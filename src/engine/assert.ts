/**
 * The one sanctioned way to say "this can't be missing": a lookup that fails loudly, naming what
 * was missing, instead of a bare `!` that throws "Cannot read properties of undefined" somewhere
 * later. The engine and battle modules use this (or a guard) instead of non-null assertions, and
 * the linter holds them to it (biome.json).
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${what}`);
  return value;
}
