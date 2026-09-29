import type { Topic } from "../types";

/**
 * Périmètre volontairement étroit de la vue « Flux live » : trois médias,
 * quelques figures de l'exécutif et de la scène internationale, leurs pays,
 * six sujets. Le reste de l'appli couvre tout le spectre politique ; cette
 * vue non.
 *
 * Réutilise le vocabulaire existant là où il existe :
 * - les clés de personnalité suivent `figureKeyOf` (handle si connu, sinon
 *   nom) — Macron et Lecornu reprennent leur handle de x_accounts.json ;
 * - les sujets ont la forme `Topic` (thème long -> libellé court), et
 *   « Europe » reprend exactement le thème « Europe & souveraineté » de la
 *   table `topics`.
 * Les autres entrées (médias, Barrot, dirigeants étrangers, pays, cinq
 * sujets) n'existent encore nulle part ailleurs dans le code : elles sont
 * définies ici, et seulement ici.
 */

// --- médias -----------------------------------------------------------------

export type OutletId = "lemondefr" | "Le_Figaro" | "le_Parisien";

export interface Outlet {
  /** Handle X, sans l'arobase. */
  id: OutletId;
  label: string;
  color: string;
}

export const OUTLETS: Outlet[] = [
  { id: "lemondefr", label: "Le Monde", color: "var(--outlet-lemonde)" },
  { id: "Le_Figaro", label: "Le Figaro", color: "var(--outlet-figaro)" },
  { id: "le_Parisien", label: "Le Parisien", color: "var(--outlet-parisien)" },
];

export const outletOf = (id: OutletId): Outlet => OUTLETS.find((o) => o.id === id) ?? OUTLETS[0];

// --- personnalités et pays -----------------------------------------------------

/** Pays suivis ; « fr » regroupe l'exécutif français au centre de la carte. */
export type Pole = "fr" | "us" | "ru" | "ua" | "cn" | "il";

export interface ScopeEntity {
  /** Clé stable : `figureKeyOf` pour une personnalité, `pays:<pole>` pour un pays. */
  key: string;
  kind: "figure" | "country";
  nom: string;
  /** Fonction (personnalité) — absent pour un pays. */
  role?: string;
  pole: Pole;
}

export const ENTITIES: ScopeEntity[] = [
  // Exécutif français — handles repris de x_accounts.json quand ils y figurent.
  { key: "EmmanuelMacron", kind: "figure", nom: "Emmanuel Macron", role: "Président de la République", pole: "fr" },
  { key: "SebLecornu", kind: "figure", nom: "Sébastien Lecornu", role: "Premier ministre", pole: "fr" },
  {
    key: "Jean-Noël Barrot",
    kind: "figure",
    nom: "Jean-Noël Barrot",
    role: "Ministre de l'Europe et des Affaires étrangères",
    pole: "fr",
  },
  // Chefs d'État et de gouvernement étrangers, chacun à côté de son pays.
  { key: "Donald Trump", kind: "figure", nom: "Donald Trump", role: "Président des États-Unis", pole: "us" },
  { key: "pays:us", kind: "country", nom: "États-Unis", pole: "us" },
  { key: "Vladimir Poutine", kind: "figure", nom: "Vladimir Poutine", role: "Président de la Russie", pole: "ru" },
  { key: "pays:ru", kind: "country", nom: "Russie", pole: "ru" },
  { key: "Volodymyr Zelensky", kind: "figure", nom: "Volodymyr Zelensky", role: "Président de l'Ukraine", pole: "ua" },
  { key: "pays:ua", kind: "country", nom: "Ukraine", pole: "ua" },
  { key: "Xi Jinping", kind: "figure", nom: "Xi Jinping", role: "Président de la Chine", pole: "cn" },
  { key: "pays:cn", kind: "country", nom: "Chine", pole: "cn" },
  {
    key: "Benjamin Netanyahu",
    kind: "figure",
    nom: "Benjamin Netanyahu",
    role: "Premier ministre d'Israël",
    pole: "il",
  },
  { key: "pays:il", kind: "country", nom: "Israël", pole: "il" },
];

export const entityOf = (key: string): ScopeEntity | undefined => ENTITIES.find((e) => e.key === key);

// --- sujets -------------------------------------------------------------------

export const SUBJECTS: Topic[] = [
  { theme: "Gaza / Proche-Orient", libelle_court: "Gaza / Proche-Orient", ordre: 1 },
  { theme: "Guerre en Ukraine", libelle_court: "Guerre en Ukraine", ordre: 2 },
  { theme: "Diplomatie", libelle_court: "Diplomatie", ordre: 3 },
  { theme: "Commerce / droits de douane", libelle_court: "Commerce / douanes", ordre: 4 },
  { theme: "Défense / Otan", libelle_court: "Défense / Otan", ordre: 5 },
  // Thème existant de la table `topics`, repris tel quel.
  { theme: "Europe & souveraineté", libelle_court: "Europe", ordre: 6 },
];

export const subjectShort = (theme: string): string =>
  SUBJECTS.find((s) => s.theme === theme)?.libelle_court ?? theme;

// --- mentions -----------------------------------------------------------------

/**
 * Un article d'un média suivi qui cite au moins une entité du périmètre —
 * une ligne de la table `media_mentions` (migration 009), alimentée chaque
 * nuit depuis les flux RSS des rédactions (politiscope/media.py, dont les
 * clés d'entités et de sujets doivent rester celles de ce fichier).
 */
export interface MediaMention {
  /** URL canonique de l'article. */
  id: string;
  outlet: OutletId;
  /** ISO 8601. */
  published_at: string;
  /** Titre, tel que publié par la rédaction. */
  titre: string;
  /** Chapô, tel que publié, s'il y en a un. */
  resume: string | null;
  article_url: string;
  /** Thème de SUBJECTS. */
  theme: string;
  /** Clés d'ENTITIES citées. */
  entities: string[];
}

export type Period = "24h" | "7j" | "30j";

export const PERIOD_MS: Record<Period, number> = {
  "24h": 24 * 3600 * 1000,
  "7j": 7 * 24 * 3600 * 1000,
  "30j": 30 * 24 * 3600 * 1000,
};
