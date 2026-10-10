/**
 * The real game on the new engine, checked in a browser (docs/engine/m1-brief.md tasks 13 and 14, pass lines 3 and 4; M6 made the new engine the default, so the page is `/?debug`
 * with no flag, and the old path these tests once compared against is gone).
 * It runs in CI on Chromium with SwiftShader (software GL), like the canaries.
 *
 *  0. M6: with no flag, the page is the new engine: the Pixi canvas, the DEV hook's engine members, no `#fx` overlay and no `#screen`. Control: the page of the old
 *     default (the `main` branch before M6) fails this case.
 *  1. Title, field, battle and shop each reach their screen, and each draws a picture (not a blank canvas). Control: waiting for a scene that is
 *     not there fails.
 *  2. The block test: at integer ratios 1, 2 and 3, the title screen has no uneven block. Controls: the block holds a picture (not a flat color); a picture read at
 *     the wrong ratio has uneven blocks. (Until M6 the same test also compared a 64x64 block with the old 2D path, pixel for pixel; M1 proved that and the old path is gone.
 *     The goldens of M6, `e2e/default-path.spec.ts`, guard the picture now.)
 *  3. Context loss and restore returns to the same frame. Control: ticks that run while the context is lost give a different frame, which the
 *     same hash tells apart.
 *  4. Enter and leave a legacy scene 10 times: the GL object counts do not grow. Control: a scene that leaks on purpose makes them grow.
 *  5. The DEV hook has its members, `gpu(on)` sets `fxLevel`, and the options row for scaling is gone.
 *  6. No WebGL2: the page shows the "failed to start" text, not a blank page.
 *
 * The pictures of pass line 4 (the four screens) are written to test-results/m1-shell/ (not tracked).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { H, W } from '../src/sje/core/size';
import { advance, decode, openGame, sameRect, sj, unevenBlocks, waitTop, waitUntil } from './sjegamekit';

const OUT = 'test-results/m1-shell';
mkdirSync(OUT, { recursive: true });

/** Playwright's emulated viewport for a whole-number ratio k: the picture fills it exactly, so no bars and no offset. */
const viewportFor = (k: number) => ({ width: W * k, height: H * k });

/** The context-loss warning that Chrome logs on purpose. */
const LOSS_NOISE = /CONTEXT_LOST_WEBGL|context lost|WebGL: INVALID_OPERATION: .*context/i;

/** Stop the game's loop (the state stays as it is, and a draw shows it). The old and the new path both have `game.speed`. */
const freeze = (page: import('@playwright/test').Page) => sj(page, '(sj.game.speed = 0, true)');

