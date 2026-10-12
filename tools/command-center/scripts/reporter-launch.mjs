// The launcher of the local reporter (design.md section 11.1, "It runs from a pinned copy of origin/main").
// It is plain JavaScript, so that it runs with `node` alone, before any package is installed.
//
// What it does, in order:
//   1. Takes a lock (and checks the port), so that a second launch does nothing.
//   2. Makes or updates a PINNED COPY of origin/main in `<main checkout>/.cc-reporter/pinned` (git-ignored). The copy is its own small clone,
//      so a branch switch in the shared checkout cannot change the code that the reporter runs, and the fetch never moves any ref of the shared checkout.
//   3. Runs the server of the Command Center from the copy, headless (CC_NO_OPEN=1), in reporter mode, on its own port.
//   4. Every 2 minutes it runs `git fetch` in the copy. When main changed anything under tools/command-center/, it updates the copy
//      (and installs the packages again when the lock file changed) and starts the server again.
//   5. When the server exits on its own (30 minutes with no session: code 0; a public page: code 3; no settings file: code 4), it stops too.
//      Any other exit is a crash: it starts the server again, at most 3 times in 10 minutes.
//
// Everything this file writes is under `.cc-reporter/` (the lock, the log, the generated config, the copy). It never touches the settings file with the token.
// The pure parts are exported, so that tests/reporter-launch.test.ts can run them with fakes.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** The reporter's own port. The normal Command Center uses 3009 and the end-to-end tests 3010, so a person can run both. */
export const REPORTER_PORT = 3011;
/** The folder of the reporter inside the main checkout. It is in .gitignore. */
export const STATE_DIR = '.cc-reporter';
/** A lock that was not touched for this long is dead (a crash, or a power cut). The launcher touches it every `LOCK_TOUCH_MS`. */
export const LOCK_STALE_MS = 120_000;
export const LOCK_TOUCH_MS = 30_000;
/** How often the copy is fetched (design.md section 11.1). */
export const FETCH_EVERY_MS = 120_000;
/** The exit codes of the server (src/server/publish/reporter.ts, EXIT). */
export const EXIT = { idle: 0, public: 3, notConfigured: 4 };

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
export function mainCheckout(dir, git = runGit) {
  const result = git(['worktree', 'list', '--porcelain'], dir);
  if (result.status !== 0) return dir;
  const first = result.stdout.split(/\r?\n/).find((line) => line.startsWith('worktree '));
  return first === undefined ? dir : resolve(first.slice('worktree '.length));
}

function runGit(args, cwd, timeout = 60_000) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { status: result.error ? null : result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ---- the lock ----

/**
 * Takes the lock, or says that another launcher holds it. A second launch does nothing.
 * The lock is held when its file was touched in the last 2 minutes, or when something answers on the reporter's port (a launcher that sleeps with the
 * machine has an old lock, but its server still holds the port). Only a lock that is old AND a port that is free is taken over.
 * @param {{ now: () => number, portInUse: () => Promise<boolean>, read: () => { text: string, mtimeMs: number } | null, create: (text: string) => boolean, remove: () => void }} deps
 * @param {string} text what to write into the lock (JSON with the process ids)
 * @returns {Promise<'acquired' | 'held'>}
 */
export async function acquireLock(deps, text) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (deps.create(text)) return 'acquired';
    const lock = deps.read();
    if (lock === null) continue; // it vanished between the two calls: try again
    if (deps.now() - lock.mtimeMs < LOCK_STALE_MS) return 'held';
    if (await deps.portInUse()) return 'held';
    deps.remove();
  }
  return 'held';
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

// ---- the pinned copy ----

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

