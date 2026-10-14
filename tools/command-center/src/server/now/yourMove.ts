import type { AgentsLive, DecisionsInfo, GithubInfo, Panel, SessionInfo, SessionsInfo, YourMoveInfo, YourMoveSource } from '../../shared/types';
import { ASK_MAX_LINES, type LiveAsk, askStatus, buildYourMoveItems, cutLine } from '../../shared/your-move';
import { inlineText } from '../engine/decisions';

// "Your move" on the local page. The rule itself is shared with the hosted page (src/shared/your-move.ts); this file only reads the panels of the sources and
// hands the rule its input. It reads no file and runs no command: it is a plain function from four panels to a list, so a test can feed it any mix of good and failed panels.
//
// Three sources (design.md section 5.1): the open decision issues, the pull requests that wait for Mark, and the live asks (the newest "Your move" box of a live session).
// The "Next up for Mark" list of status.md and the open decisions of the engine docs are not sources any more: they link only to text and do not clear themselves.

/** The four panels that the list is made from. */
export type YourMoveSources = {
  decisionIssues: Panel<DecisionsInfo>;
  sessions: Panel<SessionsInfo>;
  github: Panel<GithubInfo>;
  /** The live sessions: the process list of Claude Code. Rule 1 of a live ask reads it. */
  agents: Panel<AgentsLive>;
};

/**
 * The data of a panel, or null when there is none. A failed panel still carries the last data that did load (`lastGood`). The decisions and the pull requests read it:
 * a list that is a little old is still the list of what waits for Mark, and the notice names the source that failed.
 */
function dataOf<T>(panel: Panel<T>): T | null {
  return panel.ok ? panel.data : (panel.lastGood?.data ?? null);
}

/** The data of a panel that is good NOW, else null. A live ask reads only this: the last good data of a failed panel says which sessions ran, and which boxes were open, some time ago. */
function freshOf<T>(panel: Panel<T>): T | null {
  return panel.ok ? panel.data : null;
}

/**
 * The ask of a session, or null when one of the four rules hides it. The words of a line may carry markdown (`code`, **bold**), and the list is plain text.
 * Rule 1 (the session is live) is whether the process list of Claude Code has the session. Rules 2 to 4 are `askStatus`; "a newer box replaced it" is done by
 * `extractYourMove`, which keeps only the newest box.
 */
function askOf(session: SessionInfo, liveIds: ReadonlySet<string>, nowMs: number): LiveAsk | null {
  const box = session.yourMove;
  if (box === null || askStatus(box, liveIds.has(session.id), nowMs) !== 'show') return null;
  const lines = box.items
    .map((line) => cutLine(inlineText(line)))
    .filter((line) => line !== '')
    .slice(0, ASK_MAX_LINES);
  return { sessionId: session.id, title: session.title, lines, at: box.at === '' ? null : box.at, light: box.light };
}

/** The list for Mark, and the sources that could not be read in full. It never throws: a failed panel is named in `missing` and the other sources go on. */
export function buildYourMove(sources: YourMoveSources, nowMs: number = Date.now()): YourMoveInfo {
  const decisionIssues = dataOf(sources.decisionIssues);
  const github = dataOf(sources.github);
  const live = freshOf(sources.agents);
  const sessions = freshOf(sources.sessions);

  // No fresh process list or no fresh session read means no live asks (rule 1): an ask is never made from data that may be old.
  const liveIds = new Set((live?.sessions ?? []).map((session) => session.id));
  const asks = (sessions?.sessions ?? []).flatMap((session) => {
    const ask = askOf(session, liveIds, nowMs);
    return ask === null ? [] : [ask];
  });

  const items = buildYourMoveItems({ decisions: decisionIssues?.open ?? [], prs: github?.open ?? [], asks, nowMs });

  // Every failed source is named, also when it still gave items from its last good data: that data may be old (gh is signed out). The message is the source's own sentence.
  // The live asks need two sources, and both are named when they fail.
  const named: [YourMoveSource, Panel<unknown>][] = [
    ['decision-issue', sources.decisionIssues],
    ['session', sources.sessions],
    ['session', sources.agents],
    ['pr', sources.github],
  ];
  const missing = named.flatMap(([source, panel]) => (panel.ok ? [] : [{ source, message: panel.error.message }]));

  return { items, missing };
}
