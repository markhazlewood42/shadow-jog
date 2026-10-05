/**
 * Part A, the two cases that are not "an effect on an object" (docs/spikes/engine-platform.md):
 *
 *   (iii) Pixi `RenderLayer` with filters: does a filter on an ANCESTOR reach a child that is attached
 *         to a layer, and does a filter on the layer itself reach the child?
 *   (iv)  `roundPixels` with a negative scale (the mirror rule): a picture drawn with a negative scale,
 *         or inside a parent with one, against Canvas 2D drawing the same transform.
 *
 * Same method as parta.ts: build it with the engine's own API, draw, compare with a CPU reference.
 */
import { colorMatrixEffect, type Container, type Effect, type GameObject, H, Scene, W } from '../sje';
import { applyEffectCpu, MATRIX, type PartAEnv, type Rect, STATION_BG } from './parta';

// =====================================================================================================
// (iii) Pixi RenderLayer with filters
// =====================================================================================================

export interface RenderLayerResult {
  /** Scenario 1: the filter is on a CONTAINER that holds red and blue; blue is attached to a RenderLayer. Pixel colours at each centre. */
  ancestor: { red: number[]; blue: number[] };
  /** What the effect makes of red and of blue (the CPU's answer), to tell "filtered" from "not". */
  redFiltered: number[];
  blueFiltered: number[];
  /** Scenario 1 result: is blue (attached to the layer) filtered by its ancestor's filter? */
  ancestorFilterAppliesToAttached: boolean;
  /** Scenario 2: the filter is on the LAYER, blue is attached to it, the container has no filter. */
  onLayer: { red: number[]; blue: number[]; appliesToAttached: boolean };
  /** Scenario 3, the control: a plain filtered container, no layer. Both are filtered. */
  control: { red: number[]; blue: number[] };
  glErrors: number[];
}

class FlatScene extends Scene<void> {
  override create(): void {
    const bg = this.add.graphics().setDepth(-10);
    bg.fillStyle(STATION_BG).fillRect(0, 0, W, H);
  }
  fixedUpdate(): void {}
}

/** The lab's handle on a layer (a `RenderLayerProbe`). */
export interface LayerHandle {
  attach(o: GameObject): unknown;
  setEffect(e: Effect | null): unknown;
  destroy(): void;
}

export function runRenderLayerCase(env: PartAEnv, makeLayer: (parent: Container) => LayerHandle): RenderLayerResult {
  env.glErrors();
  const scene = new FlatScene();
  env.run(scene);
  const effect = colorMatrixEffect(MATRIX);
  const redRect: Rect = { x: 100, y: 100, w: 40, h: 40 };
  const blueRect: Rect = { x: 160, y: 100, w: 40, h: 40 };
  const read = (): { red: number[]; blue: number[] } => {
    env.draw();
    const px = env.backBuffer();
    const at = (r: Rect): number[] => {
      const i = ((r.y + 20) * W + (r.x + 20)) * 4;
      return [px.data[i] ?? 0, px.data[i + 1] ?? 0, px.data[i + 2] ?? 0];
    };
    return { red: at(redRect), blue: at(blueRect) };
  };
  const build = (): { holder: Container; blue: GameObject } => {
    const holder = scene.add.container(0, 0).setDepth(1);
    const red = scene.add.graphics();
    red.fillStyle(0xe8452e).fillRect(redRect.x, redRect.y, redRect.w, redRect.h);
    const blue = scene.add.graphics();
    blue.fillStyle(0x3a6aff).fillRect(blueRect.x, blueRect.y, blueRect.w, blueRect.h);
    holder.add(red);
    holder.add(blue);
    return { holder, blue };
  };
  const near = (got: number[], want: number[]): boolean => got.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= 2);
  try {
    // Scenario 3, the control: a filtered container and nothing attached to a layer.
    const c = build();
    c.holder.filters.add(effect);
    const control = read();
    c.holder.filters.clear();
    c.holder.destroy();

    // Scenario 1: the filter is on the ANCESTOR; blue is attached to a layer that sits after the container.
    const a = build();
    a.holder.filters.add(effect);
    const layer1 = makeLayer(scene.sys.world);
    layer1.attach(a.blue);
    const ancestor = read();
    layer1.destroy();
    a.holder.filters.clear();
    a.holder.destroy();

    // Scenario 2: no filter on the container; the filter is on the LAYER, and blue is attached to it.
    const b = build();
    const layer2 = makeLayer(scene.sys.world);
    layer2.attach(b.blue);
    layer2.setEffect(effect);
    const onLayer = read();
    layer2.setEffect(null);
    layer2.destroy();
    b.holder.destroy();

    const redFiltered = applyEffectCpu('colorMatrix', 0xe8, 0x45, 0x2e);
    const blueFiltered = applyEffectCpu('colorMatrix', 0x3a, 0x6a, 0xff);
    return {
      ancestor,
      redFiltered,
      blueFiltered,
      ancestorFilterAppliesToAttached: near(ancestor.blue, blueFiltered),
      onLayer: { ...onLayer, appliesToAttached: near(onLayer.blue, blueFiltered) },
      control,
      glErrors: env.glErrors(),
    };
  } finally {
    effect.destroy();
    env.close(scene);
  }
}

