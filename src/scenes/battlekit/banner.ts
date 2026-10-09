/** The victory banner: VICTORY at 3x, sliding in with a light sweep and an underline. */
import { surface, type Ctx } from '../../engine/canvas';
import { drawText } from '../../engine/font';
import { UI } from '../../ui/draw';
import { HUD, VICTORY_ROWS, VICTORY_SCALE } from './geom';

const buf = surface(120, VICTORY_ROWS);

/**
 * VICTORY at 3x: slides in on an ease-out, a light sweep crosses it, a rule underlines it. The
 * band, the letters and the rule sit in the HUD frame (its top is `HUD.victoryBannerY`); the
 * letters slide in from the screen's left edge.
 */
export function drawVictoryBanner(ctx: Ctx, t: number): void {
  const text = 'VICTORY';
  const fr = HUD.frame;
  buf.ctx.clearRect(0, 0, buf.canvas.width, buf.canvas.height);
  const tw = drawText(buf.ctx, text, 1, 1, { color: UI.amber, shadow: '#3a1a08' }) + 2;
  const k = VICTORY_SCALE, bw = tw * k, bh = VICTORY_ROWS * k;
  const ease = 1 - (1 - Math.min(1, t / 12)) ** 3;
  const rest = fr.x + (fr.w - bw) / 2, y = HUD.victoryBannerY;
  const x = Math.round(-bw + (rest + bw) * ease);
  const band = HUD.victoryBandRect();
  ctx.fillStyle = 'rgba(8,6,16,0.55)';
  ctx.fillRect(band.x, band.y, band.w, band.h);
  ctx.fillStyle = UI.amber;
  ctx.fillRect(fr.x, y + bh + 3, Math.round(fr.w * ease), 1);
  ctx.drawImage(buf.canvas, 0, 0, tw, VICTORY_ROWS, x, y, bw, bh);
  // The sweep: a white band clipped to the letters.
  const sx = ((t - 10) * 9) % (bw + 60) - 30;
  if (t > 10 && sx < bw) {
    buf.ctx.globalCompositeOperation = 'source-atop';
    buf.ctx.fillStyle = '#fff6d8';
    buf.ctx.fillRect(sx / k, 0, 4, VICTORY_ROWS);
    buf.ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(buf.canvas, 0, 0, tw, VICTORY_ROWS, x, y, bw, bh);
  }
}
