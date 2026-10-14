// Configuration par variables d'environnement. Les secrets restent ICI, côté serveur :
// ils ne sont jamais envoyés au navigateur ni journalisés.
import { parsePersonalities } from "../../shared/src";
import type { Personality } from "../../shared/src";

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  demoMode: boolean;
  refreshIntervalMinutes: number;
  minManualRefreshSeconds: number;
  retentionDays: number;
  adminToken?: string;
  officialAccounts: string[];
  userAgent: string;
  webDist: string;
  google: { enabled: boolean; query: string; language: string; country: string };
  personalities: Personality[];
  x: { bearerToken?: string; accounts: string[]; maxPostsPerRefresh: number };
  warnings: string[];
}

const bool = (v?: string) => /^(1|true|yes|on)$/i.test(v ?? "");
const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const warnings: string[] = [];

  const personalities = parsePersonalities(env.PERSONALITIES);

  const refresh = int(env.REFRESH_INTERVAL_MINUTES, 30);
  if (refresh < 10) warnings.push("REFRESH_INTERVAL_MINUTES < 10 : valeur relevée à 10 pour respecter les limites des services.");

  const accounts = list(env.X_ACCOUNTS).map((a) => a.replace(/^@/, ""));
  const contact = env.HTTP_CONTACT?.trim();

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: int(env.PORT, 8787),
    dbPath: env.DB_PATH?.trim() || "./data/flux-macron.sqlite",
    demoMode: bool(env.DEMO_MODE),
    refreshIntervalMinutes: Math.max(10, refresh),
    minManualRefreshSeconds: Math.max(30, int(env.MIN_MANUAL_REFRESH_SECONDS, 60)),
    retentionDays: Math.max(31, int(env.RETENTION_DAYS, 45)),
    adminToken: env.ADMIN_TOKEN?.trim() || undefined,
    officialAccounts: (list(env.OFFICIAL_ACCOUNTS).length ? list(env.OFFICIAL_ACCOUNTS) : ["EmmanuelMacron", "Elysee"]).map((a) =>
      a.replace(/^@/, ""),
    ),
    userAgent: `FluxMacron/0.1 (veille éditoriale${contact ? `; contact: ${contact}` : ""})`,
    webDist: env.WEB_DIST?.trim() || "../web/dist",
    google: {
      enabled: bool(env.GOOGLE_NEWS_RSS_ENABLED),
      query: env.GOOGLE_NEWS_QUERY?.trim() || '"Emmanuel Macron"',
      language: env.GOOGLE_NEWS_LANGUAGE?.trim() || "fr",
      country: env.GOOGLE_NEWS_COUNTRY?.trim() || "FR",
    },
    personalities,
    x: {
      bearerToken: env.X_BEARER_TOKEN?.trim() || undefined,
      accounts: accounts.length ? accounts : ["EmmanuelMacron"],
      maxPostsPerRefresh: Math.min(100, Math.max(5, int(env.X_MAX_POSTS_PER_REFRESH, 20))),
    },
    warnings,
  };
}
