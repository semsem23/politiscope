import { useEffect, useRef } from "react";
import { initials } from "../hooks/usePolitiscope";
import { familleOf, type Entry } from "../types";

interface Props {
  entry: Entry | null;
  onClose: () => void;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function DetailModal({ entry, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Échap pour fermer, focus sur le bouton, et blocage du défilement de fond.
  useEffect(() => {
    if (!entry) return;
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
  }, [entry, onClose]);

  if (!entry) return null;

  const fam = familleOf(entry.famille);
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
              {initials(entry.nom)}
            </span>
            <div>
              <div className="modal-name" id="modal-name">
                {entry.nom}
              </div>
              <div className="modal-party">
                <span className="dot" style={{ background: fam.color }} />
                {entry.parti}
              </div>
            </div>
          </div>
          <button ref={closeRef} className="modal-close" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="modal-section-label">Sujet principal</p>
        <p className="modal-topic">{entry.sujet}</p>

        <p className="modal-section-label">Citation</p>
        <blockquote className="quote" style={style}>
          « {entry.citation} »
        </blockquote>

        <div className="modal-footer">
          <span>{entry.date_texte}</span>
          <a href={entry.source} target="_blank" rel="noopener noreferrer">
            Source : {domain(entry.source)} ↗
          </a>
        </div>
      </div>
    </div>
  );
}