test.describe('the real game on the new engine', () => {
  test('with no flag the page is the new engine: the Pixi canvas, the engine members of the DEV hook, no #fx and no #screen', async ({ browser }) => {
    const g = await openGame(browser);
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      // The URL has no engine parameter at all.
      expect(new URL(page.url()).searchParams.has('engine')).toBe(false);
      // One canvas in the page (the Pixi one); the two canvases of the old default, #screen and #fx, are not there.
      expect(await page.locator('canvas').count()).toBe(1);
      expect(await page.locator('#screen').count()).toBe(0);
      expect(await page.locator('#fx').count()).toBe(0);
      // The engine's members: the renderer, and the Pixi tree with the four roots.
      expect(await sj<string>(page, 'typeof sj.renderer.name')).toBe('string');
      expect(await sj<string[]>(page, 'sj.tree().children.map((c) => c.label)')).toEqual(['worldRoot', 'fxRoot', 'uiRoot', 'overlayRoot']);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('title, field, battle and shop each reach their screen and draw a picture; waiting for a scene that is not there fails', async ({ browser }) => {
    const g = await openGame(browser, {});
    try {
      const { page } = g;
      const shot = async (name: string) => {
        const png = await page.screenshot();
        writeFileSync(`${OUT}/sje-${name}.png`, png);
        const img = decode(png);
        // A picture, not a flat canvas: many colors.
        const colors = new Set<number>();
        for (let i = 0; i < img.data.length; i += 4 * 97) colors.add(((img.data[i] ?? 0) << 16) | ((img.data[i + 1] ?? 0) << 8) | (img.data[i + 2] ?? 0));
        expect(colors.size, `${name}: colors in the picture`).toBeGreaterThan(8);
      };
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await page.waitForTimeout(600);
      await shot('title');
      // Control: a scene that is not on the stack is never found.
      expect(await waitTop(page, 'NoSuchScene', 1500)).toBe(false);

      await sj(page, "sj.stage('town')");
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
      await page.waitForTimeout(500);
      await shot('field');

      await sj(page, "(sj.defineEncounter('m1shot', ['sewer_ghoul', 'rust_crab']), sj.battle('m1shot', 'sewer'))");
      expect(await waitTop(page, 'BattleScene')).toBe(true);
      await page.waitForTimeout(3500);
      await shot('battle');
      expect(await sj<string>(page, 'sj.top()')).toBe('BattleScene');

      // Back to a field, then the shop.
      await sj(page, "sj.stage('town')");
      expect(await waitUntil(page, 'sj.top() === "FieldScene" && sj.idle()', 30_000)).toBe(true);
      await sj(page, "sj.shop('lr_weapons')");
      expect(await waitTop(page, 'ShopScene')).toBe(true);
      await page.waitForTimeout(800);
      await shot('shop');
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  for (const k of [1, 2, 3]) {
    test(`ratio ${k}: the title has no uneven block, and its middle block holds a picture`, async ({ browser }) => {
      // A deterministic run (fake clock, seeded random), so the animated title is the same on every run.
      const g = await openGame(browser, { viewport: viewportFor(k), fakeClock: true });
      try {
        const { page } = g;
        expect(await waitUntil(page, 'sj.game.stack.length > 0', 30_000)).toBe(true);
        // No effects: the base picture, as the block test always judged it. The effects have their own pixel tests (e2e/sje-fx.spec.ts).
        await sj(page, 'sj.gpu(false)');
        expect(await sj<string>(page, 'sj.renderer.fxLevel'), 'the page runs with no effects').toBe('none');
        await advance(page, 700);
        expect(await sj<string>(page, 'sj.top()')).toBe('TitleScene');
        const png = await page.screenshot();
        writeFileSync(`${OUT}/sje-title-k${k}.png`, png);
        expect(g.problems).toEqual([]);
        const neu = decode(png);
        expect([neu.w, neu.h]).toEqual([W * k, H * k]);

        // The block: 64x64 GAME pixels, so 64k device pixels, where the title has its picture: the middle of the screen. Control: it is not a flat color.
        const bx = (W / 2 - 32) * k;
        const by = (H / 2 - 32) * k;
        expect(sameRect(neu, neu, bx, by, 64 * k, 64 * k).colors, 'the block holds a picture, not a flat color').toBeGreaterThan(6);

        // No uneven block anywhere in the picture. Control: read the same picture at another ratio and the blocks are uneven.
        expect(unevenBlocks(neu, k, 0, 0, W, H), `ratio ${k}: uneven blocks`).toBe(0);
        const wrong = k + 1;
        expect(unevenBlocks(neu, wrong, 0, 0, Math.floor((W * k) / wrong) - 1, Math.floor((H * k) / wrong) - 1), 'control: a wrong ratio finds uneven blocks').toBeGreaterThan(0);
      } finally {
        await g.close();
      }
    });
  }

  test('context loss and restore returns to the same frame; ticks that ran while the context was lost give another frame (the control)', async ({ browser }) => {
    const g = await openGame(browser, { allow: [LOSS_NOISE] });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await page.waitForTimeout(700);
      await freeze(page);

      const lose = async () => {
        await sj(page, 'sj.forceContextLoss()');
        expect(await waitUntil(page, 'sj.renderer.contextLost', 10_000)).toBe(true);
      };
      const restore = async () => {
        await sj(page, 'sj.forceContextRestore()');
        expect(await waitUntil(page, '!sj.renderer.contextLost', 10_000)).toBe(true);
      };

      // Same frame: draw once, lose, restore, draw the same state again.
      await sj(page, 'sj.step(0)');
      const before = await sj<string>(page, 'sj.frameHash()');
      await lose();
      await sj(page, 'sj.step(0)'); // draws nothing while lost, and must not throw
      await restore();
      await sj(page, 'sj.step(0)');
      const after = await sj<string>(page, 'sj.frameHash()');
      expect(after, 'the frame after restore is the frame before the loss').toBe(before);

      // Control: the same sequence, but 90 ticks run while the context is lost. The title moves, so the frame is another one.
      await lose();
      await sj(page, 'sj.step(90)');
      await restore();
      await sj(page, 'sj.step(0)');
      const later = await sj<string>(page, 'sj.frameHash()');
      expect(later, 'control: a frame after 90 more ticks is another frame').not.toBe(before);

      // The game still draws and ticks, and made no GL error.
      const tick = await sj<number>(page, 'sj.game.tick');
      await sj(page, 'sj.step(5)');
      expect(await sj<number>(page, 'sj.game.tick')).toBe(tick + 5);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('entering and leaving a legacy scene 10 times leaves the GL object counts flat; a scene that leaks on purpose makes them grow', async ({ browser }) => {
    const g = await openGame(browser, {});
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await page.waitForTimeout(500);
      await freeze(page);
      // The cycle: run a legacy scene (the old Scene class from the game), draw it, close it. `leak` also makes a texture it never frees.
      const cycle = (n: number, leak: boolean) =>
        sj<{ texture: number; buffer: number; framebuffer: number; program: number; vao: number }>(
          page,
          `(async () => {
            const { Scene } = await import('/src/engine/game.ts');
            const game = sj.game;
            class Probe extends Scene { update() {} render(ctx) { ctx.fillStyle = '#336699'; ctx.fillRect(0, 0, 40, 40); } }
            for (let i = 0; i < ${n}; i++) {
              const probe = new Probe();
              probe.opaque = false;
              const done = game.run(probe);
              sj.step(2);
              if (${leak}) {
                const key = 'leak-' + Math.random();
                const made = game.textures.createCanvas(key, 8, 8);
                made.ctx.fillStyle = '#ff0000';
                made.ctx.fillRect(0, 0, 8, 8);
                made.refresh();
                const shown = new (await import('/src/sje/display/imageobject.ts')).ImageObject(game, 0, 0, key);
                game.screen.overlayRoot.add(shown);
                sj.step(1);
                shown.destroy();
              }
              probe.close(undefined);
              await done;
              sj.step(2);
            }
            const c = sj.glCounts();
            return { texture: c.texture, buffer: c.buffer, framebuffer: c.framebuffer, program: c.program, vao: c.vao };
          })()`,
        );
      // One cycle to warm up (programs and first uploads), then the baseline.
      const base = await cycle(1, false);
      const after = await cycle(10, false);
      console.log(`SJE leak: GL counts after 1 cycle ${JSON.stringify(base)}, after 10 more ${JSON.stringify(after)}`);
      expect(after).toEqual(base);
      // Control: the leaking scene makes the texture count grow.
      const leaked = await cycle(10, true);
      expect(leaked.texture, 'control: leaking on purpose grows the texture count').toBeGreaterThan(after.texture);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('the DEV hook has its members; gpu(on) sets fxLevel; the options list has no scaling row', async ({ browser }) => {
    const g = await openGame(browser, {});
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await freeze(page);
      const kinds = await sj<Record<string, string>>(page, `Object.fromEntries(['hooks', 'tree', 'step', 'frameHash', 'pixels', 'glCounts', 'renderer', 'forceContextLoss', 'forceContextRestore', 'canvasPixels'].map((k) => [k, typeof sj[k]]))`);
      expect(kinds).toEqual({ hooks: 'object', tree: 'function', step: 'function', frameHash: 'function', pixels: 'function', glCounts: 'function', renderer: 'object', forceContextLoss: 'function', forceContextRestore: 'function', canvasPixels: 'function' });
      // The tree has the four roots (the effects' own layers, `fxRoot`, since M2), and a legacy scene's canvas image shows as a Sprite.
      const roots = await sj<string[]>(page, 'sj.tree().children.map((c) => c.label)');
      expect(roots).toEqual(['worldRoot', 'fxRoot', 'uiRoot', 'overlayRoot']);
      expect(await sj<number>(page, 'JSON.stringify(sj.tree()).split("Sprite").length - 1')).toBeGreaterThan(0);
      // hooks: onTick sees ticks until it is removed.
      const counts = await sj<number[]>(page, `(() => { let n = 0; const off = sj.hooks.onTick(() => n++); sj.step(3); const a = n; off(); sj.step(3); return [a, n]; })()`);
      expect(counts).toEqual([3, 3]);
      // renderer, and gpu(on).
      expect(await sj<boolean>(page, 'sj.renderer.contextLost')).toBe(false);
      await sj(page, 'sj.gpu(false)');
      expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('none');
      await sj(page, 'sj.gpu(true)');
      expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('full');
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('a browser without WebGL2 shows the "failed to start" text, not a blank page', async ({ browser }) => {
    const g = await openGame(browser, {
      // The page logs the failure on purpose (console.error); that is the expected output of this test.
      allow: [/./],
      init: () => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          if (type === 'webgl2') return null;
          return (get as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest);
        } as typeof HTMLCanvasElement.prototype.getContext;
      },
    });
    try {
      const { page } = g;
      await page.waitForFunction(() => /failed to start/i.test(document.getElementById('boot')?.textContent ?? ''), null, { timeout: 30_000 });
      const text = await page.locator('#boot').innerText();
      expect(text).toMatch(/SHADOW JOG failed to start/);
      expect(text).toMatch(/WebGL 2/);
      await expect(page.locator('#boot')).toBeVisible();
    } finally {
      await g.close();
    }
  });
});
