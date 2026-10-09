/**
 * The canary suite (docs/engine/tooling-and-testing.md section 8) and the lab checks around it (M0).
 *
 * A CANARY is a Playwright test for one trap from the Pixi and Three research. The traps break quietly:
 * nothing throws, the picture is wrong. Each canary fails if its fix is missing, and each has a NEGATIVE
 * CONTROL: the same check on a build that has the trap on purpose, which must fail. A test that cannot
 * fail proves nothing. The suite runs on every Pixi or Three bump (versions are pinned exactly).
 *
 *   #   canary                          control (must show the bug)
 *   1   stale clear color               GlHandoff clean-up off, back buffer cleared to (0,0,0,0)
 *   2   canvas on init                  Pixi started without `canvas`: no recovery after a context restore
 *   3   destroy kills the context       the source scan flags a bad snippet; a throwaway renderer loses its context
 *   4   ExternalSource scale            a Three target with linear filtering blends the 2x2 blocks
 *   5   stencil mask                    a context made with no stencil buffer lets the panel through
 *   6   Three canvas and context        Three made with only the context: no recovery after a restore
 *   7   no second Pixi loop             `Ticker.system` started: requestAnimationFrame callbacks keep running
 *   8   extension list                  Pixi's default init downloads its environment chunks
 *   9   texture GC                      Pixi's collector on: an idle texture is unloaded
 *   10  texture handle                  the handle hidden: `auto` falls back to the canvas copy with one warning
 *   11  color exactness                 Three's color management left on: #ff2080 comes out as #ff0437
 *   12  frame rewrap                    the frame is not re-pointed after a restore: the picture is stale
 *
 * Around them: boot, no WebGL2, crisp pixels at every ratio, determinism, the GL-object leak check (10 enter
 * and exit cycles stay flat; a deliberate leak grows) and context loss.
 *
 * Run it:  npx playwright test e2e/sje-canaries.spec.ts --reporter=line
 *          CI=1 npx playwright test e2e/sje-canaries.spec.ts   (the bundled Chromium on SwiftShader, like CI)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { bytesOf, CONTROL_NOISE, isSoftware, openLab, SIZE, withLab, zoomFor } from './sjelabkit';

/** One viewport per device pixel ratio. 1280x720 is the CI default: exactly 2x the 640x360 picture. */
const RATIOS = [
  { dpr: 1, viewport: { width: 1920, height: 1080 } },
  { dpr: 1.25, viewport: { width: 1600, height: 900 } },
  { dpr: 1.5, viewport: { width: 1300, height: 730 } },
  { dpr: 1.75, viewport: { width: 1100, height: 620 } },
  { dpr: 2, viewport: { width: 960, height: 540 } },
  { dpr: 2.25, viewport: { width: 1600, height: 900 } },
  // Windows where the ratio does not divide the picture.
  { dpr: 1.1, viewport: { width: 1000, height: 560 } },
  { dpr: 2.5, viewport: { width: 900, height: 520 } },
];

const ROOT = join(import.meta.dirname, '..');

