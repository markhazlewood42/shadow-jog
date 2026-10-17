import { fetchDecisionForAnswer } from '../github-api';
import { BAD_NOTE_CHARACTERS, MAX_ISSUE_NUMBER, MAX_OPTION_CHARS, askText, checkAnswer, checkAsk, runAnswer, runAsk } from '../server/decisions/answer-core';
import { say } from '../server/messages';
import { isStrictVercelLogin } from '../server/publish/protection';
import { MAX_NOTE_CHARS, isBlankQuestion, questionLength } from '../shared/types';
import { bypassSecretIn, type Env, readGithubToken, readOrigin } from './env';
import { mapAdapterError } from './errors';
import { CALL_TIMEOUT_MS, checkTokenOwner, createRestExecutor, type HttpFetch, withDeadline } from './github-rest';
import { CACHE, jsonResponse } from './http';

// `POST /api/answer` (docs/command-center/hosted-answer-brief.md, option B): Mark answers a decision from the hosted page. The function writes with the token in
// `GITHUB_TOKEN`, which is Mark's own fine-grained token, so the comment and the label are by `markhazlewood42`, as the "Decisions for Mark" rule in CLAUDE.md needs.
//
// The same function takes Mark's ask for more info (docs/command-center/needs-info-brief.md, option A): the body field `action` is `"answer"` (the default) or `"ask"`. Every gate
// below runs for both. An ask writes a `Question:` comment and then the label `needs-info`, and never a `Decision:` comment, the label `decided` or a close. An answer on an issue
// that has `needs-info` takes the label off first (step 0).
//
// WHO MAY CALL IT. Vercel Authentication is the gate that says who clicked: only Mark's Vercel login gets through to this function. The function cannot read who
// passed the gate, and several other things also pass it (a Shareable Link, the Protection Bypass for Automation secret, an external user that Mark adds). So the
// function adds checks that FAIL CLOSED when the gate is gone or has a hole. They run in this order, and the first that fails ends the request. Nothing is written
// to GitHub before the token owner check and the re-read have passed.
//
//    1. method POST (405)
//    2. the settings: GITHUB_TOKEN and CC_ORIGIN (500 misconfigured)
//    3. the Host header is the host of CC_ORIGIN (403 wrong-host): so the probe below always tests the host that took this request
//    4. Content-Type is JSON (415): a plain HTML form cannot send it
//    5. Origin is CC_ORIGIN and Sec-Fetch-Site is same-origin (403 cross-site): another site in Mark's browser cannot post with his Vercel cookie
//    6. the body: size, JSON, action, number, option and note (413, 400, 422)
//    7. the bypass secret variable is not set (503 bypass-on)
//    8. the protection probe: CC_ORIGIN/api/snapshot, with no cookie, must answer with the Vercel login (503 protection-unproven)
//    9. the token belongs to Mark's account (500 misconfigured, 502 github)
//   10. the issue is read again from GitHub and checked like the local route does (404, 409, 422, 502)
//   11. the writes, from the first step that is not done (502 with the step)
//
// The headers of step 5 are easy to forge with curl, which is why steps 3 and 8 carry the weight against a caller that is not a browser.
// Every answer is `Cache-Control: no-store` and holds fixed sentences only. The token is never in an answer, a header or a log line, and a log line holds only the name of an error.

/** The most a request may carry. A note is at most 2000 characters, which is under 8 KB at four bytes each. */
const MAX_BODY_BYTES = 16 * 1024;
/** The deadline of the whole request. `maxDuration` of the functions is 30 s (vercel.json), so the function stops itself before Vercel stops it. */
const DEADLINE_MS = 25_000;
/** The limit of the protection probe. */
const PROBE_TIMEOUT_MS = 5_000;

