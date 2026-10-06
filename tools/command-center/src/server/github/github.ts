import type { GithubInfo, PullRequest, PullRequestCheck, PullRequestReview } from '../../shared/types';
import { PanelError } from '../source';

// The parser of the GitHub module: it reads what `gh pr list --json ...` prints and makes the pull
// requests that the Now page shows. The repo is public, so the text of a pull request (its title,
// its branch, the words of a check) can come from anyone. Everything here is plain data that the
// page shows as text, and the only things that become links are addresses that start with http or
// https, so a pull request cannot put a script into a link of the page.

/** The fields that gh is asked for: the ones that PullRequest is made of. `latestReviews` has the words of each review too; they are asked for, because gh has no smaller field, and dropped. */
export const GH_PR_FIELDS = 'number,title,state,isDraft,headRefName,url,author,updatedAt,mergedAt,reviewDecision,latestReviews,statusCheckRollup';

/** How many pull requests gh is asked for, newest first. The repo has about 20; this is room to grow, and the call stays small. */
export const PR_LIMIT = 100;

/** A merged pull request stays in the list for this long after the merge: 7 days, as the design says. */
const MERGED_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mark's GitHub account: the one account whose pull requests can wait for him (see `attentionOf`), and,
 * for the decision inbox, the only one whose comments and labels count (the "Trust" rule). GitHub
 * logins are not case sensitive, so a login is compared in lower case.
 */
export const MARK_LOGIN = 'markhazlewood42';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** An ISO time as milliseconds, or 0 when it is not one (so a sort never meets NaN). */
function millisOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** The address, when it is an http or https address, else null. A `javascript:` or `data:` address in a link would run code in the page. */
function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  try {
    const { protocol } = new URL(address);
    return protocol === 'https:' || protocol === 'http:' ? address : null;
  } catch {
    return null; // not an address at all
  }
}

const unreadable = (what: string) => new PanelError('gh-bad-output', `gh printed a list of pull requests that this page cannot read: ${what}.`);

// ---- checks ----

type CheckStatus = PullRequestCheck['status'];

/**
 * What a check run says. A run that is not COMPLETED (it is queued, waiting or running) is pending. A
 * completed one has a conclusion: SUCCESS passes, SKIPPED and NEUTRAL have no verdict, and every
 * other one (FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE, STALE, and any that
 * GitHub adds later) counts as a failure, so that something new is never taken for a pass. A
 * completed run with no conclusion is not known to have passed: it is pending.
 */
function runStatus(status: string, conclusion: string): CheckStatus {
  if (status !== 'COMPLETED') return 'pending';
  if (conclusion === 'SUCCESS') return 'pass';
  if (conclusion === 'SKIPPED' || conclusion === 'NEUTRAL') return 'skipped';
  return conclusion === '' ? 'pending' : 'fail';
}

/** What a status context (the older kind of check, which another service reports) says. A state that is not known is pending. */
function contextStatus(state: string): CheckStatus {
  if (state === 'SUCCESS') return 'pass';
  return state === 'FAILURE' || state === 'ERROR' ? 'fail' : 'pending';
}

const UNKNOWN_CHECK = 'unknown check';

/** One entry of `statusCheckRollup`: a CheckRun, a StatusContext, or something that this does not know (kept, as pending). */
function toCheck(raw: unknown): PullRequestCheck {
  if (!isRecord(raw)) return { name: UNKNOWN_CHECK, status: 'pending', url: null };
  if (raw.__typename === 'CheckRun') {
    return { name: text(raw.name) || UNKNOWN_CHECK, status: runStatus(text(raw.status), text(raw.conclusion)), url: httpUrl(raw.detailsUrl) };
  }
  if (raw.__typename === 'StatusContext') {
    return { name: text(raw.context) || UNKNOWN_CHECK, status: contextStatus(text(raw.state)), url: httpUrl(raw.targetUrl) };
  }
  return { name: text(raw.name) || text(raw.context) || UNKNOWN_CHECK, status: 'pending', url: null };
}

/**
 * All the checks in one word. A failure comes first (it counts even while another check still runs),
 * then a check that is not done. Skipped checks do not count for or against: with only skipped ones
 * (or none) there is no verdict, and the word is `none`.
 */
function summarize(checks: readonly PullRequestCheck[]): PullRequest['checksSummary'] {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'pending')) return 'pending';
  return checks.some((check) => check.status === 'pass') ? 'pass' : 'none';
}

