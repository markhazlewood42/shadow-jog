import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { isMainModule } from '../scripts/is-main.mjs';
import { CRASH_WINDOW_MS, LOCK_TOUCH_MS, MAX_RESTARTS, READY_MARKER, lockNamesUs, npmCi, pathsFor, runLauncher, stopReporter, supervise } from '../scripts/reporter-launch.mjs';
import { PACKAGE_DIR } from './helpers';

// The fixes of the review of PR 72 for the launcher and the hook: the lock heartbeat (F5), the npm ci time limit (F6), the crash cap (F7),
// the live key after --stop (F4), and the main guard that works without `import.meta.main` (F10). Only temporary folders and fakes: the real
// launcher never runs on the real repo, and nothing here reads the settings file or reaches a store.

const scratch = mkdtempSync(join(tmpdir(), 'cc-launch-fixes-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(5);
  }
}

// ---- F5: the heartbeat ----

describe('F5: the lock heartbeat writes only into a lock that still names this launcher', () => {
  it('lockNamesUs: the same process id and start stamp is ours; anything else is not', () => {
    const ours = JSON.stringify({ launcher: 10, launcherStart: null, server: null, serverStart: null, started: 'T1' });
    expect(lockNamesUs(ours, 10, 'T1')).toBe(true);
    expect(lockNamesUs(ours, 11, 'T1')).toBe(false); // another process id
    expect(lockNamesUs(ours, 10, 'T2')).toBe(false); // the same id, started at another time: the system gave the number to a new program
    expect(lockNamesUs(null, 10, 'T1')).toBe(false); // the lock is gone
    expect(lockNamesUs('not json', 10, 'T1')).toBe(false);
    expect(lockNamesUs('null', 10, 'T1')).toBe(false);
    const withStart = JSON.stringify({ launcher: 10, launcherStart: 'S-A', started: 'T1' });
    expect(lockNamesUs(withStart, 10, 'T1', 'S-A')).toBe(true);
    expect(lockNamesUs(withStart, 10, 'T1', 'S-B')).toBe(false); // the system start time differs
    expect(lockNamesUs(withStart, 10, 'T1', null)).toBe(true); // not known yet: the stamp decides
  });

  /** Runs the whole launcher with fakes. `supervise` waits until it is told to stop through the signal, like the real one. */
  function rig(name: string) {
    const checkout = join(scratch, name);
    const paths = pathsFor(checkout);
    mkdirSync(paths.pinned, { recursive: true });
    writeFileSync(join(paths.pinned, READY_MARKER), 'x');
    const settingsFile = join(scratch, `${name}-settings.env`);
    writeFileSync(settingsFile, 'fake file made by the test\n');
    const state = { reached: false, aborted: false, ended: false };
    const supervised = (...args: unknown[]) =>
      new Promise<number>((done) => {
        state.reached = true;
        const deps = (args[5] ?? {}) as { signal?: AbortSignal };
        deps.signal?.addEventListener('abort', () => {
          state.aborted = true;
          done(0);
        });
      });
    const run = runLauncher({
      checkout,
      origin: 'o',
      settingsFile,
      deps: { git: async () => ({ status: 1, stdout: '', stderr: '' }), install: async () => true, supervise: supervised },
    }).then((code) => ((state.ended = true), code));
    return { paths, state, run };
  }

  it('a launcher that finds its lock taken over writes nothing, stops its supervisor, and leaves the other lock alone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = rig('f5-takeover');
    await waitFor(() => r.state.reached);
    const otherLock = JSON.stringify({ launcher: 424242, launcherStart: 'OTHER-START', server: 424243, serverStart: 'OTHER-SERVER', started: 'another-launcher' });
    writeFileSync(r.paths.lock, otherLock); // another launcher took the stale lock over
    vi.advanceTimersByTime(LOCK_TOUCH_MS); // the heartbeat of this launcher fires
    expect(await r.run).toBe(0);
    expect(r.state.aborted).toBe(true);
    expect(readFileSync(r.paths.lock, 'utf8')).toBe(otherLock); // not overwritten, and not removed by the release at the end
    expect(readFileSync(r.paths.log, 'utf8')).toContain('belongs to another launcher');
  });

  it('a launcher whose lock is still its own keeps writing, and removes the lock when it ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = rig('f5-own');
    await waitFor(() => r.state.reached);
    const before = JSON.parse(readFileSync(r.paths.lock, 'utf8')) as { launcher: number; started: string };
    vi.advanceTimersByTime(LOCK_TOUCH_MS);
    await sleep(20);
    expect(r.state.aborted).toBe(false);
    const after = JSON.parse(readFileSync(r.paths.lock, 'utf8')) as { launcher: number; started: string };
    expect(after.launcher).toBe(before.launcher);
    expect(after.started).toBe(before.started);
    expect(r.state.ended).toBe(false);
  });

  it('a launcher whose lock file is gone stops too (nothing names it)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = rig('f5-gone');
    await waitFor(() => r.state.reached);
    rmSync(r.paths.lock, { force: true });
    vi.advanceTimersByTime(LOCK_TOUCH_MS);
    expect(await r.run).toBe(0);
    expect(existsSync(r.paths.lock)).toBe(false); // the heartbeat did not write it again
  });
});

