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
 * How a request names the dry flag: `'real'` (no `dry` key), `'dry'` (one `dry=1`), `'off'` (one `dry=0`), or `'invalid'` (any other form: a bare `dry`, `dry=true`, `dry=%zz`, `DRY=1`, two `dry` keys, an address that cannot be read).
 * The key is matched without regard to case, so `DRY=1` is read as a dry flag with a bad spelling, not as no flag.
 */
export function dryFlag(url: string | undefined): 'real' | 'dry' | 'off' | 'invalid' {
  try {
    const hits = [...new URL(url ?? '/', 'http://localhost').searchParams].filter(([k]) => k.toLowerCase() === 'dry');
    if (hits.length === 0) return 'real';
    const only = hits[0];
    if (hits.length > 1 || !only || only[0] !== 'dry') return 'invalid';
    return only[1] === '1' ? 'dry' : only[1] === '0' ? 'off' : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * Whether a request is a dry run. It fails closed: `dry=1` is dry, and so is any flag that is not exactly `dry=0` or no flag at all (see `dryFlag`), so a flag that is spelled wrong never writes.
 * A write endpoint that wants to refuse a bad flag (the stage endpoint answers 400) asks `dryFlag` first. One helper for every write endpoint (PR 86 review, R2-2).
 */
export function isDry(url: string | undefined): boolean {
  const flag = dryFlag(url);
  return flag === 'dry' || flag === 'invalid';
}
