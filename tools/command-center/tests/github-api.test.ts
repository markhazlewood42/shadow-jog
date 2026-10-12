import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type FetchLike, fetchSnapshot } from '../src/github-api/fetch';
import { addComments, decisionsInfoOf, parseCi, parseDecisionRaws, parsePullRequests, parseRefsPage, planRows, readBlob, rowsFromFiles } from '../src/github-api/parse';
import { COMMENTS_PAGE_QUERY, REFS_PAGE_QUERY, SNAPSHOT_QUERY, aliasFor, buildFilesQuery, commentsPageVariables, snapshotVariables } from '../src/github-api/queries';
import type { Snapshot } from '../src/github-api/types';
import { PACKAGE_DIR } from './helpers';

// The GitHub API adapter (design.md sections 4.3 and 6, step 2 of 11.3). GitHub is replaced by a fake `fetch` that answers with recorded-style JSON from
// fixtures/github-api: call1.json (branches, pull requests, CI, decisions), files.json (the text at "<sha>:<path>") and comments-35-page2.json.
// The fixtures are made up (no token, no real text). The real repo is read by scripts/github-api-dry-run.ts, which is not a test.

type Json = Record<string, unknown>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'github-api', name), 'utf8')) as Json;
const FILES = fixture('files.json') as Record<string, string | null>;

const NOW = new Date('2026-10-12T12:00:00Z');
const TOKEN = 'test-token-not-real-0123456789';
const sha = (tag: string): string => tag.padEnd(40, '0');

/** A deep copy of call1.json that a test can change. */
const call1 = (): { data: { rateLimit: Json; repository: Json } } => structuredClone(fixture('call1.json')) as { data: { rateLimit: Json; repository: Json } };

type Seen = { query: string; variables: Json; headers: Record<string, string> };

/** What a blob answers: the text, `null` for no file, or a ready-made object. */
const blob = (value: unknown): unknown => (typeof value === 'string' ? { text: value, byteSize: value.length, isBinary: false, isTruncated: false } : value);

type Server = {
  /** The reply of call 1. */
  first?: unknown;
  /** The replies of the pages of branches, in order. */
  refsPages?: unknown[];
  /** The replies of the pages of comments, in order. */
  commentPages?: unknown[];
  /** What call 2 finds at each expression. A missing expression is "no file". */
  files?: Record<string, unknown>;
  /** Replaces the whole reply of call 2 (a status and a body). */
  second?: { status?: number; body?: unknown };
};

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

/** A fake GitHub. It answers each query by its name, and it answers call 2 by reading the aliases and variables the way GitHub does. */
function fakeGithub(server: Server = {}): { fetchImpl: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  let refsPage = 0;
  let commentPage = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Json };
    seen.push({ query, variables, headers: init.headers });
    if (query.includes('query Snapshot')) return respond(server.first ?? fixture('call1.json'));
    if (query.includes('query RefsPage')) return respond(server.refsPages?.[refsPage++]);
    if (query.includes('query MoreComments')) return respond(server.commentPages?.[commentPage++] ?? fixture('comments-35-page2.json'));
    if (query.includes('query Files')) {
      if (server.second !== undefined) return respond(server.second.body, server.second.status ?? 200);
      const files = server.files ?? FILES;
      const repository: Json = {};
      // Every alias in the text is paired with its variable, as GitHub does.
      for (const [, alias, variable] of query.matchAll(/(\w+): object\(expression: \$(\w+)\)/g)) {
        repository[alias as string] = blob(files[String(variables[variable as string])] ?? null);
      }
      return respond({ data: { rateLimit: { cost: 1, remaining: 3990 }, repository } });
    }
    throw new Error(`the fake GitHub does not know this query: ${query.slice(0, 40)}`);
  };
  return { fetchImpl, seen };
}

async function snapshotOf(server: Server = {}): Promise<{ snapshot: Snapshot; seen: Seen[] }> {
  const { fetchImpl, seen } = fakeGithub(server);
  const result = await fetchSnapshot({ token: TOKEN, fetchImpl, now: () => NOW });
  if (!result.ok) throw new Error(`the snapshot failed: ${result.error.code} ${result.error.message}`);
  return { snapshot: result.data, seen };
}

/** The request of call 2 (the one with the files). */
const filesCall = (seen: Seen[]): Seen => {
  const found = seen.find((entry) => entry.query.includes('query Files'));
  if (found === undefined) throw new Error('call 2 was not made');
  return found;
};

const rowOf = (snapshot: Snapshot, branch: string) => {
  const row = snapshot.workstreams.find((candidate) => candidate.branch === branch);
  if (row === undefined) throw new Error(`no row for ${branch}`);
  return row;
};

