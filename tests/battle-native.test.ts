/**
 * The battle scene as a native `sje` scene (M8c, group E; docs/engine/m8-brief.md task 8 and the rubric item 2, 5, 7).
 *
 * `BattleScene` runs on a real `Game` here, with no renderer and a scripted input, as the UI scenes do in tests/sje-ui-scenes-3.test.ts. Every proof that something DOES
 * happen has a control: a case where it must not, so the check is known to be able to fail.
 *
 *   1. It extends the sje `Scene`, and no file of the battle imports the old engine's game, display, postfx or moments (a scan with a control).
 *   2. The battle-in transition: the intro's moment plays on `game.fx` on the tick of the crack, once.
 *   3. Hit stop: while the battle is frozen the effects clock stands still (`game.fx.rate` is 0), and it runs again after.
 *   4. A move's shake and flash reach the game, in game pixels, with the strength the scene always gave them.
 *   5. However the fight ends, its effects end with it (`game.fx` is cleared and loses its clip).
 *   6. The M3 control: the seed 7 status trace of the live scene equals `battleTrace` for seed 7 (the headless driver), and another seed's driver trace does not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { battleTrace, engineWords, headOf, setupFor } from '../src/battlestage/battledrive';
import { stageOf } from '../src/battlestage/config';
import type { BattleEvent } from '../src/battle/types';
import { streams } from '../src/sje/core/rng';
import type { Input } from '../src/sje/runtime/inputdevice';
import { Scene } from '../src/sje';
import { Game } from '../src/sje/runtime/game';
import { installCanvasStub } from './recorder';
import { fixtureStages } from './stagefiles';

const sfxCalls: string[] = [];
vi.mock('../src/audio/sfx', () => ({ sfx: (name: string) => void sfxCalls.push(name) }));
vi.mock('../src/audio/music', () => ({ music: () => undefined, previewMusic: () => undefined, pushMusic: () => undefined, popMusic: () => undefined }));
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
  game = new Game({ renderer: { render: () => undefined }, input: new Keys() as unknown as Input });
  sfxCalls.length = 0;
  // The crew with their gear (the chapter's last stage): a fresh state for each test, because the trace test replaces the party.
  const { applyStage } = await import('../src/game/stages');
  applyStage('finale');
  const { setBattleDriver } = await import('../src/scenes/battlekit/driver');
  setBattleDriver(null);
});

const tick = (n: number): void => {
  for (let i = 0; i < n; i++) game.advanceTick();
};
/** Let the scene's async flows (the intro, a round) run on to their next wait: a timer that ran in a tick resumes its flow in a microtask. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
/** One tick, then the flows it released. */
const step = async (n = 1): Promise<void> => {
  for (let i = 0; i < n; i++) {
    game.advanceTick();
    await settle();
  }
};

/** A fight on the street against `enemies`, run on the game, with its first tick not yet played. */
async function fight(enemies: string[] = ['rustfang_punk']) {
  const { BattleScene } = await import('../src/scenes/battle');
  const scene = new BattleScene({ encounter: 'street', enemies, bg: 'street' });
  void game.run(scene);
  return scene;
}

