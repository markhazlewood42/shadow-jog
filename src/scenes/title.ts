/** Title screen: parallax skyline, the crew on a rooftop, neon logo, main menu. */
import { buildChar } from '../art/chars';
import { audio } from '../audio/engine';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { LOOKS } from '../data/looks';
import { silhouette, surface, type Ctx, type Surface } from '../engine/canvas';
import { mix, rgb } from '../engine/color';
import { drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { VERSION_LABEL } from '../version';
import { flashScale } from '../game/settings';
import { hash2, Rng } from '../engine/rng';
import { hasAnySave, latestSlot, type SlotId } from '../game/save';
import { UI } from '../ui/draw';
import { ListMenu } from '../ui/list';
import { OptionsScene } from './options';
import { SaveScene } from './saveload';

export type TitleChoice = { kind: 'new' } | { kind: 'load'; slot: SlotId };

const BW = 240, BH = 135;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function sky(): HTMLCanvasElement {
  const s = surface(BW, BH);
  const img = s.ctx.createImageData(BW, BH);
  const stops = ['#05040f', '#0c0822', '#1c0c36', '#3a1048', '#6a1a58', '#9a2a5a'].map(rgb);
  for (let y = 0; y < BH; y++) {
    const t = Math.min(1, y / 100) * (stops.length - 1);
    const i0 = Math.floor(t), f = t - i0;
    for (let x = 0; x < BW; x++) {
      const th = (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
      const c = stops[Math.min(stops.length - 1, f > th ? i0 + 1 : i0)]!;
      const k = (y * BW + x) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
  }
  s.ctx.putImageData(img, 0, 0);
  // Stars
  for (let i = 0; i < 40; i++) {
    s.ctx.fillStyle = i % 5 ? '#6a6a9a' : '#c8c8f0';
    s.ctx.fillRect(Math.floor(hash2(i, 1) * BW), Math.floor(hash2(i, 2) * 50), 1, 1);
  }
  // Moon with halo
  const mx = 212, my = 22;
  for (let r = 22; r > 10; r -= 2) {
    s.ctx.globalAlpha = 0.05;
    s.ctx.fillStyle = '#ffd0e8';
    s.ctx.beginPath();
    s.ctx.arc(mx, my, r, 0, Math.PI * 2);
    s.ctx.fill();
  }
  s.ctx.globalAlpha = 1;
  for (let y = -9; y <= 9; y++)
    for (let x = -9; x <= 9; x++) {
      const d = x * x + y * y;
      if (d > 81) continue;
      const shadeA = (x + 3) * (x + 3) + (y - 2) * (y - 2) < 40 ? '#f0e0f0' : '#d8c0d8';
      s.ctx.fillStyle = hash2(x, y, 7) < 0.12 ? '#b8a0c0' : shadeA;
      s.ctx.fillRect(mx + x, my + y, 1, 1);
    }
  return s.canvas;
}

interface Layer {
  canvas: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  speed: number;
}

function cityLayer(seed: number, baseY: number, minH: number, maxH: number, col: string, winCols: string[], winP: number, signs: number, spire = false): Layer {
  const w = BW * 2;
  const s = surface(w, BH), g = surface(w, BH);
  const r = new Rng(seed);
  let x = 0;
  while (x < w) {
    const bw = r.int(8, 22), bh = r.int(minH, maxH);
    const top = baseY - bh;
    s.ctx.fillStyle = col;
    s.ctx.fillRect(x, top, bw, BH - top);
    if (r.chance(0.35)) s.ctx.fillRect(x + r.int(1, bw - 2), top - r.int(3, 9), 1, 9);
    for (let wy = top + 2; wy < BH; wy += 3)
      for (let wx = x + 1; wx < x + bw - 1; wx += 2)
        if (r.chance(winP)) {
          const c = r.pick(winCols);
          s.ctx.fillStyle = c;
          s.ctx.fillRect(wx, wy, 1, 1);
          g.ctx.fillStyle = c;
          g.ctx.fillRect(wx, wy, 1, 1);
        }
    if (signs && r.chance(signs)) {
      const c = r.pick(['#ff4fb0', '#3fe0f0', '#ffcc3d', '#b07cff']);
      const vert = r.chance(0.5);
      const sw = vert ? 2 : Math.max(4, bw - 4), sh = vert ? r.int(6, 12) : 2;
      const sx = x + 2, sy = top + r.int(3, 10);
      for (const c2 of [s.ctx, g.ctx]) { c2.fillStyle = c; c2.fillRect(sx, sy, sw, sh); }
    }
    x += bw + r.int(0, 2);
  }
  if (spire) {
    // The Kessler-Mori arcology: a needle of light over the whole city.
    const sx = 150;
    s.ctx.fillStyle = col;
    s.ctx.beginPath();
    s.ctx.moveTo(sx - 14, BH);
    s.ctx.lineTo(sx - 5, 8);
    s.ctx.lineTo(sx, 0);
    s.ctx.lineTo(sx + 5, 8);
    s.ctx.lineTo(sx + 14, BH);
    s.ctx.fill();
    for (let y = 12; y < baseY; y += 4) for (const c2 of [s.ctx, g.ctx]) { c2.fillStyle = '#3f8af0'; c2.fillRect(sx - 1, y, 2, 1); }
    for (const c2 of [s.ctx, g.ctx]) { c2.fillStyle = '#9ad0ff'; c2.fillRect(sx - 1, 2, 2, 4); }
  }
  return { canvas: s.canvas, glow: g.canvas, speed: 0 };
}

export class TitleScene extends Scene<TitleChoice> {
  private buf: Surface;
  private skyC = sky();
  private far: Layer;
  private mid: Layer;
  private near: Layer;
  private roof: HTMLCanvasElement;
  private t = 0;
  private started = false;
  private startT = 0;
  private menu: ListMenu<string>;
  private flashT = 0;
  private logo: Surface;
  private busy = false;

  constructor() {
    super();
    this.buf = surface(BW, BH);
    this.far = { ...cityLayer(3, 98, 30, 70, '#1a1234', ['#5a6aa8', '#7a5aa8'], 0.08, 0, true), speed: 0.03 };
    this.mid = { ...cityLayer(5, 112, 22, 52, '#110b24', ['#ffd98a', '#8ad8ff', '#ff8ad0'], 0.12, 0.35), speed: 0.08 };
    this.near = { ...cityLayer(9, 126, 10, 30, '#08060f', ['#ffd98a', '#ff8ad0'], 0.06, 0.25), speed: 0.2 };
    this.roof = this.buildRoof();
    const saves = hasAnySave();
    const resumable = latestSlot(true) !== null;
    this.menu = new ListMenu<string>(
      [
        { label: 'New Game', value: 'new' },
        { label: 'Continue', value: 'continue', enabled: resumable, why: saves ? 'No save to pick up from.' : 'No save yet: start a New Game.' },
        { label: 'Load Game', value: 'load', enabled: saves, why: 'No saved games yet.' },
        { label: 'Options', value: 'options' },
      ],
      4,
    );
    if (saves) this.menu.index = resumable ? 1 : 2;
    this.logo = this.buildLogo();
  }

  private buildRoof(): HTMLCanvasElement {
    const s = surface(BW, BH);
    const c = s.ctx;
    c.fillStyle = '#05040a';
    c.fillRect(0, 118, BW, 17);
    c.fillRect(0, 114, 90, 4);
    c.fillRect(200, 110, 40, 8);
    // Water tank + antenna
    c.fillRect(212, 92, 16, 18);
    c.fillRect(214, 110, 2, 8);
    c.fillRect(224, 110, 2, 8);
    c.fillRect(30, 96, 1, 18);
    c.fillRect(27, 100, 7, 1);
    // Crew silhouettes on the ledge, rim-lit.
    const draw = (look: keyof typeof LOOKS, x: number) => {
      const fr = buildChar(LOOKS[look]).frames.up[0]!;
      const sil = silhouette(fr, '#05040a');
      const rim = silhouette(fr, '#ff4fb0');
      c.globalAlpha = 0.8;
      c.drawImage(rim, x + 1, 118 - fr.height + 1 - 1);
      c.globalAlpha = 1;
      c.drawImage(sil, x, 118 - fr.height + 1);
    };
    draw('rook', 44);
    draw('kit', 60);
    return s.canvas;
  }

  private buildLogo(): Surface {
    // Bold display face used only for the logo (2px strokes).
    const G: Record<string, string[]> = {
      S: ['.#####', '##....', '##....', '.####.', '....##', '....##', '#####.'],
      H: ['##..##', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
      A: ['.####.', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
      D: ['#####.', '##..##', '##..##', '##..##', '##..##', '##..##', '#####.'],
      O: ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
      W: ['##...##', '##...##', '##...##', '##.#.##', '##.#.##', '#######', '.##.##.'],
      J: ['....##', '....##', '....##', '....##', '##..##', '##..##', '.####.'],
      G: ['.####.', '##....', '##....', '##.###', '##..##', '##..##', '.#####'],
      ' ': ['...', '...', '...', '...', '...', '...', '...'],
    };
    const text = 'SHADOW JOG';
    const tw = [...text].reduce((n, ch) => n + G[ch]![0]!.length + 1, 0);
    const small = surface(tw + 2, 9);
    small.ctx.fillStyle = '#ffffff';
    let cx = 1;
    for (const ch of text) {
      const rows = G[ch]!;
      rows.forEach((r, y) => {
        [...r].forEach((c, x) => {
          if (c === '#') small.ctx.fillRect(cx + x, 1 + y, 1, 1);
        });
      });
      cx += rows[0]!.length + 1;
    }
    const k = 4;
    const s = surface(small.w * k + 24, small.h * k + 24);
    s.ctx.imageSmoothingEnabled = false;
    const at = (img: HTMLCanvasElement, dx: number) => s.ctx.drawImage(img, 12 + dx, 12, small.w * k, small.h * k);
    // Neon glow
    s.ctx.save();
    s.ctx.filter = 'blur(5px)';
    at(silhouette(small.canvas, '#ff2a9a'), 0);
    s.ctx.restore();
    // Chromatic offset + face
    s.ctx.globalAlpha = 0.85;
    at(silhouette(small.canvas, '#3fe0f0'), -3);
    s.ctx.globalAlpha = 1;
    at(silhouette(small.canvas, '#ffe4f4'), 0);
    // Lower half tint + scanlines through the letters
    s.ctx.globalCompositeOperation = 'source-atop';
    const grd = s.ctx.createLinearGradient(0, 12, 0, 12 + small.h * k);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.55, 'rgba(255,120,200,0.0)');
    grd.addColorStop(1, 'rgba(255,60,160,0.55)');
    s.ctx.fillStyle = grd;
    s.ctx.fillRect(0, 0, s.w, s.h);
    s.ctx.fillStyle = 'rgba(40,0,40,0.3)';
    for (let y = 12; y < small.h * k + 12; y += 4) s.ctx.fillRect(0, y, s.w, 1);
    s.ctx.globalCompositeOperation = 'source-over';
    return s;
  }

  override enter(): void {
    this.game.countPlayTime = false;
    audio.onUnlock(() => music('title', 0));
  }

  update(): void {
    this.t++;
    if (this.flashT > 0) this.flashT--;
    else if (hash2(Math.floor(this.t / 60), 3) < 0.04 && this.t % 60 === 0) this.flashT = 14;
    if (this.busy) return;
    const inp = this.game.input;
    if (!this.started) {
      if (inp.anyPressed && this.t > 30) {
        this.started = true;
        this.startT = this.t;
        audio.unlock();
        sfx('confirm');
      }
      return;
    }
    const r = this.menu.update(inp);
    if (r !== 'confirm') return;
    const v = this.menu.current!.value;
    if (v === 'new') this.close({ kind: 'new' });
    else if (v === 'continue') {
      const slot = latestSlot(true);
      if (slot) this.close({ kind: 'load', slot });
    } else if (v === 'load') {
      this.busy = true;
      void this.game.run(new SaveScene('load')).then((slot) => {
        this.busy = false;
        if (slot) this.close({ kind: 'load', slot });
      });
    } else if (v === 'options') {
      this.busy = true;
      void this.game.run(new OptionsScene(false)).then(() => (this.busy = false));
    }
  }

  render(ctx: Ctx): void {
    const b = this.buf.ctx;
    const t = this.t;
    b.drawImage(this.skyC, 0, 0);
    // Searchlights from the spire
    b.save();
    b.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const a = Math.sin(t * 0.008 + i * 2.1) * 0.5 - Math.PI / 2;
      const sx = 150 - (t * this.far.speed) % (BW * 2);
      for (const ox of [sx, sx + BW * 2]) {
        if (ox < -60 || ox > BW + 60) continue;
        b.globalAlpha = 0.07;
        b.fillStyle = '#9ad0ff';
        b.beginPath();
        b.moveTo(ox, 6);
        b.lineTo(ox + Math.cos(a - 0.05) * 200, 6 + Math.sin(a - 0.05) * 200);
        b.lineTo(ox + Math.cos(a + 0.05) * 200, 6 + Math.sin(a + 0.05) * 200);
        b.fill();
      }
    }
    b.restore();
    for (const L of [this.far, this.mid, this.near]) {
      const off = Math.floor((t * L.speed) % (BW * 2));
      b.drawImage(L.canvas, -off, 0);
      b.drawImage(L.canvas, BW * 2 - off, 0);
      b.globalCompositeOperation = 'lighter';
      b.globalAlpha = 0.5 + 0.1 * Math.sin(t * 0.05);
      b.drawImage(L.glow, -off, 0);
      b.drawImage(L.glow, BW * 2 - off, 0);
      b.globalAlpha = 1;
      b.globalCompositeOperation = 'source-over';
      if (L === this.mid) {
        // Monorail sliding across
        const mx = ((t * 0.9) % 700) - 200;
        b.fillStyle = '#0c0818';
        b.fillRect(0, 84, BW, 2);
        b.fillRect(Math.round(mx), 79, 90, 5);
        for (let i = 0; i < 88; i += 4) {
          b.fillStyle = i % 8 ? '#ffe0a0' : '#8ad8ff';
          b.fillRect(Math.round(mx) + 2 + i, 81, 2, 1);
        }
      }
    }
    b.drawImage(this.roof, 0, 0);
    // Rain
    b.fillStyle = '#a8b0e8';
    b.globalAlpha = 0.3;
    for (let i = 0; i < 90; i++) {
      const x = (hash2(i, 11) * BW * 1.3 + t * 1.1) % (BW * 1.3) - 20;
      const y = (hash2(i, 12) * BH + t * (3 + hash2(i, 13) * 2)) % BH;
      b.fillRect(Math.round(x), Math.round(y), 1, 3);
    }
    b.globalAlpha = 1;
    // Lightning over the skyline, scaled by the Screen flash setting (and gone with it off).
    if (this.flashT > 0 && flashScale() > 0) {
      b.globalAlpha = (this.flashT / 14) * 0.5 * flashScale();
      b.fillStyle = '#e8e0ff';
      b.fillRect(0, 0, BW, BH);
      b.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf.canvas, 0, 0, W, H);
    // Logo with glitch-in
    const lt = t - 20;
    if (lt > 0) {
      const lw = this.logo.w, lh = this.logo.h;
      const lx = Math.round((W - lw) / 2), ly = 34;
      const glitch = lt < 40 && hash2(lt, 1) < 0.5;
      if (glitch) {
        for (let s = 0; s < 6; s++) {
          const sy = Math.floor(hash2(lt, s + 2) * lh);
          const sh = 2 + Math.floor(hash2(lt, s + 9) * 6);
          ctx.drawImage(this.logo.canvas, 0, sy, lw, sh, lx + Math.round((hash2(lt, s) - 0.5) * 16), ly + sy, lw, sh);
        }
      } else {
        const flick = hash2(Math.floor(t / 4), 5) < 0.03 ? 0.6 : 1;
        ctx.globalAlpha = flick;
        ctx.drawImage(this.logo.canvas, lx, ly);
        ctx.globalAlpha = 1;
      }
      if (lt > 40) {
        ctx.globalAlpha = Math.min(1, (lt - 40) / 30);
        drawText(ctx, 'CHAPTER ONE  ·  MILK RUN', W / 2, ly + this.logo.h + 2, { align: 'center', color: '#b8d8ff' });
        ctx.globalAlpha = 1;
      }
    }
    if (!this.started) {
      if (t > 60 && Math.floor(t / 30) % 2 === 0) drawText(ctx, 'PRESS ANY KEY', W / 2, 176, { align: 'center', color: '#ffffff' });
    } else {
      const a = Math.min(1, (t - this.startT) / 15);
      ctx.globalAlpha = a;
      const mw = 110, mx = (W - mw) / 2, my = 160;
      ctx.fillStyle = 'rgba(7,6,13,0.7)';
      ctx.fillRect(mx, my - 4, mw, 50);
      ctx.fillStyle = UI.pink;
      ctx.fillRect(mx, my - 4, mw, 1);
      ctx.fillRect(mx, my + 45, mw, 1);
      this.menu.render(ctx, mx + 22, my, mw - 30);
      this.menu.renderWhy(ctx, W / 2, my + 52);
      ctx.globalAlpha = 1;
    }
    // The build stamp, bottom-left (the key hints are bottom-right).
    drawText(ctx, VERSION_LABEL, 6, H - 12, { color: mix('#8b8fa8', '#000000', 0.2) });
    // The player's own keys: a rebound confirm shows here too.
    const inp = this.game.input;
    drawText(ctx, `${inp.keyName('confirm', 2)}  confirm   ·   ${inp.keyName('cancel', 2)}  back`, W - 6, H - 12, { align: 'right', color: mix('#8b8fa8', '#000000', 0.2) });
  }
}
