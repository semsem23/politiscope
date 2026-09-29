import { scaleSqrt } from "d3-scale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaMentions } from "../hooks/useMediaMentions";
import { initials } from "../hooks/usePolitiscope";
import {
  ENTITIES,
  OUTLETS,
  PERIOD_MS,
  SUBJECTS,
  entityOf,
  outletOf,
  subjectShort,
  type MediaMention,
  type OutletId,
  type Period,
  type Pole,
  type ScopeEntity,
} from "../lib/fluxScope";

/**
 * « Flux live » — à la liveuamap : fil des mentions à gauche, carte radiale
 * au centre, bande de densité en bas. Périmètre étroit (voir fluxScope.ts),
 * indépendant des filtres du reste de la page : seuls les médias et la
 * période s'appliquent ici.
 *
 * La période filtre côté client l'historique déjà accumulé — elle ne décrit
 * pas ce qui est collecté (l'ingestion ajoute chaque nuit les dernières 24 h).
 */

const PERIODS: Period[] = ["24h", "7j", "30j"];
const DAY_MS = 86_400_000;

type Selection =
  | { kind: "mention"; id: string }
  | { kind: "entity"; key: string }
  | { kind: "subject"; theme: string }
  | null;

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

const shortName = (e: ScopeEntity): string =>
  e.kind === "country" ? e.nom : e.nom === "Xi Jinping" ? "Xi" : e.nom.split(" ").slice(-1)[0];

