/**
 * The layout recorder (docs/PIVOT-640.md, PL4; built in WP4). A stand-in for the canvas that writes
 * down what a scene draws, so a test can check the layout without a browser: vitest runs in node,
 * which has no canvas, and a screenshot cannot say "this text left its window".
 *
 * What it records, in screen pixels (after any `translate` and `scale` the scene applied):
 *   - every `fillRect`, `strokeRect`, `clearRect`, `drawImage` and `clip`;
 *   - the box of each `drawText` and `drawParagraph` call (`src/engine/font.ts`);
 *   - each `drawWindow` call (`src/ui/draw.ts`), with the text its own frame draws (the title tab and
 *     the key legend sit on the window's edge by design, so they are marked "decor", not content);
 *   - each `ListMenu.render` call (`src/ui/list.ts`): where it starts and how many rows it was given.
 *
 * How the scene reaches it: the test makes `RecordingCtx` the scene's context, stubs
 * `document.createElement('canvas')` so that the art code can build its offscreen canvases (it hands
 * out recording contexts too), and wraps `drawText`, `drawParagraph` and `drawWindow` through
 * `vi.mock` with the `tap*` functions below. The game's own code is not touched. Why the wrapping
 * is in the test and not in `src/`: the shipped game must not pay for a test's bookkeeping.
 *
 * Four checks run over a record (`outsideFrame`, `textOutsideWindow`, `listsNotFollowingHeight`,
 * and the advisory `paneShares` for rubric R5). A window drawn at `W - 10` must fail the first, and
 * the same scenes at 480x270 must pass all of them: `tests/ui-layout.test.ts` holds both controls.
 */
import type { Ctx } from '../src/engine/canvas';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A drawing call on the context, as a box in screen pixels. `text` marks a glyph blit of the font; `decor`, a window's own frame. */
export interface DrawRec extends Box {
  op: 'fillRect' | 'strokeRect' | 'clearRect' | 'drawImage' | 'clip';
  text: boolean;
  decor: boolean;
  /** The window the call belongs to (the latest one drawn that holds its top-left corner), or null. */
  win: number | null;
}

export interface WinRec extends Box {
  id: number;
  plain: boolean;
  title: string | undefined;
}

/** A drawText or drawParagraph call. `decor`: drawn by a window's own frame (title tab, key legend). */
export interface TextRec extends Box {
  text: string;
  decor: boolean;
  win: number | null;
}

export interface ListRec {
  x: number;
  y: number;
  w: number;
  rows: number;
  rowH: number;
  count: number;
  cols: number;
  win: number | null;
}

/** Everything one scene drew. */
export class Layout {
  draws: DrawRec[] = [];
  windows: WinRec[] = [];
  texts: TextRec[] = [];
  lists: ListRec[] = [];
  /** Inside a `drawWindow` call: what is drawn is the window's own frame. */
  decor = 0;
  /** Inside a `drawText` call: the glyph blits are text. */
  inText = 0;

  /** The latest-drawn window that holds the point, or null. A later window covers an earlier one, so it owns the point. */
  windowAt(x: number, y: number): number | null {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const w = this.windows[i]!;
      if (x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) return w.id;
    }
    return null;
  }
}

/** Where the recording goes. On `globalThis`, so a module graph that a test resets still finds the live one. */
const KEY = '__SJ_LAYOUT__';
type Holder = { [KEY]?: Layout | null };
export const setLayout = (l: Layout | null): void => {
  (globalThis as Holder)[KEY] = l;
};
export const currentLayout = (): Layout | null => (globalThis as Holder)[KEY] ?? null;

interface State {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

/** A canvas context that records. Anything it does not know is a no-op that returns nothing useful. */
export class RecordingCtx {
  private st: State = { tx: 0, ty: 0, sx: 1, sy: 1 };
  private stack: State[] = [];
  private pathRect: Box | null = null;
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = false;
  font = '';
  textAlign = 'left';
  lineWidth = 1;
  canvas: { width: number; height: number };
  /**
   * A silent context is an offscreen canvas (the stub's `createElement` hands these out): what a scene
   * paints into its own buffers is not on the screen yet, so it is not recorded. The scene's later
   * `drawImage` of the buffer onto the screen is. (The title's skyline buffer is 320x180 and its city
   * layers are 640 wide: drawn into the buffer they are inside it, and only the screen counts for check 1.)
   */
  silent: boolean;

  constructor(canvas: { width: number; height: number }, silent = false) {
    this.canvas = canvas;
    this.silent = silent;
  }

  /** A point of the scene's own space, in screen pixels. */
  dev(x: number, y: number): [number, number] {
    return [x * this.st.sx + this.st.tx, y * this.st.sy + this.st.ty];
  }

