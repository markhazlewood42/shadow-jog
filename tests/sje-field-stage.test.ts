/**
 * M5 tasks 5 to 7: the field stage (src/fieldstage), its engine pieces and its seam, in plain Node (no browser, no GPU).
 *
 *  1. Engine pieces the stage needs: `GameObject.setBlendMode`, `Game.runBeneath` (a scene UNDER the one the player uses), the screen snapshot hook, `Lights.flickerSignature`.
 *  2. `checkStageMap`: the rules a map must meet before the stage shows it, each with a control (a good map passes; the same map with one change fails).
 *  3. `LitPicture`: the lit sprite is the old `Lighting.drawLit`, operation for operation, and lights again only when it could look different.
 *  4. `FieldStageScene`: the layers and their order, the y-sort (ties go to the order added: props, chests, actors), `loadMap` (bad data keeps the old map; a good one frees the old textures),
 *     `snapshot` and `restore`, the screen-fixed layer, a draw that throws, and what closing the scene frees.
 *  5. The seam (`fieldseam.ts`): no provider means no stage; a load that fails is a notice and null, never a throw.
 *
 * `document` is stubbed with canvases whose 2D context records every call, so the OLD code (which makes its canvases with `document.createElement`) and the new one run against the
 * same recorder. Pixi's scene classes run in Node; the stage is the real one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentNotice } from '../src/engine/errors';
import { Scene as OldScene } from '../src/engine/game';
import { Lighting } from '../src/field/lighting';
import type { BakedLight, SortedSprite } from '../src/field/bake';
import { TS } from '../src/field/tiles';
import { FieldStageScene } from '../src/fieldstage/stagescene';
import { LitPicture } from '../src/fieldstage/lit';
import { checkStageMap } from '../src/fieldstage/view';
import { FIELD_STAGE_FAILED_NOTICE, type FieldStage, type FieldStageProvider, type FieldStageSource, type FieldStageView, fieldStages, lazyFieldStageProvider, setFieldStageProvider, type StageActor, type StageChest, type StageMap } from '../src/scenes/fieldkit/fieldseam';
import { Container, H, Lights, W } from '../src/sje';
import { fakeCanvas, headlessGame, TestScene } from './sjekit';

// ---- a recording canvas stand-in ----------------------------------------------------------------------------------

interface RecCanvas {
  width: number;
  height: number;
  /** What the context was asked to do, as text. */
  log: string[];
  /** A name that stands for this canvas in another canvas's log (`drawImage(SPRITE,...)`). */
  tag: string;
  /** When true, `getImageData` says every pixel is opaque (the picture is not blank). */
  solid: boolean;
  style: Record<string, never>;
  getContext(kind: string, opts?: unknown): CanvasRenderingContext2D;
}

const made: RecCanvas[] = [];
let nextTag = 1;

function fmt(v: unknown): string {
  if (typeof v === 'object' && v !== null && 'tag' in (v as object)) return (v as { tag: string }).tag;
  return String(v);
}

function recCanvas(w = 0, h = 0, tag = `c${nextTag++}`): RecCanvas {
  const c: RecCanvas = {
    width: w,
    height: h,
    log: [],
    tag,
    solid: false,
    style: {},
    getContext() {
      const ctx = new Proxy({} as Record<string, unknown>, {
        get(_t, name: string) {
          if (name === 'canvas') return c;
          if (name === 'getImageData') return (_x: number, _y: number, iw: number, ih: number) => ({ data: new Uint8ClampedArray(iw * ih * 4).fill(c.solid ? 255 : 0) });
          if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
          return (...args: unknown[]) => {
            c.log.push(`${name}(${args.map(fmt).join(',')})`);
            return undefined;
          };
        },
        set(_t, name: string, v) {
          c.log.push(`${name} = ${fmt(v)}`);
          return true;
        },
      });
      return ctx as unknown as CanvasRenderingContext2D;
    },
  };
  made.push(c);
  return c;
}

