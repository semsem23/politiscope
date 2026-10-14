import { normalizeRaw } from "../../shared/src";
import type { Article, RawItem } from "../../shared/src";
import type { Config } from "./config";
import type { Store } from "./db";
import { RateLimitError, safeMessage } from "./http";
import type { Collector } from "./collectors/types";

export interface RunSummary {
  sourceId: string;
  ok: boolean;
  skipped?: string;
  fetched: number;
  inserted: number;
  rejected: number;
  error?: string;
}

const DAY = 86_400_000;

/**
 * Pilote la collecte. Il n'y a ici AUCUNE donnée simulée : si aucune source n'est configurée ou
 * accessible, rien n'est enregistré et l'état des sources le dit.
 */
export class CollectionService {
  private running = false;
  private lastManualAt = 0;

  constructor(
    private config: Config,
    private store: Store,
    private collectors: Collector[],
    private clock: () => Date = () => new Date(),
  ) {}

  get isRunning() {
    return this.running;
  }

  hasConfiguredSources(): boolean {
    return this.collectors.some((c) => c.isConfigured(this.config));
  }

  /** Rafraîchissement manuel : limité en fréquence. */
  async manualRefresh(): Promise<{ ok: boolean; retryAfterSeconds?: number; message: string; runs: RunSummary[] }> {
    const wait = this.lastManualAt + this.config.minManualRefreshSeconds * 1000 - this.clock().getTime();
    if (wait > 0) {
      return { ok: false, retryAfterSeconds: Math.ceil(wait / 1000), message: "Rafraîchissement trop fréquent : patientez avant de réessayer.", runs: [] };
    }
    if (this.running) return { ok: false, retryAfterSeconds: 10, message: "Une collecte est déjà en cours.", runs: [] };
    if (!this.hasConfiguredSources()) {
      return { ok: true, message: "Aucune source configurée : rien à collecter.", runs: [] };
    }
    this.lastManualAt = this.clock().getTime();
    const runs = await this.run({ force: false });
    const done = runs.filter((r) => !r.skipped);
    const message = done.length
      ? `Collecte terminée : ${done.reduce((n, r) => n + r.inserted, 0)} nouvel(s) élément(s).`
      : "Aucune collecte lancée : sources récemment interrogées ou limitées (voir l'état des sources).";
    return { ok: true, message, runs };
  }

  async run(opts: { force?: boolean } = {}): Promise<RunSummary[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const summaries: RunSummary[] = [];
      for (const c of this.collectors) {
        if (!c.isConfigured(this.config)) continue;
        summaries.push(await this.runOne(c, !!opts.force));
      }
      this.store.purgeOlderThan(new Date(this.clock().getTime() - this.config.retentionDays * DAY).toISOString());
      return summaries;
    } finally {
      this.running = false;
    }
  }

  private async runOne(c: Collector, force: boolean): Promise<RunSummary> {
    const now = this.clock();
    const base = { sourceId: c.id, fetched: 0, inserted: 0, rejected: 0 };

    const limitedUntil = Number(this.store.kvGet(`ratelimit:${c.id}`) ?? 0);
    if (limitedUntil > now.getTime()) return { ...base, ok: false, skipped: "limite de débit : reprise différée" };

    const last = this.store.lastRun(c.id);
    if (!force && last && Date.parse(last.startedAt) + c.minIntervalMs > now.getTime()) {
      return { ...base, ok: last.ok, skipped: "collecte récente" };
    }

    const startedAt = now.toISOString();
    try {
      const since = new Date(now.getTime() - 30 * DAY);
      const result = await c.collect({
        config: this.config,
        since,
        now,
        kv: { get: (k) => this.store.kvGet(k), set: (k, v) => this.store.kvSet(k, v) },
      });

      const articles: Article[] = [];
      let rejected = 0;
      const reasons = new Map<string, number>();
      for (const raw of result.items as RawItem[]) {
        const n = normalizeRaw(raw, now);
        if (n.ok && Date.parse(n.article.publishedAt) >= since.getTime()) articles.push(n.article);
        else {
          rejected++;
          const why = n.ok ? "hors fenêtre" : n.reason;
          reasons.set(why, (reasons.get(why) ?? 0) + 1);
        }
      }
      const inserted = this.store.insertArticles(articles);
      result.commit?.(); // curseurs mémorisés seulement après enregistrement réussi

      const partial = result.partialErrors?.join(" ; ");
      this.store.recordRun({ sourceId: c.id, startedAt, finishedAt: this.clock().toISOString(), ok: true, fetched: result.items.length, inserted, rejected, error: partial });
      console.log(`[collecte] source=${c.id} reçus=${result.items.length} insérés=${inserted} rejetés=${rejected}${rejected ? ` (${[...reasons].map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""}${partial ? ` partiel="${partial}"` : ""}`);
      return { ...base, ok: true, fetched: result.items.length, inserted, rejected };
    } catch (e) {
      const error = safeMessage(e);
      if (e instanceof RateLimitError) this.store.kvSet(`ratelimit:${c.id}`, String(e.resetAtMs));
      this.store.recordRun({ sourceId: c.id, startedAt, finishedAt: this.clock().toISOString(), ok: false, fetched: 0, inserted: 0, rejected: 0, error });
      console.warn(`[collecte] source=${c.id} échec : ${error}`);
      return { ...base, ok: false, error };
    }
  }
}

export function startScheduler(service: CollectionService, config: Config): () => void {
  if (config.demoMode) {
    console.log("[planification] mode démonstration : aucune collecte.");
    return () => {};
  }
  if (!service.hasConfiguredSources()) {
    console.log("[planification] aucune source configurée : aucune collecte planifiée.");
    return () => {};
  }
  const tick = () => void service.run().catch((e) => console.error("[planification]", safeMessage(e)));
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, config.refreshIntervalMinutes * 60_000);
  console.log(`[planification] collecte toutes les ${config.refreshIntervalMinutes} min.`);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
