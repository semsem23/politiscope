import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { CATEGORY_ORDER } from "../../shared/src";
import type { ActivityCategory, EventOverride, TimeWindow, VerificationStatus } from "../../shared/src";
import type { CollectionService } from "./collect";
import type { Collector } from "./collectors/types";
import type { Config } from "./config";
import type { Store } from "./db";
import { buildLiveState } from "./state";

const WINDOWS: TimeWindow[] = ["24h", "7d", "30d"];
const STATUSES: VerificationStatus[] = ["cross_checked", "single_source", "needs_review", "scheduled", "disputed"];

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AppDeps {
  config: Config;
  store: Store;
  collectors: Collector[];
  service: CollectionService;
  clock?: () => Date;
}

export function createApp({ config, store, collectors, service, clock = () => new Date() }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: config.demoMode ? "demo" : "live" });
  });

  app.get("/api/state", (req, res) => {
    const key = String(req.query.window ?? "24h") as TimeWindow;
    if (!WINDOWS.includes(key)) return void res.status(400).json({ error: "Paramètre window invalide (24h, 7d ou 30d)." });
    res.setHeader("Cache-Control", "no-store");
    res.json(buildLiveState(config, store, collectors, key, clock()));
  });

  app.post("/api/refresh", async (_req, res) => {
    if (config.demoMode) return void res.json({ ok: true, mode: "demo", message: "Mode démonstration : aucune collecte n'est effectuée." });
    const r = await service.manualRefresh();
    if (r.retryAfterSeconds) res.setHeader("Retry-After", String(r.retryAfterSeconds));
    res.status(r.ok ? 200 : 429).json(r.ok ? { ok: true, message: r.message, runs: r.runs } : { error: r.message, retryAfterSeconds: r.retryAfterSeconds });
  });

  // — corrections manuelles : désactivées sans ADMIN_TOKEN —
  const admin = (req: Request, res: Response, next: NextFunction) => {
    if (!config.adminToken) return void res.status(403).json({ error: "Administration désactivée : définissez ADMIN_TOKEN côté serveur." });
    const given = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    if (!sameToken(given, config.adminToken)) return void res.status(401).json({ error: "Jeton d'administration invalide." });
    next();
  };

  app.patch("/api/events/:id", admin, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const o: EventOverride = {};
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status as VerificationStatus)) return void res.status(400).json({ error: "status invalide" });
      o.status = b.status as VerificationStatus;
    }
    if (b.category !== undefined) {
      if (!CATEGORY_ORDER.includes(b.category as ActivityCategory)) return void res.status(400).json({ error: "category invalide" });
      o.category = b.category as ActivityCategory;
    }
    if (b.title !== undefined) {
      if (typeof b.title !== "string" || b.title.trim().length < 3) return void res.status(400).json({ error: "title invalide" });
      o.title = b.title.trim().slice(0, 200);
    }
    store.setOverride(String(req.params.id), o);
    res.json({ ok: true });
  });

  app.post("/api/events/:id/detach", admin, (req, res) => {
    const id = (req.body as { articleId?: unknown })?.articleId;
    if (typeof id !== "string" || id.length > 200) return void res.status(400).json({ error: "articleId requis" });
    store.detach(id);
    res.json({ ok: true });
  });

  app.post("/api/links", admin, (req, res) => {
    const { a, b } = (req.body ?? {}) as { a?: unknown; b?: unknown };
    if (typeof a !== "string" || typeof b !== "string" || a === b) return void res.status(400).json({ error: "a et b requis, distincts" });
    store.addLink(a, b);
    res.json({ ok: true });
  });

  // — interface web compilée (npm run build), servie par le même serveur —
  const dist = resolve(process.cwd(), config.webDist);
  if (existsSync(resolve(dist, "index.html"))) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) return next();
      res.sendFile(resolve(dist, "index.html"));
    });
  }

  app.use("/api", (_req, res) => void res.status(404).json({ error: "Route inconnue." }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Erreur interne." });
  });
  return app;
}
