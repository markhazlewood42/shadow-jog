import { type AnswerStep, BAD_NOTE_CHARACTERS } from '../../shared/types';
import { say } from '../messages';
import type { DecisionRead } from './module';
import { LABEL_DECISION, answerComment, normalizeQuestion, questionComment } from './parse';

// The rules of an answer to a decision, with no input and no output (pure). Two programs write the answer, and they share this file:
//
//   - the local server, through `gh` (answer.ts), and
//   - the hosted function `/api/answer`, through the REST API of GitHub (src/hosted/github-rest.ts).
//
// What is here: which steps an answer has, in which order, which of them are done already (`nextStep`), whether the answer may be made at all
// (`checkAnswer`), and the loop that makes the steps (`runAnswer`). How one step is written is the job of an executor (`AnswerExecutor`).
//
// The same file holds the other write of a decision, the Ask for more info (docs/command-center/needs-info-brief.md): two steps, in order, a `Question:` comment and then
// the label `needs-info` (`nextAskStep`, `checkAsk`, `runAsk`). An answer gets a step 0 before its comment: it takes `needs-info` off, so that a `Decision:` comment
// is only ever written on an issue without that label.
//
// This file imports nothing that reads a file, starts a process or serves HTTP, because the hosted function bundles it (tests/vercel-bundle.test.ts checks that).

// ---- what a request may hold (the local route and the hosted function check the same limits) ----

/** The longest option id that is read. The ids of the template are one letter; this leaves room, and keeps an error message short. */
export const MAX_OPTION_CHARS = 64;

/** Control characters that a note may not have. The rule is shared with the question box (src/shared/types.ts), so the page shows the error before it sends. */
export { BAD_NOTE_CHARACTERS };

/** The largest number that gh and GitHub take for an issue. A bigger one cannot be an issue, and must not reach GitHub. */
export const MAX_ISSUE_NUMBER = 2_147_483_647;

/** The steps of an answer, in the order they are made. `unflag` (step 0) is made only when the label `needs-info` is on the issue. */
export const STEPS: readonly AnswerStep[] = ['unflag', 'comment', 'label', 'close'];

/** Why a step failed: a short word to test for, and a sentence for Mark. */
export type StepError = { code: string; message: string };

export type AnswerResult = { ok: true } | { ok: false; step: AnswerStep; error: StepError };

/**
 * The writes of an answer. Each one returns null when it worked, or the error when it did not. An executor must write exactly these things
 * and nothing else: the removal of `needs-info`, a comment, the label swap, and the close.
 */
export type AnswerExecutor = {
  /** Step 0: takes the label `needs-info` off (a label that is not on the issue counts as done). */
  unflag(): Promise<StepError | null>;
  /** Posts the comment (`body` is made by `answerComment`). */
  comment(body: string): Promise<StepError | null>;
  /** Takes `decision` off and puts `decided` on, after taking `decided` off first when `clearDecided` is true. */
  labels(clearDecided: boolean): Promise<StepError | null>;
  /** Closes the issue. */
  close(): Promise<StepError | null>;
};

export type RunRequest = {
  executor: AnswerExecutor;
  /** The id of the option that Mark picked. The caller has checked that the issue has it (see `checkAnswer`). */
  option: string;
  /** What Mark added, or nothing. */
  note?: string | null;
  /** The first step to make: the steps before it are already done. The comment when this is not given. */
  from?: AnswerStep;
  /** True when `decided` is on the issue and another account put it there (see `checkAnswer`): the label step takes it off first, so that putting it on makes an event of Mark's. */
  clearDecided?: boolean;
};

/**
 * Makes the steps of an answer, from `from` on, and stops at the first that fails. The comment is `Decision: <option>. <note>`,
 * the label swap takes `decision` off and puts `decided` on (after taking `decided` off when another account put it there), and the close closes the issue.
 * The caller has read the issue and checked it (that it is Mark's decision, that it is open, and that it has this option), because only it knows what GitHub holds.
 */
export async function runAnswer(request: RunRequest): Promise<AnswerResult> {
  const { executor } = request;
  for (const step of STEPS.slice(STEPS.indexOf(request.from ?? 'comment'))) {
    const error =
      step === 'unflag'
        ? await executor.unflag()
        : step === 'comment'
          ? await executor.comment(answerComment(request.option, request.note ?? null))
          : step === 'label'
            ? await executor.labels(request.clearDecided === true)
            : await executor.close();
    if (error !== null) return { ok: false, step, error };
  }
  return { ok: true };
}

/** What `checkAnswer` says when the answer may go on: from which step. */
export type Accepted = { ok: true; from: AnswerStep; clearDecided?: true };
/** What it says when it may not: an HTTP status, a short code for a program to test, and a sentence for Mark. */
export type Rejection = { ok: false; status: 404 | 409 | 422; code: string; message: string };

const reject = (status: Rejection['status'], code: string, message: string): Rejection => ({ ok: false, status, code, message });

/**
 * The first step that is not done, from what GitHub holds. Step 0 (taking `needs-info` off) is done when the label is off. The comment counts as done only when the newest `Decision:` comment of
 * Mark's says what is asked now (the same option, the same note): a retry with another choice must post it, so that the newest
 * comment (the one that the agents read) is the one that Mark means. The label swap counts as done when `decided` is on the issue,
 * Mark's account put it on, and `decision` is off.
 */
