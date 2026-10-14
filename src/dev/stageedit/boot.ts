/**
 * Starting the Battle Stage Editor's engine (ET task 5): the Shadow Jog Engine in the page's centre, the crew's pictures, and the stage scene.
 *
 * The Phaser spike's `boot.ts` made a Phaser game, kept its canvas at a whole zoom and centered it on a device pixel. All of that is the engine's now: `Game.create` makes the
 * canvas, and the engine's `Display` draws the 640x360 picture at the largest WHOLE zoom that fits the parent, centered on a whole device pixel, with the void color around it
 * (`src/sje/runtime/display.ts`). What is left is what the lab does too (`src/sje-lab/stagelab.ts`): the rig data the enemies are drawn from, the crew's sheets (Mark's, or the
 * code-drawn stand-ins when his folder is not there), and a scene.
 */
import { loadRigData } from '../../art/rig2/data';
import type { Phase } from '../../battlestage/demo';
import { chooseSprites, haveMarksSheets, loadStageAssets } from '../../battlestage/boot';
import type { StageConfig } from '../../battlestage/config';
import { Game, type GameConfig } from '../../sje';
import { type HostData, StageHost } from './host';

export interface Booted {
  game: Game;
  host: StageHost;
  /** True when the crew are code-drawn stand-ins (Mark's sheets are not on this machine, or the page asked: `?standins`). */
  standIns: boolean;
}

export interface BootOptions {
  /** The element the engine's canvas fills (it must be positioned and have a size). */
  parent: HTMLElement;
  /** Skip Mark's sheets on purpose (`?standins`). */
  forceStandIns: boolean;
  data: HostData;
  /** The first stage on show, with the enemies standing in it and the moment of the turn. */
  stage: StageConfig;
  enemies: readonly string[];
  phase: Phase;
}

/** Make the game, load the pictures, run the first scene and start the real 60 Hz loop. Rejects with a readable message (no WebGL 2, a missing sheet...). */
export async function bootEditor(opts: BootOptions): Promise<Booted> {
  await loadRigData();
  // The editor has no keyboard or gamepad of the game's: the page's own keys are the editor's. The game's input object is a stand-in with the three calls the loop makes.
  const input = { update: () => undefined, endFrame: () => undefined, consume: () => undefined } as unknown as GameConfig['input'];
  const game = await Game.create({ parent: opts.parent, input, dev: true, fxLevel: 'none' });
  // Whether Mark's sheets are there is asked once, without console noise; a missing folder is normal on CI.
  const standIns = opts.forceStandIns || !(await haveMarksSheets());
  const choice = await chooseSprites(standIns);
  await loadStageAssets(game.textures, choice);
  const host = StageHost.start(game, { metas: choice.metas, standIns: choice.standIns }, opts.data, opts.stage, opts.enemies, opts.phase);
  game.start();
  return { game, host, standIns: choice.standIns };
}
