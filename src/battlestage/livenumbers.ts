/**
 * The floating numbers of the live battle on the stage (M3 task 6): the damage numbers, the WEAK!/CRITICAL words and the status words that pop over a fighter. The battle scene
 * keeps them as a list (`BattleScene.floaters`: text, place, age, colour, style, whose); the old picture drew them into its world layer. The stage shows each as an `ImageObject`
 * of a text texture (`hudkit.ts`), moved by the same rule (`floaterMotion` in `battlekit/geom.ts`: pop, hold, drift, bounce, fade), at the same world position times the
 * stage's scale `k` (screen pixels per world pixel).
 *
 * One image per floater, found again by the floater's identity (a `Map` keyed by the object), and destroyed when the scene has dropped the floater. The images stand in
 * the scene's world (they move with the push camera and a shake, as the old numbers did) at `DEPTH.MARKS`.
 */
import { type AnyScene, DEPTH, type ImageObject } from '../sje';
import { floaterMotion } from '../scenes/battlekit/geom';
import type { Floater } from '../scenes/battlekit/types';
import { textAt, textTexture } from './hudkit';
import { NUMBER_PREFIX, NUMBER_SCALE, NUMBER_SHADOW } from './liveparams';
import { pruneTextures } from './textures';

export class LiveNumbers {
  private readonly images = new Map<Floater, { image: ImageObject; key: string }>();

  constructor(
    private readonly scene: AnyScene,
    /** Screen pixels of the stage per world pixel of the battle. */
    private readonly k: number,
  ) {}

  /** How many numbers are showing (for tests). */
  get count(): number {
    return this.images.size;
  }

  /** The images, in the order the floaters were made (for tests). */
  get shown(): ImageObject[] {
    return [...this.images.values()].map((e) => e.image);
  }

  /** Bring the images in line with the scene's list of floaters: new ones appear, moved ones follow the rule, gone ones are destroyed. */
  update(floaters: readonly Floater[]): void {
    const live = new Set(floaters);
    let dropped = false;
    for (const [f, e] of this.images) {
      if (live.has(f)) continue;
      e.image.destroy();
      this.images.delete(f);
      dropped = true;
    }
    for (const f of floaters) {
      let e = this.images.get(f);
      const t = textTexture(this.scene.textures, f.text, { color: f.color, shadow: NUMBER_SHADOW, scale: NUMBER_SCALE, prefix: NUMBER_PREFIX });
      if (!e) {
        e = { image: this.scene.add.image(0, 0, t.key).setOrigin(0, 0).setDepth(DEPTH.MARKS), key: t.key };
        this.images.set(f, e);
      }
      const m = floaterMotion(f.style, f.t);
      const at = textAt(t, f.text, Math.round(f.x * this.k), Math.round((f.y - m.rise - m.bounce) * this.k), 'center', NUMBER_SCALE);
      e.image.setPosition(at.x, at.y).setAlpha(m.alpha);
    }
    // The textures of numbers that are gone are removed with a little delay in cost: only when something was dropped.
    if (dropped) pruneTextures(this.scene.textures, NUMBER_PREFIX, new Set([...this.images.values()].map((e) => e.key)));
  }

  /** Destroy every image. */
  destroy(): void {
    for (const e of this.images.values()) e.image.destroy();
    this.images.clear();
  }
}
