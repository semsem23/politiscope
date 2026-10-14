import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api";
import { CollectionService } from "../src/collect";
import type { Collector } from "../src/collectors/types";
import { ALL_COLLECTORS } from "../src/collectors";
import { parseFeed } from "../src/collectors/rss";
import { parseGoogleNews } from "../src/collectors/googleNews";
import { mapPosts } from "../src/collectors/x";
import { loadConfig } from "../src/config";
import { Store } from "../src/db";
import { RateLimitError, safeMessage } from "../src/http";
import { describeSources } from "../src/state";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getJson = async (url: string, init?: RequestInit): Promise<any> => (await fetch(url, init)).json();

const NOW = new Date("2026-10-13T12:00:00Z");
const SINCE = new Date("2026-10-01T00:00:00Z");

// Jeux d'essai FICTIFS, uniquement pour tester l'analyse des formats (jamais affichés comme des données).
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>test</title>
  <item>
    <title>Macron évoque un plan fictif de test - Média Test</title>
    <link>https://news.example.org/rss/articles/abc?oc=5</link>
    <guid isPermaLink="false">guid-1</guid>
    <pubDate>Tue, 13 Oct 2026 09:00:00 GMT</pubDate>
    <description>&lt;ol&gt;&lt;li&gt;Macron évoque un plan fictif de test&lt;/li&gt;&lt;/ol&gt;</description>
    <source url="https://media-test.example.org">Média Test</source>
  </item>
  <item>
    <title>Un article sans rapport avec le sujet - Autre Média</title>
    <link>https://news.example.org/rss/articles/def</link>
    <pubDate>Tue, 13 Oct 2026 09:30:00 GMT</pubDate>
    <source url="https://autre.example.org">Autre Média</source>
  </item>
  <item>
    <title>Macron : ancien article hors période</title>
    <link>https://news.example.org/rss/articles/old</link>
    <pubDate>Mon, 01 Jan 2024 09:30:00 GMT</pubDate>
  </item>
  <item>
    <title>MACRON <![CDATA[<script>alert(1)</script>]]> injection</title>
    <link>javascript:alert(1)</link>
    <pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <title>Déclaration de Macron (flux de test)</title>
  <link rel="alternate" href="https://atom-test.example.org/a1"/>
  <id>tag:test:1</id><published>2026-10-13T08:00:00Z</published>
  <summary>Résumé de test</summary></entry></feed>`;

describe("analyse des flux", () => {
  it("Google Actualités : garde les mentions de Macron récentes, avec le média et sans rien inventer", () => {
    const items = parseGoogleNews(RSS, SINCE);
    expect(items.map((i) => i.publisherName)).toEqual(["Média Test", "Source inconnue"]);
    expect(items[0].url).toBe("https://news.example.org/rss/articles/abc?oc=5");
    expect(items[0].nativeId).toBe("guid-1");
    expect(items[0].sourceKind).toBe("google_news");
  });

  it("Atom : lit les entrées avec lien alternatif et date de publication", () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe("https://atom-test.example.org/a1");
    expect(items[0].date).toBe("2026-10-13T08:00:00Z");
  });

  it("X : transforme les publications en éléments bruts sourcés (URL, compte, date)", () => {
    const items = mapPosts({ id: "1", username: "CompteTest" }, [
      { id: "111", text: "Texte de\ntest", created_at: "2026-10-13T07:00:00.000Z" },
      { id: "112", text: "sans date" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://x.com/CompteTest/status/111");
    expect(items[0].authorOrAccount).toBe("@CompteTest");
    expect(items[0].title).toBe("Texte de test");
  });
});

describe("configuration", () => {
  it("rien n'est configuré par défaut ; les secrets viennent de l'environnement", () => {
    const c = loadConfig({});
    expect(ALL_COLLECTORS.some((x) => x.isConfigured(c))).toBe(false);
    expect(c.host).toBe("127.0.0.1");
    const c2 = loadConfig({ X_BEARER_TOKEN: "secret", GOOGLE_NEWS_RSS_ENABLED: "true", PERSONALITIES: "Camille Démo|C. Démo; ab" });
    expect(ALL_COLLECTORS.filter((x) => x.isConfigured(c2)).map((x) => x.id).sort()).toEqual(["google_news", "x"]);
    expect(c2.personalities.map((p) => p.name)).toEqual(["Camille Démo"]);
    expect(c2.personalities[0].aliases).toEqual(["C. Démo"]);
  });

  it("les messages d'erreur ne contiennent jamais de jeton", () => {
    expect(safeMessage(new Error("échec Bearer abc.def-123 reçu"))).not.toContain("abc.def");
  });
});

function fakeCollector(over: Partial<Collector> & { collect: Collector["collect"] }): Collector {
  return { id: "fake", kind: "other", label: "Fake", setupHint: "", minIntervalMs: 0, isConfigured: () => true, ...over };
}

describe("collecte et état des sources", () => {
  it("une source configurée est « en attente » tant qu'aucune collecte réelle n'a réussi", () => {
    const store = new Store(":memory:");
    const config = loadConfig({ GOOGLE_NEWS_RSS_ENABLED: "true" });
    const st = describeSources(config, store, ALL_COLLECTORS, NOW);
    expect(st.find((s) => s.id === "google_news")!.state).toBe("pending");
    expect(st.find((s) => s.id === "x")!.state).toBe("not_configured");
  });

  it("enregistre, normalise, rejette l'invalide et devient « opérationnelle » seulement après succès", async () => {
    const store = new Store(":memory:");
    const config = loadConfig({});
    const c = fakeCollector({
      id: "google_news",
      collect: async () => ({
        items: [
          { sourceKind: "google_news", publisherName: "Média Test", title: "Macron annonce un plan de test", url: "https://example.org/a", publishedAt: "2026-10-13T09:00:00Z" },
          { sourceKind: "google_news", publisherName: "Média Test", title: "Titre avec lien dangereux", url: "javascript:alert(1)", publishedAt: "2026-10-13T09:00:00Z" },
        ],
      }),
    });
    const service = new CollectionService(config, store, [c], () => NOW);
    const [run] = await service.run();
    expect(run).toMatchObject({ ok: true, fetched: 2, inserted: 1, rejected: 1 });
    expect(store.countArticles()).toBe(1);
    const again = await service.run({ force: true });
    expect(again[0].inserted).toBe(0); // idempotent
    const real = { ...ALL_COLLECTORS[1], isConfigured: () => true, id: "google_news" } as Collector;
    expect(describeSources(config, store, [real], NOW)[0].state).toBe("operational");
  });

  it("échec : source indisponible, rien d'enregistré, erreur sans secret", async () => {
    const store = new Store(":memory:");
    const service = new CollectionService(loadConfig({}), store, [fakeCollector({ collect: async () => { throw new Error("boom Bearer topsecret"); } })], () => NOW);
    const [run] = await service.run();
    expect(run.ok).toBe(false);
    expect(run.error).not.toContain("topsecret");
    expect(store.countArticles()).toBe(0);
    expect(store.lastRun("fake")!.ok).toBe(false);
  });

  it("limite de débit : la source passe en « limitée » et n'est plus interrogée avant la reprise", async () => {
    const store = new Store(":memory:");
    let calls = 0;
    const c = fakeCollector({ collect: async () => { calls++; throw new RateLimitError(NOW.getTime() + 15 * 60_000); } });
    const config = loadConfig({});
    const service = new CollectionService(config, store, [c], () => NOW);
    await service.run();
    const second = await service.run({ force: true });
    expect(calls).toBe(1);
    expect(second[0].skipped).toMatch(/limite/);
    expect(describeSources(config, store, [c], NOW)[0].state).toBe("limited");
  });

  it("le curseur n'est mémorisé qu'après l'enregistrement (commit)", async () => {
    const store = new Store(":memory:");
    let committed = false;
    const c = fakeCollector({ collect: async () => ({ items: [], commit: () => { committed = true; } }) });
    await new CollectionService(loadConfig({}), store, [c], () => NOW).run();
    expect(committed).toBe(true);
  });

  it("rafraîchissement manuel : refusé si trop fréquent, sans effet si rien n'est configuré", async () => {
    const store = new Store(":memory:");
    const none = new CollectionService(loadConfig({}), store, ALL_COLLECTORS, () => NOW);
    expect((await none.manualRefresh()).message).toMatch(/Aucune source configurée/);
    const c = fakeCollector({ collect: async () => ({ items: [] }) });
    const svc = new CollectionService(loadConfig({}), store, [c], () => NOW);
    expect((await svc.manualRefresh()).ok).toBe(true);
    const r = await svc.manualRefresh();
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("API HTTP", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start(env: Record<string, string>) {
    const config = loadConfig(env);
    const store = new Store(":memory:");
    const service = new CollectionService(config, store, ALL_COLLECTORS, () => NOW);
    const app = createApp({ config, store, collectors: ALL_COLLECTORS, service, clock: () => NOW });
    server = await new Promise<Server>((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
  }

  it("mode réel sans source : état vide honnête, jamais de données inventées", async () => {
    const { base } = await start({});
    const s = await getJson(`${base}/api/state?window=24h`);
    expect(s.mode).toBe("live");
    expect(s.articles).toEqual([]);
    expect(s.events).toEqual([]);
    expect(s.sources.every((x: { state: string }) => x.state === "not_configured")).toBe(true);
    expect(s.window.timezone).toBe("Europe/Paris");
    expect(Date.parse(s.window.end) - Date.parse(s.window.start)).toBe(24 * 3600_000);
  });

  it("mode démonstration : données marquées DEMO", async () => {
    const { base } = await start({ DEMO_MODE: "true" });
    const s = await getJson(`${base}/api/state?window=7d`);
    expect(s.mode).toBe("demo");
    expect(s.events.length).toBeGreaterThan(0);
    expect(s.events.every((e: { isDemo?: boolean }) => e.isDemo)).toBe(true);
    const r = await getJson(`${base}/api/refresh`, { method: "POST" });
    expect(r.mode).toBe("demo");
  });

  it("mode réel : un article enregistré apparaît avec sa source, son URL et ses dates", async () => {
    const { base, store } = await start({});
    store.insertArticles([
      { id: "x:1", sourceKind: "google_news", publisherName: "Média Test", title: "Macron annonce un plan de test pour la journée", url: "https://example.org/a", publishedAt: "2026-10-13T09:00:00.000Z", collectedAt: "2026-10-13T09:05:00.000Z" },
    ]);
    const s = await getJson(`${base}/api/state?window=24h`);
    expect(s.articles).toHaveLength(1);
    expect(s.articles[0].url).toBe("https://example.org/a");
    expect(s.events).toHaveLength(1);
    expect(s.events[0].status).toBe("single_source");
    expect(s.events[0].isDemo).toBeUndefined();
  });

  it("paramètre invalide, route inconnue, administration protégée", async () => {
    const { base } = await start({});
    expect((await fetch(`${base}/api/state?window=1y`)).status).toBe(400);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/events/e1`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    await server!.close();
    const { base: b2 } = await start({ ADMIN_TOKEN: "t0ken" });
    const bad = await fetch(`${b2}/api/events/e1`, { method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer nope" }, body: "{}" });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${b2}/api/events/e1`, { method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer t0ken" }, body: JSON.stringify({ status: "disputed" }) });
    expect(ok.status).toBe(200);
    const invalid = await fetch(`${b2}/api/events/e1`, { method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer t0ken" }, body: JSON.stringify({ status: "hack" }) });
    expect(invalid.status).toBe(400);
  });
});