/** Every `.ts` file under `dir`, repo-relative with forward slashes. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) sources(p, out);
    else if (name.endsWith('.ts')) out.push(relative('.', p).split(sep).join('/'));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// The lab around the canaries
// ------------------------------------------------------------------------------------------------

test.describe('lab: boot', () => {
  test('boots on WebGL2 with zero console errors and warnings, and says which renderer drew it', async ({ browser }) => {
    await withLab(browser, async ({ page, problems }) => {
      // Nothing has read a pixel yet: no console error, no warning, none allowed.
      expect(problems, 'console errors and warnings during boot').toEqual([]);
      const info = await page.evaluate(() => window.__SJE__?.info());
      console.log(`SJE renderer: ${info?.renderer} | ${info?.version} | k=${info?.k} dpr=${info?.dpr}`);
      expect(info?.version).toContain('WebGL 2');
      expect([info?.w, info?.h]).toEqual([SIZE.w, SIZE.h]);
      // The lab scene ticked once and drew: something other than the void color is on screen.
      expect(await page.evaluate(() => window.__SJE__?.pixel(10, 4))).not.toEqual([7, 6, 13, 255]);
      // The raw back buffer is readable: 640x360 RGBA, opaque everywhere (the engine clears to an opaque color).
      const raw = await page.evaluate(() => window.__SJE__?.pixels());
      const bytes = bytesOf(raw?.base64 ?? '');
      expect([raw?.w, raw?.h, bytes.length]).toEqual([SIZE.w, SIZE.h, SIZE.w * SIZE.h * 4]);
      let transparent = 0;
      for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== 255) transparent++;
      expect(transparent).toBe(0);
    });
  });

  test('the real 60 Hz loop ticks and keeps a sane frame interval', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        await page.waitForTimeout(1200);
        const ticks = await page.evaluate(() => window.__SJE__?.tick() ?? 0);
        // 1.2 s of real time: far more than 20 ticks, unless the loop is stuck. (Software GL draws slowly, so the bound is loose.)
        expect(ticks, 'ticks run by the real loop').toBeGreaterThan(20);
        const hash1 = await page.evaluate(() => window.__SJE__?.hash());
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.__SJE__?.hash()), 'the picture moves while the loop runs').not.toBe(hash1);
      },
      { query: '' },
    );
  });
});

test.describe('lab: no WebGL2', () => {
  test('a browser with no WebGL2 gets a plain message, a clean stack and a tidy page (not a hang or a blank canvas)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await context.newPage();
    // Pretend this browser has no WebGL2: the context request answers null (what a blocked GPU does).
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the browser's overloaded method.
      (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        // biome-ignore lint/suspicious/noExplicitAny: same.
        return type === 'webgl2' ? null : (original as any).call(this, type, ...rest);
      };
    });
    await page.goto('/sjelab.html?manual');
    await page.waitForFunction(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ !== undefined, null, { timeout: 30_000 });
    const out = await page.evaluate(() => ({
      error: (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__,
      status: document.getElementById('status')?.textContent,
      canvases: document.querySelectorAll('#stage canvas').length,
      hook: window.__SJE__ !== undefined,
    }));
    await context.close();
    expect(out.error).toContain('WebGL 2');
    expect(out.status).toContain('failed to start');
    expect(out.canvases, 'the unused canvas was removed').toBe(0);
    expect(out.hook).toBe(false);
  });
});

test.describe('lab: crisp pixels at every zoom and device pixel ratio (640x360)', () => {
  for (const { dpr, viewport } of RATIOS) {
    const k = zoomFor(viewport, dpr);
    test(`every ${k}x${k} block is one flat color at device pixel ratio ${dpr}, window ${viewport.width}x${viewport.height} (the GL canvas, and a screenshot of the page)`, async ({ browser }) => {
      await withLab(
        browser,
        async ({ page }) => {
          const info = await page.evaluate(() => window.__SJE__?.info());
          expect([info?.w, info?.h, info?.k]).toEqual([SIZE.w, SIZE.h, k]);
          for (const tick of [30, 477]) {
            const blocks = await page.evaluate((t) => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              h.step(t - h.tick());
              return h.canvasBlocks();
            }, tick);
            expect([blocks.canvasW, blocks.canvasH, blocks.blocks]).toEqual([SIZE.w * k, SIZE.h * k, SIZE.w * SIZE.h]);
            expect(blocks.bad, `non-uniform ${k}x${k} blocks at tick ${tick}, dpr ${dpr}: ${JSON.stringify(blocks.samples)}`).toBe(0);
          }
          // What the compositor shows: the canvas is the whole window in device pixels, so the browser never resamples it.
          const pic = await page.evaluate(() => window.__SJE__?.picture());
          const where = await page.evaluate(() => {
            const r = document.querySelector('canvas')?.getBoundingClientRect();
            const c = document.querySelector('canvas');
            return { left: r?.left ?? -1, top: r?.top ?? -1, width: r?.width ?? 0, height: r?.height ?? 0, backingW: c?.width ?? 0, backingH: c?.height ?? 0, innerW: window.innerWidth, innerH: window.innerHeight };
          });
          expect([where.left, where.top, where.width, where.height]).toEqual([0, 0, where.innerW, where.innerH]);
          expect([where.backingW, where.backingH]).toEqual([Math.round(where.innerW * dpr), Math.round(where.innerH * dpr)]);
          const shot = await page.screenshot();
          const url = `data:image/png;base64,${shot.toString('base64')}`;
          const region = { x: pic?.x ?? 0, y: pic?.y ?? 0, w: SIZE.w * k, h: SIZE.h * k };
          const shotBlocks = await page.evaluate(([u, kk, r]) => window.__SJE__?.imageBlocks(u as string, kk as number, r as typeof region), [url, k, region]);
          expect(shotBlocks?.blocks).toBe(SIZE.w * SIZE.h);
          expect(shotBlocks?.bad, `non-uniform ${k}x${k} blocks in the screenshot at dpr ${dpr}: ${JSON.stringify(shotBlocks?.samples)}`).toBe(0);
        },
        { dpr, viewport },
      );
    });
  }

  test('with the 3D frame over the picture the blocks are still flat (the 3D picture is nearest sampled and on the same grid)', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const blocks = await page.evaluate(async () => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          const t = await h.three();
          t.start();
          h.step(40);
          const b = h.canvasBlocks();
          t.stop();
          return b;
        });
        expect(blocks.bad, `non-uniform blocks over the 3D picture: ${JSON.stringify(blocks.samples)}`).toBe(0);
      },
      { dpr: 1.5, viewport: { width: 1300, height: 730 } },
    );
  });
});

test.describe('lab: determinism', () => {
  test('the same tick count gives the same pixel hash on two page loads, however the ticks are split', async ({ browser }) => {
    const hashes: string[][] = [];
    for (const split of [[333], Array(333).fill(1), [111, 111, 111]] as number[][]) {
      await withLab(browser, async ({ page }) => {
        const run = await page.evaluate((parts) => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          const out: string[] = [];
          for (const n of parts) h.step(n);
          out.push(h.hash());
          return out;
        }, split);
        hashes.push(run);
      });
    }
    expect(hashes[1]).toEqual(hashes[0]);
    expect(hashes[2]).toEqual(hashes[0]);
    // The picture really changes with the tick (the hash is not constant).
    await withLab(browser, async ({ page }) => {
      const a = await page.evaluate(() => window.__SJE__?.step(10));
      const b = await page.evaluate(() => window.__SJE__?.step(40));
      expect(a).not.toBe(b);
    });
  });
});

// ------------------------------------------------------------------------------------------------
// Lifetime: the GL-object harness (tooling-and-testing.md section 8)
// ------------------------------------------------------------------------------------------------

test.describe('lab: leak cycles (the GL-object harness)', () => {
  test('leak: entering and leaving the 2D scene 10 times leaves every GL object count where it was; a deliberate leak grows them', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        h.reenter(2); // warm up: shaders and buffers Pixi makes the first time something is drawn
        const baseline = h.glCounts();
        h.reenter(10);
        const after = h.glCounts();
        h.leakOnPurpose(6); // the negative control: this MUST show up
        const leaked = h.glCounts();
        return { baseline, after, leaked };
      });
      console.log(`SJE GL counts: baseline ${JSON.stringify(out.baseline)} after 10 cycles ${JSON.stringify(out.after)} after a deliberate leak of 6 textures ${JSON.stringify(out.leaked)}`);
      // Texture, buffer, program, VAO, framebuffer, renderbuffer: all flat.
      for (const kind of ['texture', 'buffer', 'program', 'vao', 'framebuffer', 'renderbuffer'] as const) expect(out.after[kind], kind).toBe(out.baseline[kind]);
      expect(out.after).toEqual(out.baseline);
      // The control: a texture that nothing frees shows up in the count.
      expect(out.leaked.texture).toBeGreaterThanOrEqual(out.after.texture + 6);
    });
  });

  test('leak: entering and leaving the 3D frame 10 times leaves every GL object count where it was; a deliberate leak of render targets grows them', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(async () => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const t = await h.three();
        const cycles = t.cycles(10);
        t.leakOnPurpose(4);
        return { ...cycles, leaked: h.glCounts(), hosts: t.hosts() };
      });
      console.log(`SJE 3D GL counts: before ${JSON.stringify(out.before)} after 10 cycles ${JSON.stringify(out.after)} after a deliberate leak of 4 targets ${JSON.stringify(out.leaked)}`);
      for (const kind of ['texture', 'buffer', 'program', 'vao', 'framebuffer', 'renderbuffer'] as const) expect(out.after[kind], kind).toBe(out.before[kind]);
      expect(out.leaked.texture).toBeGreaterThanOrEqual(out.after.texture + 4);
      expect(out.leaked.framebuffer).toBeGreaterThanOrEqual(out.after.framebuffer + 4);
      // One Three renderer for the whole page, never one per entry (a new one per entry leaked 5 textures and 3 framebuffers each time in the lab).
      expect(out.hosts).toEqual({ shared: 1, private: 0 });
    });
  });
});

test.describe('lab: context loss', () => {
  test('a lost WebGL context comes back: the frame is drawn again, identical, with no errors', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const before = await page.evaluate(() => window.__SJE__?.step(250));
      await page.evaluate(() => window.__SJE__?.loseContext());
      expect(await page.evaluate(() => window.__SJE__?.contextLost())).toBe(true);
      // Drawing while lost must not throw.
      await page.evaluate(() => window.__SJE__?.render());
      await page.evaluate(() => window.__SJE__?.restoreContext());
      expect(await page.evaluate(() => window.__SJE__?.contextLost())).toBe(false);
      const after = await page.evaluate(() => {
        window.__SJE__?.render();
        return window.__SJE__?.hash();
      });
      expect(after).toBe(before);
      expect(await page.evaluate(() => window.__SJE__?.canvasBlocks().bad)).toBe(0);
      expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
    });
  });
});

// ------------------------------------------------------------------------------------------------
// The twelve canaries
// ------------------------------------------------------------------------------------------------

test.describe('canary 1: stale clear color (GlHandoff, frame-and-rendering.md 7.3)', () => {
  test('a filtered container with a transparent gap, over a Three picture with a non-black background: the gap shows the 3D picture', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const run = (fixOn: boolean, transparent: boolean) =>
        page.evaluate(async ([f, t]) => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          const three = await h.three();
          if (!three.facts()) {
            three.start({ bloom: false });
            h.step(30);
          }
          return three.staleClear(f as boolean, t as boolean);
        }, [fixOn, transparent] as const);
      const production = await run(true, false); // the engine as shipped: void color back buffer, hand-off on
      const productionNoFix = await run(false, false); // same, hand-off off: shielded by the non-zero clear color
      const withFix = await run(true, true); // transparent back buffer, hand-off ON: must be right
      const withoutFix = await run(false, true); // transparent back buffer, hand-off OFF: THE CONTROL, must show the bug
      console.log(`SJE canary 1: shipped ${production.gapWrong} wrong; shipped with fix off ${productionNoFix.gapWrong} (shielded); transparent, fix on ${withFix.gapWrong}; fix off ${withoutFix.gapWrong} wrong of ${withoutFix.gapTotal}, first ${JSON.stringify(withoutFix.firstWrong)}`);
      expect(production.gapWrong).toBe(0);
      expect(production.rectsWrong).toBe(0);
      expect(withFix.gapWrong).toBe(0);
      expect(withFix.rectsWrong).toBe(0);
      // The canary can fail: with the fix switched off, gap pixels show Three's leftover clear color instead of the 3D picture.
      expect(withoutFix.gapWrong).toBeGreaterThan(0);
      expect(withoutFix.gapTotal).toBe(2800);
      // And the switch went back on: the next check is clean again.
      expect((await run(true, true)).gapWrong).toBe(0);
      expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
    });
  });
});

test.describe('canary 2: canvas on init (a context restore must recover)', () => {
  test('Pixi started with `canvas` draws the same pixel after a lost and restored context', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(() => window.__SJE__?.canaryCanvasInit(true));
      expect(r?.threw).toBeNull();
      expect(r?.before).toEqual([255, 32, 128, 255]);
      expect(r?.after).toEqual(r?.before);
      expect(r?.recovered).toBe(true);
    });
  });

  test('CONTROL: Pixi started without `canvas` does not recover', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const r = await page.evaluate(() => window.__SJE__?.canaryCanvasInit(false));
        expect(r?.before).toEqual([255, 32, 128, 255]);
        expect(r?.recovered, 'the trap: after the restore the renderer draws nothing').toBe(false);
      },
      { allow: CONTROL_NOISE },
    );
  });
});

test.describe('canary 3: renderer.destroy() kills the context', () => {
  /** The lines of `files` that call something that destroys a renderer or its context. */
  const FORBIDDEN = /\brenderer\.destroy\(|\.forceContextLoss\(/;
  /** The only files that may: the dev teardown (`GlRenderer.destroy`), and the lab's throwaway probes that test the trap. */
  const ALLOWED = new Set(['src/sje/runtime/glrenderer.ts', 'src/sje-lab/pixilab.ts']);
  const scan = (files: Array<{ file: string; text: string }>): string[] => {
    const bad: string[] = [];
    for (const { file, text } of files) {
      if (ALLOWED.has(file)) continue;
      text.split('\n').forEach((line, i) => {
        if (FORBIDDEN.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) bad.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    return bad;
  };

  test('nothing in src calls renderer.destroy() outside the dev teardown', () => {
    const files = [...sources('src/sje'), ...sources('src/sje-lab')].map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
    expect(files.length).toBeGreaterThan(20);
    expect(scan(files)).toEqual([]);
    // The dev teardown exists where it should: the scan is looking at the right place.
    expect(readFileSync(join(ROOT, 'src/sje/runtime/glrenderer.ts'), 'utf8')).toMatch(FORBIDDEN);
  });

  test('CONTROL: the scan flags a call that destroys the shared renderer', () => {
    expect(scan([{ file: 'src/sje/display/oops.ts', text: 'export const f = (r) => {\n  r.pixi.renderer.destroy();\n};' }])).toHaveLength(1);
    expect(scan([{ file: 'src/sje/three/oops.ts', text: 'three.renderer.forceContextLoss();' }])).toHaveLength(1);
  });

  test('the trap is real in this Pixi: destroying a throwaway renderer loses its context, and the engine context is untouched', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(() => window.__SJE__?.canaryDestroy());
      expect(r?.contextLostAfterDestroy, 'Pixi 8.22 destroy() loses the context. If this turns false, the rule above can be relaxed').toBe(true);
      expect(await page.evaluate(() => window.__SJE__?.contextLost())).toBe(false);
    });
  });
});

