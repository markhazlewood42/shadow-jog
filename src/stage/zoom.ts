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

/** What the editor's status line says about the zoom: a short text, a longer explanation for its tooltip, and a hint when the stage is only 1x and hiding the left panel would reach 2x. */
export interface ZoomLine {
  text: string;
  title: string;
  /** Set when the left panel is open, the stage is 1x and hiding the panel would reach 2x or more: the sentence to show, e.g. "Press P to hide the left panel: the stage then fits at 2x." */
  hint: string | null;
}

/**
 * The words for the zoom readout. `k` is the whole number of DEVICE pixels per game pixel the stage is drawn at;
 * `kWithoutLeft` is what it would be with the left panel hidden. On a 100% display `k` is also the zoom in page (CSS)
 * pixels. On a 125% or 150% display one page pixel is more than one device pixel, so the stage is still a whole number
 * of screen pixels per game pixel (the part that matters for crisp pixel art) while its size in page pixels is a
 * fraction, and the tooltip says so.
 */
export function zoomLine(k: number, dpr: number, kWithoutLeft: number, leftOpen: boolean): ZoomLine {
  const css = k / dpr;
  const inPage = Math.abs(css - Math.round(css)) < 1e-9 ? `${Math.round(css)}x` : `${Number(css.toFixed(2))}x`;
  const title = dpr === 1 ? `The stage is drawn at ${k}x: every game pixel is ${k} by ${k} screen pixels.` : `The stage is drawn at ${k}x: every game pixel is exactly ${k} by ${k} screen pixels (${inPage} in page pixels on this ${Math.round(dpr * 100)}% display). A whole number of screen pixels keeps the pixel art sharp.`;
  // Only for the cramped case: the stage is at 1x and hiding the panel reaches 2x or more. A bigger screen does not need the nudge.
  const hint = leftOpen && k < 2 && kWithoutLeft >= 2 ? `Press P to hide the left panel: the stage then fits at ${kWithoutLeft}x.` : null;
  return { text: `Zoom ${k}x`, title, hint };
}
