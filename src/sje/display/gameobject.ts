/**
 * GameObject: the unit of the display list (docs/engine/scene-graph.md sections 1 to 4).
 * Follows: Phaser `GameObject`. Composition, not subclassing: each GameObject OWNS exactly one
 * Pixi node and hides it. Game code touches the GameObject tree. The Pixi tree has the same shape
 * and is for the renderer. (Decision E9.)
 *
 * Snap to pixel (scene-graph.md section 7). Whole-pixel positions are a hard rule. `x` and `y`
 * keep the logical number you set (smooth motion math stays smooth). The wrapper writes
 * `Math.round` of them to the Pixi node. Exact `.5` positions are unreliable on the GPU: an 8x8
 * sprite at 40.5 drew 72 pixels in the lab. `setPixelSnap(false)` opts one object out (the 3D view
 * does, later). Godot calls this `snap_2d_transforms_to_pixel`.
 */
import type { Container as PixiContainer } from 'pixi.js';
import { assert } from '../core/assert';
import type { Container } from './container';
import { FilterList } from './effects';
import type { TextureManager } from './texturemanager';

/**
 * What a display object needs from whoever owns it. The runtime `Scene` is one; the game itself
 * is another (for the screen roots).
 *
 * @deviation from interfaces.md: the sketch types `GameObject.scene` as `Scene`. Level 2 cannot
 * import level 3, so it asks for this smaller shape and the Scene satisfies it.
 */
export interface DisplayHost {
  readonly textures: TextureManager;
}

/** Round to a whole pixel, and never give back -0 (it prints oddly and compares unequal with Object.is). */
export function snap(v: number): number {
  return Math.round(v) + 0;
}

export abstract class GameObject {
  readonly scene: DisplayHost;
  name = '';
  /** An inactive object is skipped by scene logic that checks it. The engine does not use it yet. */
  active = true;
  /** @internal The owning container (null at the top, or after `remove`). Set by `Container`. */
  _parent: Container | null = null;
  /** @internal The one Pixi node this object owns. Only code under src/sje may use it. */
  readonly _pixi: PixiContainer;

  private _x = 0;
  private _y = 0;
  private _depth = 0;
  private _scaleX = 1;
  private _scaleY = 1;
  private _snap = true;
  private _destroyed = false;
  /** @internal The effect lists that use this object as their MASK. Destroying this object clears the mask in each. Made on first use. */
  _maskUsers: Set<FilterList> | null = null;

  protected constructor(scene: DisplayHost, pixi: PixiContainer) {
    this.scene = scene;
    this._pixi = pixi;
    // Children of a container sort by depth. Pixi only re-sorts when a depth changed.
    pixi.sortableChildren = true;
  }

  /** @internal The escape hatch to Pixi, typed `unknown` so game code cannot use it by accident. */
  get node(): unknown {
    return this._pixi;
  }

  get parent(): Container | null {
    return this._parent;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  // ---- transform -------------------------------------------------------------------------------

  get x(): number {
    return this._x;
  }
  set x(v: number) {
    this._x = v;
    this.writePosition();
  }
  get y(): number {
    return this._y;
  }
  set y(v: number) {
    this._y = v;
    this.writePosition();
  }
  setPosition(x: number, y: number = x): this {
    this._x = x;
    this._y = y;
    this.writePosition();
    return this;
  }

  get scaleX(): number {
    return this._scaleX;
  }
  get scaleY(): number {
    return this._scaleY;
  }
  setScale(x: number, y: number = x): this {
    this._scaleX = x;
    this._scaleY = y;
    this.writeScale();
    return this;
  }

  /** Whether positions are rounded to whole pixels (default true). */
  get pixelSnap(): boolean {
    return this._snap;
  }
  /** @ours Opt out of snap to pixel for smooth motion. */
  setPixelSnap(on: boolean): this {
    this._snap = on;
    this.writePosition();
    return this;
  }

  // ---- draw order and look ---------------------------------------------------------------------

  /** A higher depth draws later (on top), among siblings. Phaser `depth`; Pixi `zIndex`. */
  get depth(): number {
    return this._depth;
  }
  set depth(d: number) {
    this._depth = d;
    this._pixi.zIndex = d;
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }

  get alpha(): number {
    return this._pixi.alpha;
  }
  set alpha(a: number) {
    this._pixi.alpha = a;
  }
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }

  get visible(): boolean {
    return this._pixi.visible;
  }
  set visible(v: boolean) {
    this._pixi.visible = v;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }

  // ---- filters and masks -------------------------------------------------------------------------

  private _filters: FilterList | null = null;
  /**
   * Effects and the mask of this object (docs/engine/interfaces.md section 5). Phaser 4: `go.filters`.
   * Made on first use, so an object that never has one pays nothing.
   */
  get filters(): FilterList {
    if (!this._filters) this._filters = new FilterList(this);
    return this._filters;
  }

  // ---- data bag --------------------------------------------------------------------------------

  private bag: Record<string, unknown> | undefined;
  setData(key: string, value: unknown): this {
    if (!this.bag) this.bag = {};
    this.bag[key] = value;
    return this;
  }
  getData<T>(key: string): T | undefined {
    return this.bag?.[key] as T | undefined;
  }

  // ---- lifetime --------------------------------------------------------------------------------

  /**
   * @deviation from frame-and-rendering.md section 10, which says `GameObject.destroy` destroys the object's own filters. It does NOT: an
   * `Effect` is made by the code that uses it and may be on many objects at once, so the code that made it owns it and destroys it (the
   * same rule as for textures and masks). Drift item 31 in docs/spikes/engine-platform.md.
   *
   * Remove this object from its parent and free its Pixi node. Safe to call twice. A Container
   * overrides this to destroy its children first. This does NOT destroy shared textures: the code
   * that made them owns them (docs/engine/frame-and-rendering.md section 10).
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.active = false;
    this._parent?.remove(this);
    // A destroyed node must not stay as somebody's mask (Pixi would draw with a dead node), and this
    // object's own mask must forget it. Both before the node is freed.
    if (this._maskUsers) for (const list of [...this._maskUsers]) list.clearMask();
    this._filters?.clearMask();
    this.destroyNode();
  }

  /** Free the Pixi node. A subclass that owns more GPU data (Graphics) overrides this. */
  protected destroyNode(): void {
    this._pixi.destroy();
  }

  /** Throw if this object was destroyed: used before touching its node. */
  protected assertAlive(what: string): void {
    assert(!this._destroyed, `${what}: this ${this.constructor.name} "${this.name}" was destroyed`);
  }

  /** @internal Called by subclasses (and `Container`) after anything that moves the node changes. */
  protected writePosition(): void {
    this._pixi.position.set(this._snap ? snap(this._x) : this._x, this._snap ? snap(this._y) : this._y);
  }

  /** Write the scale to the Pixi node. `ImageObject` overrides this to add the flip rule. */
  protected writeScale(): void {
    this._pixi.scale.set(this._scaleX, this._scaleY);
  }
}
