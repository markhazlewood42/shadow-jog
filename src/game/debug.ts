import type { BattleDriver } from '../scenes/battlekit/driver';

/** Test/debug switches, driven from E2E tests via window.__SJ__.debug. Never enabled in normal play. */
export const debug = {
  /** Dialogs, cards, panels, shops and prompts resolve instantly (choice 0). */
  autoDialog: false,
  /** Battles resolve instantly as wins (rewards still granted). */
  autoBattle: false,
  /** Battles resolve instantly as losses (tests the Game Over flow). */
  autoLose: false,
  /**
   * Hands-off playtest for screenshot capture: dialogs, cards and panels stay up long enough
   * to be seen, then advance; battles play a few real Auto rounds, then resolve as wins.
   */
  playtest: false,
};

/** Real rounds a playtest battle plays before it is resolved as a win. */
export const PLAYTEST_ROUNDS = 3;

/** True when a waiting screen should close itself: instantly under autoDialog, after `frames` in playtest. */
export function autoClose(t: number, frames: number): boolean {
  return debug.autoDialog || (debug.playtest && t > frames);
}

/**
 * The debug switches as a battle driver (battlekit/driver.ts). boot.ts registers it in DEV builds
 * only, so a shipped build's battles have no test paths at all.
 */
export const debugBattleDriver: BattleDriver = {
  resolveAtOnce: () => (debug.autoLose ? 'lose' : debug.autoBattle ? 'win' : null),
  // Playtest capture: linger on the menu or a results panel long enough to be seen, then act.
  act: (panel, idle) => (!debug.playtest ? null : panel ? (idle > 110 ? 'confirm' : null) : idle > 40 ? 'auto' : null),
  // A few real rounds for the camera, then a guaranteed win so the run keeps moving.
  endAsWin: (b) => debug.playtest && (b.outcome === 'lose' || b.round >= PLAYTEST_ROUNDS || b.party.some((p) => p.hp < p.base.maxHp * 0.35)),
  hurry: () => debug.autoBattle || debug.autoLose,
};