describe('fetchSnapshot with the fixtures', () => {
  it('makes call 1, one page of comments (decision 35 has more) and call 2, with the token in the header only, and keeps the cost of each', async () => {
    const { snapshot, seen } = await snapshotOf();
    expect(seen).toHaveLength(3);
    expect(seen.map((entry) => entry.query.match(/query (\w+)/)?.[1])).toEqual(['Snapshot', 'MoreComments', 'Files']);
    expect(seen[0]?.variables).toMatchObject({ owner: 'markhazlewood42', name: 'shadow-jog', author: 'markhazlewood42', mainRef: 'refs/heads/main' });
    expect(seen[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // Neither the query nor a variable nor the result holds the token.
    for (const entry of seen) expect(JSON.stringify([entry.query, entry.variables])).not.toContain(TOKEN);
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
    expect(snapshot.cost).toEqual([
      { call: expect.stringContaining('call 1'), cost: 5, remaining: 4000 },
      { call: expect.stringContaining('decision 35'), cost: 1, remaining: 3999 },
      { call: expect.stringContaining('call 2'), cost: 1, remaining: 3990 },
    ]);
    expect(snapshot.problems).toEqual([]);
  });

  it('returns the branches newest first, in the type of the Git panel plus the tip', async () => {
    const { snapshot } = await snapshotOf();
    expect(snapshot.branches.map((branch) => branch.name)).toEqual(['main', 'feature-a', 'moved-f', 'draft-b', 'Wrong_Name', 'done-c', 'plain-g', 'spike/bad-checks', 'hack"})}{#$e0', 'Bot-Branch.v1']);
    expect(snapshot.branches[1]).toEqual({ name: 'feature-a', sha: sha('a01'), date: '2026-10-11T09:00:00Z', subject: 'Fixture commit', upstream: null, track: null, worktree: null });
  });

  it('reads the CI result from the newest commit that has a run of the CI workflow', async () => {
    const { snapshot } = await snapshotOf();
    // The newest commit has only a Playtest run. The next one has a failed and a passed CI run: the newer one (the re-run) counts.
    expect(snapshot.ci).toEqual({ state: 'passing', createdAt: '2026-10-11T20:05:00Z', url: 'https://github.com/fixture-owner/fixture-repo/actions/runs/CI-2026-10-11T20:05:00Z' });
    expect(parseCi(null)).toEqual({ state: 'none', createdAt: null, url: null });
    expect(parseCi({ target: { history: { nodes: [{ oid: 'x', checkSuites: { nodes: [{ status: 'REQUESTED', conclusion: null, workflowRun: { createdAt: '2026-10-11T00:00:00Z', url: 'https://example.com/r', workflow: { name: 'CI' } } }] } }] } } }).state).toBe('running');
  });

  it('lists the pull requests as the GitHub panel does: open first, merged in the last 7 days, forks included', async () => {
    const { snapshot } = await snapshotOf();
    expect(snapshot.github.open.map((pr) => pr.number)).toEqual([19, 15, 12, 11, 10]);
    // PR 17 merged in September and PR 21 was closed without a merge: neither is in the list.
    expect(snapshot.github.merged.map((pr) => pr.number).sort()).toEqual([13, 14, 16, 18]);
  });
});

describe('paging', () => {
  it('follows the cursors of the branches, 100 a page, with a separate small query', async () => {
    const all = (call1().data.repository.refs as { nodes: Json[] }).nodes;
    const first = call1();
    (first.data.repository.refs as Json) = { totalCount: all.length, pageInfo: { hasNextPage: true, endCursor: 'CURSOR-A' }, nodes: all.slice(0, 4) };
    const second = { data: { rateLimit: { cost: 1, remaining: 3999 }, repository: { refs: { totalCount: all.length, pageInfo: { hasNextPage: true, endCursor: 'CURSOR-B' }, nodes: all.slice(4, 7) } } } };
    const third = { data: { rateLimit: { cost: 1, remaining: 3998 }, repository: { refs: { totalCount: all.length, pageInfo: { hasNextPage: false, endCursor: 'END' }, nodes: all.slice(7) } } } };
    const { snapshot, seen } = await snapshotOf({ first, refsPages: [second, third] });

    expect(snapshot.branches).toHaveLength(all.length);
    const pages = seen.filter((entry) => entry.query === REFS_PAGE_QUERY);
    expect(pages.map((entry) => entry.variables.after)).toEqual(['CURSOR-A', 'CURSOR-B']);
    expect(pages[0]?.variables.first).toBe(100);
    // Two extra pages, one page of comments and the file call: five calls in all, and the cost of each is counted.
    expect(snapshot.cost.map((entry) => entry.cost)).toEqual([5, 1, 1, 1, 1]);
    // A row exists for the branches of the later pages too.
    expect(rowOf(snapshot, 'spike/bad-checks').lookup?.sha).toBe(sha('5a1'));
  });

  it('stops at 20 pages and says so', async () => {
    const first = call1();
    (first.data.repository.refs as { pageInfo: Json }).pageInfo = { hasNextPage: true, endCursor: 'C' };
    const endless = { data: { rateLimit: { cost: 1, remaining: 1 }, repository: { refs: { totalCount: 9999, pageInfo: { hasNextPage: true, endCursor: 'C' }, nodes: [] } } } };
    const { snapshot } = await snapshotOf({ first, refsPages: Array.from({ length: 30 }, () => endless) });
    expect(snapshot.problems.map((problem) => problem.code)).toContain('branches-truncated');
  });

  it('reads a later page of comments, because the answer is the newest comment', async () => {
    const { snapshot, seen } = await snapshotOf();
    const more = seen.filter((entry) => entry.query === COMMENTS_PAGE_QUERY);
    expect(more).toHaveLength(1);
    expect(more[0]?.variables).toMatchObject({ number: 35, after: 'CURSOR-1', first: 100 });
    expect(snapshot.decisions.recent.find((issue) => issue.number === 35)?.answer).toMatchObject({ option: 'A', note: 'found on page 2', complete: true });
  });

  it('reports a decision whose comments never end, and does not loop forever', async () => {
    const endless = { data: { rateLimit: { cost: 1, remaining: 1 }, repository: { issue: { comments: { pageInfo: { hasNextPage: true, endCursor: 'X' }, nodes: [] } } } } };
    const { snapshot } = await snapshotOf({ commentPages: Array.from({ length: 30 }, () => endless) });
    expect(snapshot.problems.map((problem) => problem.code)).toContain('decision-comments-truncated');
  });
});

describe('aliases and variables', () => {
  const HOSTILE = ['x"}) { viewer { login } } #', 'a}{b', 'quote"quote', 'a\nb', '\\"',"single'quote", '${process.env.TOKEN}', '$x0 } {'];

  it('builds aliases b0, b1, ... and puts every expression in a variable, never in the text', () => {
    const expressions = HOSTILE.map((name) => `${sha('a01')}:docs/workstreams/${name}.md`);
    const { query, variables } = buildFilesQuery(expressions);
    for (const [index, expression] of expressions.entries()) {
      expect(query).toContain(`${aliasFor(index)}: object(expression: $e${index})`);
      expect(query).toContain(`$e${index}: String!`);
      expect(variables[`e${index}`]).toBe(expression);
    }
    // None of the hostile text, and not the sha, reaches the query.
    for (const name of HOSTILE) expect(query).not.toContain(name);
    expect(query).not.toContain(sha('a01'));
    // Every `expression:` argument in the text is a variable.
    const arguments_ = [...query.matchAll(/expression: ([^)]+)\)/g)].map((match) => match[1]);
    expect(arguments_.length).toBe(HOSTILE.length + 3);
    for (const argument of arguments_) expect(argument).toMatch(/^\$[A-Za-z0-9]+$/);
    // The three files of main use variables too.
    expect(variables).toMatchObject({ mainStatus: 'main:status.md', mainRoadmap: 'main:docs/roadmap/roadmap.json', mainMigration: 'main:docs/engine/migration.md' });
  });

  it('gives the same query text whatever the branch names are', () => {
    const one = buildFilesQuery(['1:a', '2:b']).query;
    const other = buildFilesQuery(['"}{', '\\n']).query;
    expect(other).toBe(one);
  });

  it('does not look up a branch name outside the rule, so a hostile ref name never reaches the query or the variables', async () => {
    const { snapshot, seen } = await snapshotOf();
    const second = filesCall(seen);
    expect(second.query).not.toContain('hack');
    expect(JSON.stringify(second.variables)).not.toContain('hack');
    expect(JSON.stringify(second.variables)).not.toContain('Bot-Branch');
    expect(JSON.stringify(second.variables)).not.toContain('Wrong_Name');
    expect(rowOf(snapshot, 'hack"})}{#$e0')).toMatchObject({ lookup: null, workstream: null });
    // Eight files are looked up (see the lookup test below; gone-h is read and then left out, as it has no file) plus the three files of main.
    expect(Object.keys(second.variables).filter((key) => /^e\d+$/.test(key))).toHaveLength(8);
  });

  it('keeps the call 1 constants free of text from outside', () => {
    expect(snapshotVariables()).toMatchObject({ author: 'markhazlewood42' });
    expect(SNAPSHOT_QUERY).toContain('filterBy: {createdBy: $author}');
    expect(SNAPSHOT_QUERY).toContain('statusCheckRollup');
    expect(SNAPSHOT_QUERY).toContain('refs(refPrefix: "refs/heads/"');
    expect(commentsPageVariables(7, 'x')).toMatchObject({ number: 7, after: 'x' });
  });
});

