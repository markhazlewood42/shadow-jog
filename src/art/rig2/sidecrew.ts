/**
 * The crew at BATTLE scale for the side-on battle (spike `spike/side-battle`, `?battle=side`).
 *
 * Each member comes from their traced `west` view (`public/art/rig/views.json`, 97 to 123 px tall,
 * about 2x2 pixel blocks), shrunk by nearest to ~46 px so the soles are on one row, the baked outline
 * taken off and redone round the finished frame. From that one base the code makes:
 *   - an idle "wait" loop (three frames, played 1-2-3-2): the chest stretches by a row or two, so the
 *     head rises, and the feet stay put;
 *   - a four-frame walk (step, pass, other step, pass) with the legs swung about the hip by RotSprite,
 *     the field rig's own idea (`facingFrames` in rig.ts) on the bigger frame.
 * Nothing is repainted by hand: a member is a trace, a scale, a hip row and a chest row.
 */
import { VIEWS_TRACED } from './data';
import { byColour, cut, darker, decode, type Layer, legColours, renderLayers, rotSprite, span, type Traced } from './rig';
import { shrink, stripOutline } from './side';

/** The row the soles stand on in the shrunk frame (so a member is ~47 px tall with hair). */
export const BATTLE_FEET = 46;
/** Transparent room round the frame: the sides for swung legs and a staff, the top for the head's rise. */
const PAD_X = 5;
const PAD_TOP = 4;

/** Where, as a fraction of the sole row, a member's legs begin and their chest is (data per member). */
interface CrewSpec {
  hip: number;
  chest: number;
  /** Which traced view faces left: `west` for most; Sable's traced `west` is a turned-away sliver with no face, so she uses `south-west` (a three-quarter view facing left and a little toward us). */
  from: 'west' | 'south-west';
}
const SPEC: Record<string, CrewSpec> = {
  kit: { hip: 0.74, chest: 0.5, from: 'west' },
  rook: { hip: 0.84, chest: 0.5, from: 'west' },
  hex: { hip: 0.78, chest: 0.5, from: 'west' },
  sable: { hip: 0.8, chest: 0.5, from: 'south-west' },
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

/** A member's side-on battle-scale frames, or null while the views haven't loaded (or the member has none). */
export function buildSideCrew(key: string): SideCrew | null {
  const views = VIEWS_TRACED[key];
  const spec = SPEC[key];
  const side = spec ? views?.[spec.from] : undefined;
  const south = views?.south;
  if (!side || !south || !spec) return null;
  const west = side;
  const small = (t: Traced): Traced => {
    const s = shrink(t, BATTLE_FEET / t.feet, 'nearest');
    return { ...s, hip: Math.round(s.feet * spec.hip) };
  };
  const sw = small(west);
  const base = stripOutline(decode(sw), sw.pal);
  // The legs: the trousers' and boots' colours, as the front view has them, below the hip.
  const legCols = legColours(small(south));
  const below = cut(base, 0, sw.hip, sw.w, sw.h);
  const legs = byColour(below, legCols, true);
  const upper: Layer = { ...base, px: base.px.slice() };
  for (let y = sw.hip; y < sw.h; y++) for (let x = 0; x < sw.w; x++) if (legCols.has(upper.px[y * sw.w + x] ?? -1)) upper.px[y * sw.w + x] = -1;
  const cols = span(legs) ?? [0, sw.w - 1];
  const hipX = (cols[0] + cols[1]) / 2 + 0.5;

  // Every frame shares one canvas, with the soles on its second-to-last row (the outline takes the last).
  const W = sw.w + PAD_X * 2;
  const H = PAD_TOP + sw.h + 1;
  const draw = (layers: Layer[], dy = 0): HTMLCanvasElement => renderLayers(layers, sw.pal, W, H, PAD_X, PAD_TOP + dy);

  const chest = Math.round(sw.feet * spec.chest);
  const idle = [draw([base]), draw([stretch(base, [chest])]), draw([stretch(base, [chest, chest - 7])])];

  // Side on: the legs part about the hip, each shifted a pixel its way, the far one darker and behind.
  const STRIDE = 34;
  const near = (deg: number): Layer => {
    const r = rotSprite(legs, deg, hipX, sw.hip);
    return { ...r, ox: r.ox + Math.sign(deg) };
  };
  const far = (deg: number): Layer => {
    const r = rotSprite(darker(legs, sw.pal), deg, hipX, sw.hip);
    return { ...r, ox: r.ox + Math.sign(deg) };
  };
  // Facing left: forward is -x, so the near leg's forward swing is a negative turn.
  const walk = [
    draw([far(STRIDE), upper, near(-STRIDE)]),
    draw([upper, legs], -1),
    draw([far(-STRIDE), upper, near(STRIDE)]),
    draw([upper, legs], -1),
  ];
  return { base: idle[0] as HTMLCanvasElement, idle, walk, headPx: H - headRowOf(idle[0] as HTMLCanvasElement), w: W, h: H };
}
