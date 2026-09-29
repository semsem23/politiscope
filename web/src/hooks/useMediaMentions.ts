import { useEffect, useState } from "react";
import type { MediaMention } from "../lib/fluxScope";
import { supabase, supabaseConfigError } from "../lib/supabase";

export interface MediaMentionsData {
  /** Tout l'historique accumulé, du plus récent au plus ancien. */
  mentions: MediaMention[];
  loading: boolean;
  /** Table absente (migration 009 pas appliquée) ou lecture impossible. */
  error: string | null;
  /** Instant de référence des fenêtres 24h / 7j / 30j. */
  now: number;
}

/** PostgREST plafonne chaque réponse (1000 lignes par défaut) : on pagine. */
const PAGE = 1000;
const MAX_PAGES = 20;

/**
 * Données de la vue « Flux live » : la table `media_mentions` entière.
 *
 * La collecte nocturne (`politiscope.cli fetch-media`) n'ajoute que les
 * articles nouveaux ; la table est donc l'historique accumulé depuis le
 * premier passage. Le filtrage par période se fait côté client sur cet
 * historique — rien ici ne demande « les N derniers jours ».
 */
export function useMediaMentions(): MediaMentionsData {
  const [now] = useState(() => Date.now());
  const [mentions, setMentions] = useState<MediaMention[]>([]);
  const [loading, setLoading] = useState(() => supabase !== null);
  const [error, setError] = useState<string | null>(() => supabaseConfigError);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const client = supabase;

    (async () => {
      const all: MediaMention[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error: err } = await client
          .from("media_mentions")
          .select("id, outlet, published_at, titre, resume, article_url, theme, entities")
          .order("published_at", { ascending: false })
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (cancelled) return;
        if (err) {
          console.warn("table `media_mentions` indisponible :", err.message);
          setError(err.message);
          setLoading(false);
          return;
        }
        all.push(...((data ?? []) as MediaMention[]));
        if (!data || data.length < PAGE) break;
      }
      setMentions(all);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { mentions, loading, error, now };
}
