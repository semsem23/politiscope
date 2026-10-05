import { scaleSqrt } from "d3-scale";
import { useMemo, useState } from "react";
import { initials } from "../hooks/usePolitiscope";
import {
  ENTITIES,
  SUBJECTS,
  shortName,
  type MediaMention,
  type Pole,
} from "../lib/fluxScope";

/**
 * Ancienne carte radiale du « Flux live » : co-occurrences entités x sujets,
 * exécutif français au centre, sujets en anneau, dirigeants et pays
 * étrangers autour.
 *
 * DÉSACTIVÉE : la colonne de droite affiche désormais la frise
 * chronologique (voir EventTimeline.tsx). Ce fichier est conservé tel quel
 * pour pouvoir revenir en arrière — il suffit de remonter `<RadialMap
 * mentions={inWindow} onSelect={setSelection} />` dans `.flux-map` à la
 * place de `<EventTimeline …>`. Rien ne l'importe pour l'instant.
 */

/** Sélection émise vers le parent — sous-ensemble du type `Selection` de FluxLive. */
type MapSelection = { kind: "entity"; key: string } | { kind: "subject"; theme: string };

/** Idem `plural` dans FluxLive : dupliqué pour garder ce fichier autonome. */
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

// --- mise en page de la carte radiale ---------------------------------------
// Positions fixes, pas de simulation : la carte doit rester lisible d'un
// passage à l'autre, chaque entité toujours au même endroit.

const VB = 640;
const C = VB / 2;
/** Exécutif français au centre, sujets en anneau, pays et dirigeants étrangers autour. */
const R_FR = 58;
const R_SUBJECT = 170;
const R_OUTER = 250;

/** Angles (degrés, 0 = droite, sens horaire) — chaque sujet près des pays qui le portent. */
const POLE_ANGLE: Record<Exclude<Pole, "fr">, number> = { us: -90, ru: -18, ua: 54, cn: 126, il: 198 };
const SUBJECT_ANGLE: Record<string, number> = {
  "Commerce / droits de douane": -90,
  "Défense / Otan": -30,
  "Guerre en Ukraine": 30,
  "Europe & souveraineté": 90,
  Diplomatie: 150,
  "Gaza / Proche-Orient": 210,
};

interface Point {
  x: number;
  y: number;
  /** Direction depuis le centre, pour placer le libellé vers l'extérieur. */
  angle: number;
}

function polar(angleDeg: number, r: number): Point {
  const a = (angleDeg * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a), angle: angleDeg };
}

const ENTITY_POS: Map<string, Point> = (() => {
  const out = new Map<string, Point>();
  const fr = ENTITIES.filter((e) => e.pole === "fr");
  fr.forEach((e, i) => out.set(e.key, polar(-90 + i * 120, R_FR)));
  for (const e of ENTITIES) {
    if (e.pole === "fr") continue;
    // Dirigeant et pays côte à côte, de part et d'autre de l'angle du pays.
    out.set(e.key, polar(POLE_ANGLE[e.pole] + (e.kind === "figure" ? -10 : 10), R_OUTER));
  }
  return out;
})();

const SUBJECT_POS: Map<string, Point> = new Map(
  SUBJECTS.map((s) => [s.theme, polar(SUBJECT_ANGLE[s.theme] ?? 0, R_SUBJECT)])
);


// --- carte radiale -------------------------------------------------------------

interface MapProps {
  mentions: MediaMention[];
  onSelect: (s: MapSelection) => void;
}

