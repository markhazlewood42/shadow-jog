import type { Snapshot } from '../../github-api/types';
import type { DecisionIssue, PullRequest, YourMoveInfo, YourMoveItem } from '../../shared/types';
import { type WorkstreamsView, cardAnchor, visibleCards } from './workstreams';

// "Your move" on the hosted page (design.md section 5.1). The sources are different from the local page: there is no session file and no status.md here.
// The list is, in order: the open decision issues, the `next_for_mark` lines of every workstream, and the pull requests that wait for Mark.
// The local page keeps `status.md` as its source and builds the list on the server (src/server/now/yourMove.ts).

/** The title of a decision issue without the "Decision:" that the issue template puts in front of it. The same rule as the local list. */
function questionOf(title: string): string {
  const stripped = title.replace(/^\s*decision\s*:\s*/i, '').trim();
  return stripped === '' ? title.trim() : stripped;
}

const orNull = (text: string): string | null => (text === '' ? null : text);

function decisionItem(issue: DecisionIssue): YourMoveItem {
  const at = orNull(issue.createdAt);
  if (issue.problem !== null) return { source: 'decision-issue', text: `Decision #${issue.number} is unreadable: ${issue.problem}`, href: orNull(issue.url), light: null, at };
  return { source: 'decision-issue', text: `Decision #${issue.number}: ${questionOf(issue.title)}`, href: `/decisions/${issue.number}`, light: null, at };
}

function prItem(pr: PullRequest): YourMoveItem {
  const text = pr.attention === 'merge' ? `PR #${pr.number} is ready to merge: ${pr.title}` : `PR #${pr.number} needs a fix: ${pr.title}`;
  return { source: 'pr', text, href: orNull(pr.url), light: null, at: orNull(pr.updatedAt) };
}

/** The `updated` day of a workstream file as an ISO time, or null. The day has no clock, so it counts from the start of the day (UTC). */
function dayToIso(day: string): string | null {
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function buildHostedYourMove(snapshot: Snapshot, view: WorkstreamsView): YourMoveInfo {
  const workstreamItems: YourMoveItem[] = visibleCards(view).flatMap((card) =>
    card.nextForMark.map((line) => ({
      source: 'workstream' as const,
      text: `${line} (workstream: ${card.title})`,
      href: `/workstreams#${cardAnchor(card.branch)}`,
      light: null,
      at: dayToIso(card.updated),
    })),
  );

  const items: YourMoveItem[] = [
    ...snapshot.decisions.open.map(decisionItem),
    ...workstreamItems,
    ...snapshot.github.open.filter((pr) => pr.attention !== null).map(prItem),
  ];

  // A problem of the snapshot means that a source may be incomplete. The list is still made; the notice says what may be missing.
  const missing: YourMoveInfo['missing'] = view.snapshotProblems.length === 0 ? [] : [{ source: 'workstream', message: `Snapshot incomplete: ${view.snapshotProblems[0]}` }];

  return { items, missing };
}
