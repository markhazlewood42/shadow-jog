/**
 * The engine lab (/sjelab.html): the Shadow Jog Engine (src/sje) running a sandbox scene made of the
 * game's own art, checked in a real browser. Step B0 of the engine-platform spike
 * (docs/spikes/engine-platform.md, docs/engine/verification.md).
 *
 * What it checks, and the design rule behind each:
 *  - boot: zero console errors AND warnings (Pixi logs real defects as warnings);
 *  - crispness: at zoom 4, every 4x4 block of the canvas is one flat colour, at device pixel ratios
 *    1, 1.25 and 1.5 (frame-and-rendering.md 6.6), read from the GL canvas AND from a screenshot;
 *  - determinism: the same tick count gives the same pixel hash, on two page loads and however the
 *    ticks are split (section 8);
 *  - parity: the engine's frame against a Canvas 2D drawing of the same content;
 *  - snap to pixel, flip, depth order, a stable camera pan (scene-graph.md 4, 5, 7);
 *  - no second Pixi loop, no GL object leaks over enter-and-leave cycles, context loss and restore.
 *
 * Run it:  npx playwright test e2e/sjelab.spec.ts --reporter=line
 *          PW_NOGPU=1 npx playwright test e2e/sjelab.spec.ts   (software GL, like CI)
 * Set SJE_SHOTS=<folder> to also save the pictures (engine, reference, diff, canvas) for a human to look at.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * One viewport per device pixel ratio, each chosen so the window is a whole number of device pixels
 * (viewport x ratio has no fraction) and the integer zoom is `k`. Ratios 1.75, 2 and 2.25 were added
 * in step B2: at 2.25 and zoom 7, B0's picture-sized canvas drew 2651 uneven blocks (spike finding 10).
 */
const ZOOM4 = [
  { dpr: 1, viewport: { width: 1920, height: 1080 }, k: 4 },
  { dpr: 1.25, viewport: { width: 1600, height: 900 }, k: 4 },
  { dpr: 1.5, viewport: { width: 1300, height: 730 }, k: 4 },
  { dpr: 1.75, viewport: { width: 1100, height: 620 }, k: 4 },
  { dpr: 2, viewport: { width: 960, height: 540 }, k: 4 },
  { dpr: 2.25, viewport: { width: 1600, height: 900 }, k: 7 },
];
/** Extra windows where the ratio does not divide the picture: the cases B0's sizing got wrong. */
const AWKWARD = [
  { dpr: 1.1, viewport: { width: 1000, height: 560 }, k: 2 },
  { dpr: 1.75, viewport: { width: 1400, height: 790 }, k: 5 },
  { dpr: 2.25, viewport: { width: 1200, height: 680 }, k: 5 },
  { dpr: 2.5, viewport: { width: 900, height: 520 }, k: 4 },
];

interface Lab {
  page: Page;
  /** Console messages that are errors or warnings, and uncaught page errors. */
  problems: string[];
  close(): Promise<void>;
}

