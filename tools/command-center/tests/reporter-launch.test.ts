import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUDGET_MS, startReporter } from '../scripts/reporter-hook.mjs';
import {
  LOCK_STALE_MS,
  NEEDS_INSTALL_MARKER,
  READY_MARKER,
  REPORTER_PORT,
  acquireLock,
  ensureCopy,
  fileLock,
  findCheckout,
  mainCheckout,
  needsInstall,
  pathsFor,
  portInUse,
  processInfo,
  reporterConfig,
  runCommand,
  runLauncher,
  stopReporter,
  supervise,
  updateCopy,
} from '../scripts/reporter-launch.mjs';
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

  describe('a fresh lock whose owner is gone', () => {
    const NOW = 1_000_000;
    const fresh = (launcherStart: string | null) => ({ text: JSON.stringify({ launcher: 4242, launcherStart, started: 's' }), mtimeMs: NOW - 5000 });
    const withInfo = (lookup: (pid: number) => Promise<{ start: string } | null>, port = false, launcherStart: string | null = 'T1') => {
      const { deps, state } = fake(NOW, fresh(launcherStart), port);
      return { deps: { ...deps, processInfo: lookup }, state };
    };

    it('takes the lock at once when the launcher process does not exist', async () => {
      const asked: number[] = [];
      const { deps, state } = withInfo(async (pid) => (asked.push(pid), null));
      expect(await acquireLock(deps, 'me')).toBe('acquired');
      expect(asked[0]).toBe(4242);
      expect(state.removed).toBe(1);
    });
    it('takes the lock when the pid is alive but has another start time (pid reuse)', async () => {
      const { deps } = withInfo(async () => ({ start: 'T2-other' }));
      expect(await acquireLock(deps, 'me')).toBe('acquired');
    });
    it('keeps the lock when the owner lives with the same start time', async () => {
      const { deps, state } = withInfo(async () => ({ start: 'T1' }));
      expect(await acquireLock(deps, 'me')).toBe('held');
      expect(state.removed).toBe(0);
    });
    it('keeps the lock when the check throws (it cannot judge)', async () => {
      const { deps, state } = withInfo(async () => {
        throw new Error('powershell failed');
      });
      expect(await acquireLock(deps, 'me')).toBe('held');
      expect(state.removed).toBe(0);
    });
    it('keeps the lock when the owner is gone but the port still answers', async () => {
      const { deps, state } = withInfo(async () => null, true);
      expect(await acquireLock(deps, 'me')).toBe('held');
      expect(state.removed).toBe(0);
    });
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

  it('starts the launcher for a session inside a shadow-jog checkout', async () => {
    const started: string[][] = [];
    const answer = await startReporter({
      cwd: '/work/sj/src',
      launcher: '/pinned/reporter-launch.mjs',
      exists: exists('/work/sj/.git', '/work/sj/tools/command-center/command-center.config.json', '/pinned/reporter-launch.mjs'),
      start: (launcher, checkout) => started.push([launcher, checkout]),
    });
    expect(answer).toBe('started');
    expect(started).toEqual([['/pinned/reporter-launch.mjs', resolve('/work/sj')]]);
  });

  it('does nothing for a session in any other folder', async () => {
    const started: string[][] = [];
    for (const cwd of ['/work/home-base', '/work/other-project/src', '', undefined]) {
      const answer = await startReporter({ cwd, launcher: '/l.mjs', exists: exists('/work/home-base/.git', '/l.mjs'), start: (l, c) => started.push([l, c]) });
      expect(answer).toBe('not-shadow-jog');
    }
    expect(started).toEqual([]);
  });

  it('does nothing when the launcher file is missing', async () => {
    const started: string[][] = [];
    const answer = await startReporter({
      cwd: '/work/sj',
      launcher: '/missing.mjs',
      exists: exists('/work/sj/.git', '/work/sj/tools/command-center/command-center.config.json'),
      start: (l, c) => started.push([l, c]),
    });
    expect(answer).toBe('no-launcher');
    expect(started).toEqual([]);
  });
});

const NOOP_LAUNCHER = join(scratch, 'noop-launcher.mjs');
writeFileSync(NOOP_LAUNCHER, '// does nothing');

