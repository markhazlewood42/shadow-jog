/**
 * FxParticles: draws the CPU particle simulation (`ParticleSim`, particles.ts) with Pixi `ParticleContainer`s
 * (docs/engine/frame-and-rendering.md 6.5, row "Particles"; m2-brief.md section 2, point 4).
 *
 * The simulation does not change: it packs the living particles as `x, y, w, h, angle, r, g, b, a, shape` (additive ones first). This class turns
 * each packed record into a Pixi `Particle` and keeps two containers: the glowing particles (blend `add`) and the covering ones (blend `normal`). A
 * third, light-only container shares the glowing list and draws into the light that blooms.
 *
 * THE SHAPES. The old presenter drew each shape in its fragment shader (soft glow, dot, spark, square, ring). A `ParticleContainer` shares ONE
 * texture source, so the five shapes are cells of one small atlas, computed on the CPU from the same formulas. The atlas holds premultiplied white:
 * a particle's tint and alpha then give `rgb * a, a`, the old output. A cell is 16 px with a 1 px empty gutter, linear sampling. Look drift against
 * the analytic shader (a dot or a ring at 3 px) is expected and is what the side-by-side shows (m2-brief.md section 6); nothing here tunes it.
 *
 * No allocation per frame: the `Particle` objects are pooled (grown on demand, never freed until `destroy`).
 */
