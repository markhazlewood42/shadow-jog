/**
 * Shared helpers for the specs that run the REAL game on the new engine (`/?engine=sje`): e2e/sje-shell.spec.ts and e2e/sje-bench.spec.ts.
 * The lab page has its own kit (e2e/sjelabkit.ts).
 */
import type { Browser, Page } from '@playwright/test';
import { decodePng } from '../scripts/lib/png.mjs';

export interface GamePage {
  page: Page;
  /** Console errors and warnings, and uncaught page errors. A test asserts this is empty (after its own `allow`). */
  problems: string[];
  close(): Promise<void>;
}

export interface OpenGameOptions {
  /** `true`: `/?engine=sje&debug` (the new engine). `false`: `/?debug` (the old path). */
  engine: boolean;
  viewport?: { width: number; height: number };
  dpr?: number;
  /** Extra query text, for example `&scene=...`. */
  query?: string;
  /** Console messages that are expected in THIS test. */
  allow?: RegExp[];
  /** Run before the page's own scripts (for example a test double for WebGL). */
  init?: () => void;
  /**
   * A deterministic run, as e2e/shots.spec.ts does it: the page's clock is fake and paused (a frame happens only when the test calls `advance`),
   * `Date.now()` is fixed, and `Math.random` is a seeded generator. Two pages that run the same code then draw the same frames.
   */
  fakeClock?: boolean;
}

/** Noise that is the tooling and not the game: the Vite hot-reload socket, and Chrome's hint when a test reads pixels back. */
const ALWAYS_ALLOWED = [
  /GPU stall due to ReadPixels/,
  /WebSocket connection to 'ws:\/\/localhost:\d+\/\?token=/,
  // The game's own art code reads canvases back (on both paths, before this milestone): Chrome's hint, not a fault.
  /willReadFrequently/,
];

/** The fixed wall clock of a deterministic run: 2026-10-06 12:00 UTC (the same as e2e/shots.spec.ts). */
const CLOCK = Date.UTC(2026, 9, 6, 12, 0, 0);
const RANDOM_SEED = 0x5eed;

export async function openGame(browser: Browser, opts: OpenGameOptions): Promise<GamePage> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 720 }, deviceScaleFactor: opts.dpr ?? 1 });
  const page = await context.newPage();
  const problems: string[] = [];
  const allowed = [...ALWAYS_ALLOWED, ...(opts.allow ?? [])];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (allowed.some((re) => re.test(m.text()))) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  if (opts.fakeClock) {
    // A real zero-delay timer that touches the fake clock as soon as a document exists: Playwright replays its clock log on the first call to a faked function.
    await page.addInitScript(() => {
      setTimeout(() => Date.now(), 0);
    });
    await page.clock.pauseAt(CLOCK);
    await page.addInitScript((seed: number) => {
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, RANDOM_SEED);
  }
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(`/?${opts.engine ? 'engine=sje&' : ''}debug${opts.query ?? ''}`);
  return { page, problems, close: () => context.close() };
}

/** Run `fn` in the page with `sj` = `window.__SJ__`. */
export async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

/** Wait (up to `ms`) for an expression in the page to be true. Returns whether it was. A control passes a false expression and expects `false`. */
export async function waitUntil(page: Page, expr: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await sj<boolean>(page, `!!(${expr})`)) return true;
    } catch {
      // The hook is not there yet (the page is still loading).
    }
    await page.waitForTimeout(100);
  }
  return false;
}

/** Step the page's fake clock by `ms` (a `fakeClock` run). The game runs one frame per 16 ms of it. */
export const advance = (page: Page, ms: number): Promise<void> => page.clock.runFor(ms);

/** Wait for the scene on top to have this class name. */
export const waitTop = (page: Page, name: string, ms = 30_000): Promise<boolean> => waitUntil(page, `sj.top() === ${JSON.stringify(name)}`, ms);

/** A decoded picture. */
export interface Img {
  w: number;
  h: number;
  data: Uint8Array;
}

