import { firstLine } from '../first-line';

// What went wrong with a gh call, named. The runner hands back a program's exit code and what it
// printed on stderr; a person needs to know which of the usual causes it is, and what to do. Any
// module that calls gh uses this (the GitHub module, and the decisions module that follows it).

export type GhErrorCode = 'gh-not-signed-in' | 'gh-missing' | 'gh-offline' | 'gh-timeout' | 'gh-failed';

/** A failure of gh: a short word to test for, and a sentence for a person. */
export type GhError = { code: GhErrorCode; message: string };

/** gh asks to sign in, or GitHub refuses the token. (`gh auth login` is in the hint of every one of gh's own sign-in errors.) */
const NOT_SIGNED_IN = /gh auth login|not logged in|authentication required|HTTP 401|bad credentials/i;

/** gh's own words for a network that does not work, and the words of the network layer under it (Go's and Windows'). */
const OFFLINE =
  /error connecting to|could not resolve host|no such host|dial tcp|network is unreachable|no route to host|connection (?:refused|reset)|i\/o timeout|tls handshake timeout|check your internet connection|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i;

/** A shell's words for a program that does not exist (the runner reports that as the code 127 as well). */
const MISSING = /command not found|is not recognized as an internal or external command/i;

/**
 * Names the failure of a gh call from its exit code and its stderr.
 *
 * - `gh-missing`: gh is not installed. The runner reports that as code 127.
 * - `gh-timeout`: gh ran past its time limit. The runner reports that as code 124.
 * - `gh-not-signed-in`: gh has no login, or GitHub does not accept it.
 * - `gh-offline`: GitHub cannot be reached.
 * - `gh-failed`: anything else; the message has the first line of what gh said.
 *
 * "Could not resolve to a Repository" (GitHub does not know the repo) is a failure of its own, not a
 * network problem: the network patterns need the word "host".
 */
export function classifyGhError(code: number, stderr: string): GhError {
  if (code === 127 || MISSING.test(stderr)) {
    return { code: 'gh-missing', message: 'The gh command is not installed (or it is not on the PATH), so GitHub cannot be read. Install the GitHub CLI from https://cli.github.com and run "gh auth login", then press Retry.' };
  }
  if (code === 124) return { code: 'gh-timeout', message: 'gh did not answer in time. GitHub may be slow. Press Retry.' };
  if (code === 4 || NOT_SIGNED_IN.test(stderr)) {
    return { code: 'gh-not-signed-in', message: 'gh is not signed in to GitHub. Run "gh auth login" in a terminal, then press Retry.' };
  }
  if (OFFLINE.test(stderr)) return { code: 'gh-offline', message: 'GitHub cannot be reached. Check the internet connection, then press Retry.' };
  const said = firstLine(stderr);
  return { code: 'gh-failed', message: said === '' ? `gh failed with exit code ${code}.` : `gh failed: ${said}` };
}