// =====================================================================================================
// (iv) roundPixels with a negative scale: the mirror rule
// =====================================================================================================

export interface MirrorRow {
  /** The picture's width in pixels (the height is always 8). */
  width: number;
  /** The origin x that was asked for, and the whole-pixel origin the engine used. */
  originX: number;
  originPx: number;
  /** How the mirror was made: the object's own negative scale, the engine's flip, a negative-scale parent, a negative y scale, or both signs. */
  how: 'scaleX' | 'flipX' | 'parentScaleX' | 'scaleY' | 'scaleXY';
  /** Pixels that differ from the Canvas 2D drawing of the same transform, over the picture's box and a margin. 0 means exact. */
  differing: number;
  glErrors: number[];
}

/** A picture whose every column is a different colour (and whose top row is white), so a mirror or a one-pixel shift shows at once. */
function patternCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D context');
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = `rgb(${(x * 29 + 40) % 256},${255 - ((x * 13) % 200)},${(x * 47 + 20) % 256})`;
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, 1);
  return c;
}

/** The engine's rule for an origin: the anchor must land on a whole pixel (see ImageObject.wholePixelOrigin). */
const wholeOriginPx = (origin: number, size: number): number => Math.round(origin * size);

/** The matrix: widths 8, 9, 15, 16 x origins 0, 0.5, 1 x five ways to mirror. Each is compared with Canvas 2D drawing the same transform. */
export function runMirrorMatrix(env: PartAEnv): MirrorRow[] {
  const rows: MirrorRow[] = [];
  const scene = new FlatScene();
  env.run(scene);
  const HEIGHT = 8;
  const POS = { x: 120, y: 100 };
  const widths = [8, 9, 15, 16];
  try {
    for (const width of widths) {
      for (const originX of [0, 0.5, 1]) {
        for (const how of ['scaleX', 'flipX', 'parentScaleX', 'scaleY', 'scaleXY'] as const) {
          env.glErrors();
          const key = `lab-mirror-${width}`;
          const pattern = patternCanvas(width, HEIGHT);
          env.textures.addCanvasReplacing(key, pattern);
          const originY = 0.5;
          const holder = scene.add.container(POS.x, POS.y).setDepth(1);
          const img = scene.add.image(0, 0, key).setOrigin(originX, originY);
          holder.add(img);
          const axPx = wholeOriginPx(originX, width);
          const ayPx = wholeOriginPx(originY, HEIGHT);
          if (how === 'scaleX') img.setScale(-1, 1);
          else if (how === 'flipX') img.setFlipX(true);
          else if (how === 'parentScaleX') holder.setScale(-1, 1);
          else if (how === 'scaleY') img.setScale(1, -1);
          else img.setScale(-1, -1);
          env.draw();
          const gpu = env.backBuffer();
          // The reference: Canvas 2D, same transform, no smoothing.
          const ref = document.createElement('canvas');
          ref.width = W;
          ref.height = H;
          const ctx = ref.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('no 2D context');
          ctx.imageSmoothingEnabled = false;
          ctx.fillStyle = '#203040';
          ctx.fillRect(0, 0, W, H);
          ctx.save();
          if (how === 'flipX') {
            // Phaser's flip: mirror about the middle of the picture, so it stays where it was.
            ctx.translate(POS.x - axPx + width, POS.y - ayPx);
            ctx.scale(-1, 1);
            ctx.drawImage(pattern, 0, 0);
          } else {
            const sx = how === 'scaleX' || how === 'parentScaleX' || how === 'scaleXY' ? -1 : 1;
            const sy = how === 'scaleY' || how === 'scaleXY' ? -1 : 1;
            ctx.translate(POS.x, POS.y);
            ctx.scale(sx, sy);
            ctx.drawImage(pattern, -axPx, -ayPx);
          }
          ctx.restore();
          const want = ctx.getImageData(0, 0, W, H).data;
          let differing = 0;
          // The box the picture can occupy, with a margin for a shifted picture.
          for (let y = POS.y - 20; y < POS.y + 20; y++) {
            for (let x = POS.x - 24; x < POS.x + 24; x++) {
              const i = (y * W + x) * 4;
              if (gpu.data[i] !== want[i] || gpu.data[i + 1] !== want[i + 1] || gpu.data[i + 2] !== want[i + 2]) differing++;
            }
          }
          rows.push({ width, originX, originPx: axPx, how, differing, glErrors: env.glErrors() });
          holder.destroy();
        }
      }
    }
    return rows;
  } finally {
    for (const w of widths) env.textures.remove(`lab-mirror-${w}`);
    env.close(scene);
  }
}
