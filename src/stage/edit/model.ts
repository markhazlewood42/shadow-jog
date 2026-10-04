/**
 * What the Battle Stage Editor can DO to a stage, as plain functions (Phaser spike `spike/phaser-stage`).
 *
 * Every function here takes a stage (or the whole stage file) and changes it in place, so the editor makes a copy
 * first, calls one of these, and keeps the copy: that is what lets one gesture be one undo step. Nothing here
 * touches the browser or Phaser, which is why a unit test can drive a whole editing session without a page.
 *
 * The ideas the functions share, in plain words:
 *
 *  - A **slot** is a place to stand: a depth row (`row`, an index into `rows`), an `x`, and a small optional
 *    vertical nudge `dy`. Dragging a fighter picks the nearest row for it, which is what "snap to rows" means.
 *  - The **horizon** is where the backdrop's wall meets the floor, and in the final design it is also the top
 *    of the floor, so one handle moves `backdrop.horizonY`, `floor.y0` and (for the street, whose skyline is an
 *    old picture slid into place) `backdrop.shiftY`. Rows cannot go above it and the floor's bottom cannot go
 *    above the front row: the handles refuse what the validator would refuse (`checkStages`).
 *  - Every function that moves something returns the value it actually used after clamping, so the editor can
 *    show the user where the thing landed.
 */
import {
  ART_KERB_ROW,
  type EnemySlot,
  type EntryFile,
  type HudBoxOverride,
  type HudLayout,
  type PartySlot,
  SCREEN_H,
  SCREEN_W,
  type StageBody,
  type StageEntry,
  setSize,
  slotPoint,
  snapSlot,
} from '../config';
import { HUD_FIELDS, HUD_REGIONS, type HudField, type HudRegionKey, setField } from '../hudpresets';
import { enemyLeftLimit, heroRightLimit, RULE_LIMITS } from '../rules';
import type { AxesFile } from '../config';
import type { FacingFile } from '../facing';
import type { HeroesFile } from '../proportions';

export type Side = 'party' | 'enemy';

/** The size of the editor's coarse grid, in game pixels. */
export const GRID = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A deep copy of a stage (the editor edits copies). */
export function cloneStage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ------------------------------------------------------------------ ground: horizon, floor bottom, rows

/**
 * Move the horizon (and with it the floor's top and, for a reprojected backdrop, the picture's shift). The
 * horizon stays on the screen and above the back row, because a row above the floor is invalid.
 */
export function setHorizon(s: StageBody, y: number): number {
  const back = s.rows[0]?.y ?? SCREEN_H;
  const v = clamp(Math.round(y), 0, back);
  s.backdrop.horizonY = v;
  s.floor.y0 = v;
  if (s.backdrop.mode === 'reproject') s.backdrop.shiftY = v - ART_KERB_ROW;
  return v;
}

/** Move the floor's bottom: not above the front row, not off the screen. */
export function setFloorBottom(s: StageBody, y: number): number {
  const front = s.rows[s.rows.length - 1]?.y ?? 0;
  const v = clamp(Math.round(y), front, SCREEN_H);
  s.floor.y1 = v;
  return v;
}

/** Move one depth row's foot line: it stops one pixel short of its neighbours and inside the floor. Fighters on it move with it. */
export function setRowY(s: StageBody, index: number, y: number): number {
  const row = s.rows[index];
  if (!row) throw new Error(`Row ${index} does not exist`);
  const lo = index === 0 ? s.floor.y0 : (s.rows[index - 1]?.y ?? 0) + 1;
  const hi = index === s.rows.length - 1 ? s.floor.y1 : (s.rows[index + 1]?.y ?? SCREEN_H) - 1;
  row.y = clamp(Math.round(y), lo, hi);
  return row.y;
}

/** Add a row in front of the others, 17 px below the last (the shipped spacing). Returns a reason when it cannot. */
export function addRow(s: StageBody): string | null {
  if (s.rows.length >= 6) return 'A stage can have at most 6 depth rows';
  const last = s.rows[s.rows.length - 1]?.y ?? s.floor.y0;
  const y = Math.min(s.floor.y1, last + 17);
  if (y <= last) return 'There is no room below the front row; move the floor bottom down first';
  s.rows.push({ y });
  s.depthTint?.amounts.push(0);
  return null;
}

/** Every slot of the stage that stands on this row, as "Party 2", "Enemy 1 of 3 (set 3)" ... for a refusal message. */
export function slotsOnRow(s: StageBody, row: number): string[] {
  const out: string[] = [];
  s.party.forEach((q, i) => {
    if (q.row === row) out.push(`Party ${i + 1}`);
  });
  for (const [key, set] of Object.entries(s.enemySets)) {
    set.forEach((q, i) => {
      if (q.row === row) out.push(`Enemy ${i + 1} of set ${key}`);
    });
  }
  return out;
}

/** Remove a row. Refused (with the reason) while someone stands on it, or when only two would be left. Rows behind it keep their slots. */
export function removeRow(s: StageBody, index: number): string | null {
  if (s.rows.length <= 2) return 'A stage needs at least 2 depth rows';
  const users = slotsOnRow(s, index);
  if (users.length) return `Row ${index + 1} is in use by ${users.slice(0, 3).join(', ')}${users.length > 3 ? ` and ${users.length - 3} more` : ''}; move them first`;
  s.rows.splice(index, 1);
  s.depthTint?.amounts.splice(index, 1);
  const shift = (q: PartySlot): void => {
    if (q.row > index) q.row -= 1;
  };
  s.party.forEach(shift);
  for (const set of Object.values(s.enemySets)) set.forEach(shift);
  return null;
}

// ------------------------------------------------------------------ slots

/** The slot list a selection refers to: the party, or one enemy group. */
export function slotList(s: StageBody, side: Side, setKey: string): Array<PartySlot | EnemySlot> {
  if (side === 'party') return s.party;
  const set = s.enemySets[setKey];
  if (!set) throw new Error(`Stage "${s.id}" has no enemy group "${setKey}"`);
  return set;
}

/** The side's half of the screen: the party stands left of the middle, enemies from the middle on. */
function xRange(side: Side): [number, number] {
  return side === 'party' ? [0, SCREEN_W / 2 - 1] : [SCREEN_W / 2, SCREEN_W];
}

