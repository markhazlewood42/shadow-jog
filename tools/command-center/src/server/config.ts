import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** The tool's own folder (tools/command-center), where package.json and the config file live. */
export const PACKAGE_DIR = resolve(import.meta.dirname, '..', '..');

/** The config file that is read unless `--config <file>` says another. */
export const DEFAULT_CONFIG_FILE = join(PACKAGE_DIR, 'command-center.config.json');

/** The settings of one run. Every path in it is absolute (loadConfig makes them so). */
export type Config = {
  /** The port to listen on. The server listens on 127.0.0.1 only. */
  port: number;
  /** The Shadow Jog repo: where git runs, and where the docs are read from. */
  repoRoot: string;
  /** The folders the server may read or run commands in: the repo and the shadow-jog-phaser checkout. */
  roots: string[];
  /** The GitHub repository that `gh` talks to, as owner/name. Every gh call is pinned to it. */
  githubRepo: string;
  /** The git ref (a commit) that Mark approved the engine design at. Decisions are compared with their text at this ref. */
  approvalRef: string;
  /** The address of the game's dev server. */
  gameUrl: string;
  /** Links the Links panel shows. */
  links: { label: string; url: string }[];
  claude: {
    /** The folder where Claude Code keeps its session files (~/.claude/projects). */
    projectsRoot: string;
    /** Session folders (inside projectsRoot) whose sessions all belong to this project. Matched by exact name. */
    folders: string[];
    /** Session folders that mix projects: a session counts only when its working folder is inside a root. Matched by exact name. */
    cwdMatchFolders: string[];
    /**
     * Whether the sessions that a script started are listed. A session whose entrypoint starts with "sdk" (`sdk-py`, `sdk-ts`, `sdk-cli`: what
     * `claude -p` and the Agent SDK write) is an automated run, not a conversation of Mark's, and a machine can have hundreds of them. They are
     * left out of the sessions list unless this is true, and the count of the ones left out is `hiddenSdk`. A session with no entrypoint is always listed.
     * The default is false (the setting may be left out of the file).
     */
    includeSdk: boolean;
    /** A session file older than this many seconds is left out. */
    recentSeconds: number;
    /** A session that was written to within this many seconds, and is not waiting for Mark, counts as working. */
    workingSeconds: number;
    /** A session whose last reply ended its turn counts as waiting for Mark for this many seconds, then as idle. */
    waitingSeconds: number;
  };
};

/** A config file that cannot be used. The message names the file and the setting, and is safe to print as it is. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// ---- isInside ----

/**
 * A path in a form that can be compared as text: absolute, with "." and ".." folded away, with
 * forward slashes and no trailing slash. On Windows the case is dropped too, because C:\Repo and
 * c:/repo name the same folder there.
 */
function comparable(path: string): string {
  const windows = process.platform === 'win32';
  let text = resolve(path);
  if (windows) text = text.replace(/\\/g, '/');
  // Keep the slash of a drive or file system root ("C:/" or "/"): it is part of the root's name.
  if (text.length > 1 && text.endsWith('/') && !/^[A-Za-z]:\/$/.test(text)) text = text.slice(0, -1);
  return windows ? text.toLowerCase() : text;
}

/**
 * Whether `path` is the folder `root` or something inside it. It compares whole path segments, so
 * `C:\x\shadow-jog-old` is not inside `C:\x\shadow-jog`, which a plain "starts with" would say.
 */
export function isInside(root: string, path: string): boolean {
  const base = comparable(root);
  const target = comparable(path);
  return target === base || target.startsWith(base.endsWith('/') ? base : `${base}/`);
}

// ---- loadConfig ----

const TOP_LEVEL_KEYS = ['port', 'repoRoot', 'roots', 'githubRepo', 'approvalRef', 'gameUrl', 'links', 'claude'] as const;
const CLAUDE_KEYS = ['projectsRoot', 'folders', 'cwdMatchFolders', 'includeSdk', 'recentSeconds', 'workingSeconds', 'waitingSeconds'] as const;

type Json = Record<string, unknown>;

/**
 * Reads and checks a config file. The paths in the file are relative to the file itself (so the
 * file holds no machine-specific path and the repo can be public); the Config that comes back has
 * absolute ones. A setting that is wrong, missing or unknown stops the start with a message that
 * names it, because a typo in a safety setting such as `githubRepo` must not be ignored.
 */
