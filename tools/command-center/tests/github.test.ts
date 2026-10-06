import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGh, readGhCalls, resetGh, setGhMode } from '../e2e/fake-gh';
import { GH_PR_FIELDS, parseGhPrs } from '../src/server/github/github';
import { classifyGhError } from '../src/server/github/errors';
import { createGithubSource } from '../src/server/github/module';
import { createHub } from '../src/server/hub';
import { registerGithubRoutes } from '../src/server/routes/github';
import { type Exec, createRunner } from '../src/server/runner';
import { PanelError } from '../src/server/source';
import type { GithubInfo, Panel, PullRequest } from '../src/shared/types';
import { PACKAGE_DIR, getFrom, makeApp, makeTestConfig } from './helpers';

// The GitHub module: the open pull requests and the ones merged in the last week, with their review
// state and checks, read through `gh pr list`. The parser is tested on synthetic gh output
// (fixtures/gh/prs.json: nine pull requests that are all made up); the module is tested over the
// real runner with the fake gh of the end-to-end tests under it, so a call that the runner's
// allow-list would refuse fails here too, and the fake's failure modes are the ones gh really has.

const PRS_JSON = readFileSync(join(PACKAGE_DIR, 'fixtures', 'gh', 'prs.json'), 'utf8');
const PRS_EMPTY_JSON = readFileSync(join(PACKAGE_DIR, 'fixtures', 'gh', 'prs-empty.json'), 'utf8');
/** The clock of the fixture: the merged dates of the pull requests are counted from this moment. */
const FIXTURE_NOW = new Date('2026-10-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const parsed = parseGhPrs(PRS_JSON, FIXTURE_NOW);
const byNumber = (list: readonly PullRequest[], number: number): PullRequest => {
  const found = list.find((pr) => pr.number === number);
  if (found === undefined) throw new Error(`pull request #${number} is not in the list`);
  return found;
};
const openPr = (number: number) => byNumber(parsed.open, number);

/** A minimal gh entry with the fields of the brief, for the tests that need one thing different. */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'T',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'b',
    url: 'https://github.com/o/r/pull/7',
    author: { login: 'someone' },
    updatedAt: '2026-10-05T00:00:00Z',
    mergedAt: null,
    reviewDecision: '',
    latestReviews: [],
    statusCheckRollup: [],
    ...over,
  };
}
const parseOne = (over: Record<string, unknown> = {}, now = FIXTURE_NOW) => parseGhPrs(JSON.stringify([entry(over)]), now);
const checkRun = (conclusion: string, status = 'COMPLETED', name = 'job') => ({ __typename: 'CheckRun', name, status, conclusion, detailsUrl: 'https://github.com/o/r/actions/runs/1' });

