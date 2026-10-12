/**
 * What a hack session gives back (docs/engine/interfaces.md section 12; decision E11: a hack ALWAYS resolves, so every way it can end is a value).
 *
 * It lives in the engine core, at level 0, so that BOTH sides can name it without the one importing the other: the lazy 3D chunk (`Scene3D`
 * ends a session with it) and the hack door (`src/hack3d/result.ts`, which the shipped game loads up front and which must not import Three).
 * Type only: there is no code in this file.
 */

/** Why a 3D session ended early (not by its own success or fail). */
export type HackAbortReason = 'context-lost' | 'user' | 'error';

/** Why a hack could not start at all. */
export type HackUnsupportedReason = 'no-webgl2' | 'chunk-failed';

export type HackResult =
  | { status: 'success'; data?: unknown }
  | { status: 'fail'; data?: unknown }
  | { status: 'aborted'; reason: HackAbortReason }
  | { status: 'unsupported'; reason: HackUnsupportedReason };
