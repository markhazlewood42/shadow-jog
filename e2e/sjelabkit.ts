/**
 * Shared helpers for the engine lab's 3D specs (e2e/sje3d.spec.ts, e2e/sje-parta.spec.ts,
 * e2e/sje3d-browsers.spec.ts): open the lab page with a clock the test drives, collect the console
 * messages that count as problems, start a hack and wait for its scene.
 *
 * (e2e/sjelab.spec.ts, the B0 spec, has its own copy of `openLab`. It is left as it was.)
 */
import { type Browser, expect, type Page } from '@playwright/test';

/**
 * The picture size under test. Default 480x270. `SJE_SIZE=640x360` runs the same specs on the 640x360 picture (step S1a): every page is opened
 * with `?size=640x360` (the DEV switch in `src/sje/core/size.ts`) and every size or zoom that a spec checks comes from here, not from a typed number.
 * Only `640x360` is accepted; anything else means 480x270, as the page itself does.
 */
export const SIZE: { w: number; h: number; is640: boolean; query: string } = process.env.SJE_SIZE === '640x360' ? { w: 640, h: 360, is640: true, query: 'size=640x360' } : { w: 480, h: 270, is640: false, query: '' };

/** `query` with the size switch added when the run is at 640x360. */
export function withSize(query: string): string {
  return SIZE.query ? `${query}&${SIZE.query}` : query;
}

/**
 * The integer zoom the presenter picks for a window, by its own rule (`src/sje/render/presenter.ts`): the largest whole k with k x W and k x H inside the window in
 * device pixels. A spec at 480x270 passes the zoom it has always written (`tableK`) and gets it back: that value is a hard-coded check. At 640x360 the table
 * does not apply (a different picture fits a window a different number of times), so the zoom is computed.
 */
export function zoomFor(tableK: number, viewport: { width: number; height: number }, dpr: number): number {
  if (!SIZE.is640) return tableK;
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
  /** Query string after `/sjelab.html?`. Default `manual` (the test drives the clock). Add `&frame=canvas-copy` to pick the fallback frame. */
  query?: string;
  /** Console messages that are expected in THIS test (matched against the text). */
  allow?: RegExp[];
}

/** Chrome's own performance hint when a page reads pixels back. Only the lab's test hook does that. */
const ALWAYS_ALLOWED = [
  /GPU stall due to ReadPixels/,
  // Vite's hot-reload socket can fail to connect while the dev server is busy. Tooling noise, not the engine.
  /WebSocket connection to 'ws:\/\/localhost:\d+\/\?token=/,
];

/** Open the lab and wait for it to be ready. */
export async function openLab(browser: Browser, opts: OpenOptions = {}): Promise<LabPage> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 960, height: 540 }, deviceScaleFactor: opts.dpr ?? 1 });
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
  const boot = async (): Promise<string | undefined> => {
    await page.goto(`/sjelab.html?${withSize(opts.query ?? 'manual')}`);
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

/** Start one hack through the door and wait until its scene is on the stack (the first call downloads the 3D chunk). */
export async function startHack(page: Page, def: Parameters<NonNullable<Window['__SJE__']>['hackStart']>[0] = {}, opts: { hud?: boolean } = {}): Promise<void> {
  await page.evaluate(
    ([d, hud]) => {
      const h = window.__SJE__;
      if (!h) throw new Error('no hook');
      h.hackHud(hud as boolean);
      h.hackStart(d as Parameters<typeof h.hackStart>[0]);
    },
    [def, opts.hud ?? true] as const,
  );
  await page.waitForFunction(() => window.__SJE__?.scenes().includes('HackScene') === true, null, { timeout: 60_000 });
}

/** Run `n` ticks and one draw. */
export async function step(page: Page, n: number): Promise<string> {
  return page.evaluate((k) => window.__SJE__?.step(k) ?? '', n);
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

/** Is this lab drawing with a software renderer (SwiftShader, llvmpipe)? */
export async function isSoftware(page: Page): Promise<boolean> {
  const info = await page.evaluate(() => window.__SJE__?.info());
  return /swiftshader|llvmpipe|software/i.test(info?.renderer ?? '');
}
