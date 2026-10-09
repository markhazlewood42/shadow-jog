/**
 * Input actions for the new scenes (docs/engine/interfaces.md section 8).
 * Follows: Godot `InputMap` and Unity action maps (Phaser has no action map). `ActionMap` is ours.
 *
 * This file WRAPS `src/engine/input.ts`, it does not copy it: keyboard, gamepad and touch, the nine actions, one-tick presses,
 * repeat after 16 ticks then every 4, `consume()` on every scene push and pop, and the player's custom keys all stay in the
 * old `Input` class. `Game` runs its `update()` and `endFrame()` at the places the design names (frame-and-rendering.md
 * section 2), and a scene reads it through `scene.input.actions`. The legacy scenes read `game.input` (the same object) as before.
 *
 * Only a type of the old `Input` is imported (the runtime never runs old engine code), so this file adds no old code to the 3D or lab builds.
 *
 * @deviation from interfaces.md section 8: `justReleased` is not built (the old `Input` has no release edge, and no scene asks for
 * one), and `SceneInput.context` is not built (no scene needs parallel action maps yet). Both are absent from the types.
 */
import type { Action, Input } from '../../engine/input';

export type { Action };

export interface ActionMap {
  /** True for exactly one tick. A tap shorter than a tick is kept. */
  justPressed(a: Action): boolean;
  isDown(a: Action): boolean;
  /** Pressed, or held long enough to auto-repeat (menus). */
  repeat(a: Action): boolean;
  /** The most recently pressed direction, or null. */
  dir(): 'up' | 'down' | 'left' | 'right' | null;
  /** Swallow the current presses so the next scene does not see them. */
  consume(): void;
}

/** The action map over the old `Input`. One per game. */
export function actionMapOf(input: Input): ActionMap {
  return {
    justPressed: (a) => input.pressed(a),
    isDown: (a) => input.down(a),
    repeat: (a) => input.repeat(a),
    dir: () => input.dir(),
    consume: () => input.consume(),
  };
}

/** What `scene.input` is. */
export interface SceneInput {
  readonly actions: ActionMap;
}