/** Open the lab with the clock in the test's hands (`?manual`). */
async function openLab(browser: Browser, dpr = 1, viewport = { width: 960, height: 540 }): Promise<Lab> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Chrome's own performance hint, logged when a page reads pixels back from the GPU. Only this
    // test hook does that (to compare pictures); the engine itself never reads the GPU back. The boot
    // test below checks the page BEFORE any readback, with nothing allowed.
    if (/GPU stall due to ReadPixels/.test(m.text())) return;
    // Vite's hot-reload socket can fail to connect while the dev server is busy. Tooling noise, not the engine.
    if (/WebSocket connection to 'ws:\/\/localhost:\d+\/\?token=/.test(m.text())) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Count every requestAnimationFrame CALLBACK THAT RUNS, from before any script runs (the "no second loop" check).
  await page.addInitScript(() => {
    const w = window as unknown as { __rafRuns: number };
    w.__rafRuns = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      orig((t) => {
        w.__rafRuns++;
        cb(t);
      });
  });
  const boot = async (): Promise<string | undefined> => {
    await page.goto('/sjelab.html?manual');
    await page.waitForFunction(() => window.__SJE__ !== undefined || (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ !== undefined, null, { timeout: 90_000 });
    return page.evaluate(() => (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__);
  };
  let failed = await boot();
  // The dev server (Vite) now and then fails ONE module request while it is busy re-transforming files. That is the
  // server, not the engine: try once more. Any other start-up error is real and stops the test.
  if (failed && /Failed to fetch dynamically imported module/.test(failed)) {
    problems.length = 0;
    failed = await boot();
  }
  if (failed) throw new Error(`the lab failed to start: ${failed}`);
  return { page, problems, close: () => context.close() };
}

/** Run `fn` against a fresh lab and always close it. */
async function withLab(browser: Browser, fn: (lab: Lab) => Promise<void>, dpr?: number, viewport?: { width: number; height: number }): Promise<void> {
  const lab = await openLab(browser, dpr, viewport);
  try {
    await fn(lab);
    expect(lab.problems, 'console errors and warnings').toEqual([]);
  } finally {
    await lab.close();
  }
}

const SHOTS = process.env.SJE_SHOTS;
function save(name: string, dataUrl: string): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
}

test.describe('engine lab: boot', () => {
  test('boots on WebGL2 with zero console errors and warnings, and says which renderer drew it', async ({ browser }) => {
    await withLab(browser, async ({ page, problems }) => {
      // Nothing has read a pixel yet: no console error, no warning, none allowed.
      expect(problems, 'console errors and warnings during boot').toEqual([]);
      const info = await page.evaluate(() => window.__SJE__?.info());
      console.log(`SJE renderer: ${info?.renderer} | ${info?.version} | k=${info?.k} dpr=${info?.dpr}`);
      expect(info?.version).toContain('WebGL 2');
      expect([info?.w, info?.h]).toEqual([480, 270]);
      // The lab scene stepped one tick and drew: something other than the void colour is on screen.
      const pixel = await page.evaluate(() => window.__SJE__?.pixel(10, 4));
      expect(pixel).not.toEqual([7, 6, 13, 255]);
      // The raw back buffer is readable: 480x270 RGBA, opaque everywhere (the engine clears to an opaque colour).
      const raw = await page.evaluate(() => window.__SJE__?.pixels());
      const bytes = Buffer.from(raw?.base64 ?? '', 'base64');
      expect([raw?.w, raw?.h, bytes.length]).toEqual([480, 270, 480 * 270 * 4]);
      let transparent = 0;
      for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== 255) transparent++;
      expect(transparent).toBe(0);
    });
  });

  test('the engine runs ONE loop: Pixi starts no requestAnimationFrame loop of its own', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      // ?manual: our FixedLoop is not started, so once the lab is up nobody should be running frames.
      // (Pixi's scheduler asks for one frame while it starts. It must not keep asking.)
      const runs = () => page.evaluate(() => (window as unknown as { __rafRuns: number }).__rafRuns);
      const before = await runs();
      await page.waitForTimeout(700);
      expect(await runs(), 'requestAnimationFrame callbacks that ran after boot (Ticker.system must be stopped)').toBe(before);
    });
  });
});

