/**
 * The 3D path of the engine (step B2 of the engine-platform spike, docs/spikes/engine-platform.md):
 * the test hacking scene on the lab page, drawn by Three.js into a render target that Pixi shows on
 * the SAME WebGL context (decision E3), with the 2D HUD over it, started from a story script.
 *
 * What it checks, and the pass line behind each:
 *  - the picture: not blank, 0 GL errors, 0 console errors; the 3D target is 480x270 and NEAREST; the 3D
 *    pixels reach the screen with no resampling; the shared-context frame and the canvas-copy fallback
 *    draw the same picture; the same tick count gives the same picture (V3, B5, P7).
 *  - the HUD over it: exact against a Canvas 2D drawing, with no glow bleeding in; readable (V1, V5).
 *  - crispness: zero uneven blocks with the 3D scene running at ratios 1, 1.25, 1.5, 1.75, 2, 2.25 (P2).
 *  - the story bridge: a 2D line, the hack, a 2D line; success and fail; the result policy (E19).
 *  - fallback: context loss resolves the hack within 2 s with the fallback result and the story goes on;
 *    a context that returns in time carries on with a correct picture; no WebGL2 resolves "unsupported"
 *    at once; a chunk that will not load resolves "unsupported"; a dropped hack still resolves (P3, E11).
 *  - leaks: 10 enter-and-leave cycles leave the WebGL object counts flat, and the heap after garbage
 *    collection within 5% (P4).
 *  - the hand-off canary: a filtered container with a transparent gap over a non-black Three
 *    background; the negative control shows the check can fail.
 *  - speed (P6): on the GPU, the frame interval is within 5% of a bare page and a frame costs at most 8 ms with the
 *    GPU wait included (a read-back, and the GPU's own timer where offered). A negative control (a scene far too heavy)
 *    must fail the same rules.
 *
 * Run it:  npx playwright test e2e/sje3d.spec.ts --reporter=line
 *          PW_NOGPU=1 npx playwright test e2e/sje3d.spec.ts   (software GL, like CI)
 * Set SJE_SHOTS=<folder> to save pictures of the scene.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { MAX_TICKS_PER_FRAME } from '../src/sje/core/fixedloop';
import { bytesOf, isSoftware, openLab, percentile, startHack, step, withLab } from './sjelabkit';

const SHOTS = process.env.SJE_SHOTS;
function save(name: string, dataUrl: string): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
}

/** The 3D scene's void colour (look.ts PALETTE.void) as it reaches the picture. */
const THREE_VOID = [0x07, 0x0a, 0x22];

/** One viewport per device pixel ratio, each a whole number of device pixels, with the integer zoom `k`. */
const RATIOS = [
  { dpr: 1, viewport: { width: 1920, height: 1080 }, k: 4 },
  { dpr: 1.25, viewport: { width: 1600, height: 900 }, k: 4 },
  { dpr: 1.5, viewport: { width: 1300, height: 730 }, k: 4 },
  { dpr: 1.75, viewport: { width: 1100, height: 620 }, k: 4 },
  { dpr: 2, viewport: { width: 960, height: 540 }, k: 4 },
  { dpr: 2.25, viewport: { width: 1600, height: 900 }, k: 7 },
];

test.describe('3D scene: the picture', () => {
  test('renders a non-blank picture with 0 GL errors and 0 console errors; the target is 480x270 and nearest', async ({ browser }, testInfo) => {
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 900 });
      await step(page, 120);
      const info = await page.evaluate(() => window.__SJE__?.info());
      console.log(`SJE3D renderer: ${info?.renderer}`);
      const frame = await page.evaluate(() => window.__SJE__?.frame());
      expect(frame).toMatchObject({ mode: 'shared-context', width: 480, height: 270, minFilter: 'nearest', magFilter: 'nearest', contextLost: false });
      // Several frames, then the error flags.
      for (let i = 0; i < 20; i++) await step(page, 1);
      expect(await page.evaluate(() => window.__SJE__?.glErrors()), 'GL error flags').toEqual([]);

      const raw = await page.evaluate(() => window.__SJE__?.framePixels());
      expect([raw?.w, raw?.h]).toEqual([480, 270]);
      const px = bytesOf(raw?.base64 ?? '');
      expect(px.length).toBe(480 * 270 * 4);
      // Non-blank: many colours, and a good part of the picture is not the void.
      const colours = new Set<number>();
      let notVoid = 0;
      let opaque = 0;
      for (let i = 0; i < px.length; i += 4) {
        colours.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
        if (Math.abs((px[i] ?? 0) - (THREE_VOID[0] ?? 0)) + Math.abs((px[i + 1] ?? 0) - (THREE_VOID[1] ?? 0)) + Math.abs((px[i + 2] ?? 0) - (THREE_VOID[2] ?? 0)) > 12) notVoid++;
        if (px[i + 3] === 255) opaque++;
      }
      const sim = await page.evaluate(() => window.__SJE__?.sim());
      console.log(`SJE3D picture: ${colours.size} colours, ${((notVoid / (480 * 270)) * 100).toFixed(1)}% not void, sim ${JSON.stringify(sim)}`);
      expect(colours.size).toBeGreaterThan(300);
      expect(notVoid / (480 * 270)).toBeGreaterThan(0.1);
      // The 3D target is opaque everywhere (the scene has a background colour), so nothing shows through it by accident.
      expect(opaque).toBe(480 * 270);
      if (SHOTS) {
        testInfo.annotations.push({ type: 'shots', description: SHOTS });
        save('hack-t120.png', (await page.evaluate(() => window.__SJE__?.png('sje', 2))) ?? '');
      }
    });
  });

  test('the 3D pixels reach the screen exactly: where nothing is drawn over them, the back buffer IS the 3D target (no resampling)', async ({ browser }) => {
    for (const query of ['manual', 'manual&frame=canvas-copy']) {
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: 900 }, { hud: false });
          await step(page, 150);
          const result = await page.evaluate(() => {
            const h = window.__SJE__;
            if (!h) throw new Error('no hook');
            const rt = h.framePixels();
            const bb = h.pixels();
            if (!rt) throw new Error('no 3D picture');
            const a = atob(rt.base64);
            const b = atob(bb.base64);
            let differing = 0;
            for (let i = 0; i < a.length; i += 4) if (a.charCodeAt(i) !== b.charCodeAt(i) || a.charCodeAt(i + 1) !== b.charCodeAt(i + 1) || a.charCodeAt(i + 2) !== b.charCodeAt(i + 2)) differing++;
            return { differing, total: a.length / 4, mode: h.frame()?.mode };
          });
          console.log(`SJE3D target vs back buffer (${result.mode}, no HUD): ${result.differing} of ${result.total} pixels differ`);
          expect(result.differing).toBe(0);
        },
        { query },
      );
    }
  });

  test('the shared-context frame and the canvas-copy fallback draw the SAME picture, tick for tick', async ({ browser }) => {
    const hashes: Record<string, string[]> = {};
    for (const query of ['manual&frame=shared-context', 'manual&frame=canvas-copy']) {
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: 900 });
          const mode = await page.evaluate(() => window.__SJE__?.frame()?.mode);
          expect(mode).toBe(query.includes('canvas-copy') ? 'canvas-copy' : 'shared-context');
          const run: string[] = [];
          for (const t of [1, 60, 200, 400]) {
            const h = await page.evaluate((n) => {
              const hook = window.__SJE__;
              if (!hook) throw new Error('no hook');
              return hook.step(n - (hook.sim()?.tick ?? 0));
            }, t);
            run.push(h);
          }
          hashes[query] = run;
        },
        { query },
      );
    }
    expect(hashes['manual&frame=canvas-copy']).toEqual(hashes['manual&frame=shared-context']);
    expect(new Set(hashes['manual&frame=shared-context']).size, 'the picture changes with the tick').toBe(4);
  });

  test("frame=auto with Three's texture handle missing: the frame is a canvas copy, exactly ONE console warning, and the picture still renders (E3)", async ({ browser }) => {
    // The reference: what an explicit canvas-copy frame draws at these ticks.
    const reference: string[] = [];
    await withLab(
      browser,
      async ({ page }) => {
        await startHack(page, { ticks: 900 });
        for (const t of [1, 60, 200]) {
          reference.push(await page.evaluate((n) => window.__SJE__?.step(n - (window.__SJE__?.sim()?.tick ?? 0)) ?? '', t));
        }
      },
      { query: 'manual&frame=canvas-copy' },
    );

    const lab = await openLab(browser, { query: 'manual&frame=auto', allow: [/texture handle is missing/] });
    try {
      const { page } = lab;
      // `allow` keeps the expected warning out of `lab.problems`, so count it with a listener of our own.
      const fallbackWarnings: Array<{ type: string; text: string }> = [];
      page.on('console', (m) => {
        if (/texture handle is missing/.test(m.text())) fallbackWarnings.push({ type: m.type(), text: m.text() });
      });
      // Hide the handle BEFORE the hack starts: `auto` then finds none and must fall back by itself.
      await page.evaluate(() => window.__SJE__?.hideTextureHandle(true));
      await startHack(page, { ticks: 900 });
      expect((await page.evaluate(() => window.__SJE__?.frame()))?.mode, 'auto fell back to the canvas copy').toBe('canvas-copy');
      const got: string[] = [];
      for (const t of [1, 60, 200]) got.push(await page.evaluate((n) => window.__SJE__?.step(n - (window.__SJE__?.sim()?.tick ?? 0)) ?? '', t));
      // It still renders, and renders the same picture as the explicit canvas copy.
      expect(got, 'the same pictures as an explicit canvas-copy frame').toEqual(reference);
      expect(new Set(got).size, 'the picture changes with the tick').toBe(3);
      const raw = await page.evaluate(() => window.__SJE__?.framePixels());
      const colours = new Set<number>();
      const px = bytesOf(raw?.base64 ?? '');
      for (let i = 0; i < px.length; i += 4) colours.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
      expect(colours.size, 'a non-blank picture').toBeGreaterThan(300);
      expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
      // Exactly one warning, and nothing else (the fall back is a note, not an error).
      expect(fallbackWarnings, 'one console warning').toHaveLength(1);
      expect(fallbackWarnings[0]?.type).toBe('warning');
      expect(lab.problems, 'no other console warning or error').toEqual([]);
    } finally {
      await lab.close();
    }
  });

  test('determinism: the same tick count gives the same picture on two loads, however the ticks are split', async ({ browser }) => {
    const results: string[] = [];
    for (const split of [[300], Array(300).fill(1), [100, 100, 100]] as number[][]) {
      await withLab(browser, async ({ page }) => {
        await startHack(page, { ticks: 5000 });
        results.push(
          await page.evaluate((parts) => {
            const h = window.__SJE__;
            if (!h) throw new Error('no hook');
            let last = '';
            for (const n of parts) last = h.step(n);
            return last;
          }, split),
        );
      });
    }
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });
});

