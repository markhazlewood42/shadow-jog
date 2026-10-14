/**
 * TextObject: a string in the game's bitmap font, as a display object (UI kit, M8a; docs/engine/interfaces.md `TextObject`).
 * Follows: Phaser `Text`, but the glyphs are the game's own pixel font (`display/font.ts`), not a browser font. The name has a suffix
 * so it does not shadow the DOM global `Text`.
 *
 * How it works: the text is drawn with `drawText` into a small canvas that the object owns, and an image shows the canvas. A new string, or a new
 * style, paints again (the same canvas when the size is the same, a new one when it is not). Setting the same string and style again does nothing, so a
 * scene can call `setText` every tick for free. Control codes (`{c}`, `{/}`, `{p}`) work as in `drawText`.
 *
 * x,y is where the first glyph's top-left lands for a left-aligned text, as in `drawText(ctx, text, x, y)`. For `center` and `right` it is the
 * middle and the right edge of each line.
 *
 * Built (principle 6: only what a scene calls): `color`, `shadow`, `align`, `max` (the typewriter) and word wrap (`wrapWidth`, `lineHeight`: `drawParagraph`).
 * @deviation from interfaces.md: `shadow` is the shadow's COLOR (or `false`), as in `drawText`, not a boolean. `outline` and `scale` are not built (no scene
 * uses them; the battle HUD draws its own outlined numbers in `hudkit.ts`).
 */
import { drawText, GLYPH_H, LINE_H, measure, SHADOW, TEXT, visibleLength, wrap } from '../display/font';
import type { DisplayHost } from '../display/gameobject';
import { ImageObject } from '../display/imageobject';
import { OwnedTexture } from './ownedtexture';

export interface TextStyle {
  /** Base color of the text (default: the game's text white). Control codes inside the string still change it. */
  color?: string | undefined;
  /** The drop shadow's color, or `false` for none. Default: the game's dark shadow. */
  shadow?: string | false | undefined;
  align?: 'left' | 'center' | 'right' | undefined;
  /** Typewriter: draw only this many visible characters. */
  max?: number | undefined;
  /** Word wrap to this width in pixels (`wrap`); without it the text is one line. */
  wrapWidth?: number | undefined;
  /** The distance between two wrapped lines. Default: the game's line height (10). */
  lineHeight?: number | undefined;
}

/** Where each line goes and how big the picture is, worked out without a canvas (so a test, or a layout check, can use it). */
export interface TextLayout {
  lines: string[];
  /** The picture's size in pixels. */
  w: number;
  h: number;
  /** Where the anchor (the object's x,y) is inside the picture. */
  ax: number;
  /** Each line's left edge inside the picture, and its width. */
  xs: number[];
  widths: number[];
  lineHeight: number;
  shadow: string | false;
}

export function layoutText(text: string, style: TextStyle = {}): TextLayout {
  const lines = style.wrapWidth !== undefined ? wrap(text, style.wrapWidth) : [text];
  const lineHeight = style.lineHeight ?? LINE_H;
  const shadow = style.shadow === undefined ? SHADOW : style.shadow;
  const align = style.align ?? 'left';
  const widths = lines.map((l) => measure(l));
  // A line's left edge relative to the anchor: `drawText` puts a centered line at x - floor(w / 2) and a right-aligned one at x - w.
  const rel = widths.map((w) => (align === 'left' ? 0 : align === 'center' ? 0 - Math.floor(w / 2) : 0 - w));
  const pad = shadow ? 1 : 0;
  const minX = Math.min(0, ...rel);
  const maxX = Math.max(1, ...rel.map((r, i) => r + (widths[i] ?? 0) + pad));
  return {
    lines,
    w: maxX - minX,
    h: (lines.length - 1) * lineHeight + GLYPH_H + pad,
    ax: 0 - minX,
    xs: rel.map((r) => r - minX),
    widths,
    lineHeight,
    shadow,
  };
}

