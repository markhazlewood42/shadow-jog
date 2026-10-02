/**
 * The shape of public/art/rig/skeleton.json, checked: what the animation editor's save endpoint
 * (vite.config.ts `rigEdit`, dev only) writes only if it passes. A malformed file breaks every
 * battle back the game draws from it, so the whole structure is checked, not just its top level
 * (Copilot review of main, 2026-10-02). It mirrors the types in battle.ts (BattleRig, ArmRig,
 * ArmPose); it imports nothing, so the dev server can load it on its own.
 */

/** The key poses a skeleton can have (battle.ts `KEY_POSES`; a test keeps the two the same). */
export const POSE_KEYS = ['brace', 'windup', 'strike', 'raise', 'victory'] as const;

type Obj = Record<string, unknown>;
const plain = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nums = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(num);
const colour = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Problems with posted skeletons, in plain words, or none: an object of crew members, each with an
 * arm, poses, a light colour and the optional parts battle.ts reads.
 */
export function checkSkeletons(data: unknown): string[] {
  const out: string[] = [];
  if (!plain(data)) return ['expected an object of skeletons'];
  if (!Object.keys(data).length) return ['no skeletons'];
  // Each field: present when required, the right kind when present, and nothing unknown. Its own
  // problems are recorded as it goes; it answers true, so a nested object isn't also "not valid".
  const fields = (o: Obj, at: string, spec: Record<string, [boolean, (v: unknown, at: string) => boolean]>): true => {
    for (const k of Object.keys(o)) if (!(k in spec)) out.push(`${at}.${k} is not a field`);
    for (const [k, [required, ok]] of Object.entries(spec)) {
      if (o[k] === undefined) {
        if (required) out.push(`${at}.${k} is missing`);
      } else if (!ok(o[k], `${at}.${k}`)) out.push(`${at}.${k} is not valid`);
    }
    return true;
  };
  const pt = (v: unknown) => nums(v, 2);
  const box = (v: unknown) => nums(v, 4);
  const bool = (v: unknown) => typeof v === 'boolean';
  const oneOf = (...xs: string[]) => (v: unknown) => typeof v === 'string' && xs.includes(v);
  const hand = (v: unknown, at: string) => {
    if (!plain(v)) return false;
    return fields(v, at, {
      rows: [true, (r) => Array.isArray(r) && r.length > 0 && r.every((s) => typeof s === 'string')],
      colors: [true, (c) => plain(c) && Object.values(c).every(colour)],
      pivot: [true, pt],
    });
  };
  const arm = (v: unknown, at: string) => {
    if (!plain(v)) return false;
    return fields(v, at, {
      shoulder: [true, pt],
      elbow: [true, pt],
      wrist: [true, pt],
      box: [true, box],
      more: [false, (m) => Array.isArray(m) && m.every(box)],
      keep: [true, (k) => Array.isArray(k) && k.every(pt)],
      reach: [true, pt],
      hand: [true, box],
      sleeve: [true, colour],
      width: [true, num],
      fill: [false, box],
      clear: [false, bool],
      drawnFrom: [false, num],
      fist: [false, hand],
      open: [false, hand],
      side: [false, box],
      fore: [false, colour],
      foreWidth: [false, num],
      shoulderWidth: [false, num],
      outline: [false, bool],
    });
  };
  const pose = (v: unknown, at: string) => {
    if (!plain(v)) return false;
    return fields(v, at, {
      hand: [true, pt],
      flip: [false, bool],
      grip: [false, num],
      weapon: [false, (w, wat) => (plain(w) ? fields(w, wat, { kind: [true, oneOf('katana', 'pistol')], angle: [true, num] }) : false)],
      light: [false, oneOf('spark', 'impact', 'shot')],
      lightAt: [false, oneOf('hand', 'tip', 'top')],
      arc: [false, (a, aat) => (plain(a) ? fields(a, aat, { from: [true, pt], bend: [true, pt] }) : false)],
      shape: [false, oneOf('fist', 'open')],
      depth: [false, num],
      behind: [false, bool],
      both: [false, bool],
      freeFlip: [false, bool],
      freeBehind: [false, bool],
      length: [false, (n) => num(n) && n > 0],
      lean: [false, num],
      drop: [false, num],
      feet: [false, (f, fat) => (plain(f) ? fields(f, fat, { left: [false, pt], right: [false, pt] }) : false)],
      coat: [false, (c, cat) => (plain(c) ? fields(c, cat, { flare: [false, pt], split: [false, num] }) : false)],
    });
  };
  for (const [id, r] of Object.entries(data)) {
    if (!plain(r)) {
      out.push(`${id} is not an object`);
      continue;
    }
    fields(r, id, {
      arm: [true, arm],
      free: [false, (f, at) => (plain(f) ? fields(f, at, { arm: [true, arm], pose: [true, pose] }) : false)],
      stance: [
        false,
        (s, at) =>
          plain(s)
            ? fields(s, at, { legs: [true, num], sink: [true, num], spread: [true, num], stagger: [false, num], hip: [false, pt], neck: [false, pt], waist: [false, num] })
            : false,
      ],
      hide: [false, (h, at) => (plain(h) ? fields(h, at, { box: [true, box], keep: [true, (k) => Array.isArray(k) && k.every(pt)] }) : false)],
      light: [true, colour],
      aim: [false, oneOf('strike', 'raise')],
      poses: [true, (p, at) => (plain(p) ? fields(p, at, Object.fromEntries(POSE_KEYS.map((k) => [k, [false, pose]]))) : false)],
      notes: [false, (n) => plain(n) && Object.entries(n).every(([k, t]) => (POSE_KEYS as readonly string[]).includes(k) && typeof t === 'string')],
    });
  }
  return out;
}
