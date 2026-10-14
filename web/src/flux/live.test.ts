import { describe, expect, it } from "vitest";
import { OFFICIAL_ACCOUNTS, STALE_AFTER_MS, assembleLiveState, describeSources, rowToArticle } from "./live";
import type { ArticleRow, PersonalityRow, RunRow } from "./live";

const NOW = new Date("2026-10-14T12:00:00Z");
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString();

const article = (over: Partial<ArticleRow> & { id: string }): ArticleRow => ({
  source_kind: "google_news",
  publisher_name: "Le Monde",
  title: "Emmanuel Macron reçoit le chancelier allemand à l'Élysée",
  excerpt: null,
  url: "https://news.google.com/rss/articles/CBM1",
  published_at: iso(3),
  collected_at: iso(0.5),
  author_or_account: null,
  original_source_url: null,
  ...over,
});

const run = (over: Partial<RunRow>): RunRow => ({
  source_kind: "x",
  started_at: iso(1),
  finished_at: iso(1),
  status: "ok",
  items_seen: 10,
  items_kept: 10,
  items_new: 2,
  error: null,
  ...over,
});

describe("rowToArticle", () => {
  it("convertit une ligne en article, sans champ vide inventé", () => {
    const a = rowToArticle(article({ id: "g:1" }));
    expect(a).toMatchObject({ id: "g:1", sourceKind: "google_news", publisherName: "Le Monde" });
    expect("excerpt" in a).toBe(false);
    expect("authorOrAccount" in a).toBe(false);
    expect("isDemo" in a).toBe(false);
  });

  it("conserve la date de publication et la date de collecte séparément", () => {
    const a = rowToArticle(article({ id: "g:1", published_at: iso(30), collected_at: iso(1) }));
    expect(a.publishedAt).toBe(iso(30));
    expect(a.collectedAt).toBe(iso(1));
  });
});

describe("describeSources", () => {
  it("sans aucun passage enregistré : « en attente », jamais « opérationnelle »", () => {
    const s = describeSources([], NOW);
    expect(s.map((x) => [x.id, x.state])).toEqual([["x", "pending"], ["google_news", "pending"]]);
    expect(s.every((x) => x.lastSuccessAt === undefined)).toBe(true);
  });

  it("passage réussi récent : opérationnelle, avec date et nombre d'éléments", () => {
    const x = describeSources([run({ source_kind: "x", items_seen: 71 })], NOW)[0];
    expect(x.state).toBe("operational");
    expect(x.lastSuccessAt).toBe(iso(1));
    expect(x.itemsLastRun).toBe(71);
  });

  it("source désactivée volontairement : non configurée, avec la marche à suivre", () => {
    const g = describeSources([run({ source_kind: "google_news", status: "disabled", items_seen: 0 })], NOW)[1];
    expect(g.state).toBe("not_configured");
    expect(g.setupHint).toContain("GOOGLE_NEWS_ENABLED");
  });

  it("échec : indisponible, avec l'erreur, et la dernière réussite antérieure conservée", () => {
    const runs = [
      run({ source_kind: "google_news", status: "error", error: "ConnectionError: réseau coupé", started_at: iso(1), finished_at: iso(1) }),
      run({ source_kind: "google_news", status: "ok", started_at: iso(25), finished_at: iso(25) }),
    ];
    const g = describeSources(runs, NOW)[1];
    expect(g.state).toBe("unavailable");
    expect(g.lastError).toContain("réseau coupé");
    expect(g.lastSuccessAt).toBe(iso(25));
  });

  it("dernière réussite trop ancienne : limitée, jamais « opérationnelle »", () => {
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 3600_000).toISOString();
    const x = describeSources([run({ started_at: old, finished_at: old })], NOW)[0];
    expect(x.state).toBe("limited");
    expect(x.note).toMatch(/une fois par jour/);
  });

  it("X sans ingestion : non configurée", () => {
    expect(describeSources([run({ status: "not_configured" })], NOW)[0].state).toBe("not_configured");
  });
});

