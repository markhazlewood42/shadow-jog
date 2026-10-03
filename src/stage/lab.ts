/**
 * The Phaser stage lab's entry point (spike `spike/phaser-stage`; page: `/stagelab.html`, DEV only).
 *
 * It starts a Phaser 4 game next to the game's own engine and shows the battle stage in it. This file does
 * the set-up that has to happen before Phaser can draw anything and then hands over to `StageScene`:
 *
 *  1. Load the game's traced rig data (the enemies' art generators read it).
 *  2. Fetch the Sprite Fusion sheet descriptions and check the stage config.
 *  3. Create the Phaser game: 480x270 like the real game, pixel-art settings (no smoothing, whole-pixel
 *     placement), and a Scale Manager that shows the canvas at the biggest WHOLE-number zoom that fits the
 *     window (2x, 3x, ...). A fractional zoom would make some source pixels wider than others, which is
 *     the shimmer pixel art must not have.
 *
 * `window.__stagelab` is the test hook (like the game's `window.__SJ__`): the Playwright spec reads it.
 */
import Phaser from 'phaser';
import { BG_IDS } from '../art/battlebg';
import { loadRigData } from '../art/rig2/data';
import stagesJson from '../data/stages.json';
import { loadStages, SCREEN_H, SCREEN_W } from './config';
import { FrameStats, type FrameSummary } from './metrics';
import { StageScene, type StageInit } from './stagescene';
import { fetchSheetMetas, isCrisp, standInMetas, type SheetMeta } from './textures';

/** The fight shown today: two Rustfang punks and a glowrat. */
const FIGHT = ['rustfang_punk', 'glowrat', 'rustfang_punk'];

export interface StageLabHook {
  ready: boolean;
  error: string | null;
  /** True when the crew are code-drawn stand-ins because Mark's Sprite Fusion folder is missing. */
  standIns: boolean;
  /** 'WEBGL' or 'CANVAS': which Phaser renderer ended up running. */
  renderer: string;
  zoom: number;
  /** Milliseconds from the start of the page load to the first frame drawn. */
  firstFrameMs: number;
  stats: () => FrameSummary;
  resetStats: () => void;
  /** Whether every texture the stage uses is set to NEAREST sampling. */
  crisp: () => boolean;
  /** How many textures Phaser holds (to check nothing leaks across a restart). */
  textureCount: () => number;
  /** Copies the next drawn frame into a 2D canvas and describes it: how many different colours it has and what share is the most common one. */
  snapshot: () => Promise<{ colours: number; topShare: number; width: number; height: number }>;
  scene: () => StageScene | null;
  /** Restart the scene (as an edit mode's "reload" would); resolves once the new run has drawn a frame. */
  restart: () => Promise<void>;
  game: Phaser.Game | null;
}

declare global {
  interface Window {
    __stagelab?: StageLabHook;
  }
}

const statusEl = document.getElementById('status');

function show(message: string, bad = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = bad ? 'bad' : '';
  statusEl.style.display = message ? 'block' : 'none';
}

const hook: StageLabHook = {
  ready: false,
  error: null,
  standIns: false,
  renderer: '',
  zoom: 0,
  firstFrameMs: 0,
  stats: () => ({ frames: 0, intervalP50: 0, intervalP95: 0, workP50: 0, workP95: 0 }),
  resetStats: () => {},
  crisp: () => false,
  textureCount: () => 0,
  snapshot: () => Promise.reject(new Error('not started')),
  scene: () => null,
  restart: () => Promise.reject(new Error('not started')),
  game: null,
};
window.__stagelab = hook;

function fail(message: string): void {
  hook.error = message;
  show(message, true);
  console.error(message);
}

