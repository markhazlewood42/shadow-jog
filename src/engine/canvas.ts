/** Offscreen canvas helpers. Every canvas the game makes is pixel-art configured (no smoothing). */

export type Ctx = CanvasRenderingContext2D;

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  w: number;
  h: number;
}

export function surface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx, w: canvas.width, h: canvas.height };
}

/** A surface whose pixels will be read back (getImageData) — hints the browser to keep it on CPU. */
export function pixelSurface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx, w: canvas.width, h: canvas.height };
}

export function flipH(src: HTMLCanvasElement): HTMLCanvasElement {
  const s = surface(src.width, src.height);
  s.ctx.translate(src.width, 0);
  s.ctx.scale(-1, 1);
  s.ctx.drawImage(src, 0, 0);
  return s.canvas;
}

/** Returns a copy of `src` with every opaque pixel painted `color` (keeps alpha). */
export function silhouette(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const s = surface(src.width, src.height);
  s.ctx.drawImage(src, 0, 0);
  s.ctx.globalCompositeOperation = 'source-in';
  s.ctx.fillStyle = color;
  s.ctx.fillRect(0, 0, s.w, s.h);
  return s.canvas;
}

/** Draw a 1px rectangle outline (crisp). */
export function strokeRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** Integer pixel line (Bresenham). */
export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  ctx.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Filled pixel circle (no antialiasing). */
export function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  const r2 = r * r;
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
    const span = Math.floor(Math.sqrt(Math.max(0, r2 - y * y)));
    if (r2 - y * y < 0) continue;
    ctx.fillRect(Math.round(cx - span), Math.round(cy + y), span * 2 + 1, 1);
  }
}

/** Filled pixel ellipse (no antialiasing). */
export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t < 0) continue;
    const span = Math.floor(rx * Math.sqrt(t));
    ctx.fillRect(Math.round(cx - span), Math.round(cy + y), span * 2 + 1, 1);
  }
}
