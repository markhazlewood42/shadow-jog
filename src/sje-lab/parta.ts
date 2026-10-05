/**
 * Part A of the engine-platform spike, run in the lab (docs/spikes/engine-platform.md, step 3 and
 * the Part A list). Each case builds something with the engine's own API, draws it, and compares the
 * result with a CPU reference computed here in plain JavaScript:
 *
 *   effects  A built-in filter, a custom GLSL filter, a Graphics mask and a sprite (alpha) mask,
 *            each on the 3D view and on a container with depth-sorted children.
 *   canary   The stale clear-colour canary of GlHandoff (frame-and-rendering.md 7.3): a filtered
 *            container with a transparent gap, over a 3D picture with a non-black background.
 *
 * "Reference" means: take the picture WITHOUT the effect, apply what the effect is supposed to do
 * to each pixel in JavaScript, and compare with what the GPU drew WITH the effect. The tolerance is
 * stated per case (2/255 per channel for arithmetic in a shader: the GPU rounds a little differently
 * from JavaScript; 0 for a stencil mask, which has no arithmetic).
 *
 * Everything runs inside the page, so a test does not ship pixel buffers through Playwright.
 */
import { colorMatrixEffect, type Container, createEffect, type Effect, type GameObject, H, type Pixels, Scene, W } from '../sje';

export type EffectName = 'colorMatrix' | 'glsl' | 'graphicsMask' | 'spriteMask';
export type EffectTarget = 'view3d' | 'sorted';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EffectCaseResult {
  target: EffectTarget;
  effect: EffectName;
  /** The tolerance this case promises, per channel, out of 255. */
  tolerance: number;
  region: Rect;
  compared: number;
  /** The largest difference in any channel between the GPU and the CPU reference. */
  maxDiff: number;
  /** Pixels off by more than the tolerance. Must be 0. */
  over: number;
  /** The box that holds every pixel that is off (null when none is). To see WHERE a failure is. */
  overBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Pixels where the effect changed the picture compared with no effect (the control: this must NOT be 0, or the case tests nothing). */
  changedByEffect: number;
  /** GL error flags found after drawing. Must be empty. */
  glErrors: number[];
  /** After the effect is removed the back buffer is identical to the one before it was added. */
  restored: boolean;
  /** The k-by-k blocks of the CANVAS (what the player sees) while the effect is on: how many, how many are not one flat colour. Must be 0 bad. */
  canvasBlocks: { k: number; blocks: number; bad: number };
  samples: Array<{ x: number; y: number; gpu: number[]; cpu: number[] }>;
}

/** The colour of the engine's void: what shows through where nothing is drawn (BackBuffer's clear colour). */
export const VOID_RGB: readonly [number, number, number] = [7, 6, 13];
/** The flat colour behind the sorted-container station. */
export const STATION_BG = 0x203040;

/** The 4x5 colour matrix of the built-in case: mixes channels and adds a little offset, so every output channel depends on all inputs. */
export const MATRIX: readonly number[] = [0.3, 0.6, 0.1, 0, 0.05, 0.15, 0.7, 0.15, 0, 0, 0.8, 0.1, 0.1, 0, 0.03, 0, 0, 0, 1, 0];
/** The uniform of the GLSL case (it proves `set` and the uniform path work). */
const GLSL_BIAS = 0.25;
const GLSL_FRAGMENT = `
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  // Premultiplied alpha in, premultiplied out. For an opaque pixel c.a is 1 and this is just a swizzle and a mix.
  finalColor = vec4(c.b, 1.0 - c.r, 0.5 * c.g + uBias, 1.0) * c.a;
}`;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const to8 = (v: number): number => Math.round(clamp01(v) * 255);

/** What each effect does to one OPAQUE pixel (r, g, b in 0 to 255), as the CPU computes it. */
export function applyEffectCpu(effect: 'colorMatrix' | 'glsl', r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  if (effect === 'colorMatrix') {
    const m = MATRIX;
    const at = (i: number): number => m[i] ?? 0;
    return [to8(at(0) * R + at(1) * G + at(2) * B + at(4)), to8(at(5) * R + at(6) * G + at(7) * B + at(9)), to8(at(10) * R + at(11) * G + at(12) * B + at(14))];
  }
  return [to8(B), to8(1 - R), to8(0.5 * G + GLSL_BIAS)];
}