test.describe('3D scene: colours are exact (frame-and-rendering.md 7.5)', () => {
  test('a colour written in Three reaches the 3D picture and the screen unchanged: #ff2080 stays #ff2080 (the default would give #ff0437)', async ({ browser }) => {
    for (const query of ['manual', 'manual&frame=canvas-copy']) {
      await withLab(
        browser,
        async ({ page }) => {
          for (const [background, plane] of [
            [0xff2080, 0x2080ff],
            [0x123456, 0xfedcba],
            [0x070a22, 0xffcc3d],
          ] as const) {
            const r = await page.evaluate(([b, p]) => window.__SJE__?.colourProbe(b, p), [background, plane] as const);
            const rgb = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
            console.log(`SJE3D colour (${query}): background #${background.toString(16)} -> ${JSON.stringify(r?.target.left)} on screen ${JSON.stringify(r?.screen.left)}; material #${plane.toString(16)} -> ${JSON.stringify(r?.target.right)} on screen ${JSON.stringify(r?.screen.right)}`);
            expect(r?.target.left, 'the scene background colour in the 3D picture').toEqual(rgb(background));
            expect(r?.target.right, 'an unlit material colour in the 3D picture').toEqual(rgb(plane));
            // And on the screen: the 3D picture is shown by Pixi with no colour change.
            expect(r?.screen.left).toEqual(rgb(background));
            expect(r?.screen.right).toEqual(rgb(plane));
          }
          expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
        },
        { query },
      );
    }
  });
});

test.describe('3D scene: no flicker on entering or leaving, and none during (V4)', () => {
  test('on the real loop, every frame from the lab, into the 3D scene and back out is a whole picture (never blank or half drawn)', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        // Warm up: the first entry compiles shaders (a hitch that the game hides behind a transition).
        await page.evaluate(() => window.__SJE__?.hackCycles(2));
        const watch = page.evaluate(() => window.__SJE__?.flickerWatch(240));
        await page.waitForTimeout(250); // some frames of the lab alone, first
        await page.evaluate(() => {
          window.__SJE__?.hackHud(true);
          window.__SJE__?.hackStart({ ticks: 100 });
        });
        const frames = await watch;
        if (!frames) throw new Error('no frames');
        // The scenes on top, in order, each listed once while it stays on top.
        const tops: string[] = [];
        for (const f of frames) if (tops[tops.length - 1] !== f.top) tops.push(f.top);
        const worst = Math.max(...frames.map((f) => f.dominant));
        const inHack = frames.filter((f) => f.top === 'HackScene');
        console.log(`SJE3D flicker watch: ${frames.length} frames, scenes on top in order ${tops.join(' > ')}, ${inHack.length} frames in the 3D scene; the largest single-colour share of any frame was ${(worst * 100).toFixed(1)}%, the smallest in the 3D scene ${(Math.min(...inHack.map((f) => f.dominant)) * 100).toFixed(1)}%`);
        expect(tops).toEqual(['LabScene', 'HackScene', 'LabScene']);
        // How much of the hack was WATCHED is counted in ticks, not frames. A machine that draws slowly (CI's software GL) gets fewer frames
        // in the same time, and the loop then runs up to 5 ticks in a frame. So a 100 tick hack always gives at least 20 frames, and the
        // frames must span nearly all of its ticks. (A fast GPU gives about 100 frames.) The no-flicker check below is the same on every machine.
        const ticksSeen = inHack.length ? (inHack[inHack.length - 1]?.tick ?? 0) - (inHack[0]?.tick ?? 0) : 0;
        console.log(`SJE3D flicker watch: the 3D scene was on top for ${ticksSeen} ticks`);
        expect(inHack.length, 'frames in the 3D scene').toBeGreaterThanOrEqual(100 / MAX_TICKS_PER_FRAME - 2);
        expect(ticksSeen, 'ticks covered by the frames in the 3D scene').toBeGreaterThanOrEqual(90);
        // A blank, cleared or half-drawn frame is almost one colour (over 90%). The measured worst is 41 to 43% (the lab's own background), so 0.6 leaves room and still catches a half-cleared frame.
        expect(worst, 'a frame that is mostly one colour (flicker)').toBeLessThan(0.6);
      },
      { query: 'frame=auto' },
    );
  });
});

