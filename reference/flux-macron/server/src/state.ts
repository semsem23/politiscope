import { STANDARD_COVERAGE_NOTES, buildDemoState, buildEvents, computeWindow, formatParis } from "../../shared/src";
import type { SourceStatus, StateResponse, TimeWindow } from "../../shared/src";
import type { Collector } from "./collectors/types";
import type { Config } from "./config";
import type { Store } from "./db";

export function describeSources(config: Config, store: Store, collectors: Collector[], now: Date): SourceStatus[] {
  return collectors.map((c) => {
    const base: SourceStatus = { id: c.id, kind: c.kind, label: c.label, state: "not_configured", setupHint: c.setupHint };
    if (config.demoMode) return { ...base, note: "Mode démonstration : aucune collecte n'est effectuée." };
    if (!c.isConfigured(config)) return base;

    const last = store.lastRun(c.id);
    const ok = store.lastSuccess(c.id);
    const info: SourceStatus = {
      ...base,
      setupHint: undefined,
      lastAttemptAt: last?.finishedAt,
      lastSuccessAt: ok?.finishedAt,
      itemsLastRun: ok?.fetched,
    };
    const limitedUntil = Number(store.kvGet(`ratelimit:${c.id}`) ?? 0);
    if (limitedUntil > now.getTime()) {
      return { ...info, state: "limited", note: `Limite de débit atteinte : reprise après ${formatParis(limitedUntil, "dayTime")}.`, lastError: last?.error };
    }
    // Aucun état « opérationnel » tant qu'une collecte réelle n'a pas réussi.
    if (!last) return { ...info, state: "pending", note: "Configurée, mais aucune collecte n'a encore été effectuée." };
    if (!last.ok) return { ...info, state: "unavailable", lastError: last.error };
    if (last.error) return { ...info, state: "limited", lastError: last.error, note: "Couverture partielle lors de la dernière collecte." };
    return { ...info, state: "operational" };
  });
}

export function buildLiveState(config: Config, store: Store, collectors: Collector[], key: TimeWindow, now: Date): StateResponse {
  if (config.demoMode) {
    const demo = buildDemoState(now, key);
    demo.sources = describeSources(config, store, collectors, now);
    return demo;
  }

  const window = computeWindow(key, now);
  const startMs = Date.parse(window.start);
  const built = buildEvents(store.articlesBetween(window.start, window.end), {
    now,
    officialAccounts: config.officialAccounts,
    overrides: store.getOverrides(),
    detachedArticleIds: store.listDetached(),
    manualLinks: store.listLinks(),
    personalities: config.personalities,
  });
  const events = built.events.filter((e) => Date.parse(e.firstPublishedAt) >= startMs);
  const ids = new Set(events.map((e) => e.id));
  for (const e of events) {
    e.suggestedRelations = e.suggestedRelations.filter((id) => ids.has(id));
    e.confirmedRelations = e.confirmedRelations.filter((id) => ids.has(id));
  }
  const sources = describeSources(config, store, collectors, now);
  const successes = sources.map((s) => s.lastSuccessAt).filter((x): x is string => !!x).sort();

  const notes = [...STANDARD_COVERAGE_NOTES];
  const missing = sources.filter((s) => s.state === "not_configured").map((s) => s.label);
  if (missing.length) notes.push(`Sources non configurées, donc absentes de cet affichage : ${missing.join(", ")}.`);
  const down = sources.filter((s) => s.state === "unavailable" || s.state === "limited").map((s) => s.label);
  if (down.length) notes.push(`Sources indisponibles ou limitées lors de la dernière collecte : ${down.join(", ")}. La couverture est partielle.`);

  return {
    mode: "live",
    window,
    generatedAt: now.toISOString(),
    lastRefreshAt: successes[successes.length - 1],
    articles: built.articles.filter((a) => a.eventId && ids.has(a.eventId)),
    events,
    sources,
    coverageNotes: notes,
    personalities: config.personalities,
  };
}
