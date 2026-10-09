import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { CiMain, GitInfo, GithubInfo, Panel, StatusInfo } from '../src/shared/types';
import { E2E_DIR, clearGhCalls, readGhCalls, resetGh, setGhMode } from './fake-gh';

// The status, git and GitHub routes on the end-to-end server: the real server over a fixture git
// repo (two commits, no remote) with a fake gh under the real runner. These tests ask the routes
// and read the answers, so they open no browser page. The end-to-end server sets the least time
// between two forced refreshes to 0 (see e2e/server.ts), so a test can change what the fake gh says
// and see it at once; the 10 s rule itself is tested in tests/github.test.ts.

const REPO = join(E2E_DIR, 'repo');
const MIGRATION_DOC = join(REPO, 'docs', 'engine', 'migration.md');
/** The made-up migration doc that the fixture repo starts with: a test puts it back when it has changed or removed it, because the status panel of the Now page needs its table. */
const MIGRATION_ORIGINAL = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'repo', 'docs', 'engine', 'migration.md'), 'utf8');
const PRS_JSON = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'gh', 'prs.json'), 'utf8');

/** The moment that the dates of fixtures/gh/prs.json are counted from (its merged dates make sense next to it). */
const FIXTURE_NOW = Date.parse('2026-10-06T12:00:00Z');

/** The fixture's pull requests, with every date moved so that the fixture's clock is now: "merged in the last week" then holds on any day. */
function pullRequestsFromNow(): string {
  const shift = Date.now() - FIXTURE_NOW;
  return PRS_JSON.replace(/"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)"/g, (_all, iso: string) => `"${new Date(Date.parse(iso) + shift).toISOString().replace(/\.\d{3}Z$/, 'Z')}"`);
}

async function readPanel<T>(request: APIRequestContext, path: string): Promise<Panel<T>> {
  const res = await request.get(path);
  expect(res.status(), path).toBe(200);
  return (await res.json()) as Panel<T>;
}

