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

/** A native-resolution trace made `m` times bigger by nearest (m between 1 and 2: every so often a row or column is drawn twice). */
function stretchTo(t: Traced, m: number): Traced {
  if (m === 1) return t;
  const src = decode(t).px;
  const w = Math.round(t.w * m);
  const h = Math.round(t.h * m);
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      const p = src[Math.min(t.h - 1, Math.floor((y + 0.5) / m)) * t.w + Math.min(t.w - 1, Math.floor((x + 0.5) / m))] ?? -1;
      r += p < 0 ? '.' : (PAL_CH[p] ?? '.');
    }
    rows.push(r);
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
  const t = native ? stretchTo(collapseBlocks(full), native) : full;
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