  private rec(op: DrawRec['op'], x: number, y: number, w: number, h: number): void {
    const l = currentLayout();
    if (!l || this.silent) return;
    const [x0, y0] = this.dev(x, y);
    const [x1, y1] = this.dev(x + w, y + h);
    const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    l.draws.push({ op, ...box, text: l.inText > 0, decor: l.decor > 0, win: l.windowAt(box.x, box.y) });
  }

  save(): void {
    this.stack.push({ ...this.st });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.st = s;
  }
  translate(x: number, y: number): void {
    this.st.tx += x * this.st.sx;
    this.st.ty += y * this.st.sy;
  }
  scale(x: number, y: number): void {
    this.st.sx *= x;
    this.st.sy *= y;
  }
  setTransform(): void {
    this.st = { tx: 0, ty: 0, sx: 1, sy: 1 };
  }
  resetTransform(): void {
    this.setTransform();
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rec('fillRect', x, y, w, h);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.rec('strokeRect', x, y, w, h);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.rec('clearRect', x, y, w, h);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.pathRect = { x, y, w, h };
  }
  clip(): void {
    if (this.pathRect) this.rec('clip', this.pathRect.x, this.pathRect.y, this.pathRect.w, this.pathRect.h);
  }
  beginPath(): void {
    this.pathRect = null;
  }
  /** drawImage(img, dx, dy) | (img, dx, dy, dw, dh) | (img, sx, sy, sw, sh, dx, dy, dw, dh). */
  drawImage(img: { width: number; height: number }, ...a: number[]): void {
    if (a.length >= 8) this.rec('drawImage', a[4]!, a[5]!, a[6]!, a[7]!);
    else if (a.length >= 4) this.rec('drawImage', a[0]!, a[1]!, a[2]!, a[3]!);
    else this.rec('drawImage', a[0] ?? 0, a[1] ?? 0, img.width, img.height);
  }
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
  createRadialGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
  createPattern(): object {
    return {};
  }
  getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
  }
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
  }
  measureText(t: string): { width: number } {
    return { width: t.length * 5 };
  }
}

/**
 * The context for a scene: the recording one, behind a proxy that turns every method it does not
 * implement (`arc`, `lineTo`, `fill`, `putImageData`...) into a no-op, so art code that draws paths
 * does not throw.
 */
export function recordingContext(canvas = { width: 1, height: 1 }, silent = false): Ctx {
  const real = new RecordingCtx(canvas, silent);
  const proxy = new Proxy(real as unknown as Record<string, unknown>, {
    get: (t, p: string) => (p in t ? t[p] : () => undefined),
    set: (t, p: string, v) => {
      t[p] = v;
      return true;
    },
  });
  return proxy as unknown as Ctx;
}

/**
 * Make `document.createElement('canvas')` hand out recording canvases (the art code builds offscreen
 * canvases when a scene first draws a portrait or a sprite). Returns a function that puts back what was there.
 */
export function installCanvasStub(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  g.document = {
    createElement: () => {
      const canvas: { width: number; height: number; getContext?: () => Ctx } = { width: 0, height: 0 };
      const ctx = recordingContext(canvas, true);
      canvas.getContext = () => ctx;
      return canvas;
    },
  };
  return () => {
    g.document = before;
  };
}

// ------------------------------------------------------------------ the taps (installed with vi.mock)

type DrawText = (ctx: Ctx, text: string, x: number, y: number, opts?: { align?: 'left' | 'center' | 'right'; lineH?: number; max?: number }) => number;
type DrawParagraph = (ctx: Ctx, text: string, x: number, y: number, maxW: number, opts?: { lineH?: number; max?: number }) => number;
type DrawWindow = (ctx: Ctx, x: number, y: number, w: number, h: number, opts?: { plain?: boolean | undefined; title?: string | undefined }) => void;

const GLYPH_H = 9;

/** Wrap `drawText`: record the box of the text (its measured width, aligned the way the call says), then draw. */
export function tapText(real: DrawText, measure: (t: string) => number): DrawText {
  return (ctx, text, x, y, opts) => {
    const l = currentLayout();
    if (l && 'dev' in (ctx as object) && !(ctx as unknown as RecordingCtx).silent) {
      const w = measure(text);
      const left = opts?.align === 'center' ? x - Math.floor(w / 2) : opts?.align === 'right' ? x - w : x;
      const [sx, sy] = (ctx as unknown as RecordingCtx).dev(left, y);
      l.texts.push({ text, x: sx, y: sy, w, h: GLYPH_H, decor: l.decor > 0, win: l.windowAt(sx, sy) });
    }
    if (l) l.inText++;
    try {
      return real(ctx, text, x, y, opts);
    } finally {
      if (l) l.inText--;
    }
  };
}