test.describe('engine lab: no WebGL2', () => {
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

test.describe('engine lab: what gets loaded', () => {
  test('Pixi’s "load every extension" chunks are never downloaded (skipExtensionImports works), and no three.js', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await context.newPage();
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto('/sjelab.html?manual');
    await page.waitForFunction(() => window.__SJE__ !== undefined, null, { timeout: 90_000 });
    await context.close();
    expect(urls.some((u) => /pixi/i.test(u)), 'Pixi was loaded at all (the check is looking at the right requests)').toBe(true);
    expect(urls.filter((u) => /browserAll|webworkerAll|accessibility|lib\/events/.test(u))).toEqual([]);
    expect(urls.filter((u) => /\/three[/.@-]|three\.module/.test(u))).toEqual([]);
  });
});

test.describe('engine lab: crisp pixels at every zoom and device pixel ratio', () => {
  for (const { dpr, viewport, k } of [...ZOOM4, ...AWKWARD]) {
    test(`every ${k}x${k} block is one flat colour at device pixel ratio ${dpr}, window ${viewport.width}x${viewport.height} (the GL canvas, over a camera pan)`, async ({ browser }) => {
      await withLab(
        browser,
        async ({ page }) => {
          const info = await page.evaluate(() => window.__SJE__?.info());
          expect(info?.k, 'integer zoom').toBe(k);
          for (const tick of [0, 150, 477, 900, 1180]) {
            const blocks = await page.evaluate((t) => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              h.step(t - h.tick());
              return h.canvasBlocks();
            }, tick);
            expect(blocks.canvasW).toBe(480 * k);
            expect(blocks.canvasH).toBe(270 * k);
            expect(blocks.blocks).toBe(480 * 270);
            expect(blocks.bad, `non-uniform ${k}x${k} blocks at tick ${tick}, dpr ${dpr}: ${JSON.stringify(blocks.samples)}`).toBe(0);
          }
        },
        dpr,
        viewport,
      );
    });

    test(`and in a screenshot of the page at device pixel ratio ${dpr}, window ${viewport.width}x${viewport.height} (what the compositor shows)`, async ({ browser }) => {
      await withLab(
        browser,
        async ({ page }) => {
          await page.evaluate(() => window.__SJE__?.step(333));
          // The canvas is the whole window in device pixels. The picture sits inside it, on a whole device pixel.
          const pic = await page.evaluate(() => window.__SJE__?.picture());
          expect(pic?.k).toBe(k);
          const where = await page.evaluate(() => {
            const c = document.querySelector('canvas');
            const r = c?.getBoundingClientRect();
            return { left: r?.left ?? -1, top: r?.top ?? -1, width: r?.width ?? 0, height: r?.height ?? 0, backingW: c?.width ?? 0, backingH: c?.height ?? 0, innerW: window.innerWidth, innerH: window.innerHeight };
          });
          // The canvas fills the window exactly, and its backing store is the window's size in device pixels: nothing for the browser to resample.
          expect([where.left, where.top, where.width, where.height]).toEqual([0, 0, where.innerW, where.innerH]);
          expect([where.backingW, where.backingH]).toEqual([Math.round(where.innerW * dpr), Math.round(where.innerH * dpr)]);
          expect([pic?.canvasW, pic?.canvasH]).toEqual([where.backingW, where.backingH]);
          expect(Number.isInteger(pic?.x) && Number.isInteger(pic?.y)).toBe(true);
          const shot = await page.screenshot();
          const url = `data:image/png;base64,${shot.toString('base64')}`;
          const region = { x: pic?.x ?? 0, y: pic?.y ?? 0, w: 480 * k, h: 270 * k };
          const blocks = await page.evaluate(([u, kk, r]) => window.__SJE__?.imageBlocks(u as string, kk as number, r as typeof region), [url, k, region]);
          expect(blocks?.blocks).toBe(480 * 270);
          expect(blocks?.bad, `non-uniform ${k}x${k} blocks in the screenshot at dpr ${dpr}: ${JSON.stringify(blocks?.samples)}`).toBe(0);
          // The bars around the picture are the void colour (so the picture's edge is where the engine says it is).
          const probe = (x: number, y: number) => page.evaluate(async ([u, px, py]) => {
            const bmp = await createImageBitmap(await (await fetch(u as string)).blob());
            const c = document.createElement('canvas');
            c.width = bmp.width;
            c.height = bmp.height;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx?.drawImage(bmp, 0, 0);
            return Array.from(ctx?.getImageData(px as number, py as number, 1, 1).data ?? []);
          }, [url, x, y]);
          if (region.x > 0) expect(await probe(region.x - 1, region.y + 5)).toEqual([7, 6, 13, 255]);
          if (region.y > 0) expect(await probe(region.x + 5, region.y - 1)).toEqual([7, 6, 13, 255]);
          // (Only when the picture does not touch the right edge: a pixel past the screenshot has no colour at all.)
          if (region.x + region.w < (pic?.canvasW ?? 0)) expect(await probe(region.x + region.w, region.y + 5)).toEqual([7, 6, 13, 255]);
        },
        dpr,
        viewport,
      );
    });
  }

  test('other whole zooms are exact too (1, 2, 3 at dpr 1)', async ({ browser }) => {
    for (const [w, h, k] of [
      [480, 270, 1],
      [960, 540, 2],
      [1440, 810, 3],
    ] as const) {
      await withLab(
        browser,
        async ({ page }) => {
          const blocks = await page.evaluate(() => {
            window.__SJE__?.step(211);
            return window.__SJE__?.canvasBlocks();
          });
          expect(blocks?.k).toBe(k);
          expect(blocks?.bad, `zoom ${k}`).toBe(0);
        },
        1,
        { width: w, height: h },
      );
    }
  });
});

