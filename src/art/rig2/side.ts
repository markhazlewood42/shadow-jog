/**
 * Side-view battle sprites (spike, `spike/side-battle`): a crew member seen from the side, small.
 * Two sizes are under test: FIELD scale (the traced field frame, ~30 px tall) and BATTLE scale
 * (the traced 8-direction view, shrunk to ~46 px).
 *
 * The question this file answers is whether the near arm can be posed without the pixel repaint
 * loop the back view needs. In a side view the near arm hangs in front of the torso, so:
 *   1. the arm is cut out by GEOMETRY (a capsule round its bone), not by colour, because Rook's
 *      coat sleeve is the same green as his torso;
 *   2. the torso behind it is filled in once, flat;
 *   3. the arm is then turned about the shoulder (RotSprite) or REPLACED by a code-drawn limb;
 *   4. the whole pose is outlined afterwards, as the field rig does.
 * Nothing here is used by the shipped game; the dev lab (`src/dev/sidelab.ts`) shows it.
 */
import { band, katana, nearest, solveArm } from './battle';
import { type Layer, decode, rotSprite, type Traced } from './rig';

export type Pt = readonly [number, number];

const hexRgb = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (c: string): number => {
  const [r, g, b] = hexRgb(c);
  return 0.3 * r + 0.59 * g + 0.11 * b;
};

/** How a traced frame is shrunk: average then snap to the palette, the pixel at the centre, or the commonest colour. */
export type ShrinkMode = 'area' | 'nearest' | 'mode';

const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A traced frame shrunk by `k` (< 1), on its own palette. `feet` and `hip` scale with it. */
export function shrink(t: Traced, k: number, mode: ShrinkMode): Traced {
  const w = Math.max(1, Math.round(t.w * k));
  const h = Math.max(1, Math.round(t.h * k));
  const rgb = t.pal.map(hexRgb);
  const src = decode(t).px;
  const out: string[] = [];
  for (let ty = 0; ty < h; ty++) {
    let row = '';
    for (let tx = 0; tx < w; tx++) {
      // The source rectangle this pixel covers.
      const x0 = tx / k;
      const x1 = (tx + 1) / k;
      const y0 = ty / k;
      const y1 = (ty + 1) / k;
      let total = 0;
      let solid = 0;
      const sum = [0, 0, 0];
      const votes = new Map<number, number>();
      for (let sy = Math.floor(y0); sy < Math.min(t.h, Math.ceil(y1)); sy++)
        for (let sx = Math.floor(x0); sx < Math.min(t.w, Math.ceil(x1)); sx++) {
          const ov = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
          if (ov <= 0) continue;
          total += ov;
          const p = src[sy * t.w + sx] ?? -1;
          if (p < 0) continue;
          solid += ov;
          const c = rgb[p] ?? [0, 0, 0];
          sum[0] = (sum[0] ?? 0) + c[0] * ov;
          sum[1] = (sum[1] ?? 0) + c[1] * ov;
          sum[2] = (sum[2] ?? 0) + c[2] * ov;
          votes.set(p, (votes.get(p) ?? 0) + ov);
        }
      let p = -1;
      if (mode === 'nearest') {
        const sx = Math.min(t.w - 1, Math.floor((tx + 0.5) / k));
        const sy = Math.min(t.h - 1, Math.floor((ty + 0.5) / k));
        p = src[sy * t.w + sx] ?? -1;
      } else if (total > 0 && solid / total >= 0.5) {
        if (mode === 'mode') p = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
        else {
          const avg = [sum[0] ?? 0, sum[1] ?? 0, sum[2] ?? 0].map((v) => v / solid);
          let bd = Infinity;
          rgb.forEach((c, i) => {
            const d = (c[0] - (avg[0] ?? 0)) ** 2 + (c[1] - (avg[1] ?? 0)) ** 2 + (c[2] - (avg[2] ?? 0)) ** 2;
            if (d < bd) {
              bd = d;
              p = i;
            }
          });
        }
      }
      row += p < 0 ? '.' : (CH[p] ?? '.');
    }
    out.push(row);
  }
  return { ...t, w, h, feet: Math.round(t.feet * k), hip: Math.round(t.hip * k), rows: out };
}

/**
 * Take off the outer outline the art came with: dark pixels touching the outside, one pass. The
 * renderer outlines the finished pose itself, so a baked one would double it.
 */
export function stripOutline(l: Layer, pal: string[], maxLum = 34): Layer {
  const px = l.px.slice();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? -1 : (l.px[y * l.w + x] ?? -1));
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) {
      const p = at(x, y);
      if (p < 0 || lum(pal[p] ?? '#000000') > maxLum) continue;
      if (at(x - 1, y) < 0 || at(x + 1, y) < 0 || at(x, y - 1) < 0 || at(x, y + 1) < 0) px[y * l.w + x] = -1;
    }
  return { ...l, px };
}

