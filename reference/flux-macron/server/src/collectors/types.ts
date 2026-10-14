import type { SourceKind } from "../../../shared/src";
import type { RawItem } from "../../../shared/src";
import type { Config } from "../config";

export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface CollectContext {
  config: Config;
  /** Ne collecter que les contenus publiés après cet instant. */
  since: Date;
  now: Date;
  kv: KeyValueStore;
}

export interface CollectResult {
  items: RawItem[];
  /** Appelé APRÈS l'enregistrement réussi des éléments (ex. mémoriser le curseur since_id). */
  commit?: () => void;
  /** Erreurs partielles : la source répond mais la couverture est incomplète. */
  partialErrors?: string[];
}

export interface Collector {
  id: string;
  kind: SourceKind;
  label: string;
  setupHint: string;
  /** Délai minimal entre deux collectes automatiques ou manuelles. */
  minIntervalMs: number;
  isConfigured(config: Config): boolean;
  collect(ctx: CollectContext): Promise<CollectResult>;
}
