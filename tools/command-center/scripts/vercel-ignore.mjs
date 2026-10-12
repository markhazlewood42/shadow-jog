// The Ignored Build Step of the Command Center's Vercel project (design.md sections 4.3 and 11.3).
// vercel.json sets `"ignoreCommand": "node scripts/vercel-ignore.mjs"`. Vercel runs it from the project root directory (tools/command-center), and uses the exit code:
//   exit 0 = skip the build,   exit 1 = run the build.
// Rule: build only when the branch is `main` AND something under tools/command-center/ changed in the last commit.
// Root-directory caveat: the diff path is `.` (the project root), not `tools/command-center`, because git resolves a pathspec from the working folder.
// If the diff cannot be made (a shallow clone without HEAD^, no git), the answer is "build": a wasted build is better than a missed deploy.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * The decision, as a pure function.
 * @param {{ branch: string | undefined, changed: boolean | null }} input `changed` is true when the project folder changed, false when it did not, null when unknown.
 * @returns {{ build: boolean, reason: string }}
 */
export function decide({ branch, changed }) {
  if (branch !== 'main') return { build: false, reason: `branch is "${branch ?? ''}", not main: skip` };
  if (changed === false) return { build: false, reason: 'no change under the project folder: skip' };
  if (changed === null) return { build: true, reason: 'the change could not be determined: build' };
  return { build: true, reason: 'main changed the project folder: build' };
}

/** What `git diff --quiet HEAD^ HEAD -- .` said: status 0 = no change, 1 = a change, anything else (or no status) = unknown. */
export function changedFromDiffStatus(status) {
  if (status === 0) return false;
  if (status === 1) return true;
  return null;
}

/** The exit code for a decision: 0 skips the build, 1 runs it. */
export const exitCodeOf = (decision) => (decision.build ? 1 : 0);

function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  // Git is only asked when the branch is main: any other branch is skipped without it.
  let changed = null;
  if (branch === 'main') {
    const run = spawnSync('git', ['diff', '--quiet', 'HEAD^', 'HEAD', '--', '.'], { stdio: 'ignore' });
    changed = run.error === undefined && run.status !== null ? changedFromDiffStatus(run.status) : null;
  }
  const decision = decide({ branch, changed });
  console.log(`vercel-ignore: ${decision.reason}`);
  process.exit(exitCodeOf(decision));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
