import { SUBJECTS, TERM_SUBJECT, type MediaMention, type Period } from "./fluxScope";

/**
 * Dérive des « événements » reliés à partir des articles de `press_mentions`.
 *
 * La base ne connaît pas la notion d'événement : elle n'a que des articles
 * avec un sujet et les termes du lexique trouvés dans leur titre (voir
 * fluxScope.ts). Ce module la fabrique côté client, par heuristique :
 *
 * 1. deux articles proches dans le temps qui partagent des termes **et**
 *    des mots significatifs de titre racontent le même fait -> un seul
 *    événement ;
 * 2. deux événements distincts dont les titres se recoupent encore
 *    nettement sont liés de façon « établie » (même fait, suite directe) ;
 * 3. deux événements dont les titres ne partagent que deux mots rares sont
 *    liés de façon « suggérée » — à confirmer, donc en pointillés dans la
 *    frise.
 *
 * Tout est pur et sans état : `buildTimeline` est la seule porte d'entrée de
 * la vue. C'est le point de remplacement prévu pour un vrai pipeline
 * (clustering sur embeddings calculés en base) — la forme de sortie
 * (`Timeline`) est le contrat à préserver, pas la façon de l'obtenir.
 */

// --- couloirs thématiques ---------------------------------------------------

export interface Lane {
  id: string;
  /** Nom affiché à gauche du couloir. */
  label: string;
  /** Thèmes de SUBJECTS qui tombent dans ce couloir. */
  themes: string[];
}

/**
 * Un couloir par sujet du lexique (subjects.json), dans son ordre. `autres`
 * récupère un thème inconnu — un sujet ancien encore en base avant re-tag —
 * plutôt que de le faire disparaître. Seuls les couloirs peuplés s'affichent.
 */
export const LANES: Lane[] = [
  ...SUBJECTS.map((s) => ({ id: s.theme, label: s.libelle_court, themes: [s.theme] })),
  { id: "autres", label: "Autres", themes: [] },
];

const LANE_OF_THEME = new Map<string, string>(
  LANES.flatMap((l) => l.themes.map((t) => [t, l.id] as const))
);

export const laneIdOf = (theme: string): string => LANE_OF_THEME.get(theme) ?? "autres";

export const laneOf = (id: string): Lane => LANES.find((l) => l.id === id) ?? LANES[LANES.length - 1];

// --- mots significatifs ------------------------------------------------------

/**
 * Mots vides du français, plus le vocabulaire de titre de presse qui revient
 * partout et ne distingue donc aucun fait (« annonce », « ministre »…).
 */
const STOP = new Set([
  "alors", "apres", "attendant", "aucun", "aussi", "autre", "autres", "avant", "avec", "avoir",
  "beaucoup", "cela", "celle", "celles", "celui", "cette", "ceux", "chaque", "comme", "comment",
  "contre", "dans", "depuis", "deux", "devant", "doit", "donc", "dont", "elle", "elles", "encore",
  "entre", "etre", "fait", "faire", "fois", "hier", "jour", "jours", "leur", "leurs", "mais",
  "meme", "moins", "nous", "plus", "pour", "pourquoi", "pres", "quand", "quel", "quelle",
  "quelles", "quels", "sans", "selon", "sera", "seront", "soit", "sont", "sous", "sur",
  "tous", "tout", "toute", "toutes", "trois", "trop", "vers", "veut", "vous",
  // vocabulaire de titre, trop fréquent pour identifier un fait
  "annonce", "annoncent", "articles", "chef", "declaration", "declarations", "direct",
  "entretien", "gouvernement", "ministre", "ministres", "president", "presidente",
  "premier", "recit", "reportage", "tribune", "video", "live", "analyse", "decryptage",
  "france", "francais", "francaise", "paris",
]);

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ");

/**
 * Mots qui ne sont qu'un terme du lexique (« donald », « trump », « russie »…).
 * Les écarter du vocabulaire de titre évite de compter deux fois le même
 * indice : les termes ont déjà leur propre signal, et sans ça « Donald Trump »
 * pèse à lui seul deux mots partagés — assez pour déclarer deux articles sans
 * rapport « même fait ».
 */
const TERM_WORDS: Set<string> = new Set(
  [...TERM_SUBJECT.keys()].flatMap((t) => fold(t).split(" ")).filter((w) => w.length >= 4)
);

