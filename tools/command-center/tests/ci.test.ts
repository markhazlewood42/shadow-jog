import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGh, readGhCalls, resetGh, setGhMode } from '../e2e/fake-gh';
import { parseGhRun } from '../src/server/github/ci';
import { createCiSource } from '../src/server/github/ci-module';
import { createHub } from '../src/server/hub';
import { registerCiRoutes } from '../src/server/routes/ci';
import { type Exec, createRunner } from '../src/server/runner';
import { PanelError } from '../src/server/source';
import type { CiMain, Panel } from '../src/shared/types';
import { getFrom, makeApp, makeTestConfig } from './helpers';

// The CI source: the newest run on the branch main, for the row "CI on main" of the Status panel. The parser is tested on made-up gh output; the source is tested over the
// real runner with the fake gh of the end-to-end tests under it, so a call that the runner's allow-list would refuse fails here too.

const RUN_URL = 'https://github.com/octo-owner/octo-repo/actions/runs/77';
const RUN_TIME = '2026-10-07T10:00:00Z';
const NO_RUN: CiMain = { state: 'none', createdAt: null, url: null };

/** What `gh run list ... --limit 1 --json status,conclusion,url,createdAt` prints for one run. */
const printed = (status: string, conclusion: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify([{ status, conclusion, url: RUN_URL, createdAt: RUN_TIME, ...extra }]);

/** The error that `fn` throws. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, and it did not');
}

describe('parseGhRun', () => {
  it('ci run maps to passing, failing, running and none', () => {
    const run = (status: string, conclusion: string) => parseGhRun(printed(status, conclusion));

    // A run that finished and passed: its state, its time and its address.
    expect(run('completed', 'success')).toEqual({ state: 'passing', createdAt: RUN_TIME, url: RUN_URL });

    // A run that finished and did not pass: each of the four conclusions of the brief.
    for (const conclusion of ['failure', 'timed_out', 'startup_failure', 'action_required']) {
      expect(run('completed', conclusion), conclusion).toEqual({ state: 'failing', createdAt: RUN_TIME, url: RUN_URL });
    }

    // A run that has not finished: queued, working, waiting or pending. Its conclusion is empty, and a conclusion on it would not change that.
    for (const status of ['queued', 'in_progress', 'waiting', 'pending']) {
      expect(run(status, ''), status).toEqual({ state: 'running', createdAt: RUN_TIME, url: RUN_URL });
    }
    expect(run('in_progress', 'failure').state).toBe('running');

    // Anything else has no verdict: a run that was canceled or skipped, a conclusion that GitHub adds later, a status that this does not know, a finished run with no
    // conclusion. It is "none", with no time and no address, and it is never taken for a pass.
    for (const [status, conclusion] of [
      ['completed', 'cancelled'],
      ['completed', 'skipped'],
      ['completed', 'neutral'],
      ['completed', 'stale'],
      ['completed', 'something_new'],
      ['completed', ''],
      ['requested', ''],
      ['something_new', 'success'],
      ['', ''],
    ] as const) {
      expect(run(status, conclusion), `${status}/${conclusion}`).toEqual(NO_RUN);
    }

    // No run at all: an empty list (a branch that never ran a workflow).
    expect(parseGhRun('[]')).toEqual(NO_RUN);
    // gh prints these words in lower case. Upper case is read the same way (the case of the words is not trusted).
    expect(run('COMPLETED', 'SUCCESS').state).toBe('passing');
    expect(run('IN_PROGRESS', '').state).toBe('running');
  });

  it('keeps the time and the address of the first run, and leaves out a time or an address that cannot be used', () => {
    // Only the first entry counts: the call asks for one run, and a longer list does not make the row read the wrong one.
    const two = JSON.stringify([
      { status: 'completed', conclusion: 'failure', url: RUN_URL, createdAt: RUN_TIME },
      { status: 'completed', conclusion: 'success', url: 'https://github.com/o/r/actions/runs/1', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(parseGhRun(two)).toEqual({ state: 'failing', createdAt: RUN_TIME, url: RUN_URL });

    // An address that is not http or https is left out (a link with `javascript:` would run code in the page), and a time that is not a time as well.
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '', 42, null]) {
      expect(parseGhRun(printed('completed', 'success', { url })), String(url)).toEqual({ state: 'passing', createdAt: RUN_TIME, url: null });
    }
    for (const createdAt of ['yesterday', '', 7, null]) {
      expect(parseGhRun(printed('completed', 'success', { createdAt })), String(createdAt)).toEqual({ state: 'passing', createdAt: null, url: RUN_URL });
    }
    // The other fields of the run are never copied.
    expect(Object.keys(parseGhRun(printed('completed', 'success', { displayTitle: 'SECRET-TITLE' }))).sort()).toEqual(['createdAt', 'state', 'url']);
  });

  it('output that is not a list of runs is an error with the code gh-bad-output', () => {
    for (const output of ['', 'not json', '{"status":"completed"}', '"completed"', 'null', '[7]', '["completed"]', '[null]']) {
      const error = thrown(() => parseGhRun(output));
      expect(error, output).toBeInstanceOf(PanelError);
      expect((error as PanelError).code, output).toBe('gh-bad-output');
    }
  });
});

// ---- the source ----

const dir = mkdtempSync(join(tmpdir(), 'cc-ci-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = makeTestConfig();

/** A CI source over the fake gh, behind the real runner, on its own hub. */
function sourceOverFake(hub = createHub()) {
  return createCiSource({ runner: createRunner(config, createFakeGh(dir)), hub });
}

function dataOf(panel: Panel<CiMain>): CiMain {
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}

describe('the ci source', () => {
  beforeEach(() => resetGh(dir));
  afterEach(() => vi.useRealTimers());

  it('asks gh for the newest run on main with the four fields, through a call that the runner allows', async () => {
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: printed('completed', 'success') } } }, dir);
    expect(dataOf(await sourceOverFake().get())).toEqual({ state: 'passing', createdAt: RUN_TIME, url: RUN_URL });
    // What the fake gh was asked: the runner added the repository, and the call is one read.
    const calls = readGhCalls(dir);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['run', 'list', '--repo', config.githubRepo, '--branch', 'main', '--limit', '1', '--json', 'status,conclusion,url,createdAt']);
  });

  it('the fake gh answers with one run that passed when a test sets no reply', async () => {
    const panel = dataOf(await sourceOverFake().get());
    expect(panel.state).toBe('passing');
    // The address is in the repository the runner pinned.
    expect(panel.url).toBe(`https://github.com/${config.githubRepo}/actions/runs/9001`);
  });

  it('gh not signed in, missing, offline and timeout each give a named code and keep lastGood', async () => {
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: printed('completed', 'failure') } } }, dir);
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
      messages.add(failed.error.message);
      // The last run that loaded is still there, with the time it was made.
      expect(failed.lastGood, mode).toEqual({ data: good.data, updatedAt: good.updatedAt });
    }
    expect(messages.size).toBe(4);

    // gh works again: the error is gone and the run is the new one.
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: printed('in_progress', '') } } }, dir);
    expect(dataOf(await source.get(true)).state).toBe('running');
  });

  it('output that gh cannot be read as runs fails the panel with gh-bad-output, and a failed gh before any load has no lastGood', async () => {
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: '<html>not json</html>' } } }, dir);
    expect(await sourceOverFake().get()).toMatchObject({ ok: false, error: { code: 'gh-bad-output' } });
    setGhMode({ mode: 'signed-out' }, dir);
    expect(await sourceOverFake().get()).toMatchObject({ ok: false, error: { code: 'gh-not-signed-in' }, updatedAt: null, lastGood: null });
  });

  it('the source loads when it starts and then every 60 s, like the pull request source', async () => {
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: '[]' } } }, dir);
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
    } finally {
      source.stop();
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(readGhCalls(dir)).toHaveLength(2); // stop() stops the timer
  });

  it('publishes a ci change when the run changes, and not when it stays the same', async () => {
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: printed('completed', 'success') } } }, dir);
    const hub = createHub();
    const heard: string[] = [];
    hub.subscribe((event) => heard.push(event.module));
    const source = sourceOverFake(hub);

    await source.get(true);
    await source.get(true); // the same run again
    expect(heard).toEqual(['ci']);
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: printed('completed', 'failure') } } }, dir);
    await source.get(true);
    expect(heard).toEqual(['ci', 'ci']);
  });
});

