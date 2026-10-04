/**
 * Hex's cyberdeck, drawn in code like everything else: a rugged slab with a hinged screen, a
 * keyboard they've re-legended by hand, a whip antenna, sticker-bombed plating and, on the right, the
 * coprocessor bay the Stingray sits in. The static body is painted once and cached; the screen,
 * the LEDs and the chip are drawn over it each frame by the scenes that show it (deck.ts, and the
 * battle cut-in).
 *
 * Coordinates are the art's own pixels (DECK_W × DECK_H), shown at 1x on the 480×270 screen.
 */
import { surface } from '../engine/canvas';
import type { Ctx } from '../engine/canvas';
import { drawText } from '../engine/font';

export const DECK_W = 264, DECK_H = 136;

/** Where the moving parts go, in deck pixels. */
export const DECK = {
  screen: { x: 38, y: 16, w: 106, h: 42 },
  /** The socket's opening (the chip's pins land on its floor). */
  socket: { x: 184, y: 78, w: 60, h: 20 },
  antennaTip: { x: 252, y: 8 },
  leds: { x: 34, y: 124, n: 6 },
};

/** The Stingray chip's size, and its pin pitch (the pins line up with the socket's). */
export const CHIP_W = 56, CHIP_H = 26;

const P = {
  outline: '#0b0b12',
  caseDark: '#1c1e29',
  case: '#2a2d3a',
  top: '#373b4d',
  topHi: '#4a4f66',
  edge: '#5c6280',
  violet: '#c3a0ff',
  violetDark: '#6c4fb0',
  gold: '#e0b04a',
  goldDark: '#8a6a26',
  key: '#23252f',
  keyTop: '#303342',
  keyLit: '#9ae8ff',
  screenOff: '#07090d',
};

let cache: HTMLCanvasElement | null = null;

