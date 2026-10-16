import { addDecision, parseDecisionIssue, sortDecisions } from '../server/decisions/parse';
import { ciFromRun } from '../server/github/ci';
import { isRecord, splitPullRequests, toPullRequest } from '../server/github/github';
import type { CiMain, DecisionIssue, DecisionsInfo, GithubInfo, PullRequest } from '../shared/types';
import { STALE_AFTER_DAYS, type WorkstreamResult, branchCheck, branchNameProblem, parseWorkstream, workstreamPathFor } from '../shared/workstream';
import { CI_WORKFLOW_NAME, DEFAULT_BRANCH, MAIN_FILES, OWNER, REPO, aliasFor } from './queries';
import type { LookupSource, MainFiles, RemoteBranch, SnapshotProblem, WorkstreamRow } from './types';

// The pure parsers of the GitHub API adapter. They take the JSON that GitHub's GraphQL API answered and make the SAME types as the local modules.
//
// The pull request, check, CI and decision rules are not written again here. The adapter reshapes each GraphQL node into the shape that `gh ... --json`
// prints (gh builds its JSON from the same API), and then calls the parser that the local modules use (`toPullRequest`, `ciFromRun`,
// `parseDecisionIssue`). So a rule that changes there changes here too.
//
// Nothing here throws to the caller. A reply with an unknown shape raises a ShapeError inside, and `shaped` (used by the fetcher) turns it into a typed error.

/** The reply has a shape that the adapter does not know. The message names the field. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapeError';
  }
}

type Json = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function record(value: unknown, where: string): Json {
  if (!isRecord(value)) throw new ShapeError(`${where} is missing or is not an object`);
  return value;
}

/** The records in `connection.nodes`. GitHub puts `null` in a list for something that the token cannot see: such an entry is left out. */
function nodesOf(connection: unknown, where: string): Json[] {
  const nodes = record(connection, where).nodes;
  if (!Array.isArray(nodes)) throw new ShapeError(`${where}.nodes is missing or is not a list`);
  return nodes.filter(isRecord);
}

/** Runs a parser and turns a ShapeError (or the PanelError of a shared parser) into a message. Any other error is a bug, so it passes through. */
export function shaped<T>(run: () => T): { ok: true; value: T } | { ok: false; message: string } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof ShapeError) return { ok: false, message: error.message };
    // The shared parsers throw a PanelError (code + message) for a node that has the wrong shape.
    if (error instanceof Error && error.name === 'PanelError') return { ok: false, message: error.message };
    throw error;
  }
}

// ---- the branches ----

export type RefsPage = { branches: RemoteBranch[]; next: string | null; problems: SnapshotProblem[] };

/**
 * One page of `refs`. `next` is the cursor of the next page, or null on the last one. One odd ref (no target, no name, no commit, or a target that is
 * not a commit) is left out with a problem, and the other branches stay: one bad ref must not blank the page.
 */
export function parseRefsPage(connection: unknown): RefsPage {
  const page = record(connection, 'refs');
  if (!Array.isArray(page.nodes)) throw new ShapeError('refs.nodes is missing or is not a list');
  const problems: SnapshotProblem[] = [];
  const branches: RemoteBranch[] = [];
  page.nodes.forEach((node: unknown, index) => {
    const target = isRecord(node) && isRecord(node.target) ? node.target : null;
    const name = isRecord(node) ? text(node.name) : '';
    const sha = target === null ? '' : text(target.oid);
    if (target === null || name === '' || sha === '' || target.__typename !== 'Commit') {
      problems.push({ code: 'branch-skipped', message: `A branch was left out: refs.nodes[${index}] has no name, or does not point at a commit.` });
      return;
    }
    branches.push({ name, sha, date: text(target.committedDate), subject: text(target.messageHeadline), upstream: null, track: null, worktree: null });
  });
  const info = record(page.pageInfo, 'refs.pageInfo');
  const cursor = text(info.endCursor);
  return { branches, next: info.hasNextPage === true && cursor !== '' ? cursor : null, problems };
}