/** Runs the hook script as Claude Code does: a node process with a JSON line on stdin. Gives the exit code, the output and the time it took. */
function runHook(input: string | null, env: Record<string, string> = {}, closeInput = true): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((done) => {
    const started = Date.now();
    // SAFETY: a hook run never starts the real launcher. The default launcher is a stub that does nothing, and the folder of the process is the scratch folder, not the repo.
    const child = spawn(process.execPath, [HOOK], { cwd: scratch, env: { ...process.env, CC_REPORTER_LAUNCHER: NOOP_LAUNCHER, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

it('a syntax error in the launcher cannot make the hook exit non-zero (the launcher is imported inside the try)', async () => {
  const dir = join(scratch, 'broken-launcher');
  mkdirSync(dir, { recursive: true });
  copyFileSync(HOOK, join(dir, 'reporter-hook.mjs'));
  copyFileSync(join(PACKAGE_DIR, 'scripts', 'is-main.mjs'), join(dir, 'is-main.mjs'));
  writeFileSync(join(dir, 'reporter-launch.mjs'), 'export const = ;');
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [join(dir, 'reporter-hook.mjs')], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('exit', (code) => done({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ cwd: dir }));
  });
  expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
});

// ---- git and the heartbeat (R1, M7) ----

describe('runCommand', () => {
  it('does not block the event loop, so the lock heartbeat keeps running during a long git call', async () => {
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 20);
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 500)']);
    clearInterval(timer);
    expect(result.status).toBe(0);
    expect(ticks).toBeGreaterThan(8); // a blocking spawnSync would give 0 or 1
  });

  it('gives status null when the program runs past the timeout, and when it cannot start', async () => {
    expect((await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 150 })).status).toBeNull();
    expect((await runCommand('this-program-does-not-exist-cc', [], {})).status).toBeNull();
  });
});

// ---- the pinned copy (R2, R3, M7) ----

type Call = { args: string[]; cwd: string };
const ok = { status: 0, stdout: '', stderr: '' };

function freshPaths(name: string) {
  const checkout = join(scratch, name);
  const paths = pathsFor(checkout);
  mkdirSync(paths.state, { recursive: true });
  return paths;
}

describe('ensureCopy: the ready marker', () => {
  /** A fake git that makes the folder that a clone would make. */
  function cloneGit(calls: Call[], failStep?: string) {
    return async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      if (args[0] === failStep) return { status: 1, stdout: '', stderr: '' };
      if (args[0] === 'clone') mkdirSync(join(args[args.length - 1] as string, '.git'), { recursive: true });
      return ok;
    };
  }
  const log = () => {};

  it('makes the copy and writes the marker only after the clone, the checkout and npm ci all worked', async () => {
    const paths = freshPaths('copy-fresh');
    const calls: Call[] = [];
    const installs: string[] = [];
    const ready = await ensureCopy(paths, 'https://example.test/r.git', 'main', { git: cloneGit(calls), install: async (cwd) => (installs.push(cwd), true), log });
    expect(ready).toBe(true);
    expect(calls.map((call) => call.args[0])).toEqual(['clone', 'sparse-checkout', 'checkout']);
    expect(installs).toEqual([paths.app]);
    expect(existsSync(join(paths.pinned, READY_MARKER))).toBe(true);
  });

  it('puts -- before the origin address, so an address that starts with a dash is never an option', async () => {
    const paths = freshPaths('copy-dashes');
    const calls: Call[] = [];
    await ensureCopy(paths, '--upload-pack=evil', 'main', { git: cloneGit(calls), install: async () => true, log });
    const clone = calls[0]?.args ?? [];
    expect(clone.indexOf('--upload-pack=evil')).toBe(clone.indexOf('--') + 1);
    expect(clone.indexOf('--')).toBeGreaterThan(clone.indexOf('--branch'));
  });

  it('a .git folder without the marker is a half-made copy: it is removed and made again', async () => {
    const paths = freshPaths('copy-half');
    mkdirSync(join(paths.pinned, '.git'), { recursive: true });
    writeFileSync(join(paths.pinned, 'stale-file.txt'), 'left over');
    const calls: Call[] = [];
    const ready = await ensureCopy(paths, 'o', 'main', { git: cloneGit(calls), install: async () => true, log });
    expect(ready).toBe(true);
    expect(calls[0]?.args[0]).toBe('clone');
    expect(existsSync(join(paths.pinned, 'stale-file.txt'))).toBe(false);
    expect(existsSync(join(paths.pinned, READY_MARKER))).toBe(true);
  });

  it('a copy with the marker is used as it is: no git call, no install', async () => {
    const paths = freshPaths('copy-ready');
    mkdirSync(join(paths.pinned, '.git'), { recursive: true });
    writeFileSync(join(paths.pinned, READY_MARKER), 'x');
    const calls: Call[] = [];
    const installs: string[] = [];
    expect(await ensureCopy(paths, 'o', 'main', { git: cloneGit(calls), install: async (cwd) => (installs.push(cwd), true), log })).toBe(true);
    expect(calls).toEqual([]);
    expect(installs).toEqual([]);
  });

  it('a failed npm ci leaves no marker, so the next launch makes the copy again (it does not count as ready)', async () => {
    const paths = freshPaths('copy-install-fails');
    const calls: Call[] = [];
    expect(await ensureCopy(paths, 'o', 'main', { git: cloneGit(calls), install: async () => false, log })).toBe(false);
    expect(existsSync(join(paths.pinned, '.git'))).toBe(true);
    expect(existsSync(join(paths.pinned, READY_MARKER))).toBe(false);
    const again: Call[] = [];
    expect(await ensureCopy(paths, 'o', 'main', { git: cloneGit(again), install: async () => true, log })).toBe(true);
    expect(again[0]?.args[0]).toBe('clone');
  });

  it.each(['clone', 'sparse-checkout', 'checkout'])('a failed git %s leaves no marker', async (step) => {
    const paths = freshPaths(`copy-fail-${step}`);
    expect(await ensureCopy(paths, 'o', 'main', { git: cloneGit([], step), install: async () => true, log })).toBe(false);
    expect(existsSync(join(paths.pinned, READY_MARKER))).toBe(false);
  });
});