function npmCi(cwd, log) {
  return new Promise((done) => {
    // `npm` is a .cmd file on Windows, which only a shell can start. The arguments are fixed, so the shell has nothing to misread.
    const child = spawn('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd, shell: process.platform === 'win32', stdio: 'ignore', windowsHide: true });
    child.once('error', (error) => {
      log(`npm ci could not start (${error.code ?? 'error'})`);
      done(false);
    });
    child.once('exit', (code) => done(code === 0));
  });
}

const treeOf = (git, cwd, ref, path) => {
  const result = git(['rev-parse', `${ref}:${path}`], cwd);
  return result.status === 0 ? result.stdout.trim() : null;
};

/**
 * Makes the pinned copy if it is missing. A sparse, shallow clone: only tools/command-center, only the newest commit of the branch.
 * @returns {Promise<boolean>} whether the copy is ready
 */
async function ensureCopy(paths, origin, branch, git, log) {
  if (existsSync(join(paths.pinned, '.git'))) return true;
  log(`making the pinned copy of origin/${branch} (the first run takes a minute or two)`);
  rmSync(paths.pinned, { recursive: true, force: true });
  const steps = [
    ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', branch, origin, paths.pinned],
    ['sparse-checkout', 'set', 'tools/command-center'],
    ['checkout', branch],
  ];
  for (const [index, step] of steps.entries()) {
    const result = git(step, index === 0 ? paths.state : paths.pinned, 300_000);
    if (result.status !== 0) {
      log(`git ${step[0]} failed (code ${result.status})`);
      return false;
    }
  }
  const installed = await npmCi(paths.app, log);
  if (!installed) log('npm ci failed in the pinned copy');
  return installed;
}

/**
 * Fetches the branch into the pinned copy. When tools/command-center changed, the copy moves to the new commit.
 * @returns {Promise<'same' | 'updated' | 'failed'>}
 */
async function updateCopy(paths, branch, git, log) {
  const fetched = git(['fetch', '--depth', '1', 'origin', branch], paths.pinned);
  if (fetched.status !== 0) {
    log(`git fetch failed (code ${fetched.status}); the copy stays as it is`);
    return 'failed';
  }
  const before = treeOf(git, paths.pinned, 'HEAD', 'tools/command-center');
  const after = treeOf(git, paths.pinned, 'FETCH_HEAD', 'tools/command-center');
  if (after === null) {
    log('the fetched commit has no tools/command-center; the copy stays as it is');
    return 'failed';
  }
  if (before === after) return 'same';
  const lockBefore = treeOf(git, paths.pinned, 'HEAD', 'tools/command-center/package-lock.json');
  const lockAfter = treeOf(git, paths.pinned, 'FETCH_HEAD', 'tools/command-center/package-lock.json');
  const moved = git(['reset', '--hard', 'FETCH_HEAD'], paths.pinned);
  if (moved.status !== 0) {
    log(`git reset failed (code ${moved.status}); the copy stays as it is`);
    return 'failed';
  }
  log('main changed tools/command-center: the copy was updated');
  if (lockBefore !== lockAfter && !(await npmCi(paths.app, log))) return 'failed';
  return 'updated';
}

// ---- the run ----

/**
 * The whole launcher. Returns the exit code.
 * @param {{ checkout: string, branch?: string, origin?: string }} options
 */
export async function runLauncher(options) {
  const checkout = mainCheckout(options.checkout);
  const paths = pathsFor(checkout);
  const branch = options.branch ?? 'main';
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

  // 1. The lock.
  const lock = fileLock(paths.lock);
  const startedIso = new Date().toISOString();
  let serverPid = null;
  const lockText = () => JSON.stringify({ launcher: process.pid, server: serverPid, started: startedIso });
  const got = await acquireLock({ now: Date.now, portInUse: () => portInUse(REPORTER_PORT), read: lock.read, create: lock.create, remove: lock.remove }, lockText());
  if (got === 'held') return 0; // another launcher runs: do nothing, and say nothing
  log(`started (process ${process.pid}, branch ${branch})`);
  const heartbeat = setInterval(() => lock.touch(lockText()), LOCK_TOUCH_MS);
  const release = () => {
    clearInterval(heartbeat);
    lock.remove();
  };

  try {
    // 2. The copy.
    const origin = options.origin ?? (runGit(['remote', 'get-url', 'origin'], checkout).stdout.trim() || null);
    if (origin === null) {
      log('the checkout has no remote called origin, so there is nothing to pin');
      return 1;
    }
    if (!(await ensureCopy(paths, origin, branch, runGit, log))) return 1;
    await updateCopy(paths, branch, runGit, log);

    // 3. The server, kept running until it ends on its own.
    return await supervise(paths, checkout, branch, log, (pid) => {
      serverPid = pid;
      lock.touch(lockText());
    });
  } finally {
    release();
    log('stopped');
  }
}

/** Starts the server, restarts it on a crash or a new main, and returns the exit code that ends the launcher. */
function supervise(paths, checkout, branch, log, onServerPid) {
  return new Promise((done) => {
    let child = null;
    let restarting = false;
    const crashes = [];

    const writeConfig = () => {
      const original = JSON.parse(readFileSync(join(paths.app, 'command-center.config.json'), 'utf8'));
      writeFileSync(paths.config, JSON.stringify(reporterConfig(original, checkout), null, 2));
    };

    const start = () => {
      writeConfig();
      const out = openSync(paths.log, 'a');
      // `--import tsx` runs the TypeScript source as `npm run cc` does. CC_NO_OPEN=1 keeps a browser tab from opening.
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--config', paths.config, '--reporter'], {
        cwd: paths.app,
        env: { ...process.env, CC_NO_OPEN: '1' },
        stdio: ['ignore', out, out],
        windowsHide: true,
      });
      closeSync(out);
      onServerPid(child.pid ?? null);
      log(`server started (process ${child.pid})`);
      child.once('exit', (code) => {
        child = null;
        onServerPid(null);
        if (restarting) {
          restarting = false;
          start();
          return;
        }
        if (code === EXIT.idle || code === EXIT.public || code === EXIT.notConfigured) {
          log(`server ended with code ${code}${code === EXIT.public ? ' (the page was not protected)' : code === EXIT.notConfigured ? ' (no settings file)' : ' (no session for 30 minutes)'}`);
          clearInterval(fetcher);
          done(code);
          return;
        }
        const now = Date.now();
        crashes.push(now);
        while (crashes.length > 0 && now - crashes[0] > 600_000) crashes.shift();
        if (crashes.length > 3) {
          log(`server crashed ${crashes.length} times in 10 minutes (last code ${code}); giving up`);
          clearInterval(fetcher);
          done(1);
          return;
        }
        log(`server crashed (code ${code}); starting it again in 5 seconds`);
        setTimeout(start, 5000);
      });
    };

    // Every 2 minutes: fetch, and start the server again with the new code when main changed the tool.
    let fetching = false;
    const fetcher = setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        if ((await updateCopy(paths, branch, runGit, log)) === 'updated' && child !== null) {
          restarting = true;
          child.kill();
        }
      } finally {
        fetching = false;
      }
    }, FETCH_EVERY_MS);

    const stop = () => {
      clearInterval(fetcher);
      if (child !== null) child.kill();
      done(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    start();
  });
}