export type AnswerDeps = {
  env: Env;
  /** Replaces the global `fetch` for GitHub and for the probe. A test sets it. */
  fetchImpl?: HttpFetch;
  /** The calendar clock, in milliseconds. It stamps the reply. A test sets it. */
  now?: () => number;
  /** The monotonic clock, in milliseconds, for the deadline. The calendar clock can jump, so the deadline does not read it. A test sets it. */
  clock?: () => number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An error answer: `{ ok: false, error: { code, message } }`, the same body as the local server sends, plus `step` for a failed write. */
function refuse(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return jsonResponse({ ok: false, error: { code, message }, ...extra }, status, CACHE.none, headers);
}

/** The media type of a Content-Type value, in lower case, without its parameters. */
const mediaTypeOf = (value: string | null): string => (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/**
 * Proves that the hosted page is behind Vercel Authentication: a request to `<origin>/api/snapshot` with no cookie and no token, `Accept: text/html` and manual redirects
 * (so that the redirect is seen, not followed) must get a 302 or 307 to the Vercel login (see `isStrictVercelLogin`). Everything else is "not proven": 200, 401, another
 * redirect, a network error, a timeout. (The reporter's check sends `Accept: application/json` and counts a 401 as protected. This one must not: with it a 401 would
 * mean that the gate is something else than the Vercel login.)
 */
async function protectionProven(send: HttpFetch, origin: string): Promise<boolean> {
  try {
    const reply = await send(`${origin}/api/snapshot`, { method: 'GET', headers: { Accept: 'text/html' }, redirect: 'manual' });
    return (reply.status === 302 || reply.status === 307) && isStrictVercelLogin(reply.headers.get('location'), origin);
  } catch {
    return false;
  }
}

type Wanted = { action: 'answer'; number: number; option: string; note: string | null } | { action: 'ask'; number: number; text: string };

/** The bytes of the body, or null when it is over `max` bytes. The read stops at the first chunk that passes the cap, so a body of any size costs at most `max` plus one chunk. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** The body of the request, or the answer to send back when it is not one this function can take. */
async function readBody(request: Request): Promise<Wanted | Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse(413, 'too-large', say('requestTooLarge', { max: MAX_BODY_BYTES }));
  // Content-Length can be missing or false, so the body is read as a stream and the read stops at the cap.
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (bytes === null) return refuse(413, 'too-large', say('requestTooLarge', { max: MAX_BODY_BYTES }));
  const text = new TextDecoder().decode(bytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, 'bad-json', say('requestNotJson'));
  }
  // Fields that are not named here (a repo, an owner, labels) are ignored: the repo is a constant of the code, and so are the writes.
  // A body that is not an object does not say what it is (an answer or an ask), so it gets the message of the ask, as on the local route.
  if (!isRecord(body)) return refuse(422, 'bad-request', say('requestAskNeedsText', { max: MAX_NOTE_CHARS }));
  // `action` is an allow-list: absent means an answer, and anything but the two words writes nothing.
  if (body.action !== undefined && body.action !== 'answer' && body.action !== 'ask') return refuse(422, 'bad-request', say('requestBadAction'));
  if (body.action === 'ask') return readAsk(body);
  if (typeof body.option !== 'string' || body.option === '' || body.option.length > MAX_OPTION_CHARS) return refuse(422, 'bad-request', say('requestNoOption'));
  if (typeof body.number !== 'number' || !Number.isInteger(body.number) || body.number < 1 || body.number > MAX_ISSUE_NUMBER) return refuse(422, 'bad-request', say('requestNoNumber'));
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return refuse(422, 'bad-request', say('requestNoteNotText'));
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_NOTE_CHARS) return refuse(422, 'note-too-long', say('noteTooLong', { max: MAX_NOTE_CHARS }));
  if (BAD_NOTE_CHARACTERS.test(note)) return refuse(422, 'bad-note', say('noteBadCharacter'));
  return { action: 'answer', number: body.number, option: body.option, note: note === '' ? null : note };
}

/** The body of an Ask: `number`, and `note` as the question (1 to 2000 characters after trimming, with at least one character that is not a space or zero-width, line breaks made `\n`). An `option` gives 422: a question picks nothing. */
function readAsk(body: Record<string, unknown>): Wanted | Response {
  if (typeof body.number !== 'number' || !Number.isInteger(body.number) || body.number < 1 || body.number > MAX_ISSUE_NUMBER) return refuse(422, 'bad-request', say('requestNoNumber'));
  if (body.option !== undefined) return refuse(422, 'bad-request', say('requestAskHasOption'));
  if (typeof body.note !== 'string') return refuse(422, 'bad-request', say('requestAskNeedsText', { max: MAX_NOTE_CHARS }));
  const text = askText(body.note);
  if (isBlankQuestion(text)) return refuse(422, 'bad-request', say('requestAskNeedsText', { max: MAX_NOTE_CHARS }));
  if (questionLength(text) > MAX_NOTE_CHARS) return refuse(422, 'note-too-long', say('noteTooLong', { max: MAX_NOTE_CHARS }));
  if (BAD_NOTE_CHARACTERS.test(text)) return refuse(422, 'bad-note', say('noteBadCharacter'));
  return { action: 'ask', number: body.number, text };
}

