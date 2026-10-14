import type { ActivityCategory, EventKind } from "../types";
import { fold } from "../text";

// Classification HEURISTIQUE par mots-clés (sur texte replié : minuscules, sans accents).
// Elle ne remplace pas une lecture humaine : toute catégorie peut être corrigée manuellement.

const CATEGORY_KEYWORDS: Record<Exclude<ActivityCategory, "other">, string[]> = {
  institutions: [
    "gouvernement", "premier ministre", "assemblee nationale", "senat", "conseil des ministres",
    "constitution", "conseil constitutionnel", "dissolution", "remaniement", "motion de censure",
    "49.3", "projet de loi", "reforme", "depute", "ministre",
  ],
  security: [
    "securite", "defense", "armee", "militaire", "terror", "police", "gendarmerie", "attentat",
    "dissuasion", "renseignement", "cyberattaque", "guerre", "missile", "drone",
  ],
  economy: [
    "economie", "economique", "budget", "croissance", "inflation", "emploi", "chomage", "entreprise",
    "industrie", "impot", "fiscal", "dette", "investissement", "commerce", "douane", "pib", "bourse",
  ],
  environment: [
    "climat", "ecolog", "energie", "biodiversite", "cop 3", "transition", "renouvelable", "pollution",
  ],
  diplomacy: [
    "sommet", "diplomat", "ambassad", "bilateral", "visite d etat", "g7", "g20", "onu", "otan",
    "traite", "chancelier", "coalition",
  ],
  international: [
    "ukraine", "russie", "poutine", "zelensk", "gaza", "israel", "proche orient", "liban", "iran",
    "chine", "etats unis", "trump", "afrique", "algerie", "europe", "bruxelles",
  ],
  france: [
    "lycee", "ecole", "sante", "retraite", "culture", "hommage", "jeux olympiques", "territoire",
    "outre mer", "francais", "education", "universite", "logement", "sport",
  ],
};

const PRIORITY: Exclude<ActivityCategory, "other">[] = [
  "institutions", "security", "economy", "environment", "diplomacy", "international", "france",
];

function hits(text: string, keyword: string): boolean {
  const k = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${k}`).test(text);
}

export function classifyCategory(rawText: string): ActivityCategory {
  const text = fold(rawText).replace(/[-–—]/g, " ");
  let best: ActivityCategory = "other";
  let bestHits = 0;
  for (const cat of PRIORITY) {
    const n = CATEGORY_KEYWORDS[cat].filter((k) => hits(text, k)).length;
    if (n > bestHits) {
      best = cat;
      bestHits = n;
    }
  }
  return best;
}

const TRAVEL = /\b(se rend|se rendra|en visite|visite|deplacement|voyage|arrive a|atterri)/;
const MEETING = /\b(rencontre|reunion|entretien|recoit|recevra|echange|sommet|conseil des ministres|dejeuner|diner)/;
const DECLARATION =
  /\b(declare|annonce|affirme|allocution|discours|interview|conference de presse|s exprime|prend la parole|message|appelle|plaide|promet|reagit)/;

export function classifyKind(rawText: string, onlyOfficialPosts: boolean): EventKind {
  if (onlyOfficialPosts) return "publication";
  const text = fold(rawText);
  if (TRAVEL.test(text)) return "travel";
  if (MEETING.test(text)) return "meeting";
  if (DECLARATION.test(text)) return "declaration";
  return "other";
}

const FUTURE =
  /\b(se rendra|recevra|rencontrera|seront|prevu|prevue|prevus|programme|attendu a|attendue a|attendu ce|attendue ce|demain|la semaine prochaine|ce soir|aura lieu|doit (?:se rendre|recevoir|prendre|presider|annoncer)|va (?:se rendre|recevoir|presider|annoncer|prendre))\b/;
const PAST =
  /\b(a (?:annonce|declare|recu|rencontre|affirme|promis|appele|reagi)|s est rendu|est arrive|hier|a eu lieu|ont (?:annonce|declare))/;

/** « annoncé / prévu » : marqueurs de futur présents ET aucun marqueur de passé. Heuristique. */
export function detectScheduled(titles: string[]): boolean {
  const text = fold(titles.join(" . "));
  return FUTURE.test(text) && !PAST.test(text);
}

const CONTRADICTION = /\b(dement\w*|infox|fake news|fausse information|canular|hoax|rumeur)\b/;

/** Mot-clé de démenti/rumeur : n'établit PAS un démenti, impose seulement une vérification. */
export function detectContradiction(text: string): boolean {
  return CONTRADICTION.test(fold(text));
}