const spotKey = (q: PartySlot): string => `${q.row}:${q.x}:${q.dy ?? 0}`;

/** True when another slot of the list already stands on this exact spot. */
function taken(list: ReadonlyArray<PartySlot>, self: number, q: PartySlot): boolean {
  return list.some((o, i) => i !== self && spotKey(o) === spotKey(q));
}

/** Slide a slot sideways, a pixel at a time, off a spot another slot already holds (two on one spot is invalid). */
function clearOfOthers(list: ReadonlyArray<PartySlot>, index: number, side: Side): void {
  const q = list[index];
  if (!q) return;
  const [lo, hi] = xRange(side);
  const base = q.x;
  // Try 1 pixel right, 1 left, 2 right, 2 left... until the spot is free.
  for (let step = 1; step <= 40 && taken(list, index, q); step++) q.x = clamp(base + (step % 2 === 1 ? (step + 1) / 2 : -step / 2), lo, hi);
}

/** Where a dragged fighter's feet should land: the editor's snapping rules in one place. */
export interface DragOptions {
  /** Snap to the nearest depth row (otherwise the row is the nearest one and the rest is a `dy` nudge up to 8 px). */
  rows: boolean;
  /** Snap x to the 8 px grid. */
  grid: boolean;
}

/** The slot values for feet dropped at (x, y) on the screen, under the snapping options. */
export function slotFor(s: StageBody, side: Side, x: number, y: number, opts: DragOptions): { x: number; row: number; dy: number } {
  const [lo, hi] = xRange(side);
  const px = opts.grid ? Math.round(x / GRID) * GRID : Math.round(x);
  const snapped = snapSlot(s, side, clamp(px, lo, hi), y);
  const rowY = slotPoint(s, { x: snapped.x, row: snapped.row }).y;
  const dy = opts.rows ? 0 : clamp(Math.round(y - rowY), -8, 8);
  return { x: clamp(snapped.x, lo, hi), row: snapped.row, dy };
}

/** Where a slot stood when a drag began. */
export interface SlotStart {
  index: number;
  x: number;
  row: number;
  dy: number;
}

/** Remember where some slots stand (a drag moves them relative to this). */
export function startsOf(list: ReadonlyArray<PartySlot>, indices: readonly number[]): SlotStart[] {
  return indices.flatMap((index) => {
    const q = list[index];
    return q ? [{ index, x: q.x, row: q.row, dy: q.dy ?? 0 }] : [];
  });
}

/**
 * Move a group of slots together by a change of x, rows and nudge from where they started (a multi-selection
 * drag). Each keeps its distance from the others; one that would leave the screen or the rows stops at the edge.
 */
export function moveGroup(s: StageBody, side: Side, setKey: string, starts: readonly SlotStart[], dx: number, dRow: number, dy: number): void {
  const list = slotList(s, side, setKey);
  const [lo, hi] = xRange(side);
  for (const st of starts) {
    const q = list[st.index];
    if (!q) continue;
    q.x = clamp(st.x + dx, lo, hi);
    q.row = clamp(st.row + dRow, 0, s.rows.length - 1);
    if (st.dy + dy !== 0) q.dy = clamp(st.dy + dy, -8, 8);
    else delete q.dy;
  }
  for (const st of starts) clearOfOthers(list, st.index, side);
}

/** Arrow-key nudge: sideways by `dx` pixels, and up or down by whole rows. */
export function nudgeSlots(s: StageBody, side: Side, setKey: string, indices: readonly number[], dx: number, dRow: number): void {
  const list = slotList(s, side, setKey);
  const [lo, hi] = xRange(side);
  for (const i of indices) {
    const q = list[i];
    if (!q) continue;
    q.x = clamp(q.x + dx, lo, hi);
    q.row = clamp(q.row + dRow, 0, s.rows.length - 1);
    if (dRow !== 0) delete q.dy;
  }
  for (const i of indices) clearOfOthers(list, i, side);
}

/** Set a slot's draw-order override (forward 1, back -1, or automatic 0, which is stored as nothing). */
export function setOrder(s: StageBody, side: Side, setKey: string, index: number, order: -1 | 0 | 1): void {
  const q = slotList(s, side, setKey)[index];
  if (!q) return;
  if (order === 0) delete q.order;
  else q.order = order;
}

/** Bring a fighter forward or send it back by one step: -1, 0 or 1, never beyond. Returns the new value. */
export function stepOrder(s: StageBody, side: Side, setKey: string, index: number, by: 1 | -1): -1 | 0 | 1 {
  const q = slotList(s, side, setKey)[index];
  const next = clamp((q?.order ?? 0) + by, -1, 1) as -1 | 0 | 1;
  setOrder(s, side, setKey, index, next);
  return next;
}

// ------------------------------------------------------------------ formations: align, copy from n-1

/**
 * An even formation for a group of this size (the Align button, like RPG Maker's): enemies spread over the rows
 * from back to front in two staggered columns on the right half of the stage. A boss stands in the middle row
 * with its helpers on the front and back rows behind it.
 */
export function alignedSlots(rowCount: number, key: string): EnemySlot[] {
  const last = rowCount - 1;
  const mid = Math.floor(last / 2);
  const n = setSize(key);
  if (key.startsWith('boss')) {
    const helpers = n - 1;
    const helperRows = [Math.min(1, last), Math.max(last - 1, 0)];
    return [
      { x: 372, row: mid, size: 'boss' },
      ...Array.from({ length: helpers }, (_, i): EnemySlot => ({ x: 436, row: helperRows[i] ?? 0 })),
    ];
  }
  if (n === 1) return [{ x: 356, row: mid }];
  return Array.from({ length: n }, (_, i): EnemySlot => ({ x: i % 2 === 0 ? 312 : 404, row: Math.round((i * last) / (n - 1)) }));
}

/** Re-lay one group evenly (one undo step). Boss markers stay. */
export function alignEnemies(s: StageBody, key: string): void {
  s.enemySets[key] = alignedSlots(s.rows.length, key);
}

/** The group with one fewer enemy, which "Copy from n-1" starts from; null for the smallest groups. */
export function previousKey(key: string): string | null {
  if (key === 'boss' || key === '1') return null;
  if (key.startsWith('boss+')) return Number(key.slice(5)) <= 1 ? 'boss' : `boss+${Number(key.slice(5)) - 1}`;
  return String(Number(key) - 1);
}

