/**
 * The field scene as a native `sje` scene (M8c, group F; docs/engine/m8-brief.md task 9 and rubric items 3, 5, 6, 7).
 *
 * `FieldScene` runs on a real `Game` here, with no renderer and a scripted input, as the battle does in tests/battle-native.test.ts. Every proof that something DOES
 * happen has a control: a case where it must not, so the check is known to be able to fail.
 *
 *   1. It extends the sje `Scene`, and no file of the field, its kit, its seam or its stage imports the old engine's game, display, postfx or moments (a scan with a control).
 *   2. The transitions of the field go to the game with the timing they always had: the warp fade (14 ticks out, 14 in), the shake and the flash a story script asks for, the
 *      camera that moves with the shake, and the glow the field feeds to `game.fx`.
 *   3. The stage under the field: the field leaves its canvas out when the stage draws and no overlay is on, hands the picture back when the stage fails, and closes the stage
 *      when the field ends.
 *   4. The seam keeps its contract (editor contract d): `snapshot()` and `restore()` of the stage over the REAL field give the same frame, and `loadMap` still takes a map.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/engine/input';
import { Container, type GameObject, Scene } from '../src/sje';
import { Game } from '../src/sje/runtime/game';
import { installCanvasStub } from './recorder';

vi.mock('../src/audio/sfx', () => ({ sfx: () => undefined }));
vi.mock('../src/audio/music', () => ({ music: () => undefined, placeMusic: () => undefined, previewMusic: () => undefined, pushMusic: () => undefined, popMusic: () => undefined }));
vi.mock('../src/audio/engine', () => ({ audio: { duck: () => undefined, applyVolumes: () => undefined, onUnlock: () => undefined, unlock: () => undefined } }));

/** A scripted input: nothing is pressed, nothing is held. */
class Keys {
  pressed = () => false;
  repeat = () => false;
  down = () => false;
  carry = () => undefined;
  dir = () => null;
  update = () => undefined;
  endFrame = () => undefined;
  consume = () => undefined;
  keyName = (a: string) => ({ confirm: 'Z', cancel: 'X' })[a] ?? a;
  keysFor = () => ['KeyZ'];
  captureNext = () => undefined;
}

let restoreCanvas: () => void;
beforeAll(() => {
  restoreCanvas = installCanvasStub();
});
afterAll(() => restoreCanvas());

let game: Game;
beforeEach(async () => {
  // The shake motion of the game is the old engine's function; here it is the simplest one that can be told from none: one pixel to the right for each point of strength.
  game = new Game({ renderer: { render: () => undefined }, input: new Keys() as unknown as Input, compat: { shakeOffset: (s) => ({ x: Math.round(s.mag), y: 0 }) } });
  const { applyStage } = await import('../src/game/stages');
  applyStage('finale');
});
afterEach(async () => {
  const { setFieldStageProvider } = await import('../src/scenes/fieldkit/fieldseam');
  setFieldStageProvider(null);
  const { fieldHooks } = await import('../src/game/hooks');
  delete fieldHooks.renderOverlay;
});

const tick = (n: number): void => {
  for (let i = 0; i < n; i++) game.advanceTick();
};

/** A field on the first town map, run on the game, with its first tick not yet played. */
async function field(map = 'lantern_row', x = 10, y = 10) {
  const { FieldScene } = await import('../src/scenes/field');
  const scene = new FieldScene(map, x, y, 'down');
  void game.run(scene);
  return scene;
}