/** Where the near arm is on a frame: the bone's two ends, how wide the capsule round it is, and a pixel of sleeve and of fist. */
export interface SideArm {
  shoulder: Pt;
  hand: Pt;
  /** Radius of the capsule that takes the arm's pixels. */
  r: number;
  /** A pixel in the sleeve and a pixel in the fist (for their colours). */
  sleeve: Pt;
  skin: Pt;
}

/** The same arm on a frame shrunk by `k`. */
export const scaleArm = (a: SideArm, k: number): SideArm => ({
  shoulder: [a.shoulder[0] * k, a.shoulder[1] * k],
  hand: [a.hand[0] * k, a.hand[1] * k],
  r: a.r * k,
  sleeve: [Math.floor(a.sleeve[0] * k), Math.floor(a.sleeve[1] * k)],
  skin: [Math.floor(a.skin[0] * k), Math.floor(a.skin[1] * k)],
});

const idx = (l: Layer, x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? -1 : (l.px[y * l.w + x] ?? -1));

/** Distance from a point to the segment a-b. */
function toSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export interface Separated {
  /** The body with the arm gone and the torso behind it filled in. */
  body: Layer;
  /** The arm's own pixels, in place (the same size and origin as the body). */
  arm: Layer;
  /** The pixels of the arm that the fill covered (the gap), for showing. */
  gap: Layer;
  sleeveCol: number;
  skinCol: number;
}

/**
 * Cut the near arm out of a frame and fill the torso behind it. The arm is every pixel within `r`
 * of the bone. The fill is the torso's commonest colour next to the gap, on rows where the body
 * continues on both sides of it (so an arm that hangs past the body's edge leaves that edge bare).
 */
export function separateArm(base: Layer, a: SideArm, pal: string[]): Separated {
  const arm: Layer = { ...base, px: new Int16Array(base.px.length).fill(-1) };
  const body: Layer = { ...base, px: base.px.slice() };
  const gap: Layer = { ...base, px: new Int16Array(base.px.length).fill(-1) };
  const taken: boolean[] = new Array(base.w * base.h).fill(false);
  const skinAt = idx(base, Math.floor(a.skin[0]), Math.floor(a.skin[1]));
  for (let y = 0; y < base.h; y++)
    for (let x = 0; x < base.w; x++) {
      const p = base.px[y * base.w + x] ?? -1;
      if (p < 0) continue;
      if (toSeg([x + 0.5, y + 0.5], a.shoulder, a.hand) <= a.r && !(p === skinAt && y < a.shoulder[1] + 3) && !(lum(pal[p] ?? '#fff') <= 34 && Math.hypot(x + 0.5 - a.shoulder[0], y + 0.5 - a.shoulder[1]) < a.r * 1.1 && y < a.shoulder[1] + 1.5)) {
        arm.px[y * base.w + x] = p;
        body.px[y * base.w + x] = -1;
        taken[y * base.w + x] = true;
      }
    }
  const sleeveCol = idx(base, Math.floor(a.sleeve[0]), Math.floor(a.sleeve[1]));
  const skinCol = idx(base, Math.floor(a.skin[0]), Math.floor(a.skin[1]));
  // The torso colour: what surrounds the gap most, ignoring skin and the very dark.
  const votes = new Map<number, number>();
  for (let y = 0; y < base.h; y++)
    for (let x = 0; x < base.w; x++) {
      if (!taken[y * base.w + x]) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const q = idx(body, x + dx, y + dy);
          if (q >= 0) votes.set(q, (votes.get(q) ?? 0) + 1);
        }
    }
  votes.delete(skinCol);
  const fill = sleeveCol >= 0 && !votes.has(sleeveCol) ? sleeveCol : ([...votes.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? sleeveCol);
  for (let y = 0; y < base.h; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < base.w; x++) if (body.px[y * base.w + x] !== -1) {
      if (left < 0) left = x;
      right = x;
    }
    for (let x = 0; x < base.w; x++) {
      if (!taken[y * base.w + x]) continue;
      if (left >= 0 && x > left && x < right) {
        body.px[y * base.w + x] = fill;
        gap.px[y * base.w + x] = fill;
      }
    }
  }
  // Dark seam bits of the old sleeve left beside the gap (inside the silhouette) are part of the arm's outline: fill them too.
  const hole = (x: number, y: number) => gap.px[y * base.w + x] !== -1;
  for (let y = 0; y < base.h; y++)
    for (let x = 0; x < base.w; x++) {
      const p = body.px[y * base.w + x] ?? -1;
      if (p < 0 || lum(pal[p] ?? '#fff') > 34 || p === fill) continue;
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < base.w && y + dy < base.h && hole(x + dx, y + dy)) near = true;
      const edge = idx(body, x - 1, y) < 0 || idx(body, x + 1, y) < 0 || idx(body, x, y - 1) < 0 || idx(body, x, y + 1) < 0;
      if (near && !edge) {
        body.px[y * base.w + x] = fill;
        gap.px[y * base.w + x] = fill;
      }
    }
  return { body, arm, gap, sleeveCol, skinCol };
}