/** One 2D station: a flat background and a container with three overlapping swatches whose DEPTHS are not their add order. */
class StationScene extends Scene<void> {
  swatches!: Container;
  readonly pieces: Array<{ x: number; y: number; w: number; h: number; color: number; depth: number }> = [
    // Added in this order (red, green, blue) but drawn by depth: green (1), blue (2), red (3).
    { x: 0, y: 0, w: 40, h: 40, color: 0xe8452e, depth: 3 },
    { x: 16, y: 16, w: 40, h: 40, color: 0x62e06a, depth: 1 },
    { x: 32, y: 32, w: 40, h: 40, color: 0x3a6aff, depth: 2 },
  ];
  /** Where the container is on the screen. */
  readonly at = { x: 200, y: 100 };

  override create(): void {
    const bg = this.add.graphics().setDepth(-10);
    bg.fillStyle(STATION_BG).fillRect(0, 0, W, H);
    this.swatches = this.add.container(this.at.x, this.at.y).setDepth(5);
    for (const p of this.pieces) {
      const g = this.add.graphics().setDepth(p.depth);
      g.fillStyle(p.color).fillRect(p.x, p.y, p.w, p.h);
      this.swatches.add(g);
    }
  }

  fixedUpdate(): void {}
}

/** What the lab gives Part A. */
export interface PartAEnv {
  /** Draw a frame and read the back buffer. */
  backBuffer(): Pixels;
  /** Draw a frame (nothing read). */
  draw(): void;
  /** The 3D picture of the hack that is running, before Pixi touches it. */
  framePixels(): Pixels | null;
  /** The hack scene that is running (its `View3D` and its display list), or null. */
  hackScene(): { view: GameObject; add: Scene['add']; sys: Scene['sys'] } | null;
  /** Push a scene on the game. Returns it. */
  run(scene: Scene<void>): void;
  /** Close a scene. */
  close(scene: Scene<void>): void;
  /** Count the k-by-k blocks of the canvas that are not one flat colour. Call right after `draw` (same task). */
  blocks(): { k: number; blocks: number; bad: number };
  /** Drain the GL error flags. */
  glErrors(): number[];
  /** The scene's texture store, to make the sprite mask's texture. */
  textures: {
    createCanvas(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; refresh(): void };
    /** Store this canvas under `key`, replacing an earlier one of that key. */
    addCanvasReplacing(key: string, canvas: HTMLCanvasElement): void;
    remove(key: string): boolean;
  };
}

const same = (a: Pixels, b: Pixels): boolean => {
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
};

/** Options of one case. */
export interface EffectCaseOptions {
  /** Where the SPRITE mask's top-left corner sits, in screen pixels. Default (180, 80). */
  maskAt?: { x: number; y: number };
  /** The `glsl` effect with NO uniforms (the bias is a constant in the shader): an empty uniform group used to crash the first draw. */
  noUniforms?: boolean;
}

