import type { Img } from './pixkit/index.mjs';
export interface LintItem { id: string; name: string; status: 'pass' | 'fail' | 'info' | 'skipped'; value: string; detail: string }
export const LINES: Record<string, number>;
export function lintFrame(img: Img, opts: { palette: string[] | Set<string>; ref?: Record<string, unknown> | null; refColors?: string[] | null; katana?: string[]; facing?: boolean; boxWidthReport?: boolean; ranges?: Record<string, unknown> | null }): LintItem[];
export function lintAnimation(frames: Img[]): LintItem[];
export function hasFail(items: LintItem[]): boolean;
export function lintFile(path: string, o?: Record<string, unknown>): { label: string; items: LintItem[] }[];
