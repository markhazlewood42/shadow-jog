/**
 * The editor contract of the battle stage (principle 11; docs/engine/m3-brief.md section 5, pass line 12), proved on the real `BattleStageScene` in Node. As in
 * tests/battlestage-scene.test.ts the texture helpers that need a browser canvas are replaced by ones that register fake canvases; the scene, its figures, the
 * display list, the texture manager and the scene stack are the real ones, and so is the config check.
 *
 *  (a) every stage value is data with a check: `checkStageConfig` accepts the stages of the file and refuses what the file would refuse;
 *  (b) `loadStage(config)` swaps a stage into the running scene, and bad data leaves the old stage as it was (control: good data swaps);
 *  (c) `snapshot()` is plain JSON and `restore(snapshot())` gives the same frame, on the same scene and on another one;
 *  (d) no Pixi object leaves the scene: the snapshot holds numbers and text only.
 * (e) `step(n)` equals n ticks: on the headless battle driver (task 7) and on the scene itself. (The same frame in pixels is e2e/sje-stage-parity.spec.ts, "snapshot and restore".)
 * Also here: the push camera's numbers (src/battlestage/push.ts), and that no look constant of it hides in the scene's code.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { TextureManager } from '../src/sje';
import { BG_IDS } from '../src/art/battlebg480';
import { BattleDrive, setupFor } from '../src/battlestage/battledrive';
import { checkStageConfig, enemySlots, slotPoint, type StageConfig, stageOf } from '../src/battlestage/config';
import type { FacingFile } from '../src/battlestage/facing';
import { STAGE_KNOWN } from '../src/battlestage/known';
import { LEGACY_PUSH, pushStrength, pushView, pushZoom } from '../src/battlestage/push';
import { BattleStageScene, type BattleStageInit, type StageSnapshot } from '../src/battlestage/stagescene';
import { fakeCanvas, headlessGame } from './sjekit';
import { fixtureStages } from './stagefiles';

vi.mock('../src/battlestage/textures', () => {
  const add = (textures: TextureManager, key: string, w: number, h: number): string => {
    if (!textures.exists(key)) textures.addCanvas(key, fakeCanvas(w, h));
    return key;
  };
  const sheetArt = (w: number, h: number) => ({ raw: { w, h, data: new Uint8ClampedArray(w * h * 4) }, box: { x0: 10, y0: 8, x1: w - 11, y1: h - 2, feet: Math.floor(w / 2) }, foot: { x: Math.floor(w / 2), y: h - 1 }, face: { x: 3, y: 4 }, grain: 1 });
  return {
    PREFIX: { shadow: 'shadow-', ring: 'ring-' },
    pruneTextures: (textures: TextureManager, prefix: string, inUse: ReadonlySet<string>) => textures.prune(prefix, inUse),
    shadowTexture: (textures: TextureManager, width: number) => add(textures, `shadow-${width}`, width + 8 + (width % 2), 10),
    ringTexture: (textures: TextureManager, width: number, color: string) => add(textures, `ring-${width}-${color.slice(1)}`, width + 6, 12),
    hazedTexture: (_textures: TextureManager, base: string) => base,
    // The picture is named after its stage, so a swap of stages is a different picture (as the real fingerprint makes it).
    bakeStage: (textures: TextureManager, stage: { id: string }) => ({ key: add(textures, `stage-${stage.id}`, 480, 270) }),
    registerCrew: (textures: TextureManager, metas: Record<string, { frame_w: number; frame_h: number; frame_count: number }>, ids: readonly string[]) => {
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const m = metas[id];
        if (!m) throw new Error(`No metadata for ${id}`);
        const key = `crewb-${id}`;
        if (!textures.exists(key)) {
          textures.addCanvas(key, fakeCanvas(m.frame_w * m.frame_count, m.frame_h));
          const frames: Record<number, [number, number, number, number]> = {};
          for (let i = 0; i < m.frame_count; i++) frames[i] = [i * m.frame_w, 0, m.frame_w, m.frame_h];
          textures.addFrames(key, frames);
        }
        out[id] = { texture: key, frameW: m.frame_w, frameH: m.frame_h, foot: { x: 32, y: m.frame_h - 1 }, fig: sheetArt(m.frame_w, m.frame_h), plan: {}, drawn: { frames: [], foot: { x: 32, y: 63 } }, footDelta: { x: 0, y: 0 } };
      }
      return out;
    },
    addEnemy: (textures: TextureManager, sprite: string, copy: number) => {
      const key = add(textures, `enemy-${sprite}-${copy}`, 85, 97);
      return { key, width: 85, height: 97, idleShadow: 0, idle: 'breathe', fig: sheetArt(85, 97) };
    },
  };
});

const META = {
  kit: { frame_w: 64, frame_h: 64, frame_count: 8, fps: 8 },
  rook: { frame_w: 79, frame_h: 68, frame_count: 8, fps: 8 },
  hex: { frame_w: 64, frame_h: 64, frame_count: 8, fps: 8 },
  sable: { frame_w: 64, frame_h: 64, frame_count: 8, fps: 8 },
};
const FACING: FacingFile = { punk: { mirror: true, facing: 'right', note: 'the punk faces right as drawn' } };

const street = (): StageConfig => stageOf(fixtureStages(), 'street');
const sewer = (): StageConfig => stageOf(fixtureStages(), 'sewer');
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function init(over: Partial<BattleStageInit> = {}): BattleStageInit {
  return { stages: fixtureStages(), stageId: 'street', metas: META, standIns: true, lineup: ['kit', 'rook'], setKey: '2', enemies: ['rustfang_punk', 'scrap_hound'], facing: FACING, active: 0, target: 1, ...over };
}

function run(over: Partial<BattleStageInit> = {}): { scene: BattleStageScene; game: ReturnType<typeof headlessGame>['game'] } {
  const { game } = headlessGame();
  const scene = new BattleStageScene(init(over));
  void game.run(scene);
  return { scene, game };
}

/** What a frame is, as text: the draw order of the display list, every figure as the display list sees it, and the world layer's scale and place. */
function frameOf(scene: BattleStageScene): string {
  return JSON.stringify({
    order: scene.sys.world.drawOrder().map((o) => o.name),
    figures: scene.figures.map((f) => ({ id: f.id, ...f.describe(), alpha: f.alpha })),
    world: { scale: scene.sys.world.scaleX, x: scene.sys.world.x, y: scene.sys.world.y },
  });
}

