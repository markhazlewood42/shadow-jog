// The pixel-art authoring kit: a grid with a locked palette, and the drawing operations that keep it clean.
// A Grid holds one color string ("#rrggbb", lower case) or null (transparent) per cell. There is no alpha in between,
// so a Grid can never hold a half-transparent pixel. Setting a color that is not in the palette throws.
import { hex, newImage, unhex } from './png.mjs';

const norm = (c) => {
  unhex(c);
  return c.toLowerCase();
};

export class Grid {
  /** @param {number} w @param {number} h @param {string[]} palette the only colors the grid may hold */
  constructor(w, h, palette) {
    this.w = w;
    this.h = h;
    this.palette = new Set(palette.map(norm));
    this.cells = new Array(w * h).fill(null);
  }

  inside(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** The color at x,y, or null for transparent. Out of bounds reads as null. */
  get(x, y) {
    return this.inside(x, y) ? this.cells[y * this.w + x] : null;
  }

  /** Set one cell. Throws on a color outside the palette and on a cell outside the grid. null clears the cell. */
  set(x, y, color) {
    if (!this.inside(x, y)) throw new RangeError(`pixel ${x},${y} is outside the ${this.w}x${this.h} grid`);
    if (color === null) {
      this.cells[y * this.w + x] = null;
      return this;
    }
    const c = norm(color);
    if (!this.palette.has(c)) throw new Error(`color ${c} is not in the palette (pixel ${x},${y})`);
    this.cells[y * this.w + x] = c;
    return this;
  }

  clone() {
    const g = new Grid(this.w, this.h, [...this.palette]);
    g.cells = this.cells.slice();
    return g;
  }

  /** Same size and cells? */
  equals(other) {
    return this.w === other.w && this.h === other.h && this.cells.every((c, i) => c === other.cells[i]);
  }

  /** Count of opaque cells. */
  count() {
    return this.cells.filter((c) => c !== null).length;
  }

  /** Make a grid from an image { w, h, data }. Throws on a half-transparent pixel or an off-palette color. */
  static fromImage(img, palette) {
    const g = new Grid(img.w, img.h, palette);
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4;
        const a = img.data[i + 3];
        if (a === 0) continue;
        if (a !== 255) throw new Error(`half-transparent pixel at ${x},${y} (alpha ${a})`);
        g.set(x, y, hex(img.data[i], img.data[i + 1], img.data[i + 2]));
      }
    }
    return g;
  }

  /** To an image { w, h, data }. */
  toImage() {
    const img = newImage(this.w, this.h);
    this.cells.forEach((c, i) => {
      if (c === null) return;
      img.data.set([...unhex(c), 255], i * 4);
    });
    return img;
  }
}

/** A clean 1 px line between two cells (Bresenham, all octants, both ends included). Returns the grid. */
export function line(g, x0, y0, x1, y1, color) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    g.set(x, y, color);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return g;
}

/**
 * An ellipse by the midpoint method, centered on cell cx,cy with integer radii rx, ry (so it is (2rx+1) by (2ry+1) cells).
 * `fill: true` fills the inside too.
 */
export function ellipse(g, cx, cy, rx, ry, color, { fill = false } = {}) {
  const put = (x, y) => g.set(x, y, color);
  const span = (x0, x1, y) => {
    for (let x = x0; x <= x1; x++) put(x, y);
  };
  const plot4 = (x, y) => {
    if (fill) {
      span(cx - x, cx + x, cy + y);
      if (y !== 0) span(cx - x, cx + x, cy - y);
    } else {
      put(cx + x, cy + y);
      put(cx - x, cy + y);
      put(cx + x, cy - y);
      put(cx - x, cy - y);
    }
  };
  if (rx === 0 || ry === 0) {
    // A degenerate ellipse is a line.
    return line(g, cx - rx, cy - ry, cx + rx, cy + ry, color);
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  let x = 0;
  let y = ry;
  let px = 0;
  let py = 2 * rx2 * y;
  let p = ry2 - rx2 * ry + 0.25 * rx2;
  while (px < py) {
    plot4(x, y);
    x++;
    px += 2 * ry2;
    if (p < 0) {
      p += ry2 + px;
    } else {
      y--;
      py -= 2 * rx2;
      p += ry2 + px - py;
    }
  }
  p = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
  while (y >= 0) {
    plot4(x, y);
    y--;
    py -= 2 * rx2;
    if (p > 0) {
      p += rx2 - py;
    } else {
      x++;
      px += 2 * ry2;
      p += rx2 - py + px;
    }
  }
  return g;
}

/** A new grid, flipped left to right. A mirror also moves any asymmetric part (a carried item) to the other side. */
export function mirror(g) {
  const out = new Grid(g.w, g.h, [...g.palette]);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) out.cells[y * g.w + (g.w - 1 - x)] = g.cells[y * g.w + x];
  return out;
}

