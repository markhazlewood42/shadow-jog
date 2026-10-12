// The allow-list for `/api/docs/<repo path>` (design.md section 6). It matches the local docs set: `docs/**/*.md`, the root `*.md` files (`status.md`,
// `CHANGELOG.md`, ...) and the diagram PNGs under `docs/`. It is strict on purpose: the path goes into a GitHub URL, so only plain names pass.
// Pure: it looks at text only.

export type DocPath = { ok: true; path: string; type: 'markdown' | 'png' } | { ok: false; status: 400 | 404; reason: string };

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
  }
  return { ok: false, status: 404, reason: 'not in the allow-list' };
}

/** The path of a request URL, as the URL parser gives it (it may already have removed dot segments, which is safe: the result is checked again). */
export function pathnameOf(request: Request): string | null {
  try {
    return new URL(request.url).pathname;
  } catch {
    return null;
  }
}
