/**
 * HERO PROPORTIONS (Phaser spike `spike/phaser-stage`): how tall and how broad each hero stands in battle, relative to the
 * art as Mark drew it. Kit and Rook are human, Hex is a dwarf, Sable is an orc, and the heroes' drawings were made on
 * equal-sized cells, so on the stage everyone looked the same size. `src/data/heroes.json` holds two numbers per hero:
 *
 *   { "hex": { "height": 0.8, "build": 1 } }      height 1 = as drawn, 0.8 = a fifth shorter; build is the same for width
 *
 * The file is GLOBAL (every battle on every stage reads it; a stage cannot override it), because it describes a character,
 * not a layout. The Battle Stage Editor edits it with two sliders and saves it with the other stage files.
 *
 * HOW THE NUMBERS BECOME PIXELS: never by stretching. Stretching pixel art by 1.07 makes some rows twice as thick as their
 * neighbours and blurs or breaks outlines. Instead we ADD or REMOVE WHOLE ROWS and COLUMNS of pixels inside the body (the
 * artist's trick for resizing a sprite by hand): to make a figure 5 rows taller we repeat 5 rows of the legs and chest;
 * to make it 12 rows shorter we drop 12. Every pixel stays exactly 1x1 and every outline stays one pixel wide.
 *
 *  - Rows are only added or removed in the BODY: the head (the top 28% of the figure) and the feet (the bottom 6%) are
 *    never touched, so a smaller hero keeps a full-sized head, as a dwarf should look.
 *  - Columns are only added or removed in the MIDDLE of the body (20% to 80% of its width), so arms, a staff or a sword
 *    keep their shape.
 *  - Which rows and columns? One line per equal slice of the body, and in each slice the line most like its neighbour
 *    (repeating or dropping a line that looks the same as the next one is the least visible change).
 *
 * CONSISTENCY. The picks are made ONCE per hero, on one reference frame (idle frame 1), and written down relative to the
 * feet (a row as "this many pixels above the soles", a column as "this many pixels left or right of the feet's middle").
 * The same picks are then applied to every other frame of the hero (the whole idle loop, Rook's strike pictures, Kit's
 * punches), so the body is the same shape in every frame and nothing jitters when the animation hands over.
 *
 * This file is pure (arrays in, arrays out, no Phaser, no browser), so a unit test can run it on made-up frames and on
 * Mark's real sheets.
 */
import { boxOf, type Raw } from './sfgeom';
import { CREW_IDS } from './crew';
import type { FootAnchor } from './feet';

// ------------------------------------------------------------------ the file

/** One hero's two numbers. */
export interface Proportion {
  /** How tall, as a multiple of the drawn height (1 = as drawn). */
  height: number;
  /** How broad, as a multiple of the drawn width (1 = as drawn). */
  build: number;
}

/** `heroes.json`: an entry for every hero. */
export type HeroesFile = Record<string, Proportion>;

/** The smallest and largest number a slider may hold. Outside this the pixel art stops looking like itself. */
export const PROPORTION_MIN = 0.6;
export const PROPORTION_MAX = 1.5;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= PROPORTION_MIN && v <= PROPORTION_MAX;

/**
 * Everything wrong with a heroes file, one problem per line in plain words (empty when it is fine). `ids` is the list of
 * heroes that must have an entry (the crew); an entry for anyone else is also a problem, since it would silently do nothing.
 */
export function checkHeroes(data: unknown, ids: readonly string[] = CREW_IDS): string[] {
  if (!isObj(data)) return ['hero proportions: must be an object with one entry per hero'];
  const out: string[] = [];
  for (const id of ids) if (!(id in data)) out.push(`hero proportions: no entry for "${id}" (every hero needs one)`);
  for (const [id, v] of Object.entries(data)) {
    if (!ids.includes(id)) {
      out.push(`hero proportions "${id}": this is not a hero`);
      continue;
    }
    if (!isObj(v)) {
      out.push(`hero proportions "${id}": must be an object with height and build`);
      continue;
    }
    for (const key of ['height', 'build'] as const) {
      if (!inRange(v[key])) out.push(`hero proportions "${id}": ${key} must be a number from ${PROPORTION_MIN} to ${PROPORTION_MAX}`);
    }
    for (const key of Object.keys(v)) if (key !== 'height' && key !== 'build') out.push(`hero proportions "${id}": "${key}" is not a setting (only height and build)`);
  }
  return out;
}

