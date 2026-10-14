import type { Article, ProvenanceEntry } from "../types";
import { hash, similarity, tokenize } from "../text";
import type { Similarity } from "../text";

export interface Cluster {
  key: string;
  articleIds: string[];
  provenance: ProvenanceEntry[];
  forced: boolean;
}

export interface SuggestedPair {
  a: number; // index de cluster
  b: number;
  score: number;
}

export interface ClusterOptions {
  /** Score de Dice minimal pour rattacher un article à un événement. */
  joinThreshold: number;
  /** Score minimal pour proposer un rapprochement (non fusionné). */
  suggestThreshold: number;
  /** Écart de publication maximal avec le membre le plus proche. */
  maxJoinGapMs: number;
  /** Forçage manuel : articleId -> clé d'événement. Ces articles ne participent pas au regroupement automatique. */
  forced?: Record<string, string>;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  joinThreshold: 0.5,
  suggestThreshold: 0.28,
  maxJoinGapMs: 48 * 3600_000,
};

interface Feat {
  article: Article;
  t: number;
  title: Set<string>;
  text: Set<string>;
}

function articleSimilarity(a: Feat, b: Feat): Similarity {
  const t = similarity(a.title, b.title);
  const x = similarity(a.text, b.text);
  const x2 = { score: x.score * 0.9, shared: x.shared };
  return t.score >= x2.score ? t : x2;
}

/**
 * Étape 5 — regroupement. Algorithme glouton, volontairement prudent :
 *  - rattachement automatique seulement si ≥ 3 mots significatifs communs ET Dice ≥ seuil,
 *    ou si les articles citent la même source initiale ;
 *  - un rapprochement plus faible n'est jamais fusionné : il devient un lien « suggéré ».
 */
export function clusterArticles(
  articles: Article[],
  options: Partial<ClusterOptions> = {},
): { clusters: Cluster[]; suggested: SuggestedPair[] } {
  const opt = { ...DEFAULT_CLUSTER_OPTIONS, ...options };
  const forced = opt.forced ?? {};
  const feats: Feat[] = [...articles]
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id))
    .map((article) => ({
      article,
      t: Date.parse(article.publishedAt),
      title: tokenize(article.title),
      text: tokenize(`${article.title} ${article.excerpt ?? ""}`),
    }));

  const clusters: Cluster[] = [];
  const members: Feat[][] = [];
  const forcedIndex = new Map<string, number>();

  for (const f of feats) {
    const fkey = forced[f.article.id];
    if (fkey !== undefined) {
      let idx = forcedIndex.get(fkey);
      if (idx === undefined) {
        idx = clusters.length;
        forcedIndex.set(fkey, idx);
        clusters.push({ key: fkey, articleIds: [], provenance: [], forced: true });
        members.push([]);
      }
      clusters[idx].articleIds.push(f.article.id);
      clusters[idx].provenance.push({
        articleId: f.article.id,
        joinedBy: members[idx].length === 0 ? "seed" : "manual",
      });
      members[idx].push(f);
      continue;
    }

    let best = -1;
    let bestScore = 0;
    let bestEntry: ProvenanceEntry | null = null;
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].forced) continue;
      let clusterBest: ProvenanceEntry | null = null;
      for (const m of members[i]) {
        if (Math.abs(m.t - f.t) > opt.maxJoinGapMs) continue;
        const a = f.article;
        const b = m.article;
        const sameOrigin =
          (a.originalSourceUrl && (a.originalSourceUrl === b.url || a.originalSourceUrl === b.originalSourceUrl)) ||
          (b.originalSourceUrl && b.originalSourceUrl === a.url);
        if (sameOrigin) {
          clusterBest = { articleId: a.id, joinedBy: "same_original_source", score: 1, matchedWith: b.id };
          break;
        }
        const sim = articleSimilarity(f, m);
        if (sim.shared >= 3 && sim.score >= opt.joinThreshold && sim.score > (clusterBest?.score ?? 0)) {
          clusterBest = { articleId: a.id, joinedBy: "similarity", score: round(sim.score), matchedWith: b.id };
        }
      }
      if (clusterBest && (clusterBest.score ?? 0) > bestScore) {
        best = i;
        bestScore = clusterBest.score ?? 0;
        bestEntry = clusterBest;
      }
    }

    if (best >= 0 && bestEntry) {
      clusters[best].articleIds.push(f.article.id);
      clusters[best].provenance.push(bestEntry);
      members[best].push(f);
    } else {
      clusters.push({
        key: `evt_${hash(f.article.id)}`,
        articleIds: [f.article.id],
        provenance: [{ articleId: f.article.id, joinedBy: "seed" }],
        forced: false,
      });
      members.push([f]);
    }
  }

  return { clusters, suggested: suggestRelations(members, opt) };
}

const SUGGEST_GAP_MS = 72 * 3600_000;
const MAX_SUGGESTIONS_PER_CLUSTER = 3;
const SUGGEST_ARTICLE_CAP = 1500;

function suggestRelations(members: Feat[][], opt: ClusterOptions): SuggestedPair[] {
  const total = members.reduce((n, m) => n + m.length, 0);
  if (total > SUGGEST_ARTICLE_CAP) return []; // garde-fou de coût : O(n²)
  const pairs: SuggestedPair[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      let best = 0;
      for (const a of members[i]) {
        for (const b of members[j]) {
          if (Math.abs(a.t - b.t) > SUGGEST_GAP_MS) continue;
          const sim = articleSimilarity(a, b);
          if (sim.shared >= 2 && sim.score > best) best = sim.score;
        }
      }
      if (best >= opt.suggestThreshold) pairs.push({ a: i, b: j, score: round(best) });
    }
  }
  // limiter le nombre de liens suggérés par événement (les plus forts d'abord)
  pairs.sort((x, y) => y.score - x.score);
  const count = new Map<number, number>();
  return pairs.filter((p) => {
    const ca = count.get(p.a) ?? 0;
    const cb = count.get(p.b) ?? 0;
    if (ca >= MAX_SUGGESTIONS_PER_CLUSTER || cb >= MAX_SUGGESTIONS_PER_CLUSTER) return false;
    count.set(p.a, ca + 1);
    count.set(p.b, cb + 1);
    return true;
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
