/**
 * Two small guards the engine uses instead of non-null assertions (`!`), which the linter forbids
 * under `src/sje`. They fail loudly and say what was wrong.
 */

/** A lookup that cannot be missing: returns the value, or throws naming what was missing. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${what}`);
  return value;
}

/** Throws when a rule is broken. TypeScript then knows `condition` is true after the call. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
