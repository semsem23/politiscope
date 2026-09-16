import { useMemo, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { familleOf, figureKeyOf, type Entry } from "../types";

interface Props {
  entries: Entry[];
  onSelectPerson: (figureId: string) => void;
  onOpenPerson: (figureId: string) => void;
}

type DateDir = "desc" | "asc";

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

export function CitationsTable({ entries, onSelectPerson, onOpenPerson }: Props) {
  const [dateDir, setDateDir] = useState<DateDir>("desc");
  // En dessous de 640px, la ligne entière ouvre la fiche personnalité — au
  // clavier, le nom filtre toujours, quelle que soit la largeur (voir
  // le bouton nom ci-dessous, qui stoppe la propagation).
  const isMobile = useMediaQuery("(max-width: 639px)");

  const sorted = useMemo(() => {
    const dir = dateDir === "desc" ? -1 : 1;
    return [...entries].sort((a, b) => (ts(a) - ts(b)) * dir || a.nom.localeCompare(b.nom, "fr"));
  }, [entries, dateDir]);

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        Aucune citation ne correspond à ces filtres. Élargissez les filtres ou cliquez sur
        Réinitialiser.
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="citations-table">
        <thead>
          <tr>
            <th aria-sort={dateDir === "desc" ? "descending" : "ascending"}>
              <button
                type="button"
                className="sort-btn"
                onClick={() => setDateDir((d) => (d === "desc" ? "asc" : "desc"))}
              >
                Date {dateDir === "desc" ? "↓" : "↑"}
              </button>
            </th>
            <th>Personnalité</th>
            <th>Famille</th>
            <th>Thème</th>
            <th>Citation</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const fam = familleOf(e.famille);
            const figureId = figureKeyOf(e);
            return (
              <tr
                key={e.id}
                className="citation-row"
                onClick={isMobile ? () => onOpenPerson(figureId) : undefined}
              >
                <td data-label="Date">{e.date_texte}</td>
                <td data-label="Personnalité">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={(evt) => {
                      evt.stopPropagation();
                      onSelectPerson(figureId);
                    }}
                  >
                    {e.nom}
                  </button>
                </td>
                <td data-label="Famille">
                  <span className="dot" style={{ background: fam.color }} />
                  {fam.label}
                </td>
                <td data-label="Thème">{e.theme}</td>
                <td data-label="Citation" className="citation-cell">
                  « {e.citation} »
                </td>
                <td data-label="Source">
                  <a
                    href={e.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(evt) => evt.stopPropagation()}
                  >
                    {domain(e.source)} ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
