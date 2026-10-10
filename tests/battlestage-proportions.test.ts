/**
 * Hero proportions (ported from the Phaser spike `spike/phaser-stage`, tests/stageproportions.test.ts): the `heroes.json` loader and the pure
 * row-and-column bake (`src/battlestage/proportions.ts`). The bake is also run on Mark's real idle sheets where his folder is present (it is
 * git-ignored, so CI skips those tests). Not ported: the editor's save tests and the "stable format" tests (the editor and its JSON formatter are not on this branch).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxOf, type Raw } from '../src/battlestage/sfgeom';
import { CREW_IDS } from '../src/battlestage/crew';
import { cutSheet, footAnchor } from '../src/battlestage/feet';
import {
  bakeFrame,
  bakeSheet,
  checkHeroes,
  colsFor,
  FEET_SHARE,
  HEAD_SHARE,
  isIdentity,
  loadHeroes,
  PROPORTION_MAX,
  PROPORTION_MIN,
  pickLines,
  planFor,
  proportionTag,
  rowsFor,
  targetSize,
  throughColumns,
  throughRows,
} from '../src/battlestage/proportions';
import { readPng } from './png';
import { fixtureHeroes, shippedHeroes, shippedHeroesJson } from './stagefiles';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ------------------------------------------------------------------ a made-up figure

/** A figure `w` by `h` with a head on top, a body of different-coloured rows and columns, and two boots. Every row and column differs a little, so no pick is a tie. */
function figure(w = 40, h = 70, bob = 0): Raw {
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const i = (y * w + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  const top = 2 + bob;
  const bottom = h - 3 + bob; // the lowest sole row
  for (let y = top; y <= bottom; y++) {
    const head = y < top + 14;
    const feet = y > bottom - 4;
    const half = head ? 6 : feet ? 9 : 12;
    for (let x = Math.floor(w / 2) - half; x < Math.floor(w / 2) + half; x++) {
      if (feet && x >= Math.floor(w / 2) - 2 && x < Math.floor(w / 2) + 2) continue; // a gap between the boots
      put(x, y, (y * 7 + x * 3) % 256, (y * 5 + 40) % 256, (x * 11 + 90) % 256);
    }
  }
  return { w, h, data: px };
}

const ANCHOR = (r: Raw): { x: number; y: number } => footAnchor([r]);
const sizeOf = (r: Raw): { w: number; h: number } => {
  const b = boxOf(r);
  return { w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
};
const rowOf = (r: Raw, y: number): string => Array.from(r.data.subarray(y * r.w * 4, (y + 1) * r.w * 4)).join(',');

// Mark's heroes.json, as it is now. He edits the numbers in the Battle Stage Editor, so this block checks INVARIANTS only: the
// file loads, every hero is in it, and the heroes keep their ancestry order. It never pins a number. The tool and the bake
// are tested on the frozen fixture file (tests/fixtures/stagedata/heroes.json) in the blocks below.
describe('the shipped heroes file', () => {
  it('passes the loader and has every hero', () => {
    expect(checkHeroes(copy(shippedHeroesJson))).toEqual([]);
    const file = shippedHeroes();
    for (const id of CREW_IDS) expect(file[id], id).toBeDefined();
    expect(Object.keys(file).sort()).toEqual([...CREW_IDS].sort());
  });

  // The ancestry order (Hex shortest, Sable tallest, Rook at least Kit) is judged on the baked pictures below, not on these
  // numbers: each sprite is drawn at its own height, so the multipliers alone do not say which hero comes out taller.

});

describe('the fixture heroes file', () => {
  it('passes the loader and has every hero', () => {
    const file = fixtureHeroes();
    expect(checkHeroes(copy(file))).toEqual([]);
    expect(Object.keys(file).sort()).toEqual([...CREW_IDS].sort());
  });

  it('refuses a missing hero, an unknown one, a number out of range and a stray field', () => {
    const good = fixtureHeroes();
    const { sable: _gone, ...fewer } = good;
    expect(checkHeroes(fewer)).toEqual(['hero proportions: no entry for "sable" (every hero needs one)']);
    expect(checkHeroes({ ...good, ghost: { height: 1, build: 1 } })).toEqual(['hero proportions "ghost": this is not a hero']);
    expect(checkHeroes({ ...good, hex: { height: PROPORTION_MIN - 0.01, build: 1 } })).toEqual([`hero proportions "hex": height must be a number from ${PROPORTION_MIN} to ${PROPORTION_MAX}`]);
    expect(checkHeroes({ ...good, hex: { height: 1, build: PROPORTION_MAX + 0.01 } })[0]).toContain('build must be a number');
    expect(checkHeroes({ ...good, hex: { height: 'tall', build: 1 } })[0]).toContain('height must be a number');
    expect(checkHeroes({ ...good, hex: { height: Number.NaN, build: 1 } })[0]).toContain('height must be a number');
    expect(checkHeroes({ ...good, hex: { height: 1, build: 1, cape: 2 } })[0]).toContain('"cape" is not a setting');
    expect(checkHeroes([])[0]).toContain('must be an object');
    expect(() => loadHeroes({ ...good, hex: { height: 3, build: 1 } })).toThrow(/heroes\.json is not valid/);
  });

  it('allows the ends of the range', () => {
    expect(checkHeroes({ ...fixtureHeroes(), hex: { height: PROPORTION_MIN, build: PROPORTION_MAX } })).toEqual([]);
  });
});

describe('picking the lines', () => {
  it('gives one line from each equal slice, the one most like the next', () => {
    // 10 identical rows except row 4 differs from row 5: asking for 2 lines from 0..10 picks within [0,5) and [5,10).
    const r = figure();
    const picks = pickLines(r, 20, 40, 4, true);
    expect(picks.length).toBe(4);
    picks.forEach((p, k) => {
      expect(p).toBeGreaterThanOrEqual(20 + k * 5);
      expect(p).toBeLessThan(20 + (k + 1) * 5);
    });
  });

  it('gives as many as fit when there is not room for all, and never the same line twice', () => {
    const r = figure();
    const picks = pickLines(r, 20, 25, 99, true);
    expect(picks).toEqual([20, 21, 22, 23, 24]);
    expect(pickLines(r, 20, 20, 3, true)).toEqual([]);
    expect(pickLines(r, 20, 40, 0, true)).toEqual([]);
  });
});

describe('baking a made-up figure', () => {
  const frame = figure();
  const foot = ANCHOR(frame);

  it('changes nothing at 1.0 and 1.0', () => {
    const plan = planFor(frame, foot, { height: 1, build: 1 });
    expect(isIdentity(plan)).toBe(true);
    const b = bakeFrame(frame, foot, plan);
    expect(b.raw.w).toBe(frame.w);
    expect(b.raw.h).toBe(frame.h);
    expect(Array.from(b.raw.data)).toEqual(Array.from(frame.data));
    expect(b.anchor).toEqual(foot);
  });

  it('makes the figure exactly the target height and width', () => {
    const { w, h } = sizeOf(frame);
    for (const [height, build] of [[1.05, 1], [1.27, 1.15], [0.8, 1], [0.6, 0.6], [1.5, 1.5], [1, 1.3], [0.9, 0.75]] as const) {
      const p = { height, build };
      const plan = planFor(frame, foot, p);
      const b = bakeFrame(frame, foot, plan);
      const want = targetSize(w, h, p);
      expect(sizeOf(b.raw), `${height} x ${build}`).toEqual(want);
      expect(plan.rows.length).toBe(rowsFor(h, height));
      expect(plan.cols.length).toBe(colsFor(w, build));
    }
  });

  it('leaves the head and the feet alone: every pick is in the body, and the head rows are the same rows', () => {
    const box = boxOf(frame);
    const h = box.y1 - box.y0 + 1;
    const plan = planFor(frame, foot, { height: 1.4, build: 1 });
    const headRows = Math.floor(HEAD_SHARE * h);
    const feetRows = Math.floor(FEET_SHARE * h);
    for (const up of plan.rows) {
      const row = foot.y - 1 - up;
      expect(row, 'not in the head').toBeGreaterThanOrEqual(box.y0 + headRows);
      expect(row, 'not in the feet').toBeLessThan(box.y1 - feetRows);
    }
    const b = bakeFrame(frame, foot, plan);
    for (let y = 0; y < box.y0 + headRows; y++) expect(rowOf(b.raw, y), `head row ${y}`).toBe(rowOf(frame, y));
    // The soles' rows come out in the same order at the bottom.
    for (let k = 0; k <= feetRows; k++) expect(rowOf(b.raw, b.raw.h - 1 - k)).toBe(rowOf(frame, frame.h - 1 - k));
  });

  it('keeps the columns in the middle of the body, so the sides do not change', () => {
    const box = boxOf(frame);
    const plan = planFor(frame, foot, { height: 1, build: 1.3 });
    const w = box.x1 - box.x0 + 1;
    for (const off of plan.cols) {
      const col = foot.x + off;
      expect(col).toBeGreaterThanOrEqual(box.x0 + Math.floor(0.2 * w));
      expect(col).toBeLessThan(box.x1 - Math.floor(0.2 * w));
    }
  });

  it('never resamples: every output row is a whole input row, in order, and no colour is new', () => {
    const plan = planFor(frame, foot, { height: 1.2, build: 1 });
    const b = bakeFrame(frame, foot, plan);
    const squash = (r: Raw): string[] => {
      const rows = Array.from({ length: r.h }, (_, y) => rowOf(r, y));
      return rows.filter((row, y) => y === 0 || row !== rows[y - 1]);
    };
    // Repeating a row only makes a row appear twice, so with repeats collapsed the picture reads the same top to bottom.
    expect(squash(b.raw)).toEqual(squash(frame));
    expect(b.raw.h).toBe(frame.h + plan.rows.length);
    // Dropping works the same way: the output is the input with whole rows missing.
    const shorter = bakeFrame(frame, foot, planFor(frame, foot, { height: 0.7, build: 0.8 }));
    const colours = new Set<string>();
    for (let i = 0; i < frame.data.length; i += 4) colours.add(`${frame.data[i]},${frame.data[i + 1]},${frame.data[i + 2]},${frame.data[i + 3]}`);
    for (let i = 0; i < shorter.raw.data.length; i += 4) expect(colours.has(`${shorter.raw.data[i]},${shorter.raw.data[i + 1]},${shorter.raw.data[i + 2]},${shorter.raw.data[i + 3]}`)).toBe(true);
  });

  it('keeps the soles on the bottom row and moves the foot anchor with the pictures', () => {
    for (const p of [{ height: 1.3, build: 1.2 }, { height: 0.7, build: 0.8 }]) {
      const plan = planFor(frame, foot, p);
      const b = bakeFrame(frame, foot, plan);
      expect(boxOf(b.raw).y1 + 1, `${p.height}`).toBe(b.anchor.y);
      expect(b.anchor.y).toBe(foot.y + Math.sign(p.height - 1) * plan.rows.length);
      // The anchor column is the same column of the figure as before (the one `mapX` says).
      expect(b.anchor.x).toBe(b.mapX(foot.x));
      // Re-measuring the feet from the baked picture finds them within a pixel of where the anchor went.
      expect(Math.abs(footAnchor([b.raw]).x - b.anchor.x)).toBeLessThanOrEqual(1);
    }
  });

  it('gives every frame of a loop the same picks, so they all come out the same size and the bounce survives', () => {
    const frames = [figure(40, 70, 0), figure(40, 70, 0), figure(40, 70, 0), figure(40, 70, -1), figure(40, 70, -1)];
    const anchor = footAnchor(frames);
    const plan = planFor(frames[0] as Raw, anchor, { height: 1.2, build: 1.15 });
    const sheet = bakeSheet(frames, anchor, plan);
    const sizes = new Set(sheet.frames.map((f) => `${f.w}x${f.h}`));
    expect(sizes.size).toBe(1);
    // A frame that bobs up one row is still one row higher than the others after the bake.
    expect(boxOf(sheet.frames[3] as Raw).y1).toBe(boxOf(sheet.frames[0] as Raw).y1 - 1);
    for (const b of sheet.baked) {
      expect(b.rows).toBe(plan.rows.length);
      expect(b.cols).toBe(plan.cols.length);
    }
  });

  it('reports where a point went, for the face and for a move’s contact point', () => {
    const plan = planFor(frame, foot, { height: 1.3, build: 1.3 });
    const b = bakeFrame(frame, foot, plan);
    // Rows are only added below the head, so a point in the head keeps its row.
    expect(b.mapY(boxOf(frame).y0 + 3)).toBe(boxOf(frame).y0 + 3);
    // Contacts: a point beyond the feet moves out by the columns added between; a point at the feet does not move.
    expect(throughColumns(plan, 0)).toBe(0);
    expect(throughColumns(plan, 30)).toBe(30 + plan.cols.filter((o) => o >= 0 && o < 30).length);
    expect(throughColumns(plan, -30)).toBe(-30 - plan.cols.filter((o) => o >= -30 && o < 0).length);
    expect(throughRows(plan, 0)).toBe(0);
    expect(throughRows(plan, 200)).toBe(200 + plan.rows.length);
  });

  it('a pick that falls in another pose’s head or feet is skipped for that frame only (guard)', () => {
    // A crouching pose: the same figure but 20 rows shorter, standing on the same soles.
    const crouch = figure(40, 50, 0);
    const plan = planFor(frame, foot, { height: 1.3, build: 1 });
    const free = bakeFrame(crouch, ANCHOR(crouch), plan, false);
    const guarded = bakeFrame(crouch, ANCHOR(crouch), plan, true);
    expect(guarded.rows).toBeLessThanOrEqual(free.rows);
    // No row of the crouch's head was repeated.
    const box = boxOf(crouch);
    const headEnd = box.y0 + Math.floor(HEAD_SHARE * (box.y1 - box.y0 + 1));
    for (let y = 0; y < headEnd; y++) expect(rowOf(guarded.raw, y)).toBe(rowOf(crouch, y));
  });
});

describe('the texture name', () => {
  it('changes with either number', () => {
    expect(proportionTag({ height: 1, build: 1 })).not.toBe(proportionTag({ height: 1.01, build: 1 }));
    expect(proportionTag({ height: 1, build: 1 })).not.toBe(proportionTag({ height: 1, build: 1.01 }));
  });
});

// ------------------------------------------------------------------ Mark's real sheets

const FOLDER = join(process.cwd(), 'spritefusion-tests', 'extracted');
const HAVE = existsSync(join(FOLDER, 'kit-battle-idle', 'spritesheet.png'));
const maybe = HAVE ? describe : describe.skip;

function sheetOf(id: string): { frames: Raw[]; meta: { frame_w: number; frame_count: number } } {
  const dir = join(FOLDER, `${id}-battle-idle`);
  const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8')) as { frame_w: number; frame_count: number };
  return { frames: cutSheet(readPng(join(dir, 'spritesheet.png')), meta.frame_w, meta.frame_count), meta };
}

maybe("Mark's idle sheets", () => {
  // What the approved prototype (iteration 2) measured on frame 0: [width, height] as drawn and after.
  const PROTOTYPE: Record<string, { drawn: [number, number]; baked: [number, number] }> = {
    kit: { drawn: [36, 63], baked: [36, 66] },
    rook: { drawn: [79, 68], baked: [85, 73] },
    hex: { drawn: [50, 61], baked: [50, 49] },
    sable: { drawn: [55, 60], baked: [63, 76] },
  };

  for (const id of CREW_IDS) {
    it(`${id}: frame 1 comes out the size the prototype made, and every frame of the loop takes the same picks`, () => {
      const { frames } = sheetOf(id);
      const anchor = footAnchor(frames);
      const p = fixtureHeroes()[id] ?? { height: 1, build: 1 };
      const first = frames[0] as Raw;
      const plan = planFor(first, anchor, p);
      const sheet = bakeSheet(frames, anchor, plan);
      const want = PROTOTYPE[id];
      expect(want).toBeDefined();
      const drawn = sizeOf(first);
      expect([drawn.w, drawn.h]).toEqual(want?.drawn);
      const baked = sizeOf(sheet.frames[0] as Raw);
      expect([baked.w, baked.h]).toEqual(want?.baked);
      // Every frame takes every pick (none is skipped) and is the same size.
      for (const b of sheet.baked) {
        expect(b.rows).toBe(plan.rows.length);
        expect(b.cols).toBe(plan.cols.length);
      }
      // The body keeps its shape from frame to frame: each frame grows by exactly the same number of rows and columns.
      for (const [i, f] of frames.entries()) {
        const before = sizeOf(f);
        const after = sizeOf(sheet.frames[i] as Raw);
        expect(after.h - before.h, `frame ${i} height change`).toBe(Math.sign(p.height - 1) * plan.rows.length);
        expect(after.w - before.w, `frame ${i} width change`).toBe(Math.sign(p.build - 1) * plan.cols.length);
      }
    });

    it(`${id}: the soles stay on the bottom, the head rows are untouched, and 1.0 changes nothing`, () => {
      const { frames } = sheetOf(id);
      const anchor = footAnchor(frames);
      const first = frames[0] as Raw;
      const identity = bakeSheet(frames, anchor, planFor(first, anchor, { height: 1, build: 1 }));
      for (const [i, f] of identity.frames.entries()) expect(Array.from(f.data)).toEqual(Array.from((frames[i] as Raw).data));
      const tall = bakeSheet(frames, anchor, planFor(first, anchor, { height: 1.3, build: 1 }));
      const bottom = Math.max(...frames.map((f) => boxOf(f).y1));
      const grown = tall.frames.length ? Math.max(...tall.frames.map((f) => boxOf(f).y1)) : 0;
      expect(grown - bottom).toBe(tall.anchor.y - anchor.y);
      const box = boxOf(first);
      const headRows = Math.floor(HEAD_SHARE * (box.y1 - box.y0 + 1));
      for (let y = 0; y < box.y0 + headRows; y++) expect(rowOf(tall.frames[0] as Raw, y)).toBe(rowOf(first, y));
    });
  }
});

// Mark's heroes.json as it is now, baked onto his real sheets. Invariants only: the bake keeps its promise for whatever numbers he
// chose, and the heroes keep their ancestry order in the baked pictures (measured, not read from the file).
maybe("the shipped heroes baked onto Mark's idle sheets", () => {
  const bakedSizes = (): Record<string, { w: number; h: number }> => {
    const out: Record<string, { w: number; h: number }> = {};
    for (const id of CREW_IDS) {
      const { frames } = sheetOf(id);
      const anchor = footAnchor(frames);
      const p = shippedHeroes()[id] ?? { height: 1, build: 1 };
      const first = frames[0] as Raw;
      const drawn = sizeOf(first);
      const baked = sizeOf(bakeSheet(frames, anchor, planFor(first, anchor, p)).frames[0] as Raw);
      // The promise of the bake, for any numbers: the figure comes out exactly the target size.
      expect(baked, `${id} baked size`).toEqual(targetSize(drawn.w, drawn.h, p));
      out[id] = baked;
    }
    return out;
  };

  it('every hero comes out exactly the size the bake promises', () => {
    bakedSizes();
  });

  it('keeps the ancestry order in the baked heights: Hex shorter than Kit and Rook, Sable the tallest, Rook at least as tall as Kit', () => {
    const h = bakedSizes();
    const tall = (id: string): number => (h[id] as { h: number }).h;
    expect(tall('hex')).toBeLessThan(tall('kit'));
    expect(tall('hex')).toBeLessThan(tall('rook'));
    expect(tall('sable')).toBeGreaterThan(tall('kit'));
    expect(tall('sable')).toBeGreaterThan(tall('rook'));
    expect(tall('rook')).toBeGreaterThanOrEqual(tall('kit'));
  });
});
