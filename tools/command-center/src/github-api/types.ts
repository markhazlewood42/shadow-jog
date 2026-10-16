import type { CiMain, DecisionsInfo, GitBranch, GithubInfo, PullRequest } from '../shared/types';
import type { WorkstreamResult } from '../shared/workstream';

// The shapes of the GitHub API adapter (design.md sections 4.3 and 6). The adapter reads GitHub with two GraphQL calls and returns the SAME
// types as the local modules (GithubInfo, CiMain, DecisionsInfo, GitBranch). The few types here describe only what no local module has:
// the workstream rows, the files of `main`, and the errors.

/** Why a call of the adapter failed. A code to test for and a sentence for a person. The adapter returns these; it does not throw them. */
export type AdapterErrorCode =
  /** The network failed, or the request ran past its time limit. */
  | 'network'
  /** HTTP 401: GitHub does not accept the token. */
  | 'unauthorized'
  /** HTTP 403 or 429 with a rate-limit message or the header `x-ratelimit-remaining: 0`, or a GraphQL RATE_LIMITED error. */
  | 'rate-limited'
  /** Any other HTTP status that is not 200. */
  | 'http-error'
  /** The reply is not JSON, or has a shape that this adapter does not know. */
  | 'bad-response'
  /** The reply has an `errors` list and no `data`. (With usable `data`, the call works and a problem names each error.) */
  | 'graphql-error'
  /** GitHub answered in part (`errors` plus `data` with a null field) twice, so the snapshot could not be read. Trying again later is likely to work. */
  | 'graphql-incomplete'
  /** The one deadline of the snapshot ran out before a call could start. Trying again later is likely to work. */
  | 'deadline';

export type AdapterError = {
  code: AdapterErrorCode;
  message: string;
  /** The HTTP status, when there was a reply. */
  status?: number;
  /** For `rate-limited`: the seconds to wait, from the `retry-after` header, when GitHub sent one. */
  retryAfter?: number;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: AdapterError };

/** What the `rateLimit { cost remaining }` field of one call said. */
export type CallCost = { call: string; cost: number; remaining: number };

/** The branch of a pull request or of a ref: where the workstream file was read. */
export type LookupSource = 'pr-head' | 'merge-commit' | 'branch-tip';

/**
 * One row of the Workstreams view: a branch, its pull request, and its workstream file.
 *
 * `workstream` is null for a neutral "no workstream" row: the branch has no file, or its name is outside the rule and it has no file (a bot branch).
 * Otherwise it is the verdict of the shared validator: `ok` for a good file, and a red row (`ok: false`, with the path and the error text) for a bad file,
 * and for a file on a branch whose name is outside the rule.
 */
export type WorkstreamRow = {
  branch: string;
  /** The branch as it is now on GitHub, or null when the branch is gone (a merged pull request whose branch was deleted). */
  head: { sha: string; date: string; subject: string } | null;
  /** The pull request that the row follows, or null. Open first, then merged, then closed. A pull request from a fork never counts. */
  pr: PullRequest | null;
  /** What the file was read at. Null when no lookup was made (the name is outside the rule). */
  lookup: { sha: string; source: LookupSource } | null;
  workstream: WorkstreamResult | null;
};

/** A branch as the Git panel shows it, plus the sha of its tip. `upstream`, `track` and `worktree` are always null here: GitHub knows no local checkout. */
export type RemoteBranch = GitBranch & { sha: string; subject: string };

/** The text of the files of `main` that the page needs. A file that is missing or too big for GraphQL (`isTruncated`) is null, with a note in `problems`. */
export type MainFiles = { status: string | null; roadmap: string | null; migration: string | null };

/** A part of the snapshot that failed while the rest worked. The page shows it as an error beside the data. */
export type SnapshotProblem = { code: string; message: string };

/** What `fetchSnapshot` returns when both calls worked. */
export type Snapshot = {
  /** When the adapter made it (an ISO time). */
  at: string;
  /** Every branch of the repo, the newest first. */
  branches: RemoteBranch[];
  /** The open pull requests and the ones merged in the last 7 days (the same type as the GitHub panel). Pull requests from forks are in the list. */
  github: GithubInfo;
  ci: CiMain;
  decisions: DecisionsInfo;
  /** One row for each branch and each merged pull request that has no branch any more (and merged less than 14 days ago), without `main`. */
  workstreams: WorkstreamRow[];
  main: MainFiles;
  /** Non-fatal failures (a truncated list, a file too big). An empty list means that everything was read. */
  problems: SnapshotProblem[];
  /** What each call cost, in the order the calls were made. */
  cost: CallCost[];
};
