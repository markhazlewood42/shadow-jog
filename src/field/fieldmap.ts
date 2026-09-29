/** Runtime map: parses a MapDef and bakes its layers once. */
import { pixelSurface, surface, type Ctx } from '../engine/canvas';
import { mix, rgba } from '../engine/color';
import { hash2 } from '../engine/rng';
import type { AnimFx, BakeCtx, BakedLight, SortedSprite } from './bake';
import { paintBuilding } from './buildings';
import { paintProp } from './props';
import { isWater, paintTerrain, SOLID_TERRAIN, TS, WALL_TERRAIN } from './tiles';
import type { MapDef, TerrainId } from './types';
import { state } from '../game/state';

const flagsNow = () => state.flags as Record<string, unknown>;

export const DEFAULT_LEGEND: Record<string, TerrainId> = {
  ' ': 'void',
  '#': 'wall',
  '~': 'water',
  '=': 'asphalt',
  '-': 'roadline',
  ':': 'crosswalk',
  ',': 'sidewalk',
  ';': 'alley',
  o: 'puddle',
  '+': 'grate',
  b: 'bridge',
  p: 'plaza',
  d: 'dirt',
  g: 'grass',
  r: 'rubble',
  t: 'rail',
  W: 'floor_wood',
  T: 'floor_tile',
  M: 'floor_metal',
  C: 'floor_carpet',
  K: 'floor_concrete',
  I: 'iwall',
};

export class FieldMap {
  readonly def: MapDef;
  readonly w: number;
  readonly h: number;
  readonly terrain: TerrainId[];
  readonly solid: Uint8Array;
  ground!: HTMLCanvasElement;
  emit!: HTMLCanvasElement;
  over!: HTMLCanvasElement;
  overEmit!: HTMLCanvasElement;
  hasOver = false;
  lights: BakedLight[] = [];
  sprites: SortedSprite[] = [];
  anims: AnimFx[] = [];
  private waterTiles: number[] = [];

