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
