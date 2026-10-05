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
 * Removing a texture that an object still shows (decision of the B2 round, carry-over d). Two ways
 * were possible: refuse the removal with a warning, or keep the pictures alive until the last object
 * that shows them is gone. This class keeps them alive. A scene normally removes its textures in a
 * `shutdown` listener, which runs BEFORE the scene's own display list is destroyed, so refusing
 * would fail every time. So: `remove` frees the KEY at once (`exists` is false, the key can be
 * added again) and destroys the GPU data when the use count reaches zero, which is right away when
 * nothing shows it. `ImageObject` counts itself in and out (`retain` and `release`).
 *
 * The public type of what this class hands out is `SjTexture` (interfaces.md section 6). The class
 * with the Pixi parts, `TextureEntry`, is for src/sje/display only, through `entryOf`.
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
  /** @internal How many display objects show this texture right now. */
  private users = 0;
  /** @internal True after `remove`: the key is gone, the GPU data waits for the last user. */
  private retired = false;

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

  /** @internal A display object starts showing this texture. */
  retain(): void {
    this.users++;
  }

  /** @internal A display object stops showing it (destroyed, or switched to another texture). */
  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.retired && this.users === 0) this.destroy();
  }

  /** @internal `remove`: destroy now if nothing shows it, otherwise when the last user lets go. */
  retire(): void {
    this.retired = true;
    if (this.users === 0) this.destroy();
  }

  /** How many display objects show this texture (tests). */
  get useCount(): number {
    return this.users;
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

  /** The texture under a key, as the public type (no Pixi in it). Throws if there is none. */
  get(key: string): SjTexture {
    return this.entryOf(key);
  }

  /** @internal The entry with its Pixi parts. For src/sje/display only (`ImageObject`, `Sprite`). */
  entryOf(key: string): TextureEntry {
    return must(this.entries.get(key), `texture "${key}"`);
  }

  getTextureKeys(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Store a canvas as a texture. The canvas stays the owner of the pixels: draw on it, then call
   * `refresh()`. Throws if the key is taken (a silent replace would leak the old texture).
   */
  addCanvas(key: string, canvas: HTMLCanvasElement, opts?: { cpu?: Raw }): SjTexture {
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
    this.addCanvas(key, canvas);
    return { canvas, ctx, refresh: () => this.refresh(key) };
  }

  /** The canvas of `key` changed: upload it again. Without this the old picture stays on the GPU. */
  refresh(key: string): void {
    this.entryOf(key).refresh();
  }

  /**
   * Name rectangles of a stored image, so a Sprite can show one by name. Frames are `[x, y, w, h]`
   * in pixels. A second call adds more frames (a repeated name is an error).
   */
  addFrames(key: string, frames: Record<string | number, [x: number, y: number, w: number, h: number]>): void {
    const entry = this.entryOf(key);
    for (const [name, [x, y, w, h]] of Object.entries(frames)) {
      assert(!entry.frames.has(name), `TextureManager.addFrames: "${key}" already has frame "${name}"`);
      assert(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= entry.width && y + h <= entry.height, `TextureManager.addFrames: frame "${name}" is outside "${key}" (${entry.width}x${entry.height})`);
      entry.frames.set(name, { name, x, y, w, h });
      entry.cells.set(name, new Texture({ source: entry.base.source, frame: new Rectangle(x, y, w, h), label: `${key}/${name}` }));
    }
  }

  /**
   * Forget a key and free its texture. If display objects still show it, the GPU data stays until
   * the last one is destroyed (see the note at the top of this file); the key is free at once.
   * Returns false if there was no such key.
   */
  remove(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    entry.retire();
    return true;
  }

  /** Remove every texture whose key starts with `prefix`, except the keys in `inUse`. Returns how many went. @ours */
  prune(prefix: string, inUse: ReadonlySet<string>): number {
    let n = 0;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix) && !inUse.has(key) && this.remove(key)) n++;
    return n;
  }
}
