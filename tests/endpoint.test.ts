/**
 * `withBody` (src/dev/endpoint.ts), the body reading and failure handling that the FX lab and the animation editor save endpoints share (PR 86 review, round 3, findings 4 and 5).
 * A real HTTP server runs the very function the endpoints use; `vite.config.ts` only wires it to a path.
 */
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BodyOptions, withBody } from '../src/dev/endpoint';

const MAX = 1000;
let server: Server;
let port: number;
/** What the handler of the next request does. */
let handle: BodyOptions['handle'];
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const reply = (code: number, body: unknown): void => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    withBody(req, res, {
      max: MAX,
      reply,
      tooBig: { ok: false, problem: 'too big' },
      failed: (message) => ({ ok: false, problem: `could not check: ${message}` }),
      handle: async (body) => {
        seen.push(body);
        await handle(body);
        reply(200, { ok: true });
      },
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

function post(text: string): Promise<{ status: number; body: { ok: boolean; problem?: string } }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } }, (res) => {
      let out = '';
      res.on('data', (c: Buffer) => (out += c.toString()));
      res.on('end', () => done({ status: res.statusCode ?? 0, body: JSON.parse(out) }));
    });
    req.on('error', fail);
    req.end(text);
  });
}

describe('withBody', () => {
  it('a body over the limit gets 413 (not a dropped connection), and the handler never sees it', async () => {
    seen.length = 0;
    handle = () => {};
    const r = await post('x'.repeat(MAX + 1));
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ ok: false, problem: 'too big' });
    expect(seen).toEqual([]);
  });

  it('control: a body at the limit reaches the handler whole', async () => {
    seen.length = 0;
    handle = () => {};
    const text = 'y'.repeat(MAX);
    expect((await post(text)).status).toBe(200);
    expect(seen).toEqual([text]);
  });

  it('a handler that rejects (ssrLoadModule on a file with a syntax error) is answered 500 with its message, not left unhandled', async () => {
    handle = async () => {
      await Promise.resolve();
      throw new Error('Transform failed: syntax error');
    };
    const r = await post('{}');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ ok: false, problem: 'could not check: Transform failed: syntax error' });
  });

  it('a handler that throws at once is answered 500 too', async () => {
    handle = () => {
      throw new Error('boom');
    };
    const r = await post('{}');
    expect(r.status).toBe(500);
    expect(r.body.problem).toBe('could not check: boom');
  });

  it('a multibyte character split across two chunks stays whole (the chunks are decoded once, not one by one)', async () => {
    seen.length = 0;
    handle = () => {};
    const bytes = Buffer.from('{"t":"it’s"}', 'utf8'); // a curly apostrophe is 3 bytes
    const cut = bytes.indexOf(0xe2) + 1; // inside the character
    const r = await new Promise<number>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/' }, (res) => {
        res.resume();
        res.on('end', () => done(res.statusCode ?? 0));
      });
      req.on('error', fail);
      req.write(bytes.subarray(0, cut));
      setTimeout(() => req.end(bytes.subarray(cut)), 50);
    });
    expect(r).toBe(200);
    expect(seen).toEqual(['{"t":"it’s"}']);
  });

  it('the limit counts bytes, not characters', async () => {
    seen.length = 0;
    handle = () => {};
    const text = '€'.repeat(400); // 400 characters, 1,200 bytes
    expect(text.length).toBeLessThan(MAX);
    expect((await post(text)).status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('past the limit the answer goes out at once, with Connection: close, while the client is still sending', async () => {
    seen.length = 0;
    handle = () => {};
    const got = await new Promise<{ status: number; connection: string | undefined }>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/' }, (res) => {
        res.resume();
        done({ status: res.statusCode ?? 0, connection: res.headers.connection });
        req.destroy();
      });
      req.on('error', () => {}); // destroyed on purpose once the answer is in
      // The request is never ended: only an answer given before the end of the body can arrive.
      req.write('z'.repeat(MAX + 1));
      setTimeout(() => fail(new Error('no answer while the body was still being sent')), 4000).unref();
    });
    expect(got).toEqual({ status: 413, connection: 'close' });
    expect(seen).toEqual([]);
  });
});
