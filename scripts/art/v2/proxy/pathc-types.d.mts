// Types for path C: layout, ramp, transplant, code painter, detail mask. index.d.mts re-exports this file.
import type { Img } from '../../pixkit/index.mjs';
import type { Box, Spec, Template } from './index.mjs';

export type Letters = string[];
export interface FacingRule { id: string; r2: string; basis: string; [key: string]: unknown }
export interface FacingRules {
  format: string;
  light: { direction: string; basis: string; evidence: { lumaTop: number; lumaBottom: number; lumaRight: number; lumaLeft: number; source: string }; rule: string; relightOnFlip: string };
  allowList: { labels: string[]; rule: string; basis: string };
  rules: FacingRule[];
  params: {
    hideBelowVisibleShare: { value: number; basis: string };
    columnEdit: { maxColumns: number; minDelta: number; basis: string };
    overflowClip: { distance: number; basis: string };
    detailMaskCap: { value: number; basis: string };
    patch: { size: number; basis: string };
  };
  [key: string]: unknown;
}
export interface CellStats { cells: number; center: [number, number]; rows: [number, number]; cols: [number, number] }
export interface PartLayout {
  id: string; label: string; group: string | null; joint: string; mirrorOf: string | null;
  center: [number, number] | null; rows: [number, number] | null; cols: [number, number] | null;
  cells: number; visibleCells: number; visibleShare: number; aloneShare: number; hidden: boolean; hiddenByRule: boolean; depth: number | null; meanLevel: number | null;
}
export interface Layout {
  facing: string; yaw: number; template: Template; parts: Record<string, PartLayout>; order: string[]; groups: Record<string, CellStats | null>; light: Int8Array;
  rows: { head: number | null; eye: number | null; eyeLast: number | null; shoulder: number | null; hip: number | null; hem: number | null; foot: number | null };
  face: { axisCol: number | null; headCenter: number | null; offset: number | null };
  eyes: { lensParts: string[]; count: number; proxyCount: number; rowCenters: number[] };
}
export interface GroupCompare { cells: number; givenCells: number; iou: number; centerDist: number | null; rows: [number, number] | null; givenRows: [number, number] | null; dRowTop: number | null; dRowBottom: number | null; cols: [number, number] | null; givenCols: [number, number] | null }
export interface LayoutLine { ok: boolean; groups: Record<string, GroupCompare & { centerOk: boolean; rowsOk: boolean }>; mIoU: number; failures: string[] }
export const FACING_RULES_PATH: string;
export const LAYOUT_GROUPS: Record<string, string[]>;
export const GROUP_OF_LABEL: Record<string, string>;
export function loadFacingRules(path?: string): FacingRules;
export function ruleById(rules: FacingRules, id: string): FacingRule;
export function cellStats(cells: number[]): CellStats | null;
export function layoutFor(spec: Spec, facing: string, opts?: { rules?: FacingRules; template?: Template | null }): Layout;
export function layoutAll(spec: Spec, opts?: { rules?: FacingRules }): Record<string, Layout>;
export function groupsOfLabels(labels: (string | null)[]): (string | null)[];
export function compareGroups(layout: Layout, givenGroups: (string | null)[], opts?: { minCells?: number }): { per: Record<string, GroupCompare>; mIoU: number };
export function layoutLine(layout: Layout, givenGroups: (string | null)[], opts?: { centerTol?: number; rowTol?: number; miouMin?: number }): LayoutLine;
export function ruleChecks(by: Record<string, Layout>, spec: Spec, rules?: FacingRules): { id: string; ok: boolean; detail: string }[];

export function lumaOfLetter(letter: string): number | null;
export function isNearBlackLetter(letter: string): boolean;
export function letterRank(letter: string): number;
export function relightLetter(spec: Spec, id: string, letter: string, shift: number): string;
export function outlineLetter(spec: Spec, id: string, level: number | null | undefined): string;

export interface LayerCell { k: number; x: number; y: number; letter: string; level: number | null; edge: boolean }
export interface TransplantLayer { id: string; label: string; source: string | null; flip: boolean; dx: number; dy: number; drawn: number; clipped: number; hidden: 'share' | 'rule' | null; columnEdit: { column: number; delta: number } | null }
export interface CellOrigin { part: string; from: string; flip: boolean; srcK: number; srcEdge: boolean }
export type Provenance = 'copied' | 'flipped' | 'relit' | 'empty' | 'outside' | 'painted' | 'outline';
export interface TransplantResult {
  facing: string; yaw: number; letters: Letters; prov: Provenance[]; origin: (CellOrigin | null)[]; layers: TransplantLayer[]; silhouette: boolean[];
  counts: { copied: number; flipped: number; relit: number; empty: number; outside: number }; total: number; invented: number; layout: Layout;
}
export function lettersOfImage(img: Img): Letters;
export function cutLayers(spec: Spec, tSrc: Template, letters: Letters, labels: (string | null)[]): { layers: Record<string, { id: string; cells: LayerCell[] }>; assign: (string | null)[] };
export function chooseSource(spec: Spec, id: string, targetYaw: number, givenYaw: number, givenLayout: Layout, allowLabels: string[]): { id: string; flip: boolean; orient: number; cost: number; share: number };
export function editColumn<T>(cells: Map<string, T>, delta: number, letterOf?: (v: T) => string): { cells: Map<string, T>; edited: number | null };
export function distanceToMask(inMask: ArrayLike<boolean | number>): Float64Array;
export function transplant(spec: Spec, opts: { letters?: Letters; givenImg?: Img | null; labels: (string | null)[]; facing: string; rules?: FacingRules; layout?: Layout | null; givenLayout?: Layout | null }): TransplantResult;

export function mulberry32(seed: number): () => number;
export function levelsOfLetters(spec: Spec, letters: Letters, labels: (string | null)[]): (number | null)[];
export interface CodePaintResult { letters: Letters; filled: number[]; unfilled: number[]; picks: Record<number, { src: number; cost: number; tier: number }>; tiers: Record<number, number> }
export function codePaint(spec: Spec, opts: { letters: Letters; mask: ArrayLike<boolean | number>; labels: (string | null)[]; levels?: ArrayLike<number | null> | null; source: { letters: Letters; labels: (string | null)[]; levels: (number | null)[] }; exclude?: ArrayLike<boolean | number> | null; seed?: number; edge?: ArrayLike<boolean | number> | null }): CodePaintResult;
export function selOutline(spec: Spec, letters: Letters, opts: { labels: (string | null)[]; levels?: ArrayLike<number | null> | null; cells: number[] }): { letters: Letters; changed: number[] };
export function paintBox(spec: Spec, opts: { letters: Letters; labels: (string | null)[]; box: Box; seed?: number; facing?: string | null }): CodePaintResult & { box: Box; mask: number[]; template: Template };

export const DETAIL_KINDS: string[];
export interface DetailMask { cells: { k: number; x: number; y: number; kind: string }[]; count: number; opaque: number; share: number; cap: number; capped: boolean; available: Record<string, number> }
export function detailMask(opts: { letters: Letters; labels: (string | null)[]; prov: Provenance[]; origin?: (CellOrigin | null)[] | null; cap?: number | null; rules?: FacingRules | null }): DetailMask;
export function effectiveLabels(layout: Layout): (string | null)[];
