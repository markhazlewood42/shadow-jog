/**
 * Starting the Phaser stage (spike `spike/phaser-stage`): everything that has to happen before the scene can
 * draw, as one function any entry page can call. The lab page (`lab.ts`) uses it today; an editor page
 * would use the same call and add its panels, without dragging the lab's test hook along (`labhook.ts`).
 *
 *  1. Load the game's traced rig data (the enemies' art generators read it).
 *  2. Fetch the Sprite Fusion sheet descriptions (or fall back to stand-ins) and check the stage config.
 *  3. Create the Phaser game: 480x270 like the real game, pixel-art settings (no smoothing, whole-pixel
 *     placement), and a zoom that makes every game pixel a WHOLE number of the monitor's own pixels.
 *  4. Add the scene and start it.
 */
import Phaser from 'phaser';
import { BG_IDS } from '../art/battlebg';
import { loadRigData } from '../art/rig2/data';
import { type AxesFile, loadHud, loadStages, SCREEN_H, SCREEN_W, type StageFile, stageOf } from './config';
import type { Phase } from './demo';
import { FrameStats } from './metrics';
import { StageScene, type StageInit } from './stagescene';
import { CREW_IDS } from './crew';
import { STAGE_KNOWN } from './known';
import { fetchSheetMetas, standInMetas, type SheetMeta } from './textures';
import { cssZoom, devicePixelsPerGamePixel } from './zoom';

export interface BootOptions {
  /** Id of the element Phaser puts its canvas in (it must have a size). */
  parent: string;
  /** Which stage in `stages.json` to show. */
  stageId: string;
  /** Which enemy group to start with ("1" to "6", "boss", "boss+1", "boss+2"). */
  setKey?: string;
  /** Which moment of the example turn to start on. */
  phase?: Phase;
  /**
   * The stages to use instead of the shipped files (already checked and resolved against the global HUD by
   * `loadStages`). The editor passes what it fetched from the dev server, so a saved change shows after a reload.
   * When absent the shipped `stages.json` and `hud.json` are imported here, on demand: a page that supplies its own
   * never has those files in its module graph, so saving them does not make Vite reload the page.
   */
  stages?: StageFile;
  /** Foot-anchor corrections per sprite (`src/data/axes.json`). */
  axes?: AxesFile;
  /** The page's query string: `?standins` skips Mark's sheets on purpose, `?renderer=canvas` forces Phaser's 2D renderer. */
  query: URLSearchParams;
  /** Called with a readable message when something fails. */
  onError: (message: string) => void;
}

export interface Booted {
  game: Phaser.Game;
  scene: StageScene;
  init: StageInit;
  stats: FrameStats;
  /** True when the crew are code-drawn stand-ins because Mark's folder is missing. */
  standIns: boolean;
  /** Device pixels per game pixel right now (a whole number: 2 on a 960x540 window at 100%, also 2 on a 1200x675 window at 125%). */
  devicePixelsPerPixel: () => number;
}

/** The CSS length for a margin of about `ideal` device pixels, moved down to the nearest whole device pixel count that is also a whole number of 1/64 CSS pixels. */
function exactOffset(ideal: number, dpr: number): number {
  for (let d = Math.max(0, ideal); d >= Math.max(0, ideal - 32); d--) {
    const units = (d / dpr) * 64;
    if (Math.abs(units - Math.round(units)) < 1e-6) return d / dpr;
  }
  return Math.max(0, ideal) / dpr; // a ratio with no exact offset nearby: the plain whole-device-pixel one
}

/**
 * Centre the canvas in its parent with margins that are a whole number of DEVICE pixels. Phaser's own
 * `autoCenter` rounds in CSS pixels, which on a 125% display can leave the canvas half a device pixel off,
 * and a canvas that does not start on a device pixel boundary is resampled (blurred). The margins are written
 * in CSS pixels (device pixels divided by the ratio), so the canvas's edges land on the monitor's pixels.
 *
 * The browser lays things out in 1/64 of a CSS pixel. An offset that is not a whole number of those (say 67
 * device pixels at a ratio of 1.25 = 53.6 CSS pixels) is stored rounded, and Playwright's Chromium (build
 * 1234) then draws the canvas's outer row of game pixels half-blended with the page behind it. So the offset
 * is nudged down by a few device pixels to the nearest one that IS exact (`exactOffset`): off-centre by at
 * most a handful of device pixels, which nobody can see, and the picture is exact.
 *
 * Known limit: the canvas SIZE is k * 480 device pixels = k * 480 / ratio CSS pixels, and when that is not a
 * whole number of 1/64 CSS pixels (true for ratios such as 1.75 or 2.25, not for 1.25, 1.5, 2 or 2.5) it
 * cannot be made exact, and the outer row and column of game pixels can come out one device pixel off.
 * Measured in `e2e/stagelab-dpr.spec.ts`; still far better than an uneven zoom.
 */
