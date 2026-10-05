/**
 * The stage lab (DEV only, /sjestage.html): boots the Shadow Jog Engine with the battle stage slice (`src/battlestage/slice.ts`) and installs
 * `window.__SJESTAGE__` (`stagehook.ts`), the hook the e2e spec (e2e/sjestage.spec.ts) uses to set the tick, the seed and the sprite mode and to read
 * the back buffer. The parity harness compares this page's frames with the Phaser spike's page on the same tick.
 *
 * It follows the engine lab (`lab.ts`): the canvas fills the window and shows the 480x270 picture at the largest whole zoom, on whole device
 * pixels. Without `?manual` the real 60 Hz loop runs.
 */
import { assert, Game, GlRenderer, H, must, W } from '../sje';
import { BattleStageScene, chooseSprites, haveMarksSheets, loadStageAssets, loadStageData, type SpriteChoice, type StageData } from '../battlestage';
import { SLICE, sliceInit } from '../battlestage/slice';
import { installGlCounter } from './glcounter';
import { installStageHook } from './stagehook';

export interface ShowOptions {
  /** How many ticks to run before the frame is drawn (the scene starts at tick 0). Default 0. */
  tick?: number;
  /** The floor seed. Default: the slice's (the stage file's own). */
  seed?: number;
  /** 'standins' draws the crew as code-drawn blocks, 'art' uses Mark's sheets (when his folder is there). Default: what the page started with. */
  sprites?: 'standins' | 'art';
}

export interface StageLab {
  game: Game;
  renderer: GlRenderer;
  data: StageData;
  /** Which crew pictures are in use now. */
  sprites(): SpriteChoice;
  /** True when Mark's sheets were found at start-up. */
  haveArt: boolean;
  scene(): BattleStageScene | null;
  /** The seed and the sprites the current scene was made with, and the ticks it has run. */
  current(): { seed: number; sprites: 'standins' | 'art'; tick: number };
  /** Close the current scene, make a new one for these options and bring it to its tick (one frame is drawn). */
  show(opts?: ShowOptions): Promise<void>;
}

/** Boot the engine and the stage slice. */
export async function startStageLab(): Promise<StageLab> {
  const params = new URLSearchParams(location.search);
  // Count GL objects from before the context exists, so nothing is missed.
  installGlCounter();
  const parent = must(document.getElementById('stage'), '#stage');
  const game = await Game.create({ parent, dev: true });
  assert(game.renderer instanceof GlRenderer, 'the stage lab needs the GL renderer');
  const renderer = game.renderer;
  const data = await loadStageData();
  // Whether Mark's sheets are there is asked once, without console noise; a missing folder is normal on CI.
  const haveArt = await haveMarksSheets();
  let choice = await chooseSprites(params.has('standins') || !haveArt);
  await loadStageAssets(game.textures, choice);

  const status = document.getElementById('status');
  // The tests screenshot the canvas: nothing may sit on top of it.
  if (status && params.has('manual')) status.style.display = 'none';
  // The size the browser says the canvas box has in DEVICE pixels, when it can say (real Chrome and Firefox).
  let observed: { w: number; h: number } | undefined;
  const fitCanvas = (): void => {
    const k = renderer.fitToWindow(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, observed);
    game.draw();
    if (status) status.textContent = `${W}x${H}  x${k}  dpr ${window.devicePixelRatio}  ${choice.standIns ? 'stand-ins' : "Mark's art"}`;
  };
  window.addEventListener('resize', fitCanvas);
  try {
    const watcher = new ResizeObserver((entries) => {
      const size = entries[0]?.devicePixelContentBoxSize?.[0];
      if (size && (observed?.w !== size.inlineSize || observed?.h !== size.blockSize)) {
        observed = { w: size.inlineSize, h: size.blockSize };
        fitCanvas();
      }
    });
    watcher.observe(renderer.glc.canvas, { box: 'device-pixel-content-box' });
  } catch {
    // A browser without 'device-pixel-content-box' (Safari): the arithmetic in deviceSize() is used.
  }

  let scene: BattleStageScene | null = null;
  let made = { seed: SLICE.seed, sprites: (choice.standIns ? 'standins' : 'art') as 'standins' | 'art' };
  const lab: StageLab = {
    game,
    renderer,
    data,
    haveArt,
    sprites: () => choice,
    scene: () => scene,
    current: () => ({ ...made, tick: scene?.frame ?? 0 }),
    async show(opts = {}) {
      const seed = opts.seed ?? SLICE.seed;
      const kind = opts.sprites ?? made.sprites;
      if (kind === 'art' && !haveArt) throw new Error("Mark's sheets are not on this machine, so the 'art' mode cannot be shown");
      // The old scene goes first: its objects are destroyed and the textures it showed are kept for the next one.
      scene?.close();
      scene = null;
      if ((kind === 'standins') !== choice.standIns) {
        choice = await chooseSprites(kind === 'standins');
        await loadStageAssets(game.textures, choice);
      }
      scene = new BattleStageScene(sliceInit(data, choice, seed));
      void game.run(scene);
      made = { seed, sprites: kind };
      // Run the ticks with no real time passing, then draw one frame: the same tick count is always the same picture.
      game.step(opts.tick ?? 0);
      fitCanvas();
    },
  };
  await lab.show({ tick: Number(params.get('tick') ?? 0), seed: params.has('seed') ? Number(params.get('seed')) : SLICE.seed });
  // `?manual` leaves the clock to the tests (`__SJESTAGE__.step`). Otherwise the real 60 Hz loop runs.
  if (!params.has('manual')) game.start();
  window.__SJESTAGE__ = installStageHook(lab);
  return lab;
}
