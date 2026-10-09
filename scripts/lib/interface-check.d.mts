/** Types for scripts/lib/interface-check.mjs, so tests/sje-interfaces.test.ts can import it under `tsc --noEmit`. */
export const VALUE_LINES: Map<string, string>;
export const STUBS: string;
/** The `ts` code blocks of the doc, in order. */
export function blocksOf(md: string): string[];
/** One block, made ambient. */
export function ambient(block: string, index: number): string;
/** The whole generated file. */
export function buildCheckFile(md: string): string;
