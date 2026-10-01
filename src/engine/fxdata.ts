/**
 * The GPU effects' data, as it lives in src/data/fx.json: particle presets, and "moments" (what
 * fires on each game event: a FIRE hit, a critical, a boss changing form). The FX lab (a dev page,
 * `?scene=fxlab`) edits both and saves them through the dev server; the game reads them.
 *
 * This file holds the shapes, the checks and the file format, and nothing that needs a browser:
 * the dev server's save endpoint (vite.config.ts) and the tests use it too.
 */
import type { EmitterPreset, ParticleShape } from './particles';

/** A preset as stored: the emitter, plus a note for whoever tunes it next. */
export type FxPreset = EmitterPreset & { note?: string };

/**
 * One layer of a moment. A layer does one thing: bursts a preset (`emit`), sends a shockwave
 * (`shock`), splits the colour (`aberrate`, pixels) or brightens the bloom (`flare`), after an
 * optional delay in frames, offset from the moment's point.
 */
export interface MomentLayer {
  emit?: string;
  /** A fixed multiplier on the burst's count. */
  scale?: number;
  /** Scale with the event's weight (a heavier blow, a bigger burst; a weak hit, bigger again). */
  weighted?: boolean;
  /** Fly the way the blow travelled (the preset's direction is turned to match). */
  aim?: boolean;
  shock?: { strength?: number; reach?: number; life?: number; width?: number };
  aberrate?: number;
  flare?: number;
  /** Heat shimmer around the point (fire). */
  haze?: { radius?: number; strength?: number; life?: number };
  /** Corruption over a rectangle centred on the point (a hack). */
  glitch?: { w?: number; h?: number; strength?: number; life?: number };
  /** The whole stage dimmed (0..1) while a big spell plays; what glows stays lit. */
  dim?: { amount?: number; life?: number };
  delay?: number;
  dx?: number;
  dy?: number;
}

export interface Moment {
  note?: string;
  layers: MomentLayer[];
}

export interface FxData {
  presets: Record<string, FxPreset>;
  moments: Record<string, Moment>;
}

const SHAPES: readonly ParticleShape[] = ['soft', 'dot', 'spark', 'square', 'ring'];
const ID = /^[a-z][a-z0-9_.]*$/;
const HEX = /^#[0-9a-f]{6}$/i;

