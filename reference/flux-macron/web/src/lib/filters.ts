import type {
  ActivityCategory,
  ActivityEvent,
  Article,
  EventKind,
  SourceKind,
  VerificationStatus,
} from "../shared";
import { fold } from "../shared";

export interface Filters {
  sources: Set<SourceKind>;
  categories: Set<ActivityCategory>;
  statuses: Set<VerificationStatus>;
  kinds: Set<EventKind>;
  /** Identifiants de personnalités (OU entre elles). */
  personalities: Set<string>;
  query: string;
}

export const emptyFilters = (): Filters => ({
  sources: new Set(),
  categories: new Set(),
  statuses: new Set(),
  kinds: new Set(),
  personalities: new Set(),
  query: "",
});

export function hasActiveFilters(f: Filters): boolean {
  return f.sources.size + f.categories.size + f.statuses.size + f.kinds.size + f.personalities.size > 0 || f.query.trim() !== "";
}

const inSet = <T,>(set: Set<T>, v: T) => set.size === 0 || set.has(v);

/**
 * Un ensemble vide = « pas de filtre ». Les groupes se combinent en ET, les valeurs d'un groupe en OU.
 * Un événement n'est visible que s'il reste au moins un article visible.
 */
export function applyFilters(
  data: { events: ActivityEvent[]; articles: Article[] },
  f: Filters,
): { events: ActivityEvent[]; articles: Article[] } {
  const words = fold(f.query).split(/\s+/).filter(Boolean);
  const eventOk = new Map<string, boolean>();
  for (const e of data.events) {
    eventOk.set(e.id, inSet(f.categories, e.category) && inSet(f.statuses, e.status) && inSet(f.kinds, e.kind ?? "other") &&
        (f.personalities.size === 0 || (e.personalityIds ?? []).some((id) => f.personalities.has(id))),
    );
  }
  const articles = data.articles.filter((a) => {
    if (a.eventId && eventOk.get(a.eventId) === false) return false;
    if (!inSet(f.sources, a.sourceKind)) return false;
    if (words.length) {
      const hay = fold(`${a.title} ${a.excerpt ?? ""} ${a.publisherName}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const visibleEvents = new Set(articles.map((a) => a.eventId));
  return { articles, events: data.events.filter((e) => eventOk.get(e.id) && visibleEvents.has(e.id)) };
}
