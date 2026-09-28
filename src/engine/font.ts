/**
 * Custom proportional bitmap font. Cap height 7px, 2px descenders, 1px letter spacing.
 * Rows are authored top-down; a glyph with 9 rows uses the descender area.
 *
 * Inline control codes (never rendered):
 *   {w} {y} {c} {m} {r} {g} {d} {o} {v}  — switch color (see COLOR_CODES)
 *   {/}                                  — reset to the call's base color
 *   {p}                                  — typewriter pause (dialog only)
 */
import { surface, type Ctx } from './canvas';

const G: Record<string, string[]> = {
  // ---- uppercase (5 wide unless noted) ----
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  // ---- lowercase (mostly 4 wide) ----
  a: ['....', '....', '.##.', '...#', '.###', '#..#', '.###'],
  b: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '###.'],
  c: ['....', '....', '.###', '#...', '#...', '#...', '.###'],
  d: ['...#', '...#', '.###', '#..#', '#..#', '#..#', '.###'],
  e: ['....', '....', '.##.', '#..#', '####', '#...', '.###'],
  f: ['.##', '#..', '###', '#..', '#..', '#..', '#..'],
  g: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '.##.'],
  h: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  j: ['.#', '..', '.#', '.#', '.#', '.#', '.#', '.#', '#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  m: ['.....', '.....', '####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['....', '....', '###.', '#..#', '#..#', '#..#', '#..#'],
  o: ['....', '....', '.##.', '#..#', '#..#', '#..#', '.##.'],
  p: ['....', '....', '###.', '#..#', '#..#', '#..#', '###.', '#...', '#...'],
  q: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '...#'],
  r: ['...', '...', '#.#', '##.', '#..', '#..', '#..'],
  s: ['....', '....', '.###', '#...', '.##.', '...#', '###.'],
  t: ['...', '#..', '###', '#..', '#..', '#..', '.##'],
  u: ['....', '....', '#..#', '#..#', '#..#', '#..#', '.###'],
  v: ['.....', '.....', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['....', '....', '#..#', '#..#', '.##.', '#..#', '#..#'],
  y: ['....', '....', '#..#', '#..#', '#..#', '#..#', '.###', '...#', '.##.'],
  z: ['....', '....', '####', '..#.', '.#..', '#...', '####'],
  // ---- digits (4 wide, tabular) ----
  '0': ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  '1': ['.#..', '##..', '.#..', '.#..', '.#..', '.#..', '###.'],
  '2': ['.##.', '#..#', '...#', '..#.', '.#..', '#...', '####'],
  '3': ['###.', '...#', '...#', '.##.', '...#', '...#', '###.'],
  '4': ['#..#', '#..#', '#..#', '####', '...#', '...#', '...#'],
  '5': ['####', '#...', '#...', '###.', '...#', '...#', '###.'],
  '6': ['.##.', '#...', '#...', '###.', '#..#', '#..#', '.##.'],
  '7': ['####', '...#', '...#', '..#.', '.#..', '.#..', '.#..'],
  '8': ['.##.', '#..#', '#..#', '.##.', '#..#', '#..#', '.##.'],
  '9': ['.##.', '#..#', '#..#', '.###', '...#', '...#', '.##.'],
  // ---- punctuation ----
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '..', '.#', '#.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.##.', '#..#', '...#', '..#.', '.#..', '....', '.#..'],
  ':': ['.', '.', '#', '.', '.', '.', '#'],
  ';': ['..', '..', '.#', '..', '..', '..', '.#', '#.'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '+': ['...', '...', '.#.', '###', '.#.', '...', '...'],
  '=': ['...', '...', '###', '...', '###', '...', '...'],
  '/': ['..#', '..#', '.#.', '.#.', '.#.', '#..', '#..'],
  '\\': ['#..', '#..', '.#.', '.#.', '.#.', '..#', '..#'],
  '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
  '[': ['##', '#.', '#.', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '.#', '.#', '##'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '*': ['...', '#.#', '.#.', '#.#', '...', '...', '...'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '<': ['...', '..#', '.#.', '#..', '.#.', '..#', '...'],
  '>': ['...', '#..', '.#.', '..#', '.#.', '#..', '...'],
  _: ['....', '....', '....', '....', '....', '....', '####'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '^': ['.#.', '#.#', '...', '...', '...', '...', '...'],
  '~': ['....', '....', '.#.#', '#.#.', '....', '....', '....'],
  '|': ['#', '#', '#', '#', '#', '#', '#'],
  // ---- specials ----
  '¢': ['....', '..#.', '.###', '#.#.', '#.#.', '.###', '..#.'],
  '▶': ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
  '◀': ['...#', '..##', '.###', '####', '.###', '..##', '...#'],
  '▼': ['.....', '.....', '#####', '.###.', '..#..', '.....', '.....'],
  '▲': ['.....', '..#..', '.###.', '#####', '.....', '.....', '.....'],
  '♥': ['.....', '##.##', '#####', '#####', '.###.', '..#..', '.....'],
  '★': ['..#..', '..#..', '#####', '.###.', '.#.#.', '#...#', '.....'],
  '•': ['..', '..', '..', '##', '##', '..', '..'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  '♦': ['.....', '..#..', '.###.', '#####', '.###.', '..#..', '.....'],
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'],
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '–': ['....', '....', '....', '####', '....', '....', '....'],
  '→': ['.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....'],
  '←': ['.....', '..#..', '.#...', '#####', '.#...', '..#..', '.....'],
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '.....'],
  '↓': ['.....', '..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..'],
  '×': ['...', '...', '#.#', '.#.', '#.#', '...', '...'],
  '’': ['#', '#', '.', '.', '.', '.', '.'],
  '‘': ['#', '#', '.', '.', '.', '.', '.'],
  '“': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '”': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  'é': ['.#..', '#...', '.##.', '#..#', '####', '#...', '.###'],
};

/** Whether the bitmap font can draw this character (anything else renders as a fallback box). */
export function hasGlyph(ch: string): boolean {
  return ch === ' ' || ch === '\n' || G[ch] !== undefined;
}

export const LINE_H = 10;
export const GLYPH_H = 9;
const SPACING = 1;

export const COLOR_CODES: Record<string, string> = {
  w: '#f4f1ff',
  y: '#ffd75e',
  c: '#6ff3ff',
  m: '#ff6fc8',
  r: '#ff6b6b',
  g: '#86f08c',
  d: '#8b8fa8',
  o: '#ffa24a',
  v: '#b99bff',
};

export const TEXT = '#f4f1ff';
export const TEXT_DIM = '#8b8fa8';
export const SHADOW = '#0a0913';

interface Glyph {
  x: number;
  w: number;
}

let atlas: HTMLCanvasElement | null = null;
const glyphs = new Map<string, Glyph>();
const tinted = new Map<string, HTMLCanvasElement>();

function buildAtlas(): void {
  const chars = Object.keys(G);
  let total = 0;
  for (const ch of chars) total += G[ch]![0]!.length + 1;
  const s = surface(total, GLYPH_H);
  s.ctx.fillStyle = '#ffffff';
  let x = 0;
  for (const ch of chars) {
    const rows = G[ch]!;
    const w = rows[0]!.length;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') s.ctx.fillRect(x + rx, ry, 1, 1);
    });
    glyphs.set(ch, { x, w });
    x += w + 1;
  }
  atlas = s.canvas;
}

function atlasFor(color: string): HTMLCanvasElement {
  if (!atlas) buildAtlas();
  let t = tinted.get(color);
  if (!t) {
    const s = surface(atlas!.width, atlas!.height);
    s.ctx.drawImage(atlas!, 0, 0);
    s.ctx.globalCompositeOperation = 'source-in';
    s.ctx.fillStyle = color;
    s.ctx.fillRect(0, 0, s.w, s.h);
    t = s.canvas;
    tinted.set(color, t);
  }
  return t;
}

function glyph(ch: string): Glyph {
  if (!atlas) buildAtlas();
  return glyphs.get(ch) ?? glyphs.get('?')!;
}

/** Iterate text as runs, resolving control codes. Calls `emit` per visible char. */
function walk(text: string, base: string, emit: (ch: string, color: string) => void): void {
  let color = base;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '{') {
      const end = text.indexOf('}', i);
      if (end > i) {
        const code = text.slice(i + 1, end);
        if (code === '/') color = base;
        else if (COLOR_CODES[code]) color = COLOR_CODES[code]!;
        else if (code.startsWith('#')) color = code;
        i = end;
        continue;
      }
    }
    emit(ch, color);
  }
}

