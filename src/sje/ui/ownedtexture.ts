/**
 * OwnedTexture: a canvas texture that ONE display object owns (UI kit, M8a).
 * Follows: the pattern of `CanvasImage` (display/canvasimage.ts), made resizable. A `TextObject` or a `NineSlice` paints into its own canvas,
 * and when the size changes it needs a new canvas (a texture cannot change size in place). The old texture is removed AFTER the object shows the new
 * one, so the key never goes away while it is still on screen, and nothing is left behind: `dispose` removes the last key.
 *
 * Usage (the order matters):
 *   const tex = new OwnedTexture(scene.textures, 'ui-text', w, h);   // before `super(...)`: the image needs a key that exists
 *   super(scene, x, y, tex.key);
 *   ...
 *   const old = tex.resize(w2, h2);                                    // null when the size did not change (same canvas, paint again)
 *   if (old !== null) { this.setTexture(tex.key); tex.drop(old); }
 *   tex.refresh();                                                     // upload the pixels
 */
import type { TextureManager } from '../display/texturemanager';

let nextId = 1;

export class OwnedTexture {
  key: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private refreshFn: () => void;

  constructor(
    private readonly textures: TextureManager,
    private readonly prefix: string,
    w: number,
    h: number,
  ) {
    const made = this.make(w, h);
    this.key = made.key;
    this.canvas = made.canvas;
    this.ctx = made.ctx;
    this.refreshFn = made.refresh;
  }

  private make(w: number, h: number): { key: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; refresh(): void } {
    const key = `${this.prefix}-${nextId++}`;
    const made = this.textures.createCanvas(key, Math.max(1, w), Math.max(1, h));
    return { key, ...made };
  }

  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }

  /** Make a canvas of this size. Returns the OLD key for the caller to `drop` once the new one is shown, or null when the size is the same (nothing changed). */
  resize(w: number, h: number): string | null {
    const cw = Math.max(1, w);
    const ch = Math.max(1, h);
    if (cw === this.canvas.width && ch === this.canvas.height) return null;
    const old = this.key;
    const made = this.make(cw, ch);
    this.key = made.key;
    this.canvas = made.canvas;
    this.ctx = made.ctx;
    this.refreshFn = made.refresh;
    return old;
  }

  /** Remove a texture the object no longer shows. */
  drop(key: string): void {
    this.textures.remove(key);
  }

  /** The canvas changed: upload it again. */
  refresh(): void {
    this.refreshFn();
  }

  /** Remove the current texture (the object is being destroyed). */
  dispose(): void {
    this.textures.remove(this.key);
  }
}
