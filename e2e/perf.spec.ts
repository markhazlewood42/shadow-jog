/// <reference types="node" />
/**
 * Frame budget: per-frame work (simulation + render + present) must stay well inside the
 * 16.7 ms a 60 fps frame allows, in the busiest field scene and in a live battle.
 *
 * The second half of this file gates the NEW engine render stack on the engine lab page (M0, tooling-and-testing.md section 7): the frame
 * interval and the speed line. A JavaScript timer cannot see GPU cost (a draw call only submits commands), so the old gates alone would
 * stay green while frames drop.
 *
 * LOCAL ONLY: run it with `npm run perf` on a machine with a real GPU. CI does not run this file, because a software renderer says nothing
 * about GPU timing (Mark, 2026-10-09). The draw-call counts do not depend on the GPU, so they live in sje-draws.spec.ts, which CI runs.
 */
import { type Browser, expect, type Page, test } from '@playwright/test';
import { bareIntervals, isSoftware, mean, openLab, percentile, SPEED_LINE, speedLineMisses } from './sjelabkit';

async function sj<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

type Stats = { frames: number; mean: number; p95: number; max: number };

async function measure(page: Page, ms: number): Promise<Stats & { sim: Stats }> {
  await sj(page, 'sj.perf.reset()');
  await page.waitForTimeout(ms);
  return { ...(await sj<Stats>(page, 'sj.perf.stats()')), sim: await sj<Stats>(page, 'sj.perf.simStats()') };
}

// Timing on a shared machine: noise only ever adds time. A CI runner has neighbors, and one
// stretch of a run can be twice as slow as the next (round 2 of WP3 saw the same plaza read 8.79 ms
// in one CI attempt and 5.82 ms in the rerun of the same commit). So a scene is timed in SAMPLES
// separate windows, after the warm-up the caller does, and the gate reads the window with the lowest
// mean (its mean and its p95). The best of several windows is the usual way to time code on a
// shared machine. It cannot hide a real slowdown: a real slowdown adds time to every window, so
// the best one rises with it (the negative control of WP3 round 3 shows it: a 5 ms busy wait in
// every frame fails the gate). It can only drop a window that a neighbor spoiled.
const SAMPLES = 3;
/** The shortest window that still holds enough frames for a mean and a p95 (120 frames at 60 fps is 2.0 s). */
const MIN_FRAMES = 120;

/** Time a scene in SAMPLES windows of `ms` each. Returns the window with the lowest mean, and all of them. */
async function measureBest(page: Page, ms: number): Promise<{ best: Stats & { sim: Stats }; all: (Stats & { sim: Stats })[] }> {
  const all: (Stats & { sim: Stats })[] = [];
  for (let i = 0; i < SAMPLES; i++) all.push(await measure(page, ms));
  const best = all.reduce((a, b) => (b.mean < a.mean ? b : a));
  return { best, all };
}

// Two gates, so a regression fails on any machine, GPU or not:
//  1. Simulation (the ticks: pure JS, no canvas) must fit a strict budget everywhere.
//  2. Whole frames: strict with a GPU canvas (local); on a software canvas (GPU-less CI runners,
//     or PW_NOGPU=1 locally) the busiest scenes' p95 must still fit a 60 fps frame.
// (An earlier ratio-to-the-title gate assumed a software canvas slows every scene alike. It
// doesn't: unbounded composite ops made the field 26x the title on CI and 5x locally.)
const SIM_MEAN_MS = 2;
const SIM_P95_MS = 4;
const SOFTWARE = !!(process.env.CI || process.env.PW_NOGPU);
// CI's software canvas measures the plaza at 4.3 to 8.8 ms mean (WP3 readings, 640x360). The two
// readings above 7.5 (8.79 and 7.50) came from the round 2 code, before the overhead pass was
// clipped; the round 3 code, with this spec's best-of-3 windows, read 4.33 and 6.70 ms on CI. The
// spread is the runner: the title scene, which no change of ours touches, reads 0.97 to 1.66 ms
// across the same runs. So the software gate stays at 8 / 11 ms (mean / p95), where it was at 480x270.
// The rule (Mark, WP3 named fixes): a CI red from a slow runner gets ONE rerun and a note in the
// Record, never a gate change. Re-setting a gate is a separate step that comes after the
// optimizations (D15), stays inside the PL8 ceiling of 12.5 / 14.5 ms, and is written down with its
// evidence in docs/PIVOT-640.md. The GPU gate is 4 / 6 ms and holds locally with margin.
// Battle on software reads 1.6 to 3.0 ms and shares the gate.
const MEAN_MS = SOFTWARE ? 8 : 4;
const P95_MS = SOFTWARE ? 11 : 6;

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
  const { best: s, all } = await measureBest(page, 3000);
  console.log('field', JSON.stringify(s));
  console.log('field windows (mean, p95)', JSON.stringify(all.map((w) => [+w.mean.toFixed(2), +w.p95.toFixed(1)])));
  expect(s.frames).toBeGreaterThan(MIN_FRAMES);
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
  const topAtStart = await sj<string>(page, 'sj.top()');
  const { best: s, all } = await measureBest(page, 3000);
  console.log('battle', JSON.stringify(s));
  console.log('battle windows (mean, p95)', JSON.stringify(all.map((w) => [+w.mean.toFixed(2), +w.p95.toFixed(1)])));
  // The fight must still be on screen after the last window, or the later windows timed the field.
  expect(await sj<string>(page, 'sj.top()')).toBe(topAtStart);
  expect(s.frames).toBeGreaterThan(MIN_FRAMES);
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

