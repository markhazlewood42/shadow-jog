/**
 * The hit effects of the "acting" state as pixel pictures (spike `spike/phaser-stage`), ported from the design's
 * mockup script: a sword cut (a cyan edge with a white core), a palm strike (a burst ring with radial streaks)
 * and the attacker's dashed path. Pure, no Phaser: each function paints into a `Raw` the size of the screen.
 *
 * These are STAND-INS for the real effects. The battle test (a later step) plays Rook's strike from Mark's
 * Sprite Fusion frames with its own smear art; what matters here is that the stage can show an effect layer
 * that sorts with the attacker (as part of its figure: body, weapon, smear and shadow are one unit).
 * Everything is whole pixels with no anti-aliasing: a disc is "every pixel within r of the centre".
 */
import { hexRgb, newRaw, type Raw, type RGB, setRgb, th } from './pixels';

export const SLASH_CYAN = '#3fe0f0';
export const SLASH_AMBER = '#ffcc3d';
export const SLASH_PINK = '#ff4fb0';

export interface Vec {
  x: number;
  y: number;
}

/** A transparent picture the size of the screen to paint effects into. */
export function newFxLayer(w: number, h: number): Raw {
  return newRaw(w, h);
}

/** A filled square of pixels. */
function box(img: Raw, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setRgb(img, x + i, y + j, c);
}

/**
 * One sweep of a blade: a curved stroke from `p0` to `p1` that swells in the middle (a sine), with a cyan edge
 * and a thinner white core. `arc` bends the path sideways by that many pixels at its middle.
 */
export function drawCut(img: Raw, p0: Vec, p1: Vec, width: number, arc: Vec): void {
  for (const [col, shrink] of [[hexRgb(SLASH_CYAN), 0], [[255, 255, 255] as RGB, 1.5]] as const) {
    const n = Math.floor(Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)) * 2);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = p0.x + (p1.x - p0.x) * t + Math.sin(Math.PI * t) * arc.x;
      const y = p0.y + (p1.y - p0.y) * t + Math.sin(Math.PI * t) * arc.y;
      const r = (width - shrink) * Math.sin(Math.PI * t) ** 0.8;
      const rr = shrink === 0 ? (r + 1.2) ** 2 : Math.max(0.3, r) ** 2;
      const reach = Math.trunc(r);
      for (let dx = -reach - 2; dx < reach + 3; dx++)
        for (let dy = -reach - 2; dy < reach + 3; dy++) if (dx * dx + dy * dy <= rr) setRgb(img, Math.round(x) + dx, Math.round(y) + dy, col);
    }
  }
}

/** The spray of sparks around a cut: small coloured squares at fixed offsets from the target's middle. */
export function drawSparks(img: Raw, cx: number, cy: number): void {
  const sparks: Array<[number, number, string]> = [
    [30, 18, '#ffffff'],
    [34, 8, SLASH_AMBER],
    [24, 26, SLASH_PINK],
    [-22, -20, SLASH_AMBER],
    [20, 30, SLASH_CYAN],
  ];
  for (const [dx, dy, c] of sparks) box(img, cx + dx, cy + dy, 2, 2, hexRgb(c));
}

/** Kit's palm strike: a mana-blue burst ring, two white rings inside it, radial streaks and a white core. */
export function drawPalm(img: Raw, cx: number, cy: number): void {
  const rad = Math.PI / 180;
  for (const [r, col] of [[15, SLASH_CYAN], [10, '#ffffff'], [5, '#ffffff']] as const) {
    for (let k = 0; k < 360; k += 4) {
      if (r === 15 && Math.floor(k / 4) % 3 === 2) continue;
      setRgb(img, cx + Math.round(Math.cos(k * rad) * r), cy + Math.round(Math.sin(k * rad) * r * 0.8), hexRgb(col));
    }
  }
  for (let k = 0; k < 360; k += 30)
    for (let d = 18; d < 26; d++) if (d % 3 !== 2) setRgb(img, cx + Math.round(Math.cos((k + 15) * rad) * d), cy + Math.round(Math.sin((k + 15) * rad) * d * 0.8), hexRgb(SLASH_CYAN));
  box(img, cx - 2, cy - 2, 5, 5, [255, 255, 255]);
}