const realDocument = (globalThis as { document?: unknown }).document;
beforeEach(() => {
  made.length = 0;
  (globalThis as unknown as { document: unknown }).document = { createElement: () => recCanvas() };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const asCanvas = (c: RecCanvas): HTMLCanvasElement => c as unknown as HTMLCanvasElement;

/** The canvas of a `CanvasImage` or the like, as the recorder. */
const recOf = (c: HTMLCanvasElement): RecCanvas => c as unknown as RecCanvas;

// ---- a map and a source -------------------------------------------------------------------------------------------

function prop(x: number, y: number, w: number, h: number, baseY: number, extra: Partial<SortedSprite> = {}): SortedSprite {
  return { canvas: asCanvas(recCanvas(w, h, `prop@${x},${y}`)), x, y, baseY, ...extra };
}

interface MapOptions {
  id?: string;
  w?: number;
  h?: number;
  lights?: BakedLight[];
  sprites?: SortedSprite[];
  hasOver?: boolean;
}

/** A small map (the layers are w*TS by h*TS) the way `FieldMap` gives one. */
function fakeMap(o: MapOptions = {}): StageMap {
  const w = o.w ?? 4;
  const h = o.h ?? 4;
  const layer = (name: string): HTMLCanvasElement => asCanvas(recCanvas(w * TS, h * TS, name));
  const hasOver = o.hasOver ?? true;
  return {
    def: { id: o.id ?? 'testmap', kind: 'town', ambient: '#605a86' },
    w,
    h,
    ground: layer('ground'),
    emit: layer('emit'),
    over: layer('over'),
    overEmit: layer('overEmit'),
    hasOver,
    overRects: hasOver ? [{ x: 0, y: 0, w: 32, h: 16 }] : [],
    lights: o.lights ?? [{ x: 32, y: 32, r: 40, color: '#ffcc88', i: 1 }],
    sprites: o.sprites ?? [prop(0, 0, 16, 16, 15), prop(16, 0, 16, 16, 15), prop(0, 8, 16, 16, 23)],
    anims: [],
  };
}

class FakeSource implements FieldStageSource {
  frame = 1;
  screen = false;
  screenCalls = 0;
  legacyPaints = 0;
  failures: unknown[] = [];
  throwOnView: Error | null = null;
  readonly v: FieldStageView;
  constructor(map: StageMap) {
    // A map smaller than the screen is centered: the camera origin is negative, as `cameraOrigin` gives it.
    const cx = Math.round((map.w * TS - W) / 2);
    const cy = Math.round((map.h * TS - H) / 2);
    this.v = { map, frame: 1, camX: cx, camY: cy, cx, cy, actors: [], chests: [] };
  }
  view(): FieldStageView {
    if (this.throwOnView) throw this.throwOnView;
    this.v.frame = this.frame;
    return this.v;
  }
  paintScreen(): boolean {
    this.screenCalls++;
    return this.screen;
  }
  paintLegacy(): void {
    this.legacyPaints++;
  }
  stageFailed(error: unknown): void {
    this.failures.push(error);
  }
}

function actor(ref: object, x: number, y: number, py: number, image = recCanvas(8, 16, `actor@${x},${y}`)): StageActor {
  return { ref, image: asCanvas(image), x, y, px: x + 4, py };
}

interface Rig {
  h: ReturnType<typeof headlessGame>;
  scene: FieldStageScene;
  src: FakeSource;
  map: StageMap;
}

function stage(o: MapOptions = {}): Rig {
  const h = headlessGame();
  const map = fakeMap(o);
  const src = new FakeSource(map);
  const scene = new FieldStageScene(src);
  void h.game.run(scene);
  return { h, scene, src, map };
}

/** One game frame: one tick and one draw. */
const frame = (r: Rig): void => {
  r.src.frame++;
  r.h.frame(17);
};

const sortOf = (r: Rig): Container => {
  const c = r.scene.sys.world.list.find((o) => o.name === 'sort');
  if (!(c instanceof Container)) throw new Error('no sort container');
  return c;
};

/** The names of the sort container's children in the order they draw. */
const drawn = (r: Rig): string[] => sortOf(r).drawOrder().map((o) => o.name);

// ---- 1. engine pieces ---------------------------------------------------------------------------------------------

describe('GameObject.setBlendMode', () => {
  it('writes the built modes to the Pixi node and refuses the two that are only in the design', () => {
    const r = stage();
    r.h.frame(17);
    const light = r.scene.sys.world.list.find((o) => o.blendMode === 'multiply');
    expect(light, 'the light map is a multiply image').toBeDefined();
    expect(r.scene.sys.world.list.filter((o) => o.blendMode === 'add').length).toBe(1);
    const c = new Container(r.scene);
    for (const mode of ['add', 'multiply', 'screen', 'normal'] as const) expect(c.setBlendMode(mode).blendMode).toBe(mode);
    expect(() => c.setBlendMode('min')).toThrow(/not built/);
    expect(() => c.setBlendMode('max')).toThrow(/not built/);
    c.destroy();
  });
});

describe('Game.runBeneath: a scene under the one the player uses', () => {
  it('puts the scene below, runs its lifecycle at once, and pauses and resumes nothing', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const top = new TestScene(log, 'top');
    void game.run(top);
    const under = new TestScene(log, 'under');
    void game.runBeneath(under, top);
    expect(game.scene.scenes).toEqual([under, top]);
    expect(log).toEqual(['top:init', 'top:preload', 'top:create', 'under:init', 'under:preload', 'under:create']);
    expect(log.some((l) => l.endsWith(':pause'))).toBe(false);
  });

  it('finds the adapter of an old scene, and takes the new scene off again when it closes', async () => {
    const { game } = headlessGame();
    class Old extends OldScene<void> {
      update(): void {}
      render(): void {}
    }
    const old = new Old();
    void game.run(old);
    const log: string[] = [];
    const under = new TestScene(log, 'under');
    const done = game.runBeneath(under, old);
    expect(game.scene.scenes.length).toBe(2);
    expect(game.scene.scenes[0]).toBe(under);
    under.close();
    await done;
    expect(game.scene.scenes.length).toBe(1);
    expect(game.top).toBe(old);
  });

  it('rejects when the scene above is not on the stack, and changes nothing', async () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const stranger = new TestScene(log, 'stranger');
    await expect(game.runBeneath(new TestScene(log, 'x'), stranger)).rejects.toThrow(/not on the stack/);
    expect(game.scene.scenes.length).toBe(0);
  });

  it('the scene below is drawn only while the one above is not opaque (the field makes itself non-opaque to show its stage)', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const top = new TestScene(log, 'top');
    void game.run(top);
    const under = new TestScene(log, 'under');
    void game.runBeneath(under, top);
    game.scene.refreshLayout();
    expect(under.sys.visible).toBe(false);
    top.opaque = false;
    game.scene.refreshLayout();
    expect(under.sys.visible).toBe(true);
  });
});

