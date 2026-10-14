// The launcher of the local reporter (design.md section 11.1, "It runs from a pinned copy of origin/main").
// It is plain JavaScript, so that it runs with `node` alone, before any package is installed.
//
// What it does, in order:
//   1. Takes a lock (and checks the port), so that a second launch does nothing. The lock holds each process id with its start time.
//   2. Looks for the settings file (only that it exists). Without it, it logs one line and ends: the pinned copy is not fetched for nothing.
//   3. Makes or updates a PINNED COPY of origin/main in `<main checkout>/.cc-reporter/pinned` (git-ignored). The copy is its own small clone,
//      so a branch switch in the shared checkout cannot change the code that the reporter runs, and the fetch never moves any ref of the shared checkout.
//      A copy is ready only with its marker file, which is written after the clone, the checkout and `npm ci` all worked.
//      Git runs asynchronously, so the lock heartbeat keeps going during a long clone.
//   4. Runs the server of the Command Center from the copy, headless (CC_NO_OPEN=1), in reporter mode, on its own port.
//   5. Every 2 minutes it runs `git fetch` in the copy. When main changed anything under tools/command-center/, it updates the copy
//      (and installs the packages again when the lock file changed) and starts the server again. A "needs install" marker makes a failed
//      `npm ci` try again, and the server never starts with new code and old packages.
//   (`--manual`, from the tray app: the server runs with `--no-idle-exit`, so rule 6 never applies to code 0. `--prepare-local` writes the config of the
//   local Command Center on port 3009 and builds its page, then ends. `--stop` stops what the tray started.)
//   6. When the server exits on its own (30 minutes with no session: code 0; a public page: code 3; no settings file: code 4), it stops too.
//      Any other exit is a crash: it starts the server again, at most 3 times in 10 minutes. The 4th crash inside 10 minutes ends the launcher
//      (code 1), so 3 restarts and 4 crashes is the most.
//   7. The lock heartbeat checks that the lock still names this launcher (process id and start stamp) before it writes. If another launcher took the
//      lock over (this one slept with the laptop and its lock went stale), this launcher stops its server and ends, and never removes the other's lock.
//
// It needs no feature newer than Node 20.11. It does not use `import.meta.main` (Node 24.2 and newer only): see is-main.mjs.
//
// Everything this file writes is under `.cc-reporter/` (the lock, the log, the generated config, the copy). It never touches the settings file with the token.
// The pure parts are exported, so that tests/reporter-launch.test.ts can run them with fakes.

import { execFile, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isMainModule } from './is-main.mjs';

/** The reporter's own port. The normal Command Center uses 3009 and the end-to-end tests 3010. Do not move it back to a 30xx port: `PW_PORT=3011` game Playwright runs use 3011 and the launcher reads an open port as "a reporter is running". It stays below 32768 so that no OS gives it out as the source port of an outgoing connection (Linux ephemeral range 32768-60999). */
export const REPORTER_PORT = 29417;
/** The folder of the reporter inside the main checkout. It is in .gitignore. */
export const STATE_DIR = '.cc-reporter';
/** A lock that was not touched for this long is dead (a crash, or a power cut). The launcher touches it every `LOCK_TOUCH_MS`. */
export const LOCK_STALE_MS = 120_000;
export const LOCK_TOUCH_MS = 30_000;
/** How often the copy is fetched (design.md section 11.1). */
export const FETCH_EVERY_MS = 120_000;
/** The most time that one `npm ci` may take. A hung install must not hold the lock (and keep its heartbeat going) for ever. */
export const NPM_CI_TIMEOUT_MS = 5 * 60_000;
/** The crash cap: more than `MAX_RESTARTS` crashes inside `CRASH_WINDOW_MS` ends the launcher. So the 4th crash in 10 minutes is the last. */
export const MAX_RESTARTS = 3;
export const CRASH_WINDOW_MS = 600_000;
/** The exit codes of the server (src/server/publish/reporter.ts, EXIT). */
export const EXIT = { idle: 0, public: 3, notConfigured: 4 };

/** Written into the pinned copy only after the clone, the checkout AND `npm ci` all worked. A copy with a `.git` and no marker is a half-made copy. */
export const READY_MARKER = '.cc-ready';
/** Written into the pinned copy before the code moves to a commit with a new lock file, and removed when `npm ci` worked. While it exists, the packages may not match the code. */
export const NEEDS_INSTALL_MARKER = '.cc-needs-install';

const CONFIG_PATH = join('tools', 'command-center', 'command-center.config.json');

// ---- finding the checkout ----

/**
 * The folder of the shadow-jog checkout (or worktree) that holds `start`, or null. A shadow-jog checkout is a folder with a `.git` (a folder in the main
 * checkout, a file in a worktree) and tools/command-center/command-center.config.json.
 * @param {string} start
 * @param {(path: string) => boolean} [exists]
 */
