import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { E2E_PORT, FIXTURE_NAV_FILE, createE2eRuntime } from '../e2e/server';
import { readGhCalls, setGhMode } from '../e2e/fake-gh';
import { isInside } from '../src/server/config';
import { createDocIndex } from '../src/server/docs/index';
import { createHub } from '../src/server/hub';
import { REPO_DIR } from './helpers';

// e2e/server.ts is the server the Playwright tests run against. Its wiring (a fixture config, a
// temp git repo and a fake gh under the real runner) is built by createE2eRuntime, and tested
// here without opening a port.

const parent = mkdtempSync(join(tmpdir(), 'cc-e2e-runtime-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

describe('createE2eRuntime', () => {
  it('builds a fixture config on port 3010 over a temp repo with two commits', () => {
    const rt = createE2eRuntime(join(parent, 'one'));
    try {
      expect(E2E_PORT).toBe(3010);
      expect(rt.config.port).toBe(3010);
      expect(rt.repo.commits).toHaveLength(2);
      expect(rt.config.repoRoot).toBe(rt.repo.dir);
      expect(rt.config.roots).toEqual([rt.repo.dir]);
      // The Shadow Jog repo itself is not in play, and the approval ref is a commit of the fixture repo.
      expect(isInside(REPO_DIR, rt.config.repoRoot)).toBe(false);
      expect(rt.config.approvalRef).toBe(rt.repo.commits[0]);
      // The fixture names no real repo and no real session folder.
      expect(rt.config.githubRepo).toBe('fixture-owner/fixture-repo');
      expect(isInside(rt.workDir, rt.config.claude.projectsRoot)).toBe(true);
      expect(rt.config.links.length).toBeGreaterThan(0);
    } finally {
      rt.close();
    }
  });

  it('runs git for real in the fixture repo and sends gh to the fake', async () => {
    const rt = createE2eRuntime(join(parent, 'two'));
    try {
      const log = await rt.runner('git', ['log', '--format=%s']);
      expect(log.stdout.trim().split(/\r?\n/)).toEqual(['Add the second doc', 'Add the first doc']);

      const status = await rt.runner('gh', ['auth', 'status']);
      expect(status.code).toBe(0);
      setGhMode({ mode: 'signed-out' }, rt.workDir);
      expect((await rt.runner('gh', ['auth', 'status'])).code).toBe(1);

      const calls = readGhCalls(rt.workDir);
      expect(calls.map((c) => [c.args.join(' '), c.mode, c.code])).toEqual([
        ['auth status', 'ok', 0],
        ['auth status', 'signed-out', 1],
      ]);
      // The real runner is still in front, so the allow-list holds in the end-to-end tests too.
      await expect(rt.runner('gh', ['pr', 'merge', '1'])).rejects.toThrow(/refused/i);
      await expect(rt.runner('git', ['push'])).rejects.toThrow(/refused/i);
    } finally {
      rt.close();
    }
  });

  it('puts the sample docs of fixtures/repo into the fixture repo, and fixtures/nav.json sorts them into sections', async () => {
    const rt = createE2eRuntime(join(parent, 'docs'));
    const index = createDocIndex({ config: rt.config, runner: rt.runner, hub: createHub() }, { watch: false, navFile: FIXTURE_NAV_FILE });
    try {
      // The repo is the folder "repo" of the work folder, which is where the Playwright tests look for it.
      expect(rt.repo.dir).toBe(join(rt.workDir, 'repo'));
      expect(existsSync(join(rt.repo.dir, 'docs', 'guides', 'setup.md'))).toBe(true);
      // The seed is in the two commits of makeTempRepo, so there are still two.
      expect((await rt.runner('git', ['log', '--format=%s'])).stdout.trim().split(/\r?\n/)).toEqual(['Add the second doc', 'Add the first doc']);

      await index.ready();
      expect(index.nav().map((section) => section.title)).toEqual(['Start here', 'Guides', 'Diagrams and links', 'Live edits']);
      expect(index.get('guides/setup')?.title).toBe('Setup guide');
      // Only the sample doc with broken links has a problem (four of them, on purpose).
      expect(index.problems().length).toBe(4);
      expect(index.problems().every((problem) => problem.startsWith('docs/broken-link.md:'))).toBe(true);
    } finally {
      await index.close();
      rt.close();
    }
  });

  it('wipes what an earlier run left in its work folder', () => {
    const dir = join(parent, 'three');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'left-over.txt'), 'from an earlier run');
    writeFileSync(join(dir, 'gh-mode.json'), '{ "mode": "offline" }');
    const rt = createE2eRuntime(dir);
    try {
      expect(existsSync(join(dir, 'left-over.txt'))).toBe(false);
      // The fake starts in the ok mode, not in the one an earlier run left behind.
      expect(existsSync(join(dir, 'gh-mode.json'))).toBe(false);
    } finally {
      rt.close();
    }
  });

  it('close() removes the work folder', () => {
    const dir = join(parent, 'four');
    const rt = createE2eRuntime(dir);
    expect(existsSync(dir)).toBe(true);
    rt.close();
    expect(existsSync(dir)).toBe(false);
  });
});
