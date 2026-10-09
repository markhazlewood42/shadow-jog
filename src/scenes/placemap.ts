/**
 * A place's map, from the Places menu: the whole map scaled to fit, dimmed like a printed plan,
 * with the exits labelled by where they lead and, on the map the crew is on, where they stand.
 */
import { sfx } from '../audio/sfx';
import type { Ctx } from '../engine/canvas';
import { drawText, measure } from '../engine/font';
import { Scene } from '../engine/game';
import { H, W } from '../sje/core/size';
import { getMap } from '../data/maps';
import { FieldMap } from '../field/fieldmap';
import { TS } from '../field/tiles';
import { state } from '../game/state';
import type { MapDef } from '../field/types';
import { drawWindow, UI, OVERLAY_DIM } from '../ui/draw';

/** A placed exit label: its dot, and the text box beside it. */
export interface ExitLabel {
  text: string;
  dot: { x: number; y: number };
  /** The text's box (left edge, top, width, height), after nudging clear of the others. */
  box: { x: number; y: number; w: number; h: number };
}

/** The plan's frame on screen, and its scale from map pixels. */
export function planRect(mapW: number, mapH: number): { x: number; y: number; w: number; h: number; k: number } {
  const box = { x: 14, y: 22, w: W - 28, h: H - 44 };
  const gw = mapW * TS, gh = mapH * TS;
  const k = Math.min(box.w / gw, box.h / gh);
  const w = Math.round(gw * k), h = Math.round(gh * k);
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h, k };
}

/**
 * Exit labels, one per destination: beside their dot (to the left near the right edge), kept
 * inside the screen, and stepped down (then up) past any label they'd overlap.
 */
export function exitLabels(def: MapDef, flags: Record<string, unknown>): ExitLabel[] {
  const r = planRect(Math.max(...def.terrain.map((row) => row.length)), def.terrain.length);
  const out: ExitLabel[] = [];
  const seen = new Set<string>();
  const hit = (b: ExitLabel['box']) => out.some((o) => b.x < o.box.x + o.box.w + 2 && o.box.x < b.x + b.w + 2 && b.y < o.box.y + o.box.h && o.box.y < b.y + b.h);
  for (const wp of def.warps ?? []) {
    if (wp.when && !wp.when(flags as never)) continue;
    let name: string;
    try {
      name = getMap(wp.to).name;
    } catch {
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const dot = { x: Math.round(r.x + (wp.x + (wp.w ?? 1) / 2) * TS * r.k), y: Math.round(r.y + (wp.y + (wp.h ?? 1) / 2) * TS * r.k) };
    const tw = measure(name);
    const left = dot.x > r.x + r.w * 0.7;
    const bx = Math.max(10, Math.min(W - 10 - tw, left ? dot.x - 4 - tw : dot.x + 4));
    const base = { x: bx, y: Math.max(20, Math.min(H - 30, dot.y - 4)), w: tw, h: 9 };
    let box = base;
    for (let step = 1; hit(box) && step < 12; step++) {
      const dy = (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 10;
      box = { ...base, y: Math.max(20, Math.min(H - 30, base.y + dy)) };
    }
    out.push({ text: name, dot, box });
  }
  return out;
}

/** Maps are baked once per visit to this screen, not per frame. */
const baked = new Map<string, FieldMap>();

export class PlaceMapScene extends Scene<void> {
  override opaque = false;
  override curtain = true;
  private m: FieldMap;
  private t = 0;
  private labels: ExitLabel[] | null = null;

  constructor(private id: string) {
    super();
    let m = baked.get(id);
    if (!m) {
      m = new FieldMap(getMap(id));
      baked.set(id, m);
    }
    this.m = m;
  }

  update(): void {
    this.t++;
    const inp = this.game.input;
    if (inp.pressed('cancel') || inp.pressed('confirm')) {
      sfx('cancel');
      this.close(undefined);
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = OVERLAY_DIM;
    ctx.fillRect(0, 0, W, H);
    drawWindow(ctx, 6, 6, W - 12, H - 12, { title: this.m.def.name.toUpperCase(), accent: UI.cyan });
    const { x, y, w, h, k } = planRect(this.m.w, this.m.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.m.ground, x, y, w, h);
    for (const s of this.m.sprites) ctx.drawImage(s.canvas, x + s.x * k, y + s.y * k, s.canvas.width * k, s.canvas.height * k);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this.m.emit, x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    // A plan, not a photo: tint it night-blue and rule it faintly.
    ctx.fillStyle = 'rgba(10,14,40,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(111,243,255,0.06)';
    const step = Math.max(4, Math.round(TS * k * 4));
    for (let gx = x; gx < x + w; gx += step) ctx.fillRect(gx, y, 1, h);
    for (let gy = y; gy < y + h; gy += step) ctx.fillRect(x, gy, w, 1);
    ctx.strokeStyle = UI.cyan;
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    ctx.globalAlpha = 1;

    // Exits, labelled by destination (placed clear of each other: exitLabels, tested).
    ctx.fillStyle = UI.amber;
    for (const wp of this.m.def.warps ?? []) {
      if (wp.when && !wp.when(state.flags)) continue;
      ctx.fillRect(Math.round(x + (wp.x + (wp.w ?? 1) / 2) * TS * k) - 1, Math.round(y + (wp.y + (wp.h ?? 1) / 2) * TS * k) - 1, 3, 3);
    }
    this.labels ??= exitLabels(this.m.def, state.flags);
    for (const l of this.labels) drawText(ctx, l.text, l.box.x, l.box.y, { color: '#ffe7a0' });

    // You are here.
    if (state.map === this.id) {
      const px = Math.round(x + (state.x + 0.5) * TS * k), py = Math.round(y + (state.y + 0.5) * TS * k);
      const r = 3 + (Math.floor(this.t / 8) % 3);
      ctx.fillStyle = UI.pink;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(px - r, py - r, r * 2 + 1, r * 2 + 1);
      ctx.globalAlpha = 1;
      ctx.fillRect(px - 1, py - 1, 3, 3);
      drawText(ctx, 'You are here', 14, H - 20, { color: UI.pink });
    }
    drawText(ctx, `${this.game.input.keyName('cancel')}: back`, W - 14, H - 20, { color: UI.dim, align: 'right' });
  }
}
