/**
 * The page's `?seed=N`, read in one place (the engine's FX seed in `boot.ts` and the hack cover's noise in `hack3d/jack.ts` both use it, so one URL gives one number).
 * DEV builds only: a shipped game has no page seed.
 */

/** One reading of a `seed` value: a finite number, else undefined. A missing, empty or blank value is "no seed" (never 0), and so is NaN or Infinity. */
export function parseSeed(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** The page's seed, or undefined (always undefined in a shipped build). */
export function pageSeed(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  return parseSeed(new URLSearchParams(location.search).get('seed'));
}
