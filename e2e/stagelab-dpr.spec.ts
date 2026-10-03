/**
 * The Phaser stage lab on displays whose scaling is not 100% (spike `spike/phaser-stage`).
 *
 * On a Windows display set to 125%, one CSS pixel is 1.25 device pixels. A canvas "zoomed 2x" in CSS pixels
 * is then 2.5 device pixels per game pixel, so some game pixels are drawn 2 device pixels wide and some 3:
 * the uneven shimmer pixel art must not have. The lab counts in DEVICE pixels instead (`src/stage/zoom.ts`,
 * `boot.ts`), and these tests check the screenshot, which Playwright takes in device pixels: every game
 * pixel must be an exact k x k block of one colour, and the canvas must start on a device pixel.
 */
import { expect, test } from '@playwright/test';
import { hideStatus, openLab } from './stagelabkit';

/** Cut the canvas out of a device-pixel screenshot and count the k x k blocks that are not one flat colour. */
async function mixedBlocks(page: import('@playwright/test').Page, k: number, dpr: number): Promise<{ blocks: number; mixed: number; mixedInside: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  // Layout positions are in CSS pixels; the screenshot is in device pixels.
  const left = Math.round(box.x * dpr);
  const top = Math.round(box.y * dpr);
  const png = await page.screenshot();
  const result = await page.evaluate(
    async ({ b64, left, top, k }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) throw new Error('no 2d canvas');
      g.drawImage(img, 0, 0);
      const w = 480 * k;
      const h = 270 * k;
      const px = g.getImageData(left, top, w, h).data;
      let blocks = 0;
      let mixed = 0;
      let mixedInside = 0; // mixed blocks that are NOT in the last column or last row of game pixels
      for (let by = 0; by < h; by += k) {
        for (let bx = 0; bx < w; bx += k) {
          blocks++;
          const first = (by * w + bx) * 4;
          let same = true;
          for (let y = 0; y < k && same; y++) {
            for (let x = 0; x < k && same; x++) {
              const i = ((by + y) * w + bx + x) * 4;
              if (px[i] !== px[first] || px[i + 1] !== px[first + 1] || px[i + 2] !== px[first + 2]) same = false;
            }
          }
          if (!same) {
            mixed++;
            if (bx < w - k && by < h - k) mixedInside++;
          }
        }
      }
      return { blocks, mixed, mixedInside };
    },
    { b64: png.toString('base64'), left, top, k },
  );
  return result;
}

// [device pixel ratio, window (CSS pixels), expected whole device pixels per game pixel]. In all of these the canvas size is a
// whole number of CSS pixels, so every block must be exact.
const CASES: Array<[number, number, number, number]> = [
  [1.25, 960, 540, 2], // 1200x675 device pixels: k 2 (the plain CSS zoom 2 would have been 2.5)
  [1.25, 1003, 601, 2], // an odd size, so centring would land between device pixels if it were done in CSS pixels
  [1.5, 1001, 601, 3],
  [2, 1000, 600, 4],
  [2.5, 1000, 600, 5],
];

for (const [dpr, width, height, k] of CASES) {
  test.describe(`display scaling ${Math.round(dpr * 100)}%, window ${width}x${height}`, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width, height } });

    test(`every game pixel is exactly ${k} x ${k} device pixels, and the canvas starts on a device pixel`, async ({ page }) => {
      const errors = await openLab(page);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
      expect(await page.evaluate(() => window.__stagelab?.devicePixelsPerPixel)).toBe(k);
      // The CSS size times the ratio is a whole number of device pixels, and so is the canvas's position.
      const box = await page.locator('canvas').boundingBox();
      expect(box).not.toBeNull();
      expect((box?.width ?? 0) * dpr).toBeCloseTo(480 * k, 1);
      expect((box?.height ?? 0) * dpr).toBeCloseTo(270 * k, 1);
      expect(((box?.x ?? 0) * dpr) % 1 < 0.02 || ((box?.x ?? 0) * dpr) % 1 > 0.98).toBe(true);
      expect(((box?.y ?? 0) * dpr) % 1 < 0.02 || ((box?.y ?? 0) * dpr) % 1 > 0.98).toBe(true);
      await hideStatus(page);
      // Let the heroes bounce and the enemies sway: movement is where half-pixels would show.
      await page.waitForTimeout(700);
      const r = await mixedBlocks(page, k, dpr);
      expect(r.blocks).toBe(480 * 270);
      expect(r.mixed).toBe(0);
    });
  });
}

test.describe('the fit follows the window and the pixel ratio', () => {
  test.use({ deviceScaleFactor: 1.25, viewport: { width: 960, height: 540 } });

  test('resizing re-fits to the next whole number of device pixels', async ({ page }) => {
    const errors = await openLab(page);
    expect(await page.evaluate(() => window.__stagelab?.devicePixelsPerPixel)).toBe(2);
    await page.setViewportSize({ width: 1500, height: 900 }); // 1875x1125 device pixels: k 3
    await page.waitForFunction(() => window.__stagelab?.devicePixelsPerPixel === 3);
    const box = await page.locator('canvas').boundingBox();
    expect((box?.width ?? 0) * 1.25).toBeCloseTo(480 * 3, 1);
    expect(errors).toEqual([]);
  });
});

// A ratio such as 1.75 (Windows "175%") makes the canvas size a fraction the browser cannot store exactly (see boot.ts): the
// inside of the picture is still perfectly even, and at most the last column and row of game pixels is one device pixel off.
test.describe('display scaling 175%, window 1100x700 (the known limit)', () => {
  test.use({ deviceScaleFactor: 1.75, viewport: { width: 1100, height: 700 } });

  test('the picture is even everywhere except, at worst, its last column and row', async ({ page }) => {
    const errors = await openLab(page);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__stagelab?.devicePixelsPerPixel)).toBe(4);
    await hideStatus(page);
    await page.waitForTimeout(500);
    const r = await mixedBlocks(page, 4, 1.75);
    expect(r.mixedInside).toBe(0);
    expect(r.mixed).toBeLessThanOrEqual(480 + 270);
  });
});
