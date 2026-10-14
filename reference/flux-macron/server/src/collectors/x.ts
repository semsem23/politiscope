import type { RawItem } from "../../../shared/src";
import { HttpError, RateLimitError, httpGet } from "../http";
import type { Collector } from "./types";

// X : API officielle v2 avec un jeton « Bearer » d'application (lecture seule), uniquement côté serveur.
// Chaque lecture est facturée selon votre formule d'accès X : le connecteur borne donc le volume
// (X_MAX_POSTS_PER_REFRESH), mémorise les identifiants d'utilisateur et lit seulement les publications
// plus récentes que la dernière déjà collectée (since_id). Voir docs/SOURCES.md.
//
// ⚠ Ce connecteur n'a PAS pu être testé contre l'API réelle dans l'environnement de développement
// (pas de jeton, pas d'accès réseau sortant). Seule la transformation des réponses est testée.

const API = "https://api.x.com/2";

interface XUser {
  id: string;
  username: string;
  name?: string;
}
interface XPost {
  id: string;
  text: string;
  created_at?: string;
}

export function mapPosts(user: XUser, posts: XPost[]): RawItem[] {
  return posts
    .filter((p) => p.id && p.text && p.created_at)
    .map((p) => {
      const oneLine = p.text.replace(/\s+/g, " ").trim();
      return {
        sourceKind: "x" as const,
        publisherName: `@${user.username} (X)`,
        title: oneLine.length > 140 ? oneLine.slice(0, 139) + "…" : oneLine,
        excerpt: oneLine,
        url: `https://x.com/${encodeURIComponent(user.username)}/status/${p.id}`,
        publishedAt: new Date(p.created_at!),
        authorOrAccount: `@${user.username}`,
        nativeId: p.id,
      };
    });
}

/** Compare deux identifiants de publication X (entiers de 64 bits en texte). */
const newer = (a: string, b: string) => (a.length !== b.length ? a.length > b.length : a > b);

export const xCollector: Collector = {
  id: "x",
  kind: "x",
  label: "X",
  setupHint:
    "API officielle X v2 : définissez X_BEARER_TOKEN (jeton d'application, côté serveur) et X_ACCOUNTS. Vérifiez votre formule d'accès et ses coûts (docs/SOURCES.md).",
  minIntervalMs: 10 * 60_000,
  isConfigured: (c) => !!c.x.bearerToken,
  async collect({ config, since, kv }) {
    const bearer = config.x.bearerToken!;
    const get = async (path: string) => {
      try {
        const { text } = await httpGet(`${API}${path}`, { userAgent: config.userAgent, headers: { Authorization: `Bearer ${bearer}` } });
        return JSON.parse(text) as { data?: unknown; errors?: { detail?: string }[] };
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) {
          const reset = Number(e.headers.get("x-rate-limit-reset"));
          throw new RateLimitError(Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 15 * 60_000);
        }
        throw e;
      }
    };

    // 1) identifiants d'utilisateur (mémorisés : chaque recherche d'utilisateur peut être facturée)
    const users: XUser[] = [];
    const missing: string[] = [];
    for (const name of config.x.accounts) {
      const id = kv.get(`x:user:${name.toLowerCase()}`);
      if (id) users.push({ id, username: name });
      else missing.push(name);
    }
    if (missing.length) {
      const res = await get(`/users/by?usernames=${missing.map(encodeURIComponent).join(",")}`);
      for (const u of (res.data as XUser[] | undefined) ?? []) {
        kv.set(`x:user:${u.username.toLowerCase()}`, u.id);
        users.push(u);
      }
    }

    // 2) publications récentes, sans réponses ni republications
    const items: RawItem[] = [];
    const cursors = new Map<string, string>();
    const partialErrors: string[] = [];
    for (const user of users) {
      try {
        const sinceId = kv.get(`x:since:${user.id}`);
        const q = new URLSearchParams({
          max_results: String(config.x.maxPostsPerRefresh),
          "tweet.fields": "created_at",
          exclude: "retweets,replies",
        });
        if (sinceId) q.set("since_id", sinceId);
        else q.set("start_time", new Date(Math.max(since.getTime(), Date.now() - 7 * 86_400_000)).toISOString());
        const res = await get(`/users/${user.id}/tweets?${q}`);
        const posts = (res.data as XPost[] | undefined) ?? [];
        items.push(...mapPosts(user, posts));
        const top = posts.map((p) => p.id).reduce<string | undefined>((m, id) => (!m || newer(id, m) ? id : m), undefined);
        if (top) cursors.set(user.id, top);
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        partialErrors.push(`@${user.username} : ${e instanceof HttpError ? `HTTP ${e.status}` : "erreur"}`);
      }
    }
    if (users.length > 0 && partialErrors.length === users.length) throw new Error(partialErrors.join(" ; "));
    return {
      items,
      partialErrors: partialErrors.length ? partialErrors : undefined,
      commit: () => cursors.forEach((id, uid) => kv.set(`x:since:${uid}`, id)),
    };
  },
};
