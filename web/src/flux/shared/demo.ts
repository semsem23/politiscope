// Données de DÉMONSTRATION — entièrement fictives, jamais mélangées aux données réelles.
// Elles passent par le vrai pipeline (statut, indépendance, confiance) mais :
//  - les titres contiennent « DEMO » et « fictif » ;
//  - les URL pointent vers example.org (domaine réservé) ;
//  - le compte « X » est un compte inventé, pas le compte réel d'une personne ;
//  - chaque article et événement porte isDemo = true.
import type { ActivityCategory, Article, Personality, SourceKind, StateResponse, TimeWindow } from "./types";
import { CATEGORY_ORDER } from "./types";
import { buildEvents } from "./pipeline/events";
import { notConfiguredStatuses } from "./sources";
import { STANDARD_COVERAGE_NOTES } from "./sources";
import { computeWindow, DAY, HOUR } from "./time";

export const DEMO_OFFICIAL_ACCOUNT = "CompteDemo";

/** Personnalités FICTIVES de démonstration : aucune personne réelle. */
export const DEMO_PERSONALITIES: Personality[] = [
  { id: "camille-demo", name: "Camille Démo", aliases: [], role: "ministre fictive", isDemo: true },
  { id: "alex-exemple", name: "Alex Exemple", aliases: [], role: "ambassadeur fictif", isDemo: true },
  { id: "sam-imaginaire", name: "Sam Imaginaire", aliases: [], role: "sénatrice fictive", isDemo: true },
  { id: "jo-factice", name: "Jo Factice", aliases: [], role: "dirigeant étranger fictif", isDemo: true },
];

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PHRASES: Record<ActivityCategory, string[]> = {
  france: [
    "Hommage fictif dans une école de démonstration",
    "Visite fictive d'un lycée imaginaire pour l'éducation",
  ],
  diplomacy: [
    "Sommet diplomatique fictif entre ambassadeurs imaginaires",
    "Visite d'État fictive : sommet bilatéral d'exemple",
  ],
  economy: [
    "Plan fictif pour l'économie : budget et investissement d'exemple",
    "Rencontre fictive sur l'industrie et l'emploi imaginaires",
  ],
  security: [
    "Réunion fictive sur la défense et le renseignement d'exemple",
    "Déclaration fictive sur la sécurité et la gendarmerie imaginaires",
  ],
  international: [
    "Échange fictif à Bruxelles sur l'Europe, scénario d'exemple",
    "Déclaration fictive sur l'Afrique, événement imaginaire",
  ],
  institutions: [
    "Conseil des ministres fictif : projet de loi d'exemple",
    "Déclaration fictive devant le Sénat imaginaire",
  ],
  environment: [
    "Annonce fictive sur le climat et la biodiversité d'exemple",
    "Visite fictive d'un site d'énergie renouvelable imaginaire",
  ],
  other: ["Message fictif sans thème défini pour la démonstration"],
};

const ANGLES = [
  "analyse des réactions politiques",
  "portrait et coulisses de la journée",
  "chiffres clés et contexte historique",
  "décryptage et enjeux à venir",
  "points de vue des observateurs",
];
const PUBLISHERS = ["Média démo A", "Média démo B", "Média démo C", "Média démo D"];