describe('(a) checkStageConfig: the rules of the stage file, for one stage', () => {
  it('accepts the stages of the file (control: the check is alive, so a refusal below means something)', () => {
    expect(checkStageConfig(street(), BG_IDS, STAGE_KNOWN)).toEqual([]);
    expect(checkStageConfig(sewer(), BG_IDS, STAGE_KNOWN)).toEqual([]);
  });

  it('refuses what the file refuses: an unknown backdrop, a slot on the wrong side, a row off the floor, rows out of order, a box past the screen', () => {
    const cases: Array<[string, (s: StageConfig) => void, RegExp]> = [
      ['an unknown backdrop', (s) => {
          s.backdrop.id = 'no_such_backdrop';
        }, /backdrop/],
      ['a party slot on the enemies’ side', (s) => {
          const slot = s.party[0];
          if (slot) slot.x = 470;
        }, /wrong side/],
      ['a row below the floor', (s) => {
          const row = s.rows[0];
          if (row) row.y = s.floor.y1 + 40;
        }, /outside the floor/],
      ['rows out of order', (s) => {
          s.rows.reverse();
        }, /grow/],
      ['a HUD box past the right edge', (s) => {
          s.hud.turnOrder.x = 475;
        }, /edge|screen/],
    ];
    for (const [what, edit, message] of cases) {
      const bad = copy(street());
      edit(bad);
      const problems = checkStageConfig(bad, BG_IDS, STAGE_KNOWN);
      expect(problems.length, `${what} is refused`).toBeGreaterThan(0);
      expect(problems.join('\n'), what).toMatch(message);
    }
  });
});

