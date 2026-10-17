import { OWNER, REPO } from '../github-api/queries';
import type { AnswerExecutor, AskExecutor, StepError } from '../server/decisions/answer-core';
import { LABEL_DECIDED, LABEL_DECISION, LABEL_NEEDS_INFO } from '../server/decisions/parse';

// The hosted executor of an answer (the local one is src/server/decisions/answer.ts, with `gh`). It writes through the REST API of GitHub, with the token of
// Mark's account, and it can write exactly these things to exactly one issue of the one repository that is a constant of this code:
//
//   1. POST   /repos/<repo>/issues/<n>/comments        { body }               the comment `Decision: <option>. <note>`, or `Question: <text>` (an Ask)
//   2. the labels: DELETE .../labels/decided (only when another account put it on), POST .../labels { labels: ["decided"] }, DELETE .../labels/decision
//   3. PATCH  /repos/<repo>/issues/<n>                 { state: "closed" }    the close
//   4. the label of an ask: POST .../labels { labels: ["needs-info"] } (an Ask), DELETE .../labels/needs-info (step 0 of an answer)
//
// Every write goes through `ghWrite`, which checks the method, the path and the body against that list before it sends anything. It is the same idea as the allow-list
// of the runner for `gh` (src/server/runner.ts): a bug elsewhere in the hosted code cannot write anything else, and cannot write to another repository or another issue.
// The token is used only in the Authorization header. It is not part of any message, result or log line.

const API = 'https://api.github.com';

/** The part of `fetch` that the hosted code uses, so that a test passes a small fake. `redirect: 'manual'` is for the protection probe. */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: 'manual' },
) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'text'>>;

/** The longest one call to GitHub may take, in milliseconds. */
export const CALL_TIMEOUT_MS = 10_000;
/** The write steps stop when less than this is left of the deadline (a write that starts and is cut off half way is the worst case). */
export const MIN_WRITE_MS = 5_000;

export type WriteRequest = { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);

/** The path of the issue (without the address of the API), for the issue number `number`. */
const issuePath = (number: number): string => `/repos/${OWNER}/${REPO}/issues/${number}`;

/**
 * Whether a write is one of the allowed shapes, for the issue `number` of the constant repository. Anything else is refused: another method, another path, another
 * issue, another repository, another label, and a body with other fields or other values (the close is exactly `{ state: "closed" }`).
 */
export function isAllowedWrite(request: WriteRequest, number: number): boolean {
  if (!Number.isInteger(number) || number < 1) return false;
  const base = issuePath(number);
  const { method, path, body } = request;
  if (method === 'POST' && path === `${base}/comments`) return isRecord(body) && sameKeys(body, ['body']) && typeof body.body === 'string';
  if (method === 'POST' && path === `${base}/labels`) return isRecord(body) && sameKeys(body, ['labels']) && Array.isArray(body.labels) && body.labels.length === 1 && (body.labels[0] === LABEL_DECIDED || body.labels[0] === LABEL_NEEDS_INFO);
  if (method === 'DELETE' && (path === `${base}/labels/${LABEL_DECIDED}` || path === `${base}/labels/${LABEL_DECISION}` || path === `${base}/labels/${LABEL_NEEDS_INFO}`)) {
    return body === undefined;
  }
  if (method === 'PATCH' && path === base) return isRecord(body) && sameKeys(body, ['state']) && body.state === 'closed';
  return false;
}

/** A write that `ghWrite` refused. It is a bug in the code that asked, never a condition of GitHub. */
export class WriteRefused extends Error {
  constructor(request: WriteRequest) {
    super(`refused write ${request.method} ${request.path}`);
    this.name = 'WriteRefused';
  }
}

