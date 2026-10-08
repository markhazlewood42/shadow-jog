/**
 * The screen-literal scan: pass line PL1 of docs/PIVOT-640.md ("one source of the size").
 *
 * The screen is `W` by `H` (src/engine/game.ts), and the battle world is `BW` by `BHT`
 * (src/art/worldsize.ts, re-exported by src/scenes/battlekit/geom.ts). A bare number that means one of those (480, 270, 240, 135 today;
 * 640, 360, 320, 180 after the move; and the off-by-one neighbors 239, 479, 269, 639, 359, 319, 179)
 * is a copy of the size that a change cannot find. This test scans the code for those numbers as
 * whole tokens. Comments and string literals are ignored (a color channel or a comment never hits).
 *
 * Every hit must be on one of two lists:
 *   tests/screen-literals.allow.json    hits that do not mean the screen, each with a reason
 *                                       (a price, a frame count, degrees, hertz, a modal's width).
 *   tests/screen-literals.pending.json  hits that do mean the screen and that a work package of the
 *                                       move still has to replace. The `wp` field names the package.
 *                                       This list shrinks at each package and is empty at WP7.
 * A hit on neither list fails the test. An entry that matches nothing fails it too (the lists stay
 * honest: a fixed site is removed from the pending list in the same change).
 *
 * The file set is `listScanFiles` in scripts/lib/source-scan.mjs: every `.ts` under src/ (data
 * included), plus vite.config.ts and scripts/bundle-budget.mjs (inventory rows 14 and 213, where
 * 480 means kilobytes). A new file under src/ is scanned on its own.
 *
 * To rewrite the pending list from the current hits (the first run of WP0 did this, and a package
 * may do it again), run:  SCREEN_LITERALS_WRITE_PENDING=1 npx vitest run tests/screen-literals.test.ts
 * It keeps the `wp` of every entry that still matches and marks new entries "?".
 *
 * The scan only covers screen-size tokens. A derived value such as 464 (W-16 at 480) or `W-16`
 * itself passes it; scripts/derived-literals.mjs lists those for the reconciliation at WP7.
 */
/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findTokens, listScanFiles } from '../scripts/lib/source-scan.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const ALLOW_FILE = join(HERE, 'screen-literals.allow.json');
const PENDING_FILE = join(HERE, 'screen-literals.pending.json');

/** The numbers that mean the screen: the old size, the new size, and their off-by-one neighbors. */
const SCREEN_TOKENS = ['480', '270', '240', '135', '239', '479', '269', '640', '360', '320', '180', '639', '359', '319', '179'] as const;

interface Hit {
  file: string;
  line: number;
  token: string;
  text: string;
}

/** An allow entry: one line of a file (with `match`), or every hit of the token in the file (without). */
interface AllowEntry {
  file: string;
  token: number | number[];
  match?: string;
  reason: string;
}

/** A pending entry: one distinct line of a file, the tokens on it, and the package that owns it. */
interface PendingEntry {
  file: string;
  token: number | number[];
  match: string;
  lines: number[];
  wp: string;
}

interface ListFile<E> {
  _comment?: string;
  entries: E[];
}

function readList<E>(file: string): ListFile<E> {
  const json = JSON.parse(readFileSync(file, 'utf8')) as ListFile<E>;
  if (!Array.isArray(json.entries)) throw new Error(`${file}: expected an object with an "entries" array`);
  return json;
}

const tokensOf = (e: { token: number | number[] }): string[] => (Array.isArray(e.token) ? e.token : [e.token]).map(String);

/** Does this entry cover this hit? The file and the token must match; `match` narrows it to lines that contain it. */
function covers(e: { file: string; token: number | number[]; match?: string }, h: Hit): boolean {
  return e.file === h.file && tokensOf(e).includes(h.token) && (e.match === undefined || h.text.includes(e.match));
}

/** Every screen-token hit in the file set. */
function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of listScanFiles(ROOT)) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const h of findTokens(src, SCREEN_TOKENS)) hits.push({ file, ...h });
  }
  return hits;
}

