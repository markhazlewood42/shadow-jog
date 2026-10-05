/**
 * Engine level 2 (src/sje/display) against the REAL Pixi scene classes, in Node (no GPU).
 * Pixi's Container, Sprite and Graphics work with no DOM. We reach the Pixi node through the
 * `@internal` `node` property, cast to the few fields we check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera, CameraManager } from '../src/sje/display/camera';
import { Container } from '../src/sje/display/container';
import { DEPTH, depthFor, PART } from '../src/sje/display/depth';
import type { DisplayHost } from '../src/sje/display/gameobject';
import { Graphics } from '../src/sje/display/graphics';
import { ImageObject, wholePixelOrigin } from '../src/sje/display/imageobject';
import { Sprite } from '../src/sje/display/sprite';
import { TextureManager } from '../src/sje/display/texturemanager';
import { fakeCanvas } from './sjekit';

/** The bits of a Pixi node these tests read. */
interface PixiNode {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  anchor: { x: number; y: number };
  zIndex: number;
  sortableChildren: boolean;
  children: PixiNode[];
  parent: PixiNode | null;
  destroyed: boolean;
  label: string;
  sortChildren(): void;
  getLocalBounds(): { x: number; y: number; width: number; height: number };
}
const px = (o: { node: unknown }) => o.node as PixiNode;

function host(): DisplayHost & { textures: TextureManager } {
  return { textures: new TextureManager() };
}

afterEach(() => vi.restoreAllMocks());

describe('snap to pixel', () => {
  it('writes Math.round of x and y to the Pixi node, and keeps the logical value', () => {
    const h = host();
    const c = new Container(h);
    c.setPosition(40.5, 10.4);
    expect(px(c).position).toMatchObject({ x: 41, y: 10 });
    expect([c.x, c.y]).toEqual([40.5, 10.4]);
    c.x = 99.49;
    expect(px(c).position.x).toBe(99);
    c.y = -0.4; // rounds to -0: must come out as a plain 0
    expect(Object.is(px(c).position.y, 0)).toBe(true);
  });

  it('setPixelSnap(false) lets an object move smoothly', () => {
    const c = new Container(host());
    c.setPixelSnap(false).setPosition(40.25, 3.75);
    expect(px(c).position).toMatchObject({ x: 40.25, y: 3.75 });
    c.setPixelSnap(true);
    expect(px(c).position).toMatchObject({ x: 40, y: 4 });
  });

  it('a nested child of whole-pixel parents lands on a whole pixel', () => {
    const h = host();
    const outer = new Container(h, 10.6, 20.4);
    const inner = new Container(h, 5.5, 5.5);
    outer.add(inner);
    // 11 + 6 = 17, 20 + 6 = 26: both whole.
    expect(px(outer).position.x + px(inner).position.x).toBe(17);
    expect(px(outer).position.y + px(inner).position.y).toBe(26);
  });
});

describe('snap to pixel is the ONLY rounding: with roundPixels OFF at the renderer, every snapped node sits on a whole world pixel', () => {
  /** Where a node ends up on screen: its world position, and for a picture, the corner of its box. Pixi works these out. */
  const worldOf = (o: { node: unknown }) => {
    const n = o.node as PixiNode & { getGlobalPosition(): { x: number; y: number }; getBounds(): { x: number; y: number; width: number; height: number } };
    return { origin: n.getGlobalPosition(), box: n.getBounds() };
  };

  const FRACTIONS = [0, 0.25, 0.5, 0.5, 0.75, 0.1, 0.9, -0.5];

  /** A tiny seeded generator, so the test is the same every run. Gives numbers with fractions, ties (.5) and negatives. */
  function* positions(seed: number): Generator<number> {
    let s = seed;
    for (;;) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const whole = (s % 600) - 200;
      yield whole + (FRACTIONS[(s >>> 12) % 8] ?? 0);
    }
  }

  it('a deep tree of containers, images, flipped images, odd sizes and graphics, under a camera with a fractional scroll', () => {
    const h = host();
    h.textures.addCanvas('even', fakeCanvas(16, 16));
    // A size and a key no other test uses: the engine warns about a rounded origin once per message, and the origin test counts that warning.
    h.textures.addCanvas('odd-snap', fakeCanvas(13, 7));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const next = positions(7);
    const take = () => next.next().value as number;

    const world = new Container(h);
    const camera = new Camera(world);
    camera.setScroll(take(), take()); // a fractional scroll is rounded by the camera
    const nodes: Array<{ node: unknown; what: string }> = [{ node: world, what: 'world' }];
    for (let branch = 0; branch < 12; branch++) {
      const outer = new Container(h, take(), take());
      const inner = new Container(h, take(), take());
      world.add(outer);
      outer.add(inner);
      const even = new ImageObject(h, take(), take(), 'even').setScale(branch % 3 === 0 ? 2 : 1);
      const flipped = new ImageObject(h, take(), take(), 'even').setOrigin(0.25, 0.5).setFlipX(true);
      const odd = new ImageObject(h, take(), take(), 'odd-snap'); // origin 0.5 of an odd size: the wrapper rounds it to a whole pixel
      const mirrored = new ImageObject(h, take(), take(), 'even').setScale(-1, 1);
      const g = new Graphics(h, take(), take());
      g.fillStyle(0xff0000).fillRect(take(), take(), 12.4, 7.6);
      inner.add([even, flipped, odd, mirrored, g]);
      nodes.push({ node: outer, what: 'outer' }, { node: inner, what: 'inner' }, { node: even, what: 'even' }, { node: flipped, what: 'flipped' }, { node: odd, what: 'odd' }, { node: mirrored, what: 'mirrored' }, { node: g, what: 'graphics' });
    }
    expect(nodes.length).toBeGreaterThan(80);
    for (const { node, what } of nodes) {
      const w = worldOf(node as { node: unknown });
      expect(Number.isInteger(w.origin.x) && Number.isInteger(w.origin.y), `${what}: world position ${w.origin.x}, ${w.origin.y}`).toBe(true);
      // The box of a picture or a drawing: its corner is on a whole pixel too, so nothing is sampled between pixels.
      if (what !== 'world' && what !== 'outer' && what !== 'inner') {
        expect(Number.isInteger(w.box.x) && Number.isInteger(w.box.y), `${what}: box corner ${w.box.x}, ${w.box.y}`).toBe(true);
      }
    }
  });

  it('control: an object that opted out (setPixelSnap(false)) is NOT whole, so the check above can fail', () => {
    const c = new Container(host());
    c.setPixelSnap(false).setPosition(10.5, 3.25);
    const w = worldOf(c);
    expect(Number.isInteger(w.origin.x)).toBe(false);
  });
});

