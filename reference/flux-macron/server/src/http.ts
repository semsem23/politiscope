// Client HTTP minimal et prudent : https uniquement, délai d'attente, taille de réponse bornée,
// User-Agent explicite. Les erreurs ne contiennent jamais d'en-têtes (donc jamais de jeton).

export class HttpError extends Error {
  constructor(
    public status: number,
    public headers: Headers,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
  }
}

/** Limite de débit atteinte : le service indique quand réessayer. */
export class RateLimitError extends Error {
  constructor(
    public resetAtMs: number,
    message = "Limite de débit atteinte",
  ) {
    super(message);
  }
}

export interface GetOptions {
  userAgent: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function httpGet(url: string, opt: GetOptions): Promise<{ status: number; headers: Headers; text: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Seules les URL https sont autorisées.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opt.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": opt.userAgent, Accept: "application/json, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5", ...opt.headers },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (new URL(res.url || url).protocol !== "https:") throw new Error("Redirection vers une URL non https refusée.");
    const max = opt.maxBytes ?? 2_000_000;
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new Error(`Réponse trop volumineuse (> ${max} octets).`);
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!res.ok) throw new HttpError(res.status, res.headers);
    return { status: res.status, headers: res.headers, text };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Délai d'attente dépassé.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Message d'erreur affichable : sans secret, sans URL complète. */
export function safeMessage(e: unknown): string {
  if (e instanceof RateLimitError) return e.message;
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403) return `Accès refusé (HTTP ${e.status}) : vérifiez les identifiants et le niveau d'accès.`;
    if (e.status === 429) return "Limite de débit atteinte (HTTP 429).";
    return `Le service a répondu HTTP ${e.status}.`;
  }
  const msg = e instanceof Error ? e.message : "erreur inconnue";
  return msg.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 300);
}