/** Paint a layout onto a canvas context, with the anchor at (0, 0) of the canvas' own top-left plus the layout's offsets. */
export function paintText(ctx: CanvasRenderingContext2D, lay: TextLayout, style: TextStyle = {}): void {
  let remaining = style.max ?? Number.POSITIVE_INFINITY;
  lay.lines.forEach((ln, i) => {
    if (remaining <= 0) return;
    drawText(ctx, ln, lay.xs[i] ?? 0, i * lay.lineHeight, { color: style.color ?? TEXT, shadow: lay.shadow, max: remaining });
    remaining -= visibleLength(ln);
  });
}

export class TextObject extends ImageObject {
  private readonly owned: OwnedTexture;
  private _text: string;
  private _style: TextStyle;
  private lay: TextLayout;

  constructor(scene: DisplayHost, x: number, y: number, text = '', style: TextStyle = {}) {
    const lay = layoutText(text, style);
    const tex = new OwnedTexture(scene.textures, 'ui-text', lay.w, lay.h);
    super(scene, x, y, tex.key);
    this.owned = tex;
    this._text = text;
    this._style = { ...style };
    this.lay = lay;
    this.name = 'text';
    this.paint(true);
  }

  get text(): string {
    return this._text;
  }
  get style(): Readonly<TextStyle> {
    return this._style;
  }
  /** The text's lines (one, unless `wrapWidth` is set). */
  get lines(): readonly string[] {
    return this.lay.lines;
  }
  /** The width in pixels of the widest line, as `measure` gives it (without the shadow's extra pixel). */
  get textWidth(): number {
    return Math.max(0, ...this.lay.widths);
  }

  /** Change the string. The same string does nothing. */
  setText(s: string): this {
    this.assertAlive('TextObject.setText');
    if (s === this._text) return this;
    this._text = s;
    this.paint(false);
    return this;
  }

  /** Change some of the style (the keys you give; the rest stay). A key given as `undefined` goes back to its default. */
  setStyle(patch: TextStyle): this {
    this.assertAlive('TextObject.setStyle');
    // Fast path: every key given already has this value (a list sets its colors every tick).
    if ((Object.keys(patch) as (keyof TextStyle)[]).every((k) => patch[k] === this._style[k])) return this;
    const next: TextStyle = { ...this._style, ...patch };
    for (const k of Object.keys(next) as (keyof TextStyle)[]) if (next[k] === undefined) delete next[k];
    if (sameStyle(next, this._style)) return this;
    this._style = next;
    this.paint(false);
    return this;
  }

  /** Draw the string again. `first`: the picture was just made for this layout, so there is no texture to swap. */
  private paint(first: boolean): void {
    const lay = layoutText(this._text, this._style);
    this.lay = lay;
    const old = this.owned.resize(lay.w, lay.h);
    if (old !== null) {
      this.setTexture(this.owned.key);
      this.owned.drop(old);
    }
    const ctx = this.owned.ctx;
    if (!first || old !== null) ctx.clearRect(0, 0, this.owned.width, this.owned.height);
    paintText(ctx, lay, this._style);
    this.owned.refresh();
    // The anchor: a whole number of pixels inside the picture, whatever the alignment.
    this.setOrigin(lay.ax / this.owned.width, 0);
  }

  protected override destroyNode(): void {
    try {
      super.destroyNode();
    } finally {
      this.owned.dispose();
    }
  }
}

/** Do two styles look the same? A key left out and a key set to its default are the same. */
function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    (a.color ?? TEXT) === (b.color ?? TEXT) &&
    (a.shadow === undefined ? SHADOW : a.shadow) === (b.shadow === undefined ? SHADOW : b.shadow) &&
    (a.align ?? 'left') === (b.align ?? 'left') &&
    a.max === b.max &&
    a.wrapWidth === b.wrapWidth &&
    (a.lineHeight ?? LINE_H) === (b.lineHeight ?? LINE_H)
  );
}
