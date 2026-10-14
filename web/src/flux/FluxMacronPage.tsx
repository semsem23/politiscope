import { useEffect, useMemo, useState } from "react";
import type { ActivityEvent, Article, TimeWindow } from "./shared";
import { countByPersonality, formatParis } from "./shared";
import { loadState } from "./data";
import type { Loaded } from "./data";
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
const TITLE = "Flux Macron — Politiscope";

/**
 * Page /flux : activités publiques d'Emmanuel Macron sur une fenêtre glissante.
 * Étape 1 : données de démonstration fictives (voir data.ts). Pas indexée.
 */
export default function FluxMacronPage() {
  const [windowKey, setWindowKey] = useState<TimeWindow>("24h");
  const [loaded, setLoaded] = useState<Loaded>(() => loadState("24h"));
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

  const changeWindow = (key: TimeWindow) => {
    setWindowKey(key);
    setLoaded(loadState(key));
    setZoom(null);
    setSelectedEventId(null);
    setRefreshMsg(null);
  };

  const { state } = loaded;
  const startMs = Date.parse(state.window.start);
  const endMs = Date.parse(state.window.end);

  const eventsById = useMemo(() => new Map<string, ActivityEvent>(state.events.map((e) => [e.id, e])), [state]);
  const articlesById = useMemo(() => new Map<string, Article>(state.articles.map((a) => [a.id, a])), [state]);
  const filtered = useMemo(() => applyFilters(state, filters), [state, filters]);
  const personalities = state.personalities;
  const personalityCounts = useMemo(() => countByPersonality(state.events), [state]);
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
    setLoaded(loadState(windowKey));
    setRefreshMsg("Mode démonstration : aucune collecte n'est effectuée.");
  };

  const isDemo = state.mode === "demo";
  const emptyMessage =
    state.articles.length === 0 ? "Aucune donnée de démonstration sur cette période." : "Aucun résultat ne correspond aux filtres actuels.";

  return (
    <div className="flux">
      <div className="app">
        <header className="head">
          <div className="brand">
            <div>
              <p className="flux-back">
                <a href="/">← Politiscope</a>
              </p>
              <h1 className="ftitle">Flux Macron</h1>
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
          busy={false}
          isDemo={isDemo}
          personalities={personalities}
          personalityCounts={personalityCounts}
        />

        <p className="status-line" aria-live="polite">
          <span>
            Fenêtre : {formatParis(state.window.start)} → {formatParis(state.window.end)} (heure de Paris)
          </span>
          <span>Dernier rafraîchissement : démo générée à {formatParis(state.generatedAt, "time")} · aucune collecte</span>
          {isDemo && <span className="tag tag-demo">DEMO</span>}
          {refreshMsg && (
            <span className="refresh-msg" role="status">
              {refreshMsg}
            </span>
          )}
        </p>

        {isDemo && (
          <div className="banner banner-demo" role="status">
            <strong>DONNÉES DE DÉMONSTRATION.</strong> Médias, événements, liens et compte « X » sont fictifs (URL example.org). Aucune
            collecte en temps réel n'est effectuée.
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
              loading={false}
              emptyMessage={emptyMessage}
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
              loading={false}
              emptyMessage={
                hasActiveFilters(filters) && state.events.length > 0 ? "Aucun événement ne correspond aux filtres actuels." : emptyMessage
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

        <DensityChart
          articles={filtered.articles}
          eventsById={eventsById}
          windowKey={windowKey}
          startMs={startMs}
          endMs={endMs}
          zoom={zoom}
        />
        <SourcePanel sources={state.sources} notes={state.coverageNotes} />
        <Legend isDemo={isDemo} />
      </div>
    </div>
  );
}