describe('which commit the workstream file is read at', () => {
  it('uses the head of an open pull request, the merge commit of a merged one, and the tip of a branch with no pull request', async () => {
    const { snapshot } = await snapshotOf();
    expect(rowOf(snapshot, 'feature-a').lookup).toEqual({ sha: sha('a01'), source: 'pr-head' });
    expect(rowOf(snapshot, 'spike/bad-checks').lookup).toEqual({ sha: sha('5a1'), source: 'pr-head' });
    expect(rowOf(snapshot, 'done-c').lookup).toEqual({ sha: sha('c09'), source: 'merge-commit' });
    expect(rowOf(snapshot, 'plain-g').lookup).toEqual({ sha: sha('9a1'), source: 'branch-tip' });
  });

  it('asks GitHub for exactly those expressions', async () => {
    const { seen } = await snapshotOf();
    const asked = Object.entries(filesCall(seen).variables)
      .filter(([key]) => /^e\d+$/.test(key))
      .map(([, value]) => value)
      .sort();
    expect(asked).toEqual(
      [
        `${sha('a01')}:docs/workstreams/feature-a.md`,
        `${sha('5a1')}:docs/workstreams/spike/bad-checks.md`,
        `${sha('b01')}:docs/workstreams/draft-b.md`,
        `${sha('c09')}:docs/workstreams/done-c.md`,
        `${sha('f02')}:docs/workstreams/moved-f.md`,
        `${sha('9a1')}:docs/workstreams/plain-g.md`,
        `${sha('d09')}:docs/workstreams/gone-d.md`,
        `${sha('0e9')}:docs/workstreams/gone-h.md`,
      ].sort(),
    );
  });

  it('gives a merged pull request whose branch is deleted a row at the merge commit, for 14 days', async () => {
    const { snapshot } = await snapshotOf();
    const gone = rowOf(snapshot, 'gone-d');
    expect(gone.head).toBeNull();
    expect(gone.lookup).toEqual({ sha: sha('d09'), source: 'merge-commit' });
    expect(gone.pr?.number).toBe(16);
    expect(gone.workstream).toMatchObject({ ok: true, workstream: { branch: 'gone-d' } });
    // gone-e merged 32 days ago: no row, and no lookup. gone-h merged a day ago and left no file: no row either.
    expect(snapshot.workstreams.map((row) => row.branch)).not.toContain('gone-e');
    expect(snapshot.workstreams.map((row) => row.branch)).not.toContain('gone-h');
  });

  it('reads the branch tip, and not the old pull request, when the branch moved on after the merge', async () => {
    const { snapshot } = await snapshotOf();
    const moved = rowOf(snapshot, 'moved-f');
    expect(moved.pr).toBeNull();
    expect(moved.lookup).toEqual({ sha: sha('f02'), source: 'branch-tip' });
  });

  it('ignores a pull request from a fork, even when its branch has the name of a branch here', async () => {
    const { snapshot, seen } = await snapshotOf();
    // PR 19 is from a fork and calls its branch feature-a. It is in the list of pull requests, and it is not the pull request of the row.
    expect(snapshot.github.open.map((pr) => pr.number)).toContain(19);
    expect(rowOf(snapshot, 'feature-a').pr?.number).toBe(10);
    expect(JSON.stringify(filesCall(seen).variables)).not.toContain(sha('fa1'));
    // A fork pull request cannot make a red row for a branch either: PR 20 (closed, from a fork) names the hostile branch.
    expect(rowOf(snapshot, 'hack"})}{#$e0').pr).toBeNull();
  });

  it('does not look up a commit that is not a full sha', () => {
    const refs = parseRefsPage({ pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ name: 'short-sha', target: { __typename: 'Commit', oid: 'abc123', committedDate: '2026-10-11T00:00:00Z', messageHeadline: 'x' } }] });
    const { plans, problems } = planRows(refs.branches, [], NOW);
    expect(plans[0]?.expression).toBeNull();
    expect(problems.map((problem) => problem.code)).toEqual(['workstream-lookup-skipped']);
  });
});

