import { buildChar, type Dir } from '../art/chars';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { LOOKS, randomLook } from '../data/looks';

/** Dev scene: character sprite sheet. ?scene=chars[&zoom=3] */
export class CharTestScene extends Scene {
  constructor(private zoom = 2, private npcs = false) {
    super();
  }
  update(): void {}
  render(ctx: Ctx): void {
    ctx.fillStyle = '#3a3f5c';
    ctx.fillRect(0, 0, W, H);
    const z = this.zoom;
    const dirs: Dir[] = ['down', 'left', 'right', 'up'];
    if (this.npcs) {
      for (let i = 0; i < 40; i++) {
        const s = buildChar(randomLook(i));
        const x = 8 + (i % 20) * 23;
        const y = 10 + Math.floor(i / 20) * 60;
        ctx.drawImage(s.frames.down[0]!, x, y, s.w * z, s.h * z);
      }
      return;
    }
    const entries = Object.entries(LOOKS);
    entries.forEach(([name, look], row) => {
      const s = buildChar(look);
      const perRow = Math.floor(W / ((s.w + 2) * z * 12));
      void perRow;
      const col = row % 2;
      const r = Math.floor(row / 2);
      const bx = 4 + col * 240;
      const by = 4 + r * (26 * z + 10);
      drawText(ctx, name, bx, by, { color: '#fff' });
      let x = bx + 34;
      for (const d of dirs) {
        for (let f = 0; f < 3; f++) {
          const fr = s.frames[d][f]!;
          ctx.drawImage(fr, x, by, fr.width * z, fr.height * z);
          x += fr.width * z - 6;
        }
        x += 2;
      }
    });
  }
}