/** The error that `fn` throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, and it did not');
}

describe('parseGhPrs', () => {
  it('gh: CheckRun and StatusContext both map, a PR with no checks maps, review bodies are dropped', () => {
    // A check run: its name, its address, and its verdict.
    expect(openPr(101).checks).toEqual([{ name: 'check', status: 'pass', url: 'https://github.com/fixture-owner/fixture-repo/actions/runs/1001/job/2001' }]);
    expect(openPr(102).checks.map((c) => [c.name, c.status])).toEqual([['check', 'fail'], ['lint', 'pass']]);

    // A status context (the older kind of check): its context is the name, its target is the address, and SUCCESS and PENDING map.
    // A check run that is still running is pending, whatever it says of its conclusion.
    expect(openPr(104).checks).toEqual([
      { name: 'ci/legacy', status: 'pass', url: 'https://ci.fixture.example/builds/5' },
      { name: 'ci/deploy-preview', status: 'pending', url: 'https://ci.fixture.example/builds/6' },
      { name: 'check', status: 'pending', url: 'https://github.com/fixture-owner/fixture-repo/actions/runs/1007/job/2007' },
    ]);
    for (const [state, status] of [['SUCCESS', 'pass'], ['FAILURE', 'fail'], ['ERROR', 'fail'], ['PENDING', 'pending'], ['EXPECTED', 'pending']] as const) {
      const rollup = [{ __typename: 'StatusContext', context: 'ci', state, targetUrl: '' }];
      expect(parseOne({ statusCheckRollup: rollup }).open[0]?.checks).toEqual([{ name: 'ci', status, url: null }]);
    }

    // A pull request with no checks: an empty list and the summary "none". (A missing field or a null is the same.)
    expect(openPr(105)).toMatchObject({ checks: [], checksSummary: 'none', attention: null });
    for (const rollup of [undefined, null]) {
      const { statusCheckRollup: _unused, ...without } = entry();
      expect(parseGhPrs(JSON.stringify([{ ...without, statusCheckRollup: rollup }]), FIXTURE_NOW).open[0]).toMatchObject({ checks: [], checksSummary: 'none' });
    }

    // A review is who, which verdict and when. The words of the review are never copied.
    expect(openPr(101).reviews).toEqual([{ by: 'fixture-reviewer', state: 'APPROVED', at: '2026-10-05T09:30:00Z' }]);
    expect(Object.keys(openPr(101).reviews[0] ?? {}).sort()).toEqual(['at', 'by', 'state']);
    expect(PRS_JSON).toContain('REVIEW-BODY-MARKER'); // it is in the input ...
    expect(JSON.stringify(parsed)).not.toContain('REVIEW-BODY-MARKER'); // ... and nowhere in the output

    // The other fields come over as the brief names them.
    expect(openPr(101)).toMatchObject({
      number: 101,
      title: 'Fixture: the widget is ready to merge',
      url: 'https://github.com/fixture-owner/fixture-repo/pull/101',
      state: 'OPEN',
      isDraft: false,
      branch: 'feature/widget-ready',
      author: 'fixture-owner',
      updatedAt: '2026-10-05T09:30:00Z',
      mergedAt: null,
      reviewDecision: 'APPROVED',
    });
    expect(openPr(102).reviewDecision).toBeNull(); // gh writes "" when there is no decision
    expect(openPr(104)).toMatchObject({ reviewDecision: 'REVIEW_REQUIRED', author: 'fixture-bot' });
  });

  it('maps every conclusion of a check run, and a status that the page does not know is pending, never a pass', () => {
    const cases: [string, string, string][] = [
      ['COMPLETED', 'SUCCESS', 'pass'],
      ['COMPLETED', 'SKIPPED', 'skipped'],
      ['COMPLETED', 'NEUTRAL', 'skipped'],
      ['COMPLETED', 'FAILURE', 'fail'],
      ['COMPLETED', 'CANCELLED', 'fail'],
      ['COMPLETED', 'TIMED_OUT', 'fail'],
      ['COMPLETED', 'ACTION_REQUIRED', 'fail'],
      ['COMPLETED', 'STARTUP_FAILURE', 'fail'],
      ['COMPLETED', 'STALE', 'fail'],
      ['COMPLETED', '', 'pending'], // done, and no word on how it went: not a pass
      ['QUEUED', '', 'pending'],
      ['IN_PROGRESS', '', 'pending'],
      ['WAITING', '', 'pending'],
      ['PENDING', '', 'pending'],
      ['REQUESTED', '', 'pending'],
    ];
    for (const [status, conclusion, expected] of cases) {
      expect(parseOne({ statusCheckRollup: [checkRun(conclusion, status)] }).open[0]?.checks[0]?.status, `${status}/${conclusion}`).toBe(expected);
    }
    // Something that is neither a check run nor a status context: kept, as pending, and named as well as it can be.
    const odd = parseOne({ statusCheckRollup: [{ __typename: 'SomethingNew', name: 'future check' }, 'not even an object', null, { __typename: 'CheckRun' }] }).open[0];
    expect(odd?.checks.map((c) => c.status)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(odd?.checks[0]?.name).toBe('future check');
    expect(odd?.checks[3]?.name).toBe('unknown check');
    expect(odd?.attention).toBeNull();
  });

  it('sums the checks up: a failure first, then a check that is not done, then a pass, and none when nothing counts', () => {
    const summary = (...conclusions: [string, string?][]) =>
      parseOne({ statusCheckRollup: conclusions.map(([conclusion, status]) => checkRun(conclusion, status)) }).open[0]?.checksSummary;
    expect(summary(['SUCCESS'], ['SUCCESS'])).toBe('pass');
    expect(summary(['SUCCESS'], ['FAILURE'])).toBe('fail');
    expect(summary(['', 'IN_PROGRESS'], ['FAILURE'])).toBe('fail'); // a failure counts even when another check still runs
    expect(summary(['SUCCESS'], ['', 'QUEUED'])).toBe('pending');
    expect(summary(['SUCCESS'], ['SKIPPED'])).toBe('pass'); // skipped checks do not count against it
    expect(summary(['SKIPPED'], ['NEUTRAL'])).toBe('none'); // nothing ran, so there is nothing to call a pass
    expect(summary()).toBe('none');
  });

  it('attention: a draft never needs Mark, open with passing checks is merge, failing checks is fix', () => {
    expect(openPr(101).attention).toBe('merge'); // open, every check passes
    expect(openPr(102).attention).toBe('fix'); // open, one check failed
    expect(openPr(103)).toMatchObject({ isDraft: true, checksSummary: 'fail', attention: null }); // a draft with a failing check
    expect(openPr(104).attention).toBeNull(); // checks still run: nothing to do yet
    expect(openPr(105).attention).toBeNull(); // no checks: nothing says it is ready

    // A draft with passing checks does not need Mark either, and neither does anything that is not open.
    expect(parseOne({ isDraft: true, statusCheckRollup: [checkRun('SUCCESS')] }).open[0]).toMatchObject({ checksSummary: 'pass', attention: null });
    for (const pr of parsed.merged) expect(pr.attention, `#${pr.number}`).toBeNull();
    const mergedFailing = parseOne({ state: 'MERGED', mergedAt: '2026-10-06T00:00:00Z', statusCheckRollup: [checkRun('FAILURE')] }).merged[0];
    expect(mergedFailing).toMatchObject({ checksSummary: 'fail', attention: null });
  });

  it('merged keeps the last week only', () => {
    // The fixture: #106 merged 16 hours before the clock, #107 four days before, #108 eight days before. #109 was closed, never merged.
    expect(parsed.merged.map((pr) => pr.number)).toEqual([106, 107]);
    expect(parsed.merged[0]).toMatchObject({ state: 'MERGED', mergedAt: '2026-10-05T20:00:00Z' });
    // The open list has the open ones only, the one that was updated last first.
    expect(parsed.open.map((pr) => pr.number)).toEqual([104, 102, 101, 103, 105]);
    expect([...parsed.open, ...parsed.merged].map((pr) => pr.number)).not.toContain(109);

    // The edge: exactly 7 days is still in, one second more is out. The week is counted from the clock that the caller gives.
    const mergedAt = '2026-10-01T12:00:00Z';
    const at = (ms: number) => parseOne({ state: 'MERGED', mergedAt }, new Date(Date.parse(mergedAt) + ms)).merged.length;
    expect(at(7 * DAY - 1000)).toBe(1);
    expect(at(7 * DAY)).toBe(1);
    expect(at(7 * DAY + 1000)).toBe(0);
    expect(at(0)).toBe(1);
    expect(at(-DAY)).toBe(1); // a merge time a little ahead of this computer's clock (clock drift) is not dropped

    // Newest merge first, whatever the order of gh's list; a merged pull request with no usable time cannot be placed in the week, so it is left out.
    const mixed = parseGhPrs(
      JSON.stringify([
        entry({ number: 1, state: 'MERGED', mergedAt: '2026-10-03T00:00:00Z' }),
        entry({ number: 2, state: 'MERGED', mergedAt: '2026-10-05T00:00:00Z' }),
        entry({ number: 3, state: 'MERGED', mergedAt: null }),
        entry({ number: 4, state: 'MERGED', mergedAt: '0001-01-01T00:00:00Z' }),
        entry({ number: 5, state: 'MERGED', mergedAt: 'not a date' }),
      ]),
      FIXTURE_NOW,
    );
    expect(mixed.merged.map((pr) => pr.number)).toEqual([2, 1]);
  });

  it('a list with no pull request is an empty answer, and so is the empty fixture', () => {
    expect(parseGhPrs(PRS_EMPTY_JSON, FIXTURE_NOW)).toEqual({ open: [], merged: [] });
    expect(parseGhPrs('[]', FIXTURE_NOW)).toEqual({ open: [], merged: [] });
    expect(parseGhPrs('  \n[]\n', FIXTURE_NOW)).toEqual({ open: [], merged: [] });
  });

  it('keeps an address only when it is an http or https address, so a pull request cannot put a script into a link', () => {
    const odd = parseOne({
      url: 'javascript:alert(1)',
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'javascript:alert(2)' },
        { __typename: 'CheckRun', name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'data:text/html,<script>' },
        { __typename: 'CheckRun', name: 'c', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: '' },
        { __typename: 'CheckRun', name: 'd', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci.example/run/1' },
        { __typename: 'StatusContext', context: 'e', state: 'SUCCESS', targetUrl: ' javascript:alert(3)' },
      ],
    }).open[0];
    expect(odd?.url).toBe('');
    expect(odd?.checks.map((c) => c.url)).toEqual([null, null, null, 'https://ci.example/run/1', null]);
  });

  it('shows what is not known as "unknown" or empty and never throws for a field that is missing', () => {
    const bare = parseGhPrs(JSON.stringify([{ number: 9, state: 'OPEN' }]), FIXTURE_NOW).open[0];
    expect(bare).toEqual({
      number: 9,
      title: '',
      url: '',
      state: 'OPEN',
      isDraft: false,
      branch: '',
      author: 'unknown',
      updatedAt: '',
      mergedAt: null,
      reviewDecision: null,
      reviews: [],
      checks: [],
      checksSummary: 'none',
      attention: null,
    });
    // A deleted account has no author, and a review of one has no author either.
    const ghost = parseOne({ author: null, latestReviews: [{ author: null, state: 'COMMENTED', submittedAt: '2026-10-05T00:00:00Z' }, null] }).open[0];
    expect(ghost?.author).toBe('unknown');
    expect(ghost?.reviews).toEqual([{ by: 'unknown', state: 'COMMENTED', at: '2026-10-05T00:00:00Z' }]);
  });

  it('output that is not a list of pull requests is an error with the code gh-bad-output', () => {
    const failing: [string, string][] = [
      ['', 'not JSON'],
      ['not json', 'not JSON'],
      ['{"number":1}', 'not a list'],
      ['[1]', 'entry 1'],
      ['[{"title":"no number","state":"OPEN"}]', 'number'],
      ['[{"number":0,"state":"OPEN"}]', 'number'],
      ['[{"number":1.5,"state":"OPEN"}]', 'number'],
      ['[{"number":1,"state":"SOMETHING"}]', 'SOMETHING'],
      ['[{"number":1}]', 'state'],
    ];
    for (const [json, word] of failing) {
      const error = thrown(() => parseGhPrs(json, FIXTURE_NOW));
      expect(error, json).toBeInstanceOf(PanelError);
      expect((error as PanelError).code, json).toBe('gh-bad-output');
      expect((error as PanelError).message, json).toContain(word);
    }
  });
});

describe('classifyGhError', () => {
  const table: [number, string, string][] = [
    // The runner reports a program that is not installed as 127, and one that ran too long as 124.
    [127, 'gh: command not found', 'gh-missing'],
    [124, 'gh: timed out after 30000 ms', 'gh-timeout'],
    // Not signed in: what gh says without a login (exit code 4), what `gh auth status` says, and a token that GitHub refuses.
    [4, 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.', 'gh-not-signed-in'],
    [1, 'You are not logged into any GitHub hosts. To log in, run: gh auth login', 'gh-not-signed-in'],
    [1, 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login', 'gh-not-signed-in'],
    [4, 'authentication required', 'gh-not-signed-in'],
    // Offline: gh's own words, and the words of the network layer under it.
    [1, 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com', 'gh-offline'],
    [1, 'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host', 'gh-offline'],
    [1, 'Post "https://api.github.com/graphql": dial tcp 140.82.112.5:443: i/o timeout', 'gh-offline'],
    [1, 'Get "https://api.github.com/repos": net/http: TLS handshake timeout', 'gh-offline'],
    [1, 'dial tcp 127.0.0.1:443: connectex: No connection could be made because the target machine actively refused it.', 'gh-offline'],
    [1, 'Could not resolve host: api.github.com', 'gh-offline'],
    // Anything else is a failure of its own, with gh's first line. "Could not resolve to a Repository" is not a network problem.
    [1, "GraphQL: Could not resolve to a Repository with the name 'x/y'. (repository)", 'gh-failed'],
    [1, 'HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/graphql)', 'gh-failed'],
    [1, '', 'gh-failed'],
    [2, 'unknown flag: --nope', 'gh-failed'],
  ];

  it('names each kind of failure from the exit code and the words of gh', () => {
    for (const [code, stderr, expected] of table) {
      expect(classifyGhError(code, stderr).code, `${code}: ${stderr.split('\n')[0]}`).toBe(expected);
    }
  });

  it('gives a sentence for a person: what happened and what to do, and for a failure also the first line of gh', () => {
    const signedOut = classifyGhError(4, 'To get started with GitHub CLI, please run:  gh auth login');
    expect(signedOut.message).toContain('not signed in');
    expect(signedOut.message).toContain('gh auth login');
    expect(classifyGhError(127, '').message).toMatch(/not installed/i);
    expect(classifyGhError(124, '').message).toMatch(/did not answer in time/i);
    expect(classifyGhError(1, 'error connecting to api.github.com').message).toMatch(/cannot be reached/i);
    // All four have different words, so a page can tell them apart without the code.
    expect(new Set([127, 124, 4, 1].map((code, i) => classifyGhError(code, ['', '', 'gh auth login', 'error connecting to x'][i] ?? '').message)).size).toBe(4);

    const failed = classifyGhError(1, "GraphQL: Could not resolve to a Repository with the name 'x/y'. (repository)\nsecond line");
    expect(failed.message).toContain("Could not resolve to a Repository with the name 'x/y'");
    expect(failed.message).not.toContain('second line');
    expect(classifyGhError(3, '').message).toContain('exit code 3');
  });

  it('keeps the message short and free of control characters, whatever gh printed', () => {
    const noisy = classifyGhError(1, `\u001b[31mred\u0007 ${'x'.repeat(2000)}\r\nnext`);
    expect(noisy.message.length).toBeLessThan(400);
    expect(noisy.message).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});

// ---- the module ----

const dir = mkdtempSync(join(tmpdir(), 'cc-github-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = makeTestConfig();

/** A runner over the fake gh of the end-to-end tests: the real allow-list is in front of it. */
function fakeRunner() {
  return createRunner(config, createFakeGh(dir));
}

