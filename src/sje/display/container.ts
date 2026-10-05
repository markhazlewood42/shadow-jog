/**
 * Container: a GameObject that holds other GameObjects (docs/engine/scene-graph.md sections 2 to 4).
 * Follows: Phaser `Container`. Pixi backing: `Container`.
 *
 * Position, scale and depth of a child are LOCAL to its parent, as in Phaser. `add` and `remove`
 * change the parent; the child keeps its local values.
 *
 * Not built yet (on demand, M1 to M3): `setGrain`, `setSortingGroup`, `ySort`, masks and filters.
 */
import { Container as PixiContainer } from 'pixi.js';
import { assert } from '../core/assert';
import { type DisplayHost, GameObject } from './gameobject';

export class Container extends GameObject {
  private readonly children: GameObject[] = [];

  constructor(scene: DisplayHost, x = 0, y = 0, label = 'container') {
    const node = new PixiContainer({ label });
    super(scene, node);
    this.name = label;
    this.setPosition(x, y);
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
    this.children.push(go);
    this._pixi.addChild(go._pixi);
    return this;
  }

  /** Remove a child without destroying it, or destroy it too. A child that is not here is ignored. */
  remove(child: GameObject, destroy = false): this {
    const i = this.children.indexOf(child);
    if (i < 0) return this;
    this.children.splice(i, 1);
    child._parent = null;
    this._pixi.removeChild(child._pixi);
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
