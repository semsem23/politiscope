import type { StateResponse, TimeWindow } from "./shared";
import { buildDemoState } from "./shared";

export interface Loaded {
  state: StateResponse;
  /** "demo" : données fictives générées dans le navigateur. */
  origin: "demo";
}

/**
 * Étape 1 : uniquement des données de DÉMONSTRATION fictives, étiquetées DEMO
 * partout. Aucune collecte, aucune simulation de temps réel. L'étape 3 remplace
 * cette fonction par une lecture de Supabase.
 */
export function loadState(key: TimeWindow): Loaded {
  return { state: buildDemoState(new Date(), key), origin: "demo" };
}