describe('origin, flip and frames of an ImageObject', () => {
  function withSheet() {
    const h = host();
    h.textures.addCanvas('sheet', fakeCanvas(32, 16));
    h.textures.addFrames('sheet', { a: [0, 0, 16, 16], b: [16, 0, 16, 16] });
    h.textures.addCanvas('odd', fakeCanvas(15, 9));
    return h;
  }

  it('origin is 0.5 by default and is written to the Pixi anchor (Pixi alone defaults to 0,0)', () => {
    const h = withSheet();
    const s = new ImageObject(h, 0, 0, 'sheet', 'a');
    expect([s.originX, s.originY]).toEqual([0.5, 0.5]);
    expect(px(s).anchor).toMatchObject({ x: 0.5, y: 0.5 });
    s.setOrigin(0.25, 1);
    expect(px(s).anchor).toMatchObject({ x: 0.25, y: 1 });
  });

  it('flip follows Phaser: scale.x is negative AND anchor.x is 1 - originX (same place, mirrored)', () => {
    const h = withSheet();
    const s = new ImageObject(h, 0, 0, 'sheet', 'a').setOrigin(0.25, 0.5).setScale(2, 2);
    s.setFlipX(true);
    expect(px(s).scale).toMatchObject({ x: -2, y: 2 });
    expect(px(s).anchor).toMatchObject({ x: 0.75, y: 0.5 });
    s.setFlipX(false);
    expect(px(s).scale).toMatchObject({ x: 2, y: 2 });
    expect(px(s).anchor).toMatchObject({ x: 0.25, y: 0.5 });
    // A negative logical scale still flips the same way (the wrapper uses -abs).
    s.setScale(-3, 3).setFlipX(true);
    expect(px(s).scale.x).toBe(-3);
  });

  it('the flipped picture covers the same span as the unflipped one (mirrored about the middle)', () => {
    // Left edge = x - scale * anchor * width for an unflipped sprite; for a flipped one the span is
    // x + |scale| * (1 - anchor) * width .. going left. Both must cover [x - ox*w, x + (1-ox)*w].
    const h = withSheet();
    const s = new ImageObject(h, 100, 50, 'sheet', 'a').setOrigin(0.25, 0.5);
    const span = (flip: boolean) => {
      s.setFlipX(flip);
      const n = px(s);
      const a = n.position.x - n.scale.x * n.anchor.x * 16;
      const b = n.position.x + n.scale.x * (1 - n.anchor.x) * 16;
      return [Math.min(a, b), Math.max(a, b)];
    };
    expect(span(true)).toEqual(span(false));
  });

  it('an origin that is not a whole pixel is rounded, with ONE dev warning', async () => {
    const h = withSheet();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = new ImageObject(h, 0, 0, 'odd'); // 15 px wide: 0.5 -> 7.5 px
    const b = new ImageObject(h, 0, 0, 'odd');
    expect(px(a).anchor.x).toBeCloseTo(8 / 15, 9);
    expect(px(b).anchor.x).toBeCloseTo(8 / 15, 9);
    expect(a.originX).toBe(0.5); // the logical origin is kept
    expect(warn).not.toHaveBeenCalled(); // the warning waits a microtask: the origin may be set right after
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1); // the second object says the same thing: not repeated
  });

  it('no warning when the origin is fixed in the same breath (add.image(...).setOrigin(0, 0))', async () => {
    const h = withSheet();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = new ImageObject(h, 0, 0, 'odd').setOrigin(0, 1);
    expect(px(s).anchor).toMatchObject({ x: 0, y: 1 });
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    // And a destroyed object never warns late.
    const gone = new ImageObject(h, 0, 0, 'odd');
    gone.destroy();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
  });

  it('wholePixelOrigin keeps whole-pixel origins unchanged', () => {
    expect(wholePixelOrigin(0.5, 16)).toBe(0.5);
    expect(wholePixelOrigin(7 / 15, 15)).toBe(7 / 15);
    expect(wholePixelOrigin(0.5, 15)).toBeCloseTo(8 / 15, 12);
  });

  it('Sprite.setFrame switches frames of one texture; an unknown frame throws', () => {
    const h = withSheet();
    const s = new Sprite(h, 0, 0, 'sheet', 'a');
    expect(s.frame).toBe('a');
    s.setFrame('b');
    expect(s.frame).toBe('b');
    expect(s.texture.key).toBe('sheet');
    expect(s.width).toBe(16);
    expect(() => s.setFrame('nope')).toThrow(/frame "nope"/);
    // Images have setTexture(key, frame) but no setFrame (deviation 16).
    expect('setFrame' in new ImageObject(h, 0, 0, 'sheet', 'a')).toBe(false);
  });

  it('setTexture on a destroyed texture or object throws instead of drawing garbage', () => {
    const h = withSheet();
    const s = new ImageObject(h, 0, 0, 'sheet', 'a');
    h.textures.remove('sheet');
    expect(() => h.textures.get('sheet')).toThrow(/Missing texture "sheet"/);
    s.destroy();
    expect(() => s.setTexture('odd')).toThrow(/destroyed/);
  });
});

