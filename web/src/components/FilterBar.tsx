import type { Filters } from "../hooks/usePolitiscope";
import { FAMILLES, SENTIMENTS, type Entry, type SortKey } from "../types";

interface Props {
  entries: Entry[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  onReset: () => void;
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: "theme", label: "Trier — sujet le plus discuté" },
  { value: "date-desc", label: "Trier — plus récent d'abord" },
  { value: "date-asc", label: "Trier — plus ancien d'abord" },
  { value: "alpha", label: "Trier — ordre alphabétique" },
  { value: "parti", label: "Trier — par parti" },
  { value: "sentiment", label: "Trier — par sentiment" },
];

export function FilterBar({ entries, filters, setFilters, onReset }: Props) {
  const themes = [...new Set(entries.map((e) => e.theme))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  return (
    <div className="filterbar">
      <div className="filter-row">
        <span className="filter-group-label">Famille politique</span>
        {FAMILLES.map((f) => {
          const count = entries.filter((e) => e.famille === f.id).length;
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
        <span className="filter-group-label">Sentiment</span>
        {SENTIMENTS.map((s) => {
          const active = filters.sentiments[s.id];
          return (
            <button
              key={s.id}
              type="button"
              className="chip"
              data-active={active}
              aria-pressed={active}
              onClick={() =>
                setFilters({
                  ...filters,
                  sentiments: { ...filters.sentiments, [s.id]: !active },
                })
              }
            >
              <span className="dot" style={{ background: s.color }} />
              {s.label}
            </button>
          );
        })}

        <span className="filter-group-label" style={{ marginLeft: 10 }}>
          Thème
        </span>
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

        <select
          className="control"
          value={filters.sort}
          aria-label="Trier"
          onChange={(e) => setFilters({ ...filters, sort: e.target.value as SortKey })}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

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
