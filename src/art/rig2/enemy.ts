/**
 * Enemies by rig v2: the redraw Mark picked for each ("redraw of today's design"), traced, and the
 * rest in code. The outline is drawn after posing; the strike frame leans the enemy in toward the
 * party and the flinch tips it back (RotSprite, about its feet), which the battle plays with its
 * own lunge, shake and flash; the bright, saturated pixels (eyes, lamps, cores) glow at night.
 * A second copy in one fight is mirrored and marked rather than palette-shifted (`individual`).
 */
import type { EnemyArt } from '../enemies';
import { decode, renderLayers, rotSprite, type Traced } from './rig';
import { ENEMY_TRACED } from './data';

/**
 * Sprites drawn smaller than their trace, by how many pixels per native pixel they get (1 = the
 * trace's own native resolution, 1.25 = a quarter bigger). Empty in the game; the side-view battle
 * spike fills it (`?battle=side`, DEV only) so a 91 px humanoid doesn't tower over a 47 px crew.
 * The traces are drawn in roughly 2x2 pixel blocks, so "native" is the trace collapsed by two.
 */
const REDUCED = new Map<string, number>();
export const reduceEnemies = (sprites: readonly string[], native: number): void => {
  for (const s of sprites) REDUCED.set(s, native);
};

/**
 * Sprite Fusion side view (round 2 of F-sf-layout): enemies that get `finishTrace` after they are scaled, so they sit beside Mark's hard-outlined crew
 * instead of looking like another game. `flip` is the subset turned to face LEFT, toward a party standing on the left.
 */
const FINISHED = new Map<string, { flip: boolean }>();
export const finishEnemies = (sprites: readonly string[], flip: readonly string[] = []): void => {
  for (const s of sprites) FINISHED.set(s, { flip: flip.includes(s) });
};

/**
 * Sprite Fusion side view (round 4): enemies whose dark tones are lifted toward light by a fraction, so a dark-bodied sprite (the ghoul: grey-green on a navy
 * street) keeps a silhouette beside the crew. Data, applied to the palette only (outline and bright accents are left alone).
 */
const LIFTED = new Map<string, number>();
export const liftEnemies = (sprites: readonly string[], by: number): void => {
  for (const s of sprites) LIFTED.set(s, by);
};
const liftHex = (hex: string, by: number): string => {
  if (lumOf(hex) > 150 || satOf(hex) > 110) return hex;
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * by));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/** The dark line round the crew's sprites (and the code-drawn art's own outline colour). */
const ENEMY_OUTLINE = '#07060c';
/** RGB distance within which two shades of one enemy count as one (round 3: 20 -> 30, so a material folds into a ramp of a few shades, as the crew's clean-up does). */
const ENEMY_MERGE = 30;

/**
 * Face clean-up for a trace at its NATIVE resolution (round 3; the pixel artist's note that the punks' eyes read as closed slashes and their cheeks as
 * speckle). Data, applied before scaling and flipping: `flat` turns every non-skin-coloured pixel of a box (the cheek noise) into one skin tone, and `set`
 * puts single pixels (an eye is a white pixel beside a dark one, a brow a dark pixel over it). Characters are palette letters of that sprite's trace.
 */