/** Run one effect case. The target is the 3D view of the running hack, or the sorted container of a fresh station. */
export function runEffectCase(env: PartAEnv, effect: EffectName, target: EffectTarget, options: EffectCaseOptions = {}): EffectCaseResult {
  env.glErrors(); // clear anything left over, so errors found below are this case's
  // Two lists: what undoes the effect, and what removes the station scene. The effect goes FIRST, so the
  // "picture comes back" check can run while the station is still on screen.
  const keep: Array<() => void> = [];
  const keepScene: Array<() => void> = [];
  const cleanup = (): void => {
    for (const fn of keep.reverse()) fn();
    keep.length = 0;
  };
  const cleanupScene = (): void => {
    for (const fn of keepScene.reverse()) fn();
    keepScene.length = 0;
  };
  try {
    // ---- the object under test, and the picture with NO effect (the baseline) ----------------------
    let object: GameObject;
    let adder: Scene['add'];
    let base: (x: number, y: number) => [number, number, number];
    // Does the object cover this pixel? The 3D view covers all of the screen; the sorted container only its swatches.
    let covers: (x: number, y: number) => boolean;
    let background: [number, number, number];
    let region: Rect;
    let station: StationScene | null = null;
    if (target === 'view3d') {
      const hack = env.hackScene();
      if (!hack) throw new Error('the 3D view case needs a running hack');
      const rt = env.framePixels();
      if (!rt) throw new Error('no 3D picture to read');
      object = hack.view;
      adder = hack.add;
      base = (x, y) => {
        const i = (y * rt.w + x) * 4;
        return [rt.data[i] ?? 0, rt.data[i + 1] ?? 0, rt.data[i + 2] ?? 0];
      };
      background = [...VOID_RGB];
      covers = () => true;
      // Clear of the HUD (the case starts the hack with no HUD; this is belt and braces).
      region = { x: 140, y: 30, w: 250, h: 200 };
    } else {
      station = new StationScene();
      env.run(station);
      keepScene.push(() => env.close(station as StationScene));
      object = station.swatches;
      adder = station.add;
      const st = station;
      const bgR = (STATION_BG >> 16) & 255;
      const bgG = (STATION_BG >> 8) & 255;
      const bgB = STATION_BG & 255;
      base = (x, y) => {
        // The CPU picture of the swatches: paint in DEPTH order, later ones over earlier ones.
        let out: [number, number, number] = [bgR, bgG, bgB];
        for (const p of [...st.pieces].sort((a, b) => a.depth - b.depth)) {
          const px = st.at.x + p.x;
          const py = st.at.y + p.y;
          if (x >= px && x < px + p.w && y >= py && y < py + p.h) out = [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255];
        }
        return out;
      };
      background = [bgR, bgG, bgB];
      covers = (x, y) => st.pieces.some((p) => x >= st.at.x + p.x && x < st.at.x + p.x + p.w && y >= st.at.y + p.y && y < st.at.y + p.y + p.h);
      region = { x: 190, y: 90, w: 100, h: 100 };
    }

    env.draw();
    const baseline = env.backBuffer();
    // The baseline must itself match the CPU's idea of the picture (it proves the case compares the right thing).
    // For the 3D view that is the RT readback; for the station, the CPU swatches.

    // ---- add the effect ------------------------------------------------------------------------------
    let insideMask: ((x: number, y: number) => number) | null = null; // alpha 0 to 1 of the mask at a pixel
    let added: Effect | null = null;
    let maskObject: GameObject | null = null;
    if (effect === 'colorMatrix') {
      added = colorMatrixEffect(MATRIX);
      object.filters.add(added);
    } else if (effect === 'glsl') {
      if (options.noUniforms) {
        added = createEffect({ name: 'lab-glsl-const', fragment: GLSL_FRAGMENT.replace('uBias', `${GLSL_BIAS.toFixed(2)}`) });
      } else {
        added = createEffect({ name: 'lab-glsl', fragment: GLSL_FRAGMENT, uniforms: { uBias: { type: 'f32', value: 0 } } });
        added.set('uBias', GLSL_BIAS);
      }
      object.filters.add(added);
    } else if (effect === 'graphicsMask') {
      // Two rectangles make a stepped shape: a hard stencil edge with corners.
      const rects: Rect[] = target === 'view3d' ? [{ x: 150, y: 40, w: 120, h: 80 }, { x: 200, y: 100, w: 150, h: 90 }, { x: 260, y: 170, w: 100, h: 50 }] : [{ x: 210, y: 110, w: 30, h: 30 }, { x: 240, y: 140, w: 40, h: 30 }];
      const g = adder.graphics();
      g.fillStyle(0xffffff);
      for (const r of rects) g.fillRect(r.x, r.y, r.w, r.h);
      maskObject = g;
      object.filters.addMask(g);
      insideMask = (x, y) => (rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ? 1 : 0);
    } else {
      // A sprite mask: its ALPHA decides. 3 bands of alpha: 255, then 128 (half), then 0.
      const w = 96;
      const h = 64;
      const key = `lab-parta-mask-${Math.random().toString(36).slice(2, 8)}`;
      const made = env.textures.createCanvas(key, w, h);
      for (const [x0, x1, alpha] of [[0, 48, 255], [48, 72, 128], [72, 96, 0]] as const) {
        made.ctx.fillStyle = `rgba(255,255,255,${alpha / 255})`;
        made.ctx.fillRect(x0, 0, x1 - x0, h);
      }
      made.refresh();
      keep.push(() => env.textures.remove(key));
      // Where the sprite mask sits. The default overlaps the swatches only in part, so the mask cuts through them.
      const at = options.maskAt ?? { x: 180, y: 80 };
      const sprite = adder.image(at.x, at.y, key).setOrigin(0, 0);
      maskObject = sprite;
      object.filters.addMask(sprite);
      // The alpha the browser stores for rgba(255,255,255,128/255) is 128: read it back so the reference uses the real value.
      const stored = made.ctx.getImageData(0, 0, w, h).data;
      insideMask = (x, y) => {
        const lx = x - at.x;
        const ly = y - at.y;
        if (lx < 0 || ly < 0 || lx >= w || ly >= h) return 0;
        return (stored[(ly * w + lx) * 4 + 3] ?? 0) / 255;
      };
    }
    keep.push(() => {
      if (added) {
        object.filters.remove(added);
        added.destroy();
      }
      if (maskObject) {
        object.filters.clearMask();
        maskObject.destroy();
      }
    });

    env.draw();
    const gpu = env.backBuffer();
    const canvasBlocks = env.blocks();
    const glErrors = env.glErrors();

    // ---- compare with the CPU reference ---------------------------------------------------------------
    const tolerance = effect === 'graphicsMask' ? 0 : 2;
    const result: EffectCaseResult = { target, effect, tolerance, region, compared: 0, maxDiff: 0, over: 0, overBox: null, changedByEffect: 0, glErrors, restored: false, canvasBlocks, samples: [] };
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        const i = (y * W + x) * 4;
        const b = base(x, y);
        let want: [number, number, number];
        if (!covers(x, y)) want = [b[0], b[1], b[2]]; // the effect only touches the object's own pixels
        else if (effect === 'colorMatrix' || effect === 'glsl') want = applyEffectCpu(effect, b[0], b[1], b[2]);
        else {
          // out = base * a + background * (1 - a), where a is the mask's alpha here.
          const a = insideMask ? insideMask(x, y) : 1;
          want = [Math.round(b[0] * a + background[0] * (1 - a)), Math.round(b[1] * a + background[1] * (1 - a)), Math.round(b[2] * a + background[2] * (1 - a))];
        }
        const got: [number, number, number] = [gpu.data[i] ?? 0, gpu.data[i + 1] ?? 0, gpu.data[i + 2] ?? 0];
        const d = Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]), Math.abs(got[2] - want[2]));
        result.compared++;
        result.maxDiff = Math.max(result.maxDiff, d);
        if (d > tolerance) {
          result.over++;
          result.overBox = result.overBox ? { x0: Math.min(result.overBox.x0, x), y0: Math.min(result.overBox.y0, y), x1: Math.max(result.overBox.x1, x), y1: Math.max(result.overBox.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
          if (result.samples.length < 6) result.samples.push({ x, y, gpu: got, cpu: want });
        }
        if (got[0] !== (baseline.data[i] ?? 0) || got[1] !== (baseline.data[i + 1] ?? 0) || got[2] !== (baseline.data[i + 2] ?? 0)) result.changedByEffect++;
      }
    }

    // ---- remove the effect: the picture must come back exactly -------------------------------------------
    cleanup();
    env.draw();
    result.restored = same(baseline, env.backBuffer());
    env.glErrors();
    return result;
  } finally {
    cleanup();
    cleanupScene();
  }
}