/** Start a group from the one with one fewer enemy and add the extra slot on a row nobody stands on. Returns a reason when there is nothing to copy. */
export function copyFromPrevious(s: StageBody, key: string): string | null {
  const prev = previousKey(key);
  if (!prev) return `The group "${key}" is the smallest; there is nothing to copy from`;
  const from = s.enemySets[prev];
  if (!from) return `There is no group "${prev}" to copy from`;
  const out: EnemySlot[] = cloneStage(from);
  const used = new Set(out.map((q) => q.row));
  const row = s.rows.findIndex((_, i) => !used.has(i));
  const extra: EnemySlot = { x: 404, row: row >= 0 ? row : 0 };
  out.push(extra);
  s.enemySets[key] = out;
  clearOfOthers(out, out.length - 1, 'enemy');
  return null;
}

// ------------------------------------------------------------------ HUD boxes: the global layout and a stage's overrides

/**
 * Everything the editor edits and Save writes: the stages file, the foot-anchor corrections, the global HUD layout and
 * which enemies are mirrored and how tall and broad each hero stands (five files, `stages.json`, `axes.json`, `hud.json`,
 * `enemyfacing.json` and `heroes.json`). Only `stages` holds anything about one stage's own layout; the rest is global.
 */
export interface EditorData {
  stages: EntryFile;
  axes: AxesFile;
  hud: HudLayout;
  facing: FacingFile;
  heroes: HeroesFile;
}

/** Turn one enemy sprite's mirror on or off in the data (the entry always exists: the loader refuses a file without one). */
export function setMirror(d: EditorData, sprite: string, on: boolean): void {
  const entry = d.facing[sprite];
  if (entry) entry.mirror = on;
}

/** Set one number of one hero's proportions in the data (the entry always exists: the loader refuses a file without one). */
export function setProportion(d: EditorData, hero: string, key: 'height' | 'build', value: number): void {
  const entry = d.heroes[hero];
  if (entry) entry[key] = value;
}

/** A HUD box's position and size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The HUD works on two levels, in plain words. The **global layout** (`hud.json`) is one HUD for every battle. A
 * stage may **override** single boxes: it then keeps its own copy of the fields that differ, and the rest still
 * follow the global layout. A box a stage overrides is edited on that stage only; any other box is edited in the
 * global layout, so the change shows on every stage.
 */
export function isOverridden(stage: StageEntry, region: HudRegionKey): boolean {
  return !!stage.hud?.[region];
}

/** The value a HUD box has on a stage right now: the stage's own, else the global one. */
export function hudNow(data: EditorData, stageId: string, region: HudRegionKey, field: HudField): number | string {
  const over = (data.stages[stageId]?.hud?.[region] as Record<string, number | string> | undefined)?.[field];
  if (over !== undefined) return over;
  const r = data.hud[region] as unknown as Record<string, number | string | undefined>;
  return r[field] ?? (field === 'opacity' ? 1 : 0);
}

/** Write one field of a HUD box where it belongs: into the stage's override if that box is overridden here, else into the global layout. A value equal to the global one is not kept in an override. */
function writeHud(data: EditorData, stageId: string, region: HudRegionKey, field: HudField, value: number | string): void {
  const stage = data.stages[stageId];
  const over = stage?.hud?.[region] as Record<string, number | string> | undefined;
  if (over) {
    const global = (data.hud[region] as unknown as Record<string, number | string | undefined>)[field] ?? (field === 'opacity' ? 1 : undefined);
    if (global === value) delete over[field];
    else over[field] = value;
  } else setField(data.hud, region, field, value);
}

/** Move and/or resize a HUD box, keeping it whole on the screen and at least a small size. */
export function setHudBox(data: EditorData, stageId: string, region: HudRegionKey, box: Partial<Box>): void {
  const now = (f: 'x' | 'y' | 'w' | 'h'): number => Number(hudNow(data, stageId, region, f));
  const w = clamp(Math.round(box.w ?? now('w')), 16, SCREEN_W);
  const h = clamp(Math.round(box.h ?? now('h')), 8, SCREEN_H);
  const x = clamp(Math.round(box.x ?? now('x')), 0, SCREEN_W - w);
  const y = clamp(Math.round(box.y ?? now('y')), 0, SCREEN_H - h);
  writeHud(data, stageId, region, 'x', x);
  writeHud(data, stageId, region, 'y', y);
  writeHud(data, stageId, region, 'w', w);
  writeHud(data, stageId, region, 'h', h);
}

/** Set one HUD field from the inspector (the number fields are clamped like a drag; `show` and `opacity` as given). */
export function setHudField(data: EditorData, stageId: string, region: HudRegionKey, field: HudField, value: number | string): void {
  if (field === 'x' || field === 'y' || field === 'w' || field === 'h') setHudBox(data, stageId, region, { [field]: Number(value) });
  else if (field === 'opacity') writeHud(data, stageId, region, field, clamp(Number(value), 0, 1));
  else writeHud(data, stageId, region, field, value);
}

/** Give a stage its own copy of a box: from now on edits to it stay on this stage. Nothing changes on screen yet (the override starts empty and holds only what differs). */
export function overrideRegion(data: EditorData, stageId: string, region: HudRegionKey): void {
  const stage = data.stages[stageId];
  if (!stage) return;
  stage.hud = stage.hud ?? {};
  stage.hud[region] = stage.hud[region] ?? {};
}

/** Take a stage's own copy of a box away: the box follows the global layout again. */
export function clearOverride(data: EditorData, stageId: string, region: HudRegionKey): void {
  const stage = data.stages[stageId];
  if (!stage?.hud) return;
  delete stage.hud[region];
  if (!Object.keys(stage.hud).length) delete stage.hud;
}

/** Put one overridden field back to the global value (the box stays overridden). */
export function revertOverrideField(data: EditorData, stageId: string, region: HudRegionKey, field: HudField): void {
  const over = data.stages[stageId]?.hud?.[region] as Record<string, unknown> | undefined;
  if (over) delete over[field];
}

