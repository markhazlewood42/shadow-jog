/**
 * The 3D mode on the GAME page, part C of four (M7; docs/engine/m7-brief.md pass lines 4 to 24): the jump: a slow chunk is held with a moving picture, and the picture after jack out with no effects. CI runs the four parts in different shards, because the
 * one file `sje-hack.spec.ts` took 1,514 s on CI (software GL) and a shard may not pass 30 minutes. The helpers are in `e2e/sjehackkit.ts`; the `test()` calls stay here, because Playwright
 * names a test by the file that calls `test()`. The four parts hold exactly the 59 tests of the old file, with the same titles. Hooks and method: the header of `e2e/sjehackkit.ts`.
 *
 * Run:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-hack-c.spec.ts --project=chromium --reporter=line
 */
import { expect, test } from '@playwright/test';
import { sj } from './sjegamekit';
import { openTitle, openField, freeze, frozenStep, TRANSITION, STYLES, LEVELS, capture, holdProblems, chunkUrl, HOLD_FRAMES, SLOW_RUNNER_BOUND, holdChunkFor } from './sjehackkit';

test.describe('the jump between 2D and 3D: no bad frame, a held chunk, an exact way back (pass lines 19 to 24)', () => {
  for (const style of STYLES) {
    for (const level of LEVELS) {
      test(`${style} at fx ${level}: a slow chunk is held with a moving picture (never blank), then the reveal runs in full and the hack plays (line 20, case 1)`, async ({ browser }) => {
        const g = await openTitle(browser, { query: `&jack=${style}&fx=${level}&seed=5` });
        try {
          const { page } = g;
          const gate = holdChunkFor(HOLD_FRAMES);
          await page.route(chunkUrl, async (route) => {
            await gate.released;
            await route.continue();
          });
          await sj(page, SLOW_RUNNER_BOUND);
          const frames = await capture(page, 'test-short', { over: { ticks: 30 } }, { pause: 14, maxSteps: 1500, onFrame: gate.watch });
          expect(holdProblems(frames)).toEqual([]);
          expect(frames.filter((f) => f.phase === 'in').length, 'the reveal ran in full (the jack-in round and the jack-out round)').toBe(2 * TRANSITION.inTicks);
          expect(await sj(page, 'window.__h.out')).toMatchObject({ outcome: 'success', via: 'played' });
          expect(g.problems).toEqual([]);
        } finally {
          await g.close();
        }
      });
    }
  }


  test('fx none: the settled picture after jack out equals the picture of a run that was never covered, at the same field frame', async ({ browser }) => {
    const q = '&jack=glitch&fx=none&seed=5';
    const a = await openField(browser, { query: q, interior: true });
    let f1 = 0;
    let hashA = '';
    try {
      const { page } = a;
      await capture(page, 'test-short', { over: { ticks: 30 } }, { afterDone: 6 });
      expect(await sj(page, 'sj.jackState()')).toBeNull();
      f1 = await sj<number>(page, 'sj.field().frame');
      hashA = await sj<string>(page, '(sj.step(0), sj.frameHash())');
      expect(a.problems).toEqual([]);
    } finally {
      await a.close();
    }
    const b = await openField(browser, { query: q, interior: true });
    try {
      const { page } = b;
      await freeze(page);
      const fb = await sj<number>(page, 'sj.field().frame');
      expect(fb, 'the reference run is not past the frame').toBeLessThanOrEqual(f1);
      await frozenStep(page, f1 - fb);
      expect(await sj<number>(page, 'sj.field().frame')).toBe(f1);
      expect(await sj<string>(page, '(sj.step(0), sj.frameHash())'), 'the settled picture').toBe(hashA);
      // CONTROL: one more tick is another picture (the hash is not constant).
      await frozenStep(page, 7);
      expect(await sj<string>(page, '(sj.step(0), sj.frameHash())')).not.toBe(hashA);
    } finally {
      await b.close();
    }
  });
});
