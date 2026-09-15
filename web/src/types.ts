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
  theme: string;
  sujet: string;
  citation: string;
  hashtags: string[];
  justif: string;
  date_texte: string;
  date_tri: string | null;
  source: string;
}

export interface Topic {
  theme: string;
  libelle_court: string;
  ordre: number;
}

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

export type SortKey =
  | "theme"
  | "date-desc"
  | "date-asc"
  | "alpha"
  | "parti";
