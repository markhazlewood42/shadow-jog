/** Field drawing helpers: the draw list's entries, culling, layer blits, emotes. */
import type { Ctx } from '../../engine/canvas';
import { drawText, measure } from '../../engine/font';
import { W, H } from '../../engine/game';
import type { Actor } from '../../field/actor';
import type { SortedSprite } from '../../field/bake';
import { clipToScreen, type Rect } from '../../field/overrects';
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

/** Draw the camera window of a map-sized layer, handling maps smaller than the screen. */
export function blit(ctx: Ctx, layer: HTMLCanvasElement, cx: number, cy: number): void {
  const sx = Math.max(0, cx), sy = Math.max(0, cy);
  const dx = sx - cx, dy = sy - cy;
  const w = Math.min(layer.width - sx, W - dx);
  const h = Math.min(layer.height - sy, H - dy);
  if (w <= 0 || h <= 0) return;
  ctx.drawImage(layer, sx, sy, w, h, dx, dy, w, h);
}

/**
 * Draw only the `parts` of a map-sized layer that hold anything (`field/overrects.ts`): the same picture
 * as `blit`, without copying the clear parts. `scratch` is a rectangle the caller keeps, so no frame allocates.
 */
export function blitParts(ctx: Ctx, layer: HTMLCanvasElement, cx: number, cy: number, parts: Rect[], scratch: Rect): void {
  for (const part of parts) {
    if (clipToScreen(part, cx, cy, W, H, scratch)) ctx.drawImage(layer, scratch.x, scratch.y, scratch.w, scratch.h, scratch.x - cx, scratch.y - cy, scratch.w, scratch.h);
  }
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