export function loadConfig(file: string): Config {
  const configFile = resolve(file);
  const base = resolve(configFile, '..');
  const fail = (setting: string, problem: string): never => {
    throw new ConfigError(`${configFile}: "${setting}" ${problem}`);
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'it is not valid JSON' : error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${configFile}: the config cannot be read (${reason})`);
  }

  /** An object whose keys are all in `allowed`. `where` is the setting's name for the message ("" for the top level). */
  const object = (value: unknown, where: string, allowed: readonly string[]): Json => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(where || 'the config', 'must be an object');
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) fail(where ? `${where}.${key}` : key, 'is not a setting (a typo?)');
    }
    return value as Json;
  };
  const need = (obj: Json, key: string, where: string): unknown => {
    if (!(key in obj)) fail(where ? `${where}.${key}` : key, 'is missing');
    return obj[key];
  };
  const text = (obj: Json, key: string, where: string): string => {
    const value = need(obj, key, where);
    if (typeof value !== 'string' || value.trim() === '') fail(where ? `${where}.${key}` : key, 'must be a non-empty text');
    return value as string;
  };
  const whole = (obj: Json, key: string, where: string, min: number, max: number): number => {
    const value = need(obj, key, where);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      fail(where ? `${where}.${key}` : key, `must be a whole number from ${min} to ${max}`);
    }
    return value as number;
  };
  /** A true-or-false setting that may be left out: `fallback` when it is not in the file, a stop when it is not `true` or `false` (text "true" and 1 are not). */
  const flag = (obj: Json, key: string, where: string, fallback: boolean): boolean => {
    if (!(key in obj)) return fallback;
    const value = obj[key];
    if (typeof value !== 'boolean') fail(where ? `${where}.${key}` : key, 'must be true or false');
    return value as boolean;
  };
  const list = (obj: Json, key: string, where: string, minLength: number): unknown[] => {
    const value = need(obj, key, where);
    if (!Array.isArray(value) || value.length < minLength) {
      fail(where ? `${where}.${key}` : key, minLength > 0 ? 'must be a list with at least one entry' : 'must be a list');
    }
    return value as unknown[];
  };
  const httpUrl = (value: unknown, setting: string): string => {
    try {
      if (typeof value === 'string') {
        const url = new URL(value);
        if (url.protocol === 'http:' || url.protocol === 'https:') return value;
      }
    } catch {
      // not a URL: reported below
    }
    return fail(setting, 'must be an http or https address');
  };
  /** A path from the file: "~" is the home folder, a relative path starts at the file's folder. */
  const toAbsolute = (value: string): string => {
    if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) return resolve(join(homedir(), value.slice(1)));
    return isAbsolute(value) ? resolve(value) : resolve(base, value);
  };
  /** A folder name: one segment, never a path (so a name cannot reach outside projectsRoot). */
  const folderNames = (obj: Json, key: string): string[] => {
    const setting = `claude.${key}`;
    return list(obj, key, 'claude', 0).map((entry, i) => {
      if (typeof entry !== 'string' || entry === '' || entry === '.' || entry === '..' || /[\\/:*?"<>|]/.test(entry)) {
        return fail(`${setting}[${i}]`, 'must be a folder name, not a path');
      }
      return entry;
    });
  };

  const top = object(parsed, '', TOP_LEVEL_KEYS);
  const claude = object(need(top, 'claude', ''), 'claude', CLAUDE_KEYS);

  const githubRepo = text(top, 'githubRepo', '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) fail('githubRepo', 'must look like owner/name');
  const approvalRef = text(top, 'approvalRef', '');
  // A ref that starts with "-" would be read by git as an option, so it is not a ref.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(approvalRef)) fail('approvalRef', 'must be a commit id or a ref name');

  return {
    port: whole(top, 'port', '', 1, 65535),
    repoRoot: toAbsolute(text(top, 'repoRoot', '')),
    roots: list(top, 'roots', '', 1).map((entry, i) => {
      if (typeof entry !== 'string' || entry.trim() === '') return fail(`roots[${i}]`, 'must be a non-empty path');
      return toAbsolute(entry);
    }),
    githubRepo,
    approvalRef,
    gameUrl: httpUrl(need(top, 'gameUrl', ''), 'gameUrl'),
    links: list(top, 'links', '', 0).map((entry, i) => {
      const link = object(entry, `links[${i}]`, ['label', 'url']);
      return { label: text(link, 'label', `links[${i}]`), url: httpUrl(need(link, 'url', `links[${i}]`), `links[${i}].url`) };
    }),
    claude: {
      projectsRoot: toAbsolute(text(claude, 'projectsRoot', 'claude')),
      folders: folderNames(claude, 'folders'),
      cwdMatchFolders: folderNames(claude, 'cwdMatchFolders'),
      includeSdk: flag(claude, 'includeSdk', 'claude', false),
      recentSeconds: whole(claude, 'recentSeconds', 'claude', 1, 31_536_000),
      workingSeconds: whole(claude, 'workingSeconds', 'claude', 1, 31_536_000),
      waitingSeconds: whole(claude, 'waitingSeconds', 'claude', 1, 31_536_000),
    },
  };
}
