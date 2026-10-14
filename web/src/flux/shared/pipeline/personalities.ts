import type { ActivityEvent, Article, Personality } from "../types";
import { fold } from "../text";

const MAX = 50;
const MIN_LEN = 4; // évite les fausses détections sur des sigles ou prénoms très courts

const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Lit « Nom|alias1|alias2 ; Autre nom|alias ». Aucune personnalité par défaut : la liste est choisie
 * (et vérifiée) par l'utilisateur. Les alias trop courts sont ignorés.
 */
export function parsePersonalities(raw: string | undefined): Personality[] {
  const out: Personality[] = [];
  const seen = new Set<string>();
  for (const chunk of (raw ?? "").split(";")) {
    const [name, ...aliases] = chunk.split("|").map((s) => s.trim());
    if (!name || name.length < MIN_LEN) continue;
    const id = slug(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, aliases: aliases.filter((a) => a.length >= MIN_LEN) });
    if (out.length >= MAX) break;
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Identifiants des personnalités dont le nom ou un alias apparaît (mot entier, sans accents ni casse) dans le texte. */
export function detectPersonalities(text: string, list: Personality[]): string[] {
  if (!list.length) return [];
  const hay = ` ${fold(text)} `;
  const found: string[] = [];
  for (const p of list) {
    const hit = [p.name, ...p.aliases].some((n) => {
      const f = fold(n).trim();
      return f.length >= MIN_LEN && new RegExp(`[^a-z0-9]${esc(f)}[^a-z0-9]`).test(hay);
    });
    if (hit) found.push(p.id);
  }
  return found;
}

/** Personnalités citées par au moins un article de l'événement (titre ou extrait). */
export function personalitiesOfEvent(articles: Article[], list: Personality[]): string[] {
  return detectPersonalities(articles.map((a) => `${a.title} . ${a.excerpt ?? ""}`).join(" . "), list);
}

export const countByPersonality = (events: ActivityEvent[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const e of events) for (const id of e.personalityIds ?? []) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};
