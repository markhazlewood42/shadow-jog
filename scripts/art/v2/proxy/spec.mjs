// character.json: the spec of one character for the proxy renderer (art pipeline v2, plan section 2 and 3, stage S0).
// Structure only. No pixels of any reference. Every character constant (axis, face offset, ramps, light, item side) lives here, not in code.
//
// SCHEMA (all lengths are world units; 1 unit = 1 px at camera scale 1; Y is up, Z points to the camera when the figure faces s)
//   format      "character-proxy/1"
//   name        string
//   size        32                        output cell grid, 32x32, no resample
//   givenFacing one of s se e ne n nw w sw   the facing of the one given frame (Rook: se)
//   diagonalYaw optional, default 45. How far the diagonal facings turn from s or n: se = d, sw = -d, ne = 180 - d, nw = 180 + d. A 3/4 sprite is often drawn
//               at a weaker angle than 45; the fit may set this one number.
//   diagonalHeadTurn optional, default 0, degrees. On the four diagonal facings the head is turned toward the viewer by this much compared with the body
//               (se and ne: head yaw - d, sw and nw: head yaw + d). Chibi sprites often show the face turned toward the camera more than the body.
//   camera      { pitchDeg, scale, origin: [x, y] }
//                 pitchDeg  camera elevation above the horizon: 0 = side view, 90 = straight down
//                 scale     pixels per unit
//                 origin    screen position (pixel edge coordinates) of the world origin (the ground point between the feet)
//   light       { vector: [x, y, z], levels: [t1, t2] }
//                 vector    direction TO the light in world space, fixed to the camera (one light for the whole set)
//                 levels    n.l below t1 = shadow, below t2 = base, else lit (3 levels)
//   outline     { depthJump }             interior line on a cell whose depth is more than depthJump behind a 4-neighbor (0 = off)
//   joints      { <name>: { parent: <name>|null, offset: [x,y,z], rot: [rx,ry,rz], mirrorOf? } }   exactly one root (parent null).
//                 mirrorOf  another joint name: offset and rot are derived from it (x negated, ry and rz negated). Use it for left and right so the figure stays symmetric.
//                 rot in degrees: roll z, then pitch x, then yaw y. A pose adds to rot. +rx swings a hanging limb toward -Z (back).
//   parts       { <id>: { label, joint, prim, ramp, bias, mirrorOf?, center? } }     one primitive per part
//                 mirrorOf  another part id: prim is derived from it (x negated in the joint space). Write no prim then.
//                 center    true = the part sits on the figure axis (x = 0 in joint space). The fit never moves it sideways.
//                 label     one of the 13 part-map names of decompose.mjs (hair skin lenses beard coat sleeves zipper hands legs boots sheath guard wrap).
//                           Several ids may share one label (two lenses, two arms).
//                 joint     the joint the part follows
//                 prim      ellipsoid { type, at, size: [rx,ry,rz], rot? }
//                           box       { type, at, size: [hx,hy,hz], rot? }          (half extents)
//                           capsule   { type, a, b, r }                              (a, b are end points in joint space)
//                           cylinder  { type, a, b, r }                              (flat caps)
//                 ramp      { shadow, base, lit, outline }   strings of palette letters a to v, taken from the given. Level T allows these.
//                 bias      added to n.l for this part (fabric: a negative bias removes the highlight). Optional, default 0.
//   items       { <name>: { parts: [<id>], side: "-x" | "+x" } }    carried items. side is the side of the body, seen from the figure facing s
//                 (-x is the left of the picture at s). The renderer draws the item where the geometry puts it, so each facing shows it on the right side.
//   face        { joint, at: [x,y,z] }   the front-center point of the face (the face axis) and the joint it follows. "No face" when it points away.
//   landmarks   { <name>: { part, at: [x,y,z], given: [x, y] } }
//                 part      the part id the 3D point is anchored to; at is relative to that part's primitive centre (or to point a for capsules)
//                 given     where this feature sits in the given frame, in cell coordinates (a cell centre is x + 0.5 in edge coordinates)
//   folds       [ { part, from: [x,y,z], to: [x,y,z] } ]   a fold stroke from a support point toward the pull, in joint space of the part. At most 2 per part.
//
// Facings (yaw of the figure about Y, degrees): s 0, se 45, e 90, ne 135, n 180, nw 225, w 270, sw 315.
// Forward at yaw t is (sin t, 0, cos t). The camera looks from the south (+Z) and from above.
import { readFileSync } from 'node:fs';
import { PART_NAMES } from '../../pipeline/decompose.mjs';
import { LETTERS } from '../../headtest/lib.mjs';

