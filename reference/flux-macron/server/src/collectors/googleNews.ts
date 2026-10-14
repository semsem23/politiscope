import type { RawItem } from "../../../shared/src";
import { httpGet } from "../http";
import type { Collector } from "./types";
import { mentionsMacron, parseFeed } from "./rss";

// Google Actualités : il n'existe PAS d'API officielle. Ce connecteur lit le flux RSS public de
// recherche (news.google.com/rss/search), sans garantie de disponibilité ni de stabilité.
// Il est désactivé tant que GOOGLE_NEWS_RSS_ENABLED n'est pas défini à "true" (voir docs/SOURCES.md).
// Les liens du flux sont des liens Google qui redirigent vers l'éditeur : on conserve le lien tel quel.

export function parseGoogleNews(xml: string, since: Date): RawItem[] {
  const items: RawItem[] = [];
  for (const it of parseFeed(xml)) {
    const publisher = it.sourceName || it.title.split(" - ").slice(1).pop() || "Source inconnue";
    if (!mentionsMacron(it.title, it.description)) continue;
    const published = it.date ? new Date(it.date) : undefined;
    if (!published || Number.isNaN(published.getTime()) || published < since) continue;
    items.push({
      sourceKind: "google_news",
      publisherName: publisher,
      title: it.title,
      // la description Google est souvent une simple liste de titres liés : elle est ignorée si identique au titre
      excerpt: it.description,
      url: it.link,
      publishedAt: published,
      nativeId: it.guid,
    });
  }
  return items;
}

export const googleNewsCollector: Collector = {
  id: "google_news",
  kind: "google_news",
  label: "Google Actualités",
  setupHint:
    "Pas d'API officielle : flux RSS public de recherche. Définissez GOOGLE_NEWS_RSS_ENABLED=true après avoir vérifié les conditions d'utilisation (docs/SOURCES.md).",
  minIntervalMs: 15 * 60_000,
  isConfigured: (c) => c.google.enabled,
  async collect({ config, since, now }) {
    const days = Math.min(30, Math.max(1, Math.ceil((now.getTime() - since.getTime()) / 86_400_000)));
    const q = `${config.google.query} when:${days}d`;
    const { language: hl, country: gl } = config.google;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`;
    const { text } = await httpGet(url, { userAgent: config.userAgent });
    return { items: parseGoogleNews(text, since) };
  },
};
