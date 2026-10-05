/**
 * Frame3D: how the 3D picture gets into Pixi (docs/engine/interfaces.md section 12,
 * frame-and-rendering.md section 7, decision E3). The scene code asks for a `Frame3D` and never
 * knows which of the two ways is behind it.
 *
 *   SHARED CONTEXT (primary)         Three renders into a 480x270 `WebGLRenderTarget` on the engine's
 *                                    own WebGL context. Pixi wraps that target's GL texture in an
 *                                    `ExternalSource` and shows it as a `View3D`. No copy.
 *   CANVAS COPY (fallback)           The same render target, drawn onto a canvas of a second Three
 *                                    renderer. Pixi uploads that canvas each frame (`CanvasSource`).
 *
 * Both draw the same picture into the same target first, so the two modes are pixel-identical (the
 * e2e spec compares them). The look rules (`7.5`): the target is W x H and NEAREST filtered, so one
 * 3D pixel is one game pixel on the same grid as every 2D object; bloom runs INSIDE the target, at
 * game resolution, so after the integer upscale every 3D pixel is an exact block.
 *
 * @deviation from frame-and-rendering.md section 7: bloom runs INSIDE the 480x270 target (a Three `UnrealBloomPass`), not as a Pixi filter on
 * the `View3D`. The design's default needs `pixi-filters`, which is not installed, and a pass at game resolution keeps every glow pixel on the
 * game grid. Not compared against the Pixi filter. Drift item 13 in docs/spikes/engine-platform.md.
 *
 * Which mode: `auto` uses the shared context, and switches to the canvas copy (with one console
 * warning) if Three's texture handle cannot be found. `Three.properties.get(rt.texture).__webglTexture`
 * is an INTERNAL Three field, so Three is pinned exactly (0.186.1) and a canary test reads it.
 */
import { type Camera, type Scene, Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, Scene as ThreeScene, Vector2, WebGLRenderTarget } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { H, W } from '../core/size';
import type { DisplayHost } from '../display/gameobject';
import { View3D } from '../display/view3d';
import { runAll } from '../core/runall';
import { flipRows, type Pixels } from '../render/backbuffer';
import { CanvasFrameTexture, ExternalFrameTexture } from '../render/frametexture';
import type { GlRenderer } from '../runtime/glrenderer';
import { hostsCreated, ThreeHost } from './threehost';

export type Frame3DMode = 'shared-context' | 'canvas-copy';
/** What a caller asks for. `auto` picks the shared context when it works. */
export type Frame3DPreference = 'auto' | Frame3DMode;

/** UnrealBloomPass settings. The pass runs inside the low-resolution target. */
export interface BloomSettings {
  strength: number;
  radius: number;
  /** Luminance (0 to 1) above which a pixel glows. */
  threshold: number;
}

/** What a frame draws: a Three scene seen by a camera, with optional bloom. */
export interface Frame3DSetup {
  scene: Scene;
  camera: Camera;
  bloom: BloomSettings | null;
}

export interface Frame3D {
  /** Goes into any display list. */
  readonly sprite: View3D;
  readonly mode: Frame3DMode;
  /** One frame: hand the context to Three, draw into the target, hand it back. Does nothing while the context is lost. */
  render(): void;
  /** Re-point Pixi at Three's texture. Needed after a context restore and after any resize of the target. */
  rewrap(): void;
  /** True while the GL context is lost. */
  readonly contextLost: boolean;
  /**
   * The GL context this frame draws with was LOST. Tell Three to drop its records of this frame's GPU
   * objects (the target, the bloom pass), so that a dispose after a restore cannot delete dead handles.
   * Makes no GL call that matters: while the context is lost every call is a no-op. Safe to call twice.
   * See `releaseGpuData` in dispose.ts for the whole story.
   */
  releaseGpuData(): void;
  /** TEST ONLY: the private canvas's context (the canvas-copy fallback), so a test can lose it on purpose. Null in the shared mode. */
  privateContext(): WebGL2RenderingContext | null;
  /** Dev and tests: the 3D picture before Pixi touches it (RGBA, top row first). Slow. */
  readPixels(): Pixels;
  /** Dev and tests: facts about the target, to check "W x H, nearest". */
  describe(): {
    mode: Frame3DMode;
    width: number;
    height: number;
    minFilter: 'nearest' | 'other';
    magFilter: 'nearest' | 'other';
    rewraps: number;
    /** How many Three renderers the page has made so far, by kind. Never more than one of each. */
    hosts: { shared: number; private: number };
  };
  /** Free everything this frame made. Safe to call twice. */
  dispose(): void;
}