describe('Game.ctx asks a scene for a picture of itself', () => {
  it('calls paintSnapshot of every visible scene that has one (the screen snapshot of a battle intro)', () => {
    const r = stage();
    r.h.frame(17);
    const ctx = r.h.game.ctx;
    expect(ctx).toBeDefined();
    expect(r.src.legacyPaints).toBe(1);
  });

  it('control: a hidden stage paints nothing', () => {
    const r = stage();
    const log: string[] = [];
    void r.h.game.run(new TestScene(log, 'opaque cover'));
    r.h.game.scene.refreshLayout();
    void r.h.game.ctx;
    expect(r.src.legacyPaints).toBe(0);
  });
});

describe('LegacyShape.blank: a scene with a stage under it does not upload an empty canvas', () => {
  class Staged extends OldScene<void> {
    blank = true;
    renders = 0;
    update(): void {}
    render(): void {
      this.renders++;
    }
  }
  const imageOf = (game: ReturnType<typeof headlessGame>['game'], scene: object): { visible: boolean; canvas: RecCanvas } => {
    const w = game.scene.scenes.find((s) => (s as { legacy?: unknown }).legacy === scene) as unknown as { image: { visible: boolean; canvas: RecCanvas } };
    return w.image;
  };

  it('leaves its canvas out while there is nothing to paint on it, and does not even draw into it', () => {
    const h = headlessGame();
    const s = new Staged();
    void h.game.run(s);
    h.frame(17);
    expect(imageOf(h.game, s).visible).toBe(false);
    expect(s.renders).toBe(0);
  });

  it('paints it again while a fade is on, or an overlay has something to show, and leaves it out after', () => {
    const h = headlessGame();
    const s = new Staged();
    void h.game.run(s);
    h.frame(17);
    h.game.fadeLevel = 0.5;
    h.frame(17);
    expect(imageOf(h.game, s).visible).toBe(true);
    expect(s.renders).toBe(1);
    h.game.fadeLevel = 0;
    h.game.overlayWanted = () => true;
    h.frame(17);
    expect(imageOf(h.game, s).visible).toBe(true);
    h.game.overlayWanted = () => false;
    h.frame(17);
    expect(imageOf(h.game, s).visible).toBe(false);
  });

  it('control: a scene that is not blank always draws', () => {
    const h = headlessGame();
    const s = new Staged();
    s.blank = false;
    void h.game.run(s);
    h.frame(17);
    expect(imageOf(h.game, s).visible).toBe(true);
    expect(s.renders).toBe(1);
  });

  it('control: a blank scene that is not the topmost drawn one does not wait for the washes (they are painted on the top one)', () => {
    const h = headlessGame();
    const s = new Staged();
    void h.game.run(s);
    const top = new Staged();
    top.blank = false;
    top.opaque = false;
    void h.game.run(top);
    h.game.fadeLevel = 0.5;
    h.frame(17);
    expect(imageOf(h.game, s).visible).toBe(false);
    expect(imageOf(h.game, top).visible).toBe(true);
  });
});

describe('Lights.flickerSignature', () => {
  const lights = (): Lights => {
    const l = new Lights();
    l.addLight(100, 100, 40, '#ffffff', 1);
    l.addLight(300, 100, 40, '#ffffff', 1, { flicker: true, seed: 3 });
    return l;
  };
  it('is 0 where no flickering light reaches, and changes between frames where one does', () => {
    const l = lights();
    expect(l.flickerSignature(80, 80, 40, 40, 5)).toBe(0); // the steady light only
    expect(l.flickerSignature(500, 0, 40, 40, 5)).toBe(0); // nothing near
    const seen = new Set<number>();
    for (let f = 0; f < 30; f++) seen.add(l.flickerSignature(290, 90, 20, 20, f));
    expect(seen.size).toBeGreaterThan(5);
  });
  it('hasFlicker says whether any light flickers', () => {
    expect(lights().hasFlicker).toBe(true);
    expect(new Lights().hasFlicker).toBe(false);
  });
});

