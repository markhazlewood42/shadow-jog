/**
 * Scene3D on the scene runtime and the shared GL context (docs/engine/m1b-brief.md section 4, pass lines 3 to 9).
 *
 * The cube scene (src/sje-lab/cubescene.ts) is a real `Scene3D` that runs on a `Game` over the lab's renderer, next to Pixi objects.
 * Each check has the control that proves it can fail:
 *
 *   cube visible and moving      the corner of the picture is the background; the center is not; two tick counts differ
 *   determinism                  the same tick count gives the same back buffer hash on three page loads, however the ticks are split
 *   leak                         10 enter and exit cycles are flat; a deliberate leak grows the counts (control)
 *   context loss                 a lost context ends the scene with aborted / context-lost within 2 seconds, with no console error; the
 *                                restore after the end throws nothing; a new scene runs again
 *   no WebGL2                    a plain message, no uncaught error, a tidy page, in 2 seconds, and the 3D chunk is never requested
 *   filter and iris mask         inside the mask the picture is inverted by the filter; outside it is not the 3D picture (control: the
 *                                filter with no mask shows the inverted picture outside too)
 *   crisp pixels                 no mixed k-by-k block at device pixel ratio 1 and 1.5 with the 3D frame, with and without filter and mask
 *
 * Run it:  npx playwright test e2e/sje-scene3d.spec.ts --reporter=line
 *          CI=1 npx playwright test e2e/sje-scene3d.spec.ts   (the bundled Chromium on SwiftShader, like CI)
 */
import { expect, test } from '@playwright/test';
import { openLab, SIZE, withLab } from './sjelabkit';

const { w: W, h: H } = SIZE;
/** The iris radius of the cube scene (src/sje-lab/cubescene.ts) is H/2 - 40; points are chosen well inside and well outside. */
const INSIDE: ReadonlyArray<readonly [number, number]> = [
  [Math.floor(W / 2) - 100, Math.floor(H / 2) - 60],
  [Math.floor(W / 2) + 110, Math.floor(H / 2) + 40],
  [Math.floor(W / 2), Math.floor(H / 2) - 120],
  [Math.floor(W / 2) - 20, Math.floor(H / 2) + 110],
];
const OUTSIDE: ReadonlyArray<readonly [number, number]> = [
  [30, H - 30],
  [W - 30, 30],
  [W - 30, H - 30],
  [30, 60],
];

