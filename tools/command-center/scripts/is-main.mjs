// "Is this file the program that was started?" for Node versions that have no `import.meta.main` (it came in Node 24.2; the hook runs with whatever
// `node` is on the PATH of Claude Code, and on Node 22 `import.meta.main` is undefined, so a guard written with it silently does nothing).
//
// The check: the real path of `process.argv[1]` (the file that `node` was asked to run) equals the real path of the file that asks. The real path
// (after symlinks) matters on this machine, where a checkout can be reached through a link, and the case is folded on Windows, where paths are not
// case-sensitive. A file that cannot be resolved (no argv[1], a missing file) is "not main", so an import from a test never runs the program.
//
// Use: `if (isMainModule(import.meta.url)) { ... }`

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The path in one comparable form: real, absolute, and lower case on Windows. */
function comparable(path, platform) {
  const real = realpathSync(path);
  return platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * True when `metaUrl` (the `import.meta.url` of the caller) is the file that `node` started.
 * `argv1` and `platform` are parameters for the tests; the defaults are the real process.
 */
export function isMainModule(metaUrl, argv1 = process.argv[1], platform = process.platform) {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try {
    return comparable(argv1, platform) === comparable(fileURLToPath(metaUrl), platform);
  } catch {
    return false;
  }
}
