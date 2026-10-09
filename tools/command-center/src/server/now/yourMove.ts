import { type Decision, type DecisionIssue, type DecisionsInfo, type GithubInfo, type Panel, type PullRequest, type SessionInfo, type SessionsInfo, type StatusInfo, type YourMoveInfo, type YourMoveItem, type YourMoveSource, sessionHref } from '../../shared/types';
import { docUrl } from '../docs/links';
import { slugOf } from '../docs/index';
import { inlineText } from '../engine/decisions';
import { say } from '../messages';
import { STATUS_DOC_PATH } from '../status/status';

// "Your move": every open action for Mark, in one list. The Now page shows it at the top. It is built from the panels of five
// sources that other routes already serve, so this file reads no file and runs no command: it is a plain function from five
// panels to a list, which is why a test can feed it any mix of good and failed panels.
//
// The order of the list is the order of the work that is most likely to block somebody:
//   1. the open decision issues (a decision stops work, and only Mark can answer it),
//   2. the "Your move" boxes that the live sessions wrote and Mark has not answered,
//   3. the pull requests that wait for him (merge, or fix),
//   4. the decisions of the engine docs that are open for him,
//   5. the "Next up for Mark" list of status.md.

/** The five panels that the list is made from. */
export type YourMoveSources = {
  decisionIssues: Panel<DecisionsInfo>;
  sessions: Panel<SessionsInfo>;
  status: Panel<StatusInfo>;
  github: Panel<GithubInfo>;
  docDecisions: Panel<Decision[]>;
};

/**
 * The data of a panel, or null when there is none. A failed panel still carries the last data that did load (`lastGood`), and this reads it.
 * That matters for two modules whose failure is partial: the engine module reports a bad `approvalRef` as a failed panel whose `lastGood` holds all
 * the decisions (only the "changed" flags are missing), and the status module does the same for a missing milestone table. In both the list
 * of what waits for Mark is complete, and a page that threw it away would hide his to-do list because of a broken table.
 */
function dataOf<T>(panel: Panel<T>): T | null {
  return panel.ok ? panel.data : (panel.lastGood?.data ?? null);
}

/** An item of the list. The fields that most items leave empty are null unless the caller gives them. */
function item(source: YourMoveSource, text: string, href: string | null, extra: Partial<Pick<YourMoveItem, 'light' | 'at'>> = {}): YourMoveItem {
  return { source, text, href, light: extra.light ?? null, at: extra.at ?? null };
}

/** An empty text from a file or from GitHub is "no time", not a time. */
const orNull = (text: string): string | null => (text === '' ? null : text);

// ---- the five sources ----

/**
 * The title of a decision issue without the "Decision:" that the issue template puts in front of it ("Decision: <the question>"): the list already says
 * that this is a decision. A title that is only that word is kept as it is. (The page of a decision does the same in `titleOf` of web/decisions/DecisionCard.tsx:
 * the server does not import code of the page app, so the rule is written twice.)
 */
function questionOf(title: string): string {
  const stripped = title.replace(/^\s*decision\s*:\s*/i, '').trim();
  return stripped === '' ? title.trim() : stripped;
}

function decisionIssueItem(issue: DecisionIssue): YourMoveItem {
  const at = orNull(issue.createdAt);
  // An issue that does not follow the template cannot be answered on its page. The item says so and links to the issue itself, where Mark can read it and fix it.
  if (issue.problem !== null) return item('decision-issue', say('yourMoveUnreadable', { number: issue.number, problem: issue.problem }), orNull(issue.url), { at });
  return item('decision-issue', `Decision #${issue.number}: ${questionOf(issue.title)}`, `/decisions/${issue.number}`, { at });
}

/**
 * The lines of the "Your move" box of a session, when Mark has something to do there: the session is not idle (an idle one has been quiet for hours, and its box
 * is old news), the box does not say "nothing", and no prompt of his came after it. The words of a line may carry markdown (`code`, **bold**), and the list is plain text.
 * The session's title is part of the text, because a line such as "Review the diff" means nothing without the session that wrote it. Each line links to the place of its
 * session on the Agents page (design 5.1: each item links to its source): `/agents#session-<id>`. That page draws only a session whose Claude process runs, and this
 * list keeps the items of a session for as long as the sessions module counts it as not idle (hours after its last reply, also when the process has ended). A link can
 * lead to a session that is not live then, and the item keeps it: the Agents page shows the label "Session not active" (web/agents/Diagram.tsx).
 */
function sessionItems(session: SessionInfo): YourMoveItem[] {
  const box = session.yourMove;
  if (session.state === 'idle' || box === null || box.nothing || box.answered) return [];
  return box.items.flatMap((line) => {
    const words = inlineText(line);
    return words === '' ? [] : [item('session', `${words} (session: ${session.title})`, sessionHref(session.id), { light: box.light, at: orNull(box.at) })];
  });
}

function pullRequestItem(pr: PullRequest): YourMoveItem {
  const text = say(pr.attention === 'merge' ? 'yourMovePrMerge' : 'yourMovePrFix', { number: pr.number, title: pr.title });
  return item('pr', text, orNull(pr.url), { at: orNull(pr.updatedAt) });
}

/** A decision of the engine docs that waits for Mark. It links to the doc at the heading of the decision. */
function docDecisionItem(decision: Decision): YourMoveItem {
  return item('doc-decision', `Decision ${decision.id}: ${decision.question}`, docUrl(decision.docSlug, decision.anchor ?? undefined));
}

/** The list for Mark, and the sources that could not be read in full. It never throws: a failed panel is named in `missing` and the other sources go on. */
export function buildYourMove(sources: YourMoveSources): YourMoveInfo {
  const decisionIssues = dataOf(sources.decisionIssues);
  const sessions = dataOf(sources.sessions);
  const github = dataOf(sources.github);
  const docDecisions = dataOf(sources.docDecisions);
  const status = dataOf(sources.status);

  const items: YourMoveItem[] = [
    ...(decisionIssues?.open ?? []).map(decisionIssueItem),
    ...(sessions?.sessions ?? []).flatMap(sessionItems),
    ...(github?.open ?? []).filter((pr) => pr.attention !== null).map(pullRequestItem),
    ...(docDecisions ?? []).filter((decision) => decision.status === 'open').map(docDecisionItem),
    // status.md is a doc of the site: its items link to it, and the reader finds them in the "Right now" section.
    ...(status?.nextUpForMark ?? []).map((entry) => item('status', entry.text, docUrl(slugOf(STATUS_DOC_PATH)))),
  ];

  // Every failed source is named, also when it still gave items from its last good data: that data may be old (gh is signed out) or complete (a
  // broken milestone table), and the notice says only that the source could not be read in full. The message is the source's own sentence.
  const named: [YourMoveSource, Panel<unknown>][] = [
    ['decision-issue', sources.decisionIssues],
    ['session', sources.sessions],
    ['pr', sources.github],
    ['doc-decision', sources.docDecisions],
    ['status', sources.status],
  ];
  const missing = named.flatMap(([source, panel]) => (panel.ok ? [] : [{ source, message: panel.error.message }]));

  return { items, missing };
}
