/**
 * The crew at BATTLE scale for the side-on battle (spike `spike/side-battle`, `?battle=side`, DEV only).
 *
 * Round 4 rebuilt the pipeline on one finding: the traced views (`public/art/rig/views.json`) are drawn in
 * 2x2 pixel blocks, so each one collapses EXACTLY to its native resolution (`collapseBlocks`, the same
 * call the enemies use): 49 to 59 px tall, one art pixel per screen pixel. Rounds 1 to 3 shrank by
 * nearest to 46 px, which is 0.41 of the trace, below native: it threw away detail and sampled unevenly.
 * And every member is now the `south-west` view (three-quarter, facing left and a little at us): it is the
 * only trace where all four have a readable face (Kit's eyes, Rook's visor and beard, Hex's goggles,
 * Sable's face and white hair), which also removes round 3's "Sable is a three-quarter among profiles"
 * break and its 90 hand-placed head pixels.
 *
 * From one base frame the code makes every pose, as DATA (rows, columns, pixels, angles), never a repaint:
 *   - wait (3 frames, played 1-2-3-2): the chest row drawn twice, so the head rises, the feet stay;
 *   - walk (4 frames): one leg's shin and foot lifted (the rows taken out, so the leg stays a solid shape
 *     with no ghost), the other planted, a crouch on the passing frames, a lean on the steps;
 *   - brace, wind-up, strike, cast, victory: the lead arm cut out by a capsule (`separateArm`) and drawn
 *     again as two bands and a fist, reaching where the pose says, with a lean and a crouch; Rook's
 *     katana is drawn in two hands (`heldKatana`);
 *   - hurt: a lean back, a crouch, a tilt of the head.
 * One finishing pass grades the palette for the night street and lights the edges.
 */
import { VIEWS_TRACED } from './data';
import { collapseBlocks } from './enemy';
import { band, solveArm } from './battle';
import { type Layer, decode, renderLayers, shadeMap } from './rig';
import { type Pt, type SideArm, heldKatana, separateArm, stripOutline } from './side';
import type { KataKey } from './sidekata';
import { buildKata } from './sidekatadraw';
import { at, bendLeg, clearBox, crouch, dropSpecks, embed, type LegBox, lean, leanAt, rise, topRow } from './sideops';
import type { Pose } from '../battlers';

/** Room round the base frame: the left for an arm or a katana reaching at the enemy, the right for a lean back, the top for a rise or a raised blade. */
const PAD_L = 16;
const PAD_R = 16;
const PAD_T = 20;

/** A leg's columns and the rows its thigh and shin start on (base-frame pixels). */
interface LegSpec {
  x0: number;
  x1: number;
}

/** What a member is, as data (base-frame pixels: the collapsed `south-west` view, soles on its last row). */
interface CrewSpec {
  /** First row of the legs (below the coat, the skirt), and the row the shin starts on. */
  hip: number;
  knee: number;
  /** The leg on the left (toward the enemy) and the one on the right. */
  left: LegSpec;
  right: LegSpec;
  /** The row the wait loop stretches (the chest): everything above it rises. */
  chest: number;
  /** The lead (screen-left) arm: shoulder, resting hand, a capsule radius, a sleeve pixel and a fist pixel. */
  arm: SideArm;
  /** The far shoulder (where the second hand's arm starts, for a two-handed grip). */
  farShoulder: Pt;
  /** Boxes whose near-white pixels become cool grey-blue metal (Kit's chrome forearm and gloves). */
  metal?: [number, number, number, number][];
  /** A weapon drawn in the hands in the action poses (Rook's katana), and the box that clears its sheathed copy from his back. */
  katana?: { box: [number, number, number, number] };
  /** For the kendo strike (`sidekata.ts`): the coat sleeve on the right (the second hand's arm), and a pixel of coat. */
  kata?: { arm2: SideArm; coat: Pt; padX: number; padT: number };
  /** How the staff-side arm and the staff stay put (Sable): the columns the leg moves leave alone are the legs' own, so nothing to do. */
  hair?: boolean;
}