import { CanvasSource, Container, Graphics, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import { PARTICLE_STRIDE } from './particles';

/** Size of one shape cell in the atlas, in texels. The quad is drawn at (width / CELL) scale. */
const CELL = 16;
/** Empty texels between cells, so linear sampling never reads the next shape. */
const GUTTER = 1;
const STEP = CELL + 2 * GUTTER;
const SHAPES = 5;

/** The old fragment shader's alpha for shape `id` at local position (x, y) in -1..1. `SHAPE_ID`: soft 0, dot 1, spark 2, square 3, ring 4. */
function shapeAlpha(id: number, x: number, y: number): number {
  const r = Math.hypot(x, y);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  if (id === 0) return Math.max(0, 1 - r) ** 2;
  if (id === 1) return r <= 1 ? 1 : 0;
  if (id === 2) return (1 - Math.abs(x)) * Math.max(0, 1 - Math.abs(y)) ** 2;
  if (id === 3) return 1;
  return smooth(0.6, 0.8, r) * (1 - smooth(0.88, 1, r));
}

/** The atlas canvas: five cells in a row, premultiplied white by shape alpha. */
function drawAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHAPES * STEP;
  canvas.height = STEP;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('A 2D canvas context is needed for the particle shapes (this browser has no canvas drawing)');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let id = 0; id < SHAPES; id++) {
    for (let j = 0; j < CELL; j++) {
      for (let i = 0; i < CELL; i++) {
        const a = shapeAlpha(id, ((i + 0.5) / CELL) * 2 - 1, ((j + 0.5) / CELL) * 2 - 1);
        const o = ((j + GUTTER) * canvas.width + id * STEP + GUTTER + i) * 4;
        image.data[o] = 255;
        image.data[o + 1] = 255;
        image.data[o + 2] = 255;
        image.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function newContainer(label: string, blend: 'add' | 'normal'): ParticleContainer {
  // Every property changes each frame (the packed list is re-sorted as particles die), so none is static.
  return new ParticleContainer({ label, blendMode: blend, dynamicProperties: { vertex: true, position: true, rotation: true, uvs: true, color: true } });
}

/**
 * The atlas lives for the page, and is shared by every `FxParticles`. Pixi's particle shader keeps a reference to the texture source it drew last, and
 * warns when that source is destroyed while still bound. The atlas is five tiny cells, so keeping it costs nothing.
 */
let atlas: { source: CanvasSource; shapes: Texture[] } | null = null;
function sharedAtlas(): { source: CanvasSource; shapes: Texture[] } {
  if (atlas) return atlas;
  const source = new CanvasSource({ resource: drawAtlas(), resolution: 1, scaleMode: 'linear' });
  const shapes: Texture[] = [];
  for (let id = 0; id < SHAPES; id++) shapes.push(new Texture({ source, frame: new Rectangle(id * STEP + GUTTER, GUTTER, CELL, CELL) }));
  atlas = { source, shapes };
  return atlas;
}

export class FxParticles {
  private readonly shapes: Texture[];
  /** The glowing and the covering particles, in draw order. */
  private readonly addList: Particle[] = [];
  private readonly alphaList: Particle[] = [];
  private readonly spare: Particle[] = [];
  private readonly addPC = newContainer('particles add', 'add');
  private readonly alphaPC = newContainer('particles alpha', 'normal');
  private readonly litPC = newContainer('particles light', 'add');
  /** What the main containers sit in (clipped to the battlefield), and what the light container sits in. */
  readonly group = new Container({ label: 'particles' });
  readonly litGroup = new Container({ label: 'particles light group' });
  private readonly mask = new Graphics();
  private readonly litMask = new Graphics();
  private clipKey = '';
  /** The packed draw buffer: one record per particle, written by `ParticleSim.write`. */
  private readonly data: Float32Array;
  /** How many glowing particles the last `sync` drew. */
  glowing = 0;
  /** How many covering particles the last `sync` drew. */
  covering = 0;

  constructor(cap: number) {
    this.data = new Float32Array(cap * PARTICLE_STRIDE);
    this.shapes = sharedAtlas().shapes;
    // Both lists are shared on purpose: the light container draws the glowing particles again, into the light.
    this.addPC.particleChildren = this.addList;
    this.litPC.particleChildren = this.addList;
    this.alphaPC.particleChildren = this.alphaList;
    // The clip masks are not children: a child would draw its white rectangle. A mask outside the tree is fine (the groups sit at the origin).
    this.group.addChild(this.addPC, this.alphaPC);
    this.litGroup.addChild(this.litPC);
  }

  /** The packed buffer, for the simulation to write into. */
  get buffer(): Float32Array {
    return this.data;
  }

  /** Turn the first `add + alpha` records of the buffer into particles. Call right after `ParticleSim.write`. */
  sync(add: number, alpha: number): void {
    this.fill(this.addList, 0, add);
    this.fill(this.alphaList, add, alpha);
    this.glowing = add;
    this.covering = alpha;
  }

  /** Show particles only inside this rectangle, or anywhere (null). */
  setClip(clip: { x: number; y: number; w: number; h: number } | null): void {
    const key = clip ? `${clip.x},${clip.y},${clip.w},${clip.h}` : '';
    if (key === this.clipKey) return;
    this.clipKey = key;
    for (const [g, node] of [[this.mask, this.group], [this.litMask, this.litGroup]] as const) {
      if (clip) {
        g.clear().rect(clip.x, clip.y, clip.w, clip.h).fill(0xffffff);
        node.mask = g;
      } else node.mask = null;
    }
  }

  private fill(list: Particle[], start: number, n: number): void {
    while (list.length > n) {
      const p = list.pop();
      if (p) this.spare.push(p);
    }
    const d = this.data;
    for (let i = 0; i < n; i++) {
      let p = list[i];
      if (!p) {
        p = this.spare.pop() ?? new Particle({ texture: this.shapes[0] as Texture, anchorX: 0.5, anchorY: 0.5 });
        list.push(p);
      }
      const o = (start + i) * PARTICLE_STRIDE;
      p.x = d[o] ?? 0;
      p.y = d[o + 1] ?? 0;
      p.scaleX = (d[o + 2] ?? CELL) / CELL;
      p.scaleY = (d[o + 3] ?? CELL) / CELL;
      p.rotation = d[o + 4] ?? 0;
      p.texture = this.shapes[d[o + 9] ?? 0] ?? (this.shapes[0] as Texture);
      // Pixi packs the color as 0xAABBGGRR: the tint in BGR order, the alpha on top. It premultiplies in the vertex shader.
      const r = Math.round(Math.min(1, Math.max(0, d[o + 5] ?? 1)) * 255);
      const g = Math.round(Math.min(1, Math.max(0, d[o + 6] ?? 1)) * 255);
      const b = Math.round(Math.min(1, Math.max(0, d[o + 7] ?? 1)) * 255);
      const a = Math.round(Math.min(1, Math.max(0, d[o + 8] ?? 1)) * 255);
      p.color = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  }

  destroy(): void {
    this.group.destroy({ children: true });
    this.litGroup.destroy({ children: true });
    this.mask.destroy();
    this.litMask.destroy();
    this.addList.length = 0;
    this.alphaList.length = 0;
    this.spare.length = 0;
  }
}
