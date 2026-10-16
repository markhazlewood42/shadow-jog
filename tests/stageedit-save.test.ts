/**
 * ET pass line 7: the stage editor's save path is safe (docs/engine/et-brief.md section 4, task 4).
 *
 * The test starts a real HTTP server with the very handlers `vite.config.ts` mounts at `/__stage/stages` and `/__stage/hud` (`src/dev/stageedit/serve.ts`) and the real
 * `prepareSave`, and sends it real requests. It checks: a cross-site POST gets 403, bad data gets 400, one Save writes all its files or none, only the 640 set is
 * written, a path is never taken from a request, and `?dry=1` from the dev server's own page gets 200 and writes nothing.
 *
 * THE DATA FOLDER. The handlers are given a folder to treat as `src/data`: a private copy of the frozen fixtures (`tests/fixtures/stagedata/`) made under
 * `tests/fixtures/stagedata/.scratch/` (git-ignored) and removed at the end. Nothing here can touch `src/data`: the test seam is the `dataDir` option of `stageHandlers`.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, request, type Server } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StageEntry } from '../src/battlestage/config';
import { dryFlag, isDry, sameOrigin } from '../src/dev/sameorigin';
import { SET_SCREEN, prepareSave } from '../src/dev/stageedit/save';
import { MAX_BODY, PART_FILES, stageHandlers } from '../src/dev/stageedit/serve';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/stagedata');
const SCRATCH_ROOT = join(FIXTURES, '.scratch');
const read = (file: string): string => readFileSync(join(FIXTURES, file), 'utf8');

let work: string;
let dataDir: string;
let scratchDir: string;
let server: Server;
let port: number;

/** Every file name in the data folder with the hash of its text: "nothing was written" is "this map is equal". */
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).map((name) => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]));
}

beforeAll(async () => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  work = mkdtempSync(join(SCRATCH_ROOT, 'unit-'));
  dataDir = join(work, 'data');
  scratchDir = join(work, 'scratch');
  const handlers = stageHandlers({ dataDir, scratchRoot: scratchDir, prepare: prepareSave, screen: SET_SCREEN });
  server = createServer((req, res) => {
    req.on('data', (c: Buffer) => (bodyBytesSeen += c.length));
    // Like Connect's `server.middlewares.use(prefix, handler)` (vite.config.ts): a prefix mount on a path-segment boundary, and the handler sees the url WITHOUT the prefix.
    const mounted = (prefix: string): boolean => {
      const url = req.url ?? '';
      if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) return false;
      const rest = url.slice(prefix.length);
      req.url = rest.startsWith('/') ? rest : `/${rest}`;
      return true;
    };
    if (mounted('/__stage/stages')) handlers.stages(req, res);
    else if (mounted('/__stage/hud')) handlers.hud(req, res);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(work, { recursive: true, force: true });
});

/** The data folder at the start of each test: the 640 fixtures under their real names, and two 480 files that must never change. */
beforeEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  copyFileSync(join(FIXTURES, 'stages-640.json'), join(dataDir, 'stages-640.json'));
  copyFileSync(join(FIXTURES, 'hud-640.json'), join(dataDir, 'hud-640.json'));
  for (const f of ['axes.json', 'enemyfacing.json', 'heroes.json']) copyFileSync(join(FIXTURES, f), join(dataDir, f));
  // The frozen 480 set: sentinels. A Save must leave them as they are.
  writeFileSync(join(dataDir, 'stages.json'), '{"sentinel":"480 stages"}\n');
  writeFileSync(join(dataDir, 'hud.json'), '{"sentinel":"480 hud"}\n');
});

interface Answer {
  status: number;
  body: { ok: boolean; problems: string[]; written?: string[]; wouldWrite?: string[]; file?: string; dry?: boolean; stages?: string; hud?: string; axes?: string; facing?: string; heroes?: string };
}