export function stripCodes(text: string): string {
  return text.replace(/\{[^}]*\}/g, '');
}

export function measure(text: string): number {
  let w = 0;
  let any = false;
  walk(text, TEXT, (ch) => {
    if (ch === '\n') return;
    w += glyph(ch).w + SPACING;
    any = true;
  });
  return any ? w - SPACING : 0;
}

export interface TextOpts {
  color?: string;
  shadow?: string | false;
  align?: 'left' | 'center' | 'right';
  /** Typewriter: only draw this many visible characters. */
  max?: number;
}

/** Draw a single line (no wrapping). Returns drawn width. */
export function drawText(ctx: Ctx, text: string, x: number, y: number, opts: TextOpts = {}): number {
  const base = opts.color ?? TEXT;
  const shadow = opts.shadow === undefined ? SHADOW : opts.shadow;
  let w = 0;
  if (opts.align && opts.align !== 'left') {
    w = measure(text);
    x = opts.align === 'center' ? x - Math.floor(w / 2) : x - w;
  }
  x = Math.round(x);
  y = Math.round(y);
  let cx = x;
  let n = 0;
  const max = opts.max ?? Infinity;
  walk(text, base, (ch, color) => {
    if (n >= max || ch === '\n') return;
    n++;
    const g = glyph(ch);
    if (ch !== ' ') {
      if (shadow) ctx.drawImage(atlasFor(shadow), g.x, 0, g.w, GLYPH_H, cx + 1, y + 1, g.w, GLYPH_H);
      ctx.drawImage(atlasFor(color), g.x, 0, g.w, GLYPH_H, cx, y, g.w, GLYPH_H);
    }
    cx += g.w + SPACING;
  });
  return cx - x - SPACING;
}

