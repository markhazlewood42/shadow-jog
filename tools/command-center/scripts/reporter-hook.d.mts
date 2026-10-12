// Types for scripts/reporter-hook.mjs (a plain JavaScript file, so that Claude Code can run it with `node` and no build).
export const BUDGET_MS: number;
export function startReporter(input: {
  cwd: string | undefined;
  launcher: string;
  exists?: (path: string) => boolean;
  start: (launcher: string, checkout: string) => void;
}): 'started' | 'not-shadow-jog' | 'no-launcher';