test.describe('3D scene: the 2D HUD over it (V1, V5)', () => {
  test('the HUD panels and text equal a Canvas 2D drawing, pixel for pixel, with no glow bleeding in', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 900 });
      for (const t of [30, 200, 420]) {
        const r = await page.evaluate((n) => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          h.step(n - (h.sim()?.tick ?? 0));
          return h.hudParity();
        }, t);
        console.log(`SJE3D HUD at tick ${t}: NODE panel ${r.node.differing} of ${r.node.total} differ (max ${r.node.maxDiff}); caption strip ${r.caption.differing} of ${r.caption.total} differ (max ${r.caption.maxDiff}); NODE panel colours ${r.nodeColours}`);
        expect(r.node.differing, `NODE panel at tick ${t}`).toBe(0);
        expect(r.caption.differing, `caption strip at tick ${t}`).toBe(0);
        // The panel shows its edge, its fill, the text and the text's shadow: 4 colours. The 3D glow does not reach it.
        expect(r.nodeColours).toBeLessThanOrEqual(4);
      }
    });
  });

  test('legible: the HUD text is at least 7:1 against its panel (WCAG AAA), and the panel does not move while the 3D underneath does', async ({ browser }) => {
    const luminance = (hex: number): number => {
      const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    const ratio = (a: number, b: number): number => {
      const [hi, lo] = [Math.max(luminance(a), luminance(b)), Math.min(luminance(a), luminance(b))];
      return (hi + 0.05) / (lo + 0.05);
    };
    // The HUD's colours (src/hack3d/hud.ts): panel 0a0918; text cyan 3fe0f0, bright f4f1ff, dim b0b4cc.
    const panel = 0x0a0918;
    const texts = { cyan: 0x3fe0f0, bright: 0xf4f1ff, dim: 0xb0b4cc };
    for (const [name, colour] of Object.entries(texts)) {
      console.log(`SJE3D HUD contrast ${name}: ${ratio(colour, panel).toFixed(1)}:1`);
      expect(ratio(colour, panel), `${name} on the panel`).toBeGreaterThanOrEqual(7);
    }
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 900 });
      // The NODE panel is a fixed rectangle: its pixels are the same at two ticks, while the 3D under the rest of the screen is not.
      const hashes = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const panelHash = () => h.regionHash(396, 6, 78, 18);
        h.step(30);
        const a = panelHash();
        const whole1 = h.hash();
        h.step(200);
        return { panelSame: a === panelHash(), screenSame: whole1 === h.hash() };
      });
      expect(hashes.panelSame).toBe(true);
      expect(hashes.screenSame).toBe(false);
    });
  });
});

test.describe('3D scene: crisp pixels with the 2D HUD over the 3D', () => {
  for (const { dpr, viewport, k } of RATIOS) {
    test(`every ${k}x${k} block is one flat colour at device pixel ratio ${dpr}, in the canvas and in a screenshot of the page`, async ({ browser }) => {
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: 900 });
          await step(page, 77);
          const info = await page.evaluate(() => window.__SJE__?.info());
          expect(info?.k).toBe(k);
          for (const tick of [80, 200, 333]) {
            const blocks = await page.evaluate((t) => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              h.step(t - (h.sim()?.tick ?? 0));
              return h.canvasBlocks();
            }, tick);
            expect([blocks.canvasW, blocks.canvasH]).toEqual([480 * k, 270 * k]);
            expect(blocks.blocks).toBe(480 * 270);
            expect(blocks.bad, `uneven ${k}x${k} blocks of the canvas at tick ${tick}, dpr ${dpr}: ${JSON.stringify(blocks.samples)}`).toBe(0);
          }
          // And what the compositor shows: a screenshot of the page, the picture's own rectangle.
          const pic = await page.evaluate(() => window.__SJE__?.picture());
          const shot = await page.screenshot();
          const region = { x: pic?.x ?? 0, y: pic?.y ?? 0, w: 480 * k, h: 270 * k };
          const url = `data:image/png;base64,${shot.toString('base64')}`;
          const blocks = await page.evaluate(([u, kk, r]) => window.__SJE__?.imageBlocks(u as string, kk as number, r as typeof region), [url, k, region]);
          expect(blocks?.bad, `uneven blocks in the screenshot at dpr ${dpr}: ${JSON.stringify(blocks?.samples)}`).toBe(0);
          if (dpr === 1) save('hack-zoom4-page.png', url);
        },
        { dpr, viewport },
      );
    });
  }
});

