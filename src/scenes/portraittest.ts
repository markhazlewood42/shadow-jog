import { getPortrait, PORTRAIT_KEYS } from '../art/portraits';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';

/** Dev scene: portrait sheet (8 characters × 4 expressions). ?scene=portraits[&faces=a,b,c,d] */
export class PortraitTestScene extends Scene {
  constructor(private faces = ['neutral', 'happy', 'angry', 'sad']) {
    super();
  }
  update(): void {}
  render(ctx: Ctx): void {
    ctx.fillStyle = '#141325';
    ctx.fillRect(0, 0, W, H);
    PORTRAIT_KEYS.forEach((k, i) => {
      const col = Math.floor(i / 4), row = i % 4;
      const x0 = 16 + col * 232, y0 = 12 + row * 64;
      drawText(ctx, k, x0, y0, { color: '#8b8fa8' });
      this.faces.forEach((f, j) => ctx.drawImage(getPortrait(k, f)!, x0 + j * 52, y0 + 11));
    });
    void H;
  }
}
