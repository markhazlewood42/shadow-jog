/** UI drawing primitives: framed windows, bars, cursors, icons. */
import type { Ctx } from '../engine/canvas';
import { drawText, measure } from '../engine/font';

export const UI = {
  outline: '#07060d',
  frame: '#4a4f86',
  frameLit: '#7a80c4',
  fillTop: '#1c1a3a',
  fillBot: '#0d0c1f',
  inner: '#2c2a58',
  cyan: '#3fe0f0',
  pink: '#ff4fb0',
  amber: '#ffcc3d',
  green: '#62e06a',
  red: '#ff5a5a',
  violet: '#b07cff',
  dim: '#8b8fa8',
  text: '#f4f1ff',
  select: 'rgba(63,224,240,0.16)',
  disabled: '#5d6080',
};

export interface WindowOpts {
  accent?: string | undefined;
  title?: string | undefined;
  alpha?: number | undefined;
  /** Skip corner accents (compact popups). */
  plain?: boolean | undefined;
}

const gradCache = new Map<string, CanvasGradient>();

export function drawWindow(ctx: Ctx, x: number, y: number, w: number, h: number, opts: WindowOpts = {}): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const accent = opts.accent ?? UI.cyan;
  const alpha = opts.alpha ?? 0.95;
  ctx.save();
  // Drop shadow
  ctx.globalAlpha = 0.45 * alpha;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x + 2, y + 2, w, h);
  // Body
  ctx.globalAlpha = alpha;
  const key = `${y}:${h}`;
  let g = gradCache.get(key);
  if (!g) {
    g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, UI.fillTop);
    g.addColorStop(1, UI.fillBot);
    gradCache.set(key, g);
  }
  ctx.fillStyle = g;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // Scanlines
  ctx.globalAlpha = 0.07 * alpha;
  ctx.fillStyle = '#000';
  for (let yy = y + 3; yy < y + h - 2; yy += 2) ctx.fillRect(x + 2, yy, w - 4, 1);
  ctx.globalAlpha = 1;
  // Outline + frame
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = UI.frame;
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + 1, y + 1, 1, h - 2);
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
  ctx.fillStyle = UI.inner;
  ctx.fillRect(x + 2, y + 2, w - 4, 1);
  if (!opts.plain) {
    // Neon corner brackets
    ctx.fillStyle = accent;
    ctx.fillRect(x + 1, y + 1, 7, 1);
    ctx.fillRect(x + 1, y + 1, 1, 5);
    ctx.fillRect(x + w - 8, y + h - 2, 7, 1);
    ctx.fillRect(x + w - 2, y + h - 6, 1, 5);
    ctx.fillStyle = UI.pink;
    ctx.fillRect(x + w - 5, y + 1, 3, 1);
    ctx.fillRect(x + w - 9, y + 1, 2, 1);
  }
  ctx.restore();
  if (opts.title) drawTab(ctx, x + 6, y - 5, opts.title, accent);
}

/** Small label tab that sits on a window's top edge. */
export function drawTab(ctx: Ctx, x: number, y: number, label: string, accent = UI.cyan): void {
  const w = measure(label) + 8;
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x - 1, y - 1, w + 2, 12);
  ctx.fillStyle = '#12112a';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 2, 10);
  drawText(ctx, label, x + 5, y + 1, { color: accent });
}

export function drawBar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: string,
  back = '#241f3a',
): void {
  ratio = Math.max(0, Math.min(1, ratio));
  ctx.fillStyle = UI.outline;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * ratio);
  if (fw > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, fw, h);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, fw, 1);
    ctx.globalAlpha = 1;
  }
}

export function hpColor(ratio: number): string {
  if (ratio > 0.5) return UI.green;
  if (ratio > 0.25) return UI.amber;
  return UI.red;
}

/** Animated selection cursor (a neon chevron that nudges horizontally). */
export function drawCursor(ctx: Ctx, x: number, y: number, frame: number, color = UI.cyan): void {
  const dx = Math.round(Math.sin(frame * 0.18) * 1.5);
  drawText(ctx, '▶', x + dx, y, { color });
}

/** Down-arrow "more" indicator (blinking). */
export function drawMore(ctx: Ctx, x: number, y: number, frame: number, color = UI.cyan): void {
  if (Math.floor(frame / 20) % 2 === 0) drawText(ctx, '▼', x, y, { color });
}

/** Highlight bar behind a selected row. */
export function drawSelect(ctx: Ctx, x: number, y: number, w: number, h = 11, color = UI.select): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function drawDivider(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.fillStyle = UI.inner;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = '#0a0918';
  ctx.fillRect(x, y + 1, w, 1);
}

/** A horizontal band that fades out at both ends (banner backing). */
export function bandGradient(ctx: Ctx, x: number, w: number, edge: number, alpha: number): CanvasGradient {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(10,8,20,0)');
  g.addColorStop(edge, `rgba(10,8,20,${alpha})`);
  g.addColorStop(1 - edge, `rgba(10,8,20,${alpha})`);
  g.addColorStop(1, 'rgba(10,8,20,0)');
  return g;
}
