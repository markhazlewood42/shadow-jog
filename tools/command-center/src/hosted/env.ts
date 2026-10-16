// Reads the settings of the Vercel functions from the environment (design.md sections 6 and 11.3). Pure: the caller passes the environment, so a test needs no real one.
// A value is only ever used in a request header. It is not part of any answer, message or log line.

export type Env = Record<string, string | undefined>;

/**
 * The Vercel environment variable with the GitHub token: a fine-grained token of Mark's account for markhazlewood42/shadow-jog only. It needs "Issues: Read and write",
 * because `/api/answer` writes the answer with it (a comment, the labels, the close). `snapshot` and `docs` still only read with it.
 * A fine-grained token acts as the account that made it, so a write with it is a write by `markhazlewood42`.
 */
export const GITHUB_TOKEN_VAR = 'GITHUB_TOKEN';
/** The address of the hosted page, no path and no trailing slash (for example `https://shadow-jog-command-center.vercel.app`). `/api/answer` serves only requests that arrive on this host. */
export const CC_ORIGIN_VAR = 'CC_ORIGIN';
/**
 * The system variable that Vercel adds to a project when "Protection Bypass for Automation" is on: it holds the secret that skips Vercel Authentication.
 * The name is confirmed in the Vercel documentation (last updated 2026-09-16):
 * https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
 * ("Vercel automatically sets one secret as the `VERCEL_AUTOMATION_BYPASS_SECRET` system environment variable in your deployments.")
 */
export const BYPASS_SECRET_VAR = 'VERCEL_AUTOMATION_BYPASS_SECRET';
/** The Marketplace names of the Upstash variables. The URL and the READ-ONLY token are the only ones that the functions use. */
export const UPSTASH_URL_VAR = 'KV_REST_API_URL';
export const UPSTASH_READ_ONLY_TOKEN_VAR = 'KV_REST_API_READ_ONLY_TOKEN';
/**
 * The READ-WRITE token variables. The Marketplace install adds the first one (the Upstash integration can add the second). Both must be deleted from the Vercel
 * project. A function never reads their values. `KV_REST_API_READ_ONLY_TOKEN` is not on this list.
 */
export const READ_WRITE_TOKEN_VARS = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'] as const;

/** The name of the first read-write variable that is set in the environment (even when empty), or null. Looks at the name only, never at the value. */
export const readWriteVarIn = (env: Env): string | null => READ_WRITE_TOKEN_VARS.find((name) => env[name] !== undefined) ?? null;

const valueOf = (env: Env, name: string): string | null => {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? null : value;
};

/** The GitHub token, or null when it is not set. */
export const readGithubToken = (env: Env): string | null => valueOf(env, GITHUB_TOKEN_VAR);

/** True when the bypass variable exists in the environment (even when empty). Looks at the name only, never at the value: the secret is never read. */
export const bypassSecretIn = (env: Env): boolean => env[BYPASS_SECRET_VAR] !== undefined;

export type OriginSettings = { ok: true; origin: string; host: string } | { ok: false };

/**
 * The hosted address from `CC_ORIGIN`. It must be exactly an origin: `https`, a host, and nothing else (no path, no trailing slash, no query, no user name). Anything else is
 * `ok: false`, and the answer function then refuses to run (it cannot tell which host is the right one). `host` is the part that a `Host` header must match.
 */
export function readOrigin(env: Env): OriginSettings {
  const value = valueOf(env, CC_ORIGIN_VAR);
  if (value === null) return { ok: false };
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== value) return { ok: false };
    return { ok: true, origin: parsed.origin, host: parsed.host };
  } catch {
    return { ok: false };
  }
}

export type UpstashSettings = { ok: true; url: string; token: string } | { ok: false; reason: 'not-configured' | 'misconfigured'; /** For `misconfigured`: why, as a sentence with the name of the variable and never its value. */ detail?: string };

/**
 * The Upstash settings for a READ. `misconfigured` means a read-write token variable exists in the environment (the setup step "delete it" was not done),
 * or the URL is not an https address. `not-configured` means the URL or the read-only token is missing.
 * The check for the read-write variable looks only at whether the name is set. It never reads or uses the value.
 */
export function readUpstash(env: Env): UpstashSettings {
  const readWrite = readWriteVarIn(env);
  if (readWrite !== null) return { ok: false, reason: 'misconfigured', detail: `${readWrite} (a read-write token) must be deleted from this project` };
  const url = valueOf(env, UPSTASH_URL_VAR);
  const token = valueOf(env, UPSTASH_READ_ONLY_TOKEN_VAR);
  if (url === null || token === null) return { ok: false, reason: 'not-configured' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return { ok: false, reason: 'misconfigured', detail: 'the Upstash URL is not an https address' };
    return { ok: true, url: parsed.origin, token };
  } catch {
    return { ok: false, reason: 'misconfigured', detail: 'the Upstash URL is not an https address' };
  }
}
