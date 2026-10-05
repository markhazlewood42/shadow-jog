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

export const ROOT = resolve(import.meta.dirname, '..');
export const W = 480;
export const H = 270;

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
    await page.goto(`/sjestage.html?${opts.query ?? 'manual'}`);
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

export interface SliceFile {
  stageId: string;
  setKey: string;
  lineup: string[];
  enemies: string[];
  active: number;
  target: number;
  seed: number;
  ticks: number[];
}

/** The slice's numbers, from the one file the engine and the capture script both read. */
export function readSlice(): SliceFile {
  return JSON.parse(readFileSync(join(ROOT, 'src/battlestage/slice.json'), 'utf8')) as SliceFile;
}

export const FIXTURES = join(ROOT, 'tests', 'fixtures', 'sjestage');

/** The reference frame for a mode, a renderer kind and a tick, or null when there is none to read here. Stand-ins: the local folder if it has one, else the committed file. Art: the local folder only. */
export function readReference(mode: SpriteMode, kind: RendererKind, tick: number): Buffer | null {
  const name = `${mode}-${kind}-t${tick}.rgba`;
  let raw: Buffer | null = null;
  const local = process.env.SJESTAGE_REFS;
  if (local && existsSync(join(local, name))) raw = readFileSync(join(local, name));
  else if (mode === 'standins' && existsSync(join(FIXTURES, `${name}.gz`))) raw = gunzipSync(readFileSync(join(FIXTURES, `${name}.gz`)));
  if (raw && raw.length !== W * H * 4) throw new Error(`${name}: ${raw.length} bytes, expected ${W * H * 4}`);
  return raw;
}

/** The committed stand-in reference for a tick (never the local folder): what CI compares with. Null when the file is missing. */
export function readCommitted(kind: RendererKind, tick: number): Buffer | null {
  const file = join(FIXTURES, `standins-${kind}-t${tick}.rgba.gz`);
  return existsSync(file) ? gunzipSync(readFileSync(file)) : null;
}

/** Does Mark's sprite folder exist here? (The lab uses it when it does.) */
export const HAVE_ART = existsSync(join(ROOT, 'spritefusion-tests', 'extracted', 'kit-battle-idle', 'metadata.json'));

// ------------------------------------------------------------------ comparing

export interface Parity {
  /** The largest difference in any one of R, G, B (0 to 255). */
  maxDiff: number;
  /** Pixels where any of R, G or B differs at all, and as a percentage of the picture. */
  differing: number;
  pct: number;
  /** Pixels that differ by more than 1, 2 and 3 in some channel. */
  over1: number;
  over2: number;
  over3: number;
  /** The share of the picture that differs by MORE than the allowed 2/255. */
  failing: number;
  /** Up to 8 worst pixels. */
  samples: Array<{ x: number; y: number; engine: number[]; ref: number[] }>;
  /** A picture of where they differ: the reference dimmed, every differing pixel hot pink (alpha 255). */
  diff: Buffer;
}

/** Compare two RGBA pictures of the same size (alpha is not compared: both are opaque). */
export function compareFrames(engine: Buffer, ref: Buffer): Parity {
  if (engine.length !== ref.length) throw new Error(`the pictures differ in size: ${engine.length} and ${ref.length} bytes`);
  const n = engine.length / 4;
  const diff = Buffer.alloc(engine.length);
  const out: Parity = { maxDiff: 0, differing: 0, pct: 0, over1: 0, over2: 0, over3: 0, failing: 0, samples: [], diff };
  const worst: Array<{ d: number; i: number }> = [];
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const d = Math.max(Math.abs((engine[i] ?? 0) - (ref[i] ?? 0)), Math.abs((engine[i + 1] ?? 0) - (ref[i + 1] ?? 0)), Math.abs((engine[i + 2] ?? 0) - (ref[i + 2] ?? 0)));
    if (d > 0) {
      diff.set([255, 0, 96, 255], i);
      out.differing++;
      out.maxDiff = Math.max(out.maxDiff, d);
      if (d > 1) out.over1++;
      if (d > 2) out.over2++;
      if (d > 3) out.over3++;
      if (worst.length < 8 || d > (worst[worst.length - 1]?.d ?? 0)) {
        worst.push({ d, i });
        worst.sort((a, b) => b.d - a.d);
        if (worst.length > 8) worst.pop();
      }
    } else diff.set([(ref[i] ?? 0) >> 2, (ref[i + 1] ?? 0) >> 2, (ref[i + 2] ?? 0) >> 2, 255], i);
  }
  out.pct = (out.differing / n) * 100;
  out.failing = (out.over2 / n) * 100;
  out.samples = worst.map(({ i }) => ({ x: (i / 4) % W, y: Math.floor(i / 4 / W), engine: [...engine.subarray(i, i + 4)], ref: [...ref.subarray(i, i + 4)] }));
  return out;
}

/** The pass line of exit criterion 7: no pixel differs by more than 2/255 in any channel, and at most 3% of the pixels differ at all. */
export const PARITY_MAX_CHANNEL = 2;
export const PARITY_MAX_PERCENT = 3;

/** A one-line report of one comparison (the numbers the spike doc records). */
export function describeParity(label: string, p: Parity): string {
  return `${label}: max channel diff ${p.maxDiff}/255, ${p.differing} px differ (${p.pct.toFixed(3)}%), over 1: ${p.over1}, over 2: ${p.over2}, over 3: ${p.over3}`;
}

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