test.describe('Scene3D: the cube', () => {
  test('the cube is drawn: the corner is the background, the center is not, it reaches the screen unchanged, and it turns between two tick counts', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(
        async ([w, h]) => {
          const hk = window.__SJE__;
          if (!hk) throw new Error('no hook');
          const t = await hk.three();
          t.start({ bloom: false });
          hk.step(10);
          const cx = Math.floor((w ?? 0) / 2);
          const cy = Math.floor((h ?? 0) / 2);
          const corner = t.targetPixel(4, 4);
          // How many pixels of a 80 x 80 patch at the cube's place differ from the background.
          const patchDiff = (): number => {
            const f = t.framePixels();
            if (!f) throw new Error('no frame');
            const bin = atob(f.base64);
            let n = 0;
            for (let y = cy - 40; y < cy + 40; y++) {
              for (let x = cx - 40; x < cx + 40; x++) {
                const i = (y * f.w + x) * 4;
                if (bin.charCodeAt(i) !== (corner[0] ?? 0) || bin.charCodeAt(i + 1) !== (corner[1] ?? 0) || bin.charCodeAt(i + 2) !== (corner[2] ?? 0)) n++;
              }
            }
            return n;
          };
          const covered = patchDiff();
          const center10 = t.targetPixel(cx, cy);
          const screen10 = hk.pixel(cx, cy).slice(0, 3);
          const screenCorner = hk.pixel(4, 4).slice(0, 3);
          const hash10 = hk.hash();
          const hash40 = hk.step(30);
          const center40 = t.targetPixel(cx, cy);
          return { corner, covered, center10, screen10, screenCorner, hash10, hash40, center40, glErrors: hk.glErrors(), tick: hk.tick() };
        },
        [W, H] as const,
      );
      // The corner is the scene's background (0x180830), not black.
      expect(out.corner).toEqual([0x18, 0x08, 0x30]);
      expect(out.screenCorner, 'the background reaches the screen').toEqual(out.corner);
      // The whole 80 x 80 patch at the center is cube.
      expect(out.covered).toBe(80 * 80);
      expect(out.screen10, 'the cube reaches the screen unchanged').toEqual(out.center10);
      // It turns: the picture is different 30 ticks later.
      expect(out.hash40).not.toBe(out.hash10);
      expect(out.glErrors).toEqual([]);
    });
  });

  test('determinism: the same tick count gives the same back buffer hash on three page loads, however the ticks are split', async ({ browser }) => {
    const hashes: string[] = [];
    for (const split of [[150], Array(150).fill(1), [50, 50, 50]] as number[][]) {
      await withLab(browser, async ({ page }) => {
        hashes.push(
          await page.evaluate(async (parts) => {
            const hk = window.__SJE__;
            if (!hk) throw new Error('no hook');
            const t = await hk.three();
            t.start();
            for (const n of parts) hk.step(n);
            return hk.hash();
          }, split),
        );
      });
    }
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[0]);
    // Control: another tick count is another picture (the hash is not constant).
    await withLab(browser, async ({ page }) => {
      const other = await page.evaluate(async () => {
        const hk = window.__SJE__;
        if (!hk) throw new Error('no hook');
        const t = await hk.three();
        t.start();
        return hk.step(151);
      });
      expect(other).not.toBe(hashes[0]);
    });
  });

  test('leak: 10 enter and exit cycles of the Scene3D leave every GL object count where it was; a deliberate leak grows them', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(async () => {
        const hk = window.__SJE__;
        if (!hk) throw new Error('no hook');
        const t = await hk.three();
        const cycles = t.cycles(10);
        // The promise of `game.run` settles in a microtask.
        await Promise.resolve();
        const settled = { running: t.sceneRunning(), result: t.sceneResult() };
        t.leakOnPurpose(4);
        return { ...cycles, leaked: hk.glCounts(), hosts: t.hosts(), settled };
      });
      for (const kind of ['texture', 'buffer', 'program', 'vao', 'framebuffer', 'renderbuffer'] as const) expect(out.after[kind], kind).toBe(out.before[kind]);
      expect(out.after).toEqual(out.before);
      // The scene ended by `stop`, and said so.
      expect(out.settled).toEqual({ running: false, result: { status: 'aborted', reason: 'user' } });
      // Control: render targets that nothing frees show up in the count.
      expect(out.leaked.texture).toBeGreaterThanOrEqual(out.after.texture + 4);
      expect(out.leaked.framebuffer).toBeGreaterThanOrEqual(out.after.framebuffer + 4);
      expect(out.hosts).toEqual({ shared: 1, private: 0 });
    });
  });

  test('CONTROL: a scene that never disposes at shutdown grows the counts every cycle (so the leak check above can fail)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(async () => {
        const hk = window.__SJE__;
        if (!hk) throw new Error('no hook');
        const t = await hk.three();
        return t.cycles(3, { skipDispose: true });
      });
      expect(out.after.framebuffer).toBeGreaterThanOrEqual(out.before.framebuffer + 3);
      expect(out.after.texture).toBeGreaterThanOrEqual(out.before.texture + 3);
    });
  });
});

