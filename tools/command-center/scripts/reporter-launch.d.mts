// Types for scripts/reporter-launch.mjs (a plain JavaScript file, so that `node` runs it with no build and no installed package).
export const REPORTER_PORT: number;
export const STATE_DIR: string;
export const LOCK_STALE_MS: number;
export const LOCK_TOUCH_MS: number;
export const FETCH_EVERY_MS: number;
export const EXIT: { idle: 0; public: 3; notConfigured: 4 };
export function findCheckout(start: string, exists?: (path: string) => boolean): string | null;
export function mainCheckout(dir: string, git?: (args: string[], cwd: string) => { status: number | null; stdout: string }): string;
export type LockDeps = {
  now: () => number;
  portInUse: () => Promise<boolean>;
  read: () => { text: string; mtimeMs: number } | null;
  create: (text: string) => boolean;
  remove: () => void;
};
export function acquireLock(deps: LockDeps, text: string): Promise<'acquired' | 'held'>;
export function fileLock(file: string): {
  read: LockDeps['read'];
  create: LockDeps['create'];
  remove: LockDeps['remove'];
  touch: (text: string) => void;
};
export function portInUse(port: number, host?: string): Promise<boolean>;
export function reporterConfig(original: Record<string, unknown>, checkout: string, port?: number): Record<string, unknown>;
export function pathsFor(checkout: string): { state: string; lock: string; log: string; config: string; pinned: string; app: string };
export function runLauncher(options: { checkout: string; branch?: string; origin?: string }): Promise<number>;
export function stopReporter(checkout: string): string;
