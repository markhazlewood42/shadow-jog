import { OWNER, REPO } from '../github-api/queries';
import { type Env, readGithubToken } from './env';
import { type ErrorMap, mapAdapterError, responseOf } from './errors';
import { bytesResponse, CACHE, errorResponse, notConfigured } from './http';
import { type DocPath, docPathnameOf, parseDocPath } from './doc-path';

// `GET /api/docs/<repo path>` (design.md section 6): one doc from `main`, read through the GitHub contents API with the server token.
// It reads only `OWNER/REPO` at the ref `main`, and only a path that the allow-list (`doc-path.ts`) accepts. The CDN keeps a good answer for 60 seconds.

/** The ref that every read uses. It is a constant: no request can choose another ref. */
export const DOCS_REF = 'main';
/** The Vercel response limit is 4.5 MB. A file near it is refused with a clear error. */
const MAX_BYTES = 4_000_000;
const TIMEOUT_MS = 20_000;

/** The part of `fetch` that this function uses, so that a test can pass a small fake. */
export type DocFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'arrayBuffer' | 'body'>>;

export type DocsDeps = { env: Env; fetchImpl?: DocFetch; now?: () => Date };

/** The media type of a Content-Type header: the part before `;`, trimmed, lower case. Empty when the header is missing. */
export const mediaTypeOf = (contentType: string | null): string => (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

const CONTENT_TYPE = { markdown: 'text/markdown; charset=utf-8', png: 'image/png' } as const;

/** The GitHub URL of an allowed path. Every segment is plain (letters, digits, `.`, `-`, `_`), so nothing needs encoding. */
export const contentsUrl = (path: string): string => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${DOCS_REF}`;

/** A non-OK reply of GitHub as an answer. The body of the reply is never read, so no GitHub text can reach the answer. */
function failureOf(status: number, headers: Headers, now: Date): Response {
  if (status === 404) return errorResponse(404, 'not found', 'not-found');
  if (status === 401) return responseOf(mapAdapterError({ code: 'unauthorized' }));
  const retryAfter = headers.get('retry-after');
  const exhausted = headers.get('x-ratelimit-remaining') === '0';
  if (status === 429 || (status === 403 && (exhausted || retryAfter !== null))) {
    // The seconds to wait: `retry-after` (a secondary limit) first, then the reset time of the primary limit (epoch seconds) minus now. `mapAdapterError` clamps to 1..3600.
    const reset = Number(headers.get('x-ratelimit-reset'));
    const fromReset = exhausted && headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset) ? reset - now.getTime() / 1000 : undefined;
    const fromRetry = retryAfter !== null && retryAfter !== '' && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : undefined;
    const seconds = fromRetry ?? fromReset;
    return responseOf(mapAdapterError({ code: 'rate-limited', ...(seconds === undefined ? {} : { retryAfter: seconds }) }));
  }
  const map: ErrorMap = mapAdapterError({ code: 'http-error' });
  return responseOf(map);
}

/** The body as bytes, or null when it is longer than `max`. The stream is cancelled at the cap, so a huge file is not buffered. */
async function readCapped(reply: Pick<Response, 'arrayBuffer' | 'body'>, max: number): Promise<ArrayBuffer | null> {
  if (reply.body === null || reply.body === undefined) {
    const all = await reply.arrayBuffer();
    return all.byteLength > max ? null : all;
  }
  const reader = reply.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

export async function handleDocs(request: Request, deps: DocsDeps): Promise<Response> {
  // GET only. A HEAD request (the CDN may send one) must not cost a GitHub call.
  if (request.method !== 'GET') return errorResponse(405, 'method not allowed', 'method', { Allow: 'GET' });

  // The path is checked before anything else, so a bad path gets its answer even when the server is not configured.
  const requested = docPathnameOf(request.url);
  const parsed: DocPath = requested.ok ? parseDocPath(requested.pathname) : { ok: false, status: 400, reason: requested.reason };
  if (!parsed.ok) return errorResponse(parsed.status, parsed.status === 404 ? 'not found' : 'bad path', parsed.status === 404 ? 'not-found' : 'bad-path');

  const token = readGithubToken(deps.env);
  if (token === null) return notConfigured();

  const send: DocFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  try {
    const reply = await send(contentsUrl(parsed.path), {
      headers: {
        Authorization: `Bearer ${token}`,
        // The raw media type: GitHub sends the file bytes (text or PNG) and not a JSON wrapper with base64.
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'shadow-jog-command-center',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!reply.ok) return failureOf(reply.status, reply.headers, (deps.now ?? (() => new Date()))());
    // A folder comes back as `application/json` (checked against the real API). A file comes back as `application/vnd.github.raw+json`, which is NOT a listing.
    // So only the media type `application/json` exactly (the part before `;`, any case) is refused.
    if (mediaTypeOf(reply.headers.get('content-type')) === 'application/json') return responseOf(mapAdapterError({ code: 'bad-response' }));
    // Refuse on the announced size before reading anything, then cap the read itself (a reply with no or a wrong content-length).
    const announced = Number(reply.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > MAX_BYTES) return errorResponse(502, 'file is too large', 'too-large');
    const bytes = await readCapped(reply, MAX_BYTES);
    if (bytes === null) return errorResponse(502, 'file is too large', 'too-large');
    return bytesResponse(bytes, CONTENT_TYPE[parsed.type], CACHE.docs);
  } catch (error) {
    console.error(`docs failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return responseOf(mapAdapterError({ code: 'network' }));
  }
}
