import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { FieldMap } from '../field/fieldmap';
import { getMap } from '../data/maps';

/** Dev scene: whole-map overview (ground + emissive, scaled to fit). ?scene=mapview&map=id */
export class MapViewScene extends Scene {
  private m: FieldMap;
  constructor(id: string) {
    super();
    this.m = new FieldMap(getMap(id));
  }
  update(): void {}
  render(ctx: Ctx): void {
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    const k = Math.min((W - 8) / this.m.ground.width, (H - 18) / this.m.ground.height);
    const w = this.m.ground.width * k, h = this.m.ground.height * k;
    const x = (W - w) / 2, y = 14;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.m.ground, x, y, w, h);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.m.emit, x, y, w, h);
    ctx.globalAlpha = 1;
    for (const s of this.m.sprites) ctx.drawImage(s.canvas, x + s.x * k, y + s.y * k, s.canvas.width * k, s.canvas.height * k);
    ctx.imageSmoothingEnabled = false;
    drawText(ctx, `${this.m.def.name} (${this.m.w}×${this.m.h})`, 4, 2, { color: '#8b8fa8' });
  }
}