  constructor(def: MapDef) {
    this.def = def;
    this.h = def.terrain.length;
    this.w = Math.max(...def.terrain.map((r) => r.length));
    const legend = { ...DEFAULT_LEGEND, ...def.legend };
    const rows = def.terrain.map((r) => r.split(''));
    for (const patch of def.patches ?? []) {
      if (!patch.when(flagsNow())) continue;
      for (const [px, py, pw, ph, ch] of patch.rects) for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (rows[y]) rows[y]![x] = ch;
    }
    this.terrain = new Array(this.w * this.h);
    this.solid = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) {
      const row = rows[y]!;
      for (let x = 0; x < this.w; x++) {
        const ch = row[x] ?? ' ';
        const id = legend[ch] ?? 'void';
        this.terrain[y * this.w + x] = id;
        if (SOLID_TERRAIN.has(id)) this.solid[y * this.w + x] = 1;
        if (isWater(id)) this.waterTiles.push(y * this.w + x);
      }
    }
    this.bake();
  }

  at(x: number, y: number): TerrainId {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 'void';
    return this.terrain[y * this.w + x]!;
  }

  isSolid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    return this.solid[y * this.w + x] === 1;
  }

  private bake(): void {
    const pw = this.w * TS, ph = this.h * TS;
    const gs = pixelSurface(pw, ph);
    const img = gs.ctx.createImageData(pw, ph);
    paintTerrain({ data: img.data, w: pw, h: ph }, { at: (x, y) => this.at(x, y), w: this.w, h: this.h });
    gs.ctx.putImageData(img, 0, 0);
    const ground = surface(pw, ph);
    ground.ctx.drawImage(gs.canvas, 0, 0);
    const emit = surface(pw, ph);
    const over = surface(pw, ph);
    const overEmit = surface(pw, ph);
    const b: BakeCtx = {
      g: ground.ctx,
      e: emit.ctx,
      o: over.ctx,
      oe: overEmit.ctx,
      lights: this.lights,
      sprites: this.sprites,
      anims: this.anims,
      w: this.w,
      h: this.h,
      block: (x, y) => {
        if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.solid[y * this.w + x] = 1;
      },
      unblock: (x, y) => {
        if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.solid[y * this.w + x] = 0;
      },
      both: (fn) => {
        fn(ground.ctx);
        fn(emit.ctx);
      },
      bothOver: (fn) => {
        fn(over.ctx);
        fn(overEmit.ctx);
      },
    };
    for (const s of this.def.structures ?? []) paintBuilding(b, s);
    (this.def.props ?? []).forEach((p, i) => {
      if (p.when && !p.when(flagsNow())) return;
      paintProp(b, p, i * 977 + p.x * 31 + p.y);
    });
    for (const l of this.def.lights ?? []) {
      if (l.when && !l.when(flagsNow())) continue;
      const k = l.px ? 1 : TS;
      const off = l.px ? 0 : TS / 2;
      this.lights.push({ x: l.x * k + off, y: l.y * k + off, r: l.r, color: l.color, i: l.i ?? 0.8, flicker: l.flicker });
    }
    if (this.def.strings?.length) {
      this.hasOver = true;
      for (const s of this.def.strings) this.bakeString(b, s);
    }
    if (this.def.weather === 'rain') this.bakeWetStreets(emit.ctx);
    this.bakePuddleReflections(emit.ctx);
    if (this.waterTiles.length && this.def.kind === 'dungeon') this.bakeBiolume(emit.ctx);
    if (this.def.kind === 'dungeon') this.bakeStructureEdges(emit.ctx);
    if (this.waterTiles.length) this.anims.push(this.waterShimmer());
    this.ground = ground.canvas;
    this.emit = emit.canvas;
    this.over = over.canvas;
    this.overEmit = overEmit.canvas;
  }

  private bakeString(b: BakeCtx, s: NonNullable<MapDef['strings']>[number]): void {
    const x0 = s.a[0] * TS + 8, y0 = s.a[1] * TS;
    const x1 = s.b[0] * TS + 8, y1 = s.b[1] * TS;
    const sag = s.sag ?? 10;
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag;
      pts.push([Math.round(x), Math.round(y)]);
    }
    b.o.fillStyle = '#0c0b12';
    for (const [x, y] of pts) b.o.fillRect(x, y, 1, 1);
    const lanterns = s.lanterns ?? [];
    if (!lanterns.length) return;
    const step = Math.max(10, Math.floor(n / (lanterns.length * 3)));
    let li = 0;
    for (let i = step; i < n - 4; i += step) {
      const [x, y] = pts[i]!;
      const col = lanterns[li++ % lanterns.length]!;
      b.bothOver((c) => {
        c.fillStyle = '#1a1018';
        c.fillRect(x, y + 1, 1, 1);
        c.fillStyle = col;
        c.fillRect(x - 1, y + 2, 3, 4);
        c.fillStyle = mix(col, '#ffffff', 0.55);
        c.fillRect(x, y + 3, 1, 2);
      });
      this.lights.push({ x, y: y + 4, r: 26, color: col, i: 0.75, flicker: hash2(x, y) < 0.2 });
    }
  }

  /** Rain-slick ground mirrors every strong light as a rippled vertical streak below it. */
  private bakeWetStreets(e: Ctx): void {
    const WET = new Set<TerrainId>(['asphalt', 'roadline', 'crosswalk', 'sidewalk', 'plaza', 'puddle', 'alley', 'grate', 'bridge']);
    const wetAt = (px: number, py: number) => WET.has(this.at(Math.floor(px / TS), Math.floor(py / TS))) && !this.isSolid(Math.floor(px / TS), Math.floor(py / TS));
    for (const l of this.lights) {
      if (l.i < 0.5 || l.r < 20) continue;
      let y0 = Math.round(l.y);
      let tries = 0;
      while (!wetAt(l.x, y0) && tries < 64) {
        y0 += 4;
        tries += 4;
      }
      if (!wetAt(l.x, y0)) continue;
      const len = Math.min(46, Math.round(l.r * 0.75));
      const half = l.r > 40 ? 3 : 2;
      for (let dy = 0; dy < len; dy++) {
        const py = y0 + dy;
        if (hash2(Math.round(l.x), py, 5) < 0.28) continue; // ripple gaps
        const fall = 1 - dy / len;
        const a = Math.min(0.5, 0.3 * l.i) * fall * fall;
        if (a < 0.02) continue;
        const wob = Math.round(Math.sin(py * 0.9 + l.x) * 1.5);
        const hw = Math.max(1, Math.round(half * (0.6 + fall * 0.6)));
        for (let dx = -hw; dx <= hw; dx++) {
          const px = Math.round(l.x) + dx + wob;
          if (!wetAt(px, py)) continue;
          e.fillStyle = rgba(l.color, a * (1 - Math.abs(dx) / (hw + 1)));
          e.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  /** Puddles and wet asphalt reflect nearby light as vertical streaks (emissive). */
  private bakePuddleReflections(e: Ctx): void {
    const strong = this.lights.filter((l) => l.i >= 0.55 && l.r >= 20);
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const id = this.at(tx, ty);
        if (id !== 'puddle' && id !== 'd_shallow') continue;
        const cx = tx * TS + 8, cy = ty * TS + 8;
        let best: BakedLight | null = null;
        let bd = 1e9;
        for (const l of strong) {
          const d = Math.hypot(l.x - cx, (l.y - cy) * 0.6);
          if (d < bd && d < 90) {
            bd = d;
            best = l;
          }
        }
        if (!best) continue;
        // Standing water across a whole floor reflects each light only in the column beneath it;
        // a streak on every tile would read as a pattern.
        if (id === 'd_shallow' && (Math.abs(best.x - cx) > 10 || cy < best.y || cy - best.y > 64)) continue;
        const a = Math.max(0.12, 0.55 * (1 - bd / 90));
        const col = best.color;
        const rx = Math.round(Math.max(tx * TS + 3, Math.min(tx * TS + 12, best.x)));
        for (let py = ty * TS + 3; py < ty * TS + 13; py++) {
          for (let px = rx - 2; px <= rx + 2; px++) {
            const wob = Math.sin(py * 1.7) * 1.2;
            if (Math.abs(px - rx - wob) > 1.5) continue;
            const alpha = a * (1 - Math.abs(py - (ty * TS + 8)) / 6);
            if (alpha <= 0.02) continue;
            e.fillStyle = rgba(col, alpha);
            e.fillRect(px, py, 1, 1);
          }
        }
      }
    }
  }

  /** Flooded dungeons: faint bioluminescent plankton in the black water (unlit, so it reads in the dark). */
  /**
   * Dungeons: a faint line, unlit, wherever walkable floor meets a wall or the void. Away from
   * the lamps the light map pushes floor and wall towards the same black; this keeps the edge of
   * where you can walk readable between them (Mark's playthrough, 2026-09-29: "hard to tell what's
   * surface level vs. what's structural"). Faint on purpose: an edge, not a neon outline.
   */
  private bakeStructureEdges(e: Ctx): void {
    const edge = (t: TerrainId) => WALL_TERRAIN.has(t) || t === 'void' || t === 'd_wall_crack';
    e.fillStyle = 'rgba(170,184,210,0.2)';
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.at(tx, ty);
        if (SOLID_TERRAIN.has(t)) continue;
        const x = tx * TS, y = ty * TS;
        if (edge(this.at(tx, ty - 1))) e.fillRect(x, y, TS, 1);
        if (edge(this.at(tx, ty + 1))) e.fillRect(x, y + TS - 1, TS, 1);
        if (edge(this.at(tx - 1, ty))) e.fillRect(x, y, 1, TS);
        if (edge(this.at(tx + 1, ty))) e.fillRect(x + TS - 1, y, 1, TS);
      }
    }
  }

  private bakeBiolume(e: Ctx): void {
    for (const k of this.waterTiles) {
      const tx = k % this.w, ty = (k / this.w) | 0;
      if (!isWater(this.at(tx, ty - 1))) continue; // keep the far-bank lip clean
      for (let i = 0; i < 3; i++) {
        const h = hash2(tx, ty, 300 + i);
        if (h > 0.55) continue;
        const px = tx * TS + ((hash2(tx, ty, 310 + i) * 15) | 0), py = ty * TS + ((hash2(tx, ty, 320 + i) * 15) | 0);
        e.globalAlpha = 0.25 + h * 0.6;
        e.fillStyle = h < 0.12 ? '#9affe0' : '#3fd0a8';
        e.fillRect(px, py, 1, 1);
      }
      if (hash2(tx, ty, 330) < 0.05) {
        const cx = tx * TS + 8, cy = ty * TS + 8;
        const g = e.createRadialGradient(cx, cy, 0, cx, cy, 14);
        g.addColorStop(0, 'rgba(60,210,170,0.10)');
        g.addColorStop(1, 'rgba(60,210,170,0)');
        e.globalAlpha = 1;
        e.fillStyle = g;
        e.fillRect(cx - 14, cy - 14, 28, 28);
      }
    }
    e.globalAlpha = 1;
  }

  private waterShimmer(): AnimFx {
    const tiles = this.waterTiles;
    const w = this.w;
    const dungeon = this.def.kind === 'dungeon';
    return {
      x: 0, y: 0, w: this.w * TS, h: this.h * TS,
      draw: (ctx, frame, ox, oy) => {
        // Drip rings: a few slots, each expanding and fading on a random on-screen water tile.
        if (tiles.length) {
          for (let slot = 0; slot < 5; slot++) {
            const period = 110 + slot * 17;
            const cycle = Math.floor((frame + slot * 40) / period);
            const t = ((frame + slot * 40) % period) / 60;
            if (t > 1) continue;
            const k = tiles[Math.floor(hash2(slot, cycle, 340) * tiles.length)]!;
            const tx = k % w, ty = (k / w) | 0;
            const cx = tx * TS + 8 - ox, cy = ty * TS + 9 - oy;
            if (cx < -16 || cy < -16 || cx > 496 || cy > 286) continue;
            const rx = 1 + t * 7, ry = 0.5 + t * 2.5;
            ctx.globalAlpha = (1 - t) * 0.6;
            ctx.fillStyle = dungeon ? '#8af0d8' : '#8ab8e8';
            for (let a = 0; a < 16; a++) {
              const th = (a / 16) * Math.PI * 2;
              ctx.fillRect(Math.round(cx + Math.cos(th) * rx), Math.round(cy + Math.sin(th) * ry), 1, 1);
            }
          }
        }
        ctx.fillStyle = dungeon ? '#7ae8d0' : '#6ab8d8';
        for (const k of tiles) {
          const tx = k % w, ty = (k / w) | 0;
          const sx = tx * TS - ox, sy = ty * TS - oy;
          if (sx < -16 || sy < -16 || sx > 480 || sy > 270) continue;
          for (let i = 0; i < 2; i++) {
            const phase = (frame * 0.05 + hash2(tx, ty, i) * 6.28) % 6.28;
            const a = Math.max(0, Math.sin(phase));
            if (a < 0.4) continue;
            ctx.globalAlpha = a * 0.45;
            const px = sx + ((hash2(tx, ty, 10 + i) * 13) | 0) + 1;
            const py = sy + 4 + ((hash2(tx, ty, 20 + i) * 10) | 0);
            ctx.fillRect(px, py, 2 + i, 1);
          }
        }
        ctx.globalAlpha = 1;
      },
    };
  }
}
