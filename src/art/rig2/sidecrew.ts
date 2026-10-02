/**
 * The crew at BATTLE scale for the side-on battle (spike `spike/side-battle`, `?battle=side`).
 *
 * Each member comes from a traced view (`public/art/rig/views.json`, 97 to 123 px tall, about 2x2
 * pixel blocks), shrunk by nearest to ~46 px so the soles are on one row, the baked outline taken off
 * and redone round the finished frame. From that one base the code makes:
 *   - an idle "wait" loop (three frames, played 1-2-3-2): the chest stretches by a row or two, so the
 *     head rises, and on the last frame the upper body leans back a pixel; the feet stay put;
 *   - a four-frame walk (step, pass, other step, pass): the legs swing about the hip by RotSprite (the
 *     field rig's own idea, `facingFrames` in rig.ts), the near arm is cut out and counter-swings about
 *     the shoulder (`separateArm` from the day-1 arm test), the body drops a pixel on the passing steps,
 *     and a long coat's hem sways opposite the leading leg.
 * Then one finishing pass for the night street: the darkest trousers and boots are lifted a step,
 * the outline is lifted from near-black on dark members, and a thin cool rim lights the back and top
 * edge, so a member doesn't dissolve into the pavement.
 * Nothing is repainted by hand: a member is a trace, a scale, a hip row, a chest row and (optionally) an arm.
 */
import { VIEWS_TRACED } from './data';
import { byColour, cut, decode, type Layer, legColours, renderLayers, rotSprite, shadeMap, span, type Traced } from './rig';
import { type Pt, type SideArm, separateArm, shrink, stripOutline } from './side';

/** The row the soles stand on in the shrunk frame (so a member is ~47 px tall with hair). */
export const BATTLE_FEET = 46;
/** Transparent room round the frame: the sides for swung legs and a staff, the top for the head's rise. */
const PAD_X = 6;
const PAD_TOP = 4;

/** Where, as a fraction of the sole row, a member's legs begin and their chest is (data per member). */
interface CrewSpec {
  hip: number;
  chest: number;
  /**
   * Which traced view faces left. `west` for most. Sable's traced `west` is a narrow turned-away sliver with
   * no face, and her `east` is a back view (hair over everything), so she is the three-quarter `south-west`:
   * the one view with her face, white hair and staff. A KNOWN BREAK: she is not a true profile like the others.
   */
  from: 'west' | 'south-west';
  /** The near arm on the shrunk frame (shoulder, hand, a capsule radius, a sleeve pixel and a fist pixel), if it counter-swings in the walk. */
  arm?: SideArm;
  /** How far the near arm swings against the near leg, degrees (Rook's coat sleeve is shaded in seams that turn to scribbles at a wide angle). */
  swing?: number;
  /** How far the legs swing in the walk, degrees (a long coat or a dark leg needs more to read). */
  stride: number;
  /** Rows at the bottom of a long coat that sway opposite the leading leg. */
  hem?: number;
}
const arm = (shoulder: Pt, hand: Pt, r: number, sleeve: Pt, skin: Pt): SideArm => ({ shoulder, hand, r, sleeve, skin });
const SPEC: Record<string, CrewSpec> = {
  kit: { hip: 0.74, chest: 0.5, from: 'west', stride: 34, arm: arm([8.5, 18], [9.5, 30], 3.2, [9, 22], [9, 30]), swing: 16 },
  rook: { hip: 0.84, chest: 0.5, from: 'west', stride: 40, hem: 11, arm: arm([11, 17], [13, 30], 3.4, [12, 24], [13, 30]), swing: 9 },
  hex: { hip: 0.78, chest: 0.5, from: 'west', stride: 40, arm: arm([7, 17], [8, 31], 2.6, [7, 24], [8, 32]), swing: 14 },
  sable: { hip: 0.8, chest: 0.5, from: 'south-west', stride: 40 },
};


export interface SideCrew {
  /** The rest frame (the first idle frame). */
  base: HTMLCanvasElement;
  /** The wait loop: three frames, played 1-2-3-2. */
  idle: HTMLCanvasElement[];
  /** The walk: step, pass, other step, pass. */
  walk: HTMLCanvasElement[];
  /** Height from the frame's bottom edge to the top of the head, in art pixels. */
  headPx: number;
  /** The frame's size in art pixels. */
  w: number;
  h: number;
}

/** The order the idle frames play in (indexes into `idle`): 1-2-3-2. */
export const IDLE_ORDER = [0, 1, 2, 1] as const;

