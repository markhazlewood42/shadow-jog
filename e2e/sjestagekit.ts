/**
 * Shared by the stage lab's spec (e2e/sjestage.spec.ts): how to open /sjestage.html, where the reference frames are, how two frames are
 * compared (the parity numbers) and how a diff picture is written. Step B1 of the engine-platform spike.
 *
 * References. A reference frame is a raw RGBA picture (480x270x4 bytes, top row first) made by `scripts/sjestage-refs.mjs` from the PHASER spike's
 * stage lab. The STAND-IN frames are committed, gzipped (`tests/fixtures/sjestage/`), because CI has no Phaser checkout. Mark's-art frames are
 * never committed: they are read from the folder named by `SJESTAGE_REFS` (the script's `--out` folder) and only when his sprite folder is here.
 *
 * There is one set of frames for each renderer KIND: `gpu` (a hardware browser) and `soft` (software GL and canvas, what CI's browser is). The game's own
 * glow layer is painted by canvas 2D code, which differs by 1/255 between the two kinds in both pages, so each page is compared with the Phaser page of its own kind.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync, gunzipSync } from 'node:zlib';
import { type Browser, expect, type Page } from '@playwright/test';
import { SIZE, withSize } from './sjelabkit';
import { changedInputs, H, pinMessage, rendererMask, W } from './sjestageparity';

// The picture size under test (480x270, or 640x360 with SJE_SIZE=640x360) is `SIZE` from sjelabkit.ts. `W` and `H` below are NOT it: they are the size of the
// PHASER references, always 480x270, so the parity checks only run at 480x270.
export { SIZE };

export const ROOT = resolve(import.meta.dirname, '..');
// The pure parts (the comparison numbers, the strict gate, the pins) are in sjestageparity.ts, so a unit test can use them. Re-exported here for the spec.
export { compareFrames, describeParity, describeStrict, H, PARITY_MAX_CHANNEL, PARITY_MAX_PERCENT, type Parity, rendererMask, type StrictResult, strictCompare, W } from './sjestageparity';

export interface StagePage {
  page: Page;
  /** Console messages that are errors or warnings, and uncaught page errors. Tests assert this is empty. */
  problems: string[];
  close(): Promise<void>;
}

export interface OpenOptions {
  dpr?: number;
  viewport?: { width: number; height: number };
  /** Query string after `/sjestage.html?`. Default `manual` (the test drives the clock). */
  query?: string;
  /**
   * Pretend Mark's sprite folder is not here, the way a CI checkout has it: every request for it is answered with the app's own page (200, text/html),
   * which is what Vite really sends for a path it does not have. The page must then find out by itself and use the stand-ins.
   */
  hideArt?: boolean;
}

/** Chrome's own performance hint when a page reads pixels back. Only the lab's test hook does that. */
const ALWAYS_ALLOWED = [
  /GPU stall due to ReadPixels/,
  // Vite's hot-reload socket can fail to connect while the dev server is busy. Tooling noise, not the engine.
  /WebSocket connection to 'ws:\/\/localhost:\d+\/\?token=/,
];

/** Open the stage lab and wait for it to be ready. */
export async function openStage(browser: Browser, opts: OpenOptions = {}): Promise<StagePage> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 960, height: 540 }, deviceScaleFactor: opts.dpr ?? 1 });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (ALWAYS_ALLOWED.some((re) => re.test(m.text()))) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  if (opts.hideArt) await page.route('**/spritefusion-tests/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>app</title>' }));
  const boot = async (): Promise<string | undefined> => {
    await page.goto(`/sjestage.html?${withSize(opts.query ?? 'manual')}`);
    await page.waitForFunction(() => window.__SJESTAGE__ !== undefined || (window as unknown as { __SJESTAGE_ERROR__?: string }).__SJESTAGE_ERROR__ !== undefined, null, { timeout: 90_000 });
    return page.evaluate(() => (window as unknown as { __SJESTAGE_ERROR__?: string }).__SJESTAGE_ERROR__);
  };
  let failed = await boot();
  // The dev server (Vite) now and then fails ONE module request while it is busy re-transforming files. That is the server, not the engine: try once more.
  if (failed && /Failed to fetch dynamically imported module/.test(failed)) {
    problems.length = 0;
    failed = await boot();
  }
  if (failed) throw new Error(`the stage lab failed to start: ${failed}`);
  return { page, problems, close: () => context.close() };
}

/** Open a stage lab, run `fn`, always close it, and check no console problem appeared. */
export async function withStage(browser: Browser, fn: (lab: StagePage) => Promise<void>, opts: OpenOptions = {}): Promise<void> {
  const lab = await openStage(browser, opts);
  try {
    await fn(lab);
    expect(lab.problems, 'console errors and warnings').toEqual([]);
  } finally {
    await lab.close();
  }
}

/** Is this lab drawing with a software renderer (SwiftShader, llvmpipe)? */
export async function isSoftware(page: Page): Promise<boolean> {
  const info = await page.evaluate(() => window.__SJESTAGE__?.info());
  return /swiftshader|llvmpipe|software/i.test(info?.renderer ?? '');
}

/** Which set of reference frames this page is compared with. */
export async function rendererKind(page: Page): Promise<RendererKind> {
  return (await isSoftware(page)) ? 'soft' : 'gpu';
}

// ------------------------------------------------------------------ references

export type SpriteMode = 'standins' | 'art';
/** `gpu`: a hardware browser. `soft`: software GL and software canvas (SwiftShader), what CI runs. */
export type RendererKind = 'gpu' | 'soft';

/** The second frame of the parity set (C3): the depth haze with no ring exemption. */
export interface HazeSpec {
  lineup: string[];
  setKey: string;
  enemies: string[];
  ticks: number[];
}

