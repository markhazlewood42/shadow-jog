import { say } from '../server/messages';
import { type DecisionIssue, type YourMoveItem, sessionHref } from './types';

// "Your move" (design.md section 5.1, your-move-redesign.md): the one rule that decides what waits for Mark. The local page (src/server/now/yourMove.ts)
// and the hosted page (src/web/hosted/your-move.ts) both call it, so the two pages cannot drift apart. It is pure: no file, no command, no clock of its own.
//
// Two sources, and every item of them clears itself:
//   1. Decision issues: open, with the label `decision`, made by `markhazlewood42`. The two modules that read them (src/server/decisions/module.ts, src/github-api/queries.ts)
//      ask GitHub for exactly those issues, so a `DecisionIssue` in `open` has passed the label and the author check. This file keeps the open ones.
//      Clears when the issue is closed.
//   2. Live asks: the lines of the newest "Your move" box of a live session. Clears by any one of the four rules in `askStatus`.
//
// Pull requests are not a source (Mark, 2026-10-13): the Pull requests panel already lists them with their review and checks, and a PR in both panels showed twice.
// Every item links to a place where Mark can act: a decision page or a live session.

/** A box older than this is old news (rule 4). */
export const ASK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * How far in the future a time may be before it is not believed. Two clocks differ a little (the machine that wrote the time, the machine that reads it), so a few seconds
 * ahead is normal. A time more than a minute ahead is a wrong clock or a forged value, and it would otherwise stay "fresh" for ever.
 */
export const FUTURE_SLACK_MS = 60 * 1000;

/** The most lines of one box that are shown or sent, and the longest line (design: your-move-redesign.md section 4). */
export const ASK_MAX_LINES = 6;
export const ASK_MAX_CHARS = 160;