describe("assembleLiveState", () => {
  const base = { runs: [run({ source_kind: "x" }), run({ source_kind: "google_news" })], personalities: [] as PersonalityRow[], key: "24h" as const, now: NOW };

  it("sans article : aucun événement ni article, état vide (rien d'inventé)", () => {
    const s = assembleLiveState({ ...base, articles: [] });
    expect(s.mode).toBe("live");
    expect(s.events).toEqual([]);
    expect(s.articles).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/example\.org|DEMO/i);
  });

  it("n'utilise que les articles fournis : mêmes URL, jamais l'heure de collecte comme heure d'événement", () => {
    const rows = [
      article({ id: "g:1", published_at: iso(5), collected_at: iso(0.2), url: "https://news.google.com/rss/articles/AAA" }),
      article({
        id: "x:1", source_kind: "x", publisher_name: "@EmmanuelMacron (X)", author_or_account: "@EmmanuelMacron",
        title: "Ce soir, entretien avec le chancelier allemand à l'Élysée", url: "https://x.com/EmmanuelMacron/status/1",
        published_at: iso(6), collected_at: iso(0.2),
      }),
    ];
    const s = assembleLiveState({ ...base, articles: rows });
    expect(s.events.length).toBeGreaterThan(0);
    const urls = new Set(rows.map((r) => r.url));
    for (const a of s.articles) expect(urls.has(a.url)).toBe(true);
    for (const e of s.events) {
      expect(e.eventTime).toBeUndefined(); // l'heure de l'événement n'est jamais déduite
      const published = e.articleIds.map((id) => Date.parse(s.articles.find((a) => a.id === id)!.publishedAt));
      expect(Date.parse(e.firstPublishedAt)).toBe(Math.min(...published));
      expect(e.isDemo).toBeUndefined();
    }
  });

  it("le compte officiel est une source primaire", () => {
    expect(OFFICIAL_ACCOUNTS).toContain("EmmanuelMacron");
    const rows = [
      article({
        id: "x:1", source_kind: "x", publisher_name: "@EmmanuelMacron (X)", author_or_account: "@EmmanuelMacron",
        title: "Hommage national aux Invalides ce matin", url: "https://x.com/EmmanuelMacron/status/1", published_at: iso(4),
      }),
    ];
    const s = assembleLiveState({ ...base, articles: rows });
    expect(s.articles[0].independenceKey).toBe("primary:x:emmanuelmacron");
  });

  it("n'affiche que les événements de la fenêtre", () => {
    const rows = [article({ id: "g:old", published_at: iso(60), title: "Emmanuel Macron inaugure un salon à Lyon", url: "https://news.google.com/rss/articles/OLD" })];
    expect(assembleLiveState({ ...base, articles: rows, key: "24h" }).events).toEqual([]);
    expect(assembleLiveState({ ...base, articles: rows, key: "7d" }).events.length).toBe(1);
  });

  it("rattache une personnalité seulement si son nom est cité (mot entier)", () => {
    const people: PersonalityRow[] = [{ id: "gabriel-attal", name: "Gabriel Attal", aliases: [], role: "Renaissance" }];
    const cite = article({ id: "g:1", title: "Emmanuel Macron et Gabriel Attal à Matignon", url: "https://news.google.com/rss/articles/B1" });
    const pas = article({ id: "g:2", title: "Emmanuel Macron s'exprime sur l'éducation", url: "https://news.google.com/rss/articles/B2", published_at: iso(10) });
    const s = assembleLiveState({ ...base, articles: [cite, pas], personalities: people });
    const withPerson = s.events.filter((e) => e.personalityIds.includes("gabriel-attal"));
    expect(withPerson).toHaveLength(1);
    expect(withPerson[0].articleIds).toEqual(expect.arrayContaining([expect.stringContaining("g:1")]));
  });

  it("signale les sources absentes ou en panne dans les notes de couverture", () => {
    const s = assembleLiveState({
      ...base, articles: [],
      runs: [run({ source_kind: "google_news", status: "disabled" }), run({ source_kind: "x", status: "error", error: "boom" })],
    });
    const notes = s.coverageNotes.join(" ");
    expect(notes).toMatch(/Google Actualités/);
    expect(notes).toMatch(/indisponibles ou en retard/);
    expect(s.lastRefreshAt).toBeUndefined();
  });
});
