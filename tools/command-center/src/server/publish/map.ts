import type { LiveSession, SessionInfo } from '../../shared/types';
import type { LiveSessionRow, LiveWorktree } from '../../shared/live';

// The allow-list mapper (design.md section 11.1). It is the only code that decides what leaves this machine.
//
// Each output field is written out by hand from a named input field. There is no spread (`...session`) and no copy of a whole object, so a
// field that a source adds later cannot get through by accident. The fields that leave:
//   session: id, title, branch, folder name, state, start time, agent names and counts
//   worktree: path, branch, dirty count
// Never a message, a prompt, a result, a file body, the path of a session file, or a working folder (only the NAME of its last folder).
//
// The result is checked once more with `parseLive` before every write (reporter.ts), and `parseLive` builds new objects from the fields that the
// contract names, so a field that this file did not intend would be dropped there too.

/** Limits for text that comes from a transcript, so that one odd value cannot make a very large write. */
export const LIMITS = { title: 120, branch: 200, folder: 100, agentName: 80, agentNames: 20, sessions: 50, worktrees: 30 } as const;

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

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
];

/** A run of 24 or more characters of a token alphabet that mixes letters and digits, like a random key. */
const LONG_RUN = /[A-Za-z0-9_\-+/=]{24,}/g;

/** Replaces secret-shaped text with "[redacted]". Plain words, numbers and paths without a long mixed run pass through unchanged. */
export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.replace(LONG_RUN, (run) => (/[A-Za-z]/.test(run) && /[0-9]/.test(run) ? REDACTED : run));
}

/** The last folder name of a path, with either kind of slash. "" for a missing or empty path. */
export function folderName(cwd: string | null): string {
  if (cwd === null) return '';
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? '';
}

/** What the mapper reads from the sessions module for one session: the branch and the working folder. */
export type SessionFacts = Pick<SessionInfo, 'id' | 'branch' | 'cwd'>;

/** One live session as the contract wants it. `facts` is the sessions module's entry for the same id, or undefined when it has not looked yet. */
export function mapSession(live: LiveSession, facts: SessionFacts | undefined): LiveSessionRow {
  const nodes = live.nodes;
  return {
    id: live.id,
    title: cut(redact(live.title), LIMITS.title),
    branch: cut(facts?.branch ?? '', LIMITS.branch),
    folder: cut(folderName(facts?.cwd ?? null), LIMITS.folder),
    state: live.state === 'working' ? 'working' : 'waiting',
    startedAt: live.startedAt,
    agents: {
      running: nodes.filter((node) => node.state === 'running').length,
      done: nodes.filter((node) => node.state === 'done').length,
      // The running ones first: they are the ones Mark looks for.
      names: [...nodes.filter((node) => node.state === 'running'), ...nodes.filter((node) => node.state === 'done')].slice(0, LIMITS.agentNames).map((node) => cut(redact(node.label), LIMITS.agentName)),
    },
  };
}

/** What the worktree reader found for one checkout. */
export type WorktreeFacts = { path: string; branch: string | null; dirty: number };

export function mapWorktree(facts: WorktreeFacts): LiveWorktree {
  return { path: facts.path, branch: facts.branch === null ? null : cut(facts.branch, LIMITS.branch), dirty: Math.max(0, Math.floor(facts.dirty)) };
}

/** The whole `live` value except `writtenAt`, which the reporter stamps when it writes. */
export type LiveBody = { sessions: LiveSessionRow[]; worktrees: LiveWorktree[] };

export function buildLiveBody(input: { sessions: readonly LiveSession[]; facts: readonly SessionFacts[]; worktrees: readonly WorktreeFacts[] }): LiveBody {
  const byId = new Map(input.facts.map((facts) => [facts.id, facts] as const));
  return {
    sessions: input.sessions.slice(0, LIMITS.sessions).map((session) => mapSession(session, byId.get(session.id))),
    worktrees: input.worktrees.slice(0, LIMITS.worktrees).map(mapWorktree),
  };
}