const arm = (shoulder: Pt, hand: Pt, r: number, sleeve: Pt, skin: Pt): SideArm => ({ shoulder, hand, r, sleeve, skin });
const SPEC: Record<string, CrewSpec> = {
  kit: {
    hip: 36,
    knee: 44,
    left: { x0: 3, x1: 12 },
    right: { x0: 13, x1: 21 },
    chest: 25,
    arm: arm([4.5, 26], [3, 33.5], 3.4, [3, 27], [3, 33]),
    farShoulder: [19, 26],
    metal: [[1, 30, 8, 37], [15, 31, 23, 41]],
  },
  rook: {
    hip: 39,
    knee: 42,
    left: { x0: 5, x1: 13 },
    right: { x0: 14, x1: 22 },
    chest: 20,
    arm: arm([5, 19], [2, 29.5], 3, [2, 24], [2, 29]),
    farShoulder: [18, 19],
    katana: { box: [19, 2, 28, 17] },
    kata: { arm2: arm([19, 21], [19.5, 30.5], 3.3, [18, 25], [19, 30]), coat: [13, 33], padX: 44, padT: 46 },
  },
  hex: {
    hip: 40,
    knee: 47,
    left: { x0: 0, x1: 11 },
    right: { x0: 12, x1: 23 },
    chest: 26,
    arm: arm([4, 24], [1.5, 32], 3, [12, 28], [1, 32]),
    farShoulder: [17, 25],
  },
  sable: {
    hip: 43,
    knee: 47,
    left: { x0: 2, x1: 10 },
    right: { x0: 11, x1: 15 },
    chest: 26,
    arm: arm([5, 24], [2, 31], 3, [9, 34], [2, 31]),
    farShoulder: [17, 24],
  },
};

export interface SideCrew {
  /** The rest frame (the first idle frame). */
  base: HTMLCanvasElement;
  /** The wait loop: three frames, played 1-2-3-2. */
  idle: HTMLCanvasElement[];
  /** The walk: step, pass, other step, pass. */
  walk: HTMLCanvasElement[];
  /** The action frames: brace (the crouch before), attack (the wind-up), strike (the blow), cast, item, thrust, aim, hurt, victory. */
  poses: Partial<Record<Pose, HTMLCanvasElement>>;
  /** Rook's kendo strike: one frame per key of `sidekata.ts`, each on its own canvas (wider than the others, centred on the same spot). */
  kata?: Record<KataKey, HTMLCanvasElement>;
  /** The same frames without the smear (the speed ghosts are cut from these). */
  kataPlain?: Record<KataKey, HTMLCanvasElement>;
  /** Height from the frame's bottom edge to the top of the head, in art pixels. */
  headPx: number;
  /** The frame's size in art pixels. */
  w: number;
  h: number;
}

/** The order the idle frames play in (indexes into `idle`): 1-2-3-2. */
export const IDLE_ORDER = [0, 1, 2, 1] as const;

const rgbOf = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const lumOf = (c: string): number => {
  const [r, g, b] = rgbOf(c);
  return 0.3 * r + 0.59 * g + 0.11 * b;
};
/** `a` moved `t` of the way toward `b`. */
const mix = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return `#${hex2(r1 + (r2 - r1) * t)}${hex2(g1 + (g2 - g1) * t)}${hex2(b1 + (b2 - b1) * t)}`;
};

/** The renderer's own outline colour (rig.ts), which the finishing pass swaps for a crisper one. */
const BAKED_OUTLINE = '#120e1d';
/** The cool light off the signs on the back and top edge, and the warm light on the front (face) edge: the street's two neon colours. */
const RIM_COOL = '#a8dcff';
const RIM_WARM = '#ffb27a';
/** A light boot edge so soles read against the pavement. */
const SOLE_LIGHT = '#e6d8ff';
/** Colour grading: saturation up a step, and a floor on how dark a colour may be (legs and boots a little higher: they stand on the darkest ground). Skin is left alone. */
const SAT_BOOST = 1.22;
const FLOOR_BODY = 0.2;
const FLOOR_LEGS = 0.27;
const FLOOR_PULL = 0.6;

