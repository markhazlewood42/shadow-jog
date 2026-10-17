export interface Img { w: number; h: number; data: Uint8Array }
export interface Change { x: number; y: number; from: string | null; to: string | null }
export class Grid {
  w: number;
  h: number;
  palette: Set<string>;
  cells: (string | null)[];
  constructor(w: number, h: number, palette: string[]);
  inside(x: number, y: number): boolean;
  get(x: number, y: number): string | null;
  set(x: number, y: number, color: string | null): this;
  clone(): Grid;
  equals(other: Grid): boolean;
  count(): number;
  static fromImage(img: Img, palette: string[]): Grid;
  toImage(): Img;
}
export function line(g: Grid, x0: number, y0: number, x1: number, y1: number, color: string): Grid;
export function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, color: string, opts?: { fill?: boolean }): Grid;
export function mirror(g: Grid): Grid;
export function floodFill(g: Grid, x: number, y: number, color: string | null): number[][];
export function outline(g: Grid, color: string): Grid;
export function selout(g: Grid, ramp: Record<string, string>, fallback?: string | null): Grid;
export function applyDiff(g: Grid, edits: { x: number; y: number; color: string | null }[]): Change[];
export function diffGrids(a: Grid, b: Grid): Change[];
export function readPng(path: string): Img;
export function writePng(img: Img, path: string): void;
export function newImage(w: number, h: number, rgba?: number[]): Img;
export function crop(img: Img, x: number, y: number, w: number, h: number): Img;
export function frames(img: Img, fw: number, fh: number): Img[];
export function hex(r: number, g: number, b: number): string;
export function unhex(s: string): number[];