// ---- 2. the rules of a map ----------------------------------------------------------------------------------------

describe('checkStageMap', () => {
  it('accepts a good map', () => {
    expect(checkStageMap(fakeMap())).toEqual([]);
  });

  const bad: Array<[string, (m: StageMap) => StageMap, RegExp]> = [
    ['a layer of the wrong size', (m) => ({ ...m, ground: asCanvas(recCanvas(10, 10)) }), /ground layer is 10x10/],
    ['a missing layer', (m) => ({ ...m, emit: undefined as unknown as HTMLCanvasElement }), /emit layer is missing/],
    ['a map size that is not whole', (m) => ({ ...m, w: 2.5 }), /not a whole size/],
    ['an ambient color that is not a hex color', (m) => ({ ...m, def: { ...m.def, ambient: 'purple' } }), /ambient color "purple"/],
    ['a light with no radius', (m) => ({ ...m, lights: [{ x: 1, y: 1, r: 0, color: '#ffffff', i: 1 }] }), /radius of 0/],
    ['a light that is not a number', (m) => ({ ...m, lights: [{ x: Number.NaN, y: 1, r: 5, color: '#ffffff', i: 1 }] }), /not finite/],
    ['a light with a color that is not a hex color', (m) => ({ ...m, lights: [{ x: 1, y: 1, r: 5, color: 'red', i: 1 }] }), /color "red"/],
    ['an over rectangle outside the map', (m) => ({ ...m, overRects: [{ x: 60, y: 0, w: 32, h: 16 }] }), /not inside/],
    ['a sprite with no position', (m) => ({ ...m, sprites: [{ ...prop(0, 0, 4, 4, 3), x: Number.NaN }] }), /position that is not finite/],
  ];
  for (const [name, change, expected] of bad) {
    it(`refuses ${name}`, () => {
      expect(checkStageMap(change(fakeMap())).join('\n')).toMatch(expected);
    });
  }
});

// ---- 3. a lit picture ---------------------------------------------------------------------------------------------

