/**
 * The stage lab's TEST HOOK (spike `spike/phaser-stage`): `window.__stagelab`, like the game's `window.__SJ__`.
 * The Playwright specs read it to wait for the first frame, take timings, copy the drawn canvas and restart
 * the scene. It lives in its own file so that an editor page can reuse `boot.ts` without carrying test code.
 */
import Phaser from 'phaser';
import type { Booted } from './boot';
import type { FrameSummary } from './metrics';
import type { StageScene } from './stagescene';
import { isCrisp } from './textures';

export interface StageLabHook {
  ready: boolean;
  error: string | null;
  /** True when the crew are code-drawn stand-ins because Mark's Sprite Fusion folder is missing. */
  standIns: boolean;
  /** 'WEBGL' or 'CANVAS': which Phaser renderer ended up running. */
  renderer: string;
  /** The canvas's CSS zoom (device pixels per game pixel divided by the pixel ratio). */
  zoom: number;
  /** Whole device pixels per game pixel (what the monitor really shows). */
  devicePixelsPerPixel: number;
  /** Milliseconds from the start of the page load to the first frame drawn. */
  firstFrameMs: number;
  stats: () => FrameSummary;
  resetStats: () => void;
  /** Whether every texture the stage uses is set to NEAREST sampling. */
  crisp: () => boolean;
  /** How many textures Phaser holds (to check nothing leaks across a restart). */
  textureCount: () => number;
  /** The names of the textures Phaser holds. */
  textureKeys: () => string[];
  /** Copies the next drawn frame into a 2D canvas and describes it: how many different colours it has and what share is the most common one. */
  snapshot: () => Promise<{ colours: number; topShare: number; width: number; height: number }>;
  /** The colours (as #rrggbb) of these game pixels in the next drawn frame. */
  pixels: (points: ReadonlyArray<readonly [number, number]>) => Promise<string[]>;
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

/** The hook before anything has started: every method says so instead of returning a made-up answer. */
export function emptyHook(): StageLabHook {
  return {
    ready: false,
    error: null,
    standIns: false,
    renderer: '',
    zoom: 0,
    devicePixelsPerPixel: 0,
    firstFrameMs: 0,
    stats: () => ({ frames: 0, intervalP50: 0, intervalP95: 0, workP50: 0, workP95: 0 }),
    resetStats: () => {},
    crisp: () => false,
    textureCount: () => 0,
    textureKeys: () => [],
    snapshot: () => Promise.reject(new Error('not started')),
    pixels: () => Promise.reject(new Error('not started')),
    scene: () => null,
    restart: () => Promise.reject(new Error('not started')),
    game: null,
  };
}

/** Fill the hook in once the game exists. `onReady` is called when the first frame has been drawn. */
export function connectHook(hook: StageLabHook, booted: Booted, onReady: () => void): void {
  const { game, scene, stats, init } = booted;
  hook.game = game;
  hook.standIns = booted.standIns;
  hook.renderer = game.renderer.type === Phaser.WEBGL ? 'WEBGL' : 'CANVAS';
  // The zoom is settled by the Scale Manager's resize events; read it live so the hook never shows a stale one.
  Object.defineProperty(hook, 'zoom', { get: () => game.scale.zoom, configurable: true });
  Object.defineProperty(hook, 'devicePixelsPerPixel', { get: () => booted.devicePixelsPerPixel(), configurable: true });

  // Timing: the interval between frames and the CPU work inside each.
  game.events.on(Phaser.Core.Events.PRE_STEP, (time: number) => stats.begin(time));
  let first = true;
  game.events.on(Phaser.Core.Events.POST_RENDER, () => {
    stats.end();
    if (first && scene.frame > 0) {
      first = false;
      hook.firstFrameMs = performance.now();
      hook.ready = true;
      onReady();
    }
  });

  hook.stats = () => stats.summary();
  hook.resetStats = () => stats.reset();
  hook.textureCount = () => game.textures.getTextureKeys().length;
  hook.textureKeys = () => game.textures.getTextureKeys();
  hook.scene = () => scene;
  hook.crisp = () => game.textures.getTextureKeys().filter((k) => !k.startsWith('__')).every((k) => isCrisp(game.textures, k));
  // A WebGL canvas can only be copied in the same moment it is drawn, so wait for the next POST_RENDER, then copy it into a 2D canvas.
  const nextFrame = (): Promise<{ width: number; height: number; px: Uint8ClampedArray }> =>
    new Promise((resolve, reject) => {
      game.events.once(Phaser.Core.Events.POST_RENDER, () => {
        try {
          const c = document.createElement('canvas');
          c.width = game.canvas.width;
          c.height = game.canvas.height;
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) throw new Error('no 2d canvas');
          g.drawImage(game.canvas, 0, 0);
          resolve({ width: c.width, height: c.height, px: g.getImageData(0, 0, c.width, c.height).data });
        } catch (e) {
          reject(e);
        }
      });
    });
  hook.snapshot = async () => {
    const { width, height, px } = await nextFrame();
    const counts = new Map<number, number>();
    for (let i = 0; i < px.length; i += 4) {
      const k = ((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return { colours: counts.size, topShare: Math.max(...counts.values()) / (width * height), width, height };
  };
  hook.pixels = async (points) => {
    const { width, px } = await nextFrame();
    const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(2, '0');
    return points.map(([x, y]) => {
      const i = (y * width + x) * 4;
      return `#${hex(px[i])}${hex(px[i + 1])}${hex(px[i + 2])}`;
    });
  };
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
