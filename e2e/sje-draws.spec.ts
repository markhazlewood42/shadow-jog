/**
 * Draw-call and framebuffer-bind budgets of the engine lab page (tooling-and-testing.md section 7). The counts come from a patch of
 * WebGL2RenderingContext.prototype, so every machine gives the same numbers, and the software renderer in CI is fine. This is the only
 * performance check that CI runs: timing lives in perf.spec.ts and runs locally on a GPU (npm run perf).
 */
import { expect, test } from '@playwright/test';
import { glErrors, openProbe } from './sjefxkit';
import { installGlCounters, openGame, sj, waitTop, waitUntil } from './sjegamekit';
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

/**
 * The SHIPPED battle on the stage (M3 task 6, pass line 10): the real game under the flag with a battle on, at `full`: the stage, the figures, the HUD, the effects layer, the floating
 * numbers, and the whole GPU effect stack on top. The numbers are the record (the console line); the bounds sit a little over them. What a frame draws is counted by the patch of
 * `WebGL2RenderingContext.prototype` (hardware independent). Builder A's lab case above has the bare stage; this one adds what Builder B put on it.
 */
const LIVE_DRAWS_MAX = 26; // measured 20 with the stack on SwiftShader (18 waiting for orders)
const LIVE_BINDS_MAX = 22; // measured 17
const LIVE_UPLOADS_MAX = 6; // measured 4 canvas uploads (3 waiting for orders: the old UI canvas, the effects canvas, the glow layer)

