/**
 * The battle stage as DATA (Phaser spike, `spike/phaser-stage`): where the horizon is, where the floor
 * is, which depth rows the fighters can stand on, and which slot each fighter takes. Nothing here draws
 * anything and nothing imports Phaser, so a unit test can check it and, later, an edit mode can change
 * it and save it as `src/data/stages.json` (the same way the FX lab saves `fx.json`).
 *
 * A few ideas, in plain words:
 *
 *  - **Depth rows.** The floor is seen from above at an angle, so something standing further back is
 *    drawn higher on the screen. A row is one such line: its `y` is where a fighter's FEET land. Rows are
 *    listed back to front (smallest y first). A slot names a row, so moving a fighter to another row is
 *    one number, and the fighter's height on screen follows.
 *  - **Slots.** A slot is a place to stand: a row and an `x`. The party has four, on the left. The
 *    enemies have a slot set for each head-count (1 to 4), on the right, because one big enemy stands
 *    in the middle while four stand in a spread.
 *  - **Depth sorting.** Whoever's feet are lower on the screen is nearer and is drawn on top. Phaser
 *    draws objects in order of their `depth` number, so `depthFor(y, x)` turns a foot position into that
 *    number (ties go to the one further right, so two fighters on one row never flicker).
 *
 * All the numbers are whole screen pixels on the game's 480x270 screen, so nothing lands between pixels.
 */

export const SCREEN_W = 480;
export const SCREEN_H = 270;

/** One depth row: where feet land (`y`), and an optional tint multiplied over whoever stands on it (rear rows a little darker or bluer). */
export interface DepthRow {
  y: number;
  /** `#rrggbb`. White (or none) leaves the art as drawn. */
  tint?: string;
}

/** A place to stand: a row (an index into `rows`) and the x of the feet's middle. */
export interface Slot {
  row: number;
  x: number;
}

/** The contact shadow under a fighter: a flat ellipse on the floor. */
export interface ShadowStyle {
  /** Width in screen pixels for a party member (an enemy brings its own width from its art). */
  width: number;
  /** Height as a share of the width (a floor seen at an angle squashes a circle to about a third). */
  ratio: number;
  /** 0 to 1. */
  alpha: number;
}

export interface StageConfig {
  name: string;
  /** Which battle backdrop (`src/art/battlebg.ts`) is painted behind the fighters. */
  backdrop: string;
  /** Screen y of the horizon: the line where the floor meets the wall behind it. */
  horizon: number;
  /** The band of floor fighters may stand on (feet y between `top` and `bottom`). */
  floor: { top: number; bottom: number };
  rows: DepthRow[];
  /** Exactly four, in party order: the first stands furthest back. */
  party: Slot[];
  /** Slot sets by number of enemies, keys "1" to "4". */
  enemies: Record<string, Slot[]>;
  shadow: ShadowStyle;
}

export type StageFile = Record<string, StageConfig>;

export const PARTY_SIZE = 4;
export const MAX_ENEMIES = 4;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;

function checkSlots(path: string, slots: unknown, count: number, rowCount: number, side: 'party' | 'enemy', out: string[]): void {
  if (!Array.isArray(slots) || slots.length !== count) {
    out.push(`${path}: needs exactly ${count} slots`);
    return;
  }
  const seen = new Set<string>();
  slots.forEach((s: unknown, i) => {
    if (!isObj(s) || !isInt(s.row) || !isInt(s.x)) {
      out.push(`${path}[${i}]: needs a whole-number row and x`);
      return;
    }
    if (s.row < 0 || s.row >= rowCount) out.push(`${path}[${i}]: row ${s.row} is not one of the ${rowCount} rows`);
    // The party stands on the left half of the screen and the enemies on the right.
    if (side === 'party' ? s.x < 0 || s.x >= SCREEN_W / 2 : s.x < SCREEN_W / 2 || s.x > SCREEN_W) out.push(`${path}[${i}]: x ${s.x} is on the wrong side of the screen`);
    const k = `${s.row}:${s.x}`;
    if (seen.has(k)) out.push(`${path}[${i}]: two fighters on the same spot`);
    seen.add(k);
  });
}

/**
 * Everything wrong with a stage file, in plain words (empty when it is fine). `knownBackdrops`, when
 * given, is the list of backdrop ids the art can paint, so a typo is caught before it silently shows
 * the default.
 */