/** Wrap `drawParagraph`: one box over the wrapped lines. */
export function tapParagraph(real: DrawParagraph, wrap: (t: string, w: number) => string[], measure: (t: string) => number): DrawParagraph {
  return (ctx, text, x, y, maxW, opts) => {
    const l = currentLayout();
    if (l && 'dev' in (ctx as object) && !(ctx as unknown as RecordingCtx).silent) {
      const lines = wrap(text, maxW);
      const lh = opts?.lineH ?? 10;
      const w = Math.max(0, ...lines.map(measure));
      const [sx, sy] = (ctx as unknown as RecordingCtx).dev(x, y);
      l.texts.push({ text, x: sx, y: sy, w, h: (lines.length - 1) * lh + GLYPH_H, decor: l.decor > 0, win: l.windowAt(sx, sy) });
    }
    if (l) l.inText++;
    try {
      return real(ctx, text, x, y, maxW, opts);
    } finally {
      if (l) l.inText--;
    }
  };
}

/** Wrap `drawWindow`: record the window, and mark everything its own frame draws as decor. */
export function tapWindow(real: DrawWindow): DrawWindow {
  return (ctx, x, y, w, h, opts) => {
    const l = currentLayout();
    if (l && 'dev' in (ctx as object) && !(ctx as unknown as RecordingCtx).silent) {
      const [sx, sy] = (ctx as unknown as RecordingCtx).dev(x, y);
      l.windows.push({ id: l.windows.length, x: Math.round(sx), y: Math.round(sy), w: Math.round(w), h: Math.round(h), plain: !!opts?.plain, title: opts?.title });
    }
    if (l) l.decor++;
    try {
      real(ctx, x, y, w, h, opts);
    } finally {
      if (l) l.decor--;
    }
  };
}

/** The shape of `ListMenu.render` that the tap needs. */
interface ListLike {
  items: unknown[];
  rows: number;
  rowH: number;
  cols: number;
}
export function tapListRender<T extends ListLike>(real: (this: T, ctx: Ctx, x: number, y: number, w: number, ...rest: unknown[]) => void): (this: T, ctx: Ctx, x: number, y: number, w: number, ...rest: unknown[]) => void {
  return function (this: T, ctx, x, y, w, ...rest) {
    const l = currentLayout();
    if (l && 'dev' in (ctx as object) && !(ctx as unknown as RecordingCtx).silent) {
      const [sx, sy] = (ctx as unknown as RecordingCtx).dev(x, y);
      l.lists.push({ x: sx, y: sy, w, rows: this.rows, rowH: this.rowH, count: this.items.length, cols: this.cols, win: l.windowAt(sx, sy) });
    }
    return real.call(this, ctx, x, y, w, ...rest);
  };
}

// ------------------------------------------------------------------ a scene's input and game

/** A scripted input: one action is "pressed" while `press` holds it. */
export class FakeInput {
  private cur: string | null = null;
  press(a: string | null): void {
    this.cur = a;
  }
  pressed = (a: string): boolean => a === this.cur;
  repeat = (a: string): boolean => a === this.cur;
  down = (_a: string): boolean => false;
  keyName = (a: string): string => ({ confirm: 'Z', cancel: 'X', menu: 'C', dash: 'Shift' })[a] ?? a;
  keysFor = (_a: string): string[] => ['KeyZ'];
  captureNext = (): void => undefined;
  bind = (): null => null;
}

/** The little of `Game` that a scene reads while it updates and draws. */
export function fakeGame(input: FakeInput): Record<string, unknown> {
  return {
    input,
    playFrames: 60 * 60 * 31,
    shakeX: 0,
    shakeY: 0,
    stack: [],
    remove: () => undefined,
    run: () => new Promise(() => undefined),
  };
}

/** Press each action once, updating the scene after each. */
export function drive(scene: { update(): void }, input: FakeInput, actions: string[]): void {
  for (const a of actions) {
    input.press(a);
    scene.update();
    input.press(null);
  }
}

// ------------------------------------------------------------------ the checks

/**
 * Check 1: every rect, image and clip lies inside the screen (`w` by `h`). Returns the ones that do not.
 * A shake can move a layer by a few pixels, and the scenes drawn here are not shaking.
 */
export function outsideFrame(l: Layout, w: number, h: number): DrawRec[] {
  return l.draws.filter((d) => d.x < 0 || d.y < 0 || d.x + d.w > w || d.y + d.h > h);
}