describe('updateCopy: the needs-install marker', () => {
  const TOOL = 'tools/command-center';
  /** A fake git. `trees` maps "<ref>:<path>" to a tree id. A missing key means the path does not exist. */
  function updateGit(trees: Record<string, string>, calls: string[][], fetchStatus = 0) {
    return async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'fetch') return { status: fetchStatus, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        const tree = trees[args[1] as string];
        return tree === undefined ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: `${tree}\n`, stderr: '' };
      }
      return ok;
    };
  }
  const changed = { [`HEAD:${TOOL}`]: 'a', [`FETCH_HEAD:${TOOL}`]: 'b', [`HEAD:${TOOL}/package-lock.json`]: 'l1', [`FETCH_HEAD:${TOOL}/package-lock.json`]: 'l2' };
  const same = { [`HEAD:${TOOL}`]: 'a', [`FETCH_HEAD:${TOOL}`]: 'a', [`HEAD:${TOOL}/package-lock.json`]: 'l1', [`FETCH_HEAD:${TOOL}/package-lock.json`]: 'l1' };
  const log = () => {};

  function readyCopy(name: string) {
    const paths = freshPaths(name);
    mkdirSync(paths.app, { recursive: true });
    writeFileSync(join(paths.pinned, READY_MARKER), 'x');
    return paths;
  }

  it('a failed npm ci after the reset is tried again at the next round, even though the fetch then finds nothing new', async () => {
    const paths = readyCopy('upd-retry');
    let installOk = false;
    const installs: string[] = [];
    const install = async (cwd: string) => (installs.push(cwd), installOk);

    // Round 1: the lock file changed, the code moves, npm ci fails.
    expect(await updateCopy(paths, 'main', { git: updateGit(changed, []), install, log })).toBe('failed');
    expect(needsInstall(paths)).toBe(true);
    expect(existsSync(join(paths.pinned, NEEDS_INSTALL_MARKER))).toBe(true);

    // Round 2: the tree is the same now. The install is still tried (and fails again): not 'same'.
    expect(await updateCopy(paths, 'main', { git: updateGit(same, []), install, log })).toBe('failed');
    expect(installs).toHaveLength(2);
    expect(needsInstall(paths)).toBe(true);

    // Round 3: npm ci works. The marker goes, and the answer is 'updated' so that the running server is started again with the new code.
    installOk = true;
    expect(await updateCopy(paths, 'main', { git: updateGit(same, []), install, log })).toBe('updated');
    expect(installs).toHaveLength(3);
    expect(needsInstall(paths)).toBe(false);

    // Round 4: nothing to do.
    expect(await updateCopy(paths, 'main', { git: updateGit(same, []), install, log })).toBe('same');
    expect(installs).toHaveLength(3);
  });

  it('sets the marker before the code moves (a stop between the reset and npm ci is also caught up)', async () => {
    const paths = readyCopy('upd-marker-first');
    let markerAtReset: boolean | null = null;
    const git = async (args: string[]) => {
      if (args[0] === 'reset') markerAtReset = existsSync(join(paths.pinned, NEEDS_INSTALL_MARKER));
      return updateGit(changed, [])(args);
    };
    expect(await updateCopy(paths, 'main', { git, install: async () => true, log })).toBe('updated');
    expect(markerAtReset).toBe(true);
    expect(needsInstall(paths)).toBe(false);
  });

  it('does not run npm ci when the lock file did not change', async () => {
    const paths = readyCopy('upd-no-lock-change');
    const trees = { ...changed, [`FETCH_HEAD:${TOOL}/package-lock.json`]: 'l1' };
    const installs: string[] = [];
    expect(await updateCopy(paths, 'main', { git: updateGit(trees, []), install: async (cwd) => (installs.push(cwd), true), log })).toBe('updated');
    expect(installs).toEqual([]);
    expect(needsInstall(paths)).toBe(false);
  });

  it('answers failed on a failed fetch, and leaves the copy alone', async () => {
    const paths = readyCopy('upd-fetch-fails');
    const calls: string[][] = [];
    expect(await updateCopy(paths, 'main', { git: updateGit(changed, calls, 1), install: async () => true, log })).toBe('failed');
    expect(calls.some((args) => args[0] === 'reset')).toBe(false);
  });
});

