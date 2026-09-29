/** Field drawing helpers: the draw list's entries, culling, the room shell, layer blits, emotes. */
import { surface, type Ctx } from '../../engine/canvas';
import { drawText, measure } from '../../engine/font';
import { W, H } from '../../engine/game';
import type { Actor } from '../../field/actor';
import type { SortedSprite } from '../../field/bake';
import type { Chest } from '../field';
import { UI } from '../../ui/draw';

export interface DrawEntry {
  baseY: number;
  kind: 0 | 1 | 2;
  ref: SortedSprite | Chest | Actor;
}

export const byBaseY = (a: DrawEntry, b: DrawEntry) => a.baseY - b.baseY;

export function inView(a: { x: number; y: number; w: number; h: number }, cx: number, cy: number): boolean {
  return a.x - cx < W && a.y - cy < H && a.x + a.w - cx > 0 && a.y + a.h - cy > 0;
}

let shellPattern: CanvasPattern | null = null;
/** The shadow's steps outward from the room's edge (built once: no strings per frame). */
const SHELL_SHADE = Array.from({ length: 14 }, (_, i) => `rgba(4,3,9,${(0.6 * (1 - i / 14)).toFixed(3)})`);

/**
 * A room smaller than the screen sits inside its building, not in a void: dark brick around it,
 * anchored to the world so it doesn't swim under a shake, with the room's edge cut clean and a
 * shadow falling from it into the shell.
 */
export function drawShell(ctx: Ctx, mw: number, mh: number, cx: number, cy: number): void {
  if (mw >= W && mh >= H) return;
  if (!shellPattern) {
    const s = surface(32, 16);
    const g = s.ctx;
    g.fillStyle = '#100d18';
    g.fillRect(0, 0, 32, 16);
    for (const [bx, by] of [[0, 0], [16, 0], [-8, 8], [8, 8], [24, 8]] as const) {
      g.fillStyle = '#231d31';
      g.fillRect(bx + 1, by + 1, 14, 6);
      g.fillStyle = '#2e263f';
      g.fillRect(bx + 1, by + 1, 14, 1);
      g.fillStyle = '#1b1626';
      g.fillRect(bx + 1, by + 6, 14, 1);
    }
    shellPattern = ctx.createPattern(s.canvas, 'repeat');
  }
  if (!shellPattern) return;
  ctx.save();
  ctx.translate(-cx, -cy);
  ctx.fillStyle = shellPattern;
  ctx.fillRect(cx, cy, W, H);
  ctx.restore();
  const x0 = -cx, y0 = -cy;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = SHELL_SHADE[i]!;
    ctx.fillRect(x0 - i - 1, y0 - i - 1, mw + i * 2 + 2, 1);
    ctx.fillRect(x0 - i - 1, y0 + mh + i, mw + i * 2 + 2, 1);
    ctx.fillRect(x0 - i - 1, y0 - i, 1, mh + i * 2);
    ctx.fillRect(x0 + mw + i, y0 - i, 1, mh + i * 2);
  }
  ctx.fillStyle = '#050409';
  ctx.fillRect(x0 - 2, y0 - 2, mw + 4, 2);
  ctx.fillRect(x0 - 2, y0 + mh, mw + 4, 2);
  ctx.fillRect(x0 - 2, y0, 2, mh);
  ctx.fillRect(x0 + mw, y0, 2, mh);
}

/** Draw the camera window of a map-sized layer, handling maps smaller than the screen. */
export function blit(ctx: Ctx, layer: HTMLCanvasElement, cx: number, cy: number): void {
  const sx = Math.max(0, cx), sy = Math.max(0, cy);
  const dx = sx - cx, dy = sy - cy;
  const w = Math.min(layer.width - sx, W - dx);
  const h = Math.min(layer.height - sy, H - dy);
  if (w <= 0 || h <= 0) return;
  ctx.drawImage(layer, sx, sy, w, h, dx, dy, w, h);
}

export function drawEmote(ctx: Ctx, a: Actor, cx: number, cy: number): void {
  const e = a.emote!;
  const pop = Math.min(1, e.t / 6);
  const x = Math.round(a.px - cx);
  const y = Math.round(a.drawY() - cy - 4 - pop * 4);
  const label = e.kind === 'anger' ? '#' : e.kind === 'sweat' ? ';' : e.kind === 'zzz' ? 'z' : e.kind;
  const tw = measure(label) + 6;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x - tw / 2 - 1, y - 11, tw + 2, 12);
  ctx.fillStyle = '#f4f1ff';
  ctx.fillRect(x - tw / 2, y - 10, tw, 10);
  ctx.fillRect(x - 1, y, 3, 2);
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x - 1, y + 2, 3, 1);
  const col = e.kind === '!' || e.kind === '!!' || e.kind === 'anger' ? '#d8302a' : e.kind === '♥' ? '#ff4fb0' : '#2a2840';
  drawText(ctx, label, x, y - 9, { align: 'center', color: col, shadow: false });
}