// --- utilitaires --------------------------------------------------------------

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.round(diff / 60_000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

const fullDate = (iso: string): string =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

// --- carte radiale -------------------------------------------------------------

interface MapProps {
  mentions: MediaMention[];
  onSelect: (s: Selection) => void;
}

function RadialMap({ mentions, onSelect }: MapProps) {
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

  const keyActivate = (e: React.KeyboardEvent, s: Selection) => {
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

// --- bande de densité ------------------------------------------------------------

interface StripProps {
  /** Historique accumulé, filtré par média mais pas par période. */
  mentions: MediaMention[];
  activeOutlets: OutletId[];
  period: Period;
  now: number;
}

function DensityStrip({ mentions, activeOutlets, period, now }: StripProps) {
  const { days, start, end, max } = useMemo(() => {
    const endDate = new Date(now);
    endDate.setHours(24, 0, 0, 0);
    let oldest = now;
    for (const m of mentions) oldest = Math.min(oldest, Date.parse(m.published_at));
    const startDate = new Date(oldest);
    startDate.setHours(0, 0, 0, 0);

    // Bornes de jour via setDate : reste juste malgré les changements d'heure.
    const bounds: number[] = [];
    for (const d = new Date(startDate); d.getTime() < endDate.getTime(); d.setDate(d.getDate() + 1)) {
      bounds.push(d.getTime());
    }
    const days = bounds.map((t) => ({ t, byOutlet: new Map<OutletId, number>(), total: 0 }));
    for (const m of mentions) {
      const ts = Date.parse(m.published_at);
      let i = bounds.length - 1;
      while (i > 0 && bounds[i] > ts) i--;
      const day = days[i];
      day.byOutlet.set(m.outlet, (day.byOutlet.get(m.outlet) ?? 0) + 1);
      day.total += 1;
    }
    return {
      days,
      start: startDate.getTime(),
      end: endDate.getTime(),
      max: Math.max(1, ...days.map((d) => d.total)),
    };
  }, [mentions, now]);

  const W = Math.max(days.length, 1) * 10;
  const H = 44;
  const x = (t: number) => ((t - start) / (end - start)) * W;
  const windowStart = Math.max(start, now - PERIOD_MS[period]);
  const firstDay = new Date(start).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  return (
    <div className="flux-strip">
      <div className="flux-strip-head">
        <span className="filter-group-label">Densité</span>
        <span>
          Mentions par jour sur l'historique accumulé (depuis le {firstDay}) — la zone surlignée est la
          période affichée.
        </span>
      </div>
      <svg
        className="flux-strip-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Mentions par jour depuis le ${firstDay}, maximum ${plural(max, "mention")} en une journée`}
      >
        <rect className="flux-strip-window" x={x(windowStart)} y={0} width={W - x(windowStart)} height={H} />
        {days.map((d, i) => {
          let y = H;
          const inWindow = d.t + DAY_MS > windowStart;
          return (
            <g key={d.t} opacity={inWindow ? 1 : 0.35}>
              <title>
                {new Date(d.t).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} :{" "}
                {plural(d.total, "mention")}
              </title>
              {activeOutlets.map((o) => {
                const n = d.byOutlet.get(o) ?? 0;
                if (!n) return null;
                const h = (n / max) * (H - 4);
                y -= h;
                return <rect key={o} x={i * 10 + 1} y={y} width={8} height={h} fill={outletOf(o).color} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="flux-strip-axis">
        <span>{firstDay}</span>
        <span>aujourd'hui</span>
      </div>
    </div>
  );
}

// --- panneau de détail -------------------------------------------------------------

function MentionCard({ m, now }: { m: MediaMention; now: number }) {
  const outlet = outletOf(m.outlet);
  const names = m.entities.map((k) => entityOf(k)?.nom ?? k);
  return (
    <div className="citation-block" style={{ "--fam-color": outlet.color } as React.CSSProperties}>
      <p className="citation-theme">
        {subjectShort(m.theme)} · {names.join(", ")}
      </p>
      <blockquote className="quote flux-excerpt">{m.titre}</blockquote>
      {m.resume && <p className="flux-resume">{m.resume}</p>}
      <div className="modal-footer">
        <span title={fullDate(m.published_at)}>
          {outlet.label} · {relativeTime(m.published_at, now)}
        </span>
        <a href={m.article_url} target="_blank" rel="noopener noreferrer">
          Lire l'article : {domain(m.article_url)} ↗
        </a>
      </div>
    </div>
  );
}

interface DetailProps {
  selection: Selection;
  mentions: MediaMention[];
  now: number;
  periodLabel: string;
  onClose: () => void;
}

/** Même gabarit que la fiche personnalité (PersonModal) : backdrop, Échap, focus sur Fermer. */
function FluxDetail({ selection, mentions, now, periodLabel, onClose }: DetailProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selection, onClose]);

  if (!selection) return null;

  let title: string;
  let sub: string;
  let orb: React.ReactNode;
  let list: MediaMention[];

  if (selection.kind === "mention") {
    const m = mentions.find((x) => x.id === selection.id);
    if (!m) return null;
    const outlet = outletOf(m.outlet);
    title = outlet.label;
    sub = `${subjectShort(m.theme)} · ${fullDate(m.published_at)}`;
    orb = (
      <span className="modal-orb" style={{ "--fam-color": outlet.color } as React.CSSProperties}>
        {initials(outlet.label)}
      </span>
    );
    list = [m];
  } else if (selection.kind === "entity") {
    const e = entityOf(selection.key);
    if (!e) return null;
    list = mentions.filter((m) => m.entities.includes(e.key));
    title = e.nom;
    sub = `${e.role ?? "Pays"} · ${plural(list.length, "mention")} ${periodLabel}`;
    orb = (
      <span className={e.kind === "country" ? "modal-orb flux-orb-country" : "modal-orb"}>
        {e.kind === "country" ? e.nom.slice(0, 2).toUpperCase() : initials(e.nom)}
      </span>
    );
  } else {
    list = mentions.filter((m) => m.theme === selection.theme);
    title = subjectShort(selection.theme);
    sub = `Sujet · ${plural(list.length, "mention")} ${periodLabel}`;
    orb = <span className="modal-orb flux-orb-subject">#</span>;
  }

  const shown = list.slice(0, 30);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flux-detail-name"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-top">
          <div className="modal-id">
            {orb}
            <div>
              <div className="modal-name" id="flux-detail-name">
                {title}
              </div>
              <div className="modal-party">{sub}</div>
            </div>
          </div>
          <button ref={closeRef} className="modal-close" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="empty-state">Aucune mention sur cette période.</p>
        ) : (
          <ul className="citation-timeline">
            {shown.map((m) => (
              <li key={m.id}>
                <MentionCard m={m} now={now} />
              </li>
            ))}
          </ul>
        )}
        {list.length > shown.length && (
          <p className="modal-count">… et {plural(list.length - shown.length, "autre mention")}.</p>
        )}
      </div>
    </div>
  );
}

// --- vue -----------------------------------------------------------------------------

export function FluxLive() {
  const { mentions, loading, error, now } = useMediaMentions();
  const [outlets, setOutlets] = useState<Record<OutletId, boolean>>(
    () => Object.fromEntries(OUTLETS.map((o) => [o.id, true])) as Record<OutletId, boolean>
  );
  const [period, setPeriod] = useState<Period>("7j");
  const [selection, setSelection] = useState<Selection>(null);
  const closeDetail = useCallback(() => setSelection(null), []);

  const activeOutlets = OUTLETS.filter((o) => outlets[o.id]).map((o) => o.id);

  const byOutlet = useMemo(() => mentions.filter((m) => outlets[m.outlet]), [mentions, outlets]);
  const inWindow = useMemo(() => {
    const from = now - PERIOD_MS[period];
    return byOutlet.filter((m) => Date.parse(m.published_at) >= from);
  }, [byOutlet, period, now]);

  const periodLabel = period === "24h" ? "sur 24 h" : `sur ${period.replace("j", " jours")}`;

  return (
    <section className="flux-section" aria-label="Flux live">
      <div className="section-head">
        <div className="section-head-top">
          <div>
            <h2 className="section-title">Flux live</h2>
            <p className="section-sub">
              L'exécutif français et les principaux dirigeants étrangers dans les articles du Monde,
              du Figaro et du Parisien, d'après leurs flux RSS. Chaque nuit, la collecte ajoute les
              nouveaux articles à l'historique déjà accumulé ; la période ci-dessous filtre cet
              historique. Titres et chapôs sont ceux des rédactions ; cliquez une mention ou une
              bulle pour le détail et le lien vers l'article.
            </p>
          </div>
        </div>
      </div>

      <div className="flux-controls">
        <div className="filter-row" role="group" aria-label="Médias">
          <span className="filter-group-label">Médias</span>
          {OUTLETS.map((o) => (
            <button
              key={o.id}
              type="button"
              className="chip"
              data-active={outlets[o.id]}
              aria-pressed={outlets[o.id]}
              onClick={() => setOutlets((prev) => ({ ...prev, [o.id]: !prev[o.id] }))}
            >
              <span className="dot" style={{ background: o.color }} />
              {o.label}
            </button>
          ))}
        </div>
        <div className="graph-toggle" role="tablist" aria-label="Période, sur l'historique accumulé">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              className="toggle-btn"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flux-layout">
        <aside className="flux-feed" aria-label="Fil des mentions">
          <div className="flux-feed-head">
            <span className="flux-live-dot" aria-hidden="true" />
            {loading ? "chargement…" : `${plural(inWindow.length, "mention")} ${periodLabel}`}
          </div>
          {loading ? null : error || mentions.length === 0 ? (
            <p className="empty-state">
              Aucun article collecté pour l'instant : la collecte des flux presse tourne chaque nuit.
            </p>
          ) : inWindow.length === 0 ? (
            <p className="empty-state">Aucune mention sur cette période pour ces médias.</p>
          ) : (
            <ol className="flux-feed-list">
              {inWindow.map((m) => {
                const outlet = outletOf(m.outlet);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flux-item"
                      style={{ "--outlet-color": outlet.color } as React.CSSProperties}
                      onClick={() => setSelection({ kind: "mention", id: m.id })}
                    >
                      <span className="flux-item-meta">
                        <span className="dot" style={{ background: outlet.color }} />
                        {outlet.label}
                        <time dateTime={m.published_at} title={fullDate(m.published_at)}>
                          {relativeTime(m.published_at, now)}
                        </time>
                      </span>
                      <span className="flux-item-text">{m.titre}</span>
                      <span className="flux-item-tags">
                        <span className="flux-tag-subject">{subjectShort(m.theme)}</span>
                        {m.entities.map((k) => {
                          const e = entityOf(k);
                          return (
                            <span key={k} className={e?.kind === "country" ? "flux-tag flux-tag-country" : "flux-tag"}>
                              {e ? shortName(e) : k}
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>

        <div className="flux-map">
          <RadialMap mentions={inWindow} onSelect={setSelection} />
        </div>
      </div>

      <DensityStrip mentions={byOutlet} activeOutlets={activeOutlets} period={period} now={now} />

      <div className="graph-legend">
        <span className="legend-item">
          <span className="flux-swatch flux-swatch-figure" />
          Personnalité
        </span>
        <span className="legend-item">
          <span className="flux-swatch flux-swatch-country" />
          Pays
        </span>
        <span className="legend-item">
          <span className="flux-swatch flux-swatch-subject" />
          Sujet <span style={{ opacity: 0.65 }}>— taille et trait = nombre de mentions sur la période</span>
        </span>
      </div>

      <FluxDetail
        selection={selection}
        mentions={inWindow}
        now={now}
        periodLabel={periodLabel}
        onClose={closeDetail}
      />
    </section>
  );
}
