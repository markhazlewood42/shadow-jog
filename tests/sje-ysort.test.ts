/**
 * M5 task 2: `Container.ySort` (docs/engine/scene-graph.md section 4, Godot y-sort). The children draw by `y + ySortOrigin`, low first, and a tie
 * goes to the child that was added first: the rule of the old field's `byBaseY` (`src/scenes/fieldkit/draw.ts`), which has no tie rule of its own
 * and gets one from a stable sort over a list filled in a fixed order.
 *
 * The order is read from PIXI'S OWN children array after its sort has run (`pixiOrder`), not from the engine's model of it (`drawOrder`), so the
 * test sees what the renderer would draw. Each check that guards a trap has a control: the same history in a container without `ySort`, which
 * shows the trap is real.
 */
import type { Container as PixiContainer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { Container } from '../src/sje/display/container';
import type { GameObject } from '../src/sje/display/gameobject';
import { Graphics } from '../src/sje/display/graphics';
import { TextureManager } from '../src/sje/display/texturemanager';
import { byBaseY, type DrawEntry } from '../src/scenes/fieldkit/draw';

function rig() {
  const host = { textures: new TextureManager() };
  const group = new Container(host, 0, 0, 'actors');
  const make = (name: string, y: number, add = true): Graphics => {
    const g = new Graphics(host);
    g.name = name;
    g.y = y;
    if (add) group.add(g);
    return g;
  };
  return { host, group, make };
}

/** The children in the order Pixi will draw them: its array, after the sort it runs when a depth changed. */
function pixiOrder(c: Container): string[] {
  const node = c.node as PixiContainer;
  node.sortChildren();
  return node.children.map((n) => c.list.find((g) => g._pixi === n)?.name ?? '?');
}

describe('Container.ySort: the order', () => {
  it('draws the lowest y first, and follows the objects when they move', () => {
    const { group, make } = rig();
    group.ySort = true;
    const a = make('a', 30);
    make('b', 10);
    make('c', 20);
    expect(pixiOrder(group)).toEqual(['b', 'c', 'a']);
    a.y = 5;
    expect(pixiOrder(group)).toEqual(['a', 'b', 'c']);
    a.setPosition(0, 99);
    expect(pixiOrder(group)).toEqual(['b', 'c', 'a']);
  });

  it('works when ySort is turned on after the children are in', () => {
    const { group, make } = rig();
    make('a', 30);
    make('b', 10);
    expect(pixiOrder(group)).toEqual(['a', 'b']);
    group.ySort = true;
    expect(pixiOrder(group)).toEqual(['b', 'a']);
  });

  it('the key is y + ySortOrigin: a sprite drawn from its top edge sorts by its feet', () => {
    const { group, make } = rig();
    group.ySort = true;
    const tall = make('tall', 0); // its top is at 0, its feet at 40
    make('mid', 25);
    tall.ySortOrigin = 40;
    expect(pixiOrder(group)).toEqual(['mid', 'tall']);
    // CONTROL: with no origin the same two objects sort the other way, so the origin is what decided it above.
    tall.ySortOrigin = 0;
    expect(pixiOrder(group)).toEqual(['tall', 'mid']);
    // A hop moves y but not the sort line: the stage keeps y + origin fixed by moving both.
    tall.ySortOrigin = 40;
    tall.y = -6;
    tall.ySortOrigin = 46;
    expect(tall.depth).toBe(40);
  });

  it('uses the logical y, not the rounded one the picture is placed at', () => {
    const { group, make } = rig();
    group.ySort = true;
    make('a', 10.4);
    make('b', 10.2);
    // Rounded, both are 10 and a would win the tie. Logical, b is higher up the screen and goes first.
    expect(pixiOrder(group)).toEqual(['b', 'a']);
  });

  it('a tie goes to the child added first', () => {
    const { group, make } = rig();
    group.ySort = true;
    for (const n of ['a', 'b', 'c', 'd']) make(n, 7);
    expect(pixiOrder(group)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the tie rule survives a reshuffle: A leaves the tie and comes back, and is still first', () => {
    const { group, make } = rig();
    group.ySort = true;
    const a = make('a', 5);
    make('b', 5);
    make('c', 5);
    a.y = 9;
    expect(pixiOrder(group)).toEqual(['b', 'c', 'a']);
    a.y = 5;
    expect(pixiOrder(group)).toEqual(['a', 'b', 'c']);
  });

  it('CONTROL: the same history with plain depths leaves Pixi in the order of the last sort (the trap the tie slot avoids)', () => {
    const { group, make } = rig();
    const a = make('a', 0);
    make('b', 0);
    make('c', 0);
    a.depth = 9;
    expect(pixiOrder(group)).toEqual(['b', 'c', 'a']);
    a.depth = 0;
    // a was added first, but Pixi's sort is stable over the array it holds, and that array is [b, c, a] now.
    expect(pixiOrder(group)).toEqual(['b', 'c', 'a']);
  });

  it('the tie rule holds for hundreds of children at a large y', () => {
    const { group, make } = rig();
    group.ySort = true;
    const names: string[] = [];
    for (let i = 0; i < 600; i++) {
      names.push(`n${i}`);
      make(`n${i}`, 640);
    }
    expect(pixiOrder(group)).toEqual(names);
  });
});

describe('Container.ySort: the field draw order', () => {
  /** A small deterministic generator, so the test needs no seed library. */
  function lcg(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('gives the same order as the old byBaseY sort over the old fill order (sprites, then chests, then actors), ties included', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rnd = lcg(seed);
      // Few distinct rows on purpose, so there are many ties.
      const y = () => Math.floor(rnd() * 12) * 8 + 7;
      const list: DrawEntry[] = [];
      const entries: { name: string; y: number }[] = [];
      for (const [kind, count, tag] of [[0, 25, 's'], [1, 4, 'c'], [2, 6, 'p']] as const) {
        for (let i = 0; i < count; i++) {
          const baseY = y();
          const name = `${tag}${i}`;
          list.push({ baseY, kind, ref: name as never });
          entries.push({ name, y: baseY });
        }
      }
      const legacy = [...list].sort(byBaseY).map((e) => e.ref as unknown as string);

      const { group, make } = rig();
      group.ySort = true;
      for (const e of entries) make(e.name, e.y);
      expect(pixiOrder(group), `seed ${seed}`).toEqual(legacy);
    }
  });

  it('CONTROL: filling the list in another order (actors first) gives another order, so the test depends on the add order', () => {
    const { group, make } = rig();
    group.ySort = true;
    make('actor', 20);
    make('sprite', 20);
    expect(pixiOrder(group)).toEqual(['actor', 'sprite']);
    const other = rig();
    other.group.ySort = true;
    other.make('sprite', 20);
    other.make('actor', 20);
    expect(pixiOrder(other.group)).toEqual(['sprite', 'actor']);
  });
});

describe('Container.ySort: adding, removing, turning off', () => {
  it('removing a child keeps the tie order of the rest, and a new child goes last among its ties', () => {
    const { group, make } = rig();
    group.ySort = true;
    const a = make('a', 3);
    make('b', 3);
    make('c', 3);
    group.remove(a);
    expect(pixiOrder(group)).toEqual(['b', 'c']);
    make('d', 3);
    expect(pixiOrder(group)).toEqual(['b', 'c', 'd']);
    // Destroying a child in the middle is the same as removing it.
    group.list.find((g) => g.name === 'c')?.destroy();
    expect(pixiOrder(group)).toEqual(['b', 'd']);
  });

  it('a child that leaves gets back the depth it had; ySort off gives every child its own depth again', () => {
    const { host, group, make } = rig();
    const plain = new Container(host, 0, 0, 'plain');
    const a = make('a', 50, false);
    a.depth = 7; // its own depth, set before it joins a y-sorted container
    group.ySort = true;
    group.add(a);
    make('b', 10);
    expect((a._pixi as PixiContainer).zIndex).toBeGreaterThan(40);
    group.remove(a);
    expect((a._pixi as PixiContainer).zIndex).toBe(7);
    expect(a.depth).toBe(7);

    group.add(a);
    group.ySort = false;
    expect(a.depth).toBe(7);
    expect((a._pixi as PixiContainer).zIndex).toBe(7);
    // Moved into another container, a is not sorted by y there.
    plain.add(a);
    a.y = 999;
    expect((a._pixi as PixiContainer).zIndex).toBe(7);
  });

  it('moving a child to another y-sorted container re-sorts it there', () => {
    const one = rig();
    const two = rig();
    one.group.ySort = true;
    two.group.ySort = true;
    const a = one.make('a', 30);
    two.make('b', 10);
    two.make('c', 40);
    two.group.add(a);
    expect(pixiOrder(two.group)).toEqual(['b', 'a', 'c']);
    expect(pixiOrder(one.group)).toEqual([]);
  });

  it('inside a y-sorted container the depth is the engine\'s: reading gives the key, writing throws', () => {
    const { group, make } = rig();
    group.ySort = true;
    const a = make('a', 12);
    a.ySortOrigin = 3;
    expect(a.depth).toBe(15);
    expect(() => {
      a.depth = 4;
    }).toThrow('ySort');
    expect(() => a.setDepth(4)).toThrow('ySort');
    // CONTROL: outside a y-sorted container the same write is fine.
    const free = rig().make('free', 0);
    expect(() => {
      free.depth = 4;
    }).not.toThrow();
    expect(free.depth).toBe(4);
  });

  it('a container without ySort is unchanged: y does not touch the depth', () => {
    const { group, make } = rig();
    const a = make('a', 0);
    const b = make('b', 0);
    a.depth = 2;
    a.y = 500;
    b.y = -500;
    expect(pixiOrder(group)).toEqual(['b', 'a']);
    expect(a.depth).toBe(2);
    expect(group.drawOrder().map((g: GameObject) => g.name)).toEqual(['b', 'a']);
  });

  it('drawOrder (the model) agrees with Pixi for a y-sorted container', () => {
    const { group, make } = rig();
    group.ySort = true;
    make('a', 8);
    make('b', 2);
    make('c', 8);
    make('d', 2);
    expect(group.drawOrder().map((g) => g.name)).toEqual(pixiOrder(group));
    expect(pixiOrder(group)).toEqual(['b', 'd', 'a', 'c']);
  });
});
