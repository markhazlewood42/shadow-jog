/** The battle intro: the field frame freezes, cracks from the centre, and falls away in shards. */
import type { Ctx } from '../../engine/canvas';
import { H, W } from '../../engine/game';

interface Shard {
  pts: [number, number][];
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * Frames the shatter takes at Normal battle speed: CRACK of cracks racing out over the frozen
 * frame, then the fall. Lengthened after Mark's first playthrough (2026-09-29: "make it longer"),
 * from 6 + 24: the fall is the same motion, played slower.
 */
export const INTRO_T = 52;
const CRACK = 16;
/** The fall as first authored ran 24 frames; it now spans the rest of INTRO_T at the same shapes. */
const FALL_SCALE = 24 / (INTRO_T - CRACK);

export class ShatterIntro {
  private shards: Shard[];

  constructor(private img: CanvasImageSource) {
    this.shards = this.build();
  }

  private build(): Shard[] {
    const cols = 9, rows = 5;
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const grid: [number, number][][] = [];
    for (let j = 0; j <= rows; j++) {
      grid.push([]);
      for (let i = 0; i <= cols; i++) {
        const edge = i === 0 || j === 0 || i === cols || j === rows;
        const jx = edge ? 0 : (rnd() - 0.5) * (W / cols) * 0.7;
        const jy = edge ? 0 : (rnd() - 0.5) * (H / rows) * 0.7;
        grid[j]!.push([(i * W) / cols + jx, (j * H) / rows + jy]);
      }
    }
    const shards: Shard[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = grid[j]![i]!, b = grid[j]![i + 1]!, c = grid[j + 1]![i + 1]!, d = grid[j + 1]![i]!;
        const tris = (i + j) % 2 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const pts of tris as [number, number][][]) {
          const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
          const dx = cx - W / 2, dy = cy - H / 2, len = Math.hypot(dx, dy) || 1;
          const sp = 3 + rnd() * 4;
          shards.push({ pts, cx, cy, vx: (dx / len) * sp, vy: (dy / len) * sp - 2 - rnd() * 2, spin: (rnd() - 0.5) * 0.3 });
        }
      }
    return shards;
  }

  draw(ctx: Ctx, t: number): void {
    const img = this.img;
    if (t < CRACK) {
      // The frame freezes and cracks spread from the centre along the shard seams; the seams
      // glow brighter as they reach the edges, a beat before it all gives way.
      ctx.drawImage(img, 0, 0, W, H);
      ctx.fillStyle = `rgba(10,8,20,${(0.25 * (t / CRACK)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = `rgba(255,255,255,${(0.6 + 0.4 * (t / CRACK)).toFixed(3)})`;
      ctx.lineWidth = 1;
      const reach = Math.min(1, (t + 1) / (CRACK * 0.7)) * Math.hypot(W, H) * 0.55;
      ctx.beginPath();
      for (const sh of this.shards) {
        if (Math.hypot(sh.cx - W / 2, sh.cy - H / 2) > reach) continue;
        const [p0, p1, p2] = sh.pts;
        ctx.moveTo(p0![0], p0![1]);
        ctx.lineTo(p1![0], p1![1]);
        ctx.lineTo(p2![0], p2![1]);
        ctx.closePath();
      }
      ctx.stroke();
      return;
    }
    const k = (t - CRACK) * FALL_SCALE;
    ctx.globalAlpha = Math.max(0, 1 - k / 24);
    for (const sh of this.shards) {
      const ox = sh.vx * k, oy = sh.vy * k + 0.35 * k * k;
      ctx.save();
      ctx.translate(sh.cx + ox, sh.cy + oy);
      ctx.rotate(sh.spin * k);
      ctx.beginPath();
      ctx.moveTo(sh.pts[0]![0] - sh.cx, sh.pts[0]![1] - sh.cy);
      ctx.lineTo(sh.pts[1]![0] - sh.cx, sh.pts[1]![1] - sh.cy);
      ctx.lineTo(sh.pts[2]![0] - sh.cx, sh.pts[2]![1] - sh.cy);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, -sh.cx, -sh.cy, W, H);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
