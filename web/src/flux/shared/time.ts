import type { TimeWindow, WindowInfo } from "./types";

export const PARIS_TZ = "Europe/Paris" as const;
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export const WINDOW_MS: Record<TimeWindow, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
};

export const WINDOW_LABEL: Record<TimeWindow, string> = { "24h": "24 h", "7d": "7 j", "30d": "30 j" };

/** Fenêtre glissante exacte : [maintenant − durée, maintenant]. */
export function computeWindow(key: TimeWindow, now: Date): WindowInfo {
  const end = now.getTime();
  return {
    key,
    start: new Date(end - WINDOW_MS[key]).toISOString(),
    end: new Date(end).toISOString(),
    timezone: PARIS_TZ,
  };
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PARIS_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Décalage Paris − UTC (en ms) à l'instant t : 3 600 000 en hiver, 7 200 000 en été. */
export function parisOffsetMs(t: number): number {
  const p = partsFmt.formatToParts(new Date(t));
  const g = (type: string) => Number(p.find((x) => x.type === type)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS_TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export type DateStyle = "time" | "day" | "dayShort" | "dayTime" | "full";

export function formatParis(value: number | string | Date, style: DateStyle = "dayTime"): string {
  const d = value instanceof Date ? value : new Date(value);
  switch (style) {
    case "time":
      return fmt("time", { hour: "2-digit", minute: "2-digit" }).format(d);
    case "day":
      return fmt("day", { weekday: "short", day: "numeric", month: "short" }).format(d);
    case "dayShort":
      return fmt("dayShort", { weekday: "short", day: "numeric" }).format(d);
    case "full":
      return fmt("full", {
        weekday: "short", day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZoneName: "short",
      }).format(d);
    default:
      return fmt("dayTime", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  }
}

const TICK_STEPS = [1, 2, 3, 6, 12, 24, 48, 168].map((h) => h * HOUR);

export interface Tick {
  t: number;
  /** true pour les graduations de minuit (étiquette de jour). */
  midnight: boolean;
}

/** Graduations alignées sur l'heure de Paris. */
export function niceTicks(start: number, end: number, maxTicks = 8): { ticks: Tick[]; step: number } {
  const range = Math.max(1, end - start);
  const step = TICK_STEPS.find((s) => range / s <= maxTicks) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const phase = step === 168 * HOUR ? 4 * DAY : 0; // semaines alignées sur le lundi
  const off = parisOffsetMs(start);
  const localStart = start + off;
  const ticks: Tick[] = [];
  for (let L = Math.ceil((localStart - phase) / step) * step + phase; ; L += step) {
    const t = L - parisOffsetMs(L - off);
    if (t > end) break;
    if (t >= start) ticks.push({ t, midnight: L % DAY === 0 });
  }
  return { ticks, step };
}

export function formatTick(tick: Tick, step: number): string {
  if (step >= DAY) return formatParis(tick.t, "day");
  return tick.midnight ? formatParis(tick.t, "dayShort") : formatParis(tick.t, "time");
}

export function binSizeFor(key: TimeWindow): number {
  return key === "24h" ? 15 * 60_000 : key === "7d" ? 6 * HOUR : DAY;
}

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: PARIS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const parisDayKey = (t: number): string => dayKeyFmt.format(new Date(t));

/** « Aujourd'hui », « Hier » ou « lun. 12 » (jour de Paris), par rapport à nowMs. */
export function relDayLabel(t: number, nowMs: number): string {
  const k = parisDayKey(t);
  if (k === parisDayKey(nowMs)) return "Aujourd'hui";
  if (k === parisDayKey(nowMs - DAY)) return "Hier";
  return formatParis(t, "dayShort");
}

/** « Aujourd'hui 12:34 » (avec le jour) ou « 12:34 ». */
export function formatRel(t: number, nowMs: number, withDay: boolean): string {
  const time = formatParis(t, "time");
  return withDay ? `${relDayLabel(t, nowMs)} ${time}` : time;
}

export interface Bin<T> {
  start: number;
  end: number;
  items: T[];
}

export function makeBins<T>(items: T[], getTime: (i: T) => number, start: number, end: number, binMs: number): Bin<T>[] {
  const n = Math.max(1, Math.ceil((end - start) / binMs));
  const bins: Bin<T>[] = Array.from({ length: n }, (_, i) => ({
    start: start + i * binMs,
    end: Math.min(end, start + (i + 1) * binMs),
    items: [],
  }));
  for (const it of items) {
    const t = getTime(it);
    if (t < start || t > end) continue;
    bins[Math.min(n - 1, Math.floor((t - start) / binMs))].items.push(it);
  }
  return bins;
}

export function relativeTimeFr(fromMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - fromMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