test.describe('engine lab: determinism', () => {
  test('the same tick count gives the same pixel hash on two page loads', async ({ browser }) => {
    const hashes: string[][] = [];
    for (let load = 0; load < 2; load++) {
      await withLab(browser, async ({ page }) => {
        const run: string[] = [];
        for (const ticks of [0, 1, 59, 60, 333, 1000]) {
          run.push(
            await page.evaluate((t) => {
              const h = window.__SJE__;
              if (!h) throw new Error('no hook');
              return h.step(t - h.tick());
            }, ticks),
          );
        }
        hashes.push(run);
      });
    }
    expect(hashes[1]).toEqual(hashes[0]);
    // And the picture really changes with the tick (the check is not comparing blank frames).
    expect(new Set(hashes[0]).size).toBeGreaterThanOrEqual(4);
  });

  test('however the ticks are split (1 x 333, 333 x 1, 3 x 111), the picture is the same', async ({ browser }) => {
    const results: string[] = [];
    for (const split of [[333], Array(333).fill(1), [111, 111, 111]] as number[][]) {
      await withLab(browser, async ({ page }) => {
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

test.describe('engine lab: parity with a Canvas 2D drawing of the same content', () => {
  test('the engine frame matches the CPU reference: report the difference at five ticks', async ({ browser }, testInfo) => {
    await withLab(browser, async ({ page }) => {
      const rows: string[] = [];
      let worst = 0;
      let worstPct = 0;
      for (const tick of [0, 90, 400, 1000, 1500]) {
        const p = await page.evaluate((t) => {
          const h = window.__SJE__;
          if (!h) throw new Error('no hook');
          h.step(t - h.tick());
          return h.parity();
        }, tick);
        rows.push(`tick ${String(tick).padStart(4)}: max channel difference ${p.maxDiff}/255, ${p.differing} of ${p.total} pixels differ (${p.pct.toFixed(3)}%), ${p.over1} by more than 1`);
        worst = Math.max(worst, p.maxDiff);
        worstPct = Math.max(worstPct, p.pct);
        // Everything that differs is a half-transparent pixel, which rounds differently (see below).
        expect(p.maxDiff, `tick ${tick}`).toBeLessThanOrEqual(1);
      }
      console.log(`SJE PARITY (Pixi on the GPU vs Canvas 2D on the CPU)\n${rows.join('\n')}\nworst: ${worst}/255 on at most ${worstPct.toFixed(3)}% of pixels`);
      testInfo.annotations.push({ type: 'parity', description: `worst max diff ${worst}/255, worst ${worstPct.toFixed(3)}% of pixels differ` });
      // Spike pass line for the stage slice: no pixel more than 2/255 off, and at most 3% of pixels differ at all.
      expect(worst).toBeLessThanOrEqual(2);
      expect(worstPct).toBeLessThanOrEqual(3);
    });
  });

  test('everything that is not translucent is EXACT: sprites, flips, snapped positions, rectangles, lines, text, enemies', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const regions = await page.evaluate(() => window.__SJE__?.layout());
      expect(regions).toBeTruthy();
      for (const tick of [0, 250, 777]) {
        const result = await page.evaluate(
          ([t]) => {
            const h = window.__SJE__;
            if (!h) throw new Error('no hook');
            h.step((t as number) - h.tick());
            const l = h.layout();
            const names = ['whole', 'fracHalf', 'fracQuarter', 'flipped', 'unflipped', 'scaled2x', 'rectOpaque', 'rectEdge', 'lineH', 'lineV', 'text', 'titleBar', 'sort'] as const;
            const out: Record<string, number> = {};
            for (const n of names) out[n] = h.parity(l[n]).differing;
            // The world: tick lines, the enemies and the backdrops, above the translucent ground stripe.
            out.world = h.parity({ x: 0, y: 140, w: 480, h: 96 }).differing;
            // Both diagonals (Bresenham): the whole row 2 panel's line area.
            out.diagonals = h.parity({ x: 184, y: 58, w: 56, h: 30 }).differing;
            return out;
          },
          [tick],
        );
        for (const [name, differing] of Object.entries(result)) expect(differing, `${name} at tick ${tick}`).toBe(0);
      }
    });
  });

  test('a translucent pixel differs by at most 1/255 (premultiplied alpha rounds differently from Canvas 2D)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const out = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const l = h.layout();
        h.step(10);
        return { rect: h.parity(l.rectAlpha), sprite: h.parity(l.halfAlpha), stripe: h.parity({ x: 0, y: 238, w: 480, h: 6 }) };
      });
      for (const p of Object.values(out)) expect(p.maxDiff).toBeLessThanOrEqual(1);
      // ...and they really do differ somewhere: the exact checks above are not passing by accident.
      expect(out.rect.differing + out.stripe.differing).toBeGreaterThan(0);
    });
  });
});

