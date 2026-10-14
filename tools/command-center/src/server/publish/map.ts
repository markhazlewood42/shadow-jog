import { LIVE_ITEM_LIMITS, type LiveAgentItem, type LiveSessionRow, type LiveWorktree } from '../../shared/live';
import type { LiveSession, SessionInfo } from '../../shared/types';
import { ASK_MAX_CHARS, ASK_MAX_LINES, askStatus } from '../../shared/your-move';
import { inlineText } from '../inline-text';

// The allow-list mapper (design.md section 11.1). It is the only code that decides what leaves this machine.
//
// Each output field is written out by hand from a named input field. There is no spread (`...session`) and no copy of a whole object, so a
// field that a source adds later cannot get through by accident. The fields that leave:
//   session: id, title, branch, folder name, state, start time, agent names and counts, the agents (label, state, model family, start and end time; approved by Mark 2026-10-14), and the "Your move" ask (below)
//   worktree: folder name (the last folder of its path, never the full path), branch, dirty count
// The ask (your-move-redesign.md section 4, approved by Mark 2026-10-13): per LIVE session, at most 6 lines of its newest "Your move" box, each as plain text, redacted like a
// title and then cut to 160 characters, with the time of the box. They are sent only when the box passes the four rules of src/shared/your-move.ts (the session is live,
// Mark has not answered, the box does not say "nothing", it is less than 12 hours old). Nothing else of any message.
// Never a prompt, a result, a file body, the path of a session file, or a working folder (only the NAME of its last folder), and no other part of a message.
// The hosted page joins a worktree to its workstream by BRANCH, so the name is only a label there.
//
// The result is checked once more with `parseLive` before every write (reporter.ts), and `parseLive` builds new objects from the fields that the
// contract names, so a field that this file did not intend would be dropped there too.

/** Limits for text that comes from a transcript, so that one odd value cannot make a very large write. */
export const LIMITS = { title: 120, branch: 200, folder: 100, agentName: LIVE_ITEM_LIMITS.label, agentNames: LIVE_ITEM_LIMITS.items, agentModel: LIVE_ITEM_LIMITS.model, sessions: 50, worktrees: 30 } as const;

/**
 * Cuts a text to `max` characters with an ellipsis. A redaction marker is never cut in the middle: when the cut would fall inside "[redacted]", the text is cut before the whole
 * marker, so the page never shows "[redact…" (which would look like a broken page and hides that a secret was there).
 */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  let moved = false;
  for (const match of text.matchAll(/\[redacted\]/g)) {
    if (match.index < end && match.index + match[0].length > end) {
      end = match.index;
      moved = true;
    }
  }
  return `${moved ? text.slice(0, end).trimEnd() : text.slice(0, end)}…`;
}

// Redaction of secret-shaped text. A session title is the text of a prompt, and a prompt can hold a pasted token. The rules run from the specific
// to the general, and each match is replaced by REDACTED. They run BEFORE the length cut, so the cut cannot leave the start of a token in the text.
// A rule that is too eager costs a word in a title. A rule that misses costs a secret on a hosted page, so the rules lean toward redacting.
export const REDACTED = '[redacted]';

