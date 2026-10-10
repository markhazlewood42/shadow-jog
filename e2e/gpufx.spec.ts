/**
 * GPU effects on the new engine (M6 rewrote this spec: it used to look for the `#fx` overlay canvas of the old presenter, which no longer exists). The effects now come
 * from `game.fx`, and the spec reads their level from `__SJ__.renderer.fxLevel` (docs/engine/tooling-and-testing.md section 11):
 *
 *  - the default level (no `?fx=`) is the request `auto`, which gives `full` on a GPU and `lite` on software GL (`fxCounts().level` is the level actually drawn), the game survives a battle full of effects, and no `#fx` canvas exists;
 *  - the Options switch (`gpu(false)` / `gpu(true)`) changes the level, and the choice is remembered across a reload;
 *  - `?fx=none` forces the level `none`: every effect call is a no-op and the battle plays. Control: the same calls at the default level make particles;
 *  - Pixel-perfect scaling (PL7 of docs/PIVOT-640.md): every game pixel is an exact k-by-k block of screen pixels. Control: the same picture read at another ratio is uneven.
 *
 * A browser without WebGL 2 does not play at all since M6; its message is checked in `e2e/prod.spec.ts`, `e2e/gameover.spec.ts` and `e2e/sje-shell.spec.ts`.
 */
import { expect, test, type Page } from '@playwright/test';
import { H, W } from '../src/sje/core/size';
import { decode, unevenBlocks } from './sjegamekit';

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

