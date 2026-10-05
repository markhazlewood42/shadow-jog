/**
 * `window.__SJE__`: the dev and test hook of the engine lab. The design calls its big brother
 * `__SJ__` (docs/engine/interfaces.md section 14): "step n ticks with a fixed dt, then draw one
 * frame; read the pixels back; hash the frame". This one is for the new engine only, and lives on
 * the lab page, which is not part of the shipped game.
 *
 * Everything that compares pixels runs INSIDE the page, so a test does not have to ship half a
 * megabyte of pixels through Playwright for every check.
 */
import { H, type Pixels, RenderLayerProbe, Scene, W } from '../sje';
import type { HackScene } from '../hack3d';
import { loadChunk } from '../hack3d/door';
import { describeResult, type HackDef, type HackResult } from '../hack3d/result';
import type { Frame3D } from '../sje/three';
import type { LabContent } from './content';
import type { GlCounts } from './glcounter';
import type { Lab } from './lab';
import { captionFor, HUD_FIXED } from '../hack3d/hud';
import { drawText, measure } from '../engine/font';
import { drawReference, referenceScroll } from './reference';
import { type CanaryResult, type EffectCaseOptions, type EffectCaseResult, type EffectName, type EffectTarget, type PartAEnv, runCanary, runEffectCase } from './parta';
import { type MirrorRow, type RenderLayerResult, runMirrorMatrix, runRenderLayerCase } from './partaextra';
import type { StoryLogEntry } from './story';

export interface PixelDiff {
  /** Pixels compared. */
  total: number;
  /** Pixels where any of R, G or B differs. */
  differing: number;
  /** `differing` as a percentage of `total`. */
  pct: number;
  /** The largest difference in any one of R, G, B (0 to 255). */
  maxDiff: number;
  /** Pixels that differ by more than 1, 2 and 3 in some channel. */
  over1: number;
  over2: number;
  over3: number;
  /** Up to 8 differing pixels, to look at. */
  samples: Array<{ x: number; y: number; sje: number[]; ref: number[] }>;
}

