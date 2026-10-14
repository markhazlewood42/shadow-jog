/**
 * Battle Test's glue (ET task 6; docs/engine/et-brief.md decision 2, option B, and the Battle Test exemption of pass line 2).
 *
 * Battle Test runs the game's OWN `BattleScene` (`src/scenes/battle.ts`) over the stage the editor shows, unsaved edits included. That scene still uses the old engine until M8
 * converts it, so every line that touches the old engine is in this ONE file. `tests/et-tools.test.ts` names it (and `scenes/battle.ts`) as the only old-engine files a Battle Test
 * file may reach, and only through a dynamic `import()` (`battletest.ts` makes it). M8 deletes this file's old-engine half together with the exemption.
 *
 * What it does, in order (the same steps the shipped battle takes in `game/systems.ts` `runBattle`, and the probe of `et-survey.md` section 9.1):
 *   1. route the old effects (`postfx`) to the new engine's (`game.fx`), as `src/sje/boot.ts` does for the game;
 *   2. set the party the game's battle reads (`state.party`, `state.members`), the story flags the loadouts name, the inventory, and a fixed seed for the battle's random numbers;
 *   3. make the `BattleScene`, then the game's `LiveStageScene` over the editor's stage (made from the unsaved data, so what the fight shows is what the editor showed), and run both;
 *   4. record a status trace as the fight goes: one line per action, the engine's state of every fighter (the same lines `legacyTrace` writes), so a seed gives a checkable fight;
 *   5. on the way out, put everything back (state, settings, flags, driver, music, the effects routing) and drop every scene and timer so no half-finished round can run on.
 */
import { battleTrace, engineWords, headOf, setupFor } from '../../battlestage/battledrive';
import { type DemoMember, stageOf } from '../../battlestage/config';
import { LiveStageScene, liveStage } from '../../battlestage/live';
import type { BattleStageInit } from '../../battlestage/stagescene';
import type { BattleEvent } from '../../battle/types';
import { music } from '../../audio/music';
import { FX } from '../../data/fx';
import { streams } from '../../engine/rng';
import { postfx } from '../../engine/postfx';
import { createMember, memberStats, restoreUses } from '../../game/party';
import { settings } from '../../game/settings';
import { flags, state } from '../../game/state';
import type { MemberId } from '../../game/state';
import { BattleScene } from '../../scenes/battle';
import { setBattleDriver } from '../../scenes/battlekit/driver';
import { routePostfx } from '../../sje/fx/route';
import type { Game } from '../../sje';

/** Everything a fight needs, as plain data (the editor's Battle Test file builds it from the dialog and the unsaved stage). */
export interface FightPlan {
  /** The stage scene's data: the unsaved stage, the crew, the enemies, and the editor's pictures and data files. */
  init: BattleStageInit;
  /** Who fights: crew id, level, the stage's own gear and story flags for that member. */
  party: DemoMember[];
  /** The enemies, in slot order. */
  roster: string[];
  /** The seed of every roll of the battle. The same seed and the same orders give the same fight. */
  seed: number;
  /** Start every fighter at full resource (TP, skill uses). */
  fullResources: boolean;
  /** The computer gives every order and confirms every panel, so the fight plays itself. */
  auto: boolean;
  /** Play the timed presses (the rings). Off by default: a press that nobody makes would change the fight, and a seed should name one fight. */
  timed: boolean;
  /** Game ticks per 1/60 s (1 or 2). */
  speed: 1 | 2;
  /** The old backdrop id the battle scene is made with (the stage draws the picture; the id only has to exist). */
  bg: string;
  boss: boolean;
}

/** How a fight ended: `run` is the party fleeing. */
export type FightOutcome = 'win' | 'lose' | 'run';

/** What the page can read of a running fight. */
export interface FightStatus {
  /** What the battle scene is doing: `intro`, `round` (the Fight/Auto/Run menu), `command`, `list`, `target`, `play`, `end`. */
  mode: string;
  round: number;
  outcome: 'win' | 'lose' | 'fled' | null;
  /** The hero who is giving orders (a crew id) while the scene is in `command`, `list` or `target`, else null. */
  actor: string | null;
  /** The `uid` of the fighter the targeting cursor is on while the scene is in `target`, else null. */
  target: number | null;
  party: Array<{ id: string; name: string; hp: number; maxHp: number; tp: number; down: boolean }>;
  foes: Array<{ id: string; name: string; hp: number; maxHp: number; down: boolean }>;
}

export interface Fight {
  status(): FightStatus;
  /** One line per action: `r<round> <action> | <every fighter>` (the lines of `legacyTrace` in `battledrive.ts`). */
  readonly trace: string[];
  /** Settles when the battle scene ends by itself (a win, a defeat, a flight). Never settles when `dispose` drops the scenes. */
  readonly finished: Promise<FightOutcome>;
  /** Put everything back. Safe to call twice. */
  dispose(): void;
}

/** The story flags the party's loadouts name that are not on yet (they decide which skills the crew know). */
function flagsToTurnOn(party: readonly DemoMember[]): string[] {
  const out: string[] = [];
  for (const m of party) for (const f of m.flags ?? []) if (!flags.has(f) && !out.includes(f)) out.push(f);
  return out;
}

