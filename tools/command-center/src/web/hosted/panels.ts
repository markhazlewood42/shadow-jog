import type { Snapshot } from '../../github-api/types';
import type { LiveAnswer } from '../../hosted/live';
import { type LiveAgentItem, type LiveSessionRow, type LiveState, parseLive } from '../../shared/live';
import { APP_NAME, type AgentsLive, type DecisionDetail, type DecisionIssue, type GitInfo, type Health, type LiveNode, type LiveSession, type Panel } from '../../shared/types';
import type { HostedError } from './fetch';
import { HOSTED_REPO } from './mode';
import type { Slot } from './store';
import { type LiveStatus, liveStatusOf } from './workstreams';

// Pure maps from the two slots of the store to the data that the existing pages read. A page asks for `/api/github` and gets the part of the snapshot that the
// local server would have sent. Nothing here fetches: `resolve.ts` does that and calls these.

/** The time of day for a person ("14:03:09"). */
export function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString('en-GB', { hour12: false });
}

export const NOT_RUNNING_MESSAGE = 'Reporter not running. Sessions and worktrees show only while it runs.';
export const offlineMessage = (writtenAt: string | null): string => (writtenAt === null ? 'Reporter offline. The rows show its last state.' : `Reporter offline since ${clock(writtenAt)}. The rows show its last state.`);

/** A failed panel. `lastGood` carries the data that the page may still show under the error. */
export function failedPanel<T>(error: { code: string; message: string }, updatedAt: string | null, lastGood: { data: T; updatedAt: string } | null): Panel<T> {
  return { ok: false, error: { code: error.code, message: error.message }, updatedAt, lastGood };
}

/** A panel for a hosted error. `kept` is the data that was good before the error, with its time. */
export function errorPanel<T>(error: HostedError, kept: { data: T; updatedAt: string } | null): Panel<T> {
  return failedPanel(error, kept?.updatedAt ?? null, kept);
}

/** When this page started. Captured once, so the health answer does not change on every call. */
const STARTED_AT = new Date().toISOString();

export function hostedHealth(origin: string): Health {
  const repoUrl = `https://github.com/${HOSTED_REPO}`;
  return {
    ok: true,
    name: APP_NAME,
    version: 'hosted',
    startedAt: STARTED_AT,
    // The game does not run on Vercel with this page, so the first link is the repo.
    gameUrl: repoUrl,
    githubRepo: HOSTED_REPO,
    links: [
      { label: 'GitHub repo', url: repoUrl },
      { label: 'Roadmap', url: `${origin}/docs/roadmap/README` },
    ],
  };
}

/**
 * The branches of the GitHub panel. GitHub knows no checkout, so the "current" branch is `main` (the branch whose files and CI the page shows), level with itself.
 * A snapshot without `main` gives no current branch.
 */
export function gitInfoOf(snapshot: Snapshot): GitInfo {
  const hasMain = snapshot.branches.some((branch) => branch.name === 'main');
  return {
    current: hasMain ? 'main' : null,
    ahead: hasMain ? 0 : null,
    behind: hasMain ? 0 : null,
    branches: snapshot.branches.map((branch) => ({ name: branch.name, date: branch.date, upstream: `origin/${branch.name}`, track: null, worktree: null })),
    commits: [],
  };
}

export function decisionDetailOf(snapshot: Snapshot, number: number): DecisionDetail | null {
  const issue: DecisionIssue | undefined = [...snapshot.decisions.open, ...snapshot.decisions.recent].find((candidate) => candidate.number === number);
  return issue === undefined ? null : { ...issue, sections: [] };
}

// ---- live ----

/** What the live slot says about the reporter and about its value, without making any data for a page. */
export type LiveRead = {
  status: LiveStatus;
  /** The value of the key when it is a good value. Null when the reporter does not run, or the value is unreadable. */
  live: LiveState | null;
  /** The message to show under the data when the data is not fresh, or null. A failed request wins over the state of the reporter. */
  problem: { code: string; message: string } | null;
};

