import type { HttpClient } from './http';

// The continuous protection check (design.md sections 7 and 11.1). The hosted page must stay behind Vercel Authentication. The reporter asks
// `<hosted address>/api/live` WITHOUT a login cookie, and WITHOUT the store token. Then:
//
//   401, or a redirect to the Vercel login  -> protected
//   200 with a JSON body                    -> PUBLIC: the reporter stops and removes the key
//   a network error, a timeout, a 5xx, or any other answer -> unknown: nothing changes, the reporter asks again later

export type Verdict =
  | { kind: 'protected'; why: string }
  | { kind: 'public'; why: string }
  | { kind: 'unknown'; why: string };

const TIMEOUT_MS = 10_000;

/** Where the login of Vercel lives. A redirect to any other host is not proof of a login (a trailing slash, say). */
function isVercelLogin(location: string | null, base: string): boolean {
  if (location === null) return false;
  try {
    const host = new URL(location, base).hostname;
    return host === 'vercel.com' || host.endsWith('.vercel.com');
  } catch {
    return false;
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
      : { kind: 'unknown', why: `the hosted page redirected, but not to the Vercel login (status ${status})` };
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