// ---- the pull requests ----

/** A pull request with what the workstream lookup needs from it. */
export type PrMeta = {
  pr: PullRequest;
  /** The sha of the head of the pull request. */
  headSha: string;
  /** The sha of the merge commit, for a merged pull request. */
  mergeSha: string | null;
  /** The paths that the pull request changed (the first 50). */
  files: string[];
  /** True when the head branch is in a fork. A fork can use any branch name, so its pull request never stands for a branch of this repo. */
  cross: boolean;
  /** Which lists of the pull request GitHub cut short (more entries exist than the page holds). */
  cut: { checks: boolean; files: boolean; reviews: boolean };
};

/** True when a connection has more entries (`totalCount`) than the nodes it returned. A reply with no `totalCount` is taken as complete. */
function isCut(connection: unknown): boolean {
  return isRecord(connection) && typeof connection.totalCount === 'number' && Array.isArray(connection.nodes) && connection.totalCount > connection.nodes.length;
}

/** One pull request, in the shape that `gh pr list --json` prints, then through the parser of the GitHub panel. */
function toMeta(node: Json, index: number): PrMeta {
  const where = `pull request ${index + 1}`;
  const rollup = node.statusCheckRollup;
  const contexts = isRecord(rollup) && isRecord(rollup.contexts) && Array.isArray(rollup.contexts.nodes) ? rollup.contexts.nodes : [];
  const ghShaped = {
    number: node.number,
    title: node.title,
    state: node.state,
    isDraft: node.isDraft,
    headRefName: node.headRefName,
    url: node.url,
    author: node.author,
    updatedAt: node.updatedAt,
    mergedAt: node.mergedAt,
    reviewDecision: node.reviewDecision ?? '', // gh prints "" when nobody has decided
    latestReviews: isRecord(node.latestReviews) && Array.isArray(node.latestReviews.nodes) ? node.latestReviews.nodes : [],
    statusCheckRollup: contexts,
  };
  const cutChecks = isRecord(rollup) && isCut(rollup.contexts);
  let pr = toPullRequest(ghShaped, index + 1);
  // Some checks are not in the list, so "pass" is not known: a hidden check may have failed. The pull request is shown as pending and is not ready to merge.
  if (cutChecks && pr.checksSummary === 'pass') pr = { ...pr, checksSummary: 'pending', attention: pr.attention === 'merge' ? null : pr.attention };
  const headSha = text(node.headRefOid);
  if (headSha === '') throw new ShapeError(`${where} has no head commit`);
  const merge = isRecord(node.mergeCommit) ? text(node.mergeCommit.oid) : '';
  const files = isRecord(node.files) && Array.isArray(node.files.nodes) ? node.files.nodes.filter(isRecord).map((file) => text(file.path)) : [];
  // A missing flag counts as "from a fork": the safe reading.
  return { pr, headSha, mergeSha: merge === '' ? null : merge, files, cross: node.isCrossRepository !== false, cut: { checks: cutChecks, files: isCut(node.files), reviews: isCut(node.latestReviews) } };
}

export function parsePullRequests(connection: unknown, where: string): PrMeta[] {
  return nodesOf(connection, where).map(toMeta);
}

/** A problem for each pull request whose checks or reviews were cut short. (A cut list of files matters only for a branch name outside the rule: see `planRows`.) */
export function pullRequestProblems(metas: readonly PrMeta[]): SnapshotProblem[] {
  return metas.flatMap((meta) => [
    ...(meta.cut.checks ? [{ code: 'pr-checks-truncated', message: `Pull request ${meta.pr.number} has more checks than the first page holds. It is shown as pending, not as passing.` }] : []),
    ...(meta.cut.reviews ? [{ code: 'pr-reviews-truncated', message: `Pull request ${meta.pr.number} has more reviews than the first page holds. The review list is not complete.` }] : []),
  ]);
}