test.describe('engine lab: snap to pixel, flip and depth', () => {
  test('a sprite at a fractional position lands on Math.round of it, and jumps one whole pixel at .5', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const result = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const region = { x: 208, y: 24, w: 26, h: 24 }; // around the probe at (220, 36), inside row 1
        const exactAt = (f: number) => {
          h.setProbe(220 + f, 36 + f);
          return { diff: h.parity(region).differing, hash: h.regionHash(region.x, region.y, region.w, region.h) };
        };
        const out: Record<string, { diff: number; hash: string }> = {};
        for (const f of [0, 0.1, 0.25, 0.49, 0.5, 0.51, 0.75, 0.99, 1]) out[String(f)] = exactAt(f);
        return out;
      });
      for (const [f, r] of Object.entries(result)) expect(r.diff, `probe at +${f}`).toBe(0); // equals the reference, which rounds
      expect(result['0.1']?.hash).toBe(result['0']?.hash);
      expect(result['0.25']?.hash).toBe(result['0']?.hash);
      expect(result['0.49']?.hash).toBe(result['0']?.hash);
      expect(result['0.5']?.hash).toBe(result['1']?.hash); // .5 rounds UP, to the next whole pixel
      expect(result['0.99']?.hash).toBe(result['1']?.hash);
      expect(result['0.5']?.hash).not.toBe(result['0']?.hash);
    });
  });

  test('flipX mirrors about the middle and stays in place (Phaser), and a snapped pair is identical to the pixel', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const bad = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        h.step(5);
        const l = h.layout();
        const f = l.flipped;
        const u = l.unflipped;
        let mismatches = 0;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const a = h.pixel(f.x + x, f.y + y);
            const b = h.pixel(u.x + 7 - x, u.y + y);
            if (a.join() !== b.join()) mismatches++;
          }
        }
        return mismatches;
      });
      expect(bad).toBe(0);
    });
  });

  test('depth sorts siblings: a container whose children were added red, green, blue draws green, blue, red', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const colours = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        h.step(3);
        const l = h.layout();
        const at = (r: { x: number; y: number }) => h.pixel(r.x, r.y).slice(0, 3);
        return { redOnly: at(l.sortRedOnly), redGreen: at(l.sortRedGreen), all: at(l.sortAll), greenBlue: at(l.sortGreenBlue) };
      });
      const RED = [0xe8, 0x45, 0x2e];
      const BLUE = [0x3a, 0x6a, 0xff];
      expect(colours.redOnly).toEqual(RED);
      expect(colours.redGreen).toEqual(RED); // depth 3 over depth 1
      expect(colours.all).toEqual(RED); // depth 3 over 1 and 2
      expect(colours.greenBlue).toEqual(BLUE); // depth 2 over depth 1
    });
  });
});

