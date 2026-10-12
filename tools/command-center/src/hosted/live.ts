import { type Env, readUpstash } from './env';
import { CACHE, errorResponse, jsonResponse, methodNotAllowed, notConfigured } from './http';

// `GET /api/live` (design.md sections 6, 7 and 11.1): the `live` key from Upstash Redis, read over REST with the READ-ONLY token, plus the state of the reporter.
// Never cached. Uses `fetch`, no SDK. The read-write token variable must not exist in this project: if it does, the function refuses to run.

export const LIVE_KEY = 'live';
/** The reporter is offline when `writtenAt` is older than this (design.md section 7). The key itself lives 600 s, so "offline since" can show. */
export const OFFLINE_AFTER_SECONDS = 150;

export type ReporterState = 'online' | 'offline' | 'not-running';
export type Reporter = { state: ReporterState; writtenAt: string | null; ageSeconds: number | null; offlineAfterSeconds: number };
/** `live` is the stored JSON as it is (the reporter's allow-listed fields), or null when the key is gone. */
export type LiveAnswer = { reporter: Reporter; live: unknown };

/** The part of `fetch` that this function uses, so that a test can pass a small fake. */
export type LiveFetch = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

export type LiveDeps = { env: Env; fetchImpl?: LiveFetch; now?: () => Date };

const TIMEOUT_MS = 10_000;

/** The reporter state from the stored value. Pure. A missing or unreadable `writtenAt` counts as offline: freshness cannot be shown. */
export function reporterOf(live: unknown, now: Date): Reporter {
  if (live === null || live === undefined) return { state: 'not-running', writtenAt: null, ageSeconds: null, offlineAfterSeconds: OFFLINE_AFTER_SECONDS };
  const writtenAt = typeof live === 'object' && !Array.isArray(live) ? (live as Record<string, unknown>).writtenAt : undefined;
  const time = typeof writtenAt === 'string' ? Date.parse(writtenAt) : Number.NaN;
  if (!Number.isFinite(time)) return { state: 'offline', writtenAt: typeof writtenAt === 'string' ? writtenAt : null, ageSeconds: null, offlineAfterSeconds: OFFLINE_AFTER_SECONDS };
  // A clock that runs ahead of the reporter's clock gives a negative age: show 0.
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - time) / 1000));
  return { state: ageSeconds > OFFLINE_AFTER_SECONDS ? 'offline' : 'online', writtenAt: writtenAt as string, ageSeconds, offlineAfterSeconds: OFFLINE_AFTER_SECONDS };
}

export async function handleLive(request: Request, deps: LiveDeps): Promise<Response> {
  const refused = methodNotAllowed(request);
  if (refused !== null) return refused;

  const settings = readUpstash(deps.env);
  if (!settings.ok) {
    if (settings.reason === 'not-configured') return notConfigured();
    // Logged once for each call, with the name of the variable and never its value.
    console.error(`misconfigured: ${settings.detail ?? 'see the environment variables'}`);
    return errorResponse(500, 'misconfigured', 'misconfigured');
  }

  const send: LiveFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  let text: string;
  try {
    const reply = await send(`${settings.url}/get/${LIVE_KEY}`, { method: 'GET', headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!reply.ok) return errorResponse(502, reply.status === 401 || reply.status === 403 ? 'the store does not accept the read token' : 'the store refused the request', 'store-error');
    text = await reply.text();
  } catch (error) {
    console.error(`live read failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return errorResponse(504, 'the store could not be reached', 'store-unreachable');
  }

  // Upstash answers `{ "result": <value> }`. The reporter stores the state as a JSON string, so `result` is a string that holds JSON (or null when the key is gone).
  let result: unknown;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null || !('result' in body)) throw new Error('no result');
    result = (body as { result: unknown }).result;
    if (typeof result === 'string') result = JSON.parse(result);
  } catch {
    return errorResponse(502, 'the stored value is not JSON', 'bad-stored-value');
  }
  const live = result ?? null;
  const answer: LiveAnswer = { reporter: reporterOf(live, (deps.now ?? (() => new Date()))()), live };
  return jsonResponse(answer, 200, CACHE.none);
}
