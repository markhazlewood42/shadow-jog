/**
 * The lazy 3D chunk's entry (docs/engine/frame-and-rendering.md 7.2). A story script reaches it only
 * through ONE dynamic `import('../hack3d')`, in the door that `s.hack` uses; everything that imports
 * Three.js lives behind this file, so the shipped game does not download Three until the first hack.
 *
 * Importing `src/hack3d/result.ts` instead (the result types and the policy) does NOT load Three.
 */
import type { Game } from '../sje';
import { HackScene, type HackOptions } from './hackscene';
import type { HackDef, HackResult } from './result';

export { frame3dTestSeams } from '../sje/three';
export { ColourProbeScene } from './colorprobe';
export { HackScene, type HackOptions, makeHackDef } from './hackscene';
export { HackSim } from './sim/hacksim';

/**
 * Run a hack and return its result. The promise ALWAYS resolves, with one of the four results
 * (decision E11: "s.hack always resolves"):
 *   - the scene finished: its own `success` or `fail`;
 *   - it ended early (context lost for good, an error while drawing): `aborted`;
 *   - it was dropped by `game.abandon()` or `game.reset()`: `aborted` with reason `user`. (`game.run`
 *     alone would stay pending forever then, which is right for most scenes but not for a hack.)
 *   - it could not even start (`create` threw): `aborted` with reason `error`.
 */
export function startHack(game: Game, def: HackDef, options?: HackOptions): Promise<HackResult> {
  const scene = new HackScene(def, options);
  return new Promise<HackResult>((resolve) => {
    let settled = false;
    const settle = (r: HackResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    scene.onAbandoned = () => settle({ status: 'aborted', reason: 'user' });
    game.run(scene).then(settle, (e) => {
      console.error('[sje] the hack could not start:', e);
      settle({ status: 'aborted', reason: 'error' });
    });
  });
}
