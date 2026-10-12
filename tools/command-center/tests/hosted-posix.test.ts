import { posix as nodePosix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { posix } from '../src/web/hosted/posix';

// The browser build of the doc renderer gets its own four path functions (src/web/hosted/posix.ts). They must give what Node's do on every input that a link
// in a doc can make, because they decide where a link points (and whether it climbs out of the repo).

const PATHS = [
  '',
  '.',
  '..',
  '/',
  '//',
  'a',
  'a/',
  'a/b',
  'a/b/',
  '/a',
  '/a/b',
  './a',
  './a/./b',
  'a/./b',
  'a//b',
  'a/../b',
  'a/..',
  'a/../',
  'a/../..',
  '../a',
  '../../a',
  'a/b/../../..',
  '/..',
  '/../a',
  '/a/../..',
  'docs/engine/../GDD.md',
  'docs/engine/README.md',
  'docs/ ünï/file name.md',
  '...',
  'a/.../b',
  '.hidden/x',
];

describe('the browser posix functions', () => {
  it.each(PATHS)('normalize(%j) is the same as Node', (path) => {
    expect(posix.normalize(path)).toBe(nodePosix.normalize(path));
  });

  it.each(PATHS)('dirname(%j) is the same as Node', (path) => {
    expect(posix.dirname(path)).toBe(nodePosix.dirname(path));
  });

  it.each(PATHS)('basename(%j) is the same as Node', (path) => {
    expect(posix.basename(path)).toBe(nodePosix.basename(path));
  });

  it('join gives what Node gives for the folder of a doc and a relative link', () => {
    for (const from of ['docs/engine/README.md', 'status.md', 'docs/a/b/c.md']) {
      for (const link of PATHS) {
        expect(posix.join(posix.dirname(from), link), `${from} + ${link}`).toBe(nodePosix.join(nodePosix.dirname(from), link));
      }
    }
    expect(posix.join()).toBe(nodePosix.join());
    expect(posix.join('', '')).toBe(nodePosix.join('', ''));
    expect(posix.join('a', '', 'b')).toBe(nodePosix.join('a', '', 'b'));
  });
});
