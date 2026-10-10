/**
 * The battle's push camera (M3 decision 3): on a big hit the picture leans in toward the target for a few frames and eases back out. Pure numbers, no engine:
 * the scene (`stagescene.ts`) applies them to its world layer, and a test can check them.
 *
 * The values are the legacy battle's (`src/scenes/battle.ts` sets `push = { x, y, t: 0, life: 20 }`, `src/scenes/battlekit/render.ts` has the curve): a ramp
 * of 4 frames up, an ease down over the other 16, and a zoom of up to 1.09x. Mark decided to keep the 1.09x push (decision 3): at 1.09x the texels are uneven
 * (99 pixels on a GPU, 128 on SwiftShader, scene-graph.md section 7), which he judges from the pictures. They are a record of the old look, so they stay in this
 * file and in `LEGACY_PUSH` for now. The stage JSONs of the 480x270 layout cannot carry them (principle 8: the files stay byte for byte); the 640x360 set of task 9
 * can hold them as stage data.
 */

export interface PushSpec {
  /** The largest extra zoom: 0.09 is 1.09x. */
  zoom: number;
  /** Frames to reach the largest push. */
  rampFrames: number;
  /** Frames in all, ramp and ease back together. */
  lifeFrames: number;
}

/** The push of the legacy battle. */
export const LEGACY_PUSH: PushSpec = { zoom: 0.09, rampFrames: 4, lifeFrames: 20 };

/** How far into the push (0 to 1) at frame `t`: up in `rampFrames`, then down to 0 at `lifeFrames`. Outside the push it is 0. */
export function pushStrength(t: number, spec: PushSpec = LEGACY_PUSH): number {
  if (t < 0 || t >= spec.lifeFrames) return 0;
  return t < spec.rampFrames ? t / spec.rampFrames : 1 - (t - spec.rampFrames) / (spec.lifeFrames - spec.rampFrames);
}

/** The zoom at frame `t`: 1 at rest, up to `1 + spec.zoom` (the legacy curve squares the strength). */
export function pushZoom(t: number, spec: PushSpec = LEGACY_PUSH): number {
  const k = pushStrength(t, spec);
  return 1 + spec.zoom * k * k;
}

export interface PushView {
  /** The zoom. */
  zoom: number;
  /** The top left of the part of the picture that fills the screen, in the picture's own pixels. */
  x: number;
  y: number;
  /** Where the picture's origin goes on the screen so that part fills it: the world container's position. */
  offsetX: number;
  offsetY: number;
}

/**
 * The part of a `w` x `h` picture the screen shows at zoom `zoom` when the camera leans toward `focus`: the window is `w / zoom` wide, centered on the focus and
 * kept inside the picture. The container that holds the picture is then scaled by `zoom` and put at (`offsetX`, `offsetY`).
 */
export function pushView(focus: { x: number; y: number }, zoom: number, w: number, h: number): PushView {
  const sw = w / zoom;
  const sh = h / zoom;
  const x = Math.max(0, Math.min(w - sw, focus.x - sw / 2));
  const y = Math.max(0, Math.min(h - sh, focus.y - sh / 2));
  return { zoom, x, y, offsetX: -x * zoom, offsetY: -y * zoom };
}