/** Three's GL texture for a render target, or null. This reads an INTERNAL Three field (see the note at the top). */
function glTextureOf(host: ThreeHost, target: WebGLRenderTarget): WebGLTexture | null {
  const props = host.renderer.properties.get(target.texture) as { __webglTexture?: unknown } | undefined;
  const tex = props?.__webglTexture;
  return typeof WebGLTexture !== 'undefined' && tex instanceof WebGLTexture ? tex : null;
}

/**
 * TEST ONLY. Set `hideTextureHandle` to make `createFrame3D` act as if Three's texture handle were missing (what a Three upgrade
 * that moves the internal field would cause). The `auto` fall back to the canvas copy is otherwise unreachable with the pinned Three,
 * so a test needs a way to take it. The lab's `hideTextureHandle` hook sets this. Nothing in the game reads or writes it.
 */
export const frame3dTestSeams = { hideTextureHandle: false };

/**
 * Run `build`. If it throws, run `free` first and then throw the same error again. A constructor that
 * throws gives its caller nothing to dispose, so whatever was made BEFORE the throw (here: the render
 * target and the bloom pass's 11 render targets) must be freed by the one who made it.
 * Exported for the unit test (tests/sje-frame3d.test.ts).
 */
export function buildOrFree<T>(free: () => void, build: () => T): T {
  try {
    return build();
  } catch (e) {
    try {
      free();
    } catch (freeError) {
      // The first error is the one that matters. Note the second one and go on.
      console.error('[sje] Frame3D: freeing a half-built frame failed too:', freeError);
    }
    throw e;
  }
}

/**
 * The part both modes share: the nearest render target and the bloom pass. `draw()` renders the scene
 * into the target, then lets the bloom pass add its glow to the same target in place.
 */
class TargetPipeline {
  readonly target: WebGLRenderTarget;
  private readonly bloom: UnrealBloomPass | null;

  constructor(
    private readonly host: ThreeHost,
    private readonly setup: Frame3DSetup,
  ) {
    // NEAREST both ways: Pixi's own `scaleMode` does not reach an externally made texture, so the
    // filter must be set here. W x H exactly, on the same grid as the 2D picture.
    this.target = new WebGLRenderTarget(W, H, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true, generateMipmaps: false });
    let bloom: UnrealBloomPass | null = null;
    try {
      bloom = setup.bloom ? new UnrealBloomPass(new Vector2(W, H), setup.bloom.strength, setup.bloom.radius, setup.bloom.threshold) : null;
      // Make Three allocate the GL texture and framebuffer now, so there is a handle to wrap before the first draw.
      host.renderer.initRenderTarget(this.target);
    } catch (e) {
      // A constructor that throws gives the caller no object to dispose, so free what exists here.
      bloom?.dispose();
      this.target.dispose();
      throw e;
    }
    this.bloom = bloom;
  }

  draw(): void {
    const r = this.host.renderer;
    r.setRenderTarget(this.target);
    r.render(this.setup.scene, this.setup.camera);
    // The pass adds its blurred bright pixels onto the target it is given (it needs no write buffer here).
    if (this.bloom) this.bloom.render(r, this.target, this.target, 0, false);
    r.setRenderTarget(null);
  }

  /** Context lost: let Three forget the GPU data of the target and the pass. Both are still usable: they upload again on the next draw. */
  release(): void {
    this.bloom?.dispose();
    this.target.dispose();
  }

  dispose(): void {
    // The pass owns 11 or more render targets and materials, and `dispose` on it frees them all.
    // (An EffectComposer would NOT free its passes: it leaks 11 textures and 11 framebuffers per entry.)
    this.bloom?.dispose();
    this.target.dispose();
  }
}

