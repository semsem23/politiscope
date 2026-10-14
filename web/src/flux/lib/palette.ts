import type { ActivityCategory, EventKind, SourceKind, VerificationStatus } from "../shared";

export const catVar = (c: ActivityCategory) => `var(--cat-${c})`;
export const srcVar = (k: SourceKind) => `var(--src-${k})`;

// Le statut est signalé par un glyphe ET un libellé, jamais par la couleur seule.
export const STATUS_GLYPH: Record<VerificationStatus, string> = {
  cross_checked: "✓",
  single_source: "1",
  needs_review: "?",
  scheduled: "◷",
  disputed: "✕",
};

export const LANE_SHORT: Record<ActivityCategory, string> = {
  france: "France",
  diplomacy: "Diplo.",
  economy: "Économie",
  security: "Sécurité",
  international: "Internat.",
  institutions: "Institut.",
  environment: "Environ.",
  other: "Autres",
};

export const LANE_SUB: Record<ActivityCategory, string> = {
  france: "Vie politique nationale",
  diplomacy: "Relations internationales",
  economy: "Économie, travail, industrie",
  security: "Défense, sécurité, crise",
  international: "Afrique, Europe, monde",
  institutions: "Gouvernement, Parlement, lois",
  environment: "Climat, énergie, biodiversité",
  other: "Sans rubrique identifiée",
};

// Icônes (viewBox 24×24) par nature d'activité — dessinées pour ce projet.
export const KIND_ICON: Record<EventKind, string> = {
  declaration: "M3 10v4a1 1 0 0 0 1 1h2.5l5 4V5l-5 4H4a1 1 0 0 0-1 1zm14.2 2a4.6 4.6 0 0 0-2.4-4.05v8.1A4.6 4.6 0 0 0 17.2 12z",
  travel: "M3 11.5 21 3l-8.5 18-2.2-7.3L3 11.5z",
  meeting:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM9 13c-3 0-6 1.5-6 4v2h12v-2c0-2.5-3-4-6-4zm7 .5c-.6 0-1.2.1-1.7.2 1.1.9 1.7 2.1 1.7 3.3v2h5v-1.5c0-2-2.2-4-5-4z",
  publication: "M4 4h16v12H8.5L4 20.5V4z",
  other: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

export const SOURCE_BADGE: Record<SourceKind, { letter: string; className: string }> = {
  x: { letter: "X", className: "sb-x" },
  google_news: { letter: "G", className: "sb-google" },
  other: { letter: "•", className: "sb-other" },
};