/** Open the game and wait for its title. `query` is extra text, for example `&fx=none`. */
async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/?debug${query}`);
  await page.waitForFunction(() => (window as unknown as { __SJ__?: { top?: () => string | null } }).__SJ__?.top?.() === 'TitleScene', null, { timeout: 30_000 });
}

/** Every kind of effect call at once, several times over: shockwaves, colour split, flares, and every emitter preset. */
const SPRAY = `(() => {
  const postfx = sj.postfx;
  for (let i = 0; i < 6; i++) {
    // The six emit points spread over the full width, at 40% of the screen height.
    for (const p of Object.values(sj.fx.presets)) postfx.emit(p, (${W} * (i + 1)) / 7, ${H} * 0.4);
    postfx.shock(${W / 2}, ${H / 2}, { strength: 6, reach: 200 });
    postfx.aberrate(4, ${W / 2}, ${H / 2});
    postfx.flare(1.5);
  }
})()`;

async function intoBattle(page: Page): Promise<void> {
  await sj(page, "sj.stage('sinkline')");
  await page.waitForTimeout(900);
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3500);
}

test('at the default level the effects run through a battle full of effects, with no #fx canvas', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  // `renderer.fxLevel` is what was asked for: `auto` by default. What is drawn (`fxCounts().level`) is `lite` on software GL (CI) and `full` on a GPU, never `none`.
  expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('auto');
  expect(await sj<string>(page, 'sj.fxCounts().level')).toMatch(/^(full|lite)$/);
  expect(await sj<boolean>(page, 'sj.postfx.active')).toBe(true);
  // The old overlay canvas is gone, and the one canvas is the game's own.
  await expect(page.locator('#fx')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  await intoBattle(page);
  await sj(page, SPRAY);
  await page.waitForTimeout(600);
  expect(await sj<number>(page, 'sj.postfx.particles.count')).toBeGreaterThan(0);
  // The renderer kept its context, the level did not change, and the game kept running.
  expect(await sj<boolean>(page, 'sj.renderer.contextLost')).toBe(false);
  expect(await sj<string>(page, 'sj.fxCounts().level')).toMatch(/^(full|lite)$/);
  expect(await sj<string>(page, 'sj.top()')).toBe('BattleScene');
  expect(errors).toEqual([]);
});

test('GPU effects switch off and on from Options, and the choice is remembered', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await sj(page, 'sj.gpu(false)');
  await page.waitForTimeout(200);
  expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('none');
  expect(await sj<boolean>(page, 'sj.postfx.active')).toBe(false);
  await page.reload();
  await page.waitForTimeout(700);
  // Remembered: the setting is `none`, so the reloaded page runs at `none`.
  expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('none');
  await sj(page, 'sj.gpu(true)');
  await page.waitForTimeout(200);
  expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('full');
  expect(await sj<string>(page, 'sj.fxCounts().level')).toBe('full');
  expect(await sj<boolean>(page, 'sj.postfx.active')).toBe(true);
  await expect(page.locator('#fx')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('?fx=none forces the level none: effect calls do nothing and the battle plays', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '&fx=none');
  expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('none');
  expect(await sj<boolean>(page, 'sj.postfx.active')).toBe(false);
  // The Options switch cannot override the forced level.
  await sj(page, 'sj.gpu(true)');
  await page.waitForTimeout(200);
  expect(await sj<string>(page, 'sj.renderer.fxLevel')).toBe('none');
  await intoBattle(page);
  // Effect calls are harmless no-ops here.
  await sj(page, SPRAY);
  expect(await sj<number>(page, 'sj.postfx.particles.count')).toBe(0);
  expect(await sj<string>(page, 'sj.top()')).toBe('BattleScene');
  // The frame is drawn (not a blank canvas): the screenshot has more than one colour in it.
  const png = await page.locator('canvas').first().screenshot();
  expect(png.length).toBeGreaterThan(20_000);
  expect(errors).toEqual([]);
});

/**
 * Pixel-perfect scaling (PL7 of docs/PIVOT-640.md): in Pixel-perfect mode, every game pixel is an exact k-by-k block of screen pixels, k a whole number: 3 on a 1080p
 * screen and 2 in the Steam Deck's 1280x800 window. "Uneven" means a block whose k*k pixels are not all one color, which is what a fractional scale or a resample leaves
 * at the seams. The effects are off, so the visible picture is the base picture; the page is busy (rain, a lit street) so a flat picture cannot pass by being uniform.
 */
for (const [name, vw, vh, k] of [
  ['1920x1080 (1080p)', 1920, 1080, 3],
  ['1280x800 (the Steam Deck window)', 1280, 800, 2],
] as const) {
  test(`Pixel-perfect mode draws every game pixel as an exact ${k}x${k} block at ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: vw, height: vh });
    await open(page);
    await sj(page, 'sj.gpu(false)');
    await sj(page, "(sj.display.mode = 'integer', sj.display.resize(), true)");
    await sj(page, "sj.stage('town')");
    await page.waitForTimeout(1500);
    // The canvas fills the window; the picture sits in it at the whole ratio k, centered, with bars around it (the browser resamples nothing).
    const layout = await sj<{ k: number; x: number; y: number; w: number; h: number }>(page, 'sj.game.renderer.picture');
    expect(layout.k).toBe(k);
    expect([layout.w, layout.h]).toEqual([W * k, H * k]);
    const img = decode(await page.locator('canvas').first().screenshot());
    expect([img.w, img.h]).toEqual([vw, vh]);
    const colors = new Set<number>();
    // Colors inside the picture only (the bars are one flat color).
    for (let i = (layout.y * img.w + layout.x) * 4; i < ((layout.y + layout.h) * img.w) * 4; i += 4 * 61) colors.add(((img.data[i] ?? 0) << 16) | ((img.data[i + 1] ?? 0) << 8) | (img.data[i + 2] ?? 0));
    expect(colors.size).toBeGreaterThan(30);
    expect(unevenBlocks(img, k, layout.x, layout.y, W, H), 'uneven blocks').toBe(0);
    // Control: the same picture read at the next ratio has uneven blocks, so the check can fail.
    const wrong = k + 1;
    expect(unevenBlocks(img, wrong, layout.x, layout.y, Math.floor((W * k) / wrong) - 1, Math.floor((H * k) / wrong) - 1), 'control: a wrong ratio finds uneven blocks').toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
