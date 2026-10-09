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
import { Scene } from '../engine/game';
import { W, H } from '../sje/core/size';
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
  /** The chapter's last beat: a title card with its own slow build, not a caption box. */
  finale?: { title: string; sub: string };
}

type Page = Panel[];

/**
 * The comic page's layout, as plain data in one place (the editor rule of docs/IDEAS.md: a layout
 * is a named value, not a literal inside draw code). The panels below are authored directly for
 * the frame PANEL_FRAME: 8 px in from the left, top and right edges, and clear of the footer
 * strip at the bottom (the skip hint and the page marker). That is 624 by 334 at 640x360. A panel
 * editor would change the table and these numbers, and nothing else.
 */
export const FOOT_TOP = H - 18;
const FOOT_Y = H - 13;
export const PANEL_FRAME = { x0: 8, y0: 8, x1: W - 8, y1: FOOT_TOP };
/** The width of a full-width panel: the whole frame (624 at 640x360). */
export const PANEL_W = PANEL_FRAME.x1 - PANEL_FRAME.x0;
/** How wide a speech bubble and a caption may grow (the panels are wider than they were, so the lines run longer). */
export const BUBBLE_MAX_W = 280;
export const CAPTION_MAX_W = 400;
/** The portrait size when a panel does not pin one: 2x, as the panels have always used (D9). */
export const PORTRAIT_SCALE = 2;
/** The scale a panel's portrait is drawn at: the one the panel pins in the table below, or 2x (the Review 5 pick, D9). */
export function portraitScale(pn: Panel): number {
  return pn.portrait?.scale ?? PORTRAIT_SCALE;
}

export const PAGES: Record<string, Page[]> = {
  intro: [
    [
      { x: 8, y: 8, w: PANEL_W, h: 170, bg: 'city', caption: 'SALTREACH, 2079.', from: 'top' },
      { x: 8, y: 184, w: 309, h: 158, bg: 'street', caption: 'Thirty years ago, the magic came back. It didn’t fix anything.', from: 'left' },
      { x: 323, y: 184, w: 309, h: 158, bg: 'spire', caption: 'The corporations just found new things to own.', from: 'right' },
    ],
    [
      { x: 8, y: 8, w: 268, h: 334, bg: 'rooftop', caption: 'In the Lower Wards, people take the work that comes.', from: 'left' },
      { x: 282, y: 8, w: 350, h: 164, bg: 'dark', portrait: { key: 'rook', face: 'neutral', scale: 2 }, speech: { who: 'rook', text: 'Two rules, kid. Get paid. And don’t die for anyone who isn’t paying.' }, from: 'right' },
      { x: 282, y: 178, w: 350, h: 164, bg: 'dark', portrait: { key: 'kit', face: 'smirk', scale: 2, flip: true }, speech: { who: 'kit', text: 'Who’s paying for me?' }, from: 'right' },
    ],
  ],
  ending: [
    [
      { x: 8, y: 8, w: PANEL_W, h: 158, bg: 'flash', caption: 'Rook’s flashbang bought them eleven seconds.', from: 'top', shake: true },
      { x: 8, y: 172, w: 309, h: 170, bg: 'dark', portrait: { key: 'kit', face: 'sad', scale: 2 }, speech: { who: 'kit', text: 'Rook! ROOK!' }, from: 'left' },
      { x: 323, y: 172, w: 309, h: 170, bg: 'dark', portrait: { key: 'rook', face: 'hurt', scale: 2, flip: true }, speech: { who: 'rook', text: 'Go, kid. Don’t look back.' }, from: 'right' },
    ],
    [
      { x: 8, y: 8, w: PANEL_W, h: 158, bg: 'canal', caption: 'Last they saw, he was on his knees in the rain, rifles all round him. The other three surfaced in the canal, three wards over.', from: 'top' },
      { x: 8, y: 172, w: 309, h: 170, bg: 'dark', portrait: { key: 'kit', face: 'sad', scale: 2 }, speech: { who: 'kit', text: 'He said don’t look back. So I didn’t.' }, from: 'left' },
      { x: 323, y: 172, w: 309, h: 170, bg: 'rooftop', caption: 'For a long time, nobody said anything. The rain did the talking.', from: 'right' },
    ],
    [
      { x: 8, y: 8, w: PANEL_W, h: 175, bg: 'rooftop', portrait: { key: 'sable', face: 'sad', scale: 2, dx: 188 }, speech: { who: 'sable', text: 'The crow followed the vans all the way up the arcology. He is hurt. He is alive.' }, from: 'top' },
      { x: 8, y: 189, w: 309, h: 153, bg: 'dark', portrait: { key: 'hex', face: 'angry', scale: 2 }, speech: { who: 'hex', text: 'Then we go get him. On the way, we ask Dutch what he knew.' }, from: 'left' },
      { x: 323, y: 189, w: 309, h: 153, bg: 'dark', portrait: { key: 'kit', face: 'angry', scale: 2, flip: true }, speech: { who: 'kit', text: 'We go get him.' }, from: 'right' },
    ],
    [
      { x: 8, y: 8, w: PANEL_W, h: 175, bg: 'spire', portrait: { key: 'pale', face: 'smirk', scale: 2, dx: 188 }, speech: { who: 'pale', text: 'Find them. The orc, the jockey, and Miss Kit. Keep the old samurai breathing: I want to know who taught Miss Kit to fight like that. You have until morning.' }, from: 'top' },
      { x: 8, y: 189, w: PANEL_W, h: 153, bg: 'dark', finale: { title: 'END OF CHAPTER ONE', sub: 'They have until morning.' }, from: 'bottom' },
    ],
  ],
};

