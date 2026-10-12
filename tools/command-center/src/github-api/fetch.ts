import { STALE_AFTER_DAYS } from '../shared/workstream';
import { buildFilesQuery, COMMENTS_PAGE_QUERY, commentsPageVariables, OWNER, REFS_PAGE_QUERY, REPO, refsPageVariables, SNAPSHOT_QUERY, snapshotVariables } from './queries';
import {
  type DecisionRaw,
  type PrMeta,
  addComments,
  decisionsInfoOf,
  githubInfoOf,
  parseCi,
  parseDecisionRaws,
  parsePullRequests,
  parseRefsPage,
  planRows,
  rowsFromFiles,
  shaped,
} from './parse';
import type { AdapterError, CallCost, RemoteBranch, Result, Snapshot, SnapshotProblem } from './types';

// The fetcher of the GitHub API adapter: it makes the GraphQL calls (Node `fetch`, which a test replaces) and hands each reply to the pure parsers.
// It never throws for a reply that GitHub gave: a failure comes back as `{ ok: false, error }` with a code to test for. The token is used only in the
// Authorization header. It is not part of any message, result or log line.

const ENDPOINT = 'https://api.github.com/graphql';

/** The fetch function. The type is the part of `fetch` that the adapter uses, so a test can pass a small fake. */
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'text'>>;

export type FetchOptions = {
  /** A GitHub token that can read the repo. The caller gets it from an environment variable, or from `gh auth token` in a script. */
  token: string;
  /** Replaces the global `fetch`. */
  fetchImpl?: FetchLike;
  /** The clock. A test sets it, so that "merged in the last 7 days" is the week that its fixtures were made for. */
  now?: () => Date;
  owner?: string;
  repo?: string;
  /** The limit for one call, in milliseconds. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
/** The most pages of branches (100 each) that one snapshot reads. A repo past this has 2,000 branches, and a problem says so. */
const MAX_REFS_PAGES = 20;
/** The most pages of comments (100 each) that one decision issue is followed for. */
const MAX_COMMENT_PAGES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (code: AdapterError['code'], message: string, extra: Partial<AdapterError> = {}): { ok: false; error: AdapterError } => ({ ok: false, error: { code, message, ...extra } });

/** The first words of a text from GitHub, cut so that one message stays short. */
const clip = (value: string, max = 200): string => (value.length <= max ? value : `${value.slice(0, max)}...`);

type Reply = { data: Record<string, unknown>; cost: CallCost };

/**
 * One GraphQL call. The result is the `data` of the reply and the cost of the call, or a typed error:
 *   - `network`: fetch itself failed (no network, timeout);
 *   - `unauthorized`: HTTP 401;
 *   - `rate-limited`: HTTP 403 or 429 about a rate limit, or a GraphQL error of type RATE_LIMITED;
 *   - `http-error`: any other status that is not 200;
 *   - `bad-response`: the reply is not JSON, or has no `data` object;
 *   - `graphql-error`: the reply has an `errors` list. `partial` says that it also had data, which the adapter does not use.
 */
export async function graphql(options: FetchOptions, label: string, query: string, variables: Record<string, unknown>): Promise<Result<Reply>> {
  const send: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await send(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'shadow-jog-command-center',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // The message of a network error holds no header, but only the name of the error is passed on: nothing from the request.
    const name = error instanceof Error ? error.name : 'Error';
    return fail('network', `GitHub could not be reached (${label}: ${name}). Try again.`);
  }

  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch {
    return fail('network', `The reply from GitHub broke off (${label}). Try again.`, { status: response.status });
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = undefined;
  }
  const said = isRecord(body) && typeof body.message === 'string' ? body.message : '';

  if (response.status === 401) return fail('unauthorized', 'GitHub does not accept the token. Check the token and its rights.', { status: 401 });
  if (response.status === 403 || response.status === 429) {
    const limited = /rate limit|abuse|secondary/i.test(said) || response.headers.get('x-ratelimit-remaining') === '0';
    return limited
      ? fail('rate-limited', 'GitHub says the rate limit is used up. Wait, then try again.', { status: response.status })
      : fail('http-error', `GitHub refused the request (HTTP ${response.status}). ${clip(said)}`.trim(), { status: response.status });
  }
  if (!response.ok) return fail('http-error', `GitHub answered HTTP ${response.status} (${label}). ${clip(said)}`.trim(), { status: response.status });
  if (!isRecord(body)) return fail('bad-response', `The reply of GitHub is not JSON (${label}).`, { status: response.status });

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const message = isRecord(first) && typeof first.message === 'string' ? clip(first.message) : 'unknown error';
    const kind = isRecord(first) && typeof first.type === 'string' ? first.type : '';
    const partial = isRecord(body.data);
    return kind === 'RATE_LIMITED'
      ? fail('rate-limited', 'GitHub says the rate limit is used up. Wait, then try again.', { partial })
      : fail('graphql-error', `GitHub reported an error (${label}): ${message}`, { partial });
  }
  if (!isRecord(body.data)) return fail('bad-response', `The reply of GitHub has no data (${label}).`, { status: response.status });

  const limit = body.data.rateLimit;
  const cost: CallCost = { call: label, cost: isRecord(limit) && typeof limit.cost === 'number' ? limit.cost : 0, remaining: isRecord(limit) && typeof limit.remaining === 'number' ? limit.remaining : -1 };
  return { ok: true, data: { data: body.data, cost } };
}