describe('leaves refuse children', () => {
  it('ImageObject, Sprite and Graphics have no add (Pixi only warns about a child of a leaf)', () => {
    const h = host();
    h.textures.addCanvas('t', fakeCanvas(8, 8));
    for (const leaf of [new ImageObject(h, 0, 0, 't'), new Sprite(h, 0, 0, 't'), new Graphics(h)]) {
      expect('add' in leaf).toBe(false);
      expect('list' in leaf).toBe(false);
    }
    expect('add' in new Container(h)).toBe(true);
  });
});

describe('depth and sorting', () => {
  it('depth is written to Pixi zIndex, and Pixi sorts the children by it', () => {
    const h = host();
    const c = new Container(h);
    const a = new Container(h, 0, 0, 'a').setDepth(5);
    const b = new Container(h, 0, 0, 'b').setDepth(1);
    const d = new Container(h, 0, 0, 'd').setDepth(5);
    const e = new Container(h, 0, 0, 'e').setDepth(-1);
    c.add([a, b, d, e]);
    expect(px(c).sortableChildren).toBe(true);
    expect(c.list.map((o) => o.name)).toEqual(['a', 'b', 'd', 'e']); // insertion order
    expect(c.drawOrder().map((o) => o.name)).toEqual(['e', 'b', 'a', 'd']); // low first; ties keep insertion order
    px(c).sortChildren();
    expect(px(c).children.map((n) => n.label)).toEqual(['e', 'b', 'a', 'd']); // Pixi agrees
    expect(px(a).zIndex).toBe(5);
  });

  it('changing a depth re-orders the draw order', () => {
    const h = host();
    const c = new Container(h);
    const a = new Container(h, 0, 0, 'a');
    const b = new Container(h, 0, 0, 'b');
    c.add([a, b]);
    expect(c.drawOrder()).toEqual([a, b]);
    a.depth = 10;
    expect(c.drawOrder()).toEqual([b, a]);
    px(c).sortChildren();
    expect(px(c).children.map((n) => n.label)).toEqual(['b', 'a']);
  });

  it('the named bands and depthFor follow the spike', () => {
    expect([DEPTH.BACKDROP, DEPTH.GUIDE, DEPTH.MARKS, DEPTH.HUD]).toEqual([-1, 900_000, 1_000_000, 2_000_000]);
    expect(depthFor(100, 3, 1, 2)).toBe(100 * 1000 + 3 * 2 + 1 + 2 * 1000);
    // A figure lower on the screen draws over one higher up.
    expect(depthFor(120)).toBeGreaterThan(depthFor(119, 9, 1, 0));
    expect(PART.SHADOW).toBeLessThan(PART.BODY);
    expect(PART.BODY).toBeLessThan(PART.BAR);
    // Figures stay below the guide band.
    expect(depthFor(270, 99, 1, 0)).toBeLessThan(300_000);
  });
});