const SECRET_PATTERNS: readonly RegExp[] = [
  // GitHub tokens: ghp_ gho_ ghu_ ghs_ ghr_ and the fine-grained github_pat_.
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  // OpenAI and Anthropic style keys: sk-..., sk-ant-...
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  // Stripe keys: sk_live_ sk_test_ pk_live_ pk_test_ rk_live_ rk_test_.
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_-]{6,}/g,
  // GitLab personal access tokens.
  /\bglpat-[A-Za-z0-9_-]{8,}/g,
  // Supabase keys.
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{6,}/g,
  // A bearer token in an Authorization header.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Slack tokens.
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/g,
  // A JWT or the start of one: eyJ... with optional dot-separated parts.
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)*/g,
  // An assignment of a secret-looking name: KEY=value, API_TOKEN=value, client_secret=value, PASSWORD=value. The whole assignment goes.
  /\b[A-Za-z0-9_.-]*(?:key|token|secret|password|passwd)[A-Za-z0-9_.-]*\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
  // A secret word with a colon or equals sign and a value, in prose: "password: hunter2", "pwd = x", "api key: abc".
  /\b(?:password|passwd|pwd|secret|token|api[\s_-]?key|apikey)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
  // A secret word followed by "is" or "was" and a value of 8 or more characters: "my token is abcdefghijklmnop".
  /\b(?:password|passwd|pwd|secret|token|api[\s_-]?key|apikey)\s+(?:is|was)\s+(?:"[^"]{4,}"|'[^']{4,}'|\S{8,})/gi,
  // A secret word, a space and a value, with no colon, equals sign or "is": "password hunter2", "token AXabc...". Plain prose also has "token refresh" and "password manager",
  // so the value must look like a value: it has a digit (the first rule) or a capital inside it (the second rule, which is case-sensitive on purpose).
  /\b(?:password|passwd|pwd|secret|token|api[\s_-]?key|apikey)\s+(?=\S*\d)\S{6,}/gi,
  /\b(?:[Pp]assword|[Pp]asswd|[Pp]wd|[Ss]ecret|[Tt]oken|[Aa]pi[\s_-]?[Kk]ey|[Aa]pikey|PASSWORD|PASSWD|PWD|SECRET|TOKEN|API[\s_-]?KEY|APIKEY)\s+(?=\S+[A-Z])\S{6,}/g,
  // The query parameters of a signed or authorized URL: ?sig=..., &signature=..., &auth=..., &code=..., ?key=..., &access_token=... The name stays out of the match start so the
  // "?" or "&" stays, and the value runs to the next "&", "#" or space.
  /(?<=[?&])(?:[A-Za-z0-9_.-]*sig(?:nature)?|auth(?:orization)?|code|key|[a-z_]*token)=[^\s&#]*/gi,
  // A URL with a user and a password: postgres://user:pass@host/db. The part up to the @ goes.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi,
];

/** A run of 24 or more characters of a token alphabet. Whether it is a secret depends on its shape (see `looksLikeKey`). */
const LONG_RUN = /[A-Za-z0-9_\-+/=]{24,}/g;

const mixesLettersAndDigits = (text: string): boolean => /[A-Za-z]/.test(text) && /[0-9]/.test(text);

/**
 * True for one piece of text without a slash that looks like a key: 32 or more token characters (even all letters or all digits),
 * or 24 or more that mix letters and digits. A git hash of 40 characters is redacted too. A hash shorter than 32 passes.
 */
function pieceLooksLikeKey(piece: string): boolean {
  return piece.length >= 32 || (piece.length >= 24 && mixesLettersAndDigits(piece));
}

/**
 * A run can hold slashes, because base64 uses them, and so does a file path. A path like "tools/command-center/src/server/publish/map" must pass,
 * so a run with slashes counts as a key when one piece between the slashes looks like a key, or when the whole run is 32 or more characters of
 * mixed case and digits (a base64 key, not a lower-case path).
 */
function looksLikeKey(run: string): boolean {
  if (!run.includes('/')) return pieceLooksLikeKey(run);
  if (run.split('/').some(pieceLooksLikeKey)) return true;
  return run.length >= 32 && /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);
}

/** Replaces secret-shaped text with "[redacted]". Plain words, numbers and paths without a long key-like run pass through unchanged. */
export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.replace(LONG_RUN, (run) => (looksLikeKey(run) ? REDACTED : run));
}

/**
 * Redaction for a branch name or a folder name. These are joined by name on the hosted page (a session to its workstream by branch), and a
 * kebab-case branch like "command-center-step-5-local-reporter" is longer than 32 characters. So the named patterns run in full, but a long run
 * is judged piece by piece between the separators - / _ : one piece that looks like a key redacts the whole name, and a name of 32 or more
 * characters of mixed case and digits does too.
 */
export function redactName(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.replace(LONG_RUN, (run) => {
    if (run.split(/[-_/]/).some(pieceLooksLikeKey)) return REDACTED;
    return run.length >= 32 && /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run) ? REDACTED : run;
  });
}

/** The last folder name of a path, with either kind of slash. "" for a missing or empty path. */
export function folderName(cwd: string | null): string {
  if (cwd === null) return '';
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? '';
}

/** What the mapper reads from the sessions module for one session: the branch and the working folder. */
export type SessionFacts = Pick<SessionInfo, 'id' | 'branch' | 'cwd'> & { yourMove?: SessionInfo['yourMove'] };

/**
 * The ask of one live session: the lines of its box, or null when the box fails a rule. Each line goes through the markdown strip of the local list, then the SAME redaction
 * as a title (before the strip and after it, so that a mark inside a token cannot hide it), and then the cut. The cut comes last, so that it cannot leave the start of a token.
 * `nowMs` is the clock of the reporter. The session is live by construction: the mapper is called only for the sessions that the process list has.
 */
