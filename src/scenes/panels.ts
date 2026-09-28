/** Comic-panel cutscenes (a Phantasy Star IV signature): pages of panels that slide in with captions. */
import { buildChar } from '../art/chars';
import { getPortrait } from '../art/portraits';
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import { charsPerFrame } from '../game/settings';
import { LOOKS } from '../data/looks';
import { SPEAKERS } from '../data/speakers';
import { silhouette, surface, type Ctx } from '../engine/canvas';
import { drawText, measure, wrap } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { hash2 } from '../engine/rng';

type Bg = 'city' | 'rooftop' | 'flash' | 'canal' | 'spire' | 'lab' | 'dark' | 'street';

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
  bg: Bg;
  portrait?: { key: string; face: string; scale?: number; flip?: boolean; dx?: number };
  caption?: string;
  speech?: { who: string; text: string };
  from?: 'left' | 'right' | 'top' | 'bottom';
  shake?: boolean;
}

type Page = Panel[];

/** Page layouts are authored for an 8..262 frame; they are squeezed into 8..FOOT_TOP to keep a footer strip. */
const FOOT_TOP = H - 18;
const FOOT_Y = H - 13;
function fitPanel(p: Panel): Panel {
  const k = (FOOT_TOP - 8) / (H - 16);
  const y = Math.round(8 + (p.y - 8) * k);
  return { ...p, y, h: Math.round(8 + (p.y + p.h - 8) * k) - y };
}

const PAGES: Record<string, Page[]> = {
  intro: [
    [
      { x: 8, y: 8, w: 464, h: 132, bg: 'city', caption: 'SALTREACH, 2079.', from: 'top' },
      { x: 8, y: 146, w: 226, h: 116, bg: 'street', caption: 'Thirty years ago, the magic came back. It didn’t fix anything.', from: 'left' },
      { x: 240, y: 146, w: 232, h: 116, bg: 'spire', caption: 'The corporations just found new things to own.', from: 'right' },
    ],
    [
      { x: 8, y: 8, w: 200, h: 254, bg: 'rooftop', caption: 'In the Lower Wards, you take the work that comes.', from: 'left' },
      { x: 214, y: 8, w: 258, h: 124, bg: 'dark', portrait: { key: 'rook', face: 'neutral' }, speech: { who: 'rook', text: 'One job. Easy. We walk in, we walk out.' }, from: 'right' },
      { x: 214, y: 138, w: 258, h: 124, bg: 'dark', portrait: { key: 'kit', face: 'smirk', flip: true }, speech: { who: 'kit', text: 'You always say that.' }, from: 'right' },
    ],
  ],
  ending: [
    [
      { x: 8, y: 8, w: 464, h: 120, bg: 'flash', caption: 'Rook’s flashbang bought them eleven seconds.', from: 'top', shake: true },
      { x: 8, y: 134, w: 228, h: 128, bg: 'dark', portrait: { key: 'kit', face: 'sad' }, speech: { who: 'kit', text: 'Rook! ROOK!' }, from: 'left' },
      { x: 242, y: 134, w: 230, h: 128, bg: 'dark', portrait: { key: 'rook', face: 'hurt', flip: true }, speech: { who: 'rook', text: 'Hey, Pale. You still owe us three thousand.' }, from: 'right' },
    ],
    [
      { x: 8, y: 8, w: 464, h: 120, bg: 'canal', caption: 'They came up three wards over, soaked and shaking. Three of them.', from: 'top' },
      { x: 8, y: 134, w: 150, h: 128, bg: 'dark', portrait: { key: 'kit', face: 'sad' }, speech: { who: 'kit', text: 'He told us not to wait. We didn’t wait.' }, from: 'left' },
      { x: 164, y: 134, w: 150, h: 128, bg: 'dark', portrait: { key: 'sable', face: 'sad' }, speech: { who: 'sable', text: 'The crow saw them take him. He’s alive.' }, from: 'bottom' },
      { x: 320, y: 134, w: 152, h: 128, bg: 'dark', portrait: { key: 'hex', face: 'angry' }, speech: { who: 'hex', text: 'Then we go get him.' }, from: 'right' },
    ],
    [
      { x: 8, y: 8, w: 464, h: 150, bg: 'spire', portrait: { key: 'pale', face: 'smirk', dx: 140 }, speech: { who: 'pale', text: 'Find them. The orc, the decker, the girl. Keep the old samurai breathing: I want to know who taught the girl to fight like that. You have until morning.' }, from: 'top' },
      { x: 8, y: 164, w: 464, h: 98, bg: 'dark', caption: 'END OF CHAPTER ONE', from: 'bottom' },
    ],
  ],
};

