import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent, Article, Personality, SourceKind } from "../shared";
import { CATEGORY_LABEL, SOURCE_LABEL, formatRel } from "../shared";
import { catVar } from "../lib/palette";
import { DemoTag, SourceBadge, StatusBadge } from "./bits";

const PAGE = 40;

interface Props {
  events: ActivityEvent[];
  articlesById: Map<string, Article>;
  personalities: Personality[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  nowMs: number;
  windowKey: string;
  query: string;
  setQuery: (q: string) => void;
  loading: boolean;
  emptyMessage: string;
}

function describe(e: ActivityEvent, arts: Article[]): string {
  const withText = arts.find((a) => a.excerpt && !a.nearDuplicateOf) ?? arts.find((a) => a.excerpt);
  if (withText?.excerpt) return withText.excerpt;
  const names = [...new Set(arts.map((a) => a.publisherName))];
  return names.length ? `Rapporté par ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}.` : e.summary;
}

export default function EventList(p: Props) {
  const [limit, setLimit] = useState(PAGE);
  const [newestFirst, setNewestFirst] = useState(true);
  const refs = useRef(new Map<string, HTMLElement>());
  useEffect(() => setLimit(PAGE), [p.events.length, p.windowKey]);

  const sorted = useMemo(() => {
    const s = [...p.events].sort((a, b) => a.firstPublishedAt.localeCompare(b.firstPublishedAt));
    return newestFirst ? s.reverse() : s;
  }, [p.events, newestFirst]);

  useEffect(() => {
    if (!p.selectedId) return;
    const i = sorted.findIndex((e) => e.id === p.selectedId);
    if (i < 0) return;
    if (i >= limit) setLimit(i + 5);
    requestAnimationFrame(() => refs.current.get(p.selectedId!)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedId]);

  const showDay = true; // le jour est toujours indiqué : « Aujourd'hui » / « Hier » / date

  return (
    <section className="panel list-panel" aria-label="Dernières activités">
      <div className="list-head">
        <h2 className="panel-h">Dernières activités <span className="count-badge">{p.events.length}</span></h2>
        <button type="button" className="sort" onClick={() => setNewestFirst(!newestFirst)} aria-label={newestFirst ? "Tri : plus récentes d'abord. Cliquer pour inverser." : "Tri : plus anciennes d'abord. Cliquer pour inverser."}>
          {newestFirst ? "Plus récentes" : "Plus anciennes"} <span aria-hidden="true">{newestFirst ? "↓" : "↑"}</span>
        </button>
      </div>
      <div className="search">
        <input type="search" value={p.query} onChange={(e) => p.setQuery(e.target.value)} placeholder="Rechercher (titres, extraits, médias)" aria-label="Recherche textuelle" />
      </div>

      <ol className="cards" aria-live="polite">
        {sorted.slice(0, limit).map((e) => {
          const arts = e.articleIds.map((id) => p.articlesById.get(id)).filter((a): a is Article => !!a);
          const counts = new Map<SourceKind, number>();
          for (const a of arts) counts.set(a.sourceKind, (counts.get(a.sourceKind) ?? 0) + 1);
          const sel = e.id === p.selectedId;
          return (
            <li key={e.id}>
              <button
                type="button"
                ref={(el) => { if (el) refs.current.set(e.id, el); else refs.current.delete(e.id); }}
                className={sel ? "card card-sel" : "card"}
                style={{ ["--c" as string]: catVar(e.category) }}
                onClick={() => p.onSelect(e.id)}
                aria-pressed={sel}
              >
                <span className="card-body">
                  <span className="card-top">
                    <span className="cat-label"><i className="dot" aria-hidden="true" />{CATEGORY_LABEL[e.category]}</span>
                    <time className="card-time" dateTime={e.firstPublishedAt}>{formatRel(Date.parse(e.firstPublishedAt), p.nowMs, showDay)}</time>
                  </span>
                  <span className="card-title">{e.title}</span>
                  <span className="card-excerpt">{describe(e, arts)}</span>
                  {(e.personalityIds ?? []).length > 0 && (
                    <span className="card-people">
                      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor" /></svg>
                      {(e.personalityIds ?? []).map((id) => p.personalities.find((x) => x.id === id)?.name ?? id).join(", ")}
                    </span>
                  )}
                  <span className="card-tags">
                    {e.isDemo && <DemoTag />}
                    {[...counts].map(([k, n]) => (
                      <span key={k} className="spill" title={`${SOURCE_LABEL[k]} : ${n} article${n > 1 ? "s" : ""}`}>
                        <SourceBadge kind={k} />{SOURCE_LABEL[k]}{n > 1 && <b> ×{n}</b>}
                      </span>
                    ))}
                    {e.status !== "single_source" && <StatusBadge status={e.status} />}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ol>

      {p.loading && <p className="empty">Chargement…</p>}
      {!p.loading && p.events.length === 0 && <p className="empty">{p.emptyMessage}</p>}
      {sorted.length > limit && (
        <button type="button" className="more" onClick={() => setLimit(limit + PAGE)}>
          Afficher {Math.min(PAGE, sorted.length - limit)} de plus ({sorted.length - limit} restantes)
        </button>
      )}
    </section>
  );
}
