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

// Two gates, so a regression fails on any machine, GPU or not:
//  1. Simulation (the ticks: pure JS, no canvas) must fit a strict budget everywhere.
//  2. Whole frames: strict with a GPU canvas (local); on a software canvas (GPU-less CI runners,
//     or PW_NOGPU=1 locally) the busiest scenes must still fit a 60 fps frame.
// (An earlier ratio-to-the-title gate assumed a software canvas slows every scene alike. It
// doesn't: unbounded composite ops made the field 26x the title on CI and 5x locally.)
const SIM_MEAN_MS = 2;
const SIM_P95_MS = 4;
const SOFTWARE = !!(process.env.CI || process.env.PW_NOGPU);
const MEAN_MS = SOFTWARE ? 16.7 : 4;
const P95_MS = SOFTWARE ? 25 : 6;

// The title's cost, logged for context in the evidence (the machine's floor), not gated.
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/?debug');
  await page.waitForTimeout(1500);
  console.log('title baseline', JSON.stringify(await measure(page, 2500)));
  await page.close();
});

function gate(s: Stats & { sim: Stats }): void {
  expect(s.sim.mean).toBeLessThan(SIM_MEAN_MS);
  expect(s.sim.p95).toBeLessThan(SIM_P95_MS);
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

/**
 * Input latency: keydown to the first frame whose game state shows the response, measured in
 * the page (a capture-phase keydown listener, then a per-frame check). Movement and opening the
 * menu both answer on the next tick; the gate allows two frames plus a frame of measurement slack.
 */
test('input answers within two frames (field movement, opening the menu)', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  await sj(page, "sj.stage('town')");
  await page.waitForTimeout(1500);
  // In play the title screen takes the first keypress, which is what unlocks audio (creating the
  // AudioContext costs the browser ~25 ms). Do the same here so the probes measure steady state.
  await page.keyboard.press('Shift');
  await page.waitForTimeout(500);
  const probe = async (key: string, changed: string): Promise<number> => {
    await page.evaluate(`(() => {
      const sj = window.__SJ__;
      const before = (${changed})(sj);
      window.__lat = -1;
      let tKey = 0;
      window.addEventListener('keydown', () => { tKey = performance.now(); }, { capture: true, once: true });
      const poll = () => {
        if (tKey && (${changed})(sj) !== before) { window.__lat = performance.now() - tKey; return; }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    })()`);
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
    return page.evaluate('window.__lat') as Promise<number>;
  };
  const move: number[] = [];
  for (let i = 0; i < 8; i++) {
    move.push(await probe(i % 2 ? 'ArrowLeft' : 'ArrowRight', '(sj) => { const l = sj.field().leader; return l.px + ":" + l.dir; }'));
  }
  const menu: number[] = [];
  for (let i = 0; i < 4; i++) {
    menu.push(await probe('Escape', '(sj) => sj.top()'));
    await page.waitForTimeout(300);
    // Close it again (the probe's own keydown listener is spent).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
  console.log('input latency ms', JSON.stringify({ move: move.map((v) => +v.toFixed(1)), menu: menu.map((v) => +v.toFixed(1)), moveMedian: median(move), menuMedian: median(menu) }));
  expect(Math.min(...move, ...menu)).toBeGreaterThanOrEqual(0);
  // Two frames at 60 fps; a single outlier gets one more.
  expect(median(move)).toBeLessThan(34);
  expect(median(menu)).toBeLessThan(34);
  expect(Math.max(...move, ...menu)).toBeLessThan(50);
});
