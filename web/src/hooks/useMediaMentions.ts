import { useState } from "react";
import { buildMockMentions } from "../lib/fluxMock";
import type { MediaMention } from "../lib/fluxScope";

export interface MediaMentionsData {
  /** Tout l'historique accumulé, du plus récent au plus ancien. */
  mentions: MediaMention[];
  /** "mock" tant qu'aucune ingestion réelle n'alimente `media_mentions`. */
  source: "mock" | "live";
  /** Instant de référence des fenêtres 24h / 7j / 30j. */
  now: number;
}

/**
 * Point d'entrée unique des données de la vue « Flux live ».
 *
 * Aujourd'hui : données fictives (voir fluxMock.ts). Il n'existe ni table
 * `media_mentions`, ni ingestion des comptes médias — le workflow nocturne
 * ne lit que les timelines des personnalités de x_accounts.json.
 *
 * Quand l'ingestion existera (incrémentale via since_id, ajoutant chaque nuit
 * les dernières 24h aux mentions déjà accumulées), ce hook est le seul
 * endroit à changer : lire la table entière, renvoyer `source: "live"`. Le
 * filtrage par période reste côté client, sur l'historique accumulé.
 */
export function useMediaMentions(): MediaMentionsData {
  const [data] = useState<MediaMentionsData>(() => {
    const now = Date.now();
    return { mentions: buildMockMentions(now), source: "mock", now };
  });
  return data;
}
