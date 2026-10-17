import type { Img } from './pixkit/index.mjs';
export function colorsOf(img: Img): string[];
export function luminance(c: string | number[]): number;
export function bbox(img: Img): { x0: number; y0: number; x1: number; y1: number; w: number; h: number } | null;
export function headWidth(img: Img): number;
export function orphans(img: Img): number[][];
export function smallRegionsPosterized(img: Img): number;
export function measureFrame(
  img: Img,
  nearBlack?: string[] | null,
): {
  colors: number;
  bodyHeight: number;
  bboxWidth: number;
  bottomRow: number;
  headWidth: number;
  outlineRatio: number;
  edgePixels: number;
  orphans: number;
  smallRegions: number;
  smallRegionsSameColor: number;
  clusterSize: { min: number; median: number; max: number; regions: number };
};
