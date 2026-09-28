/// <reference types="node" />
/**
 * Frame budget: per-frame work (simulation + render + present) must stay well inside the
 * 16.7 ms a 60 fps frame allows, in the busiest field scene and in a live battle.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

type Stats = { frames: number; mean: number; p95: number; max: number };

async function measure(page: Page, ms: number): Promise<Stats & { sim: Stats }> {
  await sj(page, 'sj.perf.reset()');
  await page.waitForTimeout(ms);
  return { ...(await sj<Stats>(page, 'sj.perf.stats()')), sim: await sj<Stats>(page, 'sj.perf.simStats()') };
}

// Three gates, so a regression fails on any machine, GPU or not:
//  1. Simulation (the ticks: pure JS, no canvas) must fit a strict budget everywhere.
//  2. Whole frames are judged against the title screen measured on the same machine: CI's
//     software canvas slows both alike, so the ratio still catches a heavy scene.
//  3. An absolute ceiling: strict locally (GPU canvas), coarse on GPU-less CI runners.
const SIM_MEAN_MS = 2;
const SIM_P95_MS = 4;
const RATIO = 10; // the busiest field sits near 5x the title; 10x catches a doubling
const MEAN_MS = process.env.CI ? 45 : 8;
const P95_MS = process.env.CI ? 70 : 14;

let baseline = 0;
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/?debug');
  await page.waitForTimeout(1500);
  const s = await measure(page, 2500);
  baseline = Math.max(0.25, s.mean);
  console.log('title baseline', JSON.stringify(s));
  await page.close();
});

function gate(s: Stats & { sim: Stats }): void {
  expect(s.sim.mean).toBeLessThan(SIM_MEAN_MS);
  expect(s.sim.p95).toBeLessThan(SIM_P95_MS);
  expect(s.mean / baseline, `frame cost ${s.mean.toFixed(2)} ms vs title ${baseline.toFixed(2)} ms`).toBeLessThan(RATIO);
  expect(s.mean).toBeLessThan(MEAN_MS);
  expect(s.p95).toBeLessThan(P95_MS);
}

test('field (Lantern Row plaza, rain, crowds) stays inside the frame budget', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1500);
  const s = await measure(page, 4000);
  console.log('field', JSON.stringify(s));
  expect(s.frames).toBeGreaterThan(120);
  gate(s);
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
  gate(s);
});