/** Cuts a line to `max` characters, with an ellipsis. */
export function cutLine(text: string, max: number = ASK_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The facts of a box that the four rules read. `at` is the time of the reply that wrote the box ("" or null when its line has no time). */
export type BoxFacts = { nothing: boolean; answered: boolean; at: string | null };

/** Why an ask is hidden, or `show`. */
export type AskStatus = 'show' | 'not-live' | 'answered' | 'nothing' | 'old';

/**
 * The four rules. An ask hides when ANY of them holds:
 *   1. The session is not live (`live` is false: its process was not seen, or the `live` key is not fresh).
 *   2. Mark answered after the box (`answered`).
 *   3. The box says "Your move: nothing" (`nothing`). A newer box that replaced this one is not a case here: the box that reaches this function is already the newest one
 *      (`extractYourMove`), and a newer reply with no box leaves the box where it is.
 *   4. The box is more than 12 hours old. A box with no usable time is hidden too: its age cannot be shown to be inside the limit, and the safe reading is to hide.
 * A box that does not exist (null) is `nothing`.
 */
export function askStatus(box: BoxFacts | null, live: boolean, nowMs: number): AskStatus {
  if (!live) return 'not-live';
  if (box === null || box.nothing) return 'nothing';
  if (box.answered) return 'answered';
  const at = box.at === null || box.at === '' ? Number.NaN : Date.parse(box.at);
  // A time too far in the future is not a fresh box, it is a wrong time: hidden like an old one.
  if (Number.isNaN(at) || nowMs - at > ASK_MAX_AGE_MS || nowMs - at < -FUTURE_SLACK_MS) return 'old';
  return 'show';
}

/** A live ask: the lines of one box, plain text, with the session they belong to. `light` is only known locally (the reporter does not send it). */
export type LiveAsk = {
  sessionId: string;
  /** The title of the session. Transcript text: it is shown as text. */
  title: string;
  lines: string[];
  at: string | null;
  light: YourMoveItem['light'];
};

/** What the rule needs to make the list. */
export type YourMoveInput = {
  /** The open decision issues. */
  decisions: readonly DecisionIssue[];
  /** The asks that have already passed `askStatus` for their session. This function re-checks `at` against `nowMs` so a stale list cannot show an old ask. */
  asks: readonly LiveAsk[];
  nowMs: number;
};

const orNull = (text: string): string | null => (text === '' ? null : text);

/**
 * The title of a decision issue without the "Decision:" that the issue template puts in front of it ("Decision: <the question>"). A title that is only that word is kept
 * as it is. (`titleOf` in web/decisions/DecisionCard.tsx does the same for the page of a decision.)
 */
export function questionOf(title: string): string {
  const stripped = title.replace(/^\s*decision\s*:\s*/i, '').trim();
  return stripped === '' ? title.trim() : stripped;
}

/** Whether a decision waits for a session and not for Mark: he asked for more info and no `Info:` came yet (the phases `needs-info` and `needs-info-empty`). */
const waitsForInfo = (issue: DecisionIssue): boolean => issue.phase === 'needs-info' || issue.phase === 'needs-info-empty';

function decisionItem(issue: DecisionIssue): YourMoveItem {
  const at = orNull(issue.createdAt);
  // An issue that does not follow the template cannot be answered on its page. The item says so and links to the issue itself, where Mark can read it and fix it.
  // Comments cut short are not a broken issue: the page still opens and shows the notice, so the item links to the decision's own page.
  if (issue.problem !== null && issue.problem.includes(say('commentsCutNotice'))) {
    return { source: 'decision-issue', text: say('yourMoveCommentsCut', { number: issue.number }), href: `/decisions/${issue.number}`, light: null, at };
  }
  if (issue.problem !== null) return { source: 'decision-issue', text: `Decision #${issue.number} is unreadable: ${issue.problem}`, href: orNull(issue.url), light: null, at };
  return {
    source: 'decision-issue',
    text: `Decision #${issue.number}: ${questionOf(issue.title)}`,
    href: `/decisions/${issue.number}`,
    light: null,
    at,
    ...(waitsForInfo(issue) ? { waitingForInfo: true as const } : {}),
    ...(issue.phase === 'info-posted' ? { tag: 'More info posted' } : {}),
  };
}

function askItems(ask: LiveAsk, nowMs: number): YourMoveItem[] {
  // The same age rule as `askStatus`, applied again to the list that reaches this file: a list that was made long ago must not show a box that has grown old since.
  if (askStatus({ nothing: false, answered: false, at: ask.at }, true, nowMs) !== 'show') return [];
  return ask.lines
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, ASK_MAX_LINES)
    .map((line) => ({ source: 'session' as const, text: `${cutLine(line)} (session: ${ask.title})`, href: sessionHref(ask.sessionId), light: ask.light, at: ask.at }));
}

/**
 * The list, most blocking first: the open decision issues (a decision stops work, and only Mark can answer it), then the live asks. A decision with fresh info
 * (`info-posted`) comes first, because a session answered it and Mark can decide now. A decision that Mark asked about and that waits for a session
 * (`waitingForInfo`) comes last: the panel lists it apart, under "Waiting for info", and it does not count as an item for Mark.
 */
export function buildYourMoveItems(input: YourMoveInput): YourMoveItem[] {
  const open = input.decisions.filter((issue) => issue.state === 'open');
  const posted = open.filter((issue) => issue.phase === 'info-posted');
  const waiting = open.filter(waitsForInfo);
  const others = open.filter((issue) => issue.phase !== 'info-posted' && !waitsForInfo(issue));
  return [
    ...[...posted, ...others].map(decisionItem),
    ...input.asks.flatMap((ask) => askItems(ask, input.nowMs)),
    ...waiting.map(decisionItem),
  ].filter(hasActionPlace);
}

/**
 * The action rule (Mark, 2026-10-13): every item links to a place where he can act. An item whose link is missing or is not an address of this site or of GitHub (an issue
 * with no address) has no such place and is left out. A link to text of a doc is not one of the kinds, so no source makes one.
 */
function hasActionPlace(item: YourMoveItem): boolean {
  return item.href !== null && (item.href.startsWith('/decisions/') || item.href.startsWith('/agents#session-') || item.href.startsWith('https://github.com/'));
}