/** The fields a stage overrides, for the inspector's list: each with the stage's value and the global one. */
export function stageOverrides(data: EditorData, stageId: string): Array<{ region: HudRegionKey; field: HudField; value: number | string; global: number | string }> {
  const hud = data.stages[stageId]?.hud;
  const out: Array<{ region: HudRegionKey; field: HudField; value: number | string; global: number | string }> = [];
  if (!hud) return out;
  for (const region of HUD_REGIONS) {
    const box = hud[region] as HudBoxOverride | undefined;
    if (!box) continue;
    for (const field of HUD_FIELDS) {
      const value = (box as Record<string, number | string | undefined>)[field];
      if (value === undefined) continue;
      const g = (data.hud[region] as unknown as Record<string, number | string | undefined>)[field] ?? (field === 'opacity' ? 1 : 0);
      out.push({ region, field, value, global: g });
    }
  }
  return out;
}

/**
 * Tidy the data before it is written: a stage override keeps only the fields that really differ from the global
 * layout, a box left with no fields stops being an override, and a stage with no overrides carries no `hud` at all.
 * ("Remove the per-stage HUD fields unless they differ from global.") Returns true when it changed anything.
 */
export function settleData(data: EditorData): boolean {
  let changed = false;
  for (const stage of Object.values(data.stages)) {
    const hud = stage.hud;
    if (!hud) continue;
    for (const region of HUD_REGIONS) {
      const box = hud[region] as Record<string, number | string | undefined> | undefined;
      if (!box) continue;
      for (const field of HUD_FIELDS) {
        const g = (data.hud[region] as unknown as Record<string, number | string | undefined>)[field] ?? (field === 'opacity' ? 1 : undefined);
        if (box[field] !== undefined && box[field] === g) {
          delete box[field];
          changed = true;
        }
      }
      if (!Object.keys(box).length) {
        delete hud[region];
        changed = true;
      }
    }
    if (!Object.keys(hud).length) {
      delete stage.hud;
      changed = true;
    }
  }
  return changed;
}

// ------------------------------------------------------------------ the stage list

/** A name like `base`, or `base-2`, `base-3`... that no stage in the file uses. */
export function uniqueId(file: EntryFile, base: string): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
  if (!file[stem]) return stem;
  for (let n = 2; ; n++) if (!file[`${stem}-${n}`]) return `${stem}-${n}`;
}

/** The kinds of change the list buttons make: each returns the id to show afterwards, or a reason it was refused. */
export type ListResult = { ok: true; id: string } | { ok: false; reason: string };

/** A new stage, started from a copy of an existing one (the template: its floor, rows, slots and HUD) under a new id and name. */
export function newStage(file: EntryFile, templateId: string, name: string): ListResult {
  const t = file[templateId];
  if (!t) return { ok: false, reason: `There is no stage "${templateId}" to start from` };
  const id = uniqueId(file, name);
  const copy = cloneStage(t);
  copy.id = id;
  copy.name = name.trim() || id;
  delete copy.note;
  file[id] = copy;
  return { ok: true, id };
}

/** A copy of a stage next to the original. */
export function duplicateStage(file: EntryFile, id: string): ListResult {
  const t = file[id];
  if (!t) return { ok: false, reason: `There is no stage "${id}"` };
  const copyId = uniqueId(file, `${id}-copy`);
  const copy = cloneStage(t);
  copy.id = copyId;
  copy.name = `${t.name} copy`;
  // Insert right after the original so the list reads naturally.
  const entries = Object.entries(file);
  for (const k of Object.keys(file)) delete file[k];
  for (const [k, v] of entries) {
    file[k] = v;
    if (k === id) file[copyId] = copy;
  }
  return { ok: true, id: copyId };
}

/** Change a stage's display name, and its id too when `newId` differs (the key in the file and the stage's own `id` stay equal). */
export function renameStage(file: EntryFile, id: string, name: string, newId?: string): ListResult {
  const t = file[id];
  if (!t) return { ok: false, reason: `There is no stage "${id}"` };
  const target = newId ?? id;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(target)) return { ok: false, reason: 'An id is lowercase words joined by dashes, like "sinkline-gate"' };
  if (target !== id && file[target]) return { ok: false, reason: `There is already a stage "${target}"` };
  if (!name.trim()) return { ok: false, reason: 'A stage needs a name' };
  t.name = name.trim();
  if (target !== id) {
    t.id = target;
    const entries = Object.entries(file);
    for (const k of Object.keys(file)) delete file[k];
    for (const [k, v] of entries) file[k === id ? target : k] = v;
  }
  return { ok: true, id: target };
}

/** Remove a stage. Refused for the last one (the game needs at least one). `usedBy` names anything that refers to the stage (maps and troops, once they exist). */
export function deleteStage(file: EntryFile, id: string, usedBy: readonly string[] = []): ListResult {
  if (!file[id]) return { ok: false, reason: `There is no stage "${id}"` };
  if (usedBy.length) return { ok: false, reason: `${id} is used by ${usedBy.join(', ')}` };
  const ids = Object.keys(file);
  if (ids.length <= 1) return { ok: false, reason: 'The last stage cannot be deleted' };
  const index = ids.indexOf(id);
  delete file[id];
  return { ok: true, id: ids[index + 1] ?? ids[index - 1] ?? '' };
}

// ------------------------------------------------------------------ align and distribute (a design tool's Align bar)

/** Sideways alignment: the left edges, the centres or the right edges line up. */
export type AlignAcross = 'left' | 'centre' | 'right';
/** Depth alignment of fighters: all on the back row, the middle one or the front row. (A HUD box says top, middle, bottom instead.) */
export type AlignDepth = 'back' | 'middle' | 'front';

/** How far a fighter's drawn pixels reach left and right of its feet, in game pixels (both are zero or more). The page measures it from the scene. */
export interface Reach {
  left: number;
  right: number;
}

/** The least space, in px, kept between two fighters' drawn edges when Align packs them side by side on one row. */
export const ALIGN_GAP = 2;

