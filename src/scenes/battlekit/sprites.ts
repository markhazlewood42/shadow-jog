/** Battle sprite treatments: silhouettes, rim light, duplicates (palette, mirror, markings), bars, big text. */
import { silhouette, surface, type Ctx } from '../../engine/canvas';
import { drawText } from '../../engine/font';
import { W } from '../../engine/game';

export const silCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
export const topCache = new WeakMap<HTMLCanvasElement, number>();
/** First row with any opaque pixel (sprite canvases carry padding); measured once per canvas. */
/** The trailing "damage ghost" between the shown value and where it was a moment ago. */
export function drawLag(ctx: Ctx, x: number, y: number, w: number, h: number, shown: number, lag: number): void {
  if (lag <= shown + 0.004) return;
  const a = Math.round(w * Math.max(0, shown)), b = Math.round(w * Math.min(1, lag));
  if (b <= a) return;
  ctx.fillStyle = '#ffd7c0';
  ctx.fillRect(x + a, y, b - a, h);
}

export function opaqueTop(c: HTMLCanvasElement): number {
  let top = topCache.get(c);
  if (top === undefined) {
    top = 0;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    scan: for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]! > 0) {
      top = y;
      break scan;
    }
    topCache.set(c, top);
  }
  return top;
}

export const flipCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** Horizontally mirrored copy (cached): every other duplicate enemy faces the other way. */
/** How long an enemy's action pose runs, in frames. */
export const ENEMY_POSE_T = 30;

/**
 * Markings that make a second or third enemy an individual, not a recolour: machines carry a
 * stencilled unit number and a hazard stripe, beasts a scar, spirits a cluster of bright motes,
 * humans a squad-coloured armband.
 * Painted only onto opaque pixels, near the body's middle.
 */
export const markCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
export const DIGITS: Record<string, string[]> = {
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '011', '001', '111'], '4': ['101', '101', '111', '001', '001'],
};
export function marked(src: HTMLCanvasElement, family: string, dup: number): HTMLCanvasElement {
  if (dup === 0 || !['machine', 'beast', 'spirit', 'human'].includes(family)) return src;
  let m = markCache.get(src);
  if (!m) {
    m = new Map();
    markCache.set(src, m);
  }
  const key = `${family}:${dup}`;
  let c = m.get(key);
  if (c) return c;
  const w = src.width, h = src.height;
  const s = surface(w, h);
  s.ctx.drawImage(src, 0, 0);
  const data = s.ctx.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 200;
  // Opaque bounds, to find the body's middle.
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = Math.round((x0 + x1) / 2), cy = Math.round(y0 + (y1 - y0) * 0.45);
  const dot = (x: number, y: number, col: string) => {
    if (!solid(x, y)) return;
    s.ctx.fillStyle = col;
    s.ctx.fillRect(x, y, 1, 1);
  };
  if (family === 'machine') {
    const glyph = DIGITS[String(Math.min(4, dup + 1))]!;
    const gx = cx - 5, gy = cy - 2;
    for (let j = 0; j < glyph.length; j++) {
      for (let i = 0; i < 3; i++) if (glyph[j]![i] === '1') dot(gx + i, gy + j, '#f0e8c8');
    }
    for (let i = 0; i < 5; i++) dot(cx + 2 + i, cy - 4 + i, i % 2 ? '#1a1820' : '#ffcc3d');
  } else if (family === 'human') {
    // A unit armband in a squad colour across the upper arm (the sprite's left third, a little
    // above the middle), 3px deep so it survives the 2x scale: two guards are 'yellow' and 'cyan'.
    const band = ['#ffcc3d', '#3fe0f0', '#ff6a9a'][(dup - 1) % 3]!;
    const bx0 = x0 + Math.round((x1 - x0) * 0.08), bx1 = x0 + Math.round((x1 - x0) * 0.34);
    const by = Math.round(y0 + (y1 - y0) * 0.36);
    for (let y = by; y < by + 3; y++) for (let x = bx0; x <= bx1; x++) dot(x, y, y === by + 1 ? band : '#1a1820');
  } else if (family === 'beast') {
    const dir = dup % 2 ? 1 : -1;
    for (let i = 0; i < 6; i++) dot(cx + dir * (i - 2), cy - 3 + i, i % 3 === 1 ? '#f0c0b8' : '#c07878');
  } else {
    for (const [dx, dy] of [[-3, -2], [2, -3], [0, 2], [4, 1]] as const) dot(cx + dx * dup, cy + dy, '#ffffff');
  }
  c = s.canvas;
  m.set(key, c);
  return c;
}

/** Rim-light colour per battle backdrop: a light the enemies catch that the set doesn't have. */
export const RIM: Record<string, string> = {
  street: '#ffc27a', barrens: '#9ae8ff', rustyard: '#9ae8ff', park: '#ffd0f0',
  sewer: '#ffcf7a', junction: '#ffcf7a', lab: '#ff6a7a', core: '#8ae8ff',
};

