/**
 * TextureManager: a name-keyed store of textures, with a data bag per texture
 * (docs/engine/interfaces.md section 6, frame-and-rendering.md 6.7 and 10).
 * Follows: Phaser `TextureManager`. Pixi has neither the keys nor the data bag.
 *
 * All generated art in this game is drawn on a canvas, so the main entry is `addCanvas`. Three
 * Pixi facts cause silent bugs here, and this class is where they are handled:
 *
 *  1. `Texture.from(canvas)` caches by the canvas object unless you ask it not to. We build the
 *     `CanvasSource` ourselves, so Pixi's global cache never sees it.
 *  2. `texture.destroy()` leaves the source alive. Frames of one image share ONE source. So we
 *     destroy the frame textures first, then the source ONCE (`remove`).
 *  3. A changed canvas needs `source.update()` (a `texSubImage2D` upload) or the old picture
 *     stays on the GPU. `refresh()` does it.
 *
 * Pixi's own texture GC is off (see PixiRenderer), so nothing frees a texture but `remove`/`prune`.
 *
 * Built later (on demand, M3): `addCanvasOnce`, `variantOf`, `setStandIn`, `getPixelAlpha`.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { assert, must } from '../core/assert';

export interface SjFrame {
  readonly name: string | number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** CPU pixels, kept for picking (`getPixelAlpha`, M3). */
export interface Raw {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export interface SjTexture {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly frames: ReadonlyMap<string | number, SjFrame>;
  /** Phaser's `customData`: feet, face, bounds. We call it `data` (deviation 13 in conventions.md). */
  data: Record<string, unknown>;
  readonly cpu?: Raw;
  /** True after `remove` or `prune`: a destroyed texture must not be drawn. */
  readonly destroyed: boolean;
}

/** One stored texture. The Pixi parts are `@internal`: only src/sje/display may use them. */
export class TextureEntry implements SjTexture {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly frames = new Map<string | number, SjFrame>();
  data: Record<string, unknown> = {};
  readonly cpu?: Raw;
  destroyed = false;

  /** @internal */
  readonly canvas: HTMLCanvasElement;
  /** @internal The whole image as one Pixi texture. */
  readonly base: Texture;
  /** @internal One Pixi texture per frame. They share `base.source`. */
  readonly cells = new Map<string, Texture>();

  constructor(key: string, canvas: HTMLCanvasElement, cpu: Raw | undefined) {
    this.key = key;
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    if (cpu) this.cpu = cpu;
    // Built by hand (not Texture.from) so Pixi's global cache never holds the canvas. Nearest
    // filtering is the default set in PixiRenderer; it is written here too so this class is correct on its own.
    const source = new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'nearest' });
    this.base = new Texture({ source, label: key });
  }

  /** @internal The Pixi texture for a frame, or the whole image when `frame` is undefined. */
  pixiTexture(frame?: string | number): Texture {
    assert(!this.destroyed, `Texture "${this.key}" was destroyed`);
    if (frame === undefined) return this.base;
    return must(this.cells.get(String(frame)), `frame "${frame}" of texture "${this.key}"`);
  }

  /** The canvas changed: upload it again. Without this the old picture stays on the GPU. */
  refresh(): void {
    assert(!this.destroyed, `Texture "${this.key}" was destroyed`);
    this.base.source.update();
  }

  /** @internal Free the frames, then the source, once. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.cells.values()) t.destroy(false);
    this.cells.clear();
    this.base.destroy(true);
  }
}

export class TextureManager {
  private readonly entries = new Map<string, TextureEntry>();

  exists(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): TextureEntry {
    return must(this.entries.get(key), `texture "${key}"`);
  }

  getTextureKeys(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Store a canvas as a texture. The canvas stays the owner of the pixels: draw on it, then call
   * `refresh()`. Throws if the key is taken (a silent replace would leak the old texture).
   */
  addCanvas(key: string, canvas: HTMLCanvasElement, opts?: { cpu?: Raw }): TextureEntry {
    assert(!this.entries.has(key), `TextureManager.addCanvas: key "${key}" already exists`);
    assert(canvas.width > 0 && canvas.height > 0, `TextureManager.addCanvas: canvas "${key}" has no size`);
    const entry = new TextureEntry(key, canvas, opts?.cpu);
    this.entries.set(key, entry);
    return entry;
  }

  /** Make a new canvas of this size and store it. Draw into `ctx`, then call `refresh()`. */
  createCanvas(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; refresh(): void } {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = must(canvas.getContext('2d'), 'a 2D canvas context');
    ctx.imageSmoothingEnabled = false;
    const entry = this.addCanvas(key, canvas);
    return { canvas, ctx, refresh: () => entry.refresh() };
  }

  /**
   * Name rectangles of a stored image, so a Sprite can show one by name. Frames are `[x, y, w, h]`
   * in pixels. A second call adds more frames (a repeated name is an error).
   */
  addFrames(key: string, frames: Record<string | number, [x: number, y: number, w: number, h: number]>): void {
    const entry = this.get(key);
    for (const [name, [x, y, w, h]] of Object.entries(frames)) {
      assert(!entry.frames.has(name), `TextureManager.addFrames: "${key}" already has frame "${name}"`);
      assert(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= entry.width && y + h <= entry.height, `TextureManager.addFrames: frame "${name}" is outside "${key}" (${entry.width}x${entry.height})`);
      entry.frames.set(name, { name, x, y, w, h });
      entry.cells.set(name, new Texture({ source: entry.base.source, frame: new Rectangle(x, y, w, h), label: `${key}/${name}` }));
    }
  }

  /** Destroy a texture and forget its key. Destroy the objects that show it first. Returns false if there was no such key. */
  remove(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    entry.destroy();
    return true;
  }

  /** Remove every texture whose key starts with `prefix`, except the keys in `inUse`. Returns how many went. @ours */
  prune(prefix: string, inUse: ReadonlySet<string>): number {
    let n = 0;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix) && !inUse.has(key) && this.remove(key)) n++;
    return n;
  }
}
