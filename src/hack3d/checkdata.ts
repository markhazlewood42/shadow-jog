/**
 * The checks of `src/data/hacks.json` (decision E3's condition; M7 pass line 3): `checkHacks` for the whole file, `checkTransition` for its `transition` block. Pure: shapes and limits,
 * nothing that needs a browser. A bad file is a mistake of the author, so the loader (`data.ts`) runs the check in a DEV build and the tests run it on the file and on bad copies;
 * a shipped build holds none of these functions (this file is reached only behind `import.meta.env.DEV`, so the bundler drops it from the start path).
 */
import type { HackPolicy } from './result';
import { checkUniformRanges, JACK_LEVELS, JACK_STYLES, type TransitionParams } from './transition';

const DEF_KEYS = ['id', 'seed', 'ticks', 'iceCount', 'traceLimit', 'hitCost', 'policy'] as const;
const ID = /^[a-z][a-z0-9_-]*$/;
const ABORTED: readonly HackPolicy['aborted'][] = ['retry-then-succeed', 'succeed', 'fail'];
const UNSUPPORTED: readonly HackPolicy['unsupported'][] = ['alternative', 'succeed', 'fail'];

const TRANSITION_NUMBERS = ['outTicks', 'inTicks', 'swapMinTicks', 'holdBoundMs', 'holdCover', 'dissolveHold', 'block', 'lineHeight', 'cursorPeriod'] as const;
/** Upper bounds of the `transition` numbers: about 10 times the shipped values (out and in 60 ticks, swap 2, hold bound 10 s). A bound catches a typo, it is not a design limit. */
const MAX_PHASE_TICKS = 600;
const MAX_SWAP_TICKS = 120;
const MAX_HOLD_BOUND_MS = 60000;
const RANGE_PHASES = ['out', 'swap', 'in'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/**
 * The problems of a hacks file, as sentences (an empty list means the file is good). Rejects a value that JSON cannot hold (a function, NaN,
 * Infinity), a wrong type, a count the simulation would clamp, an unknown key and a repeated id.
 */
export function checkHacks(file: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(file)) return ['the file must be an object with a "hacks" list'];
  for (const key of Object.keys(file)) if (key !== 'hacks' && key !== 'transition' && key !== 'uniform') problems.push(`unknown key "${key}" at the top of the file`);
  problems.push(...checkTransition(file.transition), ...checkUniform(file.uniform, file.transition));
  const list = file.hacks;
  if (!Array.isArray(list)) return [...problems, '"hacks" must be a list'];
  const seen = new Set<string>();
  list.forEach((def, i) => {
    const at = isObj(def) && typeof def.id === 'string' ? `hack "${def.id}"` : `hacks[${i}]`;
    if (!isObj(def)) {
      problems.push(`${at} must be an object`);
      return;
    }
    for (const key of Object.keys(def)) if (!(DEF_KEYS as readonly string[]).includes(key)) problems.push(`${at}: unknown key "${key}"`);
    if (typeof def.id !== 'string' || !ID.test(def.id)) problems.push(`${at}: id must be lowercase letters, digits, "-" or "_", starting with a letter`);
    else if (seen.has(def.id)) problems.push(`${at}: duplicate id`);
    else seen.add(def.id);
    if (!isInt(def.seed) || def.seed < 0) problems.push(`${at}: seed must be a whole number, 0 or more`);
    if (!isInt(def.ticks) || def.ticks < 1) problems.push(`${at}: ticks must be a whole number, 1 or more`);
    if (!isInt(def.iceCount) || def.iceCount < 1 || def.iceCount > 5) problems.push(`${at}: iceCount must be a whole number from 1 to 5`);
    if (!isNum(def.traceLimit) || def.traceLimit <= 0) problems.push(`${at}: traceLimit must be a number above 0 (a limit above 100 never fails)`);
    if (!isNum(def.hitCost) || def.hitCost < 0) problems.push(`${at}: hitCost must be a number, 0 or more`);
    if (def.policy !== undefined) {
      const p = def.policy;
      if (!isObj(p) || !ABORTED.includes(p.aborted as HackPolicy['aborted']) || !UNSUPPORTED.includes(p.unsupported as HackPolicy['unsupported'])) {
        problems.push(`${at}: policy needs "aborted" (${ABORTED.join(', ')}) and "unsupported" (${UNSUPPORTED.join(', ')})`);
      } else {
        for (const key of Object.keys(p)) if (key !== 'aborted' && key !== 'unsupported') problems.push(`${at}: policy has an unknown key "${key}"`);
      }
    }
  });
  return problems;
}

