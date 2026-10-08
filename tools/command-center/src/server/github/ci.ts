import type { CiMain } from '../../shared/types';
import { say } from '../messages';
import { PanelError } from '../source';
import { httpUrl, isRecord } from './github';

// The parser of the CI source: it reads what `gh run list --branch main --limit 1 --json status,conclusion,url,createdAt` prints (see GH_RUN_LIST in the runner) and
// makes the one word and the one time that the Status row "CI on main" shows. The repo is public, so the only thing in the run that becomes a link is an address that
// starts with http or https (httpUrl), and the run's other words are never copied.

/** A run that has finished and did not pass. `action_required` is a run that waits for someone to approve it: it did not pass either. */
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

/** A run that has not finished: it waits for a runner or for a gate, or it works. */
const UNFINISHED_STATUSES: ReadonlySet<string> = new Set(['queued', 'in_progress', 'waiting', 'pending']);

/** There is nothing to say about the run: no time and no address, so that the label "no run" never has a link or an age beside it. */
const NO_RUN: CiMain = { state: 'none', createdAt: null, url: null };

/** The failure for gh output that is not a list of runs. `detail` is one of the `ghDetail...` messages. */
const unreadable = (detail: string) => new PanelError('gh-bad-output', say('ghBadOutput', { subject: 'runs', ghDetail: detail }));

/** A word of gh's output in lower case (gh prints these in lower case; the case is not trusted), or '' when it is not text. */
const wordOf = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '');

/**
 * What a run says. A run that has not finished is `running`, whatever its conclusion field says (it has none yet). A finished one passed (`success`) or failed
 * (see FAILED_CONCLUSIONS). Anything else has no verdict and is `none`: a run that was canceled or skipped (a newer push cancels the run before it), one with
 * a status that GitHub adds later, and a finished run with no conclusion. A new word must never be taken for a pass.
 */
function stateOf(status: string, conclusion: string): CiMain['state'] {
  if (UNFINISHED_STATUSES.has(status)) return 'running';
  if (status !== 'completed') return 'none';
  if (conclusion === 'success') return 'passing';
  return FAILED_CONCLUSIONS.has(conclusion) ? 'failing' : 'none';
}

/**
 * Reads the text that `gh run list ... --limit 1` printed: a list with the newest run of the branch, or an empty list for a branch that never ran a workflow.
 * Throws a PanelError (code `gh-bad-output`) when the text is not a list of runs, so the row shows that and not a guess. Only the first entry counts: the call asks for one.
 */
export function parseGhRun(json: string): CiMain {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw unreadable(say('ghDetailOutputNotJson'));
  }
  if (!Array.isArray(parsed)) throw unreadable(say('ghDetailOutputNotList'));
  const [run] = parsed;
  if (run === undefined) return NO_RUN;
  if (!isRecord(run)) throw unreadable(say('ghDetailFirstEntryNotRun'));

  const state = stateOf(wordOf(run.status), wordOf(run.conclusion));
  if (state === 'none') return NO_RUN;
  // A time that is not a time is left out (the row then shows the state and no age), never replaced by a made-up one.
  const createdAt = typeof run.createdAt === 'string' && Number.isFinite(Date.parse(run.createdAt)) ? run.createdAt : null;
  return { state, createdAt, url: httpUrl(run.url) };
}
