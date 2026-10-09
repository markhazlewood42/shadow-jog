/**
 * The DEV hook of the real game on the new engine (docs/engine/interfaces.md section 14, m1-brief.md task 13).
 *
 * `src/main.ts` runs `?engine=sje` through `src/sje/boot.ts`, which loads THIS file only in a DEV build (`import.meta.env.DEV`; the
 * shipped build removes that branch, and `e2e/prod.spec.ts` checks that `window.__SJ__` is absent). The game's own boot has already put
 * its members on `window.__SJ__` (game, top, state, tp, battle, field, idle, ... and `display`, which here is the adapter over `game.scale`).
 * This file adds the engine's:
 *
 *   hooks.onTick(fn) / hooks.onFrame(fn)   after the scenes update / in the draw phase. Return an unsubscribe function.
 *   tree()                                 JSON of the Pixi node tree: label, type, x, y, depth, visible, texture key, filter count
 *   step(n)                                n ticks with no real time passing, then one frame
 *   frameHash()                            a fingerprint of the back buffer
 *   pixels(rect?)                          the back buffer (or a part), RGBA bytes, top row first
 *   canvasPixels()                         what the player sees: the picture read out of the canvas, no bars
 *   glCounts()                             live GL objects (texture, buffer, program, vao, framebuffer, ...)
 *   renderer                               { name, fxLevel, contextLost }
 *   fxCounts()                             the effects now: { level, active, shocks, hazes, glitches, particles } (`sj.fx` is the game's fx.json data)
 *   setFxLevel(level)                      `auto`, `full`, `lite` or `none`, at once (the same as `game.fxLevel = level`)
 *   fxMoments()                            the names of the moments in fx.json that `playMoment` can fire
 *   playMoment(name, x?, y?)               fire one by name (the screen center by default); the DEV tab lists a button for each (fxpanel.ts)
 *   forceContextLoss() / forceContextRestore()
 *
 * Reads happen inside the page, so a test does not ship pixels through Playwright for every check. Dev and tests only.
 */
import type { Container as PixiContainer } from 'pixi.js';
import { type FxCounts, type FxRequest, type Game, GlRenderer, H, type Pixels, W } from '../sje';
import { type GlCounts, installGlCounter, readGlCounts } from './glcounter';
import { mountFxPanel } from './fxpanel';
import { fingerprint, words } from './pixeltools';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeDump {
  label: string;
  /** The Pixi class name (`Container`, `Sprite`, `Graphics`). */
  type: string;
  x: number;
  y: number;
  depth: number;
  visible: boolean;
  /** The texture's label, for a node that shows one. */
  texture: string | null;
  filters: number;
  children: NodeDump[];
}

/** Dump a Pixi node and everything under it. */
export function dumpNode(node: PixiContainer): NodeDump {
  const withTexture = node as PixiContainer & { texture?: { label?: string } };
  return {
    label: node.label ?? '',
    type: node.constructor.name,
    x: node.x,
    y: node.y,
    depth: node.zIndex,
    visible: node.visible,
    texture: withTexture.texture ? (withTexture.texture.label ?? '') : null,
    filters: Array.isArray(node.filters) ? node.filters.length : node.filters ? 1 : 0,
    children: node.children.map((c) => dumpNode(c as PixiContainer)),
  };
}

export interface SjEngineHook {
  hooks: {
    onTick(fn: (tick: number) => void): () => void;
    onFrame(fn: () => void): () => void;
  };
  tree(): NodeDump;
  step(n: number): void;
  frameHash(): string;
  pixels(r?: Rect): { w: number; h: number; data: Uint8Array };
  canvasPixels(): { w: number; h: number; base64: string; k: number; x: number; y: number };
  glCounts(): GlCounts;
  fxCounts(): FxCounts;
  setFxLevel(level: FxRequest): void;
  fxMoments(): string[];
  playMoment(name: string, x?: number, y?: number): boolean;
  readonly renderer: { name: string; fxLevel: string; contextLost: boolean };
  forceContextLoss(): void;
  forceContextRestore(): void;
}

