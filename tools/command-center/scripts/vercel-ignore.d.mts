// Types for scripts/vercel-ignore.mjs (a plain JavaScript file, so that Vercel can run it with `node` and no build).
export function decide(input: { branch: string | undefined; changed: boolean | null }): { build: boolean; reason: string };
export function changedFromDiffStatus(status: number | null): boolean | null;
export function exitCodeOf(decision: { build: boolean }): 0 | 1;