export interface SliceFile {
  stageId: string;
  setKey: string;
  lineup: string[];
  enemies: string[];
  active: number;
  target: number;
  seed: number;
  ticks: number[];
  haze: HazeSpec;
}

/** Which frame of the parity set: 'slice' (Kit and the punk with both rings, exit criterion 7) or 'haze' (four heroes and three enemies on hazed rows, no rings). */
export type FrameKind = 'slice' | 'haze';

/** The slice's numbers, from the one file the engine and the capture script both read. */
export function readSlice(): SliceFile {
  return JSON.parse(readFileSync(join(ROOT, 'src/battlestage/slice.json'), 'utf8')) as SliceFile;
}

export const FIXTURES = join(ROOT, 'tests', 'fixtures', 'sjestage');

/** The file name of a reference frame (the haze frame has "haze" in it). */
export function referenceName(mode: SpriteMode, kind: RendererKind, tick: number, frame: FrameKind = 'slice'): string {
  return `${mode}-${kind}${frame === 'haze' ? '-haze' : ''}-t${tick}.rgba`;
}

/** The reference frame for a mode, a renderer kind and a tick, or null when there is none to read here. Stand-ins: the local folder if it has one, else the committed file. Art: the local folder only. */
export function readReference(mode: SpriteMode, kind: RendererKind, tick: number, frame: FrameKind = 'slice'): Buffer | null {
  const name = referenceName(mode, kind, tick, frame);
  let raw: Buffer | null = null;
  const local = process.env.SJESTAGE_REFS;
  if (local && existsSync(join(local, name))) raw = readFileSync(join(local, name));
  else if (mode === 'standins' && existsSync(join(FIXTURES, `${name}.gz`))) raw = gunzipSync(readFileSync(join(FIXTURES, `${name}.gz`)));
  if (raw && raw.length !== W * H * 4) throw new Error(`${name}: ${raw.length} bytes, expected ${W * H * 4}`);
  return raw;
}

/** The committed stand-in reference for a tick (never the local folder): what CI compares with. Null when the file is missing. */
export function readCommitted(kind: RendererKind, tick: number, frame: FrameKind = 'slice'): Buffer | null {
  const file = join(FIXTURES, `${referenceName('standins', kind, tick, frame)}.gz`);
  return existsSync(file) ? gunzipSync(readFileSync(file)) : null;
}

/** Every committed stand-in frame as a [frame, tick] pair: the slice's ticks, then the haze frame's. */
export function committedFrames(): Array<{ frame: FrameKind; tick: number }> {
  const slice = readSlice();
  return [...slice.ticks.map((tick) => ({ frame: 'slice' as const, tick })), ...slice.haze.ticks.map((tick) => ({ frame: 'haze' as const, tick }))];
}

/**
 * The pixels whose colour depends on the kind of renderer (C1), from the committed GPU and software stand-in references of every frame. The strict gate
 * allows 1/255 only there. Made once and kept.
 */
let maskCache: Uint8Array | undefined;
export function strictMask(): Uint8Array {
  if (!maskCache) {
    const pairs: Array<{ gpu: Buffer; soft: Buffer }> = [];
    for (const { frame, tick } of committedFrames()) {
      const gpu = readCommitted('gpu', tick, frame);
      const soft = readCommitted('soft', tick, frame);
      if (gpu && soft) pairs.push({ gpu, soft });
    }
    maskCache = rendererMask(pairs);
  }
  return maskCache;
}

// ------------------------------------------------------------------ pinned inputs (C2)

/** The data files the slice reads (tests/fixtures/sjestage/inputs.json): the references are only valid for these exact bytes. */
export function inputFiles(): string[] {
  return (JSON.parse(readFileSync(join(FIXTURES, 'inputs.json'), 'utf8')) as { files: string[] }).files;
}

/**
 * Check that every input file is the one the references were made with. Throws ONE message that says so and names the command that makes the references
 * again, so a design edit never shows up as a pile of pixel numbers. Call it before any pixel is compared. The manifest checked is the committed
 * one for this renderer kind, and also the one in `SJESTAGE_REFS` when frames are read from there.
 */
export function assertInputsPinned(kind: RendererKind): void {
  const files = inputFiles();
  const sources = [join(FIXTURES, `manifest-${kind}.json`)];
  const local = process.env.SJESTAGE_REFS;
  if (local && existsSync(join(local, `manifest-${kind}.json`))) sources.push(join(local, `manifest-${kind}.json`));
  for (const source of sources) {
    const manifest = JSON.parse(readFileSync(source, 'utf8')) as { inputs?: Record<string, string> };
    const problems = changedInputs(ROOT, files, manifest.inputs);
    if (problems.length) throw new Error(`${pinMessage(problems)}
  (manifest: ${source})`);
  }
}

/** Does Mark's sprite folder exist here? (The lab uses it when it does.) */
export const HAVE_ART = existsSync(join(ROOT, 'spritefusion-tests', 'extracted', 'kit-battle-idle', 'metadata.json'));

// ------------------------------------------------------------------ a PNG writer (diff pictures)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An RGBA picture as a PNG, scaled up by a whole number. */
export function encodePng(rgba: Buffer, w: number, h: number, scale = 1): Buffer {
  const W2 = w * scale;
  const H2 = h * scale;
  const rows = Buffer.alloc((W2 * 4 + 1) * H2);
  for (let y = 0; y < H2; y++) {
    const row = y * (W2 * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < W2; x++) rgba.copy(rows, row + 1 + x * 4, (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4, (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4 + 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W2, 0);
  ihdr.writeUInt32BE(H2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** Pictures go outside the repo: the folder named by `SJESTAGE_SHOTS`, or nowhere. */
export function savePicture(name: string, png: Buffer): void {
  const dir = process.env.SJESTAGE_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), png);
}