/** Start a fight on the page's game. The editor's own scene must be suspended first (two stage scenes must not draw at once). */
export async function startFight(game: Game, plan: FightPlan): Promise<Fight> {
  // ---- 1. the effects
  const problems = game.fx.loadData(FX);
  if (problems.length > 0) throw new Error(`src/data/fx.json is not valid: ${problems.join('; ')}`);
  const unroute = routePostfx(postfx, () => game.fx);

  // ---- 2. the game's state, kept to put back
  const saved = { party: state.party, members: state.members, inventory: state.inventory, lastOrders: state.lastOrders, timing: settings.timing, speed: game.speed };
  const turnedOn = flagsToTurnOn(plan.party);
  let disposed = false;
  let stage: LiveStageScene | null = null;
  const undo = (): void => {
    if (disposed) return;
    disposed = true;
    setBattleDriver(null);
    stage?.close();
    // Every scene, timer and fade goes without resolving: a round that is half played must not run on and push a panel on top of the editor.
    game.abandon();
    music(null, 0);
    for (const f of turnedOn) flags.clear(f);
    state.party = saved.party;
    state.members = saved.members;
    state.inventory = saved.inventory;
    state.lastOrders = saved.lastOrders;
    settings.timing = saved.timing;
    game.speed = saved.speed;
    postfx.clear();
    unroute();
  };

  try {
    for (const f of turnedOn) flags.set(f);
    state.party = plan.party.map((m) => m.id as MemberId);
    state.members = {};
    for (const l of plan.party) {
      const m = createMember(l.id as MemberId, l.level);
      Object.assign(m.equip, l.equip ?? {});
      const s = memberStats(m);
      m.hp = s.maxHp;
      if (plan.fullResources) {
        m.tp = s.maxTp;
        restoreUses(m);
      }
      state.members[l.id as MemberId] = m;
    }
    // A generous kit, so the Items menu has something in it (as `?scene=battle` does).
    state.inventory = { medkit: 5, neurotab: 2, adrenal_stim: 1, frag: 2, smoke_pellet: 1 };
    state.lastOrders = {};
    if (!plan.timed) settings.timing = 'off';
    game.speed = plan.speed;
    setBattleDriver(
      plan.auto
        ? {
            resolveAtOnce: () => null,
            // The round menu waits a beat so it is seen, then plays the round on Auto. A results panel waits a little longer, then closes.
            act: (panel, idle) => (panel ? (idle > 40 ? 'confirm' : null) : idle > 24 ? 'auto' : null),
            endAsWin: () => false,
            hurry: () => false,
            timing: () => null,
          }
        : null,
    );

    // ---- 3. the battle, then the stage under it
    // The battle takes its seed from the `battle` stream when it is made: for this one call the stream answers with the plan's seed, so `new Rng(seed)` is what runs the fight.
    const stream = streams.battle;
    const draw = stream.int.bind(stream);
    stream.int = () => plan.seed;
    let scene: BattleScene;
    try {
      scene = new BattleScene({ encounter: 'street', enemies: plan.roster, bg: plan.bg, boss: plan.boss, canRun: !plan.boss });
    } finally {
      stream.int = draw;
    }
    const battle = scene.battle;
    const trace: string[] = [];
    // An action is declared by `next()` and resolved by `land()`; the trace names it by the declaration, as `legacyTrace` does (`[...step.events, ...land()]`).
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

    stage = new LiveStageScene(plan.init, scene);
    // Runs init, preload and create now; a stage that cannot be made throws here (a readable message), and the editor comes back.
    void game.run(stage);
    scene.attachStage(stage);
    attachHook(plan);

    const finished = game.run(scene).then((result): FightOutcome => result);
    const status = (): FightStatus => {
      const unit = (u: (typeof battle.units)[number]) => ({ id: u.key, name: u.name, hp: Math.max(0, u.hp), maxHp: u.base.maxHp, down: u.hp <= 0 });
      return {
        mode: scene.mode,
        round: battle.round,
        outcome: battle.outcome,
        actor: scene.mode === 'command' || scene.mode === 'list' || scene.mode === 'target' ? (scene.actor?.key ?? null) : null,
        target: scene.mode === 'target' ? (scene.targetList[scene.targetIdx] ?? null) : null,
        party: battle.party.map((u) => ({ ...unit(u), tp: u.tp })),
        foes: battle.enemies.map(unit),
      };
    };
    return { status, trace, finished, dispose: undo };
  } catch (e) {
    undo();
    throw e;
  }
}

/**
 * The DEV hook of the game's battle (`src/sje-lab/battlehook.ts`), on the page's `window.__SJ__`, so the editor's fight is read the way the game's own is:
 *   battleStage          the stage of the fight that is on, as plain data (the figures where they stand, in draw order); null when none is on
 *   battleTrace(seed)    the SAME fight (the stage under test, its party and enemies, full resources as chosen) played on the headless driver (`battledrive.ts`), as a status trace.
 *                        The live fight's `trace` for the same seed must equal it: that is how the page proves the game's own battle runs what the driver says it does.
 * (Written here and not imported from the lab file: tool files do not import `src/sje-lab`, and the lab's hook reads the saved 480 data, not the stage on screen.)
 */
function attachHook(plan: FightPlan): void {
  const w = window as unknown as { __SJ__?: Record<string, unknown> };
  w.__SJ__ ??= {};
  const stage = stageOf(plan.init.stages, plan.init.stageId);
  Object.defineProperties(w.__SJ__, {
    battleStage: { get: () => liveStage()?.describe() ?? null, configurable: true, enumerable: true },
    battleTrace: {
      value: (seed: number) => battleTrace({ ...setupFor(stage, plan.init.setKey ?? '3', seed), roster: [...plan.roster], fullResources: plan.fullResources }),
      configurable: true,
      enumerable: true,
      writable: true,
    },
  });
}
