/**
 * Shared text helpers for the screen-literal scans: tests/screen-literals.test.ts (the pass line
 * PL1 of docs/PIVOT-640.md) and scripts/derived-literals.mjs (the advisory report). They work on
 * the source text, not on a syntax tree, so they stay small and need no package.
 *
 * `stripNoise(source)` blanks out comments and the inside of string literals. Every line break and
 * every other character stays in place, so line numbers still match the file. A number inside a
 * color such as 'rgba(63,224,240,0.08)' or a comment that says 480x270 can then never count as a
 * hit: the scan looks at code only.
 *
 * `findTokens(source, tokens)` lists each whole-token hit of the given tokens with its line number
 * and the original line. A token is a number ("480": matches `480` but not `1480`, `480.5`, `0.480`
 * or `x480`) or an expression such as "W-16" (matches `W - 16` with any spacing).
 *
 * `listScanFiles(repoRoot)` is the one definition of which files the scans read.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The files the screen-literal scans read: every `.ts` file under `src/` (data files included, so a
 * price such as the nodachi's 480 sits on the allow list with its reason), plus the two files of
 * inventory rows 14 and 213 whose 480 means kilobytes. Paths are relative to `repoRoot`, with
 * forward slashes, sorted. The `.d.ts` files are skipped (they hold no code).
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listScanFiles(repoRoot) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(rel);
    }
  };
  walk('src');
  for (const extra of ['vite.config.ts', 'scripts/bundle-budget.mjs']) if (existsSync(join(repoRoot, extra))) out.push(extra);
  return out.sort();
}

/**
 * Replace comments and string contents with spaces, keeping newlines and all other code.
 * @param {string} src
 * @returns {string} the same length as `src`
 */
export function stripNoise(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  // Template literals can hold code in ${ }: `mode` says what the scanner is inside, and `depth`
  // counts braces inside a ${ } so the matching } hands back to the template text.
  const stack = []; // frames of { mode: 'template' | 'code', depth }
  let mode = 'code';
  let depth = 0;
  // The last code character that is not a space, to tell a regex literal from a division.
  let lastCode = '';
  const space = (ch) => (ch === '\n' ? '\n' : ' ');

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'template') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '`') { out += c; i++; const f = stack.pop(); mode = f.mode; depth = f.depth; continue; }
      if (c === '$' && d === '{') { out += '${'; i += 2; stack.push({ mode: 'template', depth: 0 }); mode = 'code'; depth = 0; continue; }
      out += space(c); i++;
      continue;
    }
    // code
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += space(src[i]); i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      out += c; i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += ' '; i++;
      }
      if (i < n) { out += src[i]; i++; }
      lastCode = c;
      continue;
    }
    if (c === '`') {
      out += c; i++;
      stack.push({ mode: 'code', depth });
      mode = 'template';
      lastCode = c;
      continue;
    }
    if (c === '/' && startsRegex(lastCode)) {
      // A regex literal: skip to its closing slash (a slash inside [...] does not close it).
      out += c; i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const r = src[i];
        if (r === '\\') { out += '  '; i += 2; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        out += ' '; i++;
      }
      if (i < n && src[i] === '/') { out += '/'; i++; }
      lastCode = '/';
      continue;
    }
    if (stack.length && stack[stack.length - 1].mode === 'template') {
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) { out += c; i++; stack.pop(); mode = 'template'; continue; }
        depth--;
      }
    }
    out += c;
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') lastCode = c;
    i++;
  }
  return out;
}

/** After one of these characters a slash starts a regex literal, not a division. */
function startsRegex(lastCode) {
  return lastCode === '' || '(,=:[!&|?{;+-*%<>~^'.includes(lastCode);
}

/**
 * @param {string} token "480" or "W-16"
 * @returns {RegExp} a global regex that matches the token as a whole
 */
function tokenRegex(token) {
  if (/^\d+$/.test(token)) return new RegExp(`(?<![\\w.$])${token}(?![\\w.])`, 'g');
  const m = /^([A-Za-z_$][\w$]*)\s*([-+*/])\s*(\d+)$/.exec(token);
  if (m) {
    const op = m[2].replace(/[-+*/]/g, (ch) => `\\${ch}`);
    return new RegExp(`(?<![\\w.$])${m[1]}\\s*${op}\\s*${m[3]}(?![\\w.])`, 'g');
  }
  throw new Error(`cannot build a scan pattern for "${token}"`);
}

/**
 * Every whole-token hit in the code of `src` (comments and strings ignored).
 * @param {string} src
 * @param {readonly string[]} tokens
 * @returns {{ line: number, token: string, text: string }[]} sorted by line, then by column
 */
export function findTokens(src, tokens) {
  const clean = stripNoise(src);
  const originalLines = src.split('\n');
  const cleanLines = clean.split('\n');
  const hits = [];
  const patterns = tokens.map((t) => ({ token: String(t), re: tokenRegex(String(t)) }));
  for (let li = 0; li < cleanLines.length; li++) {
    const line = cleanLines[li];
    const found = [];
    for (const { token, re } of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) found.push({ col: m.index, token });
    }
    found.sort((a, b) => a.col - b.col);
    for (const f of found) hits.push({ line: li + 1, token: f.token, text: (originalLines[li] ?? '').trim() });
  }
  return hits;
}
