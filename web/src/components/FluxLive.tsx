import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaMentions } from "../hooks/useMediaMentions";
import { initials } from "../hooks/usePolitiscope";
import {
  PERIOD_MS,
  PUBLISHER_GROUPS,
  groupInfo,
  publisherColor,
  publisherGroup,
  subjectShort,
  type MediaMention,
  type Period,
  type PublisherGroup,
} from "../lib/fluxScope";
import { EventTimeline, type EventSelection } from "./EventTimeline";

/**
 * « Flux live » — à la liveuamap : fil des mentions à gauche, frise
 * chronologique des événements à droite, bande de densité en bas. Périmètre
 * étroit (voir fluxScope.ts), indépendant des filtres du reste de la page :
 * seuls les éditeurs et la période s'appliquent ici.
 *
 * La période filtre côté client l'historique déjà accumulé — elle ne décrit
 * pas ce qui est collecté (l'ingestion ajoute chaque nuit les derniers articles).
 */

const PERIODS: Period[] = ["24h", "7j", "30j"];
const DAY_MS = 86_400_000;

type Selection =
  | { kind: "mention"; id: string }
  | { kind: "subject"; theme: string }
  // Émise par la frise : porte déjà ses libellés et la liste de ses articles.
  | EventSelection
  | null;

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

// --- bande de densité ------------------------------------------------------------

interface StripProps {
  /** Historique accumulé, filtré par éditeur mais pas par période. */
  mentions: MediaMention[];
  activeGroups: PublisherGroup[];
  period: Period;
  now: number;
}