const PAGE_BG = '#0a0914';

export class PanelScene extends Scene<void> {
  private pages: Page[];
  private page = 0;
  private shown = 0;
  private t = 0;
  private panelT: number[] = [];
  /** Characters of each panel's speech revealed so far. */
  private typed: number[] = [];
  private cache = new Map<string, HTMLCanvasElement>();

  constructor(id: string) {
    super();
    this.pages = PAGES[id] ?? [];
  }

  override enter(): void {
    this.revealNext();
  }

  private revealNext(): void {
    const p = this.pages[this.page];
    if (!p) return;
    if (this.shown < p.length) {
      this.panelT[this.shown] = 0;
      this.typed[this.shown] = 0;
      this.shown++;
      sfx(p[this.shown - 1]!.shake ? 'explosion' : 'page');
      if (p[this.shown - 1]!.shake) this.game.shake(20, 3);
    }
  }

  update(): void {
    this.t++;
    if (autoClose(this.t, 150)) {
      this.close();
      return;
    }
    for (let i = 0; i < this.panelT.length; i++) this.panelT[i]!++;
    const inp = this.game.input;
    const p = this.pages[this.page];
    if (!p) {
      this.close();
      return;
    }
    // Speech bubbles type out at the player's Text Speed, once the panel has slid in.
    for (let i = 0; i < this.shown; i++) {
      const sp = p[i]?.speech;
      if (sp && (this.panelT[i] ?? 0) > 6) this.typed[i] = Math.min(sp.text.length, (this.typed[i] ?? 0) + charsPerFrame());
    }
    const lastT = this.panelT[this.shown - 1] ?? 999;
    if (inp.pressed('cancel')) {
      // Skip the whole sequence.
      this.close();
      return;
    }
    // Same contract as dialogue boxes: a press first finishes the line being typed.
    const cur = p[this.shown - 1]?.speech;
    if (inp.pressed('confirm') && cur && (this.typed[this.shown - 1] ?? 0) < cur.text.length) {
      this.typed[this.shown - 1] = cur.text.length;
      return;
    }
    if (inp.pressed('confirm') && lastT > 12) {
      if (this.shown < p.length) this.revealNext();
      else {
        this.page++;
        this.shown = 0;
        this.panelT = [];
        this.typed = [];
        if (this.page >= this.pages.length) this.close();
        else this.revealNext();
      }
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, W, H);
    // Halftone dots on the page
    ctx.fillStyle = '#12101e';
    for (let y = 0; y < H; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < W; x += 6) ctx.fillRect(x, y, 1, 1);
    const p = this.pages[this.page];
    if (!p) return;
    for (let i = 0; i < this.shown; i++) this.drawPanel(ctx, fitPanel(p[i]!), this.panelT[i] ?? 0, this.typed[i] ?? 0);
    // Footer strip below the panels: skip hint left, page-advance marker right.
    const lastT = this.panelT[this.shown - 1] ?? 0;
    if (lastT > 20 && Math.floor(this.t / 20) % 2 === 0) drawText(ctx, '▼', W - 14, FOOT_Y, { color: '#ffffff' });
    drawText(ctx, 'X', 9, FOOT_Y, { color: '#c8c6e0' });
    drawText(ctx, 'skip', 9 + measure('X') + 4, FOOT_Y, { color: '#8a87a8' });
  }