test.describe('Scene3D: context loss', () => {
  test('a lost context ends the scene with aborted / context-lost, quickly and with no console error; the restore throws nothing; a new scene runs', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(async ([w, h]) => {
        const hk = window.__SJE__;
        if (!hk) throw new Error('no hook');
        const t = await hk.three();
        t.start({ bloom: false });
        hk.step(20);
        const wasRunning = t.sceneRunning();
        const t0 = performance.now();
        await hk.loseContext();
        // The scene hears the loss in its next draw (a drawn frame while the context is lost).
        hk.render();
        await Promise.resolve();
        const ms = performance.now() - t0;
        const ended = { running: t.sceneRunning(), result: t.sceneResult(), facts: t.facts() };
        await hk.restoreContext();
        // After the restore nothing draws and nothing throws.
        let threw: string | null = null;
        try {
          hk.step(5);
        } catch (e) {
          threw = String(e);
        }
        const afterRestore = { running: t.sceneRunning(), result: t.sceneResult(), glErrors: hk.glErrors() };
        // A new scene runs on the restored context.
        t.stop();
        t.start({ bloom: false });
        hk.step(10);
        const again = { running: t.sceneRunning(), center: t.targetPixel(Math.floor((w ?? 0) / 2), Math.floor((h ?? 0) / 2)), corner: t.targetPixel(4, 4), glErrors: hk.glErrors() };
        t.stop();
        return { wasRunning, ms, ended, threw, afterRestore, again };
      }, [W, H] as const);
      expect(out.wasRunning).toBe(true);
      expect(out.ms, 'ms from the loss to the end of the scene').toBeLessThan(2000);
      expect(out.ended).toEqual({ running: false, result: { status: 'aborted', reason: 'context-lost' }, facts: null });
      expect(out.threw).toBeNull();
      expect(out.afterRestore.running).toBe(false);
      expect(out.afterRestore.result).toEqual({ status: 'aborted', reason: 'context-lost' });
      expect(out.afterRestore.glErrors).toEqual([]);
      expect(out.again.running).toBe(true);
      expect(out.again.center, 'the new cube is drawn').not.toEqual(out.again.corner);
      expect(out.again.glErrors).toEqual([]);
    });
  });

  test('on the real 60 Hz loop the scene ends by itself within 2 seconds of the loss', async ({ browser }) => {
    await withLab(
      browser,
      async ({ page }) => {
        const out = await page.evaluate(async () => {
          const hk = window.__SJE__;
          if (!hk) throw new Error('no hook');
          const t = await hk.three();
          t.start({ bloom: false });
          await new Promise((r) => setTimeout(r, 300));
          const t0 = performance.now();
          await hk.loseContext();
          while (t.sceneResult() === null && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
          const ms = performance.now() - t0;
          const result = t.sceneResult();
          await hk.restoreContext();
          await new Promise((r) => setTimeout(r, 300));
          return { ms, result, running: t.sceneRunning(), glErrors: hk.glErrors() };
        });
        expect(out.result).toEqual({ status: 'aborted', reason: 'context-lost' });
        expect(out.ms).toBeLessThan(2000);
        expect(out.running).toBe(false);
        expect(out.glErrors).toEqual([]);
      },
      { query: 'real' },
    );
  });
});

test.describe('Scene3D: no WebGL2', () => {
  test('a browser with no WebGL2 gets a plain message in 2 seconds, no uncaught error, a tidy page, and the 3D chunk is never requested', async ({ browser }) => {
    // Warm the dev server's transforms first, so the 2 seconds measure the page and not a cold Vite.
    const warm = await openLab(browser);
    await warm.close();
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await context.newPage();
    const uncaught: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (e) => uncaught.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the browser's overloaded method.
      (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        // biome-ignore lint/suspicious/noExplicitAny: same.
        return type === 'webgl2' ? null : (original as any).call(this, type, ...rest);
      };
    });
    await page.goto('/sjelab.html?manual');
    const t0 = Date.now();
    await page.waitForFunction(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ !== undefined, null, { timeout: 30_000 });
    const ms = Date.now() - t0;
    const out = await page.evaluate(() => ({
      error: (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__,
      status: document.getElementById('status')?.textContent,
      canvases: document.querySelectorAll('#stage canvas').length,
      hook: window.__SJE__ !== undefined,
    }));
    await context.close();
    expect(ms).toBeLessThan(2000);
    expect(out.error).toContain('WebGL 2');
    // Plain: one sentence for a person, not a stack.
    expect(out.error).not.toMatch(/\n\s+at /);
    expect(out.status).toContain('failed to start');
    expect(out.canvases, 'the unused canvas was removed').toBe(0);
    expect(out.hook).toBe(false);
    expect(uncaught).toEqual([]);
    expect(requests.filter((u) => /sje\/three\/|sje-lab\/(threelab|cubescene)|\/three[/.@-]|three\.module|deps\/three/.test(u)), 'the 3D chunk was not entered').toEqual([]);
  });
});