test.describe('canary 4: ExternalSource scale (a Three target must be nearest filtered)', () => {
  test('a nearest 8x8 Three target shown at 4x is hard blocks of two colors, and the real 3D frame is 640x360 and nearest', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(async () => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const t = await h.three();
        const scale = t.externalScale(false);
        const facts = t.start({ bloom: false });
        t.stop();
        return { scale, facts };
      });
      expect(out.scale.colours).toBe(2);
      expect([out.facts.width, out.facts.height, out.facts.minFilter, out.facts.magFilter]).toEqual([SIZE.w, SIZE.h, 'nearest', 'nearest']);
    });
  });

  test('CONTROL: a linear target blends the edge into more colors', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(async () => (await window.__SJE__?.three())?.externalScale(true));
      expect(r?.magFilter).toBe('linear');
      expect(r?.colours, 'blended edge pixels').toBeGreaterThan(2);
    });
  });
});

test.describe('canary 5: stencil mask (a Graphics mask must not draw outside)', () => {
  test('the engine context has a stencil buffer, a mask on a canvas holds, and the back buffer shows exactly the mask rectangle', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(() => window.__SJE__?.canaryStencil(true));
      expect(r?.engineHasStencil).toBe(true);
      expect(r?.canvas).toEqual({ inside: 20 * 20, outside: 0 });
      // The lab's panel is 96x64 and its mask lets a 40x32 rectangle through.
      expect(r?.backBuffer).toEqual({ inside: 40 * 32, outside: 0 });
    });
  });

  test('CONTROL: a context made with no stencil buffer lets the whole panel through', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const r = await page.evaluate(() => window.__SJE__?.canaryStencil(false));
        expect(r?.canvas.inside).toBe(20 * 20);
        expect(r?.canvas.outside, 'pink drawn outside the mask: the trap').toBeGreaterThan(0);
      },
      { allow: CONTROL_NOISE },
    );
  });
});

