/**
 * The dialog wrap test (docs/PIVOT-640.md, WP4, D8 and the named gap "story page counts at the new
 * width"): every line of dialogue the game authors wraps, at the dialog box's text width, into the
 * same lines as it did at 480x270. The box is capped at 464 px and centered (D8), so its text is
 * 448 px wide (392 with a portrait), the width it had when the screen was 480 wide. If a line wrapped
 * differently, the story would re-paginate and a writer would have to reread every page.
 *
 * The lines are found in the source, not listed here: a new `s.say`, `s.narrate` or `s.ask` anywhere
 * in the game's scripts is picked up without an edit to this file. Each call's text is read as a
 * string literal; a line built from a template with `${...}` in it cannot be read this way, and the
 * test counts those and names them (so a skipped line is never a silent one).
 */
/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPEAKERS } from '../src/data/speakers';
import { measure, wrap } from '../src/engine/font';
import { DIALOG_MAX_W, DIALOG_PAD, DIALOG_PORTRAIT_COL, dialogBoxW, dialogTextW } from '../src/ui/layout';

/** What the dialog box's text width was at 480x270: the box was the screen less 8 px a side. */
const OLD_BOX_W = 480 - 16;
/** Where the game's scripts and dialogue live. */
const ROOTS = ['src/story', 'src/data/maps', 'src/game', 'src/scenes'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The arguments of the call whose `(` is at `open` in `src`, as source text. Reads strings (all three
 * quote kinds, with escapes) and nested brackets, so a comma inside either does not split an argument.
 */
function callArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** The three quote characters of a JavaScript string, and the escape character. */
const QUOTES = ["'", '"', '`'];
const BACKSLASH = String.fromCharCode(92);

/** The text of one string literal in source (a quoted string with escapes), or null if the source is anything else. */
function stringLiteral(srcText: string): string | null {
  const t = srcText.trim();
  const q = t[0];
  if (!q || !QUOTES.includes(q) || t[t.length - 1] !== q || t.length < 2 || t.includes('${')) return null;
  // The body must be one string: an unescaped quote of the same kind inside means a concatenation or an expression.
  const body = t.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === BACKSLASH) i++;
    else if (body[i] === q) return null;
  }
  return body.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_m, e: string) => (e.startsWith('u') && e.length === 5 ? String.fromCharCode(Number.parseInt(e.slice(1), 16)) : e === 'n' ? '\n' : e));
}

/** The strings of an array literal of string literals, or null if it is anything else. */
function stringArray(srcText: string): string[] | null {
  const t = srcText.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const items = callArgs(`(${t.slice(1, -1)})`, 0).map((x) => x.trim()).filter(Boolean);
  const out = items.map(stringLiteral);
  return out.every((x): x is string => x !== null) ? out : null;
}

interface Line {
  where: string;
  who: string | null;
  text: string;
}
interface Choice {
  where: string;
  text: string;
}

/** Every authored line and choice in the game's scripts, and the calls this reading could not take. */
function authored(): { lines: Line[]; choices: Choice[]; unreadable: { where: string; arg: string }[] } {
  const lines: Line[] = [];
  const choices: Choice[] = [];
  const unreadable: { where: string; arg: string }[] = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\b([A-Za-z_]+)\.(say|narrate|ask)\(/g)) {
        // Only the script API and the field's own wrappers: `s.say(...)`, `api.say(...)` (a `say` of
        // something else, like a toast, takes one argument and no speaker).
        const kind = m[2]!;
        const open = (m.index ?? 0) + m[0].length - 1;
        const args = callArgs(src, open);
        const line = src.slice(0, open).split('\n').length;
        const where = `${file}:${line}`;
        const textArg = kind === 'narrate' ? args[0] : args[1];
        if (textArg === undefined) continue;
        const text = stringLiteral(textArg);
        if (text === null) {
          unreadable.push({ where, arg: textArg.trim() });
          continue;
        }
        const who = kind === 'narrate' ? null : stringLiteral(args[0] ?? '');
        lines.push({ where, who, text });
        if (kind === 'ask') {
          const opts = stringArray(args[2] ?? '');
          if (opts) for (const c of opts) choices.push({ where, text: c });
          else unreadable.push({ where: `${where} (choices)`, arg: (args[2] ?? '').trim() });
        }
      }
    }
  }
  return { lines, choices, unreadable };
}