/** Facts the two modes share. */
abstract class FrameBase implements Frame3D {
  abstract readonly mode: Frame3DMode;
  abstract readonly sprite: View3D;
  protected rewrapCount = 0;
  protected disposed = false;

  constructor(
    protected readonly gl: GlRenderer,
    protected readonly host: ThreeHost,
    protected readonly pipeline: TargetPipeline,
  ) {}

  abstract render(): void;
  abstract rewrap(): void;
  abstract dispose(): void;

  releaseGpuData(): void {
    if (!this.disposed) this.pipeline.release();
  }

  privateContext(): WebGL2RenderingContext | null {
    return null;
  }

  get contextLost(): boolean {
    return this.gl.glc.lost;
  }

  readPixels(): Pixels {
    const bottomUp = new Uint8Array(W * H * 4);
    this.gl.handoff.withThree(this.host.renderer, () => this.host.renderer.readRenderTargetPixels(this.pipeline.target, 0, 0, W, H, bottomUp));
    return { w: W, h: H, data: flipRows(bottomUp, W, H) };
  }

  describe(): ReturnType<Frame3D['describe']> {
    const t = this.pipeline.target;
    return {
      mode: this.mode,
      width: t.width,
      height: t.height,
      minFilter: t.texture.minFilter === NearestFilter ? 'nearest' : 'other',
      magFilter: t.texture.magFilter === NearestFilter ? 'nearest' : 'other',
      rewraps: this.rewrapCount,
      hosts: { ...hostsCreated },
    };
  }
}

/** Primary: the render target's GL texture, wrapped for Pixi. */
class SharedContextFrame extends FrameBase {
  readonly mode = 'shared-context';
  readonly sprite: View3D;
  private readonly wrapper: ExternalFrameTexture;
  private stale = false;
  private readonly onRestored = (): void => {
    // Do NOT rewrap here. This runs inside the browser's `webglcontextrestored` dispatch, and Three's
    // own listener may not have run yet, so its state is still the old one. The next `render` does it.
    this.stale = true;
  };

  constructor(gl: GlRenderer, host: ThreeHost, pipeline: TargetPipeline, texture: WebGLTexture, scene: DisplayHost) {
    super(gl, host, pipeline);
    this.wrapper = new ExternalFrameTexture(gl.pixi, texture, W, H);
    // The wrapper is Pixi's. If the sprite cannot be made, free the wrapper (the caller frees the pipeline).
    const wrapper = this.wrapper;
    this.sprite = buildOrFree(() => wrapper.destroy(), () => new View3D(scene, wrapper));
    gl.glc.on('restored', this.onRestored);
  }

  render(): void {
    if (this.disposed || this.contextLost) return;
    if (this.stale) this.rewrap();
    this.gl.handoff.withThree(this.host.renderer, () => this.pipeline.draw());
  }

  rewrap(): void {
    if (this.disposed || this.contextLost) return;
    this.gl.handoff.withThree(this.host.renderer, () => this.host.renderer.initRenderTarget(this.pipeline.target));
    const tex = glTextureOf(this.host, this.pipeline.target);
    if (!tex) throw new Error('Frame3D: Three has no GL texture for its render target after a restore');
    this.wrapper.rewrap(tex);
    this.stale = false;
    this.rewrapCount++;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.glc.off('restored', this.onRestored);
    // Order matters: the sprite and Pixi's wrapper first, then Three's texture (the wrapper never deletes it).
    // Each step runs even when the one before it threw (see `runAll`).
    runAll([() => this.sprite.destroy(), () => this.wrapper.destroy(), () => this.gl.handoff.withThree(this.host.renderer, () => this.pipeline.dispose())]);
  }
}

/** Fallback: draw the target onto a private canvas, and let Pixi upload that canvas. */
class CanvasCopyFrame extends FrameBase {
  readonly mode = 'canvas-copy';
  readonly sprite: View3D;
  private readonly wrapper: CanvasFrameTexture;
  // The copy: one full-screen quad that shows the target, drawn to the private canvas.
  private readonly copyScene = new ThreeScene();
  private readonly copyCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly copyMesh: Mesh;

