/**
 * A place's map, from the Places menu: the whole map scaled to fit, dimmed like a printed plan,
 * with the exits labelled by where they lead and, on the map the crew is on, where they stand.
 */
import { sfx } from '../audio/sfx';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { keyLabel } from '../engine/input';
import { H, Scene, W } from '../engine/game';
import { getMap } from '../data/maps';
import { FieldMap } from '../field/fieldmap';
import { TS } from '../field/tiles';
import { state } from '../game/state';
import { drawWindow, UI } from '../ui/draw';

/** Maps are baked once per visit to this screen, not per frame. */
const baked = new Map<string, FieldMap>();

export class PlaceMapScene extends Scene<void> {
  override opaque = false;
  private m: FieldMap;
  private t = 0;

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
    ctx.fillStyle = 'rgba(7,6,13,0.96)';
    ctx.fillRect(0, 0, W, H);
    drawWindow(ctx, 6, 6, W - 12, H - 12, { title: this.m.def.name.toUpperCase(), accent: UI.cyan });
    const box = { x: 14, y: 22, w: W - 28, h: H - 44 };
    const gw = this.m.ground.width, gh = this.m.ground.height;
    const k = Math.min(box.w / gw, box.h / gh);
    const w = Math.round(gw * k), h = Math.round(gh * k);
    const x = Math.round(box.x + (box.w - w) / 2), y = Math.round(box.y + (box.h - h) / 2);
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

    // Exits, labelled by destination (one label per destination).
    const seen = new Set<string>();
    for (const wp of this.m.def.warps ?? []) {
      if (wp.when && !wp.when(state.flags)) continue;
      const cx = x + (wp.x + (wp.w ?? 1) / 2) * TS * k, cy = y + (wp.y + (wp.h ?? 1) / 2) * TS * k;
      ctx.fillStyle = UI.amber;
      ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 3);
      let name: string;
      try {
        name = getMap(wp.to).name;
      } catch {
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      const left = cx > x + w * 0.7;
      drawText(ctx, name, Math.round(cx + (left ? -4 : 4)), Math.round(cy - 4), { color: '#ffe7a0', align: left ? 'right' : 'left' });
    }

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
    const back = this.game.input.keysFor('cancel')[0];
    drawText(ctx, `${back ? keyLabel(back) : 'Cancel'}: back`, W - 14, H - 20, { color: UI.dim, align: 'right' });
  }
}
