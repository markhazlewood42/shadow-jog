/**
 * Custom proportional bitmap font. Cap height 7px, 2px descenders, 1px letter spacing.
 * Rows are authored top-down; a glyph with 9 rows uses the descender area.
 *
 * Inline control codes (never rendered):
 *   {w} {y} {c} {m} {r} {g} {d} {o} {v}  — switch color (see COLOR_CODES)
 *   {/}                                  — reset to the call's base color
 *   {p}                                  — typewriter pause (dialog only)
 */
import { must } from './assert';
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

/** A glyph's rows (the '?' box for anything the font doesn't have). */
function rowsOf(ch: string): readonly string[] {
  return G[ch] ?? FALLBACK;
}

/** The box drawn for any character the font lacks. */
const FALLBACK: readonly string[] = must(G['?'], "the font's '?' glyph");

function buildAtlas(): void {
  const chars = Object.keys(G);
  let total = 0;
  for (const ch of chars) total += glyphWidth(ch) + 1;
  const s = surface(total, GLYPH_H);
  s.ctx.fillStyle = '#ffffff';
  let x = 0;
  for (const ch of chars) {
    const rows = rowsOf(ch);
    const w = glyphWidth(ch);
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
  const base = must(atlas, 'the font atlas');
  let t = tinted.get(color);
  if (!t) {
    const s = surface(base.width, base.height);
    s.ctx.drawImage(base, 0, 0);
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
  return glyphs.get(ch) ?? must(glyphs.get('?'), "the font's '?' glyph");
}

/**
 * Control codes ({c}, {/}, {#rrggbb}...) are read in place by the loops below rather than through a
 * per-call callback: text is drawn dozens of times a frame, and a closure per call was the one
 * allocation left in the draw path. `codeColor` is the colour after the last code read.
 */
let codeColor = TEXT;
/** If a control code starts at `i`, apply it to `codeColor` and return the index of its '}', else -1. */
function skipCode(text: string, i: number, base: string): number {
  if (text.charCodeAt(i) !== 123) return -1;
  const end = text.indexOf('}', i);
  if (end <= i) return -1;
  const code = text.slice(i + 1, end);
  if (code === '/') codeColor = base;
  else if (code.startsWith('#')) codeColor = code;
  else codeColor = COLOR_CODES[code] ?? codeColor;
  return end;
}

export function stripCodes(text: string): string {
  return text.replace(/\{[^}]*\}/g, '');
}

export function measure(text: string): number {
  let w = 0;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const end = skipCode(text, i, TEXT);
    if (end >= 0) {
      i = end;
      continue;
    }
    const ch = text.charAt(i);
    if (ch === '\n') continue;
    w += glyphWidth(ch) + SPACING;
    any = true;
  }
  return any ? w - SPACING : 0;
}

/** A glyph's advance, straight from the glyph table (no canvas, so layout can be measured anywhere). */
function glyphWidth(ch: string): number {
  return rowsOf(ch)[0]?.length ?? 0;
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
  // After measure() (which reads codes too): start from this call's own colour.
  codeColor = base;
  for (let i = 0; i < text.length; i++) {
    const end = skipCode(text, i, base);
    if (end >= 0) {
      i = end;
      continue;
    }
    const ch = text.charAt(i);
    if (n >= max || ch === '\n') continue;
    n++;
    const g = glyph(ch);
    if (ch !== ' ') {
      if (shadow) ctx.drawImage(atlasFor(shadow), g.x, 0, g.w, GLYPH_H, cx + 1, y + 1, g.w, GLYPH_H);
      ctx.drawImage(atlasFor(codeColor), g.x, 0, g.w, GLYPH_H, cx, y, g.w, GLYPH_H);
    }
    cx += g.w + SPACING;
  }
  return cx - x - SPACING;
}

/** Visible character count (excludes control codes and newlines). */
export function visibleLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const end = skipCode(text, i, TEXT);
    if (end >= 0) i = end;
    else if (text[i] !== '\n') n++;
  }
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