/** The attacker's faint dashed path from where it started to where it struck (one pixel under the feet, two on and two off). */
export function drawPath(img: Raw, from: Vec, to: Vec): void {
  const steps = 80;
  const c = hexRgb(SLASH_CYAN);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (i % 4 < 2 && t > 0.06 && t < 0.85) {
      const x = Math.round(from.x + (to.x - from.x) * t);
      const y = Math.round(from.y + (to.y - from.y) * t) + 1;
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      // 85% strength over what is below: write the colour at that alpha so it blends on the stage.
      img.px.set([c[0], c[1], c[2], Math.round(0.85 * 255)], (y * img.w + x) * 4);
    }
  }
}

// ------------------------------------------------------------------ hit effects for the live battle (Battle Test)

/** Mirror a picture left to right (a hit that comes from the right-hand side). */
export function flipRaw(r: Raw): Raw {
  const out = newRaw(r.w, r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) out.px.set(r.px.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4), (y * r.w + (r.w - 1 - x)) * 4);
  return out;
}

/**
 * A solid, dithered disc of radius `r` in `color`: every pixel inside 55% of the radius is on, and between 55% and 100%
 * a pixel is on when the 4x4 Bayer pattern says so. The stage draws it with ADDITIVE blending (the pixels add their
 * colour to what is behind), which makes it a glow, and swaps between a few sizes to make it swell and shrink: whole
 * pixels only, never a smooth fade. The picture is (2r+1) square and its middle pixel is the centre.
 */
export function glowRaw(r: number, color: string): Raw {
  const s = 2 * r + 1;
  const out = newRaw(s, s);
  const c = hexRgb(color);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - r, y - r) / (r + 0.5);
      if (d > 1) continue;
      const edge = d <= 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
      if (edge >= 1 || edge > th(x, y)) setRgb(out, x, y, c);
    }
  return out;
}

/** A hit star: four rays and four short diagonals around a white core, `r` pixels out. Centre = the middle pixel. */
export function starRaw(r: number, color: string): Raw {
  const s = 2 * r + 1;
  const out = newRaw(s, s);
  const c = hexRgb(color);
  for (let i = 1; i <= r; i++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) setRgb(out, r + dx * i, r + dy * i, i <= 2 ? [255, 255, 255] : c);
    if (i <= Math.ceil(r * 0.6))
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) setRgb(out, r + dx * i, r + dy * i, c);
  }
  box(out, r - 1, r - 1, 3, 3, [255, 255, 255]);
  return out;
}

/** The size of the slash picture. */
export const SLASH_W = 96;
export const SLASH_H = 72;

/**
 * The sword-cut hit picture grown to `t` (0 to 1) of its length: two crossing strokes in the cut colours, centred in
 * a 96x72 picture. At `t` 1 the little sparks are added. A hit that comes from the right passes `flip`.
 */
export function slashRaw(t: number, flip: boolean): Raw {
  const out = newRaw(SLASH_W, SLASH_H);
  const cx = SLASH_W / 2;
  const cy = SLASH_H / 2;
  const grow = (x0: number, y0: number, x1: number, y1: number): Vec => ({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  drawCut(out, { x: cx - 32, y: cy - 24 }, grow(cx - 32, cy - 24, cx + 28, cy + 24), 4.0 * Math.max(0.5, t), { x: 6 * t, y: -8 * t });
  drawCut(out, { x: cx - 22, y: cy - 28 }, grow(cx - 22, cy - 28, cx + 32, cy + 6), 2.4 * Math.max(0.5, t), { x: 4 * t, y: -6 * t });
  if (t >= 1) drawSparks(out, cx, cy);
  return flip ? flipRaw(out) : out;
}

/** The palm-strike hit picture (a ring burst), centred in a 64x56 picture. */
export function blowRaw(): Raw {
  const out = newRaw(64, 56);
  drawPalm(out, 32, 28);
  return out;
}
