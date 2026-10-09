/**
 * GPU effects (engine/postfx.ts, engine/gl/presenter.ts): the WebGL layer comes up where WebGL 2
 * exists, survives a battle full of effects, can be switched off and on in Options, and a browser
 * without WebGL 2 plays exactly as before on the 2D canvas.
 */
import { expect, test, type Page } from '@playwright/test';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** WebGL 2 on a real GPU, as the presenter asks for it (a software renderer, as on CI, doesn't count). */
const hasWebGl2 = (page: Page) =>
  page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    // The same test as GlPresenter.create (engine/gl/presenter.ts SOFTWARE_GL).
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    return !/swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(name);
  });

test('with WebGL 2, the effects layer draws the game, through a battle full of effects', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await page.waitForTimeout(700);
  test.skip(!(await hasWebGl2(page)), 'this browser has no WebGL 2 (the fallback test covers it)');
  await expect(page.locator('#fx')).toBeVisible();
  expect(await sj<boolean>(page, "sj.postfx.active")).toBe(true);
  await sj(page, "sj.stage('sinkline')");
  await page.waitForTimeout(900);
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3500);
  // Every kind of moment at once, several times over: shockwaves, colour split, flares, and
  // every emitter preset.
  await sj(page, `(async () => {
    const postfx = sj.postfx;
    // The middle of the screen, from the one size source (src/engine/game.ts), not a literal.
    const { W, H } = await import('/src/engine/game.ts');
    for (let i = 0; i < 6; i++) {
      // The six emit points spread over the full width, at 40% of the screen height (it was 100 of 270).
      for (const p of Object.values(sj.fx.presets)) postfx.emit(p, (W * (i + 1)) / 7, H * 0.4);
      postfx.shock(W / 2, H / 2, { strength: 6, reach: 200 });
      postfx.aberrate(4, W / 2, H / 2);
      postfx.flare(1.5);
    }
  })()`);
  await page.waitForTimeout(600);
  const live = await sj<number>(page, "sj.postfx.particles.count");
  expect(live).toBeGreaterThan(0);
  // The presenter kept its context and the game kept running.
  expect(await sj<boolean>(page, "sj.postfx.active")).toBe(true);
  expect(await sj<string>(page, 'sj.top()')).toBe('BattleScene');
  expect(errors).toEqual([]);
});

test('GPU effects switch off and on from Options, and the choice is remembered', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await page.waitForTimeout(700);
  test.skip(!(await hasWebGl2(page)), 'this browser has no WebGL 2');
  await sj(page, 'sj.gpu(false)');
  await page.waitForTimeout(200);
  await expect(page.locator('#fx')).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(700);
  await expect(page.locator('#fx')).toHaveCount(0);
  await sj(page, 'sj.gpu(true)');
  await page.waitForTimeout(200);
  await expect(page.locator('#fx')).toBeVisible();
  expect(errors).toEqual([]);
});

test('without WebGL 2 (or with only a software renderer) the game plays on the 2D canvas as before', async ({ page }) => {
  const errors = watchErrors(page);
  // A browser with no WebGL 2 at all.
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (get as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/?debug');
  await page.waitForTimeout(700);
  await expect(page.locator('#fx')).toHaveCount(0);
  await sj(page, "sj.stage('sinkline')");
  await page.waitForTimeout(900);
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3500);
  // Effect calls are harmless no-ops here.
  await sj(page, "(async () => { sj.postfx.shock(1, 1); sj.postfx.emit(sj.fx.presets.embers, 10, 10); })()");
  expect(await sj<number>(page, "sj.postfx.particles.count")).toBe(0);
  expect(await sj<string>(page, 'sj.top()')).toBe('BattleScene');
  // The frame is drawn (not a blank canvas): the screenshot has more than one colour in it.
  const png = await page.locator('#screen').screenshot();
  expect(png.length).toBeGreaterThan(20_000);
  expect(errors).toEqual([]);
});

/**
 * Pixel-perfect scaling (PL7 of docs/PIVOT-640.md): on the 2D canvas, in Pixel-perfect mode, every
 * game pixel is an exact k-by-k block of screen pixels, k a whole number: 3 on a 1080p screen and 2
 * in the Steam Deck's 1280x800 window. "Uneven" means a block whose k*k pixels are not all one
 * color, which is what a fractional scale or a resample leaves at the seams. The GPU layer is off,
 * so the visible picture is the 2D canvas itself; the page is busy (rain, a lit street) so a flat
 * picture cannot pass by being uniform.
 */
for (const [name, vw, vh, k] of [
  ['1920x1080 (1080p)', 1920, 1080, 3],
  ['1280x800 (the Steam Deck window)', 1280, 800, 2],
] as const) {
  test(`Pixel-perfect mode draws every game pixel as an exact ${k}x${k} block at ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto('/?debug');
    await page.waitForTimeout(700);
    await sj(page, 'sj.gpu(false)');
    await sj(page, "(sj.display.mode = 'integer', sj.display.resize(), true)");
    await sj(page, "sj.stage('town')");
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const sj = (window as unknown as { __SJ__: { display: { back: HTMLCanvasElement } } }).__SJ__;
      const c = document.getElementById('screen') as HTMLCanvasElement;
      const gw = sj.display.back.width, gh = sj.display.back.height;
      const k = c.width / gw;
      const rect = c.getBoundingClientRect();
      const px = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
      const colors = new Set<number>();
      let uneven = 0;
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const o = (gy * k * c.width + gx * k) * 4;
          const want = (px[o] ?? 0) | ((px[o + 1] ?? 0) << 8) | ((px[o + 2] ?? 0) << 16) | ((px[o + 3] ?? 0) << 24);
          colors.add(want);
          let same = true;
          for (let dy = 0; dy < k && same; dy++) {
            for (let dx = 0; dx < k; dx++) {
              const p = ((gy * k + dy) * c.width + gx * k + dx) * 4;
              if (px[p] !== px[o] || px[p + 1] !== px[o + 1] || px[p + 2] !== px[o + 2] || px[p + 3] !== px[o + 3]) {
                same = false;
                break;
              }
            }
          }
          if (!same) uneven++;
        }
      }
      return { gw, gh, k, backing: [c.width, c.height], shown: [rect.width, rect.height], uneven, colors: colors.size };
    });
    // The back buffer is scaled by exactly k, and the canvas is shown at its own size (the browser
    // resamples nothing).
    expect(r.k).toBe(k);
    expect(r.backing).toEqual([r.gw * k, r.gh * k]);
    expect(r.shown).toEqual(r.backing);
    expect(r.colors).toBeGreaterThan(30);
    expect(r.uneven).toBe(0);
    expect(errors).toEqual([]);
  });
}
