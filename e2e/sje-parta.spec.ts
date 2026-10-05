/**
 * Part A of the engine-platform spike (docs/spikes/engine-platform.md): the lab items that test the
 * design's open questions about Pixi and Three on ONE WebGL context. Each case builds something with
 * the engine's own API, draws it, and compares the result with a CPU reference computed in the page
 * (src/sje-lab/parta.ts and partaextra.ts). The numbers are printed (`SJE PARTA ...`) so they can be
 * copied into the spike doc's progress log with the browser and renderer.
 *
 *   (i)   a built-in Pixi filter, a custom GLSL filter, a Graphics mask and a sprite (alpha) mask, each on
 *         the 3D `View3D` and on a container with depth-sorted children: 0 GL errors, CPU match (P5)
 *   (ii)  the same cases at device pixel ratio 1.5, with the canvas blocks checked while the effect is on
 *   (iii) Pixi `RenderLayer` with filters
 *   (iv)  `roundPixels` with a negative scale (the mirror rule)
 *   (v)   the attach order, Pixi first and Three later: e2e/sje3d-browsers.spec.ts (runs in every browser)
 *
 * Run it:  npx playwright test e2e/sje-parta.spec.ts --reporter=line
 *          PW_NOGPU=1 npx playwright test e2e/sje-parta.spec.ts    (software GL, like CI)
 */
import { expect, test } from '@playwright/test';
import { isSoftware, startHack, step, withLab } from './sjelabkit';

type Effect = 'colorMatrix' | 'glsl' | 'graphicsMask' | 'spriteMask';
const EFFECTS: Effect[] = ['colorMatrix', 'glsl', 'graphicsMask', 'spriteMask'];
const TARGETS = ['view3d', 'sorted'] as const;

/** The windows for (ii): ratio 1 (zoom 2) and ratio 1.5 (zoom 4, the ratio the spike asks about). */
const WINDOWS = [
  { dpr: 1, viewport: { width: 960, height: 540 }, k: 2 },
  { dpr: 1.5, viewport: { width: 1300, height: 730 }, k: 4 },
];

test.describe('Part A (i) and (ii): effects and masks on the 3D view and on a sorted container', () => {
  for (const { dpr, viewport, k } of WINDOWS) {
    test(`all eight cases at device pixel ratio ${dpr}: CPU match, 0 GL errors, the picture comes back, and the ${k}x${k} blocks stay flat`, async ({ browser }) => {
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: 5000 }, { hud: false });
          await step(page, 90);
          const info = await page.evaluate(() => window.__SJE__?.info());
          console.log(`SJE PARTA renderer: ${info?.renderer} | dpr ${dpr} zoom ${info?.k}`);
          expect(info?.k).toBe(k);
          const rows: string[] = [];
          for (const target of TARGETS) {
            for (const effect of EFFECTS) {
              const r = await page.evaluate(([e, t]) => window.__SJE__?.effectCase(e as Effect, t as 'view3d' | 'sorted'), [effect, target] as const);
              if (!r) throw new Error('no result');
              rows.push(`${target.padEnd(7)} ${effect.padEnd(12)} tolerance ${r.tolerance}/255 | compared ${r.compared} px | max difference ${r.maxDiff} | over tolerance ${r.over} | changed by the effect ${r.changedByEffect} | GL errors ${r.glErrors.length} | restored ${r.restored} | ${r.canvasBlocks.k}x${r.canvasBlocks.k} blocks uneven ${r.canvasBlocks.bad} of ${r.canvasBlocks.blocks}`);
              const label = `${target} ${effect} at dpr ${dpr}`;
              expect(r.over, `${label}: pixels off by more than ${r.tolerance}/255 in the box ${JSON.stringify(r.overBox)}, e.g. ${JSON.stringify(r.samples)}`).toBe(0);
              expect(r.maxDiff, label).toBeLessThanOrEqual(r.tolerance);
              expect(r.glErrors, `${label}: GL error flags`).toEqual([]);
              expect(r.restored, `${label}: the picture must return exactly once the effect is removed`).toBe(true);
              // The control: the effect really changed the picture, so the comparison above tested something.
              expect(r.changedByEffect, `${label}: the effect changed nothing, so the case proves nothing`).toBeGreaterThan(1000);
              expect(r.canvasBlocks.bad, `${label}: uneven blocks of the canvas while the effect is on`).toBe(0);
            }
          }
          console.log(`SJE PARTA effects at dpr ${dpr}:\n${rows.join('\n')}`);
        },
        { dpr, viewport },
      );
    });
  }

  test('a custom GLSL effect with NO uniforms draws (an empty uniform group crashed the first draw): 0 GL errors, CPU match, on both targets', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 5000 }, { hud: false });
      await step(page, 90);
      for (const target of TARGETS) {
        const r = await page.evaluate((t) => window.__SJE__?.effectCase('glsl', t as 'view3d' | 'sorted', { noUniforms: true }), target);
        expect(r?.over, `${target}: ${JSON.stringify(r?.samples)}`).toBe(0);
        expect(r?.glErrors).toEqual([]);
        expect(r?.restored).toBe(true);
        expect(r?.changedByEffect).toBeGreaterThan(1000);
      }
    });
  });

  test('the same four effects on the 3D view when the 3D comes through the CANVAS COPY (a CanvasSource instead of an ExternalSource)', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        await startHack(page, { ticks: 5000 }, { hud: false });
        expect(await page.evaluate(() => window.__SJE__?.frame()?.mode)).toBe('canvas-copy');
        await step(page, 90);
        for (const effect of EFFECTS) {
          const r = await page.evaluate((e) => window.__SJE__?.effectCase(e as Effect, 'view3d'), effect);
          if (!r) throw new Error('no result');
          console.log(`SJE PARTA canvas-copy view3d ${effect}: max difference ${r.maxDiff}, over ${r.over}, GL errors ${r.glErrors.length}, restored ${r.restored}`);
          expect(r.over, `${effect}: ${JSON.stringify(r.samples)}`).toBe(0);
          expect(r.glErrors).toEqual([]);
          expect(r.restored).toBe(true);
          expect(r.changedByEffect).toBeGreaterThan(1000);
        }
      },
      { query: 'manual&frame=canvas-copy' },
    );
  });
});