// ---- stop ----

/**
 * Stops the running reporter: the server first, then the launcher. It acts only on the process ids in a lock that was touched in the last 2 minutes,
 * so a number that the system gave to another program since is never killed.
 * @returns {string} what happened, as a sentence
 */
export function stopReporter(checkout) {
  const paths = pathsFor(mainCheckout(checkout));
  const lock = fileLock(paths.lock).read();
  if (lock === null) return 'The reporter is not running (no lock file).';
  if (Date.now() - lock.mtimeMs >= LOCK_STALE_MS) return 'The reporter is not running (the lock file is old).';
  let ids;
  try {
    ids = JSON.parse(lock.text);
  } catch {
    return 'The lock file is not readable, so nothing was stopped.';
  }
  for (const pid of [ids.server, ids.launcher]) {
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
  }
  rmSync(paths.lock, { force: true });
  return 'The reporter was stopped.';
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const start = readOption(argv, '--repo') ?? process.cwd();
  const checkout = findCheckout(start);
  if (checkout === null) {
    console.error('reporter-launch: this folder is not inside a shadow-jog checkout. Use --repo <folder>.');
    process.exit(1);
  }
  if (argv.includes('--stop')) {
    console.log(stopReporter(checkout));
    process.exit(0);
  }
  // --branch and --origin are for testing a branch before it is merged: the pinned copy then follows that branch.
  runLauncher({ checkout, ...(readOption(argv, '--branch') ? { branch: readOption(argv, '--branch') } : {}), ...(readOption(argv, '--origin') ? { origin: readOption(argv, '--origin') } : {}) }).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`reporter-launch: ${error instanceof Error ? error.message : 'failed'}`);
      process.exit(1);
    },
  );
}
