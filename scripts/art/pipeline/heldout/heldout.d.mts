import type { Img } from '../../pixkit/index.mjs';
import type { PartMap, PartMotif } from '../index.mjs';
import type { NamedRect, Rect } from './boxkit.mjs';

export interface ScoreRow {
  name: string;
  value: number;
  band: string;
  pass: boolean;
  extra: string;
}
export interface RegionResult {
  ok: boolean;
  failed: string[];
  rows: ScoreRow[];
}
export interface GridScore {
  box: HeldBox;
  cand: Img;
  cells: string[][];
  res: RegionResult;
  mask: { outside: number; missing: number };
}
export interface Finding {
  file?: string;
  kind: string;
  [k: string]: unknown;
}
export interface Hidden {
  x: number;
  y: number;
  rgb: number[];
}
export const ROOT: string;
export const BOX_NAMES: string[];
export const TRUTH_PATHS: string[];
export function boxPaths(name: string, root?: string): { dir: string; kit: string; truth: string; score: string };
export type HeldBox = NamedRect & { cells: number; opaque: number; part: string };
export function getBox(name: string, img?: Img): HeldBox;
export function truthCells(img: Img, box: Rect): string[][];
export function blankedGiven(img: Img, box: Rect): Img;
export function maskImage(img: Img, box: Rect): Img;
export function maskCount(img: Img, box: Rect): number;
export function nearParts(blank: Img, pm: PartMap, box: Rect): string[];
export function boxMotif(img: Img, pm: PartMap, box: Rect): Record<string, PartMotif>;
export function rulesText(img: Img, box: Rect): string;
export function buildKit(name: string, opts?: { root?: string; img?: Img; validate?: boolean }): { dir: string; files: string[] };
export function scoreGrid(name: string, gridText: string, opts?: { img?: Img }): GridScore;
export function writeScoreViews(base: string, img: Img, box: Rect, cand: Img): string[];
export function formatScore(name: string, s: GridScore, title?: string): string;
export function listFiles(dir: string): string[];
export function hiddenCells(img: Img, box: Rect): Hidden[];
export function knownLayouts(box: Rect): { name: string; w: number; h: number; ox: number; oy: number; k: number; X0: number; Y0: number }[];
export function pngFindings(im: Img, hidden: Hidden[], box: Rect, opts?: { sweep?: boolean }): Finding[];
export function textFindings(text: string, img: Img, box: Rect): Finding[];
export function checkKit(kitDir: string, opts?: { img?: Img; box: Rect }): { ok: boolean; files: number; hidden: number; findings: Finding[] };
export function newImage(w: number, h: number, rgba?: number[]): Img;
export function paste(dst: Img, src: Img, x: number, y: number): void;
export function readPng(path: string): Img;
export function writePng(img: Img, path: string): void;
