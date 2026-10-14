import { XMLParser } from "fast-xml-parser";
import { fold } from "../../../shared/src";

export interface FeedItem {
  title: string;
  link: string;
  date?: string;
  description?: string;
  sourceName?: string;
  sourceUrl?: string;
  guid?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
});

const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

/** Lit un flux RSS 2.0 ou Atom. Le contenu est traité comme une donnée non fiable (aucune interprétation). */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const out: FeedItem[] = [];

  for (const it of asArray<any>(doc?.rss?.channel?.item)) {
    const src = it.source;
    out.push({
      title: text(it.title),
      link: text(it.link),
      date: text(it.pubDate) || text(it["dc:date"]) || undefined,
      description: text(it.description) || text(it["content:encoded"]) || undefined,
      sourceName: text(src) || undefined,
      sourceUrl: typeof src === "object" && src ? (src["@_url"] as string | undefined) : undefined,
      guid: text(it.guid) || undefined,
    });
  }

  for (const en of asArray<any>(doc?.feed?.entry)) {
    const links = asArray<any>(en.link);
    const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    out.push({
      title: text(en.title),
      link: alt?.["@_href"] ?? "",
      date: text(en.published) || text(en.updated) || undefined,
      description: text(en.summary) || text(en.content) || undefined,
      guid: text(en.id) || undefined,
    });
  }
  return out.filter((i) => i.title && i.link);
}

/** Pertinence : le texte doit réellement mentionner Macron (mot entier, sans accents ni casse). */
export function mentionsMacron(...parts: (string | undefined)[]): boolean {
  return /\bmacron\b/.test(fold(parts.filter(Boolean).join(" ")));
}