export interface Timing {
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface BlockStats {
  /** The zoom the canvas is at (whole device pixels per game pixel). */
  k: number;
  /** The canvas size in device pixels. */
  canvasW: number;
  canvasH: number;
  /** How many k-by-k blocks there are, and how many are NOT one flat colour. */
  blocks: number;
  bad: number;
  samples: Array<{ x: number; y: number }>;
}

/** A hack's definition with every field optional: the hook fills in the rest. */
export type HackDefInput = Partial<HackDef>;

export interface StoryState {
  log: StoryLogEntry[];
  done: boolean;
  outcome: { outcome: 'success' | 'fail'; via: string; results: string[] } | null;
  /** The raw result of the last try through the door, with the ms (since the story started) it arrived. */
  lastResult: { status: string; reason: string | null; ms: number } | null;
}

export interface FrameFacts {
  mode: string;
  width: number;
  height: number;
  minFilter: string;
  magFilter: string;
  rewraps: number;
  hosts: { shared: number; private: number };
  contextLost: boolean;
}

export interface SjeHook {
  ready: true;
  /** The game's tick counter. */
  tick(): number;
  info(): { renderer: string; version: string; k: number; dpr: number; w: number; h: number };
  /** Where the 480x270 picture sits in the canvas, and the canvas's size, both in device pixels. */
  picture(): { x: number; y: number; w: number; h: number; k: number; canvasW: number; canvasH: number };
  /** Run `n` ticks with no real time passing, draw one frame, return the hash of the back buffer. */
  step(n: number): string;
  /** Draw one frame now (no tick). */
  render(): void;
  /** The hash of the back buffer as it is now. */
  hash(): string;
  /** The hash of a rectangle of the back buffer, in game pixels. */
  regionHash(x: number, y: number, w: number, h: number): string;
  /** The whole back buffer: RGBA bytes, top row first, as base64 (about 0.7 MB). For tests that need the raw pixels. */
  pixels(): { w: number; h: number; base64: string };
  /** One back buffer pixel as [r, g, b, a]. */
  pixel(x: number, y: number): number[];
  /** Where the lab put things (screen pixels), so a test can look at the right place. */
  layout(): LabContent['layout'];
  /** The camera scroll the engine is at, and the scroll the reference expects. */
  scroll(): { camera: number; expected: number };
  /** Count the k-by-k blocks of the CANVAS (what the player sees) that are not one flat colour. */
  canvasBlocks(): BlockStats;
  /** The same count, for a picture the test took of the page (a Playwright screenshot as a data URL). `region` is the canvas's place in it, in device pixels. */
  imageBlocks(dataUrl: string, k: number, region?: { x: number; y: number; w: number; h: number }): Promise<BlockStats>;
  /** Compare the back buffer to the Canvas 2D reference of the same content at this tick. */
  parity(region?: { x: number; y: number; w: number; h: number }): PixelDiff;
  /** A picture, as a PNG data URL, scaled up by whole numbers: the engine, the reference, a diff, or the canvas itself. */
  png(which: 'sje' | 'ref' | 'diff' | 'canvas', scale?: number): string;
  /** Move the probe sprite (the snap-to-pixel test). */
  setProbe(x: number, y: number): void;
  /** Enter and leave a fresh lab scene `n` times. */
  reenter(n: number): void;
  /** Time `n` ticks and `n` draws one after the other, in ms of JavaScript. (A draw only SUBMITS work to the GPU: its GPU time is not in this number.) */
  timing(n: number): { tick: Timing; draw: Timing };
  glCounts(): GlCounts;
  /** A negative control for the leak check: makes `n` textures and never frees them. */
  leakOnPurpose(n: number): void;
  contextLost(): boolean;
  /** Lose the context on purpose; resolves when the browser has told the page (the lost event). */
  loseContext(): Promise<void>;
  /** Give it back; resolves when the restored event fires. Only valid after loseContext() resolved. */
  restoreContext(): Promise<void>;

  /**
   * Lose the PRIVATE context of the canvas-copy fallback on purpose (the engine's own context stays up). Resolves one macrotask
   * after the browser's lost event. Only for `?frame=canvas-copy` with a hack running.
   */
  losePrivateContext(): Promise<void>;
  /** Give the private context back; resolves one macrotask after the restored event. Only valid after `losePrivateContext()`. */
  restorePrivateContext(): Promise<void>;

