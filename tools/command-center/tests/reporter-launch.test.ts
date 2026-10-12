import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUDGET_MS, startReporter } from '../scripts/reporter-hook.mjs';
import { LOCK_STALE_MS, REPORTER_PORT, acquireLock, fileLock, findCheckout, mainCheckout, pathsFor, portInUse, reporterConfig } from '../scripts/reporter-launch.mjs';
import { PACKAGE_DIR, REPO_DIR } from './helpers';

const scratch = mkdtempSync(join(tmpdir(), 'cc-reporter-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HOOK = join(PACKAGE_DIR, 'scripts', 'reporter-hook.mjs');

// ---- finding a shadow-jog checkout ----

describe('findCheckout', () => {
  const CONFIG = 'tools/command-center/command-center.config.json';
  const existsIn = (...paths: string[]) => {
    const set = new Set(paths.map((path) => resolve(path)));
    return (path: string) => set.has(resolve(path));
  };

  it('finds the checkout from a folder inside it, a main checkout (.git folder) or a worktree (.git file) alike', () => {
    const exists = existsIn('/work/sj/.git', `/work/sj/${CONFIG}`);
    expect(findCheckout('/work/sj/src/engine', exists)).toBe(resolve('/work/sj'));
    expect(findCheckout('/work/sj', exists)).toBe(resolve('/work/sj'));
  });

  it('returns null for any other folder, home-base included', () => {
    const exists = existsIn('/work/home-base/.git', '/work/home-base/CLAUDE.md');
    expect(findCheckout('/work/home-base', exists)).toBeNull();
    expect(findCheckout('/work/home-base/projects/other', exists)).toBeNull();
    expect(findCheckout('/', exists)).toBeNull();
  });

  it('needs both the .git entry and the tool config', () => {
    expect(findCheckout('/work/sj', existsIn(`/work/sj/${CONFIG}`))).toBeNull();
    expect(findCheckout('/work/sj', existsIn('/work/sj/.git'))).toBeNull();
  });

  it('finds this repo from the tool folder', () => {
    expect(findCheckout(PACKAGE_DIR)).toBe(REPO_DIR);
  });
});

describe('mainCheckout', () => {
  it('is the first entry of git worktree list, so a worktree and the main folder share one reporter', () => {
    const git = () => ({ status: 0, stdout: 'worktree C:/work/shadow-jog\nHEAD a\nbranch refs/heads/main\n\nworktree C:/work/other\nHEAD b\n' });
    expect(mainCheckout('C:/work/other', git)).toBe(resolve('C:/work/shadow-jog'));
  });
  it('falls back to the folder itself when git fails', () => {
    expect(mainCheckout('C:/work/other', () => ({ status: 1, stdout: '' }))).toBe('C:/work/other');
  });
});

// ---- the lock ----

describe('the lock: a second launch does nothing', () => {
  function fake(now: number, existing: { text: string; mtimeMs: number } | null, port: boolean) {
    const state = { lock: existing, removed: 0 };
    return {
      state,
      deps: {
        now: () => now,
        portInUse: async () => port,
        read: () => state.lock,
        create: (text: string) => {
          if (state.lock !== null) return false;
          state.lock = { text, mtimeMs: now };
          return true;
        },
        remove: () => {
          state.lock = null;
          state.removed += 1;
        },
      },
    };
  }

  it('takes a free lock', async () => {
    const { deps, state } = fake(1_000_000, null, false);
    expect(await acquireLock(deps, 'me')).toBe('acquired');
    expect(state.lock?.text).toBe('me');
  });

  it('answers "held" for a lock that was touched a moment ago, and leaves it alone', async () => {
    const { deps, state } = fake(1_000_000, { text: 'other', mtimeMs: 1_000_000 - 5000 }, false);
    expect(await acquireLock(deps, 'me')).toBe('held');
    expect(state.lock?.text).toBe('other');
    expect(state.removed).toBe(0);
  });

  it('answers "held" for an old lock when something still answers on the reporter port (a launcher that slept with the machine)', async () => {
    const { deps, state } = fake(1_000_000, { text: 'other', mtimeMs: 1_000_000 - LOCK_STALE_MS - 1 }, true);
    expect(await acquireLock(deps, 'me')).toBe('held');
    expect(state.removed).toBe(0);
  });

  it('takes over an old lock only when the port is free', async () => {
    const { deps, state } = fake(1_000_000, { text: 'dead', mtimeMs: 1_000_000 - LOCK_STALE_MS - 1 }, false);
    expect(await acquireLock(deps, 'me')).toBe('acquired');
    expect(state.removed).toBe(1);
    expect(state.lock?.text).toBe('me');
  });

  it('with real files: the first launch gets the lock and the second does not (the create is exclusive)', async () => {
    const file = join(scratch, 'one.lock');
    const lock = fileLock(file);
    const deps = { now: Date.now, portInUse: async () => false, read: lock.read, create: lock.create, remove: lock.remove };
    expect(await acquireLock(deps, '{"launcher":1}')).toBe('acquired');
    expect(await acquireLock(deps, '{"launcher":2}')).toBe('held');
    expect(readFileSync(file, 'utf8')).toBe('{"launcher":1}');
    lock.remove();
    expect(await acquireLock(deps, '{"launcher":3}')).toBe('acquired');
  });

  it('two launches at the same moment: exactly one wins', async () => {
    const lock = fileLock(join(scratch, 'race.lock'));
    const deps = { now: Date.now, portInUse: async () => false, read: lock.read, create: lock.create, remove: lock.remove };
    const results = await Promise.all([acquireLock(deps, 'a'), acquireLock(deps, 'b'), acquireLock(deps, 'c')]);
    expect(results.filter((result) => result === 'acquired')).toHaveLength(1);
  });

  it('portInUse sees a listener and sees a free port', async () => {
    const { createServer } = await import('node:net');
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    expect(await portInUse(port)).toBe(true);
    await new Promise<void>((done) => server.close(() => done()));
    expect(await portInUse(port)).toBe(false);
  });
});

describe('the reporter run config', () => {
  const original = {
    port: 3009,
    repoRoot: '../..',
    roots: ['../..', '../../../shadow-jog-phaser'],
    githubRepo: 'o/r',
    claude: { projectsRoot: '~/.claude/projects', folders: ['f'] },
  };

  it('points the repo root and the roots at the real checkout (not at the pinned copy), and uses the reporter port', () => {
    const config = reporterConfig(original, resolve('/work/shadow-jog'));
    expect(config.port).toBe(REPORTER_PORT);
    expect(REPORTER_PORT).not.toBe(3009);
    expect(REPORTER_PORT).not.toBe(3010);
    expect(config.repoRoot).toBe(resolve('/work/shadow-jog'));
    expect(config.roots).toEqual([resolve('/work/shadow-jog'), resolve('/work/shadow-jog-phaser')]);
    expect(config.claude).toEqual(original.claude);
    expect(config.githubRepo).toBe('o/r');
  });

  it('keeps the paths of the repo clean of the pinned folder', () => {
    const config = reporterConfig(original, resolve('/work/shadow-jog'));
    expect(JSON.stringify(config)).not.toContain('.cc-reporter');
    expect(pathsFor(resolve('/work/shadow-jog')).app).toContain('.cc-reporter');
  });
});

describe('.gitignore', () => {
  it('ignores the reporter folder, so the pinned copy, the log and the lock are never committed', () => {
    expect(readFileSync(join(REPO_DIR, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('.cc-reporter/');
  });
});

// ---- the hook ----

describe('startReporter (the decision of the hook)', () => {
  const exists = (...paths: string[]) => (path: string) => paths.map((p) => resolve(p)).includes(resolve(path));

  it('starts the launcher for a session inside a shadow-jog checkout', () => {
    const started: string[][] = [];
    const answer = startReporter({
      cwd: '/work/sj/src',
      launcher: '/pinned/reporter-launch.mjs',
      exists: exists('/work/sj/.git', '/work/sj/tools/command-center/command-center.config.json', '/pinned/reporter-launch.mjs'),
      start: (launcher, checkout) => started.push([launcher, checkout]),
    });
    expect(answer).toBe('started');
    expect(started).toEqual([['/pinned/reporter-launch.mjs', resolve('/work/sj')]]);
  });

  it('does nothing for a session in any other folder', () => {
    const started: string[][] = [];
    for (const cwd of ['/work/home-base', '/work/other-project/src', '', undefined]) {
      const answer = startReporter({ cwd, launcher: '/l.mjs', exists: exists('/work/home-base/.git', '/l.mjs'), start: (l, c) => started.push([l, c]) });
      expect(answer).toBe('not-shadow-jog');
    }
    expect(started).toEqual([]);
  });

  it('does nothing when the launcher file is missing', () => {
    const started: string[][] = [];
    const answer = startReporter({
      cwd: '/work/sj',
      launcher: '/missing.mjs',
      exists: exists('/work/sj/.git', '/work/sj/tools/command-center/command-center.config.json'),
      start: (l, c) => started.push([l, c]),
    });
    expect(answer).toBe('no-launcher');
    expect(started).toEqual([]);
  });
});

/** Runs the hook script as Claude Code does: a node process with a JSON line on stdin. Gives the exit code, the output and the time it took. */
function runHook(input: string | null, env: Record<string, string> = {}, closeInput = true): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('exit', (code) => done({ code, stdout, stderr, ms: Date.now() - started }));
    if (input !== null) child.stdin.write(input);
    if (closeInput) child.stdin.end();
  });
}

/** A launcher stub that only writes a marker file, so no test starts the real reporter. */
function stubLauncher(name: string): { launcher: string; marker: string } {
  const marker = join(scratch, `${name}.marker`);
  const launcher = join(scratch, `${name}.mjs`);
  writeFileSync(launcher, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '));`);
  return { launcher, marker };
}

const waitFor = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  return check();
};

describe('the hook script', () => {
  it('returns within 1 second, exits 0 and prints nothing, for a session outside shadow-jog (and starts nothing)', async () => {
    const { launcher, marker } = stubLauncher('outside');
    const result = await runHook(JSON.stringify({ cwd: scratch, hook_event_name: 'SessionStart' }), { CC_REPORTER_LAUNCHER: launcher });
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(result.ms).toBeLessThan(1000);
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    expect(existsSync(marker)).toBe(false);
  });

  it('starts the launcher detached for a session inside this checkout, and still returns within 1 second', async () => {
    const { launcher, marker } = stubLauncher('inside');
    const result = await runHook(JSON.stringify({ cwd: join(REPO_DIR, 'src'), hook_event_name: 'SessionStart' }), { CC_REPORTER_LAUNCHER: launcher });
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(result.ms).toBeLessThan(1000);
    expect(await waitFor(() => existsSync(marker))).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe(`--repo ${REPO_DIR}`);
  });

  it('never fails a session: bad JSON, no input and a missing launcher all exit 0 with no output', async () => {
    for (const [input, env] of [
      ['{not json', {}],
      ['', {}],
      [JSON.stringify({ cwd: REPO_DIR }), { CC_REPORTER_LAUNCHER: join(scratch, 'does-not-exist.mjs') }],
      [JSON.stringify({ cwd: 42 }), {}],
    ] as [string, Record<string, string>][]) {
      const result = await runHook(input, env);
      expect(result, input).toMatchObject({ code: 0, stdout: '', stderr: '' });
      expect(result.ms).toBeLessThan(1000);
    }
  });

  it('returns within the time budget even when the input never ends', async () => {
    const result = await runHook('{"cwd":"', {}, false);
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(1000);
    expect(BUDGET_MS).toBeLessThan(1000);
  });
});
