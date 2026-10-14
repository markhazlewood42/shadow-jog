/**
 * Shared plumbing of the dev server's write endpoints (`vite.config.ts`): read a POST body with a size limit, answer 413 past it, and answer 500 when the handler fails.
 * Node only. It lives here, not in `vite.config.ts`, so a test can run the very code the endpoints use (PR 86 review, round 3, findings 4 and 5).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface BodyOptions {
  /** The most characters a body may have. */
  max: number;
  /** Answer with a status code and a JSON body (the endpoint's own `reply`). */
  reply: (code: number, body: unknown) => void;
  /** The JSON body of the 413 answer. */
  tooBig: unknown;
  /** The JSON body of the 500 answer, from a readable sentence about what failed. */
  failed: (message: string) => unknown;
  /** Runs once the whole body is in and it is not too big. A rejection or a throw is answered 500 (never left unhandled). */
  handle: (body: string) => void | Promise<void>;
}

/**
 * Read the body to its end, then run `handle`. A body over `max` is read to the end and thrown away, and answered 413: never a dropped connection. A failure of `handle`
 * (for example `ssrLoadModule` rejecting while a checked file has a syntax error mid-edit) is answered 500, unless an answer has already gone out.
 */
export function withBody(req: IncomingMessage, res: Pick<ServerResponse, 'headersSent'>, o: BodyOptions): void {
  let body = '';
  let tooBig = false;
  req.on('data', (chunk: Buffer | string) => {
    if (tooBig) return;
    body += chunk.toString();
    if (body.length > o.max) {
      tooBig = true;
      body = '';
    }
  });
  const fail = (e: unknown): void => {
    if (res.headersSent) return;
    o.reply(500, o.failed(e instanceof Error ? e.message : String(e)));
  };
  req.on('error', fail);
  req.on('end', () => {
    if (tooBig) {
      o.reply(413, o.tooBig);
      return;
    }
    try {
      Promise.resolve(o.handle(body)).catch(fail);
    } catch (e) {
      fail(e);
    }
  });
}