export interface FaceFix {
  flat?: { box: [number, number, number, number]; skin: string; keep: string };
  set: [number, number, string][];
  /** Round 4: turn the head toward the way the figure faces (the trace is a front view). Rows `y0` to `y1` slide `dx` pixels sideways (positive = toward the club), the body stays. */
  turn?: { y0: number; y1: number; dx: number };
}
export const FACE_FIX: Record<string, FaceFix> = {
  // The punk's face (36x46 collapsed, club on the right, so it looks right: pupil on the right of each eye). `keep` lists the shades that stay in the box.
  punk: { flat: { box: [8, 10, 18, 17], skin: 'x', keep: 'xtusnk01' }, set: [[10, 14, 'D'], [11, 14, '0'], [16, 14, 'D'], [17, 14, '0'], [10, 13, '0'], [11, 13, '0'], [16, 13, '0'], [17, 13, '0']], turn: { y0: 0, y1: 17, dx: 2 } },
};
export function fixFace(t: Traced, fix: FaceFix | undefined): Traced {
  if (!fix) return t;
  const rows = t.rows.map((r) => r.split(''));
  const f = fix.flat;
  if (f) for (let y = f.box[1]; y <= f.box[3]; y++) for (let x = f.box[0]; x <= f.box[2]; x++) { const c = rows[y]?.[x]; if (c && c !== '.' && !f.keep.includes(c)) (rows[y] as string[])[x] = f.skin; }
  for (const [x, y, c] of fix.set) if (rows[y]?.[x] !== undefined) (rows[y] as string[])[x] = c;
  const turn = fix.turn;
  if (turn)
    for (let y = turn.y0; y <= turn.y1; y++) {
      const r = rows[y];
      if (!r) continue;
      rows[y] = r.map((_, x) => r[x - turn.dx] ?? '.');
    }
  return { ...t, rows: rows.map((r) => r.join('')) };
}
const lumOf = (hex: string): number => 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);
const satOf = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...c) - Math.min(...c);
};

/**
 * A scaled trace made to read like Mark's Sprite Fusion crew, in three passes on the pixel grid (data in, data out, no hand repair):
 *   1. `flip`: mirror it, so a club or an outstretched arm points at the party on the left.
 *   2. Despeckle: a solid pixel whose colour none of its four neighbours share, with the neighbours agreeing on one other (similar-brightness) colour, takes
 *      that colour. This is the scaler's dither noise (dark specks on a grey leg); a lone bright or saturated pixel (an eye, a lamp) is kept.
 *   3. A 1 px dark outline: every empty pixel beside a solid one becomes outline colour, EXCEPT where the edge pixel is already dark (the trace's own
 *      line), so the line is one pixel wide everywhere and not two. The game's gold rim light is switched off for these sprites (render.ts).
 */
