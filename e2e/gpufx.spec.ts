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
    for (let i = 0; i < 6; i++) {
      for (const p of Object.values(sj.fx.presets)) postfx.emit(p, 120 + i * 40, 100);
      postfx.shock(240, 120, { strength: 6, reach: 200 });
      postfx.aberrate(4, 240, 120);
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
