/**
 * The Pixi side of the canary suite (docs/engine/tooling-and-testing.md section 8). Each canary is a trap
 * from the research that breaks quietly: nothing throws, the picture is just wrong. A canary reads pixels
 * or state and says whether the trap is sprung. Most have a NEGATIVE CONTROL beside them: the same check run
 * on a build that has the trap on purpose, which must fail. A test that cannot fail proves nothing.
 *
 * The lab may import `pixi.js` (it tests Pixi directly). The engine's own code never does, outside
 * src/sje/render and src/sje/display.
 *
 * Throwaway renderers. Several controls need a second Pixi renderer on a second context, with one
 * setting wrong. `makeProbe` builds one the way `PixiRenderer.create` does, with a switch for the setting.
 * A page may hold about 16 live contexts, so every probe is freed (its context lost on purpose) when done.
 */
import {
  Container as PixiContainer,
  Graphics as PixiGraphics,
  ImageSource,
  RenderTexture,
  Sprite as PixiSprite,
  Texture,
  Ticker,
  WebGLRenderer,
} from 'pixi.js';
import { colorMatrixEffect, Graphics, ImageObject, type Pixels, W } from '../sje';
import { PANEL, PANEL_COLOR, PANEL_MASK } from './content';
import type { Lab } from './lab';

/** What can go wrong with a probe renderer, one switch per trap. */
export interface ProbeOptions {
  /** Pass `canvas` to Pixi's init (the engine does). Without it Pixi listens for context loss on a canvas of its own. */
  canvas?: boolean;
  /** Ask the context for a stencil buffer (the engine does). */
  stencil?: boolean;
  /** Pixi's texture garbage collector (the engine turns it off). */
  gcActive?: boolean;
  /** Idle ms before the collector may unload a texture (only with `gcActive`). */
  gcMaxUnusedTime?: number;
  /** Idle ms between two collections (only with `gcActive`). */
  gcFrequency?: number;
  /** Skip Pixi's "load every extension" step (the engine does: `skipExtensionImports`). */
  skipExtensionImports?: boolean;
}

export interface Probe {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  renderer: WebGLRenderer;
  /** Lose the context on purpose and wait for the page to hear of it, plus one macrotask. */
  lose(): Promise<void>;
  /** Give it back and wait for the restored event, plus one macrotask. */
  restore(): Promise<void>;
  /** Free it: lose the context so the page does not keep a live one. Safe to call twice. */
  free(): void;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A Pixi renderer on a context of its own, set up like the engine's, with the traps switchable. */
export async function makeProbe(options: ProbeOptions = {}): Promise<Probe> {
  const o = { canvas: true, stencil: true, gcActive: false, skipExtensionImports: true, ...options };
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const gl = canvas.getContext('webgl2', { stencil: o.stencil, antialias: false, alpha: false, depth: false });
  if (!gl) throw new Error('makeProbe: no WebGL2');
  // The extension is fetched NOW: once the context is lost it answers null.
  const loseExt = gl.getExtension('WEBGL_lose_context');
  // preventDefault on the lost event is what allows the browser to restore the context later.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  const renderer = new WebGLRenderer();
  await renderer.init({
    context: gl,
    ...(o.canvas ? { canvas } : {}),
    width: 64,
    height: 64,
    resolution: 1,
    antialias: false,
    clearBeforeRender: false,
    roundPixels: false,
    skipExtensionImports: o.skipExtensionImports,
    gcActive: o.gcActive,
    ...(options.gcMaxUnusedTime !== undefined ? { gcMaxUnusedTime: options.gcMaxUnusedTime } : {}),
    ...(options.gcFrequency !== undefined ? { gcFrequency: options.gcFrequency } : {}),
  });
  // Pixi's scheduler starts its own requestAnimationFrame loop on `Ticker.system` when a renderer starts. Stop it, as the engine does
  // (PixiRenderer.create): a probe must not leave a second loop running in the page.
  Ticker.system.stop();
  let freed = false;
  return {
    canvas,
    gl,
    renderer,
    lose: () =>
      new Promise<void>((resolve) => {
        canvas.addEventListener('webglcontextlost', () => setTimeout(resolve, 0), { once: true });
        loseExt?.loseContext();
      }),
    restore: () =>
      new Promise<void>((resolve) => {
        canvas.addEventListener('webglcontextrestored', () => setTimeout(resolve, 0), { once: true });
        loseExt?.restoreContext();
      }),
    free() {
      if (freed) return;
      freed = true;
      if (!gl.isContextLost()) loseExt?.loseContext();
    },
  };
}

/** Draw a solid rectangle into a small render texture with `renderer`, and read its middle pixel. */
function drawAndRead(renderer: WebGLRenderer, color: number): number[] {
  const rt = RenderTexture.create({ width: 16, height: 16, resolution: 1 });
  const root = new PixiContainer();
  const g = new PixiGraphics();
  g.rect(0, 0, 16, 16).fill({ color });
  root.addChild(g);
  try {
    renderer.render({ container: root, target: rt, clear: true, clearColor: [0, 0, 0, 1] });
    const out = renderer.extract.pixels(rt);
    const i = (8 * 16 + 8) * 4;
    return [out.pixels[i] ?? 0, out.pixels[i + 1] ?? 0, out.pixels[i + 2] ?? 0, out.pixels[i + 3] ?? 0];
  } finally {
    g.destroy();
    root.destroy();
    rt.destroy(true);
  }
}

/** Count the pink pixels of a picture that fall inside and outside the rectangle `x, y, w, h`. */
function countPink(px: Uint8ClampedArray | Uint8Array, width: number, rect: { x: number; y: number; w: number; h: number }): { inside: number; outside: number } {
  let inside = 0;
  let outside = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] !== PANEL_COLOR >> 16 || px[i + 1] !== ((PANEL_COLOR >> 8) & 255) || px[i + 2] !== (PANEL_COLOR & 255)) continue;
    const p = i / 4;
    const x = p % width;
    const y = Math.floor(p / width);
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) inside++;
    else outside++;
  }
  return { inside, outside };
}