/**
 * Where a side's fighters may stand, as DRAWN edges (the left and right of the picture, not the feet). Align keeps every
 * fighter inside this range, so an Align can never walk a fighter into a rule the stage checks (`rules.ts`):
 *  - heroes stay in the left half, 0 to 240;
 *  - enemies stay from `RULE_LIMITS.nearest` (260, the nearest an enemy's left edge may be) to the screen's right edge
 *    less `RULE_LIMITS.edgeMargin` (476, an enemy that touches the edge looks cut off).
 *
 * `against` is where the OTHER side stands, when the caller knows: for heroes the drawn left edge of the nearest enemy (of
 * any enemy group of the stage), for enemies the drawn right edge of the farthest hero. The 55 px gap rule then narrows
 * the range (`heroRightLimit`, `enemyLeftLimit` in `rules.ts`): with enemies at 260 a hero's right edge stops at 205, not 240.
 * A limit that would leave no room at all is ignored: the stage already breaks the rule and Align cannot mend that.
 */
export function standingRange(side: Side, against?: number): { l: number; r: number } {
  const base = side === 'party' ? { l: 0, r: SCREEN_W / 2 } : { l: RULE_LIMITS.nearest, r: SCREEN_W - RULE_LIMITS.edgeMargin };
  if (against === undefined) return base;
  if (side === 'party') {
    const r = Math.min(base.r, heroRightLimit(against));
    return r > base.l ? { l: base.l, r } : base;
  }
  const l = Math.max(base.l, enemyLeftLimit(against));
  return l < base.r ? { l, r: base.r } : base;
}

/** What an Align that moves fighters did, worked out from where everyone FINALLY stands, so the status line can say what really happened. */
export interface AcrossResult {
  /** Fighters that were packed side by side with a neighbour on their row (0 when every one had a row to itself). */
  packed: number;
  /** How many rows had two or more fighters that had to be packed. */
  packedRows: number;
  /** How many fighters the Align was asked to move (those with a measured size). */
  total: number;
  /** How many of them stand where the Align put them in the end. */
  fit: number;
  /** Fighters left out because there was no room for them: they stayed EXACTLY where they were (the same row, x and small nudge). */
  short: number;
  /** Fighters that had to slide a pixel or more off a spot another fighter holds, after the Align had placed them. */
  slid: number;
  /** How many of them stand somewhere else than before (another row, x or small nudge). The others did not change. */
  moved: number;
  /** The range the fighters were kept inside (drawn edges). */
  range: { l: number; r: number };
  /** True when the gap rule to the other side narrowed that range (so the status line can say why a fighter stopped short of the edge). */
  limited: boolean;
}

const emptyResult = (range: { l: number; r: number }, limited = false): AcrossResult => ({ packed: 0, packedRows: 0, total: 0, fit: 0, short: 0, slid: 0, moved: 0, range, limited });

/** A fighter being lined up: its place in the list, its slot and how far its picture reaches. */
interface Placed {
  i: number;
  q: PartySlot;
  r: Reach;
}

/** A stretch of a row that something else holds: the drawn edges of a fighter that stays where it is. */
interface Blocked {
  l: number;
  r: number;
}

/** The slots' drawn left edge. */
const leftEdge = (p: Placed): number => p.q.x - p.r.left;
/** The drawn edges of a fighter as it stands now. */
const intervalOf = (p: Placed): Blocked => ({ l: p.q.x - p.r.left, r: p.q.x + p.r.right });
/** True when a fighter with this reach standing at `x` would come closer than `ALIGN_GAP` to the blocked stretch (or into it). */
const hits = (x: number, r: Reach, b: Blocked): boolean => x - r.left < b.r + ALIGN_GAP && x + r.right + ALIGN_GAP > b.l;

/**
 * The stretches of one row that fighters hold which this Align does NOT move: everyone in the list who is not in `moving` and
 * stands on `row`. A fighter whose size is not known counts as a point. Whatever is moved must keep `ALIGN_GAP` clear of these.
 */
function standingOn(list: ReadonlyArray<PartySlot>, row: number, moving: ReadonlySet<number>, reach: Readonly<Record<number, Reach>>): Blocked[] {
  return list.flatMap((q, i) => (moving.has(i) || q.row !== row ? [] : [{ l: q.x - (reach[i]?.left ?? 0), r: q.x + (reach[i]?.right ?? 0) }]));
}

/**
 * True when some fighter of `group` comes closer than `ALIGN_GAP` to another one of the group or to a fixed stretch (two fixed
 * stretches near each other are not this Align's business). The test looks at the right edge of the FURTHEST fighter so far in
 * left-to-right order, not only at the one before: a wide fighter can overlap one that stands two places later.
 */
function crowded(group: readonly Placed[], fixed: readonly Blocked[]): boolean {
  const all = [...group.map((p) => ({ ...intervalOf(p), mine: true })), ...fixed.map((b) => ({ ...b, mine: false }))].sort((a, b) => a.l - b.l);
  let anyRight = Number.NEGATIVE_INFINITY; // furthest right edge of anything so far
  let myRight = Number.NEGATIVE_INFINITY; // furthest right edge of the group so far
  for (const e of all) {
    if (e.l < (e.mine ? anyRight : myRight) + ALIGN_GAP) return true;
    anyRight = Math.max(anyRight, e.r);
    if (e.mine) myRight = Math.max(myRight, e.r);
  }
  return false;
}

/**
 * Put the fighters, in this order, as far left as they go starting at the drawn edge `from`: each at the first place that is
 * `ALIGN_GAP` clear of the one before and of every blocker. Stops at the first fighter that has no place left before `limit`
 * (the range's right end); the ones after it are not placed either.
 */
function fillRight(order: readonly Placed[], from: number, limit: number, blockers: readonly Blocked[]): Array<{ p: Placed; x: number }> {
  const out: Array<{ p: Placed; x: number }> = [];
  let left = Math.ceil(from);
  for (const p of order) {
    let x = Math.ceil(left + p.r.left);
    for (let hit = blockers.find((b) => hits(x, p.r, b)); hit; hit = blockers.find((b) => hits(x, p.r, b))) {
      left = Math.max(left + 1, Math.ceil(hit.r + ALIGN_GAP));
      x = Math.ceil(left + p.r.left);
    }
    if (x + p.r.right > limit) break;
    out.push({ p, x });
    left = Math.ceil(x + p.r.right + ALIGN_GAP);
  }
  return out;
}

