/**
 * CanvasImage: an image that owns a canvas (docs/engine/scene-graph.md section 2).
 * Follows: Phaser `CanvasTexture` shown by an `Image` (ours as one class). Pixi backing: `Sprite` over a `CanvasSource`.
 *
 * Draw on `ctx` (the 2D canvas context), then call `refresh()` once: that uploads the canvas to the GPU (a
 * `texSubImage2D`). Without `refresh()` the old picture stays on the GPU. The `LegacyScene` adapter owns one of these
 * per scene and draws today's whole Canvas 2D frame into it.
 *
 * It frees its texture with itself: `destroy()` removes the key from the `TextureManager`.
 */
import type { DisplayHost } from './gameobject';
import { ImageObject } from './imageobject';

let nextId = 1;

export class CanvasImage extends ImageObject {
  /** The canvas this image shows. The image owns the pixels: draw, then `refresh()`. */
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly refreshTexture: () => void;
  private readonly key: string;

  /** `key` is optional: a generated one is used when it is left out. Throws if the key is taken. */
  constructor(scene: DisplayHost, x: number, y: number, w: number, h: number, key = `canvas-${nextId++}`) {
    const made = scene.textures.createCanvas(key, w, h);
    super(scene, x, y, key);
    this.key = key;
    this.canvas = made.canvas;
    this.ctx = made.ctx;
    this.refreshTexture = made.refresh;
    this.name = key;
    // A canvas image is laid out from its top-left corner, like the legacy frame it replaces.
    this.setOrigin(0, 0);
  }

  /** The canvas changed: upload it again. */
  refresh(): this {
    this.assertAlive('CanvasImage.refresh');
    this.refreshTexture();
    return this;
  }

  /** Free the node, then the texture key (the GPU data goes with the last user, which is this image). */
  protected override destroyNode(): void {
    try {
      super.destroyNode();
    } finally {
      this.scene.textures.remove(this.key);
    }
  }
}
