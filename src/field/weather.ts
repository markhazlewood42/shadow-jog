/** Screen-space weather: rain in three depth layers with ground splashes, dripping water, drifting dust. */
import type { Ctx } from '../engine/canvas';
import { H, W } from '../sje/core/size';
import { Rng } from '../engine/rng';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  life: number;
  /** Screen y where it lands. */
  land: number;
  /** Rain layer: 0 far, 1 mid, 2 near (see LAYERS). */
  depth: number;
}

interface Splash {
  x: number;
  y: number;
  t: number;
}

/**
 * Rain depth: far streaks are short, faint and slow and drift less when the camera moves; near
 * ones are long, bright and fast and drift more. Only the mid layer lands on the ground we see.
 */
const LAYERS = [
  { share: 0.35, speed: 0.6, len: [3, 4], alpha: 0.16, color: '#8a98c8', parallax: 0.55 },
  { share: 0.5, speed: 1, len: [5, 9], alpha: 0.32, color: '#b8c8ff', parallax: 1 },
  { share: 0.15, speed: 1.45, len: [11, 15], alpha: 0.4, color: '#dce4ff', parallax: 1.4 },
] as const;

/** The area of the old 480x270 field, in pixels: the screen the weather counts below were tuned on. */
const TUNED_AREA = 129_600;
/**
 * The screen is bigger than the field the counts below were tuned on, and the same count over more
 * area looks thin, so every count scales by the area ratio (1.78 at 640x360), and the weather keeps
 * its density per pixel. This is the one place the ratio is made; the counts and the splash cap all
 * go through it.
 */
export const AREA_SCALE = (W * H) / TUNED_AREA;
/** Rain, dust and drips per kind, and the splash cap, at an intensity of 1 (the old counts times `AREA_SCALE`). */
export const RAIN_DROPS = Math.round(190 * AREA_SCALE);
export const DUST_MOTES = Math.round(50 * AREA_SCALE);
export const DRIPS = Math.round(14 * AREA_SCALE);
export const MAX_SPLASHES = Math.round(60 * AREA_SCALE);

export class Weather {
  private drops: Drop[] = [];
  /** Splash pool: the first `splashCount` entries are live; the rest are kept for reuse. */
  private splashes: Splash[] = [];
  private splashCount = 0;
  private rng = new Rng(77);
  kind: 'rain' | 'drip' | 'dust' | 'none' = 'none';
  intensity = 1;