export function mapAsk(box: SessionInfo['yourMove'] | undefined, nowMs: number): LiveSessionRow['yourMove'] {
  // `Array.isArray` guards a value that is not a box at all (the facts come from another module): it sends nothing rather than throw.
  if (box === undefined || box === null || !Array.isArray(box.items) || askStatus(box, true, nowMs) !== 'show') return null;
  // The cut-and-cap here is repeated on purpose in src/shared/live.ts (askOf) and src/server/now/yourMove.ts: each place is a trust boundary of its own (defense in depth).
  const lines = box.items
    .map((line) => cut(redact(inlineText(redact(line))).trim(), ASK_MAX_CHARS))
    .filter((line) => line !== '')
    .slice(0, ASK_MAX_LINES);
  return lines.length === 0 ? null : { at: box.at, lines };
}

/** The time of a node as an ISO text, or null when it is missing or is not a time (a bad value must not reach the validator and refuse the whole write). */
const isoOrNull = (time: string | null): string | null => (typeof time === 'string' && !Number.isNaN(Date.parse(time)) ? time : null);

/**
 * The agents of a session for the hosted boxes: running first, then done, at most 20. Only agents (a workflow has no model and no clear start, and its name is in `names`).
 * Each field is written out by hand from the named node field: no spread, so no path, prompt or message count can get through.
 */
export function mapItems(nodes: readonly LiveSession['nodes'][number][]): LiveAgentItem[] {
  const agents = nodes.filter((node) => node.kind === 'agent');
  return [...agents.filter((node) => node.state === 'running'), ...agents.filter((node) => node.state === 'done')].slice(0, LIMITS.agentNames).map((node) => ({
    label: cut(redact(node.label), LIMITS.agentName),
    state: node.state,
    model: node.model === null ? null : cut(redactName(node.model), LIMITS.agentModel),
    startedAt: isoOrNull(node.startedAt),
    endedAt: isoOrNull(node.endedAt),
  }));
}

/** One live session as the contract wants it. `facts` is the sessions module's entry for the same id, or undefined when it has not looked yet. `nowMs` is the clock of the reporter. */
export function mapSession(live: LiveSession, facts: SessionFacts | undefined, nowMs: number): LiveSessionRow {
  const nodes = live.nodes;
  return {
    id: live.id,
    title: cut(redact(live.title), LIMITS.title),
    branch: cut(redactName(facts?.branch ?? ''), LIMITS.branch),
    folder: cut(redactName(folderName(facts?.cwd ?? null)), LIMITS.folder),
    state: live.state === 'working' ? 'working' : 'waiting',
    startedAt: live.startedAt,
    agents: {
      running: nodes.filter((node) => node.state === 'running').length,
      done: nodes.filter((node) => node.state === 'done').length,
      // The running ones first: they are the ones Mark looks for.
      names: [...nodes.filter((node) => node.state === 'running'), ...nodes.filter((node) => node.state === 'done')].slice(0, LIMITS.agentNames).map((node) => cut(redact(node.label), LIMITS.agentName)),
      items: mapItems(nodes),
    },
    yourMove: mapAsk(facts?.yourMove, nowMs),
  };
}

/** What the worktree reader found for one checkout. */
export type WorktreeFacts = { path: string; branch: string | null; dirty: number };

/**
 * One checkout. `path` in the contract holds the NAME of the last folder only, never the full path (the full path shows the user name and the layout
 * of the machine). The page joins a worktree to its workstream by branch, so it needs no more than a label.
 */
export function mapWorktree(facts: WorktreeFacts): LiveWorktree {
  return {
    path: cut(redactName(folderName(facts.path)), LIMITS.folder) || UNNAMED_FOLDER,
    branch: facts.branch === null ? null : cut(redactName(facts.branch), LIMITS.branch),
    dirty: Math.max(0, Math.floor(facts.dirty)),
  };
}

/** The contract wants a non-empty `path`. A path with no folder name (a drive root, say) gets this label. */
const UNNAMED_FOLDER = '(unnamed)';

/** The whole `live` value except `writtenAt`, which the reporter stamps when it writes. */
export type LiveBody = { sessions: LiveSessionRow[]; worktrees: LiveWorktree[] };

export function buildLiveBody(input: { sessions: readonly LiveSession[]; facts: readonly SessionFacts[]; worktrees: readonly WorktreeFacts[]; nowMs: number }): LiveBody {
  const byId = new Map(input.facts.map((facts) => [facts.id, facts] as const));
  return {
    sessions: input.sessions.slice(0, LIMITS.sessions).map((session) => mapSession(session, byId.get(session.id), input.nowMs)),
    worktrees: input.worktrees.slice(0, LIMITS.worktrees).map(mapWorktree),
  };
}
