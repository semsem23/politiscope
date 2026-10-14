import type { Article } from "../types";
import { fold, hash, similarity, stripPublisherSuffix, tokenize } from "../text";

export interface DroppedDuplicate {
  article: Article;
  duplicateOf: string;
  reason: "same_id" | "same_url" | "same_title_same_publisher";
}

export function titleFingerprint(article: Pick<Article, "title" | "publisherName">): string {
  const base = fold(stripPublisherSuffix(article.title, article.publisherName))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return hash(base);
}

/** Étape 3 — doublons exacts (id, URL canonique, même titre chez le même média). */
export function dedupeExact(articles: Article[]): { kept: Article[]; dropped: DroppedDuplicate[] } {
  const byId = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const kept: Article[] = [];
  const dropped: DroppedDuplicate[] = [];

  for (const a of articles) {
    const titleKey = `${fold(a.publisherName)}|${titleFingerprint(a)}`;
    const dupId = byId.get(a.id);
    const dupUrl = byUrl.get(a.url);
    const dupTitle = byTitle.get(titleKey);
    if (dupId) dropped.push({ article: a, duplicateOf: dupId, reason: "same_id" });
    else if (dupUrl) dropped.push({ article: a, duplicateOf: dupUrl, reason: "same_url" });
    else if (dupTitle) dropped.push({ article: a, duplicateOf: dupTitle, reason: "same_title_same_publisher" });
    else {
      byId.set(a.id, a.id);
      byUrl.set(a.url, a.id);
      byTitle.set(titleKey, a.id);
      kept.push(a);
    }
  }
  return { kept, dropped };
}

const WIRE =
  /\((AFP|Reuters|AP)\)|\b(?:avec|selon|d apres|source\s*:?)\s+(?:l\s+)?(AFP|Reuters|Associated Press)\b/i;

/**
 * Étape 4a — clé d'indépendance. Plusieurs reprises d'une même dépêche ou d'un même texte
 * ne comptent que pour UNE confirmation. Les contenus externes étant non fiables, ces règles
 * ne peuvent que réduire le nombre de confirmations (jamais le gonfler).
 */
export function assignIndependence(articles: Article[], officialAccounts: string[]): Article[] {
  const official = new Set(officialAccounts.map((a) => a.replace(/^@/, "").toLowerCase()));
  const byUrl = new Map(articles.map((a) => [a.url, a]));

  // Même titre diffusé par plusieurs médias = reprise du même texte.
  const publishersByFp = new Map<string, Set<string>>();
  for (const a of articles) {
    const fp = titleFingerprint(a);
    if (!publishersByFp.has(fp)) publishersByFp.set(fp, new Set());
    publishersByFp.get(fp)!.add(fold(a.publisherName));
  }

  const baseKey = (a: Article): string => {
    const account = (a.authorOrAccount ?? "").replace(/^@/, "").toLowerCase();
    if (a.sourceKind === "x" && official.has(account)) return `primary:x:${account}`;
    const wire = WIRE.exec(fold(`${a.title} ${a.excerpt ?? ""}`));
    if (wire) return `wire:${(wire[1] ?? wire[2]).toLowerCase()}`;
    const fp = titleFingerprint(a);
    if ((publishersByFp.get(fp)?.size ?? 0) > 1) return `text:${fp}`;
    return `pub:${fold(a.publisherName)}`;
  };

  const resolve = (a: Article, depth = 0): string => {
    if (a.originalSourceUrl && depth < 5) {
      const parent = byUrl.get(a.originalSourceUrl);
      if (parent && parent.id !== a.id) return resolve(parent, depth + 1);
      return `orig:${a.originalSourceUrl}`;
    }
    return baseKey(a);
  };

  return articles.map((a) => ({ ...a, independenceKey: resolve(a) }));
}

export const NEAR_DUPLICATE_THRESHOLD = 0.85;

/**
 * Étape 4b — quasi-doublons. On ne supprime rien : l'article est seulement marqué
 * (nearDuplicateOf) et exclu du compte d'articles distincts. Si deux médias différents
 * publient un texte quasi identique, le plus récent adopte la clé d'indépendance du plus ancien
 * (probable reprise), par prudence.
 */
export function markNearDuplicates(articles: Article[]): Article[] {
  const sorted = [...articles].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const tokens = new Map(sorted.map((a) => [a.id, tokenize(`${a.title} ${a.excerpt ?? ""}`)]));
  const result = new Map<string, Article>(sorted.map((a) => [a.id, { ...a }]));

  for (let i = 0; i < sorted.length; i++) {
    const later = result.get(sorted[i].id)!;
    if (later.nearDuplicateOf) continue;
    for (let j = 0; j < i; j++) {
      const earlier = sorted[j];
      if (Math.abs(Date.parse(later.publishedAt) - Date.parse(earlier.publishedAt)) > 12 * 3600_000) continue;
      const sim = similarity(tokens.get(later.id)!, tokens.get(earlier.id)!);
      if (sim.score >= NEAR_DUPLICATE_THRESHOLD && sim.shared >= 3) {
        later.nearDuplicateOf = earlier.id;
        if (fold(later.publisherName) !== fold(earlier.publisherName)) {
          later.independenceKey = result.get(earlier.id)!.independenceKey;
        }
        break;
      }
    }
  }
  return articles.map((a) => result.get(a.id)!);
}
