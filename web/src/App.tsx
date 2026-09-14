import { useCallback, useMemo, useState } from "react";
import { BubbleField } from "./components/BubbleField";
import { DetailModal } from "./components/DetailModal";
import { FilterBar } from "./components/FilterBar";
import { TopicGraph } from "./components/TopicGraph";
import { useFiltered, usePolitiscopeData, type Filters } from "./hooks/usePolitiscope";
import { FAMILLES, SENTIMENTS, type Entry, type FamilleId, type SentimentId } from "./types";

const CONTEXTE =
  "Les élections municipales se sont achevées en mars 2026 ; la France entre désormais en " +
  "pré-campagne pour la présidentielle de 2027. Le gouvernement de Sébastien Lecornu, formé " +
  "fin février après avoir fait passer le budget 2026 au 49.3, affronte une contestation " +
  "sociale naissante sur le pouvoir d'achat pendant que plusieurs figures officialisent leur " +
  "candidature à l'occasion des universités d'été de septembre.";

const emptyFilters = (): Filters => ({
  familles: Object.fromEntries(FAMILLES.map((f) => [f.id, true])) as Record<FamilleId, boolean>,
  sentiments: Object.fromEntries(SENTIMENTS.map((s) => [s.id, true])) as Record<SentimentId, boolean>,
  theme: "all",
  sort: "theme",
  search: "",
});

export default function App() {
  const { entries, topics, loading, error } = usePolitiscopeData();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<Entry | null>(null);

  const filtered = useFiltered(entries, filters);
  const onReset = useCallback(() => setFilters(emptyFilters()), []);
  const closeModal = useCallback(() => setSelected(null), []);

  const stats = useMemo(
    () =>
      SENTIMENTS.map((s) => {
        const n = entries.filter((e) => e.sentiment === s.id).length;
        return { ...s, n, pct: entries.length ? Math.round((100 * n) / entries.length) : 0 };
      }),
    [entries]
  );

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

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">Baromètre politique · Rentrée 2026</p>
        <h1 className="title">Politiscope</h1>
        <p className="dek">{CONTEXTE}</p>
        <p className="methodo">
          <strong>Méthode.</strong> Citations publiques réellement prononcées — discours,
          déclarations à la presse, publications sur X — collectées par un pipeline d'ingestion et
          relues à la main. Chaque fiche renvoie vers sa source d'origine. Le sentiment évalue le{" "}
          <em>ton</em> de la déclaration, non un jugement sur son auteur.
        </p>
      </header>

      <section className="stats" aria-label="Répartition du sentiment">
        {stats.map((s) => (
          <div className="stat-tile" key={s.id}>
            <div className="label">
              <span className="stat-dot" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="value" style={{ color: s.color }}>
              {loading ? "—" : `${s.pct} %`}
            </div>
            <div className="sub">
              {loading ? "chargement…" : `${s.n} déclarations sur ${entries.length}`}
            </div>
          </div>
        ))}
      </section>

      <FilterBar
        entries={entries}
        filters={filters}
        setFilters={setFilters}
        onReset={onReset}
      />

      <div className="field-meta">
        <span>
          {loading
            ? "chargement…"
            : `${filtered.length} résultat${filtered.length > 1 ? "s" : ""}` +
              (filters.theme !== "all" ? ` · ${filters.theme}` : "")}
        </span>
        {/* Une personne peut porter plusieurs citations : compter les bulles
            comme des « personnalités » deviendrait faux dès la 2e publication. */}
        <span>
          {entries.length} citation{entries.length > 1 ? "s" : ""} ·{" "}
          {new Set(entries.map((e) => e.nom)).size} personnalités
        </span>
      </div>

      {loading ? (
        <section className="bubble-field" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="skeleton" style={{ width: 96, height: 96 }} />
          ))}
        </section>
      ) : (
        <BubbleField entries={filtered} onSelect={setSelected} />
      )}

      {!loading && entries.length > 0 && (
        <TopicGraph entries={entries} topics={topics} onSelect={setSelected} />
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

      <DetailModal entry={selected} onClose={closeModal} />
    </div>
  );
}
