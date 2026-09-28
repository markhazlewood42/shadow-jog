/** The victory banner: VICTORY at 3x, sliding in with a light sweep and an underline. */
import { surface, type Ctx } from '../../engine/canvas';
import { drawText } from '../../engine/font';
import { W } from '../../engine/game';
import { UI } from '../../ui/draw';

const buf = surface(120, 12);

/** VICTORY at 3x: slides in on an ease-out, a light sweep crosses it, a rule underlines it. */
export function drawVictoryBanner(ctx: Ctx, t: number): void {
  const text = 'VICTORY';
  buf.ctx.clearRect(0, 0, buf.canvas.width, buf.canvas.height);
  const tw = drawText(buf.ctx, text, 1, 1, { color: UI.amber, shadow: '#3a1a08' }) + 2;
  const k = 3, bw = tw * k, bh = 12 * k;
  const ease = 1 - (1 - Math.min(1, t / 12)) ** 3;
  const x = Math.round(-bw + ((W - bw) / 2 + bw) * ease), y = 58;
  ctx.fillStyle = 'rgba(8,6,16,0.55)';
  ctx.fillRect(0, y - 6, W, bh + 10);
  ctx.fillStyle = UI.amber;
  ctx.fillRect(0, y + bh + 3, Math.round(W * ease), 1);
  ctx.drawImage(buf.canvas, 0, 0, tw, 12, x, y, bw, bh);
  // The sweep: a white band clipped to the letters.
  const sx = ((t - 10) * 9) % (bw + 60) - 30;
  if (t > 10 && sx < bw) {
    buf.ctx.globalCompositeOperation = 'source-atop';
    buf.ctx.fillStyle = '#fff6d8';
    buf.ctx.fillRect(sx / k, 0, 4, 12);
    buf.ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(buf.canvas, 0, 0, tw, 12, x, y, bw, bh);
  }
}