/** The text of a source file without comments, so a mention in a comment is not an import. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
/** An import (or a dynamic import) of one of the old engine's four files. */
const OLD_ENGINE = /(?:from\s*|import\s*\(\s*)['"][^'"]*engine\/(?:game|display|postfx|moments)['"]/;
const root = join(import.meta.dirname, '..');
const sourcesIn = (dir: string): string[] => readdirSync(join(root, dir)).filter((f) => f.endsWith('.ts')).map((f) => `${dir}/${f}`);

describe('the field scene is a native sje scene', () => {
  it('extends the sje Scene, and a run gives it a canvas image in its display list', async () => {
    const scene = await field();
    expect(scene).toBeInstanceOf(Scene);
    game.advanceTick();
    expect(scene.sys.world.list.some((o) => o.constructor.name === 'CanvasImage')).toBe(true);
    // The old lifecycle names are gone: `enter`, `exit` and `update` are not on the scene.
    expect(['enter', 'exit', 'update'].filter((n) => typeof (scene as unknown as Record<string, unknown>)[n] === 'function')).toEqual([]);
  });

  it('no file of the field, its kit, its seam or its stage imports the old engine: not its game, display, postfx or moments', () => {
    const files = ['src/scenes/field.ts', ...sourcesIn('src/scenes/fieldkit'), ...sourcesIn('src/fieldstage')];
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) expect(code(readFileSync(join(root, f), 'utf8')), f).not.toMatch(OLD_ENGINE);
  });

  it('control: the scan finds an import of each of the four files, and ignores a comment', () => {
    for (const name of ['game', 'display', 'postfx', 'moments']) {
      expect(`import { x } from '../engine/${name}';`).toMatch(OLD_ENGINE);
      expect(`const m = () => import('../../engine/${name}');`).toMatch(OLD_ENGINE);
    }
    expect(code("// import { postfx } from '../engine/postfx';")).not.toMatch(OLD_ENGINE);
    expect(`import { shake } from '../engine/shake';`).not.toMatch(OLD_ENGINE);
  });
});

/** Let the flows of the scene run on: a fade or a stage that finished in a tick resumes its flow in a microtask. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
/** The real stage opens by the next macrotask (src/fieldstage/fieldopen.ts): wait for it. */
const stageUp = (): Promise<void> => new Promise((res) => setTimeout(res, 5));
/** One tick, then the flows it released. */
const step = async (): Promise<void> => {
  game.advanceTick();
  await settle();
};

describe('the transitions and effects of the field go to the game on the same ticks as before', () => {
  it('the warp fade: out over 14 ticks, the new map loads at black, in over 14 ticks', async () => {
    const { state } = await import('../src/game/state');
    const scene = await field('lantern_row', 10, 10);
    game.advanceTick();
    const from = state.map;
    const levels: number[] = [];
    const maps: string[] = [];
    void scene.warp('bar', 3, 3, 'down');
    await settle();
    expect(scene.busy, 'a warp holds the field busy').toBeGreaterThan(0);
    for (let i = 0; i < 28; i++) {
      await step();
      levels.push(Math.round(game.fadeLevel * 1000) / 1000);
      maps.push(state.map);
    }
    // Out: tick n of 14 is n/14 of the way to black. The map is the old one until the fade is full, and the new one from the tick it is.
    expect(levels[6]).toBeCloseTo(7 / 14, 3);
    expect(levels[13]).toBe(1);
    expect(maps[12]).toBe(from);
    expect(maps[13]).toBe('bar');
    // In: 14 ticks back to clear.
    expect(levels[20]).toBeCloseTo(1 - 7 / 14, 3);
    expect(levels[27]).toBe(0);
    expect(scene.busy).toBe(0);
  });

  it('control: a warp without a fade never darkens the screen', async () => {
    const scene = await field('lantern_row', 10, 10);
    game.advanceTick();
    void scene.warp('bar', 3, 3, 'down', false);
    let top = 0;
    for (let i = 0; i < 30; i++) {
      await step();
      top = Math.max(top, game.fadeLevel);
    }
    expect(top).toBe(0);
  });

  it('a script asks for a shake and a flash: the game gets them with the strength the script wrote, and the camera moves with the shake', async () => {
    const { scriptApi } = await import('../src/scenes/fieldkit/api');
    const scene = await field();
    game.advanceTick();
    game.draw(0);
    // Control: with nothing asked for, the stage camera is the plain camera.
    const quiet = scene.view();
    expect([quiet.cx, quiet.cy]).toEqual([quiet.camX, quiet.camY]);
    const flashes: Array<[string, number]> = [];
    const flash = game.flash.bind(game);
    game.flash = (color, frames) => {
      flashes.push([color ?? '', frames ?? 0]);
      flash(color, frames);
    };
    const api = scriptApi(scene);
    api.shake(10, 3);
    expect(flashes, 'control: a shake is not a flash').toEqual([]);
    api.flash('#ffe07a', 5);
    expect(flashes).toEqual([['#ffe07a', 5]]);
    game.draw(0);
    expect(game.shakeX).toBe(3);
    const shaken = scene.view();
    expect(shaken.cx).toBe(shaken.camX - 3);
    expect(shaken.cy).toBe(shaken.camY);
    // The shake lasts its 10 ticks.
    tick(5);
    game.draw(0);
    expect(game.shakeX, 'still shaking after 5 ticks').toBe(3);
    tick(5);
    game.draw(0);
    expect(game.shakeX).toBe(0);
    const after = scene.view();
    expect(after.cx).toBe(after.camX);
  });

  it('the glow: the field feeds the emissive layer to game.fx, and towns glow harder than rooms', async () => {
    for (const [map, bloom] of [
      ['lantern_row', 0.9],
      ['bar', 0.5],
    ] as const) {
      const drawn: unknown[][] = [];
      const layer = { drawImage: (...a: unknown[]) => void drawn.push(a) } as unknown as CanvasRenderingContext2D;
      game.fx.glowLayer = () => layer;
      game.fx.bloom = 0;
      const scene = await field(map, 5, 5);
      game.advanceTick();
      game.draw(0);
      expect(game.fx.bloom, map).toBe(bloom);
      expect(drawn.length, `${map} feeds the glow layer`).toBeGreaterThan(0);
      scene.close();
      game.advanceTick();
    }
    // Control: with the effects off there is no glow layer, and the field leaves the bloom alone.
    game.fx.glowLayer = () => null;
    game.fx.bloom = 0.123;
    await field();
    game.advanceTick();
    game.draw(0);
    expect(game.fx.bloom).toBe(0.123);
  });
});

