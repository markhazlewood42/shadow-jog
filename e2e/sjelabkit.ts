/**
 * Shared helpers for the engine lab's specs (e2e/sje-canaries.spec.ts, e2e/perf.spec.ts): open the lab page
 * with a clock the test drives, collect the console messages that count as problems, and the rules of the
 * speed line.
 */
import { type Browser, expect, type Page } from '@playwright/test';
import { H, W } from '../src/sje/core/size';

/** The picture size under test, from the one size source (`src/sje/core/size.ts`). */
export const SIZE = { w: W, h: H };

/**
 * The integer zoom the presenter picks for a window, by its own rule (`src/sje/render/presenter.ts`): the largest whole k with k x W and
 * k x H inside the window in device pixels. Computed here from the size source, so a change of the picture size changes the expectation too.
 */
export function zoomFor(viewport: { width: number; height: number }, dpr: number): number {
  return Math.max(1, Math.floor(Math.min((viewport.width * dpr) / SIZE.w, (viewport.height * dpr) / SIZE.h) + 1e-9));
}

export interface LabPage {
  page: Page;
  /** Console messages that are errors or warnings, and uncaught page errors. Tests assert this is empty. */
  problems: string[];
  /** Every URL the page requested. */
  requests: string[];
  close(): Promise<void>;
}

export interface OpenOptions {
  dpr?: number;
  viewport?: { width: number; height: number };
  /** Query string after `/sjelab.html?`. Default `manual` (the test drives the clock). Leave out `manual` for the real loop. */
  query?: string;
  /** Console messages that are expected in THIS test (matched against the text). */
  allow?: RegExp[];
  /** Count every requestAnimationFrame callback that runs, from before any script runs (`window.__rafRuns`). The "no second loop" canary. */
  countFrames?: boolean;
  /** Count draw calls and framebuffer binds of the WebGL2 context from before any script runs (`window.__gl`). */
  countGl?: boolean;
}

/** Chrome's own performance hint when a page reads pixels back. Only the lab's test hook does that. */
const ALWAYS_ALLOWED = [
  /GPU stall due to ReadPixels/,
  // Vite's hot-reload socket can fail to connect while the dev server is busy. Tooling noise, not the engine.
  /WebSocket connection to 'ws:\/\/localhost:\d+\/\?token=/,
];

/** Open the lab and wait for it to be ready. */
export async function openLab(browser: Browser, opts: OpenOptions = {}): Promise<LabPage> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 720 }, deviceScaleFactor: opts.dpr ?? 1 });
  const page = await context.newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  const allowed = [...ALWAYS_ALLOWED, ...(opts.allow ?? [])];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (allowed.some((re) => re.test(m.text()))) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => requests.push(r.url()));
  if (opts.countFrames) {
    await page.addInitScript(() => {
      const w = window as unknown as { __rafRuns: number };
      w.__rafRuns = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        orig((t) => {
          w.__rafRuns++;
          cb(t);
        });
    });
  }
  if (opts.countGl) {
    await page.addInitScript(() => {
      const w = window as unknown as { __gl: { draws: number; binds: number } };
      w.__gl = { draws: 0, binds: 0 };
      const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const [name, key] of [
        ['drawElements', 'draws'],
        ['drawArrays', 'draws'],
        ['drawElementsInstanced', 'draws'],
        ['drawArraysInstanced', 'draws'],
        ['drawRangeElements', 'draws'],
        ['bindFramebuffer', 'binds'],
      ] as const) {
        const orig = proto[name];
        if (!orig) continue;
        proto[name] = function (this: unknown, ...args: unknown[]) {
          w.__gl[key]++;
          return orig.apply(this, args);
        };
      }
    });
  }
  const boot = async (): Promise<string | undefined> => {
    await page.goto(`/sjelab.html?${opts.query ?? 'manual'}`);
    await page.waitForFunction(() => window.__SJE__ !== undefined || (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ !== undefined, null, { timeout: 90_000 });
    return page.evaluate(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__);
  };
  let failed = await boot();
  // The dev server (Vite) now and then fails ONE module request while it is busy re-transforming files. That is the
  // server, not the engine: try once more. Any other start-up error is real and stops the test.
  if (failed && /Failed to fetch dynamically imported module/.test(failed)) {
    problems.length = 0;
    failed = await boot();
  }
  if (failed) throw new Error(`the lab failed to start: ${failed}`);
  return { page, problems, requests, close: () => context.close() };
}