/**
 * A pink 40x40 panel masked to its middle 20x20, drawn by `renderer` straight onto its CANVAS (the default framebuffer),
 * and the pink pixels inside and outside the mask. A `Graphics` mask works through the stencil buffer, so a context with
 * no stencil lets the whole panel through.
 */
function maskedPanelOnCanvas(renderer: WebGLRenderer): { inside: number; outside: number } {
  const root = new PixiContainer();
  const fill = new PixiGraphics();
  fill.rect(0, 0, 40, 40).fill({ color: PANEL_COLOR });
  const mask = new PixiGraphics();
  mask.rect(10, 10, 20, 20).fill({ color: 0xffffff });
  root.addChild(fill, mask);
  fill.setMask({ mask, channel: 'alpha' });
  try {
    renderer.render({ container: root, clear: true, clearColor: [0, 0, 0, 1] });
    // Copy the canvas to a 2D canvas in the SAME task: a WebGL canvas is only valid until the browser paints the page.
    const view = renderer.canvas as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = view.width;
    copy.height = view.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2D context');
    ctx.drawImage(view, 0, 0);
    return countPink(ctx.getImageData(0, 0, copy.width, copy.height).data, copy.width, { x: 10, y: 10, w: 20, h: 20 });
  } finally {
    root.destroy({ children: true });
  }
}

export interface RecoverResult {
  /** The pixel before the loss, and after the restore. Both must be the color that was drawn. */
  before: number[];
  after: number[];
  /** Did the drawing after the restore throw? */
  threw: string | null;
  /** True when `after` equals `before`. */
  recovered: boolean;
}

export interface DestroyResult {
  /** True when `renderer.destroy()` on a throwaway renderer left its context lost: the trap is real in this Pixi. */
  contextLostAfterDestroy: boolean;
}

export interface GcResult {
  /** The collector's state on this renderer. */
  enabled: boolean;
  /** True when the idle texture was still on the GPU after the wait. */
  textureKept: boolean;
}

export interface StencilResult {
  /** Does the engine's own context have a stencil buffer? */
  engineHasStencil: boolean;
  /** The masked panel drawn on a probe canvas whose context was made with (or without) stencil. */
  canvas: { inside: number; outside: number };
  /** The lab's masked panel as the engine's back buffer shows it (only for the engine's own path). */
  backBuffer: { inside: number; outside: number } | null;
}

export interface ExtensionsResult {
  /** The pixel of a tile sprite, of a Graphics rectangle, of a masked panel (inside and outside the mask) and of a filtered rectangle. */
  sprite: number[];
  graphics: number[];
  maskInside: number[];
  maskOutside: number[];
  filter: number[];
}

export interface PixiCanaries {
  /** Canary "canvas on init": lose and restore a context, and see whether the renderer draws again. `withCanvas: false` is the control. */
  canaryCanvasInit(withCanvas: boolean): Promise<RecoverResult>;
  /** Canary "destroy kills the context". */
  canaryDestroy(): Promise<DestroyResult>;
  /** Canary "texture GC": an idle texture must stay on the GPU. `active: true` is the control (Pixi's collector on). */
  canaryGc(active: boolean): Promise<GcResult>;
  /** Canary "stencil mask". `stencil: false` is the control (a context made with no stencil buffer). */
  canaryStencil(stencil: boolean): Promise<StencilResult>;
  /** Canary "extension list", the half that draws: with the load-everything step skipped, a sprite, a Graphics, a mask and a filter still render. */
  canaryExtensions(): ExtensionsResult;
  /**
   * Canary "extension list", the half that downloads: make a throwaway renderer and list the URLs of Pixi's environment chunks that the page
   * fetched because of it. `skip: false` is the control (Pixi's default, which loads them).
   */
  canaryExtensionRequests(skip: boolean): Promise<string[]>;
  /** TEST ONLY: start or stop Pixi's own ticker (a second requestAnimationFrame loop). The control of canary "no second Pixi loop". */
  pixiTicker(on: boolean): void;
}

