/**
 * Glyph coverage: every character in the game's authored strings is one the bitmap font can draw.
 * A missing glyph renders as the '?' fallback, and nothing but a screenshot review would catch it:
 * one stray smart quote or accented name in a line of dialogue is enough.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasGlyph } from '../src/engine/font';

/** Where on-screen text is authored. Dev-only test scenes are skipped (they're not shipped). */
const ROOTS = ['src/data', 'src/story', 'src/scenes', 'src/ui', 'src/game'];
const SKIP = /(test|devroutes)\.ts$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !SKIP.test(p) ? [p] : [];
  });
}

/** The string literals in a source file, with comments removed first (their apostrophes aren't quotes). */
function literals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;,({])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    out.push(
      raw
        .replace(/\$\{[^}]*\}/g, '')
        // Colour and markup codes are consumed by the renderer, not drawn.
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
        .replace(/\\n/g, '\n')
        .replace(/\\(.)/g, '$1'),
    );
  }
  return out;
}

describe('glyph coverage', () => {
  it('every character in authored text has a glyph in the bitmap font', () => {
    const missing = new Map<string, Set<string>>();
    for (const root of ROOTS) {
      for (const file of sources(root)) {
        for (const text of literals(readFileSync(file, 'utf8'))) {
          for (const ch of text) {
            // Braces are markup syntax (and nested template expressions), never drawn.
            if (ch === '\t' || ch === '{' || ch === '}' || hasGlyph(ch)) continue;
            if (!missing.has(ch)) missing.set(ch, new Set());
            missing.get(ch)!.add(file.replace(/\\/g, '/'));
          }
        }
      }
    }
    expect(Object.fromEntries([...missing].map(([ch, files]) => [ch, [...files].slice(0, 4)]))).toEqual({});
  });
});
