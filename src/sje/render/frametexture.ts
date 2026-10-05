/**
 * FrameTexture: a picture that ANOTHER library draws (Three.js), shown by Pixi as an ordinary
 * texture (docs/engine/frame-and-rendering.md 7.1 and 7.2, decision E3).
 *
 * Two ways in, behind one small interface:
 *
 *  - `ExternalFrameTexture`   the primary way. Three renders into a `WebGLRenderTarget` on the SAME
 *                             WebGL context as Pixi. Pixi wraps that render target's GL texture in an
 *                             `ExternalSource`: no copy, no upload.
 *  - `CanvasFrameTexture`     the fallback. Three renders on its OWN canvas (a second context).
 *                             Pixi uploads that canvas each frame through a `CanvasSource`.
 *
 * Why this file exists at level 1: Pixi types may only appear under src/sje/render and
 * src/sje/display. The 3D chunk (src/sje/three) needs to hand a texture to Pixi, so it does it
 * through these two classes and never names a Pixi type.
 *
 * Scale mode: Pixi's `scaleMode` does NOT reach an `ExternalSource` (research finding 4: the style
 * listener is only registered for sources Pixi uploaded itself). The 3D picture is sampled with
 * whatever filter Three set on its render target, so the Three side must be `NearestFilter`.
 * `Frame3D` sets it and the e2e spec checks it. We still set `scaleMode` here, so a future Pixi that
 * does honour it agrees.
 */
import { CanvasSource, ExternalSource, Texture } from 'pixi.js';
import type { PixiRenderer } from './pixirenderer';

export interface FrameTexture {
  /** @internal The Pixi texture. For src/sje/display only (`View3D`). */
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
  /**
   * True when the picture is stored upside down for Pixi. A GL render target keeps its first row at
   * the BOTTOM of the picture; a canvas keeps it at the top. `View3D` mirrors the sprite when true.
   */
  readonly flipY: boolean;
  /** Free the Pixi side. The other library frees its own picture (`WebGLRenderTarget.dispose`). */
  destroy(): void;
}

/** A GL texture that Three owns, wrapped for Pixi. */
export class ExternalFrameTexture implements FrameTexture {
  readonly texture: Texture;
  readonly flipY = true;
  private readonly source: ExternalSource;
  private destroyed = false;

  constructor(
    pixi: PixiRenderer,
    glTexture: WebGLTexture,
    readonly width: number,
    readonly height: number,
  ) {
    this.source = new ExternalSource({ resource: glTexture, renderer: pixi.renderer, width, height, label: 'frame3d' });
    this.source.scaleMode = 'nearest';
    this.texture = new Texture({ source: this.source, label: 'frame3d' });
  }

  /**
   * Point at a NEW GL texture. Three makes a new one after a context restore and after any resize of
   * the render target, and the old wrapper then points at nothing (lab: 125,088 wrong pixels).
   */
  rewrap(glTexture: WebGLTexture): void {
    if (this.destroyed) return;
    this.source.updateGPUTexture(glTexture, this.width, this.height);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // The texture first (it listens to its source), then the source. `ExternalSource.destroy` forgets
    // the GL texture without deleting it: Three owns it and deletes it in `WebGLRenderTarget.dispose`.
    this.texture.destroy(false);
    this.source.destroy();
  }
}

/** A canvas that Three draws on, uploaded to Pixi each frame. */
export class CanvasFrameTexture implements FrameTexture {
  readonly texture: Texture;
  readonly flipY = false;
  private readonly source: CanvasSource;
  private destroyed = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.source = new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'nearest', label: 'frame3d-copy' });
    this.texture = new Texture({ source: this.source, label: 'frame3d-copy' });
  }

  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }

  /** Upload the canvas again. Call it after Three drew, in the same task as the draw. */
  update(): void {
    if (!this.destroyed) this.source.update();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.texture.destroy(false);
    this.source.destroy();
  }
}