/** The two lists of the GitHub panel. */
export function githubInfoOf(metas: readonly PrMeta[], now: Date): GithubInfo {
  return splitPullRequests(
    metas.map((meta) => meta.pr),
    now,
  );
}

// ---- CI on main ----

/** GraphQL names the state of a check suite `REQUESTED` where gh says `queued`. Everything else lower-cased is the word that gh prints. */
const suiteStatus = (status: unknown): string => (text(status).toUpperCase() === 'REQUESTED' ? 'queued' : text(status).toLowerCase());

/**
 * The CI result: the newest run of the CI workflow in the newest commits of the default branch. A commit that only changes docs starts no CI run
 * (`paths-ignore` in ci.yml), so the search goes down the history until it finds a commit with one. A run is a check suite with a `workflowRun` of the workflow
 * named CI_WORKFLOW_NAME. The run is then read by the same rule as the local `gh run list` row.
 */
export function parseCi(refNode: unknown): CiMain {
  const commits = isRecord(refNode) && isRecord(refNode.target) && isRecord(refNode.target.history) ? nodesOf(refNode.target.history, 'ci.history') : [];
  for (const commit of commits) {
    const runs = nodesOf(commit.checkSuites, 'ci.checkSuites').flatMap((suite) => {
      const run = suite.workflowRun;
      if (!isRecord(run) || !isRecord(run.workflow) || run.workflow.name !== CI_WORKFLOW_NAME) return [];
      return [{ status: suiteStatus(suite.status), conclusion: text(suite.conclusion).toLowerCase(), url: run.url, createdAt: run.createdAt }];
    });
    if (runs.length === 0) continue;
    // The newest run of this commit (a re-run makes a second suite).
    runs.sort((a, b) => Date.parse(text(b.createdAt)) - Date.parse(text(a.createdAt)));
    return ciFromRun(runs[0]);
  }
  return ciFromRun({});
}

// ---- the decisions ----

/** A decision issue in the shape that the local parser reads, with its events, and where its comments go on (null when it has all of them). */
export type DecisionRaw = { raw: Json; events: Json[]; moreCommentsAfter: string | null };

const loginObject = (value: unknown): Json | null => (isRecord(value) ? { login: text(value.login) } : null);

const commentOf = (node: Json): Json => ({ author: loginObject(node.author), body: text(node.body), createdAt: text(node.createdAt) });

/** The issues of a list (`waiting` or `decided`), reshaped as `gh issue list --json ...` prints them, plus the events that the `decided` label needs (as `gh api .../events` prints them). */
export function parseDecisionRaws(connection: unknown, where: string): DecisionRaw[] {
  return nodesOf(connection, where).map((node, index) => {
    const at = `${where}.nodes[${index}]`;
    const comments = record(node.comments, `${at}.comments`);
    const info = record(comments.pageInfo, `${at}.comments.pageInfo`);
    const cursor = text(info.endCursor);
    const labels = nodesOf(node.labels, `${at}.labels`).map((label) => ({ name: text(label.name) }));
    const events = nodesOf(node.timelineItems, `${at}.timelineItems`)
      .filter((item) => item.__typename === 'LabeledEvent')
      .map((item) => ({ event: 'labeled', label: { name: text(isRecord(item.label) ? item.label.name : '') }, actor: loginObject(item.actor), created_at: text(item.createdAt) }));
    const raw: Json = {
      number: node.number,
      title: node.title,
      url: node.url,
      state: node.state,
      body: node.body,
      createdAt: node.createdAt,
      author: loginObject(node.author),
      labels,
      comments: nodesOf(comments, `${at}.comments`).map(commentOf),
    };
    return { raw, events, moreCommentsAfter: info.hasNextPage === true && cursor !== '' ? cursor : null };
  });
}