test.describe('the shipped battle on the stage: draw calls, uploads and leaks', () => {
  test('a battle frame with the stage, the HUD, the effects of the battle and the whole effect stack stays inside the budgets; 10 battle enter and exit cycles leave the GL counts flat (control: a battle open holds more objects than none)', async ({ browser }) => {
    test.setTimeout(240_000);
    const g = await openGame(browser, { query: '&fx=full', init: installGlCounters });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await sj(page, "sj.stage('town')");
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
      const start = async (): Promise<void> => {
        await sj(page, "(sj.defineEncounter('m3d', ['rustfang_punk', 'glowrat', 'rustfang_punk']), sj.battle('m3d', 'street'))");
        expect(await waitTop(page, 'BattleScene')).toBe(true);
        expect(await waitUntil(page, 'sj.battleStage !== null', 30_000)).toBe(true);
      };
      const counts = () => sj<Record<string, number>>(page, '(() => { const c = sj.glCounts(); return { texture: c.texture, buffer: c.buffer, framebuffer: c.framebuffer, program: c.program, vao: c.vao }; })()');
      const field = () => waitUntil(page, 'sj.top() === "FieldScene" && sj.battleStage === null', 60_000);

      // The frame: first with the battle waiting on orders, then with the effects alive.
      const before = await counts();
      await start();
      expect(await waitUntil(page, 'sj.game.top.mode === "round"', 60_000)).toBe(true);
      await sj(page, '(sj.game.speed = 0, true)');
      const measure = () =>
        sj<{ draws: number; binds: number; uploads: number }>(
          page,
          `(() => { const w = window; sj.step(0); w.__gl = { draws: 0, binds: 0, uploads: 0, uploadBytes: 0 }; for (let i = 0; i < 10; i++) sj.step(0); return { draws: w.__gl.draws / 10, binds: w.__gl.binds / 10, uploads: w.__gl.uploads / 10 }; })()`,
        );
      const bare = await measure();
      const open = await counts();
      // The effects: the battle's own painters (a fire spell, numbers) and the GPU stack on top of them.
      await sj(
        page,
        `(() => {
          const t = sj.game.top;
          const e = t.battle.enemies[0];
          t.fx.play('fire_all', t.pos(0), t.battle.enemies.map((u) => t.pos(u.uid)));
          t.floatOn(e.uid, '27', '#ffb23a', 'hit');
          t.floatOn(e.uid, 'WEAK!', '#6ff3ff', 'label');
          t.rate = 0;
          const p = t.pos(e.uid);
          sj.postfx.shock(200, 120, { strength: 6, reach: 90, life: 600, width: 10 });
          sj.postfx.shock(420, 220, { strength: 6, reach: 90, life: 600, width: 10 });
          sj.postfx.aberrate(4, 320, 180);
          sj.postfx.haze(320, 180, { radius: 60, strength: 3, life: 600 });
          sj.postfx.glitch(120, 250, { w: 100, h: 60, strength: 12, life: 600 });
          sj.postfx.dim(0.4, 600);
          sj.postfx.emit(sj.fx.presets.crit_sparks, 320, 180);
          sj.step(6);
          sj.game.speed = 0;
          return p;
        })()`,
      );
      const stack = await measure();
      console.log(`SJE draws, shipped battle on the stage: waiting for orders ${JSON.stringify(bare)}; with the battle's effects and the whole stack ${JSON.stringify(stack)}`);
      expect(await sj<boolean>(page, 'sj.battleStage.fxDrawn')).toBe(true);
      expect(stack.draws, 'the stack draws more than the waiting frame (control: the counter sees the effects)').toBeGreaterThan(bare.draws);
      expect(stack.draws, 'draw calls per frame').toBeLessThanOrEqual(LIVE_DRAWS_MAX);
      expect(stack.binds, 'framebuffer binds per frame').toBeLessThanOrEqual(LIVE_BINDS_MAX);
      expect(stack.uploads, 'canvas uploads per frame').toBeLessThanOrEqual(LIVE_UPLOADS_MAX);

      // Leave the fight, then enter and leave ten more times: the GL object counts are flat. A battle that is open holds more objects than none (the counter sees the stage).
      await sj(page, "(sj.game.speed = 1, sj.postfx.clear && sj.postfx.clear(), sj.game.top.close('run'), true)");
      expect(await field()).toBe(true);
      // The counter sees the stage: the field before any battle held fewer textures than the open battle (the pictures stay cached by key after it closes, so the flat counts below are about leaks, not about caching).
      expect(open.texture, 'control: an open battle holds more textures than the field before it').toBeGreaterThan(before.texture ?? 0);
      await sj(page, '(sj.debug.autoBattle = true)');
      const cycle = async (n: number): Promise<Record<string, number>> => {
        for (let i = 0; i < n; i++) {
          await start();
          expect(await field()).toBe(true);
        }
        return counts();
      };
      await cycle(3);
      const base = await cycle(1);
      const after = await cycle(10);
      console.log(`SJE draws, shipped battle on the stage: GL objects after the warm-up ${JSON.stringify(base)}, after 10 more cycles ${JSON.stringify(after)}`);
      expect(after, '10 battle enter and exit cycles leave the GL object counts flat').toEqual(base);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});

/** The shipped field on the stage (M5 task 9): the draw calls, framebuffer binds and canvas uploads of one frame, per map, with the whole effect stack. Written down and bounded from above. */
const FIELD_DRAWS_MAX = 40; // measured 21, 29, 17 (town, world, interior) on SwiftShader and CI's Chromium
const FIELD_BINDS_MAX = 24; // measured 17 (the effect stack's own: the same as the bare lab frame)
const FIELD_UPLOADS_MAX = 75; // measured 56, 30, 15: a few full-screen canvases (light map, haze, screen layer) and many SMALL ones (a lit sprite is lit again when a flickering light reaches it)
const FIELD_UPLOAD_BYTES_MAX = 8_000_000; // measured 6.8 MB, 5.6 MB, 3.7 MB a frame: the upload bytes are the cost to watch on a real GPU (the main session runs npm run perf)

test.describe('the shipped field on the stage: draw calls, binds and uploads', () => {
  test('a field frame (baked layers, props, actors, lights, haze, weather, the whole effect stack) stays inside the budgets on the town, the world map and an interior; the control exceeds them', async ({ browser }) => {
    test.setTimeout(240_000);
    const g = await openGame(browser, { query: '&fx=full', init: installGlCounters });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await sj(page, "sj.stage('town')");
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
      const measure = () =>
        sj<{ draws: number; binds: number; uploads: number; bytes: number }>(
          page,
          `(() => { const w = window; sj.step(0); w.__gl = { draws: 0, binds: 0, uploads: 0, uploadBytes: 0 }; for (let i = 0; i < 10; i++) sj.step(1); return { draws: w.__gl.draws / 10, binds: w.__gl.binds / 10, uploads: w.__gl.uploads / 10, bytes: w.__gl.uploadBytes / 10 }; })()`,
        );
      const seen: Record<string, { draws: number; binds: number; uploads: number; bytes: number }> = {};
      for (const [map, x, y] of [['lantern_row', 27, 21], ['world', 13, 22], ['bar', 11, 12]] as const) {
        await sj(page, `sj.tp(${JSON.stringify(map)}, ${x}, ${y}, 'down')`);
        expect(await waitUntil(page, `sj.fieldStage !== null && sj.fieldStage.mapId === ${JSON.stringify(map)} && sj.fieldStage.frame > 0 && sj.idle()`, 30_000)).toBe(true);
        // Let the banner of the area go (it is the screen layer's own upload), so the frame is the field alone: 200 ticks.
        await sj(page, '(sj.step(220), true)');
        seen[map] = await measure();
        expect(seen[map]?.draws, `${map}: a frame draws something (control: the counter sees the stage)`).toBeGreaterThan(3);
      }
      console.log(`SJE draws, shipped field on the stage with the whole stack: ${JSON.stringify(seen)}`);
      for (const [map, m] of Object.entries(seen)) {
        expect(m.draws, `${map}: draw calls per frame`).toBeLessThanOrEqual(FIELD_DRAWS_MAX);
        expect(m.binds, `${map}: framebuffer binds per frame`).toBeLessThanOrEqual(FIELD_BINDS_MAX);
        expect(m.uploads, `${map}: canvas uploads per frame`).toBeLessThanOrEqual(FIELD_UPLOADS_MAX);
        expect(m.bytes, `${map}: canvas upload bytes per frame`).toBeLessThanOrEqual(FIELD_UPLOAD_BYTES_MAX);
      }
      // Control: 80 extra images in the stage, each with another blend mode than the one before (a changed blend breaks the batch), exceed the draw budget: the bound can fail.
      await sj(
        page,
        `(() => {
          const s = sj.game.scene.scenes.find((x) => x.constructor.name === 'FieldStageScene');
          for (let i = 0; i < 80; i++) {
            const img = s.add.canvasImage(i * 4, 0, 4, 4).setDepth(200).setBlendMode(i % 2 ? 'add' : 'multiply');
            img.ctx.fillStyle = '#fff';
            img.ctx.fillRect(0, 0, 4, 4);
            img.refresh();
          }
          return true;
        })()`,
      );
      const over = await measure();
      console.log(`SJE draws, field with 80 extra images: ${JSON.stringify(over)}`);
      expect(over.draws, 'the control exceeds the draw budget').toBeGreaterThan(FIELD_DRAWS_MAX);
      expect(g.problems.filter((p) => !/GPU stall/.test(p))).toEqual([]);
    } finally {
      await g.close();
    }
  });
});