describe('LitPicture: the old drawLit, operation for operation', () => {
  /** The ops on a canvas after its setup lines (the recorder sees `imageSmoothingEnabled = false` first on both sides). */
  const ops = (c: RecCanvas): string[] => c.log.filter((l) => !l.startsWith('imageSmoothingEnabled'));

  it('draws the same copy, multiply, destination-in on the same numbers as Lighting.drawLit', () => {
    const sprite = recCanvas(16, 24, 'SPRITE');
    for (const [sx, sy] of [[100, 50], [3, 7], [600, 300]] as const) {
      made.length = 0;
      const old = new Lighting();
      const mapCanvas = made[0];
      if (!mapCanvas) throw new Error('the old Lighting made no map canvas');
      mapCanvas.tag = 'MAP';
      const target = recCanvas().getContext('2d');
      const before = made.length;
      old.drawLit(target, asCanvas(sprite) as CanvasImageSource & { width: number; height: number }, sx, sy);
      const scratch = made[before];
      if (!scratch) throw new Error('the old drawLit made no scratch');
      const want = ops(scratch);
      expect(want.length, 'the old log is not empty').toBeGreaterThan(5);

      const pic = new LitPicture({ textures: stageTextures() }, 16, 24);
      const map = recCanvas(W, H, 'MAP');
      const imgCanvas = recOf(pic.image.canvas);
      imgCanvas.log.length = 0;
      pic.relight(asCanvas(sprite), null, asCanvas(map), old.spriteBoost, 0, 0, sx, sy, 0, 0);
      expect(ops(imgCanvas), `at ${sx},${sy}`).toEqual(want);
    }
  });

  it('control: another boost, another position and another picture each change the log', () => {
    const sprite = recCanvas(16, 24, 'SPRITE');
    const map = recCanvas(W, H, 'MAP');
    const logFor = (boost: number, sx: number, src = sprite): string[] => {
      const pic = new LitPicture({ textures: stageTextures() }, 16, 24);
      const c = recOf(pic.image.canvas);
      c.log.length = 0;
      pic.relight(asCanvas(src), null, asCanvas(map), boost, 0, 0, sx, 10, 0, 0);
      return c.log;
    };
    const base = logFor(0.32, 100);
    expect(logFor(0.5, 100)).not.toEqual(base);
    expect(logFor(0.32, 101)).not.toEqual(base);
    expect(logFor(0.32, 100, recCanvas(16, 24, 'OTHER'))).not.toEqual(base);
  });

  it('lights again only when the picture, its place, the flicker or the epoch changed, and always at the edge of the screen', () => {
    const pic = new LitPicture({ textures: stageTextures() }, 16, 24);
    const sprite = asCanvas(recCanvas(16, 24));
    const map = asCanvas(recCanvas(W, H));
    const lit = (o: { src?: HTMLCanvasElement; wx?: number; sx?: number; sig?: number; epoch?: number } = {}): boolean => pic.relight(o.src ?? sprite, null, map, 0.32, o.wx ?? 5, 5, o.sx ?? 100, 100, o.sig ?? 0, o.epoch ?? 0);
    expect(lit()).toBe(true); // first time
    expect(lit()).toBe(false); // nothing changed
    expect(lit({ sx: 140 })).toBe(false); // the camera moved, the prop stood still in the world
    expect(lit({ wx: 6 })).toBe(true); // it moved in the world
    expect(lit({ wx: 6, sig: 9 })).toBe(true); // a flickering light that reaches it changed
    expect(lit({ wx: 6, sig: 9, epoch: 1 })).toBe(true); // the ambient or the set of lights changed
    expect(lit({ wx: 6, sig: 9, epoch: 1, src: asCanvas(recCanvas(16, 24)) })).toBe(true); // another picture (a walk frame)
    expect(lit({ wx: 6, sig: 9, epoch: 1, src: sprite })).toBe(true); // and back
    expect(pic.lit).toBe(6);
    // The light map is only as big as the screen: a picture partly off it is lit every frame.
    expect(pic.relight(sprite, null, map, 0.32, 5, 5, -4, 100, 0, 1)).toBe(true);
    expect(pic.relight(sprite, null, map, 0.32, 5, 5, -4, 100, 0, 1)).toBe(true);
  });

  it('with the lights off the picture is copied as it is (the old drawLit drew it plain)', () => {
    const pic = new LitPicture({ textures: stageTextures() }, 16, 24);
    const c = recOf(pic.image.canvas);
    c.log.length = 0;
    pic.relight(asCanvas(recCanvas(16, 24, 'SPRITE')), null, null, 0.32, 0, 0, 10, 10, 0, 0);
    expect(c.log.join('\n')).not.toMatch(/multiply|destination-in/);
    expect(c.log.join('\n')).toMatch(/drawImage\(SPRITE/);
  });

  it('a cropped picture (a part of the overhead layer) reads the rectangle of its source', () => {
    const pic = new LitPicture({ textures: stageTextures() }, 32, 16);
    const c = recOf(pic.image.canvas);
    c.log.length = 0;
    pic.relight(asCanvas(recCanvas(64, 64, 'OVER')), { x: 8, y: 4 }, asCanvas(recCanvas(W, H, 'MAP')), 0, 8, 4, 50, 50, 0, 0);
    expect(c.log.filter((l) => l.startsWith('drawImage(OVER'))).toEqual(['drawImage(OVER,8,4,32,16,0,0,32,16)', 'drawImage(OVER,8,4,32,16,0,0,32,16)']);
    expect(c.log).toContain('globalAlpha = 1'); // boost 0: the whole map multiplies
  });
});

/** A texture manager for the LitPicture tests: the one of a headless game. */
function stageTextures(): import('../src/sje').TextureManager {
  return headlessGame().game.textures;
}

// ---- 4. the scene -------------------------------------------------------------------------------------------------

describe('FieldStageScene: what it builds', () => {
  it('has the layers of the old render, in its order, after the first frame', () => {
    const r = stage();
    r.h.frame(17);
    const layers = r.scene.sys.world.list.map((o) => `${o.depth}:${o.name}`);
    const depths = r.scene.sys.world.list.map((o) => o.depth).sort((a, b) => a - b);
    // surround 0, ground 10, lit anims 20, shadows 25, light 30, emit 40, unlit anims 50, sort 60, over 70, over emit 80, bloom 90, screen 100
    expect(new Set(depths)).toEqual(new Set([0, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100]));
    expect(layers.find((l) => l.startsWith('10:'))).toMatch(/field-1-ground/);
    expect(layers.find((l) => l.startsWith('40:'))).toMatch(/field-1-emit/);
    expect(layers.find((l) => l.startsWith('80:'))).toMatch(/field-1-overEmit/);
    expect(r.scene.mapId).toBe('testmap');
  });

  it('adopts the baked canvases as textures: no copy of the layers is made', () => {
    const r = stage();
    r.h.frame(17);
    const tex = r.h.game.textures;
    expect(tex.exists('field-1-ground')).toBe(true);
    expect(r.scene.describe().textures).toBeGreaterThanOrEqual(3);
  });

  it('puts the camera where the field says (whole pixels, negative for a map smaller than the view)', () => {
    const r = stage();
    r.h.frame(17);
    const d = r.scene.describe();
    expect(d.scroll).toEqual({ x: r.src.v.cx, y: r.src.v.cy });
    expect(d.scroll.x).toBeLessThan(0);
    r.src.v.cx = 7;
    r.src.v.cy = 9;
    frame(r);
    expect(r.scene.describe().scroll).toEqual({ x: 7, y: 9 });
  });

  it('builds a prop only when it first comes into view, and hides it when it leaves', () => {
    const far = prop(2000, 2000, 16, 16, 2015);
    const r = stage({ w: 200, h: 200, sprites: [prop(0, 0, 16, 16, 15), far] });
    r.src.v.cx = 0;
    r.src.v.cy = 0;
    r.src.v.camX = 0;
    r.src.v.camY = 0;
    r.h.frame(17);
    expect(r.scene.describe().props).toEqual({ total: 2, built: 1, shown: 1 });
    r.src.v.cx = 1900;
    r.src.v.cy = 1900;
    frame(r);
    expect(r.scene.describe().props).toEqual({ total: 2, built: 2, shown: 1 });
  });
});

describe('FieldStageScene: the sort', () => {
  it('draws by the foot line, and a tie goes to the prop that is first in the map, then the chests, then the actors', () => {
    const r = stage();
    const chest: StageChest = { tx: 1, ty: 1, kind: 'crate', open: false };
    const a1 = {};
    const a2 = {};
    // prop 0 and prop 1 tie at 15, prop 2 is at 23. A chest on tile (1,1) has its foot line at (1+1)*TS-1 = 31. An actor with feet at y 15 ties with the props, one at 31 ties with the chest.
    r.src.v.chests = [chest];
    r.src.v.actors = [actor(a1, 2, 0, 15), actor(a2, 20, 8, 31)];
    r.h.frame(17);
    expect(drawn(r)).toEqual(['prop', 'prop', 'actor', 'prop', 'chest', 'actor']);
    // keys: prop0 15, prop1 15, actor1 15 (added last of the three), prop2 23, chest 31, actor2 31 (after the chest)
  });

  it('keeps that order when the chests change (the actors are added after the chests again)', () => {
    const r = stage();
    const a1 = {};
    r.src.v.actors = [actor(a1, 2, 0, 31)];
    r.h.frame(17);
    expect(drawn(r)).toEqual(['prop', 'prop', 'prop', 'actor']);
    r.src.v.chests = [{ tx: 1, ty: 1, kind: 'crate', open: false }];
    frame(r);
    // The chest was made after the actor view existed, and ties with it at 31: it must still draw first.
    expect(drawn(r)).toEqual(['prop', 'prop', 'prop', 'chest', 'actor']);
  });

  it('control: without the sort, the order would be the order added', () => {
    const r = stage();
    r.src.v.actors = [actor({}, 2, 0, 5)];
    r.h.frame(17);
    // The actor has the smallest foot line (5) but was added last: the sort puts it first.
    expect(drawn(r)[0]).toBe('actor');
    const sort = sortOf(r);
    expect(sort.list.map((o) => o.name).at(-1)).toBe('actor');
  });

  it('follows a walking actor: its place in the order changes with its feet', () => {
    const r = stage();
    const a = {};
    r.src.v.actors = [actor(a, 2, 0, 5)];
    r.h.frame(17);
    expect(drawn(r)[0]).toBe('actor');
    r.src.v.actors = [actor(a, 2, 0, 40)];
    frame(r);
    expect(drawn(r).at(-1)).toBe('actor');
  });

  it('opens and closes a chest in place: its halo and glow go with it', () => {
    const r = stage();
    const chest: StageChest = { tx: 1, ty: 1, kind: 'locker', open: false };
    r.src.v.chests = [chest];
    r.h.frame(17);
    const item = sortOf(r).list.find((o) => o.name === 'chest');
    if (!(item instanceof Container)) throw new Error('no chest');
    const kids = item.list;
    expect(kids.map((k) => k.visible)).toEqual([true, true, true, true]);
    chest.open = true;
    frame(r);
    expect(kids.map((k) => k.visible)).toEqual([false, true, false, true]);
  });
});

describe('FieldStageScene: the lit pass is skipped when it cannot show', () => {
  it('lights a still prop once, however many frames pass, while steady lights are the only ones', () => {
    const r = stage();
    for (let i = 0; i < 12; i++) frame(r);
    expect(r.scene.describe().litPaints).toBe(4); // the 3 props and the one overhead part, once each
  });

  it('a flickering light that reaches a prop lights it again, and one that does not leaves it alone', () => {
    const near = prop(0, 0, 16, 16, 15);
    const farAway = prop(50, 50, 8, 8, 57);
    const r = stage({ lights: [{ x: 8, y: 8, r: 12, color: '#ff0000', i: 1, flicker: true, seed: 2 }], sprites: [near, farAway], hasOver: false });
    r.h.frame(17);
    const first = r.scene.describe().litPaints;
    expect(first).toBe(2);
    for (let i = 0; i < 20; i++) frame(r);
    const after = r.scene.describe().litPaints;
    // Only `near` is under the light: it lights again on frames where the flicker changed. The far prop is lit once.
    expect(after).toBeGreaterThan(first + 5);
    expect(after - first).toBeLessThanOrEqual(20);
  });

  it('paints the light map again only when the camera moved or a flickering light on screen changed', () => {
    const r = stage();
    r.h.frame(17);
    const paints = r.scene.describe().lightPaints;
    for (let i = 0; i < 10; i++) frame(r);
    expect(r.scene.describe().lightPaints).toBe(paints);
    r.src.v.cx += 1;
    frame(r);
    expect(r.scene.describe().lightPaints).toBe(paints + 1);
  });

  it('a new ambient color lights everything again', () => {
    const r = stage();
    r.h.frame(17);
    const lit = r.scene.describe().litPaints;
    (r.map.def as { ambient: string }).ambient = '#ffffff';
    frame(r);
    expect(r.scene.describe().litPaints).toBe(lit + 4);
  });
});

describe('FieldStageScene: loadMap, the editor contract', () => {
  it('refuses a map that breaks the rules, keeps the map it had, and says which rule', () => {
    const r = stage();
    r.h.frame(17);
    const world = r.scene.sys.world.list.length;
    const before = r.scene.describe();
    const bad = { ...fakeMap({ id: 'bad' }), ground: asCanvas(recCanvas(10, 10)) };
    expect(() => r.scene.loadMap(bad)).toThrow(/The map "bad" is not valid, so the stage keeps "testmap"[\s\S]*ground layer is 10x10/);
    expect(r.scene.mapId).toBe('testmap');
    expect(r.scene.sys.world.list.length).toBe(world);
    expect(r.scene.describe().textures).toBe(before.textures);
    expect(r.h.game.textures.exists('field-1-ground')).toBe(true);
  });

  it('control: a map that is fine loads, and replaces the first (its pictures and its textures)', () => {
    const r = stage();
    r.h.frame(17);
    const second = fakeMap({ id: 'second', w: 5, h: 3 });
    r.scene.loadMap(second);
    expect(r.scene.mapId).toBe('second');
    expect(r.h.game.textures.exists('field-1-ground')).toBe(false);
    expect(r.h.game.textures.exists('field-2-ground')).toBe(true);
  });

  it('the source decides at the next frame: a different map from the source is loaded without a call', () => {
    const r = stage();
    r.h.frame(17);
    const second = fakeMap({ id: 'second' });
    r.src.v.map = second;
    frame(r);
    expect(r.scene.mapId).toBe('second');
  });

  it('a map the source gives that breaks the rules fails the stage (the field takes its drawing back)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = stage();
    r.h.frame(17);
    r.src.v.map = { ...fakeMap({ id: 'bad' }), emit: asCanvas(recCanvas(3, 3)) };
    frame(r);
    expect(r.src.failures.length).toBe(1);
    expect(r.scene.closed).toBe(true);
  });

  it('frees every texture of the map when the scene closes (the 10-cycle leak check, in small)', () => {
    const r = stage();
    const tex = r.h.game.textures;
    const before = tex.getTextureKeys().length;
    r.h.frame(17);
    expect(tex.getTextureKeys().length).toBeGreaterThan(before);
    for (let i = 0; i < 10; i++) r.scene.loadMap(fakeMap({ id: `m${i}` }));
    const during = tex.getTextureKeys().length;
    r.scene.close();
    // The shared chest pictures stay (a few, bounded by the three chest kinds); the map's do not.
    expect(tex.getTextureKeys().filter((k) => k.startsWith('field-') && !k.startsWith('field-halo') && !k.startsWith('field-chestglow'))).toEqual([]);
    expect(during - tex.getTextureKeys().length).toBeGreaterThan(0);
  });
});

