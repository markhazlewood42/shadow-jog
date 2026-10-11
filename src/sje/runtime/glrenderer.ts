/**
 * GlRenderer: the real way a frame reaches the canvas. It joins the level 1 parts:
 * GlContext, PixiRenderer, BackBuffer, Presenter and GlHandoff
 * (docs/engine/frame-and-rendering.md section 6.2).
 *
 *   per frame:  GlHandoff.beginPixi()            Pixi forgets its cached GL state
 *               beforeDraw                       the effects' own render textures (the bloom), when there are effects
 *               screen -> BackBuffer (640x360)   every filter runs in here, at game resolution
 *               BackBuffer -> canvas             one nearest sprite, whole-number scale k
 *
 * A test can give `Game` a different `FrameRenderer` (one that draws nothing), so the scene stack
 * and the loop are testable in Node with no browser and no GPU.
 */
import type { Screen } from '../display/screen';
import { BackBuffer, type Pixels } from '../render/backbuffer';
import { createGlContext, type GlContext } from '../render/glcontext';
import { GlHandoff } from '../render/glhandoff';
import { PixiRenderer } from '../render/pixirenderer';
import { deviceSize, type PictureLayout, Presenter } from '../render/presenter';

/** Whatever draws the screen root. `Game` calls it once per frame. */
export interface FrameRenderer {
  render(screen: Screen): void;
  /** True while the renderer cannot draw (a lost WebGL context). A renderer that can never lose its context leaves this out. */
  readonly contextLost?: boolean;
  /** Dev and tests only (`Game.destroyForTests`). A renderer with nothing to free leaves this out. */
  destroyForTests?(): void;
}

export class GlRenderer implements FrameRenderer {
  /**
   * Called every frame after Pixi forgot its cached GL state and before it draws the screen: the effects draw their own render textures here
   * (the light and the blur of the bloom), so the composite filter finds them ready. Null with no effects.
   */
  beforeDraw: ((pixi: PixiRenderer) => void) | null = null;

  private constructor(
    readonly glc: GlContext,
    readonly pixi: PixiRenderer,
    readonly backBuffer: BackBuffer,
    readonly presenter: Presenter,
    readonly handoff: GlHandoff,
  ) {}

  /** Make the canvas context and the Pixi renderer. Throws a plain message when there is no WebGL2 (E5: the page shows it, with a hint line, under "failed to start"). */
  static async create(canvas: HTMLCanvasElement): Promise<GlRenderer> {
    const glc = createGlContext(canvas);
    if (!glc) throw new Error('This browser cannot run WebGL 2, which the game needs. Try a current Chrome, Edge, Firefox or Safari.\nYour browser’s WebGL 2 may be turned off in its settings.');
    const pixi = await PixiRenderer.create(glc);
    const backBuffer = new BackBuffer(pixi);
    const handoff = new GlHandoff(glc.gl, pixi);
    const presenter = new Presenter(pixi, backBuffer, handoff);
    return new GlRenderer(glc, pixi, backBuffer, presenter, handoff);
  }

  /** The canvas (what `Display` resizes: the `ScaleTarget` of display.ts). */
  get canvas(): HTMLCanvasElement {
    return this.glc.canvas;
  }

  get contextLost(): boolean {
    return this.glc.lost;
  }

  render(screen: Screen): void {
    // While the context is lost nothing can be drawn. Pixi does not throw, but there is no point.
    // After it comes back, the next frame redraws everything: the back buffer is rebuilt every frame
    // and Pixi uploads the canvas textures again from their CPU copies.
    if (this.glc.lost) return;
    this.handoff.beginPixi();
    this.beforeDraw?.(this.pixi);
    screen.drawInto(this.backBuffer);
    this.presenter.present();
  }

  /**
   * Size the canvas to the WHOLE WINDOW in device pixels, and put the 640x360 picture in it at the
   * largest whole-number scale that fits, on a whole device pixel. Returns `k`. Draw a frame
   * afterwards: resizing clears the canvas. `Display` (display.ts) calls this.
   *
   * Why the whole window (spike finding 10): the browser shows a canvas 1:1 only when the canvas
   * backing store has exactly as many pixels as the box it fills. A window is always a whole number
   * of device pixels, so a canvas that fills it is exact at EVERY device pixel ratio. A canvas the
   * size of the picture (W*k, shown at W*k/dpr CSS pixels) is not: at ratio 2.25 and zoom 7 that is
   * 1493.33... CSS pixels, which layout cannot hold, and the browser drew 2651 uneven blocks.
   *
   * The canvas's parent must be positioned (fixed, absolute or relative) and fill the window.
   * `observed` is the size the browser reports for the canvas box in device pixels
   * (`devicePixelContentBoxSize`), when it has one: see `deviceSize`.
   */
  fitToWindow(viewW: number, viewH: number, dpr: number, observed?: { w: number; h: number }): number {
    const device = deviceSize(viewW, viewH, dpr, observed);
    const layout = this.presenter.setCanvasSize(device.w, device.h);
    const style = this.glc.canvas.style;
    style.position = 'absolute';
    style.left = '0px';
    style.top = '0px';
    style.width = '100%';
    style.height = '100%';
    // The canvas is 1:1 with the screen, so no resampling happens. If a browser zoom still scales it, it must not smooth the blocks.
    style.imageRendering = 'pixelated';
    return layout.k;
  }

  /** Where the picture is in the canvas, in device pixels. */
  get picture(): PictureLayout {
    return this.presenter.layout;
  }

  /** Dev and tests only. Production never destroys the renderer: it would lose a context Three shares. `Game.destroyForTests` calls this. */
  destroyForTests(): void {
    this.destroy();
  }

  /** Dev and tests only. Production never destroys the renderer: it would lose a context Three shares. */
  destroy(): void {
    this.backBuffer.destroy();
    this.pixi.renderer.destroy();
    this.glc.canvas.remove();
  }

  /** Read the back buffer to the CPU. Dev and tests only. */
  readBackBuffer(): Pixels {
    // Anything may have used the context since Pixi last drew (Three, a raw read): Pixi forgets its cached state first.
    this.handoff.beginPixi();
    return this.backBuffer.pixels();
  }
}
