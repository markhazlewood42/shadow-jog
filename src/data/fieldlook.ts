/**
 * The field's look values (M5 round 1, finding F1): every tunable number of how the new field stage looks that is not in a map's data or in the old lighting
 * config. One file, `fieldlook.json`, an editor can change; this module is its typed loader and its check.
 *
 * What stays in code on purpose (the form, not the tuning): the formulas that use these numbers (the chest pulse is `base + swing * sin(...)`, the flicker is two
 * sines and a dropout, the glint walks one tile of the lid), the lighting formula (the sprite's falloff stops, the intensity-above-one second pass), the ySort rule.
 * `checkFieldLook` lists every problem in plain words (like `checkEnemies`); `loadFieldLook` throws with that list, so a bad edit stops at load.
 */
import raw from './fieldlook.json' with { type: 'json' };

/** [x, y, width, height]. */
export type RectArr = readonly [number, number, number, number];

/** The tuning of a failing neon tube. The same shape as the engine's `FlickerLook` (src/sje/display/lights.ts): the data side holds its own copy, so a data file never imports the engine. */
export interface FlickerLook {
  /** The steady level of a flickering light, as a multiplier of its intensity. */
  readonly base: number;
  /** The slow wobble: its size and its speed (radians a frame). */
  readonly wobbleSlow: number;
  readonly rateSlow: number;
  /** The fast wobble. */
  readonly wobbleFast: number;
  readonly rateFast: number;
  /** A hard dropout (a failing tube): the hash of the frame mod `dropEvery` is below `dropBelow`, and the light falls to `dropTo`. */
  readonly dropEvery: number;
  readonly dropBelow: number;
  readonly dropTo: number;
}

export interface FieldLook {
  /** The contact shadow under an actor: color (a 0xrrggbb number), alpha, and rectangles as offsets from the feet. */
  readonly shadow: { readonly color: number; readonly alpha: number; readonly rects: readonly RectArr[] };
  /** How strongly the glow layer is lit: towns glow harder than rooms. */
  readonly glow: { readonly interior: number; readonly outdoors: number };
  /** The haze around bright lights. */
  readonly bloom: { readonly outdoors: number; readonly interior: number };
  readonly chest: {
    readonly haloAt: { readonly x: number; readonly y: number };
    /** `base + swing * sin(frame * rate + tileX * phase)`. */
    readonly pulse: { readonly base: number; readonly swing: number; readonly rate: number; readonly phase: number };
    /** A glint crosses a closed chest's lid every `period` frames for `length` frames. The dot is drawn at `g` pixels along the lid, the star while `starAfter < g < starBefore`. */
    readonly glint: {
      readonly period: number;
      readonly length: number;
      readonly tileX: number;
      readonly tileY: number;
      readonly color: number;
      readonly dot: RectArr;
      readonly starAfter: number;
      readonly starBefore: number;
      readonly star: readonly RectArr[];
    };
  };
  readonly lights: {
    /** How much a lit sprite resists the dark: 0 = the light map decides, 1 = the map is ignored. */
    readonly spriteBoost: number;
    readonly flicker: FlickerLook;
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function section(data: Record<string, unknown>, key: string, at: string, out: string[]): Record<string, unknown> | null {
  const v = data[key];
  if (!isObj(v)) {
    out.push(`${at}${key}: must be an object`);
    return null;
  }
  return v;
}

function numbers(at: string, o: Record<string, unknown>, keys: readonly string[], out: string[], min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) out.push(`${at}: "${k}" is not a field here`);
  for (const k of keys) {
    const v = o[k];
    if (!isNum(v)) out.push(`${at}.${k}: must be a number`);
    else if (v < min || v > max) out.push(`${at}.${k}: must be from ${min} to ${max}, got ${v}`);
  }
}

function rect(at: string, v: unknown, out: string[]): void {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isInt)) {
    out.push(`${at}: must be [x, y, width, height], four whole numbers`);
    return;
  }
  if (Number(v[2]) <= 0 || Number(v[3]) <= 0) out.push(`${at}: the width and height must be above 0`);
}

