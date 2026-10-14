// Données RÉELLES de la page /flux : assemble l'état à partir de ce que Supabase contient.
// Code pur (aucun réseau) : testé dans live.test.ts. La lecture elle-même est dans data.ts.
//
// Rien n'est inventé : sans article, la page n'a aucun événement ; sans passage de collecte
// enregistré, une source est « en attente », jamais « opérationnelle ».
import type { Article, Personality, SourceStatus, StateResponse, TimeWindow } from "./shared";
import { SOURCE_LABEL, STANDARD_COVERAGE_NOTES, buildEvents, computeWindow, formatParis } from "./shared";

/** Compte X traité comme source primaire (compte officiel de la figure suivie). */
export const OFFICIAL_ACCOUNTS = ["EmmanuelMacron"];

/** La collecte tourne une fois par jour : au-delà de ce délai sans passage réussi, la source est « limitée ». */
export const STALE_AFTER_MS = 48 * 3600_000;

export interface ArticleRow {
  id: string;
  source_kind: "x" | "google_news";
  publisher_name: string;
  title: string;
  excerpt: string | null;
  url: string;
  published_at: string;
  collected_at: string;
  author_or_account: string | null;
  original_source_url: string | null;
}

export interface RunRow {
  source_kind: "x" | "google_news";
  started_at: string;
  finished_at: string | null;
  status: "ok" | "error" | "disabled" | "not_configured";
  items_seen: number;
  items_kept: number;
  items_new: number;
  error: string | null;
}

export interface PersonalityRow {
  id: string;
  name: string;
  aliases: string[] | null;
  role: string | null;
}

export function rowToArticle(r: ArticleRow): Article {
  const a: Article = {
    id: r.id,
    sourceKind: r.source_kind,
    publisherName: r.publisher_name,
    title: r.title,
    url: r.url,
    publishedAt: new Date(r.published_at).toISOString(),
    collectedAt: new Date(r.collected_at).toISOString(),
  };
  if (r.excerpt) a.excerpt = r.excerpt;
  if (r.author_or_account) a.authorOrAccount = r.author_or_account;
  if (r.original_source_url) a.originalSourceUrl = r.original_source_url;
  return a;
}

export const rowToPersonality = (r: PersonalityRow): Personality => ({
  id: r.id,
  name: r.name,
  aliases: r.aliases ?? [],
  ...(r.role ? { role: r.role } : {}),
});

const SOURCES: ("x" | "google_news")[] = ["x", "google_news"];

const SETUP_HINT: Record<"x" | "google_news", string> = {
  x: "Les publications de @EmmanuelMacron sont lues dans la base, alimentée chaque nuit par `fetch-x` (X_BEARER_TOKEN) : lancez `fetch-x`, puis `fetch-flux`. Voir README.",
  google_news:
    "Google n'offre pas d'API officielle : le flux RSS public est lu seulement si GOOGLE_NEWS_ENABLED=true, après avoir vérifié ses conditions d'usage (usage personnel et non commercial). Voir README.",
};

const hoursAgo = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 3600_000));

/** État de chaque source d'après le journal `flux_source_runs`. « Opérationnelle » seulement après une collecte réussie. */
export function describeSources(runs: RunRow[], now: Date): SourceStatus[] {
  const byRecent = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
  return SOURCES.map((kind) => {
    const mine = byRecent.filter((r) => r.source_kind === kind);
    const last = mine[0];
    const ok = mine.find((r) => r.status === "ok");
    const base: SourceStatus = {
      id: kind,
      kind,
      label: SOURCE_LABEL[kind],
      state: "pending",
      lastAttemptAt: last?.finished_at ?? last?.started_at,
      lastSuccessAt: ok ? (ok.finished_at ?? ok.started_at) : undefined,
      itemsLastRun: ok?.items_seen,
    };
    if (!last) return { ...base, note: "Aucun passage de collecte enregistré pour cette source." };
    if (last.status === "disabled") {
      return { ...base, state: "not_configured", note: "Désactivée volontairement : aucune requête n'est faite.", setupHint: SETUP_HINT[kind] };
    }
    if (last.status === "not_configured") {
      return { ...base, state: "not_configured", setupHint: SETUP_HINT[kind] };
    }
    if (last.status === "error") {
      return { ...base, state: "unavailable", lastError: last.error ?? "erreur inconnue" };
    }
    const finished = last.finished_at ?? last.started_at;
    if (now.getTime() - Date.parse(finished) > STALE_AFTER_MS) {
      return { ...base, state: "limited", note: `Dernière collecte réussie il y a ${hoursAgo(finished, now)} h : la collecte tourne une fois par jour.` };
    }
    return { ...base, state: "operational" };
  });
}

export interface LiveInput {
  articles: ArticleRow[];
  runs: RunRow[];
  personalities: PersonalityRow[];
  key: TimeWindow;
  now: Date;
}

export function assembleLiveState({ articles, runs, personalities, key, now }: LiveInput): StateResponse {
  const window = computeWindow(key, now);
  const startMs = Date.parse(window.start);
  const people = personalities.map(rowToPersonality);

  const built = buildEvents(articles.map(rowToArticle), { now, officialAccounts: OFFICIAL_ACCOUNTS, personalities: people });
  const events = built.events.filter((e) => Date.parse(e.firstPublishedAt) >= startMs);
  const ids = new Set(events.map((e) => e.id));
  for (const e of events) {
    e.suggestedRelations = e.suggestedRelations.filter((id) => ids.has(id));
    e.confirmedRelations = e.confirmedRelations.filter((id) => ids.has(id));
  }

  const sources = describeSources(runs, now);
  const successes = sources.map((s) => s.lastSuccessAt).filter((x): x is string => !!x).sort();

  const notes = [
    "Périmètre : Emmanuel Macron seulement. X : ses propres publications (ni réponses ni republications). Presse : titres du flux RSS public de Google Actualités qui le mentionnent.",
    "La collecte tourne une fois par jour : un article publié depuis le dernier passage n'apparaît pas encore.",
    ...STANDARD_COVERAGE_NOTES,
  ];
  const missing = sources.filter((s) => s.state === "not_configured" || s.state === "pending").map((s) => s.label);
  if (missing.length) notes.push(`Sources non configurées ou sans collecte, donc absentes de cet affichage : ${missing.join(", ")}.`);
  const down = sources.filter((s) => s.state === "unavailable" || s.state === "limited").map((s) => s.label);
  if (down.length) notes.push(`Sources indisponibles ou en retard lors de la dernière collecte : ${down.join(", ")}. La couverture est partielle.`);

  return {
    mode: "live",
    window,
    generatedAt: now.toISOString(),
    lastRefreshAt: successes[successes.length - 1],
    articles: built.articles.filter((a) => a.eventId && ids.has(a.eventId)),
    events,
    sources,
    coverageNotes: notes,
    personalities: people,
  };
}

/** « mar. 14 oct., 16:52 » : dernière collecte réussie, en heure de Paris. */
export const formatLastCollect = (iso?: string): string => (iso ? formatParis(iso) : "aucune collecte effectuée");
