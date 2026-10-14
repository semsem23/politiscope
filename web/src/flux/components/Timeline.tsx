import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ActivityCategory, ActivityEvent, Article } from "../shared";
import { CATEGORY_LABEL, CATEGORY_ORDER, STATUS_LABEL, formatParis, formatRel, niceTicks, relDayLabel } from "../shared";
import { KIND_ICON, LANE_SUB, STATUS_GLYPH, catVar, srcVar } from "../lib/palette";

const TOP = 58;
const BOTTOM = 12;
const MIN_SPAN = 30 * 60_000;
const MAC_R = 30;
const MAX_DOTS = 5;

interface Props {
  events: ActivityEvent[];
  eventsById: Map<string, ActivityEvent>;
  articlesById: Map<string, Article>;
  startMs: number;
  endMs: number;
  zoom: [number, number] | null;
  setZoom: (z: [number, number] | null) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showSuggested: boolean;
  setShowSuggested: (v: boolean) => void;
  filterSlot: ReactNode;
  loading: boolean;
  emptyMessage: string;
  windowKey: string;
}

interface Pos { x: number; y: number; r: number; lane: number }

function curve(a: Pos, b: Pos): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - 22;
  return `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
}

export default function Timeline(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; d0: number; d1: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(560, Math.floor(el.clientWidth))));
    ro.observe(el);
    setWidth(Math.max(560, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const [d0, d1] = p.zoom ?? [p.startMs, p.endMs];
  const narrow = width < 700;
  const left = narrow ? 110 : 168;
  const right = 24;
  const plotW = width - left - right;

  // Couloirs : les 5 premiers toujours, les suivants seulement s'ils contiennent des événements.
  const lanes = useMemo<ActivityCategory[]>(() => {
    const used = new Set(p.events.map((e) => e.category));
    return CATEGORY_ORDER.filter((c, i) => i < 5 || used.has(c));
  }, [p.events]);
  const laneH = lanes.length <= 6 ? 92 : 74;
  const height = TOP + lanes.length * laneH + BOTTOM;
  const mx = left + plotW / 2;
  const centerLane = Math.floor(lanes.length / 2);
  const my = TOP + centerLane * laneH + laneH / 2;

  const xOf = useCallback((t: number) => left + ((t - d0) / (d1 - d0)) * plotW, [left, d0, d1, plotW]);

  // — zoom / déplacement ———————————————————————————————————
  const clampSpan = useCallback(
    (a: number, b: number): [number, number] => {
      let span = Math.min(p.endMs - p.startMs, Math.max(MIN_SPAN, b - a));
      let s = a;
      if (s < p.startMs) s = p.startMs;
      if (s + span > p.endMs) s = p.endMs - span;
      span = Math.min(span, p.endMs - p.startMs);
      return [s, s + span];
    },
    [p.startMs, p.endMs],
  );
  const setDomain = useCallback(
    (a: number, b: number) => {
      const [s, e] = clampSpan(a, b);
      p.setZoom(e - s >= p.endMs - p.startMs - 1 ? null : [s, e]);
    },
    [clampSpan, p],
  );
  const zoomBy = useCallback(
    (factor: number, centerMs?: number) => {
      const c = centerMs ?? (d0 + d1) / 2;
      setDomain(c - (c - d0) * factor, c + (d1 - c) * factor);
    },
    [d0, d1, setDomain],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const rect = svg.getBoundingClientRect();
        const t = d0 + ((ev.clientX - rect.left - left) / plotW) * (d1 - d0);
        zoomBy(ev.deltaY > 0 ? 1.25 : 0.8, Math.min(d1, Math.max(d0, t)));
      } else if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) && p.zoom) {
        ev.preventDefault();
        const dt = (ev.deltaX / plotW) * (d1 - d0);
        setDomain(d0 + dt, d1 + dt);
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [d0, d1, left, plotW, zoomBy, setDomain, p.zoom]);

  // — disposition des nœuds ————————————————————————————————
  const layout = useMemo(() => {
    const pos = new Map<string, Pos>();
    const rowOff = [0, -laneH * 0.2, laneH * 0.2];
    const byLane = new Map<number, ActivityEvent[]>();
    for (const e of p.events) {
      const lane = lanes.indexOf(e.category);
      if (lane < 0) continue;
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane)!.push(e);
    }
    for (const [lane, list] of byLane) {
      list.sort((a, b) => a.firstPublishedAt.localeCompare(b.firstPublishedAt));
      const ends: number[] = rowOff.map(() => -Infinity);
      for (const e of list) {
        const r = 13 + Math.min(7, (e.distinctArticleCount - 1) * 1.5);
        let x = xOf(Date.parse(e.firstPublishedAt));
        let row = ends.findIndex((end) => end + r + 4 <= x);
        if (row < 0) row = ends.indexOf(Math.min(...ends));
        ends[row] = x + r;
        const y = TOP + lane * laneH + laneH / 2 - 6 + rowOff[row];
        // évite le disque central de Macron
        const dx = x - mx, dy = y - my;
        const minD = MAC_R + r + 6;
        if (Math.hypot(dx, dy) < minD) x = mx + (dx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, minD * minD - dy * dy));
        pos.set(e.id, { x, y, r, lane });
      }
    }
    return pos;
  }, [p.events, lanes, laneH, xOf, mx, my]);

  const sortedEvents = useMemo(() => [...p.events].sort((a, b) => a.firstPublishedAt.localeCompare(b.firstPublishedAt)), [p.events]);
  const { ticks, step } = useMemo(() => niceTicks(d0, d1, narrow ? 4 : 7), [d0, d1, narrow]);
  const dayStep = step >= 24 * 3600_000;

  const selected = p.selectedId ? p.eventsById.get(p.selectedId) : undefined;
  const hovered = hoverId ? p.eventsById.get(hoverId) : undefined;
  const hovPos = hoverId ? layout.get(hoverId) : undefined;

  const edges = useCallback(
    (key: "suggestedRelations" | "confirmedRelations") => {
      const out: { a: Pos; b: Pos; ia: string; ib: string }[] = [];
      const seen = new Set<string>();
      for (const e of p.events) {
        for (const other of e[key]) {
          const k = [e.id, other].sort().join("|");
          const a = layout.get(e.id), b = layout.get(other);
          if (seen.has(k) || !a || !b) continue;
          seen.add(k);
          out.push({ a, b, ia: e.id, ib: other });
        }
      }
      return out;
    },
    [p.events, layout],
  );
  const suggestedEdges = useMemo(() => edges("suggestedRelations"), [edges]);
  const confirmedEdges = useMemo(() => edges("confirmedRelations"), [edges]);

  // — clavier ———————————————————————————————————————————
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "+" || ev.key === "=") return zoomBy(0.7);
    if (ev.key === "-") return zoomBy(1.4);
    if (ev.key === "0") return p.setZoom(null);
    if (ev.key === "Escape") return p.onSelect(null);
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      ev.preventDefault();
      const idx = sortedEvents.findIndex((e) => e.id === (p.selectedId ?? (ev.target as SVGElement).getAttribute?.("data-eid")));
      const next = sortedEvents[idx < 0 ? 0 : Math.min(sortedEvents.length - 1, Math.max(0, idx + (ev.key === "ArrowRight" ? 1 : -1)))];
      if (next) {
        p.onSelect(next.id);
        requestAnimationFrame(() => svgRef.current?.querySelector<SVGElement>(`[data-eid="${CSS.escape(next.id)}"]`)?.focus());
      }
    }
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    drag.current = { x: ev.clientX, d0, d1, moved: false };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved || !p.zoom) return;
    const dt = (-dx / plotW) * (d.d1 - d.d0);
    setDomain(d.d0 + dt, d.d1 + dt);
  };
  const onPointerUp = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (!moved) p.onSelect(null);
  };

  const empty = !p.loading && p.events.length === 0;
  const nowMs = p.endMs;

  return (
    <div className="timeline" onKeyDown={onKeyDown}>
      <div className="tl-toolbar">
        <h2 className="panel-h sr-only-sm">Frise des activités</h2>
        <span className="tl-controls">
          {p.filterSlot}
          <div className="popwrap" ref={menuRef}>
            <button type="button" className="icon-btn" aria-label="Options de la frise" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}>⋮</button>
            {menu && (
              <div className="popover popover-menu" role="menu">
                <label className="check" role="menuitemcheckbox" aria-checked={p.showSuggested}>
                  <input type="checkbox" checked={p.showSuggested} onChange={(e) => p.setShowSuggested(e.target.checked)} />
                  Liens suggérés <span className="pill-count">{suggestedEdges.length}</span>
                </label>
                <div className="menu-row">
                  <span>Zoom</span>
                  <span className="zoom-btns" role="group" aria-label="Zoom de la frise">
                    <button type="button" onClick={() => zoomBy(1.4)} aria-label="Dézoomer" disabled={!p.zoom}>−</button>
                    <button type="button" onClick={() => zoomBy(0.7)} aria-label="Zoomer">+</button>
                    <button type="button" onClick={() => p.setZoom(null)} disabled={!p.zoom}>Réinit.</button>
                  </span>
                </div>
                <p className="small mute menu-note">Glisser pour déplacer · Ctrl/⌘ + molette pour zoomer · clavier : ← → + − 0 Échap</p>
              </div>
            )}
          </div>
        </span>
      </div>

      <div className="tl-scroll" ref={wrapRef}>
        <div className="tl-stage" style={{ height }}>
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label="Frise chronologique des activités autour d'Emmanuel Macron. Flèches gauche et droite : événement précédent ou suivant. Plus et moins : zoom. Zéro : réinitialiser."
          >
            <defs>
              <clipPath id="plot-clip"><rect x={left - 6} y={TOP - 4} width={plotW + 12} height={height - TOP - BOTTOM + 4} /></clipPath>
            </defs>

            {/* couloirs thématiques */}
            {lanes.map((c, i) => (
              <g key={c}>
                {i > 0 && <line x1={14} x2={width - 14} y1={TOP + i * laneH} y2={TOP + i * laneH} className="lane-line" />}
                <circle cx={22} cy={TOP + i * laneH + laneH / 2 - 9} r={4.5} fill={catVar(c)} />
                <text x={34} y={TOP + i * laneH + laneH / 2 - 5} className="lane-label">{CATEGORY_LABEL[c]}</text>
                {!narrow && <text x={34} y={TOP + i * laneH + laneH / 2 + 12} className="lane-sub">{LANE_SUB[c]}</text>}
              </g>
            ))}

            {/* fond : clic / glisser */}
            <rect x={left} y={TOP} width={plotW} height={lanes.length * laneH} fill="transparent"
              style={{ cursor: p.zoom ? "grab" : "default" }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />

            {/* graduations (heure de Paris) */}
            {ticks.map((t, i) => {
              const x = xOf(t.t);
              const showDay = !dayStep && (t.midnight || i === 0);
              return (
                <g key={t.t}>
                  <line x1={x} x2={x} y1={TOP - 4} y2={height - BOTTOM} className="tick-line" />
                  {showDay && <text x={x} y={TOP - 34} textAnchor="middle" className="tick-day">{relDayLabel(t.t, nowMs)}</text>}
                  <text x={x} y={TOP - 18} textAnchor="middle" className="tick-label">
                    {dayStep ? formatParis(t.t, "day") : formatParis(t.t, "time")}
                  </text>
                </g>
              );
            })}

            <g clipPath="url(#plot-clip)">
              {/* rayons depuis Macron : périmètre de collecte, pas une relation factuelle */}
              {p.events.map((e) => {
                const q = layout.get(e.id);
                if (!q) return null;
                const on = e.id === p.selectedId || e.id === hoverId;
                return <line key={`m-${e.id}`} x1={mx} y1={my} x2={q.x} y2={q.y} className={on ? "spoke spoke-on" : "spoke"} />;
              })}

              {confirmedEdges.map((l) => <path key={`c-${l.ia}-${l.ib}`} d={curve(l.a, l.b)} className="edge-confirmed" />)}
              {p.showSuggested && suggestedEdges.map((l) => {
                const hot = l.ia === p.selectedId || l.ib === p.selectedId;
                return <path key={`s-${l.ia}-${l.ib}`} d={curve(l.a, l.b)} className={hot ? "edge-suggested edge-hot" : "edge-suggested"} />;
              })}

              {/* nœuds */}
              {p.events.map((e) => {
                const q = layout.get(e.id);
                if (!q || q.x < left - 10 || q.x > width - right + 10) return null;
                const sel = e.id === p.selectedId;
                const sched = e.status === "scheduled";
                const dim = p.selectedId && !sel && !(selected?.suggestedRelations.includes(e.id) || selected?.confirmedRelations.includes(e.id));
                const arts = e.articleIds.map((id) => p.articlesById.get(id)).filter((a): a is Article => !!a && !a.nearDuplicateOf);
                const dots = arts.slice(0, MAX_DOTS);
                const more = arts.length - dots.length;
                const icon = KIND_ICON[e.kind ?? "other"];
                const k = (q.r * 1.05) / 24;
                const dw = 9;
                return (
                  <g
                    key={e.id}
                    data-eid={e.id}
                    transform={`translate(${q.x} ${q.y})`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={sel}
                    aria-label={`${e.isDemo ? "DEMO. " : ""}${e.title}. ${CATEGORY_LABEL[e.category]}. ${STATUS_LABEL[e.status]}. ${e.distinctArticleCount} article${e.distinctArticleCount > 1 ? "s" : ""}. ${formatParis(e.firstPublishedAt)}.`}
                    className={dim ? "node node-dim" : "node"}
                    onClick={(ev) => { ev.stopPropagation(); p.onSelect(sel ? null : e.id); }}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); p.onSelect(sel ? null : e.id); } }}
                    onPointerEnter={() => setHoverId(e.id)}
                    onPointerLeave={() => setHoverId((h) => (h === e.id ? null : h))}
                    onFocus={() => setHoverId(e.id)}
                    onBlur={() => setHoverId((h) => (h === e.id ? null : h))}
                  >
                    {sel && <circle r={q.r + 6} className="node-halo" />}
                    <circle r={q.r} className="node-disc" fill={sched ? "var(--card)" : catVar(e.category)} stroke={catVar(e.category)} strokeWidth={sched ? 2.5 : 0} strokeDasharray={sched ? "4 3" : undefined} />
                    <path d={icon} transform={`translate(${-12 * k} ${-12 * k}) scale(${k})`} fill={sched ? catVar(e.category) : "#fff"} pointerEvents="none" />
                    <g transform={`translate(${q.r * 0.8} ${-q.r * 0.8})`}>
                      <circle r={7} className="badge" />
                      <text textAnchor="middle" dy="3.3" className="badge-glyph">{STATUS_GLYPH[e.status]}</text>
                    </g>
                    <g transform={`translate(${-((dots.length - 1) * dw + (more > 0 ? 14 : 0)) / 2} ${q.r + 8})`} pointerEvents="none">
                      {dots.map((a, i) => <circle key={a.id} cx={i * dw} r={3.2} fill={srcVar(a.sourceKind)} className="src-dot" />)}
                      {more > 0 && <text x={dots.length * dw - 2} y={3.5} className="more-dots">+{more}</text>}
                    </g>
                  </g>
                );
              })}
            </g>

            {/* Macron au centre (décoratif pour la souris, mais décrit pour les lecteurs d'écran) */}
            <g pointerEvents="none">
              <title>Emmanuel Macron : toutes les activités affichées concernent ses activités publiques</title>
              <circle cx={mx} cy={my} r={MAC_R + 4} fill="var(--card)" opacity="0.9" />
              <circle cx={mx} cy={my} r={MAC_R} className="macron-disc" />
              <text x={mx} y={my + 6} textAnchor="middle" className="macron-initials">EM</text>
              <rect x={mx - 62} y={my + MAC_R + 5} width={124} height={22} rx={11} className="macron-pill" />
              <text x={mx} y={my + MAC_R + 20} textAnchor="middle" className="macron-pill-text">Emmanuel Macron</text>
            </g>

            {selected && layout.get(selected.id) && (() => {
              const q = layout.get(selected.id)!;
              return (
                <text x={q.x} y={q.y - q.r - 12} textAnchor={q.x > width - 230 ? "end" : q.x < left + 150 ? "start" : "middle"} className="node-label">
                  {selected.title.length > 46 ? selected.title.slice(0, 45) + "…" : selected.title}
                </text>
              );
            })()}
          </svg>

          {hovered && hovPos && (
            <div className="tip" style={{ left: Math.min(width - 260, Math.max(8, hovPos.x + 18)), top: Math.max(4, hovPos.y - 10 - (hovPos.y > height - 150 ? 90 : 0)) }} role="tooltip">
              {hovered.isDemo && <span className="tag tag-demo">DEMO</span>}
              <strong>{hovered.title}</strong>
              <span>{CATEGORY_LABEL[hovered.category]} · {STATUS_GLYPH[hovered.status]} {STATUS_LABEL[hovered.status]}</span>
              <span>{formatRel(Date.parse(hovered.firstPublishedAt), nowMs, true)} · {hovered.distinctArticleCount} article{hovered.distinctArticleCount > 1 ? "s" : ""}, {hovered.independentSourceCount} source{hovered.independentSourceCount > 1 ? "s" : ""} indép.</span>
            </div>
          )}

          {p.loading && <div className="overlay" role="status" style={{ left: left }}>Chargement des événements…</div>}
          {empty && (
            <div className="overlay overlay-empty" role="status" style={{ left: left, top: TOP }}>
              <strong>Aucun événement sur cette période</strong>
              <span>{p.emptyMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