/** The mirror of `fillRight`: the fighters in this order (the right-most first) from the drawn edge `from` toward the left, as far right as they go. */
function fillLeft(order: readonly Placed[], from: number, limit: number, blockers: readonly Blocked[]): Array<{ p: Placed; x: number }> {
  const out: Array<{ p: Placed; x: number }> = [];
  let right = Math.floor(from);
  for (const p of order) {
    let x = Math.floor(right - p.r.right);
    for (let hit = blockers.find((b) => hits(x, p.r, b)); hit; hit = blockers.find((b) => hits(x, p.r, b))) {
      right = Math.min(right - 1, Math.floor(hit.l - ALIGN_GAP));
      x = Math.floor(right - p.r.right);
    }
    if (x - p.r.left < limit) break;
    out.push({ p, x });
    right = Math.floor(x - p.r.left - ALIGN_GAP);
  }
  return out;
}

/**
 * Pack fighters of ONE row side by side in their current left-to-right order, `ALIGN_GAP` apart, as one block that
 * stays inside `range`. The block lines up with `span` (its left edge, its right edge or its centre), and slides to stay
 * inside the range if that would push it out. When all of them are wider than the range, as many as fit are packed,
 * counted from the side the block lines up against (from the right for Right, else from the left); the rest stay out.
 * Returns the planned x for those that fit, in left-to-right order, and the ones left out.
 *
 * `blockers` are stretches of the row that fighters hold which do not move. When the block would land on one, the fighters
 * are placed around them instead (`fillRight` / `fillLeft`), one by one at the first free place from the block's side; a fighter
 * with no free place left is one of the ones left out.
 */
function packRow(group: readonly Placed[], how: AlignAcross, span: { l: number; r: number }, range: { l: number; r: number }, blockers: readonly Blocked[] = []): { fit: Array<{ p: Placed; x: number }>; rest: Placed[] } {
  // Left to right as they stand now (ties: the lower x, then the first selected), so the order never changes.
  const ordered = [...group].sort((a, b) => leftEdge(a) - leftEdge(b) || a.q.x - b.q.x);
  const room = range.r - range.l;
  const seq = how === 'right' ? [...ordered].reverse() : ordered;
  const chosen: Placed[] = [];
  let width = 0;
  for (const p of seq) {
    const next = width + p.r.left + p.r.right + (chosen.length ? ALIGN_GAP : 0);
    if (next > room) break;
    chosen.push(p);
    width = next;
  }
  const fitOrder = how === 'right' ? chosen.reverse() : chosen;
  // Where the block's left drawn edge goes, kept inside the range.
  const wanted = how === 'left' ? span.l : how === 'right' ? span.r - width : (span.l + span.r) / 2 - width / 2;
  const start = clamp(wanted, range.l, range.r - width);
  // Pack left to right. Rounding must never push two fighters back onto each other, so each is at least the gap past the one before.
  let prevRight = Number.NEGATIVE_INFINITY;
  let cursor = Math.round(start);
  let fit = fitOrder.map((p) => {
    const left = Math.max(cursor, prevRight + ALIGN_GAP);
    const x = Math.round(left + p.r.left);
    prevRight = x + p.r.right;
    cursor = prevRight + ALIGN_GAP;
    return { p, x };
  });
  if (blockers.some((b) => fit.some(({ p, x }) => hits(x, p.r, b)))) {
    // Something that does not move stands in the way of the block: place the fighters around it.
    if (how === 'left') fit = fillRight(ordered, clamp(span.l, range.l, range.r), range.r, blockers);
    else if (how === 'right') fit = fillLeft([...ordered].reverse(), clamp(span.r, range.l, range.r), range.l, blockers).reverse();
    else {
      // Centre: the block as wide as before, from the nearest start (moving out from the centred one) where all of it clears the blockers.
      const want = fit.map((f) => f.p);
      const first = fit[0];
      const s0 = first ? first.x - first.p.r.left : range.l;
      let found: Array<{ p: Placed; x: number }> | null = null;
      for (let step = 0; step <= room && !found; step++) {
        for (const s of step === 0 ? [s0] : [s0 + step, s0 - step]) {
          if (s < range.l || s > range.r) continue;
          const placed = fillRight(want, s, range.r, blockers);
          if (placed.length === want.length) {
            found = placed;
            break;
          }
        }
      }
      fit = found ?? fillRight(ordered, range.l, range.r, blockers);
    }
  }
  return { fit, rest: ordered.filter((p) => !fit.some((f) => f.p === p)) };
}

/**
 * `packRow` for a row where some of the fighters that did not fit may still STAND on the row (`standsHere`): they stay where
 * they are, so they are walls for the others. Without this, the ones that fit could be packed onto the ones that stayed. The
 * plan is made again with each such fighter as a wall until nobody new is left out; it ends because the walls only grow.
 */
function planRow(group: readonly Placed[], how: AlignAcross, span: { l: number; r: number }, range: { l: number; r: number }, fixed: readonly Blocked[], standsHere: (p: Placed) => boolean): { fit: Array<{ p: Placed; x: number }>; rest: Placed[] } {
  let staying: Placed[] = [];
  for (;;) {
    const moving = group.filter((p) => !staying.includes(p));
    const plan = packRow(moving, how, span, range, [...fixed, ...staying.map(intervalOf)]);
    const stuck = plan.rest.filter(standsHere);
    if (!stuck.length) return { fit: plan.fit, rest: [...plan.rest, ...staying] };
    staying = [...staying, ...stuck];
  }
}

/** Where a fighter stood before an Align: the three things that say where a slot is. */
interface Spot {
  row: number;
  x: number;
  dy: number;
}
const spotOf = (q: PartySlot): Spot => ({ row: q.row, x: q.x, dy: q.dy ?? 0 });

/**
 * Write the planned places, let `clearOfOthers` nudge anyone who was PLACED on exactly another fighter's spot, and then
 * count what really happened from where everyone stands now (so the status line never reports a move that was undone).
 * A fighter that was not placed is never touched: it stays exactly where it was.
 */