/**
 * What waits for Mark, in this order:
 *
 * 1. A pull request that is not open, or is a draft, waits for nothing.
 * 2. Neither does a pull request of another account. The repo is public, so anyone can open a pull
 *    request, and a stranger's must never reach Mark's "Your move" as "merge" or "fix" (it still shows in
 *    the list of pull requests). The agents work through Mark's login, so their pull requests are Mark's.
 * 3. `fix`: a check failed, or a reviewer asked for changes (whatever the checks say: it is not ready).
 * 4. `merge`: every check passes (and, by 3, nobody asked for changes).
 * 5. Anything else (checks still running, no checks, only skipped ones) waits for nothing yet.
 */
function attentionOf(pr: Pick<PullRequest, 'state' | 'isDraft' | 'author' | 'reviewDecision' | 'checksSummary'>): PullRequest['attention'] {
  if (pr.state !== 'OPEN' || pr.isDraft) return null;
  // The repo is public, so this may be a stranger's pull request. The agents work through Mark's login, so theirs are Mark's.
  if (pr.author.toLowerCase() !== MARK_LOGIN) return null;
  if (pr.checksSummary === 'fail' || pr.reviewDecision === 'CHANGES_REQUESTED') return 'fix';
  return pr.checksSummary === 'pass' ? 'merge' : null;
}

// ---- pull requests ----

/** One review of `latestReviews`: who, which verdict and when. The words of the review (`body`) are never copied. */
function toReview(raw: unknown): PullRequestReview | null {
  if (!isRecord(raw)) return null;
  return { by: (isRecord(raw.author) ? text(raw.author.login) : '') || 'unknown', state: text(raw.state), at: text(raw.submittedAt) };
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** One entry of gh's list. `position` counts from 1, for the message when the entry cannot be read. */
function toPullRequest(raw: unknown, position: number): PullRequest {
  if (!isRecord(raw)) throw unreadable(`entry ${position} is not a pull request`);
  const { number, state } = raw;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) throw unreadable(`entry ${position} has no pull request number`);
  if (state !== 'OPEN' && state !== 'MERGED' && state !== 'CLOSED') {
    throw unreadable(`pull request #${number} has the state ${state === undefined ? '(none)' : JSON.stringify(state)}, which this page does not know`);
  }

  const checks = listOf(raw.statusCheckRollup).map(toCheck);
  const checksSummary = summarize(checks);
  const isDraft = raw.isDraft === true;
  const author = (isRecord(raw.author) ? text(raw.author.login) : '') || 'unknown';
  const reviewDecision = text(raw.reviewDecision) || null; // gh prints "" when nobody has decided
  // gh prints a merge time of year 1 (or nothing) for a pull request that was not merged.
  const mergedAt = typeof raw.mergedAt === 'string' && millisOf(raw.mergedAt) > 0 ? raw.mergedAt : null;
  return {
    number,
    title: text(raw.title),
    url: httpUrl(raw.url) ?? '',
    state,
    isDraft,
    branch: text(raw.headRefName),
    author,
    updatedAt: text(raw.updatedAt),
    mergedAt,
    reviewDecision,
    reviews: listOf(raw.latestReviews).map(toReview).filter((review): review is PullRequestReview => review !== null),
    checks,
    checksSummary,
    attention: attentionOf({ state, isDraft, author, reviewDecision, checksSummary }),
  };
}

/**
 * Reads the text that `gh pr list --state all --json <GH_PR_FIELDS>` printed. `open` is the open
 * pull requests (drafts too), the one updated last first. `merged` is the ones merged in the 7 days
 * before `now`, the one merged last first. A closed pull request that was not merged is in neither.
 * Throws a PanelError (code `gh-bad-output`) when the text is not a list of pull requests, so the
 * page shows that and not an empty list.
 */
export function parseGhPrs(json: string, now: Date): GithubInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw unreadable('the output is not JSON');
  }
  if (!Array.isArray(parsed)) throw unreadable('the output is not a list');
  const all = parsed.map((raw, index) => toPullRequest(raw, index + 1));

  const open = all.filter((pr) => pr.state === 'OPEN').sort((a, b) => millisOf(b.updatedAt) - millisOf(a.updatedAt) || b.number - a.number);
  // A merge time a little ahead of this computer's clock (clock drift) is not a reason to drop the pull request.
  const merged = all
    .filter((pr) => pr.state === 'MERGED' && pr.mergedAt !== null && now.getTime() - millisOf(pr.mergedAt) <= MERGED_KEPT_MS)
    .sort((a, b) => millisOf(b.mergedAt ?? '') - millisOf(a.mergedAt ?? '') || b.number - a.number);
  return { open, merged };
}