test.describe('the story bridge: a script that awaits a hack and continues (decision E19, E11)', () => {
  /** Tick the game until the story is done, recording which scene is on top whenever it changes. */
  async function runStory(page: import('@playwright/test').Page, def: Record<string, unknown>, holdTicks = 8): Promise<{ tops: string[]; boxPixels: number[][] }> {
    await page.evaluate(
      ([d, hold]) => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        h.hackHud(true);
        h.storyStart(d as Parameters<typeof h.storyStart>[0], hold as number);
      },
      [def, holdTicks] as const,
    );
    const tops: string[] = [];
    const boxPixels: number[][] = [];
    for (let i = 0; i < 4000; i++) {
      const state = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const s = h.scenes();
        const top = s[s.length - 1] ?? '';
        // The dialog box's pink corner pixel (20,222) when a line is up.
        // Draw first: the line was just pushed and the back buffer still shows the frame before it.
        if (top === 'LineScene') h.render();
        return { done: h.story().done, top, corner: top === 'LineScene' ? h.pixel(20, 222) : null };
      });
      if (state.top !== tops[tops.length - 1] && state.top !== '') tops.push(state.top);
      if (state.corner) boxPixels.push(state.corner);
      if (state.done) break;
      // The chunk loads asynchronously the first time: give the page a moment, then tick.
      await page.evaluate(() => window.__SJE__?.step(1));
      if (i % 20 === 0) await page.waitForTimeout(5);
    }
    return { tops, boxPixels };
  }

  test('a 2D line, then the 3D scene, then a 2D line: the story continues after the hack, with its result', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const { tops, boxPixels } = await runStory(page, { ticks: 90 });
      const story = await page.evaluate(() => window.__SJE__?.story());
      console.log(`SJE3D story: tops ${tops.join(' > ')}; log ${story?.log.map((e) => `${e.what}@${e.tick}`).join(' | ')}`);
      // The scene on top, each time it changed: the first line, the lab alone while the 3D chunk loads, the 3D scene, the last line, the lab again.
      expect(tops).toEqual(['LineScene', 'LabScene', 'HackScene', 'LineScene', 'LabScene']);
      // The story's own log: in order, and the line AFTER the hack came after its result.
      const what = (story?.log ?? []).map((e) => e.what.replace(/:.*/, ''));
      expect(what).toEqual(['say', 'hack-start', 'hack-result', 'outcome', 'say', 'story-end']);
      expect(story?.log.find((e) => e.what.startsWith('hack-result'))?.what).toBe('hack-result: success');
      expect(story?.outcome).toEqual({ outcome: 'success', via: 'played', results: ['success'] });
      // The 2D line really was on screen (its pink edge at the box's corner), before and after.
      expect(boxPixels.length).toBeGreaterThan(8);
      for (const p of boxPixels) expect(p.slice(0, 3)).toEqual([0xff, 0x4f, 0xb0]);
      // Ticks only moved forward through the story, and the 3D scene ran for its 90 ticks.
      const ticks = (story?.log ?? []).map((e) => e.tick);
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
      const hackTicks = (story?.log.find((e) => e.what.startsWith('hack-result'))?.tick ?? 0) - (story?.log.find((e) => e.what === 'hack-start')?.tick ?? 0);
      expect(hackTicks).toBeGreaterThanOrEqual(90);
      expect(await page.evaluate(() => window.__SJE__?.scenes())).toEqual(['LabScene']);
    });
  });

  test('a hack the player fails: the result is fail, the story continues with it', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      await runStory(page, { ticks: 2000, traceLimit: 10, hitCost: 30 });
      const story = await page.evaluate(() => window.__SJE__?.story());
      expect(story?.outcome).toEqual({ outcome: 'fail', via: 'played', results: ['fail'] });
      expect(story?.log.at(-1)?.what).toBe('story-end');
    });
  });

  test('a hack that is dropped (game.abandon) still resolves: aborted / user, never a promise left hanging', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 5000 });
      await step(page, 10);
      expect(await page.evaluate(() => window.__SJE__?.hackResult())).toBeNull();
      await page.evaluate(() => window.__SJE__?.abandon());
      await page.waitForFunction(() => window.__SJE__?.hackResult() !== null, null, { timeout: 5000 });
      expect(await page.evaluate(() => window.__SJE__?.hackResult())).toMatchObject({ status: 'aborted', reason: 'user' });
      expect(await page.evaluate(() => window.__SJE__?.scenes())).toEqual([]);
    });
  });
});

