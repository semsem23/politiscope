import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Entry, FamilleId, SentimentId, SortKey, Topic } from "../types";

interface Loaded {
  entries: Entry[];
  topics: Topic[];
  loading: boolean;
  error: string | null;
}

export function usePolitiscopeData(): Loaded {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [e, t] = await Promise.all([
        supabase.from("entries").select("*").order("date_tri", { ascending: false }),
        supabase.from("topics").select("*").order("ordre"),
      ]);
      if (cancelled) return;

      if (e.error || t.error) {
        setError((e.error ?? t.error)!.message);
      } else {
        setEntries((e.data ?? []) as Entry[]);
        setTopics((t.data ?? []) as Topic[]);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, topics, loading, error };
}

export interface Filters {
  familles: Record<FamilleId, boolean>;
  sentiments: Record<SentimentId, boolean>;
  theme: string;
  sort: SortKey;
  search: string;
}

/** Filtrage et tri, mémorisés : le graphe et les bulles partagent la source. */
export function useFiltered(entries: Entry[], f: Filters): Entry[] {
  return useMemo(() => {
    const counts = entries.reduce<Record<string, number>>((acc, d) => {
      acc[d.theme] = (acc[d.theme] ?? 0) + 1;
      return acc;
    }, {});

    const q = f.search.trim().toLowerCase();
    const list = entries.filter((d) => {
      if (!f.familles[d.famille]) return false;
      if (!f.sentiments[d.sentiment]) return false;
      if (f.theme !== "all" && d.theme !== f.theme) return false;
      if (q) {
        const hay = [d.nom, d.parti, d.citation, d.sujet, ...(d.hashtags ?? [])]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const ts = (d: Entry) => (d.date_tri ? Date.parse(d.date_tri) : 0);
    const byName = (a: Entry, b: Entry) => a.nom.localeCompare(b.nom, "fr");

    return [...list].sort((a, b) => {
      switch (f.sort) {
        case "date-desc":
          return ts(b) - ts(a) || byName(a, b);
        case "date-asc":
          return ts(a) - ts(b) || byName(a, b);
        case "alpha":
          return byName(a, b);
        case "parti":
          return a.parti.localeCompare(b.parti, "fr") || byName(a, b);
        case "sentiment": {
          const order = { positif: 0, neutre: 1, negatif: 2 } as const;
          return order[a.sentiment] - order[b.sentiment] || byName(a, b);
        }
        default: {
          const diff = (counts[b.theme] ?? 0) - (counts[a.theme] ?? 0);
          if (diff !== 0) return diff;
          if (a.theme !== b.theme) return a.theme.localeCompare(b.theme, "fr");
          return byName(a, b);
        }
      }
    });
  }, [entries, f]);
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
