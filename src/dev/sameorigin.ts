/**
 * Whether a request to one of the dev server's write endpoints came from the dev server's own pages (the editors), not from another site open in the browser.
 * A browser marks a cross-site request (Sec-Fetch-Site) and names the page's origin (Origin), and a page elsewhere could otherwise post to localhost and overwrite
 * project files (Copilot review of main, 2026-10-02). A request with neither (a script, node's fetch) is allowed: it isn't a web page.
 *
 * The Host header is checked too (PR 86 review, R1-1). A DNS-rebinding page (evil.com rebound to 127.0.0.1) is same-origin in the browser's eyes: its Origin and its Host both
 * say evil.com, and Sec-Fetch-Site says same-origin. So the Host must also be this machine (`localhost`, `127.0.0.1` or `[::1]`, any port).
 * There is no "must carry an Origin" rule: local tools and tests post without one, and a local process is trusted.
 *
 * Node only (`vite.config.ts` and the stage editor's save endpoint import it). It lives here, not in `vite.config.ts`, so a test can run the very check the endpoints use.
 */
import type { IncomingMessage } from 'node:http';

/** The host names that mean this machine. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a Host header (or an Origin's host) names this machine, on any port. */
function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // A Host is `name[:port]` and nothing else. `new URL` would read `localhost/x` or `localhost@evil.com` as a host plus a path or user, so refuse those characters first.
  if (/[/\\?#@\s]/.test(hostHeader)) return false;
  try {
    return LOCAL_HOSTS.has(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

export function sameOrigin(req: Pick<IncomingMessage, 'headers'>): boolean {
  if (!isLocalHost(req.headers.host)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  // No Origin (and no cross-site Sec-Fetch-Site): not a web page, so allowed. Main's check in vite.config.ts did the same; scripts, curl and the tests rely on it.
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Whether a request is a dry run: the query has `dry=1` and nothing else counts (`dry=0`, `dry=10`, `dry=true` and a bare `dry` write for real).
 * One helper for every write endpoint (PR 86 review, R2-2); they used to read the flag three different ways.
 */
export function isDry(url: string | undefined): boolean {
  try {
    return new URL(url ?? '/', 'http://localhost').searchParams.get('dry') === '1';
  } catch {
    return false; // a request line that is not an address is no dry run (the stage endpoint answers 400 for it first)
  }
}
