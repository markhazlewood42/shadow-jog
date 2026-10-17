// The proxy renderer (plan stage S2). Orthographic, top-down three-quarter camera, any yaw, any pose, native 32x32, no resample.
// One ray per cell through the cell centre. A cell gets the nearest primitive hit: part id, light level, depth, surface point, normal.
// Deterministic: no random numbers, no clock, no state between calls.
//
//   const t = renderTemplate(spec, { facing: 'se' });          // or { yaw: 45 }, plus { pose: { armL: [20, 0, 0] } }
//   t.id[i]      part id (spec.parts key) or null           t.label[i]   part-map label or null
//   t.level[i]   -1 none, 0 shadow, 1 base, 2 lit           t.outline[i] 0 none, 1 silhouette edge, 2 interior line
//   t.depth[i]   distance along the view ray (larger = farther)   t.point[i] world surface point   t.normal[i] world normal
//   t.joints     world transforms of the joints (used by the reprojection)
import { SIZE, facingName, facingYaw, resolveSpec, stylePose } from './spec.mjs';
import { add, apply, compose, dot, eulerMat, matMul, matT, matVec, mul, norm, rotY, sub } from './math.mjs';

const rad = (d) => (d * Math.PI) / 180;

/** Camera vectors. D = view ray direction, U = screen-up in world space, V = direction to the viewer. */
export function cameraBasis(spec) {
  const p = rad(spec.camera.pitchDeg);
  return { D: [0, -Math.sin(p), -Math.cos(p)], U: [0, Math.cos(p), -Math.sin(p)], V: [0, Math.sin(p), Math.cos(p)] };
}
/** World point -> screen position in pixel edge coordinates, plus its depth along the view ray. */
export function project(spec, P) {
  const { D, U } = cameraBasis(spec);
  const [ox, oy] = spec.camera.origin;
  const s = spec.camera.scale;
  return { x: ox + s * P[0], y: oy - s * dot(P, U), depth: dot(P, D) };
}

/** World transform of every joint: the figure turned by yaw about Y at the origin, then the joint chain with rest rot + pose rot. */
export function jointTransforms(raw, yaw, pose = {}) {
  const spec = resolveSpec(raw);
  const out = {};
  const walk = (name) => {
    if (out[name]) return out[name];
    const j = spec.joints[name];
    const rot = [0, 1, 2].map((i) => (j.rot[i] ?? 0) + (pose[name]?.[i] ?? 0));
    const local = { R: eulerMat(rot), t: j.offset };
    const base = j.parent === null ? { R: rotY(yaw), t: [0, 0, 0] } : walk(j.parent);
    out[name] = compose(base, local);
    return out[name];
  };
  for (const n of Object.keys(spec.joints)) walk(n);
  return out;
}

/** Primitives of every part in world space. */
export function buildSolids(raw, joints) {
  const spec = resolveSpec(raw);
  return Object.entries(spec.parts).map(([id, part], idx) => {
    const jw = joints[part.joint];
    const pr = part.prim;
    if (pr.type === 'ellipsoid' || pr.type === 'box') {
      const R = matMul(jw.R, eulerMat(pr.rot ?? [0, 0, 0]));
      return { id, idx, type: pr.type, c: apply(jw, pr.at), R, Rt: matT(R), size: pr.size, bias: part.bias ?? 0 };
    }
    return { id, idx, type: pr.type, a: apply(jw, pr.a), b: apply(jw, pr.b), r: pr.r, bias: part.bias ?? 0 };
  });
}

/** World position of a point given relative to a part: primitive centre (ellipsoid, box) or point a (capsule, cylinder), in the part's own frame. */
export function partPoint(raw, joints, id, at) {
  const spec = resolveSpec(raw);
  const part = spec.parts[id];
  const jw = joints[part.joint];
  const pr = part.prim;
  if (pr.type === 'ellipsoid' || pr.type === 'box') {
    const R = matMul(jw.R, eulerMat(pr.rot ?? [0, 0, 0]));
    return add(apply(jw, pr.at), matVec(R, at));
  }
  return add(apply(jw, pr.a), matVec(jw.R, at));
}