function centreOnDevicePixels(game: Phaser.Game, k: number, dpr: number): void {
  const { width, height } = game.scale.parentSize;
  const left = exactOffset(Math.floor((width * dpr - SCREEN_W * k) / 2), dpr);
  const top = exactOffset(Math.floor((height * dpr - SCREEN_H * k) / 2), dpr);
  game.canvas.style.marginLeft = `${left}px`;
  game.canvas.style.marginTop = `${top}px`;
  // Phaser's input maths reads the canvas's position; tell it about the margin we just changed.
  game.scale.updateBounds();
}

/**
 * Make the canvas show every game pixel as a whole number of DEVICE pixels, and keep it so as the window,
 * the browser zoom or the monitor changes. (See `zoom.ts` for why CSS pixels are not enough.)
 */
function keepZoomWhole(game: Phaser.Game): () => number {
  let k = 1;
  const refit = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = game.scale.parentSize;
    k = devicePixelsPerGamePixel(width, height, SCREEN_W, SCREEN_H, dpr);
    const zoom = cssZoom(k, dpr);
    // Only when it changed: `setZoom` fires the resize event again, which would call us forever.
    if (Math.abs(zoom - game.scale.zoom) > 1e-9) game.scale.setZoom(zoom);
    centreOnDevicePixels(game, k, dpr);
  };
  game.scale.on(Phaser.Scale.Events.RESIZE, refit);
  // Moving the window to a monitor with another scaling changes the pixel ratio without changing the size: ask the browser to tell us.
  const watchRatio = (): void => {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        game.scale.refresh();
        refit();
        watchRatio();
      },
      { once: true },
    );
  };
  watchRatio();
  // Phaser boots at once when the page is already loaded (our case), else on DOMContentLoaded.
  if (game.isBooted) refit();
  else game.events.once(Phaser.Core.Events.READY, refit);
  return () => k;
}

/** True once a page has given `bootStage` its own stage file (the editor): such a page manages the file itself and must not be reloaded when the file changes. */
let managesOwnStages = false;

// The editor saves src/data/stages.json and src/data/hud.json while its page is open. Vite would answer a change to a
// file in the page's module graph with a full page reload (losing the undo history), and it counts the dynamic imports
// below. Accepting the change here stops that; the plain lab page, which does show the shipped files, still reloads.
import.meta.hot?.accept(['../data/stages.json', '../data/hud.json'], () => {
  if (!managesOwnStages) location.reload();
});

export async function bootStage(opts: BootOptions): Promise<Booted> {
  await loadRigData();
  managesOwnStages = !!opts.stages;
  const stages = opts.stages ?? loadStages((await import('../data/stages.json')).default, BG_IDS, STAGE_KNOWN, loadHud((await import('../data/hud.json')).default));
  // A wrong ?stage= should be one readable message naming the stages there are, not a scene that never starts.
  stageOf(stages, opts.stageId);

  // Mark's sheets live in a git-ignored folder; on a machine without it (CI) show stand-in figures, and say so.
  let standIns = false;
  let metas: Record<string, SheetMeta>;
  try {
    if (opts.query.has('standins')) throw new Error('asked for with ?standins');
    metas = await fetchSheetMetas(CREW_IDS);
  } catch (e) {
    standIns = true;
    metas = standInMetas(CREW_IDS);
    console.warn(`Mark's Sprite Fusion sheets are not available, so the crew are stand-in blocks: ${e instanceof Error ? e.message : String(e)}`);
  }

  const forceCanvas = opts.query.get('renderer') === 'canvas';
  const stats = new FrameStats();
  const scene = new StageScene();
  const game = new Phaser.Game({
    type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
    parent: opts.parent,
    backgroundColor: '#07060d',
    // pixelArt: NEAREST sampling for everything, no smoothing, sprites placed on whole pixels.
    pixelArt: true,
    scale: {
      width: SCREEN_W,
      height: SCREEN_H,
      // NONE + zoom: the canvas stays 480x270 and the browser enlarges it. `keepZoomWhole` sets the zoom once the parent's size is known.
      mode: Phaser.Scale.NONE,
      zoom: 1,
      // Centring is done by hand in whole device pixels (`centreOnDevicePixels`), so Phaser's own is off.
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    audio: { noAudio: true },
    banner: false,
  });
  const devicePixelsPerPixel = keepZoomWhole(game);

  const init: StageInit = { stages, stageId: opts.stageId, ...(opts.setKey ? { setKey: opts.setKey } : {}), ...(opts.phase ? { phase: opts.phase } : {}), metas, standIns, onError: opts.onError, ...(opts.axes ? { axes: opts.axes } : {}) };
  // `scene.add(key, scene, autoStart, data)`: add it and start it at once, handing it `init`.
  game.scene.add('stage', scene, true, init);
  return { game, scene, init, stats, standIns, devicePixelsPerPixel };
}