function settle(list: ReadonlyArray<PartySlot>, side: Side, items: readonly Placed[], planned: Map<number, number>, packedGroups: number[], range: { l: number; r: number }, before: ReadonlyMap<number, Spot>, limited: boolean): AcrossResult {
  const [lo, hi] = xRange(side);
  const xBefore = new Map(items.map((p) => [p.i, p.q.x]));
  for (const p of items) {
    const x = planned.get(p.i);
    if (x !== undefined) p.q.x = clamp(x, lo, hi);
  }
  for (const p of items) if (planned.has(p.i)) clearOfOthers(list, p.i, side);
  let fit = 0;
  let slid = 0;
  let moved = 0;
  for (const p of items) {
    const x = planned.get(p.i);
    if (x !== undefined) {
      if (p.q.x === clamp(x, lo, hi)) fit++;
      else slid++;
    } else if (p.q.x !== xBefore.get(p.i)) slid++;
    const b = before.get(p.i);
    if (b && (b.row !== p.q.row || b.x !== p.q.x || b.dy !== (p.q.dy ?? 0))) moved++;
  }
  return { packed: packedGroups.reduce((sum, n) => sum + n, 0), packedRows: packedGroups.length, total: items.length, fit, short: items.length - planned.size, slid, moved, range, limited };
}

/**
 * Line fighters up sideways (the Align bar's Left, Centre, Right). One fighter lines up with its side's standing range
 * (`standingRange`: the heroes' half, or the enemies' from x 260 to 476, narrowed by the gap rule when `against` says where
 * the other side stands); two or more line up with each other, inside that range. The fighter's drawn edge is what lines up,
 * not its feet, so a wide boss and a thin hero share an edge.
 *
 * Two fighters on the SAME row cannot share an edge without standing on each other. So fighters that share a row are
 * packed side by side in their current left-to-right order, with `ALIGN_GAP` between their drawn edges (`packRow`).
 * Fighters alone on their row line up exactly as before. When a packed block is wider than the range, as many as fit are
 * packed and the rest stay where they were; nobody is ever pushed past the range.
 *
 * `reach` should hold EVERY fighter of the side (not only the selected ones): a fighter that is not selected but stands on
 * the same row never moves, and the others are placed around it, or stay where they were if there is no room.
 * The returned counts come from the final positions, so they say what really happened.
 */
export function alignAcross(s: StageBody, side: Side, setKey: string, indices: readonly number[], how: AlignAcross, reach: Readonly<Record<number, Reach>>, against?: number): AcrossResult {
  const list = slotList(s, side, setKey);
  const range = standingRange(side, against);
  const base = standingRange(side);
  const limited = range.l !== base.l || range.r !== base.r;
  const items = indices.flatMap((i): Placed[] => {
    const q = list[i];
    const r = reach[i];
    return q && r ? [{ i, q, r }] : [];
  });
  if (!items.length) return emptyResult(range, limited);
  const before = new Map(items.map((p) => [p.i, spotOf(p.q)]));
  const moving = new Set(items.map((p) => p.i));
  // The span the edges line up with: the fighters' own bounds (one fighter: the side's whole standing range), kept inside that range.
  // It is the side's OWN range, not the one narrowed by the gap rule: Centre still means the middle of the half, and `packRow` then slides the block back inside the narrower range if it would stand outside it.
  const own = items.length === 1 ? base : { l: Math.min(...items.map((p) => p.q.x - p.r.left)), r: Math.max(...items.map((p) => p.q.x + p.r.right)) };
  const span = { l: clamp(own.l, base.l, base.r), r: clamp(own.r, base.l, base.r) };
  const byRow = new Map<number, Placed[]>();
  for (const p of items) byRow.set(p.q.row, [...(byRow.get(p.q.row) ?? []), p]);
  const planned = new Map<number, number>();
  const packedGroups: number[] = [];
  for (const [row, group] of byRow) {
    // Fighters that are not selected but stand on this row are walls.
    const plan = planRow(group, how, span, range, standingOn(list, row, moving, reach), () => false);
    for (const { p, x } of plan.fit) planned.set(p.i, x);
    if (plan.fit.length > 1) packedGroups.push(plan.fit.length);
  }
  return settle(list, side, items, planned, packedGroups, range, before, limited);
}

/**
 * The middle row, by position in the list of rows: row 3 of 5, row 3 of 4, row 2 of 3 (index `floor(rows / 2)`). This is
 * what the Align bar's Middle means for one fighter. (It is not the row nearest the middle of the floor band: the
 * rows are not spread evenly over the floor, so that would pick a different row than the one you count.)
 */
export function middleRow(s: StageBody): number {
  return Math.floor(s.rows.length / 2);
}

/**
 * Put fighters on the same depth row (the Align bar's Back, Middle, Front). One fighter goes to the back row, the
 * front row or the middle row (`middleRow`); two or more go to the back-most, the front-most or the middle
 * of the rows they already use. Rows are the only places to stand, so this always lands on a valid row.
 *
 * Several fighters landing on one row can end up on top of each other, or on a fighter that is not selected and already
 * stands there (it never moves). When anyone comes closer than `ALIGN_GAP` to another, the selected fighters are packed
 * side by side like Align's Left / Centre / Right does (`packRow`): in their old left-to-right order, `ALIGN_GAP` apart, as
 * one block centred where they stood, inside the side's range, around whatever stands on the row. Fighters that already have
 * room keep their x. A fighter that does not fit on the row stays EXACTLY where it was (the same row, x and small nudge),
 * and it is a wall for the others if it stands on the target row. The result is counted from the final positions, like
 * `alignAcross`'s. `reach` should hold every fighter of the side, for the same reason as in `alignAcross`.
 */
