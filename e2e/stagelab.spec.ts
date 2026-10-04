/**
 * The Phaser stage lab (spike `spike/phaser-stage`): /stagelab.html on the dev server.
 *
 * Checks that the real assets load and draw with no console errors, that the picture is not blank, that
 * the canvas is shown at a WHOLE-number zoom, that every texture is set to crisp (NEAREST) sampling, and
 * that the scene survives a window resize. Screenshots go outside the repo (STAGELAB_SHOTS, else the OS
 * temp folder). `STAGELAB_MEDIA=<folder>` additionally saves the judges' pictures there.
 *
 * Mark's `spritefusion-tests/` folder is git-ignored (linked into the project root), so a CI checkout of
 * the public repo does not have it. There the lab draws stand-in figures made in code (it says so on the
 * page and in `window.__stagelab.standIns`), and these tests run all the same; on Mark's machine they
 * also assert that his real sheets were the ones used.
 *
 * WebGL on a GPU-less machine: Chromium falls back to software WebGL (SwiftShader), which Phaser's AUTO
 * renderer accepts, so the same assertions hold there; `?renderer=canvas` forces Phaser's 2D canvas
 * renderer, and the "falls back" test below checks that one draws too.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { HAVE_SPRITES, hideSprites, hideStatus, MEDIA, openLab, SHOTS } from './stagelabkit';

test('the stage draws the real assets with no errors, and the picture is not blank', async ({ page }) => {
  const errors = await openLab(page);
  expect(await page.evaluate(() => window.__stagelab?.error ?? null)).toBeNull();
  expect(errors).toEqual([]);
  // Mark's real sheets where they exist; the code-drawn stand-ins only on a machine without them.
  expect(await page.evaluate(() => window.__stagelab?.standIns)).toBe(!HAVE_SPRITES);

  // Seven fighters: four heroes and three enemies, each with a shadow.
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.length)).toBe(7);
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'party').length)).toBe(4);

  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.width).toBe(480);
  expect(snap.height).toBe(270);
  // A backdrop with fighters has hundreds of colours; one flat colour or a handful means a blank or failed draw.
  expect(snap.colours).toBeGreaterThan(100);
  expect(snap.topShare).toBeLessThan(0.5);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'stagelab-default.png') });
  // Report the renderer that ran (WEBGL on a GPU, WEBGL on SwiftShader in CI, CANVAS if forced).
  console.log(`stagelab renderer: ${await page.evaluate(() => window.__stagelab?.renderer)}, zoom ${await page.evaluate(() => window.__stagelab?.zoom)}`);
});

test('every texture is crisp, and the canvas is shown at a whole-number zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const errors = await openLab(page);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  // 1500 x 900 holds 3 x 480 = 1440 wide and 3 x 270 = 810 tall: zoom 3, and the canvas box is exactly that big.
  expect(await page.evaluate(() => window.__stagelab?.zoom)).toBe(3);
  const box = await page.locator('canvas').boundingBox();
  expect(box?.width).toBe(1440);
  expect(box?.height).toBe(810);

  // Resizing the window re-fits to the new biggest whole number.
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.waitForFunction(() => window.__stagelab?.zoom === 2);
  const small = await page.locator('canvas').boundingBox();
  expect(small?.width).toBe(960);
  expect(small?.height).toBe(540);
});

test('pixel crispness: at zoom 4 every 4 x 4 block of the screen is one flat colour, and every sprite sits on whole pixels', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors = await openLab(page);
  await page.waitForFunction(() => window.__stagelab?.zoom === 4);
  await hideStatus(page);
  // Let the enemies sway and the heroes bounce for a moment: movement is where half-pixels would show.
  await page.waitForTimeout(900);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  const result = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d canvas');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let blocks = 0;
    let mixed = 0;
    for (let by = 0; by < c.height; by += 4) {
      for (let bx = 0; bx < c.width; bx += 4) {
        blocks++;
        const first = (by * c.width + bx) * 4;
        let same = true;
        for (let y = 0; y < 4 && same; y++) for (let x = 0; x < 4 && same; x++) {
          const i = ((by + y) * c.width + bx + x) * 4;
          if (px[i] !== px[first] || px[i + 1] !== px[first + 1] || px[i + 2] !== px[first + 2]) same = false;
        }
        if (!same) mixed++;
      }
    }
    return { blocks, mixed };
  }, png.toString('base64'));
  expect(result.blocks).toBe(480 * 270);
  expect(result.mixed).toBe(0);

  // Sprites: whole-number positions and whole-number scales.
  const odd = await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => !Number.isInteger(f.sprite.x) || !Number.isInteger(f.sprite.y) || !Number.isInteger(f.sprite.scaleX) || f.sprite.scaleX !== f.sprite.scaleY).length);
  expect(odd).toBe(0);
  expect(errors).toEqual([]);
});

test('restarting the scene twice leaves no stale fighters and no extra textures or objects', async ({ page }) => {
  const errors = await openLab(page);
  const before = await page.evaluate(() => window.__stagelab?.textureCount());
  const objects = await page.evaluate(() => window.__stagelab?.scene()?.children.length);
  for (let i = 0; i < 2; i++) await page.evaluate(() => window.__stagelab?.restart());
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.length)).toBe(7);
  // Every object in the display list is alive and there are no strays: the same count as the first run
  // (the stage picture, the guide, each fighter's shadow, ring, dotted ring and sprite, an enemy's bar, the HUD's boxes and labels).
  expect(await page.evaluate(() => window.__stagelab?.scene()?.children.length)).toBe(objects);
  expect(await page.evaluate(() => window.__stagelab?.textureCount())).toBe(before);
  expect(errors).toEqual([]);
});

test('without Mark’s sheets (or with ?standins) the crew are code-drawn stand-ins and the same pipeline runs', async ({ page }) => {
  const errors = await openLab(page, '?standins');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__stagelab?.standIns)).toBe(true);
  // Feet were found on the stand-ins' pixels, and the page says what it is showing.
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.filter((f) => f.side === 'party').length)).toBe(4);
  expect(await page.locator('#status').textContent()).toContain('stand-in');
  expect(await page.evaluate(() => window.__stagelab?.crisp())).toBe(true);
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'stagelab-standins.png') });
});

test('Mark’s folder missing the way Vite shows it (the app’s page instead of a 404) still gives the stand-ins, with no console errors', async ({ page }) => {
  await hideSprites(page);
  const errors = await openLab(page);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__stagelab?.standIns)).toBe(true);
  expect(await page.evaluate(() => window.__stagelab?.error)).toBeNull();
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.length)).toBe(7);
});

test('the Phaser canvas renderer fallback draws too', async ({ page }) => {
  const errors = await openLab(page, '?renderer=canvas');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__stagelab?.renderer)).toBe('CANVAS');
  // The depth haze is baked into copies of the pictures, so the back rows are hazed here too (Phaser's own tints are WebGL-only).
  expect(await page.evaluate(() => window.__stagelab?.scene()?.fighters.some((f) => f.sprite.texture.key.startsWith('haze-')))).toBe(true);
  const snap = await page.evaluate(() => window.__stagelab?.snapshot() ?? Promise.reject(new Error('no hook')));
  expect(snap.colours).toBeGreaterThan(100);
});

test('timing: load to first frame, and frame time over 5 seconds (reported, with a loose ceiling)', async ({ page }) => {
  const errors = await openLab(page);
  expect(errors).toEqual([]);
  const firstFrameMs = await page.evaluate(() => window.__stagelab?.firstFrameMs ?? 0);
  await page.evaluate(() => window.__stagelab?.resetStats());
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => window.__stagelab?.stats());
  const r = (n: number | undefined) => (n ?? 0).toFixed(2);
  console.log(
    `stagelab timing [${await page.evaluate(() => window.__stagelab?.renderer)}]: first frame ${Math.round(firstFrameMs)} ms after navigation; ${s?.frames} frames; ` +
      `interval p50 ${r(s?.intervalP50)} ms p95 ${r(s?.intervalP95)} ms; CPU work per frame p50 ${r(s?.workP50)} ms p95 ${r(s?.workP95)} ms`,
  );
  // Loose on purpose: a CI machine with software WebGL is slow. The spike's real target (work p95 under 6 ms) is judged from the logged numbers on Mark's machine.
  expect(s?.frames ?? 0).toBeGreaterThan(60);
  expect(s?.workP95 ?? 999).toBeLessThan(50);
});

test('judge pictures: street line-up, street boss, sewer line-up and an acting state, each at 2x', async ({ page }) => {
  test.skip(!MEDIA, 'set STAGELAB_MEDIA=<folder> to save the judges’ pictures');
  const dir = MEDIA as string;
  mkdirSync(dir, { recursive: true });
  const round = process.env.STAGELAB_ROUND ?? 'r1';
  // 960 x 540 is exactly zoom 2 (the stage at 2x). The pickers are left out (?clean) so the picture is only the stage.
  await page.setViewportSize({ width: 960, height: 540 });
  const shots: Array<[string, string]> = [
    ['street-lineup', '?clean&stage=street&set=3&phase=choose'],
    ['street-boss', '?clean&stage=street&set=boss%2B2&phase=target'],
    ['sewer-lineup', '?clean&stage=sewer&set=3&phase=choose'],
    ['acting', '?clean&stage=street&set=boss&phase=act'],
    ['sewer-acting', '?clean&stage=sewer&set=3&phase=act'],
    ['street-six', '?clean&stage=street&set=6&phase=choose'],
  ];
  for (const [name, query] of shots) {
    const errors = await openLab(page, query);
    expect(errors).toEqual([]);
    await hideStatus(page);
    // Let the idle loops move on a little so the picture is a typical moment.
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(dir, `p2-${round}-${name}-2x.png`) });
  }
});
