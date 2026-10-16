/**
 * Helpers for the UI kit tests (tests/sje-ui-*.test.ts, M8a). Node has no canvas, so:
 *  - a "canvas" is an object with a size and a context that WRITES DOWN every call and every property it is given;
 *  - the same recorder is handed to the old draw functions (`src/ui/draw.ts`, `src/sje/display/font`) and to the kit's painters, and the two logs are
 *    compared line by line. That is the parity test: not a picture, but every `fillRect`, color and alpha, in order.
 */
import { TextureManager } from '../src/sje/display/texturemanager';

/** One argument of a recorded call, as text. Canvases and gradients (objects) become a tag so two logs can be compared. */
function fmt(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v && typeof v === 'object' && 'tag' in v) return `<${(v as { tag: string }).tag}>`;
  if (v && typeof v === 'object' && 'id' in v) return `<canvas#${(v as { id: number }).id}>`;
  if (v && typeof v === 'object') return '<canvas>';
  return String(v);
}

export interface Recorder {
  /** The recording context (the type of a real one, for the functions under test). */
  ctx: CanvasRenderingContext2D;
  /** Every call as `name(args)` and every property set as `name=value`. */
  log: string[];
}

export function recorder(): Recorder {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, name) => {
      if (typeof name !== 'string') return undefined;
      if (name === 'createLinearGradient') {
        return (...a: unknown[]) => {
          log.push(`createLinearGradient(${a.map(fmt).join(',')})`);
          return { tag: 'gradient', addColorStop: (...s: unknown[]) => void log.push(`addColorStop(${s.map(fmt).join(',')})`) };
        };
      }
      return (...a: unknown[]) => void log.push(`${name}(${a.map(fmt).join(',')})`);
    },
    set: (_t, name, v) => {
      log.push(`${String(name)}=${fmt(v)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** The log without the property sets that only prepare a context (smoothing). */
export const calls = (log: readonly string[]): string[] => log.filter((l) => !l.startsWith('imageSmoothingEnabled'));

export interface FakeCanvas {
  id: number;
  width: number;
  height: number;
  style: Record<string, string>;
  log: string[];
  getContext(): unknown;
}

/** The canvases made while a fake `document` is installed, newest last. */
export const canvases: FakeCanvas[] = [];

function makeCanvas(): FakeCanvas {
  const r = recorder();
  const c: FakeCanvas = { id: canvases.length, width: 0, height: 0, style: {}, log: r.log, getContext: () => r.ctx };
  canvases.push(c);
  return c;
}

/** Make `document.createElement('canvas')` hand out recording canvases. Returns the function that puts back what was there. */
export function installFakeDocument(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  g.document = { createElement: makeCanvas };
  return () => {
    g.document = before;
  };
}

/** The little a display object needs from its scene: a texture manager. */
export function fakeHost(): { textures: TextureManager } {
  return { textures: new TextureManager() };
}

/** The fillRect calls of a log, each with the fill style and the alpha that were set when it was made. */
export interface Filled {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  alpha: number;
}
export function filledRects(log: readonly string[]): Filled[] {
  const out: Filled[] = [];
  let style = '"#000"';
  let alpha = 1;
  const stack: number[] = [];
  for (const l of log) {
    if (l.startsWith('fillStyle=')) style = l.slice('fillStyle='.length);
    else if (l.startsWith('globalAlpha=')) alpha = Number(l.slice('globalAlpha='.length));
    else if (l === 'save()') stack.push(alpha);
    else if (l === 'restore()') alpha = stack.pop() ?? alpha;
    else if (l.startsWith('fillRect(')) {
      const n = l.slice('fillRect('.length, -1).split(',').map(Number);
      out.push({ x: n[0] ?? 0, y: n[1] ?? 0, w: n[2] ?? 0, h: n[3] ?? 0, style, alpha });
    }
  }
  return out;
}

/** The destination rectangles of the `drawImage` calls of a log (the glyphs): the 9-argument form's last four numbers. */
export function glyphBlits(log: readonly string[]): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const l of log) {
    if (!l.startsWith('drawImage(')) continue;
    const a = l.slice('drawImage('.length, -1).split(',');
    if (a.length === 9) out.push({ x: Number(a[5]), y: Number(a[6]), w: Number(a[7]), h: Number(a[8]) });
  }
  return out;
}

/** A tiny seeded generator, so a "random" test script is the same on every run. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
