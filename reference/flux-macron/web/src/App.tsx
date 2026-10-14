import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityEvent, Article, TimeWindow } from "./shared";
import { formatParis } from "./shared";
import { loadState, triggerRefresh } from "./api";
import type { Loaded } from "./api";
import { applyFilters, emptyFilters, hasActiveFilters } from "./lib/filters";
import type { Filters } from "./lib/filters";
import DensityChart from "./components/DensityChart";
import DetailPanel from "./components/DetailPanel";
import EventList from "./components/EventList";
import FilterMenu from "./components/FilterMenu";
import Legend from "./components/Legend";
import SourceBar from "./components/SourceBar";
import { countByPersonality } from "./shared";
import SourcePanel from "./components/SourcePanel";
import Timeline from "./components/Timeline";

const PERIOD_LABEL: Record<TimeWindow, string> = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours" };

export default function App() {
  const [windowKey, setWindowKey] = useState<TimeWindow>("24h");
  const [forceDemo, setForceDemo] = useState(
    () => new URLSearchParams(location.search).has("demo") || (window as unknown as { __FLUX_FORCE_DEMO__?: boolean }).__FLUX_FORCE_DEMO__ === true,
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [showSuggested, setShowSuggested] = useState(true);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      const r = await loadState(windowKey, forceDemo);
      setLoaded(r);
      setLoading(false);
    },
    [windowKey, forceDemo],
  );
  useEffect(() => { void load(false); }, [load]);
  // Relecture de l'état toutes les minutes : la fenêtre glissante avance. Aucune collecte n'est déclenchée ici.
  useEffect(() => {
    const id = setInterval(() => void load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => setZoom(null), [windowKey]);

  const state = loaded?.state ?? null;
  const startMs = state ? Date.parse(state.window.start) : 0;
  const endMs = state ? Date.parse(state.window.end) : 1;

  const eventsById = useMemo(() => new Map<string, ActivityEvent>((state?.events ?? []).map((e) => [e.id, e])), [state]);
  const articlesById = useMemo(() => new Map<string, Article>((state?.articles ?? []).map((a) => [a.id, a])), [state]);
  const filtered = useMemo(() => (state ? applyFilters(state, filters) : { events: [], articles: [] }), [state, filters]);

  const personalities = state?.personalities ?? [];
  const personalityCounts = useMemo(() => countByPersonality(state?.events ?? []), [state]);

  const selectedEvent = selectedEventId ? eventsById.get(selectedEventId) ?? null : null;

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

  const onRefresh = async () => {
    setRefreshMsg(null);
    if (loaded?.origin === "api" && state?.mode === "live") {
      setRefreshing(true);
      const r = await triggerRefresh();
      setRefreshMsg(r.ok ? (r.message ?? "Collecte terminée.") : `Rafraîchissement impossible : ${r.message ?? "erreur"}`);
      await load(true);
      setRefreshing(false);
    } else {
      await load(true);
      setRefreshMsg("Mode démonstration : aucune collecte n'est effectuée.");
    }
  };

  const isDemo = state?.mode === "demo";
  const noneConfigured = !!state && state.sources.every((s) => s.state === "not_configured");
  const unavailable = state?.sources.filter((s) => s.state === "unavailable") ?? [];
  const emptyMessage = !state
    ? ""
    : state.articles.length === 0
      ? isDemo
        ? "Aucune donnée de démonstration sur cette période."
        : noneConfigured
          ? "Aucune source n'est configurée : rien n'a été collecté. Voir « État des sources »."
          : "Aucun article collecté sur cette période. Cela ne prouve pas l'absence d'activité : voir l'état des sources."
      : "Aucun résultat ne correspond aux filtres actuels.";

  const refreshInfo = !state
    ? "—"
    : isDemo
      ? `démo générée à ${formatParis(state.generatedAt, "time")} · aucune collecte`
      : state.lastRefreshAt
        ? formatParis(state.lastRefreshAt)
        : "aucune collecte effectuée";

  return (
    <div className="app">
      <header className="head">
        <div className="brand">
          <svg className="flag" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
            <path d="M8 4v27" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M9.2 5.5h19v14h-19z" fill="#1d3f8f" />
            <path d="M16 5.5h6.3v14H16z" fill="#fff" />
            <path d="M22.3 5.5h5.9v14h-5.9z" fill="#d23a3a" />
          </svg>
          <div>
            <h1 className="title">Flux Macron</h1>
            <p className="sub">Activités publiques d'Emmanuel Macron · fenêtre glissante de {PERIOD_LABEL[windowKey]}</p>
          </div>
        </div>
        <div className="who" aria-label="Personnalité suivie">
          <span className="avatar" aria-hidden="true">EM</span>
          <span className="who-text"><strong>Emmanuel Macron</strong><span>Président de la République</span></span>
        </div>
      </header>

      <SourceBar
        filters={filters}
        setFilters={setFilters}
        windowKey={windowKey}
        setWindowKey={setWindowKey}
        onRefresh={onRefresh}
        busy={refreshing || loading}
        isDemo={!!isDemo}
        personalities={personalities}
        personalityCounts={personalityCounts}
      />

      <p className="status-line" aria-live="polite">
        {state && (
          <>
            <span>Fenêtre : {formatParis(state.window.start)} → {formatParis(state.window.end)} (heure de Paris)</span>
            <span>Dernier rafraîchissement : {refreshInfo}</span>
            {isDemo && <span className="tag tag-demo">DEMO</span>}
            {refreshMsg && <span className="refresh-msg" role="status">{refreshMsg}</span>}
          </>
        )}
      </p>

      {loaded?.apiError && (
        <div className="banner banner-warn" role="alert">
          <strong>Serveur injoignable ({loaded.apiError}).</strong> Démonstration locale affichée : événements fictifs, aucune collecte.
          <button type="button" onClick={() => void load(false)}>Réessayer</button>
        </div>
      )}
      {isDemo && !loaded?.apiError && (
        <div className="banner banner-demo" role="status">
          <strong>DONNÉES DE DÉMONSTRATION.</strong> Médias, événements, liens et compte « X » sont fictifs (URL example.org). Aucune collecte en temps réel n'est effectuée.
          {forceDemo && <button type="button" onClick={() => setForceDemo(false)}>Quitter la démo</button>}
        </div>
      )}
      {state?.mode === "live" && noneConfigured && state.articles.length === 0 && (
        <div className="banner banner-info" role="status">
          Aucune source n'est encore connectée : l'application n'affiche rien plutôt que d'inventer des données.
          <button type="button" onClick={() => setForceDemo(true)}>Voir la démonstration</button>
        </div>
      )}
      {unavailable.length > 0 && (
        <div className="banner banner-warn" role="status">
          Source{unavailable.length > 1 ? "s" : ""} temporairement indisponible{unavailable.length > 1 ? "s" : ""} : {unavailable.map((s) => s.label).join(", ")}. La couverture est partielle.
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
            loading={loading && !state}
            emptyMessage={hasActiveFilters(filters) && (state?.events.length ?? 0) > 0 ? "Aucun événement ne correspond aux filtres actuels." : emptyMessage}
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
  );
}
