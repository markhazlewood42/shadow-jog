/**
 * The editor's TEST HOOK: `window.__stagelab` (Phaser spike `spike/phaser-stage`; the name stays so the specs read the same way). The Playwright specs wait on it for the first
 * frame, read the stage scene through it, and read back the drawn picture. It lives in its own file so the editor's page file holds no test code.
 *
 * On the engine the picture is the back buffer: 640x360 game pixels, whatever the zoom, so `pixels` and `region` take game pixels directly (the spike read the zoomed canvas).
 */
import type { Game, GlRenderer } from '../../sje';
import type { StageHost } from './host';

export interface StageLabHook {
  ready: boolean;
  error: string | null;
  /** True when the crew are code-drawn stand-ins because Mark's Sprite Fusion folder is missing. */
  standIns: boolean;
  /** 'WEBGL': the engine has one renderer. */
  renderer: string;
  /** The picture's CSS zoom (device pixels per game pixel divided by the pixel ratio). */
  zoom: number;
  /** Whole device pixels per game pixel (what the monitor really shows). */
  devicePixelsPerPixel: number;
  /** Milliseconds from the start of the page load to the first frame drawn. */
  firstFrameMs: number;
  /** Whether the picture is drawn as crisp blocks: the canvas is shown 1:1 in device pixels (so the browser never resamples it) and the zoom is a whole number. */
  crisp: () => boolean;
  /** How many textures the engine holds (to check nothing leaks across a rebuild). */
  textureCount: () => number;
  /** The names of the textures the engine holds. */
  textureKeys: () => string[];
  /** The next drawn frame, described: how many different colours it has and what share is the most common one. */
  snapshot: () => Promise<{ colours: number; topShare: number; width: number; height: number }>;
  /** The colours (as #rrggbb) of these game pixels in the next drawn frame. */
  pixels: (points: ReadonlyArray<readonly [number, number]>) => Promise<string[]>;
  /** The colours of a rectangle of game pixels in the next drawn frame, row by row, as RGBA numbers (4 per pixel). */
  region: (x: number, y: number, w: number, h: number) => Promise<number[]>;
  /** The stage host: the scene that is running now (it changes when the axes, facing or heroes change), `fighters`, `config`, `enemies`, `pick`, `boxOf`. */
  scene: () => StageHost | null;
  /** Where the 640x360 picture is on the page, in CSS pixels, and how many CSS pixels one game pixel is. */
  picture: () => { x: number; y: number; w: number; h: number; scale: number };
  game: Game | null;
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
    crisp: () => false,
    textureCount: () => 0,
    textureKeys: () => [],
    snapshot: () => Promise.reject(new Error('not started')),
    pixels: () => Promise.reject(new Error('not started')),
    region: () => Promise.reject(new Error('not started')),
    scene: () => null,
    picture: () => ({ x: 0, y: 0, w: 0, h: 0, scale: 0 }),
    game: null,
  };
}

/**
 * Where the picture is on the page now, in CSS pixels. The canvas fills its parent in DEVICE pixels and the picture sits inside it at `layout` (device pixels, a whole zoom `k`),
 * so the picture is `layout / dpr` CSS pixels from the canvas's corner. (Not the ratio of the canvas's CSS box to its pixel size: on a 125% display the box is 923 CSS px for 1154
 * device pixels, which is not exactly 1.25, and the browser snaps the box to whole device pixels when it paints.)
 */
export function pictureRect(game: Game): { x: number; y: number; w: number; h: number; scale: number } {
  const canvas = (game.renderer as GlRenderer).glc.canvas;
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const l = game.scale.layout;
  return { x: r.left + l.x / dpr, y: r.top + l.y / dpr, w: l.w / dpr, h: l.h / dpr, scale: l.k / dpr };
}

/** Fill the hook in once the game exists. `onReady` is called when the first frame has been drawn. */
export function connectHook(hook: StageLabHook, game: Game, host: StageHost, standIns: boolean, onReady: () => void): void {
  hook.game = game;
  hook.standIns = standIns;
  hook.renderer = 'WEBGL';
  // The zoom is settled by the display's resize; read it live so the hook never shows a stale one.
  Object.defineProperty(hook, 'zoom', { get: () => game.scale.k / (window.devicePixelRatio || 1), configurable: true });
  Object.defineProperty(hook, 'devicePixelsPerPixel', { get: () => game.scale.k, configurable: true });
  hook.textureCount = () => game.textures.getTextureKeys().length;
  hook.textureKeys = () => game.textures.getTextureKeys();
  hook.scene = () => host;
  hook.picture = () => pictureRect(game);
  hook.crisp = () => {
    const canvas = (game.renderer as GlRenderer).glc.canvas;
    const r = canvas.getBoundingClientRect();
    // The canvas box is the canvas's own pixels shown 1:1 (within a pixel: a box the browser rounds), and the picture's zoom is a whole number.
    const oneToOne = Math.abs(r.width * (window.devicePixelRatio || 1) - canvas.width) <= 1 && Math.abs(r.height * (window.devicePixelRatio || 1) - canvas.height) <= 1;
    return oneToOne && Number.isInteger(game.scale.k);
  };
  const frame = (): { w: number; h: number; data: Uint8Array } => (game.renderer as GlRenderer).readBackBuffer();
  // The back buffer is read in the same call as it is wanted: it is the last frame the engine drew (the loop runs at 60 Hz).
  hook.snapshot = async () => {
    const { w, h, data } = frame();
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const k = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return { colours: counts.size, topShare: Math.max(...counts.values()) / (w * h), width: w, height: h };
  };
  const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(2, '0');
  hook.pixels = async (points) => {
    const { w, data } = frame();
    return points.map(([x, y]) => {
      const i = (y * w + x) * 4;
      return `#${hex(data[i])}${hex(data[i + 1])}${hex(data[i + 2])}`;
    });
  };
  hook.region = async (x, y, rw, rh) => {
    const { w, data } = frame();
    const out: number[] = [];
    for (let row = y; row < y + rh; row++) for (let col = x; col < x + rw; col++) for (let c = 0; c < 4; c++) out.push(data[(row * w + col) * 4 + c] ?? 0);
    return out;
  };
  // The first frame: the stage has ticked at least once and the engine has drawn.
  const off = game.events.on('postrender', () => {
    if (hook.ready || host.scene.frame === 0) return;
    hook.ready = true;
    hook.firstFrameMs = performance.now();
    onReady();
  });
  void off;
}