/** The deck's body (everything that doesn't move), painted once. */
export function deckBody(): HTMLCanvasElement {
  if (cache) return cache;
  const s = surface(DECK_W, DECK_H);
  const g = s.ctx;
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // The cable, coiling off the left side (drawn first: the body sits over its root).
  g.strokeStyle = '#15161f';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(14, 100);
  g.bezierCurveTo(-6, 104, 4, 128, 0, 134);
  g.stroke();
  g.strokeStyle = '#3a3f55';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(14, 99);
  g.bezierCurveTo(-5, 103, 3, 127, -1, 133);
  g.stroke();

  // The screen lid, standing up behind the body: a thick bezel with a violet stripe.
  r(29, 5, 124, 62, P.outline);
  r(30, 6, 122, 60, P.case);
  r(30, 6, 122, 2, P.edge);
  r(32, 10, 118, 52, P.caseDark);
  r(36, 14, 110, 46, P.outline);
  r(DECK.screen.x, DECK.screen.y, DECK.screen.w, DECK.screen.h, P.screenOff);
  r(30, 62, 122, 2, P.violetDark);
  // Hinge blocks.
  r(46, 64, 14, 5, P.outline);
  r(122, 64, 14, 5, P.outline);
  r(47, 64, 12, 4, P.edge);
  r(123, 64, 12, 4, P.edge);

  // The whip antenna, from the bay's corner up, a little bent, with a base collar.
  g.strokeStyle = '#8a8fa8';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(248, 70);
  g.quadraticCurveTo(254, 40, DECK.antennaTip.x, DECK.antennaTip.y + 2);
  g.stroke();
  r(245, 66, 7, 6, P.outline);
  r(246, 67, 5, 4, P.edge);

  // The body: a slab seen from above and in front. Top face, then the front lip.
  r(9, 66, 246, 60, P.outline);
  r(10, 67, 244, 46, P.top);
  r(10, 67, 244, 1, P.topHi);
  r(10, 113, 244, 12, P.case);
  r(10, 113, 244, 1, P.edge);
  r(10, 124, 244, 1, P.caseDark);
  // Corner bumpers (a deck that's been dropped).
  for (const [x, y] of [[9, 66], [247, 66], [9, 118], [247, 118]] as const) {
    r(x, y, 8, 8, P.outline);
    r(x + 1, y + 1, 6, 6, '#4a3a2a');
    r(x + 2, y + 2, 2, 2, '#6a5236');
  }

  // Keyboard: five rows, hand-lettered function keys in violet, a few keys worn shiny.
  const kx = 20, ky = 71;
  for (let row = 0; row < 5; row++) {
    const cols = row === 4 ? 12 : 15;
    for (let c = 0; c < cols; c++) {
      let x = kx + c * 10 + (row % 2) * 2, w = 8;
      if (row === 4 && c === 4) w = 38; // the space bar
      if (row === 4 && c > 4) x += 30;
      const y = ky + row * 8;
      r(x, y, w, 7, P.outline);
      r(x, y, w - 1, 6, row === 0 && c < 6 ? P.violetDark : P.key);
      r(x, y, w - 1, 1, row === 0 && c < 6 ? P.violet : P.keyTop);
      if ((row * 7 + c * 3) % 11 === 0) r(x + 2, y + 2, 3, 2, '#5a5f78');
    }
  }
  // A trackpoint nub and two palm-worn patches.
  r(88, 104, 3, 3, '#c85a64');
  r(34, 106, 22, 4, '#40445a');
  r(116, 106, 22, 4, '#40445a');

  // The coprocessor bay: a recessed well with its door flipped back, the socket's pins on the floor.
  const b = DECK.socket;
  r(b.x - 6, b.y - 8, b.w + 12, b.h + 14, P.outline);
  r(b.x - 5, b.y - 7, b.w + 10, b.h + 12, '#15161f');
  r(b.x - 5, b.y - 7, b.w + 10, 1, '#2a2d3a');
  // The door, open against the lid side.
  r(b.x - 4, 50, b.w + 8, 14, P.outline);
  r(b.x - 3, 51, b.w + 6, 12, P.case);
  r(b.x - 3, 51, b.w + 6, 1, P.edge);
  drawText(g, 'CO-PRO', b.x + 12, 54, { color: '#8a8fa8', shadow: false });
  // Socket floor: a row of gold contacts at the chip's pin pitch, and two clip hinges.
  r(b.x, b.y + b.h - 5, b.w, 4, '#0c0d13');
  for (let i = 0; i < 13; i++) r(b.x + 4 + i * 4, b.y + b.h - 4, 2, 2, P.goldDark);
  r(b.x - 4, b.y + 2, 3, 10, '#555a70');
  r(b.x + b.w + 1, b.y + 2, 3, 10, '#555a70');

  // Stickers: the front lip is where a deck's history lives.
  // "HEX", in marker on tape.
  r(150, 115, 26, 8, '#e8e2c8');
  drawText(g, 'HEX', 153, 115, { color: '#1a1820', shadow: false });
  // A cat face.
  r(182, 115, 10, 8, '#ff8ac8');
  r(183, 114, 2, 2, '#ff8ac8');
  r(189, 114, 2, 2, '#ff8ac8');
  r(184, 118, 1, 1, '#1a1820');
  r(188, 118, 1, 1, '#1a1820');
  // Hazard tape.
  for (let i = 0; i < 6; i++) r(200 + i * 4, 116, 2, 6, i % 2 ? '#1a1820' : '#ffcc3d');
  // A peeling warranty seal (void).
  r(230, 115, 16, 7, '#b8bcd0');
  r(244, 115, 2, 3, P.case);
  r(232, 117, 10, 1, '#c85a64');
  r(232, 119, 7, 1, '#c85a64');
  // The LED bezels.
  for (let i = 0; i < DECK.leds.n; i++) r(DECK.leds.x - 1 + i * 8, DECK.leds.y - 1, 5, 5, P.outline);
  // A strip of violet trim along the lip.
  r(10, 125, 244, 1, P.violetDark);
  cache = s.canvas;
  return cache;
}

/** The status LEDs: `lit` of them on (green), or all blinking red when the deck is dead. */
export function drawLeds(ctx: Ctx, ox: number, oy: number, lit: number, dead: boolean, t: number): void {
  for (let i = 0; i < DECK.leds.n; i++) {
    const on = dead ? Math.floor(t / 20) % 2 === 0 && i === 0 : i < lit;
    ctx.fillStyle = dead ? (on ? '#ff4a4a' : '#3a1414') : on ? (i === DECK.leds.n - 1 ? '#6ff3ff' : '#62e06a') : '#14261a';
    ctx.fillRect(ox + DECK.leds.x + i * 8, oy + DECK.leds.y, 3, 3);
  }
}

