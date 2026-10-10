/**
 * The battle stage on the Shadow Jog Engine: game code that runs on `src/sje` (docs/engine/migration.md section 6; built in the engine-platform spike, promoted in M3
 * task 4). Imports the engine only through its facade (`../sje`). Nothing the shipped game's default path loads imports this folder: the engine's boot glue loads it
 * behind `?engine=sje` (M3 task 11), and tests/sje-imports.test.ts checks.
 */
export { chooseSprites, haveMarksSheets, loadStageAssets, loadStageData, type SpriteChoice, type StageData, withSeed } from './boot';
export { checkStageConfig } from './config';
export { Figure, type FigureParts, type FigureSpec, type SheetPlay, type Side } from './figure';
export { LEGACY_PUSH, type PushSpec, pushStrength, pushView, pushZoom } from './push';
export { BattleStageScene, type BattleStageInit, type FigureState, type StageSnapshot } from './stagescene';
export type { SheetMeta } from './textures';
export { BattleDrive, type DriveResult, type DriveSetup, battleTrace, legacyTrace, setupFor } from './battledrive';
export { Hud, type HudFaces, type HudGeo, type HudMenus } from './hud';
export { LiveStageScene, liveStage } from './live';
export { liveView, type LiveSource, viewSignature } from './liveview';
export { liveProvider } from './liveopen';
