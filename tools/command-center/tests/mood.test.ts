import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moodFromTokens } from '../src/web/now/moodFromTokens';
import { supportsWebGL2 } from '../src/web/now/webgl';
import { PACKAGE_DIR } from './helpers';

// The glass of the Now page (PlasmaUI) is wrapped in a few files of our own, so that a change of its API touches one place and the rest of the page does not
// need a GPU to be tested. These tests keep the wrapping honest: the colors of the glass are the tokens, the one WebGL2 question has one answer,
// and nothing but the three wrapper files knows that PlasmaUI exists.

// ---- the mood: the glass takes its colors from the tokens ----

/** The tokens as tokens.css writes them (the three that the glass uses, and the amber one that it must never use). */
const TOKENS: Record<string, string> = {
  '--cc-paper': '#0d0c1f',
  '--cc-paper-2': '#1c1a3a',
  '--cc-rule-solid': '#7a80c4',
  '--cc-accent': '#ffcc3d',
};

/** A reader of tokens that records which ones it was asked for, as the real reader (the computed style of the page) would be asked. */
function stubReader(values: Record<string, string> = TOKENS) {
  const asked: string[] = [];
  return {
    asked,
    read: (token: string) => {
      asked.push(token);
      return values[token] ?? '';
    },
  };
}

describe('moodFromTokens', () => {
  it('moodFromTokens returns the token colors (stub reader)', () => {
    const { read, asked } = stubReader();
    const mood = moodFromTokens(read);
    // The deep base, the mid tone and the "accent" slot of the glass: the navy page, the lighter navy of the panels, and the lavender frame.
    expect(mood.colors).toEqual(['#0d0c1f', '#1c1a3a', '#7a80c4']);
    // Amber is for the one or two focal items of a page. It is never a color of the glass, and the reader is not even asked for it.
    expect(mood.colors).not.toContain(TOKENS['--cc-accent']);
    expect(asked).not.toContain('--cc-accent');
    expect(asked.sort()).toEqual(['--cc-paper', '--cc-paper-2', '--cc-rule-solid']);
    // How the glass moves (the distance at which panels fuse and the spring of a drag) is the built-in mood's: only the colors are ours.
    const fallback = moodFromTokens(() => '');
    expect(mood.blend).toBe(fallback.blend);
    expect(mood.spring).toEqual(fallback.spring);
  });

  it('takes the colors in any case and with white space around them, and keeps them as lower case hex', () => {
    const { read } = stubReader({ '--cc-paper': ' #0D0C1F ', '--cc-paper-2': '#1C1A3A\n', '--cc-rule-solid': '#7A80C4' });
    expect(moodFromTokens(read).colors).toEqual(['#0d0c1f', '#1c1a3a', '#7a80c4']);
  });

  it('falls back to the built-in ember mood when a token is missing or is not a hex color', () => {
    const ember = moodFromTokens(() => '');
    // The built-in mood is warm: it is nothing like the token colors, which is how a test (and a person) can tell the fallback was used.
    expect(ember.colors).toHaveLength(3);
    expect(ember.colors).not.toContain('#0d0c1f');

    // One token missing, one that the glass cannot read (it takes hex only), and an empty one: each gives the fallback, never a half-and-half mood.
    expect(moodFromTokens(stubReader({ ...TOKENS, '--cc-paper-2': '' }).read)).toEqual(ember);
    expect(moodFromTokens(stubReader({ ...TOKENS, '--cc-rule-solid': 'rgba(122, 128, 196, 0.28)' }).read)).toEqual(ember);
    expect(moodFromTokens(stubReader({ ...TOKENS, '--cc-paper': 'var(--elsewhere)' }).read)).toEqual(ember);
  });
});

// ---- the WebGL2 question ----

/** A document that makes one canvas, whose getContext gives `context` (or throws). */
function documentWith(getContext: (kind: string) => unknown): Pick<Document, 'createElement'> {
  return { createElement: () => ({ getContext }) as unknown as HTMLCanvasElement } as Pick<Document, 'createElement'>;
}

describe('supportsWebGL2', () => {
  it('supportsWebGL2 is false when getContext returns null', () => {
    const asked: string[] = [];
    expect(
      supportsWebGL2(
        documentWith((kind) => {
          asked.push(kind);
          return null;
        }),
      ),
    ).toBe(false);
    // It asked for exactly the context that the glass needs.
    expect(asked).toEqual(['webgl2']);
  });

  it('is true when the canvas gives a context, and frees the context it made for the question', () => {
    let lost = 0;
    const context = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => void (lost += 1) } : null) };
    expect(supportsWebGL2(documentWith(() => context))).toBe(true);
    // A browser keeps only a few contexts alive at a time, and the glass needs one of them: the probe gives its context back.
    expect(lost).toBe(1);
  });

  it('is true for a context that has no lose_context extension, and false when asking throws or there is no document', () => {
    expect(supportsWebGL2(documentWith(() => ({ getExtension: () => null })))).toBe(true);
    expect(
      supportsWebGL2(
        documentWith(() => {
          throw new Error('The GPU process crashed.');
        }),
      ),
    ).toBe(false);
    // In Node there is no document (a server-side render, a test): the answer is no, and nothing throws.
    expect(supportsWebGL2()).toBe(false);
  });
});

// ---- nothing but the three wrapper files imports PlasmaUI ----

/** An import of the package: `from '...'`, `import('...')`, `require('...')` or a bare `import '...'`, also of a path inside it. A comment that names the package is not one. */
const PLASMA_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]@cruxgarden\/plasma-ui(?:\/[^'"]*)?['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|js|jsx|mjs|css|html)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('the PlasmaUI wrapper', () => {
  it('only GlassPanel.tsx, GlassProvider.tsx and moodFromTokens.ts import plasma-ui (scan)', () => {
    const files = sourceFiles(join(PACKAGE_DIR, 'src'));
    expect(files.length).toBeGreaterThan(30); // the scan really found the app
    const importers = files
      .filter((file) => PLASMA_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(PACKAGE_DIR, file).replaceAll('\\', '/'))
      .sort();
    expect(importers).toEqual(['src/web/now/GlassPanel.tsx', 'src/web/now/GlassProvider.tsx', 'src/web/now/moodFromTokens.ts']);
  });

  it('the scan finds each way to import the package and lets a comment that names it through', () => {
    for (const code of [
      `import { Plasma } from '@cruxgarden/plasma-ui';`,
      `import type { Mood } from "@cruxgarden/plasma-ui";`,
      `export { moods } from '@cruxgarden/plasma-ui';`,
      `const mod = await import('@cruxgarden/plasma-ui');`,
      `const mod = require('@cruxgarden/plasma-ui');`,
      `import '@cruxgarden/plasma-ui/style.css';`,
    ]) {
      expect(PLASMA_IMPORT.test(code), code).toBe(true);
    }
    for (const code of [
      `// Only GlassPanel.tsx imports @cruxgarden/plasma-ui.`,
      ` * the package @cruxgarden/plasma-ui draws the glass`,
      `import { Link } from 'react-router';`,
      `const name = '@cruxgarden/plasma-ui';`,
    ]) {
      expect(PLASMA_IMPORT.test(code), code).toBe(false);
    }
  });
});
