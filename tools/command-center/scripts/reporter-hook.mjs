// The SessionStart hook of Claude Code that keeps the local reporter running (design.md section 11.1).
// Claude Code starts it at the start of every session and gives it a JSON line on stdin, with the working folder of the session in `cwd`.
//
// The rules of this file:
//   - It acts only when `cwd` is inside a shadow-jog checkout or worktree. In any other folder (home-base, say) it does nothing.
//   - It starts the launcher DETACHED and returns at once. A timer ends the process after 800 ms in every case, so a session never waits for it.
//   - It never fails a session: every error is caught, it prints nothing (the stdout of a SessionStart hook goes into the session), and it always exits 0.
//   - The launcher does the real work, and takes a lock, so a second launch does nothing.
//
// It also works by hand: `node tools/command-center/scripts/reporter-hook.mjs` in a shadow-jog folder starts the reporter in the background.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findCheckout } from './reporter-launch.mjs';

/** The most time the hook may take. The session is not slowed by more than this. */
export const BUDGET_MS = 800;

/** Reads the JSON that Claude Code sends. It gives back {} when there is none, when it is not JSON, or when it takes more than 300 ms. */
function readPayload(stream) {
  return new Promise((done) => {
    if (stream.isTTY) return done({});
    let text = '';
    const finish = () => {
      try {
        done(JSON.parse(text));
      } catch {
        done({});
      }
    };
    const timer = setTimeout(finish, 300);
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      text += chunk;
    });
    stream.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    stream.on('error', () => {
      clearTimeout(timer);
      done({});
    });
  });
}

/**
 * The decision, with the world passed in so that a test needs no real checkout or process.
 * @returns {'started' | 'not-shadow-jog' | 'no-launcher'}
 */
export function startReporter({ cwd, launcher, exists = existsSync, start }) {
  const checkout = typeof cwd === 'string' && cwd !== '' ? findCheckout(cwd, exists) : null;
  if (checkout === null) return 'not-shadow-jog';
  if (!exists(launcher)) return 'no-launcher';
  start(launcher, checkout);
  return 'started';
}

/** Starts the launcher as its own process: detached, no input and no output, not waited for. */
function detach(launcher, checkout) {
  const child = spawn(process.execPath, [launcher, '--repo', checkout], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

async function main() {
  // The timer is the promise that the hook is quick: whatever happens below, the process ends.
  setTimeout(() => process.exit(0), BUDGET_MS);
  try {
    const payload = await readPayload(process.stdin);
    // CC_REPORTER_LAUNCHER is for the tests, which point it at a stub. Real runs use the launcher that sits next to this file.
    const launcher = process.env.CC_REPORTER_LAUNCHER || join(import.meta.dirname, 'reporter-launch.mjs');
    startReporter({ cwd: payload.cwd ?? process.cwd(), launcher, start: detach });
  } catch {
    // Never fail a session.
  }
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
