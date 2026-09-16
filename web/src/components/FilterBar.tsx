import { distinctFigureCount, type Filters } from "../hooks/usePolitiscope";
import { FAMILLES, type Entry, type Figure, type PersonSortKey } from "../types";

export type View = "personnalites" | "citations";

interface Props {
  entries: Entry[];
  figures: Figure[];
  view: View;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onReset: () => void;
}

const PERSON_SORTS: { value: PersonSortKey; label: string }[] = [
  { value: "recent", label: "Trier — citation la plus récente" },
  { value: "count", label: "Trier — nombre de citations" },
  { value: "alpha", label: "Trier — ordre alphabétique" },
];

export function FilterBar({ entries, figures, view, filters, setFilters, onReset }: Props) {
  const themes = [...new Set(entries.map((e) => e.theme))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  const sortedFigures = [...figures].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return (
    <div className="filterbar">
      <div className="filter-row">
        <span className="filter-group-label">Famille politique</span>
        {FAMILLES.map((f) => {
          const count =
            view === "personnalites"
              ? distinctFigureCount(entries, f.id)
              : entries.filter((e) => e.famille === f.id).length;
          const active = filters.familles[f.id];
          return (
            <button
              key={f.id}
              type="button"
              className="chip"
              data-active={active}
              aria-pressed={active}
              onClick={() =>
                setFilters({
                  ...filters,
                  familles: { ...filters.familles, [f.id]: !active },
                })
              }
            >
              <span className="dot" style={{ background: f.color }} />
              {f.label} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="filter-row">
        <span className="filter-group-label">Thème</span>
        <select
          className="control"
          value={filters.theme}
          aria-label="Filtrer par thème"
          onChange={(e) => setFilters({ ...filters, theme: e.target.value })}
        >
          <option value="all">Tous les thèmes</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {view === "citations" && (
          <select
            className="control"
            value={filters.personId ?? "all"}
            aria-label="Filtrer par personnalité"
            onChange={(e) =>
              setFilters({ ...filters, personId: e.target.value === "all" ? null : e.target.value })
            }
          >
            <option value="all">Toutes les personnalités</option>
            {sortedFigures.map((f) => (
              <option key={f.figure_id} value={f.figure_id}>
                {f.nom}
              </option>
            ))}
          </select>
        )}

        {view === "personnalites" && (
          <select
            className="control"
            value={filters.personSort}
            aria-label="Trier"
            onChange={(e) => setFilters({ ...filters, personSort: e.target.value as PersonSortKey })}
          >
            {PERSON_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}

        <input
          className="control"
          type="search"
          placeholder="Rechercher un nom, un mot…"
          aria-label="Rechercher"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        <span className="spacer" />
        <button className="reset-btn" onClick={onReset}>
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