/** The antenna's tip light: a slow blink once the deck is live. */
export function drawAntennaTip(ctx: Ctx, ox: number, oy: number, live: boolean, t: number): void {
  const on = live && Math.floor(t / 24) % 3 !== 0;
  ctx.fillStyle = on ? '#ff5a9a' : '#3a2030';
  ctx.fillRect(ox + DECK.antennaTip.x - 1, oy + DECK.antennaTip.y, 3, 3);
  if (on) {
    ctx.fillStyle = 'rgba(255,90,154,0.35)';
    ctx.fillRect(ox + DECK.antennaTip.x - 2, oy + DECK.antennaTip.y - 1, 5, 5);
  }
}

/**
 * The Stingray: a Fathom Systems coprocessor, teal board and gold fingers, with the little fin
 * logo that glows once it's powered. Drawn at (x, y), its top-left corner.
 */
export function drawChip(ctx: Ctx, x: number, y: number, glow: number): void {
  const r = (a: number, b: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + a), Math.round(y + b), w, h);
  };
  r(-1, -1, CHIP_W + 2, CHIP_H - 2, P.outline);
  r(0, 0, CHIP_W, CHIP_H - 4, '#1a4a4e');
  r(0, 0, CHIP_W, 1, '#2f7a80');
  // Traces.
  for (let i = 0; i < 5; i++) r(20 + i * 7, 3, 1, 8, '#2a6a6e');
  r(20, 11, 29, 1, '#2a6a6e');
  // The die.
  r(24, 4, 12, 7, '#0e1418');
  r(25, 5, 10, 1, '#3a4450');
  // Gold fingers along the bottom edge, at the socket's pitch.
  for (let i = 0; i < 13; i++) r(4 + i * 4, CHIP_H - 4, 2, 4, P.gold);
  // The fin: a swept dorsal fin, lit when the chip is live.
  const fin = glow > 0 ? '#6ff3ff' : '#8fb8bc';
  r(5, 9, 10, 2, fin);
  r(7, 7, 7, 2, fin);
  r(9, 5, 4, 2, fin);
  r(11, 3, 2, 2, fin);
  if (glow > 0) {
    ctx.fillStyle = `rgba(111,243,255,${(0.25 * glow).toFixed(3)})`;
    ctx.fillRect(Math.round(x + 3), Math.round(y + 1), 14, 12);
  }
  drawText(ctx, 'STINGRAY', Math.round(x + 5), Math.round(y + 13), { color: '#d8f0f0', shadow: false });
}

/**
 * The small deck for the battle cut-in (72×40): the same deck in miniature, its screen scrolling
 * code while a program runs (`t` is frames into the cut-in; the program's name is on the banner).
 */
export function drawMiniDeck(ctx: Ctx, x: number, y: number, t: number): void {
  const r = (a: number, b: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + a, y + b, w, h);
  };
  // Lid and screen.
  r(4, 0, 50, 26, P.outline);
  r(5, 1, 48, 24, P.case);
  r(8, 3, 42, 19, '#06140f');
  // Scrolling "code": columns of lit pixels stepping upward.
  for (let i = 0; i < 9; i++) {
    const col = 10 + i * 4;
    const len = 2 + ((i * 5 + Math.floor(t / 3)) % 5);
    for (let j = 0; j < len; j++) {
      const yy = 20 - ((j * 3 + Math.floor(t / 2) + i * 2) % 16);
      r(col, yy, 2, 1, j === 0 ? '#c8ffe8' : '#3fbf88');
    }
  }
  // Body, keys, bay with the chip's fin glowing.
  r(0, 25, 72, 15, P.outline);
  r(1, 26, 70, 9, P.top);
  r(1, 35, 70, 4, P.case);
  for (let c = 0; c < 9; c++) r(3 + c * 5, 28, 4, 2, P.key);
  for (let c = 0; c < 9; c++) r(4 + c * 5, 31, 4, 2, P.key);
  r(52, 27, 17, 7, '#15161f');
  r(54, 28, 13, 5, '#1a4a4e');
  r(56, 29, 3, 2, Math.floor(t / 6) % 2 ? '#6ff3ff' : '#2f7a80');
  // The antenna.
  r(68, 10, 1, 16, '#8a8fa8');
  r(67, 9, 3, 2, Math.floor(t / 10) % 2 ? '#ff5a9a' : '#3a2030');
}