/** The heroes file, checked (throws a readable error listing every problem). */
export function loadHeroes(data: unknown, ids: readonly string[] = CREW_IDS): HeroesFile {
  const problems = checkHeroes(data, ids);
  if (problems.length) throw new Error(`heroes.json is not valid:\n - ${problems.join('\n - ')}`);
  return data as HeroesFile;
}

/** A short exact name for a hero's numbers, used in texture names so a changed number makes a new picture. */
export const proportionTag = (p: Proportion): string => `${p.height}x${p.build}`;

// ------------------------------------------------------------------ choosing the lines

/** The share of the figure's height, from the top, that is the head and is never touched. */
export const HEAD_SHARE = 0.28;
/** The share of the figure's height, from the bottom, that is the feet and is never touched. */
export const FEET_SHARE = 0.06;
/** The share of the figure's width, at each side, that is never touched. */
export const SIDE_SHARE = 0.2;

/** What a bake does: which whole rows and columns to repeat (a taller or broader figure) or drop (a shorter or slimmer one). */
export interface BakePlan {
  /** The numbers this plan was made from. */
  height: number;
  build: number;
  /** Rows to change, each as its height in pixels above the soles' row (0 = the lowest row), lowest first. */
  rows: number[];
  /** +1: each row is repeated once (taller). -1: each row is dropped (shorter). */
  rowStep: 1 | -1;
  /** Columns to change, each as its offset from the feet's middle column (negative = left), leftmost first. */
  cols: number[];
  /** +1: each column is repeated once (broader). -1: each is dropped (slimmer). */
  colStep: 1 | -1;
}

/** How different two neighbouring lines are: 0 means identical. `horizontal` compares rows `a` and `b`, else columns. */
function lineDiff(r: Raw, a: number, b: number, horizontal: boolean): number {
  let d = 0;
  const n = horizontal ? r.w : r.h;
  for (let i = 0; i < n; i++) {
    const p = (horizontal ? a * r.w + i : i * r.w + a) * 4;
    const q = (horizontal ? b * r.w + i : i * r.w + b) * 4;
    d += Math.abs((r.data[p] ?? 0) - (r.data[q] ?? 0)) + Math.abs((r.data[p + 1] ?? 0) - (r.data[q + 1] ?? 0)) + Math.abs((r.data[p + 2] ?? 0) - (r.data[q + 2] ?? 0)) + Math.abs((r.data[p + 3] ?? 0) - (r.data[q + 3] ?? 0));
  }
  return d;
}

/**
 * `n` lines from `lo` up to (not including) `hi`: the range is cut into `n` equal slices and each slice gives the line most
 * like the line after it (the first one on a tie). Asking for more lines than there is room for gives as many as fit.
 */
export function pickLines(r: Raw, lo: number, hi: number, n: number, horizontal: boolean): number[] {
  const room = hi - lo;
  const count = Math.min(n, room);
  if (count <= 0) return [];
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    // Whole-number maths: slice k covers [a, b), and the slices never overlap because count <= room.
    const a = lo + Math.floor((k * room) / count);
    const b = lo + Math.floor(((k + 1) * room) / count);
    let best = a;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = a; i < Math.max(a + 1, b); i++) {
      const d = lineDiff(r, i, i + 1, horizontal);
      if (d < bestDiff) {
        best = i;
        bestDiff = d;
      }
    }
    out.push(best);
  }
  return out;
}

/** The rows (head and feet excluded) of a figure's drawn bounds that may change: `lo` up to but not including `hi`. */
function rowWindow(box: { y0: number; y1: number }): { lo: number; hi: number } {
  const h = box.y1 - box.y0 + 1;
  return { lo: box.y0 + Math.floor(HEAD_SHARE * h), hi: box.y1 - Math.floor(FEET_SHARE * h) };
}