export function finishTrace(t: Traced, flip: boolean): Traced {
  const w = t.w, h = t.h;
  const src = decode(t).px;
  let px: Int16Array = new Int16Array(src);
  if (flip) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = src[y * w + (w - 1 - x)] ?? -1;
  const at = (g: Int16Array, x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (g[y * w + x] ?? -1));
  const lum = t.pal.map(lumOf);
  const sat = t.pal.map(satOf);
  // 2. Despeckle (reads the grid as it was, writes a copy).
  const clean = new Int16Array(px);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = at(px, x, y);
      if (a < 0) continue;
      const nb = [at(px, x - 1, y), at(px, x + 1, y), at(px, x, y - 1), at(px, x, y + 1)].filter((n) => n >= 0);
      if (nb.length < 3 || nb.includes(a)) continue;
      const votes = new Map<number, number>();
      for (const n of nb) votes.set(n, (votes.get(n) ?? 0) + 1);
      const [best, count] = [...votes.entries()].sort((p, q) => q[1] - p[1])[0] ?? [-1, 0];
      if (count < 2 || best < 0) continue;
      if (Math.abs((lum[a] ?? 0) - (lum[best] ?? 0)) > 75 || (sat[a] ?? 0) > 110 || (lum[a] ?? 0) > 200) continue;
      clean[y * w + x] = best;
    }
  px = clean;
  // 2b. Near-duplicate shades fold into the commoner one (the crew's clean-up, at a gentler distance: these palettes are already small), accents kept.
  const count = new Map<number, number>();
  for (const p of px) if (p >= 0) count.set(p, (count.get(p) ?? 0) + 1);
  const accent = (i: number): boolean => (sat[i] ?? 0) > 110 || (lum[i] ?? 0) > 200;
  const dist = (i: number, j: number): number => {
    const a = t.pal[i] ?? '#000000', b = t.pal[j] ?? '#000000';
    return Math.hypot(...[1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16) - parseInt(b.slice(k, k + 2), 16)));
  };
  const kept: number[] = [];
  const into = new Map<number, number>();
  for (const [i] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
    const near = accent(i) ? undefined : kept.find((j) => !accent(j) && dist(i, j) <= ENEMY_MERGE);
    if (near === undefined) kept.push(i);
    into.set(i, near ?? i);
  }
  px = px.map((p) => (p < 0 ? p : (into.get(p) ?? p)));
  // 2c. Majority: a pixel three of whose four neighbours share another, similar shade takes it (a dent or bump one pixel wide in a flat area).
  const maj = new Int16Array(px);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = at(px, x, y);
      if (a < 0) continue;
      const nb = [at(px, x - 1, y), at(px, x + 1, y), at(px, x, y - 1), at(px, x, y + 1)];
      const b = nb.find((n) => n >= 0 && n !== a && nb.filter((m) => m === n).length >= 3);
      if (b === undefined || accent(a) || Math.abs((lum[a] ?? 0) - (lum[b] ?? 0)) > 45) continue;
      maj[y * w + x] = b;
    }
  px = maj;
  // 3. Outline, on a grid one pixel bigger all round.
  const W = w + 2, H = h + 2;
  const out = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(y + 1) * W + x + 1] = px[y * w + x] ?? -1;
  const pal = [...t.pal, ENEMY_OUTLINE];
  const line = pal.length - 1;
  const DARK = 46;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if ((px[(y - 1) * w + x - 1] ?? -1) >= 0 && x >= 1 && y >= 1 && x <= w && y <= h) continue;
      let need = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx - 1, ny = y + dy - 1;
        const n = nx < 0 || ny < 0 || nx >= w || ny >= h ? -1 : (px[ny * w + nx] ?? -1);
        if (n >= 0 && (lum[n] ?? 0) >= DARK) need = true;
      }
      if (need) out[y * W + x] = line;
    }
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let r = '';
    for (let x = 0; x < W; x++) r += (out[y * W + x] ?? -1) < 0 ? '.' : (PAL_CH[out[y * W + x] ?? 0] ?? '.');
    rows.push(r);
  }
  return { ...t, w: W, h: H, feet: t.feet + 1, hip: t.hip + 1, pal, rows };
}

/**
 * A trace brought down to its native resolution: every 2x2 block of pixels becomes one pixel, in the
 * phase (which row and column the blocks start on) where the most blocks are one colour already. A
 * block with fewer than two solid pixels is empty; otherwise it takes its commonest solid colour
 * (the baked warm rim, which is a block wide, survives as a pixel wide). Then pixels with no
 * neighbour (orphans) are dropped. Shrinking by nearest instead takes one pixel of four, and
 * breaks the rim into stairs.
 */
export function collapseBlocks(t: Traced): Traced {
  const src = decode(t).px;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= t.w || y >= t.h ? -1 : (src[y * t.w + x] ?? -1));
  let best = { ox: 0, oy: 0, uniform: -1 };
  for (let oy = 0; oy < 2; oy++)
    for (let ox = 0; ox < 2; ox++) {
      let uniform = 0;
      for (let y = oy; y < t.h - 1; y += 2) for (let x = ox; x < t.w - 1; x += 2) if (at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1)) uniform++;
      if (uniform > best.uniform) best = { ox, oy, uniform };
    }
  const w = Math.ceil((t.w - best.ox) / 2);
  const h = Math.ceil((t.h - best.oy) / 2);
  const px = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const votes = new Map<number, number>();
      let solid = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const p = at(best.ox + x * 2 + dx, best.oy + y * 2 + dy);
        if (p < 0) continue;
        solid++;
        votes.set(p, (votes.get(p) ?? 0) + 1);
      }
      if (solid < 2) continue;
      // The commonest colour (on a tie, the first one met, reading the block left to right, top to bottom).
      px[y * w + x] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    }
  // Orphans: a pixel with nothing above, below or beside it.
  const solidAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (px[y * w + x] ?? -1) >= 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solidAt(x, y) && !solidAt(x - 1, y) && !solidAt(x + 1, y) && !solidAt(x, y - 1) && !solidAt(x, y + 1)) px[y * w + x] = -1;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += (px[y * w + x] ?? -1) < 0 ? '.' : (PAL_CH[px[y * w + x] ?? 0] ?? '.');
    rows.push(r);
  }
  return { ...t, w, h, feet: Math.max(0, Math.round((t.feet - best.oy) / 2)), hip: Math.max(0, Math.round((t.hip - best.oy) / 2)), rows };
}

