/**
 * ImageObject: one texture (or one frame of it), no animation (docs/engine/scene-graph.md section 2).
 * Follows: Phaser `Image`. The name has a suffix so it does not shadow the DOM global `Image`.
 * Pixi backing: `Sprite`.
 *
 * Origin and flip (scene-graph.md section 7):
 *  - ORIGIN is 0.5 by default (Phaser). Pixi's anchor defaults to (0,0), which would move every
 *    sprite by half its size. The wrapper always writes `anchor = origin`.
 *  - The origin must land on a whole pixel (`origin * size` is a whole number), or the picture
 *    would sit half a pixel off the grid. If it does not, the wrapper rounds it (at once) and
 *    warns once in dev. A 15 px wide sprite at the default 0.5 is such a case: give it an explicit
 *    origin. The warning waits one microtask, so `add.image(...).setOrigin(0, 0)` does not warn
 *    about the default it replaced a moment later.
 *  - FLIP follows Phaser: it mirrors about the middle of the texture, so the picture stays where
 *    it was. Pixi flips about the anchor, so the wrapper sets `scale.x = -abs(scaleX)` AND
 *    `anchor.x = 1 - originX`.
 *
 * @deviation from interfaces.md: the sketch puts `originX`, `flipX` on GameObject. Only a node
 * with a texture can use them, so they live here. A Container or Graphics would silently ignore them.
 */
import { Sprite as PixiSprite } from 'pixi.js';
import { type DisplayHost, GameObject } from './gameobject';
import type { SjTexture, TextureEntry } from './texturemanager';

const warned = new Set<string>();
/** One dev warning per distinct message, so a loop cannot flood the console. */
function warnOnce(message: string): void {
  if (!import.meta.env.DEV || warned.has(message)) return;
  warned.add(message);
  console.warn(`[sje] ${message}`);
}

/** The origin that puts the anchor on a whole pixel, for a texture `size` pixels wide (or tall). */
export function wholePixelOrigin(origin: number, size: number): number {
  const px = origin * size;
  const whole = Math.round(px);
  return Math.abs(px - whole) < 1e-6 ? origin : whole / size;
}

export class ImageObject extends GameObject {
  private readonly sprite: PixiSprite;
  private tex: TextureEntry;
  private frameName: string | number | undefined;
  private _originX = 0.5;
  private _originY = 0.5;
  private _flipX = false;
  private checkQueued = false;

  constructor(scene: DisplayHost, x: number, y: number, key: string, frame?: string | number) {
    const tex = scene.textures.get(key);
    const sprite = new PixiSprite(tex.pixiTexture(frame));
    super(scene, sprite);
    this.sprite = sprite;
    this.tex = tex;
    this.frameName = frame;
    this.name = frame === undefined ? key : `${key}/${frame}`;
    this.setPosition(x, y);
    this.writeAnchor();
  }

  get texture(): SjTexture {
    return this.tex;
  }
  get frame(): string | number | undefined {
    return this.frameName;
  }

  /** Width of the shown picture in texture pixels (before scale). */
  get width(): number {
    return this.sprite.texture.frame.width;
  }
  get height(): number {
    return this.sprite.texture.frame.height;
  }

  /** Show another texture, or another frame of it. */
  setTexture(key: string, frame?: string | number): this {
    this.assertAlive('ImageObject.setTexture');
    const tex = this.scene.textures.get(key);
    this.sprite.texture = tex.pixiTexture(frame);
    this.tex = tex;
    this.frameName = frame;
    this.name = frame === undefined ? key : `${key}/${frame}`;
    this.writeAnchor();
    return this;
  }

  /** Phaser: setOrigin. 0 to 1, default 0.5. Not Pixi's `pivot` (which is in pixels). */
  setOrigin(x: number, y: number = x): this {
    this._originX = x;
    this._originY = y;
    this.writeAnchor();
    return this;
  }
  get originX(): number {
    return this._originX;
  }
  get originY(): number {
    return this._originY;
  }

  setFlipX(flip: boolean): this {
    this._flipX = flip;
    this.writeScale();
    this.writeAnchor();
    return this;
  }
  get flipX(): boolean {
    return this._flipX;
  }

  protected override writeScale(): void {
    this._pixi.scale.set(this._flipX ? -Math.abs(this.scaleX) : this.scaleX, this.scaleY);
  }

  /** Write the anchor from the origin: whole pixels, and mirrored when flipped. */
  protected writeAnchor(): void {
    const w = this.width;
    const h = this.height;
    const ox = wholePixelOrigin(this._originX, w);
    const oy = wholePixelOrigin(this._originY, h);
    if ((ox !== this._originX || oy !== this._originY) && !this.checkQueued) {
      this.checkQueued = true;
      queueMicrotask(() => this.checkOrigin());
    }
    this.sprite.anchor.set(this._flipX ? 1 - ox : ox, oy);
  }

  /** Warn (dev only) if the origin is STILL not a whole pixel after the code that built this object finished. */
  private checkOrigin(): void {
    this.checkQueued = false;
    if (this.destroyed) return;
    const w = this.width;
    const h = this.height;
    const ox = wholePixelOrigin(this._originX, w);
    const oy = wholePixelOrigin(this._originY, h);
    if (ox !== this._originX || oy !== this._originY) {
      warnOnce(`"${this.tex.key}": origin ${this._originX},${this._originY} of a ${w}x${h} picture is not a whole pixel. Rounded to ${ox},${oy}.`);
    }
  }
}