/** What a moment layer can do (each layer does exactly one). */
export const LAYER_KINDS = ['emit', 'shock', 'aberrate', 'flare', 'haze', 'glitch', 'dim'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/** Everything wrong with a candidate fx.json (empty when it's good to save and to play). */
export function checkFx(d: unknown): string[] {
  const out: string[] = [];
  if (!isObj(d) || !isObj(d.presets) || !isObj(d.moments)) return ['fx data needs "presets" and "moments" objects'];
  for (const [id, p] of Object.entries(d.presets)) {
    const at = `preset "${id}"`;
    if (!ID.test(id)) out.push(`${at}: ids are lower case letters, digits, _ and .`);
    if (!isObj(p)) {
      out.push(`${at}: not an object`);
      continue;
    }
    for (const k of ['count', 'life', 'speed', 'size'] as const) if (!isPair(p[k])) out.push(`${at}: ${k} must be [a, b]`);
    if (isPair(p.count) && (p.count[0] < 0 || p.count[0] > p.count[1] || p.count[1] > 400)) out.push(`${at}: count must be 0 <= min <= max <= 400`);
    if (isPair(p.life) && (p.life[0] < 1 || p.life[0] > p.life[1])) out.push(`${at}: life must be 1 <= min <= max`);
    if (isPair(p.speed) && p.speed[0] > p.speed[1]) out.push(`${at}: speed min is above max`);
    if (p.alpha !== undefined && !isPair(p.alpha)) out.push(`${at}: alpha must be [start, end]`);
    if (!Array.isArray(p.colors) || !p.colors.length || !p.colors.every((c) => typeof c === 'string' && HEX.test(c))) out.push(`${at}: colors must be one or more '#rrggbb'`);
    if (!SHAPES.includes(p.shape as ParticleShape)) out.push(`${at}: shape must be one of ${SHAPES.join(', ')}`);
    if (p.blend !== undefined && p.blend !== 'add' && p.blend !== 'alpha') out.push(`${at}: blend must be add or alpha`);
    for (const k of ['angle', 'spread', 'radius', 'gravity', 'drag', 'stretch', 'spin', 'wobble'] as const) {
      if (p[k] !== undefined && !isNum(p[k])) out.push(`${at}: ${k} must be a number`);
    }
    if (isNum(p.drag) && (p.drag <= 0 || p.drag > 1)) out.push(`${at}: drag must be above 0 and at most 1`);
    if (p.snap !== undefined && typeof p.snap !== 'boolean') out.push(`${at}: snap must be true or false`);
    if (p.inward !== undefined && typeof p.inward !== 'boolean') out.push(`${at}: inward must be true or false`);
    if (p.note !== undefined && typeof p.note !== 'string') out.push(`${at}: note must be text`);
  }
  for (const [id, m] of Object.entries(d.moments)) {
    const at = `moment "${id}"`;
    if (!ID.test(id)) out.push(`${at}: ids are lower case letters, digits, _ and .`);
    if (!isObj(m) || !Array.isArray(m.layers)) {
      out.push(`${at}: needs a layers list`);
      continue;
    }
    m.layers.forEach((l: unknown, i: number) => {
      const la = `${at} layer ${i + 1}`;
      if (!isObj(l)) {
        out.push(`${la}: not an object`);
        return;
      }
      const does = LAYER_KINDS.filter((k) => l[k] !== undefined);
      if (does.length !== 1) out.push(`${la}: does exactly one of ${LAYER_KINDS.join(', ')}`);
      if (l.emit !== undefined && (typeof l.emit !== 'string' || !(l.emit in (d.presets as object)))) out.push(`${la}: no preset "${String(l.emit)}"`);
      if (l.shock !== undefined && (!isObj(l.shock) || !Object.values(l.shock).every(isNum))) out.push(`${la}: shock takes numbers (strength, reach, life, width)`);
      if (l.haze !== undefined && (!isObj(l.haze) || !Object.values(l.haze).every(isNum))) out.push(`${la}: haze takes numbers (radius, strength, life)`);
      if (l.glitch !== undefined && (!isObj(l.glitch) || !Object.values(l.glitch).every(isNum))) out.push(`${la}: glitch takes numbers (w, h, strength, life)`);
      if (l.dim !== undefined && (!isObj(l.dim) || !Object.values(l.dim).every(isNum))) out.push(`${la}: dim takes numbers (amount, life)`);
      if (isObj(l.dim) && isNum(l.dim.amount) && (l.dim.amount < 0 || l.dim.amount > 1)) out.push(`${la}: dim amount is 0 to 1`);
      for (const k of ['scale', 'aberrate', 'flare', 'delay', 'dx', 'dy'] as const) if (l[k] !== undefined && !isNum(l[k])) out.push(`${la}: ${k} must be a number`);
      if (isNum(l.delay) && l.delay < 0) out.push(`${la}: delay can't be negative`);
    });
  }
  return out;
}

/** Preset fields in the order they're written (and shown in the lab). */
export const PRESET_KEYS = ['note', 'shape', 'blend', 'count', 'life', 'speed', 'angle', 'spread', 'radius', 'gravity', 'drag', 'size', 'alpha', 'colors', 'stretch', 'spin', 'wobble', 'snap', 'inward'] as const;
const LAYER_KEYS = ['emit', 'shock', 'aberrate', 'flare', 'haze', 'glitch', 'dim', 'scale', 'weighted', 'aim', 'delay', 'dx', 'dy'] as const;

/** A value on one line: arrays and small objects inline, so each field is one line of diff. */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (isObj(v)) return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`;
  return JSON.stringify(v);
}

/** Round numbers to 4 places: the lab's sliders mustn't write 0.30000000000000004. */
function tidy(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
  if (Array.isArray(v)) return v.map(tidy);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)]));
  return v;
}

/**
 * fx.json as written: presets, then moments, each field on its own line in a fixed order, so a
 * save from the lab reads as a small, clean diff.
 */
export function formatFx(d: FxData): string {
  const lines: string[] = ['{', '  "presets": {'];
  const presets = Object.entries(d.presets);
  presets.forEach(([id, p], i) => {
    lines.push(`    ${JSON.stringify(id)}: {`);
    const src = p as unknown as Record<string, unknown>;
    const fields = PRESET_KEYS.filter((k) => src[k] !== undefined).map((k) => `      ${JSON.stringify(k)}: ${inline(tidy(src[k]))}`);
    lines.push(fields.join(',\n'));
    lines.push(`    }${i < presets.length - 1 ? ',' : ''}`);
  });
  lines.push('  },', '  "moments": {');
  const moments = Object.entries(d.moments);
  moments.forEach(([id, m], i) => {
    lines.push(`    ${JSON.stringify(id)}: {`);
    if (m.note !== undefined) lines.push(`      "note": ${JSON.stringify(m.note)},`);
    const layers = m.layers.map((l) => {
      const src = l as unknown as Record<string, unknown>;
      const ordered = Object.fromEntries(LAYER_KEYS.filter((k) => src[k] !== undefined).map((k) => [k, tidy(src[k])]));
      return `        ${inline(ordered)}`;
    });
    lines.push(layers.length ? `      "layers": [\n${layers.join(',\n')}\n      ]` : '      "layers": []');
    lines.push(`    }${i < moments.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}
