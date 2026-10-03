/**
 * Picking the picture's zoom so every game pixel is the same whole number of SCREEN pixels
 * (Phaser spike, `spike/phaser-stage`).
 *
 * The page works in CSS pixels, but the monitor has physical (device) pixels, and on a Windows display
 * set to 125% one CSS pixel is 1.25 device pixels. A canvas zoomed "2x" in CSS pixels is then 2.5 device
 * pixels per game pixel: some game pixels get 2 device pixels and some 3, and that uneven shimmer is
 * exactly what pixel art must not have. The fix is to count in DEVICE pixels: choose a whole number `k`
 * of device pixels per game pixel, then ask the page for the CSS size that makes it so (`k / dpr`).
 * The game's own `src/engine/display.ts` does the same thing for the same reason.
 *
 * Pure maths (no Phaser, no DOM) so a test can try 100%, 125%, 150% and 200% displays.
 */

/**
 * The biggest whole number of device pixels per game pixel that fits `parentW x parentH` CSS pixels at
 * this `dpr` (device pixels per CSS pixel), never less than 1.
 */
export function devicePixelsPerGamePixel(parentW: number, parentH: number, gameW: number, gameH: number, dpr: number): number {
  const fit = Math.min(parentW / gameW, parentH / gameH) * dpr;
  // The tiny nudge forgives float error, so an exact fit (1152 px at dpr 1.25 over 480 is 3) never comes out as 2.9999999.
  return Math.max(1, Math.floor(fit + 1e-9));
}

/** The CSS zoom to give the page: `k` device pixels per game pixel, expressed in CSS pixels. At dpr 1 this is the whole number `k` itself. */
export function cssZoom(k: number, dpr: number): number {
  return k / dpr;
}