export function nextStep(read: DecisionRead, option: string, note: string | null): AnswerStep {
  // Step 0: the label `needs-info` is on, so it comes off first. The comment of an answer is only ever written on an issue without it.
  if (read.ask.needsInfo) return 'unflag';
  const { comment, labelsSwapped } = read.progress;
  if (comment === null || comment.option !== option || comment.note !== note) return 'comment';
  return labelsSwapped ? 'close' : 'label';
}

/**
 * Checks an answer against the issue as GitHub holds it now (see `readDecision`), before anything is written:
 *
 * - 404: there is no such issue, or it is not a decision of Mark's (a stranger's issue with the label of the template on it).
 * - 409: it is answered already, or closed (it is not open, so there is nothing to answer).
 * - 422: the issue does not have this option.
 *
 * Otherwise the answer may go on, from the first step that is not done.
 */
export function checkAnswer(found: DecisionRead | null, option: string, note: string | null): Accepted | Rejection {
  if (found === null) return reject(404, 'decision-not-found', say('decisionNotFound'));
  const { issue } = found;
  if (issue.state === 'answered') {
    return reject(409, 'already-answered', issue.answer === null ? say('decisionAnswered', { number: issue.number }) : say('decisionAnsweredWith', { number: issue.number, option: issue.answer.option }));
  }
  if (issue.state === 'closed') return reject(409, 'not-open', say('decisionClosed', { number: issue.number }));
  if (!issue.options.some((candidate) => candidate.id === option)) {
    const listed = issue.options.map((candidate) => candidate.id).join(', ');
    return reject(422, 'unknown-option', listed === '' ? say('decisionNoOptions', { number: issue.number }) : say('decisionUnknownOption', { option, number: issue.number, listed }));
  }
  // `decided` is on the issue but not by Mark's account: take it off before the label step puts it on (see the top of answer.ts).
  return { ok: true, from: nextStep(found, option, note), ...(found.staleDecided ? { clearDecided: true as const } : {}) };
}

// ---- the Ask for more info ----

/** The steps of an Ask, in the order they are made. They are named like the first two steps of an answer (a failed step is shown with the same words). */
export type AskStep = Extract<AnswerStep, 'comment' | 'label'>;
export type AskResult = { ok: true } | { ok: false; step: AskStep; error: StepError };

/** The two writes of an Ask. An executor must write exactly these two things and nothing else. */
export type AskExecutor = {
  /** Posts the comment (`body` is made by `questionComment`). */
  comment(body: string): Promise<StepError | null>;
  /** Puts the label `needs-info` on. */
  flag(): Promise<StepError | null>;
};

/**
 * Makes the steps of an Ask, from `from` on, and stops at the first that fails: the `Question:` comment, then the label. The comment comes first because a failed label leaves a
 * state that the page shows and a Retry mends (`ask-unfinished`), while a label with no comment would show an ask with no question.
 */
export async function runAsk(request: { executor: AskExecutor; text: string; from: AskStep }): Promise<AskResult> {
  if (request.from === 'comment') {
    const failed = await request.executor.comment(questionComment(request.text));
    if (failed !== null) return { ok: false, step: 'comment', error: failed };
  }
  const error = await request.executor.flag();
  return error === null ? { ok: true } : { ok: false, step: 'label', error };
}

/** What `checkAsk` says when the Ask may go on: from which step, or `null` when there is nothing to write (the same question is asked and flagged already). */
export type AcceptedAsk = { ok: true; from: AskStep | null; text: string };

/**
 * The first step of an Ask that is not done, from what GitHub holds. The comment counts as done only when the ask point is a `Question:` that no `Info:` has answered, with the same
 * text after line ends are made alike and both ends trimmed: so a Retry never posts the question twice, and a question that was answered once can be asked again. The label counts
 * as done when `needs-info` is on the issue.
 */
export function nextAskStep(read: DecisionRead, text: string): AskStep | null {
  if (read.ask.pendingQuestion !== text) return 'comment';
  return read.ask.needsInfo ? null : 'label';
}

/**
 * Checks an Ask against the issue as GitHub holds it now, before anything is written:
 *
 * - 404: there is no such issue, or it is not a decision of Mark's.
 * - 409: it is answered or closed, or it is open but has no `decision` label (an answer stopped after the label swap: finish that first).
 *
 * Asking again on an issue that has `needs-info` is allowed.
 */
export function checkAsk(found: DecisionRead | null, text: string): AcceptedAsk | Rejection {
  if (found === null) return reject(404, 'decision-not-found', say('decisionNotFound'));
  const { issue } = found;
  if (issue.state === 'answered') {
    return reject(409, 'already-answered', issue.answer === null ? say('decisionAnswered', { number: issue.number }) : say('decisionAnsweredWith', { number: issue.number, option: issue.answer.option }));
  }
  if (issue.state === 'closed') return reject(409, 'not-open', say('decisionClosed', { number: issue.number }));
  if (!found.labels.includes(LABEL_DECISION)) return reject(409, 'not-a-decision', say('askNotDecision', { number: issue.number }));
  return { ok: true, from: nextAskStep(found, text), text };
}

/** The text of an Ask as it is written: line ends made alike, both ends trimmed. The local route and the hosted function use this one rule. */
export const askText = normalizeQuestion;
