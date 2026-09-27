/** Screen-space weather: rain with ground splashes, dripping water, drifting dust. */
import type { Ctx } from '../engine/canvas';
import { H, W } from '../engine/game';
import { Rng } from '../engine/rng';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  life: number;
  /** Screen y where it lands. */
  land: number;
}

interface Splash {
  x: number;
  y: number;
  t: number;
}

export class Weather {
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private rng = new Rng(77);
  kind: 'rain' | 'drip' | 'dust' | 'none' = 'none';
  intensity = 1;

  set(kind: Weather['kind'], intensity = 1): void {
    this.kind = kind;
    this.intensity = intensity;
    this.drops.length = 0;
    this.splashes.length = 0;
    const n = this.count();
    for (let i = 0; i < n; i++) this.drops.push(this.spawn(true));
  }

  private count(): number {
    switch (this.kind) {
      case 'rain': return Math.round(170 * this.intensity);
      case 'drip': return Math.round(14 * this.intensity);
      case 'dust': return Math.round(50 * this.intensity);
      default: return 0;
    }
  }

  private spawn(anywhere: boolean): Drop {
    const r = this.rng;
    if (this.kind === 'dust') {
      return { x: r.range(0, W), y: r.range(0, H), len: r.int(1, 2), speed: r.range(0.1, 0.35), life: r.int(200, 600), land: H + 10 };
    }
    const speed = this.kind === 'drip' ? r.range(2.5, 3.5) : r.range(5.5, 8);
    return {
      x: r.range(-40, W + 10),
      y: anywhere ? r.range(-20, H) : r.range(-40, -5),
      len: this.kind === 'drip' ? 3 : r.int(5, 9),
      speed,
      life: 0,
      land: r.range(20, H + 30),
    };
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
        if (d.life <= 0 || d.x > W + 5 || d.x < -5 || d.y < -5 || d.y > H + 5) this.drops[i] = { ...this.spawn(true), x: -2 };
        continue;
      }
      d.y += d.speed - dy;
      d.x += d.speed * 0.28 - dx;
      if (d.y >= d.land) {
        if (d.land < H && this.splashes.length < 60) this.splashes.push({ x: d.x, y: d.land, t: 0 });
        this.drops[i] = this.spawn(false);
      }
    }
    for (const s of this.splashes) {
      s.t++;
      s.x -= dx;
      s.y -= dy;
    }
    this.splashes = this.splashes.filter((s) => s.t < 10);
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
    ctx.globalAlpha = this.kind === 'drip' ? 0.6 : 0.32;
    ctx.fillStyle = '#b8c8ff';
    for (const d of this.drops) {
      const x = Math.round(d.x), y = Math.round(d.y);
      // Slanted streak: 1px wide, drawn as a short diagonal.
      for (let k = 0; k < d.len; k++) ctx.fillRect(x - Math.round(k * 0.28), y - k, 1, 1);
    }
    ctx.globalAlpha = 0.5;
    for (const s of this.splashes) {
      const r = 1 + (s.t >> 2);
      ctx.fillRect(Math.round(s.x - r), Math.round(s.y), 1, 1);
      ctx.fillRect(Math.round(s.x + r), Math.round(s.y), 1, 1);
      if (s.t < 4) ctx.fillRect(Math.round(s.x), Math.round(s.y - 1), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
}
