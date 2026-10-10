/**
 * The scale rule of the display, and the shape of what `src/boot.ts` and the dev routes call on it.
 *
 * Until M6 this file held the class that presented the 640x360 back buffer on the page: a 2D canvas, and a WebGL presenter over it for GPU effects. M6 removed both (the
 * presenter, the `#fx` canvas, the back buffer). The new engine does the drawing and the scaling (`src/sje/display/display.ts`); `src/sje/boot.ts` hands the game's boot a small adapter
 * in the shape of the `Display` interface below. M8 deletes this file with the rest of `src/engine`; until then it keeps the rule that a unit test pins (`cssScaleFor`) and the
 * interface that the game's boot is typed against.
 *
 * Every source pixel stays the same size: the picture is scaled up by a whole number of device pixels, and fill mode snaps to a whole multiple whenever one fills at least 90% of the
 * window, so the common sizes (720p and the Deck's 1280x800 window at 2x, 1080p at 3x, 1440p at 4x, 4K at 6x) are pixel-exact by default.
 */
import { H, W } from '../sje/core/size';

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

/** What the game's boot (`src/boot.ts`) and the dev routes call on the display. The new engine's adapter (`src/sje/boot.ts`) is the one implementation. */
export interface Display {
  mode: ScaleMode;
  /** Fit the picture to the window again. */
  resize(): void;
  /** Turn GPU effects on or off. Returns whether they are on (they stay off on a level of `none`). */
  setGpu(on: boolean): boolean;
  /** The effects level that is drawn now: `lite` is what `auto` picks on software graphics. */
  readonly fxLevel: 'full' | 'lite' | 'none';
  /** Convert a page-space point to game coordinates (0..W, 0..H). */
  toGame(clientX: number, clientY: number): { x: number; y: number };
  /** The canvas the player sees (it takes the pointer events). */
  readonly element: HTMLCanvasElement;
}