describe('runLauncher', () => {
  const never = async () => {
    throw new Error('git must not run');
  };

  it('with no settings file it logs one line, ends with code 4, and does not fetch or clone anything (R7)', async () => {
    const checkout = join(scratch, 'launch-no-settings');
    mkdirSync(checkout, { recursive: true });
    const code = await runLauncher({ checkout, origin: 'https://example.test/r.git', settingsFile: join(scratch, 'no-such-settings.env'), deps: { git: never, install: never } });
    expect(code).toBe(4);
    const paths = pathsFor(checkout);
    expect(existsSync(paths.pinned)).toBe(false);
    expect(existsSync(paths.lock)).toBe(false); // the lock was given up
    const lines = readFileSync(paths.log, 'utf8')
      .split('\n')
      .filter((line) => line.includes('no settings file'));
    expect(lines).toHaveLength(1);
  });

  it('does not start the server with new code and old packages: a due npm ci that fails ends the launch with code 1 (R3)', async () => {
    const checkout = join(scratch, 'launch-needs-install');
    const paths = pathsFor(checkout);
    mkdirSync(paths.app, { recursive: true });
    writeFileSync(join(paths.pinned, READY_MARKER), 'x');
    writeFileSync(join(paths.pinned, NEEDS_INSTALL_MARKER), 'x');
    const settingsFile = join(scratch, 'fake-settings.env');
    writeFileSync(settingsFile, 'fake file made by the test\n');
    let supervised = 0;
    const code = await runLauncher({
      checkout,
      origin: 'o',
      settingsFile,
      deps: { git: async () => ({ status: 1, stdout: '', stderr: '' }), install: async () => false, supervise: async () => (supervised += 1, 0) },
    });
    expect(code).toBe(1);
    expect(supervised).toBe(0);
    expect(needsInstall(paths)).toBe(true);
  });
});

// ---- supervising the server (R3, R4, R5) ----