/** The inside of a window's frame: the frame is 2 px thick, so text may touch 3 px in. */
const FRAME = 2;
/** The gap a list keeps clear of its window frame at the bottom (check 3). */
export const LIST_FRAME_MARGIN = 8;

/**
 * Check 2: every text box lies inside the window that draws it. A text belongs to the latest window
 * drawn that held its top-left corner; a window's own title and key legend are decor and are skipped.
 * A text that starts in no window is not judged here (the title screen has none): it is checked only
 * against the frame of the screen, by check 1. Returns the ones that overflow.
 */
export function textOutsideWindow(l: Layout): { text: string; win: WinRec; box: Box; over: number }[] {
  const bad: { text: string; win: WinRec; box: Box; over: number }[] = [];
  for (const t of l.texts) {
    if (t.decor || t.win === null) continue;
    const w = l.windows[t.win]!;
    // How far the box runs past the frame's inner edge, on its worst side (px; above 0 means overflow).
    const over = Math.max(w.x + FRAME - t.x, w.y + FRAME - t.y, t.x + t.w - (w.x + w.w - FRAME), t.y + t.h - (w.y + w.h - FRAME));
    if (over > 0) bad.push({ text: t.text, win: w, box: t, over });
  }
  return bad;
}

/**
 * Check 3: a tall pane's list takes the rows its window has room for (`rowsFor`, docs/PIVOT-640.md): it
 * fits inside its window, and the room left under its last row is less than one more row plus the
 * `reserve` the scene keeps under the list (a description, say) and `LIST_FRAME_MARGIN` (8 px) that a
 * list keeps clear of the frame. Only a pane at least `tall` high is judged: the rail, a three-row menu and a small popup have a
 * fixed number of rows by design. Returns the lists that break the rule.
 */
export function listsNotFollowingHeight(l: Layout, tall: number, reserve: (win: WinRec) => number = () => 0): { list: ListRec; win: WinRec; why: string }[] {
  const bad: { list: ListRec; win: WinRec; why: string }[] = [];
  for (const list of l.lists) {
    if (list.win === null) continue;
    const win = l.windows[list.win]!;
    if (win.h < tall) continue;
    const bottom = list.y + list.rows * list.rowH;
    const room = win.y + win.h - bottom;
    if (room < 0) bad.push({ list, win, why: `${list.rows} rows end ${-room} px below the window` });
    else if (room - reserve(win) >= list.rowH + LIST_FRAME_MARGIN) bad.push({ list, win, why: `${list.rows} rows leave ${room - reserve(win)} px free: room for another row` });
  }
  return bad;
}

/** Rubric R5 (advisory): how much of its inner width and height a window's content spans. */
export interface PaneShare {
  win: WinRec;
  /** Content extent over inner extent, 0 to 1. */
  wShare: number;
  hShare: number;
  items: number;
}

/**
 * The content of a window is the text boxes and the non-frame rects and images that start inside it
 * (the latest window holding their corner). The share is the span of that content over the window's
 * inner width and height. The full-screen dim and the window's own frame do not count.
 */
export function paneShares(l: Layout, w: number, h: number): PaneShare[] {
  const spans = new Map<number, { x0: number; x1: number; y0: number; y1: number; n: number }>();
  const add = (win: number | null, b: Box): void => {
    if (win === null) return;
    const s = spans.get(win) ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0 };
    s.x0 = Math.min(s.x0, b.x);
    s.x1 = Math.max(s.x1, b.x + b.w);
    s.y0 = Math.min(s.y0, b.y);
    s.y1 = Math.max(s.y1, b.y + b.h);
    s.n++;
    spans.set(win, s);
  };
  for (const t of l.texts) if (!t.decor) add(t.win, t);
  for (const d of l.draws) {
    if (d.decor || d.text || d.op === 'clip' || d.op === 'clearRect') continue;
    if (d.w >= w && d.h >= h) continue;
    add(d.win, d);
  }
  return l.windows.flatMap((win) => {
    const s = spans.get(win.id);
    if (!s) return [{ win, wShare: 0, hShare: 0, items: 0 }];
    const innerW = win.w - 2 * (FRAME + 1), innerH = win.h - 2 * (FRAME + 1);
    // Content may reach the frame (a bar, a highlight): clamp the span to the inner area.
    const x0 = Math.max(s.x0, win.x + FRAME + 1), x1 = Math.min(s.x1, win.x + win.w - FRAME - 1);
    const y0 = Math.max(s.y0, win.y + FRAME + 1), y1 = Math.min(s.y1, win.y + win.h - FRAME - 1);
    return [{ win, wShare: Math.max(0, (x1 - x0) / innerW), hShare: Math.max(0, (y1 - y0) / innerH), items: s.n }];
  });
}