function DensityStrip({ mentions, activeGroups, period, now }: StripProps) {
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
    const days = bounds.map((t) => ({ t, byGroup: new Map<PublisherGroup, number>(), total: 0 }));
    for (const m of mentions) {
      const ts = Date.parse(m.published_at);
      let i = bounds.length - 1;
      while (i > 0 && bounds[i] > ts) i--;
      const day = days[i];
      const g = publisherGroup(m.publisher);
      day.byGroup.set(g, (day.byGroup.get(g) ?? 0) + 1);
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
              {activeGroups.map((g) => {
                const n = d.byGroup.get(g) ?? 0;
                if (!n) return null;
                const h = (n / max) * (H - 4);
                y -= h;
                return <rect key={g} x={i * 10 + 1} y={y} width={8} height={h} fill={groupInfo(g).color} />;
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
  return (
    <div className="citation-block" style={{ "--fam-color": publisherColor(m.publisher) } as React.CSSProperties}>
      <p className="citation-theme">
        {subjectShort(m.theme)}
        {m.matched_terms.length > 0 && ` · ${m.matched_terms.join(", ")}`}
      </p>
      <blockquote className="quote flux-excerpt">{m.titre}</blockquote>
      {m.resume && <p className="flux-resume">{m.resume}</p>}
      <div className="modal-footer">
        <span title={fullDate(m.published_at)}>
          {m.publisher} · {relativeTime(m.published_at, now)}
        </span>
        <a href={m.article_url} target="_blank" rel="noopener noreferrer">
          Lire l'article ({m.via === "Google Actualités" ? "via Google Actualités" : domain(m.article_url)}) ↗
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
    title = m.publisher;
    sub = `${subjectShort(m.theme)} · ${fullDate(m.published_at)}`;
    orb = (
      <span className="modal-orb" style={{ "--fam-color": publisherColor(m.publisher) } as React.CSSProperties}>
        {initials(m.publisher)}
      </span>
    );
    list = [m];
  } else if (selection.kind === "subject") {
    list = mentions.filter((m) => m.theme === selection.theme);
    title = subjectShort(selection.theme);
    sub = `Sujet · ${plural(list.length, "mention")} ${periodLabel}`;
    orb = <span className="modal-orb flux-orb-subject">#</span>;
  } else {
    // La frise a déjà résolu son groupe d'articles : on ne refait pas le
    // regroupement ici, on garde seulement l'ordre du fil (plus récent d'abord).
    const ids = new Set(selection.mentionIds);
    list = mentions.filter((m) => ids.has(m.id));
    title = selection.title;
    sub = selection.sub;
    orb = <span className="modal-orb flux-orb-event">◆</span>;
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
  const [groups, setGroups] = useState<Record<PublisherGroup, boolean>>(
    () => Object.fromEntries(PUBLISHER_GROUPS.map((g) => [g.id, true])) as Record<PublisherGroup, boolean>
  );
  const [period, setPeriod] = useState<Period>("7j");
  const [selection, setSelection] = useState<Selection>(null);
  const closeDetail = useCallback(() => setSelection(null), []);

  const activeGroups = PUBLISHER_GROUPS.filter((g) => groups[g.id]).map((g) => g.id);

  const byGroup = useMemo(() => mentions.filter((m) => groups[publisherGroup(m.publisher)]), [mentions, groups]);
  const inWindow = useMemo(() => {
    const from = now - PERIOD_MS[period];
    return byGroup.filter((m) => Date.parse(m.published_at) >= from);
  }, [byGroup, period, now]);

  const periodLabel = period === "24h" ? "sur 24 h" : `sur ${period.replace("j", " jours")}`;

  return (
    <section className="flux-section" aria-label="Flux">
      <div className="section-head">
        <div className="section-head-top">
          <div>
            <h2 className="section-title">Flux</h2>
            <p className="section-sub">
              Les titres de la rubrique « France » de Google Actualités, classés en sept sujets d'après
              les personnalités, partis, pays et dossiers qu'ils citent. Chaque nuit, la collecte ajoute
              les nouveaux articles à l'historique déjà accumulé ; la période ci-dessous filtre cet
              historique. Les titres sont ceux des rédactions ; cliquez une mention ou un événement de
              la frise pour le détail et le lien vers l'article. Les événements et leurs liens sont
              reconstitués à la lecture des titres, pas fournis par les rédactions.
            </p>
          </div>
        </div>
      </div>

      <div className="flux-controls">
        <div className="filter-row" role="group" aria-label="Médias">
          <span className="filter-group-label">Médias</span>
          {PUBLISHER_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className="chip"
              data-active={groups[g.id]}
              aria-pressed={groups[g.id]}
              onClick={() => setGroups((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
            >
              <span className="dot" style={{ background: g.color }} />
              {g.label}
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
              Aucun article collecté pour l'instant : la collecte du flux presse tourne chaque nuit.
            </p>
          ) : inWindow.length === 0 ? (
            <p className="empty-state">Aucune mention sur cette période pour ces médias.</p>
          ) : (
            <ol className="flux-feed-list">
              {inWindow.map((m) => {
                const color = publisherColor(m.publisher);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flux-item"
                      style={{ "--outlet-color": color } as React.CSSProperties}
                      onClick={() => setSelection({ kind: "mention", id: m.id })}
                    >
                      <span className="flux-item-meta">
                        <span className="dot" style={{ background: color }} />
                        {m.publisher}
                        <time dateTime={m.published_at} title={fullDate(m.published_at)}>
                          {relativeTime(m.published_at, now)}
                        </time>
                      </span>
                      <span className="flux-item-text">{m.titre}</span>
                      <span className="flux-item-tags">
                        <span className="flux-tag-subject">{subjectShort(m.theme)}</span>
                        {m.matched_terms.map((t) => (
                          <span key={t} className="flux-tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>

        <div className="flux-map flux-map-frise">
          <EventTimeline mentions={inWindow} period={period} now={now} onSelect={setSelection} />
        </div>
      </div>

      <DensityStrip mentions={byGroup} activeGroups={activeGroups} period={period} now={now} />

      <div className="graph-legend">
        {PUBLISHER_GROUPS.map((g) => (
          <span className="legend-item" key={g.id}>
            <span className="dot" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
        <span className="legend-item">
          {/* Pointe dessinée en dur : la légende ne dépend pas des <defs> de la frise. */}
          <svg className="frise-key" viewBox="0 0 34 8" aria-hidden="true">
            <path className="frise-link" d="M1,4 H25" />
            <path className="frise-head-solid" d="M24,1.2 L31,4 L24,6.8 Z" />
          </svg>
          Lien établi <span style={{ opacity: 0.65 }}>— même fait</span>
        </span>
        <span className="legend-item">
          <svg className="frise-key" viewBox="0 0 34 8" aria-hidden="true">
            <path className="frise-link is-suggested" d="M1,4 H25" />
            <path className="frise-head-dashed" d="M24,1.2 L31,4 L24,6.8 Z" />
          </svg>
          Lien suggéré <span style={{ opacity: 0.65 }}>— titres proches, à confirmer</span>
        </span>
        <span className="legend-item">
          <span className="frise-swatch-count">3</span>
          {period === "24h" ? "Événements groupés" : "Événements d'une même journée"}
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