/** Every problem in a look file, in plain words. An empty list means `loadFieldLook` will accept it. */
export function checkFieldLook(data: unknown): string[] {
  if (!isObj(data)) return ['fieldlook: the file must be an object'];
  const out: string[] = [];
  for (const k of Object.keys(data)) if (!['shadow', 'glow', 'bloom', 'chest', 'lights'].includes(k)) out.push(`fieldlook: "${k}" is not a section`);

  const shadow = section(data, 'shadow', '', out);
  if (shadow) {
    for (const k of Object.keys(shadow)) if (!['color', 'alpha', 'rects'].includes(k)) out.push(`shadow: "${k}" is not a field here`);
    if (!isColor(shadow.color)) out.push('shadow.color: must be #rrggbb');
    if (!isNum(shadow.alpha) || shadow.alpha < 0 || shadow.alpha > 1) out.push('shadow.alpha: must be a number from 0 to 1');
    if (!Array.isArray(shadow.rects) || shadow.rects.length === 0) out.push('shadow.rects: must be a list of at least one rectangle');
    else for (const [i, r] of shadow.rects.entries()) rect(`shadow.rects[${i}]`, r, out);
  }
  const glow = section(data, 'glow', '', out);
  if (glow) numbers('glow', glow, ['interior', 'outdoors'], out, 0, 4);
  const bloom = section(data, 'bloom', '', out);
  if (bloom) numbers('bloom', bloom, ['outdoors', 'interior'], out, 0, 1);

  const chest = section(data, 'chest', '', out);
  if (chest) {
    for (const k of Object.keys(chest)) if (!['haloAt', 'pulse', 'glint'].includes(k)) out.push(`chest: "${k}" is not a field here`);
    const at = section(chest, 'haloAt', 'chest.', out);
    if (at) numbers('chest.haloAt', at, ['x', 'y'], out);
    const pulse = section(chest, 'pulse', 'chest.', out);
    if (pulse) {
      numbers('chest.pulse', pulse, ['base', 'swing', 'rate', 'phase'], out);
      // The halo's alpha is base + swing * sin(...): it must stay inside 0 to 1.
      if (isNum(pulse.base) && isNum(pulse.swing) && (pulse.base - Math.abs(pulse.swing) < 0 || pulse.base + Math.abs(pulse.swing) > 1)) out.push('chest.pulse: base +- swing must stay from 0 to 1 (it is the halo alpha)');
    }
    const g = section(chest, 'glint', 'chest.', out);
    if (g) {
      for (const k of Object.keys(g)) if (!['period', 'length', 'tileX', 'tileY', 'color', 'dot', 'starAfter', 'starBefore', 'star'].includes(k)) out.push(`chest.glint: "${k}" is not a field here`);
      for (const k of ['period', 'length', 'tileX', 'tileY', 'starAfter', 'starBefore']) if (!isInt(g[k])) out.push(`chest.glint.${k}: must be a whole number`);
      if (isInt(g.period) && g.period < 1) out.push('chest.glint.period: must be 1 or more');
      if (isInt(g.period) && isInt(g.length) && (g.length < 1 || g.length > g.period)) out.push('chest.glint.length: must be from 1 to the period');
      if (isInt(g.starAfter) && isInt(g.starBefore) && g.starAfter >= g.starBefore) out.push('chest.glint: starAfter must be below starBefore');
      if (!isColor(g.color)) out.push('chest.glint.color: must be #rrggbb');
      rect('chest.glint.dot', g.dot, out);
      if (!Array.isArray(g.star)) out.push('chest.glint.star: must be a list of rectangles');
      else for (const [i, r] of g.star.entries()) rect(`chest.glint.star[${i}]`, r, out);
    }
  }

  const lights = section(data, 'lights', '', out);
  if (lights) {
    for (const k of Object.keys(lights)) if (!['spriteBoost', 'flicker'].includes(k)) out.push(`lights: "${k}" is not a field here`);
    if (!isNum(lights.spriteBoost) || lights.spriteBoost < 0 || lights.spriteBoost > 1) out.push('lights.spriteBoost: must be a number from 0 to 1');
    const f = section(lights, 'flicker', 'lights.', out);
    if (f) {
      numbers('lights.flicker', f, ['base', 'wobbleSlow', 'rateSlow', 'wobbleFast', 'rateFast', 'dropEvery', 'dropBelow', 'dropTo'], out);
      if (isNum(f.dropEvery) && (!Number.isInteger(f.dropEvery) || f.dropEvery < 1)) out.push('lights.flicker.dropEvery: must be a whole number, 1 or more');
      if (isNum(f.dropBelow) && (!Number.isInteger(f.dropBelow) || f.dropBelow < 0)) out.push('lights.flicker.dropBelow: must be a whole number, 0 or more');
      if (isNum(f.dropEvery) && isNum(f.dropBelow) && f.dropBelow > f.dropEvery) out.push('lights.flicker.dropBelow: must not be above dropEvery');
      if (isNum(f.dropTo) && (f.dropTo < 0 || f.dropTo > 1)) out.push('lights.flicker.dropTo: must be from 0 to 1');
      if (isNum(f.base) && isNum(f.wobbleSlow) && isNum(f.wobbleFast) && f.base - Math.abs(f.wobbleSlow) - Math.abs(f.wobbleFast) < 0) out.push('lights.flicker: base minus both wobbles must not go below 0');
    }
  }
  return out;
}

const hex = (c: string): number => Number.parseInt(c.slice(1), 16);

/** The typed look. Throws with the whole list of problems when the data is bad. */
export function loadFieldLook(data: unknown): FieldLook {
  const problems = checkFieldLook(data);
  if (problems.length) throw new Error(`fieldlook.json is not valid:\n- ${problems.join('\n- ')}`);
  // checkFieldLook proved the shape, so this cast is the one place loose JSON types become the real ones.
  const d = data as Omit<FieldLook, 'shadow' | 'chest'> & {
    shadow: Omit<FieldLook['shadow'], 'color'> & { color: string };
    chest: Omit<FieldLook['chest'], 'glint'> & { glint: Omit<FieldLook['chest']['glint'], 'color'> & { color: string } };
  };
  return {
    ...d,
    shadow: { ...d.shadow, color: hex(d.shadow.color) },
    chest: { ...d.chest, glint: { ...d.chest.glint, color: hex(d.chest.glint.color) } },
  };
}

/** The shipped look. */
export const FIELD_LOOK: FieldLook = loadFieldLook(raw);
