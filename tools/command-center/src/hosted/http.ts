// JSON answers and cache headers of the Vercel functions (design.md section 6). Pure.

/** The Cache-Control values. The Vercel CDN keeps a response for `s-maxage` seconds, then serves it stale while it fetches a new one. */
export const CACHE = {
  snapshot: 's-maxage=15, stale-while-revalidate',
  docs: 's-maxage=60, stale-while-revalidate',
  /** For `/api/live`, and for every error answer. */
  none: 'no-store',
} as const;

const baseHeaders = (cache: string): Record<string, string> => ({ 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });

export function jsonResponse(body: unknown, status: number, cache: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...baseHeaders(cache), 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}

/** An error answer: `{ error, kind }`. Never cached. `error` is a fixed sentence, never text from GitHub or from Upstash. */
export function errorResponse(status: number, error: string, kind: string, extra: Record<string, string> = {}): Response {
  return jsonResponse({ error, kind }, status, CACHE.none, extra);
}

/**
 * An SVG file can hold a script. In an <img> the browser never runs it, but a person can open the file in its own tab. These headers stop any script, any load from
 * outside and any form there: nothing is allowed except inline styles and `data:` pictures, and `sandbox` gives the file an opaque origin. (The roadmap chart uses only
 * shapes, text and presentation attributes, so it needs nothing more.) The local server sets its own, separate policy for `/files` in `src/server/app.ts` (the `fileHeaders` block). The two are copies, so change both together.
 */
export const SVG_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" } as const;

export function bytesResponse(bytes: ArrayBuffer, contentType: string, cache: string, extra: Record<string, string> = {}): Response {
  return new Response(bytes, { status: 200, headers: { ...baseHeaders(cache), 'Content-Type': contentType, ...extra } });
}

/** The three read functions (snapshot, docs, live) only read. Any other method gets 405. HEAD is allowed (the CDN may send it). `/api/answer` writes and has its own method gate (src/hosted/answer.ts). */
export function methodNotAllowed(request: Request): Response | null {
  return request.method === 'GET' || request.method === 'HEAD' ? null : errorResponse(405, 'method not allowed', 'method', { Allow: 'GET, HEAD' });
}

export const notConfigured = (): Response => errorResponse(500, 'not configured', 'not-configured');
