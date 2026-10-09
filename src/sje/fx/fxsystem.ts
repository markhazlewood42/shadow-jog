/**
 * FxSystem: the screen effects of the new engine (docs/engine/frame-and-rendering.md 6.5, interfaces.md section 5, m2-brief.md section 2).
 * Follows: nothing in Phaser (it has no screen-wide post effects of this kind; they are a filter on its camera). Ours.
 *
 * It keeps today's `postfx` method names and signatures, because it IS the same state: it extends `FxState` (fxstate.ts), the class that the old
 * `PostFx` extends too. `shock`, `aberrate`, `haze`, `glitch`, `dim`, `flare`, `later`, `emit`, `update`, `clear`, `glowLayer` are inherited, so
 * `fx.json`, `moments.ts`, `playMoment` and the FX lab need no change. This class adds the drawing, with Pixi:
 *
 *   level     what draws
 *   full      the composite filter on the world root (shockwaves, color split, hazes, glitches, dim, flash, vignette, bloom), the glow chain,
 *             the particles, and a UI layer that stays crisp above the filter.
 *   lite      the particles and the stage dim. No filter, no bloom. (Software GL, when the level is `auto`.)
 *   none      nothing. `active` is false, every effect call does nothing, and the game draws as it did before.
 *
 * One frame: `Game.draw` calls `beginFrame` (fresh layers), the scenes draw (the glow layer, the UI layer), then the renderer calls `prepare`, which
 * draws the light and the blur into render textures, fills the particle containers and sets the composite's uniforms; then Pixi draws the screen,
 * and the filter on the world root reads what `prepare` made. The pass order is the old presenter's: blur the glow, composite the scene, draw the
 * particles, draw the UI layer.
 *
 * `update()` (the state step: shockwaves spread, particles move, delayed calls run) is NOT called by `Game`. The game's own ticker calls
 * `postfx.update()` once per tick (src/boot.ts), and the routing makes `postfx` this object. A second call here would age every effect twice.
 *
 * THE EDITOR CONTRACT (m2-brief.md section 2, point 9). A future FX editor drives this class and needs no Pixi object:
 *   `params`            every number that sets the look, in one object (fxparams.ts), changed live.
 *   `loadData(fx)`      swap the parsed `fx.json` in a running game; bad data is refused and the old data stays.
 *   `playMoment(...)`   play a moment by name with no scene running.
 *   `step(n)`           advance the effects clock by n ticks with no scene running, so a tool can scrub.
 *   `snapshot()`        the live state as plain JSON, `restore(s)` puts it back.
 *
 * Headless: with no `gpu` (a test in Node) there is no drawing at all; only the state exists, and a test switches `active` itself, like the old
 * tests do.
 */
import { Container, RenderTexture, Sprite, Texture } from 'pixi.js';
import { Rng } from '../core/rng';
import { H, W } from '../core/size';
import { CanvasImage } from '../display/canvasimage';
import type { DisplayHost } from '../display/gameobject';
import type { Screen } from '../display/screen';
import { SOFTWARE_GL } from '../render/glcontext';
import type { PixiRenderer } from '../render/pixirenderer';
import { CompositeFilter } from './compositefilter';
import { checkFx, type FxData } from './fxdata';
import { defaultFxParams, type FxParams } from './fxparams';
import { FxParticles } from './fxparticles';
import { FxState, type Glitch, type Haze, type Shock } from './fxstate';
import { fireLayer, type MomentOpts } from './moments';
import type { ParticleSnapshot } from './particles';
import { GlowChain } from './glowchain';

/** What the player or a test asks for. `auto` picks `lite` on a software renderer and `full` otherwise. */
export type FxRequest = 'auto' | FxLevel;
/** What is actually drawn. `lite` is never stored in the settings. */
export type FxLevel = 'full' | 'lite' | 'none';