export function findCheckout(start, exists = existsSync) {
  let dir = resolve(start);
  for (;;) {
    if (exists(join(dir, '.git')) && exists(join(dir, CONFIG_PATH))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The main checkout of the repo that holds `dir`: the first entry of `git worktree list`. A worktree and the main folder give the same answer, so there
 * is one reporter for the repo. If git cannot say, `dir` itself.
 * @param {string} dir
 * @param {(args: string[], cwd: string) => { status: number | null, stdout: string }} [git]
 */
export function mainCheckout(dir, git = runGitSync) {
  const result = git(['worktree', 'list', '--porcelain'], dir);
  if (result.status !== 0) return dir;
  const first = result.stdout.split(/\r?\n/).find((line) => line.startsWith('worktree '));
  return first === undefined ? dir : resolve(first.slice('worktree '.length));
}

/** A short git call that runs before the lock is taken (the worktree list, the origin address). It blocks, which is fine for these. */
function runGitSync(args, cwd, timeout = 60_000) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { status: result.error ? null : result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const OUTPUT_LIMIT = 200_000;

/**
 * Runs a program WITHOUT blocking the event loop, so that the lock heartbeat keeps running during a long clone or fetch. No shell: the arguments go
 * to the program as they are. Gives `{ status, stdout, stderr }`; `status` is null when the program could not start or ran past `timeout`.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeout?: number, env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
export function runCommand(command, args, options = {}) {
  return new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      done({ status: null, stdout, stderr });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeout ?? 60_000);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk;
    });
    child.once('error', () => {
      clearTimeout(timer);
      done({ status: null, stdout, stderr });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done({ status: timedOut ? null : code, stdout, stderr });
    });
  });
}

/** git, asynchronously (see runCommand). */
export function runGit(args, cwd, timeout = 60_000) {
  return runCommand('git', args, { cwd, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

// ---- the lock ----

/**
 * Takes the lock, or says that another launcher holds it. A second launch does nothing.
 * The lock is held when its file was touched in the last 2 minutes, or when something answers on the reporter's port (a launcher that sleeps with the
 * machine has an old lock, but its server still holds the port). Only a lock that is old AND a port that is free is taken over.
 * A fresh lock is also taken over at once when its owner is gone: `deps.processInfo(pid)` says the launcher process does not exist, or exists with
 * another start time than the lock records (the system gave the pid to another program). The port must be free too. If the check throws or the lock
 * cannot be read, the lock counts as held (it is never taken when it cannot be judged). Nothing is killed here.
 * @param {{ now: () => number, portInUse: () => Promise<boolean>, read: () => { text: string, mtimeMs: number } | null, create: (text: string) => boolean, remove: () => void, processInfo?: (pid: number) => Promise<{ start: string } | null> }} deps
 * @param {string} text what to write into the lock (JSON with the process ids)
 * @returns {Promise<'acquired' | 'held'>}
 */
export async function acquireLock(deps, text) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (deps.create(text)) return 'acquired';
    const lock = deps.read();
    if (lock === null) continue; // it vanished between the two calls: try again
    if (deps.now() - lock.mtimeMs < LOCK_STALE_MS && !(await ownerGone(deps, lock.text))) return 'held';
    if (await deps.portInUse()) return 'held';
    deps.remove();
  }
  return 'held';
}

/** True only when the lock names a launcher process that is surely gone (no such pid, or the pid now has another start time). False when unsure. */
async function ownerGone(deps, text) {
  if (typeof deps.processInfo !== 'function') return false;
  try {
    const ids = JSON.parse(text);
    if (ids === null || typeof ids !== 'object' || !Number.isInteger(ids.launcher) || ids.launcher <= 0) return false;
    const info = await deps.processInfo(ids.launcher);
    if (info === null) return true;
    return typeof ids.launcherStart === 'string' && typeof info.start === 'string' && info.start !== ids.launcherStart;
  } catch {
    return false;
  }
}

/** The lock functions on real files. `create` is atomic: the `wx` flag fails when the file exists. */
export function fileLock(file) {
  return {
    read() {
      try {
        return { text: readFileSync(file, 'utf8'), mtimeMs: statSync(file).mtimeMs };
      } catch {
        return null;
      }
    },
    create(text) {
      try {
        writeFileSync(file, text, { flag: 'wx' });
        return true;
      } catch (error) {
        if (error && error.code === 'EEXIST') return false;
        throw error;
      }
    },
    remove() {
      rmSync(file, { force: true });
    },
    /** Writes new content into a lock this process holds. It also moves the time of the file, which is the lock's heartbeat. */
    touch(text) {
      writeFileSync(file, text);
    },
  };
}

/** Whether something accepts a connection on the loopback port. */
export function portInUse(port, host = '127.0.0.1') {
  return new Promise((done) => {
    const socket = createConnection({ port, host });
    const finish = (answer) => {
      socket.destroy();
      done(answer);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

// ---- the config of the reporter run ----

/**
 * The config for the reporter run. It is the config of the pinned copy with three changes: the repo root and the roots point at the REAL checkout
 * (sessions and worktrees are looked up there, not in the copy), and the port is the reporter's own. Relative paths in the original are relative to
 * the config file of the real checkout, so they are resolved against `<checkout>/tools/command-center`.
 * @param {Record<string, any>} original the parsed command-center.config.json of the copy
 * @param {string} checkout the main checkout
 * @param {number} port
 */
export function reporterConfig(original, checkout, port = REPORTER_PORT) {
  const base = join(checkout, 'tools', 'command-center');
  const absolute = (path) => (path === '~' || path.startsWith('~/') || path.startsWith('~\\') || isAbsolute(path) ? path : resolve(base, path));
  return {
    ...original,
    port,
    repoRoot: resolve(base, original.repoRoot),
    roots: (original.roots ?? []).map(absolute),
  };
}

// ---- the paths of the reporter ----

/** Builds the paths of the reporter's folder. */
export function pathsFor(checkout) {
  const state = join(checkout, STATE_DIR);
  return {
    state,
    lock: join(state, 'reporter.lock'),
    log: join(state, 'reporter.log'),
    config: join(state, 'reporter.config.json'),
    pinned: join(state, 'pinned'),
    app: join(state, 'pinned', 'tools', 'command-center'),
  };
}

// ---- process identity (for --stop) ----

const execFileAsync = (file, args, options) =>
  new Promise((done) => {
    execFile(file, args, options, (error, stdout) => done(error ? null : String(stdout)));
  });

/**
 * When a process started and with what command line, or null when no such process exists (or it cannot be read). The start time is the identity: a
 * process id that the system gave to another program later has another start time. There is no shell: `pid` must be a whole number, and it goes into the
 * arguments of the program (`ps`, or PowerShell on Windows) and never through a shell.
 * @param {number} pid
 * @param {(file: string, args: string[], options: object) => Promise<string | null>} [run] runs a program, gives its output or null on failure
 * @param {string} [platform]
 * @returns {Promise<{ start: string, command: string } | null>}
 */
export async function processInfo(pid, run = execFileAsync, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === 'win32') {
    const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o'); $p.CommandLine }`;
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 });
    if (out === null) return null;
    const lines = out.split(/\r?\n/);
    const start = (lines[0] ?? '').trim();
    return start === '' ? null : { start, command: lines.slice(1).join(' ').trim() };
  }
  const options = { env: { ...process.env, LC_ALL: 'C' }, timeout: 10_000 };
  const start = await run('ps', ['-o', 'lstart=', '-p', String(pid)], options);
  if (start === null || start.trim() === '') return null;
  const command = await run('ps', ['-o', 'args=', '-p', String(pid)], options);
  return { start: start.trim(), command: (command ?? '').trim() };
}

// ---- the pinned copy ----

/** Ends a child and, on Windows, the processes it started (npm runs behind a shell there, and `child.kill()` would end only the shell). */
function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid !== undefined) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // the process is already gone
  }
}

/**
 * `npm ci` in the pinned copy, with a total time limit. On a time out the process is ended, a clear line goes to the log, and the answer is false, so
 * the caller stops and the lock is released (a hung install used to keep the lock fresh for ever through the heartbeat).
 * `options` is for the tests (another program, a short limit): `command`, `args`, `timeoutMs`.
 * @param {string} cwd
 * @param {(message: string) => void} log
 * @param {{ command?: string, args?: string[], timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export function npmCi(cwd, log, options = {}) {
  const timeoutMs = options.timeoutMs ?? NPM_CI_TIMEOUT_MS;
  return new Promise((done) => {
    let finished = false;
    let timer = null;
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      if (timer !== null) clearTimeout(timer);
      done(answer);
    };
    // `npm` is a .cmd file on Windows, which only a shell can start. The arguments are fixed, so the shell has nothing to misread.
    const real = options.command === undefined;
    const child = spawn(options.command ?? 'npm', options.args ?? ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], {
      cwd,
      shell: real && process.platform === 'win32',
      stdio: 'ignore',
      windowsHide: true,
    });
    timer = setTimeout(() => {
      log(`npm ci did not finish in ${Math.round(timeoutMs / 1000)} seconds, so it was ended. The pinned copy is not ready; the next session start tries again.`);
      killTree(child);
      finish(false);
    }, timeoutMs);
    child.once('error', (error) => {
      log(`npm ci could not start (${error.code ?? 'error'})`);
      finish(false);
    });
    child.once('exit', (code) => finish(code === 0));
  });
}

const treeOf = async (git, cwd, ref, path) => {
  const result = await git(['rev-parse', `${ref}:${path}`], cwd);
  return result.status === 0 ? result.stdout.trim() : null;
};

const readyFile = (paths) => join(paths.pinned, READY_MARKER);
const needsInstallFile = (paths) => join(paths.pinned, NEEDS_INSTALL_MARKER);

/** Whether the code in the copy may need packages that are not installed (an `npm ci` that was due did not finish). */
export function needsInstall(paths) {
  return existsSync(needsInstallFile(paths));
}

/**
 * Runs the install again when the "needs install" marker is set. Removes the marker when it worked.
 * @returns {Promise<'not-needed' | 'installed' | 'failed'>}
 */
export async function retryInstall(paths, deps) {
  if (!needsInstall(paths)) return 'not-needed';
  deps.log('the packages of the pinned copy are not current; running npm ci again');
  if (!(await deps.install(paths.app, deps.log))) {
    deps.log('npm ci failed again; the server will not start with new code and old packages');
    return 'failed';
  }
  rmSync(needsInstallFile(paths), { force: true });
  return 'installed';
}

/**
 * Makes the pinned copy if it is missing or half-made. A sparse, shallow clone: only tools/command-center, only the newest commit of the branch.
 * A copy counts as ready only when the ready marker exists, and the marker is written last, after the clone, the checkout and `npm ci` all worked.
 * A `.git` folder without the marker is what a crash or a failed install leaves behind, so that copy is removed and made again.
 * @param {{ pinned: string, state: string, app: string }} paths
 * @param {{ git: (args: string[], cwd: string, timeout?: number) => Promise<{ status: number | null }>, install: (cwd: string, log: (m: string) => void) => Promise<boolean>, log: (m: string) => void }} deps
 * @returns {Promise<boolean>} whether the copy is ready
 */
export async function ensureCopy(paths, origin, branch, deps) {
  const { git, install, log } = deps;
  if (existsSync(readyFile(paths))) return true;
  if (existsSync(join(paths.pinned, '.git'))) log('the pinned copy was not finished (no ready marker); it is removed and made again');
  log(`making the pinned copy of origin/${branch} (the first run takes a minute or two)`);
  rmSync(paths.pinned, { recursive: true, force: true });
  const steps = [
    // `--` before the address: an address that starts with a dash is never read as an option.
    ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', branch, '--', origin, paths.pinned],
    ['sparse-checkout', 'set', 'tools/command-center'],
    ['checkout', branch],
  ];
  for (const [index, step] of steps.entries()) {
    const result = await git(step, index === 0 ? paths.state : paths.pinned, 300_000);
    if (result.status !== 0) {
      log(`git ${step[0]} failed (code ${result.status})`);
      return false;
    }
  }
  if (!(await install(paths.app, log))) {
    log('npm ci failed in the pinned copy');
    return false;
  }
  writeFileSync(readyFile(paths), `${new Date().toISOString()}\n`);
  return true;
}

/**
 * Fetches the branch into the pinned copy. When tools/command-center changed, the copy moves to the new commit.
 * When the lock file changed, the "needs install" marker is set BEFORE the code moves and removed after `npm ci` worked. So an `npm ci` that fails
 * (or a launcher that stops half way) is tried again at the next call, even when the fetch then finds nothing new.
 * @returns {Promise<'same' | 'updated' | 'failed'>} 'updated' also when only the install of an earlier update was caught up: the code on disk is newer than the running server
 */
export async function updateCopy(paths, branch, deps) {
  const { git, log } = deps;
  const caughtUp = await retryInstall(paths, deps);
  if (caughtUp === 'failed') return 'failed';
  const fetched = await git(['fetch', '--depth', '1', 'origin', branch], paths.pinned);
  if (fetched.status !== 0) {
    log(`git fetch failed (code ${fetched.status}); the copy stays as it is`);
    return caughtUp === 'installed' ? 'updated' : 'failed';
  }
  const before = await treeOf(git, paths.pinned, 'HEAD', 'tools/command-center');
  const after = await treeOf(git, paths.pinned, 'FETCH_HEAD', 'tools/command-center');
  if (after === null) {
    log('the fetched commit has no tools/command-center; the copy stays as it is');
    return caughtUp === 'installed' ? 'updated' : 'failed';
  }
  if (before === after) return caughtUp === 'installed' ? 'updated' : 'same';
  const lockBefore = await treeOf(git, paths.pinned, 'HEAD', 'tools/command-center/package-lock.json');
  const lockAfter = await treeOf(git, paths.pinned, 'FETCH_HEAD', 'tools/command-center/package-lock.json');
  const lockChanged = lockBefore !== lockAfter;
  if (lockChanged) writeFileSync(needsInstallFile(paths), `${new Date().toISOString()}\n`);
  const moved = await git(['reset', '--hard', 'FETCH_HEAD'], paths.pinned);
  if (moved.status !== 0) {
    log(`git reset failed (code ${moved.status}); the copy stays as it is`);
    return 'failed';
  }
  log('main changed tools/command-center: the copy was updated');
  if (lockChanged && (await retryInstall(paths, deps)) === 'failed') return 'failed';
  return 'updated';
}

// ---- the run ----

/**
 * Whether the text of a lock file names this launcher: the same process id AND the same start stamp (`started`, written when this launcher began).
 * A process id alone is not enough, because the system can give an old id to a new program. When both the lock and this launcher know the start time
 * of the process (from the system), those must match too. A missing or unreadable lock names nobody.
 * @param {string | null} text
 * @param {number} pid
 * @param {string} startedIso
 * @param {string | null} [launcherStart]
 */
export function lockNamesUs(text, pid, startedIso, launcherStart = null) {
  if (text === null) return false;
  let ids;
  try {
    ids = JSON.parse(text);
  } catch {
    return false;
  }
  if (ids === null || typeof ids !== 'object') return false;
  if (ids.launcher !== pid || ids.started !== startedIso) return false;
  if (typeof ids.launcherStart === 'string' && launcherStart !== null && ids.launcherStart !== launcherStart) return false;
  return true;
}

/**
 * The whole launcher. Returns the exit code.
 * `options.settingsFile` and `options.deps` exist for the tests (a fake settings path, a fake git and installer).
 * `options.manual` is true when a person started it (the tray app): the reporter server then runs with `--no-idle-exit`.
 * @param {{ checkout: string, branch?: string, origin?: string, settingsFile?: string, manual?: boolean, deps?: { git?: Function, install?: Function, supervise?: Function } }} options
 */
export async function runLauncher(options) {
  const checkout = mainCheckout(options.checkout);
  const paths = pathsFor(checkout);
  const branch = options.branch ?? 'main';
  const git = options.deps?.git ?? runGit;
  const install = options.deps?.install ?? npmCi;
  const superviseServer = options.deps?.supervise ?? supervise;
  mkdirSync(paths.state, { recursive: true });
  // A log of more than 1 MB is moved aside, so that it cannot grow without limit.
  try {
    if (statSync(paths.log).size > 1_000_000) renameSync(paths.log, `${paths.log}.old`);
  } catch {
    // no log yet
  }
  const log = (message) => {
    try {
      appendFileSync(paths.log, `${new Date().toISOString()} launcher: ${message}\n`);
    } catch {
      // a log that cannot be written must not stop the reporter
    }
  };

  // 1. The lock. The lock text carries each process id with the START TIME of that process, so that --stop can check that a process is still ours.
  const lock = fileLock(paths.lock);
  const startedIso = new Date().toISOString();
  let serverPid = null;
  let launcherStart = null;
  let serverStart = null;
  let released = false;
  const lockText = () => JSON.stringify({ launcher: process.pid, launcherStart, server: serverPid, serverStart, started: startedIso });
  /** Aborted by the heartbeat when the lock names another launcher. The supervisor listens to it and ends. */
  const lostLock = new AbortController();
  const touch = () => {
    // A late answer must not write a lock file again after the launcher let it go.
    if (released) return;
    // Write only into a lock that still names this launcher. A launcher that slept with the laptop finds its lock taken over by another one, and
    // writing then would replace the other's process ids with its own (--stop would hit the wrong processes, and the other would run unmanaged).
    if (!lockNamesUs(lock.read()?.text ?? null, process.pid, startedIso, launcherStart)) {
      released = true; // from now on this launcher writes nothing and removes nothing
      clearInterval(heartbeat);
      log('the lock now belongs to another launcher (or is gone), so this launcher stops its server and ends');
      lostLock.abort();
      return;
    }
    lock.touch(lockText());
  };
  const got = await acquireLock({ now: Date.now, portInUse: () => portInUse(REPORTER_PORT), read: lock.read, create: lock.create, remove: lock.remove, processInfo }, lockText());
  if (got === 'held') return 0; // another launcher runs: do nothing, and say nothing
  log(`started (process ${process.pid}, branch ${branch})`);
  const heartbeat = setInterval(touch, LOCK_TOUCH_MS);
  const release = () => {
    const lost = released; // true when the lock was lost: it is another launcher's now, and is left alone
    released = true;
    clearInterval(heartbeat);
    if (!lost && lockNamesUs(lock.read()?.text ?? null, process.pid, startedIso, launcherStart)) lock.remove();
  };

  try {
    // 2. The settings file. Without it the server would exit with code 4 at once, so a session start must not fetch the copy every time for nothing.
    // Only the existence is checked here. The launcher never reads the file.
    const settingsFile = options.settingsFile ?? join(homedir(), '.shadow-jog-cc', 'upstash.env');
    if (!existsSync(settingsFile)) {
      log('there is no settings file (~/.shadow-jog-cc/upstash.env), so there is nothing to publish; the pinned copy is not fetched. Make the file (see the README), then start a session again.');
      return EXIT.notConfigured;
    }
    void processInfo(process.pid).then((info) => {
      launcherStart = info?.start ?? null;
      touch();
    });

    // 3. The copy.
    const origin = options.origin ?? (runGitSync(['remote', 'get-url', 'origin'], checkout).stdout.trim() || null);
    if (origin === null) {
      log('the checkout has no remote called origin, so there is nothing to pin');
      return 1;
    }
    if (!(await ensureCopy(paths, origin, branch, { git, install, log }))) return 1;
    if (lostLock.signal.aborted) return 0;
    const updated = await updateCopy(paths, branch, { git, install, log });
    if (lostLock.signal.aborted) return 0;
    // New code with old packages is never started: when a due `npm ci` did not work, stop here. The marker makes the next launch try it again.
    if (needsInstall(paths)) {
      log('the packages are not installed for the code of the pinned copy, so the server is not started');
      return 1;
    }
    if (updated === 'failed') log('the copy could not be updated; the server starts with the copy as it is');

    // 4. The server, kept running until it ends on its own.
    return await superviseServer(
      paths,
      checkout,
      branch,
      log,
      (pid) => {
        serverPid = pid;
        serverStart = null;
        touch();
        if (pid !== null) {
          void processInfo(pid).then((info) => {
            if (serverPid === pid) {
              serverStart = info?.start ?? null;
              touch();
            }
          });
        }
      },
      { update: () => updateCopy(paths, branch, { git, install, log }), install, signal: lostLock.signal, manual: options.manual === true },
    );
  } finally {
    release();
    log('stopped');
  }
}

/**
 * The command line of the reporter server. A reporter that a person started on purpose (`manual`: the tray app) gets `--no-idle-exit`, so it does not
 * end after 30 minutes with no session. A start by the hook keeps the idle exit. Nothing else differs.
 * @param {{ config: string }} paths
 * @param {boolean} [manual]
 */
export function serverArgs(paths, manual = false) {
  return ['--import', 'tsx', 'src/server/main.ts', '--config', paths.config, '--reporter', ...(manual ? ['--no-idle-exit'] : [])];
}

/** The real server process: `--import tsx` runs the TypeScript source as `npm run cc` does. CC_NO_OPEN=1 keeps a browser tab from opening. */
function spawnServer(paths, manual = false) {
  const out = openSync(paths.log, 'a');
  try {
    return spawn(process.execPath, serverArgs(paths, manual), {
      cwd: paths.app,
      env: { ...process.env, CC_NO_OPEN: '1' },
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
  } finally {
    closeSync(out);
  }
}

/**
 * Starts the server, restarts it on a crash or a new main, and returns the exit code that ends the launcher.
 * `deps` exists for the tests: `spawnServer(paths)` gives the child, `update()` is one fetch round, `fetchEveryMs` and `restartDelayMs` are the timings.
 * `deps.signal` ends the supervisor when it is aborted (the heartbeat found that another launcher owns the lock).
 * @returns {Promise<number>}
 */
export function supervise(paths, checkout, branch, log, onServerPid, deps = {}) {
  const spawnChild = deps.spawnServer ?? ((serverPaths) => spawnServer(serverPaths, deps.manual === true));
  const install = deps.install ?? npmCi;
  const update = deps.update ?? (() => updateCopy(paths, branch, { git: runGit, install, log }));
  const fetchEveryMs = deps.fetchEveryMs ?? FETCH_EVERY_MS;
  const restartDelayMs = deps.restartDelayMs ?? 5000;

  return new Promise((done) => {
    let child = null;
    let restarting = false;
    let finished = false;
    let retryTimer = null;
    const crashes = [];

    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearInterval(fetcher);
      if (retryTimer !== null) clearTimeout(retryTimer);
      done(code);
    };

    const writeConfig = () => {
      const original = JSON.parse(readFileSync(join(paths.app, 'command-center.config.json'), 'utf8'));
      writeFileSync(paths.config, JSON.stringify(reporterConfig(original, checkout), null, 2));
    };

    const onExit = (code) => {
      child = null;
      onServerPid(null);
      if (restarting) {
        // The launcher itself ended this process to load new code.
        restarting = false;
        void begin();
        return;
      }
      if (code === EXIT.idle || code === EXIT.public || code === EXIT.notConfigured) {
        log(`server ended with code ${code}${code === EXIT.public ? ' (the page was not protected)' : code === EXIT.notConfigured ? ' (no settings file)' : ' (no session for 30 minutes)'}`);
        finish(code);
        return;
      }
      const now = Date.now();
      crashes.push(now);
      while (crashes.length > 0 && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
      // At most MAX_RESTARTS (3) restarts in 10 minutes: the 4th crash in the window is the one that gives up.
      if (crashes.length > MAX_RESTARTS) {
        log(`server crashed ${crashes.length} times in 10 minutes (last code ${code}); giving up after ${MAX_RESTARTS} restarts`);
        finish(1);
        return;
      }
      log(`server crashed (code ${code}); starting it again in ${Math.round(restartDelayMs / 1000)} seconds`);
      retryTimer = setTimeout(() => void begin(), restartDelayMs);
    };

    const start = () => {
      if (finished) return;
      // This runs in an exit handler too. Anything that throws here must end the launcher cleanly (the lock is released by the caller), never escape.
      try {
        writeConfig();
        child = spawnChild(paths);
      } catch (error) {
        child = null;
        log(`the server could not be started (${error instanceof Error ? error.message : 'unknown error'}); the launcher stops`);
        finish(1);
        return;
      }
      onServerPid(child.pid ?? null);
      log(`server started (process ${child.pid})`);
      child.once('exit', onExit);
    };

    /** Starts the server, after the packages are current. New code is never started with old packages. */
    const begin = async () => {
      if (finished) return;
      try {
        if ((await retryInstall(paths, { install, log })) === 'failed') {
          finish(1);
          return;
        }
      } catch (error) {
        log(`the install check failed (${error instanceof Error ? error.message : 'unknown error'}); the launcher stops`);
        finish(1);
        return;
      }
      start();
    };

    // Every 2 minutes: fetch, and start the server again with the new code when main changed the tool.
    let fetching = false;
    const fetcher = setInterval(async () => {
      if (fetching || finished) return;
      fetching = true;
      try {
        if ((await update()) === 'updated' && child !== null && !restarting) {
          restarting = true;
          let sent = false;
          try {
            sent = child.kill();
          } catch {
            // the process is already gone
          }
          // If the signal did not reach a process, no exit caused by us will come, so the flag must not stay set.
          if (!sent) restarting = false;
        }
      } catch (error) {
        log(`an update round failed (${error instanceof Error ? error.message : 'unknown error'})`);
      } finally {
        fetching = false;
      }
    }, fetchEveryMs);

    const stop = () => {
      if (child !== null) child.kill();
      finish(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // The lock went to another launcher: end the server and return, so that two supervisors never run at once.
    if (deps.signal?.aborted) {
      stop();
      return;
    }
    deps.signal?.addEventListener('abort', stop, { once: true });
    start();
  });
}

// ---- stop ----

/**
 * Removes the `live` key through a short run of the server's own code (`main.ts --clear-live` in the pinned copy), which reads the settings file. The
 * launcher itself never reads that file. Gives a sentence for the log. Best effort and bounded: it is ended after 20 seconds, and nothing waits longer.
 * Without a pinned copy (or without the settings file) there is nothing to run, and nothing is done.
 */
async function clearLiveKey(paths) {
  if (!existsSync(join(paths.app, 'src', 'server', 'main.ts'))) return 'no pinned copy, so the live key was not removed (it expires by itself within 10 minutes)';
  const result = await runCommand(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--clear-live'], { cwd: paths.app, timeout: 20_000 });
  return result.status === 0 ? 'removed the live key' : `the live key was not removed (code ${result.status}); it expires by itself within 10 minutes`;
}

/**
 * Stops the running reporter: the server first, then the launcher. It acts only on a lock that was touched in the last 2 minutes, and only on a process
 * that is verified to be ours: the process id AND the start time in the lock must match what the system says about that id now, and the command line must
 * be the launcher or the server. A number that the system gave to another program since is never killed. When a process cannot be verified, nothing is
 * killed for it, the reason is written to the log, and the lock stays. Nothing is ever killed by name.
 * After a verified server was ended, the live key is removed (`clearLive`): a hard kill (all that Windows has) gives the server no time to remove its own key.
 * `deps` exists for the tests: `processInfo(pid)`, `kill(pid)`, `now()` and `clearLive(paths)`.
 * @returns {Promise<string>} what happened, as a sentence
 */
export async function stopReporter(checkout, deps = {}) {
  const lookup = deps.processInfo ?? processInfo;
  const kill = deps.kill ?? ((pid) => process.kill(pid));
  const now = deps.now ?? Date.now;
  const clear = deps.clearLive ?? clearLiveKey;
  const paths = pathsFor(mainCheckout(checkout));
  const note = (message) => {
    try {
      appendFileSync(paths.log, `${new Date().toISOString()} stop: ${message}\n`);
    } catch {
      // no log to write to
    }
  };
  const lock = fileLock(paths.lock).read();
  if (lock === null) return 'The reporter is not running (no lock file).';
  if (now() - lock.mtimeMs >= LOCK_STALE_MS) return 'The reporter is not running (the lock file is old).';
  let ids;
  try {
    ids = JSON.parse(lock.text);
  } catch {
    note('the lock file is not readable, so nothing was stopped');
    return 'The lock file is not readable, so nothing was stopped.';
  }
  const targets = [
    { name: 'server', pid: ids.server, start: ids.serverStart, ours: (command) => command.includes('--reporter') && command.includes('main.ts') },
    { name: 'launcher', pid: ids.launcher, start: ids.launcherStart, ours: (command) => command.includes('reporter-launch') },
  ];
  const verified = [];
  const refused = [];
  for (const target of targets) {
    if (!Number.isInteger(target.pid) || target.pid <= 0) continue;
    if (target.pid === process.pid) {
      refused.push(`${target.name} (process ${target.pid} is this process)`);
      continue;
    }
    if (typeof target.start !== 'string' || target.start === '') {
      refused.push(`${target.name} (process ${target.pid}): the lock has no start time for it, so it cannot be verified`);
      continue;
    }
    const found = await lookup(target.pid);
    if (found === null) {
      note(`${target.name} (process ${target.pid}) is not running`);
      continue;
    }
    if (found.start !== target.start) {
      refused.push(`${target.name} (process ${target.pid}): it started at ${found.start}, the lock says ${target.start}, so the number belongs to another program now`);
      continue;
    }
    if (!target.ours(found.command)) {
      refused.push(`${target.name} (process ${target.pid}): its command line is not ours`);
      continue;
    }
    verified.push(target);
  }
  for (const target of verified) {
    try {
      kill(target.pid);
      note(`stopped the ${target.name} (process ${target.pid})`);
    } catch {
      note(`the ${target.name} (process ${target.pid}) was already gone`);
    }
  }
  for (const reason of refused) note(`did not stop the ${reason}`);
  // The server could not remove its key itself when it was ended with a hard kill. A second short process does it, bounded by a time limit.
  if (verified.some((target) => target.name === 'server')) {
    try {
      note(await clear(paths));
    } catch {
      note('the live key could not be removed; it expires by itself within 10 minutes');
    }
  }
  if (refused.length > 0) return `The reporter was not fully stopped. Not killed: ${refused.join('; ')}. The lock file stays. See ${paths.log}.`;
  rmSync(paths.lock, { force: true });
  return verified.length > 0 ? 'The reporter was stopped.' : 'The reporter is not running (its processes are gone). The lock file was removed.';
}

// ---- the local Command Center (port 3009), for the tray app ----

/** The page build of the local server: `vite build`, run with the same `node`, so that no `npm` or shell is needed. */
const VITE_BIN = join('node_modules', 'vite', 'bin', 'vite.js');
export const LOCAL_CONFIG = 'local.config.json';
/** The most time that the page build may take. */
export const BUILD_TIMEOUT_MS = 5 * 60_000;

/**
 * The config for the local Command Center that the tray app runs from the pinned copy. The code comes from the pinned copy (origin/main, so a branch switch
 * in the shared checkout cannot break it), and the repo root and the roots point at the REAL checkout, so the docs, the search and the status are
 * those of the working tree. It keeps the port of the config (3009). It is not a reporter run: no `--reporter`, so it publishes nothing.
 * @param {Record<string, any>} original the parsed command-center.config.json of the pinned copy
 * @param {string} checkout the main checkout
 */
export function localConfig(original, checkout) {
  return reporterConfig(original, checkout, original.port);
}

/**
 * Makes the local server ready: writes `.cc-reporter/local.config.json` and builds the page in the pinned copy (what `npm run cc` does first).
 * Gives 0 when ready, 2 when the pinned copy is not ready yet (the tray app waits and asks again), 1 when it failed.
 * `deps.run(command, args, options)` and `deps.log(message)` exist for the tests.
 * @param {string} checkout
 * @param {{ run?: typeof runCommand, log?: (message: string) => void }} [deps]
 * @returns {Promise<number>}
 */
export async function prepareLocal(checkout, deps = {}) {
  const run = deps.run ?? runCommand;
  const main = mainCheckout(checkout);
  const paths = pathsFor(main);
  const log = deps.log ?? ((message) => {
    try {
      appendFileSync(paths.log, `${new Date().toISOString()} local: ${message}\n`);
    } catch {
      // no log to write to
    }
  });
  if (!existsSync(readyFile(paths))) {
    log('the pinned copy is not ready yet');
    return 2;
  }
  try {
    const original = JSON.parse(readFileSync(join(paths.app, 'command-center.config.json'), 'utf8'));
    writeFileSync(join(paths.state, LOCAL_CONFIG), JSON.stringify(localConfig(original, main), null, 2));
  } catch (error) {
    log(`the config could not be written (${error instanceof Error ? error.message : 'unknown error'})`);
    return 1;
  }
  const built = await run(process.execPath, [VITE_BIN, 'build'], { cwd: paths.app, timeout: BUILD_TIMEOUT_MS });
  if (built.status !== 0) {
    log(`the page build failed (code ${built.status}): ${(built.stderr || built.stdout).slice(-500)}`);
    return 1;
  }
  log('ready');
  return 0;
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

// Not `import.meta.main`: it exists only from Node 24.2, and the hook starts this file with whatever `node` is on the PATH (see is-main.mjs).
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const start = readOption(argv, '--repo') ?? process.cwd();
  const checkout = findCheckout(start);
  if (checkout === null) {
    console.error('reporter-launch: this folder is not inside a shadow-jog checkout. Use --repo <folder>.');
    process.exit(1);
  }
  if (argv.includes('--stop')) {
    console.log(await stopReporter(checkout));
    process.exit(0);
  }
  // --prepare-local is for the tray app: it writes the config of the local server and builds its page, then ends.
  if (argv.includes('--prepare-local')) {
    process.exit(await prepareLocal(checkout));
  }
  // --branch and --origin are for testing a branch before it is merged: the pinned copy then follows that branch.
  // --manual: a person started it (the tray app), so the reporter server has no idle exit.
  runLauncher({ checkout, ...(argv.includes('--manual') ? { manual: true } : {}), ...(readOption(argv, '--branch') ? { branch: readOption(argv, '--branch') } : {}), ...(readOption(argv, '--origin') ? { origin: readOption(argv, '--origin') } : {}) }).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`reporter-launch: ${error instanceof Error ? error.message : 'failed'}`);
      process.exit(1);
    },
  );
}
