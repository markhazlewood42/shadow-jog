import type { Img } from '../pixkit/index.mjs';

export interface PartMap {
  w: number;
  h: number;
  parts: Record<string, number[]>;
}
export interface Violation {
  name: string;
  x?: number;
  y?: number;
  part?: string;
  [k: string]: unknown;
}
export interface Mask {
  w: number;
  h: number;
  cells: Uint8Array;
}
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface PartMotif {
  cells: number;
  T?: number;
  S?: number;
  D?: number;
  orphans?: number;
  colors?: number;
  runs?: { max: number; hist: Record<string, number> };
  letters?: Record<string, number>;
  families?: string[];
}
export interface NamedBox extends Box {
  name: string;
  part: string;
  cells: number;
  opaque: number;
  partCells: number;
  how: string;
}
export interface ScoreRow {
  name: string;
  value: number;
  band: string;
  pass: boolean;
  extra: string;
}
export interface RegionScore {
  ok: boolean;
  failed: string[];
  rows: ScoreRow[];
  cand: { T: number; S: number; D: number; orphans: number; opaque: number };
  ref: { T: number; S: number; D: number; orphans: number; opaque: number };
  exactOpaque: { hit: number; of: number };
}
export interface MaskCheck {
  ok: boolean;
  violations: Violation[];
  height: number;
  bottomRow: number;
  headAlone: number;
}
export interface Planted {
  frame: number;
  foot: 'L' | 'R' | 'LR';
  dL: number;
  dR: number;
  shift: number;
}
export interface WalkRecord {
  bottomRow: number[];
  topRow: number[];
  headBobRow: number[];
  plantedFoot: ('L' | 'R' | 'LR')[];
  maxPlantedShift: number;
}
export interface ClassResult {
  cells: (string | null)[];
  counts: { copy: number; transform: number; invent: number };
  total: number;
  share: number;
}

// decompose
export const PARTS: Record<string, { code: string; families: string[] }>;
export const PART_NAMES: string[];
export const SHEATH_PARTS: string[];
export const HEAD_PARTS: string[];
export function buildPartMap(img: Img, overrides?: Record<string, string>): PartMap;
export function loadOverrides(): Record<string, string>;
export function labelsOf(pm: PartMap): string[][];
export function partAt(pm: PartMap, x: number, y: number, labels?: string[][]): string | null;
export function rampLockViolations(img: Img, pm: PartMap): Violation[];
export function validatePartMap(img: Img, pm: PartMap, opts?: { rules?: boolean }): { ok: boolean; violations: Violation[] };
export function measureCells(comp: Img, cells: number[]): { T: number; S: number; D: number; orphans: number; opaque: number };
export function motifOf(img: Img, pm: PartMap, opts?: { blank?: Box | null }): Record<string, PartMotif>;
export function motifRules(motif: Record<string, PartMotif>): Record<string, { letters: string; families: string[]; maxRun: number; T: number; S: number; D: number; orphans: number }>;
export function motifFailures(stored: Record<string, PartMotif>, fresh: Record<string, PartMotif>, tol?: number): Violation[];
export function hairWing(img: Img, pm: PartMap): number[];
export function partRows(pm: PartMap): string[];
export function partMapFromRows(rows: string[]): PartMap;
export function blankBoxImage(img: Img, b: Box): Img;
export function inBox(b: Box, x: number, y: number): boolean;

// masks
export const AXIS: number;
export const HEIGHT: number;
export const BOTTOM_ROW: number;
export const HEAD_ALONE: [number, number];
export const SHEATH_BAND: { from: [number, number]; to: [number, number]; thickness: number };
export function newMask(): Mask;
export function maskAt(m: Mask, x: number, y: number): number;
export function maskCount(m: Mask): number;
export function maskRows(m: Mask): string[];
export function maskFromRows(rows: string[]): Mask;
export function rowExtent(m: Mask, y: number): { lo: number; hi: number; width: number } | null;
export function headAloneWidth(m: Mask): number;
export function holes(m: Mask): [number, number][];
export function validateMask(m: Mask): MaskCheck;
export function symmetrize(m: Mask): Mask;
export function sheathBand(rule?: { from: [number, number]; to: [number, number]; thickness: number }): [number, number][];
export function buildMasks(img: Img, pm?: PartMap): { down: Mask; up: Mask; upRight: Mask; right: Mask | null; rightCheck: MaskCheck | null; upBand: [number, number][] };
export function rightFromIdle(idleFrame: Img, downMask: Mask): { mask: Mask; check: MaskCheck };
export function checkRight(mask: Mask, downMask: Mask): MaskCheck;
export function reduceAlpha(img: Img, targetH?: number): { w: number; h: number; cover: Float32Array };
export function givenHeadAlone(pm: PartMap): { width: number; at: { y: number; x0: number; x1: number } | null };
export function landmarkReport(mask: Mask, downMask: Mask): Record<string, { y: number; mask: number; given: number; within2: boolean }>;

// classify
export const FACINGS: string[];
export function classify(facing: string, mask: Mask, img: Img, pm: PartMap, opts?: { band?: [number, number][] }): ClassResult;
export const SOURCES: Record<string, (part: string, y: number) => 'copy' | 'transform' | null>;
export const HEM_ROW: number;
export function classifyAll(img: Img, pm?: PartMap): { masks: ReturnType<typeof buildMasks>; result: Record<string, ClassResult | null> };

// walk
export function bottomRow(f: Img): number;
export function headBobRow(f: Img): number;
export function footEdges(f: Img): { L: number; R: number } | null;
export function plantedFeet(frames: Img[]): Planted[];
export function measureWalk(frames: Img[]): WalkRecord & { planted: Planted[]; footEdges: ({ L: number; R: number } | null)[] };
export function checkWalk(frames: Img[], target: { bottomRow: number[]; headBobRow: number[]; plantedFoot: string[] }): { ok: boolean; lines: { name: string; pass: boolean; detail: unknown }[] };
export function walkRecord(frames: Img[]): WalkRecord;

// region
export const BANDS: { T: [number, number]; S: [number, number]; orphans: [number, number]; D: number };
export const BOX_CELLS: [number, number];
export const COAT_SHARE: number;
export function bandRange(ref: number, band: [number, number], unit: number): [number, number];
export function hairHalfRect(pm: PartMap): Box;
export function dominantRect(img: Img, pm: PartMap, part: string): { area: number; x0: number; y0: number; x1: number; y1: number } | null;
export const PASS: { exact: number; tolerant: number };
export function largestPartRect(pm: PartMap, part: string): { area: number; x0: number; y0: number; x1: number; y1: number } | null;
export function deriveBoxes(img: Img, pm: PartMap): { hairWing: NamedBox; coat: NamedBox };
export function blankRegion(img: Img, box: Box): Img;
export function scoreRegion(cand: Img, given: Img, box: Box): RegionScore;
export function flattenedCandidate(given: Img, box: Box): Img;
export function solidCandidate(given: Img, box: Box, letter: string): Img;

// sources
export const GIVEN_FRAME: number;
export const OUT_DIR: string;
export const TARGET_JSON: string;
export function loadGiven(): Img;
export function loadWalkFrames(): Img[];
export function loadIdleFrames(): Img[] | null;
export function readTarget(path?: string): { pipeline?: Record<string, any>; [k: string]: any };
