import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { READ_WRITE_TOKEN_VARS, UPSTASH_URL_VAR } from '../../hosted/env';
import { Secret } from './secret';

// The settings of the reporter. They live in one file OUTSIDE every repo: `~/.shadow-jog-cc/upstash.env`.
// It holds three lines. The names of the first two are the ones the hosted functions use (`src/hosted/env.ts`), so one Upstash install gives both:
//
//   KV_REST_API_URL=https://<name>.upstash.io      the same address that /api/live reads from
//   KV_REST_API_TOKEN=<the read-write token>       the token that only the reporter holds
//   CC_HOSTED_URL=https://<the hosted page>        where the protection check looks (any address of the Vercel project)
//
// A message made here names a variable and never shows a value.

/** The folder and the file, in the home folder of the person who runs the reporter. */
export const SETTINGS_DIR = join(homedir(), '.shadow-jog-cc');
export const DEFAULT_ENV_FILE = join(SETTINGS_DIR, 'upstash.env');

export const TOKEN_VAR = READ_WRITE_TOKEN_VARS[0];
export const HOSTED_URL_VAR = 'CC_HOSTED_URL';
export { UPSTASH_URL_VAR };

export type ReporterSettings = {
  /** The origin of the Upstash REST address (no path). */
  upstashUrl: string;
  token: Secret;
  /** The origin of the hosted page. The protection check asks `<this>/api/live`. */
  hostedUrl: string;
};

export type SettingsResult =
  | { ok: true; settings: ReporterSettings }
  | { ok: false; reason: 'missing-file' | 'unreadable' | 'incomplete' | 'bad-url'; /** A sentence with variable names and never a value. */ detail: string };

/** Reads `KEY=value` lines. A line that starts with # is a comment. `export KEY=value` and a value in quotes are fine. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    values[match[1] as string] = value;
  }
  return values;
}

/** The origin of an https address, or null. `http://localhost...` is accepted too, so a local fake can stand in for a host. */
function originOf(text: string | undefined): string | null {
  if (text === undefined || text === '') return null;
  try {
    const url = new URL(text);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (local && url.protocol === 'http:')) return url.origin;
  } catch {
    // not an address: the caller reports it
  }
  return null;
}

/** Reads and checks the settings file. `read` is a parameter so that a test needs no real file. */
export function loadSettings(file: string = DEFAULT_ENV_FILE, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): SettingsResult {
  let text: string;
  try {
    text = read(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'missing-file', detail: 'the settings file does not exist' };
    return { ok: false, reason: 'unreadable', detail: `the settings file cannot be read (${code ?? 'unknown error'})` };
  }
  const values = parseEnvFile(text);
  const missing = [UPSTASH_URL_VAR, TOKEN_VAR, HOSTED_URL_VAR].filter((name) => (values[name] ?? '') === '');
  if (missing.length > 0) return { ok: false, reason: 'incomplete', detail: `the settings file has no value for ${missing.join(', ')}` };
  const upstashUrl = originOf(values[UPSTASH_URL_VAR]);
  if (upstashUrl === null) return { ok: false, reason: 'bad-url', detail: `${UPSTASH_URL_VAR} is not an https address` };
  const hostedUrl = originOf(values[HOSTED_URL_VAR]);
  if (hostedUrl === null) return { ok: false, reason: 'bad-url', detail: `${HOSTED_URL_VAR} is not an https address` };
  return { ok: true, settings: { upstashUrl, token: new Secret(values[TOKEN_VAR] as string), hostedUrl } };
}
