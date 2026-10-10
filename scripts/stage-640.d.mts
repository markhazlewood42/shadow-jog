/** Types for `scripts/stage-640.mjs`, so the tests can import it. */
export const FROM: { w: number; h: number };
export const TO: { w: number; h: number };
export const DX: number;
export const DY: number;
export const ART_KERB_ROW_640: number;
export const LEGACY_PUSH: { zoom: number; rampFrames: number; lifeFrames: number };
export function transformHud(hud: unknown): any;
export function transformStage(stage: unknown): any;
export function transformStages(stages: any): Record<string, any>;
export function format(data: unknown): string;
export function make(): Record<'stages-640.json' | 'hud-640.json', any>;
