/**
 * The Phaser stage lab in a browser with WebGL switched off entirely (no GPU and no software fallback):
 * Phaser's AUTO renderer must drop to its 2D canvas renderer by itself and still draw the whole stage.
 * Its own file because `launchOptions` can only be set for a whole file (it needs its own browser).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openLab, SHOTS } from './stagelabkit';

test.use({ launchOptions: { args: ['--disable-3d-apis'] } });

test('AUTO falls back to the canvas renderer and still draws the whole stage', async ({ page }) => {
  const errors = await openLab(page);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__stagelab?.renderer)).toBe('CANVAS');
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'stagelab-canvas-fallback.png') });
});