describe('FieldStageScene: snapshot and restore', () => {
  it('is plain JSON and round-trips', () => {
    const r = stage();
    r.src.v.actors = [actor({}, 2, 0, 15)];
    r.src.v.chests = [{ tx: 1, ty: 1, kind: 'case', open: true }];
    r.h.frame(17);
    const s = r.scene.snapshot();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.version).toBe(1);
    expect(s.mapId).toBe('testmap');
    expect(s.actors.length).toBe(1);
    expect(s.chests).toEqual([{ tx: 1, ty: 1, kind: 'case', open: true }]);
  });

  it('shows the state of the snapshot while the source moves on, and the live view comes back with release', () => {
    const r = stage();
    const a = {};
    r.src.v.actors = [actor(a, 2, 0, 15)];
    r.h.frame(17);
    const s = r.scene.snapshot();
    const scrollThen = r.scene.describe().scroll;
    r.src.v.cx += 40;
    r.src.v.actors = [actor(a, 30, 30, 45)];
    frame(r);
    expect(r.scene.describe().scroll.x).toBe(scrollThen.x + 40);
    r.scene.restore(s);
    frame(r);
    expect(r.scene.describe().scroll).toEqual(scrollThen);
    expect(r.scene.describe().pinned).toBe(true);
    expect(r.scene.isHeld).toBe(true);
    // The screen-fixed layer is the field's own state: it is left out while a snapshot shows.
    expect(r.scene.describe().screenShown).toBe(false);
    r.scene.release();
    frame(r);
    expect(r.scene.describe().scroll.x).toBe(scrollThen.x + 40);
    expect(r.scene.isHeld).toBe(false);
  });

  it('refuses a snapshot of another map, of another version, or of a picture it has not seen, and changes nothing', () => {
    const r = stage();
    r.src.v.actors = [actor({}, 2, 0, 15)];
    r.h.frame(17);
    const s = r.scene.snapshot();
    expect(() => r.scene.restore({ ...s, version: 2 as unknown as 1 })).toThrow(/version/);
    expect(() => r.scene.restore({ ...s, mapId: 'elsewhere' })).toThrow(/elsewhere/);
    expect(() => r.scene.restore({ ...s, actors: [{ ref: 99, image: 98, x: 0, y: 0, px: 0, py: 0 }] })).toThrow(/has not seen/);
    expect(r.scene.isHeld).toBe(false);
  });

  it('a snapshot needs a frame to take', () => {
    const r = stage();
    expect(() => r.scene.snapshot()).toThrow(/has not drawn yet/);
  });
});

