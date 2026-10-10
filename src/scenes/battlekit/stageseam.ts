/**
 * The seam between the shipped battle and a stage that draws it (M3 task 6; docs/engine/m3-brief.md sections 1 and 4).
 *
 * The battle scene (`scenes/battle.ts`) keeps state and flow: command entry, the round, playback of the engine's events through `PlaybackView`. Normally the
 * renderer beside it (`battlekit/render.ts`) draws the whole picture into a Canvas 2D. Under `?engine=sje` a STAGE can draw it instead: a scene of the new
 * engine that stands under the battle on the scene stack and shows the backdrop, the floor, the figures, the effects, the HUD and the numbers as Pixi
 * objects, while the battle scene keeps drawing only what is still the old UI (the menus, the end panels, the cut-ins, the intro) on a clear canvas over it.
 *
 * The stage READS the battle scene each tick (its `Disp` per fighter, the floaters, the banner, the mode, the effects layer), exactly as the old renderer does,
 * and gives back a few answers the battle needs about where things stand on the stage. That is all of this interface. Without the flag no stage is ever
 * registered, so `battleStages.open` answers null and the battle runs as it always did; this file adds no Pixi to the default path.
 *
 * The coordinates in this file are WORLD pixels (`BW` x `BHT`, 320 x 180), the numbers the battle and `FxLayer` already use. The stage works in screen pixels
 * of its own layout (`SCREEN_W` x `SCREEN_H` of `src/battlestage/config.ts`) and converts at this boundary: that is the one conversion in the program.
 */
import type { Pt } from '../../battle/fx';
import { notice } from '../../engine/errors';
import type { Game } from '../../engine/game';
import type { BattleScene } from '../battle';

/** What the battle scene asks of the stage that draws it. */
export interface BattleStage {
  /** The middle of a fighter's body, in world pixels: where an effect starts or lands. */
  pos(uid: number): Pt;
  /** Just above a fighter's head, in world pixels: where a number pops. */
  headPos(uid: number): Pt;
  /** The x of a fighter's feet, in world pixels: targeting goes from left to right. */
  footX(uid: number): number;
  /**
   * The first screen row below the stage HUD's top boxes (the turn timeline and the skill banner). The old top lines (the message, the enemy's tell, the round menu's help)
   * are drawn from here, so they never cover those boxes (M3 task 9: on the 640x360 layout the timeline spans the top of the screen).
   */
  readonly topClear: number;
  /** Take the stage off the scene stack. Safe to call twice. */
  close(): void;
}

/** Something that can make a stage for a battle (the engine's boot glue registers one under the flag). */
export interface BattleStageProvider {
  /** Build the stage for this battle and put it on the scene stack. Resolves null when it cannot (the battle then draws itself, as without the flag). */
  open(game: Game, scene: BattleScene): Promise<BattleStage | null>;
}

/** The words of the in-game notice (a warning bar) when the stage cannot be made: the fight then draws itself with the old renderer. */
export const STAGE_FAILED_NOTICE = 'The new battle stage could not load, so this fight uses the old view.';

let provider: BattleStageProvider | null = null;

/** Register (or, with null, remove) the provider. Called by `src/sje/boot.ts` under `?engine=sje`, and by tests. */
export function setBattleStageProvider(p: BattleStageProvider | null): void {
  provider = p;
}

export const battleStages = {
  /** True when a stage can be made. */
  get available(): boolean {
    return provider !== null;
  },
  /** A stage for this battle, or null (no provider, or the provider could not make one). */
  async open(game: Game, scene: BattleScene): Promise<BattleStage | null> {
    return provider ? provider.open(game, scene) : null;
  },
};

/**
 * A provider that loads the real one with `load` on first use (M3 fix round 1, finding F1). `src/sje/boot.ts` registers it, with `load` a dynamic `import()` of the stage's code.
 * The load can fail (a network error, a stale deploy), and `open` of the real provider can throw. A fight must not cost the player that: the failure is a notice in the game's own
 * bar and a null answer, so the battle draws itself with the old renderer. It never rejects.
 */
export function lazyStageProvider(load: () => Promise<BattleStageProvider>): BattleStageProvider {
  return {
    async open(game: Game, scene: BattleScene): Promise<BattleStage | null> {
      try {
        return await (await load()).open(game, scene);
      } catch (e) {
        console.warn(`[battle stage] could not load, so the battle draws itself: ${e instanceof Error ? e.message : String(e)}`);
        notice(STAGE_FAILED_NOTICE, 'warn');
        return null;
      }
    },
  };
}