  constructor(gl: GlRenderer, host: ThreeHost, pipeline: TargetPipeline, scene: DisplayHost) {
    super(gl, host, pipeline);
    const wrapper = new CanvasFrameTexture(host.canvas);
    this.wrapper = wrapper;
    this.sprite = buildOrFree(() => wrapper.destroy(), () => new View3D(scene, wrapper));
    const sprite = this.sprite;
    const geometry = new PlaneGeometry(2, 2);
    this.copyMesh = buildOrFree(
      () => {
        sprite.destroy();
        wrapper.destroy();
        geometry.dispose();
      },
      () => new Mesh(geometry, new MeshBasicMaterial({ map: pipeline.target.texture, toneMapped: false, depthTest: false, depthWrite: false })),
    );
    this.copyScene.add(this.copyMesh);
  }

  override get contextLost(): boolean {
    // Two contexts matter here: the engine's (Pixi must draw) and the private one (Three must draw).
    return this.gl.glc.lost || this.host.renderer.getContext().isContextLost();
  }

  render(): void {
    if (this.disposed || this.contextLost) return;
    const r = this.host.renderer;
    // The private context is NOT the engine's, so no hand-off is needed: Pixi's GL state is untouched.
    this.pipeline.draw();
    r.setRenderTarget(null);
    r.render(this.copyScene, this.copyCamera);
    // Pixi uploads the canvas when it draws, later in this same task (a WebGL canvas is only valid until the browser paints).
    this.wrapper.update();
  }

  rewrap(): void {
    // Nothing to re-point: Pixi re-uploads the canvas every frame.
    this.rewrapCount++;
  }

  override releaseGpuData(): void {
    if (this.disposed) return;
    super.releaseGpuData();
    this.copyMesh.geometry.dispose();
    (this.copyMesh.material as MeshBasicMaterial).dispose();
  }

  override privateContext(): WebGL2RenderingContext | null {
    return this.host.renderer.getContext() as WebGL2RenderingContext;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    runAll([
      () => this.sprite.destroy(),
      () => this.wrapper.destroy(),
      () => this.copyMesh.geometry.dispose(),
      () => (this.copyMesh.material as MeshBasicMaterial).dispose(),
      () => this.pipeline.dispose(),
    ]);
  }

  // Reading the target needs no hand-off here: the private renderer is the only one that touches it.
  override readPixels(): Pixels {
    const bottomUp = new Uint8Array(W * H * 4);
    this.host.renderer.readRenderTargetPixels(this.pipeline.target, 0, 0, W, H, bottomUp);
    return { w: W, h: H, data: flipRows(bottomUp, W, H) };
  }
}

/**
 * Make a `Frame3D`. `preference` `auto` tries the shared context first; if Three's texture handle is
 * missing (an internal field that a Three upgrade could move) it logs once and uses the canvas copy.
 */
export function createFrame3D(gl: GlRenderer, scene: DisplayHost, setup: Frame3DSetup, preference: Frame3DPreference = 'auto'): Frame3D {
  if (preference !== 'canvas-copy') {
    const host = ThreeHost.shared(gl);
    const pipeline = gl.handoff.withThree(host.renderer, () => new TargetPipeline(host, setup));
    const freePipeline = (): void => gl.handoff.withThree(host.renderer, () => pipeline.dispose());
    const tex = frame3dTestSeams.hideTextureHandle ? null : glTextureOf(host, pipeline.target);
    // If the frame cannot be built, the pipeline (the target and the bloom pass) is freed here, not leaked.
    if (tex) return buildOrFree(freePipeline, () => new SharedContextFrame(gl, host, pipeline, tex, scene));
    freePipeline();
    if (preference === 'shared-context') throw new Error('Frame3D: Three has no GL texture handle for its render target (the shared-context mode needs it)');
    console.warn('[sje] Frame3D: the shared-context texture handle is missing, using the canvas copy');
  }
  const host = ThreeHost.privateCopy(gl);
  const pipeline = new TargetPipeline(host, setup);
  return buildOrFree(() => pipeline.dispose(), () => new CanvasCopyFrame(gl, host, pipeline, scene));
}
