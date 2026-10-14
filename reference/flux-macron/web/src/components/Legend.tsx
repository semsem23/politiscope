import { STATUS_LABEL } from "../shared";
import type { SourceKind, VerificationStatus } from "../shared";
import { SOURCE_LABEL } from "../shared";
import { STATUS_GLYPH, srcVar } from "../lib/palette";
import { SourceBadge } from "./bits";

const STATUSES: VerificationStatus[] = ["cross_checked", "single_source", "needs_review", "scheduled", "disputed"];
const SOURCES: SourceKind[] = ["x", "google_news"];

export default function Legend({ isDemo }: { isDemo: boolean }) {
  return (
    <footer className="legend" aria-label="Légende">
      <ul>
        <li className="legend-h">Légende</li>
        {SOURCES.map((s) => <li key={s}><SourceBadge kind={s} />{SOURCE_LABEL[s]}</li>)}
        <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" className="edge-confirmed" /></svg>Lien confirmé</li>
        <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" className="edge-suggested edge-hot" /></svg>Lien suggéré · à vérifier</li>
        <li>
          <svg width="40" height="12" aria-hidden="true">{SOURCES.map((s, i) => <circle key={s} cx={5 + i * 10} cy={6} r={3.2} fill={srcVar(s)} />)}</svg>
          Points : un point par article distinct, coloré par source
        </li>
        <li>
          <svg width="20" height="14" aria-hidden="true"><circle cx="10" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" /></svg>
          Annoncé
        </li>
      </ul>
      <ul>
        {STATUSES.map((s) => <li key={s}><span className="glyph" aria-hidden="true">{STATUS_GLYPH[s]}</span>{STATUS_LABEL[s]}</li>)}
        <li className="legend-note">
          <span className="notice-pill">
            {isDemo
              ? "Données de démonstration fictives (DEMO) — aucune collecte en temps réel."
              : "Les liens suggérés sont des rapprochements automatiques, pas des faits établis."}
          </span>
        </li>
      </ul>
    </footer>
  );
}