export const rimCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
/** A 1px rim on a sprite's top edges and upper sides, on a canvas 2px larger. */
export function rimOf(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let m = rimCache.get(src);
  if (!m) {
    m = new Map();
    rimCache.set(src, m);
  }
  let c = m.get(color);
  if (!c) {
    const w = src.width, h = src.height;
    const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
    const op = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 40;
    const s = surface(w + 2, h + 2);
    s.ctx.fillStyle = color;
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        // Light from above: every top edge, and the sides only on the upper half.
        if (op(x, y)) continue;
        if (op(x, y + 1) || (y < h * 0.5 && (op(x - 1, y) || op(x + 1, y)))) s.ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    c = s.canvas;
    m.set(color, c);
  }
  return c;
}

export function mirrored(src: HTMLCanvasElement): HTMLCanvasElement {
  let c = flipCache.get(src);
  if (!c) {
    const s = surface(src.width, src.height);
    s.ctx.translate(src.width, 0);
    s.ctx.scale(-1, 1);
    s.ctx.drawImage(src, 0, 0);
    c = s.canvas;
    flipCache.set(src, c);
  }
  return c;
}

/**
 * The n-th copy of an enemy in a fight gets its own look: a shifted palette (and every other
 * copy faces the other way), so a pair reads as two individuals, not twins. Cached per copy.
 */
export const variantCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
export const VARIANT_FILTERS = ['', 'hue-rotate(32deg) saturate(1.2) brightness(0.9)', 'hue-rotate(-38deg) saturate(1.1) brightness(1.05)', 'hue-rotate(80deg) brightness(0.92)'];
export function variant(src: HTMLCanvasElement, dup: number): HTMLCanvasElement {
  if (dup === 0) return src;
  let list = variantCache.get(src);
  if (!list) {
    list = [];
    variantCache.set(src, list);
  }
  let v = list[dup];
  if (!v) {
    const s = surface(src.width, src.height);
    s.ctx.filter = VARIANT_FILTERS[dup % VARIANT_FILTERS.length] || 'none';
    s.ctx.drawImage(dup % 2 ? mirrored(src) : src, 0, 0);
    v = s.canvas;
    list[dup] = v;
  }
  return v;
}

const thumbCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** A 12×12 head-and-shoulders crop of an enemy sprite (the turn-order strip), at its pixel scale. */
export function enemyThumb(src: HTMLCanvasElement): HTMLCanvasElement {
  let c = thumbCache.get(src);
  if (!c) {
    const s = Math.min(src.width, 24);
    const top = opaqueTop(src);
    const t = surface(12, 12);
    t.ctx.imageSmoothingEnabled = false;
    t.ctx.drawImage(src, Math.floor((src.width - s) / 2), top, s, s, 0, 0, 12, 12);
    c = t.canvas;
    thumbCache.set(src, c);
  }
  return c;
}

export const DISSOLVE_STEPS = 10;
const dissolveCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
/**
 * A defeated enemy breaking up: `step` of DISSOLVE_STEPS, in 2px blocks (the sprites' pixel
 * scale), with a hot-pink edge eating in ahead of the gaps. The sprite's own detail stays until
 * the pixels go, so every frame of a kill still reads as that enemy.
 */
export function dissolved(src: HTMLCanvasElement, step: number): HTMLCanvasElement {
  let list = dissolveCache.get(src);
  if (!list) {
    list = [];
    dissolveCache.set(src, list);
  }
  const hit = list[step];
  if (hit) return hit;
  const w = src.width, h = src.height;
  const s = surface(w, h);
  s.ctx.drawImage(src, 0, 0);
  const img = s.ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const cut = step / DISSOLVE_STEPS;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      // Per-block noise, biased so the top goes first (the body drains downward).
      const bx = x >> 1, by = y >> 1;
      const n = (((bx * 73856093) ^ (by * 19349663)) >>> 0) % 1000 / 1000 * 0.75 + (1 - y / h) * 0.25;
      if (n < cut) d[i + 3] = 0;
      else if (n < cut + 0.1) {
        d[i] = 255;
        d[i + 1] = 79;
        d[i + 2] = 176;
      }
    }
  }
  s.ctx.putImageData(img, 0, 0);
  list[step] = s.canvas;
  return s.canvas;
}

export function silhouetteCache(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let m = silCache.get(src);
  if (!m) {
    m = new Map();
    silCache.set(src, m);
  }
  let c = m.get(color);
  if (!c) {
    c = silhouette(src, color);
    m.set(color, c);
  }
  return c;
}

/** Large banner text: the bitmap font drawn at 2× via an offscreen buffer. */
export const bigBuf = surface(W, 12);
export function drawBig(ctx: Ctx, text: string, cx: number, y: number, color: string): void {
  bigBuf.ctx.clearRect(0, 0, W, 12);
  const w = drawText(bigBuf.ctx, text, 1, 1, { color, shadow: '#1a1020' });
  ctx.drawImage(bigBuf.canvas, 0, 0, w + 3, 12, Math.round(cx - w), y, (w + 3) * 2, 24);
}