/** Adds the comments of a later page to a decision. */
export function addComments(decision: DecisionRaw, connection: unknown): DecisionRaw {
  const page = record(connection, 'comments');
  const info = record(page.pageInfo, 'comments.pageInfo');
  const cursor = text(info.endCursor);
  const more = nodesOf(page, 'comments').map(commentOf);
  const had = Array.isArray(decision.raw.comments) ? decision.raw.comments : [];
  return { ...decision, raw: { ...decision.raw, comments: [...had, ...more] }, moreCommentsAfter: info.hasNextPage === true && cursor !== '' ? cursor : null };
}

/** One issue, read for the hosted answer: the decision in the shape of the local parser, and where its later comments and earlier label events go on. */
export type AnswerIssueRaw = DecisionRaw & {
  /** The cursor of the label events before the ones read, or null when all of them are read. */
  moreEventsBefore: string | null;
  /** True when the issue has more labels than were read. The labels decide whether it is a decision, so a cut list is not trusted. */
  labelsCut: boolean;
};

const labeledEventOf = (item: Json): Json => ({ event: 'labeled', label: { name: text(isRecord(item.label) ? item.label.name : '') }, actor: loginObject(item.actor), created_at: text(item.createdAt) });

/** The label events of a timeline connection, as `gh api .../events` prints them, in the order of the connection (the oldest first). */
function labeledEvents(connection: unknown, where: string): Json[] {
  return nodesOf(connection, where)
    .filter((item) => item.__typename === 'LabeledEvent')
    .map(labeledEventOf);
}

/** Where the earlier events go on: the cursor of the page before this one, or null when this is the first page. */
function eventsCursor(connection: unknown, where: string): string | null {
  const info = record(record(connection, where).pageInfo, `${where}.pageInfo`);
  const cursor = text(info.startCursor);
  return info.hasPreviousPage === true && cursor !== '' ? cursor : null;
}

/** The `issue` field of the first answer read (ANSWER_ISSUE_QUERY). Throws a ShapeError for a shape that this adapter does not know. */
export function parseAnswerIssue(issue: unknown): AnswerIssueRaw {
  const node = record(issue, 'issue');
  const [decision] = parseDecisionRaws({ nodes: [node] }, 'issue');
  if (decision === undefined) throw new ShapeError('issue is missing');
  const labels = record(record(node.labels, 'issue.labels').pageInfo, 'issue.labels.pageInfo');
  return { ...decision, moreEventsBefore: eventsCursor(node.timelineItems, 'issue.timelineItems'), labelsCut: labels.hasNextPage === true };
}

/** Adds an earlier page of label events (ANSWER_EVENTS_PAGE_QUERY) in front of the ones read. */
export function addEarlierEvents(decision: AnswerIssueRaw, connection: unknown): AnswerIssueRaw {
  return { ...decision, events: [...labeledEvents(connection, 'timelineItems'), ...decision.events], moreEventsBefore: eventsCursor(connection, 'timelineItems') };
}

/**
 * The two lists of the decisions panel. An issue is read once even when it is in both lists (it has both labels). The trust rules are the ones of the local
 * parser: the issue, each comment and the actor of the `decided` label must be Mark's account, or they do not count.
 */
export function decisionsInfoOf(raws: readonly DecisionRaw[], now: number, repo = `${OWNER}/${REPO}`): DecisionsInfo {
  const byNumber = new Map<number, DecisionRaw>();
  for (const decision of raws) {
    if (typeof decision.raw.number === 'number') byNumber.set(decision.raw.number, decision);
  }
  const info: DecisionsInfo = { open: [], recent: [] };
  for (const decision of byNumber.values()) {
    const parsed = parseDecisionIssue(decision.raw, decision.events);
    if (parsed === null) continue; // not Mark's, or not a decision
    const issue: DecisionIssue = parsed.url === '' ? { ...parsed, url: `https://github.com/${repo}/issues/${parsed.number}` } : parsed;
    addDecision(info, issue, now);
  }
  sortDecisions(info);
  return info;
}

// ---- the workstream rows ----

