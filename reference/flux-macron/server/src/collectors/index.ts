import type { Collector } from "./types";
import { googleNewsCollector } from "./googleNews";
import { xCollector } from "./x";

export const ALL_COLLECTORS: Collector[] = [xCollector, googleNewsCollector];
export type { Collector } from "./types";