export function alignDepth(s: StageBody, side: Side, setKey: string, indices: readonly number[], how: AlignDepth, reach: Readonly<Record<number, Reach>> = {}, against?: number): AcrossResult {
  const list = slotList(s, side, setKey);
  const range = standingRange(side, against);
  const base = standingRange(side);
  const limited = range.l !== base.l || range.r !== base.r;
  const items = indices.flatMap((i): Placed[] => {
    const q = list[i];
    return q ? [{ i, q, r: reach[i] ?? { left: 0, right: 0 } }] : [];
  });
  if (!items.length) return emptyResult(range, limited);
  const last = s.rows.length - 1;
  let target: number;
  if (items.length === 1) target = how === 'back' ? 0 : how === 'front' ? last : middleRow(s);
  else {
    const rows = items.map(({ q }) => q.row);
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    target = how === 'back' ? lo : how === 'front' ? hi : Math.round((lo + hi) / 2);
  }
  const row = clamp(target, 0, last);
  const before = new Map(items.map((p) => [p.i, spotOf(p.q)]));
  const moving = new Set(items.map((p) => p.i));
  // Fighters that are not selected but already stand on the target row never move: the others must keep clear of them.
  const fixed = standingOn(list, row, moving, reach);
  const planned = new Map<number, number>();
  const packedGroups: number[] = [];
  const goes = new Set<number>(); // who ends up on the target row
  const measured = items.filter((p) => reach[p.i]);
  if (measured.length && crowded(measured, fixed)) {
    const bounds = { l: Math.min(...measured.map(leftEdge)), r: Math.max(...measured.map((p) => p.q.x + p.r.right)) };
    const plan = planRow(measured, 'centre', { l: clamp(bounds.l, base.l, base.r), r: clamp(bounds.r, base.l, base.r) }, range, fixed, (p) => p.q.row === row);
    for (const { p, x } of plan.fit) {
      planned.set(p.i, x);
      goes.add(p.i);
    }
    if (plan.fit.length > 1) packedGroups.push(plan.fit.length);
    // The ones that did not fit are not in `planned` and not in `goes`: they keep their row, x and dy.
  } else {
    // Nothing to pack: everyone keeps their x (only an exact same spot is nudged).
    for (const p of measured) {
      planned.set(p.i, p.q.x);
      goes.add(p.i);
    }
  }
  // A fighter whose size is not known is not packed; it just changes row.
  for (const p of items) {
    if (reach[p.i]) continue;
    planned.set(p.i, p.q.x);
    goes.add(p.i);
  }
  for (const p of items) {
    if (!goes.has(p.i)) continue;
    p.q.row = row;
    delete p.q.dy;
  }
  return settle(list, side, items, planned, packedGroups, range, before, limited);
}

/** Spread three or more fighters evenly sideways, keeping the outer two where they are (equal gaps between their drawn edges). */
export function distributeAcross(s: StageBody, side: Side, setKey: string, indices: readonly number[], reach: Readonly<Record<number, Reach>>): void {
  const list = slotList(s, side, setKey);
  const [lo, hi] = xRange(side);
  const items = indices.flatMap((i) => {
    const q = list[i];
    const r = reach[i];
    return q && r ? [{ i, q, r }] : [];
  });
  if (items.length < 3) return;
  items.sort((a, b) => a.q.x - a.r.left - (b.q.x - b.r.left));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const start = first.q.x - first.r.left;
  const end = last.q.x + last.r.right;
  const widths = items.reduce((sum, { r }) => sum + r.left + r.right, 0);
  const gap = (end - start - widths) / (items.length - 1);
  let cursor = start;
  for (const { q, r } of items) {
    q.x = clamp(Math.round(cursor + r.left), lo, hi);
    cursor += r.left + r.right + gap;
  }
  for (const { i } of items) clearOfOthers(list, i, side);
}

/** Spread three or more fighters over the rows they span, as evenly as whole rows allow. */
export function distributeDepth(s: StageBody, side: Side, setKey: string, indices: readonly number[]): void {
  const list = slotList(s, side, setKey);
  const items = indices.flatMap((i) => {
    const q = list[i];
    return q ? [{ i, q }] : [];
  });
  if (items.length < 3) return;
  items.sort((a, b) => a.q.row - b.q.row);
  const lo = items[0]?.q.row ?? 0;
  const hi = items[items.length - 1]?.q.row ?? 0;
  items.forEach(({ q }, k) => {
    q.row = Math.round(lo + (k * (hi - lo)) / (items.length - 1));
    delete q.dy;
  });
  for (const { i } of items) clearOfOthers(list, i, side);
}

/** The HUD align choices: sideways (left, centre, right) and up and down (top, middle, bottom), or an even spread. */
export type BoxAlign = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom' | 'spreadAcross' | 'spreadDown';

/**
 * New top-left corners for HUD boxes under an Align choice. One box lines up with the screen; two or more with each
 * other. Pure: it only works out the corners (the caller writes them, so each lands in the global layout or the
 * stage's override as usual). Boxes that do not move are left out of the answer.
 */
export function alignBoxes(boxes: Readonly<Partial<Record<HudRegionKey, Box>>>, how: BoxAlign): Partial<Record<HudRegionKey, { x: number; y: number }>> {
  const entries = (Object.entries(boxes) as Array<[HudRegionKey, Box]>).filter(([, b]) => !!b);
  const out: Partial<Record<HudRegionKey, { x: number; y: number }>> = {};
  if (!entries.length) return out;
  const one = entries.length === 1;
  const l = one ? 0 : Math.min(...entries.map(([, b]) => b.x));
  const r = one ? SCREEN_W : Math.max(...entries.map(([, b]) => b.x + b.w));
  const t = one ? 0 : Math.min(...entries.map(([, b]) => b.y));
  const bt = one ? SCREEN_H : Math.max(...entries.map(([, b]) => b.y + b.h));
  const put = (k: HudRegionKey, b: Box, x: number, y: number): void => {
    const nx = clamp(Math.round(x), 0, SCREEN_W - b.w);
    const ny = clamp(Math.round(y), 0, SCREEN_H - b.h);
    if (nx !== b.x || ny !== b.y) out[k] = { x: nx, y: ny };
  };
  if (how === 'spreadAcross' || how === 'spreadDown') {
    if (entries.length < 3) return out;
    const across = how === 'spreadAcross';
    const sorted = [...entries].sort((a, b) => (across ? a[1].x - b[1].x : a[1].y - b[1].y));
    const size = (b: Box): number => (across ? b.w : b.h);
    const start = across ? l : t;
    const end = across ? r : bt;
    const gap = (end - start - sorted.reduce((sum, [, b]) => sum + size(b), 0)) / (sorted.length - 1);
    let cursor = start;
    for (const [k, b] of sorted) {
      put(k, b, across ? cursor : b.x, across ? b.y : cursor);
      cursor += size(b) + gap;
    }
    return out;
  }
  for (const [k, b] of entries) {
    if (how === 'left') put(k, b, l, b.y);
    else if (how === 'right') put(k, b, r - b.w, b.y);
    else if (how === 'centre') put(k, b, (l + r) / 2 - b.w / 2, b.y);
    else if (how === 'top') put(k, b, b.x, t);
    else if (how === 'bottom') put(k, b, b.x, bt - b.h);
    else put(k, b, b.x, (t + bt) / 2 - b.h / 2);
  }
  return out;
}