describe('(b) loadStage: a stage swapped into the running scene', () => {
  it('rebuilds the picture and every figure for the new stage, in the same lineup and group (control for the refusal below)', () => {
    const { scene } = run();
    const before = scene.figures.map((f) => f.id);
    const oldFigures = [...scene.figures];
    const next = sewer();
    scene.loadStage(next);
    expect(scene.config).toBe(next);
    expect(scene.figures.map((f) => f.id), 'the same people').toEqual(before);
    // They stand where the NEW stage puts them, and the old figures are gone from the display list.
    const heroFeet = slotPoint(next, next.party[0] ?? next.party[0]!);
    expect([scene.figures[0]?.x, scene.figures[0]?.y]).toEqual([heroFeet.x, heroFeet.y]);
    const foeSlots = enemySlots(next, '2');
    expect(scene.figures[2]?.slot).toEqual(foeSlots[0]);
    for (const f of oldFigures) expect(f.container.destroyed, `the old ${f.id} was destroyed`).toBe(true);
    expect(scene.sys.world.drawOrder().map((o) => o.name)[0], 'the new stage’s picture is the backdrop').toBe('stage-sewer');
    // The marks survive the swap.
    expect(scene.figures.map((f) => [f.active, f.target])).toEqual([[true, false], [false, false], [false, false], [false, true]]);
  });

  it('refuses bad data with one message that names the problem, and leaves the old stage exactly as it was', () => {
    const { scene } = run();
    const stage = scene.config;
    const figures = [...scene.figures];
    const before = frameOf(scene);
    const bad = copy(street());
    bad.backdrop.id = 'no_such_backdrop';
    expect(() => scene.loadStage(bad)).toThrow(/not valid, so the scene keeps "street"[\s\S]*backdrop/);
    expect(scene.config, 'the same config object').toBe(stage);
    expect(scene.figures, 'the same figures').toEqual(figures);
    for (const f of figures) expect(f.container.destroyed, `${f.id} is alive`).toBe(false);
    expect(frameOf(scene), 'the same frame').toBe(before);
    expect(scene.sys.world.drawOrder().map((o) => o.name)[0]).toBe('stage-street');
  });
});

describe('(c) snapshot and restore', () => {
  it('a snapshot is plain JSON: numbers, text and lists, no object of the engine (d)', () => {
    const { scene, game } = run();
    game.step(5);
    const snap = scene.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.version).toBe(1);
    expect(snap.stage.id).toBe('street');
    expect(snap.frame).toBe(5);
    expect(snap.lineup).toEqual(['kit', 'rook']);
    expect(snap.figures.map((f) => f.id)).toEqual(['kit', 'rook', 'rustfang_punk#0', 'scrap_hound#1']);
    // Nothing in it is a function or a class instance.
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== 'object') {
        expect(['number', 'string', 'boolean', 'object']).toContain(typeof v);
        return;
      }
      expect(Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v)).toBe(true);
      for (const x of Object.values(v)) walk(x);
    };
    walk(snap);
  });

  it('restore(snapshot()) gives the same frame on the same scene after it has moved on (a later tick, another stage, other marks), and a second snapshot equals the first', () => {
    const { scene, game } = run();
    game.step(37);
    scene.push({ x: 300, y: 150 });
    game.step(6);
    // A lunge in progress: the battle sets these on a figure.
    const hero = scene.figures[0];
    if (!hero) throw new Error('hero');
    hero.x += 12;
    hero.sortY += 3;
    hero.bodyDx = 2;
    hero.offX = 1;
    hero.alpha = 0.5;
    scene.refresh();
    const snap = scene.snapshot();
    const frame = frameOf(scene);
    // Move on: more ticks, another stage, other marks.
    game.step(50);
    scene.loadStage(sewer());
    scene.setMarks(1, 0);
    expect(frameOf(scene), 'control: the scene really did move on').not.toBe(frame);
    scene.restore(snap);
    expect(frameOf(scene)).toBe(frame);
    expect(scene.snapshot()).toEqual(snap);
    expect(scene.frame).toBe(snap.frame);
  });

  it('restore on a fresh scene made from the same init gives the same frame (the state travels, not the object)', () => {
    const a = run();
    a.game.step(41);
    a.scene.push({ x: 120, y: 200 });
    a.game.step(3);
    const snap: StageSnapshot = JSON.parse(JSON.stringify(a.scene.snapshot()));
    const b = run();
    b.game.step(2);
    expect(frameOf(b.scene), 'control: the other scene is not already the same').not.toBe(frameOf(a.scene));
    b.scene.restore(snap);
    expect(frameOf(b.scene)).toBe(frameOf(a.scene));
  });

  it('refuses a snapshot it cannot show and changes nothing: another version, a stage the file would refuse, an enemy that does not exist, a group of the wrong size', () => {
    const { scene, game } = run();
    game.step(9);
    const good = scene.snapshot();
    const before = frameOf(scene);
    const kept = [...scene.figures];
    const wrongVersion = { ...good, version: 2 } as unknown as StageSnapshot;
    const badStage = { ...good, stage: { ...copy(good.stage), backdrop: { ...good.stage.backdrop, id: 'no_such_backdrop' } } };
    const badEnemy = { ...good, enemies: ['rustfang_punk', 'no_such_enemy'] };
    const badSet = { ...good, setKey: '3' };
    for (const [what, snap, message] of [
      ['another version', wrongVersion, /version/],
      ['a stage the file would refuse', badStage, /not valid/],
      ['an enemy that does not exist', badEnemy, /no_such_enemy/],
      ['a group of the wrong size', badSet, /slots/],
    ] as const) {
      expect(() => scene.restore(snap), what).toThrow(message);
      expect(frameOf(scene), `${what}: the same frame`).toBe(before);
      expect(scene.figures, `${what}: the same figures`).toEqual(kept);
    }
  });
});

