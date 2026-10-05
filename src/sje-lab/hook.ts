/**
 * `window.__SJE__`: the dev and test hook of the engine lab. The design calls its big brother
 * `__SJ__` (docs/engine/interfaces.md section 14): "step n ticks with a fixed dt, then draw one
 * frame; read the pixels back; hash the frame". This one is for the new engine only, and lives on
 * the lab page, which is not part of the shipped game.
 *
 * Everything that compares pixels runs INSIDE the page, so a test does not have to ship half a
 * megabyte of pixels through Playwright for every check.
 */
import { H, type Pixels, Scene, W } from '../sje';
import type { LabContent } from './content';
import type { GlCounts } from './glcounter';
import type { Lab } from './lab';
import { drawReference, referenceScroll } from './reference';

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

export interface SjeHook {
  ready: true;
  /** The game's tick counter. */
  tick(): number;
  info(): { renderer: string; version: string; k: number; dpr: number; w: number; h: number };
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

  const hook: SjeHook = {
    ready: true,
    tick: () => game.tick,
    info() {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        version: String(gl.getParameter(gl.VERSION)),
        k: renderer.presenter.k,
        dpr: window.devicePixelRatio,
        w: W,
        h: H,
      };
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
    loseContext: () =>
      new Promise<void>((resolve) => {
        renderer.glc.on('lost', () => resolve());
        renderer.glc.forceLoss();
      }),
    restoreContext: () =>
      new Promise<void>((resolve) => {
        renderer.glc.on('restored', () => resolve());
        renderer.glc.forceRestore();
      }),
  };
  return hook;
}
