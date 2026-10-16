import type { AnswerStep } from '../../shared/types';
import type { Config } from '../config';
import { classifyGhError } from '../github/errors';
import { say } from '../messages';
import type { RunResult, Runner } from '../runner';
import { type AnswerExecutor, type AnswerResult, type RunRequest, type StepError, runAnswer } from './answer-core';
import { LABEL_DECIDED, LABEL_DECISION } from './parse';

// Mark's answer to a decision: the one write of the local command center. It posts one comment, swaps the label `decision` for
// `decided`, and closes the issue, through `gh`, in that order. Nothing else is written: no file, and no git operation. The
// runner (src/server/runner.ts) has an exact list of read commands and exactly these three write shapes, and it pins every
// call to the configured repository, so even a bug in this file cannot write anything else, or write to another repository.
//
// The rules of an answer (the steps and their order, `checkAnswer`, `nextStep`) are in answer-core.ts, which the hosted function shares. This file is
// the local executor of the three writes: they are `gh` calls. The hosted executor, with the REST API of GitHub, is src/hosted/github-rest.ts.
//
// The label step has a second call in one case. The route reads a decision as trusted only when Mark's account put the label `decided`
// on it (its newest `labeled` event). If `decided` is already on the issue and another account put it there, `--add-label` would do
// nothing (GitHub makes no event when the label is already on), and the answer could never become trusted. So in that case the label
// step first takes `decided` off and then puts it on, and the new `labeled` event is Mark's.
//
// The three steps are not one operation: each is a call to GitHub, and one can fail after the one before it worked. So a
// failure names the step that failed, and a retry starts at the first step that is not done (see `nextStep`), so that it never
// posts the same comment twice.

// The pure rules are re-exported, so that the callers of the local server keep one place to import from.
export { checkAnswer, nextStep, runAnswer } from './answer-core';
export type { Accepted, AnswerExecutor, AnswerResult, Rejection, StepError } from './answer-core';

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
function explain(step: AnswerStep, result: RunResult, config: Config): StepError {
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

/** The local executor: each write is one or two `gh` calls through the runner, which allows only these shapes. */
function ghExecutor(config: Config, runner: Runner, number: string): AnswerExecutor {
  const run = async (step: AnswerStep, calls: string[][]): Promise<StepError | null> => {
    for (const args of calls) {
      const result = await runner('gh', args);
      if (result.code !== 0) return explain(step, result, config);
    }
    return null;
  };
  return {
    comment: (body) => run('comment', [['issue', 'comment', number, '--body', body]]),
    labels: (clearDecided) =>
      run('label', [
        ...(clearDecided ? [['issue', 'edit', number, '--remove-label', LABEL_DECIDED]] : []),
        ['issue', 'edit', number, '--add-label', LABEL_DECIDED, '--remove-label', LABEL_DECISION],
      ]),
    close: () => run('close', [['issue', 'close', number]]),
  };
}

/**
 * Makes the steps of an answer, from `from` on, and stops at the first that fails. The route that calls this has read the
 * issue and checked it (that it is Mark's decision, that it is open, and that it has this option), because only it knows what GitHub holds.
 */
export async function answerDecision(request: AnswerRequest): Promise<AnswerResult> {
  const { config, runner, option } = request;
  const run: RunRequest = {
    executor: ghExecutor(config, runner, String(request.number)),
    option,
    note: request.note ?? null,
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.clearDecided === true ? { clearDecided: true } : {}),
  };
  return runAnswer(run);
}
