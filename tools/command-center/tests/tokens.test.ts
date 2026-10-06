import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR, REPO_DIR } from './helpers';

// tokens.css is the one place where the command center's colours are written. These tests keep
// it in step with the diagram profile it was copied from, keep every text colour readable, and
// keep a colour from sneaking in anywhere else.

const WEB_DIR = join(PACKAGE_DIR, 'src', 'web');
const TOKENS_FILE = join(WEB_DIR, 'tokens.css');
const PROFILE_FILE = join(REPO_DIR, 'docs', 'diagrams', 'profile', 'shadow-jog.md');
const NOTES_FILE = join(REPO_DIR, 'docs', 'diagrams', 'profile', 'NOTES.md');

/** The --cc-* declarations of tokens.css: name to value text. */
function readTokens(): Map<string, string> {
  const css = readFileSync(TOKENS_FILE, 'utf8');
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/(--cc-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1] as string, (match[2] as string).trim());
  }
  return tokens;
}

/** The Dark column of the profile's "Semantic roles" table: role name to the colour in that cell. */
function readProfileDark(): Map<string, string> {
  const text = readFileSync(PROFILE_FILE, 'utf8');
  const start = text.indexOf('### Semantic roles');
  const end = text.indexOf('\n### ', start + 1);
  expect(start, 'the profile has a "Semantic roles" section').toBeGreaterThanOrEqual(0);
  const section = text.slice(start, end);
  const dark = new Map<string, string>();
  for (const line of section.split('\n')) {
    // | `role` | Purpose | `light value` (note) | `dark value` (note) |
    const cells = line.split('|').map((cell) => cell.trim());
    const role = cells[1]?.match(/^`([a-z0-9-]+)`$/)?.[1];
    const value = cells[4]?.match(/`([^`]+)`/)?.[1];
    if (role && value) dark.set(role, value);
  }
  return dark;
}

/** A colour written two ways ("rgba(122, 128, 196, 0.28)" and "rgba(122,128,196,0.280)") compares equal. */
function normalise(value: string): string {
  const compact = value.toLowerCase().replace(/\s+/g, '');
  // Numbers are rewritten only inside rgba(...): a hex colour such as #07060d must stay as it is.
  return compact.includes('(') ? compact.replace(/\d*\.?\d+/g, (n) => String(Number(n))) : compact;
}

function rgb(hex: string): [number, number, number] {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [Number.parseInt(m[1] as string, 16), Number.parseInt(m[2] as string, 16), Number.parseInt(m[3] as string, 16)];
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens.css', () => {
  it('tokens.css matches the Dark column of the profile table', () => {
    const tokens = readTokens();
    const profile = readProfileDark();
    expect([...profile.keys()].sort()).toEqual(['accent', 'accent-tint', 'ink', 'ink-strong', 'link', 'muted', 'paper', 'paper-2', 'rule', 'rule-solid', 'soft']);

    for (const [role, value] of profile) {
      const token = tokens.get(`--cc-${role}`);
      expect(token, `--cc-${role} exists in tokens.css`).toBeDefined();
      expect(normalise(token as string), `--cc-${role}`).toBe(normalise(value));
    }

    // No colour in tokens.css that the profile does not have (the font tokens are not colours).
    const colourTokens = [...tokens.keys()].filter((name) => !name.startsWith('--cc-font-'));
    expect(colourTokens.sort()).toEqual([...profile.keys()].map((role) => `--cc-${role}`).sort());

    // The fonts are Geist and Geist Mono, as in the profile.
    expect(tokens.get('--cc-font-sans')).toContain('Geist');
    expect(tokens.get('--cc-font-mono')).toContain('Geist Mono');
  });

  it('text roles meet 4.5:1 on paper and paper-2 (computed from tokens.css)', () => {
    const tokens = readTokens();
    const value = (role: string) => tokens.get(`--cc-${role}`) as string;

    for (const text of ['ink', 'muted', 'soft', 'accent', 'link']) {
      for (const paper of ['paper', 'paper-2']) {
        const ratio = contrast(value(text), value(paper));
        expect(ratio, `${text} on ${paper}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Dark text on the amber a button or a marker is filled with.
    expect(contrast(value('ink-strong'), value('accent')), 'ink-strong on accent').toBeGreaterThanOrEqual(4.5);
  });

  it('computes the same ratios as the profile notes publish (checks the contrast function itself)', () => {
    const tokens = readTokens();
    const notes = readFileSync(NOTES_FILE, 'utf8');
    for (const role of ['ink', 'muted', 'soft', 'accent', 'link']) {
      // | ink | `#f4f1ff` | Game source | 17.32 | 15.00 |
      const row = notes.split('\n').find((line) => line.startsWith(`| ${role} |`));
      expect(row, `NOTES.md has a row for ${role}`).toBeDefined();
      const cells = (row as string).split('|').map((cell) => cell.trim());
      const [onPaper, onPaper2] = [Number(cells[4]), Number(cells[5])];
      expect(Math.abs(contrast(tokens.get(`--cc-${role}`) as string, tokens.get('--cc-paper') as string) - onPaper), `${role} on paper`).toBeLessThan(0.015);
      expect(Math.abs(contrast(tokens.get(`--cc-${role}`) as string, tokens.get('--cc-paper-2') as string) - onPaper2), `${role} on paper-2`).toBeLessThan(0.015);
    }
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

// ---- the scan for colours outside tokens.css ----

const NAMED_COLOURS = 'white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|cyan|magenta|navy|teal|maroon|lime|olive|aqua|fuchsia|brown';
const UTILITY_PREFIX = 'bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow|placeholder';
const HUES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_PROPERTY = 'color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration-color';

const COLOUR_PATTERNS: [string, RegExp][] = [
  ['a hex colour', /#[0-9a-fA-F]{3,8}\b/g],
  ['a colour function', /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g],
  ['a Tailwind palette colour', new RegExp(String.raw`\b(?:${UTILITY_PREFIX})-(?:${HUES})-\d{2,3}\b`, 'g')],
  ['a Tailwind white or black', new RegExp(String.raw`\b(?:${UTILITY_PREFIX})-(?:white|black)\b`, 'g')],
  ['a named colour', new RegExp(String.raw`(?:^|[\s;{(,"'])(?:${COLOUR_PROPERTY})\s*:\s*['"]?(?:${NAMED_COLOURS})\b`, 'gm')],
];

/** Every colour value in this text, as "what: the text that matched". `transparent`, `currentColor`, `inherit` and var(--…) are not colour values. */
function findColourValues(source: string): string[] {
  return COLOUR_PATTERNS.flatMap(([what, pattern]) => [...source.matchAll(pattern)].map((m) => `${what}: ${m[0].trim()}`));
}

/** The files of src/web that the scan covers. */
function webFiles(): string[] {
  return readdirSync(WEB_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(css|ts|tsx|html)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('colours', () => {
  it('no colour value in src/web outside tokens.css (scan)', () => {
    const files = webFiles();
    expect(files.length).toBeGreaterThanOrEqual(8); // the scan really found the page app
    expect(files).toContain(TOKENS_FILE);

    const found = files
      .filter((file) => file !== TOKENS_FILE)
      .flatMap((file) => findColourValues(readFileSync(file, 'utf8')).map((hit) => `${relative(PACKAGE_DIR, file)} has ${hit}`));
    expect(found).toEqual([]);

    // The scan is not blind: it does find the colours in tokens.css itself.
    expect(findColourValues(readFileSync(TOKENS_FILE, 'utf8')).length).toBeGreaterThanOrEqual(11);
  });

  it('the colour scan finds each way to write a colour and lets the tokens through', () => {
    expect(findColourValues('color: #fff;')).toHaveLength(1);
    expect(findColourValues('background: #0d0c1f99;')).toHaveLength(1);
    expect(findColourValues('className="bg-[#123456]"')).toHaveLength(1);
    expect(findColourValues('border-color: rgb(0 0 0 / 50%);')).toHaveLength(1);
    expect(findColourValues('fill: oklch(0.6 0.2 250);')).toHaveLength(1);
    expect(findColourValues('x: hsl(10 20% 30%)')).toHaveLength(1);
    expect(findColourValues('<div className="bg-red-500 text-slate-100">')).toHaveLength(2);
    expect(findColourValues('<div className="text-white border-black">')).toHaveLength(2);
    expect(findColourValues('color: red;')).toHaveLength(1);
    expect(findColourValues("style={{ background: 'white' }}")).toHaveLength(1);

    expect(findColourValues('color: var(--cc-ink); background: var(--cc-paper-2);')).toEqual([]);
    expect(findColourValues('<div className="bg-cc-paper-2 text-cc-ink border-cc-rule">')).toEqual([]);
    expect(findColourValues('border-color: transparent; fill: currentColor; color: inherit;')).toEqual([]);
    expect(findColourValues('href="#section" id="root" color-mix(in oklab, var(--cc-ink) 70%, transparent)')).toEqual([]);
    expect(findColourValues('The colour of the accent is set in the tokens file.')).toEqual([]);
  });
});