const PAL_CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * AdvMAME `scale3x`: every pixel becomes 3x3, with the corners of a diagonal edge pulled toward the neighbour they join, so a diagonal stays a
 * diagonal instead of a staircase of 3x3 squares. Colours are palette indexes, -1 empty. Returns the 3x grid.
 */
function scale3x(src: Int16Array, w: number, h: number): Int16Array {
  const W = w * 3;
  const out = new Int16Array(W * h * 3).fill(-1);
  const at = (x: number, y: number, e: number): number => (x < 0 || y < 0 || x >= w || y >= h ? e : (src[y * w + x] ?? -1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const e = src[y * w + x] ?? -1;
      const b = at(x, y - 1, e), d = at(x - 1, y, e), f = at(x + 1, y, e), hh = at(x, y + 1, e);
      const a = at(x - 1, y - 1, e), c = at(x + 1, y - 1, e), g = at(x - 1, y + 1, e), i = at(x + 1, y + 1, e);
      let e0 = e, e1 = e, e2 = e, e3 = e, e5 = e, e6 = e, e7 = e, e8 = e;
      if (b !== hh && d !== f) {
        e0 = d === b ? d : e;
        e1 = (d === b && e !== c) || (b === f && e !== a) ? b : e;
        e2 = b === f ? f : e;
        e3 = (d === b && e !== g) || (d === hh && e !== a) ? d : e;
        e5 = (b === f && e !== i) || (f === hh && e !== c) ? f : e;
        e6 = d === hh ? d : e;
        e7 = (d === hh && e !== i) || (f === hh && e !== g) ? hh : e;
        e8 = f === hh ? f : e;
      }
      const o = [e0, e1, e2, e3, e, e5, e6, e7, e8];
      for (let k = 0; k < 9; k++) out[(y * 3 + Math.floor(k / 3)) * W + x * 3 + (k % 3)] = o[k] ?? -1;
    }
  return out;
}

/**
 * A native-resolution trace made `m` times bigger, `m` from 1 to 2. 2 is every pixel drawn twice. Anything else is `scale3x` (diagonals kept) and then an
 * AREA VOTE: each output pixel looks at the 3/m by 3/m block of the 3x grid it covers and takes the colour with the most area in it (empty unless at
 * least half the block is solid), so the result stays on a whole-pixel grid, keeps its palette (no blends) and no pixel is half as wide as its
 * neighbour. 1.5 is the block-of-two vote (round 1's scaler); 1.25 (round 4) gives a 36x46 punk 45x58, party-sized beside Kit's 64, in the crew's
 * 1 px grain with only the odd row or column drawn a pixel wider.
 */
function stretchTo(t: Traced, m: number): Traced {
  if (m === 1) return t;
  const src = decode(t).px;
  const ch = (p: number): string => (p < 0 ? '.' : (PAL_CH[p] ?? '.'));
  const rows: string[] = [];
  let w = Math.round(t.w * m);
  let h = Math.round(t.h * m);
  if (m === 2) {
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) r += ch(src[Math.min(t.h - 1, y >> 1) * t.w + Math.min(t.w - 1, x >> 1)] ?? -1);
      rows.push(r);
    }
  } else {
    const s3 = scale3x(src, t.w, t.h);
    const W3 = t.w * 3;
    const H3 = t.h * 3;
    const k = 3 / m;
    w = Math.ceil(W3 / k - 1e-6);
    h = Math.ceil(H3 / k - 1e-6);
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) {
        const votes = new Map<number, number>();
        let solid = 0;
        for (let sy = Math.floor(y * k); sy < Math.min(H3, Math.ceil((y + 1) * k)); sy++)
          for (let sx = Math.floor(x * k); sx < Math.min(W3, Math.ceil((x + 1) * k)); sx++) {
            // The share of this 3x pixel that falls inside the block.
            const ox = Math.min(sx + 1, (x + 1) * k) - Math.max(sx, x * k);
            const oy = Math.min(sy + 1, (y + 1) * k) - Math.max(sy, y * k);
            if (ox <= 0 || oy <= 0) continue;
            const p = s3[sy * W3 + sx] ?? -1;
            if (p < 0) continue;
            solid += ox * oy;
            votes.set(p, (votes.get(p) ?? 0) + ox * oy);
          }
        r += solid < (k * k) / 2 ? '.' : ch([...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);
      }
      rows.push(r);
    }
  }
  return { ...t, w, h, feet: Math.round(t.feet * m), hip: Math.round(t.hip * m), rows };
}

