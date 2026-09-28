/**
 * Who drives a battle besides the player. Normally nobody: the scene asks, gets no answer, and
 * the player does everything. A test harness registers a driver (DEV builds only: see boot.ts)
 * to resolve fights instantly, or to let them play a few real rounds for the camera and then
 * move on. The scene holds no test logic of its own; it only asks these questions.
 */
import type { Battle } from '../../battle/engine';

export interface BattleDriver {
  /** Resolve the fight before it starts: 'win' or 'lose', or null to play it. */
  resolveAtOnce(): 'win' | 'lose' | null;
  /**
   * The scene is waiting on the player (a results panel, or the round menu) and has been for
   * `idle` frames: 'confirm' closes the panel, 'auto' plays the round on Auto, null waits.
   */
  act(panel: boolean, idle: number): 'confirm' | 'auto' | null;
  /** After a round that didn't end the fight: stop here and resolve it as a win. */
  endAsWin(battle: Battle): boolean;
  /** Skip the results panels and the defeat beats' long waits. */
  hurry(): boolean;
  /** Press timed prompts by itself: on the beat ('perfect'), a little early ('good'), or not (null). */
  timing(): 'perfect' | 'good' | null;
}

let current: BattleDriver | null = null;

export function setBattleDriver(d: BattleDriver | null): void {
  current = d;
}

export function battleDriver(): BattleDriver | null {
  return current;
}