/** Where the canary draws: a filtered container over the lower middle of the screen, where the 3D grid has lines. */
const CANARY = { rectA: { x: 150, y: 170, w: 50, h: 50 }, rectB: { x: 280, y: 170, w: 50, h: 50 }, gap: { x: 205, y: 175, w: 70, h: 40 } };

export interface CanaryResult {
  /** The negative control: was GlHandoff's clean-up on? */
  fixOn: boolean;
  /** Was the back buffer cleared to transparent black (the condition that lets the bug show)? */
  transparentBackBuffer: boolean;
  gapTotal: number;
  /** Gap pixels that are NOT the 3D picture that should show through. 0 when the hand-off is right. */
  gapWrong: number;
  /** Pixels of the two opaque rectangles that are not their own colour. 0 either way (they cover the stale colour). */
  rectsWrong: number;
  /** The colour a wrong gap pixel shows, if any (it should be Three's background, the stale clear colour). */
  firstWrong: { x: number; y: number; got: number[]; want: number[] } | null;
}

/**
 * The stale clear-colour canary (frame-and-rendering.md 7.3). A plain smoke test hides this bug: it
 * needs a render-texture target (the back buffer), a FILTERED container with a TRANSPARENT gap (Pixi
 * clears the filter's input texture with the GL clear colour), and a non-black Three background.
 */