test.describe('fallback: context loss, no WebGL2, a chunk that will not load (P3)', () => {
  // What the browser says when the lab loses its context on purpose.
  const LOSS_NOISE = [/context lost/i, /WEBGL_lose_context/i, /CONTEXT_LOST_WEBGL/i, /Context Lost/];

  test('a context lost for good: the hack resolves aborted/context-lost within 2 seconds, and the story continues', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        await page.evaluate(() => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          h.hackHud(true);
          h.storyStart({ ticks: 5000 }, 4);
        });
        // Tick until the 3D scene is running (the chunk loads on the way).
        for (let i = 0; i < 4000; i++) {
          if (await page.evaluate(() => window.__SJE__?.scenes().includes('HackScene'))) break;
          await page.evaluate(() => window.__SJE__?.step(1));
          if (i % 10 === 0) await page.waitForTimeout(5);
        }
        await step(page, 30);
        // THE LOSS. Then measure how long the hack takes to give an answer, with real time, no ticks.
        const lost = await page.evaluate(async () => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          const t0 = performance.now();
          await h.loseContext();
          const eventAt = performance.now() - t0;
          const hackResultAt = await new Promise<number>((resolve) => {
            const poll = () => {
              const r = h.story().lastResult;
              if (r) resolve(performance.now() - t0);
              else setTimeout(poll, 10);
            };
            poll();
          });
          return { eventAt, hackResultAt, story: h.story() };
        });
        console.log(`SJE3D context loss: the lost event after ${lost.eventAt.toFixed(0)} ms; the hack resolved after ${lost.hackResultAt.toFixed(0)} ms with ${JSON.stringify(lost.story.lastResult)}`);
        expect(lost.story.lastResult).toMatchObject({ status: 'aborted', reason: 'context-lost' });
        expect(lost.hackResultAt, 'the hack must give its fallback result within 2 seconds of the loss').toBeLessThan(2000);
        // The author's policy (the default: retry once, then count it as won). The retry sees the lost context and ends at once.
        for (let i = 0; i < 400; i++) {
          if (await page.evaluate(() => window.__SJE__?.story().done)) break;
          await page.evaluate(() => window.__SJE__?.step(1));
        }
        const story = await page.evaluate(() => window.__SJE__?.story());
        expect(story?.done).toBe(true);
        expect(story?.outcome).toEqual({ outcome: 'success', via: 'policy', results: ['aborted (context-lost)', 'aborted (context-lost)'] });
        const names = (story?.log ?? []).map((e) => e.what.replace(/:.*/, ''));
        expect(names).toEqual(['say', 'hack-start', 'hack-result', 'hack-start', 'hack-result', 'outcome', 'say', 'story-end']);
        // The retry saw the lost context and ended at once: the policy added no second wait after the first result.
        const results = (story?.log ?? []).filter((e) => e.what.startsWith('hack-result'));
        const outcomeAt = story?.log.find((e) => e.what.startsWith('outcome'))?.ms ?? 0;
        console.log(`SJE3D policy: first result at ${results[0]?.ms} ms, retry result at ${results[1]?.ms} ms, outcome at ${outcomeAt} ms (story clock)`);
        expect(outcomeAt - (results[0]?.ms ?? 0), 'the retry must not wait for a second watchdog').toBeLessThan(500);
        expect(await page.evaluate(() => window.__SJE__?.scenes())).toEqual(['LabScene']);
        // Give the context back: the engine recovers (the 2D lab draws again, identical blocks, no GL errors).
        await page.evaluate(() => window.__SJE__?.restoreContext());
        const after = await page.evaluate(() => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          h.render();
          return { bad: h.canvasBlocks().bad, errors: h.glErrors(), lost: h.contextLost() };
        });
        expect(after).toEqual({ bad: 0, errors: [], lost: false });
      },
      { allow: LOSS_NOISE },
    );
  });

  test('a context that comes back in time: the scene carries on and draws the picture it would have drawn with no loss', async ({ browser }) => {
    const runOnce = async (lose: boolean): Promise<{ hash: string; rewraps: number; result: unknown }> => {
      let out: { hash: string; rewraps: number; result: unknown } = { hash: '', rewraps: -1, result: null };
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: 5000 });
          await step(page, 50);
          if (lose) {
            await page.evaluate(async () => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              await h.loseContext();
              h.render(); // drawing while lost must not throw
              await h.restoreContext();
            });
          }
          const hash = await step(page, 50);
          const frame = await page.evaluate(() => window.__SJE__?.frame());
          out = { hash, rewraps: frame?.rewraps ?? -1, result: await page.evaluate(() => window.__SJE__?.hackResult()) };
          expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
        },
        { allow: LOSS_NOISE },
      );
      return out;
    };
    const clean = await runOnce(false);
    const interrupted = await runOnce(true);
    console.log(`SJE3D loss and restore: rewraps ${interrupted.rewraps}; hash with loss ${interrupted.hash} against ${clean.hash} without`);
    expect(interrupted.result).toBeNull(); // still running: the watchdog did not fire
    expect(interrupted.rewraps).toBe(1); // Three made a new GL texture, and the frame re-pointed Pixi at it
    // A stale wrapper would show the wrong pixels (lab: 125,088 of them). The picture must be the one with no loss.
    expect(interrupted.hash).toBe(clean.hash);
  });

  test('leaving the scene after a restore is silent: no warning from Three deleting handles of the lost context, when the hack ends or is dropped', async ({ browser }) => {
    // The bug (round 1 of the B2 verifiers): after a loss that recovered, ending the scene logged 168 "object does not belong to
    // this context" warnings. LOSS_NOISE does not allow that message, so any warning at teardown fails the test.
    for (const ending of ['dropped', 'finished'] as const) {
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: ending === 'finished' ? 160 : 5000 });
          await step(page, 40);
          await page.evaluate(async () => {
            const h = window.__SJE__;
            if (!h) throw new Error('no hook');
            await h.loseContext();
            await h.restoreContext();
          });
          await step(page, 40);
          expect(await page.evaluate(() => window.__SJE__?.hackResult()), 'still running after the restore').toBeNull();
          if (ending === 'dropped') await page.evaluate(() => window.__SJE__?.abandon());
          else await step(page, 200);
          await step(page, 3);
          expect(await page.evaluate(() => window.__SJE__?.scenes()), `scene stack after the hack was ${ending}`).toEqual(ending === 'dropped' ? [] : ['LabScene']); // abandon drops the whole stack, the lab scene too
          if (ending === 'finished') expect(await page.evaluate(() => window.__SJE__?.hackResult())).toMatchObject({ status: 'success' });
          expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
        },
        { allow: LOSS_NOISE },
      );
    }
  });

  test('after a loss and a restore a NEW hack works: it draws the picture a fresh page draws at the same tick (the cached Three renderer survived)', async ({ browser }) => {
    let fresh = '';
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 5000 });
      await step(page, 80);
      fresh = (await page.evaluate(() => window.__SJE__?.frameHash())) ?? '';
    });
    expect(fresh).not.toBe('');
    await withLab(
      browser,
      async ({ page }) => {
        await startHack(page, { ticks: 5000 });
        await step(page, 30);
        await page.evaluate(() => window.__SJE__?.loseContext());
        // The watchdog ends the first hack (the context is lost for good for now).
        await page.waitForFunction(() => window.__SJE__?.hackResult() !== null, null, { timeout: 4000 });
        expect(await page.evaluate(() => window.__SJE__?.hackResult())).toMatchObject({ status: 'aborted', reason: 'context-lost' });
        await page.evaluate(() => window.__SJE__?.restoreContext());
        expect(await page.evaluate(() => window.__SJE__?.scenes())).toEqual(['LabScene']);
        // The second hack uses the Three renderer that the first one made (one per page).
        await startHack(page, { ticks: 5000 });
        await step(page, 80);
        const frame = await page.evaluate(() => window.__SJE__?.frame());
        expect(frame).toMatchObject({ mode: 'shared-context', contextLost: false });
        expect(frame?.hosts, 'one Three renderer for the whole page, loss or no loss').toEqual({ shared: 1, private: 0 });
        expect(await page.evaluate(() => window.__SJE__?.glErrors()), 'GL error flags').toEqual([]);
        const raw = await page.evaluate(() => window.__SJE__?.framePixels());
        const colours = new Set<number>();
        const px = bytesOf(raw?.base64 ?? '');
        for (let i = 0; i < px.length; i += 4) colours.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
        expect(colours.size, 'a non-blank picture').toBeGreaterThan(300);
        expect(await page.evaluate(() => window.__SJE__?.frameHash()), 'the same picture as a page that never lost its context').toBe(fresh);
        expect(await page.evaluate(() => window.__SJE__?.canvasBlocks().bad)).toBe(0);
        // Leaving it is silent too.
        await page.evaluate(() => window.__SJE__?.abandon());
        await step(page, 3);
      },
      { allow: LOSS_NOISE },
    );
  });

  test('canvas-copy fallback, its PRIVATE context lost and back in time: the scene carries on with the picture it would have drawn, and leaving is silent', async ({ browser }) => {
    const runOnce = async (lose: boolean): Promise<{ hash: string; result: unknown }> => {
      let out = { hash: '', result: null as unknown };
      await withLab(
        browser,
        async ({ page }) => {
          await startHack(page, { ticks: 5000 });
          await step(page, 50);
          expect(await page.evaluate(() => window.__SJE__?.frame()?.mode)).toBe('canvas-copy');
          if (lose) {
            const engineLost = await page.evaluate(async () => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              await h.losePrivateContext();
              h.render(); // drawing while it is lost must not throw, and must not touch the engine's context
              const engine = h.contextLost();
              await h.restorePrivateContext();
              return engine;
            });
            expect(engineLost, 'the ENGINE context stays up').toBe(false);
          }
          await step(page, 50);
          out = { hash: (await page.evaluate(() => window.__SJE__?.frameHash())) ?? '', result: await page.evaluate(() => window.__SJE__?.hackResult()) };
          expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
          expect(await page.evaluate(() => window.__SJE__?.canvasBlocks().bad)).toBe(0);
          await page.evaluate(() => window.__SJE__?.abandon());
          await step(page, 3);
        },
        { query: 'manual&frame=canvas-copy', allow: LOSS_NOISE },
      );
      return out;
    };
    const clean = await runOnce(false);
    const interrupted = await runOnce(true);
    console.log(`SJE3D canvas-copy private loss and restore: hash with loss ${interrupted.hash} against ${clean.hash} without`);
    expect(interrupted.result).toBeNull();
    expect(interrupted.hash).not.toBe('');
    expect(interrupted.hash).toBe(clean.hash);
  });

  test('canvas-copy fallback, its PRIVATE context lost for good: the hack resolves aborted/context-lost within 2 seconds, and a new hack works after the restore', async ({ browser }) => {
    // The REAL loop (no ?manual): the scene finds out that the private context is gone when it tries to draw.
    await withLab(
      browser,
      async ({ page }) => {
        await startHack(page, { ticks: 100_000 });
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.__SJE__?.frame()?.mode)).toBe('canvas-copy');
        const lost = await page.evaluate(async () => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          const t0 = performance.now();
          await h.losePrivateContext();
          const at = await new Promise<number>((resolve) => {
            const poll = (): void => (h.hackResult() ? resolve(performance.now() - t0) : void setTimeout(poll, 10));
            poll();
          });
          return { at, result: h.hackResult(), engineLost: h.contextLost() };
        });
        console.log(`SJE3D canvas-copy private loss: the hack resolved after ${lost.at.toFixed(0)} ms with ${JSON.stringify(lost.result)}`);
        expect(lost.result).toMatchObject({ status: 'aborted', reason: 'context-lost' });
        expect(lost.at, 'within 2 seconds of the loss').toBeLessThan(2000);
        expect(lost.engineLost).toBe(false);
        await page.evaluate(() => window.__SJE__?.restorePrivateContext());
        // A new hack on the Three renderer that survived: it runs and draws.
        await startHack(page, { ticks: 100_000 });
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.__SJE__?.hackResult()), 'the new hack is still running').toBeNull();
        const frame = await page.evaluate(() => window.__SJE__?.frame());
        expect(frame).toMatchObject({ mode: 'canvas-copy', contextLost: false });
        expect(frame?.hosts, 'one private Three renderer for the whole page').toEqual({ shared: 0, private: 1 });
        const px = bytesOf((await page.evaluate(() => window.__SJE__?.framePixels()))?.base64 ?? '');
        const colours = new Set<number>();
        for (let i = 0; i < px.length; i += 4) colours.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
        expect(colours.size, 'a non-blank picture').toBeGreaterThan(300);
        await page.evaluate(() => window.__SJE__?.abandon());
        await page.waitForTimeout(100);
      },
      { query: 'frame=canvas-copy', allow: LOSS_NOISE },
    );
  });

  test('WebGL2 switched off: the hack resolves "unsupported" at once, without loading the 3D chunk, and the story plays its 2D alternative', async ({ browser }) => {
    await withLab(browser, async ({ page, requests }) => {
      // The engine is up (WebGL2 worked at boot). NOW the browser stops giving WebGL2 contexts, as a blocked GPU does.
      // ORDER MATTERS: `probeWebGL2` keeps a `true` answer for the life of the page (src/sje/render/glcontext.ts). Nothing has called it on this
      // page yet (the lab boot does not), so the first hack's probe sees the override below. A warm-up hack or story before this point would
      // have cached `true`, and this test would then fail for that reason, not for a defect. (`resetProbeWebGL2` forgets the answer, for unit tests.)
      await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the browser's overloaded method.
        (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          // biome-ignore lint/suspicious/noExplicitAny: same.
          return type === 'webgl2' ? null : (original as any).call(this, type, ...rest);
        };
      });
      const before = requests.length;
      // First, the raw door: one try.
      const raw = await page.evaluate(async () => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        h.hackStart({ ticks: 600 });
        for (let i = 0; i < 400 && !h.hackResult(); i++) await new Promise((r) => setTimeout(r, 5));
        return h.hackResult();
      });
      console.log(`SJE3D no WebGL2: the door answered ${JSON.stringify(raw)}`);
      expect(raw).toMatchObject({ status: 'unsupported', reason: 'no-webgl2' });
      expect(raw?.ms, 'unsupported must come at once').toBeLessThan(500);
      // Then the story: the default policy plays the authored 2D alternative, and the story continues.
      await page.evaluate(() => window.__SJE__?.storyStart({ ticks: 600 }, 5));
      for (let i = 0; i < 600; i++) {
        if (await page.evaluate(() => window.__SJE__?.story().done)) break;
        await page.evaluate(() => window.__SJE__?.step(1));
        if (i % 10 === 0) await page.waitForTimeout(5);
      }
      const story = await page.evaluate(() => window.__SJE__?.story());
      expect(story?.lastResult).toMatchObject({ status: 'unsupported', reason: 'no-webgl2' });
      expect(story?.outcome).toEqual({ outcome: 'success', via: 'alternative', results: ['unsupported (no-webgl2)'] });
      expect((story?.log ?? []).map((e) => e.what.replace(/:.*/, ''))).toEqual(['say', 'hack-start', 'hack-result', 'alternative-2d', 'say', 'outcome', 'say', 'story-end']);
      // The 3D chunk was never requested: not the hack scene, not Three.
      const newRequests = requests.slice(before);
      expect(newRequests.filter((u) => /hack3d|\/three|sje\/three/.test(u))).toEqual([]);
    });
  });

  test('a 3D chunk that will not load: the hack resolves unsupported / chunk-failed, and the story still continues', async ({ browser }) => {
    const lab = await openLab(browser, { allow: [/Failed to load resource|net::ERR|Failed to fetch dynamically imported module|the 3D chunk would not load/i] });
    try {
      await lab.page.route(/\/src\/hack3d\/index\.ts/, (route) => route.abort());
      await lab.page.evaluate(() => window.__SJE__?.storyStart({ ticks: 600 }, 5));
      for (let i = 0; i < 600; i++) {
        if (await lab.page.evaluate(() => window.__SJE__?.story().done)) break;
        await lab.page.evaluate(() => window.__SJE__?.step(1));
        if (i % 10 === 0) await lab.page.waitForTimeout(5);
      }
      const story = await lab.page.evaluate(() => window.__SJE__?.story());
      expect(story?.lastResult).toMatchObject({ status: 'unsupported', reason: 'chunk-failed' });
      expect(story?.outcome?.via).toBe('alternative');
      expect(story?.done).toBe(true);
    } finally {
      await lab.close();
    }
  });
});

