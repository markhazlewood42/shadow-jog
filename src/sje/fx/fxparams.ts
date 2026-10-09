/**
 * FxParams: every number that sets the LOOK of the screen effects, in one object (docs/engine/m2-brief.md section 2, point 9: the editor contract).
 *
 * In the old presenter these were constants inside the shaders and the draw code. Here they are uniforms and plain fields, with today's values as the
 * defaults, so a future FX editor (milestone ET) can change one and see it at once: `fx.params.vignetteFalloff = 3`. Nothing here is a Pixi object.
 * `defaultFxParams()` makes a fresh copy; `FxSystem.setParams(partial)` merges.
 *
 * Not in here, on purpose:
 *  - `FX_SLOTS`: how many shockwaves, hazes and glitches the shader holds at once. The shader declares arrays of that size, so it is read-only.
 *  - The hash constants of the glitch noise (12.9898, 78.233, 43758.5453): they make a pattern, not a look.
 *  - The per-effect numbers of a moment (strength, reach, life): those are data (`fx.json`), not parameters.
 *  - The comfort settings (`motion`, `intensity`) and the scene knobs (`bloom`, `vignette` strength): already fields of `FxState`.
 */
import { MAX_GLITCHES, MAX_HAZES, MAX_SHOCKS } from './fxstate';

/** The slot counts the shaders fix. Read-only. */
export const FX_SLOTS = { shocks: MAX_SHOCKS, hazes: MAX_HAZES, glitches: MAX_GLITCHES } as const;

export interface FxParams {
  /** The glow blur: the weights of its five folded taps (center, the near pair, the far pair) and where the pairs sit, in texels. Sigma about 2. */
  blurWeights: [number, number, number];
  blurOffsets: [number, number];
  /** How much of the half-size blur and of the quarter-size blur the composite adds (before `FxState.bloom`). */
  bloomHalf: number;
  bloomQuarter: number;
  /** The stage dim spares what glows: a lit pixel's brightness times this, clamped to 0..1, is how much of the dim it escapes. */
  dimSpareGain: number;
  /** The vignette: darkening = strength * distance-squared-from-center * this. */
  vignetteFalloff: number;
  /** Heat haze: it fades in over `hazeFadeIn` frames and out over the last `hazeFadeOut`. The waver: y wave (spatial, speed), x wave (x, y, speed). */
  hazeFadeIn: number;
  hazeFadeOut: number;
  hazeWaveY: [number, number];
  hazeWaveX: [number, number, number];
  /** Glitch: fade in and out in frames; the slice height in pixels; frames per new pattern; the slide of a slice (pixels per unit of strength) and its bias; the color part; the share of slices that move. */
  glitchFadeIn: number;
  glitchFadeOut: number;
  glitchSliceHeight: number;
  glitchPatternFrames: number;
  glitchSlide: number;
  glitchSlideBias: number;
  glitchSplit: number;
  glitchThreshold: number;
  /** Shockwave shape: the ring reaches out as 1 - (1 - k)^reachEase, its push fades as (1 - k)^pushEase, its width grows from widthStart by k. */
  shockReachEase: number;
  shockPushEase: number;
  shockWidthStart: number;
  /** Most particles alive at once. Read by the `FxSystem` constructor (the simulation and the buffers are sized then): changing it later has no effect. */
  particleCap: number;
}

export function defaultFxParams(): FxParams {
  return {
    blurWeights: [0.227027027, 0.3162162162, 0.0702702703],
    blurOffsets: [1.3846153846, 3.2307692308],
    bloomHalf: 0.9,
    bloomQuarter: 0.8,
    dimSpareGain: 3,
    vignetteFalloff: 2,
    hazeFadeIn: 8,
    hazeFadeOut: 20,
    hazeWaveY: [0.45, 0.21],
    hazeWaveX: [0.3, 0.2, 0.33],
    glitchFadeIn: 2,
    glitchFadeOut: 6,
    glitchSliceHeight: 3,
    glitchPatternFrames: 4,
    glitchSlide: 4,
    glitchSlideBias: 0.75,
    glitchSplit: 0.35,
    glitchThreshold: 0.5,
    shockReachEase: 2,
    shockPushEase: 1.5,
    shockWidthStart: 0.6,
    particleCap: 4096,
  };
}
