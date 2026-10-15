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

/** Make the kit parts for `ops` in `box`, in order. */
export function applyOps(host: DisplayHost, box: Container, ops: readonly Op[]): void {
  const b = new ViewBuilder(host, box);
  for (const o of ops) {
    switch (o.k) {
      case 'win':
        b.win(Math.round(o.x), Math.round(o.y), o.w, o.h, o.style);
        break;
      case 'rect':
        // A flat plate or a colored chip under kit text: a one-color picture (the kit has no flat-plate part; the battle default-path picture pins these pixels).
        b.pic(Math.round(o.x), Math.round(o.y), o.w, o.h, (c) => {
          c.fillStyle = o.color;
          c.fillRect(0, 0, o.w, o.h);
        });
        break;
      case 'text':
        b.text(Math.round(o.x), Math.round(o.y), o.s, o.style);
        break;
      case 'bar': {
        const params: Partial<BarParams> = {};
        if (o.back !== undefined) params.back = o.back;
        if (o.shine !== undefined) params.shineAlpha = o.shine;
        const bar = new Bar(host, Math.round(o.x), Math.round(o.y), o.w, o.h, o.color, o.fill / o.w, params);
        if (o.lag > o.fill) bar.setGhost({ ratio: o.lag / o.w, color: LAG_COLOR });
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
