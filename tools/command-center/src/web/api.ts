import type { ChangeEvent, Health, Panel } from '../shared/types';

// How the page talks to the server: reads (JSON, and the event stream) and the one kind of
// write. Nothing here throws for a server that is down or an answer that is odd, when it can
// say so as data instead: a panel must show its own error, not crash the page.

/** A request that failed. `code` is a short word to test for; `message` is a sentence for a person. */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const NETWORK_MESSAGE = 'Cannot reach the command center server. Is it still running?';

/** The body of an answer as JSON, or null when it is not JSON. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorInfo(value: unknown): value is { code: string; message: string } {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

/** The error of a failed answer: the server's own when it sent one (`{ ok: false, error }`), else the HTTP status. */
function errorFor(res: Response, body: unknown): ApiError {
  if (isRecord(body) && isErrorInfo(body.error)) return new ApiError(body.error.code, body.error.message);
  return new ApiError(`http-${res.status}`, `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
}

function failure<T>(code: string, message: string): Panel<T> {
  return { ok: false, error: { code, message }, updatedAt: null, lastGood: null };
}

/** Whether a JSON value has the shape of a Panel (a good one or a failed one). */
function isPanel<T>(value: unknown): value is Panel<T> {
  if (!isRecord(value)) return false;
  if (value.ok === true) return typeof value.updatedAt === 'string' && 'data' in value;
  if (value.ok !== false) return false;
  const lastGood = value.lastGood;
  return (
    isErrorInfo(value.error) &&
    (value.updatedAt === null || typeof value.updatedAt === 'string') &&
    (lastGood === null || (isRecord(lastGood) && typeof lastGood.updatedAt === 'string' && 'data' in lastGood))
  );
}

/** GETs JSON. Throws an ApiError when the server cannot be reached or does not answer 2xx. */
export async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new ApiError('network', NETWORK_MESSAGE);
  }
  const body = await readJson(res);
  if (!res.ok) throw errorFor(res, body);
  if (body === null) throw new ApiError('bad-response', 'The server answered with something that is not JSON.');
  return body as T;
}

/**
 * GETs a data endpoint as a Panel. It never throws: a server that is down, an HTTP error and an
 * answer that is not a panel all come back as a failed panel, which a PanelFrame shows.
 */
export async function getPanel<T>(url: string): Promise<Panel<T>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    return failure('network', NETWORK_MESSAGE);
  }
  const body = await readJson(res);
  // A panel is a panel whatever the HTTP status: a module that failed answers with its error inside it.
  if (isPanel<T>(body)) return body;
  if (!res.ok) {
    const error = errorFor(res, body);
    return failure(error.code, error.message);
  }
  return failure('bad-response', 'The server answered with something that is not a panel.');
}

/**
 * The panel to show after `next`. A failed panel with no data of its own keeps the data the page
 * already had, so a lost connection shows its error above the last good data, not an empty box.
 */
export function mergeLastGood<T>(previous: Panel<T> | null, next: Panel<T>): Panel<T> {
  if (next.ok || next.lastGood !== null || previous === null) return next;
  const kept = previous.ok ? { data: previous.data, updatedAt: previous.updatedAt } : previous.lastGood;
  return kept === null ? next : { ...next, updatedAt: kept.updatedAt, lastGood: kept };
}

/**
 * /api/health is a plain object, not a panel. This wraps it as one (stamped with the time it
 * arrived), so the shell shows it in a PanelFrame, with the same error state as every panel.
 */
export async function loadHealthPanel(): Promise<Panel<Health>> {
  try {
    const health = await getJson<Health>('/api/health');
    return { ok: true, data: health, updatedAt: new Date().toISOString() };
  } catch (error) {
    return failure(error instanceof ApiError ? error.code : 'unknown', error instanceof Error ? error.message : String(error));
  }
}

// ---- the one kind of write ----

/** The token of this run, which the server put into the page. Throws when the page has none. */
export function readToken(): string {
  const token = typeof document === 'undefined' ? null : document.querySelector('meta[name="cc-token"]')?.getAttribute('content');
  if (!token) throw new ApiError('no-token', 'This page has no write token. Reload the page.');
  return token;
}

/**
 * POSTs JSON with the token in the `X-CC-Token` header, which the server asks of every write.
 * Throws an ApiError, with the server's own message when it sent one, if the write did not work.
 */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const token = readToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CC-Token': token },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', NETWORK_MESSAGE);
  }
  const answer = await readJson(res);
  if (!res.ok) throw errorFor(res, answer);
  return answer as T;
}

// ---- the event stream ----

/** The state of the connection to /api/events. */
export type ConnectionState = 'connecting' | 'live' | 'offline';

export type ServerEvent =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'changed'; event: ChangeEvent }
  /**
   * The server said hello: the stream is open, new or back after a cut. Events from before this
   * moment were not delivered, so anything may have changed since the page last loaded: reload.
   */
  | { type: 'hello' };

const listeners = new Set<(event: ServerEvent) => void>();
let source: EventSource | null = null;
let connection: ConnectionState = 'connecting';

function emit(event: ServerEvent): void {
  for (const listener of [...listeners]) listener(event);
}

function setConnection(state: ConnectionState): void {
  if (state === connection) return;
  connection = state;
  emit({ type: 'connection', state });
}

function openStream(): void {
  source = new EventSource('/api/events');
  // The server says "hello" as the first thing on every new connection (EventSource reconnects by
  // itself after a cut). A page loads its data and opens this stream at about the same time, so a
  // change in between would be missed: the hello makes every panel load once more, to close that gap.
  source.addEventListener('hello', () => {
    setConnection('live');
    emit({ type: 'hello' });
  });
  source.addEventListener('changed', (message) => {
    try {
      emit({ type: 'changed', event: JSON.parse((message as MessageEvent<string>).data) as ChangeEvent });
    } catch (error) {
      console.error('A "changed" event from the server could not be read:', error);
    }
  });
  source.addEventListener('error', () => setConnection('offline'));
}

/**
 * Listens to the server's events. All listeners share one connection, which opens with the first
 * of them and closes with the last. The listener is told the connection state at once, then each
 * change. Returns the function that stops listening.
 */
export function subscribeEvents(listener: (event: ServerEvent) => void): () => void {
  listeners.add(listener);
  listener({ type: 'connection', state: connection });
  if (source === null) openStream();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source !== null) {
      source.close();
      source = null;
      connection = 'connecting';
    }
  };
}
