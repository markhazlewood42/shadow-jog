/**
 * Draw-call and framebuffer-bind budgets of the engine lab page (tooling-and-testing.md section 7). The counts come from a patch of
 * WebGL2RenderingContext.prototype, so every machine gives the same numbers, and the software renderer in CI is fine. This is the only
 * performance check that CI runs: timing lives in perf.spec.ts and runs locally on a GPU (npm run perf).
 */
import { expect, test } from '@playwright/test';
import { glErrors, openProbe } from './sjefxkit';
import { installGlCounters, sj } from './sjegamekit';
import { openLab } from './sjelabkit';
import { openStage } from './sjestagekit';

/** What the design budgets per frame (tooling-and-testing.md section 7, "Performance budget"; proposed, M1 sets the real gate). */
const DRAW_CALLS_MAX = 60;
const FRAMEBUFFER_BINDS_MAX = 30;
/** The real game at `full` with every effect alive (measured in M2; see the console line of the test below, and tooling-and-testing.md section 7). */
const STACK_DRAWS_MAX = 24; // measured 16 on SwiftShader and CI's Chromium (bare frame: 4)
const STACK_BINDS_MAX = 24; // measured 17 (bare frame: 4)
const STACK_UPLOADS_MAX = 4; // measured 3 canvas uploads (bare frame: 2)

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

  test('the real game with the full effect stack: draw calls and framebuffer binds per frame are written down and bounded; 10 enter and exit cycles with the stack on leave the GL counts flat (a leaking scene grows them)', async ({ browser }) => {
    const g = await openProbe(browser, 'full', { init: installGlCounters });
    try {
      const { page } = g;
      const out = await sj<{
        bare: { draws: number; binds: number; uploads: number };
        stack: { draws: number; binds: number; uploads: number };
        base: Record<string, number>;
        after: Record<string, number>;
        leaked: Record<string, number>;
        toggleBase: Record<string, number>;
        toggled: Record<string, number>;
        particles: number;
        cap: number;
      }>(
        page,
        `(async () => {
          const fx = sj.game.fx;
          const w = window;
          const measure = (n) => {
            sj.step(0);
            w.__gl = { draws: 0, binds: 0, uploads: 0, uploadBytes: 0 };
            for (let i = 0; i < n; i++) sj.step(0);
            return { draws: w.__gl.draws / n, binds: w.__gl.binds / n, uploads: w.__gl.uploads / n };
          };
          // The stack: every effect alive, the glow layer and the UI layer drawn into. Ticks do not run (step(0)), so it stays as it is.
          const raise = () => {
            window.__probe.glow = { x: 300, y: 150, w: 40, h: 30 };
            sj.postfx.shock(200, 120, { strength: 6, reach: 90, life: 600, width: 10 });
            sj.postfx.shock(420, 220, { strength: 6, reach: 90, life: 600, width: 10 });
            sj.postfx.aberrate(4, 320, 180);
            sj.postfx.haze(320, 180, { radius: 60, strength: 3, life: 600 });
            sj.postfx.glitch(120, 250, { w: 100, h: 60, strength: 12, life: 600 });
            sj.postfx.dim(0.4, 600);
            sj.postfx.emit(sj.fx.presets.crit_sparks, 320, 180);
            sj.postfx.emit(sj.fx.presets.glitch, 100, 100);
            sj.step(20);
            sj.game.speed = 0;
          };
          const bare = measure(10);
          raise();
          const stack = measure(10);
          fx.clear();
          // The cycle: a scene enters (it draws into the glow and UI layers), the moments play, it closes. 'leak' also makes a texture nobody frees.
          const cycle = async (n, leak) => {
            for (let i = 0; i < n; i++) {
              const probe = new window.__Probe();
              const done = sj.game.run(probe);
              fx.playMoment('spell.fire', 200, 140);
              fx.playMoment('crit', 320, 180);
              sj.postfx.dim(0.4, 30);
              sj.step(4);
              if (leak) {
                const key = 'leak-' + Math.random();
                const made = sj.game.textures.createCanvas(key, 8, 8);
                made.ctx.fillRect(0, 0, 8, 8);
                made.refresh();
                const shown = new (await import('/src/sje/display/imageobject.ts')).ImageObject(sj.game, 0, 0, key);
                sj.game.screen.overlayRoot.add(shown);
                sj.step(1);
                shown.destroy();
              }
              probe.close(undefined);
              await done;
              sj.step(2);
              fx.clear();
              sj.step(1);
            }
            const c = sj.glCounts();
            return { texture: c.texture, buffer: c.buffer, framebuffer: c.framebuffer, program: c.program, vao: c.vao };
          };
          await cycle(1, false);
          const base = await cycle(1, false);
          const after = await cycle(10, false);
          const particles = fx.particles.count;
          const cap = fx.particles.cap;
          // The level switch builds the layers and frees them again: render textures, filters and particle containers must not pile up.
          const toggle = async (n) => {
            for (let i = 0; i < n; i++) {
              sj.game.fxLevel = 'none';
              sj.step(1);
              sj.game.fxLevel = 'full';
              fx.playMoment('spell.fire', 200, 140);
              sj.step(2);
              fx.clear();
            }
            const c = sj.glCounts();
            return { texture: c.texture, buffer: c.buffer, framebuffer: c.framebuffer, program: c.program, vao: c.vao };
          };
          await toggle(1);
          const toggleBase = await toggle(1);
          const toggled = await toggle(10);
          const leaked = await cycle(10, true);
          return { bare, stack, base, after, leaked, particles, cap, toggleBase, toggled };
        })()`,
      );
      console.log(`SJE draws, real game: bare frame ${JSON.stringify(out.bare)}; full effect stack ${JSON.stringify(out.stack)}; GL objects after 1 cycle ${JSON.stringify(out.base)}, after 10 more ${JSON.stringify(out.after)}`);
      // Hardware independent counts. The numbers above are the record; the bounds sit a little over them.
      expect(out.stack.draws, 'the stack draws more than the bare frame (control: the counter sees the effects)').toBeGreaterThan(out.bare.draws);
      expect(out.stack.draws, 'draw calls per frame with the full effect stack').toBeLessThanOrEqual(STACK_DRAWS_MAX);
      expect(out.stack.binds, 'framebuffer binds per frame with the full effect stack').toBeLessThanOrEqual(STACK_BINDS_MAX);
      expect(out.stack.uploads, 'canvas uploads per frame with the full effect stack').toBeLessThanOrEqual(STACK_UPLOADS_MAX);
      // No leak: render textures, framebuffers, programs, buffers and vertex arrays are the same after ten more cycles; no particle outlives the cycle.
      expect(out.after).toEqual(out.base);
      expect(out.toggled, '10 switches of the level none and full leave the GL counts flat').toEqual(out.toggleBase);
      expect(out.particles).toBe(0);
      expect(out.cap).toBe(4096);
      expect(out.leaked.texture, 'control: leaking on purpose grows the texture count').toBeGreaterThan(out.after.texture ?? 0);
      expect(await glErrors(page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

/** The battle stage frame (M3), at `full` with the effect stack alive: what a frame may draw, as an upper bound. The M3 builder A numbers (the stage slice and the five moments of fxRaise, not the HUD or the battle fx painters of builder B): see the console line of the test. */
const BATTLE_DRAWS_MAX = 16; // measured 13 on SwiftShader and on the GPU (bare stage frame: 3)
const BATTLE_BINDS_MAX = 20; // measured 17 (bare stage frame: 4)

test.describe('battle stage: draw calls and framebuffer binds', () => {
  test('a battle frame (the stage, two figures, the whole effect stack) stays inside the draw-call and bind budgets (counted by a patch of WebGL2RenderingContext.prototype); 10 enter and exit cycles leave the GL counts flat, and a leak on purpose does not', async ({ browser }) => {
    const lab = await openStage(browser, { query: 'manual&fx=full', countGl: true });
    try {
      const { page } = lab;
      const out = await page.evaluate(async () => {
        const h = window.__SJESTAGE__;
        if (!h) throw new Error('no hook');
        const w = window as unknown as { __gl: { draws: number; binds: number } };
        const measure = (n: number) => {
          h.render(); // one frame to settle
          w.__gl = { draws: 0, binds: 0 };
          for (let i = 0; i < n; i++) h.render();
          return { draws: w.__gl.draws / n, binds: w.__gl.binds / n };
        };
        await h.show({ tick: 41, sprites: 'standins' });
        h.fxClear();
        const bare = measure(10);
        h.fxRaise(10);
        const stack = measure(10);
        h.fxClear();
        // The cycle: a battle scene enters (the stage, its figures, its shadows and rings) and leaves. Warm up first: the first cycles make the cached pictures.
        await h.reenter(4);
        const base = h.glCounts();
        await h.reenter(10);
        const after = h.glCounts();
        h.leakOnPurpose(6);
        const leaked = h.glCounts();
        return { bare, stack, base, after, leaked };
      });
      console.log(`SJE draws, battle stage: bare frame ${JSON.stringify(out.bare)}; full effect stack ${JSON.stringify(out.stack)}; GL objects after the warm-up ${JSON.stringify(out.base)}, after 10 more cycles ${JSON.stringify(out.after)}`);
      expect(out.bare.draws, 'the counter sees the stage').toBeGreaterThan(0);
      expect(out.stack.draws, 'the stack draws more than the bare frame (control: the counter sees the effects)').toBeGreaterThan(out.bare.draws);
      expect(out.stack.draws, 'draw calls per battle frame with the full effect stack').toBeLessThanOrEqual(BATTLE_DRAWS_MAX);
      expect(out.stack.binds, 'framebuffer binds per battle frame with the full effect stack').toBeLessThanOrEqual(BATTLE_BINDS_MAX);
      expect(out.after, '10 enter and exit cycles leave the GL object counts flat').toEqual(out.base);
      expect(out.leaked.texture, 'control: leaking on purpose grows the texture count').toBeGreaterThan(out.after.texture ?? 0);
      expect(lab.problems.filter((p) => !/GPU stall/.test(p))).toEqual([]);
    } finally {
      await lab.close();
    }
  });
});
