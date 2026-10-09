/**
 * `window.__SJE__`: the dev and test hook of the engine lab. The design calls its big brother
 * `__SJ__` (docs/engine/interfaces.md section 14): "step n ticks with a fixed dt, then draw one frame;
 * read the pixels back; hash the frame". This one is for the new engine's render stack only, and lives
 * on the lab page, which is not part of the shipped game.
 *
 * Everything that compares pixels runs INSIDE the page, so a test does not have to ship half a megabyte
 * of pixels through Playwright for every check.
 */
import { Ticker } from 'pixi.js';
import { H, ImageObject, type Pixels, W } from '../sje';
import type { Lab } from './lab';
import type { GlCounts } from './glcounter';
import { type BlockStats, countBlocks, fingerprint, toBase64, words } from './pixeltools';
import { type PixiCanaries, pixiCanaries } from './pixilab';
import { type ProfileOptions, type ProfileResult, profileLoop } from './profile';
import type { ThreeLab } from './threelab';

export interface Timing {
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface SjeHook extends PixiCanaries {
  ready: true;
  /** The loop's tick counter. */
  tick(): number;
  info(): { renderer: string; version: string; k: number; dpr: number; w: number; h: number };
  /** Where the picture is in the canvas, and the canvas's size, both in device pixels. */
  picture(): { x: number; y: number; w: number; h: number; k: number; canvasW: number; canvasH: number };
  /** Run `n` ticks with no real time passing, draw one frame, return the hash of the back buffer. */
  step(n: number): string;
  /** Draw one frame now (no tick). */
  render(): void;
  /** The hash of the back buffer as it is now. */
  hash(): string;
  /** The whole back buffer: RGBA bytes, top row first, as base64. */
  pixels(): { w: number; h: number; base64: string };
  /** One back buffer pixel as [r, g, b, a]. */
  pixel(x: number, y: number): number[];
  /** Count the k-by-k blocks of the CANVAS (what the player sees) that are not one flat color. */
  canvasBlocks(): BlockStats;
  /** The same count, for a picture the test took of the page (a Playwright screenshot as a data URL). `region` is the canvas's place in it, in device pixels. */
  imageBlocks(dataUrl: string, k: number, region?: { x: number; y: number; w: number; h: number }): Promise<BlockStats>;
  /** Time `n` ticks and `n` draws one after the other, in ms of JavaScript. (A draw only SUBMITS work to the GPU: its GPU time is not in this number.) */
  timing(n: number): { tick: Timing; draw: Timing };
  glCounts(): GlCounts;
  /** Enter and leave a fresh lab scene `n` times. */
  reenter(n: number): void;
  /** A negative control for the leak check: makes `n` textures and never frees them. */
  leakOnPurpose(n: number): void;
  contextLost(): boolean;
  /** Lose the context on purpose; resolves one macrotask after the browser has told the page (the lost event). */
  loseContext(): Promise<void>;
  /** Give it back; resolves one macrotask after the restored event. Only valid after loseContext() resolved. */
  restoreContext(): Promise<void>;
  /** Every GL error flag set right now (clears them). */
  glErrors(): number[];
  /** Is Pixi's own ticker (the second requestAnimationFrame loop) running? It must never be. */
  pixiTickerRunning(): boolean;
  /** Is Pixi's texture garbage collector on? It must be off. */
  pixiGcEnabled(): boolean;
  /**
   * Free-run the real loop for `frames` animation frames: the frame intervals, the JavaScript time of the engine's work in each, and (by
   * option) the cost including the wait for the GPU, and the GPU's own timer. See src/sje-lab/profile.ts. The page must run the loop (no `?manual`).
   */
  profileLoop(frames: number, options?: ProfileOptions): Promise<ProfileResult>;
  /** The 3D part of the lab (loads the 3D chunk, and Three, on first use). */
  three(): Promise<ThreeLab>;
}

declare global {
  interface Window {
    __SJE__?: SjeHook;
  }
}

/** Mean, median, p95 and max of a list of times. */
export function stats(xs: number[]): Timing {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

export function installHook(lab: Lab): SjeHook {
  const { renderer } = lab;
  const gl = renderer.glc.gl;
  let threeLab: Promise<ThreeLab> | null = null;
  const backBuffer = (): Pixels => renderer.readBackBuffer();

  const hook: SjeHook = {
    ready: true,
    tick: () => lab.tick,
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
      lab.step(n);
      return fingerprint(words(backBuffer()));
    },
    render: () => lab.draw(),
    hash: () => fingerprint(words(backBuffer())),
    pixels() {
      const p = backBuffer();
      return { w: p.w, h: p.h, base64: toBase64(p) };
    },
    pixel(x, y) {
      const p = backBuffer();
      const i = (y * p.w + x) * 4;
      return [p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0, p.data[i + 3] ?? 0];
    },
    canvasBlocks() {
      // Draw and read in the same task: a WebGL canvas is only valid until the browser paints it.
      lab.draw();
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
    timing(n) {
      const ticks: number[] = [];
      const draws: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        lab.advanceTick();
        const t1 = performance.now();
        lab.draw();
        draws.push(performance.now() - t1);
        ticks.push(t1 - t0);
      }
      return { tick: stats(ticks), draw: stats(draws) };
    },
    glCounts: () => lab.counts(),
    reenter: (n) => lab.reenter(n),
    leakOnPurpose(n) {
      // Make textures and drop the scene without ever removing them: the textures stay on the GPU.
      for (let i = 0; i < n; i++) {
        const key = `leak-${lab.host.textures.getTextureKeys().length}-${i}`;
        const made = lab.host.textures.createCanvas(key, 8, 8);
        made.ctx.fillStyle = `rgb(${(i * 7) % 256},0,0)`;
        made.ctx.fillRect(0, 0, 8, 8);
        made.refresh();
        // Showing it once makes Pixi upload it (a texture reaches the GPU when it is first drawn).
        const shown = new ImageObject(lab.host, 0, 0, key);
        lab.content.root.add(shown);
        lab.draw();
        shown.destroy();
        // ...and the key is never removed from the TextureManager: that is the leak.
      }
    },
    contextLost: () => renderer.glc.lost,
    loseContext: () => lab.loseContext(),
    restoreContext: () => lab.restoreContext(),
    glErrors: () => renderer.handoff.drainErrors(),
    pixiTickerRunning: () => Ticker.system.started,
    pixiGcEnabled: () => renderer.pixi.renderer.gc.enabled,
    profileLoop: (frames, options) => profileLoop(lab, gl, () => void renderer.handoff.readDefaultFramebuffer(0, 0, 1, 1), frames, options),
    three() {
      // The 3D part loads on first use, as the real game will load it (the lazy boundary).
      threeLab ??= import('./threelab').then((m) => m.createThreeLab(lab));
      return threeLab;
    },
    ...pixiCanaries(lab),
  };
  return hook;
}