/** A line's wrap at a box of `boxW`, the way `DialogScene` wraps it. */
const wrapAt = (l: Line, boxW: number): string[] => wrap(l.text, dialogTextW(boxW, !!(l.who && SPEAKERS[l.who]?.portrait)));

describe('dialog wrap (D8: the box is capped at 464 px, so every line wraps as it did at 480x270)', () => {
  const found = authored();

  it('finds the game’s dialogue in its scripts (a test that reads nothing proves nothing)', () => {
    // 178 `s.say` lines were counted by hand when the test was written; the scripts hold more calls
    // than that (narration, choices, the maps' own talk). A drop under this floor means the reading broke.
    expect(found.lines.length).toBeGreaterThanOrEqual(170);
    expect(found.choices.length).toBeGreaterThanOrEqual(5);
  });

  it('a call the test cannot read as a literal is built from a variable, a template or a join: it is named, never skipped by mistake', () => {
    // A line built at run time (`${...}`, a variable, a `+`) is outside this test's reach: those calls are
    // listed in the failure message if one of them is really a plain string the reading missed.
    const missed = found.unreadable.filter((u) => !/\$\{|\+/.test(u.arg) && /^['"`]/.test(u.arg) && !u.where.endsWith('(choices)'));
    expect(missed.map((u) => `${u.where}: ${u.arg.slice(0, 60)}`)).toEqual([]);
    // The count is part of the record (docs/PIVOT-640.md): lines read, choices read, calls built at run time.
    console.info(`dialog-wrap: ${found.lines.length} lines and ${found.choices.length} choices read, ${found.unreadable.length} calls built at run time`);
  });

  it('at the shipped box (capped, centered) no line wraps differently from 480x270', () => {
    const boxW = Math.min(DIALOG_MAX_W, dialogBoxW());
    expect(dialogTextW(boxW, false)).toBe(dialogTextW(OLD_BOX_W, false));
    expect(dialogTextW(boxW, true)).toBe(dialogTextW(OLD_BOX_W, true));
    const changed = found.lines.filter((l) => wrapAt(l, boxW).join('\n') !== wrapAt(l, OLD_BOX_W).join('\n')).map((l) => `${l.where}: ${l.text.slice(0, 50)}`);
    expect(changed).toEqual([]);
    // For the record: how many of the lines wrap onto more than one line, and how many fill more than one page (four lines).
    const wrapped = found.lines.filter((l) => wrapAt(l, boxW).length > 1).length;
    const paged = found.lines.filter((l) => wrapAt(l, boxW).length > 4).length;
    console.info(`dialog-wrap: ${found.lines.length} lines compared, ${wrapped} wrap onto 2 or more lines, ${paged} run over more than one page, 0 wrap differently from 480x270`);
  });

  it('the text widths are the ones the plan names: 448 px, 392 px with a portrait', () => {
    expect(dialogTextW(DIALOG_MAX_W, false)).toBe(448);
    expect(dialogTextW(DIALOG_MAX_W, true)).toBe(392);
    expect(DIALOG_PAD * 2 + DIALOG_PORTRAIT_COL).toBe(72);
  });

  it('a box as wide as the screen (the review variant, 608 px) would re-wrap some lines: the test sees the difference', () => {
    // The negative control of this test: if the check could not tell a wider box from the old one it would prove nothing.
    const wide = 640 - 16;
    const changed = found.lines.filter((l) => wrapAt(l, wide).join('\n') !== wrapAt(l, OLD_BOX_W).join('\n'));
    expect(changed.length).toBeGreaterThan(0);
  });

  it('every choice fits the box above the dialog (its width, with the margins the box draws)', () => {
    for (const c of found.choices) expect(Math.max(80, measure(c.text)) + 24, `${c.where}: ${c.text}`).toBeLessThanOrEqual(DIALOG_MAX_W - 16);
  });
});
