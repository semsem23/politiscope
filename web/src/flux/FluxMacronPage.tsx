import { useEffect, useMemo, useState } from "react";
import type { ActivityEvent, Article, TimeWindow } from "./shared";
import { countByPersonality, formatParis } from "./shared";
import { loadState } from "./data";
import type { Loaded } from "./data";
import { formatLastCollect } from "./live";
import { applyFilters, emptyFilters, hasActiveFilters } from "./lib/filters";
import type { Filters } from "./lib/filters";
import DensityChart from "./components/DensityChart";
import DetailPanel from "./components/DetailPanel";
import EventList from "./components/EventList";
import FilterMenu from "./components/FilterMenu";
import Legend from "./components/Legend";
import SourceBar from "./components/SourceBar";
import SourcePanel from "./components/SourcePanel";
import Timeline from "./components/Timeline";
import "./flux.css";

const PERIOD_LABEL: Record<TimeWindow, string> = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours" };
const TITLE = "Flux — Politiscope";

/**
 * Page /flux : activités publiques d'Emmanuel Macron sur une fenêtre glissante, d'après les articles et
 * publications réellement collectés (X, Google Actualités). Sans donnée : état vide honnête, jamais de
 * données inventées. La démonstration (fictive, étiquetée DEMO) n'existe que sur demande : /flux?demo=1.
 */
