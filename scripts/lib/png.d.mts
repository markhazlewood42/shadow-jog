/** Types for scripts/lib/png.mjs, so the e2e specs can import it under `tsc --noEmit`. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer;
export function decodePng(buf: Buffer): { width: number; height: number; data: Uint8Array };
