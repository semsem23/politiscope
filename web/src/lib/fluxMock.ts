import { ENTITIES, OUTLETS, SUBJECTS, type MediaMention } from "./fluxScope";

/**
 * DONNÉES FICTIVES — maquette de la vue « Flux live » en attendant une
 * ingestion réelle des tweets médias (table `media_mentions`, inexistante à
 * ce jour).
 *
 * Aucun texte ni lien ci-dessous n'est réel : les extraits sont générés et
 * signalés « [Fictif] », les liens pointent vers example.com. Rien ici ne
 * doit jamais être présenté comme une citation ou une source.
 *
 * Les dates sont relatives à l'instant du chargement, pour que les fenêtres
 * 24h / 7j / 30j aient toujours quelque chose à montrer ; l'historique simulé
 * remonte à MOCK_HISTORY_DAYS jours, comme une ingestion commencée à cette
 * date et complétée chaque nuit depuis.
 */

const MOCK_HISTORY_DAYS = 45;
const MOCK_COUNT = 180;

/** Qui apparaît plausiblement sous quel sujet — pour des co-mentions qui aient l'air d'en être. */
const CAST: Record<string, string[]> = {
  "Gaza / Proche-Orient": ["Benjamin Netanyahu", "pays:il", "EmmanuelMacron", "Jean-Noël Barrot", "Donald Trump", "pays:us"],
  "Guerre en Ukraine": ["Volodymyr Zelensky", "pays:ua", "Vladimir Poutine", "pays:ru", "EmmanuelMacron", "Donald Trump", "SebLecornu"],
  Diplomatie: ENTITIES.map((e) => e.key),
  "Commerce / droits de douane": ["Donald Trump", "pays:us", "Xi Jinping", "pays:cn", "EmmanuelMacron", "SebLecornu"],
  "Défense / Otan": ["SebLecornu", "EmmanuelMacron", "pays:ru", "pays:us", "Donald Trump", "pays:ua"],
  "Europe & souveraineté": ["EmmanuelMacron", "Jean-Noël Barrot", "SebLecornu", "pays:ua", "pays:us"],
};

/** Générateur pseudo-aléatoire à graine fixe : la maquette est la même à chaque chargement. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMockMentions(now: number): MediaMention[] {
  const rand = mulberry32(2026);
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const nomOf = new Map(ENTITIES.map((e) => [e.key, e.nom]));

  const out: MediaMention[] = [];
  for (let i = 0; i < MOCK_COUNT; i++) {
    // Âge biaisé vers le récent (rand² se concentre près de 0), comme un flux
    // dont le volume croît à mesure que l'actualité s'emballe.
    const ageMs = rand() * rand() * MOCK_HISTORY_DAYS * 86_400_000;
    const outlet = pick(OUTLETS).id;
    const subject = pick(SUBJECTS);
    const cast = CAST[subject.theme];

    const entities = new Set<string>([pick(cast)]);
    if (rand() < 0.55) entities.add(pick(cast));
    if (rand() < 0.2) entities.add(pick(cast));
    const keys = [...entities];

    const names = keys.map((k) => nomOf.get(k) ?? k).join(", ");
    out.push({
      id: `mock-${i}`,
      outlet,
      created_at: new Date(now - ageMs).toISOString(),
      texte: `[Fictif] ${names} — ${subject.libelle_court}. Extrait généré pour la maquette du flux, sans rapport avec une publication réelle.`,
      tweet_url: `https://example.com/mock/x/${outlet}/status/${i}`,
      article_url: rand() < 0.8 ? `https://example.com/mock/article/${outlet}/${i}` : null,
      theme: subject.theme,
      entities: keys,
    });
  }

  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
