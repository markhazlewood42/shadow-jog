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
  type PartySlot,
  SCREEN_H,
  SCREEN_W,
  type StageConfig,
  type StageFile,
  setSize,
  slotPoint,
  snapSlot,
} from '../config';
import { type HudField, type HudRegionKey, setField } from '../hudpresets';

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
export function setHorizon(s: StageConfig, y: number): number {
  const back = s.rows[0]?.y ?? SCREEN_H;
  const v = clamp(Math.round(y), 0, back);
  s.backdrop.horizonY = v;
  s.floor.y0 = v;
  if (s.backdrop.mode === 'reproject') s.backdrop.shiftY = v - ART_KERB_ROW;
  return v;
}

/** Move the floor's bottom: not above the front row, not off the screen. */
export function setFloorBottom(s: StageConfig, y: number): number {
  const front = s.rows[s.rows.length - 1]?.y ?? 0;
  const v = clamp(Math.round(y), front, SCREEN_H);
  s.floor.y1 = v;
  return v;
}

/** Move one depth row's foot line: it stops one pixel short of its neighbours and inside the floor. Fighters on it move with it. */
export function setRowY(s: StageConfig, index: number, y: number): number {
  const row = s.rows[index];
  if (!row) throw new Error(`Row ${index} does not exist`);
  const lo = index === 0 ? s.floor.y0 : (s.rows[index - 1]?.y ?? 0) + 1;
  const hi = index === s.rows.length - 1 ? s.floor.y1 : (s.rows[index + 1]?.y ?? SCREEN_H) - 1;
  row.y = clamp(Math.round(y), lo, hi);
  return row.y;
}

/** Add a row in front of the others, 17 px below the last (the shipped spacing). Returns a reason when it cannot. */
export function addRow(s: StageConfig): string | null {
  if (s.rows.length >= 6) return 'A stage can have at most 6 depth rows';
  const last = s.rows[s.rows.length - 1]?.y ?? s.floor.y0;
  const y = Math.min(s.floor.y1, last + 17);
  if (y <= last) return 'There is no room below the front row; move the floor bottom down first';
  s.rows.push({ y });
  s.depthTint?.amounts.push(0);
  return null;
}

/** Every slot of the stage that stands on this row, as "Party 2", "Enemy 1 of 3 (set 3)" ... for a refusal message. */
export function slotsOnRow(s: StageConfig, row: number): string[] {
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
export function removeRow(s: StageConfig, index: number): string | null {
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
export function slotList(s: StageConfig, side: Side, setKey: string): Array<PartySlot | EnemySlot> {
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
export function slotFor(s: StageConfig, side: Side, x: number, y: number, opts: DragOptions): { x: number; row: number; dy: number } {
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
export function moveGroup(s: StageConfig, side: Side, setKey: string, starts: readonly SlotStart[], dx: number, dRow: number, dy: number): void {
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
export function nudgeSlots(s: StageConfig, side: Side, setKey: string, indices: readonly number[], dx: number, dRow: number): void {
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
export function setOrder(s: StageConfig, side: Side, setKey: string, index: number, order: -1 | 0 | 1): void {
  const q = slotList(s, side, setKey)[index];
  if (!q) return;
  if (order === 0) delete q.order;
  else q.order = order;
}

/** Bring a fighter forward or send it back by one step: -1, 0 or 1, never beyond. Returns the new value. */
export function stepOrder(s: StageConfig, side: Side, setKey: string, index: number, by: 1 | -1): -1 | 0 | 1 {
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
export function alignEnemies(s: StageConfig, key: string): void {
  s.enemySets[key] = alignedSlots(s.rows.length, key);
}

/** The group with one fewer enemy, which "Copy from n-1" starts from; null for the smallest groups. */
export function previousKey(key: string): string | null {
  if (key === 'boss' || key === '1') return null;
  if (key.startsWith('boss+')) return Number(key.slice(5)) <= 1 ? 'boss' : `boss+${Number(key.slice(5)) - 1}`;
  return String(Number(key) - 1);
}

/** Start a group from the one with one fewer enemy and add the extra slot on a row nobody stands on. Returns a reason when there is nothing to copy. */
export function copyFromPrevious(s: StageConfig, key: string): string | null {
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

// ------------------------------------------------------------------ HUD boxes

/** Move and/or resize a HUD box, keeping it whole on the screen and at least a small size. */
export function setHudBox(s: StageConfig, region: HudRegionKey, box: { x?: number; y?: number; w?: number; h?: number }): void {
  const r = s.hud[region];
  const w = clamp(Math.round(box.w ?? r.w), 16, SCREEN_W);
  const h = clamp(Math.round(box.h ?? r.h), 8, SCREEN_H);
  const x = clamp(Math.round(box.x ?? r.x), 0, SCREEN_W - w);
  const y = clamp(Math.round(box.y ?? r.y), 0, SCREEN_H - h);
  setField(s.hud, region, 'x', x);
  setField(s.hud, region, 'y', y);
  setField(s.hud, region, 'w', w);
  setField(s.hud, region, 'h', h);
}

/** Set one HUD field from the inspector (the number fields are clamped like a drag; `show` and `opacity` as given). */
export function setHudField(s: StageConfig, region: HudRegionKey, field: HudField, value: number | string): void {
  if (field === 'x' || field === 'y' || field === 'w' || field === 'h') setHudBox(s, region, { [field]: Number(value) });
  else if (field === 'opacity') setField(s.hud, region, field, clamp(Number(value), 0, 1));
  else setField(s.hud, region, field, value);
}

// ------------------------------------------------------------------ the stage list

/** A name like `base`, or `base-2`, `base-3`... that no stage in the file uses. */
export function uniqueId(file: StageFile, base: string): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
  if (!file[stem]) return stem;
  for (let n = 2; ; n++) if (!file[`${stem}-${n}`]) return `${stem}-${n}`;
}

/** The kinds of change the list buttons make: each returns the id to show afterwards, or a reason it was refused. */
export type ListResult = { ok: true; id: string } | { ok: false; reason: string };

/** A new stage, started from a copy of an existing one (the template: its floor, rows, slots and HUD) under a new id and name. */
export function newStage(file: StageFile, templateId: string, name: string): ListResult {
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
export function duplicateStage(file: StageFile, id: string): ListResult {
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
export function renameStage(file: StageFile, id: string, name: string, newId?: string): ListResult {
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
export function deleteStage(file: StageFile, id: string, usedBy: readonly string[] = []): ListResult {
  if (!file[id]) return { ok: false, reason: `There is no stage "${id}"` };
  if (usedBy.length) return { ok: false, reason: `${id} is used by ${usedBy.join(', ')}` };
  const ids = Object.keys(file);
  if (ids.length <= 1) return { ok: false, reason: 'The last stage cannot be deleted' };
  const index = ids.indexOf(id);
  delete file[id];
  return { ok: true, id: ids[index + 1] ?? ids[index - 1] ?? '' };
}
