/**
 * `window.__SJESTAGE__`: the dev and test hook of the stage lab (/sjestage.html), like `__SJE__` for the engine lab and `__stagelab` for the
 * Phaser spike's page. A test sets the tick, the seed and the sprite mode (`show`), then reads the back buffer as raw RGBA (`pixels`) or as
 * a hash (`hash`). Everything that compares pictures with each other runs in the test (Node): the references come from a different page.
 */
import { H, type Pixels, Scene, W } from '../sje';
import type { FigureParts } from '../battlestage/figure';
import type { GlCounts } from './glcounter';
import { readGlCounts } from './glcounter';
import { type BlockStats, countBlocks, fingerprint, toBase64, toPng, words } from './pixeltools';
import { type ProfileOptions, type ProfileResult, profileLoop } from './profile';
import type { ShowOptions, StageLab } from './stagelab';

export interface FigureFacts extends FigureParts {
  id: string;
  side: string;
}

export interface StageHook {
  ready: true;
  info(): { renderer: string; version: string; k: number; dpr: number; w: number; h: number; haveArt: boolean; sprites: string; seed: number };
  /** Make a fresh scene for these options, run `tick` ticks and draw one frame. Resolves with the hash of the back buffer. */
  show(opts?: ShowOptions): Promise<string>;
  /** The scene's own tick counter (ticks since it started). */
  tick(): number;
  /** Run `n` more ticks, draw one frame and return the hash. */
  step(n: number): string;
  /** Draw one frame now (no tick). */
  render(): void;
  /** The hash of the back buffer as it is now. */
  hash(): string;
  /** The whole back buffer: RGBA bytes, top row first, as base64 (about 0.7 MB). */
  pixels(): { w: number; h: number; base64: string };
  /** The back buffer as a PNG data URL, scaled up by whole numbers. */
  png(scale?: number): string;
  /** Where the 480x270 picture sits in the canvas, and the canvas's size, both in device pixels. */
  picture(): { x: number; y: number; w: number; h: number; k: number; canvasW: number; canvasH: number };
  /** Count the k-by-k blocks of the CANVAS (what the player sees) that are not one flat colour. */
  canvasBlocks(): BlockStats;
  /** The same count for a picture the test took of the page (a Playwright screenshot as a data URL). `region` is the canvas's place in it, in device pixels. */
  imageBlocks(dataUrl: string, k: number, region?: { x: number; y: number; w: number; h: number }): Promise<BlockStats>;
  /** What the figures look like to the display list: depth, feet, parts. Party first, then enemies. */
  figures(): FigureFacts[];
  /** The names of the stage's top-level objects in the order they draw (the backdrop first, then the figures by depth). */
  drawOrder(): string[];
  /** The names of the children of a figure in the order they draw (shadow, ring, body). */
  partOrder(figureId: string): string[];
  /** Make `n` fresh scenes of the same slice, one after the other, closing each (the leak check). */
  reenter(n: number): Promise<void>;
  glCounts(): GlCounts;
  /** A negative control for the leak check: makes `n` textures, shows them for one frame and never frees them. */
  leakOnPurpose(n: number): void;
  /** How many texels of a texture's canvas are not fully opaque, and where (the stage picture should be opaque; a translucent texel blends over the clear colour). */
  translucency(key: string): { w: number; h: number; translucent: number; box: { x0: number; y0: number; x1: number; y1: number } | null };
  /** The names of the textures the game holds (a restart must not grow this list). */
  textureKeys(): string[];
  /**
   * The inked part of a figure's body picture (step B3: how tall the figure is, in game pixels): the frame it shows now, the box of
   * its non-transparent texels inside that frame, and the box's height and width. The picture is drawn at scale 1, so these are screen game pixels.
   */
  inkBox(figureId: string): { texture: string; frame: string | number | null; cellW: number; cellH: number; ink: { x0: number; y0: number; x1: number; y1: number }; inkW: number; inkH: number };
  /** Time `n` ticks and `n` draws, in ms of JavaScript, one after the other. (A draw only SUBMITS work to the GPU.) */
  timing(n: number): { tick: Timing; draw: Timing };
  /** The real loop's frame cost over `frames` animation frames (see `profile.ts`). */
  profileLoop(frames: number, options?: ProfileOptions): Promise<ProfileResult>;
  contextLost(): boolean;
  /** Lose the context on purpose; resolves when the browser has told the page. */
  loseContext(): Promise<void>;
  /** Give it back; resolves when the restored event fires. */
  restoreContext(): Promise<void>;
}