test.describe('canary 6: Three canvas and context (a context restore must recover)', () => {
  test('Three made with `canvas` and `context` draws the same color after a lost and restored context, and nothing throws while it is lost', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(async () => (await window.__SJE__?.three())?.threeContext(true));
      expect(r?.threwWhileLost).toBe(false);
      expect(r?.before).toEqual([32, 128, 255]);
      expect(r?.after).toEqual(r?.before);
      expect(r?.recovered).toBe(true);
    });
  });

  test('CONTROL: Three made with only `context` does not recover', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const r = await page.evaluate(async () => (await window.__SJE__?.three())?.threeContext(false));
        expect(r?.before).toEqual([32, 128, 255]);
        expect(r?.recovered, 'the trap: after the restore Three draws black').toBe(false);
      },
      { allow: CONTROL_NOISE },
    );
  });
});

test.describe('canary 7: no second Pixi loop', () => {
  test('Pixi starts no requestAnimationFrame loop of its own: once the lab is up, nothing runs frames', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        // ?manual: our FixedLoop is not started, so once the lab is up nobody should be running frames.
        const runs = () => page.evaluate(() => (window as unknown as { __rafRuns: number }).__rafRuns);
        const before = await runs();
        await page.waitForTimeout(700);
        expect(await runs(), 'requestAnimationFrame callbacks that ran after boot (Ticker.system must be stopped)').toBe(before);
        expect(await page.evaluate(() => window.__SJE__?.pixiTickerRunning())).toBe(false);
        // Three and the probes do not start it either: use them, then look again.
        await page.evaluate(async () => {
          const t = await window.__SJE__?.three();
          t?.start();
          window.__SJE__?.step(3);
          t?.stop();
          await window.__SJE__?.canaryExtensionRequests(true);
        });
        const mid = await runs();
        await page.waitForTimeout(500);
        expect(await runs(), 'still no callbacks after the 3D frame and a throwaway Pixi renderer').toBe(mid);
      },
      { countFrames: true },
    );
  });

  test('CONTROL: starting Pixi’s ticker makes callbacks run', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const runs = () => page.evaluate(() => (window as unknown as { __rafRuns: number }).__rafRuns);
        const before = await runs();
        await page.evaluate(() => window.__SJE__?.pixiTicker(true));
        await page.waitForTimeout(500);
        expect(await runs(), 'the counter sees a second loop').toBeGreaterThan(before + 3);
        await page.evaluate(() => window.__SJE__?.pixiTicker(false));
      },
      { countFrames: true },
    );
  });
});