const EPS = 1e-9;
function hitSphere(O, D, c, r) {
  const oc = sub(O, c);
  const b = dot(oc, D);
  const cc = dot(oc, oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return { t, n: norm(sub(add(O, mul(D, t)), c)) };
}
function hitEllipsoid(O, D, s) {
  const o = matVec(s.Rt, sub(O, s.c));
  const d = matVec(s.Rt, D);
  const [rx, ry, rz] = s.size;
  const oo = [o[0] / rx, o[1] / ry, o[2] / rz];
  const dd = [d[0] / rx, d[1] / ry, d[2] / rz];
  const a = dot(dd, dd);
  const b = dot(oo, dd);
  const c = dot(oo, oo) - 1;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  return { t, n: norm(matVec(s.R, [p[0] / (rx * rx), p[1] / (ry * ry), p[2] / (rz * rz)])) };
}
function hitBox(O, D, s) {
  const o = matVec(s.Rt, sub(O, s.c));
  const d = matVec(s.Rt, D);
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    const h = s.size[i];
    if (Math.abs(d[i]) < EPS) {
      if (o[i] < -h || o[i] > h) return null;
      continue;
    }
    let t1 = (-h - o[i]) / d[i];
    let t2 = (h - o[i]) / d[i];
    let sg = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null;
  const nl = [0, 0, 0];
  nl[axis] = sign;
  return { t: tmin, n: norm(matVec(s.R, nl)) };
}
function hitCapsule(O, D, s, capped) {
  const ab = sub(s.b, s.a);
  const L = Math.sqrt(dot(ab, ab));
  const v = mul(ab, 1 / L);
  const oa = sub(O, s.a);
  const p = sub(oa, mul(v, dot(oa, v)));
  const q = sub(D, mul(v, dot(D, v)));
  let best = null;
  const take = (h) => { if (h && (!best || h.t < best.t)) best = h; };
  const A = dot(q, q);
  if (A > EPS) {
    const B = dot(p, q);
    const C = dot(p, p) - s.r * s.r;
    const disc = B * B - A * C;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / A;
      const P = add(O, mul(D, t));
      const along = dot(sub(P, s.a), v);
      if (along >= 0 && along <= L) take({ t, n: norm(sub(sub(P, s.a), mul(v, along))) });
    }
  }
  if (capped) {
    for (const [c, n] of [[s.a, mul(v, -1)], [s.b, v]]) {
      const dn = dot(D, n);
      if (Math.abs(dn) < EPS) continue;
      const t = dot(sub(c, O), n) / dn;
      const P = add(O, mul(D, t));
      const rr = sub(P, c);
      if (dot(rr, rr) <= s.r * s.r) take({ t, n });
    }
  } else {
    for (const [c, side] of [[s.a, -1], [s.b, 1]]) {
      const h = hitSphere(O, D, c, s.r);
      if (!h) continue;
      const along = dot(sub(add(O, mul(D, h.t)), s.a), v);
      if (side < 0 ? along <= 0 : along >= L) take(h);
    }
  }
  return best;
}
const hit = (O, D, s) =>
  s.type === 'ellipsoid' ? hitEllipsoid(O, D, s) : s.type === 'box' ? hitBox(O, D, s) : hitCapsule(O, D, s, s.type === 'cylinder');

