import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite"; // intégré à Node ≥ 22.13 (avertissement « experimental » normal)
import type { Article, EventOverride } from "../../shared/src";

export interface RunRecord {
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  rejected: number;
  error?: string;
}

export class Store {
  private db: DatabaseSync;
  /** Incrémenté à chaque écriture : permet d'invalider d'éventuels caches. */
  version = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        published_at TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
      CREATE TABLE IF NOT EXISTS source_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        ok INTEGER NOT NULL,
        fetched INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        rejected INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_source ON source_runs(source_id, id);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS overrides (
        event_id TEXT PRIMARY KEY, status TEXT, category TEXT, title TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS detached (article_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS manual_links (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b));
    `);
  }

  close() {
    this.db.close();
  }

  // — articles ————————————————————————————————————————
  /** Insère sans écraser : la première capture (et son heure de collecte) fait foi. Retourne le nombre inséré. */
  insertArticles(articles: Article[]): number {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO articles (id, url, published_at, collected_at, source_kind, data) VALUES (?, ?, ?, ?, ?, ?)",
    );
    let inserted = 0;
    this.db.exec("BEGIN");
    try {
      for (const a of articles) {
        const r = stmt.run(a.id, a.url, a.publishedAt, a.collectedAt, a.sourceKind, JSON.stringify(a));
        inserted += Number(r.changes);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    if (inserted) this.version++;
    return inserted;
  }

  articlesBetween(startIso: string, endIso: string): Article[] {
    const rows = this.db
      .prepare("SELECT data FROM articles WHERE published_at >= ? AND published_at <= ? ORDER BY published_at ASC")
      .all(startIso, endIso) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Article);
  }

  countArticles(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM articles").get() as { n: number }).n);
  }

  purgeOlderThan(iso: string): number {
    const r = this.db.prepare("DELETE FROM articles WHERE published_at < ?").run(iso);
    if (Number(r.changes)) this.version++;
    return Number(r.changes);
  }

  // — exécutions de collecte ———————————————————————————
  recordRun(r: RunRecord) {
    this.db
      .prepare(
        "INSERT INTO source_runs (source_id, started_at, finished_at, ok, fetched, inserted, rejected, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.sourceId, r.startedAt, r.finishedAt, r.ok ? 1 : 0, r.fetched, r.inserted, r.rejected, r.error ?? null);
    this.version++;
  }

  private mapRun(row: Record<string, unknown> | undefined): RunRecord | undefined {
    if (!row) return undefined;
    return {
      sourceId: String(row.source_id),
      startedAt: String(row.started_at),
      finishedAt: String(row.finished_at),
      ok: Number(row.ok) === 1,
      fetched: Number(row.fetched),
      inserted: Number(row.inserted),
      rejected: Number(row.rejected),
      error: row.error ? String(row.error) : undefined,
    };
  }

  lastRun(sourceId: string): RunRecord | undefined {
    return this.mapRun(this.db.prepare("SELECT * FROM source_runs WHERE source_id = ? ORDER BY id DESC LIMIT 1").get(sourceId));
  }

  lastSuccess(sourceId: string): RunRecord | undefined {
    return this.mapRun(this.db.prepare("SELECT * FROM source_runs WHERE source_id = ? AND ok = 1 ORDER BY id DESC LIMIT 1").get(sourceId));
  }

  // — clé / valeur (curseurs, limites de débit) ————————————
  kvGet(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }
  kvSet(key: string, value: string) {
    this.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // — corrections manuelles ————————————————————————————
  getOverrides(): Record<string, EventOverride> {
    const rows = this.db.prepare("SELECT * FROM overrides").all() as Record<string, string | null>[];
    const out: Record<string, EventOverride> = {};
    for (const r of rows) {
      const o: EventOverride = {};
      if (r.status) o.status = r.status as EventOverride["status"];
      if (r.category) o.category = r.category as EventOverride["category"];
      if (r.title) o.title = r.title;
      out[String(r.event_id)] = o;
    }
    return out;
  }
  setOverride(eventId: string, o: EventOverride) {
    const prev = this.getOverrides()[eventId] ?? {};
    const m = { ...prev, ...o };
    this.db
      .prepare(
        "INSERT INTO overrides (event_id, status, category, title, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET status = excluded.status, category = excluded.category, title = excluded.title, updated_at = excluded.updated_at",
      )
      .run(eventId, m.status ?? null, m.category ?? null, m.title ?? null, new Date().toISOString());
    this.version++;
  }
  listDetached(): string[] {
    return (this.db.prepare("SELECT article_id FROM detached").all() as { article_id: string }[]).map((r) => r.article_id);
  }
  detach(articleId: string) {
    this.db.prepare("INSERT OR IGNORE INTO detached (article_id) VALUES (?)").run(articleId);
    this.version++;
  }
  listLinks(): [string, string][] {
    return (this.db.prepare("SELECT a, b FROM manual_links").all() as { a: string; b: string }[]).map((r) => [r.a, r.b]);
  }
  addLink(a: string, b: string) {
    this.db.prepare("INSERT OR IGNORE INTO manual_links (a, b) VALUES (?, ?)").run(a, b);
    this.version++;
  }
}
