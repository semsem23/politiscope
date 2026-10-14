import type { StateResponse, TimeWindow } from "./shared";
import { buildDemoState } from "./shared";

export interface Loaded {
  state: StateResponse;
  /** "api" : réponse du serveur (réelle ou démo serveur) ; "local-demo" : démonstration générée dans le navigateur. */
  origin: "api" | "local-demo";
  apiError?: string;
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) throw new Error(`Réponse inattendue du serveur (HTTP ${res.status}).`);
    return { status: res.status, body: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

function isState(x: unknown): x is StateResponse {
  const s = x as StateResponse;
  return !!s && Array.isArray(s.personalities) && Array.isArray(s.events) && Array.isArray(s.articles) && Array.isArray(s.sources) && !!s.window;
}

export async function loadState(key: TimeWindow, forceDemo: boolean): Promise<Loaded> {
  if (forceDemo) return { state: buildDemoState(new Date(), key), origin: "local-demo" };
  try {
    const { status, body } = await fetchJson(`./api/state?window=${key}`);
    if (status !== 200 || !isState(body)) throw new Error(`Le serveur a répondu HTTP ${status}.`);
    return { state: body, origin: "api" };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "délai dépassé" : e instanceof Error ? e.message : "erreur inconnue";
    return { state: buildDemoState(new Date(), key), origin: "local-demo", apiError: msg };
  }
}

export interface RefreshResult {
  ok: boolean;
  message?: string;
}

export async function triggerRefresh(): Promise<RefreshResult> {
  try {
    const { status, body } = await fetchJson("./api/refresh", { method: "POST" }, 60_000);
    const b = body as { message?: string; error?: string };
    return { ok: status === 200, message: b.message ?? b.error };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "échec du rafraîchissement" };
  }
}
