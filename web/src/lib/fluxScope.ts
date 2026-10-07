import type { Topic } from "../types";
import subjects from "./subjects.json";

/**
 * Périmètre de la vue « Flux » : les articles de la rubrique « France » de
 * Google Actualités qui relèvent d'un des sept sujets du lexique.
 *
 * Les sujets et leurs termes viennent de `subjects.json`, généré depuis
 * `SUBJECT_LEXICON` (politiscope/media.py) par `scripts/export_subjects.py` :
 * ils ne peuvent pas diverger de ce que l'ingestion tague. Rien ici ne doit
 * les recopier en dur.
 */

// --- éditeurs -----------------------------------------------------------------

/** Trois éditeurs nommés, chacun sa couleur ; tous les autres en gris. */
export type PublisherGroup = "lemonde" | "figaro" | "parisien" | "autres";

export interface PublisherGroupInfo {
  id: PublisherGroup;
  label: string;
  color: string;
}

export const PUBLISHER_GROUPS: PublisherGroupInfo[] = [
  { id: "lemonde", label: "Le Monde", color: "var(--outlet-lemonde)" },
  { id: "figaro", label: "Le Figaro", color: "var(--outlet-figaro)" },
  { id: "parisien", label: "Le Parisien", color: "var(--outlet-parisien)" },
  { id: "autres", label: "Autres médias", color: "var(--muted)" },
];

/** Google écrit « Le Monde.fr », « Le Figaro », « Le Parisien » : on compare sur le début du nom. */
export function publisherGroup(publisher: string): PublisherGroup {
  const p = publisher.toLowerCase();
  if (p.startsWith("le monde")) return "lemonde";
  if (p.startsWith("le figaro")) return "figaro";
  if (p.startsWith("le parisien")) return "parisien";
  return "autres";
}

export const groupInfo = (id: PublisherGroup): PublisherGroupInfo =>
  PUBLISHER_GROUPS.find((g) => g.id === id) ?? PUBLISHER_GROUPS[PUBLISHER_GROUPS.length - 1];

export const publisherColor = (publisher: string): string => groupInfo(publisherGroup(publisher)).color;

// --- sujets et termes -----------------------------------------------------------

/** Sujets dans l'ordre du lexique (qui départage aussi les égalités au tagging). */
export const SUBJECTS: Topic[] = subjects.map((s, i) => ({ theme: s.theme, libelle_court: s.theme, ordre: i + 1 }));

/** Terme (libellé du lexique) -> son sujet. */
export const TERM_SUBJECT: ReadonlyMap<string, string> = new Map(
  subjects.flatMap((s) => s.terms.map((t) => [t, s.theme] as const))
);

export const subjectShort = (theme: string): string =>
  SUBJECTS.find((s) => s.theme === theme)?.libelle_court ?? theme;

// --- mentions -----------------------------------------------------------------

/**
 * Un article retenu — une ligne de `press_mentions` où `theme` n'est pas null,
 * alimentée chaque nuit depuis Google Actualités (politiscope/media.py).
 */
export interface MediaMention {
  /** URL de redirection Google, canonique. */
  id: string;
  /** Éditeur réel (« Le Monde.fr », « BFM »…). */
  publisher: string;
  /** Canal de collecte : « Google Actualités », ou « RSS de la rédaction » pour l'historique. */
  via: string;
  /** Article principal du cluster Google ; null pour l'historique. */
  cluster_id: string | null;
  /** ISO 8601. */
  published_at: string;
  /** Titre, tel que publié. */
  titre: string;
  /** Chapô, s'il y en a un (historique RSS seulement). */
  resume: string | null;
  article_url: string;
  /** Thème de SUBJECTS. */
  theme: string;
  /** Libellés du lexique trouvés dans le titre ; vide si le sujet vient du cluster. */
  matched_terms: string[];
}

export type Period = "24h" | "7j" | "30j";

export const PERIOD_MS: Record<Period, number> = {
  "24h": 24 * 3600 * 1000,
  "7j": 7 * 24 * 3600 * 1000,
  "30j": 30 * 24 * 3600 * 1000,
};
