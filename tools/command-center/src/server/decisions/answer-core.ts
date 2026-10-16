import type { AnswerStep } from '../../shared/types';
import { say } from '../messages';
import type { DecisionRead } from './module';
import { answerComment } from './parse';

// The rules of an answer to a decision, with no input and no output (pure). Two programs write the answer, and they share this file:
//
//   - the local server, through `gh` (answer.ts), and
//   - the hosted function `/api/answer`, through the REST API of GitHub (src/hosted/github-rest.ts).
//
// What is here: which steps an answer has, in which order, which of them are done already (`nextStep`), whether the answer may be made at all
// (`checkAnswer`), and the loop that makes the steps (`runAnswer`). How one step is written is the job of an executor (`AnswerExecutor`).
//
// This file imports nothing that reads a file, starts a process or serves HTTP, because the hosted function bundles it (tests/vercel-bundle.test.ts checks that).

// ---- what a request may hold (the local route and the hosted function check the same limits) ----

/** The longest option id that is read. The ids of the template are one letter; this leaves room, and keeps an error message short. */
export const MAX_OPTION_CHARS = 64;

/** Control characters that a note may not have: all of them but the tab and the two line breaks. They have no use in a note, and a null character cannot be sent as an argument. */
export const BAD_NOTE_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** The largest number that gh and GitHub take for an issue. A bigger one cannot be an issue, and must not reach GitHub. */
export const MAX_ISSUE_NUMBER = 2_147_483_647;

/** The three steps, in the order they are made. */
export const STEPS: readonly AnswerStep[] = ['comment', 'label', 'close'];

/** Why a step failed: a short word to test for, and a sentence for Mark. */
export type StepError = { code: string; message: string };

export type AnswerResult = { ok: true } | { ok: false; step: AnswerStep; error: StepError };

/**
 * The three writes of an answer. Each one returns null when it worked, or the error when it did not. An executor must write exactly these three
 * things and nothing else: a comment, the label swap, and the close.
 */
export type AnswerExecutor = {
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
      step === 'comment'
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
 * The first step that is not done, from what GitHub holds. The comment counts as done only when the newest `Decision:` comment of
 * Mark's says what is asked now (the same option, the same note): a retry with another choice must post it, so that the newest
 * comment (the one that the agents read) is the one that Mark means. The label swap counts as done when `decided` is on the issue,
 * Mark's account put it on, and `decision` is off.
 */
export function nextStep(read: DecisionRead, option: string, note: string | null): AnswerStep {
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
