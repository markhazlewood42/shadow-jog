import type { DecisionRead } from '../server/decisions/module';
import { readDecisionIssue } from '../server/decisions/parse';
import { STALE_AFTER_DAYS } from '../shared/workstream';
import {
  ANSWER_EVENTS_PAGE_QUERY,
  ANSWER_ISSUE_QUERY,
  ANSWER_MAX_PAGES,
  answerEventsVariables,
  answerIssueVariables,
  buildFilesQuery,
  COMMENTS_PAGE_QUERY,
  commentsPageVariables,
  OWNER,
  REFS_PAGE_QUERY,
  REPO,
  refsPageVariables,
  SNAPSHOT_QUERY,
  snapshotVariables,
} from './queries';
import {
  type DecisionRaw,
  type PrMeta,
  addComments,
  addEarlierEvents,
  decisionsInfoOf,
  githubInfoOf,
  parseCi,
  parseAnswerIssue,
  parseDecisionRaws,
  parsePullRequests,
  parseRefsPage,
  pullRequestProblems,
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
  /** The clock. A test sets it, so that "merged in the last 7 days" is the week that its fixtures were made for. It is the calendar clock only: the deadline does not read it. */
  now?: () => Date;
  /** The clock of the deadline, in milliseconds that only go forward (`performance.now` when there is none). It is apart from `now`, so a fixed or a wrong calendar time cannot stop the deadline. A test moves it by hand. */
  clock?: () => number;
  owner?: string;
  repo?: string;
  /** The limit for one call, in milliseconds. In `fetchSnapshot` it is cut further to what is left of the deadline of the whole snapshot. */
  timeoutMs?: number;
  /** Waits before the retry of `fetchSnapshot`. A test replaces it, so that it does not wait. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 20_000;
/** One deadline for the whole snapshot (every call, every page), so that it ends inside the 30 s limit of the Vercel function (vercel.json). */
const SNAPSHOT_BUDGET_MS = 25_000;
/** A retry of call 1 starts only when at least this much of the deadline is left. */
const RETRY_MIN_MS = 8_000;
/** The short wait before the one retry, so that GitHub has a moment to recover. The retry gate counts it. */
const RETRY_BACKOFF_MS = 1_000;
/** A call is not started with less than this left of the deadline. */
const MIN_CALL_MS = 500;
/** The most pages of branches (100 each) that one snapshot reads. A repo past this has 2,000 branches, and a problem says so. */
const MAX_REFS_PAGES = 20;
/** The most pages of comments (100 each) that one decision issue is followed for. */
const MAX_COMMENT_PAGES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (code: AdapterError['code'], message: string, extra: Partial<AdapterError> = {}): { ok: false; error: AdapterError } => ({ ok: false, error: { code, message, ...extra } });

/** The first words of a text from GitHub, cut so that one message stays short. */
const clip = (value: string, max = 200): string => (value.length <= max ? value : `${value.slice(0, max)}...`);

type Reply = { data: Record<string, unknown>; cost: CallCost; problems: SnapshotProblem[] };

/**
 * One GraphQL call. The result is the `data` of the reply and the cost of the call, or a typed error:
 *   - `network`: fetch itself failed (no network, timeout);
 *   - `unauthorized`: HTTP 401;
 *   - `rate-limited`: HTTP 403 or 429 about a rate limit, or any GraphQL error of type RATE_LIMITED. `retryAfter` holds the `retry-after` seconds when GitHub sent them;
 *   - `http-error`: any other status that is not 200;
 *   - `bad-response`: the reply is not JSON, or has no `data` object;
 *   - `graphql-error`: the reply has an `errors` list and no `data`.
 * A reply with `errors` AND usable `data` is not a failure (GitHub does this when one nullable field is not allowed, for example FORBIDDEN): the data is kept, and each
 * error comes back in `problems` with its type and its path, so the page can say what is missing. (A RATE_LIMITED error fails the call even then.)
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
      ? fail('rate-limited', 'GitHub says the rate limit is used up. Wait, then try again.', { status: response.status, ...retryAfterOf(response) })
      : fail('http-error', `GitHub refused the request (HTTP ${response.status}). ${clip(said)}`.trim(), { status: response.status });
  }
  if (!response.ok) return fail('http-error', `GitHub answered HTTP ${response.status} (${label}). ${clip(said)}`.trim(), { status: response.status });
  if (!isRecord(body)) return fail('bad-response', `The reply of GitHub is not JSON (${label}).`, { status: response.status });

  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.some((error) => isRecord(error) && error.type === 'RATE_LIMITED')) {
    return fail('rate-limited', 'GitHub says the rate limit is used up. Wait, then try again.', retryAfterOf(response));
  }
  const problems: SnapshotProblem[] = errors.map((error) => {
    const kind = isRecord(error) && typeof error.type === 'string' ? error.type : 'ERROR';
    const path = isRecord(error) && Array.isArray(error.path) ? error.path.map(String).join('.') : '';
    const message = isRecord(error) && typeof error.message === 'string' ? clip(error.message) : 'unknown error';
    return { code: 'graphql-partial', message: `GitHub reported ${kind}${path === '' ? '' : ` at ${clip(path, 80)}`} (${label}): ${message}` };
  });
  if (errors.length > 0 && !isRecord(body.data)) {
    return fail('graphql-error', problems[0]?.message ?? `GitHub reported an error (${label}).`);
  }
  if (!isRecord(body.data)) return fail('bad-response', `The reply of GitHub has no data (${label}).`, { status: response.status });

  const limit = body.data.rateLimit;
  const cost: CallCost = { call: label, cost: isRecord(limit) && typeof limit.cost === 'number' ? limit.cost : 0, remaining: isRecord(limit) && typeof limit.remaining === 'number' ? limit.remaining : -1 };
  return { ok: true, data: { data: body.data, cost, problems } };
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

/** The `retry-after` header as seconds, in an object that can be spread into the error. Nothing when GitHub sent none, or sent a date or a bad number. */
function retryAfterOf(response: { headers: Headers }): { retryAfter?: number } {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 && response.headers.get('retry-after') !== null && response.headers.get('retry-after') !== '' ? { retryAfter: seconds } : {};
}

/** Everything that call 1 reads from the repository, parsed. Throws a ShapeError for a field that is missing or null. */
function parseFirstPage(repository: Record<string, unknown>, now: Date) {
  return {
    refs: parseRefsPage(repository.refs),
    open: parsePullRequests(repository.open, 'open pull requests'),
    recent: parsePullRequests(repository.recent, 'recent pull requests'),
    openMore: isRecord(repository.open) && isRecord(repository.open.pageInfo) && repository.open.pageInfo.hasNextPage === true,
    recentCut: recentIsCut(repository.recent, now),
    waitingCut: listIsCut(repository.waiting),
    decidedCut: listIsCut(repository.decided),
    ci: parseCi(repository.ci),
    decisions: [...parseDecisionRaws(repository.waiting, 'decisions waiting'), ...parseDecisionRaws(repository.decided, 'decisions answered')],
  };
}

const badShape = (label: string, message: string, field: string) => fail('bad-response', `The reply of GitHub has a shape that this adapter does not know (${label}): ${message}`, { field });

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

  // One deadline for the whole snapshot. Each call gets the smaller of its own limit and what is left. With nothing left, the call is not made.
  // The deadline reads its own monotonic clock, not `options.now`: a caller can fix the calendar time, and the calendar time can jump.
  const clock = options.clock ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const startedAt = clock();
  const callTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeLeft = (): number => SNAPSHOT_BUDGET_MS - (clock() - startedAt);
  const withinDeadline = (label: string): { ok: true; options: FetchOptions } | { ok: false; error: AdapterError } => {
    const left = timeLeft();
    return left < MIN_CALL_MS ? fail('deadline', `The snapshot ran out of time before GitHub answered (${label}). Try again.`) : { ok: true, options: { ...options, timeoutMs: Math.min(callTimeout, left) } };
  };

  const call = async (label: string, query: string, variables: Record<string, unknown>): Promise<Result<Record<string, unknown>>> => {
    const allowed = withinDeadline(label);
    if (!allowed.ok) return allowed;
    const result = await graphql(allowed.options, label, query, variables);
    if (!result.ok) return result;
    cost.push(result.data.cost);
    problems.push(...result.data.problems);
    return { ok: true, data: result.data.data };
  };

  // ---- call 1 ----
  // GitHub sometimes answers a heavy query in part: `errors` plus `data` with a null field (a timeout, or SERVICE_UNAVAILABLE). The strict parsers then fail on
  // the null field. That is not an unknown shape, so the call is tried once more, if the time limit of the function leaves room for it. A reply with an
  // unknown shape and no `errors` is a true bad-response and is not tried again.
  const callOne = async (): Promise<Result<{ reply: Reply; page: ReturnType<typeof parseFirstPage> }>> => {
    for (let attempt = 1; ; attempt += 1) {
      const allowed = withinDeadline('call 1');
      if (!allowed.ok) return allowed;
      const result = await graphql(allowed.options, 'call 1: branches, pull requests, CI, decisions', SNAPSHOT_QUERY, snapshotVariables(owner, repo));
      if (!result.ok) {
        // GitHub answers 502, 503 or 504 when a heavy query runs out of time on its side. One more try often works.
        const gatewayTrouble = result.error.code === 'http-error' && [502, 503, 504].includes(result.error.status ?? 0);
        if (gatewayTrouble && attempt < 2 && timeLeft() >= RETRY_MIN_MS + RETRY_BACKOFF_MS) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        return result;
      }
      cost.push(result.data.cost);
      const repository = repositoryOf(result.data.data);
      // A repo that is missing is not a passing trouble, so it is not tried again, whatever `errors` says.
      if (repository === null) return badShape('call 1', 'the repository is missing (is the name right, and can the token read it?)', 'repository');
      const parsed = shaped(() => parseFirstPage(repository, now));
      if (parsed.ok) return { ok: true, data: { reply: result.data, page: parsed.value } };
      if (result.data.problems.length === 0) return badShape('call 1', parsed.message, parsed.field);
      // Partial data (GitHub left a field null and said why). Try once more, but only if the first try was the first and enough time is left.
      if (attempt >= 2 || timeLeft() < RETRY_MIN_MS + RETRY_BACKOFF_MS) {
        return fail('graphql-incomplete', `GitHub answered in part (call 1: ${parsed.message}). Try again.`, { field: parsed.field });
      }
      await sleep(RETRY_BACKOFF_MS);
    }
  };
  const firstCall = await callOne();
  if (!firstCall.ok) return firstCall;
  const { reply: first, page } = firstCall.data;
  problems.push(...first.problems);
  problems.push(...page.refs.problems, ...pullRequestProblems([...page.open, ...page.recent]));
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
    if (!more.ok) {
      // The deadline ran out in the middle of the pages: the data of call 1 is good, so keep it and say that the list is cut.
      if (more.error.code !== 'deadline') return more;
      problems.push({ code: 'branches-truncated', message: 'The time limit ran out while the branches were read. The list is not complete.' });
      break;
    }
    const moreRepo = repositoryOf(more.data);
    const next = shaped(() => parseRefsPage(moreRepo?.refs));
    if (!next.ok) return badShape(`refs page ${pages + 1}`, next.message, next.field);
    branches.push(...next.value.branches);
    problems.push(...next.value.problems);
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
      if (!more.ok) {
        // As for the branches: keep what is read, and say that the answer of this decision may be missing.
        if (more.error.code !== 'deadline') return more;
        problems.push({ code: 'decision-comments-truncated', message: `The time limit ran out while the comments of decision ${String(current.raw.number)} were read. Its answer may be missing.` });
        break;
      }
      const issue = repositoryOf(more.data)?.issue;
      const added = shaped(() => addComments(current, isRecord(issue) ? issue.comments : undefined));
      if (!added.ok) return badShape(`comments of decision ${String(current.raw.number)}`, added.message, added.field);
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

/**
 * One decision issue as GitHub holds it now, for the hosted answer (the same facts as `readDecision` of the local server reads with `gh`). The result's data is
 *   - a `DecisionRead` (the issue as a decision, with how far its answer has got),
 *   - `null` when there is no such issue, it is a pull request, or it is not a decision of Mark's (the answer treats all three as "not found"), or
 *   - `'too-many'` when the issue has more comments or label events than ANSWER_MAX_PAGES pages (100 each), or more labels than one page: nothing is decided on a part of an issue.
 * The comments are read from the first page on, and the label events from the newest back, because the answer is the newest comment and the newest `decided` event.
 */
export async function fetchDecisionForAnswer(options: FetchOptions, number: number): Promise<Result<DecisionRead | null | 'too-many'>> {
  const owner = options.owner ?? OWNER;
  const repo = options.repo ?? REPO;

  const first = await graphql(options, 'answer: the issue', ANSWER_ISSUE_QUERY, answerIssueVariables(number, owner, repo));
  if (!first.ok) return first;
  const repository = repositoryOf(first.data.data);
  if (repository === null) return badShape('answer: the issue', 'the repository is missing (is the name right, and can the token read it?)', 'repository');
  // A number that is a pull request, or no issue at all, gives `issue: null` (and an error of type NOT_FOUND, which is not a failure here).
  if (repository.issue === null) return { ok: true, data: null };
  const parsed = shaped(() => parseAnswerIssue(repository.issue));
  if (!parsed.ok) return badShape('answer: the issue', parsed.message, parsed.field);
  let decision = parsed.value;
  if (decision.labelsCut) return { ok: true, data: 'too-many' };

  let pages = 1;
  while (decision.moreCommentsAfter !== null) {
    if (pages >= ANSWER_MAX_PAGES) return { ok: true, data: 'too-many' };
    const more = await graphql(options, 'answer: comments', COMMENTS_PAGE_QUERY, commentsPageVariables(number, decision.moreCommentsAfter, owner, repo));
    if (!more.ok) return more;
    const issue = repositoryOf(more.data.data)?.issue;
    const added = shaped(() => ({ ...decision, ...addComments(decision, isRecord(issue) ? issue.comments : undefined) }));
    if (!added.ok) return badShape('answer: comments', added.message, added.field);
    decision = added.value;
    pages += 1;
  }
  pages = 1;
  while (decision.moreEventsBefore !== null) {
    if (pages >= ANSWER_MAX_PAGES) return { ok: true, data: 'too-many' };
    const more = await graphql(options, 'answer: events', ANSWER_EVENTS_PAGE_QUERY, answerEventsVariables(number, decision.moreEventsBefore, owner, repo));
    if (!more.ok) return more;
    const issue = repositoryOf(more.data.data)?.issue;
    const added = shaped(() => addEarlierEvents(decision, isRecord(issue) ? issue.timelineItems : undefined));
    if (!added.ok) return badShape('answer: events', added.message, added.field);
    decision = added.value;
    pages += 1;
  }
  return { ok: true, data: readDecisionIssue(decision.raw, decision.events) };
}
