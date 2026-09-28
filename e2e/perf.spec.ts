/**
 * Frame budget: per-frame work (simulation + render + present) must stay well inside the
 * 16.7 ms a 60 fps frame allows, in the busiest field scene and in a live battle.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

type Stats = { frames: number; mean: number; p95: number; max: number };

async function measure(page: Page, ms: number): Promise<Stats> {
  await sj(page, 'sj.perf.reset()');
  await page.waitForTimeout(ms);
  return sj<Stats>(page, 'sj.perf.stats()');
}

// Generous for shared CI runners; locally the numbers are a fraction of this.
const MEAN_MS = 8;
const P95_MS = 14;

test('field (Lantern Row plaza, rain, crowds) stays inside the frame budget', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1500);
  const s = await measure(page, 4000);
  console.log('field', JSON.stringify(s));
  expect(s.frames).toBeGreaterThan(120);
  expect(s.mean).toBeLessThan(MEAN_MS);
  expect(s.p95).toBeLessThan(P95_MS);
});

test('a live battle stays inside the frame budget', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('annex')");
  await page.waitForTimeout(1500);
  // Real rounds with FX, floaters and poses, auto-played.
  await sj(page, 'Object.assign(sj.debug, { playtest: true })');
  await sj(page, "sj.battle('annex', 'lab')");
  await page.waitForTimeout(1200);
  const s = await measure(page, 6000);
  console.log('battle', JSON.stringify(s));
  expect(s.frames).toBeGreaterThan(180);
  expect(s.mean).toBeLessThan(MEAN_MS);
  expect(s.p95).toBeLessThan(P95_MS);
});
