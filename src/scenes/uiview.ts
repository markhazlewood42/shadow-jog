/**
 * ViewBuilder: the little helper that the menu and deck scenes (M8b phase 3) use to fill a `Container` with kit parts.
 *
 * The old scenes drew each screen again every frame with `drawWindow`, `drawText` and the like. A native scene keeps display objects instead. For a
 * screen that has many small pieces (the status page, the bestiary, a party card), the scene keeps ONE container for the page and builds it again
 * only when what it shows changes: `box.removeAll(true)`, then the calls below. Each call makes one kit part (`NineSlice`, `TextObject`, `Bar`)
 * and adds it to the box, so the scene's code reads like the old draw code did, one line per thing on screen.
 *
 * It holds no game state and copies no kit logic: every window, text and bar is the kit's own class. Only the two plain `Graphics` that the
 * rubric allows are made here (the divider and the select highlight), and a canvas picture is for art only.
 */
import { Bar, CanvasImage, type Container, type DisplayHost, Graphics, layoutText, NineSlice, TextObject, type TextStyle, type WindowStyle } from '../sje';

/** The style of a paragraph: its color and the distance between lines (the old `drawParagraph` options). */
export interface ParaStyle {
  color?: string;
  lineH?: number;
}

export class ViewBuilder {
  constructor(private readonly scene: DisplayHost, readonly box: Container) {}

  /** A window frame. */
  win(x: number, y: number, w: number, h: number, style: WindowStyle = {}): NineSlice {
    const n = new NineSlice(this.scene, x, y, w, h, style);
    this.box.add(n);
    return n;
  }

  /** One line of text, placed as `drawText(ctx, str, x, y, style)` placed it. */
  text(x: number, y: number, str: string, style: TextStyle = {}): TextObject {
    const t = new TextObject(this.scene, x, y, str, style);
    this.box.add(t);
    return t;
  }

  /** Wrapped text, as `drawParagraph` drew it. Returns the number of lines it takes, so the next block can start below it. */
  para(str: string, x: number, y: number, w: number, style: ParaStyle = {}): number {
    const s: TextStyle = { wrapWidth: w, lineHeight: style.lineH ?? 10 };
    if (style.color !== undefined) s.color = style.color;
    this.box.add(new TextObject(this.scene, x, y, str, s));
    return layoutText(str, s).lines.length;
  }

  /** The thin two-tone line between the sections of a page (the old `drawDivider`). One of the three plain Graphics the kit allows. */
  divider(x: number, y: number, w: number): void {
    const g = new Graphics(this.scene, 0, 0).fillStyle(0x2c2a58, 1).fillRect(x, y, w, 1).fillStyle(0x0a0918, 1).fillRect(x, y + 1, w, 1);
    g.name = 'divider';
    this.box.add(g);
  }

  /** The selection tint behind a chosen card (the old `drawSelect`). One of the three plain Graphics the kit allows. */
  select(x: number, y: number, w: number, h: number, alpha: number): void {
    const g = new Graphics(this.scene, 0, 0).fillStyle(0x3fe0f0, alpha).fillRect(x, y, w, h);
    g.name = 'select';
    this.box.add(g);
  }

  /** A flat one-color plate or chip: one kit `Graphics` fill, not a picture of its own (the `rect` ops of `uiops.ts`). `color` is 0xRRGGBB. */
  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): Graphics {
    const g = new Graphics(this.scene, 0, 0).fillStyle(color, alpha).fillRect(x, y, w, h);
    g.name = 'plate';
    this.box.add(g);
    return g;
  }

  /** A bar (the kit's `Bar`, the same pixels as the old `drawBar`). */
  bar(x: number, y: number, w: number, h: number, ratio: number, color: string): Bar {
    const b = new Bar(this.scene, x, y, w, h, color, ratio);
    this.box.add(b);
    return b;
  }

  /**
   * A canvas picture, for ART (a portrait, a character sprite, a boss portrait box) . Drawn with smoothing off, as the game's own canvas was. A plate that is semi-clear and on the field is NOT made here: the field parity pictures pin its
   * blend (see `fieldkit/hud.ts`).
   */
  pic(x: number, y: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasImage {
    const img = new CanvasImage(this.scene, x, y, w, h);
    img.ctx.imageSmoothingEnabled = false;
    draw(img.ctx);
    img.refresh();
    this.box.add(img);
    return img;
  }
}
