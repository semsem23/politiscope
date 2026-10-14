import type { ActivityEvent, Article, EventOverride, Personality, VerificationStatus } from "../types";
import { hash, truncate } from "../text";
import { classifyCategory, classifyKind, detectContradiction, detectScheduled } from "./classify";
import { clusterArticles } from "./cluster";
import type { ClusterOptions } from "./cluster";
import { computeConfidence } from "./confidence";
import { assignIndependence, dedupeExact, markNearDuplicates } from "./dedupe";
import type { DroppedDuplicate } from "./dedupe";
import { personalitiesOfEvent } from "./personalities";

export interface BuildOptions {
  now: Date;
  /** Comptes X considérés comme sources primaires (ex. compte officiel). Sans @. */
  officialAccounts: string[];
  /** Corrections manuelles (statut, catégorie, titre) par identifiant d'événement. */
  overrides?: Record<string, EventOverride>;
  /** Articles détachés manuellement : chacun redevient un événement isolé. */
  detachedArticleIds?: string[];
  /** Regroupements imposés (articleId -> identifiant d'événement). Utilisé par la démo. */
  forcedGroups?: Record<string, string>;
  /** Liens établis manuellement entre événements. */
  manualLinks?: [string, string][];
  cluster?: Partial<ClusterOptions>;
  /** Personnalités à repérer (mention exacte). Vide par défaut. */
  personalities?: Personality[];
}

export interface BuildResult {
  events: ActivityEvent[];
  articles: Article[];
  dropped: DroppedDuplicate[];
}

/**
 * Pipeline complet, pur et déterministe :
 * dédoublonnage exact → clés d'indépendance → quasi-doublons → regroupement →
 * classification heuristique → statut → indice de recoupement → résumé extractif.
 * Aucune donnée n'est ajoutée : tout provient des articles fournis.
 */
export function buildEvents(input: Article[], options: BuildOptions): BuildResult {
  const sorted = [...input].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  const { kept, dropped } = dedupeExact(sorted);
  // Les quasi-doublons ne sont repérés qu'À L'INTÉRIEUR d'un événement (voir plus bas) :
  // un article détaché manuellement ne doit pas être « absorbé » par un autre événement.
  const arts = assignIndependence(kept, options.officialAccounts);
  const byId = new Map(arts.map((a) => [a.id, a]));

  const forced: Record<string, string> = { ...(options.forcedGroups ?? {}) };
  for (const id of options.detachedArticleIds ?? []) if (byId.has(id)) forced[id] = `evt_${hash(id)}`;

  const { clusters, suggested } = clusterArticles(arts, { ...options.cluster, forced });
  const events: ActivityEvent[] = [];

  clusters.forEach((cluster) => {
    const members = markNearDuplicates(cluster.articleIds.map((id) => byId.get(id)!)).sort((a, b) =>
      a.publishedAt.localeCompare(b.publishedAt),
    );
    for (const m of members) byId.set(m.id, m);
    const distinct = members.filter((a) => !a.nearDuplicateOf);
    const keys = new Set(distinct.map((a) => a.independenceKey));
    const hasPrimary = [...keys].some((k) => k?.startsWith("primary:"));
    const text = members.map((a) => `${a.title} ${a.excerpt ?? ""}`).join(" . ");
    const scheduled = detectScheduled(members.map((a) => a.title));
    const contradiction = detectContradiction(text);
    const first = members[0];

    let status: VerificationStatus;
    if (scheduled) status = "scheduled";
    else if (contradiction || first.title.length < 20) status = "needs_review";
    else if (keys.size >= 2) status = "cross_checked";
    else status = "single_source";

    const conf = computeConfidence({
      scheduled,
      hasPrimarySource: hasPrimary,
      independentCount: keys.size,
      totalArticles: distinct.length,
      contradictionDetected: contradiction,
    });

    const others = distinct.filter((a) => a.id !== first.id).slice(0, 3);
    const summary =
      `Premier élément : « ${truncate(first.title, 140)} » (${first.publisherName}).` +
      (others.length
        ? ` Autres titres : ${others.map((a) => `« ${truncate(a.title, 100)} » (${a.publisherName})`).join(" ; ")}.`
        : "") +
      " Résumé extractif automatique : rien n'est ajouté aux titres collectés.";

    events.push({
      id: cluster.key,
      title: first.title,
      summary,
      category: classifyCategory(text),
      kind: classifyKind(text, distinct.every((a) => a.independenceKey?.startsWith("primary:"))),
      firstPublishedAt: first.publishedAt,
      lastPublishedAt: members[members.length - 1].publishedAt,
      status,
      confidence: conf.value ?? undefined,
      confidenceExplanation: conf.explanation,
      articleIds: members.map((a) => a.id),
      suggestedRelations: [],
      confirmedRelations: [],
      provenance: cluster.provenance,
      independentSourceCount: keys.size,
      distinctArticleCount: distinct.length,
      personalityIds: personalitiesOfEvent(members, options.personalities ?? []),
      ...(members.every((a) => a.isDemo) ? { isDemo: true } : {}),
    });
  });

  // liens suggérés (symétriques) — jamais présentés comme des faits établis
  for (const p of suggested) {
    const a = events[p.a];
    const b = events[p.b];
    a.suggestedRelations.push(b.id);
    b.suggestedRelations.push(a.id);
  }

  const byEvent = new Map(events.map((e) => [e.id, e]));
  for (const [x, y] of options.manualLinks ?? []) {
    const ex = byEvent.get(x);
    const ey = byEvent.get(y);
    if (ex && ey && x !== y) {
      if (!ex.confirmedRelations.includes(y)) ex.confirmedRelations.push(y);
      if (!ey.confirmedRelations.includes(x)) ey.confirmedRelations.push(x);
      ex.suggestedRelations = ex.suggestedRelations.filter((id) => id !== y);
      ey.suggestedRelations = ey.suggestedRelations.filter((id) => id !== x);
    }
  }

  for (const e of events) {
    const o = options.overrides?.[e.id];
    if (!o) continue;
    if (o.title) e.title = truncate(o.title, 200);
    if (o.category) e.category = o.category;
    if (o.status) {
      e.status = o.status;
      if (o.status === "disputed") {
        e.confidence = undefined;
        e.confidenceExplanation = "Non évalué : événement marqué « démenti » par correction manuelle.";
      }
    }
    e.manuallyEdited = true;
  }

  const eventOf = new Map<string, string>();
  for (const e of events) for (const id of e.articleIds) eventOf.set(id, e.id);
  const articles = [...byId.values()]
    .map((a) => ({ ...a, eventId: eventOf.get(a.id) }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  events.sort((a, b) => a.firstPublishedAt.localeCompare(b.firstPublishedAt));
  return { events, articles, dropped };
}
