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
    const a = t.addCanvas('a', canvas);
    const b = t.addCanvas('b', canvas);
    expect(a.base).not.toBe(b.base);
    expect(a.base.source).not.toBe(b.base.source);
    expect(a.base.source.scaleMode).toBe('nearest');
  });

  it('frames share one source; unknown or out-of-range frames are errors', () => {
    const t = new TextureManager();
    const e = t.addCanvas('s', fakeCanvas(32, 16));
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
    const e = t.addCanvas('a', fakeCanvas(4, 4));
    const update = vi.spyOn(e.base.source, 'update');
    expect(update).not.toHaveBeenCalled();
    e.refresh();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('remove() destroys the frame textures first and the shared source ONCE', () => {
    const t = new TextureManager();
    const e = t.addCanvas('s', fakeCanvas(32, 16));
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