/** One request, with the headers a browser would (or would not) send. */
function send(method: string, path: string, body?: string | Buffer, headers: IncomingHttpHeaders = {}): Promise<Answer> {
  return new Promise((resolveAnswer, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolveAnswer({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Answer['body'] }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const SAME = { 'sec-fetch-site': 'same-origin' } as const;
/** A Save body that changes nothing about the set: the files as they are. */
function body(over: Record<string, unknown> = {}): string {
  const layout = (JSON.parse(read('hud-640.json')) as { layout: unknown }).layout;
  return JSON.stringify({ stages: JSON.parse(read('stages-640.json')), axes: JSON.parse(read('axes.json')), hud: layout, facing: JSON.parse(read('enemyfacing.json')), heroes: JSON.parse(read('heroes.json')), ...over });
}
/** Bytes of request body the test server's handlers have taken in (a 413 must stop this from growing). */
let bodyBytesSeen = 0;
const post = (path: string, text: string, headers: IncomingHttpHeaders = SAME): Promise<Answer> => send('POST', path, text, headers);

describe('reading', () => {
  it('GET returns the 640 files as text, and the HUD on its own address', async () => {
    const files = await send('GET', '/__stage/stages');
    expect(files.status).toBe(200);
    expect(files.body.stages).toBe(read('stages-640.json'));
    expect(files.body.axes).toBe(read('axes.json'));
    const hud = await send('GET', '/__stage/hud');
    expect(hud.body.hud).toBe(read('hud-640.json'));
  });

  it('a POST to /__stage/hud is refused (405) and points at the stages endpoint; nothing is written', async () => {
    const before = snapshot(dataDir);
    const r = await post('/__stage/hud', body());
    expect(r.status).toBe(405);
    expect(r.body.problems.join(' ')).toMatch(/__stage\/stages/);
    expect(snapshot(dataDir)).toEqual(before);
  });

  it('a sub-path of an endpoint is a 404 (the mount is a prefix): nothing is read or written', async () => {
    const before = snapshot(dataDir);
    for (const path of ['/__stage/stages/anything', '/__stage/stages/x/y?scratch=a', '/__stage/hud/anything', '/__stage/stages//evil.com', '/__stage/stages/\\evil.com', '/__stage/hud//evil.com', '/__stage/hud/\\evil.com']) {
      expect((await send('GET', path)).status, `GET ${path}`).toBe(404);
    }
    // `//x` and `/\x` reach the handler as they are: the URL parser reads them as a host plus the path `/`, so only the raw path may be compared (F1).
    for (const path of ['/__stage/stages/anything', '/__stage/stages/anything?dry=1', '/__stage/stages//evil.com', '/__stage/stages/\\evil.com', '/__stage/stages//evil.com?dry=0']) {
      expect((await post(path, body())).status, `POST ${path}`).toBe(404);
    }
    expect(snapshot(dataDir)).toEqual(before);
    // Control: the endpoint itself, with and without a query, still answers.
    expect((await send('GET', '/__stage/stages')).status).toBe(200);
    expect((await send('GET', '/__stage/stages?x=1')).status).toBe(200);
  });

  it('a request line that is not an address gets 400 and the server stays up (ET follow-up 3)', async () => {
    // `//` is a path that `new URL('//', base)` refuses to read: it used to throw out of the handler and end the dev server.
    const raw = (line: string): Promise<string> =>
      new Promise((resolveText, reject) => {
        const socket = connect(port, '127.0.0.1', () => socket.write(`${line} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
        const parts: Buffer[] = [];
        socket.on('data', (c: Buffer) => parts.push(c));
        socket.on('end', () => resolveText(Buffer.concat(parts).toString('utf8')));
        socket.on('error', reject);
      });
    const before = snapshot(dataDir);
    for (const path of ['/__stage/stages//', '/__stage/hud//']) {
      for (const method of ['GET', 'POST']) expect((await raw(`${method} ${path}`)).split('\r\n')[0], `${method} ${path}`).toBe('HTTP/1.1 400 Bad Request');
    }
    expect(snapshot(dataDir)).toEqual(before);
    // The server is still there: a good request is answered.
    expect((await send('GET', '/__stage/stages')).status).toBe(200);
    // isDry fails closed: a bad address is read as a dry run, so it never writes (and does not throw).
    expect(isDry('//')).toBe(true);
  });

  it('PUT and DELETE are 405', async () => {
    expect((await send('PUT', '/__stage/stages', body(), SAME)).status).toBe(405);
    expect((await send('DELETE', '/__stage/stages', undefined, SAME)).status).toBe(405);
  });
});

describe('a cross-site POST gets 403 and writes nothing', () => {
  it.each([
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site: same-site', { 'sec-fetch-site': 'same-site' }],
    ['an Origin on another host', { origin: 'http://evil.example' }],
    ['a look-alike Origin (the right host as a prefix)', { origin: 'http://127.0.0.1.evil.example' }],
    ['a look-alike Origin (another port)', { origin: 'http://127.0.0.1:1' }],
    ['an Origin that is not a URL', { origin: 'not a url' }],
    ['Sec-Fetch-Site same-origin but an Origin on another host', { 'sec-fetch-site': 'same-origin', origin: 'http://evil.example' }],
  ])('%s', async (_name, headers) => {
    const before = snapshot(dataDir);
    const r = await post('/__stage/stages', body(), headers as IncomingHttpHeaders);
    expect(r.status).toBe(403);
    const dry = await post('/__stage/stages?dry=1', body(), headers as IncomingHttpHeaders);
    expect(dry.status).toBe(403);
    expect(snapshot(dataDir)).toEqual(before);
  });

  it('control: the same request from the dev server’s own page (same-origin, and its own Origin) is accepted', async () => {
    const r = await post('/__stage/stages?dry=1', body(), { 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` });
    expect(r.status).toBe(200);
  });
});

describe('the Host header (DNS rebinding): a page rebound to 127.0.0.1 is same-origin to the browser, so the Host must name this machine', () => {
  const hostHeaders = (host: string, origin = `http://${host}`): IncomingHttpHeaders => ({ host, origin, 'sec-fetch-site': 'same-origin' });

  it('a foreign Host is 403 and writes nothing, even with a matching Origin and Sec-Fetch-Site: same-origin (dry or not)', async () => {
    const before = snapshot(dataDir);
    for (const host of ['evil.com:3007', 'evil.com', '127.0.0.1.evil.com:3007', 'localhost.evil.com:3007', '10.0.0.5:3007']) {
      for (const path of ['/__stage/stages', '/__stage/stages?dry=1']) {
        const r = await post(path, body(), hostHeaders(host));
        expect(r.status, `${host} ${path}`).toBe(403);
      }
    }
    expect(snapshot(dataDir)).toEqual(before);
  });

  it('control: Host localhost, 127.0.0.1 and [::1] (any port) with the matching Origin gets through; so does a request with no Origin', async () => {
    for (const host of ['localhost:3007', 'localhost', '127.0.0.1:3007', '[::1]:3007']) {
      const r = await post('/__stage/stages?dry=1', body(), hostHeaders(host));
      expect(r.status, host).toBe(200);
    }
    expect((await post('/__stage/stages?dry=1', body(), { host: 'localhost:3007' })).status).toBe(200);
  });

  it('sameOrigin directly: the same pair of requests differs only in the Host', () => {
    expect(sameOrigin({ headers: { host: 'evil.com:3007', origin: 'http://evil.com:3007', 'sec-fetch-site': 'same-origin' } })).toBe(false);
    expect(sameOrigin({ headers: { host: 'localhost:3007', origin: 'http://localhost:3007', 'sec-fetch-site': 'same-origin' } })).toBe(true);
    expect(sameOrigin({ headers: {} })).toBe(false); // no Host at all
    // A Host with a path, user or query is not a Host a browser sends; it must not parse as local.
    for (const host of ['localhost/x', 'localhost:3007/x', 'localhost@evil.com', 'evil.com@localhost', 'localhost?x', 'localhost#x', 'localhost\\x','localhost x']) {
      expect(sameOrigin({ headers: { host, 'sec-fetch-site': 'same-origin' } }), host).toBe(false);
    }
  });
});

describe('the dry flag is read one way: only dry=1 is dry (isDry)', () => {
  it('isDry fails closed: dry=1 and every malformed flag are dry; only no flag and dry=0 write (dryFlag names which)', () => {
    expect(isDry('/x?dry=1')).toBe(true);
    expect(isDry('/x?scratch=a&dry=1')).toBe(true);
    for (const u of ['/x?dry=0', '/x?xdry=1', '/x', undefined]) expect(isDry(u), String(u)).toBe(false);
    for (const u of ['/x?dry=10', '/x?dry=true', '/x?dry=', '/x?dry', '/x?dry=%zz', '/x?DRY=1', '/x?Dry=0', '/x?dry=0&dry=1', '/x?dry=1&dry=1', '//']) expect(isDry(u), u).toBe(true);
    expect(dryFlag('/x?dry=0')).toBe('off');
    expect(dryFlag('/x?dry=%zz')).toBe('invalid');
    expect(dryFlag('/x')).toBe('real');
  });

  it('the stage endpoint writes for ?dry=0 and for no flag (control: ?dry=1 still writes nothing)', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 22, row: 2 };
    const before = snapshot(dataDir);
    expect((await post('/__stage/stages?dry=1', body({ stages }))).status).toBe(200);
    expect(snapshot(dataDir)).toEqual(before);
    for (const q of ['?dry=0', '']) {
      const r = await post(`/__stage/stages${q}`, body({ stages }));
      expect(r.status, q).toBe(200);
      expect(r.body.dry, q).toBe(false);
      expect(readFileSync(join(dataDir, 'stages-640.json'), 'utf8'), q).toContain('"x": 22');
      writeFileSync(join(dataDir, 'stages-640.json'), read('stages-640.json'));
    }
  });

  it('F2: a malformed dry flag is a 400 and writes nothing (dry=%zz, DRY=1, dry=true, dry=10, a bare dry, dry=0&dry=1)', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 23, row: 2 };
    const before = snapshot(dataDir);
    for (const q of ['?dry=%zz', '?DRY=1', '?dry=true', '?dry=10', '?dry', '?dry=', '?dry=0&dry=1', '?dry=1&dry=1']) {
      const r = await post(`/__stage/stages${q}`, body({ stages }));
      expect(r.status, q).toBe(400);
      expect(r.body.problems.join(' '), q).toMatch(/dry must be 0 or 1/);
      expect(snapshot(dataDir), q).toEqual(before);
    }
  });
});

describe('F3: the body must be sent as application/json', () => {
  it('text/plain, a form type and no type are 415 and write nothing; application/json with or without a charset is read', async () => {
    const before = snapshot(dataDir);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'text/json']) {
      expect((await post('/__stage/stages', body(), { ...SAME, 'content-type': type })).status, type).toBe(415);
    }
    const bare = await new Promise<number>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/__stage/stages', headers: { host: `127.0.0.1:${port}`, ...SAME } }, (res) => {
        res.resume();
        res.on('end', () => done(res.statusCode ?? 0));
      });
      req.on('error', fail);
      req.end(body());
    });
    expect(bare).toBe(415);
    expect(snapshot(dataDir)).toEqual(before);
    for (const type of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8']) {
      expect((await post('/__stage/stages?dry=1', body(), { ...SAME, 'content-type': type })).status, type).toBe(200);
    }
  });
});