test.describe('Part A (i), where the mask cuts through the object: positions of a sprite (alpha) mask', () => {
  const POSITIONS = [
    { x: 180, y: 80 },
    { x: 205, y: 110 },
    { x: 205, y: 109 },
    { x: 210, y: 112 },
    { x: 181, y: 81 },
    { x: 160, y: 100 },
  ];

  test('on the 3D view a sprite mask is exact wherever it sits, on a GPU and on software GL', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 5000 }, { hud: false });
      await step(page, 90);
      for (const maskAt of POSITIONS) {
        const r = await page.evaluate((m) => window.__SJE__?.effectCase('spriteMask', 'view3d', { maskAt: m }), maskAt);
        expect(r?.over, `3D view, mask at ${JSON.stringify(maskAt)}: ${JSON.stringify(r?.samples)}`).toBe(0);
        expect(r?.glErrors).toEqual([]);
      }
    });
  });

  test('on a sorted container a sprite mask is exact wherever it sits: 0 wrong pixels, on a GPU and on software GL (roundPixels is off)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const software = await isSoftware(page);
      const rows: string[] = [];
      for (const maskAt of POSITIONS) {
        const r = await page.evaluate((m) => window.__SJE__?.effectCase('spriteMask', 'sorted', { maskAt: m }), maskAt);
        if (!r) throw new Error('no result');
        rows.push(`mask at ${JSON.stringify(maskAt)}: ${r.over} pixels off, box ${JSON.stringify(r.overBox)}, max difference ${r.maxDiff}, GL errors ${r.glErrors.length}`);
        expect(r.glErrors).toEqual([]);
        expect(r.restored).toBe(true);
        // HISTORY. Rounds 2 and 3 measured a strip of 16, 35 and 16 wrong pixels at three of these positions on SwiftShader (software GL),
        // and bounded it at 40. The cause was the renderer option `roundPixels: true`: bare Pixi with it on loses the same pixels, and with it
        // off loses none. Round 4 turned it off (drift item 25 in docs/spikes/engine-platform.md): the engine already snaps every object to
        // a whole pixel itself, and tests/sje-display.test.ts checks that. So the bound is back to 0, with no software exception.
        expect(r.over, `${software ? 'software GL' : 'GPU'}, mask at ${JSON.stringify(maskAt)}: ${JSON.stringify(r.samples)}`).toBe(0);
      }
      console.log(`SJE PARTA sprite mask on a sorted container (${software ? 'software GL' : 'GPU'}):\n${rows.join('\n')}`);
    });
  });
});