/** The one gate for every write to GitHub. It throws WriteRefused for anything that is not one of the allowed shapes, before any request is made. */
export async function ghWrite(send: HttpFetch, token: string, request: WriteRequest, number: number): Promise<Pick<Response, 'ok' | 'status' | 'headers'>> {
  if (!isAllowedWrite(request, number)) throw new WriteRefused(request);
  return send(`${API}${request.path}`, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shadow-jog-command-center',
      ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
}

/** The error of a failed call: a code to test for and a fixed sentence. Nothing from the text of GitHub goes into it. */
function explainStatus(response: Pick<Response, 'status' | 'headers'>): StepError {
  const { status } = response;
  if (status === 401) return { code: 'unauthorized', message: 'GitHub does not accept the server token. Check the GITHUB_TOKEN variable.' };
  if (status === 403 || status === 429) {
    const limited = status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after') !== null;
    return limited
      ? { code: 'rate-limited', message: 'GitHub rate limit is used up. Wait, then press Retry.' }
      : { code: 'forbidden', message: 'The server token cannot write to the issue. Check that it has the Issues write permission.' };
  }
  if (status === 404) return { code: 'not-found', message: 'GitHub does not find the issue or the label. Reload the page.' };
  if (status === 422) return { code: 'rejected', message: 'GitHub refused the change.' };
  return { code: 'http-error', message: `GitHub answered with an error (HTTP ${status}). Press Retry.` };
}

function explainThrown(error: unknown): StepError {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError'
    ? { code: 'timeout', message: 'GitHub did not answer in time. Press Retry.' }
    : { code: 'network', message: 'GitHub could not be reached. Press Retry.' };
}

export type RestExecutorDeps = {
  token: string;
  /** The issue number. The gate allows writes to this issue only. */
  number: number;
  /** Sends a request. The caller wraps it (see `withDeadline`), so that each call is cut off at the time limit. */
  send: HttpFetch;
  /** The milliseconds that are left of the deadline of the whole request. */
  remainingMs: () => number;
};

/** The hosted executor: the writes of an answer and of an Ask, each through `ghWrite`. A step that the deadline cuts short fails with the code `deadline`, and a Retry resumes. */
export function createRestExecutor(deps: RestExecutorDeps): AnswerExecutor & AskExecutor {
  const { token, number, send, remainingMs } = deps;
  const base = issuePath(number);

  /** One write. `okOn404` is for the removal of a label that is not on the issue: it is done already. */
  async function write(request: WriteRequest, okOn404 = false): Promise<StepError | null> {
    // Do not start a write with too little time left: a Retry resumes from the step, so an early stop is safe and a call that is cut off half way is not.
    if (remainingMs() < MIN_WRITE_MS) return { code: 'deadline', message: 'There was not enough time to finish. Press Retry.' };
    try {
      const response = await ghWrite(send, token, request, number);
      if (response.ok || (okOn404 && response.status === 404)) return null;
      return explainStatus(response);
    } catch (error) {
      if (error instanceof WriteRefused) throw error;
      return explainThrown(error);
    }
  }

  return {
    // Step 0 of an answer: a label that is not on the issue (404) is off already.
    unflag: () => write({ method: 'DELETE', path: `${base}/labels/${LABEL_NEEDS_INFO}` }, true),
    flag: () => write({ method: 'POST', path: `${base}/labels`, body: { labels: [LABEL_NEEDS_INFO] } }),
    comment: (body) => write({ method: 'POST', path: `${base}/comments`, body: { body } }),
    async labels(clearDecided) {
      if (clearDecided) {
        const cleared = await write({ method: 'DELETE', path: `${base}/labels/${LABEL_DECIDED}` }, true);
        if (cleared !== null) return cleared;
      }
      const added = await write({ method: 'POST', path: `${base}/labels`, body: { labels: [LABEL_DECIDED] } });
      if (added !== null) return added;
      return write({ method: 'DELETE', path: `${base}/labels/${LABEL_DECISION}` }, true);
    },
    close: () => write({ method: 'PATCH', path: base, body: { state: 'closed' } }),
  };
}

/** Mark's GitHub account: the login and the numeric id that the token must belong to. The id stays Mark's even if another account gets the name. */
export const MARK_ACCOUNT = { login: 'markhazlewood42', id: 79615015 } as const;

export type Viewer = { ok: true } | { ok: false; reason: 'wrong-owner' | 'github' };

/**
 * `GET /user` with the token: it must belong to Mark's account (login and id). A failed call, or an answer that is not understood, is `github`.
 * A reply with an `x-oauth-scopes` header means a classic token (fine-grained tokens do not send it), which reaches every repo of the account: that is `wrong-owner`, so no write happens.
 */
export async function checkTokenOwner(send: HttpFetch, token: string): Promise<Viewer> {
  try {
    const response = await send(`${API}/user`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'shadow-jog-command-center' } });
    if (!response.ok) return { ok: false, reason: 'github' };
    if (response.headers.get('x-oauth-scopes') !== null) return { ok: false, reason: 'wrong-owner' };
    const body: unknown = JSON.parse(await response.text());
    if (!isRecord(body) || typeof body.login !== 'string' || typeof body.id !== 'number') return { ok: false, reason: 'github' };
    return body.login.toLowerCase() === MARK_ACCOUNT.login && body.id === MARK_ACCOUNT.id ? { ok: true } : { ok: false, reason: 'wrong-owner' };
  } catch {
    return { ok: false, reason: 'github' };
  }
}

/**
 * Wraps a fetch so that each call is cut off at the smaller of `capMs` and the time left until `deadlineAt`, and so that no call starts after the deadline.
 * The cut-off is an AbortSignal; when the caller gave its own signal too, the first of the two wins.
 */
export function withDeadline(base: HttpFetch, capMs: number, deadlineAt: number, now: () => number = Date.now): HttpFetch {
  return (url, init) => {
    const left = deadlineAt - now();
    if (left <= 0) return Promise.reject(Object.assign(new Error('deadline'), { name: 'TimeoutError' }));
    const timeout = AbortSignal.timeout(Math.min(capMs, left));
    return base(url, { ...init, signal: init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout]) });
  };
}
