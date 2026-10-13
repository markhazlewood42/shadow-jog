/**
 * The 3D mode on the GAME page, part D of four (M7; docs/engine/m7-brief.md pass lines 4 to 24): the jump: the way back is exact after each end, and the same pictures on two loads. CI runs the four parts in different shards, because the
 * one file `sje-hack.spec.ts` took 1,514 s on CI (software GL) and a shard may not pass 30 minutes. The helpers are in `e2e/sjehackkit.ts`; the `test()` calls stay here, because Playwright
 * names a test by the file that calls `test()`. The four parts hold exactly the 59 tests of the old file, with the same titles. Hooks and method: the header of `e2e/sjehackkit.ts`.
 *
 * Run:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-hack-d.spec.ts --project=chromium --reporter=line
 */
import { expect, test } from '@playwright/test';
import { sj, waitUntil } from './sjegamekit';
import { openTitle, openField, FIELD_STATE, freeze, frozenStep, TRANSITION, STYLES, restageFrozen, type Settled, settledPicture, diffPixels, PICTURE, sequence } from './sjehackkit';

test.describe('the jump between 2D and 3D: no bad frame, a held chunk, an exact way back (pass lines 19 to 24)', () => {
  // All four ends compare the same three things with the state before the jump: the field-state hash (map, leader, party, flags, camera), the settled picture (the frame hash, against a page that
  // was never covered and is stepped to the same field tick), and 0 shocks, hazes, glitches and particles. A drop leaves no scene, so a known field is put up again on both pages first
  // (the same frozen steps on each); what a drop leaves behind (a filter, an effect, a stuck cover) would show in that picture or in the counts. Each case ends with a control that the compare can fail.
  for (const end of ['success', 'fail', 'abort', 'drop'] as const) {
    for (const level of ['full', 'lite'] as const) {
      test(`fx ${level}: after a ${end} the 2D scene state and settled picture are the ones before${end === 'drop' ? ' (a drop leaves no scene: a known field is put up again, and nothing of the cover or the effects is in it)' : ', no effect is left, and the cover is gone'} (line 21)`, async ({ browser }) => {
        test.slow(); // The 2 s jack (60+60 ticks) makes every-frame capture slow on software GL.
        const query = `&jack=glitch&fx=${level}&seed=5`;
        const g = await openField(browser, { query, interior: true });
        let after: Settled;
        try {
          const { page } = g;
          const before = await sj<string>(page, FIELD_STATE);
          const jackCovers = () => sj<number>(page, "sj.game.screen.overlayRoot.list.filter((c) => c.name === 'jack').length");
          expect(await jackCovers()).toBe(0);
          const id = end === 'fail' ? 'test-fail' : end === 'success' ? 'test-short' : 'test-hack';
          await sj(page, `(window.__h = null, sj.hack(${JSON.stringify(id)}, { over: ${end === 'success' ? '{ ticks: 40 }' : '{}'} }).then((out) => { window.__h = out; }), true)`);
          if (end === 'abort' || end === 'drop') {
            expect(await waitUntil(page, 'sj.hackState().running && sj.hackState().tick > 20', 30_000)).toBe(true);
            await sj(page, end === 'abort' ? "(sj.hackTest.endHack('error'), true)" : '(sj.game.abandon(), true)');
          }
          expect(await waitUntil(page, 'window.__h !== null', 40_000)).toBe(true);
          const out = await sj<{ outcome: string; via: string }>(page, 'window.__h');
          expect(out).toMatchObject(
            { success: { outcome: 'success', via: 'played' }, fail: { outcome: 'fail', via: 'played' }, abort: { outcome: 'success', via: 'policy' }, drop: { outcome: 'fail', via: 'dropped' } }[end],
          );
          expect(await waitUntil(page, 'sj.jackState() === null', 10_000)).toBe(true);
          if (end === 'drop') {
            await restageFrozen(page);
          } else {
            expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 10_000)).toBe(true);
          }
          after = await settledPicture(page);
          expect(after.state, 'the field state is the state before').toBe(before);
          const counts = await sj<Record<string, number>>(page, 'sj.fxCounts()');
          expect([counts.shocks, counts.hazes, counts.glitches, counts.particles], 'no effect is left').toEqual([0, 0, 0, 0]);
          expect(await jackCovers(), 'the cover is gone').toBe(0);
          expect(await sj<boolean>(page, 'sj.hackState().running')).toBe(false);
          expect(g.problems).toEqual([]);
          if (end === 'success' && level === 'full') {
            // CONTROL: a layer left behind shows in the counts, and a field that moved shows in the state hash.
            await sj(page, '(sj.game.fx.glitch(320, 180, { w: 100, h: 60, strength: 5, life: 300 }), true)');
            expect((await sj<Record<string, number>>(page, 'sj.fxCounts()')).glitches, 'the control: a glitch layer is seen').toBeGreaterThan(0);
            await sj(page, '(sj.field().leader.x += 1, true)');
            expect(await sj<string>(page, FIELD_STATE), 'the control: a moved field is seen').not.toBe(before);
          }
          // CONTROL (the picture compare below can fail): a world left half faded, as a cover left behind would leave it, is far over the tolerance. (A field tick alone moves a channel by about 5 here.)
          await sj(page, '(sj.game.screen.worldRoot.node.alpha = 0.5, true)');
          const faded = await settledPicture(page);
          expect(faded.hash, 'the control: the hash sees a faded world').not.toBe(after.hash);
          expect(diffPixels(faded.shot, after.shot, PICTURE.tol), 'the control: a faded world is far over the limit').toBeGreaterThan(PICTURE.limit);
        } finally {
          await g.close();
        }
        // The reference: the same field on a page that never ran a hack, stepped to the same field tick.
        const ref = end === 'drop' ? await openTitle(browser, { query }) : await openField(browser, { query, interior: true });
        try {
          const { page } = ref;
          if (end === 'drop') await restageFrozen(page);
          else await freeze(page);
          const here = await settledPicture(page);
          expect(here.frame, 'the reference page is not past the frame').toBeLessThanOrEqual(after.frame);
          await frozenStep(page, after.frame - here.frame);
          const refPic = await settledPicture(page);
          expect(refPic.frame).toBe(after.frame);
          expect(refPic.state, 'the state is the state of a page that never jumped').toBe(after.state);
          expect(diffPixels(refPic.shot, after.shot, PICTURE.tol), 'pixels that differ from the never-covered page').toBeLessThanOrEqual(PICTURE.limit);
          expect(ref.problems).toEqual([]);
        } finally {
          await ref.close();
        }
      });
    }
  }

  for (const style of STYLES) {
    test(`${style}: the same style, seed and tick give the same frame hash on two page loads (line 24)${style === 'collapse' ? '' : '; CONTROL: another seed gives another picture'}`, async ({ browser }) => {
      test.slow(); // The 2 s jack (60+60 ticks) makes every-frame capture slow on software GL.
      const one = await sequence(browser, style, 5);
      const two = await sequence(browser, style, 5);
      expect(Object.keys(one).length, 'the frames of both rounds').toBe(2 * (TRANSITION.outTicks - 1) + 2 * TRANSITION.inTicks);
      expect(two).toEqual(one);
      if (style !== 'collapse') {
        const other = await sequence(browser, style, 6);
        const differing = Object.keys(one).filter((k) => one[k] !== other[k]).length;
        expect(differing, 'frames that differ with another seed').toBeGreaterThan(0);
      }
    });
  }
});
