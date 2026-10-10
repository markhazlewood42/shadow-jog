/**
 * Container: a GameObject that holds other GameObjects (docs/engine/scene-graph.md sections 2 to 4).
 * Follows: Phaser `Container`. Pixi backing: `Container`.
 *
 * Position, scale and depth of a child are LOCAL to its parent, as in Phaser. `add` and `remove`
 * change the parent; the child keeps its local values.
 *
 * `ySort` (M5, Godot y-sort): when on, the children draw in order of `y + ySortOrigin`, low first, and a tie goes to the child that was
 * added first. The depth is written the moment a child moves, is added or is removed, so there is no per-frame pass and no hook; the order is
 * right at any time, also for a test that never draws. How: the Pixi `zIndex` is the key plus `slot * TIE`, where `slot` is the child's place
 * in `list`. This is needed because Pixi's own sort is stable over the array it holds, and that array keeps the order of earlier sorts, so
 * "equal keys keep the order they were added" would be true only until the first reshuffle. The old field got the same rule from filling
 * its draw list in a fixed order each frame, then a stable `sort` (`fieldkit/draw.ts` `byBaseY`).
 *
 * Not built yet (on demand, M1 to M3): `setGrain`, `setSortingGroup`, masks and filters.
 */
import { Container as PixiContainer } from 'pixi.js';
import { assert } from '../core/assert';
import { type DisplayHost, GameObject } from './gameobject';

/**
 * The size of one slot in the Pixi `zIndex` of a `ySort` child (2^-30, about 1e-9). Two keys that differ by less than `children * TIE`
 * (about a millionth for 1,000 children) may sort the wrong way round. A key is a pixel row; the field's differ by whole pixels or by nothing.
 */
const TIE = 2 ** -30;

export class Container extends GameObject {
  private readonly children: GameObject[] = [];
  private _ySort = false;

  constructor(scene: DisplayHost, x = 0, y = 0, label = 'container') {
    const node = new PixiContainer({ label });
    super(scene, node);
    this.name = label;
    this.setPosition(x, y);
  }

  /** Godot y-sort. While on, the children draw by `y + ySortOrigin` (ties: the one added first), and their `depth` is read-only. Turn it off to give them their own depths again. */
  get ySort(): boolean {
    return this._ySort;
  }
  set ySort(on: boolean) {
    if (on === this._ySort) return;
    this._ySort = on;
    // On: every child takes its key. Off: every child goes back to the depth it had (or was given) before.
    for (const c of this.children) c._pixi.zIndex = on ? this.sortZ(c) : c.ownDepth;
  }

  /** @internal The sort key of a child: `y + ySortOrigin`. The key is the logical `y` (not the rounded one the picture uses). */
  ySortKey(child: GameObject): number {
    return child.y + child.ySortOrigin;
  }

  /** @internal A child moved or its origin changed: write its place in the draw order. Does nothing if `ySort` is off. */
  ySortChanged(child: GameObject): void {
    if (this._ySort) child._pixi.zIndex = this.sortZ(child);
  }

  private sortZ(child: GameObject): number {
    return this.ySortKey(child) + child._slot * TIE;
  }

  /** The children, in the order they were added. For the order they DRAW in, see `drawOrder`. */
  get list(): readonly GameObject[] {
    return this.children;
  }

  /**
   * Add a child (or several). A child that already has a parent is moved: it leaves the old one
   * first, so an object is never in two lists. Adding a child that is already here does nothing.
   */
  add(child: GameObject | readonly GameObject[]): this {
    if (Array.isArray(child)) {
      for (const c of child as readonly GameObject[]) this.add(c);
      return this;
    }
    const go = child as GameObject;
    assert(!go.destroyed, `Container.add: "${go.name}" was destroyed`);
    assert(go !== this, 'Container.add: a container cannot hold itself');
    assert(!this.isInside(go), `Container.add: "${go.name}" holds this container, so it would hold itself`);
    if (go._parent === this) return this;
    go._parent?.remove(go);
    go._parent = this;
    go._slot = this.children.length;
    this.children.push(go);
    this._pixi.addChild(go._pixi);
    if (this._ySort) go._pixi.zIndex = this.sortZ(go);
    return this;
  }

  /** Remove a child without destroying it, or destroy it too. A child that is not here is ignored. */
  remove(child: GameObject, destroy = false): this {
    const i = this.children.indexOf(child);
    if (i < 0) return this;
    this.children.splice(i, 1);
    child._parent = null;
    this._pixi.removeChild(child._pixi);
    // The children after it move up one place: their slots, and so their keys, change by one.
    for (let j = i; j < this.children.length; j++) {
      const c = this.children[j];
      if (!c) continue;
      c._slot = j;
      if (this._ySort) c._pixi.zIndex = this.sortZ(c);
    }
    // Back to the depth it had before: a y-sorted child's key is not its own depth.
    child._pixi.zIndex = child.ownDepth;
    if (destroy) child.destroy();
    return this;
  }

  /** Remove every child. */
  removeAll(destroy = false): this {
    for (const c of [...this.children]) this.remove(c, destroy);
    return this;
  }

  /**
   * The children in the order they draw: by depth, low first. Equal depths keep the order they
   * were added (Pixi breaks ties the same way). Allocates: for tests and dev tools, not for a tick.
   */
  drawOrder(): GameObject[] {
    return this.children.map((c, i) => ({ c, i })).sort((a, b) => a.c.depth - b.c.depth || a.i - b.i).map((e) => e.c);
  }

  /** Destroy the children first, then this container. A child removed earlier is not touched. */
  override destroy(): void {
    if (this.destroyed) return;
    for (const c of [...this.children]) c.destroy();
    super.destroy();
  }

  /** Is `other` this container, or an ancestor of it? (Adding an ancestor would make a loop.) */
  private isInside(other: GameObject): boolean {
    for (let p: GameObject | null = this; p; p = p._parent) if (p === other) return true;
    return false;
  }
}
