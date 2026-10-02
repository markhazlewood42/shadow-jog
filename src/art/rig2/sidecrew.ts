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
   * no face, so she is her `east` view MIRRORED (round 3): a true profile with her face, white hair, red coat
   * and staff (round 2 shrank it and judged it a back view; it is a profile with the hair drawn over the shoulder).
   */
  from: 'west' | 'south-west' | 'east';
  /** A hand-built profile head laid over the traced head (see SABLE_PROFILE_HEAD). */
  head?: { rows: string[]; pal: Record<string, number> };
  /** Mirror the traced view (Sable's `east` view faces right; the party faces left). */
  flip?: boolean;
  /** A hair colour darker than the night sky is lifted toward this warm midtone (Kit's near-black plum hair vanished into the skyline). */
  hair?: string;
  /** Draw the legs a pixel wider (Hex's thin legs read as sticks). */
  legFat?: boolean;
  /** Rows the body drops on the passing steps of the walk (default 1). */
  bob?: number;
  /** Rows the trailing foot lifts on the step frames (the heel lift; default 1). */
  heel?: number;
  /** The near arm on the shrunk frame (shoulder, hand, a capsule radius, a sleeve pixel and a fist pixel), if it counter-swings in the walk. */
  arm?: SideArm;
  /** How far the near arm swings against the near leg, degrees (Rook's coat sleeve is shaded in seams that turn to scribbles at a wide angle). */
  swing?: number;
  /** How far the legs swing in the walk, degrees (a long coat or a dark leg needs more to read). */
  stride: number;
  /** Rows at the bottom of a long coat that sway opposite the leading leg. */
  hem?: number;
}
/**
 * A hand-built profile head for a member whose traced views have no readable side face (Sable: the
 * `west` trace is a sliver behind her staff, the `east` one is hair over everything). A few rows of
 * characters over her own palette: H, h, m hair (light, shade, deeper shade), S, s, d skin (light, shade,
 * dark), E the eye, M the mouth. It is laid over the head of her three-quarter `south-west` view: the
 * old hair and face pixels in its box are cleared (the staff beside it is kept), then these go down.
 * About 45 pixels of hand work, logged as cost in the spike doc.
 */
const SABLE_PROFILE_HEAD = {
  rows: [
    '...HHHHHH..',
    '..HHHHHHHH.',
    '.HHHHHHHHHh',
    '.HHHHHHHHHh',
    '.HHHHHHHHhh',
    '.HSSSHHHHhh',
    '.SddSHHHHhh',
    'SSESSHHHHhh',
    'SSSSSsHHhhh',
    '.SSSsHHHhh.',
    '.SMSssHHhh.',
    '..SSssHHhh.',
    '..dssHHHhh.',
    '...ddHHHh..',
  ],
  /** Palette indexes in her palette (the same across her views). */
  pal: { H: 39, h: 36, m: 34, S: 28, s: 26, d: 24, E: 31, M: 17 } as Record<string, number>,
};