export function checkStages(data: unknown, knownBackdrops?: readonly string[]): string[] {
  const out: string[] = [];
  if (!isObj(data) || !Object.keys(data).length) return ['stages: needs at least one stage'];
  for (const [id, raw] of Object.entries(data)) {
    const p = `stage "${id}"`;
    if (!isObj(raw)) {
      out.push(`${p}: not an object`);
      continue;
    }
    if (typeof raw.name !== 'string' || !raw.name) out.push(`${p}: needs a name`);
    if (typeof raw.backdrop !== 'string' || !raw.backdrop) out.push(`${p}: needs a backdrop`);
    else if (knownBackdrops && !knownBackdrops.includes(raw.backdrop)) out.push(`${p}: backdrop "${raw.backdrop}" is not one the art can paint`);
    if (!isInt(raw.horizon) || raw.horizon < 0 || raw.horizon > SCREEN_H) out.push(`${p}: horizon must be a whole number on the screen`);
    // The floor band, as plain numbers once it has passed the checks.
    let floorTop = 0;
    let floorBottom = SCREEN_H;
    let floorOk = false;
    const floor = raw.floor;
    if (isObj(floor) && isInt(floor.top) && isInt(floor.bottom) && floor.top >= 0 && floor.bottom <= SCREEN_H && floor.top < floor.bottom) {
      floorOk = true;
      floorTop = floor.top;
      floorBottom = floor.bottom;
    } else out.push(`${p}: floor needs whole-number top < bottom on the screen`);
    if (floorOk && isInt(raw.horizon) && floorTop < raw.horizon) out.push(`${p}: the floor starts above the horizon`);
    // Rows: back to front, every one inside the floor band.
    let rowCount = 0;
    if (!Array.isArray(raw.rows) || raw.rows.length < 2 || raw.rows.length > 6) out.push(`${p}: needs 2 to 6 depth rows`);
    else {
      rowCount = raw.rows.length;
      let prev = -1;
      raw.rows.forEach((r: unknown, i) => {
        if (!isObj(r) || !isInt(r.y)) {
          out.push(`${p} rows[${i}]: needs a whole-number y`);
          return;
        }
        if (r.y <= prev) out.push(`${p} rows[${i}]: rows go back to front, so y must grow (${r.y} after ${prev})`);
        prev = r.y;
        if (floorOk && (r.y < floorTop || r.y > floorBottom)) out.push(`${p} rows[${i}]: y ${r.y} is outside the floor band`);
        if (r.tint !== undefined && !(typeof r.tint === 'string' && HEX.test(r.tint))) out.push(`${p} rows[${i}]: tint must look like #rrggbb`);
      });
    }
    checkSlots(`${p} party`, raw.party, PARTY_SIZE, rowCount, 'party', out);
    if (!isObj(raw.enemies)) out.push(`${p}: needs enemy slot sets`);
    else for (let n = 1; n <= MAX_ENEMIES; n++) checkSlots(`${p} enemies["${n}"]`, raw.enemies[String(n)], n, rowCount, 'enemy', out);
    const sh = raw.shadow;
    if (!isObj(sh) || !isInt(sh.width) || sh.width < 4 || sh.width > 96 || typeof sh.ratio !== 'number' || sh.ratio < 0.1 || sh.ratio > 0.6 || typeof sh.alpha !== 'number' || sh.alpha < 0 || sh.alpha > 1)
      out.push(`${p}: shadow needs width 4-96, ratio 0.1-0.6 and alpha 0-1`);
  }
  return out;
}

/** The stage file, checked. Throws a readable error listing every problem (a bad stage must not half-load). */
export function loadStages(data: unknown, knownBackdrops?: readonly string[]): StageFile {
  const problems = checkStages(data, knownBackdrops);
  if (problems.length) throw new Error(`stages.json is not valid:\n - ${problems.join('\n - ')}`);
  return data as StageFile;
}

/** One stage by id, or a readable error naming the ones there are. */
export function stageOf(file: StageFile, id: string): StageConfig {
  const s = file[id];
  if (!s) throw new Error(`No stage "${id}" (there is: ${Object.keys(file).join(', ')})`);
  return s;
}

/** A slot's feet position on the screen. */
export function slotPoint(stage: StageConfig, slot: Slot): { x: number; y: number } {
  const row = stage.rows[slot.row];
  if (!row) throw new Error(`Slot names row ${slot.row}, which stage "${stage.name}" does not have`);
  return { x: slot.x, y: row.y };
}

/** The slots enemies take for a fight of `count` of them (1 to 4). */
export function enemySlots(stage: StageConfig, count: number): Slot[] {
  const set = stage.enemies[String(count)];
  if (!set) throw new Error(`Stage "${stage.name}" has no slots for ${count} enemies (1 to ${MAX_ENEMIES})`);
  return set;
}

/**
 * The draw-order number for something standing with its feet at (x, y): nearer (lower on screen) draws
 * on top, and on one row the one further right does. Multiplied up so the x tiebreak never outweighs
 * a row. Shadows use `depth - 0.5`, which puts each just beneath its own fighter.
 */
export function depthFor(y: number, x: number): number {
  return y * 1000 + x;
}

/** The row tint as a number Phaser's `setTint` takes (0xffffff, no change, when the row has none). */
export function rowTint(stage: StageConfig, row: number): number {
  const t = stage.rows[row]?.tint;
  return t ? Number.parseInt(t.slice(1), 16) : 0xffffff;
}
