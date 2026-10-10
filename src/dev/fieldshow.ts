/**
 * DEV hooks for the field (M5 task 8 and 9): put the field in a fixed state, and read its state back. Loaded on first use by `window.__SJ__.fieldShow` and `fieldInfo`
 * (src/boot.ts), in a DEV build only, on the old path and on the new one alike, so the parity harness (`e2e/sje-field-parity.spec.ts`,
 * `scripts/sjefield-refs.mjs`) puts both paths in the same state with the same code.
 *
 * A fixed state is a map, a tile and a facing, a stage preset for the story flags (`src/game/stages.ts`) with a few flags changed, and two look overrides: the ambient color
 * and the weather of the map. The overrides are set on the shared `MapDef` before the field loads, so the map bakes with them; use one fresh page per state.
 * The seed of the page's random numbers and the tick the picture is taken at are the harness's: a page with a fake clock (`e2e/sjegamekit.ts`).
 */
import type { Dir } from '../art/chars';
import { getMap } from '../data/maps';
import type { Game } from '../engine/game';
import { applyStage } from '../game/stages';
import { state } from '../game/state';
import { FieldScene, invalidateMap } from '../scenes/field';

export interface FieldShowCase {
  /** The story-flag preset: `town`, `sinkline`, `annex`, `finale` (src/game/stages.ts). */
  stage: string;
  map: string;
  x: number;
  y: number;
  dir?: Dir;
  /** Flags set on top of the preset. */
  flags?: Record<string, unknown>;
  /** Replaces the map's ambient color (the game has no clock: a day look is an override). */
  ambient?: string;
  /** Replaces the map's weather (`none`, `rain`, `drip`...). */
  weather?: string;
  /** For the parity harness's controls only: multiply every light radius of the map (a wrong light radius must fail the gate). */
  lightScale?: number;
  /** For the parity harness's controls only: move the leader by this many pixels (a one-pixel actor move must fail the gate). */
  nudge?: { px: number; py: number };
}

export interface FieldInfo {
  map: string;
  /** The leader's tile and pixel position. */
  leader: { x: number; y: number; px: number; py: number };
  flags: Record<string, unknown>;
  /** The camera's top-left corner in map pixels (before shake). */
  camera: { x: number; y: number };
  /** How many lights the map has. */
  lights: number;
  /** The field's tick counter. */
  frame: number;
}

/** The running field scene, or null. */
function fieldOf(game: Game): FieldScene | null {
  return game.stack.find((s): s is FieldScene => s instanceof FieldScene) ?? null;
}

/** Start a fresh field in the state of `c`. Resolves when the fade-in has been asked for (the caller then runs the clock until the field is idle). */
export async function fieldShow(game: Game, c: FieldShowCase): Promise<void> {
  const st = applyStage(c.stage);
  Object.assign(state.flags, c.flags ?? {});
  const def = getMap(c.map);
  if (c.ambient !== undefined) def.ambient = c.ambient;
  if (c.weather !== undefined) def.weather = c.weather as typeof def.weather;
  if (c.lightScale !== undefined) for (const l of def.lights ?? []) l.r *= c.lightScale;
  // A map baked before the override would keep its old look.
  invalidateMap(c.map);
  game.playFrames = st.minutes * 60 * 60;
  const scene = new FieldScene(c.map, c.x, c.y, c.dir ?? 'down');
  if (c.nudge) {
    scene.leader.px += c.nudge.px;
    scene.leader.py += c.nudge.py;
  }
  void game.reset(scene);
  await game.fadeTo(0, 0);
}

/** The state of the field on show (map, position, flags, camera, light count, tick), or null when no field is on. */
export function fieldInfo(game: Game): FieldInfo | null {
  const f = fieldOf(game);
  if (!f) return null;
  const l = f.leader;
  return {
    map: f.def.id,
    leader: { x: l.x, y: l.y, px: l.px, py: l.py },
    flags: { ...state.flags },
    camera: { x: f.camX, y: f.camY },
    lights: f.map.lights.length,
    frame: (f as unknown as { frame: number }).frame,
  };
}