describe('GET /api/ci', () => {
  beforeEach(() => resetGh(dir));
  afterEach(() => vi.useRealTimers());

  /** The app with the route of a CI source over a counting exec: each `gh run list` it gets is counted. */
  function appWithCountingGh(options: Parameters<typeof registerCiRoutes>[2] = {}) {
    const calls: string[][] = [];
    const exec: Exec = async (_cmd, args) => {
      calls.push(args);
      return { code: 0, stdout: printed('completed', 'success'), stderr: '' };
    };
    const source = createCiSource({ runner: createRunner(config, exec), hub: createHub() });
    const { app } = makeApp({ config });
    registerCiRoutes(app, source, options);
    const get = async (query = ''): Promise<Panel<CiMain>> => (await (await getFrom(app, `/api/ci${query}`, config)).json()) as Panel<CiMain>;
    return { app, calls, get };
  }

  it('GET /api/ci returns a panel', async () => {
    // The good shape: status 200, never cached, and the Panel of the newest run.
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: printed('completed', 'success') } } }, dir);
    const { app } = makeApp({ config });
    registerCiRoutes(app, sourceOverFake());
    const res = await getFrom(app, '/api/ci', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Panel<CiMain>;
    expect(body).toEqual({ ok: true, data: { state: 'passing', createdAt: RUN_TIME, url: RUN_URL }, updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });

    // The error shape: gh is signed out. It is still status 200 (a failed panel is data, not an HTTP error), with the named code and the run from before.
    setGhMode({ mode: 'signed-out' }, dir);
    const failed = (await (await getFrom(app, '/api/ci?refresh=1', config)).json()) as Panel<CiMain>;
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('gh-not-signed-in');
    expect(failed.lastGood?.data).toEqual(body.ok ? body.data : null);

    // Only GET is answered.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const refused = await app.request('/api/ci', { method, headers: { host: `localhost:${config.port}` } });
      expect(refused.status, method).toBe(405);
    }

    // The refresh gate is the rule of the pull request route: one forced load in 10 s, counted from the last forced load.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T12:00:00Z') });
    const { calls, get } = appWithCountingGh();
    const at = (ms: number) => vi.setSystemTime(new Date(Date.parse('2026-10-07T12:00:00Z') + ms));

    // The first request loads the run. A request without refresh answers from what it has: no new call.
    await get();
    await get();
    expect(calls).toHaveLength(1);
    // ?refresh=1 forces a call. A second one within 10 s is answered from the cache.
    await get('?refresh=1');
    expect(calls).toHaveLength(2);
    at(9_999);
    await get('?refresh=1');
    expect(calls).toHaveLength(2);
    at(10_000);
    await get('?refresh=1');
    expect(calls).toHaveLength(3);
    // Only the value 1 asks for it.
    at(60_000);
    await get('?refresh=0');
    expect(calls).toHaveLength(3);
  });

  it('the least time between two forced refreshes of /api/ci can be set, and 0 lets every one through (the end-to-end server does that)', async () => {
    const { calls, get } = appWithCountingGh({ minGapMs: 0 });
    await get();
    await get('?refresh=1');
    await get('?refresh=1');
    expect(calls).toHaveLength(3);
  });
});
