import type { PullRequest } from './types';

// The "never merge" spike pull requests. Repo convention (CLAUDE.md): a spike lives on a draft pull request from a branch named `spike/<topic>`, and it is never merged.
// The Pull requests panel hides them, on the local page and on the hosted page, because they never wait for a decision. The hide is display-only: the data of `GET /api/github`
// and of the snapshot still holds them, and the workstream matching by branch name (src/web/hosted/workstreams.ts) still sees them.

/** The branch prefix of a spike. */
export const SPIKE_BRANCH_PREFIX = 'spike/';

/** True for an open, draft pull request from a `spike/` branch. A pull request that is not a draft, or that comes from another branch, is not a spike. */
export function isSpikePr(pr: Pick<PullRequest, 'state' | 'isDraft' | 'branch'>): boolean {
  return pr.state === 'OPEN' && pr.isDraft && pr.branch.startsWith(SPIKE_BRANCH_PREFIX);
}

/** The open pull requests that the panel shows: all of them but the spikes. */
export function shownOpenPrs(open: readonly PullRequest[]): PullRequest[] {
  return open.filter((pr) => !isSpikePr(pr));
}