/** Group hits into pending entries: one per distinct line text in a file, with every token on it. */
function toPending(hits: Hit[], previous: PendingEntry[]): PendingEntry[] {
  const byKey = new Map<string, PendingEntry>();
  for (const h of hits) {
    const key = `${h.file}\u0000${h.text}`;
    let e = byKey.get(key);
    if (!e) {
      const old = previous.find((p) => p.file === h.file && p.match === h.text);
      e = { file: h.file, token: [], match: h.text, lines: [], wp: old?.wp ?? '?' };
      byKey.set(key, e);
    }
    const toks = tokensOf(e).map(Number);
    if (!toks.includes(Number(h.token))) toks.push(Number(h.token));
    e.token = toks.length === 1 ? toks[0]! : toks;
    if (!e.lines.includes(h.line)) e.lines.push(h.line);
  }
  return [...byKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.lines[0]! - b.lines[0]!);
}

const fmt = (h: Hit) => `${h.file}:${h.line}  ${h.token}  ${h.text}`;

describe('screen-size literals (PL1: one source of the size)', () => {
  const hits = scan();
  const allow = readList<AllowEntry>(ALLOW_FILE);
  let pending = readList<PendingEntry>(PENDING_FILE);

  const allowed: Hit[] = [];
  const pendingHits: Hit[] = [];
  const unlisted: Hit[] = [];
  const classify = () => {
    allowed.length = pendingHits.length = unlisted.length = 0;
    for (const h of hits) {
      if (allow.entries.some((e) => covers(e, h))) allowed.push(h);
      else if (pending.entries.some((e) => covers(e, h))) pendingHits.push(h);
      else unlisted.push(h);
    }
  };
  classify();

  if (process.env.SCREEN_LITERALS_WRITE_PENDING) {
    // Rewrite the pending list from every hit the allow list does not cover, keeping known owners.
    const entries = toPending([...pendingHits, ...unlisted], pending.entries);
    pending = { ...pending, entries };
    writeFileSync(PENDING_FILE, `${JSON.stringify(pending, null, 2)}\n`);
    classify();
  }

  it('finds the size source itself (the scan is alive)', () => {
    // src/engine/game.ts defines W and H: the scan must see those two numbers, whatever they are.
    expect(hits.filter((h) => h.file === 'src/engine/game.ts' && /export const [WH] =/.test(h.text)).length).toBe(2);
  });

  it('every hit is on the allow list or the pending list', () => {
    expect(unlisted.map(fmt), `screen-size literals on neither list:\n${unlisted.map(fmt).join('\n')}\n\nUse W, H, BW or BHT, or add the hit to tests/screen-literals.allow.json with a reason, or to tests/screen-literals.pending.json with its work package.`).toEqual([]);
  });

  it('every allow entry has a reason and still matches a hit', () => {
    const noReason = allow.entries.filter((e) => !e.reason?.trim());
    expect(noReason, 'allow entries without a reason').toEqual([]);
    const stale = allow.entries.filter((e) => !hits.some((h) => covers(e, h)));
    expect(stale, `allow entries that match nothing any more (remove them):\n${JSON.stringify(stale, null, 2)}`).toEqual([]);
  });

  it('every pending entry still matches a hit, and names its work package', () => {
    const stale = pending.entries.filter((e) => !hits.some((h) => covers(e, h)));
    expect(stale, `pending entries that are fixed (remove them from tests/screen-literals.pending.json):\n${JSON.stringify(stale, null, 2)}`).toEqual([]);
    const unowned = pending.entries.filter((e) => !/^WP\d[a-z]?$/.test(e.wp));
    expect(unowned, 'pending entries without a work package in "wp"').toEqual([]);
  });

  it('reports the counts', () => {
    // Not a check: the numbers go into docs/PIVOT-640.md at each package.
    console.log(`screen-literals: ${hits.length} hits in ${listScanFiles(ROOT).length} files: ${allowed.length} allowed, ${pendingHits.length} pending in ${pending.entries.length} entries, ${unlisted.length} unlisted.`);
    expect(hits.length).toBe(allowed.length + pendingHits.length + unlisted.length);
  });
});
