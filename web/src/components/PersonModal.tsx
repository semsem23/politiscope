import { useEffect, useRef } from "react";
import { initials } from "../hooks/usePolitiscope";
import { familleOf, figureKeyOf, type Entry } from "../types";

interface Props {
  figureId: string | null;
  entries: Entry[];
  onClose: () => void;
  onViewInTable: (figureId: string) => void;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ts(e: Entry): number {
  return e.date_tri ? Date.parse(e.date_tri) : 0;
}

export function PersonModal({ figureId, entries, onClose, onViewInTable }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Échap pour fermer, focus sur le bouton, et blocage du défilement de fond.
  useEffect(() => {
    if (!figureId) return;
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
  }, [figureId, onClose]);

  if (!figureId) return null;

  const personEntries = entries
    .filter((e) => figureKeyOf(e) === figureId)
    .sort((a, b) => ts(b) - ts(a) || b.id - a.id);
  if (personEntries.length === 0) return null;

  const [latest, ...earlier] = personEntries;
  const fam = familleOf(latest.famille);
  const style = { "--fam-color": fam.color } as React.CSSProperties;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-name"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-top">
          <div className="modal-id">
            <span className="modal-orb" style={style}>
              {initials(latest.nom)}
            </span>
            <div>
              <div className="modal-name" id="modal-name">
                {latest.nom}
              </div>
              <div className="modal-party">
                <span className="dot" style={{ background: fam.color }} />
                {latest.parti}
              </div>
              <div className="modal-count">
                {personEntries.length} citation{personEntries.length > 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <button ref={closeRef} className="modal-close" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="modal-section-label">Dernière citation</p>
        <div className="citation-block citation-block-latest">
          <p className="citation-theme">{latest.theme}</p>
          <blockquote className="quote" style={style}>
            « {latest.citation} »
          </blockquote>
          <div className="modal-footer">
            <span>{latest.date_texte}</span>
            <a href={latest.source} target="_blank" rel="noopener noreferrer">
              Source : {domain(latest.source)} ↗
            </a>
          </div>
        </div>

        {earlier.length > 0 && (
          <>
            <p className="modal-section-label">Citations précédentes</p>
            <ul className="citation-timeline">
              {earlier.map((e) => (
                <li key={e.id} className="citation-block">
                  <p className="citation-theme">{e.theme}</p>
                  <blockquote className="quote" style={style}>
                    « {e.citation} »
                  </blockquote>
                  <div className="modal-footer">
                    <span>{e.date_texte}</span>
                    <a href={e.source} target="_blank" rel="noopener noreferrer">
                      Source : {domain(e.source)} ↗
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <button
          type="button"
          className="view-in-table-btn"
          onClick={() => onViewInTable(figureId)}
        >
          Voir dans le tableau
        </button>
      </div>
    </div>
  );
}
