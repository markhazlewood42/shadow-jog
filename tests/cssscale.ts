/**
 * The scale rule of the old display, kept as a reference model for two tests (M8d).
 *
 * Until M8d the old display file of `src/engine` held `cssScaleFor`, the rule of the display with two modes. Mark dropped the fill mode on 2026-10-09: the shipped display (`src/sje/runtime/display.ts`) has
 * the integer mode only, so no game code calls this any more. The rule moved here because two tests still use it: `tests/display.test.ts` pins its table of window sizes (docs/PIVOT-640.md,
 * D14 and PL7), and `tests/sje-display.test.ts` uses the old fill rule as the negative control for the integer rule.
 *
 * Every source pixel stays the same size: the picture is scaled up by a whole number of device pixels, and fill mode snaps to a whole multiple whenever one fills at least 90% of the
 * window, so the common sizes (720p and the Deck's 1280x800 window at 2x, 1080p at 3x, 1440p at 4x, 4K at 6x) are pixel-exact by default.
 */
import { H, W } from '../src/sje/core/size';

export type ScaleMode = 'fit' | 'integer';

/**
 * How many CSS pixels one game pixel takes, for a stage of vw by vh CSS pixels on a screen with
 * `dpr` device pixels per CSS pixel. The rule, in two steps:
 *
 * 1. `fit` is the largest scale that still shows the whole frame. `whole` is the largest scale at
 *    or below it that is a whole number of DEVICE pixels per game pixel (at a dpr of 1, a whole
 *    number: 2, 3, 4).
 * 2. Pixel-perfect mode ('integer') always uses `whole`. Fill mode ('fit') uses `whole` only when
 *    it fills at least 90% of `fit`, so a window that is a little off a whole multiple still gets
 *    exact pixels, and one far off (1536x864, a 2.4 fit) is resampled slightly instead of showing
 *    thick black bars. A stage smaller than the frame (a fit under 1) is never snapped.
 */
export function cssScaleFor(vw: number, vh: number, dpr: number, mode: ScaleMode): number {
  const fit = Math.min(vw / W, vh / H);
  const whole = Math.floor(fit * dpr) / dpr;
  if (fit >= 1 && (mode === 'integer' || whole >= fit * 0.9)) return whole;
  return fit;
}
