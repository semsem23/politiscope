// Modèle de données de Flux Macron.
// Les champs marqués « extension » complètent le modèle suggéré par le cahier des charges.

export type SourceKind = "x" | "google_news" | "other";

export type VerificationStatus =
  | "cross_checked"
  | "single_source"
  | "needs_review"
  | "scheduled"
  | "disputed";

export type ActivityCategory =
  | "france"
  | "diplomacy"
  | "economy"
  | "security"
  | "international"
  | "institutions"
  | "environment"
  | "other";

/** Extension : nature de l'activité (heuristique à base de mots-clés, jamais certaine). */
export type EventKind = "declaration" | "travel" | "meeting" | "publication" | "other";

export type TimeWindow = "24h" | "7d" | "30d";

export interface Article {
  id: string;
  sourceKind: SourceKind;
  publisherName: string;
  title: string;
  excerpt?: string;
  url: string;
  publishedAt: string; // ISO 8601 (UTC, suffixe Z)
  collectedAt: string; // ISO 8601 (UTC, suffixe Z)
  authorOrAccount?: string;
  originalSourceUrl?: string;
  eventId?: string;
  // — extensions —
  /** Clé d'indépendance : deux articles de même clé comptent pour UNE seule confirmation. */
  independenceKey?: string;
  /** Renseigné si l'article est un quasi-doublon d'un article plus ancien. */
  nearDuplicateOf?: string;
  /** Donnée de démonstration (fictive). */
  isDemo?: boolean;
}

/** Personnalité à repérer dans les textes collectés (liste choisie par l'utilisateur, jamais devinée). */
export interface Personality {
  id: string;
  name: string;
  /** Autres graphies à repérer (mot entier). */
  aliases: string[];
  /** Fonction affichée à titre indicatif (démonstration seulement). */
  role?: string;
  isDemo?: boolean;
}

export interface ProvenanceEntry {
  articleId: string;
  joinedBy: "seed" | "same_original_source" | "similarity" | "manual";
  /** Score de similarité (0–1) lorsque joinedBy = "similarity". */
  score?: number;
  matchedWith?: string;
}

export interface ActivityEvent {
  id: string;
  title: string;
  summary: string;
  category: ActivityCategory;
  eventTime?: string; // ISO 8601 si connu — jamais déduit sans source explicite
  firstPublishedAt: string;
  lastPublishedAt: string;
  status: VerificationStatus;
  confidence?: number; // 0–1, uniquement si le calcul est documenté (voir docs/CONFIDENCE.md)
  confidenceExplanation?: string;
  articleIds: string[];
  suggestedRelations: string[];
  // — extensions —
  kind?: EventKind;
  /** Liens établis entre événements (création manuelle uniquement). */
  confirmedRelations: string[];
  /** Comment chaque article a été rattaché à l'événement. */
  provenance: ProvenanceEntry[];
  independentSourceCount: number;
  distinctArticleCount: number;
  isDemo?: boolean;
  manuallyEdited?: boolean;
  /** Personnalités CITÉES dans les titres ou extraits (mention, pas implication avérée). */
  personalityIds: string[];
}

export type SourceState =
  | "operational"
  | "limited"
  | "unavailable"
  | "not_configured"
  | "pending";

export interface SourceStatus {
  id: string;
  kind: SourceKind;
  label: string;
  state: SourceState;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  itemsLastRun?: number;
  note?: string;
  setupHint?: string;
}

export interface WindowInfo {
  key: TimeWindow;
  start: string; // ISO
  end: string; // ISO
  timezone: "Europe/Paris";
}

export interface StateResponse {
  mode: "live" | "demo";
  window: WindowInfo;
  generatedAt: string;
  lastRefreshAt?: string;
  articles: Article[];
  events: ActivityEvent[];
  sources: SourceStatus[];
  coverageNotes: string[];
  /** Liste des personnalités du filtre (vide si aucune n'est configurée). */
  personalities: Personality[];
}

export interface EventOverride {
  status?: VerificationStatus;
  category?: ActivityCategory;
  title?: string;
}

export const CATEGORY_ORDER: ActivityCategory[] = [
  "france",
  "diplomacy",
  "economy",
  "security",
  "international",
  "institutions",
  "environment",
  "other",
];

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  france: "France",
  diplomacy: "Diplomatie",
  economy: "Économie",
  security: "Sécurité",
  international: "International",
  institutions: "Institutions",
  environment: "Environnement",
  other: "Autres",
};

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  cross_checked: "recoupé",
  single_source: "source unique",
  needs_review: "à vérifier",
  scheduled: "annoncé / prévu",
  disputed: "démenti",
};

export const KIND_LABEL: Record<EventKind, string> = {
  declaration: "Déclaration",
  travel: "Déplacement",
  meeting: "Réunion",
  publication: "Publication",
  other: "Autre",
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  x: "X",
  google_news: "Google Actualités",
  other: "Autre source",
};
