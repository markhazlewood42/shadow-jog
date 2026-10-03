/**
 * The Phaser stage lab in a browser with WebGL switched off entirely (no GPU and no software fallback):
 * Phaser's AUTO renderer must drop to its 2D canvas renderer by itself and still draw the whole stage.
 *
 * WebGL is switched off from inside the page (an init script makes every WebGL `getContext` answer null, which
 * is what a browser without WebGL does) rather than with a launch flag. A `test.use({ launchOptions })` REPLACES
 * the project's launch options (found by running this on Playwright's own Chromium, where the project sets the
 * browser path: the flag version lost it and could not start), while an init script works on any browser and
 * leaves the project's setup alone. The flag version (`--disable-3d-apis`) passed on Edge in step 1 round 1.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openLab, SHOTS } from './stagelabkit';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the overloaded DOM method
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      // biome-ignore lint/suspicious/noExplicitAny: forwarding to the real overloaded method
      return (real as any).call(this, type, ...rest);
    };
  });
});

test('AUTO falls back to the canvas renderer and still draws the whole stage', async ({ page }) => {
  const errors = await openLab(page);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__stagelab?.renderer)).toBe('CANVAS');
  expect(await page.evaluate(() => window.__stagelab?.rowTints)).toBe(false);
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'stagelab-canvas-fallback.png') });
});