describe('the workstream rows', () => {
  it('is a valid row for a good file, with the fields of the shared validator', async () => {
    const { snapshot } = await snapshotOf();
    const row = rowOf(snapshot, 'feature-a');
    expect(row.workstream).toMatchObject({ ok: true, path: 'docs/workstreams/feature-a.md', workstream: { type: 'workstream', branch: 'feature-a', state: 'active', roadmap: 'fixture-item' } });
    expect(row.head).toEqual({ sha: sha('a01'), date: '2026-10-11T09:00:00Z', subject: 'Fixture commit' });
  });

  it('is a neutral row (null) when the file is missing', async () => {
    const { snapshot } = await snapshotOf();
    expect(rowOf(snapshot, 'draft-b').workstream).toBeNull();
  });

  it('is a red row, with the path and the field, for a file that does not pass the validator', async () => {
    const { snapshot } = await snapshotOf();
    const row = rowOf(snapshot, 'spike/bad-checks').workstream;
    expect(row?.ok).toBe(false);
    if (row?.ok !== false) throw new Error('expected a red row');
    expect(row.path).toBe('docs/workstreams/spike/bad-checks.md');
    expect(row.message).toContain('docs/workstreams/spike/bad-checks.md:');
    expect(row.errors.join(' ')).toContain('roadmap');
    expect(row.errors.join(' ')).toContain('state must be one of');
  });

  it('is a neutral row for a name outside the rule that has no file (a bot branch)', async () => {
    const { snapshot } = await snapshotOf();
    expect(rowOf(snapshot, 'Bot-Branch.v1')).toMatchObject({ workstream: null, lookup: null });
  });

  it('is a red row, with no lookup, for a name outside the rule that has a file', async () => {
    const { snapshot } = await snapshotOf();
    const row = rowOf(snapshot, 'Wrong_Name');
    expect(row.lookup).toBeNull();
    expect(row.workstream).toMatchObject({ ok: false, path: 'docs/workstreams/Wrong_Name.md' });
    expect(row.workstream?.ok === false && row.workstream.message).toContain('must be lowercase');
  });

  it('is a red row for a file that GitHub cut off, one that is binary, and a path that is a folder', () => {
    const plans = ['one', 'two', 'three'].map((branch) => ({ branch, head: null, pr: null, expression: `${sha('a01')}:docs/workstreams/${branch}.md`, lookup: { sha: sha('a01'), source: 'branch-tip' as const }, settled: null }));
    const repository = {
      b0: { text: 'abc', byteSize: 9_999_999, isBinary: false, isTruncated: true },
      b1: { text: '', byteSize: 3, isBinary: true, isTruncated: false },
      b2: {}, // a folder: it has none of the fields of a file
      mainStatus: { text: 's', byteSize: 1, isBinary: false, isTruncated: false },
      mainRoadmap: null,
      mainMigration: { text: 'm', byteSize: 1, isBinary: false, isTruncated: true },
    };
    // The rows have no head and a red verdict, so none is dropped.
    const { rows, main, problems } = rowsFromFiles(plans, repository);
    expect(rows.map((row) => row.workstream?.ok)).toEqual([false, false, false]);
    expect(rows[0]?.workstream?.ok === false && rows[0].workstream.message).toContain('too big');
    expect(rows[2]?.workstream?.ok === false && rows[2].workstream.message).toContain('not a text file');
    expect(main).toEqual({ status: 's', roadmap: null, migration: null });
    expect(problems.map((problem) => problem.code).sort()).toEqual(['migration-unavailable', 'roadmap-unavailable']);
  });

  it('reads the three files of main', async () => {
    const { snapshot } = await snapshotOf();
    expect(snapshot.main.status).toContain('Fixture status');
    expect(snapshot.main.roadmap).toBe('{"items":[]}\n');
    expect(snapshot.main.migration).toContain('Fixture migration');
  });

  it('reports a file of main that is missing, and keeps the rest', async () => {
    const files = { ...FILES };
    delete files['main:status.md'];
    const { snapshot } = await snapshotOf({ files });
    expect(snapshot.main.status).toBeNull();
    expect(snapshot.problems).toEqual([{ code: 'status-unavailable', message: 'status.md on main: the file is not there' }]);
  });

  it('readBlob tells a missing file, a text, and a file that is not usable', () => {
    expect(readBlob(null, 'x')).toEqual({ kind: 'missing' });
    expect(readBlob({ text: 'hi', isBinary: false, isTruncated: false }, 'x')).toEqual({ kind: 'text', text: 'hi' });
    expect(readBlob({}, 'x').kind).toBe('unreadable');
    expect(() => readBlob(undefined, 'x')).toThrow(/missing from the reply/);
  });
});