/** The problems of the `transition` block: its numbers, and the declared uniform ranges of every style and level (the rules of pass line 19 are `checkUniformRanges`). */
export function checkTransition(t: unknown): string[] {
  if (!isObj(t)) return ['"transition" must be an object'];
  const out: string[] = [];
  for (const key of Object.keys(t)) if (!(TRANSITION_NUMBERS as readonly string[]).includes(key)) out.push(`transition: unknown key "${key}"`);
  for (const key of TRANSITION_NUMBERS) {
    const v = t[key];
    if (!isNum(v) || v < 0) out.push(`transition: ${key} must be a number, 0 or more`);
  }
  for (const key of ['outTicks', 'inTicks', 'swapMinTicks', 'cursorPeriod', 'block', 'lineHeight'] as const) if (!isInt(t[key]) || (t[key] as number) < 1) out.push(`transition: ${key} must be a whole number, 1 or more`);
  for (const key of ['holdCover', 'dissolveHold'] as const) if (isNum(t[key]) && (t[key] as number) > 1) out.push(`transition: ${key} must be at most 1`);
  if (isNum(t.holdBoundMs) && t.holdBoundMs < 1) out.push('transition: holdBoundMs must be at least 1');
  // Upper bounds: a typo must not make a transition that never ends. The wall-clock bound of the hold is what stops a player waiting for ever on a chunk that never loads.
  const caps = { outTicks: MAX_PHASE_TICKS, inTicks: MAX_PHASE_TICKS, swapMinTicks: MAX_SWAP_TICKS, holdBoundMs: MAX_HOLD_BOUND_MS } as const;
  for (const key of Object.keys(caps) as Array<keyof typeof caps>) {
    const v = t[key];
    if (isNum(v) && v > caps[key]) out.push(`transition: ${key} must be at most ${caps[key]}`);
  }
  // A cover of 0 at the hold shows an unchanged picture, which pass line 20 forbids.
  if (isNum(t.holdCover) && t.holdCover <= 0) out.push('transition: holdCover must be above 0 (pass line 20: the hold must show a moving cover)');
  return out;
}

/** The problems of the `uniform` block: a list of ranges for every style and level, and each style's ranges against the rules of pass line 19 (`checkUniformRanges`), for the numbers of `transition`. */
export function checkUniform(uniform: unknown, transition: unknown): string[] {
  if (!isObj(uniform)) return ['"uniform" must be an object with a list for each style and level'];
  const out: string[] = [];
  const t = isObj(transition) ? transition : {};
  for (const style of JACK_STYLES) {
    const byLevel = uniform[style];
    if (!isObj(byLevel)) {
      out.push(`uniform: no entry for style "${style}"`);
      continue;
    }
    for (const level of JACK_LEVELS) {
      const list = byLevel[level];
      const at = `uniform.${style}.${level}`;
      if (!Array.isArray(list)) {
        out.push(`${at}: must be a list of ranges`);
        continue;
      }
      let shapes = true;
      for (const r of list) {
        if (!isObj(r) || !RANGE_PHASES.includes(r.phase as string) || !isInt(r.from) || !(r.to === null || isInt(r.to)) || typeof r.reason !== 'string') {
          out.push(`${at}: each range needs phase (out, swap, in), from, to (a number or null) and a reason`);
          shapes = false;
        }
      }
      if (shapes && isInt(t.outTicks) && isInt(t.inTicks) && isInt(t.swapMinTicks)) {
        out.push(...checkUniformRanges(t as unknown as TransitionParams, list as never).map((m) => `${at}: ${m}`));
      }
    }
  }
  return out;
}