/** Flood fill (4-connected) from x,y: every connected cell with the same value as the start takes `color` (null clears). Returns the cells changed as [[x, y], ...]. */
export function floodFill(g, x, y, color) {
  if (!g.inside(x, y)) throw new RangeError(`pixel ${x},${y} is outside the grid`);
  const from = g.get(x, y);
  const to = color === null ? null : norm(color);
  if (to !== null && !g.palette.has(to)) throw new Error(`color ${to} is not in the palette`);
  if (from === to) return [];
  const changed = [];
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (!g.inside(cx, cy) || g.get(cx, cy) !== from) continue;
    g.set(cx, cy, to);
    changed.push([cx, cy]);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return changed;
}

const N4 = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/**
 * Outline pass: every transparent cell that touches an opaque cell (4 neighbors) takes `color`. Returns a new grid and leaves
 * the input alone. A cell outside the grid is never drawn, so leave a 1 px margin around the figure.
 */
export function outline(g, color) {
  const out = g.clone();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== null) continue;
      if (N4.some(([dx, dy]) => g.get(x + dx, y + dy) !== null)) out.set(x, y, color);
    }
  }
  return out;
}

/**
 * Selective outline (selout): like `outline`, but each outline cell takes a darker shade of the fill next to it, from
 * `ramp` (a map of fill color to its darker outline shade). When a cell touches several fills, the neighbor is chosen in
 * the order up, left, right, down. A fill missing from the ramp uses `fallback`; with no fallback it throws.
 */
export function selout(g, ramp, fallback = null) {
  const map = new Map(Object.entries(ramp).map(([k, v]) => [norm(k), norm(v)]));
  const out = g.clone();
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== null) continue;
      let fill = null;
      for (const [dx, dy] of N4) {
        const c = g.get(x + dx, y + dy);
        if (c !== null) {
          fill = c;
          break;
        }
      }
      if (fill === null) continue;
      const shade = map.get(fill) ?? fallback;
      if (shade === null) throw new Error(`no selout shade for fill ${fill} (pixel ${x},${y}) and no fallback`);
      out.set(x, y, shade);
    }
  }
  return out;
}

/**
 * Region edits as a grid diff. `edits` is a list of { x, y, color } (color null clears). Applies them in order to `g` and
 * returns what changed as [{ x, y, from, to }]. An edit that sets the color a cell already has is not in the result.
 * An off-palette color throws and, because the edits are checked first, nothing is applied.
 */
export function applyDiff(g, edits) {
  for (const e of edits) {
    if (!g.inside(e.x, e.y)) throw new RangeError(`pixel ${e.x},${e.y} is outside the grid`);
    if (e.color !== null && !g.palette.has(norm(e.color))) throw new Error(`color ${e.color} is not in the palette (pixel ${e.x},${e.y})`);
  }
  const changed = [];
  const first = new Map();
  for (const e of edits) {
    const key = e.y * g.w + e.x;
    const before = g.get(e.x, e.y);
    if (!first.has(key)) first.set(key, before);
    g.set(e.x, e.y, e.color);
  }
  for (const [key, from] of first) {
    const x = key % g.w;
    const y = (key - x) / g.w;
    const to = g.get(x, y);
    if (from !== to) changed.push({ x, y, from, to });
  }
  return changed;
}

/** The differences between two same-size grids as [{ x, y, from, to }] (from is in `a`, to is in `b`). */
export function diffGrids(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('grids differ in size');
  const out = [];
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const from = a.get(x, y);
      const to = b.get(x, y);
      if (from !== to) out.push({ x, y, from, to });
    }
  }
  return out;
}