/** The columns (a fifth of the width excluded at each side) that may change: `lo` up to but not including `hi`. */
function colWindow(box: { x0: number; x1: number }): { lo: number; hi: number } {
  const w = box.x1 - box.x0 + 1;
  return { lo: box.x0 + Math.floor(SIDE_SHARE * w), hi: box.x1 - Math.floor(SIDE_SHARE * w) };
}

/** How many rows a figure `h` tall gains or loses for this `height` number, and how many columns one `w` wide does for this `build`. */
export const rowsFor = (h: number, height: number): number => Math.round(h * Math.abs(height - 1));
export const colsFor = (w: number, build: number): number => Math.round(w * Math.abs(build - 1));

/** The size a figure of `w` by `h` pixels ends up (what the plan adds or removes, when there is room for all of it). */
export function targetSize(w: number, h: number, p: Proportion): { w: number; h: number } {
  return { w: w + Math.sign(p.build - 1) * colsFor(w, p.build), h: h + Math.sign(p.height - 1) * rowsFor(h, p.height) };
}

/**
 * Choose the lines for a hero, once, on the reference frame `ref` (idle frame 1). `anchor` is the hero's foot anchor: the
 * picks are written relative to it so they can be laid on any other frame of the hero that has the same feet.
 *
 * The columns are chosen on the picture AFTER the rows were added or dropped (the same order the pixels are changed in),
 * so a column is judged on the figure it will really cut.
 */
export function planFor(ref: Raw, anchor: FootAnchor, p: Proportion): BakePlan {
  const rowStep = p.height >= 1 ? 1 : -1;
  const colStep = p.build >= 1 ? 1 : -1;
  const plan: BakePlan = { height: p.height, build: p.build, rows: [], rowStep, cols: [], colStep };
  const box = boxOf(ref);
  if (box.y1 < 0) return plan;
  const h = box.y1 - box.y0 + 1;
  const w = box.x1 - box.x0 + 1;
  const rowWin = rowWindow(box);
  const rows = pickLines(ref, rowWin.lo, rowWin.hi, rowsFor(h, p.height), true);
  plan.rows = rows.map((r) => anchor.y - 1 - r).sort((a, b) => a - b);
  // The columns are picked on the picture with the rows already done.
  const tall = changeLines(ref, rows, rowStep, true).raw;
  const colWin = colWindow(box);
  const cols = pickLines(tall, colWin.lo, colWin.hi, colsFor(w, p.build), false);
  plan.cols = cols.map((c) => c - anchor.x).sort((a, b) => a - b);
  return plan;
}

/** True when the plan changes nothing (both numbers are 1, or the figure was too small to change). */
export const isIdentity = (plan: BakePlan): boolean => plan.rows.length === 0 && plan.cols.length === 0;

// ------------------------------------------------------------------ changing a picture

/** A picture with these rows (or columns) repeated once (`step` +1) or dropped (-1). Whole lines, so no pixel is ever resampled. */
function changeLines(src: Raw, at: readonly number[], step: 1 | -1, rows: boolean): { raw: Raw } {
  const set = new Set(at);
  const length = rows ? src.h : src.w;
  const order: number[] = [];
  for (let i = 0; i < length; i++) {
    if (set.has(i)) {
      if (step > 0) order.push(i, i);
    } else order.push(i);
  }
  const w = rows ? src.w : order.length;
  const h = rows ? order.length : src.h;
  const px = new Uint8ClampedArray(w * h * 4);
  if (rows) {
    for (let y = 0; y < h; y++) {
      const from = order[y] ?? 0;
      px.set(src.data.subarray(from * src.w * 4, (from + 1) * src.w * 4), y * w * 4);
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = order[x] ?? 0;
        px.set(src.data.subarray((y * src.w + from) * 4, (y * src.w + from) * 4 + 4), (y * w + x) * 4);
      }
    }
  }
  return { raw: { w, h, data: px } };
}

