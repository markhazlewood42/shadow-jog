/** pixlint hard lines and the target.json numbers. A frame just inside a line passes; a frame just past it fails. */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import target from '../docs/spikes/rook-turnaround/target.json';
import { colorsOf, luminance, measureFrame } from '../scripts/art/metrics.mjs';
import { frames, newImage, readPng } from '../scripts/art/pixkit/index.mjs';
import { lintAnimation, lintFrame } from '../scripts/art/pixlint.mjs';
import { walkSheet } from './helpers/rookwalk';

const IDLE = 'public/art/crew/rook/idle/spritesheet.png';
const INK = [0x03, 0x01, 0x02, 255];

describe('target.json numbers reproduce from the sheets', () => {
  const walk = () => frames(readPng(walkSheet()), 32, 32);
  it('the given frame (4) measures what target.json says', () => {
    const given = walk()[target.givenFrame];
    if (!given) throw new Error('no given frame');
    const m = measureFrame(given);
    expect(target.givenFrame).toBe(4);
    expect(m.bodyHeight).toBe(31);
    expect(m.headWidth).toBe(19);
    expect(m.outlineRatio).toBe(0.9681);
    expect(m.orphans).toBe(32);
    expect(m.smallRegions).toBe(66);
    expect(m.colors).toBe(22);
    expect(target.given).toMatchObject({ bodyHeight: 31, headWidth: 19, outlineRatio: 0.9681, orphans: 32, smallRegions: 66, colors: 22 });
  });

  it('the sheet has 22 colors, 7 near-black, and the 8 frames match the doc ranges', () => {
    const fs = walk();
    const all = new Set(fs.flatMap((f) => colorsOf(f)));
    expect([...all].sort()).toEqual(target.walkPalette);
    expect(all.size).toBe(22);
    expect(target.walkPalette.filter((c) => luminance(c) < 60)).toEqual(target.nearBlack);
    expect(target.nearBlack).toHaveLength(7);
    const ms = fs.map((f) => measureFrame(f));
    expect(Math.min(...ms.map((m) => m.outlineRatio))).toBe(0.9444);
    expect(Math.max(...ms.map((m) => m.outlineRatio))).toBe(1);
    expect([Math.min(...ms.map((m) => m.orphans)), Math.max(...ms.map((m) => m.orphans))]).toEqual([22, 35]);
    expect([Math.min(...ms.map((m) => m.smallRegions)), Math.max(...ms.map((m) => m.smallRegions))]).toEqual([60, 72]);
    expect(ms.map((m) => m.smallRegions)).toEqual(target.frames.map((m) => m.smallRegions));
  });

  it('the battle idle has the 22 colors listed in target.json and shares none with the walk', () => {
    const idle = frames(readPng(IDLE), 79, 68);
    const pal = [...new Set(idle.flatMap((f) => colorsOf(f)))].sort();
    expect(pal).toEqual(target.battleIdle.palette);
    expect(pal).toHaveLength(22);
    expect(pal.filter((c) => target.walkPalette.includes(c))).toEqual([]);
  });
});