export function readLive(slot: Slot<LiveAnswer>): LiveRead {
  const answer = slot.data;
  if (answer === null) {
    const message = slot.error?.message ?? 'No answer from /api/live yet.';
    return { status: liveStatusOf({ reporterState: null, writtenAt: null, parseProblem: null, error: message }), live: null, problem: { code: slot.error?.code ?? 'no-answer', message } };
  }
  const state = answer.reporter.state;
  const known = state === 'online' || state === 'offline' || state === 'not-running';
  // A state that this page does not know is a problem, and the value that goes with it is not read: it may have a shape that this page does not know either.
  const parsed = state === 'not-running' || !known ? null : parseLive(answer.live);
  const parseProblem = !known ? `the reporter state "${String(state).slice(0, 40)}" is not known` : parsed !== null && !parsed.ok ? parsed.reason : null;
  const live = parsed !== null && parsed.ok ? parsed.live : null;
  const status = liveStatusOf({ reporterState: known ? state : 'offline', writtenAt: answer.reporter.writtenAt, parseProblem, error: null });

  let problem: LiveRead['problem'] = null;
  if (slot.error !== null) problem = { code: slot.error.code, message: slot.error.message };
  else if (state === 'not-running') problem = { code: 'reporter-not-running', message: NOT_RUNNING_MESSAGE };
  else if (parseProblem !== null) problem = { code: 'live-unreadable', message: `The live value is unreadable: ${parseProblem}.` };
  else if (state === 'offline') problem = { code: 'reporter-offline', message: offlineMessage(answer.reporter.writtenAt) };
  return { status, live, problem };
}

/** A stable id for an agent box: the same agent keeps its id while it moves from running to done, so its box does not blink. Twins (same start, same label) get a count. */
function nodeId(sessionId: string, item: LiveAgentItem, seen: Map<string, number>): string {
  const key = `${item.startedAt ?? ''}|${item.label}`;
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  return `${sessionId}|${key}|${count}`;
}

const byStart = (a: LiveNode, b: LiveNode): number => (a.startedAt === b.startedAt ? 0 : a.startedAt === null ? 1 : b.startedAt === null ? -1 : a.startedAt.localeCompare(b.startedAt));

/**
 * The agent boxes of one hosted session, as the same nodes that the local server makes, so the local Diagram draws them with the same look. The reporter sends `agents.items`
 * (label, state, model, times). An older reporter sends only the counts and the names: then the names stand in, the first `running` of them as running (the reporter lists
 * the running ones first), with no model and no time. A node has no file and no messages here. The id is made from the session, the start time and the label (with a count for twins), so it stays the same when an agent ends and moves in the list.
 */
export function nodesOf(session: LiveSessionRow): LiveNode[] {
  const { items, names, running } = session.agents;
  const facts =
    items ?? names.map((label, index): LiveAgentItem => ({ label, state: index < running ? 'running' : 'done', model: null, startedAt: null, endedAt: null }));
  const seen = new Map<string, number>();
  const nodes = facts.map(
    (item): LiveNode => ({
      id: nodeId(session.id, item, seen),
      parentId: session.id,
      kind: 'agent',
      label: item.label,
      model: item.model,
      state: item.state,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      filePath: null,
      messages: { count: 0, approximate: false },
    }),
  );
  // In order of start, as the local list is. A sort is stable, so nodes with no start time keep the order they came in.
  return nodes.sort(byStart);
}

export function agentsOf(live: LiveState): AgentsLive {
  const sessions: LiveSession[] = [...live.sessions]
    // The oldest first, as the local list is. A session with no start time goes last.
    .sort((a, b) => (a.startedAt === b.startedAt ? 0 : a.startedAt === null ? 1 : b.startedAt === null ? -1 : a.startedAt.localeCompare(b.startedAt)))
    .map((session) => ({ id: session.id, title: session.title, state: session.state, startedAt: session.startedAt, filePath: '', nodes: nodesOf(session) }));
  return { sessions, hiddenScripts: 0, source: 'process-list' };
}

/** The panel of `/api/agents`: the live sessions, or the reason there are none to show. */
export function agentsPanel(slot: Slot<LiveAnswer>): Panel<AgentsLive> {
  const read = readLive(slot);
  const data = read.live === null ? null : agentsOf(read.live);
  const writtenAt = read.live?.writtenAt ?? slot.at;
  if (read.problem === null && data !== null && writtenAt !== null) return { ok: true, data, updatedAt: writtenAt };
  const kept = data !== null && writtenAt !== null ? { data, updatedAt: writtenAt } : null;
  return failedPanel(read.problem ?? { code: 'no-answer', message: 'No answer from /api/live yet.' }, writtenAt, kept);
}