export function decode(png: Buffer): Img {
  const d = decodePng(png);
  return { w: d.width, h: d.height, data: d.data };
}

/** How many pixels differ (in any channel), and the fraction of all pixels. Pictures of different sizes differ everywhere. */
export function diff(a: Img, b: Img): { differing: number; ratio: number } {
  if (a.w !== b.w || a.h !== b.h) return { differing: Math.max(a.w * a.h, b.w * b.h), ratio: 1 };
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++;
  }
  return { differing: n, ratio: n / (a.w * a.h) };
}

/**
 * Is the rectangle (device pixels) at (x, y) of `a` the same as the rectangle at (bx, by) of `b` (the same place by default)? And how many colors does it hold in `a`
 * (a flat block proves nothing)?
 */
export function sameRect(a: Img, b: Img, x: number, y: number, w: number, h: number, bx = x, by = y): { same: boolean; colors: number } {
  const colors = new Set<number>();
  let same = true;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const ia = (row * a.w + col) * 4;
      const ib = ((row - y + by) * b.w + (col - x + bx)) * 4;
      colors.add(((a.data[ia] ?? 0) << 16) | ((a.data[ia + 1] ?? 0) << 8) | (a.data[ia + 2] ?? 0));
      if (a.data[ia] !== b.data[ib] || a.data[ia + 1] !== b.data[ib + 1] || a.data[ia + 2] !== b.data[ib + 2] || a.data[ia + 3] !== b.data[ib + 3]) same = false;
    }
  }
  return { same, colors: colors.size };
}

/**
 * Count the k-by-k blocks, from (x0, y0) for `cols` x `rows` blocks, that are not one flat color. A resampled or fractionally scaled picture has
 * many; an integer scale has none.
 */
export function unevenBlocks(img: Img, k: number, x0: number, y0: number, cols: number, rows: number): number {
  let bad = 0;
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const o = ((y0 + by * k) * img.w + (x0 + bx * k)) * 4;
      let flat = true;
      for (let dy = 0; dy < k && flat; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const p = ((y0 + by * k + dy) * img.w + (x0 + bx * k + dx)) * 4;
          if (img.data[p] !== img.data[o] || img.data[p + 1] !== img.data[o + 1] || img.data[p + 2] !== img.data[o + 2]) {
            flat = false;
            break;
          }
        }
      }
      if (!flat) bad++;
    }
  }
  return bad;
}

/**
 * An init script (pass it as `openGame({ init })`) that counts, from before any script runs, the GL calls of every frame in `window.__gl`:
 * draw calls, framebuffer binds, and canvas uploads (`texImage2D` and `texSubImage2D` with a canvas or image as the source, with the bytes).
 * The counts come from patches of `WebGL2RenderingContext.prototype`, so every machine gives the same numbers.
 */
export function installGlCounters(): void {
  const w = window as unknown as { __gl: { draws: number; binds: number; uploads: number; uploadBytes: number } };
  w.__gl = { draws: 0, binds: 0, uploads: 0, uploadBytes: 0 };
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
    const orig = proto[name];
    if (!orig) continue;
    proto[name] = function (this: unknown, ...args: unknown[]) {
      w.__gl.draws++;
      return orig.apply(this, args);
    };
  }
  const bind = proto.bindFramebuffer;
  if (bind) {
    proto.bindFramebuffer = function (this: unknown, ...args: unknown[]) {
      w.__gl.binds++;
      return bind.apply(this, args);
    };
  }
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const orig = proto[name];
    if (!orig) continue;
    proto[name] = function (this: unknown, ...args: unknown[]) {
      // The source is the last argument. A canvas or an image has width and height; a typed array (a blank texture) does not count.
      const src = args[args.length - 1] as { width?: number; height?: number; byteLength?: number } | null;
      if (src && typeof src.width === 'number' && typeof src.height === 'number' && src.byteLength === undefined) {
        w.__gl.uploads++;
        w.__gl.uploadBytes += src.width * src.height * 4;
      }
      return orig.apply(this, args);
    };
  }
}
