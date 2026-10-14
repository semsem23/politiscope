import type { SourceKind, TimeWindow } from "../shared";
import { SOURCE_LABEL, WINDOW_LABEL } from "../shared";
import type { Filters } from "../lib/filters";
import type { Personality } from "../shared";
import { SourceBadge } from "./bits";
import PersonalityFilter from "./PersonalityFilter";

const SOURCES: SourceKind[] = ["x", "google_news"];

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  windowKey: TimeWindow;
  setWindowKey: (w: TimeWindow) => void;
  onRefresh: () => void;
  busy: boolean;
  isDemo: boolean;
  personalities: Personality[];
  personalityCounts: Map<string, number>;
}

/** Ligne « Sources : » + sélecteur de fenêtre. Les pastilles filtrent l'affichage, elles n'activent aucune collecte. */
export default function SourceBar({ filters: f, setFilters, windowKey, setWindowKey, onRefresh, busy, isDemo, personalities, personalityCounts }: Props) {
  const toggle = (s: SourceKind) => {
    const n = new Set(f.sources);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setFilters({ ...f, sources: n });
  };
  return (
    <div className="sourcebar" role="region" aria-label="Sources et période">
      <div className="pills">
        <span className="pills-label">Sources :</span>
        {SOURCES.map((s) => (
          <button key={s} type="button" className="pill" aria-pressed={f.sources.has(s)} onClick={() => toggle(s)}>
            <SourceBadge kind={s} />
            {SOURCE_LABEL[s]}
          </button>
        ))}
        <button type="button" className="pill pill-all" aria-pressed={f.sources.size === 0} onClick={() => setFilters({ ...f, sources: new Set() })}>
          Toutes
        </button>
        <span className="pills-sep" aria-hidden="true" />
        <PersonalityFilter personalities={personalities} counts={personalityCounts} filters={f} setFilters={setFilters} />
      </div>
      <div className="head-controls">
        <div className="seg" role="group" aria-label="Période">
          {(["24h", "7d", "30d"] as TimeWindow[]).map((k) => (
            <button key={k} type="button" aria-pressed={windowKey === k} onClick={() => setWindowKey(k)}>
              {WINDOW_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onRefresh} disabled={busy} aria-label={isDemo ? "Actualiser (aucune collecte en démonstration)" : "Relire les données (la collecte tourne une fois par jour)"} title={isDemo ? "Actualiser (démo : aucune collecte)" : "Relire les données (la collecte tourne une fois par jour)"}>
          <span className={busy ? "spin" : ""} aria-hidden="true">↻</span>
        </button>
      </div>
    </div>
  );
}