/** What the drawing needs: the Pixi renderer, the screen (to add layers and the filter), a host for the canvas images, and the GPU's name. */
export interface FxGpu {
  pixi: PixiRenderer;
  screen: Screen;
  host: DisplayHost;
  rendererName: string;
}

export interface FxOptions {
  gpu?: FxGpu;
  request?: FxRequest;
  /** Seed of the visual stream (the glitch patterns). The same seed gives the same frames. */
  seed?: number;
  /** Look parameters that differ from the defaults (`defaultFxParams`). `particleCap` is read here, once. */
  params?: Partial<FxParams>;
}

/** A moment layer waiting for its delay to run out. Plain data, so a snapshot can hold it (a closure from `later` cannot be held). */
interface DelayedLayer {
  t: number;
  moment: string;
  layer: number;
  x: number;
  y: number;
  angle?: number;
  weight?: number;
}

/** The live effect state as plain JSON (`FxSystem.snapshot`). It holds no function and no Pixi object. */
export interface FxSnapshot {
  version: 1;
  time: number;
  rate: number;
  bloom: number;
  vignette: number;
  aberration: [number, number, number];
  pulse: number;
  dim: [number, number, number];
  flash: { color: string; alpha: number };
  clip: { x: number; y: number; w: number; h: number } | null;
  shocks: Shock[];
  hazes: Haze[];
  glitches: Glitch[];
  particles: ParticleSnapshot;
  delayed: DelayedLayer[];
  /** State of the seeded visual stream. */
  rng: number;
  /** Delayed calls made with `later(frames, fn)`: functions, so they are not in the snapshot. A tool should know it lost them. */
  droppedCalls: number;
}

/** The numbers the DEV hook shows. */
export interface FxCounts {
  level: FxLevel;
  active: boolean;
  shocks: number;
  hazes: number;
  glitches: number;
  particles: number;
}

const NO_PARTICLES = { add: 0, alpha: 0 } as const;

/** Everything the current level made. Torn down when the level changes. */
interface Parts {
  level: 'full' | 'lite';
  particles: FxParticles;
  /** `full` only: */
  glowImage?: CanvasImage;
  uiImage?: CanvasImage;
  litRoot?: Container;
  chain?: GlowChain;
  composite?: CompositeFilter;
  /** `lite` only: a black full-screen sprite whose alpha is the dim. */
  dimSprite?: Sprite;
}

export class FxSystem extends FxState {
  /** What was asked for (`auto`, `full`, `lite`, `none`). */
  request: FxRequest;
  /** What is drawn now. */
  level: FxLevel = 'none';
  private parts: Parts | null = null;
  private readonly rng: Rng;
  private readonly gpu: FxGpu | null;
  /** The UI layer was drawn into this frame (an untouched one is neither uploaded nor shown), and has pixels to clear. */
  private uiTouched = false;
  private uiDirty = false;
  /** The look parameters. Change a field and the next frame shows it. */
  readonly params: FxParams;
  /** The presets and moments in use (`loadData`). Null until data is loaded. */
  data: FxData | null = null;
  private readonly delayed: DelayedLayer[] = [];

  constructor(opts: FxOptions = {}) {
    super(opts.params?.particleCap ?? defaultFxParams().particleCap);
    this.params = { ...defaultFxParams(), ...opts.params };
    this.gpu = opts.gpu ?? null;
    this.rng = new Rng(opts.seed ?? 0x5eed);
    this.request = opts.request ?? 'auto';
    this.setLevel(this.request);
  }

  /** The seeded visual stream, not `Math.random` (frame-and-rendering.md section 8). */
  protected override random(): number {
    return this.rng.next();
  }

  override get ui() {
    // A scene that reads the UI layer is about to draw into it.
    if (this.uiCtx) this.uiTouched = true;
    return this.uiCtx;
  }
  override set ui(v) {
    this.uiCtx = v;
  }

