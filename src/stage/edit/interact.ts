/**
 * Mouse handling for the Battle Stage Editor's centre view (Phaser spike `spike/phaser-stage`).
 *
 * The page puts a transparent layer over the stage; this file turns pointer events on it into game pixels
 * (0 to 480 by 0 to 270, whatever the zoom), works out what is under the pointer (`hitAt`), and runs the click and
 * drag rules of `docs/TOOLING-UI.md` 2.3:
 *
 *  - **Click** selects; **Shift+click** adds to or removes from the selection (fighters on one side, or HUD boxes);
 *    a click on nothing clears it.
 *  - **Drag** moves the selection. The scene and the panels follow on every movement (one live update, no undo
 *    step yet) and the whole drag is ONE undo step when the mouse is released. Esc during a drag puts everything back.
 *  - **Snapping:** fighters snap to the nearest depth row (the Rows toggle), x and the lines to the 8 px grid (the
 *    Grid toggle); holding **Ctrl** flips both for that one drag.
 *  - A press must travel a few screen pixels before it counts as a drag, so a plain click never nudges anything.
 *
 * It never edits stage data itself: it calls the pure functions in `model.ts` through the session.
 */
import { SCREEN_H, SCREEN_W, type StageConfig } from '../config';
import { type Corner, hitGrip, hitHud, hitLine, resizeBox } from './hit';
import { moveGroup, setFloorBottom, setHorizon, setHudBox, setRowY, slotFor, type SlotStart, slotList, startsOf, GRID, type Side, cloneStage } from './model';
import type { Item, Session } from './session';
import type { ViewState } from './view';
import type { Fighter, StageScene } from '../stagescene';
import type { HudRegionKey } from '../hudpresets';

export interface InteractHost {
  session: Session;
  view: ViewState;
  scene: () => StageScene;
  canvas: () => HTMLCanvasElement;
  /** The layer that receives the pointer. */
  layer: HTMLElement;
  /** Draw the handles again. */
  redraw: () => void;
  /** Put the scene in step with the data (called on every drag movement; the page batches them per frame). `floorFrom` freezes the floor's puddles at the drag's start. */
  syncScene: (floorFrom?: StageConfig) => void;
  /** Pointer position for the status line. */
  onPointer: (p: { x: number; y: number } | null, hit: Item | null) => void;
}

type Drag =
  | { kind: 'fighters'; side: Side; primary: number; starts: SlotStart[]; ptr: P; feet: P; frozen: StageConfig }
  | { kind: 'line'; item: Extract<Item, { kind: 'horizon' | 'floor' | 'row' }>; ptr: P; value: number }
  | { kind: 'hud'; region: HudRegionKey; corner: Corner | null; ptr: P; box: { x: number; y: number; w: number; h: number } };

interface P {
  x: number;
  y: number;
}

/** Screen pixels a press must travel before it is a drag. */
const DRAG_THRESHOLD = 3;
/** How close (in screen pixels) the pointer must be to a thin handle to grab it. */
const PICK_PX = 5;

const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

export class Interact {
  hover: Item | null = null;
  private drag: Drag | null = null;
  private down: { client: P; game: P; item: Item | null; shift: boolean; ctrl: boolean } | null = null;
  private dragging = false;

