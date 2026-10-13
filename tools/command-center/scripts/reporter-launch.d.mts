// Types for scripts/reporter-launch.mjs (a plain JavaScript file, so that `node` runs it with no build and no installed package).
export const REPORTER_PORT: number;
export const STATE_DIR: string;
export const LOCK_STALE_MS: number;
export const LOCK_TOUCH_MS: number;
export const FETCH_EVERY_MS: number;
export const NPM_CI_TIMEOUT_MS: number;
export const MAX_RESTARTS: number;
export const CRASH_WINDOW_MS: number;
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
export const READY_MARKER: string;
export const NEEDS_INSTALL_MARKER: string;
export type CommandResult = { status: number | null; stdout: string; stderr: string };
export type GitRunner = (args: string[], cwd: string, timeout?: number) => Promise<CommandResult>;
export type Installer = (cwd: string, log: (message: string) => void) => Promise<boolean>;
export type CopyDeps = { git: GitRunner; install: Installer; log: (message: string) => void };
export function runCommand(command: string, args: string[], options?: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> }): Promise<CommandResult>;
export function runGit(args: string[], cwd: string, timeout?: number): Promise<CommandResult>;
export function npmCi(cwd: string, log: (message: string) => void, options?: { command?: string; args?: string[]; timeoutMs?: number }): Promise<boolean>;
export function lockNamesUs(text: string | null, pid: number, startedIso: string, launcherStart?: string | null): boolean;
export function processInfo(
  pid: number,
  run?: (file: string, args: string[], options: object) => Promise<string | null>,
  platform?: string,
): Promise<{ start: string; command: string } | null>;
export function needsInstall(paths: { pinned: string }): boolean;
export function retryInstall(paths: { pinned: string; app: string }, deps: { install: Installer; log: (message: string) => void }): Promise<'not-needed' | 'installed' | 'failed'>;
export function ensureCopy(paths: { pinned: string; state: string; app: string }, origin: string, branch: string, deps: CopyDeps): Promise<boolean>;
export function updateCopy(paths: { pinned: string; app: string }, branch: string, deps: CopyDeps): Promise<'same' | 'updated' | 'failed'>;
export type ChildLike = { pid?: number; kill(): boolean; once(event: 'exit', listener: (code: number | null) => void): unknown };
export function supervise(
  paths: { app: string; config: string; log: string; pinned: string },
  checkout: string,
  branch: string,
  log: (message: string) => void,
  onServerPid: (pid: number | null) => void,
  deps?: { manual?: boolean; spawnServer?: (paths: unknown) => ChildLike; update?: () => Promise<'same' | 'updated' | 'failed'>; install?: Installer; fetchEveryMs?: number; restartDelayMs?: number; signal?: AbortSignal },
): Promise<number>;
export function runLauncher(options: {
  checkout: string;
  branch?: string;
  origin?: string;
  settingsFile?: string;
  /** True when a person started it (the tray app): the reporter server then has no idle exit. */
  manual?: boolean;
  deps?: { git?: GitRunner; install?: Installer; supervise?: (...args: unknown[]) => Promise<number> };
}): Promise<number>;
export function serverArgs(paths: { config: string }, manual?: boolean): string[];
export const LOCAL_CONFIG: string;
export const BUILD_TIMEOUT_MS: number;
export function localConfig(original: Record<string, unknown> & { port: number }, checkout: string): Record<string, unknown>;
export function prepareLocal(checkout: string, deps?: { run?: typeof runCommand; log?: (message: string) => void }): Promise<number>;
export function stopReporter(
  checkout: string,
  deps?: { processInfo?: (pid: number) => Promise<{ start: string; command: string } | null>; kill?: (pid: number) => void; now?: () => number; clearLive?: (paths: { app: string }) => Promise<string> },
): Promise<string>;