/** What the plan says about one row, before the files are read. */
export type RowPlan = {
  branch: string;
  head: WorkstreamRow['head'];
  pr: PullRequest | null;
  /** The expression to read, `<sha>:<path>`, or null when no lookup is made. */
  expression: string | null;
  lookup: WorkstreamRow['lookup'];
  /** Set when no lookup is made: the verdict is final (a neutral row, or a red row for a name outside the rule). */
  settled: WorkstreamResult | null;
};

const SHA = /^[0-9a-f]{40}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const millis = (iso: string | null): number => (iso === null ? 0 : Date.parse(iso) || 0);

/**
 * The pull request that stands for a branch. A pull request from a fork never does (the fork chooses its branch name, and a commit of the fork is not the work of this
 * branch). Of the rest: the open one, else the newest merged one, else the newest closed one.
 */
function prFor(branch: string, metas: readonly PrMeta[]): PrMeta | null {
  const own = metas.filter((meta) => !meta.cross && meta.pr.branch === branch);
  const open = own.filter((meta) => meta.pr.state === 'OPEN').sort((a, b) => millis(b.pr.updatedAt) - millis(a.pr.updatedAt));
  if (open[0]) return open[0];
  const merged = own.filter((meta) => meta.pr.state === 'MERGED').sort((a, b) => millis(b.pr.mergedAt) - millis(a.pr.mergedAt));
  if (merged[0]) return merged[0];
  return own.sort((a, b) => millis(b.pr.updatedAt) - millis(a.pr.updatedAt))[0] ?? null;
}

/**
 * Decides, for each branch and each recently merged pull request whose branch is gone, which commit to read the workstream file at:
 *   - the head of the pull request, for an open or closed one;
 *   - the merge commit, for a merged one (the file is on `main` then, and the branch may be deleted). If the branch is still there and has moved on
 *     since the merge, the branch is new work: its own tip is read and the old pull request is not shown;
 *   - the tip of the branch, when there is no pull request.
 * A branch name outside the rule is not looked up (see `branchCheck`): it is a neutral row, or a red row when a pull request changed a workstream file for it.
 */
export function planRows(branches: readonly RemoteBranch[], metas: readonly PrMeta[], now: Date): { plans: RowPlan[]; problems: SnapshotProblem[] } {
  const problems: SnapshotProblem[] = [];
  const byName = new Map(branches.map((branch) => [branch.name, branch]));
  const names = new Set(branches.map((branch) => branch.name));
  // A merged pull request whose branch was deleted still has a row for 14 days (the page hides a file after that).
  for (const meta of metas) {
    if (meta.cross || meta.pr.state !== 'MERGED' || meta.pr.branch === '' || names.has(meta.pr.branch)) continue;
    if (now.getTime() - millis(meta.pr.mergedAt) <= STALE_AFTER_DAYS * DAY_MS) names.add(meta.pr.branch);
  }
  names.delete(DEFAULT_BRANCH);

  const plans: RowPlan[] = [];
  for (const branch of names) {
    const ref = byName.get(branch);
    const head = ref === undefined ? null : { sha: ref.sha, date: ref.date, subject: ref.subject };
    let meta = prFor(branch, metas);
    // The branch moved on after its pull request merged: the pull request is history, not this branch.
    if (meta !== null && meta.pr.state === 'MERGED' && ref !== undefined && ref.sha !== meta.headSha) meta = null;
    const path = workstreamPathFor(branch);
    const verdict = branchCheck(branch, meta?.files.includes(path) ?? false);
    if (verdict.kind === 'skipped') {
      // The list of changed files was cut at 50, so a workstream file for this odd name may be among those not listed.
      if (meta?.cut.files === true) problems.push({ code: 'pr-files-truncated', message: `Pull request ${meta.pr.number} changed more files than the first page holds. A workstream file for the branch ${branch} may be missed.` });
      plans.push({ branch, head, pr: meta?.pr ?? null, expression: null, lookup: null, settled: null });
      continue;
    }
    if (verdict.kind === 'invalid') {
      plans.push({ branch, head, pr: meta?.pr ?? null, expression: null, lookup: null, settled: { ok: false, path, errors: [branchNameProblem(branch)], message: verdict.message } });
      continue;
    }

    let sha: string | null;
    let source: LookupSource;
    if (meta === null) {
      sha = ref?.sha ?? null;
      source = 'branch-tip';
    } else if (meta.pr.state === 'MERGED') {
      sha = meta.mergeSha ?? meta.headSha;
      source = meta.mergeSha === null ? 'pr-head' : 'merge-commit';
    } else {
      sha = meta.headSha;
      source = 'pr-head';
    }
    if (sha === null || !SHA.test(sha)) {
      problems.push({ code: 'workstream-lookup-skipped', message: `the branch ${branch} has no usable commit for the file lookup` });
      plans.push({ branch, head, pr: meta?.pr ?? null, expression: null, lookup: null, settled: null });
      continue;
    }
    plans.push({ branch, head, pr: meta?.pr ?? null, expression: `${sha}:${path}`, lookup: { sha, source }, settled: null });
  }
  return { plans, problems };
}