describe('the stage under the field', () => {
  /** A stage that records its closing. */
  function fakeStage() {
    const stage = {
      closed: false,
      closes: 0,
      close() {
        stage.closes++;
        stage.closed = true;
      },
    };
    return stage;
  }
  const imageOf = (scene: Scene<void>): { visible: boolean } => {
    const img = scene.sys.world.list.find((o) => o.constructor.name === 'CanvasImage');
    if (!img) throw new Error('the scene has no canvas image');
    return img;
  };

  it('with a stage under it, the field is not opaque and leaves its canvas out; a dev overlay or a failed stage brings the canvas back', async () => {
    const { setFieldStageProvider } = await import('../src/scenes/fieldkit/fieldseam');
    const { fieldHooks } = await import('../src/game/hooks');
    const stage = fakeStage();
    setFieldStageProvider({ open: async () => stage });
    const scene = await field();
    // Control: before the stage is up, the field draws the whole picture and is opaque.
    expect(scene.opaque).toBe(true);
    game.advanceTick();
    game.draw(0);
    expect(imageOf(scene).visible).toBe(true);
    await settle();
    expect(scene.opaque).toBe(false);
    game.draw(0);
    expect(imageOf(scene).visible).toBe(false);
    // A dev overlay is drawn on the field's own canvas, so the canvas stays.
    fieldHooks.renderOverlay = () => undefined;
    game.draw(0);
    expect(imageOf(scene).visible).toBe(true);
    delete fieldHooks.renderOverlay;
    game.draw(0);
    expect(imageOf(scene).visible).toBe(false);
    // The stage failed: the field takes its drawing back.
    scene.stageFailed(new Error('a draw threw'));
    expect(scene.opaque).toBe(true);
    game.draw(0);
    expect(imageOf(scene).visible).toBe(true);
  });

  it('the field closes its stage when it ends, once, and not before', async () => {
    const { setFieldStageProvider } = await import('../src/scenes/fieldkit/fieldseam');
    const stage = fakeStage();
    setFieldStageProvider({ open: async () => stage });
    const scene = await field();
    game.advanceTick();
    await settle();
    expect(stage.closes, 'running').toBe(0);
    scene.close();
    game.advanceTick();
    await settle();
    expect(stage.closes).toBe(1);
    // A reset that drops the whole stack ends the field too.
    const again = fakeStage();
    setFieldStageProvider({ open: async () => again });
    await field();
    game.advanceTick();
    await settle();
    expect(again.closes).toBe(0);
    game.abandon();
    await settle();
    expect(again.closes).toBe(1);
  });

  it('a stage that opens after the field ended is closed at once', async () => {
    const { setFieldStageProvider } = await import('../src/scenes/fieldkit/fieldseam');
    const late = fakeStage();
    let release: (s: typeof late) => void = () => undefined;
    setFieldStageProvider({ open: () => new Promise((res) => (release = res)) });
    const scene = await field();
    game.advanceTick();
    scene.close();
    game.advanceTick();
    release(late);
    await settle();
    expect(late.closes).toBe(1);
  });
});