describe('the push camera', () => {
  it('has the legacy curve: up in 4 frames to 1.09x, down to 1 by frame 20, nothing outside (control: the numbers are the battle’s)', () => {
    expect(LEGACY_PUSH).toEqual({ zoom: 0.09, rampFrames: 4, lifeFrames: 20 });
    expect(pushStrength(0)).toBe(0);
    expect(pushStrength(4)).toBe(1);
    expect(pushZoom(4)).toBeCloseTo(1.09, 10);
    expect(pushZoom(0)).toBe(1);
    expect(pushZoom(19)).toBeCloseTo(1 + 0.09 * (1 / 16) ** 2, 10);
    expect(pushZoom(20)).toBe(1);
    expect(pushZoom(-1)).toBe(1);
    // It never goes past the largest push, and rises then falls.
    const zs = Array.from({ length: 20 }, (_, t) => pushZoom(t));
    expect(Math.max(...zs)).toBeLessThanOrEqual(1.09 + 1e-12);
    expect(zs.slice(0, 5)).toEqual([...zs.slice(0, 5)].sort((x, y) => x - y));
    expect(zs.slice(4)).toEqual([...zs.slice(4)].sort((x, y) => y - x));
  });

  it('keeps the window inside the picture: a focus in a corner leans toward the corner, a focus in the middle is centered', () => {
    const middle = pushView({ x: 240, y: 135 }, 1.09, 480, 270);
    expect(middle.x).toBeCloseTo(240 - 480 / 1.09 / 2, 8);
    const corner = pushView({ x: 0, y: 0 }, 1.09, 480, 270);
    expect([corner.x, corner.y, corner.offsetX, corner.offsetY]).toEqual([0, 0, -0, -0]);
    const far = pushView({ x: 480, y: 270 }, 1.09, 480, 270);
    expect(far.x + 480 / 1.09).toBeCloseTo(480, 8);
    expect(far.y + 270 / 1.09).toBeCloseTo(270, 8);
    // At zoom 1 the window is the whole picture.
    expect(pushView({ x: 77, y: 33 }, 1, 480, 270)).toEqual({ zoom: 1, x: 0, y: 0, offsetX: -0, offsetY: -0 });
  });

  it('scales the scene’s world layer while it runs and puts it back at the end', () => {
    const { scene, game } = run();
    expect(scene.sys.world.scaleX).toBe(1);
    scene.push({ x: 300, y: 150 });
    expect(scene.pushing).toBe(true);
    game.step(4);
    expect(scene.sys.world.scaleX).toBeCloseTo(pushZoom(4), 10);
    expect(scene.sys.world.x, 'the layer is moved so the focus stays in view').toBeLessThan(0);
    game.step(15);
    expect(scene.pushing).toBe(true);
    game.step(1);
    expect(scene.pushing).toBe(false);
    expect([scene.sys.world.scaleX, scene.sys.world.x, scene.sys.world.y]).toEqual([1, 0, 0]);
  });

  it('the shake (M3 task 6) moves the world layer and never the ui layer, adds to a push, and zero puts it back (control: no shake, no move)', () => {
    const { scene, game } = run();
    game.step(1);
    expect([scene.sys.world.x, scene.sys.world.y, scene.sys.ui.x, scene.sys.ui.y]).toEqual([0, 0, 0, 0]);
    scene.setShake(3, -2);
    game.step(1);
    expect([scene.sys.world.x, scene.sys.world.y], 'the picture moves the way the shake says').toEqual([3, -2]);
    expect([scene.sys.ui.x, scene.sys.ui.y], 'the HUD does not shake').toEqual([0, 0]);
    // With a push running the shake is added to the push's own offset.
    scene.push({ x: 300, y: 150 });
    game.step(4);
    const pushedX = scene.sys.world.x;
    scene.setShake(0, 0);
    game.step(0);
    expect(pushedX - scene.sys.world.x).toBe(3);
    game.step(30);
    expect([scene.sys.world.scaleX, scene.sys.world.x, scene.sys.world.y]).toEqual([1, 0, 0]);
  });

  it('replaces the enemies on stage with a bigger group (a summon), keeping the heroes and the slots of the group (control: a group the stage has no slots for throws and changes nothing)', () => {
    const { scene } = run();
    const heroes = scene.figures.filter((f) => f.side === 'party').map((f) => f.id);
    scene.setEnemies(['rustfang_punk', 'scrap_hound', 'rustfang_punk']);
    expect(scene.figures.filter((f) => f.side === 'party').map((f) => f.id)).toEqual(heroes);
    expect(scene.figures.filter((f) => f.side === 'enemy').map((f) => f.id)).toEqual(['rustfang_punk#0', 'scrap_hound#1', 'rustfang_punk#2']);
    expect(scene.enemies).toEqual(['rustfang_punk', 'scrap_hound', 'rustfang_punk']);
    const before = scene.figures.map((f) => f.id);
    expect(() => scene.setEnemies(Array.from({ length: 9 }, () => 'rustfang_punk'))).toThrow(/no enemy group|no enemy slots/);
    expect(scene.figures.map((f) => f.id)).toEqual(before);
  });

  it('hides no look constant in the scene’s code: the numbers of the push live in push.ts', () => {
    const text = readFileSync(join(resolve(import.meta.dirname, '..'), 'src/battlestage/stagescene.ts'), 'utf8');
    // Code only: the comments may name the 1.09x push.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/0\.09|1\.09/);
  });
});

