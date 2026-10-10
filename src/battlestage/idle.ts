/**
 * How an enemy moves while it waits (Phaser spike, `spike/phaser-stage`): the same small hovers, bobs and
 * sways the game's own battle draws (`drawEnemy` in `src/scenes/battlekit/render.ts`), as a pure function
 * of a frame number so the stage scene can replay them from its fixed-step counter and a test can pin them.
 *
 * The game moves enemies in "world" pixels (its backdrop is 240x135 and is drawn twice as big); this
 * stage works directly on the 480x270 screen, so the offsets are doubled to match what the player sees.
 */
export type IdleKind = 'bob' | 'hover' | 'sway' | 'breathe' | 'flicker' | 'still';

/** World pixels to screen pixels. */
const WORLD_TO_SCREEN = 2;

/** The offset in screen pixels (whole numbers) for an enemy of this idle kind at `frame` (60 a second). `uid` keeps two of a kind out of step. */
export function enemyIdle(kind: IdleKind, frame: number, uid: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  switch (kind) {
    case 'hover':
      y = Math.round(Math.sin(frame * 0.08 + uid) * 2);
      break;
    case 'bob':
      y = Math.round(Math.sin(frame * 0.1 + uid) * 1);
      break;
    case 'sway':
      x = Math.round(Math.sin(frame * 0.05 + uid) * 2);
      y = Math.round(Math.sin(frame * 0.1) * 1);
      break;
    case 'breathe':
      y = Math.floor((frame + uid * 13) / 30) % 2;
      break;
    case 'flicker':
      y = Math.round(Math.sin(frame * 0.06 + uid) * 2);
      break;
    case 'still':
      break;
  }
  // "+ 0" turns a -0 (Math.round of a small negative) into a plain 0.
  return { x: x * WORLD_TO_SCREEN + 0, y: y * WORLD_TO_SCREEN + 0 };
}

/**
 * Which frame of a looping sheet shows at fixed-step tick `tick` (60 ticks a second), for a sheet that
 * plays at `fps` and has `count` frames; `phase` starts it that many frames in, so four heroes do not
 * bounce in unison.
 *
 * The stage picks frames from its own tick counter, not from Phaser's animation clock, on purpose: the
 * animation clock runs on wall-clock time, so a replay would drift from run to run and a hit-pause could
 * not freeze it. A frame chosen from the tick is the same every run, and when the battle test stops the
 * tick (hitstop) everything holds still together.
 */
export function idleFrame(tick: number, fps: number, count: number, phase = 0): number {
  const n = Math.floor((tick * fps) / 60) + phase;
  return ((n % count) + count) % count;
}