test.describe('the status, git and GitHub routes', () => {
  test.beforeEach(() => {
    resetGh();
    clearGhCalls();
  });
  test.afterEach(() => {
    resetGh();
    writeFileSync(MIGRATION_DOC, MIGRATION_ORIGINAL);
  });

  test('the status route answers the date, the Next up for Mark list and the milestone key of status.md and the milestones of the migration doc, and says what is wrong when the doc has no table or is gone', async ({ request }) => {
    // The fixture repo has a status.md and a made-up docs/engine/migration.md. The panel is good, with the milestones of the first table of the doc that
    // has a "One-line scope" column in the order of the table (the second table of the doc has no such column, and is skipped). Each milestone that the
    // doc has a heading for carries the id of that heading in the page of the doc (Phase 0 has no heading).
    const before = await readPanel<StatusInfo>(request, '/api/status');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.data.milestones).toEqual([
      { id: 'Phase 0', name: 'Platform spike', scope: 'A spike that tests the design. Done.', anchor: null },
      { id: 'M0', name: 'Kernel', scope: 'The loop and the first scene.', anchor: 'm0-kernel' },
      { id: 'M1b', name: '3D proof (parallel with M2)', scope: 'A cube on a canvas.', anchor: 'm1b-3d-proof' },
      { id: 'M2', name: 'Stage', scope: 'A battle stage.', anchor: 'm2-stage' },
    ]);
    // The key of the fixture's status.md is "none": no milestone has started, and that is a good key.
    expect(before.data.milestone).toEqual({ current: null, problem: null });
    // The text of the "Right now" section is not in the payload, only the Next up list is.
    expect(Object.keys(before.data).sort()).toEqual(['milestone', 'milestones', 'nextUpForMark', 'updated']);
    expect(before.data.nextUpForMark.map((item) => item.text)).toEqual([
      'Review the widget pictures: the round one, the square one, and the long one, which wraps onto a second line with an indent.',
      'Pick the gadget color. The choices are in the setup guide, and this item wraps onto a second line with no indent.',
      'A short last item.',
    ]);
    expect(before.data.updated).toBe('2026-01-02');
    // Links in an item are the links of the docs site, and the history section is not in it.
    expect(before.data.nextUpForMark[1]?.html).toContain('href="/docs/guides/setup"');
    expect(JSON.stringify(before.data)).not.toContain('This item is old');

    // The doc goes away. The panel was good, so no request asks again: the module has to hear of the removal from the doc index (a change event of the
    // docs). The panel then says that the doc is missing, and still carries the status, which has nothing to do with the milestones.
    rmSync(MIGRATION_DOC);
    await expect
      .poll(async () => {
        const panel = await readPanel<StatusInfo>(request, '/api/status');
        return panel.ok ? 'ok' : panel.error.code;
      }, { timeout: 15_000 })
      .toBe('milestones-doc-missing');
    const missing = await readPanel<StatusInfo>(request, '/api/status');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.message).toContain('docs/engine/migration.md');
    expect(missing.lastGood?.data.updated).toBe('2026-01-02');
    expect(missing.lastGood?.data.nextUpForMark).toHaveLength(3);
    expect(missing.lastGood?.data.milestones).toEqual([]);

    // The doc is added again, with a table of two milestones. A failed panel is asked again by the next request, so the panel is good at once, with the
    // milestones in the order of the table. The file watcher polls the disk once a second, and chokidar ignores a second change to a folder within a second of the
    // first one, so the next change waits two seconds after the docs site has the file: then it is a change that the watcher sees.
    await new Promise((done) => setTimeout(done, 2_000));
    writeFileSync(
      MIGRATION_DOC,
      [
        '# Migration',
        '',
        '## 2. The milestones',
        '',
        '| Milestone | One-line scope | Touches |',
        '|---|---|---|',
        '| **Phase 0** Platform spike | A spike. Done. | `src/` |',
        '| **M1b** 3D proof (parallel with M2) | A cube. | `src/three/` |',
        '',
      ].join('\n'),
    );
    await expect
      .poll(async () => {
        const panel = await readPanel<StatusInfo>(request, '/api/status');
        return panel.ok ? panel.data.milestones : panel.error.code;
      }, { timeout: 15_000 })
      .toEqual([
        { id: 'Phase 0', name: 'Platform spike', scope: 'A spike. Done.', anchor: null },
        { id: 'M1b', name: '3D proof (parallel with M2)', scope: 'A cube.', anchor: null },
      ]);
  });

  test('the git route answers the branch, no upstream, and the two commits of the fixture repo', async ({ request }) => {
    const panel = await readPanel<GitInfo>(request, '/api/git');
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data).toMatchObject({ current: 'main', ahead: null, behind: null });
    expect(panel.data.branches).toEqual([{ name: 'main', date: '2026-01-02T00:00:00.000Z', upstream: null, track: null, worktree: expect.stringMatching(/repo$/) }]);
    expect(panel.data.commits).toEqual([
      { sha: expect.stringMatching(/^[0-9a-f]{40}$/), date: '2026-01-02T00:00:00.000Z', author: 'Fixture Author', subject: 'Add the second doc' },
      { sha: expect.stringMatching(/^[0-9a-f]{40}$/), date: '2026-01-01T00:00:00.000Z', author: 'Fixture Author', subject: 'Add the first doc' },
    ]);
    expect(panel.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test('the github route answers the pull requests of the fake gh, and with gh signed out it answers ok:false with the code gh-not-signed-in and the last good list', async ({ request }) => {
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: pullRequestsFromNow() } } });
    const good = await readPanel<GithubInfo>(request, '/api/github?refresh=1');
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.data.open.map((pr) => [pr.number, pr.attention])).toEqual([[104, null], [102, 'fix'], [101, 'merge'], [103, null], [105, null]]);
    expect(good.data.merged.map((pr) => pr.number)).toEqual([106, 107]);

    // gh is signed out: the answer is a failed panel (still status 200) with the named code, a sentence, and the list from before.
    setGhMode({ mode: 'signed-out' });
    const failed = await readPanel<GithubInfo>(request, '/api/github?refresh=1');
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('gh-not-signed-in');
    expect(failed.error.message).toContain('gh auth login');
    expect(failed.lastGood?.data.open).toHaveLength(5);
    expect(failed.updatedAt).toBe(good.updatedAt);

    // One broken source does not take the others with it.
    expect((await readPanel<GitInfo>(request, '/api/git')).ok).toBe(true);
    const status = await readPanel<StatusInfo>(request, '/api/status');
    expect(status.ok ? status.data.updated : status.lastGood?.data.updated).toBe('2026-01-02');

    // Every call that the server made to gh was a read pinned to the configured repository: the `pr list` of this test, and, when the look of the CI source
    // every 60 seconds falls in the time of the test, its `run list`. Nothing else.
    const calls = readGhCalls();
    expect(calls.filter((call) => call.args[0] === 'pr').length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(['pr list', 'run list']).toContain(call.args.slice(0, 2).join(' '));
      expect(call.args.slice(2, 4)).toEqual(['--repo', 'fixture-owner/fixture-repo']);
    }
    expect(calls.map((call) => call.mode)).toContain('signed-out');

    // gh works again: the next request brings the answer back to good.
    resetGh();
    const mended = await readPanel<GithubInfo>(request, '/api/github?refresh=1');
    expect(mended.ok).toBe(true);
    expect(mended.ok && mended.data).toEqual({ open: [], merged: [] });
  });

  test('the ci route answers the newest run on main from the fake gh, says what is wrong when gh is signed out, and keeps the run it knew', async ({ request }) => {
    const run = (status: string, conclusion: string, id: number) => JSON.stringify([{ status, conclusion, url: `https://github.com/fixture-owner/fixture-repo/actions/runs/${id}`, createdAt: '2026-10-07T10:00:00Z' }]);

    // The fake gh answers `gh run list` with one run that passed, until a test sets another reply.
    const canned = await readPanel<CiMain>(request, '/api/ci?refresh=1');
    expect(canned).toMatchObject({ ok: true, data: { state: 'passing', url: 'https://github.com/fixture-owner/fixture-repo/actions/runs/9001' } });

    // Each state of the run, as the fake prints it.
    const states: [string, string, CiMain['state']][] = [['completed', 'failure', 'failing'], ['in_progress', '', 'running'], ['completed', 'success', 'passing'], ['completed', 'cancelled', 'none']];
    for (const [status, conclusion, state] of states) {
      setGhMode({ mode: 'ok', replies: { 'run list': { stdout: run(status, conclusion, 9002) } } });
      const panel = await readPanel<CiMain>(request, '/api/ci?refresh=1');
      expect(panel.ok && panel.data.state, `${status}/${conclusion}`).toBe(state);
    }
    // A branch that never ran a workflow: an empty list, which is "none" with no time and no address.
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: '[]' } } });
    const empty = await readPanel<CiMain>(request, '/api/ci?refresh=1');
    expect(empty.ok && empty.data).toEqual({ state: 'none', createdAt: null, url: null });

    // gh is signed out: a failed panel (still status 200) with the named code, and the run from before.
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout: run('completed', 'failure', 9003) } } });
    const before = await readPanel<CiMain>(request, '/api/ci?refresh=1');
    expect(before.ok && before.data.state).toBe('failing');
    setGhMode({ mode: 'signed-out' });
    const failed = await readPanel<CiMain>(request, '/api/ci?refresh=1');
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('gh-not-signed-in');
    expect(failed.lastGood?.data.state).toBe('failing');

    // Every `run list` call that the server made was the one exact read, pinned to the configured repository.
    const calls = readGhCalls().filter((call) => call.args[0] === 'run');
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const call of calls) {
      expect(call.args).toEqual(['run', 'list', '--repo', 'fixture-owner/fixture-repo', '--workflow', 'ci.yml', '--branch', 'main', '--limit', '1', '--json', 'status,conclusion,url,createdAt']);
    }
  });

  test('a request that is not a GET to the four routes is refused with 405', async ({ request }) => {
    for (const path of ['/api/status', '/api/git', '/api/github', '/api/ci']) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(405);
    }
  });
});