describe('supervise', () => {
  function rig(name: string) {
    const paths = freshPaths(name);
    mkdirSync(paths.app, { recursive: true });
    writeFileSync(join(paths.app, 'command-center.config.json'), JSON.stringify({ port: 3009, repoRoot: '../..', roots: [] }));
    const children: (EventEmitter & { pid: number; kill: () => boolean })[] = [];
    const spawnServer = () => {
      const child = Object.assign(new EventEmitter(), { pid: 1000 + children.length, kill: () => true });
      children.push(child);
      return child;
    };
    return { paths, children, spawnServer, logs: [] as string[] };
  }
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const root = resolve('/work/sj');

  it('R4: a kill that reaches no process leaves restarting false, so a later exit on its own (code 0) ends the launcher and does not start the server again', async () => {
    const r = rig('sup-r4');
    const result = supervise(r.paths, root, 'main', (m: string) => r.logs.push(m), () => {}, { spawnServer: r.spawnServer, update: async () => 'updated', fetchEveryMs: 20 });
    r.children[0]!.kill = () => false; // the process is already gone
    await sleep(80);
    r.children[0]!.emit('exit', 0);
    expect(await result).toBe(0);
    expect(r.children).toHaveLength(1);
  });

  it('a normal update kills the server and starts it again', async () => {
    const r = rig('sup-restart');
    let rounds = 0;
    const result = supervise(r.paths, root, 'main', (m: string) => r.logs.push(m), () => {}, { spawnServer: r.spawnServer, update: async () => (rounds++ === 0 ? 'updated' : 'same'), fetchEveryMs: 20 });
    const first = r.children[0]!;
    first.kill = () => (queueMicrotask(() => first.emit('exit', null)), true);
    await sleep(80);
    expect(r.children).toHaveLength(2);
    r.children[1]!.emit('exit', 3);
    expect(await result).toBe(3);
  });

  it('R5: a config that cannot be written when the server is started again ends the launcher with code 1 and does not throw', async () => {
    const r = rig('sup-r5');
    let rounds = 0;
    const result = supervise(r.paths, root, 'main', (m: string) => r.logs.push(m), () => {}, { spawnServer: r.spawnServer, update: async () => (rounds++ === 0 ? 'updated' : 'same'), fetchEveryMs: 20 });
    const first = r.children[0]!;
    first.kill = () => {
      rmSync(join(r.paths.app, 'command-center.config.json')); // the config that start() reads is gone
      queueMicrotask(() => first.emit('exit', null));
      return true;
    };
    expect(await result).toBe(1);
    expect(r.children).toHaveLength(1);
    expect(r.logs.some((line) => line.includes('could not be started'))).toBe(true);
  });

  it('R3: a crash restart does not start the server while a due npm ci keeps failing', async () => {
    const r = rig('sup-r3');
    writeFileSync(join(r.paths.pinned, NEEDS_INSTALL_MARKER), 'x');
    const result = supervise(r.paths, root, 'main', (m: string) => r.logs.push(m), () => {}, {
      spawnServer: r.spawnServer,
      update: async () => 'same',
      install: async () => false,
      fetchEveryMs: 100_000,
      restartDelayMs: 10,
    });
    r.children[0]!.emit('exit', 1); // a crash
    expect(await result).toBe(1);
    expect(r.children).toHaveLength(1);
  });
});

// ---- stop (A3) ----

