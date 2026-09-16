export type FamilleId =
  | "majorite"
  | "droite-rep"
  | "extreme-droite"
  | "gauche-radicale"
  | "gauche-social";

/** Une entrée éditorialisée, telle que stockée dans Supabase. */
export interface Entry {
  id: number;
  nom: string;
  parti: string;
  code_parti: string | null;
  famille: FamilleId;
  handle: string | null;
  theme: string;
  citation: string;
  date_texte: string;
  date_tri: string | null;
  source: string;
}

export interface Topic {
  theme: string;
  libelle_court: string;
  ordre: number;
}

/**
 * Une ligne de la vue `personnalites` : une personnalité, sa dernière
 * citation, et son nombre total de citations. Sert de base à la grille de
 * cartes ; la visibilité et le badge sous filtre actif sont recalculés côté
 * client à partir des `Entry` (voir deriveFigures dans usePolitiscope.ts).
 */
export interface Figure {
  figure_id: string;
  handle: string | null;
  nom: string;
  parti: string;
  code_parti: string | null;
  famille: FamilleId;
  dernier_theme: string;
  derniere_citation: string;
  derniere_date_texte: string;
  derniere_date_tri: string | null;
  derniere_source: string;
  derniere_entry_id: number;
  nb_citations: number;
}

/** Clé de regroupement par personnalité : le handle si connu, sinon le nom. */
export const figureKeyOf = (e: Pick<Entry, "handle" | "nom">): string => e.handle ?? e.nom;

export interface Famille {
  id: FamilleId;
  label: string;
  color: string;
}

export const FAMILLES: Famille[] = [
  { id: "majorite", label: "Majorité présidentielle", color: "var(--fam-majorite)" },
  { id: "droite-rep", label: "Droite républicaine", color: "var(--fam-droite-rep)" },
  { id: "extreme-droite", label: "Droite radicale / souverainiste", color: "var(--fam-extreme-droite)" },
  { id: "gauche-radicale", label: "Gauche radicale", color: "var(--fam-gauche-radicale)" },
  { id: "gauche-social", label: "Gauche social-démocrate / écologiste", color: "var(--fam-gauche-social)" },
];

export const familleOf = (id: FamilleId) =>
  FAMILLES.find((f) => f.id === id) ?? FAMILLES[0];

/** Tri de la grille Personnalités — la vue Citations trie via l'en-tête Date. */
export type PersonSortKey = "recent" | "count" | "alpha";
