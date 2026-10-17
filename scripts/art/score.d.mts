import type { Img } from './pixkit/index.mjs';
export interface Best { value: number; dx: number; dy: number }
export function shiftScores(cand: Img, key: Img, range?: number): { iou: Best; copy: Best };
export function scoreCandidate(
  cand: Img,
  key: Img,
  opts?: { range?: number; target?: { nearBlack?: string[] }; lint?: (img: Img) => unknown },
): {
  iou: { value: number; shift: number[] };
  copyMatch: { value: number; shift: number[] };
  colors: number;
  outlineRatio: number;
  bodyHeight: number;
  pixlint: unknown;
};