/** Render one template. opts: { facing | yaw, pose }. */
export function renderTemplate(raw, opts = {}) {
  const spec = resolveSpec(raw);
  const yaw = opts.yaw ?? facingYaw(spec, opts.facing ?? spec.givenFacing);
  const facing = opts.facing ?? facingName(spec, yaw) ?? `yaw${yaw}`;
  const style = stylePose(spec, facing);
  const pose = { ...style };
  for (const [j, r] of Object.entries(opts.pose ?? {})) pose[j] = style[j] ? [0, 1, 2].map((i) => style[j][i] + (r[i] ?? 0)) : r;
  const joints = jointTransforms(spec, yaw, pose);
  const solids = buildSolids(spec, joints);
  const ids = Object.keys(spec.parts);
  const { D, U } = cameraBasis(spec);
  const L = norm(spec.light.vector);
  const [t1, t2] = spec.light.levels;
  const [ox, oy] = spec.camera.origin;
  const sc = spec.camera.scale;
  const N = SIZE * SIZE;
  const t = {
    w: SIZE, h: SIZE, facing, yaw, pose, joints,
    id: Array(N).fill(null), label: Array(N).fill(null), level: new Int8Array(N).fill(-1), outline: new Uint8Array(N),
    depth: new Float64Array(N).fill(Number.POSITIVE_INFINITY), point: Array(N).fill(null), normal: Array(N).fill(null),
  };
  for (let j = 0; j < SIZE; j++)
    for (let i = 0; i < SIZE; i++) {
      const X = (i + 0.5 - ox) / sc;
      const up = -(j + 0.5 - oy) / sc;
      const O = sub(add([X, 0, 0], mul(U, up)), mul(D, 200));
      let best = null;
      let bs = null;
      for (const s of solids) {
        const h = hit(O, D, s);
        if (h && h.t > 0 && (!best || h.t < best.t - 1e-7)) { best = h; bs = s; }
      }
      if (!best) continue;
      const k = j * SIZE + i;
      const P = add(O, mul(D, best.t));
      const nl = dot(best.n, L) + bs.bias;
      t.id[k] = bs.id;
      t.label[k] = spec.parts[bs.id].label;
      t.level[k] = nl < t1 ? 0 : nl < t2 ? 1 : 2;
      t.depth[k] = dot(P, D);
      t.point[k] = P;
      t.normal[k] = best.n;
    }
  // outline map: silhouette edge cells, then interior lines on a cell that sits more than depthJump behind a neighbor
  const jump = spec.outline?.depthJump ?? 0;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && t.id[y * SIZE + x] !== null;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (!opaque(x, y)) continue;
      const k = y * SIZE + x;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      if (nb.some(([dx, dy]) => !opaque(x + dx, y + dy))) t.outline[k] = 1;
      else if (jump > 0 && nb.some(([dx, dy]) => (t.depth[(y + dy) * SIZE + x + dx] ?? Infinity) < t.depth[k] - jump)) t.outline[k] = 2;
    }
  return t;
}

export const cellOf = (t, x, y) => y * t.w + x;
export const isOpaqueAt = (t, x, y) => x >= 0 && y >= 0 && x < t.w && y < t.h && t.id[y * t.w + x] !== null;
export const opaqueCount = (t) => t.id.filter((v) => v !== null).length;

/**
 * Mirror a per-cell array of a 32x32 template left to right about the figure axis: x <-> axisSum - x (35 for an axis at x = 18).
 * axisSum has no default: take it from the spec with axisSumOf(spec). A default here would be a character constant in code (the 6a fault).
 */
export function mirrorCells(arr, axisSum) {
  if (!Number.isFinite(axisSum)) throw new Error('mirrorCells needs the axis sum of the spec: axisSumOf(spec)');
  const out = Array.isArray(arr) ? Array(arr.length) : new arr.constructor(arr.length);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const mx = axisSum - x;
      out[y * SIZE + x] = mx >= 0 && mx < SIZE ? arr[y * SIZE + mx] : Array.isArray(arr) ? null : 0;
    }
  return out;
}
/** The mirror sum of a spec: 2 * origin x - 1. */
export const axisSumOf = (spec) => Math.round(2 * spec.camera.origin[0] - 1);

/**
 * Guide rows from a per-cell label list (a template's t.label, or a part map turned into labels). Rows are cell rows.
 *   head     top row of the head parts (hair skin lenses beard)       eye   first and last row of the lenses (null = no face)
 *   shoulder top row of the sleeves, else of the coat                  hip   top row of the legs      hem   bottom row of the coat
 *   foot     bottom row of the boots
 */
export function guideRows(labels, w = SIZE) {
  const rows = (names) => {
    const ys = [];
    labels.forEach((l, i) => { if (l && names.includes(l)) ys.push(Math.floor(i / w)); });
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
  };
  const head = rows(['hair', 'skin', 'lenses', 'beard']);
  const eye = rows(['lenses']);
  const sleeves = rows(['sleeves']) ?? rows(['coat']);
  const legs = rows(['legs']);
  const coat = rows(['coat']);
  const boots = rows(['boots']);
  return {
    head: head?.[0] ?? null, eye: eye ? eye[0] : null, eyeLast: eye ? eye[1] : null,
    shoulder: sleeves?.[0] ?? null, hip: legs?.[0] ?? null, hem: coat?.[1] ?? null, foot: boots?.[1] ?? null,
  };
}
