/**
 * The 3D mode on the GAME page, part B of four (M7; docs/engine/m7-brief.md pass lines 4 to 24): the jump: every frame judged for three styles at three effects levels, the hold control and the hold bound. CI runs the four parts in different shards, because the
 * one file `sje-hack.spec.ts` took 1,514 s on CI (software GL) and a shard may not pass 30 minutes. The helpers are in `e2e/sjehackkit.ts`; the `test()` calls stay here, because Playwright
 * names a test by the file that calls `test()`. The four parts hold exactly the 59 tests of the old file, with the same titles. Hooks and method: the header of `e2e/sjehackkit.ts`.
 *
 * Run:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-hack-b.spec.ts --project=chromium --reporter=line
 */
import { expect, test } from '@playwright/test';
import { openGame, sj, waitTop, waitUntil } from './sjegamekit';
import { openTitle, FIELD_STATE, glErrors, TRANSITION, UNIFORM, STYLES, LEVELS, capture, uniformProblems, holdProblems, chunkUrl, HOLD_FRAMES, SLOW_RUNNER_BOUND, holdChunkFor } from './sjehackkit';

test.describe('the jump between 2D and 3D: no bad frame, a held chunk, an exact way back (pass lines 19 to 24)', () => {
  for (const style of STYLES) {
    for (const level of LEVELS) {
      test(`${style} at fx ${level}: every frame of jack in and jack out is judged (lines 19, 22, 23): no undeclared one-color frame, 0 GL errors, 0 console warnings`, async ({ browser }) => {
        const g = await openTitle(browser, { query: `&jack=${style}&fx=${level}&seed=5` });
        try {
          const { page } = g;
          const frames = await capture(page, 'test-short', { over: { ticks: 40 } });
          const out = await sj<{ outcome: string; via: string }>(page, 'window.__h.out');
          expect(out).toMatchObject({ outcome: 'success', via: 'played' });
          // The phases, in order: the cover's first round (jack in) and its second (jack out).
          const phases = frames.map((f) => f.phase).filter((p, i, all) => p !== all[i - 1]);
          expect(phases.filter((p) => p !== null)).toEqual(expect.arrayContaining(['out', 'swap', 'in']));
          expect(phases.filter((p) => p === 'out')).toHaveLength(2);
          expect(phases.filter((p) => p === 'swap')).toHaveLength(2);
          // (The first tick of `out` is painted before the first step, so a capture sees ticks 1 to outTicks - 1 of each round.)
          expect(frames.filter((f) => f.phase === 'out')).toHaveLength(2 * (TRANSITION.outTicks - 1));
          expect(frames.filter((f) => f.phase === 'in')).toHaveLength(2 * TRANSITION.inTicks);
          // Line 19.
          expect(uniformProblems(frames, UNIFORM[style][level])).toEqual([]);
          // Line 23: at none, no effects call and no world filter; at lite no world filter; at full the glitch style uses its effects.
          if (level === 'none') expect(frames.map((f) => f.fxCalls).at(-1)).toBe(0);
          if (level !== 'full') expect(Math.max(...frames.map((f) => f.filters)), 'a filter is on the world').toBe(0);
          if (level === 'full' && style === 'glitch') expect(frames.map((f) => f.fxCalls).at(-1)).toBeGreaterThan(0);
          // Line 22: the 3D scene was on screen under the reveal, and nothing broke.
          expect(frames.some((f) => f.phase === 'in' && f.running)).toBe(true);
          expect(await glErrors(page)).toEqual([]);
          expect(g.problems).toEqual([]);
        } finally {
          await g.close();
        }
      });
    }
  }


  test('CONTROL: a style with its hold element turned off shows a blank, frozen hold in case 1 and fails the check', async ({ browser }) => {
    const g = await openTitle(browser, { query: '&jack=glitch&fx=none&seed=5' });
    try {
      const { page } = g;
      const gate = holdChunkFor(HOLD_FRAMES);
      await page.route(chunkUrl, async (route) => {
        await gate.released;
        await route.continue();
      });
      await sj(page, SLOW_RUNNER_BOUND);
      await sj(page, '(sj.hackTest.skipHoldUi(true), true)');
      const frames = await capture(page, 'test-short', { over: { ticks: 30 } }, { pause: 14, maxSteps: 1500, onFrame: gate.watch });
      // The hold was long enough to judge, so the failure is the picture itself (blank or frozen), not a short hold.
      expect(frames.filter((f) => f.phase === 'hold').length).toBeGreaterThanOrEqual(20);
      expect(holdProblems(frames).length).toBeGreaterThan(0);
    } finally {
      await g.close();
    }
  });

  // Line 20, case 2: the chunk never arrives. The hold bound (1,500 ms here) ends it: unsupported / chunk-failed, the story goes on, the 2D scene is back clean (line 21).
  for (const level of ['full', 'none'] as const) {
    test(`fx ${level}: the chunk never completes and holdBoundMs is 1500: unsupported / chunk-failed after about 1.5 s of hold, the story continues, and the 2D scene is back with no effect left`, async ({ browser }) => {
      const g = await openGame(browser, { query: `&jack=glitch&fx=${level}&seed=5`, allow: [/\[sje\] the 3D chunk took longer/] });
      try {
        const { page } = g;
        expect(await waitTop(page, 'TitleScene')).toBe(true);
        await sj(page, "sj.stage('town')");
        expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
        const before = await sj<string>(page, FIELD_STATE);
        await page.route(chunkUrl, () => {
          /* the request never completes */
        });
        await sj(page, "(sj.hackDev.set({ options: { jack: { params: { holdBoundMs: 1500 } } } }), true)");
        // The page notes when the hold begins (a 5 ms poll) and when the story gets its answer.
        await sj(
          page,
          `(() => { const st = (window.__story = { log: [], done: false, outcome: null, holdAt: 0, at: 0 });
            const poll = setInterval(() => { const j = sj.jackState(); if (j && j.phase === 'hold' && !st.holdAt) { st.holdAt = performance.now(); clearInterval(poll); } }, 5);
            sj.field().runScript(async (s) => { st.log.push('line-1'); st.outcome = await s.hack(sj.hackDef('test-short'), { playAlternative: async () => { st.log.push('alternative'); return 'success'; } }); st.at = performance.now(); st.log.push('line-2'); }).then(() => { st.done = true; });
            return true; })()`,
        );
        expect(await waitUntil(page, 'window.__story.done', 20_000)).toBe(true);
        const st = await sj<{ log: string[]; outcome: { outcome: string; via: string; results: Array<{ status: string; reason?: string }> }; holdAt: number; at: number }>(page, 'window.__story');
        expect(st.outcome.results).toEqual([{ status: 'unsupported', reason: 'chunk-failed' }]);
        expect(st.log, 'the story continues: the 2D alternative, then the next line').toEqual(['line-1', 'alternative', 'line-2']);
        expect(st.holdAt, 'the hold began').toBeGreaterThan(0);
        expect(st.at - st.holdAt, 'ms from the start of the hold to the answer').toBeGreaterThan(1000);
        expect(st.at - st.holdAt).toBeLessThan(2000);
        // The way back runs for 24 more ticks, then the cover is gone and nothing is left of it (line 21).
        expect(await waitUntil(page, 'sj.jackState() === null', 10_000)).toBe(true);
        expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 10_000)).toBe(true);
        expect(await sj<string>(page, FIELD_STATE)).toBe(before);
        expect(await sj<Record<string, number>>(page, 'sj.fxCounts()')).toMatchObject({ shocks: 0, hazes: 0, glitches: 0 });
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }
});