/** The text of a source file without comments, so a mention in a comment is not an import. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
/** An import (or a dynamic import) of one of the old engine's four files. */
const OLD_ENGINE = /(?:from\s*|import\s*\(\s*)['"][^'"]*engine\/(?:game|display|postfx|moments)['"]/;

describe('the battle scene is a native sje scene', () => {
  it('extends the sje Scene, and a run gives it a canvas image in its display list', async () => {
    const scene = await fight();
    expect(scene).toBeInstanceOf(Scene);
    game.advanceTick();
    expect(scene.sys.world.list.some((o) => o.constructor.name === 'CanvasImage')).toBe(true);
  });

  it('no file of the battle imports the old engine: not its game, display, postfx or moments', () => {
    const files = ['src/scenes/battle.ts', 'src/scenes/battlekit/playback.ts', 'src/scenes/battlekit/render.ts', 'src/scenes/battlekit/stageseam.ts', 'src/battlestage/liveopen.ts'];
    for (const f of files) expect(code(readFileSync(join(import.meta.dirname, '..', f), 'utf8')), f).not.toMatch(OLD_ENGINE);
  });

  it('control: the scan finds an import of each of the four files, and ignores a comment', () => {
    for (const name of ['game', 'display', 'postfx', 'moments']) {
      expect(`import { x } from '../engine/${name}';`).toMatch(OLD_ENGINE);
      expect(`const m = () => import('../../engine/${name}');`).toMatch(OLD_ENGINE);
    }
    expect(code(`// import { postfx } from '../engine/${'postfx'}';`)).not.toMatch(OLD_ENGINE);
    expect(`import { shake } from '../engine/shake';`).not.toMatch(OLD_ENGINE);
  });
});

describe('the effects of the battle go to game.fx and the game, on the same ticks as before', () => {
  it('the battle-in transition: the intro moment plays once, at the middle of the screen, on the tick of the crack', async () => {
    const { CRACK, INTRO_T } = await import('../src/scenes/battlekit/intro');
    const { battleSpeed } = await import('../src/game/settings');
    const { W, H } = await import('../src/sje/core/size');
    const calls: Array<{ name: string; x: number; y: number; tick: number }> = [];
    game.fx.playMoment = (name, x, y) => void calls.push({ name, x, y, tick: game.tick });
    await fight();
    // The shatter runs `INTRO_T` effect frames at the battle speed; the crack is the one step that crosses `CRACK`. The first step runs in the call that starts the scene.
    const speed = battleSpeed().mult;
    const at = Math.ceil(CRACK / speed) - 1;
    expect(at).toBeGreaterThan(0);
    await step(at - 1);
    expect(calls).toEqual([]);
    await step();
    expect(calls).toEqual([{ name: 'intro', x: W / 2, y: H / 2, tick: at }]);
    await step(Math.ceil(INTRO_T / speed));
    expect(calls).toHaveLength(1);
  });

  it('hit stop: while the battle is frozen the effects clock stands still, and it runs again after', async () => {
    const scene = await fight();
    game.advanceTick();
    const hold = scene as unknown as { hitstop: number };
    hold.hitstop = 3;
    for (let i = 0; i < 3; i++) {
      game.advanceTick();
      expect(game.fx.rate, `during the freeze, tick ${i}`).toBe(0);
    }
    game.advanceTick();
    expect(hold.hitstop).toBe(0);
    // Control: out of the freeze the clock follows the battle's own (the pace times the battle speed), which is above zero.
    expect(scene.fx.rate).toBeGreaterThan(0);
    expect(game.fx.rate).toBe(scene.fx.rate);
  });

  it('a move asks for a shake and a flash: the game gets them with the strength the scene always gave them', async () => {
    const scene = await fight();
    game.advanceTick();
    const shakes: Array<[number, number]> = [];
    const flashes: Array<[string, number]> = [];
    game.shake = (frames, mag) => void shakes.push([frames ?? 0, mag ?? 0]);
    game.flash = (color, frames) => void flashes.push([color ?? '', frames ?? 0]);
    // Control: a tick with nothing asked for makes no call.
    game.advanceTick();
    expect([shakes, flashes]).toEqual([[], []]);
    scene.fx.shake = 7;
    scene.fx.flash = { color: '#ffe07a', frames: 5 };
    game.advanceTick();
    // Strength 7 is 6 + 7 frames, with the 4 step of the table (6 to 9 is 4).
    expect(shakes).toEqual([[13, 4]]);
    expect(flashes).toEqual([['#ffe07a', 5]]);
    // Asked for once: the scene took the request.
    expect(scene.fx.shake).toBe(0);
    expect(scene.fx.flash).toBeNull();
  });

  it('a freeze holds a request back: nothing reaches the game until the freeze is over', async () => {
    const scene = await fight();
    game.advanceTick();
    const shakes: number[] = [];
    game.shake = (frames) => void shakes.push(frames ?? 0);
    (scene as unknown as { hitstop: number }).hitstop = 2;
    scene.fx.shake = 9;
    tick(2);
    expect(shakes).toEqual([]);
    game.advanceTick();
    expect(shakes).toEqual([15]);
  });

  it('the fight owns the effects layer while it runs and clears it however it ends', async () => {
    const { PANEL_Y } = await import('../src/scenes/battlekit/geom');
    const { W } = await import('../src/sje/core/size');
    game.fx.clip = null;
    const scene = await fight();
    // The particles stay on the battlefield, above the status cards.
    expect(game.fx.clip).toEqual({ x: 0, y: 0, w: W, h: PANEL_Y });
    scene.close('run');
    game.advanceTick();
    expect(game.fx.clip).toBeNull();
  });
});

describe('the M3 control: the seed 7 status trace of the live scene equals the headless driver', () => {
  /**
   * Play the fight of `setup` on the real scene, with the computer giving every order, and write one line per action, as `legacyTrace` does: the engine's state of every
   * fighter. This is the instrument of Battle Test's glue (src/dev/stageedit/battleglue.ts), on the scene without a stage.
   */
  async function liveTrace(setup: ReturnType<typeof setupFor>): Promise<string[]> {
    const [{ createMember, memberStats, restoreUses }, { settings }, { flags, state }, { setBattleDriver }, { BattleScene }] = await Promise.all([
      import('../src/game/party'),
      import('../src/game/settings'),
      import('../src/game/state'),
      import('../src/scenes/battlekit/driver'),
      import('../src/scenes/battle'),
    ]);
    type Id = (typeof state.party)[number];
    const turnedOn: string[] = [];
    for (const m of setup.demo.party) for (const f of m.flags ?? []) if (!flags.has(f)) (flags.set(f), turnedOn.push(f));
    const saved = { party: state.party, members: state.members, timing: settings.timing };
    try {
      state.party = setup.demo.party.map((m) => m.id as Id);
      state.members = {};
      for (const l of setup.demo.party) {
        const m = createMember(l.id as Id, l.level);
        Object.assign(m.equip, l.equip ?? {});
        const s = memberStats(m);
        m.hp = s.maxHp;
        if (setup.fullResources) {
          m.tp = s.maxTp;
          restoreUses(m);
        }
        state.members[l.id as Id] = m;
      }
      state.lastOrders = {};
      settings.timing = 'off';
      setBattleDriver({ resolveAtOnce: () => null, act: (panel, idle) => (panel ? (idle > 40 ? 'confirm' : null) : idle > 24 ? 'auto' : null), endAsWin: () => false, hurry: () => false, timing: () => null });
      // The battle takes its seed from the `battle` stream when it is made: for this one call the stream answers with the seed.
      const stream = streams.battle;
      const draw = stream.int.bind(stream);
      stream.int = () => setup.seed;
      let scene: InstanceType<typeof BattleScene>;
      try {
        scene = new BattleScene({ encounter: 'street', enemies: setup.roster, bg: 'street', canRun: false });
      } finally {
        stream.int = draw;
      }
      const battle = scene.battle;
      const trace: string[] = [];
      const next = battle.next.bind(battle);
      let declared: BattleEvent[] = [];
      battle.next = () => {
        const step = next();
        declared = step ? [...step.events] : [];
        return step;
      };
      const land = battle.land.bind(battle);
      battle.land = (grade) => {
        const events = land(grade);
        trace.push(`r${battle.round} ${headOf([...declared, ...events])} | ${engineWords(battle)}`);
        return events;
      };
      const endRound = battle.endRound.bind(battle);
      battle.endRound = () => {
        const events = endRound();
        trace.push(`r${battle.round} end | ${engineWords(battle)}`);
        return events;
      };
      const finished = game.run(scene);
      let done = false;
      void finished.then(() => (done = true));
      for (let i = 0; i < 60_000 && !done; i++) await step();
      expect(done, 'the fight ended').toBe(true);
      return trace;
    } finally {
      setBattleDriver(null);
      for (const f of turnedOn) flags.clear(f);
      state.party = saved.party;
      state.members = saved.members;
      settings.timing = saved.timing;
    }
  }

  const stage = stageOf(fixtureStages(), 'street');

  it('seed 7, the street, three foes: line for line the driver’s trace', async () => {
    const live = await liveTrace(setupFor(stage, '3', 7));
    const driven = battleTrace(setupFor(stage, '3', 7)).trace;
    // A comparison of two empty lists would pass for the wrong reason.
    expect(live.length).toBeGreaterThan(3);
    expect(live).toEqual(driven);
    // Control: another seed's fight is another trace, and one changed word is caught.
    expect(live).not.toEqual(battleTrace(setupFor(stage, '3', 8)).trace);
    expect(live.map((l, i) => (i === 2 ? l.replace(/\d/, (d) => String((Number(d) + 1) % 10)) : l))).not.toEqual(driven);
  }, 60_000);
});
