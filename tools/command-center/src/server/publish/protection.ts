import type { HttpClient } from './http';

// The continuous protection check (design.md sections 7 and 11.1). The hosted page must stay behind Vercel Authentication. The reporter asks
// `<hosted address>/api/live` WITHOUT a login cookie, and WITHOUT the store token. Then:
//
//   401, or a redirect to the Vercel login (https, vercel.com, a login or SSO path; see isVercelLogin) -> protected
//   200 with a JSON body                    -> PUBLIC: the reporter stops and removes the key
//   a network error, a timeout, a 5xx, or any other answer -> unknown: nothing changes, the reporter asks again later

export type Verdict =
  | { kind: 'protected'; why: string }
  | { kind: 'public'; why: string }
  | { kind: 'unknown'; why: string };

const TIMEOUT_MS = 10_000;

/**
 * Where the login of Vercel lives. A redirect counts as proof of protection only when ALL of these hold:
 *   - the Location is an https address on vercel.com or a subdomain of it, and
 *   - the path looks like a login or SSO path (/login, /sso, /sso-api, ...), or the query has a `next=` or `redirect` parameter.
 * A redirect to the marketing page (https://vercel.com/), a project-transfer page, or any other host is not proof.
 *
 * ASSUMPTION: no Location of a real protected deployment is recorded in docs/command-center/design.md or docs/workstreams (checked 2026-10-12), so
 * these shapes are a guess at what Vercel sends, based on the SSO address the tests use (https://vercel.com/sso-api?url=...). If the live check
 * stays "unknown" for a protected page, the log line names the redirect; record the real Location and narrow this function to it.
 */
function isVercelLogin(location: string | null, base: string): boolean {
  if (location === null) return false;
  let url: URL;
  try {
    url = new URL(location, base);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (!(url.hostname === 'vercel.com' || url.hostname.endsWith('.vercel.com'))) return false;
  if (/^\/(?:login|sso)(?:[-/]|$)/i.test(url.pathname)) return true;
  return [...url.searchParams.keys()].some((key) => /^(?:next|redirect\w*)$/i.test(key));
}

/**
 * The strict rule for the hosted ANSWER (src/hosted/answer.ts), which writes to GitHub only after it has proved that the page is private. It is narrower than
 * `isVercelLogin` above, which stays as it is for the reporter: a wrong "protected" there only keeps the reporter running, but here it would let a write through.
 * A Location counts only when ALL of these hold:
 *   - the address is https, on the host `vercel.com` exactly (not a subdomain such as `evil.vercel.com`), with no port and no user name, and
 *   - the path is exactly `/sso-api`, `/sso` or `/login`, or one of them followed by `/` and more (so `/ssoX` and `/login-help` fail).
 * A `next=` query, which `isVercelLogin` accepts on any path of vercel.com, proves nothing here: `https://vercel.com/?next=x` is not a login.
 */
export function isStrictVercelLogin(location: string | null, base: string): boolean {
  if (location === null) return false;
  let url: URL;
  try {
    url = new URL(location, base);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'vercel.com' || url.port !== '' || url.username !== '' || url.password !== '') return false;
  return /^\/(?:sso-api|sso|login)(?:\/|$)/.test(url.pathname);
}

/** The place a redirect goes to, without its query (a query can hold addresses with ids). For a log line only. */
function describeLocation(location: string | null, base: string): string {
  if (location === null) return 'no Location header';
  try {
    const url = new URL(location, base);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'an address that does not parse';
  }
}

/** Makes the one request and says what the answer means. It never throws. */
export async function checkProtection(http: HttpClient, hostedUrl: string): Promise<Verdict> {
  let reply: Awaited<ReturnType<HttpClient>>;
  try {
    // The only header is Accept. This request carries no cookie and no token on purpose: it plays a visitor who has not signed in.
    reply = await http(`${hostedUrl}/api/live`, { method: 'GET', headers: { Accept: 'application/json' }, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    return { kind: 'unknown', why: `the check could not reach the hosted page (${error instanceof Error ? error.name : 'unknown error'})` };
  }
  const { status } = reply;
  if (status === 401) return { kind: 'protected', why: 'the hosted page answered 401' };
  if (status >= 300 && status <= 399) {
    return isVercelLogin(reply.location, hostedUrl)
      ? { kind: 'protected', why: `the hosted page redirected to the Vercel login (status ${status})` }
      : { kind: 'unknown', why: `the hosted page redirected, but not to the Vercel login (status ${status}, to ${describeLocation(reply.location, hostedUrl)})` };
  }
  if (status === 200) {
    let body: unknown;
    try {
      body = JSON.parse(await reply.text());
    } catch {
      return { kind: 'unknown', why: 'the hosted page answered 200 with a body that is not JSON' };
    }
    if (typeof body === 'object' && body !== null) return { kind: 'public', why: 'the hosted /api/live answered 200 with its JSON body and no login' };
    return { kind: 'unknown', why: 'the hosted page answered 200 with JSON that is not an object' };
  }
  if (status >= 500) return { kind: 'unknown', why: `the hosted page answered ${status}` };
  return { kind: 'unknown', why: `the hosted page answered ${status}, which is not a sign either way` };
}
