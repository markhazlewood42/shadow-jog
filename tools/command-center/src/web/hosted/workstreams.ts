import type { Snapshot, WorkstreamRow } from '../../github-api/types';
import type { LiveSessionRow, LiveState, LiveWorktree } from '../../shared/live';
import type { PullRequest } from '../../shared/types';
import { STALE_AFTER_DAYS, type Workstream, type WorkstreamState, staleWorkstreamPaths } from '../../shared/workstream';

// The data of the Workstreams view (design.md section 5.9), made from the snapshot rows and the live key. Pure: the same input gives the same cards, so a
// test can check every rule. The rules:
//   - one card for a row with a good workstream file; a red row for a bad file (the path and the error); a neutral "no workstream" row for a branch with none;
//   - the PR decides "merged": a merged PR makes the card merged, whatever `state` the file says;
//   - a card whose PR merged more than 14 days ago is hidden (the shared `staleWorkstreamPaths` decides, and the same age rule covers a row with no file);
//   - cards are grouped by the roadmap lane of the item that the file names (`roadmap`).

/** The reporter, as the view needs it: who says the live rows are fresh or not. `error` is a failed request for `/api/live` itself. */
export type LiveStatus =
  | { state: 'online'; writtenAt: string }
  | { state: 'offline'; writtenAt: string | null }
  | { state: 'not-running' }
  | { state: 'unreadable'; reason: string }
  | { state: 'error'; message: string };

export type WorkstreamCard = {
  kind: 'workstream';
  branch: string;
  path: string;
  title: string;
  roadmap: string;
  /** The state shown: `merged` when the PR merged, else the state of the file. */
  state: WorkstreamState;
  /** The state the file claims. It differs from `state` only when the PR merged. */
  fileState: WorkstreamState;
  nextForMark: string[];
  blockedOn: number[];
  updated: string;
  pr: PullRequest | null;
  head: WorkstreamRow['head'];
  sessions: LiveSessionRow[];
  worktrees: LiveWorktree[];
};

/** A file that failed the validator (or a file on a branch whose name is outside the rule). */
export type InvalidRow = { kind: 'invalid'; branch: string; path: string; message: string };

/** A branch with no workstream file (a bot branch, or a branch that has not written one yet). */
export type NoWorkstreamRow = { kind: 'none'; branch: string; pr: PullRequest | null; head: WorkstreamRow['head'] };

export type Lane = { id: string; title: string; cards: WorkstreamCard[] };

export type WorkstreamsView = {
  /** Red rows first: they need a fix. */
  invalid: InvalidRow[];
  lanes: Lane[];
  none: NoWorkstreamRow[];
  /** Why the lanes are not the roadmap's own (the file is missing or unreadable), or null. */
  roadmapProblem: string | null;
  /** How many merged cards the 14-day rule hid. */
  hiddenMerged: number;
  /** Whether the live rows (sessions, worktrees) are fresh, stale or missing. The view says so above the cards. */
  live: LiveStatus;
  /** The messages of the parts of the snapshot that failed while the rest worked. */
  snapshotProblems: string[];
};

export const UNPLACED_LANE: { id: string; title: string } = { id: 'unplaced', title: 'No roadmap lane' };

type RoadmapLanes = { lanes: { id: string; title: string }[]; laneOfItem: Map<string, string> };

/** Reads the lanes and the item-to-lane map from the text of `roadmap.json`. Never throws. */
export function parseRoadmapLanes(text: string | null): { ok: true; roadmap: RoadmapLanes } | { ok: false; reason: string } {
  if (text === null) return { ok: false, reason: 'docs/roadmap/roadmap.json is missing on main' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'docs/roadmap/roadmap.json is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'docs/roadmap/roadmap.json is not an object' };
  const { lanes, items } = parsed as { lanes?: unknown; items?: unknown };
  if (!Array.isArray(lanes) || !Array.isArray(items)) return { ok: false, reason: 'docs/roadmap/roadmap.json has no "lanes" or no "items" list' };
  const laneList: { id: string; title: string }[] = [];
  for (const lane of lanes) {
    if (typeof lane === 'object' && lane !== null && typeof (lane as { id?: unknown }).id === 'string' && typeof (lane as { title?: unknown }).title === 'string') {
      laneList.push({ id: (lane as { id: string }).id, title: (lane as { title: string }).title });
    }
  }
  const laneOfItem = new Map<string, string>();
  for (const item of items) {
    if (typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { lane?: unknown }).lane === 'string') {
      laneOfItem.set((item as { id: string }).id, (item as { lane: string }).lane);
    }
  }
  return { ok: true, roadmap: { lanes: laneList, laneOfItem } };
}