  private drawPanel(ctx: Ctx, pn: Panel, t: number, typed: number): void {
    const k = Math.min(1, t / 14);
    const e = 1 - (1 - k) ** 3;
    let ox = 0, oy = 0;
    const d = (1 - e) * 60;
    if (pn.from === 'left') ox = -d;
    else if (pn.from === 'right') ox = d;
    else if (pn.from === 'top') oy = -d;
    else oy = d;
    if (pn.shake && t < 20) ox += Math.round((hash2(t, 1) - 0.5) * 8);
    const x = Math.round(pn.x + ox), y = Math.round(pn.y + oy);
    ctx.save();
    ctx.globalAlpha = e;
    // Frame
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 3, y - 3, pn.w + 6, pn.h + 6);
    ctx.fillStyle = '#f0ece0';
    ctx.fillRect(x - 2, y - 2, pn.w + 4, pn.h + 4);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, pn.w + 2, pn.h + 2);
    ctx.beginPath();
    ctx.rect(x, y, pn.w, pn.h);
    ctx.clip();
    ctx.drawImage(this.bgCanvas(pn), x, y);
    if (pn.portrait) {
      const por = getPortrait(pn.portrait.key, pn.portrait.face);
      if (por) {
        const s = pn.portrait.scale ?? Math.max(2, Math.floor(Math.min(pn.h, 150) / 48));
        const pw = 48 * s;
        const px = pn.portrait.dx !== undefined ? x + pn.portrait.dx : pn.portrait.flip ? x + pn.w - pw - 6 : x + 6;
        const py = y + pn.h - 48 * s + Math.round((1 - e) * 10);
        ctx.imageSmoothingEnabled = false;
        if (pn.portrait.flip) {
          ctx.save();
          ctx.translate(px + pw, py);
          ctx.scale(-1, 1);
          ctx.drawImage(por, 0, 0, pw, pw);
          ctx.restore();
        } else ctx.drawImage(por, px, py, pw, pw);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (t < 6) return;
    if (pn.caption) this.caption(ctx, pn, x, y);
    if (pn.speech) this.speech(ctx, pn, x, y, typed);
  }

  private caption(ctx: Ctx, pn: Panel, x: number, y: number): void {
    const big = pn.caption === pn.caption!.toUpperCase() && pn.caption!.length < 30;
    const lines = wrap(pn.caption!, Math.min(pn.w - 24, 300));
    const w = Math.max(...lines.map(measure)) + 12;
    const h = lines.length * 11 + 8;
    const cx = big ? x + (pn.w - w) / 2 : x + 6;
    const cy = big ? y + (pn.h - h) / 2 : y + 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - 1, cy - 1, w + 2, h + 2);
    ctx.fillStyle = big ? '#1a1030' : '#f4e6b8';
    ctx.fillRect(cx, cy, w, h);
    lines.forEach((l, i) => {
      drawText(ctx, l, cx + 6, cy + 5 + i * 11, { color: big ? '#ffd6ee' : '#1a1420', shadow: false });
    });
  }

  private speech(ctx: Ctx, pn: Panel, x: number, y: number, typed: number): void {
    const sp = pn.speech!;
    const name = SPEAKERS[sp.who]?.name ?? sp.who;
    const maxW = Math.min(pn.w - (pn.portrait ? 96 : 24), 220);
    const lines = wrap(sp.text, Math.max(80, maxW));
    const w = Math.max(measure(name), ...lines.map(measure)) + 14;
    const h = lines.length * 11 + 20;
    const leftSide = pn.portrait?.flip || pn.portrait?.dx !== undefined;
    const bx = leftSide ? x + 8 : x + pn.w - w - 8;
    const by = y + 8;
    const reveal = Math.floor(typed);
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, w, h);
    // Tail toward the speaker
    ctx.fillStyle = '#000';
    const tx = leftSide ? bx + w - 10 : bx + 10;
    ctx.fillRect(tx - 1, by + h, 6, 1);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) ctx.fillRect(tx + (leftSide ? i : -i + 4) - 0, by + h + i, 5 - i, 1);
    drawText(ctx, name, bx + 7, by + 4, { color: SPEAKERS[sp.who]?.color ? '#6a2a58' : '#333', shadow: false });
    let rem = reveal;
    lines.forEach((l, i) => {
      if (rem <= 0) return;
      drawText(ctx, l, bx + 7, by + 16 + i * 11, { color: '#141020', shadow: false, max: rem });
      rem -= l.length + 1;
    });
  }

  private bgCanvas(pn: Panel): HTMLCanvasElement {
    const key = `${pn.bg}:${pn.w}x${pn.h}`;
    let c = this.cache.get(key);
    if (c) return c;
    const s = surface(pn.w, pn.h);
    const g = s.ctx;
    const w = pn.w, h = pn.h;
    const grad = (a: string, b: string) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, a);
      gr.addColorStop(1, b);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    };
    const skyline = (base: number, col: string, win: string[], seed: number, maxH: number) => {
      let x = -4;
      let i = 0;
      while (x < w) {
        const bw = 8 + Math.floor(hash2(i, seed) * 20), bh = 12 + Math.floor(hash2(i, seed + 1) * maxH);
        g.fillStyle = col;
        g.fillRect(x, base - bh, bw, h);
        for (let yy = base - bh + 3; yy < h; yy += 4) for (let xx = x + 2; xx < x + bw - 1; xx += 3) if (hash2(xx, yy, seed) < 0.12) { g.fillStyle = win[(xx + yy) % win.length]!; g.fillRect(xx, yy, 1, 2); }
        x += bw + 1;
        i++;
      }
    };
    switch (pn.bg) {
      case 'city':
        grad('#0a0820', '#6a1a58');
        skyline(h, '#1a1234', ['#6a7ab8', '#8a6ab8'], 3, h * 0.6);
        skyline(h, '#0e0a1c', ['#ffd98a', '#8ad8ff', '#ff8ad0'], 7, h * 0.4);
        this.rain(g, w, h, 1);
        break;
      case 'street':
        grad('#120c24', '#2a1a3a');
        skyline(h * 0.7, '#0e0a1c', ['#ffd98a', '#ff8ad0', '#8ad8ff'], 11, h * 0.5);
        g.fillStyle = '#1a1a2c';
        g.fillRect(0, h * 0.7, w, h * 0.3);
        for (let i = 0; i < 12; i++) {
          g.fillStyle = ['#ff4fb0', '#3fe0f0', '#ffcc3d'][i % 3]!;
          g.globalAlpha = 0.35;
          g.fillRect(Math.floor(hash2(i, 4) * w), h * 0.72, 2, h * 0.25);
        }
        g.globalAlpha = 1;
        this.rain(g, w, h, 2);
        break;
      case 'spire': {
        grad('#05040f', '#1a0c2a');
        const sx = w * 0.3;
        g.globalAlpha = 0.12;
        g.fillStyle = '#9ad0ff';
        for (const a of [-0.35, 0.25]) {
          g.beginPath();
          g.moveTo(sx, 12);
          g.lineTo(sx + Math.sin(a) * 300 - 10, h);
          g.lineTo(sx + Math.sin(a) * 300 + 30, h);
          g.fill();
        }
        g.globalAlpha = 1;
        g.fillStyle = '#141028';
        g.beginPath();
        g.moveTo(sx - 30, h);
        g.lineTo(sx - 8, 18);
        g.lineTo(sx, 4);
        g.lineTo(sx + 8, 18);
        g.lineTo(sx + 30, h);
        g.fill();
        for (let yy = 22; yy < h; yy += 5) {
          g.fillStyle = '#3f8af0';
          g.fillRect(sx - 2, yy, 4, 1);
        }
        g.fillStyle = '#9ad0ff';
        g.fillRect(sx - 1, 6, 2, 6);
        skyline(h, '#0a0816', ['#ffd98a', '#8ad8ff'], 5, h * 0.3);
        break;
      }
      case 'rooftop': {
        grad('#0a0820', '#5a1a4a');
        skyline(h * 0.75, '#150e2a', ['#6a7ab8', '#ff8ad0'], 9, h * 0.4);
        g.fillStyle = '#05040a';
        g.fillRect(0, h * 0.75, w, h);
        const draw = (look: 'kit' | 'rook', x: number) => {
          const fr = buildChar(LOOKS[look]).frames.up[0]!;
          const sc = 3;
          g.imageSmoothingEnabled = false;
          g.drawImage(silhouette(fr, '#ff4fb0'), x + 2, h * 0.75 - fr.height * sc + 2, fr.width * sc, fr.height * sc);
          g.drawImage(silhouette(fr, '#05040a'), x, h * 0.75 - fr.height * sc + 4, fr.width * sc, fr.height * sc);
        };
        draw('rook', w * 0.22);
        draw('kit', w * 0.52);
        this.rain(g, w, h, 3);
        break;
      }
      case 'flash': {
        grad('#fff8e0', '#ffb46a');
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(w * 0.7, h * 0.4, h * 0.6, 0, Math.PI * 2);
        g.fill();
        for (let i = 0; i < 24; i++) {
          g.strokeStyle = 'rgba(255,255,255,0.8)';
          g.beginPath();
          g.moveTo(w * 0.7, h * 0.4);
          const a = (i / 24) * Math.PI * 2;
          g.lineTo(w * 0.7 + Math.cos(a) * w, h * 0.4 + Math.sin(a) * w);
          g.stroke();
        }
        const figs: ('kit' | 'hex' | 'sable')[] = ['kit', 'hex', 'sable'];
        figs.forEach((f, i) => {
          const fr = buildChar(LOOKS[f]).frames.left[1]!;
          g.drawImage(silhouette(fr, '#1a1020'), 30 + i * 46, h - fr.height * 3 - 4, fr.width * 3, fr.height * 3);
        });
        break;
      }
      case 'canal':
        grad('#050810', '#0a1a2a');
        skyline(h * 0.5, '#0a0c1a', ['#ffd98a', '#ff5a3a'], 13, h * 0.3);
        g.fillStyle = '#081420';
        g.fillRect(0, h * 0.5, w, h * 0.5);
        for (let i = 0; i < 30; i++) {
          g.fillStyle = ['#ff8a4a', '#ffcc3d', '#ff4fb0'][i % 3]!;
          g.globalAlpha = 0.5;
          const lx = hash2(i, 2) * w;
          const ly = h * 0.5 + hash2(i, 3) * h * 0.45;
          g.fillRect(Math.floor(lx), Math.floor(ly), 3, 2);
          g.globalAlpha = 0.2;
          g.fillRect(Math.floor(lx), Math.floor(ly) + 2, 3, 8);
        }
        g.globalAlpha = 1;
        this.rain(g, w, h, 4);
        break;
      case 'lab':
        grad('#b8c4d4', '#6a7a90');
        break;
      default: {
        grad('#1a1428', '#0a0814');
        // Speed lines
        g.strokeStyle = 'rgba(120,100,180,0.18)';
        for (let i = 0; i < 40; i++) {
          const a = hash2(i, 9) * Math.PI * 2;
          g.beginPath();
          g.moveTo(w / 2 + Math.cos(a) * 20, h / 2 + Math.sin(a) * 20);
          g.lineTo(w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * w);
          g.stroke();
        }
      }
    }
    c = s.canvas;
    this.cache.set(key, c);
    return c;
  }

  private rain(g: Ctx, w: number, h: number, seed: number): void {
    g.fillStyle = 'rgba(180,190,255,0.3)';
    for (let i = 0; i < w / 3; i++) {
      const x = Math.floor(hash2(i, seed * 7) * w), y = Math.floor(hash2(i, seed * 7 + 1) * h);
      g.fillRect(x, y, 1, 4);
    }
  }
}