export const FORMAT = 'character-proxy/1';
export const SIZE = 32;
export const FACING_YAW = { s: 0, se: 45, e: 90, ne: 135, n: 180, nw: 225, w: 270, sw: 315 };
export const FACING_NAMES = Object.keys(FACING_YAW);
export const PRIM_TYPES = ['ellipsoid', 'box', 'capsule', 'cylinder'];
export const LEVELS = ['shadow', 'base', 'lit'];

export class SpecError extends Error {
  constructor(problems) {
    super(`character.json invalid:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n = 3) => Array.isArray(v) && v.length === n && v.every(isNum);

const mirrorPrim = (pr) => {
  if (pr.type === 'ellipsoid' || pr.type === 'box') {
    const o = { ...pr, at: [-pr.at[0], pr.at[1], pr.at[2]] };
    if (pr.rot) o.rot = [pr.rot[0], -pr.rot[1], -pr.rot[2]];
    return o;
  }
  return { ...pr, a: [-pr.a[0], pr.a[1], pr.a[2]], b: [-pr.b[0], pr.b[1], pr.b[2]] };
};
/** The spec with every mirrorOf joint and part filled in. Returns the same object when nothing is mirrored. Does not change its input. */
export function resolveSpec(spec) {
  const js = Object.entries(spec.joints ?? {}).filter(([, j]) => j.mirrorOf);
  const ps = Object.entries(spec.parts ?? {}).filter(([, q]) => q.mirrorOf);
  if (!js.length && !ps.length) return spec;
  const out = { ...spec, joints: { ...spec.joints }, parts: { ...spec.parts } };
  for (const [n, j] of js) {
    const src = spec.joints[j.mirrorOf];
    if (src) out.joints[n] = { ...j, offset: [-src.offset[0], src.offset[1], src.offset[2]], rot: [src.rot[0], -src.rot[1], -src.rot[2]] };
  }
  for (const [id, q] of ps) {
    const src = spec.parts[q.mirrorOf];
    if (src?.prim) out.parts[id] = { ...q, prim: mirrorPrim(src.prim) };
  }
  return out;
}

/** Check a spec. Returns the list of problems (empty = valid). */
export function specProblems(raw) {
  const p = [];
  if (!raw || typeof raw !== 'object') return ['spec is not an object'];
  for (const [n, j] of Object.entries(raw.joints ?? {})) if (j.mirrorOf && (!(j.mirrorOf in raw.joints) || raw.joints[j.mirrorOf].mirrorOf)) p.push(`joint ${n}: mirrorOf must name a joint that is not itself mirrored`);
  for (const [n, q] of Object.entries(raw.parts ?? {})) if (q.mirrorOf && (!(q.mirrorOf in raw.parts) || raw.parts[q.mirrorOf].mirrorOf)) p.push(`part ${n}: mirrorOf must name a part that is not itself mirrored`);
  if (p.length) return p;
  const spec = resolveSpec(raw);
  if (spec.format !== FORMAT) p.push(`format must be "${FORMAT}"`);
  if (typeof spec.name !== 'string' || !spec.name) p.push('name must be a non-empty string');
  if (spec.size !== SIZE) p.push(`size must be ${SIZE}`);
  if (!(spec.givenFacing in FACING_YAW)) p.push(`givenFacing must be one of ${FACING_NAMES.join(' ')}`);
  if (spec.diagonalHeadTurn !== undefined && !(isNum(spec.diagonalHeadTurn) && spec.diagonalHeadTurn >= 0 && spec.diagonalHeadTurn < 60)) p.push('diagonalHeadTurn must be a number from 0 to 60');
  if (spec.diagonalYaw !== undefined && !(isNum(spec.diagonalYaw) && spec.diagonalYaw > 0 && spec.diagonalYaw < 90)) p.push('diagonalYaw must be a number between 0 and 90');
  const cam = spec.camera;
  if (!cam || !isNum(cam.pitchDeg) || cam.pitchDeg <= 0 || cam.pitchDeg > 90) p.push('camera.pitchDeg must be a number in (0, 90]');
  if (!cam || !isNum(cam.scale) || cam.scale <= 0) p.push('camera.scale must be a positive number');
  if (!cam || !isVec(cam.origin, 2)) p.push('camera.origin must be [x, y]');
  const li = spec.light;
  if (!li || !isVec(li.vector) || Math.hypot(...(li.vector ?? [0, 0, 0])) < 1e-6) p.push('light.vector must be a non-zero [x, y, z]');
  if (!li || !isVec(li.levels, 2) || !(li.levels[0] < li.levels[1])) p.push('light.levels must be [t1, t2] with t1 < t2');
  if (spec.outline && !isNum(spec.outline.depthJump)) p.push('outline.depthJump must be a number');

  const joints = spec.joints ?? {};
  const names = Object.keys(joints);
  const roots = Object.values(joints).filter((j) => j.parent === null);
  if (roots.length !== 1) p.push(`joints needs exactly one root (parent null); found ${roots.length}`);
  for (const [n, j] of Object.entries(joints)) {
    if (j.parent !== null && !(j.parent in joints)) p.push(`joint ${n}: parent "${j.parent}" does not exist`);
    if (!isVec(j.offset)) p.push(`joint ${n}: offset must be [x, y, z]`);
    if (!isVec(j.rot)) p.push(`joint ${n}: rot must be [rx, ry, rz]`);
  }
  for (const n of names) {
    let cur = n;
    let steps = 0;
    while (cur !== null && cur !== undefined && steps <= names.length) {
      cur = joints[cur]?.parent;
      steps++;
    }
    if (steps > names.length) p.push(`joint ${n}: parent chain loops`);
  }

  const parts = spec.parts ?? {};
  if (!Object.keys(parts).length) p.push('parts is empty');
  for (const [id, part] of Object.entries(parts)) {
    if (!PART_NAMES.includes(part.label)) p.push(`part ${id}: label "${part.label}" is not one of ${PART_NAMES.join(' ')}`);
    if (!(part.joint in joints)) p.push(`part ${id}: joint "${part.joint}" does not exist`);
    const pr = part.prim;
    if (!pr || !PRIM_TYPES.includes(pr.type)) p.push(`part ${id}: prim.type must be one of ${PRIM_TYPES.join(' ')}`);
    else if (pr.type === 'ellipsoid' || pr.type === 'box') {
      if (!isVec(pr.at)) p.push(`part ${id}: prim.at must be [x, y, z]`);
      if (!isVec(pr.size) || pr.size.some((v) => v <= 0)) p.push(`part ${id}: prim.size must be three positive numbers`);
      if (pr.rot !== undefined && !isVec(pr.rot)) p.push(`part ${id}: prim.rot must be [rx, ry, rz]`);
    } else {
      if (!isVec(pr.a) || !isVec(pr.b)) p.push(`part ${id}: prim.a and prim.b must be [x, y, z]`);
      else if (Math.hypot(pr.a[0] - pr.b[0], pr.a[1] - pr.b[1], pr.a[2] - pr.b[2]) < 1e-6) p.push(`part ${id}: prim.a and prim.b are the same point`);
      if (!isNum(pr.r) || pr.r <= 0) p.push(`part ${id}: prim.r must be positive`);
    }
    const r = part.ramp;
    if (!r) p.push(`part ${id}: ramp missing`);
    else
      for (const k of [...LEVELS, 'outline']) {
        if (typeof r[k] !== 'string') p.push(`part ${id}: ramp.${k} must be a string of letters`);
        else if ([...r[k]].some((c) => !LETTERS.includes(c))) p.push(`part ${id}: ramp.${k} holds a letter outside a to v`);
      }
    if (part.bias !== undefined && !isNum(part.bias)) p.push(`part ${id}: bias must be a number`);
    if (part.center !== undefined && typeof part.center !== 'boolean') p.push(`part ${id}: center must be true or false`);
  }
  for (const [n, it] of Object.entries(spec.items ?? {})) {
    if (!Array.isArray(it.parts) || it.parts.some((id) => !(id in parts))) p.push(`item ${n}: parts must list part ids`);
    if (it.side !== '-x' && it.side !== '+x') p.push(`item ${n}: side must be "-x" or "+x"`);
  }
  if (!spec.face || !(spec.face.joint in joints) || !isVec(spec.face.at)) p.push('face must be { joint, at: [x, y, z] }');
  for (const [n, lm] of Object.entries(spec.landmarks ?? {})) {
    if (!(lm.part in parts)) p.push(`landmark ${n}: part "${lm.part}" does not exist`);
    if (!isVec(lm.at)) p.push(`landmark ${n}: at must be [x, y, z]`);
    if (!isVec(lm.given, 2) || lm.given.some((v) => v < 0 || v > SIZE)) p.push(`landmark ${n}: given must be [x, y] inside the frame`);
  }
  const perPart = {};
  for (const [i, f] of (spec.folds ?? []).entries()) {
    if (!(f.part in parts)) p.push(`fold ${i}: part "${f.part}" does not exist`);
    if (!isVec(f.from) || !isVec(f.to)) p.push(`fold ${i}: from and to must be [x, y, z]`);
    perPart[f.part] = (perPart[f.part] ?? 0) + 1;
    if (perPart[f.part] === 3) p.push(`fold ${i}: more than 2 fold strokes on part "${f.part}"`);
  }
  return p;
}

export function validateSpec(spec) {
  const problems = specProblems(spec);
  if (problems.length) throw new SpecError(problems);
  return spec;
}
export const loadSpec = (path) => validateSpec(JSON.parse(readFileSync(path, 'utf8')));
export const partIds = (spec) => Object.keys(spec.parts);
/** Yaw in degrees of a facing name at the default diagonal angle of 45. */
export const yawOf = (facing) => {
  if (typeof facing === 'number') return facing;
  if (!(facing in FACING_YAW)) throw new Error(`unknown facing ${facing}`);
  return FACING_YAW[facing];
};
/** Yaw in degrees of a facing for this spec: the diagonals use spec.diagonalYaw. */
export function facingYaw(spec, facing) {
  if (typeof facing === 'number') return facing;
  const d = spec.diagonalYaw ?? 45;
  const table = { s: 0, se: d, e: 90, ne: 180 - d, n: 180, nw: 180 + d, w: 270, sw: 360 - d };
  if (!(facing in table)) throw new Error(`unknown facing ${facing}`);
  return table[facing];
}
/** The style pose of a facing: the head turn on the diagonals. Returns { joint: [rx, ry, rz] } (empty when the spec has no head turn or the facing is not a diagonal). */
export function stylePose(spec, facing) {
  const d = spec.diagonalHeadTurn ?? 0;
  if (!d || !spec.joints?.head) return {};
  const sign = { se: -1, ne: -1, sw: 1, nw: 1 }[facing];
  return sign ? { head: [0, sign * d, 0] } : {};
}
/** The facing name of a yaw for this spec, or null. */
export const facingName = (spec, yaw) => FACING_NAMES.find((n) => Math.abs(facingYaw(spec, n) - yaw) < 1e-9) ?? null;

/** The allowed letters of a part id: all ramp letters and the outline letters. */
export function rampLetters(spec, id) {
  const r = spec.parts[id].ramp;
  return new Set([...r.shadow, ...r.base, ...r.lit, ...r.outline]);
}
/** Level of a letter inside one part: 0 shadow, 1 base, 2 lit, or null when the letter is an outline letter or not in the ramp. */
export function levelOfLetter(spec, id, letter) {
  const r = spec.parts[id].ramp;
  if (r.shadow.includes(letter)) return 0;
  if (r.base.includes(letter)) return 1;
  if (r.lit.includes(letter)) return 2;
  return null;
}
export const idsOfLabel = (spec, label) => partIds(spec).filter((id) => spec.parts[id].label === label);

/** Stable JSON: arrays of numbers or strings on one line, 2-space indent. */
export function stringifySpec(spec) {
  const walk = (v, ind) => {
    if (Array.isArray(v) && v.every((x) => typeof x === 'number' || typeof x === 'string')) return JSON.stringify(v);
    const pad = '  '.repeat(ind + 1);
    if (Array.isArray(v)) return `[\n${v.map((x) => `${pad}${walk(x, ind + 1)}`).join(',\n')}\n${'  '.repeat(ind)}]`;
    if (v && typeof v === 'object') {
      const entries = Object.entries(v).map(([k, x]) => `${pad}${JSON.stringify(k)}: ${walk(x, ind + 1)}`);
      return `{\n${entries.join(',\n')}\n${'  '.repeat(ind)}}`;
    }
    return JSON.stringify(v);
  };
  return `${walk(spec, 0)}\n`;
}
