/** The pixel-art kit (scripts/art/pixkit): palette lock, line, ellipse, mirror, flood fill, outline, selout, diff. */
import { describe, expect, it } from 'vitest';
import { applyDiff, ellipse, floodFill, Grid, line, mirror, outline, selout } from '../scripts/art/pixkit/index.mjs';

const A = '#112233';
const B = '#aabbcc';
const C = '#445566';
const PAL = [A, B, C];
const on = (g: Grid) => g.cells.flatMap((c, i) => (c ? [[i % g.w, Math.floor(i / g.w)]] : []));

describe('Grid palette lock', () => {
  it('throws on an off-palette color and leaves the cell alone', () => {
    const g = new Grid(4, 4, PAL);
    expect(() => g.set(1, 1, '#ff0000')).toThrow(/not in the palette/);
    expect(g.get(1, 1)).toBeNull();
    g.set(1, 1, A.toUpperCase());
    expect(g.get(1, 1)).toBe(A);
  });
  it('throws outside the grid and on a half-transparent image', () => {
    const g = new Grid(2, 2, PAL);
    expect(() => g.set(2, 0, A)).toThrow(RangeError);
    const img = g.toImage();
    img.data.set([0x11, 0x22, 0x33, 128], 0);
    expect(() => Grid.fromImage(img, PAL)).toThrow(/half-transparent/);
  });
  it('round-trips through an image', () => {
    const g = new Grid(3, 2, PAL);
    g.set(0, 0, A).set(2, 1, B);
    expect(Grid.fromImage(g.toImage(), PAL).equals(g)).toBe(true);
  });
});

describe('line', () => {
  it('draws a horizontal line with both ends', () => {
    const g = line(new Grid(8, 3, PAL), 1, 1, 6, 1, A);
    expect(on(g)).toEqual([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]);
  });
  it('draws a 45 degree diagonal, and the same line in reverse', () => {
    const f = line(new Grid(5, 5, PAL), 0, 0, 4, 4, A);
    expect(on(f)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
    expect(line(new Grid(5, 5, PAL), 4, 4, 0, 0, A).equals(f)).toBe(true);
  });
  it('draws a shallow line with one pixel per column', () => {
    const g = line(new Grid(9, 4, PAL), 0, 0, 8, 3, A);
    expect(g.count()).toBe(9);
    for (let x = 0; x < 9; x++) expect([0, 1, 2, 3].filter((y) => g.get(x, y)).length).toBe(1);
  });
});

describe('ellipse', () => {
  it('draws a circle of radius 2 as a ring of 12 cells', () => {
    const g = ellipse(new Grid(7, 7, PAL), 3, 3, 2, 2, A);
    for (const [x, y] of [[3, 1], [1, 3], [5, 3], [3, 5]] as const) expect(g.get(x, y)).toBe(A);
    expect(g.get(3, 3)).toBeNull();
    expect(g.count()).toBe(12);
  });
  it('fills a circle of radius 2 to 21 cells and spans width 2rx+1', () => {
    const g = ellipse(new Grid(7, 7, PAL), 3, 3, 2, 2, A, { fill: true });
    expect(g.count()).toBe(21);
    const wide = ellipse(new Grid(12, 7, PAL), 5, 3, 5, 2, A, { fill: true });
    expect(wide.get(0, 3)).toBe(A);
    expect(wide.get(10, 3)).toBe(A);
    expect(wide.get(11, 3)).toBeNull();
  });
  it('is symmetric left to right', () => {
    const g = ellipse(new Grid(13, 9, PAL), 6, 4, 6, 4, A);
    expect(mirror(g).equals(g)).toBe(true);
  });
});

describe('mirror', () => {
  it('flips left to right and moves an asymmetric cell to the other side', () => {
    const g = new Grid(5, 2, PAL);
    g.set(0, 0, A).set(1, 1, B);
    const m = mirror(g);
    expect(m.get(4, 0)).toBe(A);
    expect(m.get(3, 1)).toBe(B);
    expect(m.get(0, 0)).toBeNull();
    expect(g.get(0, 0)).toBe(A);
    expect(mirror(m).equals(g)).toBe(true);
  });
});

describe('floodFill', () => {
  it('fills the 4-connected region only and returns the cells changed', () => {
    const g = new Grid(5, 5, PAL);
    line(g, 2, 0, 2, 4, A);
    const changed = floodFill(g, 0, 0, B);
    expect(changed.length).toBe(10);
    expect(g.get(1, 4)).toBe(B);
    expect(g.get(3, 0)).toBeNull();
  });
  it('does not leak through a diagonal gap', () => {
    const g = new Grid(3, 3, PAL);
    g.set(1, 0, A).set(0, 1, A);
    floodFill(g, 0, 0, B);
    expect(g.get(0, 0)).toBe(B);
    expect(g.get(1, 1)).toBeNull();
  });
  it('refuses an off-palette color', () => {
    expect(() => floodFill(new Grid(2, 2, PAL), 0, 0, '#ff0000')).toThrow(/palette/);
  });
});

describe('outline and selout', () => {
  it('outline adds the 4 edge cells around one pixel and leaves the input alone', () => {
    const g = new Grid(5, 5, PAL).set(2, 2, B);
    const o = outline(g, A);
    expect(o.count()).toBe(5);
    expect(o.get(2, 1)).toBe(A);
    expect(o.get(1, 1)).toBeNull();
    expect(g.count()).toBe(1);
  });
  it('selout takes the darker shade of the neighbor fill, and throws with no shade and no fallback', () => {
    const g = new Grid(7, 5, PAL).set(2, 2, B).set(4, 2, C);
    const o = selout(g, { [B]: A, [C]: A });
    expect(o.get(1, 2)).toBe(A);
    expect(o.get(3, 2)).toBe(A);
    expect(() => selout(g, { [B]: A })).toThrow(/no selout shade/);
    expect(selout(g, { [B]: A }, C).get(5, 2)).toBe(C);
  });
  it('selout gives each fill its own shade', () => {
    const two = new Grid(5, 5, PAL).set(2, 2, B).set(2, 3, C);
    const s = selout(two, { [B]: A, [C]: B });
    expect(s.get(1, 2)).toBe(A);
    expect(s.get(1, 3)).toBe(B);
  });
});

describe('applyDiff', () => {
  it('applies edits and returns only what changed', () => {
    const g = new Grid(3, 3, PAL).set(0, 0, A);
    const changed = applyDiff(g, [
      { x: 0, y: 0, color: A },
      { x: 1, y: 1, color: B },
      { x: 2, y: 2, color: C },
      { x: 2, y: 2, color: null },
    ]);
    expect(changed).toEqual([{ x: 1, y: 1, from: null, to: B }]);
    expect(g.get(1, 1)).toBe(B);
    expect(g.get(2, 2)).toBeNull();
  });
  it('applies nothing when one edit is off-palette', () => {
    const g = new Grid(3, 3, PAL);
    expect(() =>
      applyDiff(g, [
        { x: 0, y: 0, color: A },
        { x: 1, y: 1, color: '#ff0000' },
      ]),
    ).toThrow(/palette/);
    expect(g.count()).toBe(0);
  });
});