/** Call BEFORE `Game.create`: the GL object counter wraps the context calls, so it must be in place before the context exists. */
export function prepare(): void {
  installGlCounter();
}

function crop(p: Pixels, r: Rect): { w: number; h: number; data: Uint8Array } {
  const x0 = Math.max(0, Math.min(p.w, r.x));
  const y0 = Math.max(0, Math.min(p.h, r.y));
  const w = Math.max(0, Math.min(p.w - x0, r.w));
  const h = Math.max(0, Math.min(p.h - y0, r.h));
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) data.set(p.data.subarray(((y0 + row) * p.w + x0) * 4, ((y0 + row) * p.w + x0 + w) * 4), row * w * 4);
  return { w, h, data };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Put the engine's members on `window.__SJ__` (which the game's boot made). */
export function attach(game: Game): void {
  const renderer = game.renderer;
  if (!(renderer instanceof GlRenderer)) throw new Error('The DEV hook needs the GL renderer');
  const sj = (window as unknown as { __SJ__?: Record<string, unknown> }).__SJ__;
  if (!sj) throw new Error('The game boot made no __SJ__');
  const hook: SjEngineHook = {
    hooks: {
      onTick(fn) {
        game.events.on('poststep', fn);
        return () => void game.events.off('poststep', fn);
      },
      onFrame(fn) {
        game.events.on('prerender', fn);
        return () => void game.events.off('prerender', fn);
      },
    },
    tree() {
      const root = game.screen;
      return {
        label: 'screen',
        type: 'Container',
        x: 0,
        y: 0,
        depth: 0,
        visible: true,
        texture: null,
        filters: 0,
        children: [root.worldRoot._pixi, root.fxRoot, root.uiRoot._pixi, root.overlayRoot._pixi].map((r) => dumpNode(r)),
      };
    },
    step: (n) => game.step(n),
    frameHash: () => fingerprint(words(renderer.readBackBuffer())),
    pixels(r) {
      const p = renderer.readBackBuffer();
      return r ? crop(p, r) : { w: p.w, h: p.h, data: p.data };
    },
    canvasPixels() {
      // Draw and read in the same task: a WebGL canvas is only valid until the browser paints it.
      game.draw(0);
      const px = renderer.presenter.readCanvas();
      const l = renderer.picture;
      return { w: px.w, h: px.h, base64: toBase64(px.data), k: l.k, x: l.x, y: l.y };
    },
    glCounts: () => readGlCounts(),
    fxCounts: () => game.fx.counts(),
    setFxLevel: (level) => {
      game.fxLevel = level;
    },
    fxMoments: () => Object.keys(game.fx.data?.moments ?? {}),
    playMoment(name, x = W / 2, y = H / 2) {
      if (!game.fx.active || !game.fx.data?.moments[name]) return false;
      game.fx.playMoment(name, x, y);
      return true;
    },
    get renderer() {
      const gl = renderer.glc.gl;
      // Firefox deprecates WEBGL_debug_renderer_info (and logs a warning for each use): it gets the generic name. A lost context has no extensions.
      const ext = renderer.glc.lost || /firefox/i.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
      return {
        name: renderer.glc.lost ? 'webgl2 (context lost)' : ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        fxLevel: game.fxLevel,
        contextLost: renderer.glc.lost,
      };
    },
    forceContextLoss: () => renderer.glc.forceLoss(),
    forceContextRestore: () => renderer.glc.forceRestore(),
  };
  // `Object.defineProperties` keeps the `renderer` getter live (Object.assign would read it once).
  Object.defineProperties(sj, Object.getOwnPropertyDescriptors(hook));
  // The DEV tab gets a list of effects buttons (not under Playwright: the tab is not mounted there).
  if (!navigator.webdriver) mountFxPanel(sj as unknown as SjEngineHook);
}
