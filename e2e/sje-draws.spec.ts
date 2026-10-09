/**
 * Draw-call and framebuffer-bind budgets of the engine lab page (tooling-and-testing.md section 7). The counts come from a patch of
 * WebGL2RenderingContext.prototype, so every machine gives the same numbers, and the software renderer in CI is fine. This is the only
 * performance check that CI runs: timing lives in perf.spec.ts and runs locally on a GPU (npm run perf).
 */
import { expect, test } from '@playwright/test';
import { openLab } from './sjelabkit';

/** What the design budgets per frame (tooling-and-testing.md section 7, "Performance budget"; proposed, M1 sets the real gate). */
const DRAW_CALLS_MAX = 60;
const FRAMEBUFFER_BINDS_MAX = 30;

test.describe('engine lab: draw calls and framebuffer binds', () => {
  test('a frame stays inside the draw-call and framebuffer-bind budgets (counted by a patch of WebGL2RenderingContext.prototype, so any machine gives the same numbers); the control exceeds them', async ({ browser }) => {
    const lab = await openLab(browser, { countGl: true });
    try {
      const { page } = lab;
      const out = await page.evaluate(async () => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const w = window as unknown as { __gl: { draws: number; binds: number } };
        const measure = (n: number) => {
          h.render(); // one frame to settle
          w.__gl = { draws: 0, binds: 0 };
          for (let i = 0; i < n; i++) h.render();
          return { draws: w.__gl.draws / n, binds: w.__gl.binds / n };
        };
        const flat = measure(10);
        const t = await h.three();
        t.start();
        h.step(5);
        const bloom = measure(10);
        // The control: the 3D frame drawn 10 extra times a frame. The counter must see it.
        t.extraRenders(10);
        const heavy = measure(10);
        t.extraRenders(0);
        t.stop();
        return { flat, bloom, heavy };
      });
      console.log(`SJE draw calls per frame: 2D scene ${JSON.stringify(out.flat)}; 3D frame with bloom ${JSON.stringify(out.bloom)}; control (10 extra 3D frames) ${JSON.stringify(out.heavy)}`);
      // Hardware independent. The 2D scene is a handful of draws and 2 binds (the back buffer and the canvas).
      for (const [name, m] of [
        ['2D scene', out.flat],
        ['3D frame with bloom', out.bloom],
      ] as const) {
        expect(m.draws, `${name}: draw calls per frame`).toBeGreaterThan(0);
        expect(m.draws, `${name}: draw calls per frame`).toBeLessThanOrEqual(DRAW_CALLS_MAX);
        expect(m.binds, `${name}: framebuffer binds per frame`).toBeLessThanOrEqual(FRAMEBUFFER_BINDS_MAX);
      }
      expect(out.heavy.draws, 'the control exceeds the draw-call budget').toBeGreaterThan(DRAW_CALLS_MAX);
      expect(out.heavy.binds, 'the control exceeds the bind budget').toBeGreaterThan(FRAMEBUFFER_BINDS_MAX);
      expect(lab.problems).toEqual([]);
    } finally {
      await lab.close();
    }
  });
});