/** RGB (0 to 255) to hue 0..360, saturation and lightness 0..1. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, sat, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${hex2((r + m) * 255)}${hex2((g + m) * 255)}${hex2((b + m) * 255)}`;
}
/** Skin: warm peach and brown (hue 8 to 45) or Sable's olive green (50 to 140), moderately saturated, mid-light. Exempt from the grade so faces keep their colour. */
function isSkin(c: string): boolean {
  const [r, g, b] = rgbOf(c);
  const [h, s, l] = toHsl(r, g, b);
  return s > 0.12 && l > 0.28 && l < 0.82 && ((h >= 8 && h <= 45 && s < 0.85) || (h >= 50 && h <= 140 && s < 0.5));
}
/** A palette colour graded for the night street: more saturated, and no darker than `floor` lightness (hue kept). */
function grade(c: string, floor: number): string {
  if (isSkin(c)) return c;
  const [r, g, b] = rgbOf(c);
  const [h, s, l] = toHsl(r, g, b);
  const l2 = l < floor ? l + (floor - l) * FLOOR_PULL : l;
  const s2 = Math.min(1, s * SAT_BOOST) * (l < floor ? Math.max(0.35, l / floor) : 1);
  return fromHsl(h, s2, l2);
}

/**
 * The finishing pass over a rendered frame: outline pixels take the crisp outline colour; body pixels on the
 * back (right) and top edges take a cool rim, those on the front (left) edge a warm one, and the bottom edge a
 * light boot edge. Very bright pixels (white hair) are left alone. `frame` is changed in place.
 */
function finish(frame: HTMLCanvasElement, outline: string, rimAmt: number): HTMLCanvasElement {
  const g = frame.getContext('2d');
  if (!g) return frame;
  const img = g.getImageData(0, 0, frame.width, frame.height);
  const d = img.data;
  const W = frame.width;
  const H = frame.height;
  const [or, og, ob] = rgbOf(BAKED_OUTLINE);
  const [nr, ng, nb] = rgbOf(outline);
  const isOutline = (i: number) => d[i] === or && d[i + 1] === og && d[i + 2] === ob && (d[i + 3] ?? 0) > 0;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (d[(y * W + x) * 4 + 3] ?? 0) > 0 && !isOutline((y * W + x) * 4);
  const rims: [number, [number, number, number], number][] = [];
  const cool = rgbOf(RIM_COOL);
  const warm = rgbOf(RIM_WARM);
  const sole = rgbOf(SOLE_LIGHT);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!solid(x, y)) continue;
      if ((!solid(x + 1, y) && solid(x - 1, y) && solid(x - 2, y)) || (!solid(x, y - 1) && solid(x, y + 1) && solid(x, y + 2))) rims.push([i, cool, rimAmt]);
      else if (!solid(x - 1, y) && solid(x + 1, y) && solid(x + 2, y)) rims.push([i, warm, rimAmt * 0.65]);
      if (!solid(x, y + 1)) rims.push([i, sole, 0.3]);
    }
  for (const [i, [cr, cg, cb], amt] of rims) {
    const l = 0.3 * (d[i] ?? 0) + 0.59 * (d[i + 1] ?? 0) + 0.11 * (d[i + 2] ?? 0);
    if (l > 175) continue;
    const t = amt * (l > 110 ? 0.6 : 1);
    d[i] = (d[i] ?? 0) + (cr - (d[i] ?? 0)) * t;
    d[i + 1] = (d[i + 1] ?? 0) + (cg - (d[i + 1] ?? 0)) * t;
    d[i + 2] = (d[i + 2] ?? 0) + (cb - (d[i + 2] ?? 0)) * t;
  }
  for (let i = 0; i < d.length; i += 4)
    if (isOutline(i)) {
      d[i] = nr;
      d[i + 1] = ng;
      d[i + 2] = nb;
    }
  g.putImageData(img, 0, 0);
  return frame;
}

/** A filled disc of one colour: a fist. */
function disc(c: Pt, r: number, col: number): Layer {
  const x0 = Math.floor(c[0] - r - 1);
  const y0 = Math.floor(c[1] - r - 1);
  const n = Math.ceil(2 * r + 3);
  const px = new Int16Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.hypot(x0 + x + 0.5 - c[0], y0 + y + 0.5 - c[1]) <= r) px[y * n + x] = col;
  return { w: n, h: n, ox: x0, oy: y0, px };
}

