/** Deterministic RNG (mulberry32) plus stateless hash noise for procedural art. */
import { must } from './assert';

export class Rng {
  private s: number;
  constructor(seed = 0x5eed) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return must(arr[Math.floor(this.next() * arr.length)], 'a choice (Rng.pick from an empty list)');
  }
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
}

/** Stateless 2D integer hash → [0, 1). Stable across runs; used for tile variation. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, octaves = 3, seed = 0): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

const seed = (Date.now() ^ 0x9e3779b9) >>> 0;

/**
 * Gameplay randomness, one stream per concern, so adding a roll to one system never shifts what
 * the other rolls next. Seeded per session; save files store both states.
 */
export const streams = {
  /** Random-encounter checks while walking. */
  encounter: new Rng(seed),
  /** Battle seeds and which group a random encounter draws. */
  battle: new Rng((seed ^ 0x5bd1e995) >>> 0 || 1),
};
