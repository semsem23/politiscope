import { useCallback, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { buildTimeline, type TimelineNode } from "../lib/buildEvents";
import { PERIOD_MS, publisherColor, type MediaMention, type Period } from "../lib/fluxScope";

/**
 * Frise chronologique des événements reliés — la colonne de droite du
 * « Flux live », à la place de l'ancienne carte radiale (retirée avec les
 * entités ; elle reste dans l'historique git).
 *
 * Axe horizontal : la période choisie en amont, repères réguliers.
 * Couloirs horizontaux : les pôles thématiques, nom à gauche.
 * Un point : un événement (ou, sur 7j et 30j, une journée d'événements d'un
 * même couloir, avec compteur). Flèche pleine = lien établi, pointillés =
 * lien suggéré, masquable par la case dédiée.
 *
 * SVG fait main, mis à l'échelle sur la largeur mesurée du conteneur : pas
 * de nouvelle dépendance, et le texte garde sa taille réelle (un viewBox
 * élastique l'étirerait). Toute la dérivation des événements vit dans
 * lib/buildEvents.ts ; ce fichier ne fait que la mettre en page.
 */

export interface EventSelection {
  kind: "event";
  nodeId: string;
  title: string;
  sub: string;
  /** Articles de l'événement, résolus par le panneau de détail. */
  mentionIds: string[];
}

interface Props {
  /** Articles déjà filtrés par média et par période (voir FluxLive). */
  mentions: MediaMention[];
  period: Period;
  now: number;
  onSelect: (s: EventSelection) => void;
}

// --- géométrie ---------------------------------------------------------------

const LANE_H = 86;
/** Bandeau des repères temporels, en haut. */
const AXIS_H = 30;
const PAD_BOTTOM = 12;
const PAD_RIGHT = 20;
/** En dessous, la frise défile dans son cadre plutôt que de se tasser. */
const MIN_WIDTH = 560;
/** Le point est bas dans son couloir : l'étiquette tient au-dessus. */
const DOT_RATIO = 0.7;

/** Gouttière à la mesure du plus long nom de couloir affiché (« Ukraine-Russie »…). */
const gutterFor = (labels: string[]) => Math.max(72, ...labels.map((l) => l.length * 7 + 24));
const radiusOf = (n: TimelineNode) => (n.count > 1 ? 11 : 7);

// --- repères temporels ---------------------------------------------------------

interface Tick {
  t: number;
  label: string;
}

/**
 * Repères alignés sur des bornes lisibles (heure pleine, minuit) plutôt que
 * sur l'instant courant : « 15 h », pas « 15 h 07 ».
 */
function ticksFor(start: number, end: number, period: Period): Tick[] {
  const out: Tick[] = [];
  const cursor = new Date(start);

  if (period === "24h") {
    cursor.setMinutes(0, 0, 0);
    while (cursor.getHours() % 3 !== 0) cursor.setHours(cursor.getHours() + 1);
    for (; cursor.getTime() <= end; cursor.setHours(cursor.getHours() + 3)) {
      const t = cursor.getTime();
      if (t >= start) out.push({ t, label: `${cursor.getHours()} h` });
    }
    return out;
  }

  const step = period === "7j" ? 1 : 5;
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < start) cursor.setDate(cursor.getDate() + 1);
  const fmt: Intl.DateTimeFormatOptions =
    period === "7j" ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" };
  for (; cursor.getTime() <= end; cursor.setDate(cursor.getDate() + step)) {
    out.push({ t: cursor.getTime(), label: cursor.toLocaleDateString("fr-FR", fmt) });
  }
  return out;
}

// --- libellés -----------------------------------------------------------------

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

const dayLabel = (t: number) =>
  new Date(t).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

const hourLabel = (t: number) =>
  new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const nodeSub = (n: TimelineNode): string =>
  n.count > 1 ? `${n.lead.subtitle} · +${plural(n.count - 1, "autre")}` : n.lead.subtitle;

/** Ce que le panneau de détail affichera en tête. */
const selectionOf = (n: TimelineNode, grouped: boolean): EventSelection => ({
  kind: "event",
  nodeId: n.id,
  title: n.count > 1 ? `${dayLabel(n.from)} — ${plural(n.count, "événement")}` : n.lead.title,
  sub: grouped
    ? `${n.lead.subtitle} · ${plural(n.articleCount, "article")}`
    : `${dayLabel(n.from)}, ${hourLabel(n.from)} · ${plural(n.articleCount, "article")}`,
  mentionIds: n.mentionIds,
});

/** Infobulle native : le détail de la journée au survol, sans quitter la frise. */
const nodeTooltip = (n: TimelineNode): string => {
  const head = n.count > 1 ? `${dayLabel(n.from)} — ${plural(n.count, "événement")}` : dayLabel(n.from);
  const body = n.events
    .slice(0, 6)
    .map((e) => `• ${hourLabel(e.t)} ${e.title} (${e.publishers.join(", ")})`);
  if (n.events.length > 6) body.push(`… et ${plural(n.events.length - 6, "autre")}`);
  return [head, ...body].join("\n");
};