describe('stopReporter: only a process that is verified as ours is killed', () => {
  const SERVER_CMD = 'node --import tsx src/server/main.ts --config C:/x/reporter.config.json --reporter';
  const LAUNCHER_CMD = 'node C:/x/scripts/reporter-launch.mjs --repo C:/x';

  /** A fake process table: pid -> start time and command line. */
  function world(name: string, lockIds: Record<string, unknown>, table: Record<number, { start: string; command: string }>) {
    const checkout = join(scratch, name);
    const paths = pathsFor(checkout);
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(paths.lock, JSON.stringify(lockIds));
    const killed: number[] = [];
    const asked: number[] = [];
    const deps = {
      processInfo: async (pid: number) => (asked.push(pid), table[pid] ?? null),
      kill: (pid: number) => void killed.push(pid),
    };
    return { checkout, paths, killed, asked, deps };
  }
  const ids = { launcher: 111, launcherStart: 'L-START', server: 222, serverStart: 'S-START', started: 'x' };

  it('kills the server and the launcher when the start time and the command line match, and removes the lock', async () => {
    const w = world('stop-ok', ids, { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-START', command: SERVER_CMD } });
    expect(await stopReporter(w.checkout, w.deps)).toBe('The reporter was stopped.');
    expect(w.killed).toEqual([222, 111]);
    expect(existsSync(w.paths.lock)).toBe(false);
  });

  it('does not kill a process id that the system gave to another program (another start time), and keeps the lock', async () => {
    const w = world('stop-reuse', ids, { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-OTHER', command: SERVER_CMD } });
    const message = await stopReporter(w.checkout, w.deps);
    expect(w.killed).toEqual([111]);
    expect(message).toContain('not fully stopped');
    expect(existsSync(w.paths.lock)).toBe(true);
    expect(readFileSync(w.paths.log, 'utf8')).toContain('did not stop the server');
  });

  it('does not kill a process whose command line is not the launcher or the server, even when the start time matches', async () => {
    const w = world('stop-command', ids, { 111: { start: 'L-START', command: 'node some-other-program.js' }, 222: { start: 'S-START', command: 'C:/Windows/notepad.exe' } });
    await stopReporter(w.checkout, w.deps);
    expect(w.killed).toEqual([]);
    expect(existsSync(w.paths.lock)).toBe(true);
  });

  it('does not kill when the lock has no start time (an old lock, or one the launcher could not complete), and logs why', async () => {
    const w = world('stop-no-identity', { launcher: 111, server: 222, started: 'x' }, { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-START', command: SERVER_CMD } });
    const message = await stopReporter(w.checkout, w.deps);
    expect(w.killed).toEqual([]);
    expect(w.asked).toEqual([]); // nothing to compare with, so the table is not even asked
    expect(message).toContain('cannot be verified');
    expect(readFileSync(w.paths.log, 'utf8')).toContain('cannot be verified');
    expect(existsSync(w.paths.lock)).toBe(true);
  });

  it('kills nothing for a process that is gone, and removes the lock', async () => {
    const w = world('stop-gone', ids, {});
    expect(await stopReporter(w.checkout, w.deps)).toContain('not running');
    expect(w.killed).toEqual([]);
    expect(existsSync(w.paths.lock)).toBe(false);
  });

  it('does nothing for an old lock', async () => {
    const w = world('stop-old', ids, { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-START', command: SERVER_CMD } });
    expect(await stopReporter(w.checkout, { ...w.deps, now: () => Date.now() + LOCK_STALE_MS + 1000 })).toContain('old');
    expect(w.killed).toEqual([]);
    expect(w.asked).toEqual([]);
  });

  it('does nothing without a lock, and for a lock that is not JSON', async () => {
    const none = join(scratch, 'stop-nolock');
    mkdirSync(pathsFor(none).state, { recursive: true });
    expect(await stopReporter(none, { processInfo: async () => null, kill: () => {} })).toContain('no lock');
    const w = world('stop-garbage', ids, {});
    writeFileSync(w.paths.lock, 'not json');
    expect(await stopReporter(w.checkout, w.deps)).toContain('not readable');
    expect(w.killed).toEqual([]);
  });
});

describe('processInfo', () => {
  it('refuses a process id that is not a whole positive number, and runs nothing', async () => {
    const run = async () => {
      throw new Error('must not run');
    };
    for (const pid of [Number.NaN, 0, -4, 1.5, '12; calc' as unknown as number]) expect(await processInfo(pid, run, 'win32')).toBeNull();
  });

  it('on Windows asks PowerShell about the numeric id only, without a shell, and reads start time and command line', async () => {
    const seen: { file: string; args: string[] }[] = [];
    const info = await processInfo(4242, async (file, args) => (seen.push({ file, args }), '2026-10-12T09:00:00.0000000Z\r\nnode C:/x/reporter-launch.mjs\r\n'), 'win32');
    expect(info).toEqual({ start: '2026-10-12T09:00:00.0000000Z', command: 'node C:/x/reporter-launch.mjs' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.file).toBe('powershell.exe');
    expect(seen[0]?.args.join(' ')).toContain("ProcessId=4242'");
  });

  it('on other systems uses ps with the id as its own argument, and gives null for a process that does not exist', async () => {
    const seen: string[][] = [];
    const info = await processInfo(4242, async (_file, args) => (seen.push(args), args.includes('lstart=') ? 'Mon Oct 12 09:00:00 2026\n' : 'node main.ts --reporter\n'), 'linux');
    expect(info).toEqual({ start: 'Mon Oct 12 09:00:00 2026', command: 'node main.ts --reporter' });
    expect(seen.every((args) => args.at(-1) === '4242')).toBe(true);
    expect(await processInfo(4242, async () => '', 'linux')).toBeNull();
    expect(await processInfo(4242, async () => null, 'linux')).toBeNull();
  });

  it('can read this very process (a real call that kills nothing)', async () => {
    const info = await processInfo(process.pid);
    expect(info).not.toBeNull();
    expect(info?.start).not.toBe('');
  });
});