/** Minuscules, sans accents, mots de 4 lettres ou plus, hors mots vides et termes du lexique. */
export function significantWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(text).split(" ")) {
    if (w.length < 4 || STOP.has(w) || TERM_WORDS.has(w) || /^\d+$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

function sharedCount<T>(a: Set<T> | readonly T[], b: Set<T>): number {
  let n = 0;
  for (const v of a) if (b.has(v)) n += 1;
  return n;
}

// --- ce qui distingue, dans cette fenêtre -------------------------------------

/**
 * Un indice ne vaut que par sa rareté. Sur une semaine de fil presse, un
 * terme comme « Crise des lycées » peut figurer dans un article sur trois :
 * le compter comme preuve de parenté agglomère toute la couverture d'un
 * dossier en un seul événement. On ne retient donc que les mots et les termes
 * peu répandus *dans la fenêtre affichée* — ce qui s'ajuste tout seul quand
 * l'actualité change de sujet.
 */
export interface Vocabulary {
  distinctiveWord(w: string): boolean;
  distinctiveTerm(term: string): boolean;
}

/** Au-delà de cette part des articles de la fenêtre, un indice ne distingue plus rien. */
const UBIQUITY = 0.15;

export function vocabularyOf(mentions: MediaMention[]): Vocabulary {
  const words = new Map<string, number>();
  const terms = new Map<string, number>();
  for (const m of mentions) {
    for (const w of significantWords(m.titre)) words.set(w, (words.get(w) ?? 0) + 1);
    for (const t of m.matched_terms) terms.set(t, (terms.get(t) ?? 0) + 1);
  }
  // Plancher à 2 : sur une poignée d'articles, tout paraîtrait ubiquitaire.
  const cap = Math.max(2, Math.ceil(mentions.length * UBIQUITY));
  return {
    distinctiveWord: (w) => (words.get(w) ?? 0) <= cap,
    distinctiveTerm: (t) => (terms.get(t) ?? 0) <= cap,
  };
}

const sharedDistinctive = (a: Set<string>, b: Set<string>, keep: (v: string) => boolean): number => {
  let n = 0;
  for (const v of a) if (b.has(v) && keep(v)) n += 1;
  return n;
};

// --- événements ---------------------------------------------------------------

export interface TimelineEvent {
  /** Stable d'un rendu à l'autre : l'URL de l'article de tête. */
  id: string;
  laneId: string;
  /** Instant du premier article du groupe. */
  t: number;
  /** Titre court, tiré du titre de presse le plus concis du groupe. */
  title: string;
  /** Termes du lexique cités, les trois premiers. */
  subtitle: string;
  /** Éditeur de l'article de tête — la pastille de couleur du point. */
  publisher: string;
  /** Tous les éditeurs du groupe, dans l'ordre de première parution. */
  publishers: string[];
  /** Articles du groupe, du plus ancien au plus récent. */
  mentions: MediaMention[];
  terms: string[];
  /** Mots significatifs de l'article de tête — base des liens. */
  words: Set<string>;
}

/** Au-delà, deux articles ne racontent plus le même fait mais sa suite. */
const MERGE_GAP_MS = 30 * 3600 * 1000;

/**
 * Le groupe est comparé à son article fondateur, pas à l'union : sinon il
 * absorbe de proche en proche. Seuls les indices distinctifs comptent (voir
 * `vocabularyOf`) : trois mots rares en commun, ou deux plus un terme rare.
 */
function sameFact(
  m: MediaMention,
  seedWords: Set<string>,
  seedTerms: Set<string>,
  vocab: Vocabulary
): boolean {
  const words = sharedDistinctive(significantWords(m.titre), seedWords, vocab.distinctiveWord);
  if (words < 2) return false;
  if (words >= 3) return true;
  return sharedDistinctive(new Set(m.matched_terms), seedTerms, vocab.distinctiveTerm) >= 1;
}

const TRUNCATE = 54;

const shorten = (s: string): string => {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= TRUNCATE) return clean;
  const cut = clean.slice(0, TRUNCATE);
  const space = cut.lastIndexOf(" ");
  return `${(space > TRUNCATE * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:]$/, "")}…`;
};

/**
 * Regroupe les articles en événements. Pur, indépendant de la période
 * affichée : c'est la fonction qu'un vrai pipeline remplacerait.
 */
export function buildEvents(mentions: MediaMention[], vocab = vocabularyOf(mentions)): TimelineEvent[] {
  const chrono = [...mentions].sort(
    (a, b) => Date.parse(a.published_at) - Date.parse(b.published_at)
  );

  interface Cluster {
    laneId: string;
    seed: MediaMention;
    seedWords: Set<string>;
    seedTerms: Set<string>;
    lastT: number;
    items: MediaMention[];
  }
  const openByLane = new Map<string, Cluster[]>();
  const all: Cluster[] = [];

  for (const m of chrono) {
    const t = Date.parse(m.published_at);
    if (!Number.isFinite(t)) continue;
    const laneId = laneIdOf(m.theme);
    const open = openByLane.get(laneId) ?? [];

    // Le groupe le plus récent qui tient encore gagne : à mots égaux, c'est
    // toujours le fait le plus proche dans le temps.
    let host: Cluster | null = null;
    for (let i = open.length - 1; i >= 0; i--) {
      const c = open[i];
      if (t - c.lastT > MERGE_GAP_MS) {
        open.splice(i, 1); // trop vieux : ne pourra plus rien accueillir
        continue;
      }
      if (!host && sameFact(m, c.seedWords, c.seedTerms, vocab)) host = c;
    }

    if (host) {
      host.items.push(m);
      host.lastT = t;
    } else {
      const c: Cluster = {
        laneId,
        seed: m,
        seedWords: significantWords(m.titre),
        seedTerms: new Set(m.matched_terms),
        lastT: t,
        items: [m],
      };
      open.push(c);
      all.push(c);
    }
    openByLane.set(laneId, open);
  }

  return all.map((c) => {
    const terms = [...new Set(c.items.flatMap((m) => m.matched_terms))];
    return {
      id: c.seed.id,
      laneId: c.laneId,
      t: Date.parse(c.seed.published_at),
      // Le titre le plus court du groupe : moins de chapô recopié, plus de fait.
      title: shorten(c.items.map((m) => m.titre).reduce((a, b) => (b.length < a.length ? b : a))),
      subtitle: terms.slice(0, 3).join(", "),
      publisher: c.seed.publisher,
      publishers: [...new Set(c.items.map((m) => m.publisher))],
      mentions: c.items,
      terms,
      words: c.seedWords,
    };
  });
}

// --- liens -------------------------------------------------------------------

export type LinkKind = "established" | "suggested";

export interface TimelineLink {
  /** Nœud amont (le plus ancien) : la flèche suit le temps. */
  source: string;
  target: string;
  kind: LinkKind;
}

/** Fenêtre de rapprochement, plus large quand la période est longue. */
const LINK_GAP_MS: Record<Period, number> = {
  "24h": 18 * 3600 * 1000,
  "7j": 60 * 3600 * 1000,
  "30j": 96 * 3600 * 1000,
};

/** Garde-fou anti-pelote : un événement ne tire qu'un petit nombre de liens. */
const MAX_DEGREE: Record<LinkKind, number> = { established: 3, suggested: 2 };

/**
 * Exporté pour pouvoir être inspecté et testé au niveau événement : une fois
 * les événements regroupés par journée, un lien ne désigne plus les titres
 * qui l'ont justifié, ce qui rend tout diagnostic trompeur.
 */
export function buildLinks(events: TimelineEvent[], gap: number, vocab: Vocabulary): TimelineLink[] {
  const byTime = [...events].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  const candidates: { link: TimelineLink; score: number }[] = [];

  for (let i = 0; i < byTime.length; i++) {
    const a = byTime[i];
    const aTerms = new Set(a.terms);
    for (let j = i + 1; j < byTime.length; j++) {
      const b = byTime[j];
      if (b.t - a.t > gap) break; // trié : les suivants sont encore plus loin
      const bTerms = new Set(b.terms);
      const words = sharedDistinctive(b.words, a.words, vocab.distinctiveWord);
      const rareTerms = sharedDistinctive(bTerms, aTerms, vocab.distinctiveTerm);
      const terms = sharedCount(b.terms, aTerms);
      // Un lien exige une preuve dans le titre. Mesuré sur le fil réel, le
      // partage de personnalités ou de pays seul relie « l'Iran appelle les
      // Américains » à « l'Estonie forme ses enfants aux drones » et « Trump
      // et Xi sur l'IA » à « sept morts à Gaza » : sur vingt liens ainsi
      // obtenus, un seul tenait. Deux articles qui citent Trump ne parlent pas
      // du même fait. Les termes ne servent donc qu'à renforcer un recoupement
      // de titre existant, jamais à créer un lien.
      // La règle tient en une phrase : trois mots rares en commun désignent le
      // même fait, deux une parenté plausible, moins ne lie rien. Un seul mot
      // partagé suffisait, et reliait « le manichéisme de Javier Milei » aux
      // « priorités de l'aide américaine » par le mot « europe ».
      let kind: LinkKind | null = null;
      if (words >= 3) kind = "established";
      else if (words >= 2) kind = "suggested";
      if (!kind) continue;
      candidates.push({
        link: { source: a.id, target: b.id, kind },
        score: words * 3 + rareTerms * 2 + terms,
      });
    }
  }

  // Les liens les plus étayés passent d'abord, les autres seulement s'il
  // reste de la place : un événement sans voisin crédible reste isolé.
  candidates.sort(
    (x, y) =>
      Number(y.link.kind === "established") - Number(x.link.kind === "established") ||
      y.score - x.score ||
      x.link.source.localeCompare(y.link.source)
  );

  const degree = new Map<string, number>();
  const out: TimelineLink[] = [];
  for (const { link } of candidates) {
    const cap = MAX_DEGREE[link.kind];
    const ks = `${link.kind}|${link.source}`;
    const kt = `${link.kind}|${link.target}`;
    if ((degree.get(ks) ?? 0) >= cap || (degree.get(kt) ?? 0) >= cap) continue;
    degree.set(ks, (degree.get(ks) ?? 0) + 1);
    degree.set(kt, (degree.get(kt) ?? 0) + 1);
    out.push(link);
  }
  return out;
}

// --- regroupement par journée ------------------------------------------------

export interface TimelineNode {
  id: string;
  laneId: string;
  /** Abscisse temporelle du point (midi de la journée quand elle est regroupée). */
  t: number;
  /** Événement de tête : son titre et son sous-titre étiquettent le point. */
  lead: TimelineEvent;
  events: TimelineEvent[];
  /** Nombre d'événements regroupés — le compteur affiché quand il dépasse 1. */
  count: number;
  articleCount: number;
  publishers: string[];
  /** Articles du point, pour le panneau de détail. */
  mentionIds: string[];
  /** Bornes réelles des événements regroupés. */
  from: number;
  to: number;
}

const nodeOf = (id: string, t: number, events: TimelineEvent[]): TimelineNode => {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  // Le plus gros événement de la journée mène : c'est lui qu'on veut lire.
  const lead = [...sorted].sort((a, b) => b.mentions.length - a.mentions.length || a.t - b.t)[0];
  return {
    id,
    laneId: lead.laneId,
    t,
    lead,
    events: sorted,
    count: sorted.length,
    articleCount: sorted.reduce((n, e) => n + e.mentions.length, 0),
    publishers: [...new Set(sorted.flatMap((e) => e.publishers))],
    mentionIds: sorted.flatMap((e) => e.mentions.map((m) => m.id)),
    from: sorted[0].t,
    to: Math.max(...sorted.map((e) => e.t)),
  };
};

/** Clé de journée locale — `toISOString` basculerait de jour en soirée. */
const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const dayMidpoint = (t: number): number => {
  const d = new Date(t);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
};

// --- sortie ------------------------------------------------------------------

export interface Timeline {
  /** Couloirs peuplés, dans l'ordre du lexique, « Autres » en dernier. */
  lanes: Lane[];
  nodes: TimelineNode[];
  links: TimelineLink[];
  /** Vrai sur 7j et 30j : un point = une journée, d'où le compteur. */
  grouped: boolean;
  eventCount: number;
}

/**
 * Seule porte d'entrée de la frise : articles déjà filtrés (médias +
 * période) en entrée, couloirs / points / liens en sortie.
 *
 * Sur 7j et 30j, les événements d'une même journée et d'un même couloir
 * fusionnent en un point compteur, sinon ils se chevauchent ; les liens
 * suivent la fusion et les doublons tombent.
 */
export function buildTimeline(mentions: MediaMention[], period: Period): Timeline {
  // Le vocabulaire se mesure sur la fenêtre affichée, pas sur tout
  // l'historique : ce qui distingue un fait dépend de ce qui l'entoure.
  const vocab = vocabularyOf(mentions);
  const events = buildEvents(mentions, vocab);
  const eventLinks = buildLinks(events, LINK_GAP_MS[period], vocab);
  const grouped = period !== "24h";

  const nodeOfEvent = new Map<string, string>();
  let nodes: TimelineNode[];

  if (!grouped) {
    nodes = events.map((e) => nodeOf(e.id, e.t, [e]));
    for (const e of events) nodeOfEvent.set(e.id, e.id);
  } else {
    const buckets = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = `${e.laneId}|${dayKey(e.t)}`;
      const list = buckets.get(key);
      if (list) list.push(e);
      else buckets.set(key, [e]);
    }
    nodes = [...buckets].map(([key, list]) => {
      const node = nodeOf(key, dayMidpoint(list[0].t), list);
      for (const e of list) nodeOfEvent.set(e.id, key);
      return node;
    });
  }

  // Un lien dont les deux bouts ont atterri dans le même point disparaît ;
  // un doublon garde la qualification la plus forte.
  const merged = new Map<string, TimelineLink>();
  for (const l of eventLinks) {
    const source = nodeOfEvent.get(l.source);
    const target = nodeOfEvent.get(l.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    const prev = merged.get(key);
    if (prev && (prev.kind === "established" || l.kind === "suggested")) continue;
    merged.set(key, { source, target, kind: l.kind });
  }

  // Sept sujets, dont souvent la plupart vides sur une période courte : un
  // couloir vide ne ferait qu'allonger la frise.
  const usedLanes = new Set(nodes.map((n) => n.laneId));
  return {
    lanes: LANES.filter((l) => usedLanes.has(l.id)),
    nodes: nodes.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)),
    links: [...merged.values()],
    grouped,
    eventCount: events.length,
  };
}
