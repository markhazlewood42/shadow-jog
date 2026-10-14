/**
 * Whether a request to one of the dev server's write endpoints came from the dev server's own pages (the editors), not from another site open in the browser.
 * A browser marks a cross-site request (Sec-Fetch-Site) and names the page's origin (Origin), and a page elsewhere could otherwise post to localhost and overwrite
 * project files (Copilot review of main, 2026-10-02). A request with neither (a script, node's fetch) is allowed: it isn't a web page.
 *
 * Node only (`vite.config.ts` and the stage editor's save endpoint import it). It lives here, not in `vite.config.ts`, so a test can run the very check the endpoints use.
 */
import type { IncomingMessage } from 'node:http';

export function sameOrigin(req: Pick<IncomingMessage, 'headers'>): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
