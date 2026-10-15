/**
 * Battle Test (ET task 6; built from the Phaser spike's idea of RPG Maker's "Battle Test", on the engine since ET): a REAL fight on the stage you are editing, unsaved edits included.
 *
 * The spike had its own battle (flow, performer, effects: about 2,000 lines). The engine's version does not: **decision 2, option B** (docs/engine/et-brief.md). The fight is the
 * game's own `BattleScene` (the one the player fights in), run over the game's own `LiveStageScene`, which is made from the editor's UNSAVED stage, crew and data. So the test plays
 * what the game plays: the menus, the timed presses, the effects, the numbers, Items and Run. It shows no move animations, because the shipped stage has none
 * (`src/battlestage/live.ts`, "What is NOT here").
 *
 * This file holds no game scene. The one file that touches the game's battle scene is `battleglue.ts`, which this file loads with a dynamic `import()`, so the scene stays out of the editor's
 * chunk (`tests/et-tools.test.ts` pins that). The dialog that asks what to test is `battledialog.ts`.
 *
 * Time: the page's game runs its real 60 Hz loop. A spec stops the loop and advances the fight with `game.step(n)` (the same n ticks give the same picture), and reads
 * `status()` and `trace`.
 */
import type { DemoMember, StageConfig } from '../../battlestage/config';
import type { Game } from '../../sje';
import type { Fight, FightOutcome, FightStatus } from './battleglue';
import type { StageHost } from './host';

/** What the Battle Test dialog hands over. */
export interface BattleTestOptions {
  /** Who fights, in party order (slot 1 first): crew id, level and the gear and story flags from the stage's demo loadout. */
  party: DemoMember[];
  /** The enemies (keys of `ENEMIES`) standing in the stage's slot set for that many (the first a boss for a boss set). */
  roster: string[];
  /** Which slot set: "3", "boss+1"... */
  setKey: string;
  seed: number;
  /** Start every fighter with full TP and skill uses. */
  fullResources: boolean;
  /** 1 or 2: game ticks per 1/60 s. */
  speed: 1 | 2;
  /** The computer gives the heroes' orders and confirms the panels (so the fight plays itself). */
  auto: boolean;
  /** Play the timed presses (the rings). Default off: a seed then names one fight. */
  timed?: boolean;
}

export type { FightOutcome, FightStatus };

/** Apply the dialog's choices to a stage config: who stands in the party slots and which enemies fill the group. */
export function stageForTest(stage: StageConfig, o: BattleTestOptions): StageConfig {
  const copy = JSON.parse(JSON.stringify(stage)) as StageConfig;
  copy.demo.lineup = o.party.map((m) => m.id);
  copy.demo.party = o.party.map((m) => ({ ...m }));
  copy.demo.rosters[o.setKey] = [...o.roster];
  return copy;
}

/**
 * Copy a key event to the game's input (`Booted.keys`). The page calls it while a test runs, for every key it does not keep for itself (Esc is the editor's: it ends the test).
 * Returns true when the key was passed on, so the page can stop the browser acting on it.
 */
export function forwardKey(keys: EventTarget, e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false; // browser and editor shortcuts stay theirs
  keys.dispatchEvent(new KeyboardEvent(e.type, { code: e.code, key: e.key, repeat: e.repeat }));
  return true;
}

/** A running test. */
export class BattleTest {
  /** How the fight ended by itself, or null while it runs (and after Esc). */
  outcome: FightOutcome | null = null;
  private stopped = false;

  private constructor(
    readonly options: BattleTestOptions,
    /** True when the stage under test differs from the saved one (the status line says so). */
    readonly unsaved: boolean,
    /** The stage the fight runs on: the editor's stage as it was on screen when Start was pressed, with the dialog's party and enemies in it. */
    readonly stage: StageConfig,
    private readonly fight: Fight,
    private readonly game: Game,
  ) {}

  /**
   * Stand the editor's scene aside and start the fight on `stage` (the stage as the editor shows it, previewed enemies and unsaved edits included). Rejects with a readable
   * message when the fight cannot start (a stage the game would refuse...), with the editor's scene back.
   */
  static async start(game: Game, host: StageHost, stage: StageConfig, options: BattleTestOptions, unsaved: boolean): Promise<BattleTest> {
    const glue = await import('./battleglue');
    const cfg = stageForTest(stage, options);
    const init = host.liveInit(cfg, options.party.map((m) => m.id), options.roster);
    host.suspend();
    try {
      const fight = await glue.startFight(game, {
        init,
        party: options.party,
        roster: options.roster,
        seed: options.seed,
        fullResources: options.fullResources,
        auto: options.auto,
        timed: options.timed ?? false,
        speed: options.speed,
        bg: cfg.backdrop.id,
        boss: options.setKey.startsWith('boss'),
      });
      return new BattleTest(options, unsaved, cfg, fight, game);
    } catch (e) {
      host.resume();
      throw e;
    }
  }

  /** What the fight is doing and how the fighters stand (the engine's numbers). */
  status(): FightStatus {
    return this.fight.status();
  }

  /** One line per action so far (see `Fight.trace`). */
  get trace(): readonly string[] {
    return this.fight.trace;
  }

  /** Settles when the fight ends by itself. */
  get finished(): Promise<FightOutcome> {
    return this.fight.finished.then((o) => {
      this.outcome = o;
      return o;
    });
  }

  /**
   * Play ticks of the game with no real time passing (a spec stops the real loop first: `game.stop()`), until `n` ticks have run or `until` says stop. Returns the ticks played.
   * Why not `game.step(n)` alone: the battle scene is a chain of `await game.wait(...)`, and a promise continues only when the running code lets go of the thread. So this lets
   * go after every tick (one message-channel hop: the promises of that tick all run before the next), and draws one frame at the end, as `game.step` does.
   */
  async advance(n: number, until?: () => boolean): Promise<number> {
    const hop = (): Promise<void> =>
      new Promise((resolve) => {
        const c = new MessageChannel();
        c.port1.onmessage = () => {
          c.port1.close();
          resolve();
        };
        c.port2.postMessage(0);
      });
    let played = 0;
    while (played < n && !this.stopped && !(until?.() ?? false)) {
      this.game.advanceTick();
      played++;
      await hop();
    }
    if (!this.stopped) this.game.draw(0);
    return played;
  }

  /** End the test: the fight's scenes and timers go and the game's state comes back. The caller then stands the editor's scene up (`host.resume`). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.fight.dispose();
  }
}