describe('Container add, remove and destroy', () => {
  it('moves a child between containers (it is never in two lists), keeping its local position', () => {
    const h = host();
    const a = new Container(h, 100, 0);
    const b = new Container(h, 200, 0);
    const kid = new Container(h, 7, 8, 'kid');
    a.add(kid);
    b.add(kid);
    expect(a.list).toEqual([]);
    expect(b.list).toEqual([kid]);
    expect(kid.parent).toBe(b);
    expect([kid.x, kid.y]).toEqual([7, 8]);
    expect(px(kid).parent).toBe(px(b));
    b.add(kid); // adding it again does nothing
    expect(b.list).toHaveLength(1);
  });

  it('remove keeps the child alive; remove(child, true) destroys it', () => {
    const h = host();
    const c = new Container(h);
    const k1 = new Container(h);
    const k2 = new Container(h);
    c.add([k1, k2]);
    c.remove(k1);
    expect(k1.destroyed).toBe(false);
    expect(k1.parent).toBeNull();
    c.remove(k2, true);
    expect(k2.destroyed).toBe(true);
    c.remove(k1); // not a child any more: ignored
  });

  it('destroying a container destroys its children, and a child removed earlier survives', () => {
    const h = host();
    const c = new Container(h);
    const kept = new Container(h);
    const gone = new Container(h);
    const deep = new Container(h);
    gone.add(deep);
    c.add([kept, gone]);
    c.remove(kept);
    c.destroy();
    expect(c.destroyed && gone.destroyed && deep.destroyed).toBe(true);
    expect(kept.destroyed).toBe(false);
    expect(px(kept).destroyed).toBe(false);
    c.destroy(); // twice is fine
  });

  it('destroying a child takes it out of its parent', () => {
    const h = host();
    const c = new Container(h);
    const k = new Container(h);
    c.add(k);
    k.destroy();
    expect(c.list).toEqual([]);
    expect(px(c).children).toHaveLength(0);
  });

  it('refuses a destroyed child and a loop (a container inside itself)', () => {
    const h = host();
    const a = new Container(h);
    const b = new Container(h);
    a.add(b);
    expect(() => b.add(a)).toThrow(/would hold itself/);
    expect(() => a.add(a)).toThrow(/cannot hold itself/);
    const dead = new Container(h);
    dead.destroy();
    expect(() => a.add(dead)).toThrow(/destroyed/);
  });

  it('a Graphics destroyed twice, or after its parent, does not throw', () => {
    const h = host();
    const c = new Container(h);
    const g = new Graphics(h);
    c.add(g);
    g.fillStyle(0xff0000).fillRect(0, 0, 4, 4);
    c.destroy();
    expect(g.destroyed).toBe(true);
    g.destroy();
  });
});

describe('Graphics', () => {
  it('rounds rectangle edges to whole pixels (round the corners, not the size)', () => {
    const g = new Graphics(host());
    g.fillStyle(0xff0000, 1).fillRect(1.4, 1.6, 10.2, 5.5);
    // corners: round(1.4)=1, round(1.6)=2, round(11.6)=12, round(7.1)=7  ->  x 1..12, y 2..7
    expect(px(g).getLocalBounds()).toMatchObject({ x: 1, y: 2, width: 11, height: 5 });
  });

  it('two rectangles that touch still touch after rounding', () => {
    const g = new Graphics(host());
    g.fillStyle(0x00ff00).fillRect(0.5, 0, 9.5, 4).fillRect(10, 0, 4.4, 4);
    // 0.5 -> 1 (Math.round) and 10 -> 10: the first ends at round(0.5+9.5)=10, where the second starts.
    expect(px(g).getLocalBounds()).toMatchObject({ x: 1, width: 13 }); // 1..14
  });

  it('lineBetween covers both end pixels: a horizontal, a vertical and a diagonal line', () => {
    const g = new Graphics(host());
    g.lineStyle(1, 0xffffff).lineBetween(2, 5, 11, 5); // 10 pixels
    expect(px(g).getLocalBounds()).toMatchObject({ x: 2, y: 5, width: 10, height: 1 });
    g.clear().lineBetween(11, 5, 2, 5); // the other way round: the same pixels
    expect(px(g).getLocalBounds()).toMatchObject({ x: 2, y: 5, width: 10, height: 1 });
    g.clear().lineBetween(7, 3, 7, 20); // 18 pixels
    expect(px(g).getLocalBounds()).toMatchObject({ x: 7, y: 3, width: 1, height: 18 });
    g.clear().lineBetween(0, 0, 24, 24);
    expect(px(g).getLocalBounds()).toMatchObject({ x: 0, y: 0, width: 25, height: 25 });
    g.clear().lineBetween(30.4, 10.6, 30.4, 10.6); // a one-pixel line: both ends are the same pixel
    expect(px(g).getLocalBounds()).toMatchObject({ x: 30, y: 11, width: 1, height: 1 });
  });

  it('lineStyle takes only width 1; clear() empties it', () => {
    const g = new Graphics(host());
    // @ts-expect-error only 1 px lines are built
    expect(() => g.lineStyle(2, 0xffffff)).toThrow(/only 1 px/);
    g.lineStyle(1, 0xffffff).lineBetween(0, 0, 10, 0);
    expect(px(g).getLocalBounds().width).toBeGreaterThan(0);
    g.clear();
    expect(px(g).getLocalBounds().width).toBe(0);
  });
});

