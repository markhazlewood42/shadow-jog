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
    title: cut(live.title, LIMITS.title),
    branch: cut(facts?.branch ?? '', LIMITS.branch),
    folder: cut(folderName(facts?.cwd ?? null), LIMITS.folder),
    state: live.state === 'working' ? 'working' : 'waiting',
    startedAt: live.startedAt,
    agents: {
      running: nodes.filter((node) => node.state === 'running').length,
      done: nodes.filter((node) => node.state === 'done').length,
      // The running ones first: they are the ones Mark looks for.
      names: [...nodes.filter((node) => node.state === 'running'), ...nodes.filter((node) => node.state === 'done')].slice(0, LIMITS.agentNames).map((node) => cut(node.label, LIMITS.agentName)),
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