test.describe('lifetime: enter and leave the 3D scene (P4)', () => {
  for (const frame of ['shared-context', 'canvas-copy']) {
    test(`10 cycles leave the WebGL object counts flat and the JS heap within 5% (${frame})`, async ({ browser }, testInfo) => {
      const lab = await openLab(browser, { query: `manual&frame=${frame}` });
      try {
        const { page } = lab;
        // Garbage collection and heap size through the DevTools protocol (Chromium only).
        const cdp = testInfo.project.name === 'chromium' ? await page.context().newCDPSession(page) : null;
        const heap = async (): Promise<number> => {
          if (!cdp) return 0;
          await cdp.send('HeapProfiler.collectGarbage');
          await cdp.send('HeapProfiler.collectGarbage');
          return (await cdp.send('Runtime.getHeapUsage')).usedSize;
        };
        // Warm up: the chunk, the shaders, the buffers Pixi and Three make the first time. Several cycles, so nothing lazy is left.
        const warm = await page.evaluate(() => window.__SJE__?.hackCycles(4));
        expect(warm).toEqual(['success', 'success', 'success', 'success']);
        const baseline = await page.evaluate(() => window.__SJE__?.glCounts());
        const heap0 = await heap();
        const cycles = await page.evaluate(() => window.__SJE__?.hackCycles(10));
        expect(cycles).toEqual(Array(10).fill('success'));
        const after = await page.evaluate(() => window.__SJE__?.glCounts());
        const heap1 = await heap();
        // The negative control: a deliberate leak MUST show, or the counter proves nothing.
        await page.evaluate(() => window.__SJE__?.leakOnPurpose(6));
        const leaked = await page.evaluate(() => window.__SJE__?.glCounts());
        const growth = heap0 > 0 ? (heap1 - heap0) / heap0 : 0;
        console.log(`SJE3D leaks (${frame}): GL counts baseline ${JSON.stringify(baseline)} after 10 cycles ${JSON.stringify(after)}; heap ${heap0} -> ${heap1} bytes (${(growth * 100).toFixed(2)}%); after a deliberate leak of 6 textures ${leaked?.texture} textures`);
        expect(after).toEqual(baseline);
        // ONE Three renderer of each kind for the whole page, never one per entry (frame-and-rendering.md 7.2, rule 1).
        const facts = await page.evaluate(() => window.__SJE__?.frame() ?? null);
        expect(facts).toBeNull(); // no hack is running now; read the counts through a new one
        await page.evaluate(() => window.__SJE__?.hackStart({ ticks: 600 }));
        await page.waitForFunction(() => window.__SJE__?.scenes().includes('HackScene') === true);
        const hosts = (await page.evaluate(() => window.__SJE__?.frame()))?.hosts;
        console.log(`SJE3D Three renderers made in the whole page (${frame}): ${JSON.stringify(hosts)} after 15 entries`);
        expect(hosts).toEqual({ shared: frame === 'canvas-copy' ? 0 : 1, private: frame === 'canvas-copy' ? 1 : 0 });
        await page.evaluate(() => window.__SJE__?.abandon());
        expect((leaked?.texture ?? 0) - (after?.texture ?? 0)).toBeGreaterThanOrEqual(6);
        if (cdp) expect(growth, 'JS heap growth after garbage collection').toBeLessThan(0.05);
        expect(lab.problems).toEqual([]);
      } finally {
        await lab.close();
      }
    });
  }
});

