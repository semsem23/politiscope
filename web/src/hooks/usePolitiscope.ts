import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { figureKeyOf, type Entry, type FamilleId, type Figure, type PersonSortKey, type Topic } from "../types";

interface Loaded {
  entries: Entry[];
  topics: Topic[];
  figures: Figure[];
  loading: boolean;
  error: string | null;
}

/**
 * Une personnalité par citation qu'elle a — dernière citation, nombre total —
 * recalculée côté client à partir de `entries`. Mêmes règles de regroupement
 * (`figureKeyOf` = handle si connu, sinon nom) et de « plus récente » que la
 * vue SQL `personnalites` : sert de repli si cette vue n'est pas encore
 * disponible (migration pas appliquée), et de base pour tout calcul qui doit
 * réagir aux filtres actifs (la vue ne connaît que la citation la plus
 * récente, pas laquelle correspond aux filtres du moment).
 */
export function deriveFigures(entries: Entry[]): Figure[] {
  const byFigure = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = figureKeyOf(e);
    const list = byFigure.get(key);
    if (list) list.push(e);
    else byFigure.set(key, [e]);
  }

  const ts = (e: Entry) => (e.date_tri ? Date.parse(e.date_tri) : 0);
  const out: Figure[] = [];
  for (const [figure_id, list] of byFigure) {
    const latest = [...list].sort((a, b) => ts(b) - ts(a) || b.id - a.id)[0];
    out.push({
      figure_id,
      handle: latest.handle,
      nom: latest.nom,
      parti: latest.parti,
      code_parti: latest.code_parti,
      famille: latest.famille,
      dernier_theme: latest.theme,
      derniere_citation: latest.citation,
      derniere_date_texte: latest.date_texte,
      derniere_date_tri: latest.date_tri,
      derniere_source: latest.source,
      derniere_entry_id: latest.id,
      nb_citations: list.length,
    });
  }
  return out;
}

export function usePolitiscopeData(): Loaded {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [e, t, p] = await Promise.all([
        supabase.from("entries").select("*").order("date_tri", { ascending: false }),
        supabase.from("topics").select("*").order("ordre"),
        supabase.from("personnalites").select("*"),
      ]);
      if (cancelled) return;

      if (e.error || t.error) {
        setError((e.error ?? t.error)!.message);
        setLoading(false);
        return;
      }

      const loadedEntries = (e.data ?? []) as Entry[];
      setEntries(loadedEntries);
      setTopics((t.data ?? []) as Topic[]);

      // La vue peut ne pas exister encore (migration 006 pas appliquée) :
      // on calcule alors la même chose côté client plutôt que de bloquer
      // toute la page pour une donnée qui se déduit de ce qu'on a déjà.
      if (p.error) {
        console.warn("vue `personnalites` indisponible, calcul côté client :", p.error.message);
        setFigures(deriveFigures(loadedEntries));
      } else {
        setFigures((p.data ?? []) as Figure[]);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, topics, figures, loading, error };
}

export interface Filters {
  familles: Record<FamilleId, boolean>;
  theme: string;
  search: string;
  /** figure_id (handle ou nom) — filtre « Personnalité », vue Citations uniquement. */
  personId: string | null;
  /** Tri de la grille Personnalités. */
  personSort: PersonSortKey;
}

/** Famille, thème et recherche : les filtres partagés par les deux vues. */
function matchesCommon(e: Entry, f: Filters, q: string): boolean {
  if (!f.familles[e.famille]) return false;
  if (f.theme !== "all" && e.theme !== f.theme) return false;
  if (q) {
    const hay = [e.nom, e.parti, e.citation, e.theme].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Lignes de la vue Citations : une par citation, filtrées y compris par personId. */
export function useFilteredEntries(entries: Entry[], f: Filters): Entry[] {
  return useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return entries.filter((e) => {
      if (f.personId && figureKeyOf(e) !== f.personId) return false;
      return matchesCommon(e, f, q);
    });
  }, [entries, f]);
}

export interface FigureCard extends Figure {
  /** Citations de cette personne qui correspondent aux filtres actifs. */
  matchCount: number;
}

/**
 * Cartes de la grille Personnalités : une personne y figure dès qu'au moins
 * une de ses citations correspond aux filtres (famille/thème/recherche —
 * personId ne s'applique pas ici, propre à la vue Citations). L'aperçu
 * affiché reste sa citation la plus récente au global, indépendamment des
 * filtres ; seuls la visibilité et le badge en tiennent compte.
 */
export function useFilteredFigures(entries: Entry[], figuresBase: Figure[], f: Filters): FigureCard[] {
  return useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (!matchesCommon(e, f, q)) continue;
      const key = figureKeyOf(e);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const cards: FigureCard[] = [];
    for (const fig of figuresBase) {
      const matchCount = counts.get(fig.figure_id) ?? 0;
      if (matchCount > 0) cards.push({ ...fig, matchCount });
    }

    const byName = (a: FigureCard, b: FigureCard) => a.nom.localeCompare(b.nom, "fr");
    const recentTs = (fig: FigureCard) => (fig.derniere_date_tri ? Date.parse(fig.derniere_date_tri) : 0);

    return cards.sort((a, b) => {
      switch (f.personSort) {
        case "count":
          return b.matchCount - a.matchCount || byName(a, b);
        case "alpha":
          return byName(a, b);
        default:
          return recentTs(b) - recentTs(a) || byName(a, b);
      }
    });
  }, [entries, figuresBase, f]);
}

/** Nombre de personnalités distinctes d'une famille, tous filtres ignorés (comme les chips aujourd'hui). */
export function distinctFigureCount(entries: Entry[], famille: FamilleId): number {
  const set = new Set<string>();
  for (const e of entries) {
    if (e.famille === famille) set.add(figureKeyOf(e));
  }
  return set.size;
}

/** Initiales affichées dans la bulle : « Élisabeth Borne » -> « EB ». */
export function initials(name: string): string {
  const parts = name
    .replace(/[ÉÈÊ]/g, "E")
    .split(/\s+/)
    .filter((p) => p.length && p[0] === p[0].toUpperCase());
  if (parts.length >= 2)
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
