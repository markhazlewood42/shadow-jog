import type { DecisionIssue, DecisionsInfo, DocDecision } from '../../shared/types';
import type { Config } from '../config';
import type { DocIndex } from '../docs/index';
import { classifyGhError } from '../github/errors';
import type { Hub } from '../hub';
import type { RunResult, Runner } from '../runner';
import { POLL_EVERY_MS, PanelError, type PanelSource, createPanelSource } from '../source';
import { type AnswerProgress, DECISION_FIELDS, LABEL_DECIDED, LABEL_DECISION, flattenEventPages, parseDecisionIssue, readDecisionIssue } from './parse';

// The decisions module: the decision issues of the repository, as a Panel of the ones that wait for Mark and the ones
// he answered in the last week. It reads GitHub through `gh`, and only reads: the one write of the command center (the
// answer) is in answer.ts, and it goes through the same runner, which has an exact list of the calls it allows.
//
// What it reads, and why:
//   - `gh issue list --label decision --state open`: the decisions that wait.
//   - `gh issue list --label decided --state all`: the decisions that were answered. An answer swaps the label `decision`
//     for `decided` and then closes the issue, so a decision whose answer stopped after the label swap is open and has
//     `decided`, and must stay on the page (with its answer marked as not complete) so that its Retry button keeps working.
//   - `gh api repos/<repo>/issues/<n>/events`, for the closed issues that were answered in the last week: the events say
//     who put the label `decided` on, and an issue counts as answered only when Mark's account did.

/** How many issues of each list gh is asked for (newest first). A repository of one person has a handful of decisions; this is room to grow. */
const LIST_LIMIT = 100;

/** An answer stays in the list of recent answers for 7 days. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export type DecisionsModuleDeps = {
  config: Config;
  /** The only way to run gh. */
  runner: Runner;
  /** The doc index: the headings that the issues link to are looked up in it. */
  docs: DocIndex;
  hub: Hub;
  /** The clock, as milliseconds. A test sets it, so that "the last week" is the one that its fixtures were made for. */
  now?: () => number;
};

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const unreadable = (what: string) => new PanelError('gh-bad-output', `gh printed something about the decision issues that this page cannot read: ${what}.`);

/** The error of a gh call that failed, named as the GitHub module names it (not signed in, offline, ...). */
function ghFailure(result: RunResult): PanelError {
  const { code, message } = classifyGhError(result.code, result.stderr);
  return new PanelError(code, message);
}

function parseJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw unreadable(`${what} is not JSON`);
  }
}

/**
 * Checks that an issue has the shape that gh promised (the fields of DECISION_FIELDS). An issue that is not a decision of Mark's is
 * an ordinary case and is left out without a word, but an issue that has the wrong shape means that gh changed, and an issue left
 * out for that reason could be a decision that waits for Mark. So that is an error, and the panel says so.
 */
function checkedIssue(entry: unknown, position: number): Json {
  if (!isRecord(entry)) throw unreadable(`entry ${position} is not an issue`);
  if (typeof entry.number !== 'number' || !Number.isInteger(entry.number) || entry.number < 1) throw unreadable(`entry ${position} has no issue number`);
  // An issue of an account that was deleted has an author that is null or empty: that is a stranger's issue, and it is left out. A missing field is another thing.
  if (entry.author === undefined) throw unreadable(`issue ${entry.number} has no author field`);
  if (!Array.isArray(entry.labels)) throw unreadable(`issue ${entry.number} has no list of labels`);
  return entry;
}

async function readList(runner: Runner, label: string, state: 'open' | 'all'): Promise<Json[]> {
  const result = await runner('gh', ['issue', 'list', '--label', label, '--state', state, '--limit', String(LIST_LIMIT), '--json', DECISION_FIELDS]);
  if (result.code !== 0) throw ghFailure(result);
  const parsed = parseJson(result.stdout, 'the list of issues');
  if (!Array.isArray(parsed)) throw unreadable('the list of issues is not a list');
  return parsed.map((entry, index) => checkedIssue(entry, index + 1));
}

/** The events of an issue, all pages, as one list. Only options that the runner allows for gh api: --paginate and --slurp. */
async function readEvents(config: Config, runner: Runner, number: number): Promise<unknown[]> {
  const result = await runner('gh', ['api', `repos/${config.githubRepo}/issues/${number}/events`, '--paginate', '--slurp']);
  if (result.code !== 0) throw ghFailure(result);
  return flattenEventPages(parseJson(result.stdout, `the events of issue ${number}`));
}

/** Whether a time is not more than 7 days before `now`. A time in the future (a clock that is a little off) counts as recent. A text that is not a time does not. */
function isRecent(at: string, now: number): boolean {
  const ms = Date.parse(at);
  return Number.isFinite(ms) && now - ms <= RECENT_MS;
}