export function RadialMap({ mentions, onSelect }: MapProps) {
  const [hover, setHover] = useState<string | null>(null);

  const { entityCount, subjectCount, links } = useMemo(() => {
    const entityCount = new Map<string, number>();
    const subjectCount = new Map<string, number>();
    const linkCount = new Map<string, { entity: string; theme: string; count: number }>();
    for (const m of mentions) {
      subjectCount.set(m.theme, (subjectCount.get(m.theme) ?? 0) + 1);
      for (const k of m.entities) {
        entityCount.set(k, (entityCount.get(k) ?? 0) + 1);
        const id = `${k}|${m.theme}`;
        const l = linkCount.get(id);
        if (l) l.count += 1;
        else linkCount.set(id, { entity: k, theme: m.theme, count: 1 });
      }
    }
    return { entityCount, subjectCount, links: [...linkCount.values()] };
  }, [mentions]);

  const maxCount = Math.max(1, ...entityCount.values());
  const radius = scaleSqrt().domain([0, maxCount]).range([9, 26]);

  // Survol : l'entité (ou le sujet) et tout ce qui y est relié restent nets.
  const connected = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const l of links) {
      if (l.entity === hover || `sujet:${l.theme}` === hover) {
        set.add(l.entity);
        set.add(`sujet:${l.theme}`);
      }
    }
    return set;
  }, [hover, links]);
  const dimmed = (id: string) => connected !== null && !connected.has(id);

  const keyActivate = (e: React.KeyboardEvent, s: MapSelection) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(s);
    }
  };

  const labelAnchor = (angle: number): "start" | "middle" | "end" => {
    const cos = Math.cos((angle * Math.PI) / 180);
    return cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
  };

  return (
    <svg
      className="flux-map-svg"
      viewBox={`0 0 ${VB} ${VB}`}
      role="group"
      aria-label="Carte radiale des mentions : exécutif français au centre, sujets en anneau, dirigeants et pays étrangers autour"
    >
      <circle className="flux-ring" cx={C} cy={C} r={R_SUBJECT} />
      <circle className="flux-ring" cx={C} cy={C} r={R_OUTER} />

      <g aria-hidden="true">
        {links.map((l) => {
          const a = ENTITY_POS.get(l.entity);
          const b = SUBJECT_POS.get(l.theme);
          if (!a || !b) return null;
          const isDim = connected !== null && !(connected.has(l.entity) && connected.has(`sujet:${l.theme}`));
          return (
            <line
              key={`${l.entity}|${l.theme}`}
              className={isDim ? "flux-link is-dim" : "flux-link"}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={Math.min(0.8 + l.count * 0.45, 6)}
            />
          );
        })}
      </g>

      {SUBJECTS.map((s) => {
        const p = SUBJECT_POS.get(s.theme)!;
        const id = `sujet:${s.theme}`;
        const n = subjectCount.get(s.theme) ?? 0;
        const label = `${s.libelle_court} ${n}`;
        const w = label.length * 6.6 + 18;
        return (
          <g
            key={s.theme}
            className={"flux-node flux-subject" + (dimmed(id) ? " is-dim" : "") + (n === 0 ? " is-empty" : "")}
            transform={`translate(${p.x},${p.y})`}
            tabIndex={0}
            role="button"
            aria-label={`${s.libelle_court} : ${plural(n, "mention")}`}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(id)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect({ kind: "subject", theme: s.theme })}
            onKeyDown={(e) => keyActivate(e, { kind: "subject", theme: s.theme })}
          >
            <rect className="flux-shape" x={-w / 2} y={-12} width={w} height={24} rx={12} />
            <text textAnchor="middle" dy="0.35em">
              {s.libelle_court} <tspan className="flux-count">{n}</tspan>
            </text>
          </g>
        );
      })}

      {ENTITIES.map((e) => {
        const p = ENTITY_POS.get(e.key)!;
        const n = entityCount.get(e.key) ?? 0;
        const r = n > 0 ? radius(n) : 8;
        const cls =
          "flux-node " +
          (e.kind === "country" ? "flux-country" : e.pole === "fr" ? "flux-figure flux-figure-fr" : "flux-figure") +
          (dimmed(e.key) ? " is-dim" : "") +
          (n === 0 ? " is-empty" : "");
        const a = (p.angle * Math.PI) / 180;
        const lx = Math.cos(a) * (r + 8);
        const ly = Math.sin(a) * (r + 8);
        return (
          <g
            key={e.key}
            className={cls}
            transform={`translate(${p.x},${p.y})`}
            tabIndex={0}
            role="button"
            aria-label={`${e.nom}${e.role ? `, ${e.role}` : ""} : ${plural(n, "mention")}`}
            onMouseEnter={() => setHover(e.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(e.key)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect({ kind: "entity", key: e.key })}
            onKeyDown={(ev) => keyActivate(ev, { kind: "entity", key: e.key })}
          >
            {e.kind === "country" ? (
              <rect className="flux-shape" x={-r} y={-r} width={r * 2} height={r * 2} rx={Math.max(3, r * 0.28)} />
            ) : (
              <circle className="flux-shape" r={r} />
            )}
            {e.kind === "figure" && r >= 14 && (
              <text className="flux-initials" textAnchor="middle" dy="0.35em">
                {initials(e.nom)}
              </text>
            )}
            <text
              className="flux-label"
              x={lx}
              y={ly}
              textAnchor={labelAnchor(p.angle)}
              dy={Math.sin(a) > 0.35 ? "0.9em" : Math.sin(a) < -0.35 ? "-0.2em" : "0.35em"}
            >
              {shortName(e)} <tspan className="flux-count">{n}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