  constructor(private readonly host: InteractHost) {
    const layer = host.layer;
    layer.addEventListener('pointerdown', (e) => this.onDown(e));
    layer.addEventListener('pointermove', (e) => this.onMove(e));
    layer.addEventListener('pointerup', (e) => this.onUp(e));
    layer.addEventListener('pointercancel', () => this.cancel());
    layer.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.setHover(null);
        host.onPointer(null, null);
      }
    });
  }

  // ---------------------------------------------------------------- geometry

  /** The pointer in game pixels, and how many screen pixels one game pixel is. */
  private toGame(e: { clientX: number; clientY: number }): { p: P; scale: number } {
    const r = this.host.canvas().getBoundingClientRect();
    const scale = r.width / SCREEN_W;
    return { p: { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }, scale };
  }

  /** The fighter's place in its side's list, as a selectable item. */
  fighterItem(f: Fighter): Item {
    const mates = this.host.scene().fighters.filter((x) => x.side === f.side);
    return { kind: 'fighter', side: f.side, index: mates.indexOf(f) };
  }

  /** What is under a point, in the order the editor prefers (see the file header). */
  hitAt(p: P, scale: number): Item | null {
    const { session, view, scene } = this.host;
    const stage = session.stage;
    const tol = PICK_PX / scale;
    const locked = view.locked;
    const sel = session.selection;
    // 1. the corner grips of a selected HUD box
    if (view.show.hud && !locked.has('hud')) {
      for (const it of sel) if (it.kind === 'hud' && hitGrip(stage, it.region, p.x, p.y, tol)) return it;
    }
    // 2. a foot crosshair (only when the Anchors overlay is on)
    if (view.show.anchors && !locked.has('fighters')) {
      const sc = scene();
      for (const side of ['party', 'enemy'] as const) {
        const mates = sc.fighters.filter((f) => f.side === side);
        for (let i = 0; i < mates.length; i++) {
          const f = mates[i];
          if (f && Math.abs(p.x - f.x) <= tol && Math.abs(p.y - f.y) <= tol) return { kind: 'anchor', side, index: i };
        }
      }
    }
    // 3. a fighter, by its drawn pixels
    if (!locked.has('fighters')) {
      const f = scene().pick(p.x, p.y);
      if (f) return this.fighterItem(f);
    }
    // 4. a HUD box
    if (view.show.hud && !locked.has('hud')) {
      const r = hitHud(stage, p.x, p.y);
      if (r) return { kind: 'hud', region: r };
    }
    // 5. the horizon, floor bottom and depth rows
    if (!locked.has('ground')) return hitLine(stage, p.x, p.y, tol);
    return null;
  }

  private cursorFor(hit: Item | null, p: P, scale: number): string {
    if (!hit) return 'default';
    switch (hit.kind) {
      case 'fighter':
        return 'grab';
      case 'anchor':
        return 'crosshair';
      case 'hud': {
        const corner = hitGrip(this.host.session.stage, hit.region, p.x, p.y, PICK_PX / scale);
        return corner ? (CURSORS[corner] ?? 'move') : 'move';
      }
      default:
        return 'ns-resize';
    }
  }

  private setHover(it: Item | null): void {
    const same = JSON.stringify(it) === JSON.stringify(this.hover);
    this.hover = it;
    if (!same) this.host.redraw();
  }

  // ---------------------------------------------------------------- events

  private onDown(e: PointerEvent): void {
    const { view, session } = this.host;
    if (view.mode !== 'edit' || e.button !== 0) return;
    this.host.layer.setPointerCapture(e.pointerId);
    const { p, scale } = this.toGame(e);
    const hit = this.hitAt(p, scale);
    this.down = { client: { x: e.clientX, y: e.clientY }, game: p, item: hit, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    this.dragging = false;
    if (!hit) {
      if (!e.shiftKey) session.select([]);
      return;
    }
    if (e.shiftKey && (hit.kind === 'fighter' || hit.kind === 'hud')) {
      // Add to or remove from the selection (only things of one kind and, for fighters, one side).
      const cur = session.selection;
      const compatible = cur.every((c) => c.kind === hit.kind && (hit.kind !== 'fighter' || (c.kind === 'fighter' && c.side === hit.side)));
      const has = cur.some((c) => JSON.stringify(c) === JSON.stringify(hit));
      if (!compatible) session.select([hit]);
      else session.select(has ? cur.filter((c) => JSON.stringify(c) !== JSON.stringify(hit)) : [...cur, hit]);
      this.down = null;
      return;
    }
    const inSel = session.selection.some((c) => JSON.stringify(c) === JSON.stringify(hit));
    if (!inSel) session.select([hit]);
    this.drag = this.startDrag(hit, p);
  }

  private startDrag(hit: Item, p: P): Drag | null {
    const { session, scene } = this.host;
    const stage = session.stage;
    switch (hit.kind) {
      case 'fighter': {
        const side = hit.side;
        const list = slotList(stage, side, session.setKey);
        const chosen = session.selectedFighters(side);
        const idx = chosen.includes(hit.index) ? chosen : [hit.index];
        const f = scene().fighters.filter((x) => x.side === side)[hit.index];
        if (!f) return null;
        return { kind: 'fighters', side, primary: hit.index, starts: startsOf(list, idx), ptr: p, feet: { x: f.baseX, y: f.baseY }, frozen: cloneStage(stage) };
      }
      case 'horizon':
        return { kind: 'line', item: hit, ptr: p, value: stage.backdrop.horizonY };
      case 'floor':
        return { kind: 'line', item: hit, ptr: p, value: stage.floor.y1 };
      case 'row':
        return { kind: 'line', item: hit, ptr: p, value: stage.rows[hit.index]?.y ?? 0 };
      case 'hud': {
        const r = stage.hud[hit.region];
        const { scale } = this.toGame({ clientX: 0, clientY: 0 });
        void scale;
        const corner = hitGrip(stage, hit.region, p.x, p.y, PICK_PX / this.scaleNow());
        return { kind: 'hud', region: hit.region, corner, ptr: p, box: { x: r.x, y: r.y, w: r.w, h: r.h } };
      }
      default:
        return null;
    }
  }

  private scaleNow(): number {
    return this.host.canvas().getBoundingClientRect().width / SCREEN_W;
  }

  private onMove(e: PointerEvent): void {
    const { p, scale } = this.toGame(e);
    if (!this.drag || !this.down) {
      const hit = this.host.view.mode === 'edit' ? this.hitAt(p, scale) : null;
      this.setHover(hit);
      this.host.layer.style.cursor = this.cursorFor(hit, p, scale);
      this.host.onPointer(p, hit);
      return;
    }
    if (!this.dragging) {
      const dist = Math.hypot(e.clientX - this.down.client.x, e.clientY - this.down.client.y);
      if (dist < DRAG_THRESHOLD) return;
      this.dragging = true;
      this.host.layer.style.cursor = this.drag.kind === 'fighters' ? 'grabbing' : this.host.layer.style.cursor;
    }
    this.host.onPointer(p, null);
    // Ctrl flips the snapping for this movement.
    const flip = e.ctrlKey || e.metaKey;
    this.applyDrag(this.drag, p, flip);
  }

  private applyDrag(drag: Drag, p: P, flip: boolean): void {
    const { session, view } = this.host;
    const id = session.stageId;
    const snapGrid = view.snapGrid !== flip;
    const snapRows = view.snapRows !== flip;
    const stageOf = (d: { stages: Record<string, StageConfig> }): StageConfig => d.stages[id] as StageConfig;
    const dx = p.x - drag.ptr.x;
    const dy = p.y - drag.ptr.y;
    if (drag.kind === 'fighters') {
      const stage = session.stage;
      const to = slotFor(stage, drag.side, drag.feet.x + dx, drag.feet.y + dy, { rows: snapRows, grid: snapGrid });
      const first = drag.starts.find((s) => s.index === drag.primary);
      if (!first) return;
      session.live((d) => moveGroup(stageOf(d), drag.side, session.setKey, drag.starts, to.x - first.x, to.row - first.row, to.dy - first.dy));
      this.host.syncScene(drag.frozen);
    } else if (drag.kind === 'line') {
      const raw = drag.value + dy;
      const v = snapGrid ? Math.round(raw / GRID) * GRID : raw;
      const it = drag.item;
      session.live((d) => {
        const s = stageOf(d);
        if (it.kind === 'horizon') setHorizon(s, v);
        else if (it.kind === 'floor') setFloorBottom(s, v);
        else setRowY(s, it.index, v);
      });
      this.host.syncScene(session.stage);
    } else {
      const grid = (n: number): number => (snapGrid ? Math.round(n / GRID) * GRID : n);
      const b = drag.corner ? resizeBox(drag.box, drag.corner, dx, dy) : { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
      session.live((d) => setHudBox(stageOf(d), drag.region, drag.corner ? { x: grid(b.x), y: grid(b.y), w: grid(b.w), h: grid(b.h) } : { x: grid(b.x), y: grid(b.y) }));
      this.host.syncScene(session.stage);
    }
  }

  private onUp(e: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.down = null;
    if (this.host.layer.hasPointerCapture(e.pointerId)) this.host.layer.releasePointerCapture(e.pointerId);
    const { scale } = this.toGame(e);
    if (!drag || !this.dragging) {
      this.dragging = false;
      return;
    }
    this.dragging = false;
    this.host.session.end(this.labelOf(drag));
    // One last, unfrozen sync: the floor's puddles settle around where everyone ended up.
    this.host.syncScene();
    const { p } = this.toGame(e);
    this.host.layer.style.cursor = this.cursorFor(this.hitAt(p, scale), p, scale);
  }

  private labelOf(drag: Drag): string {
    const { session } = this.host;
    if (drag.kind === 'fighters') {
      const n = drag.starts.length;
      const who = n > 1 ? `${n} ${drag.side === 'party' ? 'heroes' : 'enemies'}` : this.nameOf(drag.side, drag.primary);
      return `Move ${who}`;
    }
    if (drag.kind === 'line') return drag.item.kind === 'horizon' ? 'Move the horizon' : drag.item.kind === 'floor' ? 'Move the floor bottom' : `Move row ${drag.item.index + 1}`;
    void session;
    return drag.corner ? `Resize the ${drag.region} box` : `Move the ${drag.region} box`;
  }

  private nameOf(side: Side, index: number): string {
    const f = this.host.scene().fighters.filter((x) => x.side === side)[index];
    return f?.name ?? `${side} ${index + 1}`;
  }

  /** Abandon a drag in progress (Esc): the data goes back to where it was when the drag began. */
  cancel(): boolean {
    if (!this.drag) return false;
    const was = this.dragging;
    this.drag = null;
    this.down = null;
    this.dragging = false;
    if (was) {
      this.host.session.cancel();
      this.host.syncScene();
    }
    return was;
  }

  get isDragging(): boolean {
    return this.dragging;
  }
}

export { SCREEN_H };
