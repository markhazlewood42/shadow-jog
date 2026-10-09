/**
 * The Three side of the lab: a spinning cube drawn by Three into a `Frame3D` and shown by Pixi as a
 * `View3D`, plus the canaries and controls that need Three (docs/engine/tooling-and-testing.md section 8).
 *
 * This file is the lab's ONE door to Three and to the 3D chunk (`../sje/three`). The rest of the lab
 * loads it with a dynamic `import()` (see `hook.ts`), so the lab's first download holds no Three, as the
 * real game's will not (tests/sje-imports.test.ts checks both).
 *
 * M0 builds no `Scene3D`: that needs the scene runtime (`Scene`), which comes with M1 and M1b. The lab
 * drives the frame itself: Three renders the cube into the frame's target just before Pixi draws the screen.
 */
import {
  BoxGeometry,
  Color,
  ColorManagement,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene as ThreeScene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { colorMatrixEffect, Container, ExternalFrameTexture, Graphics, H, type Pixels, View3D, W } from '../sje';
import { createFrame3D, disposeObject3D, type Frame3D, type Frame3DPreference, frame3dTestSeams, hostsCreated, releaseGpuData, ThreeHost } from '../sje/three';
import type { GlCounts } from './glcounter';
import type { Lab } from './lab';
import { fingerprint, toBase64, words } from './pixeltools';

/** Facts about the running frame. */
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

export interface StartOptions {
  /** Which Frame3D: `auto` (default), `shared-context` or `canvas-copy`. */
  frame?: Frame3DPreference;
  /** Three's scene background, 0xRRGGBB. Default a dark violet. */
  background?: number;
  /** Add the bloom pass (default true). The exact-pixel canaries turn it off. */
  bloom?: boolean;
}

export interface StaleClearResult {
  fixOn: boolean;
  transparentBackBuffer: boolean;
  gapTotal: number;
  /** Gap pixels that are NOT the 3D picture that should show through. 0 when the hand-off is right. */
  gapWrong: number;
  /** Pixels of the two opaque rectangles that are not their own color. */
  rectsWrong: number;
  firstWrong: { x: number; y: number; got: number[]; want: number[] } | null;
}

export interface ColourResult {
  target: { left: number[]; right: number[] };
  screen: { left: number[]; right: number[] };
}

export interface ScaleResult {
  /** How many different colors the 4x enlarged 8x8 picture shows. 2 means hard blocks. More means blended edges. */
  colours: number;
  /** The magnification filter of the Three target, as Three names it. */
  magFilter: string;
}

export interface RewrapResult {
  /** The back buffer hash before the loss and after the restore. */
  before: string;
  after: string;
  rewraps: number;
  /** True when the picture after the restore equals the one before. */
  same: boolean;
}

export interface ThreeContextResult {
  before: number[];
  after: number[];
  recovered: boolean;
  /** Did calling `render` and `readRenderTargetPixels` while the context was lost throw? */
  threwWhileLost: boolean;
}

export interface ThreeLab {
  /** Start the cube frame and show it over the whole picture. Returns the frame's facts. Throws if one is already running. */
  start(options?: StartOptions): FrameFacts;
  /** Free the frame and everything it made. Safe to call when none is running. */
  stop(): void;
  facts(): FrameFacts | null;
  /** The 3D picture itself, before Pixi touches it: RGBA, top row first, as base64. */
  framePixels(): { w: number; h: number; base64: string } | null;
  /** Enter and leave the 3D frame `n` times (each draws two frames), and give the GL object counts before and after. */
  cycles(n: number, options?: StartOptions): { before: GlCounts; after: GlCounts };
  /** Make `n` Three render targets and never dispose them: the negative control of the leak check. */
  leakOnPurpose(n: number): void;
  /** TEST ONLY: make the next frames act as if Three's texture handle were missing (what a Three upgrade that moves its internal field would cause). */
  hideTextureHandle(on: boolean): void;
  /** Canary "texture handle": does `renderer.properties.get(rt.texture).__webglTexture` give a `WebGLTexture`? */
  handleDefined(): boolean;
  /** Canary "stale clear color". Needs a running frame with a non-black background. `fixOn: false` is the negative control. */
  staleClear(fixOn: boolean, transparentBackBuffer: boolean): StaleResult;
  /** Canary "color exactness". `managed: true` is the control (Three's own color management left on). */
  colourProbe(background: number, plane: number, managed: boolean, frame: Frame3DPreference): ColourResult;
  /** Canary "ExternalSource scale". `linear: true` is the control (a Three target with linear filtering). */
  externalScale(linear: boolean): ScaleResult;
  /** Canary "frame rewrap". `skipRewrap: true` is the control (the frame is not told to re-point at Three's new texture). */
  rewrap(skipRewrap: boolean): Promise<RewrapResult>;
  /** Canary "Three canvas and context". `withCanvas: false` is the control (Three made with only the context). */
  threeContext(withCanvas: boolean): Promise<ThreeContextResult>;
  /** How many Three renderers this page has made, by kind. */
  hosts(): { shared: number; private: number };
  /** Draw the 3D frame `n` more times per draw (the negative control of the speed line). 0 turns it off. */
  extraRenders(n: number): void;
}

type StaleResult = StaleClearResult;


/** Where the stale-color canary draws: two opaque rectangles with a transparent gap between them. */
const CANARY = { rectA: { x: 150, y: 170, w: 50, h: 50 }, rectB: { x: 280, y: 170, w: 50, h: 50 }, gap: { x: 205, y: 175, w: 70, h: 40 } };
const rgb = (n: number): number[] => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

export async function createThreeLab(lab: Lab): Promise<ThreeLab> {
  const { renderer } = lab;
  let running: { frame: Frame3D; scene: ThreeScene; cube: Mesh; before: () => void; onLost: () => void } | null = null;
  let extra = 0;

  const at = (p: Pixels, x: number, y: number): number[] => {
    const i = (y * p.w + x) * 4;
    return [p.data[i] ?? 0, p.data[i + 1] ?? 0, p.data[i + 2] ?? 0];
  };

  const stop = (): void => {
    if (!running) return;
    const r = running;
    running = null;
    const i = lab.beforeDraw.indexOf(r.before);
    if (i >= 0) lab.beforeDraw.splice(i, 1);
    renderer.glc.off('lost', r.onLost);
    r.frame.dispose();
    disposeObject3D(r.scene);
  };

  const start = (options: StartOptions = {}): FrameFacts => {
    if (running) throw new Error('ThreeLab.start: a frame is already running');
    const scene = new ThreeScene();
    scene.background = new Color(options.background ?? 0x180830);
    const camera = new PerspectiveCamera(50, W / H, 0.1, 20);
    camera.position.set(0, 0, 4);
    const faces = [0xff4fb0, 0x3fe0f0, 0xffb040, 0x7cff6b, 0xb06bff, 0xffffff].map((c) => new MeshBasicMaterial({ color: new Color(c) }));
    const cube = new Mesh(new BoxGeometry(1.6, 1.6, 1.6), faces);
    scene.add(cube);
    const frame = createFrame3D(renderer, lab.host, { scene, camera, bloom: options.bloom === false ? null : { strength: 0.5, radius: 0.4, threshold: 0.85 } }, options.frame ?? 'auto');
    frame.sprite.setDepth(20);
    lab.screen.worldRoot.add(frame.sprite);
    // The cube's turn is a function of the tick, so the same tick count gives the same picture.
    const before = (): void => {
      cube.rotation.set(lab.tick * 0.03, lab.tick * 0.05, 0);
      for (let i = 0; i <= extra; i++) frame.render();
    };
    lab.beforeDraw.push(before);
    // What a 3D scene does when the context is lost (Frame3D.releaseGpuData): Three drops its records of the frame's GPU objects, so a dispose
    // after the restore cannot delete handles of the dead context (that would log a warning for each).
    const onLost = (): void => {
      releaseGpuData(scene);
      frame.releaseGpuData();
    };
    renderer.glc.on('lost', onLost);
    running = { frame, scene, cube, before, onLost };
    return facts() as FrameFacts;
  };

  const facts = (): FrameFacts | null => (running ? { ...running.frame.describe(), contextLost: running.frame.contextLost } : null);

  /** Make a Three render target the engine's way (nearest, no depth), draw one flat scene into it, read it back, free it. */
  const withContextScene = <T>(host: ThreeHost, fn: () => T): T => renderer.handoff.withThree(host.renderer, fn);

  return {
    start,
    stop,
    facts,

    framePixels() {
      if (!running) return null;
      const p = running.frame.readPixels();
      return { w: p.w, h: p.h, base64: toBase64(p) };
    },

    cycles(n, options) {
      const once = (): void => {
        start(options);
        lab.step(2);
        stop();
      };
      // Warm up: the first entry makes the Three renderer, its shaders and the bloom pass's programs once.
      once();
      once();
      const before = lab.counts();
      for (let i = 0; i < n; i++) once();
      return { before, after: lab.counts() };
    },

    leakOnPurpose(n) {
      const host = ThreeHost.shared(renderer);
      withContextScene(host, () => {
        for (let i = 0; i < n; i++) {
          const rt = new WebGLRenderTarget(4, 4, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
          host.renderer.initRenderTarget(rt);
          // ...and never `rt.dispose()`: that is the leak.
        }
      });
    },

    hideTextureHandle(on) {
      frame3dTestSeams.hideTextureHandle = on;
    },

    handleDefined() {
      const host = ThreeHost.shared(renderer);
      const rt = new WebGLRenderTarget(4, 4, { minFilter: NearestFilter, magFilter: NearestFilter });
      try {
        withContextScene(host, () => host.renderer.initRenderTarget(rt));
        const props = host.renderer.properties.get(rt.texture) as { __webglTexture?: unknown } | undefined;
        return props?.__webglTexture instanceof WebGLTexture;
      } finally {
        withContextScene(host, () => rt.dispose());
      }
    },

    staleClear(fixOn, transparentBackBuffer) {
      if (!running) throw new Error('staleClear needs a running frame');
      renderer.handoff.drainErrors();
      renderer.handoff.setClearColourFix(fixOn);
      renderer.backBuffer.setClearColor(transparentBackBuffer ? [0, 0, 0, 0] : null);
      const box = lab.screen.overlayRoot;
      const holder = new Container(lab.host, 0, 0, 'canary');
      const colours: Array<[typeof CANARY.rectA, number]> = [
        [CANARY.rectA, 0xff4fb0],
        [CANARY.rectB, 0x3fe0f0],
      ];
      const rects = colours.map(([r, color]) => {
        const g = new Graphics(lab.host);
        g.fillStyle(color).fillRect(r.x, r.y, r.w, r.h);
        holder.add(g);
        return g;
      });
      // An IDENTITY color matrix: the filter changes nothing, so any difference is the stale color.
      const identity = colorMatrixEffect([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
      holder.filters.add(identity);
      box.add(holder);
      try {
        lab.draw();
        const gpu = renderer.readBackBuffer();
        const rt = running.frame.readPixels();
        const result: StaleResult = { fixOn, transparentBackBuffer, gapTotal: 0, gapWrong: 0, rectsWrong: 0, firstWrong: null };
        const g = CANARY.gap;
        for (let y = g.y; y < g.y + g.h; y++) {
          for (let x = g.x; x < g.x + g.w; x++) {
            const got = at(gpu, x, y);
            const want = at(rt, x, y);
            result.gapTotal++;
            // The 3D picture shows through the gap unchanged (the identity matrix does not touch it; the container has nothing there).
            if (Math.max(Math.abs((got[0] ?? 0) - (want[0] ?? 0)), Math.abs((got[1] ?? 0) - (want[1] ?? 0)), Math.abs((got[2] ?? 0) - (want[2] ?? 0))) > 0) {
              result.gapWrong++;
              result.firstWrong ??= { x, y, got, want };
            }
          }
        }
        for (const [r, color] of colours) {
          const want = rgb(color);
          for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) {
              const got = at(gpu, x, y);
              if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2]) result.rectsWrong++;
            }
          }
        }
        return result;
      } finally {
        renderer.handoff.setClearColourFix(true);
        renderer.backBuffer.setClearColor(null);
        holder.filters.clear();
        identity.destroy();
        holder.destroy();
        void rects;
        lab.draw();
        renderer.handoff.drainErrors();
      }
    },

    colourProbe(background, plane, managed, frame) {
      if (running) throw new Error('colourProbe needs no running frame');
      // Three's color management is a GLOBAL. The engine switches it off when its host module loads. The control switches it on while the colors are made.
      const was = ColorManagement.enabled;
      // The engine's own setting is left alone for the real check: it is what the test judges.
      if (managed) ColorManagement.enabled = true;
      const scene = new ThreeScene();
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(0, 0, 2);
      scene.background = new Color(background);
      const right = new Mesh(new PlaneGeometry(1, 2), new MeshBasicMaterial({ color: new Color(plane) }));
      right.position.set(0.5, 0, 0);
      scene.add(right);
      ColorManagement.enabled = was;
      const f = createFrame3D(renderer, lab.host, { scene, camera, bloom: null }, frame);
      f.sprite.setDepth(20);
      lab.screen.worldRoot.add(f.sprite);
      try {
        f.render();
        lab.draw();
        const rt = f.readPixels();
        const bb = renderer.readBackBuffer();
        // The left half is the background, the right half the plane; the middle row, away from the seam.
        const row = Math.floor(H / 2);
        const l = Math.floor(W / 6);
        const r = Math.floor((W * 4) / 5);
        return { target: { left: at(rt, l, row), right: at(rt, r, row) }, screen: { left: at(bb, l, row), right: at(bb, r, row) } };
      } finally {
        f.dispose();
        disposeObject3D(scene);
      }
    },

    externalScale(linear) {
      const host = ThreeHost.shared(renderer);
      const filter = linear ? LinearFilter : NearestFilter;
      const target = new WebGLRenderTarget(8, 8, { minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false });
      // The left half red, the right half blue: one hard edge down the middle of an 8x8 picture.
      const scene = new ThreeScene();
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(0, 0, 2);
      const left = new Mesh(new PlaneGeometry(1, 2), new MeshBasicMaterial({ color: new Color(0xff0000) }));
      left.position.set(-0.5, 0, 0);
      const rightHalf = new Mesh(new PlaneGeometry(1, 2), new MeshBasicMaterial({ color: new Color(0x0000ff) }));
      rightHalf.position.set(0.5, 0, 0);
      scene.add(left, rightHalf);
      let wrapper: ExternalFrameTexture | null = null;
      let view: View3D | null = null;
      try {
        withContextScene(host, () => {
          host.renderer.initRenderTarget(target);
          host.renderer.setRenderTarget(target);
          host.renderer.render(scene, camera);
          host.renderer.setRenderTarget(null);
        });
        const props = host.renderer.properties.get(target.texture) as { __webglTexture?: unknown };
        const tex = props.__webglTexture;
        if (!(tex instanceof WebGLTexture)) throw new Error('externalScale: no GL texture for the target');
        wrapper = new ExternalFrameTexture(renderer.pixi, tex, 8, 8);
        view = new View3D(lab.host, wrapper, 400, 250).setScale(4).setDepth(30);
        lab.screen.overlayRoot.add(view);
        lab.draw();
        const bb = renderer.readBackBuffer();
        const seen = new Set<string>();
        for (let y = 250; y < 250 + 32; y++) for (let x = 400; x < 400 + 32; x++) seen.add(at(bb, x, y).join(','));
        return { colours: seen.size, magFilter: linear ? 'linear' : 'nearest' };
      } finally {
        view?.destroy();
        wrapper?.destroy();
        withContextScene(host, () => target.dispose());
        disposeObject3D(scene);
        lab.draw();
      }
    },

    async rewrap(skipRewrap) {
      // The shared-context frame only: the canvas copy re-uploads its canvas every frame, so it has nothing to re-point.
      start({ frame: 'shared-context', bloom: false });
      const r = running;
      if (!r) throw new Error('no frame');
      try {
        lab.step(60);
        const before = hashOf(lab);
        if (skipRewrap) (r.frame as { rewrap: () => void }).rewrap = () => {};
        await lab.loseContext();
        await lab.restoreContext();
        lab.draw();
        const after = hashOf(lab);
        return { before, after, rewraps: r.frame.describe().rewraps, same: before === after };
      } finally {
        stop();
      }
    },

    async threeContext(withCanvas) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const gl = canvas.getContext('webgl2', { stencil: true, antialias: false, alpha: false, depth: false });
      if (!gl) throw new Error('no WebGL2');
      const loseExt = gl.getExtension('WEBGL_lose_context');
      canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
      const three = new WebGLRenderer({ ...(withCanvas ? { canvas } : {}), context: gl, antialias: false });
      three.outputColorSpace = LinearSRGBColorSpace;
      const scene = new ThreeScene();
      scene.background = new Color(0x2080ff);
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(0, 0, 2);
      const target = new WebGLRenderTarget(4, 4, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
      const draw = (): number[] => {
        three.setRenderTarget(target);
        three.render(scene, camera);
        three.setRenderTarget(null);
        const px = new Uint8Array(4 * 4 * 4);
        three.readRenderTargetPixels(target, 0, 0, 4, 4, px);
        return [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];
      };
      try {
        const before = draw();
        await new Promise<void>((resolve) => {
          canvas.addEventListener('webglcontextlost', () => setTimeout(resolve, 0), { once: true });
          loseExt?.loseContext();
        });
        let threwWhileLost = false;
        try {
          draw();
        } catch {
          threwWhileLost = true;
        }
        await new Promise<void>((resolve) => {
          canvas.addEventListener('webglcontextrestored', () => setTimeout(resolve, 0), { once: true });
          loseExt?.restoreContext();
        });
        const after = draw();
        return { before, after, recovered: after.every((v, i) => v === before[i]), threwWhileLost };
      } finally {
        if (!gl.isContextLost()) loseExt?.loseContext();
      }
    },

    hosts: () => ({ ...hostsCreated }),
    extraRenders(n) {
      extra = n;
    },
  };
}

/** The back buffer hash (a short fingerprint), read after a draw. */
function hashOf(lab: Lab): string {
  return fingerprint(words(lab.renderer.readBackBuffer()));
}
