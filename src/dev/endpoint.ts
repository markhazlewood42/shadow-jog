/**
 * Shared plumbing of the dev server's write endpoints (`vite.config.ts`): read a POST body with a size limit, answer 413 past it, and answer 500 when the handler fails.
 * Node only. It lives here, not in `vite.config.ts`, so a test can run the very code the endpoints use (PR 86 review, round 3, findings 4 and 5; round 4, findings 2 to 4).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface BodyOptions {
  /** The most bytes a body may have. */
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
 * Read the body to its end, then run `handle`. The chunks are kept as Buffers, counted in bytes, and decoded once at the end, so a multibyte character split across two chunks stays whole.
 * A body over `max` is answered 413 at once and no more of it is read, as the stage endpoint does (`serve.ts`): the request is paused, the connection is marked `Connection: close`, and the
 * request is destroyed a moment after the answer has gone out (destroying at once would reset the connection before a client that is still sending has read the 413).
 * A failure of `handle` (for example `ssrLoadModule` rejecting while a checked file has a syntax error mid-edit) is answered 500, unless an answer has already gone out.
 */
export function withBody(req: IncomingMessage, res: Pick<ServerResponse, 'headersSent' | 'setHeader' | 'once'>, o: BodyOptions): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (chunk: Buffer | string) => {
    if (tooBig) return;
    const part = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += part.length;
    if (size > o.max) {
      tooBig = true;
      chunks.length = 0;
      req.pause();
      res.setHeader('Connection', 'close'); // the connection is not reused: the timer below would otherwise cut the next request that rides on it
      res.once('finish', () => setTimeout(() => req.destroy(), 250).unref());
      o.reply(413, o.tooBig);
      return;
    }
    chunks.push(part);
  });
  const fail = (e: unknown): void => {
    if (res.headersSent) return;
    o.reply(500, o.failed(e instanceof Error ? e.message : String(e)));
  };
  req.on('error', fail);
  req.on('end', () => {
    if (tooBig) return; // already answered 413 above
    try {
      Promise.resolve(o.handle(Buffer.concat(chunks).toString('utf8'))).catch(fail);
    } catch (e) {
      fail(e);
    }
  });
}
