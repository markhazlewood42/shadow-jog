/**
 * The battle stage on the Shadow Jog Engine: game code that runs on `src/sje` (docs/engine/migration.md section 6; step B1 of the
 * engine-platform spike). Imports the engine only through its facade (`../sje`). DEV only until the new engine ships: nothing the shipped
 * game loads imports this folder (tests/sje-imports.test.ts checks).
 */
export { chooseSprites, haveMarksSheets, loadStageAssets, loadStageData, type SpriteChoice, type StageData, withSeed } from './boot';
export { Figure, type FigureParts, type FigureSpec, type SheetPlay, type Side } from './figure';
export { BattleStageScene, type BattleStageInit } from './stagescene';
export type { SheetMeta } from './textures';
