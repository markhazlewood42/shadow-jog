/**
 * The on-screen notice (the "Something glitched" bar, the saved badge, the news nudge), drawn as an overlay of the top scene.
 * Moved out of `src/main.ts` unchanged so that both entry paths (the old engine, and `?engine=sje` through `src/sje/boot.ts`) draw the same notice.
 */
import type { Ctx } from './engine/canvas';
import { currentNotice } from './engine/errors';
import { drawText, fitText, measure, wrap } from './engine/font';
import { H, W } from './sje/core/size';

export function drawNotice(ctx: Ctx): void {
  const n = currentNotice();
  if (!n) return;
  if (n.tone === 'saved') {
    // Small corner badge; never covers the field HUD.
    ctx.fillStyle = 'rgba(10,9,19,0.8)';
    ctx.fillRect(W - 70, H - 14, 66, 11);
    drawText(ctx, `{c}♦{/} ${n.text}`, W - 66, H - 13, { color: '#b8bcd0' });
    return;
  }
  if (n.tone === 'news') {
    // A nudge along the bottom edge: worth knowing, never in the way.
    const w = Math.min(W - 8, measure(n.text) + 20);
    ctx.fillStyle = 'rgba(10,9,19,0.86)';
    ctx.fillRect(W / 2 - w / 2, H - 16, w, 12);
    drawText(ctx, `{y}★{/} ${fitText(n.text, w - 20)}`, W / 2 - w / 2 + 5, H - 15, { color: '#e8e4ff' });
    return;
  }
  // Up to two wrapped lines; anything longer ends in an ellipsis rather than mid-word.
  // An error keeps its detail (it's what a bug report needs) but leads with what happened in the
  // game's own voice: something broke, and play carried on.
  const text = n.tone === 'warn' ? n.text : `Something glitched, and the game kept going. (${n.text})`;
  const lines = wrap(text, W - 8);
  if (lines.length > 2) lines.splice(1, lines.length - 1, fitText(lines.slice(1).join(' '), W - 8));
  ctx.fillStyle = n.tone === 'warn' ? 'rgba(46,34,6,0.92)' : 'rgba(40,6,16,0.9)';
  ctx.fillRect(0, 0, W, 3 + lines.length * 10);
  for (const [i, ln] of lines.entries()) drawText(ctx, ln, 4, 2 + i * 10, { color: n.tone === 'warn' ? '#ffe0a0' : '#ffb0b0' });
}
