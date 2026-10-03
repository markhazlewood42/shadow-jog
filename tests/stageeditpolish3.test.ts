/**
 * Battle Stage Editor, polish round 3 (Phaser spike `spike/phaser-stage`): the pure parts of what Mark's judges asked
 * for. Align that stays inside the design's limits and reports what really happened, a zoom that is always a whole
 * number, one save that writes all the files together or none, and wording that follows the real state.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StageEntry } from '../src/stage/config';
import { ALIGN_GAP, alignAcross, alignDepth, type Reach, standingRange } from '../src/stage/edit/model';
import { prepareSave } from '../src/stage/edit/save';
import { writeTogether } from '../src/stage/edit/writeset';
import { RULE_LIMITS } from '../src/stage/rules';
import { devicePixelsPerGamePixel, zoomLine } from '../src/stage/zoom';
import { hudJson, shippedEntries, stagesJson } from './stagefiles';

const street = (): StageEntry => shippedEntries().street as StageEntry;
const reach = (n: number, left = 20, right = 20): Record<number, Reach> => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { left, right }]));

describe('Align keeps every fighter inside the design’s limits', () => {
  it('the enemies’ range is x 260 to 476 (the numbers rules.ts checks), the heroes’ is the left half', () => {
    expect(standingRange('enemy')).toEqual({ l: RULE_LIMITS.nearest, r: 480 - RULE_LIMITS.edgeMargin });
    expect(standingRange('enemy').r).toBe(476);
    expect(standingRange('party')).toEqual({ l: 0, r: 240 });
  });

  it('a block that stands past a limit is pulled back inside it: right edge 476 at most, left edge 260 at least', () => {
    const s = street();
    // Three fighters 60 px wide whose right-most drawn edge is at 500, past the 476 the rules allow.
    s.enemySets['3'] = [
      { x: 430, row: 2 },
      { x: 460, row: 2 },
      { x: 470, row: 2 },
    ];
    const r = alignAcross(s, 'enemy', '3', [0, 1, 2], 'right', reach(3, 30, 30));
    const xs = (s.enemySets['3'] ?? []).map((q) => q.x);
    expect(Math.max(...xs) + 30).toBe(476);
    expect(r).toMatchObject({ total: 3, fit: 3, short: 0, slid: 0 });
    alignAcross(s, 'enemy', '3', [0, 1, 2], 'left', reach(3, 30, 30));
    expect(Math.min(...(s.enemySets['3'] ?? []).map((q) => q.x)) - 30).toBeGreaterThanOrEqual(260);
    expect(Math.max(...(s.enemySets['3'] ?? []).map((q) => q.x)) + 30).toBeLessThanOrEqual(476);
  });

  it('when fighters on one row are wider than the room, as many as fit are packed and the rest stay put, and the counts say so', () => {
    const s = street();
    // Four fighters 60 px wide on one row: 4 x 60 + 3 x 2 = 246 px, but the enemies have 216 px (260 to 476). Three fit (184 px).
    s.enemySets['4'] = [
      { x: 300, row: 2 },
      { x: 335, row: 2 },
      { x: 370, row: 2 },
      { x: 440, row: 2 },
    ];
    const before = (s.enemySets['4'] ?? []).map((q) => q.x);
    const r = alignAcross(s, 'enemy', '4', [0, 1, 2, 3], 'left', reach(4, 30, 30));
    const xs = (s.enemySets['4'] ?? []).map((q) => q.x);
    expect(xs.slice(0, 3)).toEqual([300, 300 + 60 + ALIGN_GAP, 300 + 2 * (60 + ALIGN_GAP)]); // against the group's left edge (270)
    expect(xs[3]).toBe(before[3]); // the one that did not fit stayed where it was
    expect(r).toMatchObject({ total: 4, fit: 3, short: 1, slid: 0 });
    // Nobody was pushed past a limit the rules enforce.
    for (const x of xs.slice(0, 3)) expect(x + 30).toBeLessThanOrEqual(476);
    for (const x of xs.slice(0, 3)) expect(x - 30).toBeGreaterThanOrEqual(260);
  });

  it('Right packs from the right end: the three nearest the right edge fit, the leftmost stays', () => {
    const s = street();
    s.enemySets['4'] = [
      { x: 300, row: 2 },
      { x: 335, row: 2 },
      { x: 370, row: 2 },
      { x: 440, row: 2 },
    ];
    const r = alignAcross(s, 'enemy', '4', [0, 1, 2, 3], 'right', reach(4, 30, 30));
    const xs = (s.enemySets['4'] ?? []).map((q) => q.x);
    expect(xs[3]).toBe(440); // the group's right edge (470) is where the block ends
    expect(xs[0]).toBe(300); // the leftmost did not fit and stayed
    expect(r).toMatchObject({ fit: 3, short: 1 });
  });

  it('never reports a move that clearOfOthers then undid: a planned fighter nudged off an exact spot counts as slid, not as fit', () => {
    const s = street();
    // The fourth fighter does not fit and stays at x 424, which is exactly where the third is placed (300, 362, 424).
    s.enemySets['4'] = [
      { x: 300, row: 2 },
      { x: 330, row: 2 },
      { x: 360, row: 2 },
      { x: 424, row: 2 },
    ];
    const r = alignAcross(s, 'enemy', '4', [0, 1, 2, 3], 'left', reach(4, 30, 30));
    const xs = (s.enemySets['4'] ?? []).map((q) => q.x);
    expect(new Set(xs).size).toBe(4); // nobody stands on the exact same spot
    expect(r).toMatchObject({ total: 4, fit: 2, short: 1, slid: 1 });
    expect(r.fit + r.slid + r.short).toBe(r.total);
  });

  it('several fighters lining up with each other are clamped into the range even if they stand outside it', () => {
    const s = street();
    s.enemySets['2'] = [
      { x: 250, row: 1 },
      { x: 330, row: 3 },
    ];
    // Left edges are 220 and 300; "left" lines both up at 220, which is left of the nearest allowed edge, 260.
    alignAcross(s, 'enemy', '2', [0, 1], 'left', reach(2, 30, 30));
    const xs = (s.enemySets['2'] ?? []).map((q) => q.x);
    expect(xs).toEqual([290, 290]);
  });
});

describe('Back, Middle and Front pack the fighters that land on one row', () => {
  const heroes = (xs: number[], rows: number[]): StageEntry => {
    const s = street();
    s.party = xs.map((x, i) => ({ x, row: rows[i] ?? 0 }));
    return s;
  };

  it('three heroes on different rows, close together in x, are packed side by side on the front row', () => {
    const s = heroes([100, 110, 120], [0, 2, 4]);
    const r = alignDepth(s, 'party', '3', [0, 1, 2], 'front', reach(3, 20, 20));
    expect(s.party.map((q) => q.row)).toEqual([4, 4, 4]);
    const xs = s.party.map((q) => q.x).sort((a, b) => a - b);
    xs.forEach((x, k) => {
      if (k > 0) expect(x - 20).toBeGreaterThanOrEqual((xs[k - 1] ?? 0) + 20 + ALIGN_GAP);
    });
    // Their old left-to-right order is kept, and the block stays centred where they stood (110).
    expect(s.party.map((q) => q.x)).toEqual([...s.party.map((q) => q.x)].sort((a, b) => a - b));
    expect(r).toMatchObject({ packed: 3, packedRows: 1, total: 3, fit: 3, short: 0 });
  });

  it('heroes that already have room keep their x; only a row change happens', () => {
    const s = heroes([40, 120, 200], [0, 2, 4]);
    const r = alignDepth(s, 'party', '3', [0, 1, 2], 'back', reach(3, 20, 20));
    expect(s.party.map((q) => q.x)).toEqual([40, 120, 200]);
    expect(s.party.map((q) => q.row)).toEqual([0, 0, 0]);
    expect(r).toMatchObject({ packed: 0, packedRows: 0, fit: 3 });
  });

  it('too many to fit the range: as many as fit are packed, the rest stay, and the answer says so', () => {
    // Five heroes 60 px wide on one row would need 5 x 60 + 4 x 2 = 308 px; the heroes' half has 240.
    const s = heroes([60, 80, 100, 120, 140], [0, 1, 2, 3, 4]);
    const r = alignDepth(s, 'party', '3', [0, 1, 2, 3, 4], 'middle', reach(5, 30, 30));
    expect(r.short).toBeGreaterThan(0);
    expect(r.fit).toBe(r.total - r.short);
    for (const q of s.party) expect(q.x + 30).toBeLessThanOrEqual(240 + 30); // nobody is pushed off the left half
  });

  it('one hero lands on a row alone: nothing is packed', () => {
    const s = heroes([100, 140, 180], [0, 1, 2]);
    const r = alignDepth(s, 'party', '3', [1], 'front', reach(3, 20, 20));
    expect(s.party[1]?.row).toBe(4);
    expect(r).toMatchObject({ packed: 0, total: 1, fit: 1 });
  });
});

describe('the zoom is always a whole number of screen pixels per game pixel', () => {
  // Panel widths as stageedit.html computes them (rounded down, clamped): left 268..340, right 340..440.
  const room = (w: number, h: number, left = true): { w: number; h: number } => ({
    w: w - (left ? Math.min(340, Math.max(268, Math.floor(0.175 * w))) : 0) - Math.min(440, Math.max(340, Math.floor(0.225 * w))),
    h: h - 31 - 27 - 1, // the top bar and the status line
  });

  it.each([
    [1366, 768, 1],
    [1440, 900, 1],
    [1536, 864, 1],
    [1600, 900, 2],
    [1920, 1080, 2],
    [2560, 1440, 3],
  ])('at %i x %i the stage is %ix and never a fraction', (w, h, k) => {
    const v = room(w, h);
    const got = devicePixelsPerGamePixel(v.w, v.h, 480, 270, 1);
    expect(Number.isInteger(got)).toBe(true);
    expect(got).toBe(k);
  });

  it('on a 125% or 150% display it is still a whole number of screen pixels, never less than 1', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2]) for (const w of [1366, 1440, 1536, 1600, 1920, 2560]) expect(Number.isInteger(devicePixelsPerGamePixel(room(w, 900).w, room(w, 900).h, 480, 270, dpr))).toBe(true);
  });

  it('offers the left-panel key only when hiding the panel reaches a bigger whole zoom', () => {
    // 1536 x 864: 1x with both panels; with the left panel hidden the room is wide enough for 2x.
    const v = room(1536, 864);
    const wide = room(1536, 864, false);
    const k1 = devicePixelsPerGamePixel(v.w, v.h, 480, 270, 1);
    const k2 = devicePixelsPerGamePixel(wide.w, wide.h, 480, 270, 1);
    expect(k1).toBe(1);
    expect(k2).toBe(2);
    const line = zoomLine(k1, 1, k2, true);
    expect(line.text).toBe('Zoom 1x');
    expect(line.hint).toMatch(/Press P to hide the left panel: the stage then fits at 2x/);
    // No hint when the panel is already hidden, or when hiding it would not help.
    expect(zoomLine(k2, 1, k2, false).hint).toBeNull();
    expect(zoomLine(2, 1, 2, true).hint).toBeNull();
  });

  it('on a scaled display the tooltip says how big it is in page pixels, in plain words', () => {
    const line = zoomLine(2, 1.5, 3, true);
    expect(line.text).toBe('Zoom 2x');
    expect(line.title).toMatch(/exactly 2 by 2 screen pixels/);
    expect(line.title).toMatch(/1\.33x in page pixels/);
    expect(line.title).toMatch(/150%/);
  });
});

describe('one save checks the HUD, the stages and the axes together', () => {
  const body = (): { stages: Record<string, StageEntry>; axes: Record<string, { x: number; y: number }>; hud: { commands: { w: number; x: number } } } => ({
    stages: JSON.parse(JSON.stringify(stagesJson)),
    axes: {},
    hud: (JSON.parse(JSON.stringify(hudJson)) as { layout: { commands: { w: number; x: number } } }).layout,
  });

  it('a new HUD that does not fit a stage’s own HUD box refuses the whole save, with a plain message', () => {
    const b = body();
    (b.stages.street as StageEntry).hud = { commands: { x: 300 } };
    expect(prepareSave(b).ok).toBe(true);
    b.hud.commands.w = 300; // the stage's own box at x 300 is now 300 wide and runs off the screen
    const r = prepareSave(b);
    expect(r.ok).toBe(false);
    const text = !r.ok ? r.problems.join(' ') : '';
    expect(text).toMatch(/the HUD layout in this save does not fit a stage's own HUD box/);
    expect(text).toMatch(/street/);
    expect(text).toMatch(/past the right edge/);
  });

  it('a HUD that is not valid on its own is refused before any stage is looked at', () => {
    const b = body();
    b.hud.commands.x = 900;
    const r = prepareSave(b);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]).toMatch(/the HUD layout \(src\/data\/hud\.json\) is not valid/);
  });

  it('names what to write: all that were posted by default, or only the dirty ones; the others are still checked', () => {
    const b = body();
    const all = prepareSave(b);
    expect(all.ok && all.write).toEqual(['stages', 'axes', 'hud']);
    const onlyHud = prepareSave({ ...b, write: ['hud'] });
    expect(onlyHud.ok && onlyHud.write).toEqual(['hud']);
    const noHud = prepareSave({ stages: b.stages, axes: {} });
    expect(noHud.ok && noHud.write).toEqual(['stages', 'axes']);
    expect(noHud.ok && noHud.hudText).toBeUndefined();
    // Asking to write a HUD that was not posted is a mistake, not a silent skip.
    expect(prepareSave({ stages: b.stages, axes: {}, write: ['hud'] }).ok).toBe(false);
  });
});

describe('writeTogether: all the files or none', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'writeset-'));
    dirs.push(d);
    return d;
  };

  it('writes every file, and leaves no temporary file behind', () => {
    const d = tmp();
    writeFileSync(join(d, 'a.json'), 'old a');
    writeFileSync(join(d, 'b.json'), 'old b');
    writeTogether([
      { path: join(d, 'a.json'), text: 'new a' },
      { path: join(d, 'b.json'), text: 'new b' },
    ]);
    expect(readFileSync(join(d, 'a.json'), 'utf8')).toBe('new a');
    expect(readFileSync(join(d, 'b.json'), 'utf8')).toBe('new b');
    expect(readdirSync(d).sort()).toEqual(['a.json', 'b.json']);
  });

  it('when the second file cannot be replaced, the first goes back to its old text and nothing is left over', () => {
    const d = tmp();
    writeFileSync(join(d, 'a.json'), 'old a');
    mkdirSync(join(d, 'b.json')); // a folder where a file should go: the rename onto it fails
    writeFileSync(join(d, 'b.json', 'keep.txt'), 'x');
    expect(() =>
      writeTogether([
        { path: join(d, 'a.json'), text: 'new a' },
        { path: join(d, 'b.json'), text: 'new b' },
      ]),
    ).toThrow();
    expect(readFileSync(join(d, 'a.json'), 'utf8')).toBe('old a');
    expect(readdirSync(d).sort()).toEqual(['a.json', 'b.json']);
  });

  it('when a temporary file cannot even be written, no real file is touched', () => {
    const d = tmp();
    writeFileSync(join(d, 'a.json'), 'old a');
    expect(() =>
      writeTogether([
        { path: join(d, 'a.json'), text: 'new a' },
        { path: join(d, 'missing-folder', 'b.json'), text: 'new b' },
      ]),
    ).toThrow();
    expect(readFileSync(join(d, 'a.json'), 'utf8')).toBe('old a');
    expect(readdirSync(d)).toEqual(['a.json']);
  });
});

describe('line endings: the files of this branch are LF (the repo has .gitattributes eol=lf)', () => {
  // A Windows tool that writes CRLF into the working tree makes every line show as changed in an editor and hides real diffs.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'fixtures' ? [] : walk(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  it('src/stage, e2e and tests have no carriage returns (fix with: sed -i "s/\r$//" <file>)', () => {
    const root = join(import.meta.dirname, '..');
    const crlf = ['src/stage', 'e2e', 'tests'].flatMap((d) => walk(join(root, d))).filter((f) => readFileSync(f, 'utf8').includes('\r'));
    expect(crlf.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});
