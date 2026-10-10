/**
 * The battle stage scene (src/battlestage/stagescene.ts) wired to the real engine, in Node. Step B1 of the engine-platform spike. Like
 * tests/battlestage-figure.test.ts, the texture helpers that need a browser canvas are replaced by ones that register fake canvases; the scene,
 * the figures, the display list, the texture manager and the scene stack are the real ones.
 *
 * What it pins: who is built where (party first, then enemies, in the slots of the group), the marks (who has a ring), the errors for a group
 * that does not match its enemies, a lineup longer than the party slots and an unknown enemy, the tick counter and the idle motion it drives,
 * the mirrored enemy's measurements (about the feet: the figure's foot goes to `w - foot.x`), a second punk being a different individual,
 * and what closing the scene frees.
 */
import { describe, expect, it, vi } from 'vitest';
import { Scene, type TextureManager } from '../src/sje';
import { enemySlots, type StageConfig, stageOf } from '../src/battlestage/config';
import type { FacingFile } from '../src/battlestage/facing';
import { enemyIdle, idleFrame } from '../src/battlestage/idle';
import { BattleStageScene, type BattleStageInit } from '../src/battlestage/stagescene';
import { fakeCanvas, headlessGame } from './sjekit';
import { fixtureStages } from './stagefiles';