test.describe('the GlHandoff canary (frame-and-rendering.md 7.3)', () => {
  test('a filtered container with a transparent gap, over a Three picture with a non-black background: the gap shows the 3D picture', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      await startHack(page, { ticks: 5000 }, { hud: false });
      await step(page, 120);
      // The negative control needs the condition that lets the bug show: a back buffer cleared to (0,0,0,0).
      const run = async (fixOn: boolean, transparent: boolean) => {
        const r = await page.evaluate(([f, t]) => window.__SJE__?.canary(f as boolean, t as boolean), [fixOn, transparent] as const);
        if (!r) throw new Error('no canary result');
        return r;
      };
      const production = await run(true, false); // the engine as shipped: void colour back buffer, hand-off on
      const productionNoFix = await run(false, false); // same, hand-off off: shielded by the non-zero clear colour
      const withFix = await run(true, true); // transparent back buffer, hand-off ON: must be right
      const withoutFix = await run(false, true); // transparent back buffer, hand-off OFF: must show the bug
      console.log(`SJE3D canary: shipped config ${production.gapWrong} wrong; shipped config, fix off ${productionNoFix.gapWrong} wrong (shielded); transparent back buffer, fix on ${withFix.gapWrong} wrong; fix off ${withoutFix.gapWrong} wrong of ${withoutFix.gapTotal}, first ${JSON.stringify(withoutFix.firstWrong)}`);
      expect(production.gapWrong).toBe(0);
      expect(production.rectsWrong).toBe(0);
      expect(withFix.gapWrong).toBe(0);
      expect(withFix.rectsWrong).toBe(0);
      // The canary can fail: with the fix switched off, every gap pixel is Three's leftover clear colour instead of the 3D picture.
      expect(withoutFix.gapWrong).toBeGreaterThan(0);
      expect(withoutFix.gapTotal).toBe(2800);
      // And the switch went back on: the next check is clean again.
      expect((await run(true, true)).gapWrong).toBe(0);
      expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
    });
  });
});

/**
 * THE SPEED LINE (P6), clarified by the main session on 2026-10-04 and made testable in round 4.
 * "60 fps" means NO DROPPED FRAMES against the display's own refresh rate (this machine's display runs at about 56.6 Hz, so even a bare
 * page takes 17.7 ms a frame). Two rules, both measured on a real GPU:
 *   1. INTERVAL: the 3D scene's frame interval p95 is within 5% of a bare requestAnimationFrame page on the same display.
 *   2. COST: what a frame costs, p95, is at most 8 ms. The cost INCLUDES the wait for the GPU (see src/sje-lab/profile.ts). The first
 *      version timed JavaScript only, which on a GPU is just the time to submit commands, so it could not fail for a slow GPU.
 * Rule 1 alone cannot fail on a display locked to its refresh rate (the scene's interval cannot go below the bare page's), so rule 2 is
 * what gives HEADROOM: a cost of 8 ms in a 17.7 ms frame leaves room for the game's own work. The NEGATIVE CONTROL below runs the same
 * rules on a scene made much too heavy, and they must fail.
 */
const SPEED_LINE = { intervalRatio: 1.05, costMs: 8 };