const arm = (shoulder: Pt, hand: Pt, r: number, sleeve: Pt, skin: Pt): SideArm => ({ shoulder, hand, r, sleeve, skin });
const SPEC: Record<string, CrewSpec> = {
  kit: { hip: 0.74, chest: 0.5, from: 'west', hair: '#7a4470', stride: 34, arm: arm([8.5, 18], [9.5, 30], 3.2, [9, 22], [9, 30]), swing: 16 },
  rook: { hip: 0.84, chest: 0.5, from: 'west', stride: 40, hem: 11, bob: 2, heel: 2, arm: arm([11, 17], [13, 30], 3.4, [12, 24], [13, 30]), swing: 9 },
  hex: { hip: 0.78, chest: 0.5, from: 'west', stride: 40, legFat: true, arm: arm([7, 17], [8, 31], 2.6, [7, 24], [8, 32]), swing: 14 },
  sable: { hip: 0.8, chest: 0.5, from: 'south-west', head: SABLE_PROFILE_HEAD, stride: 40 },
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

/** The renderer's own outline colour (rig.ts), which the finishing pass swaps for a crisper one. */
const BAKED_OUTLINE = '#120e1d';
/** The cool light off the signs on the back and top edge, and the warm light on the front (face) edge: the street's two neon colours. */
const RIM_COOL = '#a8dcff';
const RIM_WARM = '#ffb27a';
/** A light boot edge so soles read against the pavement. */
const SOLE_LIGHT = '#e6d8ff';
/** Colour grading (round 3): saturation up a step, and a floor on how dark a colour may be (legs and boots higher: they stand on the darkest ground). */
const SAT_BOOST = 1.28;
const FLOOR_BODY = 0.24;
const FLOOR_LEGS = 0.36;
/** How much of the gap to the floor a too-dark colour closes (soft, so a coat's dark seams keep their shading). */
const FLOOR_PULL_BODY = 0.5;
const FLOOR_PULL_LEGS = 0.8;

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
/** A palette colour graded for the night street: more saturated, and no darker than `floor` lightness (hue kept, so brown boots stay brown and navy trousers stay blue). */
function grade(c: string, floor: number, pull: number): string {
  const [r, g, b] = rgbOf(c);
  const [h, s, l] = toHsl(r, g, b);
  const l2 = l < floor ? l + (floor - l) * pull : l;
  // A very dark colour keeps its saturation in proportion to how far it was lifted, or a near-black navy would come out as pure blue.
  const s2 = Math.min(1, s * SAT_BOOST) * (l < floor ? Math.max(0.25, l / floor) : 1);
  return fromHsl(h, s2, l2);
}

/**
 * The finishing pass over a rendered frame: outline pixels take the member's crisp outline colour; body
 * pixels on the back (right) and top edges take a cool rim, those on the front (left) edge a warm one
 * (the enemies carry a warm rim too, so the two sides share a light), and the bottom edge a light boot
 * edge. Very bright pixels (white hair) are left alone. `frame` is a canvas from `renderLayers`; it is changed in place.
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
      // The back edge (nothing solid to its right) and the top edge (nothing solid above): cool.
      // Only where the part is at least two pixels thick there (a staff or a thin leg would turn to a pale line).
      if ((!solid(x + 1, y) && solid(x - 1, y) && solid(x - 2, y)) || (!solid(x, y - 1) && solid(x, y + 1) && solid(x, y + 2))) rims.push([i, cool, rimAmt]);
      // The front edge (nothing solid to its left): warm, lighter.
      else if (!solid(x - 1, y) && solid(x + 1, y) && solid(x + 2, y)) rims.push([i, warm, rimAmt * 0.65]);
      // The sole: nothing solid below.
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

/** A layer mirrored left to right. */
const flipTraced = (t: Traced): Traced => ({ ...t, rows: t.rows.map((r) => [...r].reverse().join('')) });

/** A layer with every pixel also drawn one column to the left where that column is empty (a leg a pixel wider). */
function fatten(l: Layer): Layer {
  const w = l.w + 1;
  const px = new Int16Array(w * l.h).fill(-1);
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++) {
      const p = l.px[y * l.w + x] ?? -1;
      if (p < 0) continue;
      px[y * w + x + 1] = p;
      if ((px[y * w + x] ?? -1) < 0) px[y * w + x] = p;
    }
  return { w, h: l.h, ox: l.ox - 1, oy: l.oy, px };
}


/** Skin: the olive-green and brown-orange tones, by hue (a trace's palette has no names). */
function isSkinColour(c: string): boolean {
  const [r, g, b] = rgbOf(c);
  const [h, sat, l] = toHsl(r, g, b);
  return sat > 0.1 && l > 0.2 && l < 0.7 && h >= 50 && h <= 140;
}

/** `base` with the profile head laid over its head: its left edge at the head's leftmost solid pixel, its top at the head's top. */
function patchHead(base: Layer, pal: string[], head: { rows: string[]; pal: Record<string, number> }, headRows: number): Layer {
  const lum = (p: number) => lumOf(pal[p] ?? '#000000');
  const hairOrSkin = (p: number) => p >= 0 && (lum(p) > 150 || isSkinColour(pal[p] ?? '#000000'));
  // The old head's extent: the pixels that are hair or skin in the head rows.
  let x0 = Infinity;
  let y0 = Infinity;
  for (let y = 0; y < Math.min(headRows, base.h); y++)
    for (let x = 0; x < base.w; x++)
      if (hairOrSkin(base.px[y * base.w + x] ?? -1)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
      }
  if (!Number.isFinite(x0)) return base;
  const px = base.px.slice();
  const hw = Math.max(...head.rows.map((r) => r.length));
  // Clear the old hair and face inside the head's box (the staff, brown, stays).
  for (let y = y0; y < Math.min(base.h, y0 + head.rows.length); y++)
    for (let x = x0; x < Math.min(base.w, x0 + hw); x++) if (hairOrSkin(px[y * base.w + x] ?? -1)) px[y * base.w + x] = -1;
  head.rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) {
      const ch = r[i] ?? '.';
      const idx = head.pal[ch];
      if (ch !== '.' && idx !== undefined && y0 + j < base.h && x0 + i < base.w) px[(y0 + j) * base.w + x0 + i] = idx;
    }
  });
  return { ...base, px };
}