test.describe('canary 8: extension list (skipExtensionImports)', () => {
  test('with the load-everything step skipped, a sprite, a Graphics, a mask and a filter still render, and no environment chunk is downloaded, and no three.js', async ({ browser }) => {
    await withLab(browser, async ({ page, requests }) => {
      const r = await page.evaluate(() => window.__SJE__?.canaryExtensions());
      expect(r?.sprite, 'a sprite: the tile border').toEqual([0x3f, 0xe0, 0xf0, 255]);
      expect(r?.graphics, 'a Graphics rectangle').toEqual([0x12, 0xab, 0x34, 255]);
      expect(r?.maskInside, 'inside the mask').toEqual([0xff, 0x5c, 0x33, 255]);
      expect(r?.maskOutside, 'outside the mask: the band behind it').toEqual([0x2c, 0x2a, 0x5c, 255]);
      expect(r?.filter, 'a color matrix filter (red in, blue out)').toEqual([0, 0, 255, 255]);
      const skipped = await page.evaluate(() => window.__SJE__?.canaryExtensionRequests(true));
      expect(skipped, 'environment chunks fetched for a renderer that skips them').toEqual([]);
      expect(requests.some((u) => /pixi/i.test(u)), 'Pixi was loaded at all (the check is looking at the right requests)').toBe(true);
      expect(requests.filter((u) => /browserAll|webworkerAll|accessibility|lib\/events/.test(u))).toEqual([]);
      expect(requests.filter((u) => /\/three[/.@-]|three\.module|deps\/three/.test(u)), 'no Three before the first 3D frame').toEqual([]);
    });
  });

  test('CONTROL: Pixi’s default init downloads its environment chunks', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const loaded = await page.evaluate(() => window.__SJE__?.canaryExtensionRequests(false));
      expect(loaded?.length, 'the request check can see the chunks').toBeGreaterThan(0);
      expect(loaded?.some((u) => /browserAll/.test(u))).toBe(true);
    });
  });
});

