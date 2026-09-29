/** Dust kicked up by dashing and by stopping out of a dash: pooled, in world coordinates. */
import type { Ctx } from '../../engine/canvas';

const MAX = 40;
const LIFE = 22;

export class Dust {
  private motes: { x: number; y: number; vx: number; vy: number; t: number }[] = [];
  private count = 0;

  /** Puff `n` motes at a foot position (`color`: a dash, which throws them wider). */
  kick(x: number, y: number, n: number, color: boolean): void {
    for (let i = 0; i < n && this.count < MAX; i++) {
      this.motes[this.count] ??= { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
      const d = this.motes[this.count]!;
      d.x = x + (Math.random() - 0.5) * 6;
      d.y = y - Math.random() * 2;
      d.vx = (Math.random() - 0.5) * (color ? 0.9 : 0.5);
      d.vy = -0.15 - Math.random() * 0.35;
      d.t = 0;
      this.count++;
    }
  }

  /** Step and draw every live mote (camera at cx, cy); finished ones are compacted out. */
  render(ctx: Ctx, cx: number, cy: number): void {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const d = this.motes[i]!;
      d.t++;
      d.x += d.vx;
      d.y += d.vy;
      d.vx *= 0.9;
      d.vy *= 0.92;
      if (d.t >= LIFE) continue;
      ctx.globalAlpha = 0.45 * (1 - d.t / LIFE);
      ctx.fillStyle = '#c8bca8';
      const r = d.t < 8 ? 1 : 2;
      ctx.fillRect(Math.round(d.x - cx), Math.round(d.y - cy), r, r);
      this.motes[i] = this.motes[n]!;
      this.motes[n] = d;
      n++;
    }
    ctx.globalAlpha = 1;
    this.count = n;
  }

  /** Motes still in the air (for tests). */
  get live(): number {
    return this.count;
  }
}
