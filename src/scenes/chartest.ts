import { battler, POSES } from '../art/battlers';
import { buildChar, type Dir } from '../art/chars';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { LOOKS, randomLook } from '../data/looks';

/** Dev scene: character sprite sheet. ?scene=chars[&zoom=3][&npcs][&battlers] */
export class CharTestScene extends Scene {
  constructor(private zoom = 2, private npcs = false, private battlers = false) {
    super();
  }
  update(): void {}
  render(ctx: Ctx): void {
    ctx.fillStyle = '#3a3f5c';
    ctx.fillRect(0, 0, W, H);
    const z = this.zoom;
    const dirs: Dir[] = ['down', 'left', 'right', 'up'];
    if (this.battlers) {
      // Party battle poses at battle scale (x2 to screen, as in a fight).
      (['kit', 'rook', 'hex', 'sable'] as const).forEach((id, row) => {
        const b = battler(id, LOOKS[id]);
        drawText(ctx, id, 4, 6 + row * 66, { color: '#fff' });
        POSES.forEach((p, i) => {
          const fr = b.frames[p];
          const x = 36 + i * 49, y = 4 + row * 66;
          ctx.drawImage(fr, x, y, fr.width * 0.8, fr.height * 0.8);
          const g = b.glow[p];
          if (g) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(g, x, y, g.width * 0.8, g.height * 0.8);
            ctx.globalCompositeOperation = 'source-over';
          }
          if (row === 0) drawText(ctx, p, x, H - 10, { color: '#aaa' });
        });
      });
      return;
    }
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
    if (z >= 3) {
      // Close-up lineup of the named cast, front view: faces are what this zoom is for.
      const cast = entries.slice(0, entries.findIndex(([n]) => n === 'mags') + 1);
      let x = 4, y = 6;
      for (const [name, look] of cast) {
        const fr = buildChar(look).frames.down[0]!;
        const w = fr.width * z, h = fr.height * z;
        if (x + w > W) {
          x = 4;
          y += h + 18;
        }
        ctx.drawImage(fr, x, y, w, h);
        drawText(ctx, name, x + w / 2, y + h + 3, { color: '#fff', align: 'center' });
        x += w + 4;
      }
      return;
    }
    entries.forEach(([name, look], row) => {
      const s = buildChar(look);
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