describe('FieldStageScene: the screen-fixed layer', () => {
  it('is shown only when the field drew something on it, and asked for each frame', () => {
    const r = stage();
    r.h.frame(17);
    expect(r.scene.describe().screenShown).toBe(false);
    expect(r.src.screenCalls).toBe(1);
    r.src.screen = true;
    frame(r);
    expect(r.scene.describe().screenShown).toBe(true);
    expect(r.src.screenCalls).toBe(2);
  });
});

describe('FieldStageScene: a draw that throws', () => {
  it('tells the source once, closes itself, and never throws out of the draw phase', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = stage();
    r.h.frame(17);
    r.src.throwOnView = new Error('the field broke');
    expect(() => frame(r)).not.toThrow();
    expect(r.src.failures.length).toBe(1);
    expect((r.src.failures[0] as Error).message).toBe('the field broke');
    expect(r.scene.closed).toBe(true);
    expect(r.h.game.scene.scenes.length).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // The scene is gone: later frames do nothing more.
    expect(() => frame(r)).not.toThrow();
    expect(r.src.failures.length).toBe(1);
  });
});

describe('FieldStageScene: shadows', () => {
  it('draws the three contact-shadow rectangles of the old render under each actor', () => {
    const r = stage();
    r.src.v.actors = [actor({}, 2, 0, 15)];
    r.h.frame(17);
    const g = r.scene.sys.world.list.find((o) => o.depth === 25);
    expect(g, 'the shadow layer').toBeDefined();
  });
});

