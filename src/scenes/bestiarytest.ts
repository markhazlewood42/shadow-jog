import { enemyArt, ENEMY_ART_KEYS } from '../art/enemies';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';

/** Dev scene: all enemy sprites at battle scale (2x). ?scene=bestiary[&page=1] */
export class BestiaryTestScene extends Scene {
  constructor(private page = 0) {
    super();
  }
  update(): void {}
  render(ctx: Ctx): void {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a1830');
    g.addColorStop(1, '#3a3050');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const keys = this.page === 0 ? ENEMY_ART_KEYS.filter((k) => !['lurker', 'warden', 'warden_spirit'].includes(k)) : ['lurker', 'warden', 'warden_spirit'];
    let x = 6, y = 6, rowH = 0;
    for (const k of keys) {
      const a = enemyArt(k);
      const w = a.w * 2, h = a.h * 2;
      if (x + w > W - 4) { x = 6; y += rowH + 12; rowH = 0; }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(a.canvas, x, y, w, h);
      if (a.glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(a.glow, x, y, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
      drawText(ctx, k, x, y + h + 1, { color: '#8b8fa8' });
      x += Math.max(w, 30) + 8;
      rowH = Math.max(rowH, h);
    }
  }
}