  /** Switch the level. Everything in flight is dropped, and the layers of the old level are freed. */
  setLevel(request: FxRequest): void {
    this.request = request;
    const level = this.resolve(request);
    if (level === this.level && (level === 'none') === (this.parts === null)) return;
    this.teardown();
    this.clear();
    this.level = level;
    this.active = level !== 'none' && this.gpu !== null;
    if (this.active && level !== 'none') this.build(level);
  }

  private resolve(request: FxRequest): FxLevel {
    if (!this.gpu) return 'none';
    if (request === 'auto') return SOFTWARE_GL.test(this.gpu.rendererName) ? 'lite' : 'full';
    return request;
  }

  /** Is the composite on the world (the `full` level)? The game then paints the fade and the notices into the UI layer. */
  get compositing(): boolean {
    return this.parts?.level === 'full';
  }

  /** How many of each effect is alive, for the DEV hook. */
  counts(): FxCounts {
    return { level: this.level, active: this.active, shocks: this.shocks.length, hazes: this.hazes.length, glitches: this.glitches.length, particles: this.particles.count };
  }

  // ---- the editor contract -----------------------------------------------------------------------

  /** Change some look parameters (a merge). Arrays are copied. `particleCap` is read at construction only. */
  setParams(p: Partial<FxParams>): void {
    for (const [k, v] of Object.entries(p)) (this.params as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v;
  }

  /**
   * Swap in new presets and moments (a hot reload). `d` is the parsed `fx.json`. Returns what is wrong with it (`checkFx`'s messages): when that is not
   * empty the old data stays in place and nothing changes. Moment layers already waiting on a delay use the new data when they fire.
   */
  loadData(d: unknown): string[] {
    const errors = checkFx(d);
    if (errors.length === 0) this.data = d as FxData;
    return errors;
  }

  /** Play a moment by name at (x, y), with no scene needed. Unknown names, and no data loaded, do nothing. Delayed layers wait on the effects clock. */
  playMoment(name: string, x: number, y: number, o: MomentOpts = {}): void {
    const data = this.data;
    if (!this.active || !data) return;
    const m = data.moments[name];
    if (!m) return;
    m.layers.forEach((l, layer) => {
      if (l.delay && l.delay > 0) this.delayed.push({ t: l.delay, moment: name, layer, x, y, ...(o.angle !== undefined ? { angle: o.angle } : {}), ...(o.weight !== undefined ? { weight: o.weight } : {}) });
      else fireLayer(this, data, l, x, y, o);
    });
  }

  /** One tick of the effects clock, then the moment layers whose delay ran out. */
  override update(): void {
    super.update();
    if (this.delayed.length === 0) return;
    const dt = this.rate;
    const due: DelayedLayer[] = [];
    let keep = 0;
    for (const d of this.delayed) {
      d.t -= dt;
      if (d.t <= 0) due.push(d);
      else this.delayed[keep++] = d;
    }
    this.delayed.length = keep;
    const data = this.data;
    if (!data) return;
    for (const d of due) {
      const l = data.moments[d.moment]?.layers[d.layer];
      if (l) fireLayer(this, data, l, d.x, d.y, { ...(d.angle !== undefined ? { angle: d.angle } : {}), ...(d.weight !== undefined ? { weight: d.weight } : {}) });
    }
  }

  /** Drop everything in flight, the delayed moment layers too. */
  override clear(): void {
    super.clear();
    this.delayed.length = 0;
  }

  /** Advance the effects clock by `n` ticks with no scene running. The same as `n` calls of `update()`. */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.update();
  }

  /** The live effect state as plain JSON: effects in flight, the clock, the particles, the delayed moment layers, the seeded stream. */
  snapshot(): FxSnapshot {
    return {
      version: 1,
      time: this.time,
      rate: this.rate,
      bloom: this.bloom,
      vignette: this.vignette,
      aberration: [this.aberration, this.aberrationX, this.aberrationY],
      pulse: this.pulse,
      dim: [this.dimAmount, this.dimT, this.dimLife],
      flash: { color: this.flashColor, alpha: this.flashAlpha },
      clip: this.clip ? { ...this.clip } : null,
      shocks: this.shocks.map((s) => ({ ...s })),
      hazes: this.hazes.map((h) => ({ ...h })),
      glitches: this.glitches.map((g) => ({ ...g })),
      particles: this.particles.snapshot(),
      delayed: this.delayed.map((d) => ({ ...d })),
      rng: this.rng.state,
      droppedCalls: this.pendingCalls,
    };
  }