/** A github module over the fake gh, on its own hub. */
function sourceOverFake() {
  return createGithubSource({ runner: fakeRunner(), hub: createHub() });
}

function dataOf(panel: Panel<GithubInfo>): GithubInfo {
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}

describe('the github module', () => {
  beforeEach(() => resetGh(dir));
  afterEach(() => vi.useRealTimers());

  it('asks gh for every pull request with the fields of the brief, through a call that the runner allows', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_JSON } } }, dir);
    const source = sourceOverFake();
    const info = dataOf(await source.get());

    expect(info.open).toHaveLength(5);
    // What the fake gh was asked: the runner added the repository, and every call is a read.
    const calls = readGhCalls(dir);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['pr', 'list', '--repo', config.githubRepo, '--state', 'all', '--limit', '100', '--json', GH_PR_FIELDS]);
    expect(GH_PR_FIELDS.split(',')).toEqual([
      'number', 'title', 'state', 'isDraft', 'headRefName', 'url', 'author', 'updatedAt', 'mergedAt', 'reviewDecision', 'latestReviews', 'statusCheckRollup',
    ]);
  });

  it('counts the merged week from the time of the load', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_JSON } } }, dir);
    vi.useFakeTimers({ toFake: ['Date'], now: FIXTURE_NOW });
    const mergedAt = async (later: number) => {
      vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + later));
      return dataOf(await sourceOverFake().get()).merged.map((pr) => pr.number);
    };
    expect(await mergedAt(0)).toEqual([106, 107]);
    // #107 was merged on 2026-10-02 at noon: it leaves the week a minute after 2026-10-09 at noon, and #106 (merged on 2026-10-05) later still.
    expect(await mergedAt(3 * DAY)).toEqual([106, 107]);
    expect(await mergedAt(3 * DAY + 60_000)).toEqual([106]);
    expect(await mergedAt(8 * DAY)).toEqual([]);
  });

  it('gh not signed in, missing, offline and timeout each give a named code and keep lastGood', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_JSON } } }, dir);
    const source = sourceOverFake();
    const good = await source.get();
    expect(good.ok).toBe(true);
    if (!good.ok) return;

    const messages = new Set<string>();
    for (const [mode, code] of [['signed-out', 'gh-not-signed-in'], ['missing', 'gh-missing'], ['offline', 'gh-offline'], ['timeout', 'gh-timeout']] as const) {
      setGhMode({ mode }, dir);
      const failed = await source.get(true);
      expect(failed.ok, mode).toBe(false);
      if (failed.ok) return;
      expect(failed.error.code, mode).toBe(code);
      expect(failed.error.message, mode).not.toBe('');
      messages.add(failed.error.message);
      // The last list that loaded is still there, with the time it was made, so the page shows both.
      expect(failed.lastGood, mode).toEqual({ data: good.data, updatedAt: good.updatedAt });
      expect(failed.updatedAt, mode).toBe(good.updatedAt);
    }
    expect(messages.size).toBe(4);

    // When gh works again the error is gone and the list is new.
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_EMPTY_JSON } } }, dir);
    expect(dataOf(await source.get(true))).toEqual({ open: [], merged: [] });
  });

  it('gh failing before any list loaded gives the named code and no lastGood', async () => {
    setGhMode({ mode: 'signed-out' }, dir);
    const failed = await sourceOverFake().get();
    expect(failed).toMatchObject({ ok: false, error: { code: 'gh-not-signed-in' }, updatedAt: null, lastGood: null });
  });

  it('output that gh cannot be read as pull requests fails the panel with gh-bad-output', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: '<html>not json</html>' } } }, dir);
    const failed = await sourceOverFake().get();
    expect(failed).toMatchObject({ ok: false, error: { code: 'gh-bad-output' } });
  });

  it('the source loads when it starts and then every 60 s', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_EMPTY_JSON } } }, dir);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const source = sourceOverFake();
    source.start();
    try {
      await source.get(); // waits for the load that start() began
      expect(readGhCalls(dir)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(readGhCalls(dir)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(readGhCalls(dir)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(readGhCalls(dir)).toHaveLength(3);
    } finally {
      source.stop();
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(readGhCalls(dir)).toHaveLength(3); // stop() stops the timer
  });

  it('publishes a github change when the pull requests change, and not when they stay the same', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_EMPTY_JSON } } }, dir);
    const hub = createHub();
    const heard: string[] = [];
    hub.subscribe((event) => heard.push(event.module));
    const source = createGithubSource({ runner: fakeRunner(), hub });

    await source.get(true);
    await source.get(true); // the same list again
    expect(heard).toEqual(['github']);
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_JSON } } }, dir);
    await source.get(true);
    expect(heard).toEqual(['github', 'github']);
  });
});

