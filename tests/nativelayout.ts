/**
 * The layout record of a NATIVE scene (M8b). `tests/recorder.ts` records the canvas calls of an old scene. A native scene draws no canvas calls: it builds
 * display objects (a `NineSlice` window, `TextObject` texts, a `ListMenu`, canvas pictures). This file reads those objects after the scene has run, and
 * writes the same `Layout` record, so the four checks of `tests/ui-layout.test.ts` judge both kinds of scene the same way.
 *
 * What it reads (in screen pixels, with the positions of the parent containers added up):
 *   - `NineSlice`  -> a window (its place, its box size, its title);
 *   - `TextObject` -> a text box (the left edge of its first line, its measured width, nine pixels of glyph per line); a `Cursor` is a text;
 *   - `ListMenu`   -> a list (where it starts, its rows) and, through its children, the texts of its rows;
 *   - any other image (a portrait, a character, a canvas picture) -> a `drawImage` box.
 * A `Graphics` (the dim, the select highlight, the divider) is not read: it has no size to report. An object that is not visible is skipped.
 */
import { Container, type GameObject, ImageObject, layoutText, ListMenu, NineSlice, TextObject } from '../src/sje';
import { Layout, type WinRec } from './recorder';

const GLYPH_H = 9;

/** The visible objects of a scene's ui layer, depth first, with the offset of their parents. */
function* walk(list: readonly GameObject[], ox: number, oy: number): Generator<{ o: GameObject; x: number; y: number }> {
  for (const o of list) {
    if (!o.visible) continue;
    yield { o, x: o.x + ox, y: o.y + oy };
    if (o instanceof Container) yield* walk(o.list, o.x + ox, o.y + oy);
  }
}

/** The record of a native scene, as the old recorder would have written it. */
export function layoutOfNative(ui: Container): Layout {
  const l = new Layout();
  const items = [...walk(ui.list, 0, 0)];
  // First the windows, in the order they draw, so a later one owns a point (as `Layout.windowAt` expects).
  for (const { o, x, y } of items) {
    if (!(o instanceof NineSlice)) continue;
    l.windows.push({ id: l.windows.length, x: Math.round(x), y: Math.round(y), w: o.boxW, h: o.boxH, plain: !!o.style.plain, title: o.style.title } satisfies WinRec);
  }
  for (const { o, x, y } of items) {
    if (o instanceof TextObject) {
      const lay = layoutText(o.text, o.style);
      // The picture's left edge is the anchor minus the anchor's place inside it; the first line starts `xs[0]` in.
      const sx = o.scaleX;
      const left = x - lay.ax * sx + (lay.xs[0] ?? 0) * sx;
      const wide = Math.max(0, ...lay.widths) * sx;
      const tall = ((lay.lines.length - 1) * lay.lineHeight + GLYPH_H) * o.scaleY;
      l.texts.push({ text: o.text, x: left, y, w: wide, h: tall, decor: false, win: l.windowAt(left, y) });
    } else if (o instanceof ListMenu) {
      l.lists.push({ x, y, w: o.width, rows: o.rows, rowH: o.rowH, count: o.items.length, cols: o.cols, win: l.windowAt(x, y) });
    } else if (o instanceof ImageObject && !(o instanceof NineSlice)) {
      const w = o.width * o.scaleX;
      const h = o.height * o.scaleY;
      const left = x - o.originX * w;
      const top = y - o.originY * h;
      l.draws.push({ op: 'drawImage', x: left, y: top, w, h, text: false, decor: false, win: l.windowAt(left, top) });
    }
  }
  return l;
}
