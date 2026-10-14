// The allow-list for `/api/docs/<repo path>` (design.md section 6). It matches the local docs set: `docs/**/*.md`, the root `*.md` files (`status.md`,
// `CHANGELOG.md`, ...) and the diagram PNGs and SVGs under `docs/`. It is strict on purpose: the path goes into a GitHub URL, so only plain names pass.
// Pure: it looks at text only.

export type DocPath = { ok: true; path: string; type: 'markdown' | 'png' | 'svg' } | { ok: false; status: 400 | 404; reason: string };

const PREFIX = '/api/docs/';
/** One name in a path: a letter or digit first (so no hidden file), then letters, digits, dot, dash or underscore. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const bad = (reason: string): DocPath => ({ ok: false, status: 400, reason });

/**
 * `pathname` is the path of the request URL, for example `/api/docs/docs/GDD.md`.
 *   400: the path is not well formed (an encoded character, a backslash, a null byte, `.`/`..`, an empty part, a character outside the plain set, a hidden name).
 *        Any `%` is refused, so `%2e`, `%2f`, `%5c`, `%00` and double encoding (`%252e`) are all caught without decoding anything.
 *   404: the path is plain but not in the allow-list.
 */
export function parseDocPath(pathname: string): DocPath {
  if (!pathname.startsWith(PREFIX)) return bad('not a docs path');
  const rest = pathname.slice(PREFIX.length);
  if (rest === '') return bad('empty path');
  if (rest.includes('%')) return bad('encoded characters are not allowed');
  if (rest.includes('\\') || rest.includes('\0')) return bad('backslash or null byte');
  const segments = rest.split('/');
  for (const segment of segments) {
    if (segment === '') return bad('empty part (an absolute path, a double slash or a trailing slash)');
    if (segment === '.' || segment === '..' || segment.includes('..')) return bad('dot segment');
    if (!SEGMENT.test(segment)) return bad('character outside the plain set');
  }
  const last = segments[segments.length - 1] as string;
  if (segments.length === 1) {
    return last.endsWith('.md') ? { ok: true, path: rest, type: 'markdown' } : { ok: false, status: 404, reason: 'not in the allow-list' };
  }
  if (segments[0] === 'docs') {
    if (last.endsWith('.md')) return { ok: true, path: rest, type: 'markdown' };
    if (last.endsWith('.png')) return { ok: true, path: rest, type: 'png' };
    if (last.endsWith('.svg')) return { ok: true, path: rest, type: 'svg' };
  }
  return { ok: false, status: 404, reason: 'not in the allow-list' };
}

/**
 * Where the doc path of a request comes from. vercel.json rewrites `/api/docs/:path*` to `/api/docs?path=:path*`, because the multi-segment catch-all file was not
 * matched on Vercel. So the path arrives in the `path` query parameter, or (no rewrite, or a platform that keeps the original URL) after `/api/docs/` in the URL path.
 *   - One source: it is used.
 *   - Both: they must be the same text, or the request is refused. (Vercel can add the original query to the rewritten one, and a client can send its own `?path=`.)
 *   - More than one `path` parameter, or none: refused.
 * The value is then checked by `parseDocPath` exactly as before. This function adds no permission: a value that comes from the query goes through the same allow-list.
 * The query value is decoded once by the URL parser, so `%2e%2e` becomes `..` and `%252e` becomes `%2e`, and `parseDocPath` refuses both.
 */
export type DocRequest = { ok: true; pathname: string } | { ok: false; reason: string };

export function docPathnameOf(requestUrl: string): DocRequest {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, reason: 'bad URL' };
  }
  const queryValues = url.searchParams.getAll('path');
  if (queryValues.length > 1) return { ok: false, reason: 'more than one path parameter' };
  const fromQuery = queryValues[0];
  // The URL parser may already have removed dot segments from the path. That is safe: the result is checked again.
  const fromPath = url.pathname.startsWith(PREFIX) && url.pathname.length > PREFIX.length ? url.pathname.slice(PREFIX.length) : undefined;
  if (url.pathname !== '/api/docs' && url.pathname !== PREFIX && fromPath === undefined) return { ok: false, reason: 'not a docs path' };
  if (fromQuery !== undefined && fromPath !== undefined && fromQuery !== fromPath) return { ok: false, reason: 'the path and the path parameter differ' };
  const value = fromQuery ?? fromPath;
  if (value === undefined || value === '') return { ok: false, reason: 'empty path' };
  return { ok: true, pathname: `${PREFIX}${value}` };
}