/** A pull request node with the fields the parser reads. */
const prNode = (overrides: Json = {}): Json => ({
  number: 7,
  title: 'T',
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'b',
  headRefOid: sha('a01'),
  isCrossRepository: false,
  updatedAt: '2026-10-11T00:00:00Z',
  mergedAt: null,
  reviewDecision: null,
  author: { login: 'markhazlewood42' },
  mergeCommit: null,
  latestReviews: { nodes: [] },
  files: { nodes: [] },
  statusCheckRollup: null,
  ...overrides,
});
const rollup = (...nodes: Json[]): Json => ({ contexts: { nodes } });
const checkRun = (status: string, conclusion: string | null, name = 'check'): Json => ({ __typename: 'CheckRun', name, status, conclusion, detailsUrl: 'https://github.com/o/r/runs/1' });

describe('pull request and check state mapping (the rules of the local GitHub module)', () => {
  const parse = (overrides: Json) => parsePullRequests({ nodes: [prNode(overrides)] }, 'prs')[0]?.pr;

  it('maps each state of a check run', () => {
    const summary = (status: string, conclusion: string | null) => parse({ statusCheckRollup: rollup(checkRun(status, conclusion)) })?.checksSummary;
    expect(summary('COMPLETED', 'SUCCESS')).toBe('pass');
    for (const conclusion of ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) expect(summary('COMPLETED', conclusion), conclusion).toBe('fail');
    for (const status of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING']) expect(summary(status, null), status).toBe('pending');
    expect(summary('COMPLETED', 'SKIPPED')).toBe('none');
    expect(summary('COMPLETED', 'NEUTRAL')).toBe('none');
    expect(summary('COMPLETED', null)).toBe('pending');
  });

  it('maps a status context, an unknown kind of check, and no checks', () => {
    const context = (state: string): Json => ({ __typename: 'StatusContext', context: 'deploy', state, targetUrl: 'https://example.com/d' });
    expect(parse({ statusCheckRollup: rollup(context('SUCCESS')) })?.checks).toEqual([{ name: 'deploy', status: 'pass', url: 'https://example.com/d' }]);
    expect(parse({ statusCheckRollup: rollup(context('ERROR')) })?.checksSummary).toBe('fail');
    expect(parse({ statusCheckRollup: rollup(context('EXPECTED')) })?.checksSummary).toBe('pending');
    expect(parse({ statusCheckRollup: rollup({ __typename: 'FutureCheck', name: 'f' }) })?.checks).toEqual([{ name: 'f', status: 'pending', url: null }]);
    expect(parse({ statusCheckRollup: null })).toMatchObject({ checks: [], checksSummary: 'none', attention: null });
  });

  it('puts a failure first, then a check that is not done', () => {
    expect(parse({ statusCheckRollup: rollup(checkRun('IN_PROGRESS', null), checkRun('COMPLETED', 'FAILURE', 'b')) })?.checksSummary).toBe('fail');
    expect(parse({ statusCheckRollup: rollup(checkRun('IN_PROGRESS', null), checkRun('COMPLETED', 'SUCCESS', 'b')) })?.checksSummary).toBe('pending');
  });

  it('maps the review state and what waits for Mark', () => {
    const ok = rollup(checkRun('COMPLETED', 'SUCCESS'));
    expect(parse({ statusCheckRollup: ok, reviewDecision: 'APPROVED' })).toMatchObject({ reviewDecision: 'APPROVED', attention: 'merge' });
    expect(parse({ statusCheckRollup: ok, reviewDecision: 'CHANGES_REQUESTED' })).toMatchObject({ attention: 'fix' });
    expect(parse({ statusCheckRollup: rollup(checkRun('COMPLETED', 'FAILURE')) })).toMatchObject({ attention: 'fix' });
    expect(parse({ statusCheckRollup: ok, isDraft: true })?.attention).toBeNull();
    expect(parse({ statusCheckRollup: ok, author: { login: 'stranger' } })?.attention).toBeNull();
    expect(parse({ statusCheckRollup: ok, author: null })).toMatchObject({ author: 'unknown', attention: null });
    expect(parse({ reviewDecision: null })?.reviewDecision).toBeNull();
  });

  it('keeps the latest reviews without their words, and the merge time of a merged pull request', () => {
    const pr = parse({ state: 'MERGED', mergedAt: '2026-10-10T00:00:00Z', latestReviews: { nodes: [{ author: { login: 'rev' }, state: 'APPROVED', submittedAt: '2026-10-09T00:00:00Z', body: 'REVIEW-WORDS' }] } });
    expect(pr).toMatchObject({ state: 'MERGED', mergedAt: '2026-10-10T00:00:00Z', reviews: [{ by: 'rev', state: 'APPROVED', at: '2026-10-09T00:00:00Z' }] });
    expect(JSON.stringify(pr)).not.toContain('REVIEW-WORDS');
  });

  it('makes only http and https addresses into links', () => {
    expect(parse({ url: 'javascript:alert(1)' })?.url).toBe('');
    expect(parse({ statusCheckRollup: rollup({ ...checkRun('COMPLETED', 'SUCCESS'), detailsUrl: 'data:text/html,x' }) })?.checks[0]?.url).toBeNull();
  });
});

describe('trust: only markhazlewood42 can answer a decision', () => {
  const MARK = 'markhazlewood42';
  const node = (login: string | null, decidedBy: string | null, extra: Json = {}): Json => ({
    number: 50,
    title: 'Decision: x',
    url: 'https://github.com/o/r/issues/50',
    state: 'CLOSED',
    body: '## Question\nQ?\n\n## Options\n- A: one\n- B: two\n',
    createdAt: '2026-10-11T00:00:00Z',
    author: { login: MARK },
    labels: { nodes: [{ name: 'decided' }] },
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: login === null ? [] : [{ author: { login }, body: 'Decision: A. note', createdAt: '2026-10-11T10:00:00Z' }] },
    timelineItems: { nodes: decidedBy === null ? [] : [{ __typename: 'LabeledEvent', createdAt: '2026-10-11T10:01:00Z', label: { name: 'decided' }, actor: { login: decidedBy } }] },
    ...extra,
  });
  const infoOf = (...nodes: Json[]) => decisionsInfoOf(parseDecisionRaws({ nodes }, 'd'), NOW.getTime());

  it('counts a comment and a label by markhazlewood42', () => {
    const info = infoOf(node(MARK, MARK));
    expect(info.recent).toHaveLength(1);
    expect(info.recent[0]?.answer).toMatchObject({ option: 'A', note: 'note', complete: true });
  });

  it('counts the same account written in other letter case (GitHub logins are case-insensitive)', () => {
    expect(infoOf(node('MarkHazlewood42', 'MARKHAZLEWOOD42')).recent).toHaveLength(1);
  });

  it('does not count an answer, or a label, from another account', () => {
    const others = [
      'someone-else',
      'markhazlewood42x', // a longer login
      'xmarkhazlewood42',
      'markhazlewood4', // a shorter one
      'markhazlewood-42', // a look-alike with a hyphen
      'mark-hazlewood42',
      'markhazlewood42 ', // a trailing space
      'marKhazlewood42', // the Kelvin sign lowercases to a plain k
      'ｍarkhazlewood42', // a full-width m
      'markhazlewood42​', // a zero-width space
      '',
    ];
    for (const other of others) {
      // A comment by the other account on an issue that Mark labeled: there is no answer from Mark, so the issue stays closed and out of both lists.
      expect(infoOf(node(other, MARK)), `comment by ${JSON.stringify(other)}`).toEqual({ open: [], recent: [] });
      // A comment by Mark, but the label `decided` was put on by the other account: the answer is not complete.
      expect(infoOf(node(MARK, other)), `label by ${JSON.stringify(other)}`).toEqual({ open: [], recent: [] });
      // The same two on an open issue: the answer is not Mark's, so there is none.
      const open = infoOf(node(other, MARK, { state: 'OPEN', labels: { nodes: [{ name: 'decision' }] } }));
      expect(open.open, `open, comment by ${JSON.stringify(other)}`).toHaveLength(1);
      expect(open.open[0]?.answer, `open, comment by ${JSON.stringify(other)}`).toBeNull();
    }
  });

  it('does not let a newer comment of another account replace the answer of Mark', () => {
    const issue = node(MARK, MARK);
    (issue.comments as { nodes: Json[] }).nodes.push({ author: { login: 'markhazlewood42x' }, body: 'Decision: B. I replace it', createdAt: '2026-10-11T12:00:00Z' });
    expect(infoOf(issue).recent[0]?.answer).toMatchObject({ option: 'A', note: 'note' });
  });

  it('does not take an issue of another account, whatever its label says', () => {
    expect(infoOf(node(MARK, MARK, { author: { login: 'stranger' } }))).toEqual({ open: [], recent: [] });
    expect(infoOf(node(MARK, MARK, { author: null }))).toEqual({ open: [], recent: [] });
  });

  it('does not count a label event with no actor (a deleted account), or the event of a different label', () => {
    const noActor = node(MARK, MARK);
    (noActor.timelineItems as { nodes: Json[] }).nodes = [{ __typename: 'LabeledEvent', createdAt: '2026-10-11T10:01:00Z', label: { name: 'decided' }, actor: null }];
    expect(infoOf(noActor)).toEqual({ open: [], recent: [] });
    const otherLabel = node(MARK, MARK);
    (otherLabel.timelineItems as { nodes: Json[] }).nodes = [{ __typename: 'LabeledEvent', createdAt: '2026-10-11T10:01:00Z', label: { name: 'bug' }, actor: { login: MARK } }];
    expect(infoOf(otherLabel)).toEqual({ open: [], recent: [] });
  });

  it('uses the newest label event: a label that another account put back is not Mark\'s', () => {
    const issue = node(MARK, MARK);
    (issue.timelineItems as { nodes: Json[] }).nodes.push({ __typename: 'LabeledEvent', createdAt: '2026-10-11T11:00:00Z', label: { name: 'decided' }, actor: { login: 'someone-else' } });
    expect(infoOf(issue)).toEqual({ open: [], recent: [] });
  });

  it('applies all of it to the fixture decisions end to end', async () => {
    const { snapshot } = await snapshotOf();
    // Open: 30 (a stranger wrote "Decision: A") and 34 (three look-alikes and a deleted account wrote one). Neither has an answer. 33 is a stranger's issue.
    expect(snapshot.decisions.open.map((issue) => [issue.number, issue.answer])).toEqual([
      [30, null],
      [34, null],
    ]);
    // Answered: 31 (Mark's answer B; a newer look-alike comment is ignored) and 35 (the answer is on the second page of comments). 32 was labeled by another account.
    expect(snapshot.decisions.recent.map((issue) => [issue.number, issue.answer?.option])).toEqual([
      [31, 'B'],
      [35, 'A'],
    ]);
    expect(snapshot.decisions.recent[0]).toMatchObject({ state: 'answered', question: 'Which one?', recommended: 'A', options: [{ id: 'A', text: 'first option' }, { id: 'B', text: 'second option' }] });
    const all = [...snapshot.decisions.open, ...snapshot.decisions.recent];
    expect(all.map((issue) => issue.number)).not.toContain(32);
    expect(all.map((issue) => issue.number)).not.toContain(33);
  });

  it('adds the comments of a later page without losing the first ones', () => {
    const [raw] = parseDecisionRaws({ nodes: [node('stranger', MARK, { comments: { pageInfo: { hasNextPage: true, endCursor: 'C1' }, nodes: [{ author: { login: 'stranger' }, body: 'x', createdAt: '2026-10-11T00:00:00Z' }] } })] }, 'd');
    expect(raw?.moreCommentsAfter).toBe('C1');
    const next = addComments(raw as NonNullable<typeof raw>, { pageInfo: { hasNextPage: false, endCursor: 'E' }, nodes: [{ author: { login: MARK }, body: 'Decision: B', createdAt: '2026-10-11T09:00:00Z' }] });
    expect(next.moreCommentsAfter).toBeNull();
    expect((next.raw.comments as unknown[]).length).toBe(2);
  });
});