/**
 * Where a point goes when RotSprite turns a part by `deg` about `pivot`. (Positive turns the lower
 * end toward -x: toward the enemy for a character facing left.)
 */
export function turn(p: Pt, pivot: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const dx = p[0] - pivot[0];
  const dy = p[1] - pivot[1];
  return [pivot[0] + dx * Math.cos(r) - dy * Math.sin(r), pivot[1] + dx * Math.sin(r) + dy * Math.cos(r)];
}

export interface Pose {
  name: string;
  /** Turn of the arm about the shoulder, from hanging (degrees). */
  deg: number;
  /** The katana's angle (0 = right, -90 = up) when it is held. */
  blade: number;
  /** How much longer the arm is drawn (a short chibi arm can't reach overhead past a big head). */
  reach: number;
}

/** The three poses of the arm test, for a character facing left: raised overhead, thrust forward, low follow-through. */
export const POSES: Pose[] = [
  { name: 'raised overhead', deg: 178, blade: -40, reach: 1.3 },
  { name: 'forward at shoulder', deg: 92, blade: 176, reach: 1.1 },
  { name: 'low follow-through', deg: 40, blade: 128, reach: 1.1 },
];

/** (i) The arm's own pixels, turned about the shoulder (RotSprite). The hand's new place comes with it. */
export function rotatedArm(s: Separated, a: SideArm, deg: number, reach = 1): { layers: Layer[]; hand: Pt } {
  const hand = turn(a.hand, a.shoulder, deg);
  return { layers: [rotSprite(s.arm, deg, a.shoulder[0], a.shoulder[1], reach)], hand: [a.shoulder[0] + (hand[0] - a.shoulder[0]) * reach, a.shoulder[1] + (hand[1] - a.shoulder[1]) * reach] };
}

/** Shrink or grow a fist: a filled disc of the skin colour. */
function disc(c: Pt, r: number, col: number): Layer {
  const x0 = Math.floor(c[0] - r - 1);
  const y0 = Math.floor(c[1] - r - 1);
  const n = Math.ceil(2 * r + 3);
  const px = new Int16Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.hypot(x0 + x + 0.5 - c[0], y0 + y + 0.5 - c[1]) <= r) px[y * n + x] = col;
  return { w: n, h: n, ox: x0, oy: y0, px };
}

/**
 * (ii) A code-drawn limb in place of the arm: two bands (upper arm, forearm) in the sleeve's colour
 * with a darker shade, an elbow from two-bone IK that bends down and back, and a fist. It reaches
 * the same hand place as the turned arm, so the two can be compared.
 */
export function drawnArm(s: Separated, a: SideArm, pal: string[], deg: number, width: number, fist: number, reach = 1): { layers: Layer[]; hand: Pt } {
  const h0 = turn(a.hand, a.shoulder, deg);
  const hand: Pt = [a.shoulder[0] + (h0[0] - a.shoulder[0]) * reach, a.shoulder[1] + (h0[1] - a.shoulder[1]) * reach];
  const len = Math.hypot(a.hand[0] - a.shoulder[0], a.hand[1] - a.shoulder[1]) * reach;
  const upper = len * 0.58;
  const fore = len * 0.58;
  // The elbow bends down: of the two answers, the lower one.
  const up = solveArm(a.shoulder, upper, fore, hand, 1);
  const dn = solveArm(a.shoulder, upper, fore, hand, -1);
  const { elbow } = up.elbow[1] > dn.elbow[1] ? up : dn;
  const lit = s.sleeveCol;
  const shade = nearest(pal, shadeHex(pal[lit] ?? '#444444'));
  const layers = [band(a.shoulder, elbow, width, lit, shade, true), band(elbow, hand, width - 0.5, lit, shade, true), disc(hand, fist, s.skinCol)];
  return { layers, hand };
}

function shadeHex(c: string): string {
  const [r, g, b] = hexRgb(c);
  const h = (v: number) => Math.round(v * 0.72).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export interface Dims {
  pommel: number;
  guard: number;
  tip: number;
  thin?: boolean;
}

/**
 * The katana held in two hands: the near fist's place, the blade's angle, and a second fist
 * `grip` pixels behind it along the grip (the far hand, darker, with its sleeve running back to
 * the shoulder behind the body).
 */
export function heldKatana(
  hand: Pt,
  deg: number,
  pal: string[],
  dims: Dims,
  grip: number,
  skinCol: number,
  farShoulder: Pt,
  sleeveCol: number,
  fist: number,
): { behind: Layer[]; blade: Layer; farHand: Layer } {
  const k = katana(hand, deg, pal, dims);
  const u: Pt = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const far: Pt = [hand[0] - u[0] * grip, hand[1] - u[1] * grip];
  const shade = nearest(pal, shadeHex(pal[sleeveCol] ?? '#444444'));
  const skinDark = nearest(pal, shadeHex(pal[skinCol] ?? '#aa8866'));
  return {
    behind: [band(farShoulder, far, 2.4, shade, shade, true)],
    blade: k.layer,
    farHand: disc(far, fist * 0.9, skinDark),
  };
}
