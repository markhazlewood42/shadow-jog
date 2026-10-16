/**
 * Input actions for the new scenes (docs/engine/interfaces.md section 8).
 * Follows: Godot `InputMap` and Unity action maps (Phaser has no action map). `ActionMap` is ours.
 *
 * This file WRAPS `src/sje/runtime/inputdevice.ts`, it does not copy it: keyboard, gamepad and touch, the nine actions, one-tick presses,
 * repeat after 16 ticks then every 4, `consume()` on every scene push and pop, and the player's custom keys all stay in the
 * `Input` class of `inputdevice.ts`. `Game` runs its `update()` and `endFrame()` at the places the design names (frame-and-rendering.md
 * section 2), and a scene reads it through `scene.input.actions`.
 *
 * Only a type of `Input` is imported, so this file adds no device code to the 3D or lab builds.
 *
 * @deviation from interfaces.md section 8: `justReleased` is not built (`Input` has no release edge, and no scene asks for
 * one), and `SceneInput.context` is not built (no scene needs parallel action maps yet). Both are absent from the types.
 */
import type { Action, Input } from './inputdevice';

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
  /**
   * The key bound to an action as a player reads it ('Z'), or the action's own name when it has no key. Follows the player's custom keys.
   * @deviation from interfaces.md section 8 (M8b): added so a menu's key hint (`keyLegend`, "Press X to continue") shows the player's own binding.
   */
  keyName(a: Action): string;
}

/** The action map over the old `Input`. One per game. */
export function actionMapOf(input: Input): ActionMap {
  return {
    justPressed: (a) => input.pressed(a),
    isDown: (a) => input.down(a),
    repeat: (a) => input.repeat(a),
    dir: () => input.dir(),
    consume: () => input.consume(),
    keyName: (a) => input.keyName(a),
  };
}

/** What `scene.input` is. */
export interface SceneInput {
  readonly actions: ActionMap;
}