test.describe('Part A (iii): Pixi RenderLayer with filters', () => {
  test('a filter on an ancestor does NOT reach a child attached to a RenderLayer, and a filter on the layer does not reach it either (measured)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(() => window.__SJE__?.renderLayerCase());
      if (!r) throw new Error('no result');
      console.log(`SJE PARTA renderLayer: ${JSON.stringify(r)}`);
      // The control: a filtered container filters both of its children.
      const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 2);
      expect(near(r.control.red, r.redFiltered)).toBe(true);
      expect(near(r.control.blue, r.blueFiltered)).toBe(true);
      // Scenario 1: red (in the container) is filtered; blue (attached to the layer) is NOT. Pixi's note holds.
      expect(near(r.ancestor.red, r.redFiltered)).toBe(true);
      expect(r.ancestorFilterAppliesToAttached).toBe(false);
      expect(r.ancestor.blue).toEqual([0x3a, 0x6a, 0xff]);
      // Scenario 2: a filter on the LAYER itself does not reach the attached child in Pixi 8.22 either: it stays its own colour.
      expect(r.onLayer.appliesToAttached).toBe(false);
      expect(r.onLayer.blue).toEqual([0x3a, 0x6a, 0xff]);
      expect(r.glErrors).toEqual([]);
    });
  });
});

test.describe('Part A (iv): roundPixels with a negative scale (the mirror rule)', () => {
  test('widths 8, 9, 15, 16 x origins 0, 0.5, 1 x five ways to mirror: every picture equals Canvas 2D drawing the same transform', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const rows = await page.evaluate(() => window.__SJE__?.mirrorMatrix());
      if (!rows) throw new Error('no result');
      const bad = rows.filter((r) => r.differing !== 0);
      console.log(`SJE PARTA mirror: ${rows.length} combinations, ${rows.length - bad.length} exact${bad.length ? `, not exact: ${JSON.stringify(bad)}` : ''}`);
      expect(rows).toHaveLength(60);
      expect(bad).toEqual([]);
      expect(rows.flatMap((r) => r.glErrors)).toEqual([]);
    });
  });
});

// (vi) Cleanup item C7: the renderer ships with Pixi `roundPixels: false` (drift item 25). Does that change any game pixel against `roundPixels: true`?
// tests/sje-display.test.ts answers from the vertices (a model). This is the same table on a real GPU and on software GL: the engine's own nodes drawn
// twice, once with Pixi roundPixels off and once on, read from the engine's back buffer (src/sje-lab/partaextra.ts `runSnapAb`).
// The test asserts "changes" and "no change", NOT an exact count: the number of pixels at 1.09x was 25 on a GPU and 49 on SwiftShader (the rasteriser's
// rounding of edge cases differs), but both change.
// The two tie cases (an edge exactly half way between two pixels) are a special case. The model says a tie always changes, because it uses exact arithmetic. A GPU computes the
// edge through floating point first, so a tie can fall either way: a 2x parent with the edge at 24.5 (picture x 20.25) drew the SAME pixels with the flag on and off here,
// and with the edge at 32.5 (x 24.25) it moved the whole picture one pixel. So a tie is never safe, in either direction. The test pins the two ties that were measured
// on a GPU and on SwiftShader and says so. It does not claim that every tie changes.
test.describe('Part A (vi): does roundPixels false change a game pixel? (cleanup C7, A/B on a real renderer)', () => {
  const NO_CHANGE = ['scale 1, snapped', 'scale 2, snapped', 'scale -1, snapped', 'scale 1.5, even 16x16', 'snap off, x 40.25', '2x parent, snapped', 'control: no flag in either pass'];
  const CHANGES = ['scale 1.5, odd 11x9', 'snap off, x 40.5', '1.09x parent', '2x parent, snap off, x 24.25'];

  test('the cases the engine uses draw the same pixels either way, and the cases the model names (odd size at 1.5x, a half pixel with snap off, the 1.09x push, a quarter pixel in a 2x parent) differ', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const rows = await page.evaluate(() => window.__SJE__?.snapAb());
      if (!rows) throw new Error('no result');
      const info = await page.evaluate(() => window.__SJE__?.info());
      console.log(`SJE PARTA snap A/B on ${info?.renderer}:\n${rows.map((r) => `${r.name.padEnd(32)} differing ${String(r.differing).padStart(4)} | drawn ${r.drawn}`).join('\n')}`);
      expect(rows.map((r) => r.name).sort()).toEqual([...NO_CHANGE, ...CHANGES].sort());
      for (const r of rows) {
        expect(r.glErrors, `${r.name}: GL error flags`).toEqual([]);
        // Every case drew something, so "0 differing" is not two empty pictures. (The odd 1.5x picture is the smallest: 16 x 13 = 208 pixels.)
        expect(r.drawn, `${r.name}: nothing was drawn`).toBeGreaterThan(150);
        if (NO_CHANGE.includes(r.name)) expect(r.differing, `${r.name}: roundPixels changed pixels, the model says it does not`).toBe(0);
        else expect(r.differing, `${r.name}: roundPixels changed nothing, the model says it does`).toBeGreaterThan(0);
      }
    });
  });
});