describe('(e) step(n): n ticks, however the ticks are split', () => {
  it('the headless driver: step(n) is n ticks, and 1 tick n times is the same fight (control: one tick more is another state)', () => {
    const setup = () => setupFor(street(), 'boss+1', 7);
    for (const n of [1, 29, 30, 31, 200, 1000]) {
      const whole = new BattleDrive(setup()).step(n);
      const ones = new BattleDrive(setup());
      for (let i = 0; i < n; i++) ones.step(1);
      expect(whole.tick).toBe(n);
      expect(ones.tick).toBe(n);
      expect(ones.status()).toBe(whole.status());
      expect(ones.trace).toEqual(whole.trace);
    }
    // The control: the state moves with the ticks, so the equality above is not two copies of a frozen fight.
    const states = new Set([60, 300, 600, 1200, 2400].map((n) => new BattleDrive(setup()).step(n).status()));
    expect(states.size).toBeGreaterThan(2);
  });

  it('the scene: game.step(n) runs n ticks of the scene, and n times 1 gives the same frame (control: the frame is not frozen)', () => {
    const a = run();
    a.game.step(97);
    const b = run();
    for (let i = 0; i < 97; i++) b.game.step(1);
    expect(a.scene.frame).toBe(97);
    expect(b.scene.frame).toBe(97);
    expect(frameOf(a.scene)).toBe(frameOf(b.scene));
    const c = run();
    c.game.step(98);
    expect(c.scene.frame).toBe(98);
    // An enemy's idle motion moves with the tick: one tick more is a different frame somewhere in the sway cycle.
    const moved = [3, 17, 40, 61, 98].some((n) => {
      const x = run();
      x.game.step(n);
      return frameOf(x.scene) !== frameOf(a.scene);
    });
    expect(moved).toBe(true);
  });
});