vi.mock('../src/battlestage/textures', () => {
  const add = (textures: TextureManager, key: string, w: number, h: number): string => {
    if (!textures.exists(key)) textures.addCanvas(key, fakeCanvas(w, h));
    return key;
  };
  // A fake figure picture with real (blank) pixels, because mirroring reads them.
  const sheetArt = (w: number, h: number) => ({ raw: { w, h, data: new Uint8ClampedArray(w * h * 4) }, box: { x0: 10, y0: 8, x1: w - 11, y1: h - 2, feet: Math.floor(w / 2) }, foot: { x: Math.floor(w / 2), y: h - 1 }, face: { x: 3, y: 4 }, grain: 1 });
  return {
    PREFIX: { shadow: 'shadow-', ring: 'ring-' },
    pruneTextures: (textures: TextureManager, prefix: string, inUse: ReadonlySet<string>) => textures.prune(prefix, inUse),
    shadowTexture: (textures: TextureManager, width: number) => add(textures, `shadow-${width}`, width + 8 + (width % 2), 10),
    ringTexture: (textures: TextureManager, width: number, color: string) => add(textures, `ring-${width}-${color.slice(1)}`, width + 6, 12),
    hazedTexture: (_textures: TextureManager, base: string) => base,
    bakeStage: (textures: TextureManager) => ({ key: add(textures, 'stage-test', 480, 270) }),
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

function street(): StageConfig {
  return stageOf(fixtureStages(), 'street');
}

function init(over: Partial<BattleStageInit> = {}): BattleStageInit {
  return { stages: fixtureStages(), stageId: 'street', metas: META, standIns: true, lineup: ['kit'], setKey: '1', enemies: ['rustfang_punk'], facing: FACING, ...over };
}

function run(over: Partial<BattleStageInit> = {}): { scene: BattleStageScene; game: ReturnType<typeof headlessGame>['game'] } {
  const { game } = headlessGame();
  const scene = new BattleStageScene(init(over));
  void game.run(scene);
  return { scene, game };
}

describe('BattleStageScene: what it builds', () => {
  it('builds the party first and the enemies after, in the slots of the group, each standing on its slot', () => {
    const { scene } = run({ lineup: ['kit', 'rook'], setKey: '2', enemies: ['rustfang_punk', 'scrap_hound'] });
    expect(scene.figures.map((f) => `${f.side}:${f.id}`)).toEqual(['party:kit', 'party:rook', 'enemy:rustfang_punk#0', 'enemy:scrap_hound#1']);
    const stage = street();
    expect(scene.figures.filter((f) => f.side === 'party').map((f) => f.slot)).toEqual([stage.party[0], stage.party[1]]);
    expect(scene.figures.filter((f) => f.side === 'enemy').map((f) => f.slot)).toEqual(enemySlots(stage, '2'));
    // The backdrop is the first thing drawn, then the figures from the farthest feet to the nearest.
    const order = scene.sys.world.drawOrder().map((o) => o.name);
    expect(order[0]).toBe('stage-test');
    const depths = scene.figures.map((f) => ({ name: `figure ${f.id}`, depth: f.depth })).sort((a, b) => a.depth - b.depth);
    expect(order.slice(1)).toEqual(depths.map((d) => d.name));
  });

  it('the stage defaults to its own lineup and roster for the group when the init names none', () => {
    // No lineup and no enemies in the init: the stage's own.
    const { game } = headlessGame();
    const scene = new BattleStageScene({ stages: fixtureStages(), stageId: 'street', metas: META, standIns: true, setKey: '3', facing: FACING });
    void game.run(scene);
    const stage = street();
    expect(scene.figures.filter((f) => f.side === 'party').map((f) => f.id)).toEqual(stage.demo.lineup);
    const roster = stage.demo.rosters['3'] ?? [];
    expect(roster.length).toBeGreaterThan(0);
    expect(scene.figures.filter((f) => f.side === 'enemy').map((f) => f.id)).toEqual(roster.map((key, i) => `${key}#${i}`));
  });

  it('a second enemy of one kind is a different individual (copy 1), and a mirrored enemy’s figure is the mirror image about its feet', () => {
    const { scene } = run({ setKey: '2', enemies: ['rustfang_punk', 'rustfang_punk'] });
    const foes = scene.figures.filter((f) => f.side === 'enemy');
    expect(foes.map((f) => f.describe().body.texture)).toEqual(['enemy-punk-0', 'enemy-punk-1']);
    const [a] = foes;
    if (!a) throw new Error('no enemy');
    // The art measured as drawn: foot x 42 of 85. Mirrored about the feet it is 85 - 42 = 43, and the sprite is flipped.
    expect(a.art.foot.x).toBe(42);
    expect(a.measured.foot.x).toBe(85 - 42);
    expect(a.mirror).toBe(true);
    expect(a.describe().body.flipX).toBe(true);
    expect(a.describe().body.originX).toBeCloseTo(43 / 85, 10);
  });

  it('an enemy whose sprite is not in the facing file is not mirrored', () => {
    const { scene } = run({ facing: {} });
    expect(scene.figures.filter((f) => f.side === 'enemy').every((f) => !f.mirror)).toBe(true);
  });
});

describe('BattleStageScene: the marks', () => {
  it('the acting hero has the cyan ring and the target the amber one; nobody else has a ring', () => {
    const { scene } = run({ lineup: ['kit', 'rook'], setKey: '2', enemies: ['rustfang_punk', 'scrap_hound'], active: 1, target: 0 });
    const rings = scene.figures.map((f) => [f.id, f.describe().ring.visible] as const);
    expect(rings).toEqual([
      ['kit', false],
      ['rook', true],
      ['rustfang_punk#0', true],
      ['scrap_hound#1', false],
    ]);
    expect(scene.figures.find((f) => f.id === 'rook')?.active).toBe(true);
    expect(scene.figures.find((f) => f.id === 'rustfang_punk#0')?.target).toBe(true);
  });

  it('with no marks there is no ring at all, and the shadow and ring pictures nobody shows are pruned', () => {
    const { scene, game } = run();
    expect(scene.figures.every((f) => !f.describe().ring.visible)).toBe(true);
    // A hidden ring still holds the stub picture it was made with (the spike does the same), so exactly that one picture is kept.
    const rings = game.textures.getTextureKeys().filter((k) => k.startsWith('ring-'));
    expect(rings).toEqual(['ring-24-3fe0f0']);
    // One shadow picture for each figure's size, and no more.
    const shadows = game.textures.getTextureKeys().filter((k) => k.startsWith('shadow-'));
    expect(shadows.length).toBeLessThanOrEqual(scene.figures.length);
  });
});

describe('BattleStageScene: mistakes are readable errors, and leave a clean stack', () => {
  const failing = (over: Partial<BattleStageInit>) => {
    const { game } = headlessGame();
    const scene = new BattleStageScene(init(over));
    // `game.run` rejects with the error of `create`; the stack is cleaned either way.
    return { promise: game.run(scene), game };
  };

  it('a group with more or fewer slots than enemies', async () => {
    const f = failing({ setKey: '2', enemies: ['rustfang_punk'] });
    await expect(f.promise).rejects.toThrow('The set "2" has 2 slots but 1 enemies were given');
    expect(f.game.scene.scenes).toHaveLength(0);
  });

  it('an unknown enemy', async () => {
    const f = failing({ enemies: ['no_such_enemy'] });
    await expect(f.promise).rejects.toThrow('Unknown enemy "no_such_enemy"');
    expect(f.game.scene.scenes).toHaveLength(0);
  });

  it('a lineup longer than the party slots, and a crew member with no sheet', async () => {
    const tooMany = failing({ lineup: ['kit', 'rook', 'kit', 'rook', 'kit'], metas: META });
    await expect(tooMany.promise).rejects.toThrow(/No slot, sheet or feet for/);
    const none = failing({ lineup: ['ghost'] });
    await expect(none.promise).rejects.toThrow(/No metadata for ghost/);
    expect(none.game.scene.scenes).toHaveLength(0);
  });

  it('an unknown stage is refused when the scene is made, naming the stages there are', () => {
    expect(() => new BattleStageScene(init({ stageId: 'no_such_stage' }))).toThrow(/street/);
  });
});

describe('BattleStageScene: time', () => {
  class Probe extends Scene<void> {
    fixedUpdate(): void {}
  }

  it('counts its own ticks from zero (not the game’s), and every figure moves as a function of the tick', () => {
    const { game } = headlessGame();
    // Some game ticks pass before the scene starts: the scene's own counter must not include them.
    const other = new Probe();
    void game.run(other);
    game.step(37);
    other.close();
    const scene = new BattleStageScene(init({ lineup: ['kit'], enemies: ['rustfang_punk'] }));
    void game.run(scene);
    expect(scene.frame).toBe(0);
    for (let t = 1; t <= 120; t++) {
      game.advanceTick();
      expect(scene.frame).toBe(t);
      expect(scene.worldFrame).toBe(t);
      const [kit, punk] = scene.figures;
      if (!kit || !punk) throw new Error('figures');
      expect(kit.describe().body.frame).toBe(idleFrame(t, 8, 8, 0));
      const o = enemyIdle('breathe', t, 0);
      expect([punk.describe().body.x, punk.describe().body.y - 1]).toEqual([o.x, o.y]);
    }
  });

  it('a second hero starts its loop three frames in (the spike’s rule), so the party does not bounce in unison', () => {
    const { scene } = run({ lineup: ['kit', 'rook'], setKey: '2', enemies: ['rustfang_punk', 'scrap_hound'] });
    const [kit, rook] = scene.figures;
    expect(kit?.describe().body.frame).toBe(idleFrame(0, 8, 8, 0));
    expect(rook?.describe().body.frame).toBe(idleFrame(0, 8, 8, 3));
  });
});

describe('BattleStageScene: closing', () => {
  it('destroys the display list, forgets the figures and lets go of every texture it showed', () => {
    const { scene, game } = run({ active: 0, target: 0 });
    const users = (key: string) => (game.textures.get(key) as unknown as { useCount: number }).useCount;
    expect(users('stage-test')).toBe(1);
    expect(users('crewb-kit')).toBeGreaterThan(0);
    scene.close();
    expect(scene.figures).toHaveLength(0);
    expect(users('stage-test')).toBe(0);
    expect(users('crewb-kit')).toBe(0);
    expect(game.scene.scenes).toHaveLength(0);
    // The textures themselves stay in the manager: the next scene finds them by name (nothing is made twice).
    expect(game.textures.exists('crewb-kit')).toBe(true);
  });

  it('a new scene after a closed one finds the textures again: nothing is added twice', () => {
    const { scene, game } = run();
    const before = game.textures.getTextureKeys().sort();
    scene.close();
    const again = new BattleStageScene(init());
    void game.run(again);
    expect(game.textures.getTextureKeys().sort()).toEqual(before);
  });
});
