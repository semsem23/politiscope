import type { FigureCard } from "../hooks/usePolitiscope";
import { initials } from "../hooks/usePolitiscope";
import { familleOf } from "../types";

interface Props {
  figures: FigureCard[];
  onSelect: (figureId: string) => void;
}

/** « …80 caractères environ, terminée par "…" » — coupe au dernier espace, jamais en plein mot. */
function preview(text: string, max = 80): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export function PersonGrid({ figures, onSelect }: Props) {
  if (figures.length === 0) {
    return (
      <section className="person-grid">
        <div className="empty-state">
          Aucune personnalité ne correspond à ces filtres. Élargissez les filtres ou cliquez sur
          Réinitialiser.
        </div>
      </section>
    );
  }

  return (
    <section className="person-grid" aria-label="Personnalités politiques">
      {figures.map((fig) => {
        const fam = familleOf(fig.famille);
        return (
          <button
            key={fig.figure_id}
            type="button"
            className="person-card"
            onClick={() => onSelect(fig.figure_id)}
          >
            <span className="orb" style={{ "--fam-color": fam.color } as React.CSSProperties}>
              <span className="initials">{initials(fig.nom)}</span>
              <span className="count-badge" aria-hidden="true">
                {fig.matchCount}
              </span>
              <span className="sr-only">
                {fig.matchCount} citation{fig.matchCount > 1 ? "s" : ""}
              </span>
            </span>
            <span className="name">{fig.nom}</span>
            <span className="party">
              <span className="dot" style={{ background: fam.color }} />
              {fam.label}
            </span>
            <span className="card-preview">
              <span className="preview-theme">{fig.dernier_theme}</span>
              <span className="preview-quote">« {preview(fig.derniere_citation)} »</span>
              <span className="preview-date">{fig.derniere_date_texte}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