/** The live status from the answer of `/api/live` and what parsing its value said. `error` is the failed request, when there was one and no answer came before. */
export function liveStatusOf(args: { reporterState: 'online' | 'offline' | 'not-running' | null; writtenAt: string | null; parseProblem: string | null; error: string | null }): LiveStatus {
  if (args.reporterState === null) return { state: 'error', message: args.error ?? 'No answer from /api/live yet.' };
  if (args.reporterState === 'not-running') return { state: 'not-running' };
  if (args.parseProblem !== null) return { state: 'unreadable', reason: args.parseProblem };
  if (args.reporterState === 'offline') return { state: 'offline', writtenAt: args.writtenAt };
  return { state: 'online', writtenAt: args.writtenAt ?? '' };
}

function laneIdOf(roadmapId: string, roadmap: RoadmapLanes | null): string {
  const lane = roadmap?.laneOfItem.get(roadmapId);
  return lane !== undefined && roadmap?.lanes.some((candidate) => candidate.id === lane) ? lane : UNPLACED_LANE.id;
}

/** True when the row's PR merged longer ago than 14 days. A file row goes through the shared stale logic; a row without a file uses the same age rule. */
function isStale(row: WorkstreamRow, prs: readonly { headRefName: string; mergedAt: string | null }[], now: Date): boolean {
  if (row.workstream !== null) return staleWorkstreamPaths([row.workstream.path], prs, now).length > 0;
  const mergedAt = row.pr?.mergedAt ?? null;
  if (row.pr === null || row.pr.state !== 'MERGED' || mergedAt === null) return false;
  return now.getTime() - new Date(mergedAt).getTime() > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

function card(row: WorkstreamRow, workstream: Workstream, path: string, live: LiveState | null): WorkstreamCard {
  const merged = row.pr?.state === 'MERGED';
  return {
    kind: 'workstream',
    branch: row.branch,
    path,
    title: workstream.title,
    roadmap: workstream.roadmap,
    state: merged ? 'merged' : workstream.state,
    fileState: workstream.state,
    nextForMark: workstream.next_for_mark,
    blockedOn: workstream.blocked_on,
    updated: workstream.updated,
    pr: row.pr,
    head: row.head,
    sessions: live?.sessions.filter((session) => session.branch === row.branch) ?? [],
    worktrees: live?.worktrees.filter((worktree) => worktree.branch === row.branch) ?? [],
  };
}

/** The order of cards inside a lane: what needs Mark first (review, blocked), then active, parked, merged; the newest first inside a state. */
const STATE_ORDER: Record<WorkstreamState, number> = { review: 0, blocked: 1, active: 2, parked: 3, merged: 4 };

function byState(a: WorkstreamCard, b: WorkstreamCard): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.updated.localeCompare(a.updated) || a.branch.localeCompare(b.branch);
}

export function buildWorkstreamsView(args: { snapshot: Snapshot; live: LiveState | null; liveStatus: LiveStatus; now: Date }): WorkstreamsView {
  const { snapshot, live, liveStatus, now } = args;
  const parsed = parseRoadmapLanes(snapshot.main.roadmap);
  const roadmap = parsed.ok ? parsed.roadmap : null;

  // Every PR the snapshot knows, for the stale rule: a branch with a PR that is not merged is live.
  const prs = [...snapshot.github.open, ...snapshot.github.merged, ...snapshot.workstreams.flatMap((row) => (row.pr === null ? [] : [row.pr]))].map((pr) => ({ headRefName: pr.branch, mergedAt: pr.mergedAt }));

  const invalid: InvalidRow[] = [];
  const none: NoWorkstreamRow[] = [];
  const cards: WorkstreamCard[] = [];
  let hiddenMerged = 0;

  for (const row of snapshot.workstreams) {
    if (isStale(row, prs, now)) {
      hiddenMerged += 1;
      continue;
    }
    const result = row.workstream;
    if (result === null) {
      none.push({ kind: 'none', branch: row.branch, pr: row.pr, head: row.head });
    } else if (!result.ok) {
      invalid.push({ kind: 'invalid', branch: row.branch, path: result.path, message: result.message });
    } else {
      cards.push(card(row, result.workstream, result.path, live));
    }
  }

  const lanes: Lane[] = [];
  const known = roadmap?.lanes ?? [];
  for (const lane of [...known, UNPLACED_LANE]) {
    const inLane = cards.filter((candidate) => laneIdOf(candidate.roadmap, roadmap) === lane.id).sort(byState);
    if (inLane.length > 0) lanes.push({ id: lane.id, title: lane.title, cards: inLane });
  }

  return {
    invalid,
    lanes,
    none: none.sort((a, b) => a.branch.localeCompare(b.branch)),
    roadmapProblem: parsed.ok ? null : parsed.reason,
    hiddenMerged,
    live: liveStatus,
    snapshotProblems: snapshot.problems.map((problem) => problem.message),
  };
}

/** The cards that the view shows, flat (the Your move list reads their `next_for_mark`). */
export function visibleCards(view: WorkstreamsView): WorkstreamCard[] {
  return view.lanes.flatMap((lane) => lane.cards);
}

/** The address of a card on the Workstreams page, as a hash. The branch has slashes in it, so they become dashes. */
export function cardAnchor(branch: string): string {
  return `ws-${branch.replace(/[^a-z0-9]+/g, '-')}`;
}