/** The depth of the stage's screen-fixed layer (src/fieldstage/params.ts `LAYER`). */
const SCREEN_DEPTH = 100;

describe('the seam keeps its contract over the real field (editor contract d)', () => {
  it('the stage reads the ported field: snapshot() then restore() gives the same frame, and a changed field gives another', async () => {
    const { fieldProvider } = await import('../src/fieldstage/fieldopen');
    const { setFieldStageProvider } = await import('../src/scenes/fieldkit/fieldseam');
    setFieldStageProvider(fieldProvider);
    const scene = await field();
    await stageUp();
    game.advanceTick();
    game.draw(0);
    const stage = game.scene.scenes.find((s) => s.constructor.name === 'FieldStageScene');
    if (!stage) throw new Error('the stage is not under the field');
    expect(scene.opaque, 'the stage draws, so the field lets it show').toBe(false);
    // The frame as data: what is SHOWN (the children of a hidden object are a pool, not part of the picture). The screen-fixed layer (depth 100: weather, banner, dust) is the field's
    // own live state, so a snapshot hides it by contract (src/fieldstage/stagescene.ts); it is read apart, below.
    const sig = (o: GameObject): unknown => ({ n: o.name, x: o.x, y: o.y, v: o.visible, d: o.depth, a: o.alpha, c: o instanceof Container && o.visible ? o.list.map(sig) : undefined });
    const frameSig = (): string => JSON.stringify(stage.sys.world.list.filter((o) => o.depth !== SCREEN_DEPTH).map(sig));
    const screenShown = (): boolean => stage.sys.world.list.filter((o) => o.depth === SCREEN_DEPTH).every((o) => o.visible);
    const held = stage as unknown as { snapshot(): unknown; restore(x: unknown): void; release(): void };
    const live = frameSig();
    const snap = held.snapshot();
    // The field moves on: the camera and the leader.
    scene.camX += 24;
    scene.leader.px += 8;
    game.draw(0);
    const moved = frameSig();
    expect(moved, 'control: the signature sees that the field moved').not.toBe(live);
    held.restore(snap);
    game.draw(0);
    expect(frameSig()).toBe(live);
    expect(screenShown(), 'a held snapshot shows the world only').toBe(false);
    // The snapshot is plain JSON.
    held.restore(JSON.parse(JSON.stringify(snap)));
    game.draw(0);
    expect(frameSig()).toBe(live);
    held.release();
    game.draw(0);
    expect(frameSig()).toBe(moved);
    expect(screenShown(), 'the live view brings the screen-fixed layer back').toBe(true);
  });

  it('loadMap of the stage still follows the field: a field that loads a new map hands the stage the new map', async () => {
    const { fieldProvider } = await import('../src/fieldstage/fieldopen');
    const { setFieldStageProvider } = await import('../src/scenes/fieldkit/fieldseam');
    setFieldStageProvider(fieldProvider);
    const scene = await field('lantern_row', 10, 10);
    await stageUp();
    game.advanceTick();
    game.draw(0);
    const stage = game.scene.scenes.find((s) => s.constructor.name === 'FieldStageScene') as unknown as { mapId: string | null } | undefined;
    if (!stage) throw new Error('the stage is not under the field');
    expect(stage.mapId).toBe('lantern_row');
    scene.loadAt('bar', 3, 3, 'down');
    game.advanceTick();
    game.draw(0);
    expect(stage.mapId).toBe('bar');
  });
});
