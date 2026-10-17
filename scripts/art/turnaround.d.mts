import type { Img } from './pixkit/index.mjs';
export const ORDER: { id: string; label: string; from?: string }[];
export function flipX(img: Img): Img;
export function buildTurnaround(
  sprites: { given: Img; down: Img; up: Img; right: Img; upRight: Img },
  katana?: string[],
): { sheet: Img; cells: { id: string; label: string; mirror: boolean; img: Img }[]; notes: string[] };
