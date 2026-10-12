// Types for scripts/build-functions.mjs (a plain JavaScript file, so that the Vercel build can run it with `node` and no extra step).
export const FUNCTIONS: { name: string; source: string }[];
export function buildFunctions(options?: { outDir?: string }): Promise<{ file: string; name: string; bytes: number }[]>;