describe('pixlint hard lines (just inside passes, just past fails)', () => {
  const LIGHT = '#9ea5a8';
  const pal = [...target.walkPalette];
  const rgb = (c: string) => [Number.parseInt(c.slice(1, 3), 16), Number.parseInt(c.slice(3, 5), 16), Number.parseInt(c.slice(5, 7), 16), 255];
  /** A filled box of near-black ink at x0,y0, w by h, on a 32x32 frame. */
  const box = (x0: number, y0: number, w: number, h: number) => {
    const img = newImage(32, 32);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data.set(INK, (y * 32 + x) * 4);
    return img;
  };
  const ref = { bodyHeight: 20, headWidth: 12, bboxWidth: 12, bottomRow: 30, orphans: 8, smallRegions: 8, colors: 22, itemSide: null };
  const run = (img: ReturnType<typeof newImage>, extra: Record<string, unknown> = {}) => lintFrame(img, { palette: pal, ref, refColors: pal, katana: [], facing: true, ...extra });
  const status = (items: { id: string; name: string; status: string }[], id: string, name: string) => items.find((i) => i.id === id && i.name.startsWith(name))?.status;

  it('PA-03: outline 93 percent (a 10x10 box has 36 edge pixels: 2 light is 94.4% passes, 3 light is 91.7% fails)', () => {
    const lightEdge = (k: number) => {
      const img = box(10, 10, 10, 10);
      for (let i = 0; i < k; i++) img.data.set(rgb(LIGHT), (10 * 32 + 11 + i) * 4);
      return img;
    };
    expect(status(run(lightEdge(2)), 'PA-03', 'outline')).toBe('pass');
    expect(status(run(lightEdge(3)), 'PA-03', 'outline')).toBe('fail');
  });

  it('PA-07: body height within 1 px, both directions', () => {
    for (const [h, want] of [[19, 'pass'], [21, 'pass'], [18, 'fail'], [22, 'fail']] as const) expect(status(run(box(8, 30 - h + 1, 12, h)), 'PA-07', 'body height')).toBe(want);
  });

  it('PA-07: head width within 1 px, both directions', () => {
    for (const [w, want] of [[11, 'pass'], [13, 'pass'], [10, 'fail'], [14, 'fail']] as const) expect(status(run(box(8, 11, w, 20)), 'PA-07', 'head width')).toBe(want);
  });

  it('PA-06: feet bottom row within 1 px of the reference', () => {
    for (const [bottom, want] of [[29, 'pass'], [31, 'pass'], [28, 'fail']] as const) expect(status(run(box(8, bottom - 19, 12, 20)), 'PA-06', 'feet bottom row')).toBe(want);
  });

  it('PA-06: box width within 4 px of the reference', () => {
    for (const [w, want] of [[16, 'pass'], [8, 'pass'], [17, 'fail'], [7, 'fail']] as const) expect(status(run(box(4, 11, w, 20)), 'PA-06', 'box width')).toBe(want);
  });

  it('PA-06: the sprite must fit inside its cell', () => {
    expect(status(run(box(0, 0, 32, 32)), 'PA-06', 'sprite inside')).toBe('pass');
    expect(status(run(newImage(32, 32)), 'PA-06', 'sprite inside')).toBe('fail');
  });

  it('PA-08: 90 percent of pixels in the reference palette (100 px: 90 pass, 89 fail)', () => {
    const X = '#123456';
    const refPal = pal.filter((c) => c !== X);
    const mix = (off: number) => {
      const img = box(10, 10, 10, 10);
      for (let i = 0; i < off; i++) img.data.set(rgb(X), ((10 + Math.floor(i / 10)) * 32 + 10 + (i % 10)) * 4);
      return img;
    };
    const opts = { palette: [...pal, X], refColors: refPal };
    expect(status(run(mix(10), opts), 'PA-08', '>=')).toBe('pass');
    expect(status(run(mix(11), opts), 'PA-08', '>=')).toBe('fail');
  });

  it('PA-08 across facings: 90 percent of pixels use colors found in another image of the set (100 px: 90 pass, 89 fail)', () => {
    const X = '#123456';
    const others = pal.filter((c) => c !== X);
    const mix = (off: number) => {
      const img = box(10, 10, 10, 10);
      for (let i = 0; i < off; i++) img.data.set(rgb(X), ((10 + Math.floor(i / 10)) * 32 + 10 + (i % 10)) * 4);
      return img;
    };
    const opts = { palette: [...pal, X], setColors: others };
    const find = (items: { id: string; name: string; status: string; value: string }[], name: string) => items.find((i) => i.id === 'PA-08' && i.name.startsWith(name));
    const pass = run(mix(10), opts);
    expect(find(pass, '>= 90% of pixels use colors found')?.status).toBe('pass');
    expect(find(pass, '>= 90% of pixels use colors found')?.value).toContain('90.0%');
    const fail = run(mix(11), opts);
    expect(find(fail, '>= 90% of pixels use colors found')?.status).toBe('fail');
    expect(find(fail, '>= 90% of pixels use colors found')?.value).toContain('89.0%');
    // The old "step 3 adds it" line is replaced, and "same part, same color" stays a grader check.
    expect(find(pass, 'same part, same color')).toMatchObject({ status: 'skipped', value: 'grader check' });
    expect(pass.filter((i) => i.name.startsWith('same part, same color'))).toHaveLength(1);
    // Without the option the old line stays.
    expect(find(run(mix(10)), 'same part, same color')?.value).toBe('skipped');
  });

  it('PA-08 across facings: an image with no opaque pixels fails the share line (0 of 0 px), with no divide by zero', () => {
    const items = run(newImage(32, 32), { palette: pal, setColors: pal });
    const line = items.find((i) => i.id === 'PA-08' && i.name.startsWith('>= 90% of pixels use colors found'));
    expect(line?.status).toBe('fail');
    expect(line?.value).toContain('0 of 0 px');
  });

  it('--facings with no file names exits 2 with one line', () => {
    for (const v of ['', ',', ',,']) {
      const r = spawnSync('node', ['scripts/art/pixlint.mjs', IDLE, '--facings', v], { encoding: 'utf8' });
      expect(r.status).toBe(2);
      expect(r.stderr.trim().split('\n')).toHaveLength(1);
      expect(r.stderr).toContain('--facings needs');
    }
  });

  it('PA-04 and PA-09: 1.25x the reference count (reference 8: 10 passes, 11 fails)', () => {
    const dots = (n: number) => {
      const img = newImage(32, 32);
      for (let i = 0; i < n; i++) img.data.set(INK, ((2 + 3 * Math.floor(i / 8)) * 32 + 2 + 3 * (i % 8)) * 4);
      return img;
    };
    expect(status(run(dots(10)), 'PA-04', 'orphans')).toBe('pass');
    expect(status(run(dots(11)), 'PA-04', 'orphans')).toBe('fail');
    expect(status(run(dots(10)), 'PA-09', 'squint')).toBe('pass');
    expect(status(run(dots(11)), 'PA-09', 'squint')).toBe('fail');
  });

  it('PA-04 lists every orphan with x,y and tags head-area and outline orphans', () => {
    const img = newImage(32, 32);
    const pts = Array.from({ length: 12 }, (_, i): [number, number] => [2 + 2 * i, 5]);
    for (const [x, y] of pts) img.data.set(INK, (y * 32 + x) * 4);
    const detail = run(img).find((i) => i.id === 'PA-04')?.detail ?? '';
    for (const [x, y] of pts) expect(detail).toContain(`${x},${y}HO`);
    expect(detail).toContain('12 in head area (H), 12 on outline (O)');
  });

  it('PA-01: at most 32 colors, and 1.25x the reference color count (22 gives 27)', () => {
    const many = (n: number) => {
      const img = newImage(40, 1);
      const colors = Array.from({ length: n }, (_, i) => `#${(i + 16).toString(16).padStart(2, '0')}0000`);
      for (const [i, c] of colors.entries()) img.data.set(rgb(c), i * 4);
      return { img, colors };
    };
    const at = (n: number, withRef: boolean) => {
      const m = many(n);
      return status(lintFrame(m.img, withRef ? { palette: m.colors, ref } : { palette: m.colors }), 'PA-01', 'color count');
    };
    expect(at(32, false)).toBe('pass');
    expect(at(33, false)).toBe('fail');
    expect(at(27, true)).toBe('pass');
    expect(at(28, true)).toBe('fail');
  });

  it('PA-10: the box bottom row varies at most 2 px over an animation', () => {
    const at = (rows: number[]) => lintAnimation(rows.map((b) => box(8, b - 9, 10, 10)))[0]?.status;
    expect(at([28, 29, 30, 29])).toBe('pass');
    expect(at([27, 29, 30, 29])).toBe('fail');
  });
});