describe('GET /api/github', () => {
  beforeEach(() => resetGh(dir));
  afterEach(() => vi.useRealTimers());

  /** The app with the route of a github module over a counting exec: each `gh pr list` it gets is counted. */
  function appWithCountingGh(options: Parameters<typeof registerGithubRoutes>[2] = {}) {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { code: 0, stdout: PRS_EMPTY_JSON, stderr: '' };
    };
    const source = createGithubSource({ runner: createRunner(config, exec), hub: createHub() });
    const { app } = makeApp({ config });
    registerGithubRoutes(app, source, options);
    const get = async (query = ''): Promise<Panel<GithubInfo>> => (await (await getFrom(app, `/api/github${query}`, config)).json()) as Panel<GithubInfo>;
    return { calls, get };
  }

  it('answers the panel with status 200, also when gh failed', async () => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: PRS_JSON } } }, dir);
    const source = sourceOverFake();
    const { app } = makeApp({ config });
    registerGithubRoutes(app, source);

    const res = await getFrom(app, '/api/github', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Panel<GithubInfo>;
    expect(body.ok && body.data.open).toHaveLength(5);

    // With gh signed out (the fake gh): ok:false, the named code, and the list that loaded before.
    setGhMode({ mode: 'signed-out' }, dir);
    const failed = (await (await getFrom(app, '/api/github?refresh=1', config)).json()) as Panel<GithubInfo>;
    expect(failed.ok).toBe(false);
    expect(failed.ok ? '' : failed.error.code).toBe('gh-not-signed-in');
    expect(failed.ok ? null : failed.lastGood?.data.open).toHaveLength(5);
  });

  it('a forced refresh is limited to one call in 10 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXTURE_NOW });
    const { calls, get } = appWithCountingGh();

    // The first request loads the list. A request without refresh answers from what it has: no new call.
    await get();
    expect(calls).toHaveLength(1);
    await get();
    await get();
    expect(calls).toHaveLength(1);

    // ?refresh=1 forces a call. A second one within 10 s is answered from the cache.
    await get('?refresh=1');
    expect(calls).toHaveLength(2);
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 5_000));
    await get('?refresh=1');
    await get('?refresh=1');
    expect(calls).toHaveLength(2);
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 9_999));
    await get('?refresh=1');
    expect(calls).toHaveLength(2);

    // 10 s after the forced call it is allowed again, and the 10 s start again from that call.
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 10_000));
    await get('?refresh=1');
    expect(calls).toHaveLength(3);
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 19_999));
    await get('?refresh=1');
    expect(calls).toHaveLength(3);
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 20_000));
    await get('?refresh=1');
    expect(calls).toHaveLength(4);
    // Only the value 1 asks for it.
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 60_000));
    await get('?refresh=0');
    await get('?refresh=yes');
    expect(calls).toHaveLength(4);
  });

  it('the least time between two forced refreshes can be set, and 0 lets every one through (the end-to-end server does that)', async () => {
    const { calls, get } = appWithCountingGh({ minGapMs: 0 });
    await get();
    await get('?refresh=1');
    await get('?refresh=1');
    await get('?refresh=1');
    expect(calls).toHaveLength(4);
  });
});
