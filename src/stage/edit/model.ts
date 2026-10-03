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
import type { AxesFile } from '../config';

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
 * Everything the editor edits and Save writes: the stages file, the foot-anchor corrections and the global HUD layout
 * (three files, `stages.json`, `axes.json` and `hud.json`).
 */
export interface EditorData {
  stages: EntryFile;
  axes: AxesFile;
  hud: HudLayout;
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

/**
 * Line fighters up sideways (the Align bar's Left, Centre, Right). One fighter lines up with its own half of the
 * stage, because heroes cannot cross the middle line and enemies cannot either; two or more line up with each other.
 * The fighter's drawn edge is what lines up, not its feet, so a wide boss and a thin hero share an edge.
 */
export function alignAcross(s: StageBody, side: Side, setKey: string, indices: readonly number[], how: AlignAcross, reach: Readonly<Record<number, Reach>>): void {
  const list = slotList(s, side, setKey);
  const [lo, hi] = xRange(side);
  const items = indices.flatMap((i) => {
    const q = list[i];
    const r = reach[i];
    return q && r ? [{ i, q, r }] : [];
  });
  if (!items.length) return;
  // The span the edges line up with: the fighters' own bounds, or (for one fighter) its half of the stage.
  const span =
    items.length === 1
      ? { l: side === 'party' ? 0 : SCREEN_W / 2, r: side === 'party' ? SCREEN_W / 2 : SCREEN_W }
      : { l: Math.min(...items.map(({ q, r }) => q.x - r.left)), r: Math.max(...items.map(({ q, r }) => q.x + r.right)) };
  for (const { q, r } of items) {
    if (how === 'left') q.x = span.l + r.left;
    else if (how === 'right') q.x = span.r - r.right;
    else q.x = (span.l + span.r) / 2 - (r.right - r.left) / 2;
    q.x = clamp(Math.round(q.x), lo, hi);
  }
  for (const { i } of items) clearOfOthers(list, i, side);
}

/** The row nearest the middle of the floor band (the Middle of one fighter aligned to the stage). */
export function middleRow(s: StageBody): number {
  const mid = (s.floor.y0 + s.floor.y1) / 2;
  let best = 0;
  s.rows.forEach((r, i) => {
    if (Math.abs(r.y - mid) < Math.abs((s.rows[best]?.y ?? 0) - mid)) best = i;
  });
  return best;
}

/**
 * Put fighters on the same depth row (the Align bar's Back, Middle, Front). One fighter goes to the back row, the
 * front row or the row nearest the middle of the floor; two or more go to the back-most, the front-most or the middle
 * of the rows they already use. Rows are the only places to stand, so this always lands on a valid row.
 */
export function alignDepth(s: StageBody, side: Side, setKey: string, indices: readonly number[], how: AlignDepth): void {
  const list = slotList(s, side, setKey);
  const items = indices.flatMap((i) => {
    const q = list[i];
    return q ? [{ i, q }] : [];
  });
  if (!items.length) return;
  const last = s.rows.length - 1;
  let target: number;
  if (items.length === 1) target = how === 'back' ? 0 : how === 'front' ? last : middleRow(s);
  else {
    const rows = items.map(({ q }) => q.row);
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    target = how === 'back' ? lo : how === 'front' ? hi : Math.round((lo + hi) / 2);
  }
  for (const { q } of items) {
    q.row = clamp(target, 0, last);
    delete q.dy;
  }
  for (const { i } of items) clearOfOthers(list, i, side);
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
