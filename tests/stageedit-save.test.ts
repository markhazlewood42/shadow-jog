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
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StageEntry } from '../src/battlestage/config';
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
    if (req.url?.startsWith('/__stage/stages')) handlers.stages(req, res);
    else if (req.url?.startsWith('/__stage/hud')) handlers.hud(req, res);
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
  body: { ok: boolean; problems: string[]; written?: string[]; dry?: boolean; stages?: string; hud?: string; axes?: string; facing?: string; heroes?: string };
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

describe('?dry=1 from the dev server’s own page checks and writes nothing', () => {
  it('answers 200 with the text it would write (`written` names the parts, `dry: true` says nothing was), and no file changes', async () => {
    const before = snapshot(dataDir);
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    (stages.street as StageEntry).party[0] = { x: 21, row: 2 };
    const r = await post('/__stage/stages?dry=1', body({ stages }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, dry: true, written: ['stages', 'axes', 'hud', 'facing', 'heroes'] });
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
  });

  it('a stage or file name that looks like a path changes no path: the paths are fixed', async () => {
    const stages = JSON.parse(read('stages-640.json')) as Record<string, StageEntry>;
    const evil = { ...(stages.street as StageEntry), id: '../../escape', name: '../../escape' };
    const r = await post('/__stage/stages', body({ stages: { '../../escape': evil, ...stages } }));
    // Whether the checks accept the odd key or not, no file outside the data folder appears.
    expect([200, 400]).toContain(r.status);
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

  it.each(['../up', 'a/b', 'A', 'a b', '', 'x'.repeat(49), '%2e%2e'])('the name %j is refused (400) and makes no folder', async (name) => {
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
