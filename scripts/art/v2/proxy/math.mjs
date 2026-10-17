// Small vector and 3x3 matrix helpers for the proxy renderer. Vectors are [x, y, z]. A matrix is 9 numbers, row-major.
// Pure functions, no state, so every render is deterministic.
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.sqrt(dot(a, a));
export const norm = (a) => {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const matVec = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export const matMul = (a, b) => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};
export const matT = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const rad = (d) => (d * Math.PI) / 180;
export const rotX = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [1, 0, 0, 0, c, -s, 0, s, c]; };
/** Yaw. Local +Z (forward) goes to (sin d, 0, cos d). Local +X goes to (cos d, 0, -sin d). */
export const rotY = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
/** Euler [rx, ry, rz] in degrees: roll (z) first, then pitch (x), then yaw (y). */
export const eulerMat = (e) => matMul(rotY(e[1] ?? 0), matMul(rotX(e[0] ?? 0), rotZ(e[2] ?? 0)));
/** A transform is { R, t }: p -> R p + t. */
export const compose = (p, c) => ({ R: matMul(p.R, c.R), t: add(matVec(p.R, c.t), p.t) });
export const apply = (x, p) => add(matVec(x.R, p), x.t);
export const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