/** What the list adds to an issue that the parser made: the words of each linked heading (from the doc index), and an address when gh gave none that can be used. */
function completed(config: Config, docs: DocIndex, issue: DecisionIssue): DecisionIssue {
  return {
    ...issue,
    url: issue.url === '' ? `https://github.com/${config.githubRepo}/issues/${issue.number}` : issue.url,
    docs: issue.docs.map((link) => ({ ...link, heading: docs.section(link.docId, link.anchor)?.heading ?? null })),
  };
}

/** The time of the answer as milliseconds, for sorting. */
const answeredAt = (issue: DecisionIssue): number => Date.parse(issue.answer?.at ?? '') || 0;

/**
 * The decisions module, as a source of a Panel of DecisionsInfo. It loads when it starts and then every 60 seconds, when a request
 * asks (`?refresh=1`, at most one in 10 seconds: see routes/panel.ts), and right after an answer. When gh fails the panel names the
 * cause (see github/errors.ts) and keeps the last list.
 */
export function createDecisionsSource(deps: DecisionsModuleDeps): PanelSource<DecisionsInfo> {
  const { config, runner, docs, hub } = deps;
  const now = deps.now ?? Date.now;

  return createPanelSource<DecisionsInfo>({
    name: 'decisions',
    async load() {
      // The headings of the linked docs come from the index, so wait for its first scan.
      await docs.ready();
      const [waiting, decided] = await Promise.all([readList(runner, LABEL_DECISION, 'open'), readList(runner, LABEL_DECIDED, 'all')]);
      // An issue can be in both lists (it has both labels): it is one issue.
      const raws = new Map<number, Json>();
      for (const raw of [...waiting, ...decided]) raws.set(raw.number as number, raw);

      const clock = now();
      const info: DecisionsInfo = { open: [], recent: [] };
      for (const raw of raws.values()) {
        let issue = parseDecisionIssue(raw, []);
        if (issue === null) continue; // not Mark's, or not a decision: left out
        // Only a closed issue that has an answer from the last week can turn out to be answered, and only the events can say so (who put the label decided on).
        if (issue.state === 'closed' && issue.answer !== null && isRecent(issue.answer.at, clock)) {
          issue = parseDecisionIssue(raw, await readEvents(config, runner, issue.number)) ?? issue;
        }
        if (issue.state === 'open') info.open.push(completed(config, docs, issue));
        else if (issue.state === 'answered' && issue.answer !== null && isRecent(issue.answer.at, clock)) info.recent.push(completed(config, docs, issue));
      }
      // The oldest question first, as a list of things to do. The newest answer first, as a list of what happened.
      info.open.sort((a, b) => a.number - b.number);
      info.recent.sort((a, b) => answeredAt(b) - answeredAt(a) || b.number - a.number);
      return info;
    },
    hub,
    everyMs: POLL_EVERY_MS,
  });
}

/**
 * The banners of one doc: an entry for each link of an open decision to a heading of the doc, in the order of the decisions. The page
 * shows each above the heading with that id. A decision that was answered has no banner, and neither has a link to another doc.
 */
export function bannersOf(info: DecisionsInfo, docId: string): DocDecision[] {
  const banners: DocDecision[] = [];
  for (const issue of info.open) {
    for (const link of issue.docs) {
      if (link.docId === docId && !banners.some((banner) => banner.number === issue.number && banner.anchor === link.anchor)) {
        banners.push({ number: issue.number, title: issue.title, anchor: link.anchor });
      }
    }
  }
  return banners;
}

/** A decision as GitHub holds it now, with how far its answer has got. */
export type DecisionRead = { issue: DecisionIssue; progress: AnswerProgress };

/** gh's words for an issue that is not there. (The words are those of gh 2.88, read from a real call.) */
const NO_SUCH_ISSUE = /could not resolve to an issue or pull request/i;

/**
 * Reads one issue from GitHub now, with its events, and reads it as a decision. Null when there is no such issue, and when the
 * issue is not a decision of Mark's (not his, or without the labels): the caller treats both as "not found". It throws a PanelError
 * when gh fails (not signed in, offline, ...), so that the caller can say so.
 *
 * The write route uses this, and not the list: the list can be a minute old, and a write must be decided on what GitHub holds now.
 */
export async function readDecision(config: Config, runner: Runner, number: number): Promise<DecisionRead | null> {
  const viewed = await runner('gh', ['issue', 'view', String(number), '--json', DECISION_FIELDS]);
  if (viewed.code !== 0) {
    if (NO_SUCH_ISSUE.test(viewed.stderr)) return null;
    throw ghFailure(viewed);
  }
  const raw = checkedIssue(parseJson(viewed.stdout, `issue ${number}`), 1);
  // An issue that is not Mark's decision needs no events: a stranger's issue is left alone after one call.
  if (readDecisionIssue(raw, []) === null) return null;
  return readDecisionIssue(raw, await readEvents(config, runner, number));
}