export function pixiCanaries(lab: Lab): PixiCanaries {
  const px = (p: Pixels, x: number, y: number): number[] => {
    const i = (y * p.w + x) * 4;
    return [p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0, p.data[i + 3] ?? 0];
  };
  return {
    async canaryCanvasInit(withCanvas) {
      const probe = await makeProbe({ canvas: withCanvas });
      try {
        const color = 0xff2080;
        const before = drawAndRead(probe.renderer, color);
        await probe.lose();
        await probe.restore();
        let after: number[] = [];
        let threw: string | null = null;
        try {
          after = drawAndRead(probe.renderer, color);
        } catch (e) {
          threw = e instanceof Error ? e.message : String(e);
        }
        return { before, after, threw, recovered: after.length === 4 && after.every((v, i) => v === before[i]) };
      } finally {
        probe.free();
      }
    },

    async canaryDestroy() {
      const probe = await makeProbe();
      probe.renderer.destroy();
      const lost = probe.gl.isContextLost();
      probe.free();
      return { contextLostAfterDestroy: lost };
    },

    async canaryGc(active) {
      const probe = await makeProbe({ gcActive: active, gcMaxUnusedTime: 50, gcFrequency: 20 });
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      // An ImageSource (a decoded picture, which is what the Loader will make in M1): Pixi switches the collector off for canvas
      // sources, so only this kind can be unloaded at all.
      const source = new ImageSource({ resource: await createImageBitmap(canvas), resolution: 1, scaleMode: 'nearest' });
      const texture = new Texture({ source });
      let unloaded = false;
      source.on('unload', () => {
        unloaded = true;
      });
      const rt = RenderTexture.create({ width: 16, height: 16, resolution: 1 });
      const showTexture = new PixiContainer();
      showTexture.addChild(new PixiSprite(texture));
      const other = new PixiContainer();
      const render = (c: PixiContainer): void => probe.renderer.render({ container: c, target: rt, clear: true });
      try {
        render(showTexture); // the texture reaches the GPU
        // Pixi's collector runs on the scheduler, which runs on Ticker.system. The engine stops that ticker, so the control starts it for the test.
        if (active) Ticker.system.start();
        // Leave it idle for much longer than `gcMaxUnusedTime`, drawing OTHER content, so the collector has every chance.
        for (let i = 0; i < 10; i++) {
          await wait(60);
          render(other);
        }
        return { enabled: probe.renderer.gc.enabled, textureKept: !unloaded };
      } finally {
        Ticker.system.stop();
        showTexture.destroy({ children: true });
        texture.destroy(true);
        rt.destroy(true);
        probe.free();
      }
    },

    async canaryStencil(stencil) {
      const probe = await makeProbe({ stencil });
      try {
        const canvas = maskedPanelOnCanvas(probe.renderer);
        let backBuffer: StencilResult['backBuffer'] = null;
        if (stencil) {
          // The engine's own path: the lab's masked panel, drawn into the 640x360 back buffer. The pink must be exactly the mask's rectangle.
          lab.draw();
          backBuffer = countPink(lab.renderer.readBackBuffer().data, W, PANEL_MASK);
        }
        return { engineHasStencil: lab.renderer.glc.gl.getContextAttributes()?.stencil === true, canvas, backBuffer };
      } finally {
        probe.free();
      }
    },

    canaryExtensions() {
      // Four things that need Pixi's extensions (the sprite pipe is core; Graphics, filters and masks are added by src/sje/render/extensions.ts).
      const host = lab.host;
      lab.draw();
      const made: Array<{ destroy(): void }> = [];
      const box = lab.screen.overlayRoot;
      try {
        const sprite = new ImageObject(host, 300, 300, 'lab/tiles', 0).setOrigin(0, 0);
        const rect = new Graphics(host);
        rect.fillStyle(0x12ab34).fillRect(330, 300, 8, 8);
        const swap = new Graphics(host);
        swap.fillStyle(0xff0000).fillRect(350, 300, 8, 8);
        // Swap red and blue: red in, blue out.
        const effect = colorMatrixEffect([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
        swap.filters.add(effect);
        made.push(sprite, rect, swap, { destroy: () => effect.destroy() });
        box.add([sprite, rect, swap]);
        lab.draw();
        const bb = lab.renderer.readBackBuffer();
        return {
          sprite: px(bb, 300, 300), // the tile's border color
          graphics: px(bb, 334, 304),
          maskInside: px(bb, PANEL_MASK.x + 4, PANEL_MASK.y + 4),
          maskOutside: px(bb, PANEL.x + 2, PANEL.y + 2),
          filter: px(bb, 354, 304),
        };
      } finally {
        for (const m of made.reverse()) m.destroy();
        lab.draw();
      }
    },

    async canaryExtensionRequests(skip) {
      const before = new Set(performance.getEntriesByType('resource').map((e) => e.name));
      const probe = await makeProbe({ skipExtensionImports: skip });
      probe.free();
      return performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => !before.has(u) && /browserAll|webworkerAll|accessibility|lib\/events/.test(u));
    },

    pixiTicker(on) {
      if (on) Ticker.system.start();
      else Ticker.system.stop();
    },
  };
}
