/**
 * Sprite: an ImageObject that can switch frame (docs/engine/scene-graph.md section 2).
 * Pixi backing: `Sprite`.
 *
 * @deviation in Phaser, `Sprite` and `Image` are siblings and both have `setFrame`. Here
 * `Sprite extends ImageObject`, and only `Sprite` has `setFrame`. `setTexture(key, frame)` works on both.
 *
 * There is no `play(animation)`: animation is driven by the fixed tick, never by Pixi's
 * `AnimatedSprite` (which starts its own wall-clock loop). A scene picks the frame each tick.
 * `play` is built on demand (decision E23).
 */
import { ImageObject } from './imageobject';

export class Sprite extends ImageObject {
  /** Show another frame of the current texture (a name from `textures.addFrames`). */
  setFrame(frame: string | number): this {
    return this.setTexture(this.texture.key, frame);
  }
}