/** A layer with each row in `dup` drawn twice: the part above it rises by that many rows, the part below stays. */
function stretch(l: Layer, dup: readonly number[]): Layer {
  const rows: number[] = [];
  for (let y = 0; y < l.h; y++) {
    rows.push(y);
    if (dup.includes(y)) rows.push(y);
  }
  const px = new Int16Array(l.w * rows.length);
  rows.forEach((src, y) => {
    for (let x = 0; x < l.w; x++) px[y * l.w + x] = l.px[src * l.w + x] ?? -1;
  });
  // The feet stay where they were: the extra rows go on top.
  return { w: l.w, h: rows.length, ox: l.ox, oy: l.oy - (rows.length - l.h), px };
}

/** A layer with the rows from `y0` up to (not including) `y1` moved `dx` pixels sideways (a lean, a sway); the layer grows a column each side to hold them. */
function shiftRows(l: Layer, y0: number, y1: number, dx: number): Layer {
  const w = l.w + 2;
  const px = new Int16Array(w * l.h).fill(-1);
  for (let y = 0; y < l.h; y++) {
    const d = y >= y0 && y < y1 ? dx : 0;
    for (let x = 0; x < l.w; x++) {
      const p = l.px[y * l.w + x] ?? -1;
      if (p >= 0) px[y * w + x + 1 + d] = p;
    }
  }
  return { w, h: l.h, ox: l.ox - 1, oy: l.oy, px };
}

/** A layer without its specks: connected groups (touching at a corner counts) of fewer than `min` pixels, the loose bits a trace leaves beside a figure. */
function dropSpecks(l: Layer, min = 4): Layer {
  const px = l.px.slice();
  const seen = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) {
    if ((px[i] ?? -1) < 0 || seen[i]) continue;
    const group: number[] = [i];
    seen[i] = 1;
    for (let k = 0; k < group.length; k++) {
      const at = group[k] ?? 0;
      const x = at % l.w;
      const y = Math.floor(at / l.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= l.w || ny >= l.h) continue;
          const j = ny * l.w + nx;
          if ((px[j] ?? -1) >= 0 && !seen[j]) {
            seen[j] = 1;
            group.push(j);
          }
        }
    }
    if (group.length < min) for (const j of group) px[j] = -1;
  }
  return { ...l, px };
}