// ---- 5. the seam --------------------------------------------------------------------------------------------------

describe('the seam: fieldStages and lazyFieldStageProvider', () => {
  afterEach(() => setFieldStageProvider(null));

  const game = (): never => ({}) as never;
  const field = (): never => ({}) as never;

  it('without a provider no stage is made (the field draws itself, as without the flag)', async () => {
    setFieldStageProvider(null);
    expect(fieldStages.available).toBe(false);
    expect(await fieldStages.open(game(), field())).toBeNull();
  });

  it('with a provider it asks the provider', async () => {
    const stage: FieldStage = { closed: false, close: () => undefined };
    setFieldStageProvider({ open: async () => stage });
    expect(fieldStages.available).toBe(true);
    expect(await fieldStages.open(game(), field())).toBe(stage);
  });

  it('a load that fails is a notice and null, never a throw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setFieldStageProvider(lazyFieldStageProvider(() => Promise.reject(new Error('a stale deploy'))));
    expect(await fieldStages.open(game(), field())).toBeNull();
    expect(currentNotice()?.text).toBe(FIELD_STAGE_FAILED_NOTICE);
  });

  it('a provider whose open throws is a notice and null too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad: FieldStageProvider = {
      open: async () => {
        throw new Error('create failed');
      },
    };
    setFieldStageProvider(lazyFieldStageProvider(async () => bad));
    expect(await fieldStages.open(game(), field())).toBeNull();
  });

  it('loads the real provider once, on first use, and warm() starts the load without a notice when it fails', async () => {
    let loads = 0;
    const stage: FieldStage = { closed: false, close: () => undefined };
    const real: FieldStageProvider = { open: async () => stage };
    setFieldStageProvider(
      lazyFieldStageProvider(async () => {
        loads++;
        return real;
      }),
    );
    fieldStages.warm();
    expect(loads).toBe(1);
    expect(await fieldStages.open(game(), field())).toBe(stage);
    // warm() of a failing load says nothing: the real attempt shows the notice.
    setFieldStageProvider(lazyFieldStageProvider(() => Promise.reject(new Error('offline'))));
    const before = currentNotice()?.text;
    fieldStages.warm();
    await Promise.resolve();
    expect(currentNotice()?.text).toBe(before);
  });
});

// A fakeCanvas export is used by other tests; keep the import honest so a rename is caught here too.
void fakeCanvas;
