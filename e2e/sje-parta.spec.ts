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

  test('on a sorted container: exact on a GPU; on software GL (SwiftShader) one strip of at most 40 pixels can be lost where the mask cuts through the swatches (cause: roundPixels, the same loss as bare Pixi, see the comment; 40 is one swatch edge; CI confirms it)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const software = await isSoftware(page);
      const rows: string[] = [];
      for (const maskAt of POSITIONS) {
        const r = await page.evaluate((m) => window.__SJE__?.effectCase('spriteMask', 'sorted', { maskAt: m }), maskAt);
        if (!r) throw new Error('no result');
        rows.push(`mask at ${JSON.stringify(maskAt)}: ${r.over} pixels off, box ${JSON.stringify(r.overBox)}, max difference ${r.maxDiff}, GL errors ${r.glErrors.length}`);
        expect(r.glErrors).toEqual([]);
        expect(r.restored).toBe(true);
        if (!software) expect(r.over, `GPU, mask at ${JSON.stringify(maskAt)}`).toBe(0);
        else {
          // The measured defect: the last row or column of a swatch (a strip one pixel thick), never more than 40 pixels.
          // CAUSE (round 2): the engine's Pixi renderer runs with `roundPixels: true`. A bare Pixi app (no engine) with that one option
          // reproduces the strip on SwiftShader and is exact without it. WARP (Edge with --use-angle=d3d11-warp, a second software
          // rasteriser), the RTX 4070 and Firefox are exact with it on. With `roundPixels: false` this whole file and sjelab.spec.ts and
          // sje3d.spec.ts pass on the GPU and on SwiftShader, and the strip is 0. So the cause is the `roundPixels` vertex path on
          // SwiftShader, hit when the container is drawn into the mask pass's own render target. (The exact float step inside the shader is not isolated.)
          // The engine already snaps every object to whole pixels, and the design keeps the renderer option "as a second guard"
          // (scene-graph.md section 7, point 4): turning it off is a design change for Mark. See drift item 25 in docs/spikes/engine-platform.md.
          // THE ENGINE LOSES THE SAME PIXELS AS BARE PIXI (round 3). The bare repro seemed to lose fewer (11 against 35 at (205,109)) only because
          // it counted background-coloured pixels: the 35 are the red swatch's last row (x 205 to 239), and in x 216 to 239 the GREEN swatch
          // below shows through instead of red, which is not background coloured. Counted the same way as here (any pixel that is not the
          // CPU picture), bare Pixi loses 16, 35 and 16 at the three positions, exactly the engine's numbers. So nothing in the engine adds to it.
          // WHY 40: a lost strip is one row or column of ONE swatch, and a swatch is 40 pixels wide, so 40 is the largest a single strip can be
          // (the thin-box check below keeps it to one strip). It is a geometric limit, not a number tuned to a run. The count on CI's Linux
          // SwiftShader may still differ (it is a different build of the rasteriser): a count above 40 or a thick box there is a finding.
          // The measured counts so far: 16, 35, 16 (local Edge SwiftShader and the bundled headless shell 1234).
          expect(r.over, `software GL, mask at ${JSON.stringify(maskAt)}`).toBeLessThanOrEqual(40);
          if (r.overBox) expect(r.overBox.x1 === r.overBox.x0 || r.overBox.y1 === r.overBox.y0, `a strip one pixel thick: ${JSON.stringify(r.overBox)}`).toBe(true);
        }
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