  // ---- the 3D path (step B2) ---------------------------------------------------------------------
  /** Which Frame3D the lab was asked for (`?frame=`). */
  frameMode(): string;
  /** Start the story script (a line, a hack with its policy, a line). Returns at once. Tick the game (`step`) or let the real loop run. */
  storyStart(def?: HackDefInput, holdTicks?: number): void;
  story(): StoryState;
  /** Start ONE hack through the door, with no story around it. Returns at once. */
  hackStart(def?: HackDefInput): void;
  /** The result of the hack started by `hackStart`, or null while it runs. */
  hackResult(): { status: string; reason: string | null; ms: number } | null;
  /** The class names of the scenes on the stack, bottom first. */
  scenes(): string[];
  /** Facts about the 3D frame of the hack that is running, or null. */
  frame(): FrameFacts | null;
  /** The 3D picture itself, before Pixi touches it: RGBA, top row first, as base64. */
  framePixels(): { w: number; h: number; base64: string } | null;
  /** The hash of the 3D picture. */
  frameHash(): string | null;
  /** The running hack's simulation numbers. */
  sim(): { tick: number; trace: number; hits: number; status: string; ice: number } | null;
  /** TEST ONLY: switch the end-of-Three clean up of GlHandoff on or off (the canary's negative control). */
  handoffFix(on: boolean): void;
  /** Every GL error flag set right now (clears them). */
  glErrors(): number[];
  /** Run `n` ticks and draws, each draw ended by `gl.finish()`, so the time includes the GPU's own work. */
  timingGpu(n: number): { ms: Timing };
  // ---- Part A: effects on the 3D view and on a sorted container (src/sje-lab/parta.ts) -------------
  /** Leave the 2D HUD out of the hacks the lab starts from now on (the effect cases compare plain pictures). */
  hackHud(on: boolean): void;
  /** One effect case against its CPU reference. The 3D view cases need a running hack. */
  effectCase(effect: EffectName, target: EffectTarget, options?: EffectCaseOptions): EffectCaseResult;
  /**
   * Draw a flat 3D scene whose left half is the Three BACKGROUND colour `background` and whose right half is an unlit
   * material colour `plane` (both 0xRRGGBB), and read the colours back: from the 3D picture and from the screen.
   * Proves a colour written in Three reaches the picture unchanged (colour management is off, and no OutputPass).
   */
  colourProbe(background: number, plane: number): Promise<{ target: { left: number[]; right: number[] }; screen: { left: number[]; right: number[] } }>;
  /**
   * Watch the next `frames` frames the real loop draws (the page must be running the loop: no `?manual`). After each
   * draw it reads the back buffer and records the scene on top and how much of the picture is ONE colour. A blank or
   * half-drawn frame (flicker on entering or leaving a scene) would be almost all one colour.
   */
  flickerWatch(frames: number): Promise<Array<{ top: string; dominant: number }>>;
  /** Drop every scene without resolving it (`game.abandon()`). A hack that is dropped still resolves (aborted / user). */
  abandon(): void;
  /**
   * The HUD's fixed parts (the NODE panel and the bottom caption strip) against Canvas 2D drawing the same
   * panels and text, over the running 3D picture. 0 differing means the 2D HUD is exact. Needs a running hack with its HUD.
   */
  hudParity(): { node: PixelDiff; caption: PixelDiff; nodeColours: number };
  /** Enter and leave the 3D scene `n` times (each a hack of 3 ticks, run through the real door), and give the results. Waits for each. */
  hackCycles(n: number): Promise<string[]>;
  /** (iii) Pixi RenderLayer with filters. */
  renderLayerCase(): RenderLayerResult;
  /** (iv) roundPixels with a negative scale: widths x origins x ways to mirror, against Canvas 2D. */
  mirrorMatrix(): MirrorRow[];
  /** The stale clear-colour canary. Needs a running hack. `fixOn: false` is the negative control. */
  canary(fixOn: boolean, transparentBackBuffer?: boolean): CanaryResult;
  /** Free-run the real loop for `frames` animation frames: the frame intervals, and the JavaScript time of the engine's work in each. */
  profileLoop(frames: number): Promise<{ intervals: number[]; work: number[] }>;
}

declare global {
  interface Window {
    __SJE__?: SjeHook;
  }
}

/** A 53-bit string hash (cyrb53) over 32-bit words. Not secure: just a fast fingerprint of a frame. */
function fingerprint(words: Uint32Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? 0;
    h1 = Math.imul(h1 ^ w, 2654435761);
    h2 = Math.imul(h2 ^ w, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Count the k-by-k blocks of an image that are not one flat colour. */
function countBlocks(px: Pixels, k: number): BlockStats {
  const all = new Uint32Array(px.data.buffer, px.data.byteOffset, px.w * px.h);
  const stats: BlockStats = { k, canvasW: px.w, canvasH: px.h, blocks: 0, bad: 0, samples: [] };
  for (let by = 0; by < Math.floor(px.h / k); by++) {
    for (let bx = 0; bx < Math.floor(px.w / k); bx++) {
      stats.blocks++;
      const first = all[by * k * px.w + bx * k];
      let flat = true;
      for (let dy = 0; dy < k && flat; dy++) {
        const row = (by * k + dy) * px.w + bx * k;
        for (let dx = 0; dx < k; dx++) {
          if (all[row + dx] !== first) {
            flat = false;
            break;
          }
        }
      }
      if (!flat) {
        stats.bad++;
        if (stats.samples.length < 8) stats.samples.push({ x: bx, y: by });
      }
    }
  }
  return stats;
}

const words = (p: Pixels): Uint32Array => new Uint32Array(p.data.buffer, p.data.byteOffset, p.w * p.h);

export function installHook(lab: Lab): SjeHook {
  const { game, renderer } = lab;
  const gl = renderer.glc.gl;
  const ref = document.createElement('canvas');
  ref.width = W;
  ref.height = H;
  const refCtx = ref.getContext('2d', { willReadFrequently: true });
  if (!refCtx) throw new Error('the lab needs a 2D canvas for the CPU reference');

  /** The reference picture for the current tick. */
  const reference = (): Pixels => {
    drawReference(refCtx, lab.content, game.tick);
    const img = refCtx.getImageData(0, 0, W, H);
    return { w: W, h: H, data: new Uint8Array(img.data.buffer) };
  };
  const backBuffer = (): Pixels => renderer.readBackBuffer();

  const toPng = (p: Pixels, scale: number): string => {
    const small = document.createElement('canvas');
    small.width = p.w;
    small.height = p.h;
    small.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.w, p.h), 0, 0);
    const big = document.createElement('canvas');
    big.width = p.w * scale;
    big.height = p.h * scale;
    const c = big.getContext('2d');
    if (!c) throw new Error('no 2D context');
    c.imageSmoothingEnabled = false;
    c.drawImage(small, 0, 0, big.width, big.height);
    return big.toDataURL('image/png');
  };

  const diff = (a: Pixels, b: Pixels, region?: { x: number; y: number; w: number; h: number }): { stats: PixelDiff; map: Pixels } => {
    const r = region ?? { x: 0, y: 0, w: a.w, h: a.h };
    const map: Pixels = { w: a.w, h: a.h, data: new Uint8Array(a.data.length) };
    const stats: PixelDiff = { total: r.w * r.h, differing: 0, pct: 0, maxDiff: 0, over1: 0, over2: 0, over3: 0, samples: [] };
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * a.w + x) * 4;
        const d = Math.max(Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)), Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)), Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)));
        // The diff picture: the reference dimmed, with every differing pixel in hot pink.
        if (d > 0) {
          map.data.set([255, 0, 96, 255], i);
          stats.differing++;
          stats.maxDiff = Math.max(stats.maxDiff, d);
          if (d > 1) stats.over1++;
          if (d > 2) stats.over2++;
          if (d > 3) stats.over3++;
          if (stats.samples.length < 8) stats.samples.push({ x, y, sje: [a.data[i] ?? 0, a.data[i + 1] ?? 0, a.data[i + 2] ?? 0], ref: [b.data[i] ?? 0, b.data[i + 1] ?? 0, b.data[i + 2] ?? 0] });
        } else {
          map.data.set([(b.data[i] ?? 0) >> 2, (b.data[i + 1] ?? 0) >> 2, (b.data[i + 2] ?? 0) >> 2, 255], i);
        }
      }
    }
    stats.pct = (stats.differing / stats.total) * 100;
    return { stats, map };
  };

  const regionHash = (p: Pixels, x: number, y: number, w: number, h: number): string => {
    const all = words(p);
    const out = new Uint32Array(w * h);
    for (let row = 0; row < h; row++) out.set(all.subarray((y + row) * p.w + x, (y + row) * p.w + x + w), row * w);
    return fingerprint(out);
  };

  // ---- 3D and story state ----
  // The private context's loss extension and canvas, kept from `losePrivateContext` for `restorePrivateContext`.
  let privateLoseExt: WEBGL_lose_context | null = null;
  let privateCanvas: HTMLCanvasElement | null = null;
  let hackRun: { result: HackResult; ms: number } | null = null;
  let storyDone = false;
  const defOf = (input: HackDefInput | undefined): HackDef => ({ id: 'lab-hack', seed: 7, ticks: 900, iceCount: 4, traceLimit: 100, hitCost: 14, ...input });
  const topHack = (): HackScene | null => {
    const top = game.top as unknown as Partial<HackScene> | undefined;
    return top && 'sim' in top && 'frame3d' in top ? (top as HackScene) : null;
  };
  const frameOf = (): Frame3D | null => {
    const t = topHack();
    return t?.hasFrame ? t.frame3d : null;
  };
  /** What Part A needs from the lab. */
  const partAEnv = (): PartAEnv => ({
    draw: () => game.draw(),
    backBuffer: () => backBuffer(),
    framePixels: () => frameOf()?.readPixels() ?? null,
    hackScene() {
      const t = topHack();
      return t?.hasFrame ? { view: t.frame3d.sprite, add: t.add, sys: t.sys } : null;
    },
    run: (s) => void game.run(s),
    close: (s) => s.close(),
    blocks() {
      const k = renderer.presenter.k;
      const c = countBlocks(renderer.presenter.readCanvas(), k);
      return { k, blocks: c.blocks, bad: c.bad };
    },
    glErrors: () => renderer.handoff.drainErrors(),
    textures: {
      createCanvas: (key, w, h) => game.textures.createCanvas(key, w, h),
      addCanvasReplacing(key, canvas) {
        if (game.textures.exists(key)) game.textures.remove(key);
        game.textures.addCanvas(key, canvas);
      },
      remove: (key) => game.textures.remove(key),
    },
  });
  const stats = (xs: number[]): Timing => {
    const sorted = [...xs].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
  };

  const hook: SjeHook = {
    ready: true,
    tick: () => game.tick,
    info() {
      // Firefox deprecates WEBGL_debug_renderer_info (and logs a warning for each use): it gets the generic name.
      const ext = /firefox/i.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        version: String(gl.getParameter(gl.VERSION)),
        k: renderer.presenter.k,
        dpr: window.devicePixelRatio,
        w: W,
        h: H,
      };
    },
    picture() {
      const p = renderer.picture;
      const c = renderer.presenter.canvasSize;
      return { x: p.x, y: p.y, w: p.w, h: p.h, k: p.k, canvasW: c.w, canvasH: c.h };
    },
    step(n) {
      game.step(n);
      return fingerprint(words(backBuffer()));
    },
    render: () => game.draw(),
    hash: () => fingerprint(words(backBuffer())),
    regionHash: (x, y, w, h) => regionHash(backBuffer(), x, y, w, h),
    pixels() {
      const p = backBuffer();
      let bin = '';
      for (let i = 0; i < p.data.length; i += 0x8000) bin += String.fromCharCode(...p.data.subarray(i, i + 0x8000));
      return { w: p.w, h: p.h, base64: btoa(bin) };
    },
    pixel(x, y) {
      const p = backBuffer();
      const i = (y * p.w + x) * 4;
      return [p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0, p.data[i + 3] ?? 0];
    },
    layout: () => lab.content.layout,
    scroll: () => ({ camera: lab.scene.cameras.main.scrollX, expected: referenceScroll(lab.content, game.tick) }),
    canvasBlocks() {
      // Draw and read in the same task: a WebGL canvas is only valid until the browser paints it.
      game.draw();
      return countBlocks(renderer.presenter.readCanvas(), renderer.presenter.k);
    },
    async imageBlocks(dataUrl, k, region) {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2D context');
      ctx.drawImage(bitmap, 0, 0);
      const r = region ?? { x: 0, y: 0, w: c.width, h: c.height };
      const img = ctx.getImageData(r.x, r.y, r.w, r.h);
      return countBlocks({ w: r.w, h: r.h, data: new Uint8Array(img.data.buffer) }, k);
    },
    parity(region) {
      game.draw();
      return diff(backBuffer(), reference(), region).stats;
    },
    png(which, scale = 2) {
      game.draw();
      if (which === 'canvas') return toPng(renderer.presenter.readCanvas(), 1);
      if (which === 'sje') return toPng(backBuffer(), scale);
      if (which === 'ref') return toPng(reference(), scale);
      return toPng(diff(backBuffer(), reference()).map, scale);
    },
    setProbe: (x, y) => lab.scene.setProbe(x, y),
    reenter: (n) => lab.reenter(n),
    timing(n) {
      const stats = (xs: number[]): Timing => {
        const s = [...xs].sort((a, b) => a - b);
        const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
        return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 };
      };
      const ticks: number[] = [];
      const draws: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        game.advanceTick();
        const t1 = performance.now();
        game.draw();
        draws.push(performance.now() - t1);
        ticks.push(t1 - t0);
      }
      return { tick: stats(ticks), draw: stats(draws) };
    },
    glCounts: () => lab.counts(),
    leakOnPurpose(n) {
      class Leaky extends Scene<void> {
        override create(): void {
          for (let i = 0; i < n; i++) {
            const c = document.createElement('canvas');
            c.width = 8;
            c.height = 8;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.fillStyle = `rgb(${i * 7 % 256},0,0)`;
              ctx.fillRect(0, 0, 8, 8);
            }
            const key = `leak-${game.textures.getTextureKeys().length}-${i}`;
            game.textures.addCanvas(key, c);
            this.add.image(0, 0, key);
          }
        }
        fixedUpdate(): void {}
      }
      const s = new Leaky();
      void game.run(s);
      game.step(1); // the textures reach the GPU when they are first drawn
      s.close(); // the scene goes, but its textures are never removed: that is the leak
    },
    contextLost: () => renderer.glc.lost,
    // Resolve one macrotask AFTER the event: the browser calls every listener of `webglcontextlost` (ours, Pixi's,
    // Three's) in turn, and a promise continuation would run between them. Restoring before the last one has run is
    // refused ("restoreContext: context restoration not allowed"), and the Three and Pixi handlers would run late.
    loseContext: () =>
      new Promise<void>((resolve) => {
        const done = (): void => {
          renderer.glc.off('lost', done);
          setTimeout(resolve, 0);
        };
        renderer.glc.on('lost', done);
        renderer.glc.forceLoss();
      }),
    restoreContext: () =>
      new Promise<void>((resolve) => {
        const done = (): void => {
          renderer.glc.off('restored', done);
          setTimeout(resolve, 0);
        };
        renderer.glc.on('restored', done);
        renderer.glc.forceRestore();
      }),

    losePrivateContext: () =>
      new Promise<void>((resolve) => {
        const gl2 = frameOf()?.privateContext();
        if (!gl2) throw new Error('losePrivateContext: no private context (use ?frame=canvas-copy with a hack running)');
        // The extension must be fetched BEFORE the loss: a lost context answers null.
        privateLoseExt = gl2.getExtension('WEBGL_lose_context');
        const canvas = gl2.canvas as HTMLCanvasElement;
        privateCanvas = canvas;
        const done = (): void => {
          canvas.removeEventListener('webglcontextlost', done);
          setTimeout(resolve, 0);
        };
        canvas.addEventListener('webglcontextlost', done);
        privateLoseExt?.loseContext();
      }),
    restorePrivateContext: () =>
      new Promise<void>((resolve) => {
        const canvas = privateCanvas;
        if (!privateLoseExt || !canvas) throw new Error('restorePrivateContext: call losePrivateContext first');
        const done = (): void => {
          canvas.removeEventListener('webglcontextrestored', done);
          setTimeout(resolve, 0);
        };
        canvas.addEventListener('webglcontextrestored', done);
        privateLoseExt.restoreContext();
      }),

    frameMode: () => lab.frameMode,
    storyStart(def, holdTicks) {
      storyDone = false;
      void lab.story.run(defOf(def), holdTicks).then(() => {
        storyDone = true;
      });
    },
    story() {
      const o = lab.story.outcome;
      const r = lab.story.lastResult;
      return {
        log: [...lab.story.log],
        done: storyDone,
        outcome: o ? { outcome: o.outcome, via: o.via, results: o.results.map(describeResult) } : null,
        lastResult: r ? { status: r.result.status, reason: 'reason' in r.result ? r.result.reason : null, ms: r.ms } : null,
      };
    },
    hackStart(def) {
      hackRun = null;
      const t0 = performance.now();
      void lab.story.hack(defOf(def)).then((result) => {
        hackRun = { result, ms: Math.round(performance.now() - t0) };
      });
    },
    hackResult: () => (hackRun ? { status: hackRun.result.status, reason: 'reason' in hackRun.result ? hackRun.result.reason : null, ms: hackRun.ms } : null),
    scenes: () => game.scene.scenes.map((s) => s.constructor.name),
    frame() {
      const f = frameOf();
      return f ? { ...f.describe(), contextLost: f.contextLost } : null;
    },
    framePixels() {
      const f = frameOf();
      if (!f) return null;
      const p = f.readPixels();
      let bin = '';
      for (let i = 0; i < p.data.length; i += 0x8000) bin += String.fromCharCode(...p.data.subarray(i, i + 0x8000));
      return { w: p.w, h: p.h, base64: btoa(bin) };
    },
    frameHash() {
      const f = frameOf();
      return f ? fingerprint(words(f.readPixels())) : null;
    },
    sim() {
      const t = topHack();
      return t ? { tick: t.sim.tick, trace: t.sim.tracePercent, hits: t.sim.hits, status: t.sim.status, ice: t.sim.ice.length } : null;
    },
    handoffFix: (on) => renderer.handoff.setClearColourFix(on),
    abandon: () => game.abandon(),
    flickerWatch(frames) {
      return new Promise((resolve) => {
        const out: Array<{ top: string; dominant: number }> = [];
        const onFrame = (): void => {
          const p = backBuffer();
          const counts = new Map<number, number>();
          let best = 0;
          for (const w of words(p)) {
            const n = (counts.get(w) ?? 0) + 1;
            counts.set(w, n);
            if (n > best) best = n;
          }
          const names = game.scene.scenes;
          out.push({ top: names[names.length - 1]?.constructor.name ?? '', dominant: best / (p.w * p.h) });
          if (out.length >= frames) {
            game.events.off('postrender', onFrame);
            resolve(out);
          }
        };
        game.events.on('postrender', onFrame);
      });
    },
    async colourProbe(background, plane) {
      const chunk = await loadChunk();
      const scene = new chunk.ColourProbeScene(background, plane, { frameMode: lab.frameMode });
      void game.run(scene);
      try {
        game.draw();
        const rt = scene.frame3d.readPixels();
        const bb = backBuffer();
        const at = (p: Pixels, x: number, y: number): number[] => {
          const i = (y * p.w + x) * 4;
          return [p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0];
        };
        // Left half is x 0 to 239, right half x 240 to 479; the middle row, away from the seam.
        return { target: { left: at(rt, 100, 135), right: at(rt, 380, 135) }, screen: { left: at(bb, 100, 135), right: at(bb, 380, 135) } };
      } finally {
        scene.close();
      }
    },
    hudParity() {
      game.draw();
      const gpu = backBuffer();
      const make = (region: { x: number; y: number; w: number; h: number }, paint: (ctx: CanvasRenderingContext2D) => void): PixelDiff => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2D context');
        ctx.imageSmoothingEnabled = false;
        paint(ctx);
        const img = ctx.getImageData(0, 0, W, H);
        return diff(gpu, { w: W, h: H, data: new Uint8Array(img.data.buffer) }, region).stats;
      };
      const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
      const f = HUD_FIXED;
      const node = make(f.node, (ctx) => {
        ctx.fillStyle = hex(f.edge);
        ctx.fillRect(f.node.x, f.node.y, f.node.w, f.node.h);
        ctx.fillStyle = hex(f.panel);
        ctx.fillRect(f.node.x + 1, f.node.y + 1, f.node.w - 2, f.node.h - 2);
        drawText(ctx, f.node.text, f.node.textX, f.node.textY, { color: f.node.textColor });
      });
      const title = captionFor((topHack()?.def.seed ?? 0) as number);
      const caption = make({ x: 0, y: f.caption.edgeY, w: W, h: f.caption.h + 1 }, (ctx) => {
        ctx.fillStyle = hex(f.edge);
        ctx.fillRect(0, f.caption.edgeY, W, 1);
        ctx.fillStyle = hex(f.panel);
        ctx.fillRect(0, f.caption.y, W, f.caption.h);
        drawText(ctx, title, Math.floor((W - measure(title)) / 2), f.caption.textY, { color: f.caption.textColor });
      });
      // How many different colours the NODE panel shows: its edge, its fill, its text and the text's shadow, and no more.
      const seen = new Set<number>();
      const words32 = words(gpu);
      for (let y = f.node.y; y < f.node.y + f.node.h; y++) for (let x = f.node.x; x < f.node.x + f.node.w; x++) seen.add(words32[y * W + x] ?? 0);
      return { node, caption, nodeColours: seen.size };
    },
    async hackCycles(n) {
      const out: string[] = [];
      const until = async (ok: () => boolean): Promise<void> => {
        for (let i = 0; i < 4000 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
        if (!ok()) throw new Error('timed out waiting in hackCycles');
      };
      for (let i = 0; i < n; i++) {
        hook.hackStart({ ticks: 3 });
        // The first entry loads the 3D chunk (async); later entries are quick. (On the real loop a 3-tick hack can be over
        // before this checks, so the result counts too.)
        await until(() => hackRun !== null || game.scene.scenes.some((sc) => sc.constructor.name === 'HackScene'));
        if (hackRun === null) game.step(5);
        await until(() => hackRun !== null);
        out.push(hackRun?.result.status ?? 'none');
      }
      return out;
    },
    hackHud(on) {
      lab.story.hackOptions = on ? {} : { hud: false };
    },
    effectCase: (effect, target, options) => runEffectCase(partAEnv(), effect, target, options),
    renderLayerCase: () => runRenderLayerCase(partAEnv(), (parent) => new RenderLayerProbe(parent)),
    mirrorMatrix: () => runMirrorMatrix(partAEnv()),
    canary: (fixOn, transparentBackBuffer = false) =>
      runCanary(
        partAEnv(),
        (on) => renderer.handoff.setClearColourFix(on),
        (on) => renderer.backBuffer.setClearColor(on ? [0, 0, 0, 0] : null),
        fixOn,
        transparentBackBuffer,
      ),
    glErrors: () => renderer.handoff.drainErrors(),
    timingGpu(n) {
      const ms: number[] = [];
      for (let i = 0; i < n; i++) {
        game.advanceTick();
        const t0 = performance.now();
        game.draw();
        gl.finish();
        ms.push(performance.now() - t0);
      }
      return { ms: stats(ms) };
    },
    profileLoop(frames) {
      return new Promise((resolve) => {
        const intervals: number[] = [];
        const work: number[] = [];
        // Wrap the two engine entry points the loop calls. A frame's work is the sum of its ticks and its draw.
        let acc = 0;
        const tick = game.advanceTick.bind(game);
        const draw = game.draw.bind(game);
        game.advanceTick = () => {
          const t = performance.now();
          tick();
          acc += performance.now() - t;
        };
        game.draw = (alpha?: number) => {
          const t = performance.now();
          draw(alpha);
          acc += performance.now() - t;
          work.push(acc);
          acc = 0;
        };
        let last = performance.now();
        const frame = (now: number): void => {
          intervals.push(now - last);
          last = now;
          if (intervals.length < frames) requestAnimationFrame(frame);
          else {
            game.advanceTick = tick;
            game.draw = draw;
            resolve({ intervals, work });
          }
        };
        requestAnimationFrame(frame);
      });
    },
  };
  return hook;
}
