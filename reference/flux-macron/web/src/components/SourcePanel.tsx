import type { SourceState, SourceStatus } from "../shared";
import { formatParis } from "../shared";

const STATE_LABEL: Record<SourceState, string> = {
  operational: "opérationnelle",
  limited: "limitée",
  unavailable: "indisponible",
  not_configured: "non configurée",
  pending: "en attente de la 1re collecte",
};
// glyphe + libellé : l'état n'est pas porté par la couleur seule
const STATE_GLYPH: Record<SourceState, string> = {
  operational: "●",
  limited: "◐",
  unavailable: "✕",
  not_configured: "○",
  pending: "…",
};

export default function SourcePanel({ sources, notes }: { sources: SourceStatus[]; notes: string[] }) {
  return (
    <details className="panel sources-panel">
      <summary>
        <span className="mono">État des sources</span>
        <span className="source-chips">
          {sources.map((s) => (
            <span key={s.id} className={`schip schip-${s.state}`}>
              <span aria-hidden="true">{STATE_GLYPH[s.state]}</span> {s.label} · {STATE_LABEL[s.state]}
            </span>
          ))}
        </span>
      </summary>
      <div className="source-detail">
        <table>
          <thead>
            <tr><th>Source</th><th>État</th><th>Dernière collecte réussie</th><th>Détail</th></tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td>{STATE_GLYPH[s.state]} {STATE_LABEL[s.state]}</td>
                <td>{s.lastSuccessAt ? `${formatParis(s.lastSuccessAt)}${s.itemsLastRun !== undefined ? ` · ${s.itemsLastRun} élément(s)` : ""}` : "—"}</td>
                <td className="small">
                  {s.lastError && <div>Erreur : {s.lastError}</div>}
                  {s.note && <div>{s.note}</div>}
                  {s.state === "not_configured" && s.setupHint && <div className="mute">{s.setupHint}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="sub-h">Limites de couverture</h3>
        <ul className="small">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </details>
  );
}