test.describe('canary 9: texture GC (an idle texture must stay on the GPU)', () => {
  test('the engine’s collector is off, and an idle texture is still on the GPU after a long idle', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      expect(await page.evaluate(() => window.__SJE__?.pixiGcEnabled())).toBe(false);
      const r = await page.evaluate(() => window.__SJE__?.canaryGc(false));
      expect(r).toEqual({ enabled: false, textureKept: true });
    });
  });

  test('CONTROL: with Pixi’s collector on, the idle texture is unloaded', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(() => window.__SJE__?.canaryGc(true));
      expect(r?.enabled).toBe(true);
      expect(r?.textureKept, 'the trap: Pixi frees a texture the engine still owns').toBe(false);
    });
  });
});

test.describe('canary 10: texture handle (Three’s internal field)', () => {
  test('`renderer.properties.get(rt.texture).__webglTexture` is a WebGLTexture, and the frame is the shared-context one', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(async () => {
        const t = await window.__SJE__?.three();
        if (!t) throw new Error('no 3D lab');
        const handle = t.handleDefined();
        const facts = t.start({ frame: 'auto', bloom: false });
        t.stop();
        return { handle, mode: facts.mode };
      });
      expect(out.handle, 'a Three upgrade that moves this field breaks the shared-context path').toBe(true);
      expect(out.mode).toBe('shared-context');
    });
  });

  test('CONTROL: with the handle hidden, `auto` falls back to the canvas copy with exactly ONE console warning, and `shared-context` refuses', async ({ browser }) => {
    const lab = await openLab(browser, { allow: [/texture handle is missing/] });
    try {
      const { page } = lab;
      const warnings: string[] = [];
      page.on('console', (m) => {
        if (/texture handle is missing/.test(m.text())) warnings.push(`${m.type()}: ${m.text()}`);
      });
      const out = await page.evaluate(async () => {
        const t = await window.__SJE__?.three();
        if (!t) throw new Error('no 3D lab');
        t.hideTextureHandle(true);
        const first = t.start({ frame: 'auto', bloom: false }).mode;
        window.__SJE__?.step(5);
        t.stop();
        const second = t.start({ frame: 'auto', bloom: false }).mode;
        t.stop();
        let refused = '';
        try {
          t.start({ frame: 'shared-context', bloom: false });
        } catch (e) {
          refused = e instanceof Error ? e.message : String(e);
        }
        t.hideTextureHandle(false);
        return { first, second, refused, errors: window.__SJE__?.glErrors() };
      });
      expect(out.first).toBe('canvas-copy');
      expect(out.second).toBe('canvas-copy');
      expect(out.refused).toContain('texture handle');
      expect(out.errors).toEqual([]);
      expect(warnings, 'one warning for the page, not one per entry').toHaveLength(1);
      expect(warnings[0]).toMatch(/^warning:/);
      expect(lab.problems, 'no other console problem').toEqual([]);
    } finally {
      await lab.close();
    }
  });
});

