import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiErrorBody } from '../shared/types';

// The guards of the server: who may talk to it, and which requests may write. Together with the
// rule that the server listens on 127.0.0.1 only, they keep another web page in Mark's browser
// from reading from or writing to the command center.

/** The body of an error answer. */
export function apiError(code: string, message: string): ApiErrorBody {
  return { ok: false, error: { code, message } };
}

/**
 * A new secret for one run of the server. It goes into the page the server serves (as
 * `<meta name="cc-token">`), and the page sends it back with every write. A new one is made at
 * each start, so a token from an earlier run is worth nothing.
 */
export function makeToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Answers 403 to any request whose Host header is not this server's own address.
 *
 * Why: in a "DNS rebinding" attack a web page on evil.example makes the browser believe that
 * evil.example is 127.0.0.1, and then the browser lets that page read this server's answers as
 * if they were from the same site. The page cannot hide the name it was reached by: the browser
 * sends it in the Host header. So an exact list of the two names we are really reached by
 * (localhost and 127.0.0.1, with our port) blocks the attack.
 */
export function createHostGuard(port: number): MiddlewareHandler {
  const own = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return async (c, next) => {
    const host = c.req.header('host')?.toLowerCase();
    if (host === undefined || !own.has(host)) {
      return c.json(apiError('forbidden-host', 'This server only answers to localhost and 127.0.0.1 on its own port.'), 403);
    }
    await next();
  };
}

/** The one path that may be written to: Mark's answer to a decision. */
const ANSWER_PATH = /^\/api\/decisions\/\d+\/answer$/;

/**
 * Answers 405 to every method except GET, with one exception: POST to the decision answer path.
 * The server is read-only, so a request that would change something is refused before any route
 * sees it. The `Allow` header of the refusal names the method that the path does take: POST for the
 * answer path, and GET for every other.
 */
export function createMethodGate(): MiddlewareHandler {
  return async (c, next) => {
    const { method, path } = c.req;
    if (method === 'GET' || (method === 'POST' && ANSWER_PATH.test(path))) {
      await next();
      return;
    }
    return c.json(apiError('method-not-allowed', 'This server only reads. The one write is the answer to a decision.'), 405, { Allow: ANSWER_PATH.test(path) ? 'POST' : 'GET' });
  };
}

/** The media type of a Content-Type header, without its parameters, in lower case. */
function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Whether the Origin header names the same site as the Host header. */
function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.host === host;
  } catch {
    return false; // "null" (a sandboxed frame) and anything else that is not a web address
  }
}

function deny(c: Context, status: 403 | 415, code: string, message: string): Response {
  return c.json(apiError(code, message), status);
}

/**
 * The guard for a route that writes. It lets a request through only when all of these hold:
 *
 * 1. It carries the token of this run in the `X-CC-Token` header. A page of this site has the
 *    token (it is in the HTML); a page of another site cannot read it.
 * 2. It does not come from another site. A browser names the site a request came from in the
 *    `Origin` and `Sec-Fetch-Site` headers, and a web page cannot change them. A request with
 *    neither header (a script, not a web page) passes this check and still needs the token.
 * 3. The body is JSON. A plain HTML form can post text or form data to any address without
 *    asking, but it cannot post `application/json`.
 *
 * The checks run in this order, so a request that fails several gets the first one's answer.
 */
export function createWriteGuard(token: string): MiddlewareHandler {
  const expected = Buffer.from(token);
  return async (c, next) => {
    const sent = Buffer.from(c.req.header('x-cc-token') ?? '');
    // timingSafeEqual needs two buffers of the same length, so a different length is refused first.
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
      return deny(c, 403, 'bad-token', 'A write needs the token of this run. Reload the page and try again.');
    }

    const site = c.req.header('sec-fetch-site');
    const origin = c.req.header('origin');
    if ((site !== undefined && site !== 'same-origin') || (origin !== undefined && !sameOrigin(origin, c.req.header('host')))) {
      return deny(c, 403, 'cross-site', 'A write must come from this site.');
    }

    if (mediaType(c.req.header('content-type')) !== 'application/json') {
      return deny(c, 415, 'unsupported-media-type', 'A write must be JSON (Content-Type: application/json).');
    }

    await next();
  };
}