/** The glowing parts of a frame: bright and saturated, or near white. */
function glowOf(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  const src = c.getContext('2d')?.getImageData(0, 0, c.width, c.height);
  const g = out.getContext('2d');
  if (!src || !g) return out;
  const img = g.createImageData(c.width, c.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] ?? 0;
    const gr = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;
    const hi = Math.max(r, gr, b);
    const lo = Math.min(r, gr, b);
    if ((d[i + 3] ?? 0) > 0 && ((hi >= 200 && hi - lo >= 110) || r + gr + b >= 720)) {
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

/** Does a canvas have any pixels drawn? */
function anyPixels(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
  if (!d) return false;
  for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 0) return true;
  return false;
}

/**
 * The enemy's art from its traced redraw, or null if it hasn't one. `base` is the code-drawn
 * art's (for how it idles, its shadow and size: those stay the game's).
 */
export function rigEnemy(sprite: string, base: EnemyArt): EnemyArt | null {
  const full = ENEMY_TRACED[sprite];
  if (!full) return null;
  const native = REDUCED.get(sprite);
  const fin = FINISHED.get(sprite);
  const scaled = native ? stretchTo(fixFace(collapseBlocks(full), fin ? FACE_FIX[sprite] : undefined), native) : full;
  const finished = fin ? finishTrace(scaled, fin.flip) : scaled;
  const lift = LIFTED.get(sprite);
  const t = lift ? { ...finished, pal: finished.pal.map((c, i) => (fin && i === finished.pal.length - 1 ? c : liftHex(c, lift))) } : finished;
  // Room around the trace for a leaning pose.
  const pad = native ? Math.max(3, Math.round(3 * native)) : 6;
  const w = t.w + pad * 2;
  const h = t.h + pad;
  const layer = { ...decode(t), ox: pad, oy: pad };
  const feetX = pad + t.w / 2;
  const feetY = pad + t.feet;
  const draw = (deg: number, dy = 0) => renderLayers([deg ? { ...rotSprite(layer, deg, feetX, feetY), oy: rotSprite(layer, deg, feetX, feetY).oy + dy } : layer], t.pal, w, h);
  const canvas = draw(0);
  // Strike: leaning in at the party (toward the bottom of the screen: a forward tip of the top);
  // flinch: tipped back and dropped a pixel.
  const attack = draw(5);
  const hurt = draw(-6, 1);
  const glow = glowOf(canvas);
  const lit = anyPixels(glow);
  return {
    canvas,
    res: 2,
    w: w / 2,
    h: h / 2,
    size: base.size,
    idle: base.idle,
    shadow: native ? Math.round((base.shadow * t.w) / full.w) : base.shadow,
    individual: true,
    glow: lit ? glow : undefined,
    attack: { canvas: attack, glow: lit ? glowOf(attack) : undefined },
    hurt: { canvas: hurt, glow: lit ? glowOf(hurt) : undefined },
  };
}
