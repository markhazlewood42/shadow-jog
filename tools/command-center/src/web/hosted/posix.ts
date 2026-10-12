// The four functions of `node:path`.posix that the doc renderer uses (src/server/docs/render.ts and links.ts), written for the browser. The Vite build of the hosted page
// points the import `node:path` at this file (vite.config.ts), because a browser has no `node:path`. The server still uses Node's own. A test runs both on the same inputs.
// The code follows Node's `lib/path.js` for these functions.

/** Resolves `.` and `..`. Without `allowAboveRoot`, a `..` with nothing to climb is dropped. With it, the `..` stays. */
function normalizeSegments(path: string, allowAboveRoot: boolean): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

function normalize(path: string): string {
  if (path.length === 0) return '.';
  const isAbsolute = path.startsWith('/');
  const trailingSlash = path.endsWith('/');
  let result = normalizeSegments(path, !isAbsolute);
  if (result.length === 0) {
    if (isAbsolute) return '/';
    return trailingSlash ? './' : '.';
  }
  if (trailingSlash) result += '/';
  return isAbsolute ? `/${result}` : result;
}

function join(...parts: string[]): string {
  const joined = parts.filter((part) => part.length > 0).join('/');
  return joined.length === 0 ? '.' : normalize(joined);
}

function dirname(path: string): string {
  if (path.length === 0) return '.';
  const hasRoot = path.startsWith('/');
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    if (path[i] === '/') {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

function basename(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === '/') end -= 1;
  const trimmed = path.slice(0, end);
  if (trimmed === '/') return '';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export const posix = { normalize, join, dirname, basename };