/** Visible character count (excludes control codes and newlines). */
export function visibleLength(text: string): number {
  let n = 0;
  walk(text, TEXT, (ch) => {
    if (ch !== '\n') n++;
  });
  return n;
}

/**
 * Word-wrap into lines no wider than `maxW`. Honors explicit `\n`.
 * The active color code is re-emitted at the start of continuation lines.
 */
/** Single-line text that must fit a width: returned as-is, or cut with an ellipsis. */
export function fitText(text: string, maxW: number): string {
  if (measure(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}…`) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** A single word wider than the box is split at the character that would overflow it. */
function splitLong(word: string, maxW: number): string[] {
  if (word.includes('{') || measure(word) <= maxW) return [word];
  const parts: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur && measure(cur + ch) > maxW) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

export function wrap(text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ').flatMap((w) => splitLong(w, maxW));
    let line = '';
    let activeCode = '';
    let lineStartCode = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : lineStartCode + word;
      if (line && measure(candidate) > maxW) {
        out.push(line);
        lineStartCode = activeCode;
        line = lineStartCode + word;
      } else {
        line = candidate;
      }
      for (const c of word.match(/\{[^}]*\}/g) ?? []) {
        if (c === '{/}') activeCode = '';
        else if (c !== '{p}') activeCode = c;
      }
    }
    out.push(line);
  }
  return out;
}

/** Draw wrapped multi-line text; returns number of lines. */
export function drawParagraph(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  maxW: number,
  opts: TextOpts & { lineH?: number } = {},
): number {
  const lines = wrap(text, maxW);
  const lh = opts.lineH ?? LINE_H;
  let remaining = opts.max ?? Infinity;
  lines.forEach((ln, i) => {
    if (remaining <= 0) return;
    drawText(ctx, ln, x, y + i * lh, { ...opts, max: remaining });
    remaining -= visibleLength(ln);
  });
  return lines.length;
}