/** What baking one frame gives: the new picture, where the feet are in it, and where any point of the old picture went. */
export interface Baked {
  raw: Raw;
  /** The foot anchor in the new picture. */
  anchor: FootAnchor;
  /** How many rows and columns were really changed in this frame (a frame that cannot take a pick skips it). */
  rows: number;
  cols: number;
  /** The new column / row of a column / row of the old picture. */
  mapX: (x: number) => number;
  mapY: (y: number) => number;
}

/**
 * Lay a plan on one frame. `anchor` is where the feet are in THIS frame's picture (a sheet's foot anchor, or a still's
 * axis); rows are found by their height above its soles row and columns by their offset from its middle column.
 *
 * `guard` is for a frame that is not an idle frame (a strike or punch picture, whose pose differs from the idle's): a pick
 * that falls in this frame's own head, feet or outer fifths is skipped, so a crouching figure never gets a repeated row
 * through its head. The idle loop is not guarded: every frame of it must take exactly the same picks.
 */
export function bakeFrame(src: Raw, anchor: FootAnchor, plan: BakePlan, guard = false): Baked {
  let rows = plan.rows.map((hgt) => anchor.y - 1 - hgt).filter((r) => r >= 0 && r < src.h);
  let cols = plan.cols.map((o) => anchor.x + o).filter((c) => c >= 0 && c < src.w);
  if (guard) {
    const box = boxOf(src);
    if (box.y1 < 0) {
      rows = [];
      cols = [];
    } else {
      const rw = rowWindow(box);
      const cw = colWindow(box);
      rows = rows.filter((r) => r >= rw.lo && r < rw.hi);
      cols = cols.filter((c) => c >= cw.lo && c < cw.hi);
    }
  }
  rows.sort((a, b) => a - b);
  cols.sort((a, b) => a - b);
  const tall = changeLines(src, rows, plan.rowStep, true).raw;
  const wide = changeLines(tall, cols, plan.colStep, false).raw;
  const mapY = (y: number): number => y + plan.rowStep * rows.filter((r) => r < y).length;
  const mapX = (x: number): number => x + plan.colStep * cols.filter((c) => c < x).length;
  return { raw: wide, anchor: { x: mapX(anchor.x), y: mapY(anchor.y) }, rows: rows.length, cols: cols.length, mapX, mapY };
}

/** The frames of a sheet baked with one plan. They all take the same picks, so they come out the same size (checked here). */
export function bakeSheet(frames: readonly Raw[], anchor: FootAnchor, plan: BakePlan): { frames: Raw[]; anchor: FootAnchor; baked: Baked[] } {
  const baked = frames.map((f) => bakeFrame(f, anchor, plan));
  const first = baked[0];
  if (!first) throw new Error('bakeSheet: the sheet has no frames');
  for (const b of baked) if (b.raw.w !== first.raw.w || b.raw.h !== first.raw.h) throw new Error('bakeSheet: the frames came out different sizes (a pick fell outside a frame)');
  return { frames: baked.map((b) => b.raw), anchor: first.anchor, baked };
}

// ------------------------------------------------------------------ moving points with the picture

/**
 * Where a point that is `dx` columns from the feet's middle (positive = right) ends up after a bake: the columns added
 * between the feet and the point push it outward; dropped ones pull it in. This is how a move's authored contact point (the
 * blade tip, 58 px in front of Rook's feet) follows the baked picture.
 */
export function throughColumns(plan: BakePlan, dx: number): number {
  if (dx > 0) return dx + plan.colStep * plan.cols.filter((o) => o >= 0 && o < dx).length;
  if (dx < 0) return dx - plan.colStep * plan.cols.filter((o) => o >= dx && o < 0).length;
  return 0;
}

/** Where a point `up` pixels above the soles (positive = up) ends up: rows added below it lift it, dropped ones lower it. */
export function throughRows(plan: BakePlan, up: number): number {
  return up + plan.rowStep * plan.rows.filter((r) => r < up).length;
}