const PAGE_BG = '#0a0914';

/** Where a panel's portrait is drawn horizontally (its left edge and size), or null if none. */
export function portraitRect(pn: Panel, x: number): { px: number; pw: number } | null {
  if (!pn.portrait) return null;
  const s = portraitScale(pn);
  const pw = 48 * s;
  const px = pn.portrait.dx !== undefined ? x + pn.portrait.dx : pn.portrait.flip ? x + pn.w - pw - 6 : x + 6;
  return { px, pw };
}

/**
 * A speech bubble's placement: in the wider gap beside the portrait's drawn rect, wrapped to fit
 * it, so it never covers the speaker's face (tests/layout.test.ts checks every panel).
 */
export function speechLayout(pn: Panel, x: number, name: string): { bx: number; w: number; lines: string[]; leftSide: boolean } {
  const por = portraitRect(pn, x);
  const freeL = por ? por.px - x - 12 : 0;
  const freeR = por ? x + pn.w - (por.px + por.pw) - 12 : pn.w - 24;
  const leftSide = !!por && freeL >= freeR;
  const maxW = Math.min(BUBBLE_MAX_W, (leftSide ? freeL : freeR) - 14);
  const lines = wrap(pn.speech!.text, Math.max(80, maxW));
  const w = Math.max(measure(name), ...lines.map(measure)) + 14;
  return { bx: leftSide ? x + 8 : x + pn.w - w - 8, w, lines, leftSide };
}

/** Title text rendered once at 1× for scaling up (nearest-neighbour keeps it crisp). */
const titleCache = new Map<string, { canvas: HTMLCanvasElement; w: number }>();
function titleBuf(text: string): { canvas: HTMLCanvasElement; w: number } {
  let t = titleCache.get(text);
  if (!t) {
    const s = surface(Math.max(8, measure(text) + 4), 12);
    const w = drawText(s.ctx, text, 1, 1, { color: '#ffe6f0', shadow: '#5a0a1e' }) + 3;
    t = { canvas: s.canvas, w };
    titleCache.set(text, t);
  }
  return t;
}

export class PanelScene extends Scene<void> {
  private pages: Page[];
  private page = 0;
  private shown = 0;
  private t = 0;
  private panelT: number[] = [];
  /** A confirm pressed before the newest panel landed, waiting to advance. */
  private queued = false;
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
      const pn = p[this.shown - 1]!;
      sfx(pn.shake ? 'explosion' : pn.finale ? 'phase' : 'page');
      if (pn.shake) this.game.shake(20, 3);
      if (pn.finale) this.game.flash('#ff2a4a', 18);
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
    // A press while the newest panel is still sliding in isn't lost (the dialogue contract): it
    // waits, and advances the moment the panel has landed.
    if (inp.pressed('confirm')) this.queued = true;
    if (this.queued && lastT > 12) {
      this.queued = false;
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
    ctx.save();
    ctx.translate(this.game.shakeX, this.game.shakeY);
    for (let i = 0; i < this.shown; i++) this.drawPanel(ctx, p[i]!, this.panelT[i] ?? 0, this.typed[i] ?? 0);
    ctx.restore();
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
        const { px, pw } = portraitRect(pn, x)!;
        const py = y + pn.h - pw + Math.round((1 - e) * 10);
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
    if (pn.finale) this.finale(ctx, pn, x, y, t);
  }

  /** Title card: a red rule draws across, the title stamps in at double size, then the subtitle. */
  private finale(ctx: Ctx, pn: Panel, x: number, y: number, t: number): void {
    const f = pn.finale!;
    const cx = x + pn.w / 2, cy = y + pn.h / 2;
    const rule = Math.min(1, Math.max(0, (t - 8) / 30));
    const rw = Math.round((pn.w - 40) * (1 - (1 - rule) ** 3));
    ctx.fillStyle = '#ff2a4a';
    ctx.fillRect(Math.round(cx - rw / 2), cy + 12, rw, 1);
    ctx.fillRect(Math.round(cx - rw / 2), cy - 22, rw, 1);
    if (t > 30) {
      const k = Math.min(1, (t - 30) / 10);
      const tw = titleBuf(f.title);
      const s = 2 + Math.round((1 - k) * 2);
      ctx.globalAlpha = k;
      ctx.drawImage(tw.canvas, 0, 0, tw.w, 12, Math.round(cx - (tw.w * s) / 2), Math.round(cy - 5 - 6 * s + 6), tw.w * s, 12 * s);
      ctx.globalAlpha = 1;
    }
    if (t > 60) drawText(ctx, f.sub, cx, cy + 20, { align: 'center', color: '#c8a8c0' });
  }

  private caption(ctx: Ctx, pn: Panel, x: number, y: number): void {
    const big = pn.caption === pn.caption!.toUpperCase() && pn.caption!.length < 30;
    const lines = wrap(pn.caption!, Math.min(pn.w - 24, CAPTION_MAX_W));
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
    const { bx, w, lines, leftSide } = speechLayout(pn, x, name);
    const h = lines.length * 11 + 20;
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
          g.drawImage(silhouette(fr, '#1a1020'), Math.round(w * 0.065 + i * w * 0.1), h - fr.height * 3 - 4, fr.width * 3, fr.height * 3);
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
