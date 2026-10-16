/**
 * The plain-data part of the battle's windows (M8c group G).
 *
 * A window, a text, a bar or a face on the battle's screen is described here as one `Op`: a small plain object. The HUD (`hud.ts`) works out the ops of a
 * box (a party card, an enemy's status, the target box) from the scene's state, and `applyOps` makes the kit parts for them. The ops are also the KEY of
 * the box: two ticks that give the same ops show the same box, so the HUD builds it again only when the JSON of its ops changes. This is the rule of
 * `uiview.ts` (the menus of M8b), with the data kept apart from the objects so a test can read what a box shows without a GPU.
 *
 * Numbers in an op are what is SHOWN, in whole pixels: a bar carries its fill in pixels, not a ratio. A bar that eases toward a value changes the key
 * only when its pixels change, not every tick.
 */
import { getPortrait } from '../art/portraits';
import { Bar, type BarParams, type Container, type DisplayHost, type TextStyle, UI, type WindowStyle } from '../sje';
import { ViewBuilder } from './uiview';

/** The pale color of a bar's damage ghost (the old `drawLag`). */
export const LAG_COLOR = '#ffd7c0';

export type Op =
  | { k: 'win'; x: number; y: number; w: number; h: number; style: WindowStyle }
  | { k: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { k: 'text'; x: number; y: number; s: string; style: TextStyle }
  | { k: 'bar'; x: number; y: number; w: number; h: number; fill: number; lag: number; color: string; back?: string; shine?: number }
  | { k: 'face'; x: number; y: number; who: string; face: string; down: boolean };

/** The fill of a bar in whole pixels, and its damage ghost (0 when the ghost does not reach past the fill): the arithmetic of the old `drawBar` and `drawLag`. */
export function barPixels(w: number, shown: number, lag: number): { fill: number; lag: number } {
  const fill = Math.round(w * Math.max(0, Math.min(1, shown)));
  if (lag <= shown + 0.004) return { fill, lag: 0 };
  const b = Math.round(w * Math.min(1, lag));
  return { fill, lag: b > Math.round(w * Math.max(0, shown)) ? b : 0 };
}

/** A CSS color of the `rect` ops (`#rgb`, `#rrggbb` or `rgba(r,g,b,a)`) as a 0xRRGGBB number and an alpha. Anything else throws: a wrong color is a mistake, not a silent black. */
export function rectColor(css: string): { color: number; alpha: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { color: Number.parseInt(h, 16), alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(css);
  if (rgba) {
    const [r = 0, g = 0, b = 0] = [rgba[1], rgba[2], rgba[3]].map((v) => Math.min(255, Number(v)));
    return { color: (r << 16) | (g << 8) | b, alpha: rgba[4] === undefined ? 1 : Math.min(1, Number(rgba[4])) };
  }
  throw new Error(`a rect color must be #rgb, #rrggbb or rgba(r,g,b,a), got "${css}"`);
}

/** Make the kit parts for `ops` in `box`, in order. */
export function applyOps(host: DisplayHost, box: Container, ops: readonly Op[]): void {
  const b = new ViewBuilder(host, box);
  for (const o of ops) {
    switch (o.k) {
      case 'win':
        b.win(Math.round(o.x), Math.round(o.y), o.w, o.h, o.style);
        break;
      case 'rect': {
        // A flat plate or a colored chip under kit text: one `Graphics` fill (the same pixels as the old one-color picture).
        const c = rectColor(o.color);
        b.rect(Math.round(o.x), Math.round(o.y), o.w, o.h, c.color, c.alpha);
        break;
      }
      case 'text':
        b.text(Math.round(o.x), Math.round(o.y), o.s, o.style);
        break;
      case 'bar': {
        const params: Partial<BarParams> = {};
        if (o.back !== undefined) params.back = o.back;
        if (o.shine !== undefined) params.shineAlpha = o.shine;
        // A bar of width 0 shows an empty bar, not NaN.
        const ratio = (v: number): number => (o.w > 0 ? v / o.w : 0);
        const bar = new Bar(host, Math.round(o.x), Math.round(o.y), o.w, o.h, o.color, ratio(o.fill), params);
        if (o.lag > o.fill) bar.setGhost({ ratio: ratio(o.lag), color: LAG_COLOR });
        box.add(bar);
        break;
      }
      case 'face':
        // A portrait in its dark frame (the old outline square and the 24 px image); a downed member's face is dimmed.
        b.pic(Math.round(o.x), Math.round(o.y), 26, 26, (c) => {
          c.fillStyle = UI.outline;
          c.fillRect(0, 0, 26, 26);
          const port = getPortrait(o.who, o.face);
          if (port) {
            if (o.down) c.globalAlpha = 0.35;
            c.drawImage(port, 1, 1, 24, 24);
            c.globalAlpha = 1;
          }
        });
        break;
    }
  }
}
