import { supabase, supabaseConfigError } from "../lib/supabase";
import type { StateResponse, TimeWindow } from "./shared";
import { buildDemoState, computeWindow } from "./shared";
import { assembleLiveState } from "./live";
import type { ArticleRow, PersonalityRow, RunRow } from "./live";

export interface Loaded {
  state: StateResponse;
  /** "supabase" : données réellement collectées ; "demo" : données FICTIVES, demandées explicitement (?demo=1). */
  origin: "supabase" | "demo";
}

const FIGURE = "emmanuel-macron";
const PAGE = 1000;
const MAX_PAGES = 10;

const ARTICLE_COLS =
  "id, source_kind, publisher_name, title, excerpt, url, published_at, collected_at, author_or_account, original_source_url";

/**
 * Lit Supabase (clé publishable, lecture seule par RLS) et assemble l'état.
 * Lève une Error lisible si la lecture échoue : la page l'affiche telle quelle et ne bascule
 * JAMAIS d'elle-même sur des données de démonstration. La démonstration n'existe que sur demande.
 */
export async function loadState(key: TimeWindow, forceDemo: boolean): Promise<Loaded> {
  const now = new Date();
  if (forceDemo) return { state: buildDemoState(now, key), origin: "demo" };
  if (!supabase) throw new Error(supabaseConfigError ?? "Configuration Supabase manquante.");
  const client = supabase;

  const window = computeWindow(key, now);
  const articles: ArticleRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await client
      .from("flux_articles")
      .select(ARTICLE_COLS)
      .eq("figure", FIGURE)
      .gte("published_at", window.start)
      .lte("published_at", window.end)
      .order("published_at", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(`flux_articles : ${error.message}`);
    articles.push(...((data ?? []) as ArticleRow[]));
    if (!data || data.length < PAGE) break;
  }

  const [runs, people] = await Promise.all([
    client
      .from("flux_source_runs")
      .select("source_kind, started_at, finished_at, status, items_seen, items_kept, items_new, error")
      .order("started_at", { ascending: false })
      .limit(40),
    client.from("flux_personalities").select("id, name, aliases, role"),
  ]);
  if (runs.error) throw new Error(`flux_source_runs : ${runs.error.message}`);
  if (people.error) throw new Error(`flux_personalities : ${people.error.message}`);

  return {
    state: assembleLiveState({
      articles,
      runs: (runs.data ?? []) as RunRow[],
      personalities: (people.data ?? []) as PersonalityRow[],
      key,
      now,
    }),
    origin: "supabase",
  };
}
