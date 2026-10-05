/**
 * The CPU reference: draws the lab's content (content.ts) with plain Canvas 2D, the way the shipped
 * game does, and NOT through the engine. The e2e spec compares this picture to what the engine
 * (Pixi on the GPU) puts in its back buffer.
 *
 * The rules are written out here from the design, not borrowed from the engine, so a mistake in
 * the engine's snap, origin or flip code shows up as a difference:
 *  - a position is rounded to a whole pixel (Math.round);
 *  - an image's top-left is `rounded position - origin * size * scale`;
 *  - flip mirrors the picture about its own middle and leaves it where it was (Phaser);
 *  - draw order is by `depth`, low first, and equal depths keep the order they were added;
 *  - the camera scroll is rounded, and the world is drawn shifted by minus that.
 */
import { H, W } from '../sje';
import type { GroupNode, ImageLeaf, LabContent, LabNode, LabTexture, Leaf, LineLeaf, RectLeaf } from './content';

const round = (v: number): number => Math.round(v) + 0;
const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Draw one whole frame of the lab at `tick`. */
export function drawReference(ctx: CanvasRenderingContext2D, content: LabContent, tick: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#07060d'; // the same void colour as the engine's back buffer
  ctx.fillRect(0, 0, W, H);
  const scroll = referenceScroll(content, tick);
  const byKey = new Map<string, LabTexture>(content.textures.map((t) => [t.key, t]));
  drawNodes(ctx, content.world, -scroll, 0, byKey, tick);
  drawNodes(ctx, content.ui, 0, 0, byKey, tick);
}

/** The camera scroll the engine should have at `tick`: rounded, and inside the world's bounds. */
export function referenceScroll(content: LabContent, tick: number): number {
  return Math.min(Math.max(round(content.panX(tick)), 0), 960 - W);
}

function drawNodes(ctx: CanvasRenderingContext2D, nodes: readonly LabNode[], ox: number, oy: number, tex: Map<string, LabTexture>, tick: number): void {
  // Stable sort by depth: the array order is the order they were added.
  const order = nodes.map((n, i) => ({ n, i })).sort((a, b) => a.n.depth - b.n.depth || a.i - b.i);
  for (const { n } of order) {
    if (n.kind === 'group') drawGroup(ctx, n, ox, oy, tex, tick);
    else drawLeaf(ctx, n, ox, oy, tex, tick);
  }
}

function drawGroup(ctx: CanvasRenderingContext2D, g: GroupNode, ox: number, oy: number, tex: Map<string, LabTexture>, tick: number): void {
  drawNodes(ctx, g.children, ox + round(g.x), oy + round(g.y), tex, tick);
}

function drawLeaf(ctx: CanvasRenderingContext2D, leaf: Leaf, ox: number, oy: number, tex: Map<string, LabTexture>, tick: number): void {
  ctx.globalAlpha = leaf.alpha;
  if (leaf.kind === 'image') drawImage(ctx, leaf, ox, oy, tex, tick);
  else if (leaf.kind === 'rect') drawRect(ctx, leaf, ox, oy);
  else drawLine(ctx, leaf, ox, oy);
  ctx.globalAlpha = 1;
}

function drawImage(ctx: CanvasRenderingContext2D, im: ImageLeaf, ox: number, oy: number, tex: Map<string, LabTexture>, tick: number): void {
  const t = tex.get(im.tex);
  if (!t) throw new Error(`reference: no texture ${im.tex}`);
  const frameName = im.frameAt ? im.frameAt(tick) : im.frame;
  const f = frameName ? t.frames?.[frameName] : undefined;
  const [sx, sy, sw, sh] = f ?? [0, 0, t.canvas.width, t.canvas.height];
  const left = ox + round(im.x) - im.originX * sw * im.scale;
  const top = oy + round(im.y) - im.originY * sh * im.scale;
  ctx.save();
  if (im.flipX) {
    // Mirrored about the picture's own middle: same box, flipped contents.
    ctx.translate(left + sw * im.scale, top);
    ctx.scale(-im.scale, im.scale);
  } else {
    ctx.translate(left, top);
    ctx.scale(im.scale, im.scale);
  }
  ctx.drawImage(t.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}

function drawRect(ctx: CanvasRenderingContext2D, r: RectLeaf, ox: number, oy: number): void {
  // Round both corners, not the size, so rectangles that touch still touch.
  const x0 = round(r.x);
  const y0 = round(r.y);
  ctx.fillStyle = css(r.color);
  ctx.fillRect(ox + x0, oy + y0, round(r.x + r.w) - x0, round(r.y + r.h) - y0);
}

/** A 1 px line, both ends included, by Bresenham (the game's own `line()` in engine/canvas.ts). */
function drawLine(ctx: CanvasRenderingContext2D, l: LineLeaf, ox: number, oy: number): void {
  ctx.fillStyle = css(l.color);
  let x0 = round(l.x0);
  let y0 = round(l.y0);
  const x1 = round(l.x1);
  const y1 = round(l.y1);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(ox + x0, oy + y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