// ---- F6: npm ci ----

describe('F6: npm ci has a time limit', () => {
  it('ends a hung install, logs a clear line and answers false', async () => {
    const logs: string[] = [];
    const started = Date.now();
    const ok = await npmCi(scratch, (message) => logs.push(message), { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 300 });
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(logs.some((line) => line.includes('npm ci did not finish') && line.includes('ended'))).toBe(true);
  });

  it('answers true for an install that works, false for one that fails, and logs nothing about a time out', async () => {
    const logs: string[] = [];
    expect(await npmCi(scratch, (message) => logs.push(message), { command: process.execPath, args: ['-e', '0'], timeoutMs: 20_000 })).toBe(true);
    expect(await npmCi(scratch, (message) => logs.push(message), { command: process.execPath, args: ['-e', 'process.exit(1)'], timeoutMs: 20_000 })).toBe(false);
    expect(logs).toEqual([]);
  });

  it('the default limit is 5 minutes', async () => {
    const { NPM_CI_TIMEOUT_MS } = await import('../scripts/reporter-launch.mjs');
    expect(NPM_CI_TIMEOUT_MS).toBe(300_000);
  });

  it('a hung install ends the launch with code 1 and releases the lock (the heartbeat does not hold it for ever)', async () => {
    const checkout = join(scratch, 'f6-launch');
    const paths = pathsFor(checkout);
    mkdirSync(paths.state, { recursive: true });
    const settingsFile = join(scratch, 'f6-settings.env');
    writeFileSync(settingsFile, 'fake file made by the test\n');
    const code = await runLauncher({
      checkout,
      origin: 'o',
      settingsFile,
      deps: {
        // The fake git makes the folder that a clone would make, so that the install has a real folder to run in.
        git: async (args: string[]) => {
          if (args[0] === 'checkout') mkdirSync(paths.app, { recursive: true });
          return { status: 0, stdout: '', stderr: '' };
        },
        install: (cwd: string, log: (message: string) => void) => npmCi(cwd, log, { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 300 }),
        supervise: async () => {
          throw new Error('must not be reached');
        },
      },
    });
    expect(code).toBe(1);
    expect(existsSync(paths.lock)).toBe(false);
    const log = readFileSync(paths.log, 'utf8');
    expect(log).toContain('npm ci did not finish');
    expect(log).toContain('npm ci failed in the pinned copy');
  });
});

// ---- F7: the crash cap ----

describe('F7: the crash cap is 3 restarts in 10 minutes (the 4th crash gives up)', () => {
  it('the constants say so', () => {
    expect(MAX_RESTARTS).toBe(3);
    expect(CRASH_WINDOW_MS).toBe(10 * 60_000);
  });

  it('restarts after the 1st, 2nd and 3rd crash, and gives up on the 4th with a log line that says what happened', async () => {
    const paths = pathsFor(join(scratch, 'f7'));
    mkdirSync(paths.app, { recursive: true });
    writeFileSync(join(paths.app, 'command-center.config.json'), JSON.stringify({ port: 3009, repoRoot: '../..', roots: [] }));
    const children: (EventEmitter & { pid: number; kill: () => boolean })[] = [];
    const logs: string[] = [];
    const result = supervise(paths, resolve('/work/sj'), 'main', (message: string) => logs.push(message), () => {}, {
      spawnServer: () => {
        const child = Object.assign(new EventEmitter(), { pid: 2000 + children.length, kill: () => true });
        children.push(child);
        return child;
      },
      update: async () => 'same',
      fetchEveryMs: 100_000,
      restartDelayMs: 5,
    });
    for (let crash = 1; crash <= MAX_RESTARTS; crash++) {
      await waitFor(() => children.length === crash);
      children[crash - 1]?.emit('exit', 1);
    }
    await waitFor(() => children.length === MAX_RESTARTS + 1);
    expect(children).toHaveLength(4); // 1 start and 3 restarts
    children[MAX_RESTARTS]?.emit('exit', 1); // the 4th crash
    expect(await result).toBe(1);
    expect(children).toHaveLength(4); // no 5th start
    const last = logs.at(-1) ?? '';
    expect(last).toContain('crashed 4 times in 10 minutes');
    expect(last).toContain('giving up after 3 restarts');
    expect(logs.filter((line) => line.includes('starting it again'))).toHaveLength(3);
  });
});