describe('task 19: the stage POST goes through withBody (a failure in the handler is a 500 and the server stays up)', () => {
  it('a prepare that returns nothing (its result is read outside the handler own try) is answered 500, and the server answers the next request', async () => {
    const lone = stageHandlers({ dataDir, prepare: (() => undefined) as never, screen: SET_SCREEN });
    const second = createServer((req, res) => lone.stages(req, res));
    await new Promise<void>((done) => second.listen(0, '127.0.0.1', done));
    const p = (second.address() as AddressInfo).port;
    const hit = (method: string, text?: string): Promise<number> =>
      new Promise((done, fail) => {
        const req = request({ host: '127.0.0.1', port: p, method, path: '/', headers: { host: `127.0.0.1:${p}`, 'content-type': 'application/json' } }, (res) => {
          res.resume();
          res.on('end', () => done(res.statusCode ?? 0));
        });
        req.on('error', fail);
        req.end(text);
      });
    try {
      expect(await hit('POST', body())).toBe(500);
      expect(await hit('GET')).toBe(200); // the server is still up
    } finally {
      await new Promise<void>((done) => second.close(() => done()));
    }
  });
});

describe('F6: a 500 tells the client nothing about paths', () => {
  it('the answer of a failed write has no absolute path and no raw error text', async () => {
    rmSync(join(dataDir, 'axes.json'));
    mkdirSync(join(dataDir, 'axes.json'));
    writeFileSync(join(dataDir, 'axes.json', 'keep.txt'), 'x');
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const r = await post('/__stage/stages', body({ stages }));
    expect(r.status).toBe(500);
    const text = r.body.problems.join(' ');
    expect(text).toMatch(/none was changed/);
    expect(text).not.toContain(dataDir);
    expect(text).not.toMatch(/ENOENT|EPERM|EISDIR|EEXIST|ENOTEMPTY|[A-Za-z]:[\\/]/);
  });
});

