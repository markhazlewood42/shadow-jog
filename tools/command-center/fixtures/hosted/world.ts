import type { Snapshot, WorkstreamRow } from '../../src/github-api/types';
import type { LiveAnswer } from '../../src/hosted/live';
import type { LiveState } from '../../src/shared/live';
import type { DecisionIssue, PullRequest } from '../../src/shared/types';
import { type WorkstreamResult, parseWorkstream } from '../../src/shared/workstream';

// A made-up world for the tests of the hosted page: builders for the snapshot of `/api/snapshot` and the answer of `/api/live`. The unit tests and the
// Playwright specs (which mock both endpoints with page.route) share them, so the two kinds of test agree on the shape. Nothing here names a real branch or person.

export const NOW_ISO = '2026-10-12T12:00:00.000Z';
export const NOW = new Date(NOW_ISO);

const day = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

export function pr(number: number, branch: string, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `Title of PR ${number}`,
    url: `https://github.com/fixture-owner/fixture-repo/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    branch,
    author: 'markhazlewood42',
    updatedAt: day(0),
    mergedAt: null,
    reviewDecision: null,
    reviews: [],
    checks: [],
    checksSummary: 'pass',
    attention: null,
    ...extra,
  };
}

/** The frontmatter text of a good workstream file. */
export function workstreamText(branch: string, extra: Record<string, string> = {}): string {
  const fields: Record<string, string> = { type: 'workstream', title: `Title of ${branch}`, branch, roadmap: 'M1', state: 'active', updated: '2026-10-11', ...extra };
  return `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n\nBody.\n`;
}

export function goodFile(branch: string, extra: Record<string, string> = {}): WorkstreamResult {
  return parseWorkstream(`docs/workstreams/${branch}.md`, workstreamText(branch, extra));
}

export function row(branch: string, extra: Partial<WorkstreamRow> = {}): WorkstreamRow {
  return {
    branch,
    head: { sha: 'a'.repeat(40), date: day(0), subject: `Commit on ${branch}` },
    pr: null,
    lookup: { sha: 'a'.repeat(40), source: 'branch-tip' },
    workstream: goodFile(branch),
    ...extra,
  };
}

export const ROADMAP = JSON.stringify({
  lanes: [
    { id: 'engine', title: 'Engine path' },
    { id: 'side', title: 'Side paths' },
  ],
  items: [
    { id: 'M1', lane: 'engine' },
    { id: 'S1', lane: 'side' },
  ],
});

export function decision(number: number, extra: Partial<DecisionIssue> = {}): DecisionIssue {
  return {
    number,
    title: `Decision: question ${number}`,
    url: `https://github.com/fixture-owner/fixture-repo/issues/${number}`,
    state: 'open',
    question: `Question ${number}`,
    context: null,
    options: [
      { id: 'A', text: 'Option A' },
      { id: 'B', text: 'Option B' },
    ],
    recommended: 'A',
    docs: [],
    raisedBy: null,
    waitsOn: null,
    createdAt: day(1),
    answer: null,
    problem: null,
    ...extra,
  };
}

export function snapshot(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    at: NOW_ISO,
    branches: [{ name: 'main', date: day(0), upstream: null, track: null, worktree: null, sha: 'b'.repeat(40), subject: 'Latest on main' }],
    github: { open: [], merged: [] },
    ci: { state: 'passing', createdAt: day(0), url: 'https://github.com/fixture-owner/fixture-repo/actions/runs/1' },
    decisions: { open: [], recent: [] },
    workstreams: [],
    main: { status: null, roadmap: ROADMAP, migration: null },
    problems: [],
    cost: [],
    ...extra,
  };
}

export function liveState(extra: Partial<LiveState> = {}): LiveState {
  return { writtenAt: NOW_ISO, sessions: [], worktrees: [], ...extra };
}

/** The answer of `/api/live` for a reporter in the given state. */
export function liveAnswer(state: 'online' | 'offline' | 'not-running', live: LiveState | null = liveState()): LiveAnswer {
  if (state === 'not-running') return { reporter: { state, writtenAt: null, ageSeconds: null, offlineAfterSeconds: 150 }, live: null };
  return { reporter: { state, writtenAt: live?.writtenAt ?? null, ageSeconds: state === 'online' ? 4 : 400, offlineAfterSeconds: 150 }, live };
}

/**
 * A snapshot with one of everything the Workstreams view shows: a card in review with a PR, a session and a worktree, a card with no PR, a merged card
 * that is still shown, a merged card that the 14-day rule hides, a file that fails the validator, and a bot branch with no file. Dates count back from NOW.
 */
export function richWorld(): { snapshot: Snapshot; live: LiveAnswer } {
  const reviewPr = pr(41, 'engine-m6-flip', { title: 'M6: flip the default', attention: 'merge', checksSummary: 'pass', reviewDecision: 'APPROVED' });
  const workstreams: WorkstreamRow[] = [
    row('engine-m6-flip', {
      pr: reviewPr,
      workstream: parseWorkstream(
        'docs/workstreams/engine-m6-flip.md',
        '---\ntype: workstream\ntitle: M6 flip default\nbranch: engine-m6-flip\nroadmap: M1\nstate: review\nnext_for_mark:\n  - Rename the required checks in the ruleset\nblocked_on: [61]\nupdated: 2026-10-11\n---\n',
      ),
    }),
    row('side-lab', { workstream: goodFile('side-lab', { title: 'Side lab', roadmap: 'S1', state: 'parked' }) }),
    row('recent-merged', { pr: pr(38, 'recent-merged', { state: 'MERGED', mergedAt: day(3) }), workstream: goodFile('recent-merged', { title: 'Recent merged', state: 'active' }) }),
    row('old-merged', { pr: pr(20, 'old-merged', { state: 'MERGED', mergedAt: day(15) }), workstream: goodFile('old-merged', { title: 'Old merged', state: 'merged' }) }),
    row('broken-file', { workstream: parseWorkstream('docs/workstreams/broken-file.md', workstreamText('broken-file', { state: 'done' })) }),
    row('dependabot/npm_and_yarn/vite-9', { workstream: null, pr: pr(55, 'dependabot/npm_and_yarn/vite-9', { author: 'dependabot' }) }),
  ];
  return {
    snapshot: snapshot({
      workstreams,
      github: { open: [reviewPr], merged: [] },
      decisions: { open: [decision(61, { title: 'Decision: Who owns the ruleset?', question: 'Who owns the ruleset?' })], recent: [] },
    }),
    live: liveAnswer(
      'online',
      liveState({
        sessions: [{ id: 's1', title: 'Flip the default', branch: 'engine-m6-flip', folder: 'shadow-jog', state: 'working', startedAt: day(0.1), agents: { running: 2, done: 1, names: ['reader', 'runner', 'builder'] } }],
        worktrees: [{ path: 'C:/work/shadow-jog-m6', branch: 'engine-m6-flip', dirty: 2 }],
      }),
    ),
  };
}
