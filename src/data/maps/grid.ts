/** Tiny builder for authoring terrain grids with rectangles instead of hand-typed rows. */
export class Grid {
  private cells: string[][];
  constructor(readonly w: number, readonly h: number, fill = '#') {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  }
  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ch);
    return this;
  }
  set(x: number, y: number, ch: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y]![x] = ch;
    return this;
  }
  /** Set a list of points. */
  dots(points: [number, number][], ch: string): this {
    for (const [x, y] of points) this.set(x, y, ch);
    return this;
  }
  /** Paste literal rows at (x, y); spaces in `rows` are skipped (transparent). */
  paste(x: number, y: number, rows: string[]): this {
    rows.forEach((r, dy) => {
      [...r].forEach((ch, dx) => {
        if (ch !== ' ') this.set(x + dx, y + dy, ch);
      });
    });
    return this;
  }
  get(x: number, y: number): string {
    return this.cells[y]?.[x] ?? ' ';
  }
  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }
}
