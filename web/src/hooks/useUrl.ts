import { useEffect, useRef } from "react";
import type { View } from "../components/FilterBar";
import type { Filters } from "./usePolitiscope";
import { FAMILLES, type FamilleId } from "../types";

/**
 * Ce que l'URL désigne à l'ouverture : soit rien (page normale), soit une
 * fiche personnalité (/p/:figureId), soit une citation précise à l'intérieur
 * d'une fiche (/c/:entryId) — cette dernière se résout en figure_id une fois
 * `entries` chargées (voir App.tsx), d'où la distinction avec "person".
 */
export type RouteTarget = { kind: "person"; figureId: string } | { kind: "citation"; entryId: number } | null;

export interface ParsedRoute {
  target: RouteTarget;
  view: View;
  filters: Filters;
}

const ALL_FAMILLES = FAMILLES.map((f) => f.id);
const SORTS: Filters["personSort"][] = ["recent", "count", "alpha"];

function parseFamilles(raw: string | null): Record<FamilleId, boolean> {
  const out = Object.fromEntries(ALL_FAMILLES.map((id) => [id, true])) as Record<FamilleId, boolean>;
  if (raw === null) return out;
  const active = new Set(raw.split(",").filter(Boolean));
  for (const id of ALL_FAMILLES) out[id] = active.has(id);
  return out;
}

/** null = toutes actives (défaut) : rien à écrire dans l'URL. */
function serializeFamilles(familles: Record<FamilleId, boolean>): string | null {
  const active = ALL_FAMILLES.filter((id) => familles[id]);
  return active.length === ALL_FAMILLES.length ? null : active.join(",");
}

/** Lit chemin + query de l'URL courante et les traduit en état applicatif. */
export function parseLocation(): ParsedRoute {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);

  let target: RouteTarget = null;
  const person = pathname.match(/^\/p\/([^/]+)\/?$/);
  const citation = pathname.match(/^\/c\/(\d+)\/?$/);
  if (person) target = { kind: "person", figureId: decodeURIComponent(person[1]) };
  else if (citation) target = { kind: "citation", entryId: Number(citation[1]) };

  const sort = params.get("tri");
  const filters: Filters = {
    familles: parseFamilles(params.get("familles")),
    theme: params.get("theme") ?? "all",
    search: params.get("q") ?? "",
    personId: params.get("person"),
    personSort: (SORTS as string[]).includes(sort ?? "") ? (sort as Filters["personSort"]) : "recent",
  };

  return { target, view: params.get("view") === "citations" ? "citations" : "personnalites", filters };
}

function filterParams(filters: Filters, view: View): URLSearchParams {
  const params = new URLSearchParams();
  const fam = serializeFamilles(filters.familles);
  if (fam) params.set("familles", fam);
  if (filters.theme !== "all") params.set("theme", filters.theme);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.personId) params.set("person", filters.personId);
  if (filters.personSort !== "recent") params.set("tri", filters.personSort);
  if (view !== "personnalites") params.set("view", view);
  return params;
}

function pathFor(view: View, filters: Filters, personModalId: string | null): string {
  const path = personModalId ? `/p/${encodeURIComponent(personModalId)}` : "/";
  const qs = filterParams(filters, view).toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * URL absolue et stable pour partager une citation précise : toujours
 * `/c/:entryId`, sans les filtres du moment — un lien partagé doit montrer
 * la citation quels que soient les filtres de la personne qui l'ouvre.
 */
export function shareUrlForEntry(entryId: number): string {
  return `${window.location.origin}/c/${entryId}`;
}

/**
 * Synchronise l'adresse avec l'état applicatif dans les deux sens :
 * - écrit l'URL quand la fiche ouverte ou les filtres changent. Un
 *   changement de filtre remplace l'entrée d'historique (sinon chaque
 *   frappe dans la recherche empilerait une entrée) ; ouvrir ou fermer une
 *   fiche en crée une nouvelle, pour que le bouton retour la referme ;
 * - relit l'URL au retour/avance navigateur et le signale via `onNavigate`.
 *
 * pushState/replaceState ne déclenchent jamais popstate : pas de boucle à
 * garder.
 */
export function useUrlSync(
  view: View,
  filters: Filters,
  personModalId: string | null,
  onNavigate: (route: ParsedRoute) => void,
  /**
   * Le mount sur `/c/:entryId` laisse `personModalId` à null le temps que
   * `entries` charge et que App résolve l'id en figure_id (voir App.tsx) :
   * sans ce garde-fou, ce premier passage écrirait "/" par-dessus le lien
   * partagé avant même la résolution.
   */
  suppressWrite = false
) {
  const prevModalId = useRef(personModalId);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  });

  useEffect(() => {
    if (suppressWrite) return;
    const path = pathFor(view, filters, personModalId);
    const current = window.location.pathname + window.location.search;
    if (path !== current) {
      const opensOrCloses = personModalId !== prevModalId.current;
      window.history[opensOrCloses ? "pushState" : "replaceState"](null, "", path);
    }
    prevModalId.current = personModalId;
  }, [view, filters, personModalId, suppressWrite]);

  useEffect(() => {
    const onPopState = () => onNavigateRef.current(parseLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
