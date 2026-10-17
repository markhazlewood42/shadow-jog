import type { Img } from '../../pixkit/index.mjs';
import type { DetailMask, FacingRules, Layout, Letters, Provenance, Spec, TransplantResult } from './index.mjs';

export const DEFAULT_OUT: string;
export const ALL_FACINGS: string[];
export const PROV_COLORS: Record<string, [number, number, number]>;
export interface FacingBuild {
  facing: string; letters: Letters; prov: Provenance[]; transplant: TransplantResult; painted: number[]; outlined: number[]; detail: DetailMask;
  invented: number; inventedFinal: number; layout: Layout; cellLabel: (string | null)[];
}
export function buildFacing(spec: Spec, opts: { letters: Letters; labels: (string | null)[]; facing: string; seed?: number; rules?: FacingRules; givenLayout?: Layout | null }): FacingBuild;
export function labelRows(res: { letters: Letters; cellLabel: (string | null)[] }): string;
export function lettersToImage(letters: Letters): Img;
export function partsImage(template: Layout['template']): Img;
export function provImage(res: { letters: Letters; prov: Provenance[] }): Img;
export function main(argv: string[]): number;
