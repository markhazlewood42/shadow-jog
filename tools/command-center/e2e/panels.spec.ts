import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { GitInfo, GithubInfo, Panel, StatusInfo } from '../src/shared/types';
import { E2E_DIR, clearGhCalls, readGhCalls, resetGh, setGhMode } from './fake-gh';

// The status, git and GitHub routes on the end-to-end server: the real server over a fixture git
// repo (two commits, no remote) with a fake gh under the real runner. These tests ask the routes
// and read the answers, so they open no browser page. The end-to-end server sets the least time
// between two forced refreshes to 0 (see e2e/server.ts), so a test can change what the fake gh says
// and see it at once; the 10 s rule itself is tested in tests/github.test.ts.

const REPO = join(E2E_DIR, 'repo');
const MIGRATION_DOC = join(REPO, 'docs', 'engine', 'migration.md');
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
    rmSync(MIGRATION_DOC, { force: true });
  });

  test('the status route answers the Right now section and the Next up for Mark list of status.md, and the milestones once migration.md has its table', async ({ request }) => {
    // The fixture repo has a status.md and no docs/engine/migration.md. The panel says so, and still carries the status.
    const before = await readPanel<StatusInfo>(request, '/api/status');
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(before.error.code).toBe('milestones-doc-missing');
    expect(before.error.message).toContain('docs/engine/migration.md');
    expect(before.lastGood?.data.rightNow.heading).toBe('Right now (2026-01-02)');
    expect(before.lastGood?.data.nextUpForMark.map((item) => item.text)).toEqual([
      'Review the widget pictures: the round one, the square one, and the long one, which wraps onto a second line with an indent.',
      'Pick the gadget colour. The choices are in the setup guide, and this item wraps onto a second line with no indent.',
      'A short last item.',
    ]);
    expect(before.lastGood?.data.updated).toBe('2026-01-02');
    // Links in the section are the links of the docs site, and the history section is not in it.
    expect(before.lastGood?.data.rightNow.html).toContain('href="/docs/guides/setup"');
    expect(before.lastGood?.data.rightNow.html).not.toContain('This item is old');

    // The doc is added. A failed panel is asked again by the next request, so the panel is good at once, with the milestones in the order of the table.
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
        { id: 'Phase 0', name: 'Platform spike', scope: 'A spike. Done.' },
        { id: 'M1b', name: '3D proof (parallel with M2)', scope: 'A cube.' },
      ]);
    // Wait until the docs site has the file too. The file watcher polls the disk once a second, so a change that is made and undone
    // between two polls is never seen, and chokidar ignores a second change to a folder within a second of the first one. A removal
    // right after the add can therefore be missed (the 60 s timer of the module would still put it right). Two seconds after the
    // docs site has the file, the removal below is a change that the watcher sees.
    await expect.poll(async () => (await request.get('/api/docs/engine/migration')).status(), { timeout: 15_000 }).toBe(200);
    await new Promise((done) => setTimeout(done, 2_000));

    // The doc goes away again. The panel was good, so no request asks again: the module has to hear of the removal from the doc
    // index (a change event of the docs), and the panel is back to the problem, as the fixture started.
    rmSync(MIGRATION_DOC);
    await expect
      .poll(async () => {
        const panel = await readPanel<StatusInfo>(request, '/api/status');
        return panel.ok ? 'ok' : panel.error.code;
      }, { timeout: 15_000 })
      .toBe('milestones-doc-missing');
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
    expect(status.ok ? status.data.rightNow.heading : status.lastGood?.data.rightNow.heading).toBe('Right now (2026-01-02)');

    // Every call that the server made to gh was one `pr list`, pinned to the configured repository: a read, and nothing else.
    const calls = readGhCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.args.slice(0, 4)).toEqual(['pr', 'list', '--repo', 'fixture-owner/fixture-repo']);
    }
    expect(calls.map((call) => call.mode)).toContain('signed-out');

    // gh works again: the next request brings the answer back to good.
    resetGh();
    const mended = await readPanel<GithubInfo>(request, '/api/github?refresh=1');
    expect(mended.ok).toBe(true);
    expect(mended.ok && mended.data).toEqual({ open: [], merged: [] });
  });

  test('a request that is not a GET to the three routes is refused with 405', async ({ request }) => {
    for (const path of ['/api/status', '/api/git', '/api/github']) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(405);
    }
  });
});