/** True when the list has more issues than the page holds (`totalCount` is more than the nodes). A reply with no `totalCount` is taken as complete. */
function listIsCut(list: unknown): boolean {
  return isRecord(list) && typeof list.totalCount === 'number' && Array.isArray(list.nodes) && list.totalCount > list.nodes.length;
}

/**
 * True when there are more recent (merged or closed) pull requests than the page holds AND the oldest one on the page was updated in the last 14 days, so
 * a pull request that still counts may be on the next page. Older pull requests are not wanted, so a long history is not a problem.
 */
function recentIsCut(list: unknown, now: Date): boolean {
  if (!isRecord(list) || !isRecord(list.pageInfo) || list.pageInfo.hasNextPage !== true || !Array.isArray(list.nodes)) return false;
  const times = list.nodes.flatMap((node) => (isRecord(node) && typeof node.updatedAt === 'string' ? [Date.parse(node.updatedAt)] : []));
  const oldest = Math.min(...times);
  return !Number.isFinite(oldest) || now.getTime() - oldest <= STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

const badShape = (label: string, message: string) => fail('bad-response', `The reply of GitHub has a shape that this adapter does not know (${label}): ${message}`);

/** The `repository` field of a reply, or null when it is not an object (a repo that GitHub does not know gives null). */
const repositoryOf = (data: Record<string, unknown>): Record<string, unknown> | null => (isRecord(data.repository) ? data.repository : null);

/**
 * The snapshot of the repo: two GraphQL calls (and more only in rare cases: a repo with more than 100 branches, or a decision issue with more than 100 comments).
 *   Call 1: the branches, the pull requests with checks and reviews, the CI result on `main`, and the decision issues.
 *   Call 2: the workstream file of each branch (one aliased `object(expression: $eN)` each) and the three files of `main`.
 * A failure of call 1 fails the snapshot. A failure of call 2 leaves the rest in place, with no workstream rows and a problem that says why.
 */
export async function fetchSnapshot(options: FetchOptions): Promise<Result<Snapshot>> {
  const now = (options.now ?? (() => new Date()))();
  const owner = options.owner ?? OWNER;
  const repo = options.repo ?? REPO;
  const cost: CallCost[] = [];
  const problems: SnapshotProblem[] = [];

  const call = async (label: string, query: string, variables: Record<string, unknown>): Promise<Result<Record<string, unknown>>> => {
    const result = await graphql(options, label, query, variables);
    if (!result.ok) return result;
    cost.push(result.data.cost);
    return { ok: true, data: result.data.data };
  };

  // ---- call 1 ----
  const first = await call('call 1: branches, pull requests, CI, decisions', SNAPSHOT_QUERY, snapshotVariables(owner, repo));
  if (!first.ok) return first;
  const repository = repositoryOf(first.data);
  if (repository === null) return badShape('call 1', 'the repository is missing (is the name right, and can the token read it?)');

  const parsed = shaped(() => ({
    refs: parseRefsPage(repository.refs),
    open: parsePullRequests(repository.open, 'open pull requests'),
    recent: parsePullRequests(repository.recent, 'recent pull requests'),
    openMore: isRecord(repository.open) && isRecord(repository.open.pageInfo) && repository.open.pageInfo.hasNextPage === true,
    recentCut: recentIsCut(repository.recent, now),
    waitingCut: listIsCut(repository.waiting),
    decidedCut: listIsCut(repository.decided),
    ci: parseCi(repository.ci),
    decisions: [...parseDecisionRaws(repository.waiting, 'decisions waiting'), ...parseDecisionRaws(repository.decided, 'decisions answered')],
  }));
  if (!parsed.ok) return badShape('call 1', parsed.message);
  const page = parsed.value;
  if (page.recentCut) problems.push({ code: 'recent-prs-truncated', message: 'More recent pull requests exist than the first page holds, and the last one on it is newer than 14 days. A merged pull request may be missing.' });
  if (page.waitingCut) problems.push({ code: 'decisions-waiting-truncated', message: 'More decision issues with the label decision exist than the first page holds. The list is not complete.' });
  if (page.decidedCut) problems.push({ code: 'decisions-answered-truncated', message: 'More decision issues with the label decided exist than the first page holds. An answer may be missing.' });
  if (page.openMore) problems.push({ code: 'open-prs-truncated', message: 'More open pull requests exist than the first page holds. The list is not complete.' });

  // ---- more pages of branches (only a repo with more than 100 branches) ----
  const branches: RemoteBranch[] = [...page.refs.branches];
  let cursor = page.refs.next;
  let pages = 1;
  while (cursor !== null) {
    if (pages >= MAX_REFS_PAGES) {
      problems.push({ code: 'branches-truncated', message: `The repo has more than ${MAX_REFS_PAGES * 100} branches. The list is not complete.` });
      break;
    }
    const more = await call(`refs page ${pages + 1}`, REFS_PAGE_QUERY, refsPageVariables(cursor, owner, repo));
    if (!more.ok) return more;
    const moreRepo = repositoryOf(more.data);
    const next = shaped(() => parseRefsPage(moreRepo?.refs));
    if (!next.ok) return badShape(`refs page ${pages + 1}`, next.message);
    branches.push(...next.value.branches);
    cursor = next.value.next;
    pages += 1;
  }
  branches.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.name.localeCompare(b.name));

  // ---- the rest of the comments of a decision (the answer is the newest comment, so none may be missed) ----
  const decisions: DecisionRaw[] = [];
  for (const decision of page.decisions) {
    let current = decision;
    let count = 0;
    while (current.moreCommentsAfter !== null) {
      if (count >= MAX_COMMENT_PAGES) {
        problems.push({ code: 'decision-comments-truncated', message: `Decision ${String(current.raw.number)} has too many comments. Its answer may be missing.` });
        break;
      }
      const more = await call(`comments of decision ${String(current.raw.number)}`, COMMENTS_PAGE_QUERY, commentsPageVariables(Number(current.raw.number), current.moreCommentsAfter, owner, repo));
      if (!more.ok) return more;
      const issue = repositoryOf(more.data)?.issue;
      const added = shaped(() => addComments(current, isRecord(issue) ? issue.comments : undefined));
      if (!added.ok) return badShape(`comments of decision ${String(current.raw.number)}`, added.message);
      current = added.value;
      count += 1;
    }
    decisions.push(current);
  }

  const metas: PrMeta[] = [...page.open, ...page.recent];
  const github = githubInfoOf(metas, now);
  const plan = planRows(branches, metas, now);
  problems.push(...plan.problems);

  const snapshot: Snapshot = {
    at: now.toISOString(),
    branches,
    github,
    ci: page.ci,
    decisions: decisionsInfoOf(decisions, now.getTime(), `${owner}/${repo}`),
    workstreams: [],
    main: { status: null, roadmap: null, migration: null },
    problems,
    cost,
  };

  // ---- call 2 ----
  const files = buildFilesQuery(
    plan.plans.flatMap((row) => (row.expression === null ? [] : [row.expression])),
    owner,
    repo,
  );
  const second = await call('call 2: workstream files and files of main', files.query, files.variables);
  if (!second.ok) {
    problems.push({ code: 'workstreams-failed', message: `The workstream files could not be read: ${second.error.message}` });
    return { ok: true, data: snapshot };
  }
  const rows = shaped(() => rowsFromFiles(plan.plans, second.data.repository));
  if (!rows.ok) {
    problems.push({ code: 'workstreams-failed', message: `The workstream files could not be read: the reply has an unknown shape (${rows.message}).` });
    return { ok: true, data: snapshot };
  }
  snapshot.workstreams = rows.value.rows;
  snapshot.main = rows.value.main;
  problems.push(...rows.value.problems);
  return { ok: true, data: snapshot };
}
