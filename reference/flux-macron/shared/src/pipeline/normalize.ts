import type { Article, SourceKind } from "../types";
import { hash, stripHtml, stripPublisherSuffix, truncate, fold } from "../text";

/** Élément brut tel que renvoyé par un connecteur, avant toute validation. */
export interface RawItem {
  sourceKind: SourceKind;
  publisherName: string;
  title: string;
  excerpt?: string;
  url: string;
  publishedAt: string | number | Date;
  authorOrAccount?: string;
  originalSourceUrl?: string;
  nativeId?: string;
  isDemo?: boolean;
}

export type NormalizeResult =
  | { ok: true; article: Article }
  | { ok: false; reason: string };

const TRACKING_PARAM = /^(utm_|fbclid|gclid|mc_|ref$|ref_src|cmpid|xtor|ocid|guccounter|at_)/i;

/** URL http(s) sans identifiants, sans fragment ni paramètres de suivi. null si invalide ou dangereuse. */
export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    let s = url.toString();
    if (s.endsWith("/") && url.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export const MAX_TITLE = 300;
export const MAX_EXCERPT = 280; // extrait court : pas de reproduction d'articles protégés

export function normalizeRaw(raw: RawItem, collectedAt: Date, now: Date = collectedAt): NormalizeResult {
  const url = canonicalUrl(raw.url);
  if (!url) return { ok: false, reason: "URL invalide ou non http(s)" };

  const published = raw.publishedAt instanceof Date ? raw.publishedAt : new Date(raw.publishedAt);
  if (Number.isNaN(published.getTime())) return { ok: false, reason: "date de publication illisible" };
  if (published.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, reason: "date de publication dans le futur" };
  }

  const publisherName = truncate(stripHtml(raw.publisherName || ""), 80) || "Source inconnue";
  const title = truncate(stripPublisherSuffix(stripHtml(raw.title || ""), publisherName), MAX_TITLE);
  if (title.length < 8) return { ok: false, reason: "titre vide ou trop court" };

  let excerpt = raw.excerpt ? truncate(stripHtml(raw.excerpt), MAX_EXCERPT) : undefined;
  if (excerpt && (excerpt.length < 8 || fold(excerpt) === fold(title))) excerpt = undefined;

  const original = raw.originalSourceUrl ? canonicalUrl(raw.originalSourceUrl) ?? undefined : undefined;

  const article: Article = {
    id: `${raw.sourceKind}:${raw.nativeId ? hash(raw.nativeId) : hash(url)}`,
    sourceKind: raw.sourceKind,
    publisherName,
    title,
    url,
    publishedAt: published.toISOString(),
    collectedAt: collectedAt.toISOString(),
  };
  if (excerpt) article.excerpt = excerpt;
  if (raw.authorOrAccount) article.authorOrAccount = truncate(stripHtml(raw.authorOrAccount), 80);
  if (original) article.originalSourceUrl = original;
  if (raw.isDemo) article.isDemo = true;
  return { ok: true, article };
}