export async function handleAnswer(request: Request, deps: AnswerDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const clock = deps.clock ?? (() => performance.now());
  const deadlineAt = clock() + DEADLINE_MS;
  const base: HttpFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));

  // 1. method
  if (request.method !== 'POST') return refuse(405, 'method-not-allowed', 'Use POST for this address.', {}, { Allow: 'POST' });

  try {
    // 2. the settings. Without the token or the address nothing can be proved, so nothing is done.
    const token = readGithubToken(deps.env);
    const origin = readOrigin(deps.env);
    if (token === null || !origin.ok) return refuse(500, 'misconfigured', 'The hosted setup is incomplete.');

    // 3. the host
    const host = (request.headers.get('host') ?? new URL(request.url).host).toLowerCase();
    if (host !== origin.host) return refuse(403, 'wrong-host', `Answer from ${origin.origin}.`);

    // 4. JSON only
    if (mediaTypeOf(request.headers.get('content-type')) !== 'application/json') return refuse(415, 'unsupported-media-type', 'The request must be JSON.');

    // 5. same origin
    if (request.headers.get('origin') !== origin.origin || request.headers.get('sec-fetch-site') !== 'same-origin') return refuse(403, 'cross-site', 'The request did not come from this page.');

    // 6. the body
    const wanted = await readBody(request);
    if (wanted instanceof Response) return wanted;

    // 7. the bypass secret. Only its name is looked at.
    if (bypassSecretIn(deps.env)) return refuse(503, 'bypass-on', 'Protection Bypass for Automation is on for this project. Turn it off in the Vercel settings.');

    // 8. the protection probe
    if (!(await protectionProven(withDeadline(base, PROBE_TIMEOUT_MS, deadlineAt, clock), origin.origin))) {
      return refuse(503, 'protection-unproven', 'The page could not prove that it is private. Nothing was written.');
    }

    // 9. the owner of the token
    const send = withDeadline(base, CALL_TIMEOUT_MS, deadlineAt, clock);
    const owner = await checkTokenOwner(send, token);
    if (!owner.ok) {
      return owner.reason === 'wrong-owner' ? refuse(500, 'misconfigured', 'The hosted setup is incomplete.') : refuse(502, 'github', 'GitHub could not be asked. Nothing was written.');
    }

    // 10. the issue, as GitHub holds it now
    const found = await fetchDecisionForAnswer({ token, fetchImpl: send, timeoutMs: CALL_TIMEOUT_MS }, wanted.number);
    if (!found.ok) return refuse(502, 'github', mapAdapterError(found.error).error);
    if (found.data === 'too-many') return refuse(502, 'too-many', 'The issue has too many comments or labels to read. Nothing was written.');
    const executor = createRestExecutor({ token, number: wanted.number, send, remainingMs: () => deadlineAt - clock() });

    if (wanted.action === 'ask') {
      const asked = checkAsk(found.data, wanted.text);
      if (!asked.ok) return refuse(asked.status, asked.code, asked.message);
      // 11. the writes of an Ask. `from` is null when the same question is asked and flagged already: nothing to write.
      if (asked.from !== null) {
        const outcome = await runAsk({ executor, text: wanted.text, from: asked.from });
        if (!outcome.ok) return refuse(502, outcome.error.code, outcome.error.message, { step: outcome.step });
      }
      return jsonResponse({ ok: true, ask: { text: wanted.text, at: new Date(now()).toISOString() } }, 200, CACHE.none);
    }

    const checked = checkAnswer(found.data, wanted.option, wanted.note);
    if (!checked.ok) return refuse(checked.status, checked.code, checked.message);

    // 11. the writes
    const result = await runAnswer({ executor, option: wanted.option, note: wanted.note, from: checked.from, ...(checked.clearDecided === true ? { clearDecided: true } : {}) });
    if (!result.ok) return refuse(502, result.error.code, result.error.message, { step: result.step });
    return jsonResponse({ ok: true, answer: { option: wanted.option, note: wanted.note, at: new Date(now()).toISOString() } }, 200, CACHE.none);
  } catch (error) {
    // Only the name of the error is logged: its message could hold anything.
    console.error(`answer failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return refuse(500, 'internal', 'The server failed. Nothing more is known.');
  }
}
