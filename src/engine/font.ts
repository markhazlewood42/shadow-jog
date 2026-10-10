/**
 * The game font moved into the engine in M3 (src/sje/display/font.ts); this file keeps the old path, so the ~35 files that import it do not change.
 * The font is plain code (no Pixi, no GL), so the shipped game's bundle holds it as before.
 */
export * from '../sje/display/font';