describe('errors and partial data return a typed error and never throw', () => {
  const run = (fetchImpl: FetchLike) => fetchSnapshot({ token: TOKEN, fetchImpl, now: () => NOW });
  const failWith = async (fetchImpl: FetchLike) => {
    const result = await run(fetchImpl);
    if (result.ok) throw new Error('expected a failure');
    return result.error;
  };

  it('names an HTTP 401', async () => {
    expect(await failWith(async () => respond({ message: 'Bad credentials' }, 401))).toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('names a rate limit, from the status and the words, from the header, and from a GraphQL error', async () => {
    expect(await failWith(async () => respond({ message: 'API rate limit exceeded for user' }, 403))).toMatchObject({ code: 'rate-limited', status: 403 });
    expect(await failWith(async () => respond({ message: 'Slow down' }, 429, { 'x-ratelimit-remaining': '0' }))).toMatchObject({ code: 'rate-limited' });
    expect(await failWith(async () => respond({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }], data: null }))).toMatchObject({ code: 'rate-limited' });
    // A 403 that is not about the limit is another error.
    expect(await failWith(async () => respond({ message: 'Resource not accessible' }, 403))).toMatchObject({ code: 'http-error', status: 403 });
  });

  it('names any other HTTP status', async () => {
    expect(await failWith(async () => respond('<html>Bad gateway</html>', 502))).toMatchObject({ code: 'http-error', status: 502 });
  });

  it('names a network failure and a timeout, without passing on the request', async () => {
    const error = await failWith(async () => {
      throw Object.assign(new Error(`connect failed with ${TOKEN}`), { name: 'TypeError' });
    });
    expect(error.code).toBe('network');
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('names a reply that is not JSON, or has no data', async () => {
    expect(await failWith(async () => respond('not json at all'))).toMatchObject({ code: 'bad-response' });
    expect(await failWith(async () => respond('[1,2,3]'))).toMatchObject({ code: 'bad-response' });
    expect(await failWith(async () => respond({ data: null }))).toMatchObject({ code: 'bad-response' });
    expect(await failWith(async () => ({ ...respond({}), text: async () => Promise.reject(new Error('socket closed')) }))).toMatchObject({ code: 'network' });
  });

  it('refuses a reply with an `errors` list, also when it has data, and says that the data was partial', async () => {
    const partial = { ...call1(), errors: [{ type: 'NOT_FOUND', path: ['repository', 'x'], message: 'Could not resolve to a thing' }] };
    expect(await failWith(async () => respond(partial))).toMatchObject({ code: 'graphql-error', partial: true, message: expect.stringContaining('Could not resolve') });
    expect(await failWith(async () => respond({ errors: [{ message: 'Parse error' }] }))).toMatchObject({ code: 'graphql-error', partial: false });
    expect(await failWith(async () => respond({ errors: [], data: null }))).toMatchObject({ code: 'bad-response' });
  });

  it('names a repository that GitHub does not return', async () => {
    const reply = call1();
    (reply.data as Json).repository = null;
    expect(await failWith(async () => respond(reply))).toMatchObject({ code: 'bad-response', message: expect.stringContaining('repository') });
  });

  it('names an unknown shape in call 1, whichever field it is, and does not throw', async () => {
    const break_ = (change: (reply: ReturnType<typeof call1>) => void): ReturnType<typeof call1> => {
      const reply = call1();
      change(reply);
      return reply;
    };
    const cases: [string, ReturnType<typeof call1>][] = [
      ['refs is a string', break_((r) => ((r.data.repository as Json).refs = 'oops'))],
      ['refs.nodes is not a list', break_((r) => ((r.data.repository.refs as Json).nodes = {}))],
      ['a branch with no commit', break_((r) => (((r.data.repository.refs as { nodes: Json[] }).nodes[0] as Json).target = { __typename: 'Tag', oid: 'x' }))],
      ['open pull requests missing', break_((r) => delete r.data.repository.open)],
      ['a pull request with no number', break_((r) => delete ((r.data.repository.open as { nodes: Json[] }).nodes[0] as Json).number)],
      ['a pull request with an unknown state', break_((r) => (((r.data.repository.open as { nodes: Json[] }).nodes[0] as Json).state = 'FLOATING'))],
      ['a pull request with no head', break_((r) => delete ((r.data.repository.open as { nodes: Json[] }).nodes[0] as Json).headRefOid)],
      ['decisions missing', break_((r) => delete r.data.repository.waiting)],
      ['an issue with no comments', break_((r) => delete ((r.data.repository.waiting as { nodes: Json[] }).nodes[0] as Json).comments)],
    ];
    for (const [what, reply] of cases) {
      const result = await run(async () => respond(reply));
      expect(result.ok, what).toBe(false);
      if (!result.ok) expect(result.error, what).toMatchObject({ code: 'bad-response' });
    }
  });

  it('survives an unknown kind of check and a null entry in a list', async () => {
    const reply = call1();
    const open = (reply.data.repository.open as { nodes: (Json | null)[] }).nodes;
    open.push(null);
    ((open[0] as Json).statusCheckRollup as { contexts: { nodes: unknown[] } }).contexts.nodes.push({ __typename: 'Mystery', foo: 1 }, null, 'text');
    const { snapshot } = await snapshotOf({ first: reply });
    expect(snapshot.github.open.find((pr) => pr.number === 10)?.checks.map((check) => check.name)).toEqual(['check', 'unknown check', 'unknown check', 'unknown check']);
  });

  it('keeps the snapshot, with a problem, when call 2 fails', async () => {
    for (const second of [{ status: 502, body: 'bad gateway' }, { body: { errors: [{ message: 'Timeout on validation' }] } }, { body: { data: { rateLimit: { cost: 1, remaining: 1 }, repository: { b0: 'not an object' } } } }]) {
      const { snapshot } = await snapshotOf({ second });
      expect(snapshot.workstreams, JSON.stringify(second)).toEqual([]);
      expect(snapshot.problems.map((problem) => problem.code)).toContain('workstreams-failed');
      // Call 1 still gave the branches, the pull requests, the CI result and the decisions.
      expect(snapshot.branches).toHaveLength(10);
      expect(snapshot.github.open).toHaveLength(5);
    }
  });

  it('reports a list of open pull requests that is cut short', async () => {
    const reply = call1();
    (reply.data.repository.open as { pageInfo: Json }).pageInfo = { hasNextPage: true };
    const { snapshot } = await snapshotOf({ first: reply });
    expect(snapshot.problems.map((problem) => problem.code)).toContain('open-prs-truncated');
  });

  it('reports a list of recent pull requests that is cut short while its last entry is still within 14 days, and only then', async () => {
    const cut = call1();
    (cut.data.repository.recent as { pageInfo: Json }).pageInfo = { hasNextPage: true };
    // The oldest entry of the fixture was updated on 2026-10-11, so a pull request that still counts may be on the next page.
    const { snapshot } = await snapshotOf({ first: cut });
    expect(snapshot.problems.map((problem) => problem.code)).toContain('recent-prs-truncated');

    // When the last entry on the page is older than 14 days, the rest is not wanted: a long history is not a problem.
    const old = call1();
    const recent = old.data.repository.recent as { pageInfo: Json; nodes: Json[] };
    recent.pageInfo = { hasNextPage: true };
    for (const node of recent.nodes) node.updatedAt = '2026-09-01T00:00:00Z';
    const quiet = await snapshotOf({ first: old });
    expect(quiet.snapshot.problems.map((problem) => problem.code)).not.toContain('recent-prs-truncated');
  });

  it('reports a list of waiting decisions, and a list of answered decisions, that has more issues than the page holds', async () => {
    for (const [list, code] of [
      ['waiting', 'decisions-waiting-truncated'],
      ['decided', 'decisions-answered-truncated'],
    ] as const) {
      const reply = call1();
      const page = reply.data.repository[list] as { nodes: unknown[]; totalCount?: number };
      page.totalCount = page.nodes.length + 1;
      const { snapshot } = await snapshotOf({ first: reply });
      const others = list === 'waiting' ? 'decisions-answered-truncated' : 'decisions-waiting-truncated';
      expect(snapshot.problems.map((problem) => problem.code), list).toContain(code);
      expect(snapshot.problems.map((problem) => problem.code), list).not.toContain(others);

      // A total equal to the nodes returned is complete.
      page.totalCount = page.nodes.length;
      const whole = await snapshotOf({ first: reply });
      expect(whole.snapshot.problems.map((problem) => problem.code), list).not.toContain(code);
    }
  });

  it('orders the answered decisions by the time of the last update, so a new answer on an old issue stays in the page', () => {
    expect(SNAPSHOT_QUERY).toMatch(/decided: issues\([^)]*orderBy: \{field: UPDATED_AT, direction: DESC\}/);
    expect(SNAPSHOT_QUERY).toMatch(/waiting: issues\([^)]*orderBy: \{field: CREATED_AT/);
  });

  it('does not throw when fetch is the real one and the network is not there', async () => {
    const result = await fetchSnapshot({ token: TOKEN, timeoutMs: 1, fetchImpl: () => Promise.reject(new TypeError('fetch failed')) });
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } });
  });
});