/** The first row with at least `n` solid pixels (the top of the head, not a stray hair tip or a staff's end). */
function headRowOf(c: HTMLCanvasElement, n = 5): number {
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

/** The renderer's own outline colour (rig.ts), which the finishing pass swaps for a lifted one. */
const BAKED_OUTLINE = '#120e1d';
/** The cool light that rims the back and top edge. */
const RIM_COOL = '#a8dcff';
/** Colours darker than this in the legs are lifted a step toward the midtone, so trousers and boots read against the pavement. */
const LEG_LIFT_BELOW = 62;
const MIDTONE = '#6a6a94';

/**
 * The finishing pass over a rendered frame: outline pixels take the member's lifted outline colour,
 * and each body pixel on the back (right) or top edge takes a thin cool rim (not the very bright ones:
 * white hair doesn't need it). `frame` is a canvas from `renderLayers`; it is changed in place.
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
  const rim: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!solid(x, y)) continue;
      // The back edge (nothing solid to its right) and the top edge (nothing solid above).
      if (!solid(x + 1, y) || !solid(x, y - 1)) rim.push(i);
    }
  const [cr, cg, cb] = rgbOf(RIM_COOL);
  for (const i of rim) {
    const l = 0.3 * (d[i] ?? 0) + 0.59 * (d[i + 1] ?? 0) + 0.11 * (d[i + 2] ?? 0);
    if (l > 175) continue;
    const t = rimAmt * (l > 110 ? 0.6 : 1);
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

/** A member's side-on battle-scale frames, or null while the views haven't loaded (or the member has none). */
export function buildSideCrew(key: string): SideCrew | null {
  const views = VIEWS_TRACED[key];
  const spec = SPEC[key];
  const side = spec ? views?.[spec.from] : undefined;
  const south = views?.south;
  if (!side || !south || !spec) return null;
  const small = (t: Traced): Traced => {
    const s = shrink(t, BATTLE_FEET / t.feet, 'nearest');
    return { ...s, hip: Math.round(s.feet * spec.hip) };
  };
  const sw = small(side);
  const base = dropSpecks(stripOutline(decode(sw), sw.pal));
  // The legs: the trousers' and boots' colours, as the front view has them, below the hip.
  const legCols = legColours(small(south));
  // The darkest trouser and boot colours lifted a step toward the midtone (Hex's near-black legs, Kit's navy, Sable's dark boots).
  const pal = sw.pal.map((c, i) => (legCols.has(i) && lumOf(c) < LEG_LIFT_BELOW ? mix(c, MIDTONE, 0.5) : c));
  const below = cut(base, 0, sw.hip, sw.w, sw.h);
  const legs = byColour(below, legCols, true);
  // The near arm, if it swings: cut out by the day-1 capsule, the torso behind it filled.
  const sep = spec.arm ? separateArm(base, spec.arm, pal) : null;
  // The torso behind the arm: the sleeve's own colour (the fill picks the commonest neighbour, which on a coat with dark seams can be the seam's).
  if (sep && spec.arm) {
    const sleeve = base.px[Math.floor(spec.arm.sleeve[1]) * base.w + Math.floor(spec.arm.sleeve[0])] ?? -1;
    if (sleeve >= 0) sep.gap.px.forEach((p, i) => { if (p >= 0) sep.body.px[i] = sleeve; });
  }
  const trunk = sep ? sep.body : base;
  const upper: Layer = { ...trunk, px: trunk.px.slice() };
  for (let y = sw.hip; y < sw.h; y++) for (let x = 0; x < sw.w; x++) if (legCols.has(upper.px[y * sw.w + x] ?? -1)) upper.px[y * sw.w + x] = -1;
  const cols = span(legs) ?? [0, sw.w - 1];
  const hipX = (cols[0] + cols[1]) / 2 + 0.5;

  // How dark the member is overall decides how much the outline and the rim lift.
  let total = 0;
  let n = 0;
  for (const p of base.px)
    if (p >= 0) {
      total += lumOf(pal[p] ?? '#000000');
      n++;
    }
  const dark = Math.max(0, Math.min(1, (95 - total / Math.max(1, n)) / 60));
  const outline = mix(BAKED_OUTLINE, '#5c5a8c', 0.18 + 0.2 * dark);
  const finishFrame = (c: HTMLCanvasElement) => finish(c, outline, 0.3 + 0.2 * dark);

  // Every frame shares one canvas, with the soles on its second-to-last row (the outline takes the last).
  const W = sw.w + PAD_X * 2;
  const H = PAD_TOP + sw.h + 1;
  const draw = (layers: Layer[], dy = 0): HTMLCanvasElement => finishFrame(renderLayers(layers, pal, W, H, PAD_X, PAD_TOP + dy));

  // Wait: the chest stretches (the head rises a row, then two), and on the last frame the upper body leans back a pixel.
  const chest = Math.round(sw.feet * spec.chest);
  const idle = [draw([base]), draw([stretch(base, [chest])]), draw([stretch(shiftRows(base, 0, chest, 1), [chest, chest - 7])])];

  // The far leg a shade darker, but not the colours that are nearly black already (Hex's trousers and boots
  // would turn to a muddy blob where the two legs cross).
  const shade = shadeMap(pal);
  const dim = (l: Layer): Layer => ({ ...l, px: l.px.map((p) => (p >= 0 && lumOf(pal[p] ?? '#000000') > 70 ? (shade[p] ?? p) : p)) });
  // Side on: the legs part about the hip, each shifted a pixel its way, the far one darker and behind.
  const STRIDE = spec.stride;
  const near = (deg: number): Layer => {
    const r = rotSprite(legs, deg, hipX, sw.hip);
    return { ...r, ox: r.ox + Math.sign(deg) };
  };
  const far = (deg: number): Layer => {
    const r = rotSprite(dim(legs), deg, hipX, sw.hip);
    return { ...r, ox: r.ox + Math.sign(deg) };
  };
  // The near arm swings against the near leg (leading leg forward: arm back), about the shoulder.
  const ARM = spec.swing ?? 16;
  const swing = (deg: number): Layer[] => (sep && spec.arm ? [rotSprite(sep.arm, deg, spec.arm.shoulder[0], spec.arm.shoulder[1])] : []);
  // A long coat's hem sways the other way from the leading leg.
  const body = (hem: number): Layer => (spec.hem && hem ? shiftRows(upper, sw.feet - spec.hem, sw.h, hem) : upper);
  // Facing left: forward is -x, so the near leg's forward swing is a negative turn.
  const walk = [
    draw([far(STRIDE), body(1), near(-STRIDE), ...swing(ARM)]),
    draw([body(0), legs, ...swing(0)], -1),
    draw([far(-STRIDE), body(-1), near(STRIDE), ...swing(-ARM)]),
    draw([body(0), legs, ...swing(0)], -1),
  ];
  return { base: idle[0] as HTMLCanvasElement, idle, walk, headPx: H - headRowOf(idle[0] as HTMLCanvasElement), w: W, h: H };
}
