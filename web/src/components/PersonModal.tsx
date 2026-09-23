import { useEffect, useRef, useState } from "react";
import { shareUrlForEntry } from "../hooks/useUrl";
import { initials } from "../hooks/usePolitiscope";
import { familleOf, figureKeyOf, type Entry } from "../types";

interface Props {
  figureId: string | null;
  entries: Entry[];
  /** Citation à faire défiler à l'ouverture — vient d'un lien /c/:entryId. */
  scrollToEntryId: number | null;
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour les contextes sans Clipboard API (rare, mais moins cassant
    // qu'un bouton qui ne fait rien).
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

interface CitationCardProps {
  entry: Entry;
  latest: boolean;
  style: React.CSSProperties;
  highlighted: boolean;
  copied: boolean;
  onCopy: () => void;
  cardRef: (el: HTMLDivElement | null) => void;
}

function CitationCard({ entry, latest, style, highlighted, copied, onCopy, cardRef }: CitationCardProps) {
  return (
    <div
      ref={cardRef}
      className={
        "citation-block" +
        (latest ? " citation-block-latest" : "") +
        (highlighted ? " citation-block-highlight" : "")
      }
    >
      <p className="citation-theme">{entry.theme}</p>
      <blockquote className="quote" style={style}>
        « {entry.citation} »
      </blockquote>
      <div className="modal-footer">
        <span>{entry.date_texte}</span>
        <a href={entry.source} target="_blank" rel="noopener noreferrer">
          Source : {domain(entry.source)} ↗
        </a>
        <button type="button" className="copy-link-btn" onClick={onCopy}>
          {copied ? "Lien copié ✓" : "Copier le lien"}
        </button>
      </div>
    </div>
  );
}

export function PersonModal({ figureId, entries, scrollToEntryId, onClose, onViewInTable }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRefs = useRef(new Map<number, HTMLElement>());
  const [copiedId, setCopiedId] = useState<number | null>(null);

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

  // Lien /c/:entryId : fait défiler jusqu'à la citation visée à l'ouverture.
  useEffect(() => {
    if (!figureId || scrollToEntryId == null) return;
    const el = cardRefs.current.get(scrollToEntryId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [figureId, scrollToEntryId]);

  const handleCopy = (entryId: number) => {
    void copyToClipboard(shareUrlForEntry(entryId)).then((ok) => {
      if (!ok) return;
      setCopiedId(entryId);
      setTimeout(() => setCopiedId((id) => (id === entryId ? null : id)), 1800);
    });
  };

  if (!figureId) return null;

  const personEntries = entries
    .filter((e) => figureKeyOf(e) === figureId)
    .sort((a, b) => ts(b) - ts(a) || b.id - a.id);
  if (personEntries.length === 0) return null;

  const [latest, ...earlier] = personEntries;
  const fam = familleOf(latest.famille);
  const style = { "--fam-color": fam.color } as React.CSSProperties;

  const card = (entry: Entry, isLatest: boolean) => (
    <CitationCard
      key={entry.id}
      entry={entry}
      latest={isLatest}
      style={style}
      highlighted={scrollToEntryId === entry.id}
      copied={copiedId === entry.id}
      onCopy={() => handleCopy(entry.id)}
      cardRef={(el) => {
        if (el) cardRefs.current.set(entry.id, el);
        else cardRefs.current.delete(entry.id);
      }}
    />
  );

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
        {card(latest, true)}

        {earlier.length > 0 && (
          <>
            <p className="modal-section-label">Citations précédentes</p>
            <ul className="citation-timeline">
              {earlier.map((e) => (
                <li key={e.id}>{card(e, false)}</li>
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
