/**
 * What a hack gives back to the story, and what the story does with it
 * (docs/engine/frame-and-rendering.md 7.4, decisions E11 and E19).
 *
 * `HackResult` ALWAYS arrives. A story script that awaits a hack must never hang, so every way a
 * hack can end is a value:
 *   success / fail      the player played it to the end
 *   aborted             it ended early: the GL context was lost and stayed lost, the player quit,
 *                       or the 3D scene threw
 *   unsupported         it could not start: this browser has no WebGL2, or the 3D chunk would not load
 *
 * THE POLICY (E19, option A: "per hack, authored"). The story author decides, for EACH hack, what
 * happens on `aborted` and on `unsupported`. `decideHack` is the pure rule that applies the author's
 * choice. It has no browser in it, so Vitest can check every case.
 *
 * This file must stay free of `three` and of the engine: the shipped game loads it up front, so the
 * story can reason about results without downloading the 3D chunk.
 */

export type HackResult =
  | { status: 'success'; data?: unknown }
  | { status: 'fail'; data?: unknown }
  | { status: 'aborted'; reason: 'context-lost' | 'user' | 'error' }
  | { status: 'unsupported'; reason: 'no-webgl2' | 'chunk-failed' };

/**
 * What a story gives `hack()`. It is plain data: no engine, no Three. A story file can write one
 * without loading the 3D chunk. (A first-draft shape: the real fields come with the hack design.)
 */
export interface HackDef {
  /** Names the hack in logs and saves. */
  id: string;
  /** Seeds every random choice, so a hack plays out the same way each time. */
  seed: number;
  /** How long it lasts, in ticks (60 per second). */
  ticks: number;
  /** How many pieces of ICE (1 to 5). */
  iceCount: number;
  /** TRACE (0 to 100) at which it fails (it fails the tick TRACE reaches this). TRACE stops at 100, so a limit ABOVE 100 never fails. */
  traceLimit: number;
  /** TRACE added by each hit. */
  hitCost: number;
  /** What the story does when it could not run to the end. Default: DEFAULT_POLICY. */
  policy?: HackPolicy;
}

/** What a story does when a hack could not run to the end. Chosen by the author, per hack. */
export interface HackPolicy {
  /**
   * `aborted`: `retry-then-succeed` runs the hack once more and, if that ends early too, counts it as
   * won (the story needs the player past this door). `succeed` and `fail` skip the retry.
   * Only a lost context (reason `context-lost`) is ever retried. An abort the player caused (`user`) starts nothing at all.
   */
  aborted: 'retry-then-succeed' | 'succeed' | 'fail';
  /** `unsupported`: `alternative` plays an authored 2D version instead; `succeed` and `fail` skip it. */
  unsupported: 'alternative' | 'succeed' | 'fail';
}

/** The default for a hack whose author said nothing: be kind, never trap the player. */
export const DEFAULT_POLICY: HackPolicy = { aborted: 'retry-then-succeed', unsupported: 'alternative' };

/** What the story does next. */
export type HackDecision =
  /** The hack is over for story purposes. `via` says whether the player played it or the policy decided. */
  | { next: 'done'; outcome: 'success' | 'fail'; via: 'played' | 'policy' }
  /** Run the hack again (only ever once). */
  | { next: 'retry' }
  /**
   * The player dropped the story (`game.abandon()` or `game.reset()`: a loaded save, the title screen). Start nothing and
   * say nothing more: the story that asked for this hack is over, and the stack now belongs to something else.
   */
  | { next: 'dropped' }
  /** Play the authored 2D alternative. It decides success or failure itself. */
  | { next: 'alternative' };

/**
 * Apply the author's policy to one result.
 * @param retriesUsed how many retries this hack has had already (0 on the first run).
 */
export function decideHack(result: HackResult, policy: HackPolicy, retriesUsed: number): HackDecision {
  switch (result.status) {
    case 'success':
    case 'fail':
      return { next: 'done', outcome: result.status, via: 'played' };
    case 'aborted':
      // E19: only a LOST CONTEXT is worth a retry. The player dropping the story is not a failure of the hack,
      // and a retry would start a scene on top of whatever the player moved to. A scene that threw (`error`) would
      // most likely throw again, so it does not retry either.
      if (result.reason === 'user') return { next: 'dropped' };
      if (policy.aborted === 'retry-then-succeed' && retriesUsed < 1 && result.reason === 'context-lost') return { next: 'retry' };
      return { next: 'done', outcome: policy.aborted === 'fail' ? 'fail' : 'success', via: 'policy' };
    case 'unsupported':
      if (policy.unsupported === 'alternative') return { next: 'alternative' };
      return { next: 'done', outcome: policy.unsupported === 'fail' ? 'fail' : 'success', via: 'policy' };
  }
}

/** One short line for logs and the lab. */
export function describeResult(r: HackResult): string {
  return r.status === 'aborted' || r.status === 'unsupported' ? `${r.status} (${r.reason})` : r.status;
}
