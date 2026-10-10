/**
 * The B1 slice: ONE stage (street), ONE hero (Kit) and ONE enemy (the punk), the HUD off (exit criterion 7 of docs/spikes/engine-platform.md).
 * The numbers live in `slice.json`, so the parity capture script (`scripts/sjestage-refs.mjs`), which drives the Phaser spike's page, and
 * this engine read the same file and cannot drift apart.
 *
 * The slice shows the two rings, so the "parts" of a figure (shadow, ring, body) are all in the picture: the acting hero's cyan ring
 * under Kit, the target's amber ring under the punk. They are the stage's own markers, not HUD windows.
 *
 * The second frame, `haze` (cleanup item C3), is for the DEPTH HAZE. The ring exempts a figure from the haze (`exemptActive`), and the slice has Kit on the
 * nearest row (haze 0) anyway, so the haze path never ran in the first frame. This one puts four heroes on the rows 4 to 1 and three enemies on the rows 0, 2
 * and 4 of group "3", with no ring, so every row but the nearest is hazed (0.03 to 0.12 toward the street's fog colour).
 */
import slice from './slice.json';
import type { SpriteChoice, StageData } from './boot';
import { withSeed } from './boot';
import type { BattleStageInit } from './stagescene';

export interface SliceSpec {
  stageId: string;
  setKey: string;
  lineup: readonly string[];
  enemies: readonly string[];
  /** The index of the hero with the ring, and of the enemy with the ring. */
  active: number;
  target: number;
  /** The floor seed the references were made with (the stage file's own seed for the street). */
  seed: number;
  /** The ticks the parity harness compares: the first picture, a mid-idle one and a later one. */
  ticks: readonly number[];
  /** The second frame of the parity set (C3). */
  haze: HazeSpec;
}

/** The haze frame: another lineup and group, no rings, the ticks to compare. */
export interface HazeSpec {
  lineup: readonly string[];
  setKey: string;
  enemies: readonly string[];
  ticks: readonly number[];
}

/** Which frame of the parity set: the slice itself or the haze frame. */
export type FrameKind = 'slice' | 'haze';

export const SLICE: SliceSpec = slice;

/** What to hand `BattleStageScene` to show the slice (or its haze frame) with this data, these sprites and this floor seed. */
export function sliceInit(data: StageData, sprites: SpriteChoice, seed: number = SLICE.seed, frame: FrameKind = 'slice'): BattleStageInit {
  if (frame === 'haze') {
    // No `active` and no `target`: no ring, so no figure is exempt from the haze.
    return {
      stages: withSeed(data.stages, SLICE.stageId, seed),
      stageId: SLICE.stageId,
      metas: sprites.metas,
      standIns: sprites.standIns,
      lineup: SLICE.haze.lineup,
      setKey: SLICE.haze.setKey,
      enemies: SLICE.haze.enemies,
      axes: data.axes,
      facing: data.facing,
      heroes: data.heroes,
    };
  }
  return {
    stages: withSeed(data.stages, SLICE.stageId, seed),
    stageId: SLICE.stageId,
    metas: sprites.metas,
    standIns: sprites.standIns,
    lineup: SLICE.lineup,
    setKey: SLICE.setKey,
    enemies: SLICE.enemies,
    active: SLICE.active,
    target: SLICE.target,
    axes: data.axes,
    facing: data.facing,
    heroes: data.heroes,
  };
}