describe('?dry=1 from the dev server’s own page checks and writes nothing', () => {
  it('answers 200 with the text it would write (`wouldWrite` names the parts, `dry: true` says nothing was), claims no `written` or `file`, and no file changes', async () => {
    const before = snapshot(dataDir);
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const r = await post('/__stage/stages?dry=1', body({ stages }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, dry: true, wouldWrite: ['stages', 'axes', 'hud', 'facing', 'heroes'] });
    expect(r.body).not.toHaveProperty('written');
    expect(r.body).not.toHaveProperty('file');
    expect(r.body.stages).toContain('"x": 21');
    expect(snapshot(dataDir)).toEqual(before);
  });

  it('a dry run of bad data is still a 400', async () => {
    const r = await post('/__stage/stages?dry=1', body({ stages: {} }));
    expect(r.status).toBe(400);
  });
});

describe('bad data gets 400 and writes nothing', () => {
  const refused = async (text: string, expectProblem?: RegExp): Promise<void> => {
    const before = snapshot(dataDir);
    const r = await post('/__stage/stages', text);
    expect(r.status, text.slice(0, 80)).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.problems.length).toBeGreaterThan(0);
    if (expectProblem) expect(r.body.problems.join(' ')).toMatch(expectProblem);
    expect(snapshot(dataDir)).toEqual(before);
  };

  it('not JSON', () => refused('{ not json', /not valid JSON/));
  it('JSON that is not an object (null, a number, a list)', async () => {
    await refused('null');
    await refused('7');
    await refused('[]');
  });
  it('an empty object, and a body with no stages', async () => {
    await refused('{}');
    await refused(JSON.stringify({ axes: {} }));
  });
  it('a stage the game would refuse (a row off the floor)', () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 99 };
    return refused(body({ stages }), /street/);
  });
  it('a bad axes file, a bad facing file, a bad heroes file', async () => {
    await refused(body({ axes: { kit: { x: 99, y: 0 } } }));
    await refused(body({ facing: { punk: { facing: 'sideways' } } }));
    await refused(body({ heroes: { kit: { height: 9, build: 1 } } }));
  });
  it('a HUD layout the loader refuses', () => refused(body({ hud: {} })));

  it('CONTROL (pass line 6): a HUD change that pushes a stage’s own box off the screen is refused with the archive’s message, and nothing is written', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    // The street moves its commands box to x 560 and leaves the width to the global HUD...
    (stages.street as StageEntry).hud = { commands: { x: 560 } };
    const layout = (JSON.parse(read('hud-640.json')) as { layout: { commands: { w: number } } }).layout;
    layout.commands.w = 60;
    const before = snapshot(dataDir);
    // ...which fits while the global box is 60 wide (560 + 60 is inside 640),
    const fits = await post('/__stage/stages?dry=1', body({ stages, hud: layout }));
    expect(fits.status).toBe(200);
    // ...and runs off the screen once the global box is widened.
    layout.commands.w = 200;
    const r = await post('/__stage/stages', body({ stages, hud: layout }));
    expect(r.status).toBe(400);
    expect(r.body.problems.join(' ')).toMatch(/the HUD layout in this save does not fit a stage's own HUD box: .*street/);
    expect(snapshot(dataDir)).toEqual(before);
  });

  it('a stage laid out on the 480x270 screen is refused: the 640 set holds 640x360 stages only', async () => {
    const stages = JSON.parse(read('stages.json')) as Record<string, StageEntry>;
    const r = await post('/__stage/stages', body({ stages }));
    expect(r.status).toBe(400);
    expect(r.body.problems.join(' ')).toMatch(/480x270.*640x360/);
    const stages640 = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages640.sewer as StageEntry).screen = { w: 480, h: 270 };
    expect((await post('/__stage/stages', body({ stages: stages640 }))).status).toBe(400);
  });

  it('one Save lists the wrong-screen stages together with the HUD-box problem (R1-6), each in the archive’s words, and writes nothing', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).hud = { commands: { x: 560 } };
    (stages.street as StageEntry).screen = { w: 480, h: 270 };
    const layout = (JSON.parse(read('hud-640.json')) as { layout: { commands: { w: number } } }).layout;
    layout.commands.w = 200; // street's own box (x 560) now runs off the 640 screen
    const before = snapshot(dataDir);
    const r = await post('/__stage/stages', body({ stages, hud: layout }));
    expect(r.status).toBe(400);
    const all = r.body.problems.join(' ');
    expect(all).toMatch(/the HUD layout in this save does not fit a stage's own HUD box: .*street/);
    expect(all).toMatch(/stage "street" is laid out on 480x270, but .*stages-640.json holds 640x360 stages only/);
    expect(snapshot(dataDir)).toEqual(before);
    // Control: with the street back on the 640 screen, only the HUD problem is left and the screen sentence is gone.
    (stages.street as StageEntry).screen = { w: 640, h: 360 };
    expect((await post('/__stage/stages', body({ stages, hud: layout }))).body.problems.join(' ')).not.toMatch(/laid out on/);
  });

  it('write names a file, a path, a part that does not exist, or is not a list', async () => {
    await refused(body({ write: ['stages.json'] }), /not one of the parts/);
    await refused(body({ write: ['../../src/data/stages'] }), /not one of the parts/);
    await refused(body({ write: ['stages', 'stages-480'] }), /not one of the parts/);
    await refused(body({ write: 'stages' }), /must be a list/);
    await refused(body({ write: { stages: true } }), /must be a list/);
    await refused(body({ write: ['hud'], hud: undefined }), /no HUD layout/);
  });

  it('a body over the limit gets 413 (nothing is read into the checks)', async () => {
    const before = snapshot(dataDir);
    const r = await post('/__stage/stages', JSON.stringify({ stages: 'x'.repeat(MAX_BODY + 10) }));
    expect(r.status).toBe(413);
    expect(snapshot(dataDir)).toEqual(before);
    // The server stops reading: a body of 60 MB declared and sent in pieces is not taken in to its end (a handler that kept reading would see all of it).
    const huge = Buffer.alloc(60_000_000, 120);
    bodyBytesSeen = 0;
    await new Promise<void>((done) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/__stage/stages', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': String(huge.length), ...SAME } }, (res) => {
        res.resume();
        res.on('end', () => done());
        res.on('error', () => done());
      });
      req.on('error', () => done()); // the server may cut the connection after the 413
      req.end(huge);
    });
    expect(bodyBytesSeen).toBeLessThan(4_000_000);
    // Control: the same body at the limit is read and checked (it is not JSON for `prepareSave`, so 400, not 413).
    expect((await post('/__stage/stages', 'x'.repeat(MAX_BODY - 10))).status).toBe(400);
  });

  it('a stage or file name that looks like a path changes no path: the paths are fixed', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    const evil = { ...(stages.street as StageEntry), id: '../../escape', name: '../../escape' };
    const r = await post('/__stage/stages', body({ stages: { '../../escape': evil, ...stages } }));
    // The checks accept the odd key as plain text (200); no file outside the data folder appears.
    expect(r.status).toBe(200);
    expect(existsSync(join(work, 'escape.json'))).toBe(false);
    expect(readdirSync(dataDir).sort()).toEqual(['axes.json', 'enemyfacing.json', 'heroes.json', 'hud-640.json', 'hud.json', 'stages-640.json', 'stages.json']);
  });
});

