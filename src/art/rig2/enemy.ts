/**
 * Enemies by rig v2: the redraw Mark picked for each ("redraw of today's design"), traced, and the
 * rest in code. The outline is drawn after posing; the strike frame leans the enemy in toward the
 * party and the flinch tips it back (RotSprite, about its feet), which the battle plays with its
 * own lunge, shake and flash; the bright, saturated pixels (eyes, lamps, cores) glow at night.
 * A second copy in one fight is mirrored and marked rather than palette-shifted (`individual`).
 */
import type { EnemyArt } from '../enemies';
import { decode, renderLayers, rotSprite } from './rig';
import { ENEMY_TRACED } from './data';

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
  const t = ENEMY_TRACED[sprite];
  if (!t) return null;
  // Room around the trace for a leaning pose.
  const pad = 6;
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
    shadow: base.shadow,
    individual: true,
    glow: lit ? glow : undefined,
    attack: { canvas: attack, glow: lit ? glowOf(attack) : undefined },
    hurt: { canvas: hurt, glow: lit ? glowOf(hurt) : undefined },
  };
}