test.describe('engine lab: the camera', () => {
  test('a slow pan is stable: whole pixels only, 0 or 1 per tick, never back, and the world matches the reference every tick', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const result = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const report = { badStep: [] as string[], mismatch: [] as string[], uiChanged: 0, moved: 0, parityBad: [] as string[] };
        const l = h.layout();
        const staticUi = ['titleBar', 'row2', 'row3', 'sort'] as const;
        const base = staticUi.map((n) => h.regionHash(l[n].x, l[n].y, l[n].w, l[n].h));
        let last = h.scroll().camera;
        for (let t = 1; t <= 900; t++) {
          h.step(1);
          const s = h.scroll();
          if (!Number.isInteger(s.camera)) report.badStep.push(`tick ${t}: fractional ${s.camera}`);
          if (s.camera - last !== 0 && s.camera - last !== 1) report.badStep.push(`tick ${t}: step ${s.camera - last}`);
          if (s.camera !== s.expected) report.mismatch.push(`tick ${t}: ${s.camera} vs ${s.expected}`);
          if (s.camera !== last) report.moved++;
          last = s.camera;
          // The HUD does not move with the camera: its flat panels are the same picture every tick.
          const now = staticUi.map((n) => h.regionHash(l[n].x, l[n].y, l[n].w, l[n].h));
          if (now.join() !== base.join()) report.uiChanged++;
          // The world, above the translucent stripe, equals the reference exactly (no shimmer, no seam).
          if (t % 6 === 0) {
            const p = h.parity({ x: 0, y: 140, w: 480, h: 96 });
            if (p.differing) report.parityBad.push(`tick ${t}: ${p.differing}`);
          }
        }
        return { ...report, finalScroll: last };
      });
      expect(result.badStep).toEqual([]);
      expect(result.mismatch).toEqual([]);
      expect(result.uiChanged).toBe(0);
      expect(result.parityBad).toEqual([]);
      // 900 ticks at 0.4 px per tick is 360 px, one pixel at a time.
      expect(result.finalScroll).toBe(360);
      expect(result.moved).toBe(360);
    });
  });

  test('the camera stops at the bounds of the world and comes back (a triangle wave 0 to 480)', async ({ browser }) => {
    await withLab(browser, async ({ page }) => {
      const s = await page.evaluate(() => {
        const h = window.__SJE__;
        if (!h) throw new Error('no hook');
        const out: number[] = [];
        for (const t of [1200, 1800, 2400]) {
          h.step(t - h.tick());
          out.push(h.scroll().camera);
        }
        return out;
      });
      expect(s).toEqual([480, 240, 0]);
    });
  });
});