export interface Timing {
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

declare global {
  interface Window {
    __SJESTAGE__?: StageHook;
  }
}

const stats = (xs: number[]): Timing => {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
};

export function installStageHook(lab: StageLab): StageHook {
  const { game, renderer } = lab;
  const gl = renderer.glc.gl;
  const backBuffer = (): Pixels => renderer.readBackBuffer();
  const sceneOf = () => {
    const s = lab.scene();
    if (!s) throw new Error('no stage scene is running');
    return s;
  };

  const hook: StageHook = {
    ready: true,
    info() {
      // Firefox deprecates WEBGL_debug_renderer_info (and logs a warning for each use): it gets the generic name.
      const ext = /firefox/i.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
      const cur = lab.current();
      return {
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        version: String(gl.getParameter(gl.VERSION)),
        k: renderer.presenter.k,
        dpr: window.devicePixelRatio,
        w: W,
        h: H,
        haveArt: lab.haveArt,
        sprites: cur.sprites,
        seed: cur.seed,
      };
    },
    async show(opts) {
      await lab.show(opts);
      return fingerprint(words(backBuffer()));
    },
    tick: () => sceneOf().frame,
    step(n) {
      game.step(n);
      return fingerprint(words(backBuffer()));
    },
    render: () => game.draw(),
    hash: () => fingerprint(words(backBuffer())),
    pixels() {
      const p = backBuffer();
      return { w: p.w, h: p.h, base64: toBase64(p) };
    },
    png: (scale = 1) => toPng(backBuffer(), scale),
    picture() {
      const p = renderer.picture;
      const c = renderer.presenter.canvasSize;
      return { x: p.x, y: p.y, w: p.w, h: p.h, k: p.k, canvasW: c.w, canvasH: c.h };
    },
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
    figures() {
      return sceneOf().figures.map((f) => ({ id: f.id, side: f.side, ...f.describe() }));
    },
    drawOrder() {
      return sceneOf()
        .sys.world.drawOrder()
        .map((o) => o.name);
    },
    partOrder(figureId) {
      const group = sceneOf().figureGroup(figureId);
      return group.drawOrder().map((o) => o.getData<string>('part') ?? o.name);
    },
    async reenter(n) {
      const cur = lab.current();
      for (let i = 0; i < n; i++) await lab.show({ seed: cur.seed, sprites: cur.sprites, tick: 2 });
    },
    glCounts: () => readGlCounts(),
    leakOnPurpose(n) {
      class Leaky extends Scene<void> {
        override create(): void {
          for (let i = 0; i < n; i++) {
            const c = document.createElement('canvas');
            c.width = 8;
            c.height = 8;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.fillStyle = `rgb(${(i * 7) % 256},0,0)`;
              ctx.fillRect(0, 0, 8, 8);
            }
            const key = `leak-${game.textures.getTextureKeys().length}-${i}`;
            game.textures.addCanvas(key, c);
            this.add.image(0, 0, key);
          }
        }
        fixedUpdate(): void {}
      }
      const scene = new Leaky();
      void game.run(scene);
      game.draw();
      // The scene goes, the textures stay: nothing frees them. That is the leak.
      scene.close();
    },
    textureKeys: () => game.textures.getTextureKeys(),
    inkBox(figureId) {
      const fig = sceneOf().figures.find((f) => f.id === figureId);
      if (!fig) throw new Error(`no figure "${figureId}"`);
      const body = fig.describe().body;
      const tex = game.textures.get(body.texture);
      const canvas = tex.data.canvas;
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`texture "${body.texture}" has no canvas`);
      // A texture with named frames shows one cell of its canvas; one without shows the whole canvas.
      // (Frame names are text: `addFrames` makes its keys with Object.entries, so a numeric frame is looked up as text.)
      const cell = body.frame === undefined ? undefined : (tex.frames.get(body.frame) ?? tex.frames.get(String(body.frame)));
      const cx = cell?.x ?? 0;
      const cy = cell?.y ?? 0;
      const cw = cell?.w ?? canvas.width;
      const ch = cell?.h ?? canvas.height;
      const c = canvas.getContext('2d', { willReadFrequently: true });
      if (!c) throw new Error('no 2D context');
      const img = c.getImageData(cx, cy, cw, ch).data;
      const ink = { x0: cw, y0: ch, x1: -1, y1: -1 };
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          if ((img[(y * cw + x) * 4 + 3] ?? 0) === 0) continue;
          ink.x0 = Math.min(ink.x0, x);
          ink.y0 = Math.min(ink.y0, y);
          ink.x1 = Math.max(ink.x1, x);
          ink.y1 = Math.max(ink.y1, y);
        }
      }
      return { texture: body.texture, frame: body.frame ?? null, cellW: cw, cellH: ch, ink, inkW: ink.x1 - ink.x0 + 1, inkH: ink.y1 - ink.y0 + 1 };
    },
    translucency(key) {
      const canvas = game.textures.get(key).data.canvas;
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`texture "${key}" has no canvas`);
      const c = canvas.getContext('2d', { willReadFrequently: true });
      if (!c) throw new Error('no 2D context');
      const img = c.getImageData(0, 0, canvas.width, canvas.height).data;
      let translucent = 0;
      const box = { x0: canvas.width, y0: canvas.height, x1: -1, y1: -1 };
      for (let i = 3; i < img.length; i += 4) {
        if (img[i] === 255) continue;
        translucent++;
        const p = (i - 3) / 4;
        const x = p % canvas.width;
        const y = Math.floor(p / canvas.width);
        box.x0 = Math.min(box.x0, x);
        box.y0 = Math.min(box.y0, y);
        box.x1 = Math.max(box.x1, x);
        box.y1 = Math.max(box.y1, y);
      }
      return { w: canvas.width, h: canvas.height, translucent, box: translucent ? box : null };
    },
    timing(n) {
      const ticks: number[] = [];
      const draws: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        game.advanceTick();
        const t1 = performance.now();
        game.draw();
        const t2 = performance.now();
        ticks.push(t1 - t0);
        draws.push(t2 - t1);
      }
      return { tick: stats(ticks), draw: stats(draws) };
    },
    profileLoop: (frames, options) =>
      profileLoop(
        game,
        gl,
        // The negative control draws the whole frame again this many extra times (see ProfileOptions.extraRenders).
        () => renderer.render(game.screen),
        () => void renderer.handoff.readDefaultFramebuffer(0, 0, 1, 1),
        frames,
        options,
      ),
    contextLost: () => game.contextLost,
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
  };
  return hook;
}