  /** Put a snapshot back. Calls made with `later(frames, fn)` are dropped (a snapshot cannot hold a function). */
  restore(s: FxSnapshot): void {
    if (s.version !== 1) throw new Error(`FxSystem.restore: unknown snapshot version ${String((s as { version?: unknown }).version)}`);
    this.clear();
    this.dropPending();
    this.time = s.time;
    this.rate = s.rate;
    this.bloom = s.bloom;
    this.vignette = s.vignette;
    [this.aberration, this.aberrationX, this.aberrationY] = s.aberration;
    this.pulse = s.pulse;
    [this.dimAmount, this.dimT, this.dimLife] = s.dim;
    this.flashColor = s.flash.color;
    this.flashAlpha = s.flash.alpha;
    this.clip = s.clip ? { ...s.clip } : null;
    for (const x of s.shocks) this.shocks.push({ ...x });
    for (const x of s.hazes) this.hazes.push({ ...x });
    for (const x of s.glitches) this.glitches.push({ ...x });
    this.particles.restore(s.particles);
    for (const d of s.delayed) this.delayed.push({ ...d });
    this.rng.state = s.rng;
  }

  // ---- building ----------------------------------------------------------------------------------

  private build(level: 'full' | 'lite'): void {
    const gpu = this.gpu;
    if (!gpu) return;
    const particles = new FxParticles(this.particles.cap);
    const parts: Parts = { level, particles };
    const root = gpu.screen.fxRoot;
    if (level === 'lite') {
      const dim = new Sprite(Texture.WHITE);
      dim.tint = 0x000000;
      dim.width = W;
      dim.height = H;
      dim.visible = false;
      root.addChild(dim, particles.group);
      parts.dimSprite = dim;
    } else {
      const glowImage = new CanvasImage(gpu.host, 0, 0, W, H, 'fx-glow');
      const uiImage = new CanvasImage(gpu.host, 0, 0, W, H, 'fx-ui');
      uiImage.visible = false;
      // The light: the glow layer, then the glowing particles over it (the old presenter drew them in that order).
      const litRoot = new Container({ label: 'fx light' });
      litRoot.addChild(glowImage._pixi, particles.litGroup);
      const chain = new GlowChain(litRoot);
      const composite = new CompositeFilter(chain.half[1].source, chain.quarter[1].source, chain.lit.source);
      root.addChild(particles.group, uiImage._pixi);
      gpu.screen.setWorldFilter(composite.filter);
      this.glowCtx = glowImage.ctx;
      this.uiCtx = uiImage.ctx;
      Object.assign(parts, { glowImage, uiImage, litRoot, chain, composite });
    }
    this.parts = parts;
    this.warm();
  }

  private teardown(): void {
    const parts = this.parts;
    const gpu = this.gpu;
    this.parts = null;
    this.glowCtx = null;
    this.uiCtx = null;
    this.glowUsed = false;
    this.uiTouched = false;
    this.uiDirty = false;
    if (!parts || !gpu) return;
    if (parts.level === 'full') gpu.screen.setWorldFilter(null);
    gpu.screen.fxRoot.removeChildren();
    parts.dimSprite?.destroy();
    parts.particles.destroy();
    parts.uiImage?.destroy();
    parts.glowImage?.destroy();
    // The composite reads the chain's textures: free it first, or Pixi warns that a texture source was destroyed while bound to a shader.
    parts.composite?.destroy();
    parts.chain?.destroy();
    parts.litRoot?.destroy();
  }