/** Open a lab, run `fn`, always close it, and check no console problem appeared. */
export async function withLab(browser: Browser, fn: (lab: LabPage) => Promise<void>, opts: OpenOptions = {}): Promise<void> {
  const lab = await openLab(browser, opts);
  try {
    await fn(lab);
    expect(lab.problems, 'console errors and warnings').toEqual([]);
  } finally {
    await lab.close();
  }
}

/** RGBA bytes from the hook's base64. */
export function bytesOf(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** The percentile of a list (0 to 1). */
export function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Is this lab drawing with a software renderer (SwiftShader, llvmpipe)? */
export async function isSoftware(page: Page): Promise<boolean> {
  const info = await page.evaluate(() => window.__SJE__?.info());
  return /swiftshader|llvmpipe|software/i.test(info?.renderer ?? '');
}

/** The browser errors that a control (a canary's negative control) is expected to cause on purpose. Matched per test, never globally. */
export const CONTROL_NOISE = [/INVALID_OPERATION/, /does not belong to this context/, /does not have a stencil buffer/];

/**
 * THE SPEED LINE (docs/engine/tooling-and-testing.md section 7). "60 fps" means NO DROPPED FRAMES against the display's own refresh rate (a
 * display at 56.6 Hz makes even a bare page take 17.7 ms a frame). Two rules, both judged on a real GPU:
 *   1. INTERVAL: the scene's frame interval p95 is within 5% of a bare requestAnimationFrame page in the same browser on the same display.
 *   2. COST: what a frame costs, p95, is at most 8 ms. The cost INCLUDES the wait for the GPU (src/sje-lab/profile.ts): a draw call only
 *      submits commands, so a JavaScript timer cannot see a slow GPU.
 * Rule 1 alone cannot fail on a display locked to its refresh rate, so rule 2 is what gives headroom.
 * On SOFTWARE GL (SwiftShader, llvmpipe: CI) a shared software renderer cannot meet either rule and says nothing about the engine. There the line
 * has one rule that still means something: the loop is not stuck, an interval p95 under 80 ms.
 */
export const SPEED_LINE = { intervalRatio: 1.05, costMs: 8, softwareStuckMs: 80 };

/** Which rules of the speed line a run breaks. Empty means it meets the line. Pure, so the control can prove the rules have teeth. */
export function speedLineMisses(m: { bareP95: number; sceneP95: number; costP95: number; software: boolean }): string[] {
  const misses: string[] = [];
  if (m.software) {
    if (m.sceneP95 >= SPEED_LINE.softwareStuckMs) misses.push(`stuck loop: interval p95 ${m.sceneP95.toFixed(1)} ms is not under ${SPEED_LINE.softwareStuckMs} ms`);
    return misses;
  }
  if (m.sceneP95 > m.bareP95 * SPEED_LINE.intervalRatio) misses.push(`interval p95 ${m.sceneP95.toFixed(2)} ms is over ${(m.bareP95 * SPEED_LINE.intervalRatio).toFixed(2)} ms (bare page p95 ${m.bareP95.toFixed(2)} ms plus 5%)`);
  if (m.costP95 > SPEED_LINE.costMs) misses.push(`cost p95 ${m.costP95.toFixed(2)} ms is over ${SPEED_LINE.costMs} ms`);
  return misses;
}

/** A bare requestAnimationFrame page on this display: what a frame interval is when nothing runs. */
export async function bareIntervals(browser: Browser, frames: number): Promise<number[]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const page = await context.newPage();
    await page.goto('about:blank');
    const measure = (): Promise<number[]> =>
      page.evaluate(
        (n) =>
          new Promise<number[]>((resolve) => {
            const out: number[] = [];
            let last = performance.now();
            const tick = (now: number) => {
              out.push(now - last);
              last = now;
              if (out.length < n) requestAnimationFrame(tick);
              else resolve(out.slice(30));
            };
            requestAnimationFrame(tick);
          }),
        frames,
      );
    await measure(); // warm up the page
    return await measure();
  } finally {
    await context.close();
  }
}