  set(kind: Weather['kind'], intensity = 1): void {
    this.kind = kind;
    this.intensity = intensity;
    this.drops.length = 0;
    this.splashCount = 0;
    const n = this.count();
    // Each drop keeps its depth for life, and the pool is laid out far to near: one pass over
    // it draws back to front, changing style only at the two layer boundaries.
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n);
      const depth = this.kind !== 'rain' ? 1 : k < LAYERS[0].share ? 0 : k < LAYERS[0].share + LAYERS[1].share ? 1 : 2;
      const d: Drop = { x: 0, y: 0, len: 0, speed: 0, life: 0, land: 0, depth };
      this.reset(d, true);
      this.drops.push(d);
    }
  }

  /** Live drops, far layer first (for tests and debugging). */
  get pool(): readonly Readonly<Drop>[] {
    return this.drops;
  }

  /** Splashes on the ground right now. */
  get splashesLive(): number {
    return this.splashCount;
  }

  private count(): number {
    switch (this.kind) {
      case 'rain': return Math.round(RAIN_DROPS * this.intensity);
      case 'drip': return Math.round(DRIPS * this.intensity);
      case 'dust': return Math.round(DUST_MOTES * this.intensity);
      default: return 0;
    }
  }

  /** Re-seed a drop in place (no allocation per respawn). */
  private reset(d: Drop, anywhere: boolean): void {
    const r = this.rng;
    if (this.kind === 'dust') {
      d.x = r.range(0, W);
      d.y = r.range(0, H);
      d.len = r.int(1, 2);
      d.speed = r.range(0.1, 0.35);
      d.life = r.int(200, 600);
      d.land = H + 10;
      d.depth = 1;
      return;
    }
    if (this.kind === 'drip') {
      d.depth = 1;
      d.speed = r.range(2.5, 3.5);
      d.len = 3;
    } else {
      const layer = LAYERS[d.depth]!;
      d.speed = r.range(5.5, 8) * layer.speed;
      d.len = r.int(layer.len[0], layer.len[1]);
    }
    d.x = r.range(-40, W + 10);
    d.y = anywhere ? r.range(-20, H) : r.range(-40, -5);
    d.life = 0;
    d.land = d.depth === 1 ? r.range(20, H + 30) : H + 20;
  }

  private splash(x: number, y: number): void {
    if (this.splashCount >= MAX_SPLASHES) return;
    const s = this.splashes[this.splashCount];
    if (s) {
      s.x = x;
      s.y = y;
      s.t = 0;
    } else this.splashes.push({ x, y, t: 0 });
    this.splashCount++;
  }

  /** dx, dy: camera movement this frame (keeps rain world-anchored when walking). */
  update(dx: number, dy: number): void {
    if (this.kind === 'none') return;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]!;
      if (this.kind === 'dust') {
        d.x += d.speed - dx * 0.8;
        d.y += Math.sin((d.life + i * 40) * 0.02) * 0.2 - dy * 0.8;
        d.life--;
        if (d.life <= 0 || d.x > W + 5 || d.x < -5 || d.y < -5 || d.y > H + 5) {
          this.reset(d, true);
          d.x = -2;
        }
        continue;
      }
      const par = this.kind === 'rain' ? LAYERS[d.depth]!.parallax : 1;
      d.y += d.speed - dy * par;
      d.x += d.speed * 0.28 - dx * par;
      if (d.y >= d.land) {
        if (d.land < H) this.splash(d.x, d.land);
        this.reset(d, false);
      }
    }
    // Age splashes and compact the live ones to the front, in place.
    let n = 0;
    for (let i = 0; i < this.splashCount; i++) {
      const s = this.splashes[i]!;
      s.t++;
      s.x -= dx;
      s.y -= dy;
      if (s.t < 10) {
        this.splashes[i] = this.splashes[n]!;
        this.splashes[n] = s;
        n++;
      }
    }
    this.splashCount = n;
  }

  render(ctx: Ctx): void {
    if (this.kind === 'none') return;
    if (this.kind === 'dust') {
      ctx.fillStyle = '#c8b89a';
      ctx.globalAlpha = 0.35;
      for (const d of this.drops) ctx.fillRect(Math.round(d.x), Math.round(d.y), d.len, 1);
      ctx.globalAlpha = 1;
      return;
    }
    if (this.kind === 'drip') {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#b8c8ff';
      for (const d of this.drops) this.streak(ctx, d);
    } else {
      // One pass, back to front: the pool is ordered by depth, so the style changes twice.
      let layer = -1;
      for (const d of this.drops) {
        if (d.depth !== layer) {
          layer = d.depth;
          ctx.globalAlpha = LAYERS[layer]!.alpha;
          ctx.fillStyle = LAYERS[layer]!.color;
        }
        this.streak(ctx, d);
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#b8c8ff';
    for (let i = 0; i < this.splashCount; i++) {
      const s = this.splashes[i]!;
      const r = 1 + (s.t >> 2);
      ctx.fillRect(Math.round(s.x - r), Math.round(s.y), 1, 1);
      ctx.fillRect(Math.round(s.x + r), Math.round(s.y), 1, 1);
      if (s.t < 4) ctx.fillRect(Math.round(s.x), Math.round(s.y - 1), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** A slanted 1px streak, drawn as a short diagonal. */
  private streak(ctx: Ctx, d: Drop): void {
    const x = Math.round(d.x), y = Math.round(d.y);
    for (let k = 0; k < d.len; k++) ctx.fillRect(x - Math.round(k * 0.28), y - k, 1, 1);
  }
}
