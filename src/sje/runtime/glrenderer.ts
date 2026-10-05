/**
 * GlRenderer: the real way a frame reaches the canvas. It joins the level 1 parts:
 * GlContext, PixiRenderer, BackBuffer, Presenter and GlHandoff
 * (docs/engine/frame-and-rendering.md section 6.2).
 *
 *   per frame:  GlHandoff.beginPixi()            Pixi forgets its cached GL state
 *               screen -> BackBuffer (480x270)   every filter runs in here, at game resolution
 *               BackBuffer -> canvas             one nearest sprite, whole-number scale k
 *
 * A test can give `Game` a different `FrameRenderer` (one that draws nothing), so the scene stack
 * and the loop are testable in Node with no browser and no GPU.
 */
import { H, W } from '../core/size';
import type { Screen } from '../display/screen';
import { BackBuffer, type Pixels } from '../render/backbuffer';
import { createGlContext, type GlContext } from '../render/glcontext';
import { GlHandoff } from '../render/glhandoff';
import { PixiRenderer } from '../render/pixirenderer';
import { alignedOffset, integerScale, Presenter } from '../render/presenter';

/** Whatever draws the screen root. `Game` calls it once per frame. */
export interface FrameRenderer {
  render(screen: Screen): void;
}

export class GlRenderer implements FrameRenderer {
  private constructor(
    readonly glc: GlContext,
    readonly pixi: PixiRenderer,
    readonly backBuffer: BackBuffer,
    readonly presenter: Presenter,
    readonly handoff: GlHandoff,
  ) {}

  /** Make the canvas context and the Pixi renderer. Throws a plain message when there is no WebGL2. */
  static async create(canvas: HTMLCanvasElement): Promise<GlRenderer> {
    const glc = createGlContext(canvas);
    if (!glc) throw new Error('This browser cannot run WebGL 2, which the game needs. Try a current Chrome, Edge, Firefox or Safari.');
    const pixi = await PixiRenderer.create(glc);
    const backBuffer = new BackBuffer(pixi);
    const presenter = new Presenter(pixi, backBuffer);
    return new GlRenderer(glc, pixi, backBuffer, presenter, new GlHandoff(glc.gl, pixi));
  }

  render(screen: Screen): void {
    // While the context is lost nothing can be drawn. Pixi does not throw, but there is no point.
    // After it comes back, the next frame redraws everything: the back buffer is rebuilt every frame
    // and Pixi uploads the canvas textures again from their CPU copies.
    if (this.glc.lost) return;
    this.handoff.beginPixi();
    screen.drawInto(this.backBuffer);
    this.presenter.present();
  }

  /**
   * Choose the whole-number scale for a window of `viewW` x `viewH` CSS pixels at `dpr`, resize the
   * canvas to W*k x H*k DEVICE pixels, size its CSS box to the same device pixels, and centre it on
   * a whole device pixel. Returns k. Stand-in for `Display` (M1). Draw a frame afterwards: resizing
   * clears the canvas.
   *
   * Why the centring is done here and not by CSS: at a device pixel ratio like 1.5, a canvas centred
   * by flexbox can start half a device pixel in. The browser then resamples it, and some game pixels
   * come out one device pixel wider than others (measured by e2e/sjelab.spec.ts). The canvas's
   * parent must be positioned (fixed, absolute or relative) and fill the view.
   */
  fitToWindow(viewW: number, viewH: number, dpr: number): number {
    const k = integerScale(viewW, viewH, dpr);
    this.presenter.setScale(k);
    const style = this.glc.canvas.style;
    style.width = `${(W * k) / dpr}px`;
    style.height = `${(H * k) / dpr}px`;
    style.position = 'absolute';
    // Offsets are whole numbers of device pixels (see alignedOffset). A window smaller than the picture pins it to the corner.
    style.left = `${alignedOffset(viewW - (W * k) / dpr, dpr)}px`;
    style.top = `${alignedOffset(viewH - (H * k) / dpr, dpr)}px`;
    // Pixi sets no image-rendering. With a whole-number k there is no resampling, but a browser
    // that zooms the page must still not smooth the blocks.
    style.imageRendering = 'pixelated';
    return k;
  }

  /** Dev and tests only. Production never destroys the renderer: it would lose a context Three shares. */
  destroy(): void {
    this.backBuffer.destroy();
    this.pixi.renderer.destroy();
    this.glc.canvas.remove();
  }

  /** Read the back buffer to the CPU. Dev and tests only. */
  readBackBuffer(): Pixels {
    return this.backBuffer.pixels();
  }
}