test.describe('Scene3D: a Pixi filter and an iris mask on the View3D', () => {
  const run = (browser: import('@playwright/test').Browser, parts: { filter?: boolean; mask?: boolean }) =>
    withLabResult(browser, parts);

  /** Draw the cube with the filter and mask parts given, and read inside and outside points: the screen pixel next to the raw 3D pixel. */
  async function withLabResult(browser: import('@playwright/test').Browser, parts: { filter?: boolean; mask?: boolean }) {
    let result: { inside: number[][][]; outside: number[][][]; off: number[][][]; glErrors: number[] } | undefined;
    await withLab(browser, async ({ page }) => {
      result = await page.evaluate(
        async ([inside, outside, partsArg]) => {
          const hk = window.__SJE__;
          if (!hk) throw new Error('no hook');
          const t = await hk.three();
          t.start({ bloom: false });
          hk.step(25);
          const read = (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([x, y]) => [hk.pixel(x, y).slice(0, 3), t.targetPixel(x, y)]);
          t.setFilterAndMask(true, partsArg);
          hk.render();
          const on = { inside: read(inside), outside: read(outside) };
          // Back off: the same points are the raw picture again.
          t.setFilterAndMask(false);
          hk.render();
          const off = read(inside);
          const glErrors = hk.glErrors();
          t.stop();
          return { ...on, off, glErrors };
        },
        [INSIDE, OUTSIDE, parts] as const,
      );
    });
    if (!result) throw new Error('no result');
    return result;
  }

  const invert = (v: number[]): number[] => v.map((c) => 255 - c);
  const near = (a: number[], b: number[], tol = 2): boolean => a.every((c, i) => Math.abs(c - (b[i] ?? 0)) <= tol);

  test('with the filter and the iris on, the 3D picture shows inverted inside the mask and not at all outside it; off, it is raw again', async ({ browser }) => {
    const r = await run(browser, {});
    for (const [screen, raw] of r.inside as [number[], number[]][]) expect(near(screen, invert(raw)), `inside: screen ${screen} should be the inverse of ${raw}`).toBe(true);
    const outside = (r.outside as [number[], number[]][]).map(([screen]) => screen);
    for (const [screen, raw] of r.outside as [number[], number[]][]) {
      expect(near(screen, raw, 6), `outside: screen ${screen} must not be the raw 3D picture ${raw}`).toBe(false);
      expect(near(screen, invert(raw), 6), `outside: screen ${screen} must not be the filtered 3D picture ${invert(raw)}`).toBe(false);
    }
    // Outside is one flat color: the void behind the picture.
    for (const s of outside) expect(s).toEqual(outside[0]);
    for (const [screen, raw] of r.off as [number[], number[]][]) expect(near(screen, raw), `off: screen ${screen} should be raw ${raw}`).toBe(true);
    expect(r.glErrors).toEqual([]);
  });

  test('CONTROL: the filter with no mask shows the inverted picture outside the iris too (so the check above can tell a mask from none)', async ({ browser }) => {
    const r = await run(browser, { mask: false });
    for (const [screen, raw] of r.outside as [number[], number[]][]) expect(near(screen, invert(raw)), `outside, no mask: screen ${screen} should be the inverse of ${raw}`).toBe(true);
  });

  test('CONTROL: the mask with no filter shows the raw picture inside and the void outside', async ({ browser }) => {
    const r = await run(browser, { filter: false });
    for (const [screen, raw] of r.inside as [number[], number[]][]) expect(near(screen, raw), `inside, no filter: screen ${screen} should be raw ${raw}`).toBe(true);
    for (const [screen, raw] of r.outside as [number[], number[]][]) expect(near(screen, raw, 6), `outside: screen ${screen} must not be raw ${raw}`).toBe(false);
  });
});

test.describe('Scene3D: crisp pixels with the 3D frame over the picture', () => {
  for (const { dpr, viewport } of [
    { dpr: 1, viewport: { width: 1920, height: 1080 } },
    { dpr: 1.5, viewport: { width: 1300, height: 730 } },
  ]) {
    for (const masked of [false, true]) {
      test(`every block is one flat color at device pixel ratio ${dpr}${masked ? ', with the filter and the iris mask on' : ''}`, async ({ browser }) => {
        await withLab(
          browser,
          async ({ page }) => {
            const blocks = await page.evaluate(async (on) => {
              const hk = window.__SJE__;
              if (!hk) throw new Error('no hook');
              const t = await hk.three();
              t.start();
              hk.step(40);
              if (on) t.setFilterAndMask(true);
              const b = hk.canvasBlocks();
              const errors = hk.glErrors();
              t.stop();
              return { b, errors };
            }, masked);
            expect(blocks.b.bad, `non-uniform blocks over the 3D picture: ${JSON.stringify(blocks.b.samples)}`).toBe(0);
            expect(blocks.errors).toEqual([]);
          },
          { dpr, viewport },
        );
      });
    }
  }
});
