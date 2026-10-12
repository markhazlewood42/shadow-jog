// One request of the hosted page to a Vercel function, sorted into a result that a panel can show. It never throws.
//
// The page sits behind Vercel Authentication. When the login cookie is gone, Vercel does not answer with JSON: it sends a 401, a redirect to its login page,
// or a page of HTML (design.md section 7). All three mean the same thing for the person: "Login expired: reload the page". So they get one kind, `login`,
// and the page shows a banner. The request uses `redirect: 'manual'`: a redirect to another site would otherwise fail inside the browser as a network error
// (the login page sends no CORS headers), and that would look like a lost connection.
// An answer of 200 that is not JSON counts as a lost login only when it is HTML. Any other text is "unexpected answer", so the banner never asks for a sign-in that is not the cause.

export type HostedErrorKind = 'login' | 'network' | 'http' | 'bad-response';

export type HostedError = {
  kind: HostedErrorKind;
  /** A short word to test for. */
  code: string;
  /** A sentence for a person. One line, 20 words or fewer. */
  message: string;
  /** The HTTP status, when there was an answer. */
  status?: number;
};

export type FetchResult<T> = { ok: true; data: T } | { ok: false; error: HostedError };

/** The part of `fetch` that this file uses, so that a test passes a small fake. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'type' | 'headers' | 'text'>>;

export const LOGIN_MESSAGE = 'Login expired. Reload the page to sign in again.';
const NETWORK_MESSAGE = 'Cannot reach the server. Check the connection.';

export const NOT_JSON_MESSAGE = 'Unexpected answer from the server: it is not JSON.';
const NOT_JSON_ERROR = (status: number): HostedError => ({ kind: 'bad-response', code: 'not-json', message: NOT_JSON_MESSAGE, status });

const loginError = (status?: number): HostedError => ({ kind: 'login', code: 'login-expired', message: LOGIN_MESSAGE, ...(status === undefined ? {} : { status }) });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A sentence from the error body of a function (`{ error, kind }`), or null. The functions send fixed sentences, but the text is still only data. */
function sentenceOf(body: unknown): string | null {
  if (!isRecord(body) || typeof body.error !== 'string') return null;
  const text = body.error.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, 120).replace(/\.+$/, '');
}

/** GETs JSON from a function of this site. */
export async function fetchHostedJson<T>(url: string, fetchImpl: FetchFn = (target, init) => fetch(target, init)): Promise<FetchResult<T>> {
  let res: Awaited<ReturnType<FetchFn>>;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
  } catch {
    return { ok: false, error: { kind: 'network', code: 'network', message: NETWORK_MESSAGE } };
  }
  // A redirect that fetch does not follow (`redirect: 'manual'`) comes back as an "opaque redirect" with status 0.
  if (res.type === 'opaqueredirect' || res.status === 401 || (res.status >= 300 && res.status < 400)) return { ok: false, error: loginError(res.status) };

  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, error: { kind: 'network', code: 'network', message: NETWORK_MESSAGE } };
  }
  let body: unknown = null;
  let isJson = false;
  try {
    body = JSON.parse(text);
    isJson = true;
  } catch {
    isJson = false;
  }

  if (res.ok) {
    if (!isJson) {
      // Status 2xx with something that is not JSON. An HTML page is the login page of Vercel (or the page of a host that has no such function): the login is gone.
      // Anything else is an answer that the page does not know, and it is said so: a wrong word here would send Mark to sign in again for nothing.
      const html = (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html') || text.trimStart().startsWith('<');
      return { ok: false, error: html ? loginError(res.status) : NOT_JSON_ERROR(res.status) };
    }
    return { ok: true, data: body as T };
  }
  // An error answer. A 2xx answer of HTML was handled above; a 4xx or 5xx of HTML (a platform error page) is an http error without a sentence.
  const sentence = isJson ? sentenceOf(body) : null;
  return {
    ok: false,
    error: {
      kind: 'http',
      code: `http-${res.status}`,
      message: sentence === null ? `The server answered ${res.status}.` : `The server answered ${res.status}: ${sentence}.`,
      status: res.status,
    },
  };
}

/** The same sort of error for a body that was JSON but not the shape the page needs. */
export function badResponse(what: string): HostedError {
  return { kind: 'bad-response', code: 'bad-response', message: `The ${what} answer has a shape that this page does not know.` };
}

export type TextResult = { ok: true; text: string } | { ok: false; error: HostedError; notFound: boolean };

/** GETs a text file from `/api/docs/<path>`. A 404 is `notFound`, so the caller can try another path. The login page (HTML with status 200) is a `login` error. */
export async function fetchHostedText(url: string, fetchImpl: FetchFn = (target, init) => fetch(target, init)): Promise<TextResult> {
  let res: Awaited<ReturnType<FetchFn>>;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'text/markdown, text/plain' }, cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
  } catch {
    return { ok: false, notFound: false, error: { kind: 'network', code: 'network', message: NETWORK_MESSAGE } };
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || (res.status >= 300 && res.status < 400)) return { ok: false, notFound: false, error: loginError(res.status) };
  if (res.status === 404) return { ok: false, notFound: true, error: { kind: 'http', code: 'http-404', message: 'The server answered 404.', status: 404 } };
  if (!res.ok) return { ok: false, notFound: false, error: { kind: 'http', code: `http-${res.status}`, message: `The server answered ${res.status}.`, status: res.status } };
  if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return { ok: false, notFound: false, error: loginError(res.status) };
  try {
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, notFound: false, error: { kind: 'network', code: 'network', message: NETWORK_MESSAGE } };
  }
}
