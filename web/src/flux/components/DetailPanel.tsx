import { useState } from "react";
import type { ActivityEvent, Article, Personality, SourceKind } from "../shared";
import { CATEGORY_LABEL, KIND_LABEL, SOURCE_LABEL, formatParis, formatRel } from "../shared";
import { catVar } from "../lib/palette";
import { DemoTag, SourceBadge, StatusBadge } from "./bits";

interface Props {
  event: ActivityEvent | null;
  articlesById: Map<string, Article>;
  eventsById: Map<string, ActivityEvent>;
  nowMs: number;
  personalities: Personality[];
  onSelectEvent: (id: string) => void;
  onClose: () => void;
}

const JOIN_LABEL: Record<string, string> = {
  seed: "premier article du groupe",
  same_original_source: "cite la même source initiale",
  similarity: "titres proches",
  manual: "rattaché manuellement",
};

/** Libellé d'affichage seulement : les seuils sont documentés dans docs/CONFIDENCE.md. */
function confidenceWord(c: number | undefined): string {
  if (c === undefined) return "non évalué";
  return c >= 0.7 ? "Élevée" : c >= 0.4 ? "Moyenne" : "Faible";
}

function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export default function DetailPanel({ event: e, articlesById, eventsById, nowMs, personalities, onSelectEvent, onClose }: Props) {
  const [showAll, setShowAll] = useState(false);
  if (!e) {
    return (
      <section className="panel detail-panel" aria-label="Détail de l'événement">
        <h2 className="panel-h">Détail de l'événement</h2>
        <p className="empty">Sélectionnez une activité dans la liste ou un nœud de la frise pour voir le résumé, le statut, l'indice de recoupement et les sources.</p>
      </section>
    );
  }

  const articles = e.articleIds.map((id) => articlesById.get(id)).filter((a): a is Article => !!a);
  const counts = new Map<SourceKind, number>();
  for (const a of articles) counts.set(a.sourceKind, (counts.get(a.sourceKind) ?? 0) + 1);
  const pct = e.confidence !== undefined ? Math.round(e.confidence * 100) : null;
  const t0 = Date.parse(e.firstPublishedAt);

  return (
    <section className="panel detail-panel" aria-label="Détail de l'événement">
      <div className="detail-head">
        <h2 className="panel-h">Détail de l'événement</h2>
        <button type="button" className="close" onClick={onClose} aria-label="Fermer le détail">×</button>
      </div>

      <div className="cat-label" style={{ ["--c" as string]: catVar(e.category) }}>
        <i className="fdot" aria-hidden="true" />{CATEGORY_LABEL[e.category]}
        {e.kind && e.kind !== "other" && <span className="mute"> · {KIND_LABEL[e.kind]}</span>}
        {e.isDemo && <DemoTag />}
      </div>
      <h3 className="detail-title">{e.title}</h3>
      <p className="detail-desc">{e.summary}</p>

      <dl className="facts">
        <div>
          <dt>Heure</dt>
          <dd>
            {formatRel(t0, nowMs, true)}
            <span className="mute small"> · publication du 1er article{e.eventTime ? "" : " (heure de l'événement non déterminée)"}</span>
            {e.eventTime && <div>Événement : {formatParis(e.eventTime, "full")}</div>}
          </dd>
        </div>
        <div>
          <dt>Confiance</dt>
          <dd>
            <strong className={`conf-word conf-${pct === null ? "none" : pct >= 70 ? "high" : pct >= 40 ? "mid" : "low"}`}>{confidenceWord(e.confidence)}</strong>
            {pct !== null && <span className="mute"> · indice {pct} %</span>}
            {pct !== null && <div className="meter" role="img" aria-label={`${pct} pour cent`}><span style={{ width: `${pct}%` }} /></div>}
            <div className="small mute">{e.confidenceExplanation}</div>
          </dd>
        </div>
        <div>
          <dt>Statut</dt>
          <dd>
            <StatusBadge status={e.status} />
            <div className="small mute">
              {e.distinctArticleCount} article{e.distinctArticleCount > 1 ? "s" : ""} distinct{e.distinctArticleCount > 1 ? "s" : ""} · {e.independentSourceCount} source{e.independentSourceCount > 1 ? "s" : ""} indépendante{e.independentSourceCount > 1 ? "s" : ""}
              {e.manuallyEdited ? " · corrigé manuellement" : ""}
            </div>
          </dd>
        </div>
        {(e.personalityIds ?? []).length > 0 && (
          <div>
            <dt>Personnalités citées</dt>
            <dd>
              <ul className="src-counts">
                {(e.personalityIds ?? []).map((id) => {
                  const pr = personalities.find((x) => x.id === id);
                  return <li key={id}>{pr?.name ?? id}{pr?.role && <span className="mute small"> · {pr.role}</span>}</li>;
                })}
              </ul>
              <div className="small mute">Citées dans un titre ou un extrait : pas une preuve de participation.</div>
            </dd>
          </div>
        )}
        <div>
          <dt>Sources</dt>
          <dd>
            <ul className="src-counts">
              {[...counts].map(([k, n]) => (
                <li key={k}><SourceBadge kind={k} />{SOURCE_LABEL[k]}<span className="mute"> · {n} article{n > 1 ? "s" : ""}</span></li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <button type="button" className="btn-wide" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
        Voir les sources ({articles.length}) <span aria-hidden="true">{showAll ? "↑" : "↗"}</span>
      </button>

      {showAll && (
        <ul className="sources">
          {articles.map((a) => {
            const href = safeHref(a.url);
            const prov = e.provenance.find((p) => p.articleId === a.id);
            return (
              <li key={a.id} className="src">
                <span className="pub"><SourceBadge kind={a.sourceKind} />{a.publisherName}</span>
                <span className="src-title">{a.title}</span>
                <span className="small mute">
                  Publié {formatParis(a.publishedAt)}{a.isDemo ? " · non collecté (démo)" : ` · collecté ${formatParis(a.collectedAt)}`}
                </span>
                <span className="small mute">
                  {a.nearDuplicateOf ? "Quasi-doublon : non compté comme article distinct. " : ""}
                  {a.independenceKey?.startsWith("orig:") || a.independenceKey?.startsWith("wire:") || a.independenceKey?.startsWith("text:") ? "Reprise : comptée avec sa source initiale. " : ""}
                  {prov ? `Rattachement : ${JOIN_LABEL[prov.joinedBy] ?? prov.joinedBy}${prov.score ? ` (similarité ${Math.round(prov.score * 100)} %)` : ""}.` : ""}
                </span>
                {href ? (
                  <a className="open" href={href} target="_blank" rel="noopener noreferrer">Ouvrir la source originale ↗</a>
                ) : (
                  <span className="small mute">URL non valide, lien désactivé</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {e.suggestedRelations.length > 0 && (
        <>
          <h4 className="pop-h">Rapprochements suggérés — à vérifier</h4>
          <p className="small mute">Titres proches : suggestion automatique (pointillés bleus), pas un fait établi.</p>
          <ul className="rels">
            {e.suggestedRelations.map((id) => {
              const o = eventsById.get(id);
              return o ? (
                <li key={id}><button type="button" className="linklike" onClick={() => onSelectEvent(id)}><span aria-hidden="true">┈ </span>{o.title}</button></li>
              ) : null;
            })}
          </ul>
        </>
      )}
    </section>
  );
}
