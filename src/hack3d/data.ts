/**
 * The hack definitions as data (decision E3's condition; editor contract items a and b of docs/engine/m7-brief.md section 6).
 *
 * `src/data/hacks.json` holds the definitions. This file reads it, checks it (`checkHacks`: the shapes and the limits, nothing that needs a browser),
 * and hands definitions out. A definition is read when a hack starts, so a dev reload picks up an edited file; a running hack does not swap.
 *
 * No Three and no engine here: the shipped game loads this file up front (through `src/game/hackseam.ts`), next to the door.
 */
import raw from '../data/hacks.json';
import type { HackDef, HackPolicy } from './result';

/** The file's shape: a list of definitions. */
export interface HacksFile {
  hacks: HackDef[];
}

const DEF_KEYS = ['id', 'seed', 'ticks', 'iceCount', 'traceLimit', 'hitCost', 'policy'] as const;
const ID = /^[a-z][a-z0-9_-]*$/;
const ABORTED: readonly HackPolicy['aborted'][] = ['retry-then-succeed', 'succeed', 'fail'];
const UNSUPPORTED: readonly HackPolicy['unsupported'][] = ['alternative', 'succeed', 'fail'];

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
  for (const key of Object.keys(file)) if (key !== 'hacks') problems.push(`unknown key "${key}" at the top of the file`);
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

const problems = checkHacks(raw);
// A bad file is a build-time mistake: fail loudly where the file is read, not later in the middle of a story.
if (problems.length) throw new Error(`src/data/hacks.json is not valid:\n- ${problems.join('\n- ')}`);

/** The definitions of the file. Read-only: copy before you change one (`hackDef` and `makeHackDef` do). */
export const HACKS: readonly HackDef[] = (raw as unknown as HacksFile).hacks;

/** The definition `makeHackDef` starts from: the first one in the file. */
const BASE: HackDef = (() => {
  const first = HACKS[0];
  if (!first) throw new Error('src/data/hacks.json has no hack');
  return first;
})();

/** A definition: the file's first hack with `partial` laid over it. A copy: the file's data never changes. */
export function makeHackDef(partial: Partial<HackDef> = {}): HackDef {
  return { ...JSON.parse(JSON.stringify(BASE)), ...partial };
}

/** The definition with this id, with `over` laid over it. Throws on an id that is not in the file, naming the ids that are. */
export function hackDef(id: string, over: Partial<HackDef> = {}): HackDef {
  const found = HACKS.find((h) => h.id === id);
  if (!found) throw new Error(`no hack "${id}" in src/data/hacks.json (it has: ${HACKS.map((h) => h.id).join(', ')})`);
  return { ...JSON.parse(JSON.stringify(found)), ...over };
}
