import type { DocHeading } from '../../shared/types';
import { splitFrontmatter } from '../docs/frontmatter';
import { PanelError } from '../source';
import { ENGINE_DOCS, type RawDecision, anchorOfHeading, inlineText, sortByNumber } from './decisions';

// The decisions of docs/PHASE-0.2.md. They are not a table: each one is a line in the form
//
//   **5. What should happen to PixelLab?** — **OPEN (2026-10-04).** More words.
//
// with the options and the recommendation on the lines under it. The bold words after the dash
// start with the verdict: "decided", "answered" or "OPEN". A line of this form with another verdict
// is an error (see ANY_VERDICT_LINE). A decision is its line and the lines under it, up to the next
// decision or the next heading.

/**
 * A decision line: the number and the question in bold, a dash, and bold words that start with a
 * verdict. Anything else (a status note with bold words in it, a bold list item) is not a decision. (A line of this
 * shape with another verdict is an error: see ANY_VERDICT_LINE.) The dash is the em dash of the doc, and an en dash or a hyphen is
 * accepted too, because a text editor may change one into another.
 */
const DECISION_LINE = /^\*\*(\d+)\.\s+(.+?)\*\*\s+[—–-]+\s+\*\*((?:decided|answered|open)\b.*?)\*\*/i;

/**
 * The shape of a decision line with any verdict word. A line of this shape that `DECISION_LINE` does not accept has a verdict that this page does not know
 * ("deferred", "blocked", a typo), and it is an error. It is not skipped: a decision that vanishes from the list is a decision that Mark is not asked about.
 */
const ANY_VERDICT_LINE = /^\*\*(\d+)\.\s+.+?\*\*\s+[—–-]+\s+\*\*([^\s*]+)/;

/** A heading line (ATX style: one to six `#` and a space). */
const HEADING_LINE = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;

/** A fence of a code block: three backticks or three tildes. The fence that closes a block is of the same kind. */
const FENCE_LINE = /^\s*(`{3,}|~{3,})/;

type Found = { number: string; question: string; answer: string; startLine: number; headingAbove: string };

/**
 * The decisions of docs/PHASE-0.2.md, in numeric order. Each is `D<n>` (the docs say "decision 5")
 * and it is Mark's. Its `answer` is the bold words after the dash ("decided 2026-10-02: (a)"): that is
 * where the doc says what Mark answered, and it is what decides if the decision is open.
 * `headings` are the headings of the doc's page, so that a decision can say which heading to open
 * the doc at: the one above its line.
 *
 * The doc is read line by line and not as markdown blocks, because a decision is a paragraph that
 * can be followed by more lines and lists, and the line is all that tells it from other text. A
 * line inside a code block is never a decision, and never a heading.
 */
export function parsePhaseDecisions(markdown: string, headings: readonly DocHeading[] = []): RawDecision[] {
  const lines = splitFrontmatter(markdown).body.split('\n');
  const found: Found[] = [];
  /** The lines that start a heading: a decision never runs past one. */
  const headingLines: number[] = [];
  let fence: string | null = null;
  let headingAbove = '';

  lines.forEach((line, i) => {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker.charAt(0);
      else if (fence === marker.charAt(0)) fence = null;
      return;
    }
    if (fence !== null) return;

    const heading = HEADING_LINE.exec(line);
    if (heading !== null) {
      headingLines.push(i);
      headingAbove = inlineText(heading[1] ?? '');
      return;
    }
    const decision = DECISION_LINE.exec(line);
    if (decision !== null) {
      found.push({ number: decision[1] ?? '', question: inlineText(decision[2] ?? ''), answer: inlineText(decision[3] ?? ''), startLine: i, headingAbove });
      return;
    }
    const unknown = ANY_VERDICT_LINE.exec(line);
    if (unknown !== null) {
      throw new PanelError(
        'engine-decision-unreadable',
        `${ENGINE_DOCS.phase.path} decision ${unknown[1]} has a verdict that this page does not know: "${unknown[2]}". The bold words after the dash must start with decided, answered or OPEN.`,
      );
    }
  });

  const rows = found.map((decision, k): RawDecision => {
    const nextDecision = found[k + 1]?.startLine ?? lines.length;
    const nextHeading = headingLines.find((line) => line > decision.startLine) ?? lines.length;
    const id = `D${decision.number}`;
    return {
      id,
      number: id,
      source: 'phase-0.2',
      question: decision.question,
      answer: decision.answer,
      milestone: null,
      who: 'Mark',
      option: null,
      docSlug: ENGINE_DOCS.phase.slug,
      anchor: anchorOfHeading(headings, decision.headingAbove),
      text: lines.slice(decision.startLine, Math.min(nextDecision, nextHeading)).join('\n').trimEnd(),
    };
  });
  return sortByNumber(rows);
}