describe('one Save writes all its files, or none', () => {
  it('a good Save writes the files it names together, in the 640 set only; the 480 files and every other byte stay', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const layout = (JSON.parse(read('hud-640.json')) as { layout: { commands: { y: number } } }).layout;
    layout.commands.y += 2;
    const before = snapshot(dataDir);
    const r = await post('/__stage/stages', body({ stages, hud: layout, axes: { sable: { x: -4, y: 0 } } }));
    expect(r.status).toBe(200);
    expect(r.body.written).toEqual(['stages', 'axes', 'hud', 'facing', 'heroes']);
    const after = snapshot(dataDir);
    // The 480 set is exactly as it was; the three shared files and the two 640 files are the text the answer carried.
    expect(after['stages.json']).toBe(before['stages.json']);
    expect(after['hud.json']).toBe(before['hud.json']);
    expect(readFileSync(join(dataDir, 'stages-640.json'), 'utf8')).toBe(r.body.stages);
    expect(readFileSync(join(dataDir, 'hud-640.json'), 'utf8')).toBe(r.body.hud);
    expect(readFileSync(join(dataDir, 'axes.json'), 'utf8')).toBe(r.body.axes);
    expect(readFileSync(join(dataDir, 'axes.json'), 'utf8')).toContain('"sable"');
    // No temporary file is left, and no new file exists.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    // And the game's own loader reads back what was written.
    const back = await send('GET', '/__stage/stages');
    expect(back.body.stages).toBe(r.body.stages);
  });

  it('`write` limits the Save: only the parts named are written', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const before = snapshot(dataDir);
    const r = await post('/__stage/stages', body({ stages, write: ['stages'] }));
    expect(r.status).toBe(200);
    expect(r.body.written).toEqual(['stages']);
    const after = snapshot(dataDir);
    expect(after['stages-640.json']).not.toBe(before['stages-640.json']);
    for (const f of ['hud-640.json', 'axes.json', 'enemyfacing.json', 'heroes.json', 'stages.json', 'hud.json']) expect(after[f], f).toBe(before[f]);
  });

  it('CONTROL: when one rename fails, no file of the Save is changed and no temporary file stays', async () => {
    // A directory where a file belongs makes the rename of that one file fail, after the others could have gone through. (axes.json is renamed second.)
    rmSync(join(dataDir, 'axes.json'));
    mkdirSync(join(dataDir, 'axes.json'));
    writeFileSync(join(dataDir, 'axes.json', 'keep.txt'), 'x');
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const textOf = (f: string): string => readFileSync(join(dataDir, f), 'utf8');
    const old = { stages: textOf('stages-640.json'), hud: textOf('hud-640.json'), heroes: textOf('heroes.json'), facing: textOf('enemyfacing.json') };
    const r = await post('/__stage/stages', body({ stages }));
    expect(r.status).toBe(500);
    expect(r.body.problems.join(' ')).toMatch(/none was changed/);
    expect(textOf('stages-640.json')).toBe(old.stages);
    expect(textOf('hud-640.json')).toBe(old.hud);
    expect(textOf('heroes.json')).toBe(old.heroes);
    expect(textOf('enemyfacing.json')).toBe(old.facing);
    expect(readdirSync(dataDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('the test seam: ?scratch=<name>', () => {
  it('reads the real files until a Save, writes only the private copy, and leaves the data folder as it was', async () => {
    const before = snapshot(dataDir);
    const first = await send('GET', '/__stage/stages?scratch=abc');
    expect(first.body.stages).toBe(read('stages-640.json'));
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const r = await post('/__stage/stages?scratch=abc', body({ stages }));
    expect(r.status).toBe(200);
    expect(r.body.written).toEqual(['stages', 'axes', 'hud', 'facing', 'heroes']);
    expect(snapshot(dataDir)).toEqual(before);
    expect(existsSync(join(scratchDir, 'abc', 'stages-640.json'))).toBe(true);
    const again = await send('GET', '/__stage/stages?scratch=abc');
    expect(again.body.stages).toBe(r.body.stages);
    const plain = await send('GET', '/__stage/stages');
    expect(plain.body.stages).toBe(read('stages-640.json'));
  });

  it.each(['../up', 'a/b', 'A', 'a b', '', 'x'.repeat(49), '%2e%2e', 'con', 'nul', 'prn', 'aux', 'com1', 'com9', 'lpt1', 'lpt9'])('the name %j is refused (400) and makes no folder', async (name) => {
    const r = await post(`/__stage/stages?scratch=${encodeURIComponent(name)}`, body());
    expect(r.status).toBe(400);
    expect(existsSync(scratchDir)).toBe(false);
  });

  it('a request that fails its checks makes no scratch folder', async () => {
    await post('/__stage/stages?scratch=ghost', '{ not json');
    await post('/__stage/stages?scratch=ghost', body(), { 'sec-fetch-site': 'cross-site' });
    expect(existsSync(join(scratchDir, 'ghost'))).toBe(false);
  });
});

describe('the files of the 640 set', () => {
  it('are exactly these five names, none of them the 480 set', () => {
    expect(Object.values(PART_FILES).sort()).toEqual(['axes.json', 'enemyfacing.json', 'heroes.json', 'hud-640.json', 'stages-640.json']);
  });
});