// ---- the files ----

/** What one `object(expression:)` answered. */
export type BlobRead = { kind: 'missing' } | { kind: 'text'; text: string } | { kind: 'unreadable'; reason: string };

export function readBlob(value: unknown, where: string): BlobRead {
  if (value === null) return { kind: 'missing' };
  if (value === undefined) throw new ShapeError(`${where} is missing from the reply`);
  const blob = record(value, where);
  // A tree (a folder) or a commit at that path has none of the Blob fields: it is not a file.
  if (typeof blob.text !== 'string') return { kind: 'unreadable', reason: 'it is not a text file' };
  if (blob.isBinary === true) return { kind: 'unreadable', reason: 'it is not a text file' };
  if (blob.isTruncated === true) return { kind: 'unreadable', reason: 'it is too big for the API to give whole' };
  return { kind: 'text', text: blob.text };
}

/** The reply of call 2 as the finished rows and the files of `main`. `repository` is the `repository` field of the reply. */
export function rowsFromFiles(plans: readonly RowPlan[], repository: unknown): { rows: WorkstreamRow[]; main: MainFiles; problems: SnapshotProblem[] } {
  const repo = record(repository, 'repository');
  const problems: SnapshotProblem[] = [];
  let next = 0;
  const all = plans.map((plan): WorkstreamRow => {
    const base = { branch: plan.branch, head: plan.head, pr: plan.pr, lookup: plan.lookup };
    if (plan.expression === null) return { ...base, workstream: plan.settled };
    const path = workstreamPathFor(plan.branch);
    const read = readBlob(repo[aliasFor(next++)], `the file of the branch ${plan.branch}`);
    if (read.kind === 'missing') return { ...base, workstream: null };
    if (read.kind === 'unreadable') {
      return { ...base, workstream: { ok: false, path, errors: [`the file cannot be read: ${read.reason}`], message: `${path}: the file cannot be read: ${read.reason}` } };
    }
    return { ...base, workstream: parseWorkstream(path, read.text) };
  });
  // A merged pull request whose branch is gone and that left no workstream file shows nothing: the row is left out. (Every old pull request is such a case.)
  const rows = all.filter((row) => !(row.head === null && row.workstream === null));
  rows.sort((a, b) => millis(b.head?.date ?? b.pr?.mergedAt ?? null) - millis(a.head?.date ?? a.pr?.mergedAt ?? null) || a.branch.localeCompare(b.branch));

  const main: MainFiles = { status: null, roadmap: null, migration: null };
  for (const file of MAIN_FILES) {
    const read = readBlob(repo[file.alias], `${file.path} on ${DEFAULT_BRANCH}`);
    if (read.kind === 'text') main[file.key] = read.text;
    else problems.push({ code: `${file.key}-unavailable`, message: `${file.path} on ${DEFAULT_BRANCH}: ${read.kind === 'missing' ? 'the file is not there' : read.reason}` });
  }
  return { rows, main, problems };
}