/** Which rules of the speed line a run breaks. Empty means it meets the line. Pure, so the control can prove the rules have teeth. */
function speedLineMisses(m: { bareP95: number; sceneP95: number; costP95: number }): string[] {
  const misses: string[] = [];
  if (m.sceneP95 > m.bareP95 * SPEED_LINE.intervalRatio) misses.push(`interval p95 ${m.sceneP95.toFixed(2)} ms is over ${(m.bareP95 * SPEED_LINE.intervalRatio).toFixed(2)} ms (bare page p95 ${m.bareP95.toFixed(2)} ms plus 5%)`);
  if (m.costP95 > SPEED_LINE.costMs) misses.push(`cost p95 ${m.costP95.toFixed(2)} ms is over ${SPEED_LINE.costMs} ms`);
  return misses;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

test.describe('speed (P6): 60 fps means no dropped frames against the display, on the GPU', () => {
  test('the rules of the speed line have teeth (pure check, no browser)', () => {
    expect(speedLineMisses({ bareP95: 17.7, sceneP95: 17.7, costP95: 2 })).toEqual([]);
    expect(speedLineMisses({ bareP95: 17.7, sceneP95: 17.7, costP95: 8 })).toEqual([]);
    expect(speedLineMisses({ bareP95: 17.7, sceneP95: 17.7, costP95: 8.5 })).toHaveLength(1);
    expect(speedLineMisses({ bareP95: 17.7, sceneP95: 18.7, costP95: 2 })).toHaveLength(1);
    expect(speedLineMisses({ bareP95: 17.7, sceneP95: 35, costP95: 30 })).toHaveLength(2);
  });

  /** A bare requestAnimationFrame page on this display: what a frame interval is when nothing runs. */
  async function bareIntervals(browser: Browser, frames: number): Promise<number[]> {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    try {
      const page = await context.newPage();
      await page.goto('about:blank');
      const measure = (): Promise<number[]> =>
        page.evaluate(
          (n) =>
            new Promise<number[]>((resolve) => {
              const out: number[] = [];
              let last = performance.now();
              const tick = (now: number) => {
                out.push(now - last);
                last = now;
                if (out.length < n) requestAnimationFrame(tick);
                else resolve(out.slice(30));
              };
              requestAnimationFrame(tick);
            }),
          frames,
        );
      await measure(); // warm up the page
      return await measure();
    } finally {
      await context.close();
    }
  }

  /** The lab on the real loop with the 3D scene running (bloom on, the HUD on, 5 pieces of ICE), warmed up. */
  async function runningScene(browser: Browser) {
    const lab = await openLab(browser, { query: 'frame=auto' });
    const { page } = lab;
    await page.evaluate(() => {
      const h = window.__SJE__;
      if (!h) throw new Error('no hook');
      h.hackHud(true);
      // A limit above 100 never fails (traceLimit, result.ts): the scene must stay up for the whole measurement. (Rounds 2 and 3 used the
      // default limit, and the hack could FAIL part way through, leaving the plain 2D lab on screen for the rest of the run.)
      h.hackStart({ ticks: 1_000_000, iceCount: 5, traceLimit: 101 });
    });
    await page.waitForFunction(() => window.__SJE__?.scenes().includes('HackScene') === true, null, { timeout: 60_000 });
    await page.evaluate(() => window.__SJE__?.profileLoop(120)); // warm up: shaders, the first bloom frames
    return lab;
  }

  /** The 3D scene must be the thing that was measured: it is still on the stack, and its hack has not ended. */
  async function expectSceneStillUp(page: Page, when: string): Promise<void> {
    expect(await page.evaluate(() => window.__SJE__?.scenes()), `the 3D scene was still on screen ${when}`).toContain('HackScene');
    expect(await page.evaluate(() => window.__SJE__?.hackResult()), `the hack has not ended ${when}`).toBeNull();
  }

  test("the 3D scene with bloom keeps the display's own frame interval (p95 within 5% of a bare page), and a frame costs at most 8 ms, GPU wait included", async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const frames = 600;
    const bare = await bareIntervals(browser, frames);
    const lab = await runningScene(browser);
    try {
      const { page } = lab;
      const soft = await isSoftware(page);
      // Run 1: the real loop as it is. Intervals, and the JavaScript time of the engine's work.
      const plain = await page.evaluate((n) => window.__SJE__?.profileLoop(n), frames);
      await expectSceneStillUp(page, 'after the interval run');
      // Run 2: the same, with a one pixel read-back after each draw, so the frame's cost includes the GPU. (It stalls the loop, so
      // it is a run of its own and its intervals are not used.)
      const synced = await page.evaluate((n) => window.__SJE__?.profileLoop(n, { sync: true }), 300);
      await expectSceneStillUp(page, 'after the cost run');
      // Run 3: the GPU's own clock, if this browser exposes the timer extension.
      const timed = await page.evaluate((n) => window.__SJE__?.profileLoop(n, { gpuTimer: true }), 300);
      await expectSceneStillUp(page, 'after the GPU timer run');
      const intervals = (plain?.intervals ?? []).slice(30);
      const work = (plain?.work ?? []).slice(30);
      const cost = (synced?.cost ?? []).slice(30);
      const gpu = (timed?.gpu ?? []).slice(10);
      const measured = { bareP95: percentile(bare, 0.95), sceneP95: percentile(intervals, 0.95), costP95: percentile(cost, 0.95) };
      const info = await page.evaluate(() => window.__SJE__?.info());
      const line =
        `SJE3D SPEED on ${info?.renderer}: bare rAF page p50 ${percentile(bare, 0.5).toFixed(2)} p95 ${measured.bareP95.toFixed(2)} ms | 3D scene frame interval p50 ${percentile(intervals, 0.5).toFixed(2)} p95 ${measured.sceneP95.toFixed(2)} max ${Math.max(...intervals).toFixed(1)} ms (ratio ${(measured.sceneP95 / measured.bareP95).toFixed(3)}) | ` +
        `JavaScript work (a CPU number) mean ${mean(work).toFixed(2)} p95 ${percentile(work, 0.95).toFixed(2)} max ${Math.max(...work).toFixed(2)} ms | ` +
        `FRAME COST with the GPU wait: mean ${mean(cost).toFixed(2)} p50 ${percentile(cost, 0.5).toFixed(2)} p95 ${measured.costP95.toFixed(2)} max ${Math.max(...cost).toFixed(2)} ms | ` +
        (timed?.gpuTimerAvailable ? `GPU timer query (${gpu.length} samples): mean ${mean(gpu).toFixed(2)} p95 ${percentile(gpu, 0.95).toFixed(2)} max ${Math.max(...gpu).toFixed(2)} ms` : 'GPU timer query: not offered by this browser');
      console.log(line);
      testInfo.annotations.push({ type: 'speed', description: line });
      expect(cost.length, 'frame cost samples').toBeGreaterThan(200);
      if (!soft) {
        // The pass line, on a real GPU.
        const misses = speedLineMisses(measured);
        expect(misses, `the speed line: ${misses.join('; ')}`).toEqual([]);
        expect(percentile(work, 0.95), 'JavaScript work p95').toBeLessThanOrEqual(SPEED_LINE.costMs);
        // When the browser has the GPU's own clock, the GPU's share must fit too (it is part of the cost above, so it is a tighter look at the same limit).
        if (timed?.gpuTimerAvailable && gpu.length > 100) expect(percentile(gpu, 0.95), 'GPU timer p95').toBeLessThanOrEqual(SPEED_LINE.costMs);
      } else {
        // Software GL (CI, PW_NOGPU): the CPU draws every pixel, so timing thresholds belong on a GPU. The numbers are recorded and
        // the gate only catches a stuck loop: a frame interval p95 of 80 ms or more (about 12 frames a second).
        expect(measured.sceneP95).toBeLessThan(80);
      }
      expect(lab.problems.filter((p) => !/GPU stall/.test(p))).toEqual([]);
    } finally {
      await lab.close();
    }
  });

  test('NEGATIVE CONTROL: a scene made far too heavy (the 3D frame drawn 600 extra times a frame) FAILS both rules of the speed line', async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const frames = 300;
    const bare = await bareIntervals(browser, frames);
    const lab = await runningScene(browser);
    try {
      const { page } = lab;
      test.skip(await isSoftware(page), 'the speed line is only judged on a GPU; on software GL everything is slow already');
      const EXTRA = 600;
      const plain = await page.evaluate(([n, extra]) => window.__SJE__?.profileLoop(n as number, { extraRenders: extra as number }), [frames, EXTRA] as const);
      await expectSceneStillUp(page, 'after the heavy interval run');
      const synced = await page.evaluate(([n, extra]) => window.__SJE__?.profileLoop(n as number, { sync: true, extraRenders: extra as number }), [150, EXTRA] as const);
      await expectSceneStillUp(page, 'after the heavy cost run');
      const intervals = (plain?.intervals ?? []).slice(30);
      const cost = (synced?.cost ?? []).slice(20);
      const measured = { bareP95: percentile(bare, 0.95), sceneP95: percentile(intervals, 0.95), costP95: percentile(cost, 0.95) };
      const misses = speedLineMisses(measured);
      const line = `SJE3D SPEED NEGATIVE CONTROL (${EXTRA} extra 3D frames per frame): interval p95 ${measured.sceneP95.toFixed(2)} ms against a bare page's ${measured.bareP95.toFixed(2)} ms, frame cost p95 ${measured.costP95.toFixed(2)} ms -> broken rules: ${JSON.stringify(misses)}`;
      console.log(line);
      testInfo.annotations.push({ type: 'speed-negative-control', description: line });
      // The same rules, on a scene that is too heavy, must report BOTH misses. If this passed with an empty list, the speed test could not fail.
      expect(misses, 'the interval rule fails on the heavy scene').toEqual(expect.arrayContaining([expect.stringContaining('interval')]));
      expect(misses, 'the cost rule fails on the heavy scene').toEqual(expect.arrayContaining([expect.stringContaining('cost')]));
    } finally {
      await lab.close();
    }
  });
});
