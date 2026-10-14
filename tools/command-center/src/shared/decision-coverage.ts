import type { Decision, DecisionIssue } from './types';

// The check behind "an open decision of the engine docs must have a decision issue" (your-move-redesign.md section 5).
//
// "Your move" shows a decision only through its GitHub decision issue, because only an issue has a decision page where Mark can answer, and only an issue clears itself
// when it is closed. The decisions that the engine docs mark as open used to be listed in "Your move" as links to doc text. They are not any more. So an open doc
// decision with no issue is invisible to Mark, and this check names it: the docs page at /docs/decisions shows a warning, and a test fails on a fixture that has one.

/** Whether the decision waits for Mark himself. "Agent (FYI)" decisions do not. */
const waitsForMark = (decision: Decision): boolean => decision.who.trim().toLowerCase().startsWith('mark');

/** A decision id (`E12`, `D5`, `C1`) as a whole word in a text, in any case. */
function mentions(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
}

/**
 * Whether a decision issue is the issue of a doc decision. It is when the issue links to the heading of the decision (the same doc, the same heading id), or when
 * the title or the question names the decision's id ("Decision D5: What happens to PixelLab?"). An issue in any state counts: an answered issue whose doc has not
 * been updated yet is a doc to fix, not a decision that is missing its issue.
 */
export function issueCovers(issue: DecisionIssue, decision: Decision): boolean {
  if (decision.anchor !== null && issue.docs.some((link) => link.slug === decision.docSlug && link.anchor === decision.anchor)) return true;
  return mentions(issue.title, decision.id) || mentions(issue.question, decision.id);
}

/**
 * The open decisions of the engine docs that wait for Mark and have no decision issue, in the order of the docs. `issues` is every issue the decisions module knows
 * (the open ones and the recent answers).
 */
export function decisionsWithoutIssue(decisions: readonly Decision[], issues: readonly DecisionIssue[]): Decision[] {
  return decisions.filter((decision) => decision.status === 'open' && waitsForMark(decision) && !issues.some((issue) => issueCovers(issue, decision)));
}