/** A member's side-on battle-scale frames, or null while the views haven't loaded (or the member has none). */
export function buildSideCrew(key: string): SideCrew | null {
  const views = VIEWS_TRACED[key];
  const spec = SPEC[key];
  const raw = spec ? views?.[spec.from] : undefined;
  const side = raw && spec?.flip ? flipTraced(raw) : raw;
  const south = views?.south;
  if (!side || !south || !spec) return null;
  const small = (t: Traced): Traced => {
    const s = shrink(t, BATTLE_FEET / t.feet, 'nearest');
    return { ...s, hip: Math.round(s.feet * spec.hip) };
  };
  const sw = small(side);
  const base0 = dropSpecks(stripOutline(decode(sw), sw.pal));
  const headRows = Math.round(sw.feet * 0.3);
  const base = spec.head ? patchHead(base0, sw.pal, spec.head, headRows) : base0;
  // The legs: the trousers' and boots' colours, as the front view has them, below the hip.
  const legCols = legColours(small(south));
  // Hair colours: the dark colours common in the head's rows (Kit's near-black plum vanished into the skyline).
  const used = new Map<number, number>();
  for (let y = 0; y < Math.min(headRows, sw.h); y++) for (let x = 0; x < sw.w; x++) {
    const p = base.px[y * sw.w + x] ?? -1;
    if (p >= 0) used.set(p, (used.get(p) ?? 0) + 1);
  }
  // Graded for the night street: a warmer hair midtone where the spec names one, then saturation up and a floor on how dark (legs and boots higher).
  const pal = sw.pal.map((c, i) => {
    const hairy = spec.hair && !legCols.has(i) && (used.get(i) ?? 0) >= 8 && lumOf(c) < 75;
    return grade(hairy && spec.hair ? mix(c, spec.hair, 0.5) : c, legCols.has(i) ? FLOOR_LEGS : FLOOR_BODY, legCols.has(i) ? FLOOR_PULL_LEGS : FLOOR_PULL_BODY);
  });
  const below = cut(base, 0, sw.hip, sw.w, sw.h);
  const legs0 = byColour(below, legCols, true);
  const legs = spec.legFat ? fatten(legs0) : legs0;
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
  const cols = span(legs0) ?? [0, sw.w - 1];
  const hipX = (cols[0] + cols[1]) / 2 + 0.5;

  // How dark the member is overall decides how much the rim lifts.
  let total = 0;
  let n = 0;
  for (const p of base.px)
    if (p >= 0) {
      total += lumOf(pal[p] ?? '#000000');
      n++;
    }
  const dark = Math.max(0, Math.min(1, (110 - total / Math.max(1, n)) / 60));
  // A crisp, near-black outline (round 2's lifted one made dark members look ghostly; with the fills graded up the dark line is what separates them from the street).
  const outline = mix(BAKED_OUTLINE, '#4a4880', 0.08 + 0.1 * dark);
  const finishFrame = (c: HTMLCanvasElement) => finish(c, outline, 0.3 + 0.08 * dark);

  // Every frame shares one canvas, with the soles on its second-to-last row (the outline takes the last).
  const W = sw.w + PAD_X * 2;
  const H = PAD_TOP + sw.h + 1;
  const draw = (layers: Layer[], dy = 0): HTMLCanvasElement => finishFrame(renderLayers(layers, pal, W, H, PAD_X, PAD_TOP + dy));

  // Wait: the chest stretches (the head rises two rows, then three), and on the last frame the upper body leans back a pixel. The feet stay.
  const chest = Math.round(sw.feet * spec.chest);
  const idle = [draw([base]), draw([stretch(base, [chest, chest - 6])]), draw([stretch(shiftRows(base, 0, chest, 1), [chest, chest - 6, chest - 12])])];

  // The far leg a shade darker, but not the colours that are nearly black already.
  const shade = shadeMap(pal);
  const dim = (l: Layer): Layer => ({ ...l, px: l.px.map((p) => (p >= 0 && lumOf(pal[p] ?? '#000000') > 70 ? (shade[p] ?? p) : p)) });
  // Side on: the legs part about the hip, each shifted a pixel its way, the far one darker and behind. The trailing foot lifts (the heel lift).
  const STRIDE = spec.stride;
  const HEEL = spec.heel ?? 1;
  const near = (deg: number, lift = 0): Layer => {
    const r = rotSprite(legs, deg, hipX, sw.hip);
    return { ...r, ox: r.ox + Math.sign(deg), oy: r.oy - lift };
  };
  const far = (deg: number, lift = 0): Layer => {
    const r = rotSprite(dim(legs), deg, hipX, sw.hip);
    return { ...r, ox: r.ox + Math.sign(deg), oy: r.oy - lift };
  };
  // The near arm swings against the near leg (leading leg forward: arm back), about the shoulder.
  const ARM = spec.swing ?? 16;
  const swing = (deg: number): Layer[] => (sep && spec.arm ? [rotSprite(sep.arm, deg, spec.arm.shoulder[0], spec.arm.shoulder[1])] : []);
  // A long coat's hem sways the other way from the leading leg.
  const SWAY = 2;
  const body = (hem: number): Layer => (spec.hem && hem ? shiftRows(upper, sw.feet - spec.hem, sw.h, hem) : upper);
  const BOB = spec.bob ?? 1;
  // Facing left: forward is -x, so the near leg's forward swing is a negative turn.
  const walk = [
    draw([far(STRIDE, HEEL), body(SWAY), near(-STRIDE), ...swing(ARM)]),
    draw([body(0), legs, ...swing(0)], -BOB),
    draw([far(-STRIDE), body(-SWAY), near(STRIDE, HEEL), ...swing(-ARM)]),
    draw([body(0), legs, ...swing(0)], -BOB),
  ];
  return { base: idle[0] as HTMLCanvasElement, idle, walk, headPx: H - headRowOf(idle[0] as HTMLCanvasElement), w: W, h: H };
}