test.describe('canary 11: color exactness (frame-and-rendering.md 7.5)', () => {
  test('a color written in Three reaches the 3D picture and the screen unchanged: #ff2080 stays #ff2080', async ({ browser }) => {
    for (const frame of ['shared-context', 'canvas-copy'] as const) {
      await withLab(browser, async ({ page }) => {
        for (const [background, plane] of [
          [0xff2080, 0x2080ff],
          [0x123456, 0xfedcba],
          [0x070a22, 0xffcc3d],
        ] as const) {
          const r = await page.evaluate(async ([b, p, f]) => (await window.__SJE__?.three())?.colourProbe(b as number, p as number, false, f as 'shared-context'), [background, plane, frame] as const);
          const rgb = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
          expect(r?.target.left, `${frame}: the scene background in the 3D picture`).toEqual(rgb(background));
          expect(r?.target.right, `${frame}: an unlit material in the 3D picture`).toEqual(rgb(plane));
          expect(r?.screen.left, `${frame}: on the screen`).toEqual(rgb(background));
          expect(r?.screen.right).toEqual(rgb(plane));
        }
        expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
      });
    }
  });

  test('CONTROL: with Three’s color management left on, #ff2080 comes out as #ff0437', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(async () => (await window.__SJE__?.three())?.colourProbe(0xff2080, 0x2080ff, true, 'shared-context'));
      expect(r?.target.left).toEqual([0xff, 0x04, 0x37]);
      expect(r?.screen.left).not.toEqual([0xff, 0x20, 0x80]);
    });
  });
});

test.describe('canary 12: frame rewrap (a restore must re-point the 3D sprite)', () => {
  test('after a lost and restored context the picture is the one drawn before, and the frame re-pointed once', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const r = await page.evaluate(async () => (await window.__SJE__?.three())?.rewrap(false));
      expect(r?.rewraps).toBe(1);
      expect(r?.after).toBe(r?.before);
      expect(await page.evaluate(() => window.__SJE__?.glErrors())).toEqual([]);
    });
  });

  test('CONTROL: without the rewrap the picture after the restore is stale', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const r = await page.evaluate(async () => (await window.__SJE__?.three())?.rewrap(true));
        expect(r?.rewraps).toBe(0);
        expect(r?.same, 'the trap: the sprite still samples the old texture').toBe(false);
      },
      { allow: CONTROL_NOISE },
    );
  });
});

test.describe('lab: the lab is software or hardware, and the suite says which', () => {
  test('reports the renderer (SwiftShader on CI)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const soft = await isSoftware(page);
      console.log(`SJE canaries ran on ${soft ? 'software GL (SwiftShader)' : 'a GPU'}`);
      expect(typeof soft).toBe('boolean');
    });
  });
});