export function buildDemoState(now: Date, key: TimeWindow): StateResponse {
  const rng = mulberry32(Math.floor(now.getTime() / DAY) + 7);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const nowMs = now.getTime();
  // Les événements de démonstration sont ancrés sur une demi-heure fixe : ils ne « glissent » pas à chaque rafraîchissement.
  const anchorMs = Math.floor(nowMs / (30 * 60_000)) * 30 * 60_000;

  // âge (en heures) de chaque événement : 12 sur 24 h, 20 sur 24 h–7 j, 26 sur 7–30 j, plus 3 « annoncés »
  const plan: { ageH: number; scheduled?: boolean; disputed?: boolean }[] = [];
  for (let i = 0; i < 12; i++) plan.push({ ageH: 0.5 + rng() * 22.5 });
  for (let i = 0; i < 20; i++) plan.push({ ageH: 24 + rng() * 144 });
  for (let i = 0; i < 26; i++) plan.push({ ageH: 168 + rng() * 550 });
  for (let i = 0; i < 3; i++) plan.push({ ageH: 1 + rng() * 18, scheduled: true });
  plan[3].disputed = true;
  plan[15].disputed = true;

  const articles: Article[] = [];
  const forcedGroups: Record<string, string> = {};
  const generatedAt = now.toISOString();

  plan.forEach((p, n) => {
    const category = CATEGORY_ORDER[(n * 5 + Math.floor(rng() * 3)) % CATEGORY_ORDER.length];
    // une activité sur deux cite 1 ou 2 personnalités fictives
    const guests = rng() < 0.5 ? [...DEMO_PERSONALITIES].sort(() => rng() - 0.5).slice(0, 1 + Math.floor(rng() * 2)) : [];
    const base = `DEMO · ${pick(PHRASES[category])} n°${n + 1}${guests.length ? ` avec ${guests.map((g) => g.name).join(" et ")}` : ""}${
      p.scheduled ? " prévu demain" : ""
    }${p.disputed ? " — démenti signalé (fictif)" : ""}`;
    const count = 1 + Math.floor(rng() * 4.2);
    const eventMs = anchorMs - p.ageH * HOUR;
    const withOfficial = rng() < 0.25;
    const syndicated = count >= 3 && rng() < 0.45;
    const usedAngles = [...ANGLES].sort(() => rng() - 0.5);

    for (let k = 0; k < count; k++) {
      const official = withOfficial && k === 0;
      const kind: SourceKind = official ? "x" : "google_news";
      const delayMin = k === 0 ? 0 : 5 + rng() * 300;
      const publishedMs = Math.min(anchorMs - 60_000, eventMs + delayMin * 60_000);
      const id = `demo:${n}-${k}`;
      const publisher = official ? `@${DEMO_OFFICIAL_ACCOUNT} (X)` : PUBLISHERS[(n + k) % PUBLISHERS.length];
      // k = 1 sur un même média : quasi-doublon volontaire pour illustrer le dédoublonnage
      const nearDup = !official && k === 1 && rng() < 0.3;
      const title = k === 0 ? base : nearDup ? `${base} : suite` : `${base} : ${usedAngles[k % usedAngles.length]}`;
      articles.push({
        id,
        sourceKind: kind,
        publisherName: nearDup ? PUBLISHERS[(n + 0) % PUBLISHERS.length] : publisher,
        title,
        excerpt: "Texte de démonstration sans contenu réel. Aucun fait, aucune citation, aucune URL authentique.",
        url: `https://example.org/demo/${n}-${k}`,
        publishedAt: new Date(publishedMs).toISOString(),
        collectedAt: generatedAt,
        authorOrAccount: official ? `@${DEMO_OFFICIAL_ACCOUNT}` : undefined,
        originalSourceUrl: syndicated && k >= 1 && !nearDup ? `https://example.org/demo/depeche-${n}` : undefined,
        isDemo: true,
      });
      forcedGroups[id] = `evt_demo_${n}`;
    }
  });

  const built = buildEvents(articles, {
    now,
    officialAccounts: [DEMO_OFFICIAL_ACCOUNT],
    forcedGroups,
    personalities: DEMO_PERSONALITIES,
  });

  const window = computeWindow(key, now);
  const startMs = Date.parse(window.start);
  const events = built.events.filter((e) => Date.parse(e.firstPublishedAt) >= startMs);
  const ids = new Set(events.map((e) => e.id));
  const shown = built.articles.filter((a) => a.eventId && ids.has(a.eventId));
  for (const e of events) e.suggestedRelations = e.suggestedRelations.filter((id) => ids.has(id));

  return {
    mode: "demo",
    window,
    generatedAt,
    articles: shown,
    events,
    sources: notConfiguredStatuses("Mode démonstration : aucune collecte n'est effectuée."),
    personalities: DEMO_PERSONALITIES,
    coverageNotes: [
      "DONNÉES DE DÉMONSTRATION : médias, événements, liens et compte « X » sont fictifs (URL example.org). Rien ici n'est issu d'une collecte.",
      ...STANDARD_COVERAGE_NOTES,
    ],
  };
}
