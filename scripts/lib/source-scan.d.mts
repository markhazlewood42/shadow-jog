/** Types for scripts/lib/source-scan.mjs, so tests/screen-literals.test.ts can import it under `tsc --noEmit`. */
export interface TokenHit {
  /** 1-based line number in the file. */
  line: number;
  /** The token that matched, as given ("480", "W-16"). */
  token: string;
  /** The original source line, trimmed. */
  text: string;
}
export function stripNoise(source: string): string;
export function findTokens(source: string, tokens: readonly string[]): TokenHit[];