export function runCanary(env: PartAEnv, setFix: (on: boolean) => void, setTransparentBackBuffer: (on: boolean) => void, fixOn: boolean, transparentBackBuffer: boolean): CanaryResult {
  const hack = env.hackScene();
  if (!hack) throw new Error('the canary needs a running hack');
  env.glErrors();
  const rt = env.framePixels();
  if (!rt) throw new Error('no 3D picture to read');
  setFix(fixOn);
  setTransparentBackBuffer(transparentBackBuffer);
  const c = hack.add.container(0, 0).setDepth(900);
  hack.sys.ui.add(c);
  const colours: Array<[Rect, number]> = [
    [CANARY.rectA, 0xff4fb0],
    [CANARY.rectB, 0x3fe0f0],
  ];
  for (const [r, color] of colours) {
    const g = hack.add.graphics();
    g.fillStyle(color).fillRect(r.x, r.y, r.w, r.h);
    c.add(g);
  }
  // An IDENTITY colour matrix: the filter changes nothing, so any difference is the stale colour.
  const identity = colorMatrixEffect([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  c.filters.add(identity);
  try {
    env.draw();
    const gpu = env.backBuffer();
    const result: CanaryResult = { fixOn, transparentBackBuffer, gapTotal: 0, gapWrong: 0, rectsWrong: 0, firstWrong: null };
    const g = CANARY.gap;
    for (let y = g.y; y < g.y + g.h; y++) {
      for (let x = g.x; x < g.x + g.w; x++) {
        const i = (y * W + x) * 4;
        const got: [number, number, number] = [gpu.data[i] ?? 0, gpu.data[i + 1] ?? 0, gpu.data[i + 2] ?? 0];
        const want: [number, number, number] = [rt.data[i] ?? 0, rt.data[i + 1] ?? 0, rt.data[i + 2] ?? 0];
        result.gapTotal++;
        // The 3D picture shows through the gap unchanged (the identity matrix does not touch it; the container has nothing there).
        if (Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]), Math.abs(got[2] - want[2])) > 0) {
          result.gapWrong++;
          result.firstWrong ??= { x, y, got, want };
        }
      }
    }
    for (const [r, color] of colours) {
      const want = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = (y * W + x) * 4;
          if (gpu.data[i] !== want[0] || gpu.data[i + 1] !== want[1] || gpu.data[i + 2] !== want[2]) result.rectsWrong++;
        }
      }
    }
    return result;
  } finally {
    setFix(true);
    setTransparentBackBuffer(false);
    c.filters.clear();
    identity.destroy();
    c.destroy();
    env.glErrors();
  }
}

