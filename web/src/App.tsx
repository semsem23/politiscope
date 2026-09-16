import { useCallback, useMemo, useState } from "react";
import { CitationsTable } from "./components/CitationsTable";
import { FilterBar, type View } from "./components/FilterBar";
import { PersonGrid } from "./components/PersonGrid";
import { PersonModal } from "./components/PersonModal";
import { TopicGraph } from "./components/TopicGraph";
import {
  useFilteredEntries,
  useFilteredFigures,
  usePolitiscopeData,
  type Filters,
} from "./hooks/usePolitiscope";
import { FAMILLES, figureKeyOf, type Entry, type FamilleId } from "./types";

const CONTEXTE =
  "Les élections municipales se sont achevées en mars 2026 ; la France entre désormais en " +
  "pré-campagne pour la présidentielle de 2027. Le gouvernement de Sébastien Lecornu, formé " +
  "fin février après avoir fait passer le budget 2026 au 49.3, affronte une contestation " +
  "sociale naissante sur le pouvoir d'achat pendant que plusieurs figures officialisent leur " +
  "candidature à l'occasion des universités d'été de septembre.";

const emptyFilters = (): Filters => ({
  familles: Object.fromEntries(FAMILLES.map((f) => [f.id, true])) as Record<FamilleId, boolean>,
  theme: "all",
  search: "",
  personId: null,
  personSort: "recent",
});

const VIEWS: { value: View; label: string }[] = [
  { value: "personnalites", label: "Personnalités" },
  { value: "citations", label: "Citations" },
];

export default function App() {
  const { entries, topics, figures, loading, error } = usePolitiscopeData();
  const [view, setView] = useState<View>("personnalites");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [personModalId, setPersonModalId] = useState<string | null>(null);

  const filteredEntries = useFilteredEntries(entries, filters);
  const filteredFigures = useFilteredFigures(entries, figures, filters);
  const graphEntries = useMemo(
    () => (filters.theme === "all" ? entries : entries.filter((e) => e.theme === filters.theme)),
    [entries, filters.theme]
  );

  const onReset = useCallback(() => setFilters(emptyFilters()), []);
  const closeModal = useCallback(() => setPersonModalId(null), []);
  const onThemeChange = useCallback((theme: string) => {
    setFilters((f) => ({ ...f, theme: f.theme === theme ? "all" : theme }));
  }, []);
  // Depuis le graphe : ouvre directement la fiche personnalité (mode « pol »).
  const onSelectFromGraph = useCallback((e: Entry) => setPersonModalId(figureKeyOf(e)), []);
  // Depuis le tableau, sur mobile : la ligne entière ouvre la fiche.
  const onOpenPersonFromTable = useCallback((figureId: string) => setPersonModalId(figureId), []);
  // Cliquer un nom dans le tableau filtre sur cette personne, sans ouvrir la fiche.
  const onSelectPersonInTable = useCallback((figureId: string) => {
    setFilters((f) => ({ ...f, personId: figureId }));
  }, []);
  // « Voir dans le tableau » : ferme la fiche et bascule vers la vue Citations filtrée.
  const onViewInTable = useCallback((figureId: string) => {
    setPersonModalId(null);
    setView("citations");
    setFilters((f) => ({ ...f, personId: figureId }));
  }, []);

  if (error) {
    return (
      <div className="state-panel">
        <h2>Données indisponibles</h2>
        <p>
          La connexion à Supabase a échoué : <code>{error}</code>
        </p>
        <p>
          Vérifiez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> dans
          <code>.env.local</code>, puis relancez le serveur de développement.
        </p>
      </div>
    );
  }

  const citationCount = filteredFigures.reduce((n, f) => n + f.matchCount, 0);

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">Baromètre politique · Rentrée 2026</p>
        <h1 className="title">Politiscope</h1>
        <p className="dek">{CONTEXTE}</p>
        <p className="methodo">
          <strong>Méthode.</strong> Citations publiques réellement prononcées — discours,
          déclarations à la presse, publications sur X — collectées par un pipeline d'ingestion et
          relues à la main. Chaque fiche renvoie vers sa source d'origine et résume{" "}
          <em>ce que la citation avance</em>, non un jugement sur son auteur.
        </p>
      </header>

      <div className="view-toggle graph-toggle" role="tablist" aria-label="Vue">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            className="toggle-btn"
            aria-selected={view === v.value}
            onClick={() => setView(v.value)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <FilterBar
        entries={entries}
        figures={figures}
        view={view}
        filters={filters}
        setFilters={setFilters}
        onReset={onReset}
      />

      <div className="field-meta">
        {view === "personnalites" ? (
          <span>
            {loading
              ? "chargement…"
              : `${filteredFigures.length} personnalité${filteredFigures.length > 1 ? "s" : ""} · ` +
                `${citationCount} citation${citationCount > 1 ? "s" : ""}`}
          </span>
        ) : (
          <span>
            {loading
              ? "chargement…"
              : `${filteredEntries.length} citation${filteredEntries.length > 1 ? "s" : ""}` +
                (filters.theme !== "all" ? ` · ${filters.theme}` : "")}
          </span>
        )}
        <span>
          {entries.length} citation{entries.length > 1 ? "s" : ""} ·{" "}
          {new Set(entries.map(figureKeyOf)).size} personnalités
        </span>
      </div>

      {loading ? (
        <section className="person-grid" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="skeleton" style={{ width: 96, height: 96 }} />
          ))}
        </section>
      ) : view === "personnalites" ? (
        <PersonGrid figures={filteredFigures} onSelect={setPersonModalId} />
      ) : (
        <CitationsTable
          entries={filteredEntries}
          onSelectPerson={onSelectPersonInTable}
          onOpenPerson={onOpenPersonFromTable}
        />
      )}

      {!loading && entries.length > 0 && (
        <TopicGraph
          entries={graphEntries}
          topics={topics}
          onSelect={onSelectFromGraph}
          theme={filters.theme}
          onThemeChange={onThemeChange}
        />
      )}

      <footer className="page-footer">
        <div className="legend-row" aria-label="Légende des familles politiques">
          {FAMILLES.map((f) => (
            <span className="legend-item" key={f.id}>
              <span className="dot" style={{ background: f.color }} />
              {f.label}
            </span>
          ))}
        </div>
        <p className="footer-note">
          Les familles politiques regroupent des partis distincts à des fins de lisibilité visuelle
          et ne reflètent pas les couleurs officielles des partis. Sélection non exhaustive et non
          partisane ; toutes les citations sont sourcées et vérifiables via le lien fourni sur
          chaque fiche.
        </p>
      </footer>

      <PersonModal
        figureId={personModalId}
        entries={entries}
        onClose={closeModal}
        onViewInTable={onViewInTable}
      />
    </div>
  );
}
