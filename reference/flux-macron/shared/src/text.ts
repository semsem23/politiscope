// Utilitaires de texte : nettoyage de contenus externes (données non fiables) et tokenisation.

/** Empreinte non cryptographique (cyrb53) — identifiants et empreintes de dédoublonnage. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const TAGS = /<[^>]*>/g;
// Caractères de contrôle et de direction (bidi) pouvant servir à tromper l'affichage.
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Retire balises, entités et caractères de contrôle. Le résultat est du texte brut. */
export function stripHtml(input: string): string {
  const noBlocks = input.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  const once = decodeEntities(noBlocks.replace(TAGS, " "));
  // Seconde passe : des balises encodées (&lt;b&gt;) réapparaissent après décodage.
  return once.replace(TAGS, " ").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/** Minuscules, sans accents, apostrophes remplacées par des espaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ");
}

const STOPWORDS = new Set(
  (
    "le la les un une des du de d l au aux et ou mais donc car ni que qui quoi dont ce cet cette ces son sa ses " +
    "leur leurs mon ma mes ton ta tes notre nos votre vos il elle ils elles on nous vous je tu en y a as est sont " +
    "ete etre avoir fait faire dans sur sous par pour avec sans chez vers entre apres avant pendant depuis contre " +
    "plus moins tres pas ne se si lors ainsi aussi alors encore deja tout tous toute toutes cela ceci selon " +
    "hier demain aujourd hui sera ont ete cest voici voila"
  ).split(" "),
);

// Mots présents dans presque toutes les mentions : ils ne discriminent pas les événements.
// Les mots-marqueurs de la démonstration (« fictif », « exemple »…) en font aussi partie.
const DOMAIN_STOPWORDS = new Set([
  "macron", "emmanuel", "president", "republique", "elysee",
  "demo", "fictif", "fictive", "exemple", "imaginaire", "demonstration", "scenario",
  "camille", "alex", "sam", "factice", "imaginaires",
]);

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of fold(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || DOMAIN_STOPWORDS.has(raw)) continue;
    // normalisation légère du pluriel
    const t = raw.length > 4 && (raw.endsWith("s") || raw.endsWith("x")) ? raw.slice(0, -1) : raw;
    out.add(t);
  }
  return out;
}

export interface Similarity {
  score: number; // coefficient de Dice, 0–1
  shared: number; // nombre de mots significatifs communs
}

export function similarity(a: Set<string>, b: Set<string>): Similarity {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: 0 };
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return { score: (2 * shared) / (a.size + b.size), shared };
}

export function stripPublisherSuffix(title: string, publisher?: string): string {
  if (!publisher) return title;
  const suffix = new RegExp(`\\s[-–—|]\\s${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  return title.replace(suffix, "").trim();
}
