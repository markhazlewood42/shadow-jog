/**
 * View3D: the sprite that shows the 3D picture (docs/engine/interfaces.md section 12,
 * scene-graph.md section 9). Pixi backing: `Sprite` over a texture another library draws.
 *
 * It goes into any display list. Filters, masks and blend modes work on it like on any sprite,
 * because to Pixi the 3D picture is just a texture (decision E3, the reason the shared context won).
 *
 * @deviation from interfaces.md: the sketch says `View3D extends ImageObject`. `ImageObject` is
 * keyed to the `TextureManager` (a string key, frames, a use count), and a 3D frame is neither: it
 * belongs to ONE `Frame3D` that frees it. So `View3D` is its own `GameObject`. It has the parts of
 * an image that matter here (position, scale, depth, alpha, visible, size).
 *
 * @deviation `setPixelSnap(false)` is NOT applied (interfaces.md says "View3D turns it off").
 * The 3D target sits on the same pixel grid as every 2D object (V3 of the spike rubric), so a
 * fractional position would smear it between pixels. It stays snapped like everything else.
 *
 * The picture may be stored upside down for Pixi (a GL render target keeps its first row at the
 * bottom). Then the sprite is mirrored: `anchor.y = 1` and `scale.y = -1`, which puts the top-left
 * corner of the picture at `(x, y)` just like an unmirrored sprite.
 */
import { Sprite as PixiSprite } from 'pixi.js';
import type { FrameTexture } from '../render/frametexture';
import { type DisplayHost, GameObject } from './gameobject';

export class View3D extends GameObject {
  private readonly sprite: PixiSprite;

  constructor(
    scene: DisplayHost,
    readonly frameTexture: FrameTexture,
    x = 0,
    y = 0,
  ) {
    const sprite = new PixiSprite(frameTexture.texture);
    super(scene, sprite);
    this.sprite = sprite;
    this.name = 'view3d';
    sprite.label = 'view3d';
    sprite.anchor.set(0, frameTexture.flipY ? 1 : 0);
    this.setPosition(x, y);
    this.writeScale();
  }

  /** Width of the 3D picture, in game pixels (before scale). */
  get width(): number {
    return this.frameTexture.width;
  }
  get height(): number {
    return this.frameTexture.height;
  }

  /** The mirror for a bottom-row-first picture is part of the scale. */
  protected override writeScale(): void {
    this._pixi.scale.set(this.scaleX, this.frameTexture.flipY ? -this.scaleY : this.scaleY);
  }

  /** Free the sprite. The texture is NOT freed here: the `Frame3D` that made it frees it. */
  protected override destroyNode(): void {
    this.sprite.destroy({ texture: false });
  }
}