test.describe('engine lab: speed', () => {
  test('a draw costs little JavaScript time, and the real 60 Hz loop keeps its frame interval', async ({ browser }) => {
    // 1. JavaScript time per tick and per draw (manual clock, so nothing else is running).
    await withLab(browser, async ({ page }) => {
      await page.evaluate(() => window.__SJE__?.timing(30)); // warm up: first draws compile shaders
      const t = await page.evaluate(() => window.__SJE__?.timing(300));
      console.log(`SJE JS time per call (ms): tick mean ${t?.tick.mean.toFixed(3)} p95 ${t?.tick.p95.toFixed(3)} | draw mean ${t?.draw.mean.toFixed(3)} p95 ${t?.draw.p95.toFixed(3)} max ${t?.draw.max.toFixed(2)}`);
      // Design budgets (docs/engine/tooling-and-testing.md section 7): simulation mean 2 ms, draw phase 3 ms.
      expect(t?.tick.mean).toBeLessThan(2);
      expect(t?.draw.mean).toBeLessThan(3);
    });
    // 2. The real loop, free-running, at the page's own size: how long between animation frames?
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
    });
    await page.goto('/sjelab.html'); // no ?manual: the FixedLoop runs
    await page.waitForFunction(() => window.__SJE__ !== undefined, null, { timeout: 90_000 });
    const intervals = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          let last = performance.now();
          const frame = (now: number) => {
            out.push(now - last);
            last = now;
            if (out.length < 180) requestAnimationFrame(frame);
            else resolve(out.slice(20)); // drop the first frames: shader compiles and warm-up
          };
          requestAnimationFrame(frame);
        }),
    );
    const ticks = await page.evaluate(() => window.__SJE__?.tick() ?? 0);
    await context.close();
    const sorted = [...intervals].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    console.log(`SJE frame interval at 960x540 (ms): p50 ${p50.toFixed(2)} p95 ${p95.toFixed(2)} max ${sorted[sorted.length - 1]?.toFixed(1)}; the loop ran ${ticks} ticks`);
    expect(ticks, 'the real loop is ticking').toBeGreaterThan(100);
    // Loose on purpose (CI is software GL and shared): a stuck loop or a frame time of a stutter fails, noise does not.
    expect(p50).toBeLessThan(25);
    expect(p95).toBeLessThan(60);
    expect(problems.filter((p) => !/GPU stall/.test(p))).toEqual([]);
  });
});

test.describe('engine lab: lifetime', () => {
  test('entering and leaving a scene 10 times leaves the GL object counts where they were; a deliberate leak grows them', async ({ browser }) => {
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
      expect(out.after).toEqual(out.baseline);
      expect(out.leaked.texture).toBeGreaterThanOrEqual(out.after.texture + 6);
    });
  });

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
    });
  });
});

test.describe('engine lab: pictures for a human (only when SJE_SHOTS is set)', () => {
  test('save the engine frame, the reference, the diff and the canvas at zoom 4', async ({ browser }) => {
    test.skip(!SHOTS, 'set SJE_SHOTS=<folder> to save pictures');
    await withLab(
      browser,
      async ({ page }) => {
        for (const tick of [0, 600]) {
          await page.evaluate((t) => {
            const h = window.__SJE__;
            if (!h) throw new Error('no hook');
            h.step(t - h.tick());
          }, tick);
          for (const which of ['sje', 'ref', 'diff'] as const) save(`${which}-t${tick}.png`, (await page.evaluate((w) => window.__SJE__?.png(w, 2), which)) ?? '');
          save(`canvas-zoom4-t${tick}.png`, (await page.evaluate(() => window.__SJE__?.png('canvas'))) ?? '');
        }
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          writeFileSync(join(SHOTS, 'page-zoom4.png'), await page.screenshot());
        }
      },
      1,
      ZOOM4[0]?.viewport,
    );
  });
});