// --- vue ------------------------------------------------------------------------

export function EventTimeline({ mentions, period, now, onSelect }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { width: measured } = useContainerSize(frameRef);
  const [showSuggested, setShowSuggested] = useState(true);
  const [hover, setHover] = useState<string | null>(null);

  const timeline = useMemo(() => buildTimeline(mentions, period), [mentions, period]);
  const { lanes, nodes, links, grouped } = timeline;

  const start = now - PERIOD_MS[period];
  const ticks = useMemo(() => ticksFor(start, now, period), [start, now, period]);

  const W = Math.max(MIN_WIDTH, measured ?? MIN_WIDTH);
  const gutter = gutterFor(lanes.map((l) => l.label));
  const innerW = Math.max(120, W - gutter - PAD_RIGHT);
  const H = AXIS_H + lanes.length * LANE_H + PAD_BOTTOM;

  /** Échelle temps -> pixels. Mémoïsée pour que `labelled` ne dépende que d'elle. */
  const x = useCallback(
    (t: number) => gutter + ((Math.min(now, Math.max(start, t)) - start) / (now - start)) * innerW,
    [gutter, start, now, innerW]
  );
  const laneY = (laneId: string) => {
    const i = Math.max(0, lanes.findIndex((l) => l.id === laneId));
    return AXIS_H + i * LANE_H + LANE_H * DOT_RATIO;
  };

  /**
   * Étiquettes posées de gauche à droite, une seule rangée par couloir :
   * on saute celle qui recouvrirait la précédente (le point reste, avec son
   * infobulle). Les points eux-mêmes ne se chevauchent pas — une journée
   * par point sur 7j et 30j.
   */
  const labelled = useMemo(() => {
    const keep = new Set<string>();
    const rightEdge = new Map<string, number>();
    for (const n of nodes) {
      const nx = x(n.t);
      const w = Math.min(176, Math.max(n.lead.title.length, nodeSub(n).length) * 5.4 + 14);
      const left = nx - radiusOf(n) - 2;
      if (left < (rightEdge.get(n.laneId) ?? -Infinity) + 8) continue;
      keep.add(n.id);
      rightEdge.set(n.laneId, left + w);
    }
    return keep;
  }, [nodes, x]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const shown = showSuggested ? links : links.filter((l) => l.kind === "established");

  /** Survol : le point, ses voisins et leurs liens restent nets. */
  const connected = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const l of shown) {
      if (l.source === hover) set.add(l.target);
      else if (l.target === hover) set.add(l.source);
    }
    return set;
  }, [hover, shown]);

  const suggestedCount = links.filter((l) => l.kind === "suggested").length;

  const keyActivate = (e: React.KeyboardEvent, n: TimelineNode) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(selectionOf(n, grouped));
    }
  };

  return (
    <>
      <div className="frise-head">
        <span className="filter-group-label">Frise</span>
        <span className="frise-head-note">
          {nodes.length === 0
            ? "Aucun événement sur cette période."
            : grouped
              ? `${plural(timeline.eventCount, "événement")} regroupés par journée`
              : plural(timeline.eventCount, "événement")}
        </span>
        <label className="frise-switch">
          <input
            type="checkbox"
            checked={showSuggested}
            onChange={(e) => setShowSuggested(e.target.checked)}
          />
          Afficher les liens suggérés
          {suggestedCount > 0 && <span className="frise-switch-count">{suggestedCount}</span>}
        </label>
      </div>

      <div className="frise-frame" ref={frameRef}>
        {nodes.length === 0 ? (
          <p className="empty-state">
            Aucun événement reconstitué sur cette période pour ces médias.
          </p>
        ) : (
          <svg
            className="frise-svg"
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            aria-label={`Frise chronologique : ${plural(
              timeline.eventCount,
              "événement"
            )} répartis en ${lanes.length} pôles thématiques, du plus ancien à gauche au plus récent à droite`}
          >
            <defs>
              <marker
                id="frise-head-solid"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path className="frise-head-solid" d="M0,0.9 L7.5,4 L0,7.1 Z" />
              </marker>
              <marker
                id="frise-head-dashed"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path className="frise-head-dashed" d="M0,0.9 L7.5,4 L0,7.1 Z" />
              </marker>
            </defs>

            {/* repères temporels */}
            <g aria-hidden="true">
              {ticks.map((tick) => (
                <g key={tick.t}>
                  <line className="frise-grid" x1={x(tick.t)} y1={AXIS_H - 8} x2={x(tick.t)} y2={H - PAD_BOTTOM} />
                  <text className="frise-tick" x={x(tick.t)} y={AXIS_H - 14} textAnchor="middle">
                    {tick.label}
                  </text>
                </g>
              ))}
              <text className="frise-tick frise-tick-now" x={W - PAD_RIGHT} y={AXIS_H - 14} textAnchor="end">
                maintenant
              </text>
            </g>

            {/* couloirs */}
            {lanes.map((lane) => {
              const y = laneY(lane.id);
              return (
                <g key={lane.id} aria-hidden="true">
                  <line className="frise-lane-line" x1={gutter} y1={y} x2={W - PAD_RIGHT} y2={y} />
                  <text className="frise-lane-label" x={gutter - 12} y={y} textAnchor="end" dy="0.35em">
                    {lane.label}
                  </text>
                </g>
              );
            })}

            {/* liens : sous les points, pour ne jamais masquer une pastille */}
            <g aria-hidden="true">
              {shown.map((l) => {
                const a = byId.get(l.source);
                const b = byId.get(l.target);
                if (!a || !b) return null;
                const x1 = x(a.t);
                const y1 = laneY(a.laneId);
                const x2 = x(b.t);
                const y2 = laneY(b.laneId);
                const d = Math.hypot(x2 - x1, y2 - y1) || 1;
                const ux = (x2 - x1) / d;
                const uy = (y2 - y1) / d;
                const ax = x1 + ux * (radiusOf(a) + 3);
                const ay = y1 + uy * (radiusOf(a) + 3);
                const bx = x2 - ux * (radiusOf(b) + 8);
                const by = y2 - uy * (radiusOf(b) + 8);
                // Même couloir : arc sous la ligne, là où rien n'est écrit.
                // Couloirs différents : courbe à tangentes horizontales.
                const path =
                  a.laneId === b.laneId
                    ? `M${ax},${ay} Q${(ax + bx) / 2},${ay + 20} ${bx},${by}`
                    : `M${ax},${ay} C${ax + Math.max(20, Math.abs(bx - ax) * 0.45)},${ay} ` +
                      `${bx - Math.max(20, Math.abs(bx - ax) * 0.45)},${by} ${bx},${by}`;
                const dim = connected !== null && !(connected.has(l.source) && connected.has(l.target));
                return (
                  <path
                    key={`${l.source}->${l.target}`}
                    className={
                      (l.kind === "established" ? "frise-link" : "frise-link is-suggested") +
                      (dim ? " is-dim" : "")
                    }
                    d={path}
                    markerEnd={`url(#frise-head-${l.kind === "established" ? "solid" : "dashed"})`}
                  />
                );
              })}
            </g>

            {/* événements */}
            {nodes.map((n) => {
              const nx = x(n.t);
              const ny = laneY(n.laneId);
              const r = radiusOf(n);
              const dim = connected !== null && !connected.has(n.id);
              // Étiquette repliée à gauche près du bord droit, sinon elle sort du cadre.
              const flip = nx > W - PAD_RIGHT - 150;
              const tx = flip ? nx - r - 6 : nx + r + 6;
              return (
                <g
                  key={n.id}
                  className={"frise-node" + (dim ? " is-dim" : "")}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.lead.title}. ${nodeSub(n)}. ${dayLabel(n.from)} à ${hourLabel(
                    n.from
                  )}, ${n.publishers.join(", ")}, ${plural(
                    n.articleCount,
                    "article"
                  )}`}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect(selectionOf(n, grouped))}
                  onKeyDown={(e) => keyActivate(e, n)}
                >
                  <title>{nodeTooltip(n)}</title>

                  {/* Pastille de couleur de l'éditeur source ; plusieurs éditeurs -> satellites. */}
                  <circle
                    className="frise-dot"
                    cx={nx}
                    cy={ny}
                    r={r}
                    style={{ fill: publisherColor(n.lead.publisher) }}
                  />
                  {n.count > 1 && (
                    <text className="frise-dot-count" x={nx} y={ny} textAnchor="middle" dy="0.35em">
                      {n.count}
                    </text>
                  )}
                  {n.publishers.slice(1, 4).map((p, i) => (
                    <circle
                      key={p}
                      className="frise-dot-extra"
                      cx={nx - r + 1 + i * 6}
                      cy={ny + r + 5}
                      r={3}
                      style={{ fill: publisherColor(p) }}
                    />
                  ))}

                  {labelled.has(n.id) && (
                    <>
                      <text
                        className="frise-title"
                        x={tx}
                        y={ny - 24}
                        textAnchor={flip ? "end" : "start"}
                      >
                        {n.lead.title}
                      </text>
                      <text
                        className="frise-subtitle"
                        x={tx}
                        y={ny - 11}
                        textAnchor={flip ? "end" : "start"}
                      >
                        {nodeSub(n)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </>
  );
}
