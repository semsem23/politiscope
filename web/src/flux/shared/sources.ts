import type { SourceKind, SourceStatus } from "./types";

export const SOURCE_DEFINITIONS: { id: string; kind: SourceKind; label: string; setupHint: string }[] = [
  {
    id: "x",
    kind: "x",
    label: "X",
    setupHint:
      "API officielle X v2 : créez une application sur developer.x.com, ajoutez un crédit d'utilisation, puis définissez X_BEARER_TOKEN (côté serveur uniquement). Voir docs/SOURCES.md.",
  },
  {
    id: "google_news",
    kind: "google_news",
    label: "Google Actualités",
    setupHint:
      "Google n'offre pas d'API officielle : le connecteur lit le flux RSS public de recherche. Activez-le en connaissance de cause (GOOGLE_NEWS_RSS_ENABLED=true) après avoir vérifié les conditions d'utilisation. Voir docs/SOURCES.md.",
  },
];

export const STANDARD_COVERAGE_NOTES = [
  "Périmètre : activités publiques uniquement, d'après des titres, extraits et publications accessibles par des canaux autorisés.",
  "Catégories, natures d'activité et statuts « annoncé » ou « à vérifier » : détection automatique par mots-clés, donc approximative.",
  "L'heure placée sur la frise est celle de la PUBLICATION du premier article ; la date de l'événement décrit n'est pas déduite.",
  "Le volume d'articles n'est ni une mesure de popularité ni une preuve de véracité.",
];

export function notConfiguredStatuses(note?: string): SourceStatus[] {
  return SOURCE_DEFINITIONS.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    state: "not_configured" as const,
    setupHint: d.setupHint,
    note,
  }));
}