export default function FluxMacronPage() {
  const [windowKey, setWindowKey] = useState<TimeWindow>("24h");
  const [forceDemo, setForceDemo] = useState(() => new URLSearchParams(location.search).has("demo"));
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<{ key: string; loaded: Loaded | null; error: string | null } | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [showSuggested, setShowSuggested] = useState(true);

  useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.appendChild(robots);
    return () => {
      document.title = previous;
      robots.remove();
    };
  }, []);

  // Une demande = fenêtre + démo + relecture. L'état « chargement » se déduit de la demande en cours
  // (aucun setState synchrone dans l'effet) ; le résultat précédent reste affiché jusqu'à l'arrivée du suivant.
  const requestKey = `${windowKey}|${forceDemo}|${tick}`;
  useEffect(() => {
    let cancelled = false;
    loadState(windowKey, forceDemo).then(
      (loaded) => !cancelled && setResult({ key: requestKey, loaded, error: null }),
      (e: unknown) => !cancelled && setResult({ key: requestKey, loaded: null, error: e instanceof Error ? e.message : "erreur inconnue" }),
    );
    return () => {
      cancelled = true;
    };
  }, [windowKey, forceDemo, requestKey]);
  const loading = result?.key !== requestKey;
  const loaded = result?.loaded ?? null;
  const error = result && !loading ? result.error : null;

  const changeWindow = (key: TimeWindow) => {
    setWindowKey(key);
    setZoom(null);
    setSelectedEventId(null);
  };

  const state = loaded?.state ?? null;
  const startMs = state ? Date.parse(state.window.start) : 0;
  const endMs = state ? Date.parse(state.window.end) : 1;

  const eventsById = useMemo(() => new Map<string, ActivityEvent>((state?.events ?? []).map((e) => [e.id, e])), [state]);
  const articlesById = useMemo(() => new Map<string, Article>((state?.articles ?? []).map((a) => [a.id, a])), [state]);
  const filtered = useMemo(() => (state ? applyFilters(state, filters) : { events: [], articles: [] }), [state, filters]);
  const personalities = state?.personalities ?? [];
  const personalityCounts = useMemo(() => countByPersonality(state?.events ?? []), [state]);
  const selectedEvent = selectedEventId ? (eventsById.get(selectedEventId) ?? null) : null;

  const reveal = (ev: ActivityEvent | undefined) => {
    if (!ev || !zoom) return;
    const t = Date.parse(ev.firstPublishedAt);
    if (t >= zoom[0] && t <= zoom[1]) return;
    const half = (zoom[1] - zoom[0]) / 2;
    const c = Math.min(endMs - half, Math.max(startMs + half, t));
    setZoom([c - half, c + half]);
  };
  const selectEvent = (id: string | null) => {
    setSelectedEventId(id);
    if (id) reveal(eventsById.get(id));
  };

  const onRefresh = () => {
    setTick((t) => t + 1);
    setRefreshMsg(
      forceDemo
        ? "Mode démonstration : aucune collecte n'est effectuée."
        : "Relecture des données. La collecte elle-même tourne une fois par jour.",
    );
  };

  const isDemo = state?.mode === "demo";
  const noSource = !!state && state.sources.every((s) => s.state === "not_configured" || s.state === "pending");
  const unavailable = state?.sources.filter((s) => s.state === "unavailable") ?? [];
  const emptyMessage = !state
    ? ""
    : state.articles.length === 0
      ? isDemo
        ? "Aucune donnée de démonstration sur cette période."
        : noSource
          ? "Aucune source n'est active : rien n'a été collecté. Voir « État des sources »."
          : "Aucun article collecté sur cette période. Cela ne prouve pas l'absence d'activité : voir l'état des sources."
      : "Aucun résultat ne correspond aux filtres actuels.";

  return (
    <div className="flux">
      <div className="app">
        <header className="head">
          <div className="brand">
            <div>
              <p className="flux-back">
                <a href="/">← Politiscope</a>
              </p>
              <h1 className="ftitle">Flux</h1>
              <p className="sub">Activités publiques d'Emmanuel Macron · fenêtre glissante de {PERIOD_LABEL[windowKey]}</p>
            </div>
          </div>
          <div className="who" aria-label="Personnalité suivie">
            <span className="avatar" aria-hidden="true">EM</span>
            <span className="who-text">
              <strong>Emmanuel Macron</strong>
              <span>Président de la République</span>
            </span>
          </div>
        </header>

        <SourceBar
          filters={filters}
          setFilters={setFilters}
          windowKey={windowKey}
          setWindowKey={changeWindow}
          onRefresh={onRefresh}
          busy={loading}
          isDemo={!!isDemo}
          personalities={personalities}
          personalityCounts={personalityCounts}
        />

        <p className="status-line" aria-live="polite">
          {state && (
            <>
              <span>
                Fenêtre : {formatParis(state.window.start)} → {formatParis(state.window.end)} (heure de Paris)
              </span>
              <span>
                Dernière collecte réussie :{" "}
                {isDemo ? `démo générée à ${formatParis(state.generatedAt, "time")} · aucune collecte` : formatLastCollect(state.lastRefreshAt)}
              </span>
              {isDemo && <span className="tag tag-demo">DEMO</span>}
              {refreshMsg && (
                <span className="refresh-msg" role="status">
                  {refreshMsg}
                </span>
              )}
            </>
          )}
        </p>

        {error && (
          <div className="banner banner-warn" role="alert">
            <strong>Les données du flux ne sont pas disponibles.</strong> {error}
            <button type="button" onClick={() => setTick((t) => t + 1)}>Réessayer</button>
            <button type="button" onClick={() => setForceDemo(true)}>Voir la démonstration (données fictives)</button>
          </div>
        )}
        {isDemo && (
          <div className="banner banner-demo" role="status">
            <strong>DONNÉES DE DÉMONSTRATION.</strong> Médias, événements, liens et compte « X » sont fictifs (URL example.org). Aucune
            collecte en temps réel n'est effectuée.
            <button type="button" onClick={() => setForceDemo(false)}>Quitter la démo</button>
          </div>
        )}
        {state?.mode === "live" && noSource && state.articles.length === 0 && (
          <div className="banner banner-info" role="status">
            Aucune source n'est active : l'application n'affiche rien plutôt que d'inventer des données.
            <button type="button" onClick={() => setForceDemo(true)}>Voir la démonstration</button>
          </div>
        )}
        {unavailable.length > 0 && (
          <div className="banner banner-warn" role="status">
            Source{unavailable.length > 1 ? "s" : ""} indisponible{unavailable.length > 1 ? "s" : ""} lors de la dernière collecte :{" "}
            {unavailable.map((s) => s.label).join(", ")}. La couverture est partielle.
          </div>
        )}

        <main className="grid">
          <div className="g-list">
            <EventList
              events={filtered.events}
              articlesById={articlesById}
              personalities={personalities}
              selectedId={selectedEventId}
              onSelect={selectEvent}
              nowMs={endMs}
              windowKey={windowKey}
              query={filters.query}
              setQuery={(q) => setFilters({ ...filters, query: q })}
              loading={loading && !state}
              emptyMessage={error ? "" : emptyMessage}
            />
          </div>
          <div className="g-time panel">
            <Timeline
              events={filtered.events}
              eventsById={eventsById}
              articlesById={articlesById}
              startMs={startMs}
              endMs={endMs}
              zoom={zoom}
              setZoom={setZoom}
              selectedId={selectedEventId}
              onSelect={selectEvent}
              showSuggested={showSuggested}
              setShowSuggested={setShowSuggested}
              filterSlot={<FilterMenu filters={filters} setFilters={setFilters} onReset={() => setFilters(emptyFilters())} />}
              loading={loading && !state}
              emptyMessage={
                error
                  ? ""
                  : hasActiveFilters(filters) && (state?.events.length ?? 0) > 0
                    ? "Aucun événement ne correspond aux filtres actuels."
                    : emptyMessage
              }
              windowKey={windowKey}
            />
          </div>
          <div className="g-detail">
            <DetailPanel
              key={selectedEventId ?? "none"}
              event={selectedEvent}
              articlesById={articlesById}
              eventsById={eventsById}
              nowMs={endMs}
              personalities={personalities}
              onSelectEvent={selectEvent}
              onClose={() => selectEvent(null)}
            />
          </div>
        </main>

        {state && (
          <DensityChart
            articles={filtered.articles}
            eventsById={eventsById}
            windowKey={windowKey}
            startMs={startMs}
            endMs={endMs}
            zoom={zoom}
          />
        )}
        {state && <SourcePanel sources={state.sources} notes={state.coverageNotes} />}
        <Legend isDemo={!!isDemo} />
      </div>
    </div>
  );
}
