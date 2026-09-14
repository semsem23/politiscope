import { initials } from "../hooks/usePolitiscope";
import { familleOf, sentimentOf, type Entry } from "../types";

interface Props {
  entries: Entry[];
  onSelect: (e: Entry) => void;
}

export function BubbleField({ entries, onSelect }: Props) {
  if (entries.length === 0) {
    return (
      <section className="bubble-field">
        <div className="empty-state">Aucune personnalité ne correspond à ces filtres.</div>
      </section>
    );
  }

  return (
    <section className="bubble-field" aria-label="Personnalités politiques">
      {entries.map((d) => {
        const sent = sentimentOf(d.sentiment);
        const fam = familleOf(d.famille);
        return (
          <button
            key={d.id}
            type="button"
            className="bubble"
            title={`${d.nom} — ${sent.label} — ${d.sujet}`}
            onClick={() => onSelect(d)}
          >
            <span
              className="orb"
              style={
                { "--sent-color": sent.color, "--sent-bg": sent.bg } as React.CSSProperties
              }
            >
              <span className="initials">{initials(d.nom)}</span>
              <span
                className="fam-dot"
                style={{ "--fam-color": fam.color } as React.CSSProperties}
              />
            </span>
            <span className="name">{d.nom}</span>
            <span className="party">{fam.label}</span>
          </button>
        );
      })}
    </section>
  );
}