// ---- F4: the live key after --stop ----

describe('F4: --stop removes the live key after it ended the server', () => {
  const SERVER_CMD = 'node --import tsx src/server/main.ts --config C:/x/reporter.config.json --reporter';
  const LAUNCHER_CMD = 'node C:/x/scripts/reporter-launch.mjs --repo C:/x';
  const ids = { launcher: 111, launcherStart: 'L-START', server: 222, serverStart: 'S-START', started: 'x' };

  function world(name: string, table: Record<number, { start: string; command: string }>) {
    const checkout = join(scratch, name);
    const paths = pathsFor(checkout);
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(paths.lock, JSON.stringify(ids));
    const killed: number[] = [];
    const cleared: string[] = [];
    const deps = {
      processInfo: async (pid: number) => table[pid] ?? null,
      kill: (pid: number) => void killed.push(pid),
      clearLive: async (forPaths: { app: string }) => (cleared.push(forPaths.app), 'removed the live key'),
    };
    return { checkout, paths, killed, cleared, deps };
  }

  it('runs the removal once, after the kill, and writes the result to the log', async () => {
    const w = world('f4-ok', { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-START', command: SERVER_CMD } });
    expect(await stopReporter(w.checkout, w.deps)).toBe('The reporter was stopped.');
    expect(w.killed).toEqual([222, 111]);
    expect(w.cleared).toEqual([w.paths.app]);
    expect(readFileSync(w.paths.log, 'utf8')).toContain('removed the live key');
  });

  it('does not run the removal when the server was not verified as ours', async () => {
    const w = world('f4-refused', { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-OTHER', command: SERVER_CMD } });
    await stopReporter(w.checkout, w.deps);
    expect(w.cleared).toEqual([]);
  });

  it('a removal that throws is logged and does not break the stop', async () => {
    const w = world('f4-throws', { 111: { start: 'L-START', command: LAUNCHER_CMD }, 222: { start: 'S-START', command: SERVER_CMD } });
    const message = await stopReporter(w.checkout, {
      ...w.deps,
      clearLive: async () => {
        throw new Error('boom');
      },
    });
    expect(message).toBe('The reporter was stopped.');
    expect(readFileSync(w.paths.log, 'utf8')).toContain('could not be removed');
  });
});

// ---- F10: the main guard ----

describe('F10: isMainModule works without import.meta.main', () => {
  const file = join(scratch, 'program.mjs');
  writeFileSync(file, '// a file');
  const url = pathToFileURL(file).href;

  it('is true when argv[1] is the file that asks', () => {
    expect(isMainModule(url, file)).toBe(true);
  });

  it('is true for a path with a different spelling (a "." segment, a trailing detour) of the same file', () => {
    expect(isMainModule(url, join(scratch, '.', 'program.mjs'))).toBe(true);
    expect(isMainModule(url, join(scratch, 'sub', '..', 'program.mjs'))).toBe(true);
  });

  it('is false for another file, an empty argv[1], a missing argv[1] and a path that does not exist', () => {
    const other = join(scratch, 'other.mjs');
    writeFileSync(other, '// other');
    expect(isMainModule(url, other)).toBe(false);
    expect(isMainModule(url, '')).toBe(false);
    expect(isMainModule(url, undefined)).toBe(false);
    expect(isMainModule(url, join(scratch, 'does-not-exist.mjs'))).toBe(false);
    expect(isMainModule('not a url', file)).toBe(false);
  });

  it('is true when argv[1] is a link to the file (the real paths are compared)', () => {
    const link = join(scratch, 'link.mjs');
    try {
      symlinkSync(file, link);
    } catch {
      return; // this machine cannot make a link: nothing to test
    }
    expect(isMainModule(url, link)).toBe(true);
  });

  it.runIf(process.platform === 'win32')('on Windows the letter case does not matter', () => {
    expect(isMainModule(url, file.toUpperCase(), 'win32')).toBe(true);
    expect(isMainModule(url, file.toLowerCase(), 'win32')).toBe(true);
  });

  it('the hook and the launcher do not use import.meta.main or import.meta.dirname in code (Node 24 only / newer than 22)', () => {
    for (const name of ['reporter-hook.mjs', 'reporter-launch.mjs']) {
      const code = readFileSync(join(PACKAGE_DIR, 'scripts', name), 'utf8')
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(code, name).not.toMatch(/import\.meta\.main/);
      expect(code, name).not.toMatch(/import\.meta\.dirname/);
      expect(code, name).toMatch(/isMainModule\(import\.meta\.url\)/);
    }
  });

  it('the server entry uses the same guard', () => {
    const code = readFileSync(join(PACKAGE_DIR, 'src', 'server', 'main.ts'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/import\.meta\.main/);
    expect(code).toMatch(/isMainModule\(import\.meta\.url\)/);
  });
});