// ------------------------------------------------------------------------------------------------
// The engine lab (M0): frame interval, draw calls, the speed line
// ------------------------------------------------------------------------------------------------


test.describe('engine lab: the speed line', () => {
  test('the rules of the speed line have teeth (pure check, no browser)', () => {
    const base = { bareP95: 17.7, sceneP95: 17.7, costP95: 2, software: false };
    expect(speedLineMisses(base)).toEqual([]);
    expect(speedLineMisses({ ...base, costP95: SPEED_LINE.costMs })).toEqual([]);
    expect(speedLineMisses({ ...base, costP95: 8.5 })).toHaveLength(1);
    expect(speedLineMisses({ ...base, sceneP95: 18.7 })).toHaveLength(1);
    expect(speedLineMisses({ ...base, sceneP95: 35, costP95: 30 })).toHaveLength(2);
    // On software GL only a stuck loop fails.
    expect(speedLineMisses({ ...base, software: true, sceneP95: SPEED_LINE.softwareStuckMs - 1, costP95: 40 })).toEqual([]);
    expect(speedLineMisses({ ...base, software: true, sceneP95: SPEED_LINE.softwareStuckMs })).toHaveLength(1);
  });

  /** The lab on the real loop, with the 3D frame (bloom on) running or not, warmed up. */
  async function runningScene(browser: Browser, three: boolean) {
    const lab = await openLab(browser, { query: '' });
    const { page } = lab;
    await page.evaluate(async (withThree) => {
      const h = window.__SJE__;
      if (!h) throw new Error('no hook');
      if (withThree) (await h.three()).start();
    }, three);
    await page.evaluate(() => window.__SJE__?.profileLoop(60)); // warm up: shaders, the first bloom frames
    return lab;
  }

  for (const three of [false, true]) {
    const what = three ? 'the 3D frame with bloom' : 'the 2D scene';
    test(`${what} keeps a sane frame interval, and on a GPU meets the speed line (interval p95 within 5% of a bare page, frame cost p95 at most 8 ms, GPU wait included)`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000);
      const frames = 300;
      const bare = await bareIntervals(browser, frames);
      const lab = await runningScene(browser, three);
      try {
        const { page } = lab;
        const soft = await isSoftware(page);
        // Run 1: the real loop as it is: the intervals, and the JavaScript time of the engine's work.
        const plain = await page.evaluate((n) => window.__SJE__?.profileLoop(n), frames);
        // Run 2: the same with a one pixel read-back after each draw, so the cost includes the GPU. It stalls the loop, so its intervals are not used.
        const synced = await page.evaluate((n) => window.__SJE__?.profileLoop(n, { sync: true }), 150);
        const intervals = (plain?.intervals ?? []).slice(30);
        const work = (plain?.work ?? []).slice(30);
        const cost = (synced?.cost ?? []).slice(20);
        const measured = { bareP95: percentile(bare, 0.95), sceneP95: percentile(intervals, 0.95), costP95: percentile(cost, 0.95), software: soft };
        const line =
          `SJE SPEED (${what}) on ${soft ? 'software GL' : 'a GPU'}: bare page p50 ${percentile(bare, 0.5).toFixed(2)} p95 ${measured.bareP95.toFixed(2)} ms | frame interval p50 ${percentile(intervals, 0.5).toFixed(2)} p95 ${measured.sceneP95.toFixed(2)} max ${Math.max(...intervals).toFixed(1)} ms | ` +
          `JavaScript work mean ${mean(work).toFixed(2)} p95 ${percentile(work, 0.95).toFixed(2)} ms | frame cost with the GPU wait mean ${mean(cost).toFixed(2)} p95 ${measured.costP95.toFixed(2)} ms`;
        console.log(line);
        testInfo.annotations.push({ type: 'speed', description: line });
        expect(intervals.length, 'interval samples').toBeGreaterThan(200);
        expect(cost.length, 'cost samples').toBeGreaterThan(100);
        expect(await page.evaluate(() => window.__SJE__?.tick() ?? 0), 'the real loop is ticking').toBeGreaterThan(100);
        // The speed line: all of it on a GPU; on software GL only "the loop is not stuck" (interval p95 under 250 ms).
        const misses = speedLineMisses(measured);
        expect(misses, `the speed line: ${misses.join('; ')}`).toEqual([]);
        if (!soft) expect(percentile(work, 0.95), 'JavaScript work p95').toBeLessThanOrEqual(SPEED_LINE.costMs);
        // A typical frame (p50) is under the loop's own clamp of 250 ms on any machine.
        expect(percentile(intervals, 0.5)).toBeLessThan(250);
        expect(lab.problems, 'console problems').toEqual([]);
      } finally {
        await lab.close();
      }
    });
  }

  test('NEGATIVE CONTROL: a scene made far too heavy (the 3D frame drawn many extra times a frame) FAILS the speed line, and the gauges see the extra load', async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const lab = await runningScene(browser, true);
    try {
      const { page } = lab;
      const soft = await isSoftware(page);
      const bare = await bareIntervals(browser, 150);
      // The normal scene first, for the comparison.
      const normalRun = await page.evaluate(() => window.__SJE__?.profileLoop(90, { sync: true }));
      const normal = { interval: percentile((normalRun?.intervals ?? []).slice(20), 0.95), cost: percentile((normalRun?.cost ?? []).slice(20), 0.95) };
      // A GPU shows the trouble at 600 extra frames; software GL (about 12 ms for one) is already at the stuck-loop line at 20.
      const EXTRA = soft ? 20 : 600;
      await page.evaluate(async (n) => (await window.__SJE__?.three())?.extraRenders(n), EXTRA);
      const heavyRun = await page.evaluate(() => window.__SJE__?.profileLoop(60, { sync: true }));
      const intervals = (heavyRun?.intervals ?? []).slice(10);
      const cost = (heavyRun?.cost ?? []).slice(10);
      const measured = { bareP95: percentile(bare, 0.95), sceneP95: percentile(intervals, 0.95), costP95: percentile(cost, 0.95), software: soft };
      const misses = speedLineMisses(measured);
      const line = `SJE SPEED NEGATIVE CONTROL (${EXTRA} extra 3D frames per frame, ${soft ? 'software GL' : 'a GPU'}): normal interval p95 ${normal.interval.toFixed(1)} cost p95 ${normal.cost.toFixed(1)} ms -> heavy interval p95 ${measured.sceneP95.toFixed(1)} cost p95 ${measured.costP95.toFixed(1)} ms; broken rules: ${JSON.stringify(misses)}`;
      console.log(line);
      testInfo.annotations.push({ type: 'speed-negative-control', description: line });
      // The same rules, on a scene that is too heavy, must report a miss. If this passed with an empty list, the speed test could not fail.
      expect(misses.length, 'the heavy scene breaks the speed line').toBeGreaterThan(0);
      if (!soft) {
        expect(misses, 'the interval rule fails on the heavy scene').toEqual(expect.arrayContaining([expect.stringContaining('interval')]));
        expect(misses, 'the cost rule fails on the heavy scene').toEqual(expect.arrayContaining([expect.stringContaining('cost')]));
      }
      // And the gauges see the load on any machine: the heavy cost is at least twice the normal cost.
      expect(measured.costP95).toBeGreaterThan(normal.cost * 2);
    } finally {
      await lab.close();
    }
  });
});

