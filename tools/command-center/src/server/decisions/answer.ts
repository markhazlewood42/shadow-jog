import type { AnswerStep } from '../../shared/types';
import type { Config } from '../config';
import { classifyGhError } from '../github/errors';
import { say } from '../messages';
import type { RunResult, Runner } from '../runner';
import type { DecisionRead } from './module';
import { LABEL_DECIDED, LABEL_DECISION, answerComment } from './parse';

// Mark's answer to a decision: the one write of the command center. It posts one comment, swaps the label `decision` for
// `decided`, and closes the issue, through `gh`, in that order. Nothing else is written: no file, and no git operation. The
// runner (src/server/runner.ts) has an exact list of read commands and exactly these three write shapes, and it pins every
// call to the configured repository, so even a bug in this file cannot write anything else, or write to another repository.
//
// The label step has a second call in one case. The route reads a decision as trusted only when Mark's account put the label `decided`
// on it (its newest `labeled` event). If `decided` is already on the issue and another account put it there, `--add-label` would do
// nothing (GitHub makes no event when the label is already on), and the answer could never become trusted. So in that case the label
// step first takes `decided` off and then puts it on, and the new `labeled` event is Mark's.
//
// The three steps are not one operation: each is a call to GitHub, and one can fail after the one before it worked. So a
// failure names the step that failed, and a retry starts at the first step that is not done (see `nextStep`), so that it never
// posts the same comment twice.

/** The three steps, in the order they are made. */
const STEPS: readonly AnswerStep[] = ['comment', 'label', 'close'];

export type AnswerResult = { ok: true } | { ok: false; step: AnswerStep; error: { code: string; message: string } };

export type AnswerRequest = {
  config: Config;
  runner: Runner;
  /** The issue number. */
  number: number;
  /** The id of the option that Mark picked. The caller has checked that the issue has it (see `checkAnswer`). */
  option: string;
  /** What Mark added, or nothing. */
  note?: string | null;
  /** The first step to make: the steps before it are already done. The comment when this is not given. */
  from?: AnswerStep;
  /** True when `decided` is on the issue and another account put it there (see `checkAnswer`): the label step takes it off first, so that putting it on makes an event of Mark's. */
  clearDecided?: boolean;
};

/** gh's words when a label that a command names is not in the repository: `'decided' not found`. Another way to say it is accepted when it names one of our two labels. */
const LABEL_NOT_FOUND = /'([^']+)' not found|label[^\n]*\b(decided|decision)\b[^\n]*(?:not found|does not exist)/i;

/** The error of a step that failed: named, in words that say what to do. A label that the repository lacks is named, because Mark can make it. */
function explain(step: AnswerStep, result: RunResult, config: Config): { code: string; message: string } {
  if (step === 'label') {
    const missing = LABEL_NOT_FOUND.exec(result.stderr);
    if (missing !== null) {
      const name = missing[1] ?? missing[2] ?? LABEL_DECIDED;
      // The form says that the comment is posted and that Retry does not post it again (AnswerForm.tsx), so the message only names the label.
      return { code: 'label-missing', message: say('labelMissing', { name, repo: config.githubRepo }) };
    }
  }
  return classifyGhError(result.code, result.stderr);
}

/**
 * Makes the steps of an answer, from `from` on, and stops at the first that fails. The comment is `Decision: <option>. <note>`,
 * the label swap takes `decision` off and puts `decided` on (after taking `decided` off when another account put it there), and the close closes the issue. The route that calls this has read the
 * issue and checked it (that it is Mark's decision, that it is open, and that it has this option), because only it knows what GitHub holds.
 */
export async function answerDecision(request: AnswerRequest): Promise<AnswerResult> {
  const { config, runner, option } = request;
  const number = String(request.number);
  const calls: Record<AnswerStep, string[][]> = {
    comment: [['issue', 'comment', number, '--body', answerComment(option, request.note ?? null)]],
    label: [
      ...(request.clearDecided === true ? [['issue', 'edit', number, '--remove-label', LABEL_DECIDED]] : []),
      ['issue', 'edit', number, '--add-label', LABEL_DECIDED, '--remove-label', LABEL_DECISION],
    ],
    close: [['issue', 'close', number]],
  };
  for (const step of STEPS.slice(STEPS.indexOf(request.from ?? 'comment'))) {
    for (const args of calls[step]) {
      const result = await runner('gh', args);
      if (result.code !== 0) return { ok: false, step, error: explain(step, result, config) };
    }
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
function nextStep(read: DecisionRead, option: string, note: string | null): AnswerStep {
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
  // `decided` is on the issue but not by Mark's account: take it off before the label step puts it on (see the top of this file).
  return { ok: true, from: nextStep(found, option, note), ...(found.staleDecided ? { clearDecided: true as const } : {}) };
}