/** The first row with at least `n` solid pixels (the top of the head, not a stray tip). */
function headRowOf(c: HTMLCanvasElement, n = 4): number {
  const g = c.getContext('2d');
  if (!g) return 0;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let y = 0; y < c.height; y++) {
    let k = 0;
    for (let x = 0; x < c.width; x++) if ((d[(y * c.width + x) * 4 + 3] ?? 0) > 0) k++;
    if (k >= n) return y;
  }
  return 0;
}

/** Where the lead arm's hand goes in a pose, in arm lengths from the shoulder (x toward the enemy is negative), and which way the elbow bends. */
interface ArmPose {
  hand: Pt;
  elbow: 'down' | 'back' | 'up';
}
/** The lead arm per pose (data). Lengths are fractions of the resting arm; the limb's bones reach 1.24 of it. */
const ARM_POSE: Partial<Record<Pose, ArmPose>> = {
  attack: { hand: [0.55, -0.15], elbow: 'back' },
  strike: { hand: [-1.22, 0.05], elbow: 'down' },
  cast: { hand: [-0.45, -1.2], elbow: 'down' },
  victory: { hand: [-0.2, -1.22], elbow: 'down' },
  hurt: { hand: [0.95, 0.35], elbow: 'back' },
};

/** A member's side-on battle-scale frames, or null while the views haven't loaded (or the member has none). */
export function buildSideCrew(key: string): SideCrew | null {
  const spec = SPEC[key];
  const raw = VIEWS_TRACED[key]?.['south-west'];
  if (!spec || !raw) return null;
  const t = collapseBlocks(raw);
  const W = t.w + PAD_L + PAD_R;
  const H = PAD_T + t.h + 1;
  const P = (p: Pt): Pt => [p[0] + PAD_L, p[1] + PAD_T];

  // The palette, graded for the night street (skin untouched); legs and boots a little higher.
  const base0 = dropSpecks(stripOutline(decode(t), t.pal), 4);
  const legCols = new Set<number>();
  for (let y = spec.hip; y < base0.h; y++) for (let x = spec.left.x0; x <= spec.right.x1; x++) {
    const p = at(base0, x, y);
    if (p >= 0) legCols.add(p);
  }
  const pal = t.pal.map((c, i) => grade(c, legCols.has(i) ? FLOOR_LEGS : FLOOR_BODY));
  // Metal (Kit's chrome forearm): near-white pixels in the named boxes take a cool grey-blue ramp, with a one-pixel highlight.
  let base = base0;
  if (spec.metal) {
    const ramp = ['#dfeaf7', '#9db3cf', '#677d9c'].map((c) => {
      pal.push(c);
      return pal.length - 1;
    });
    base = { ...base0, px: base0.px.slice() };
    for (const [x0, y0, x1, y1] of spec.metal)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const p = at(base, x, y);
          const l = p >= 0 ? lumOf(pal[p] ?? '#000') : 0;
          if (p >= 0 && l > 120 && toHsl(...rgbOf(pal[p] ?? '#000'))[1] < 0.6) base.px[y * base.w + x] = ramp[l > 215 ? 0 : l > 165 ? 1 : 2] ?? p;
        }
  }

  // The lead arm: cut out by a capsule round its bone, the torso behind it filled with the sleeve's colour.
  const sep = separateArm(base, spec.arm, pal);
  const sleeveCol = sep.sleeveCol;
  const fistCol = sep.skinCol;
  sep.gap.px.forEach((p, i) => { if (p >= 0 && sleeveCol >= 0) sep.body.px[i] = sleeveCol; });
  const full = embed(base, W, H, PAD_L, PAD_T);
  const trunk = embed(sep.body, W, H, PAD_L, PAD_T);
  // Rook: a katana drawn from the scabbard takes its hilt off his back.
  const emptyBack = (l: Layer): Layer => (spec.katana ? clearBox(l, spec.katana.box[0] + PAD_L, spec.katana.box[1] + PAD_T, spec.katana.box[2] + PAD_L, spec.katana.box[3] + PAD_T, (p) => p >= 0 && lumOf(pal[p] ?? '#000') > 110 && toHsl(...rgbOf(pal[p] ?? '#000'))[1] < 0.2) : l);

  const hip = spec.hip + PAD_T;
  const chest = spec.chest + PAD_T;
  const leg = (s: LegSpec): LegBox => ({ x0: s.x0 + PAD_L, x1: s.x1 + PAD_L, hip, knee: spec.knee + PAD_T });
  const L = leg(spec.left);
  const R = leg(spec.right);

  // How dark the member is decides how much the rim lifts.
  let total = 0;
  let n = 0;
  for (const p of base.px) if (p >= 0) { total += lumOf(pal[p] ?? '#000000'); n++; }
  const dark = Math.max(0, Math.min(1, (110 - total / Math.max(1, n)) / 60));
  const outline = mix(BAKED_OUTLINE, '#4a4880', 0.08 + 0.1 * dark);
  const draw = (layers: Layer[]): HTMLCanvasElement => finish(renderLayers(layers, pal, W, H, 0, 0), outline, 0.3 + 0.08 * dark);

  // Wait: the chest row drawn twice (the head rises a row, then two), and on the last frame a pixel's lean back. The feet stay.
  const idle = [draw([full]), draw([rise(full, chest, 1)]), draw([lean(rise(full, chest, 2), hip, 1)])];

  // Walk: a step lifts one leg's shin and foot 2 rows (the rows are taken out, so the leg stays whole and solid) and swings it a column; the planted leg goes the other way; the passing frames crouch a row.
  const step = (lead: 'L' | 'R'): Layer => {
    const a = bendLeg(full, lead === 'L' ? L : R, 2, lead === 'L' ? -1 : 1);
    const b = bendLeg(a, lead === 'L' ? R : L, 0, lead === 'L' ? 1 : -1);
    return lean(b, hip, lead === 'L' ? -1 : 0);
  };
  const pass = crouch(full, chest, 1);
  const walk = [draw([step('L')]), draw([pass]), draw([step('R')]), draw([pass])];

  // Action poses.
  const shade = shadeMap(pal)[sleeveCol] ?? sleeveCol;
  const armLen = Math.hypot(spec.arm.hand[0] - spec.arm.shoulder[0], spec.arm.hand[1] - spec.arm.shoulder[1]);
  const top = topRow(full);
  /** The lead arm in a pose, as layers over a body leaned and crouched by the given amounts: shoulder follows the lean and the crouch. */
  const limbFor = (pose: Pose, leanDx: number, crouchN: number): { layers: Layer[]; hand: Pt; shoulder: Pt } => {
    const ap = ARM_POSE[pose];
    const sh0 = P(spec.arm.shoulder);
    const sh: Pt = [sh0[0] + leanAt(Math.round(sh0[1]), hip, top, leanDx), sh0[1] + (spec.arm.shoulder[1] + PAD_T < chest ? 0 : 0) + (sh0[1] < chest ? crouchN : 0)];
    const target: Pt = ap ? [sh[0] + ap.hand[0] * armLen, sh[1] + ap.hand[1] * armLen] : [sh[0], sh[1] + armLen];
    const bone = armLen * 0.62;
    const a = solveArm(sh, bone, bone, target, 1);
    const b = solveArm(sh, bone, bone, target, -1);
    const pick = ap?.elbow === 'back' ? (a.elbow[0] > b.elbow[0] ? a : b) : ap?.elbow === 'up' ? (a.elbow[1] < b.elbow[1] ? a : b) : a.elbow[1] > b.elbow[1] ? a : b;
    const wide = Math.max(3, Math.round(spec.arm.r * 1.0));
    return {
      layers: [band(sh, pick.elbow, wide, sleeveCol, shade, true), band(pick.elbow, pick.wrist, wide - 0.4, sleeveCol, shade, true), disc(pick.wrist, 2.1, fistCol)],
      hand: pick.wrist,
      shoulder: sh,
    };
  };
  const body = (leanDx: number, crouchN: number, riseN = 0): Layer => {
    let l = spec.katana ? emptyBack(trunk) : trunk;
    if (crouchN) l = crouch(l, chest, crouchN);
    if (riseN) l = rise(l, chest, riseN);
    return lean(l, hip, leanDx);
  };
  const dims = { pommel: -8, guard: 3, tip: 21 };
  const posed = (pose: Pose, leanDx: number, crouchN: number, riseN = 0): HTMLCanvasElement => {
    const lb = body(leanDx, crouchN, riseN);
    const lm = limbFor(pose, leanDx, crouchN - riseN);
    if (spec.katana && (pose === 'attack' || pose === 'strike' || pose === 'cast')) {
      // Two hands on the grip: the near fist where the pose puts it, the blade along its angle (overhead for the wind-up, level for the blow).
      const deg = pose === 'attack' ? -58 : pose === 'strike' ? 172 : -84;
      const hand: Pt = pose === 'attack' ? [lm.shoulder[0] + 4, lm.shoulder[1] - 15] : pose === 'strike' ? [lm.shoulder[0] - 7, lm.shoulder[1] + 3] : [lm.shoulder[0] - 1, lm.shoulder[1] - 16];
      const k = heldKatana(hand, deg, pal, dims, 4, fistCol, P(spec.farShoulder), sleeveCol, 2);
      const near = limbToHand(lm.shoulder, hand);
      return draw([...k.behind, lb, k.blade, k.farHand, ...near]);
    }
    return draw([lb, ...lm.layers]);
  };
  /** The near arm reaching a given hand place (for the katana grip). */
  const limbToHand = (sh: Pt, hand: Pt): Layer[] => {
    const bone = armLen * 0.62;
    const a = solveArm(sh, bone, bone, hand, 1);
    const b = solveArm(sh, bone, bone, hand, -1);
    const pick = a.elbow[1] > b.elbow[1] ? a : b;
    return [band(sh, pick.elbow, 3, sleeveCol, shade, true), band(pick.elbow, pick.wrist, 2.6, sleeveCol, shade, true), disc(pick.wrist, 2.1, fistCol)];
  };

  const attack = posed('attack', 2, 1);
  const strike = posed('strike', -3, 1);
  const cast = posed('cast', 1, 0, 1);
  const poses: Partial<Record<Pose, HTMLCanvasElement>> = {
    brace: draw([lean(crouch(full, chest, 2), hip, 1)]),
    attack,
    strike,
    cast,
    victory: posed('victory', 0, 0, 1),
    hurt: posed('hurt', 4, 2),
    thrust: strike,
    aim: attack,
    item: cast,
  };
  // Rook's kendo strike: its own frames, from data.
  let kata: Record<KataKey, HTMLCanvasElement> | undefined;
  let kataPlain: Record<KataKey, HTMLCanvasElement> | undefined;
  if (spec.kata && spec.katana) {
    const kb = spec.katana.box;
    const built = buildKata({
      base,
      pal,
      arm1: spec.arm,
      arm2: spec.kata.arm2,
      coat: spec.kata.coat,
      hip: spec.hip,
      knee: spec.knee,
      chest: spec.chest,
      front: spec.left,
      back: spec.right,
      hilt: kb,
      isSteel: (p) => p >= 0 && lumOf(pal[p] ?? '#000') > 110 && toHsl(...rgbOf(pal[p] ?? '#000'))[1] < 0.2,
      isSkin: (p) => p >= 0 && isSkin(t.pal[p] ?? '#000000'),
      padX: spec.kata.padX,
      padT: spec.kata.padT,
      render: (layers, w, h) => finish(renderLayers(layers, pal, w, h, 0, 0), outline, 0.3 + 0.08 * dark),
    });
    kata = built.frames;
    kataPlain = built.plain;
  }
  return { base: idle[0] as HTMLCanvasElement, idle, walk, poses, ...(kata ? { kata } : {}), ...(kataPlain ? { kataPlain } : {}), headPx: H - headRowOf(idle[0] as HTMLCanvasElement), w: W, h: H };
}