describe('TextureManager', () => {
  it('stores canvases by key, rejects a repeated key, lists keys', () => {
    const t = new TextureManager();
    const e = t.addCanvas('a', fakeCanvas(8, 8));
    expect(t.exists('a')).toBe(true);
    expect([e.width, e.height]).toEqual([8, 8]);
    expect(() => t.addCanvas('a', fakeCanvas(8, 8))).toThrow(/already exists/);
    expect(() => t.addCanvas('z', fakeCanvas(0, 8))).toThrow(/no size/);
    expect(t.getTextureKeys()).toEqual(['a']);
    expect(() => t.get('missing')).toThrow(/Missing texture "missing"/);
  });

  it('is nearest-filtered, and never shares a texture through Pixi’s global cache', () => {
    const t = new TextureManager();
    const canvas = fakeCanvas(8, 8);
    // Pixi's Texture.from(canvas) would hand back ONE cached texture for the same canvas object.
    t.addCanvas('a', canvas);
    t.addCanvas('b', canvas);
    const a = t.entryOf('a');
    const b = t.entryOf('b');
    expect(a.base).not.toBe(b.base);
    expect(a.base.source).not.toBe(b.base.source);
    expect(a.base.source.scaleMode).toBe('nearest');
  });

  it('frames share one source; unknown or out-of-range frames are errors', () => {
    const t = new TextureManager();
    t.addCanvas('s', fakeCanvas(32, 16));
    const e = t.entryOf('s');
    t.addFrames('s', { a: [0, 0, 16, 16], 7: [16, 0, 16, 16] });
    expect(e.frames.get('a')).toMatchObject({ x: 0, y: 0, w: 16, h: 16 });
    expect(e.pixiTexture('a').source).toBe(e.base.source);
    expect(e.pixiTexture(7).frame).toMatchObject({ x: 16, y: 0, width: 16, height: 16 });
    expect(() => t.addFrames('s', { a: [0, 0, 1, 1] })).toThrow(/already has frame "a"/);
    expect(() => t.addFrames('s', { big: [0, 0, 33, 16] })).toThrow(/outside/);
    expect(() => e.pixiTexture('nope')).toThrow(/frame "nope"/);
  });

  it('keeps a data bag per texture', () => {
    const t = new TextureManager();
    t.addCanvas('a', fakeCanvas(4, 4)).data.feet = { x: 2, y: 4 };
    expect(t.get('a').data.feet).toEqual({ x: 2, y: 4 });
  });

  it('refresh() uploads the canvas again (source.update), and not before', () => {
    const t = new TextureManager();
    t.addCanvas('a', fakeCanvas(4, 4));
    const update = vi.spyOn(t.entryOf('a').base.source, 'update');
    expect(update).not.toHaveBeenCalled();
    t.refresh('a');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('the refresh() that createCanvas hands out is bound to ITS texture: after remove it does nothing, and after a re-add it never touches the new one', () => {
    // Node has no document: a canvas maker with the one method createCanvas calls.
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) });
    try {
      const t = new TextureManager();
      const first = t.createCanvas('line', 4, 4);
      const firstUpdate = vi.spyOn(t.entryOf('line').base.source, 'update');
      first.refresh();
      expect(firstUpdate).toHaveBeenCalledTimes(1);

      t.remove('line');
      expect(() => first.refresh()).not.toThrow(); // gone: a no-op, not a "texture not found" error
      expect(firstUpdate).toHaveBeenCalledTimes(1);

      t.createCanvas('line', 4, 4); // the same key again
      const secondUpdate = vi.spyOn(t.entryOf('line').base.source, 'update');
      first.refresh(); // the OLD refresh must not reach the new texture
      expect(secondUpdate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('remove() destroys the frame textures first and the shared source ONCE', () => {
    const t = new TextureManager();
    t.addCanvas('s', fakeCanvas(32, 16));
    const e = t.entryOf('s');
    t.addFrames('s', { a: [0, 0, 16, 16], b: [16, 0, 16, 16] });
    const order: string[] = [];
    const cellDestroy = (name: string) => {
      const cell = e.pixiTexture(name);
      const orig = cell.destroy.bind(cell);
      vi.spyOn(cell, 'destroy').mockImplementation((withSource?: boolean) => {
        order.push(`${name}:${withSource ? 'with-source' : 'frame-only'}`);
        orig(withSource);
      });
    };
    cellDestroy('a');
    cellDestroy('b');
    const sourceDestroy = vi.spyOn(e.base.source, 'destroy');
    expect(t.remove('s')).toBe(true);
    expect(order).toEqual(['a:frame-only', 'b:frame-only']);
    expect(sourceDestroy).toHaveBeenCalledTimes(1);
    expect(e.destroyed).toBe(true);
    expect(t.remove('s')).toBe(false); // gone
    expect(() => e.pixiTexture()).toThrow(/destroyed/);
    expect(() => e.refresh()).toThrow(/destroyed/);
  });

  it('prune() removes the keys with a prefix that are not in use, and reports how many', () => {
    const t = new TextureManager();
    for (const k of ['enemy-a', 'enemy-b', 'enemy-c', 'crew-a']) t.addCanvas(k, fakeCanvas(4, 4));
    expect(t.prune('enemy-', new Set(['enemy-b']))).toBe(2);
    expect(t.getTextureKeys().sort()).toEqual(['crew-a', 'enemy-b']);
  });
});

describe('Camera', () => {
  const world = () => new Container(host());

  it('scroll is ALWAYS rounded to whole pixels, and the world moves by the negative of it', () => {
    const w = world();
    const cam = new Camera(w);
    cam.setScroll(1.4, 2.5);
    expect([cam.scrollX, cam.scrollY]).toEqual([1, 3]);
    expect(px(w).position).toMatchObject({ x: -1, y: -3 });
    cam.setScroll(-1.5, 99.49);
    expect([cam.scrollX, cam.scrollY]).toEqual([-1, 99]); // Math.round: .5 goes toward +infinity
    cam.setScroll(0.49);
    expect(Object.is(px(w).position.x, 0)).toBe(true); // never -0
    expect([cam.scrollX, cam.scrollY]).toEqual([0, 0]); // like Phaser, y defaults to x
  });

  it('a slow pan moves the world by 0 or 1 pixel per tick, never back and never by a fraction', () => {
    const w = world();
    const cam = new Camera(w);
    let last = 0;
    for (let t = 0; t < 600; t++) {
      cam.setScroll(t * 0.37, 0);
      const step = cam.scrollX - last;
      expect(step === 0 || step === 1).toBe(true);
      expect(Number.isInteger(px(w).position.x)).toBe(true);
      last = cam.scrollX;
    }
  });

  it('bounds clamp the scroll to the rectangle (the view is 480x270)', () => {
    const cam = new Camera(world()).setBounds(0, 0, 960, 540);
    cam.setScroll(-50, -50);
    expect([cam.scrollX, cam.scrollY]).toEqual([0, 0]);
    cam.setScroll(9999, 9999);
    expect([cam.scrollX, cam.scrollY]).toEqual([480, 270]); // 960-480, 540-270
    cam.setScroll(100.4, 7.6);
    expect([cam.scrollX, cam.scrollY]).toEqual([100, 8]);
  });

  it('bounds smaller than the view centre the picture; setBounds re-clamps the current scroll', () => {
    const cam = new Camera(world()).setBounds(0, 0, 400, 270);
    cam.setScroll(50, 0);
    expect(cam.scrollX).toBe(-40); // (400 - 480) / 2
    const cam2 = new Camera(world());
    cam2.setScroll(500, 0);
    cam2.setBounds(0, 0, 960, 270);
    expect(cam2.scrollX).toBe(480);
  });

  it('bounds themselves are rounded to whole pixels', () => {
    const cam = new Camera(world()).setBounds(0.4, 0, 960.4, 270);
    cam.setScroll(-9999, 0);
    expect(cam.scrollX).toBe(0);
    cam.setScroll(9999, 0);
    expect(cam.scrollX).toBe(480);
  });

  it('the ui camera never scrolls; CameraManager.apply writes both transforms', () => {
    const h = host();
    const world = new Container(h);
    const ui = new Container(h);
    const cams = new CameraManager(world, ui);
    expect(() => cams.ui.setScroll(5)).toThrow(/never scrolls/);
    cams.main.setScroll(10, 20);
    px(world).position.x = 0; // pretend something moved it
    cams.apply();
    expect(px(world).position).toMatchObject({ x: -10, y: -20 });
    expect(px(ui).position).toMatchObject({ x: 0, y: 0 });
  });

  it('does not have the members that are not built yet (they are compile errors, not silent no-ops)', () => {
    const cam = new Camera(world());
    for (const m of ['zoom', 'setZoom', 'startFollow', 'setDeadzone', 'fade', 'flash', 'shake', 'pan', 'zoomTo', 'filters']) {
      expect(m in cam).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ C7: when would roundPixels have changed a game pixel?
//
// The renderer has `roundPixels: false` (drift item 25, awaiting Mark's approval). Pixi's `roundPixels: true` would round every vertex of every
// picture to a whole screen pixel in the vertex shader: `floor(position + 0.5)`, the half going up (node_modules/pixi.js .../roundPixelsBit.mjs).
// The tests above show that every node the ENGINE snaps sits on a whole world pixel. That proves "no change" only when the final corners are whole,
// which depends on the scale. So here the question is asked case by case, with the answer worked out from the corners Pixi computes:
//
//   - the picture's world box (Pixi's `getBounds`) gives the four vertices (nothing here is rotated, so the box is the quad);
//   - for each axis, the pixels the GPU fills are those whose CENTRE is inside the quad ([a0, a1): the left edge counts, the right does not),
//     and with NEAREST sampling each filled pixel shows texel floor(u * size), u = (centre - a0) / (a1 - a0), mirrored for a flipped picture;
//   - do that once with the vertices as they are (roundPixels OFF, what ships) and once with each vertex rounded (roundPixels ON), and compare.
//
// "Changes a game pixel" means a pixel that is filled in one and not the other, or that shows another texel. One column or row is enough. The model
// has no GPU in it: it is the rule of the rasteriser, and the check of the same table on a real renderer is e2e/sje-parta.spec.ts (vi): the same nodes drawn with Pixi roundPixels off and on, on a GPU and on SwiftShader. It agrees with every row below except the tie rule (the tie cases are marked MODEL ONLY and are never pass or fail asserts): the model says an edge exactly half way always changes, and a real renderer computes the edge in floating point first, so a tie can fall either way (a 2x parent with the edge at 24.5 drew the same pixels both ways, the edge at 32.5 moved the picture). A tie is never safe. The mirror case with a negative scale is e2e/sje-parta.spec.ts (iv).
// Ties on the y axis depend on how the render target is turned over, so no case here puts a vertex exactly half way on y: every tie case is on x.

/** Pixel -> texel for one axis of a picture whose quad runs from `a0` to `a1` and which has `size` texels there. */
function axisMap(a0: number, a1: number, size: number, flip: boolean, rounded: boolean): Map<number, number> {
  const e0 = rounded ? Math.floor(a0 + 0.5) : a0;
  const e1 = rounded ? Math.floor(a1 + 0.5) : a1;
  const map = new Map<number, number>();
  if (e1 <= e0) return map;
  for (let c = Math.ceil(e0 - 0.5); c + 0.5 < e1; c++) {
    const u = (c + 0.5 - e0) / (e1 - e0);
    map.set(c, Math.min(size - 1, Math.floor((flip ? 1 - u : u) * size)));
  }
  return map;
}

/** How many pixels of the axis differ between the two ways of drawing (filled in one only, or another texel). */
function axisDiff(a0: number, a1: number, size: number, flip: boolean): number {
  const off = axisMap(a0, a1, size, flip, false);
  const on = axisMap(a0, a1, size, flip, true);
  let n = 0;
  for (const [c, t] of off) if (on.get(c) !== t) n++;
  for (const c of on.keys()) if (!off.has(c)) n++;
  return n;
}

/** The answer for one picture: the world box Pixi computes, whether every vertex is whole, and how many columns and rows roundPixels would change. */
function verdict(o: { node: unknown }, texW: number, texH: number, flip = false) {
  const b = (o.node as PixiNode & { getBounds(): { x: number; y: number; width: number; height: number } }).getBounds();
  const x0 = b.x;
  const x1 = b.x + b.width;
  const y0 = b.y;
  const y1 = b.y + b.height;
  const whole = [x0, x1, y0, y1].every((v) => Number.isInteger(v));
  const cols = axisDiff(x0, x1, texW, flip);
  const rows = axisDiff(y0, y1, texH, false);
  return { x0, x1, y0, y1, whole, cols, rows, changes: cols + rows > 0 };
}

describe('C7: does roundPixels false change any game pixel against roundPixels true? Case by case, from the vertices', () => {
  const report: string[] = [];
  afterEach(() => {
    if (report.length) console.log(`C7 ${report.join(' | ')}`);
    report.length = 0;
  });

  function sheet() {
    const h = host();
    h.textures.addCanvas('c7-even', fakeCanvas(16, 16));
    h.textures.addCanvas('c7-odd', fakeCanvas(11, 9));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return h;
  }

  /** Fractions and ties, negatives too, from a fixed seed. */
  function* spots(): Generator<number> {
    let s = 12345;
    for (;;) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      yield (s % 400) - 100 + (([0, 0.25, 0.5, 0.75, 0.1, 0.9, -0.5, 0.3] as const)[(s >>> 12) % 8] ?? 0);
    }
  }

  it('SCALE 1, 2 and -1 (the cases the engine always uses): NO game pixel changes, for even and odd pictures at any logical position, because every vertex is whole', () => {
    const h = sheet();
    const next = spots();
    const take = () => next.next().value as number;
    let checked = 0;
    for (const [scaleX, scaleY] of [
      [1, 1],
      [2, 2],
      [-1, 1],
    ] as const) {
      for (const key of ['c7-even', 'c7-odd'] as const) {
        const [w, hh] = key === 'c7-even' ? [16, 16] : [11, 9];
        for (let i = 0; i < 40; i++) {
          const o = new ImageObject(h, take(), take(), key).setScale(scaleX, scaleY);
          const v = verdict(o, w, hh, scaleX < 0);
          expect(v.whole, `${key} at scale ${scaleX},${scaleY}: box ${v.x0},${v.y0} to ${v.x1},${v.y1}`).toBe(true);
          expect(v.changes, `${key} at scale ${scaleX},${scaleY}`).toBe(false);
          checked++;
        }
      }
    }
    report.push(`scale 1/2/-1: ${checked} pictures, every vertex whole, 0 pixels change`);
  });

  it('a FRACTIONAL SCALE (setScale(1.5)): an even picture whose scaled size is whole (16 x 1.5 = 24) is still safe, but an odd one (11 x 9 -> 16.5 x 13.5) DOES change pixels', () => {
    const h = sheet();
    let wholeCase = 0;
    for (const x of [100, 101, 137]) {
      const even = new ImageObject(h, x, 50, 'c7-even').setScale(1.5);
      const v = verdict(even, 16, 16);
      expect(v.whole, `even at ${x}: ${v.x0}..${v.x1}`).toBe(true);
      expect(v.changes).toBe(false);
      wholeCase++;
    }
    // The odd picture: its width is 16.5 and its height 13.5, so one edge of each is half way between two pixels whatever the position is.
    const rows: string[] = [];
    for (const x of [100, 101, 137]) {
      const odd = new ImageObject(h, x, 50, 'c7-odd').setScale(1.5);
      const v = verdict(odd, 11, 9);
      expect(v.whole, `odd at ${x}`).toBe(false);
      expect(v.changes, `odd at ${x}: roundPixels would change ${v.cols} columns and ${v.rows} rows of its box ${v.x0},${v.y0} to ${v.x1},${v.y1}`).toBe(true);
      rows.push(`${v.cols} cols + ${v.rows} rows`);
    }
    report.push(`scale 1.5: even 16px (24 wide) 0 change in ${wholeCase} cases; odd 11x9 (16.5 x 13.5) CHANGES (${rows.join(', ')})`);
  });

  it('a node with PIXEL SNAP OFF: no change at a quarter pixel (the same pixels are filled either way). At exactly half a pixel the edge is a TIE: the model says it changes, but a tie is renderer-dependent (MODEL ONLY, not a pass or fail)', () => {
    const h = sheet();
    const at = (x: number) => verdict(new ImageObject(h, x, 50, 'c7-even').setPixelSnap(false), 16, 16);
    // Under half a pixel off: the rasteriser fills the same pixels as the rounded quad does.
    for (const x of [40.25, 40.75, 99.1, 99.9, 40.4999]) {
      const v = at(x);
      expect(v.whole, `x ${x}`).toBe(false);
      expect(v.changes, `x ${x}: ${v.cols} columns`).toBe(false);
    }
    // Exactly half: the picture's left edge sits on a pixel centre. This is a TIE. The exact-arithmetic model below says "the rasteriser fills
    // that pixel (the left edge counts) and roundPixels moves the edge up", but a real renderer computes the edge in floating point first, so it
    // can fall either way (round 2 saw a real GPU draw the same pixels both ways at an edge of 24.5). So this test does NOT assert "changes":
    // it asserts only that the edge really is a tie (so the case stays a tie if the numbers move), and the answer for a tie is "depends on
    // the renderer, never safe". The authority for ties is the A/B on a real renderer in e2e/sje-parta.spec.ts (vi).
    const tie = at(40.5);
    expect(Math.abs(tie.x0 % 1), 'the left edge is exactly half way between two pixels').toBe(0.5);
    expect(tie.rows, 'the y position was whole').toBe(0);
    report.push(`snap off: x 40.25/40.75/99.1/99.9 no change; x 40.5 is a TIE (model only: the model says ${tie.cols} columns change, a real renderer can fall either way, so a tie is never safe)`);
  });

  it('NESTED, a 1.09x push on the whole world (the battle camera): a picture of whole size and position is NOT on whole vertices, and roundPixels WOULD change its pixels', () => {
    const h = sheet();
    const world = new Container(h);
    world.setScale(1.09);
    const a = new ImageObject(h, 100, 100, 'c7-even');
    const b = new ImageObject(h, 237, 61, 'c7-even');
    world.add([a, b]);
    const va = verdict(a, 16, 16);
    const vb = verdict(b, 16, 16);
    expect(va.whole).toBe(false);
    expect(va.changes, `a: ${va.cols} columns and ${va.rows} rows`).toBe(true);
    expect(vb.changes, `b: ${vb.cols} columns and ${vb.rows} rows`).toBe(true);
    // The engine's own rounding does not help here: the child is snapped in ITS parent's space, then the parent scales it.
    report.push(`1.09x world: 16px pictures are 17.44 wide; roundPixels would change ${va.cols + va.rows} and ${vb.cols + vb.rows} pixel columns and rows (the picture is not on one grid either way: the texel sizes are uneven at 1.09x)`);
  });

  it('NESTED, a 2x parent (what setGrain(2) will be): whole and snapped children stay on whole vertices, so NO change; a snap-off child at x.3 is off the grid but still draws the same pixels; at x.25 it is a half-pixel TIE in world space (MODEL ONLY, renderer-dependent)', () => {
    const h = sheet();
    const grain = new Container(h);
    grain.setScale(2);
    // The last value: false = the pixels are the same, 'tie' = an edge exactly half way in world space (model only: renderer-dependent, never safe).
    const items: Array<[string, ImageObject, false | 'tie']> = [
      ['whole', new ImageObject(h, 30, 20, 'c7-even'), false],
      // The logical position is fractional, the engine snaps it in the parent's space, so the world position is whole (2 x whole).
      ['snapped .4', new ImageObject(h, 41.4, 20.4, 'c7-even'), false],
      ['snapped .75', new ImageObject(h, 52.75, 20.75, 'c7-even'), false],
      // An odd picture: the wrapper makes its origin a whole pixel, so its corners are whole in the parent's space and even in the world.
      ['odd', new ImageObject(h, 70, 20, 'c7-odd'), false],
      // Snap off at 0.3: 2 x 0.3 = 0.6 of a world pixel. Not a tie, so model and renderer agree: the same pixels are filled either way.
      ['snap off .3', new ImageObject(h, 130.3, 20, 'c7-even').setPixelSnap(false), false],
      // Snap off at a quarter pixel: 2 x 0.25 = half a world pixel. A tie on x: the model says "changes", a renderer may not.
      ['snap off .25', new ImageObject(h, 90.25, 20, 'c7-even').setPixelSnap(false), 'tie'],
      // Snap off at half a pixel: 2 x 0.5 = a whole world pixel again.
      ['snap off .5', new ImageObject(h, 110.5, 20, 'c7-even').setPixelSnap(false), false],
    ];
    grain.add(items.map(([, o]) => o));
    const out: string[] = [];
    for (const [name, o, expected] of items) {
      const [w, hh] = name === 'odd' ? [11, 9] : [16, 16];
      const v = verdict(o, w, hh);
      if (expected === 'tie') {
        // MODEL ONLY. Assert that it is a tie, not what the renderer does with it.
        expect(Math.abs(v.x0 % 1), `${name}: the left edge is exactly half way`).toBe(0.5);
        out.push(`${name} TIE (model says ${v.cols}c change, renderer-dependent, never safe)`);
        continue;
      }
      expect(v.changes, `${name}: ${v.cols} columns and ${v.rows} rows, box ${v.x0},${v.y0} to ${v.x1},${v.y1}`).toBe(false);
      if (!name.startsWith('snap off')) expect(v.whole, name).toBe(true);
      out.push(`${name} no change`);
    }
    report.push(`2x parent: ${out.join(', ')}`);
  });

  it('CONTROL: the check can fail (a 1.5x picture of odd size shows a change, so "no change" above is not the model saying no to everything)', () => {
    const h = sheet();
    expect(verdict(new ImageObject(h, 100, 50, 'c7-odd').setScale(1.5), 11, 9).changes).toBe(true);
    // And the model agrees with itself on the easy case: equal maps for a whole quad.
    expect([...axisMap(10, 26, 16, false, false)]).toEqual([...axisMap(10, 26, 16, false, true)]);
  });
});