async function main(): Promise<void> {
  show('Loading the stage…');
  await loadRigData();
  // Mark's sheets live in a git-ignored folder; on a machine without it (CI) show stand-in figures, and say so.
  let standIns = false;
  let metas: Record<string, SheetMeta>;
  try {
    // `?standins` skips Mark's folder on purpose (to test the fallback on a machine that has it).
    if (new URLSearchParams(location.search).has('standins')) throw new Error('asked for with ?standins');
    metas = await fetchSheetMetas();
  } catch (e) {
    standIns = true;
    metas = standInMetas();
    hook.standIns = true;
    console.warn(`Mark's Sprite Fusion sheets are not available, so the crew are stand-in blocks: ${e instanceof Error ? e.message : String(e)}`);
  }
  const stages = loadStages(stagesJson, BG_IDS);

  // `?renderer=canvas` forces Phaser's 2D-canvas renderer (for checking the fallback a machine without WebGL would get).
  const forceCanvas = new URLSearchParams(location.search).get('renderer') === 'canvas';
  const stats = new FrameStats();
  const scene = new StageScene();

  const game = new Phaser.Game({
    type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
    parent: 'stage',
    backgroundColor: '#07060d',
    // pixelArt: NEAREST sampling for everything, no smoothing, sprites placed on whole pixels.
    pixelArt: true,
    scale: {
      width: SCREEN_W,
      height: SCREEN_H,
      // NONE + zoom: the canvas stays 480x270 and the browser enlarges it by a whole number (MAX_ZOOM picks the biggest that fits).
      mode: Phaser.Scale.NONE,
      zoom: Phaser.Scale.MAX_ZOOM,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    audio: { noAudio: true },
    banner: false,
  });
  hook.game = game;
  hook.renderer = game.renderer.type === Phaser.WEBGL ? 'WEBGL' : 'CANVAS';

  // Keep the zoom a whole number as the window changes: MAX_ZOOM is worked out once at start, so redo it on every resize.
  const fitZoom = (): void => {
    const best = game.scale.getMaxZoom();
    if (best !== game.scale.zoom) game.scale.setZoom(best);
    hook.zoom = game.scale.zoom;
  };
  game.scale.on(Phaser.Scale.Events.RESIZE, fitZoom);
  hook.zoom = game.scale.zoom;

  // Timing: the interval between frames and the CPU work inside each.
  game.events.on(Phaser.Core.Events.PRE_STEP, (time: number) => stats.begin(time));
  let first = true;
  game.events.on(Phaser.Core.Events.POST_RENDER, () => {
    stats.end();
    if (first && scene.frame > 0) {
      first = false;
      hook.firstFrameMs = performance.now();
      hook.ready = true;
      show(hook.standIns ? "Mark's Sprite Fusion sheets are not on this machine: the crew are stand-in blocks." : '');
    }
  });

  hook.stats = () => stats.summary();
  hook.resetStats = () => stats.reset();
  hook.textureCount = () => game.textures.getTextureKeys().length;
  hook.scene = () => scene;
  hook.crisp = () => game.textures.getTextureKeys().filter((k) => !k.startsWith('__')).every((k) => isCrisp(game.textures, k));
  hook.snapshot = () =>
    new Promise((resolve, reject) => {
      // A WebGL canvas can only be copied in the same moment it is drawn, so wait for the next POST_RENDER.
      game.events.once(Phaser.Core.Events.POST_RENDER, () => {
        try {
          const c = document.createElement('canvas');
          c.width = game.canvas.width;
          c.height = game.canvas.height;
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) throw new Error('no 2d canvas');
          g.drawImage(game.canvas, 0, 0);
          const px = g.getImageData(0, 0, c.width, c.height).data;
          const counts = new Map<number, number>();
          for (let i = 0; i < px.length; i += 4) {
            const k = ((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
          resolve({ colours: counts.size, topShare: Math.max(...counts.values()) / (c.width * c.height), width: c.width, height: c.height });
        } catch (e) {
          reject(e);
        }
      });
    });

  const init: StageInit = { stages, stageId: 'street', metas, enemies: FIGHT, standIns, onError: fail };
  // `scene.add(key, scene, autoStart, data)`: add it and start it at once, handing it `init`.
  game.scene.add('stage', scene, true, init);
  hook.restart = () =>
    new Promise((resolve) => {
      scene.scene.restart(init);
      const wait = (): void => {
        if (scene.frame > 0 && scene.fighters.length > 0) resolve();
        else game.events.once(Phaser.Core.Events.POST_RENDER, wait);
      };
      game.events.once(Phaser.Core.Events.POST_RENDER, wait);
    });
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