  /** Free everything (a test, or a game that ends). */
  destroy(): void {
    this.teardown();
    this.level = 'none';
    this.active = false;
  }

  /**
   * Draw every effect once, off screen, so no shader is compiled in the middle of a `playMoment` frame (frame-and-rendering.md 6.4: the first use of a
   * filter costs about 90 ms). The game calls it once the renderer exists, before the first frame; a level change calls it again. Safe to call twice.
   */
  warm(): void {
    const parts = this.parts;
    const gpu = this.gpu;
    if (!parts || !gpu) return;
    const pixi = gpu.pixi;
    pixi.resetState();
    const scratch = RenderTexture.create({ width: 16, height: 16, resolution: 1 });
    // The particle shaders, with a clip so the mask path compiles too. The live containers draw two probe particles into the scratch target, then are
    // emptied: the next `prepare` fills them from the simulation.
    const probe = parts.particles;
    probe.buffer.set([4, 4, 6, 6, 0, 1, 1, 1, 1, 1, 8, 8, 6, 6, 0, 1, 1, 1, 1, 0]);
    probe.sync(1, 1);
    probe.setClip({ x: 0, y: 0, w: 16, h: 16 });
    for (const g of [probe.group, probe.litGroup]) pixi.renderer.render({ container: g, target: scratch, clear: true });
    probe.sync(0, 0);
    probe.setClip(null);
    if (parts.chain && parts.composite) {
      // The blur passes, then the composite over a small white sprite.
      parts.chain.render(pixi, this.params);
      parts.composite.update(this, 1, this.params);
      const sprite = new Sprite(Texture.WHITE);
      sprite.width = 16;
      sprite.height = 16;
      sprite.filters = [parts.composite.filter];
      pixi.renderer.render({ container: sprite, target: scratch, clear: true });
      sprite.destroy();
    }
    scratch.destroy(true);
    pixi.resetState();
  }

  // ---- one frame ---------------------------------------------------------------------------------

  /** The start of a draw, before any scene draws: are the effects live this frame, and fresh, empty layers. */
  beginFrame(): void {
    const parts = this.parts;
    if (!parts) return;
    if (parts.level === 'full') {
      // Last frame's glow and UI pixels go; a layer nobody drew into stays as it is (it is not shown).
      if (this.glowUsed) this.glowCtx?.clearRect(0, 0, W, H);
      if (this.uiDirty) this.uiCtx?.clearRect(0, 0, W, H);
    }
    this.glowUsed = false;
    this.uiTouched = false;
    this.uiDirty = false;
  }

  /**
   * The renderer calls this every frame after Pixi has forgotten its cached GL state and before it draws the screen. Everything that needs its own
   * render pass happens here: the light and the blur, and the uniforms the composite will read.
   */
  prepare(pixi: PixiRenderer): void {
    const parts = this.parts;
    if (!parts) return;
    const sim = this.particles;
    const counts = sim.count ? sim.write(parts.particles.buffer) : NO_PARTICLES;
    parts.particles.sync(counts.add, counts.alpha);
    parts.particles.setClip(this.clip);
    if (parts.level === 'lite') {
      const dim = parts.dimSprite;
      if (dim) {
        dim.alpha = this.dimNow;
        dim.visible = dim.alpha > 0;
      }
      return;
    }
    const { uiImage, glowImage, chain, composite } = parts;
    if (!uiImage || !glowImage || !chain || !composite) return;
    uiImage.visible = this.uiTouched;
    if (this.uiTouched) {
      uiImage.refresh();
      this.uiDirty = true;
    }
    const bloom = this.glowUsed || counts.add ? this.bloom + this.pulse : 0;
    if (bloom > 0) {
      glowImage.visible = this.glowUsed;
      if (this.glowUsed) glowImage.refresh();
      chain.render(pixi, this.params);
    }
    composite.update(this, bloom, this.params);
  }
}
