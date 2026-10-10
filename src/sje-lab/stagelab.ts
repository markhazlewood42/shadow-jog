/**
 * The stage lab (DEV only, /sjestage.html): boots the Shadow Jog Engine with the battle stage slice (`src/battlestage/slice.ts`) and installs
 * `window.__SJESTAGE__` (`stagehook.ts`), the hook the e2e spec (e2e/sje-stage-parity.spec.ts) uses to set the tick, the seed and the sprite mode and to read
 * the back buffer. The parity harness compares this page's frames with the Phaser spike's frames (the goldens) on the same tick.
 *
 * It follows the engine lab (`lab.ts`): the canvas fills the window and shows the 640x360 picture at the largest whole zoom, on whole device
 * pixels. The slice is laid out in the 480x270 numbers of the stage JSONs, in the top left of that frame (M3 decision 1a, regression parity); the rest is the
 * void color. Without `?manual` the real 60 Hz loop runs.
 *
 * The effects: `?fx=none` (the default here) draws no effect, so the frame is the stage alone, which is what the goldens are. `?fx=full` runs the whole
 * effect stack on the stage (the crisp-pixel check of M3 pass line 5).
 */
import { assert, type FxRequest, Game, type GameConfig, GlRenderer, H, must, W } from '../sje';
import fxJson from '../data/fx.json';
import { BattleStageScene, chooseSprites, haveMarksSheets, loadStageAssets, loadStageData, type SpriteChoice, type StageData } from '../battlestage';
import { type FrameKind, SLICE, sliceInit } from '../battlestage/slice';
import { installGlCounter } from './glcounter';
import { installStageHook } from './stagehook';

export interface ShowOptions {
  /** How many ticks to run before the frame is drawn (the scene starts at tick 0). Default 0. */
  tick?: number;
  /** The floor seed. Default: the slice's (the stage file's own). */
  seed?: number;
  /** 'standins' draws the crew as code-drawn blocks, 'art' uses Mark's sheets (when his folder is there). Default: what the page started with. */
  sprites?: 'standins' | 'art';
  /** 'slice' (default) or 'haze': the second frame of the parity set, four heroes and three enemies on hazed rows with no ring (cleanup item C3). */
  frame?: FrameKind;
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
  current(): { seed: number; sprites: 'standins' | 'art'; frame: FrameKind; tick: number };
  /** Close the current scene, make a new one for these options and bring it to its tick (one frame is drawn). */
  show(opts?: ShowOptions): Promise<void>;
}

/** Boot the engine and the stage slice. */
export async function startStageLab(): Promise<StageLab> {
  const params = new URLSearchParams(location.search);
  // Count GL objects from before the context exists, so nothing is missed.
  installGlCounter();
  const parent = must(document.getElementById('stage'), '#stage');
  const fx = params.get('fx') ?? 'none';
  assert(fx === 'none' || fx === 'auto' || fx === 'full' || fx === 'lite', `?fx= must be none, auto, full or lite, not "${fx}"`);
  // The lab has no keyboard or gamepad: the game's input object is a stand-in with the three calls the loop makes. (The type is the old engine's `Input`, taken from `GameConfig`.)
  const input = { update: () => undefined, endFrame: () => undefined, consume: () => undefined } as unknown as GameConfig['input'];
  const game = await Game.create({ parent, input, dev: true, fxLevel: fx as FxRequest });
  assert(game.renderer instanceof GlRenderer, 'the stage lab needs the GL renderer');
  // The moments of fx.json, so a test can play one by name (the real game loads them in src/sje/boot.ts).
  const fxProblems = game.fx.loadData(fxJson);
  if (fxProblems.length > 0) throw new Error(`src/data/fx.json is not valid: ${fxProblems.join('; ')}`);
  const renderer = game.renderer;
  const data = await loadStageData();
  // Whether Mark's sheets are there is asked once, without console noise; a missing folder is normal on CI.
  const haveArt = await haveMarksSheets();
  let choice = await chooseSprites(params.has('standins') || !haveArt);
  await loadStageAssets(game.textures, choice);

  // The status line sits over the bottom-left of the window, so over the canvas. Under a test driver (`navigator.webdriver`) and with `?manual` it is removed and
  // the text goes to the page title (cleanup item C10, as in lab.ts).
  const statusEl = document.getElementById('status');
  const hideStatus = params.has('manual') || navigator.webdriver;
  if (hideStatus) statusEl?.remove();
  const status = hideStatus ? null : statusEl;
  // The size the browser says the canvas box has in DEVICE pixels, when it can say (real Chrome and Firefox).
  let observed: { w: number; h: number } | undefined;
  const fitCanvas = (): void => {
    const k = renderer.fitToWindow(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, observed);
    game.draw();
    const line = `${W}x${H}  x${k}  dpr ${window.devicePixelRatio}  ${choice.standIns ? 'stand-ins' : "Mark's art"}`;
    document.title = `Stage lab: ${line}`;
    if (status) status.textContent = line;
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
  let made = { seed: SLICE.seed, sprites: (choice.standIns ? 'standins' : 'art') as 'standins' | 'art', frame: 'slice' as FrameKind };
  const lab: StageLab = {
    game,
    renderer,
    data,
    haveArt,
    sprites: () => choice,
    scene: () => scene,
    current: () => ({ ...made, tick: scene?.frame ?? 0 }),
    async show(opts = {}) {
      const frame = opts.frame ?? 'slice';
      // The seed of the frame's own stage unless the test asks for another (the floor's puddles and reflections follow it).
      const seed = opts.seed ?? (frame === 'sewer' || frame === 'boss' ? SLICE.extra[frame].seed : SLICE.seed);
      const kind = opts.sprites ?? made.sprites;
      if (kind === 'art' && !haveArt) throw new Error("Mark's sheets are not on this machine, so the 'art' mode cannot be shown");
      // The old scene goes first: its objects are destroyed and the textures it showed are kept for the next one.
      scene?.close();
      scene = null;
      if ((kind === 'standins') !== choice.standIns) {
        choice = await chooseSprites(kind === 'standins');
        await loadStageAssets(game.textures, choice);
      }
      scene = new BattleStageScene(sliceInit(data, choice, seed, frame));
      void game.run(scene);
      made = { seed, sprites: kind, frame };
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
