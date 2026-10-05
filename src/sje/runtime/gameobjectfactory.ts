/**
 * GameObjectFactory: `scene.add` (docs/engine/interfaces.md section 3).
 * Follows: Phaser `GameObjectFactory`. Each call makes an object and puts it in the scene's
 * display list (its `world` container), exactly as Phaser does.
 *
 * Built in B0: image, sprite, container, layer, graphics. Text, zone, canvasImage and timeline are
 * built on demand (M1 to M4); they are absent from the type, so calling one is a compile error.
 */
import { Container } from '../display/container';
import type { DisplayHost, GameObject } from '../display/gameobject';
import { Graphics } from '../display/graphics';
import { ImageObject } from '../display/imageobject';
import { Sprite } from '../display/sprite';

export class GameObjectFactory {
  constructor(
    private readonly scene: DisplayHost,
    private readonly world: Container,
    private readonly ui: Container,
  ) {}

  /** Phaser: add.image. The class is `ImageObject` so it does not shadow the DOM global `Image`. */
  image(x: number, y: number, key: string, frame?: string | number): ImageObject {
    return this.put(new ImageObject(this.scene, x, y, key, frame));
  }

  sprite(x: number, y: number, key: string, frame?: string | number): Sprite {
    return this.put(new Sprite(this.scene, x, y, key, frame));
  }

  /** A container, with optional children (they MOVE into it from wherever they were). */
  container(x = 0, y = 0, children?: GameObject[]): Container {
    const c = this.put(new Container(this.scene, x, y));
    if (children) c.add(children);
    return c;
  }

  /**
   * Phaser 4 has a `Layer` class (a display list with no transform). We have none: this returns a
   * plain Container kept at identity. With `{ ui: true }` it goes into the scene's `ui` container
   * (not moved by the camera): that is how a HUD is made. @deviation 11 in conventions.md; `ui` is @ours
   */
  layer(opts?: { ui?: boolean }): Container {
    const c = new Container(this.scene, 0, 0, 'layer');
    (opts?.ui ? this.ui : this.world).add(c);
    return c;
  }

  graphics(): Graphics {
    return this.put(new Graphics(this.scene));
  }

  private put<T extends GameObject>(o: T): T {
    this.world.add(o);
    return o;
  }
}
