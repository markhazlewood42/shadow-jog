/**
 * The GPU effects' particle presets and moments: the data is src/data/fx.json (shapes and checks in
 * engine/fxdata.ts). Tune them in the FX lab: `npm run dev`, then http://localhost:3007/?scene=fxlab.
 * Saving there rewrites fx.json, and a running dev game takes the new data at once (below).
 */
import type { FxData, FxPreset } from '../engine/fxdata';
import raw from './fx.json';

export const FX: FxData = raw as unknown as FxData;

/** The presets by id (a preset missing from the data is simply not drawn). */
export function preset(id: string): FxPreset | undefined {
  return FX.presets[id];
}

/**
 * The moments the game plays, and when. The lab lists these first; a moment that isn't here can be
 * designed and saved, but nothing in the game plays it until code does.
 */
export const GAME_MOMENTS = {
  'hit.phys': 'a PHYS blow lands',
  'hit.fire': 'a FIRE blow lands',
  'hit.shock': 'a SHOCK blow lands',
  'hit.mana': 'a MANA blow lands',
  'hit.cyber': 'a CYBER blow lands',
  'hit.heavy': 'on top: a heavy blow (not a critical or combo)',
  crit: 'on top: a critical',
  combo: 'on top: a combo landing',
  heal: 'a heal',
  'heal.perfect': 'a healing skill on the beat',
  down: 'an enemy goes down',
  'down.boss': 'a boss goes down',
  phase: 'a boss changes form',
  intro: 'the battle transition breaks',
} as const;
export type GameMoment = keyof typeof GAME_MOMENTS;

/** Take new data in place, so everything holding FX (the game, the lab) sees it. */
export function replaceFx(d: FxData): void {
  for (const k of Object.keys(FX.presets)) delete FX.presets[k];
  for (const k of Object.keys(FX.moments)) delete FX.moments[k];
  Object.assign(FX.presets, d.presets);
  Object.assign(FX.moments, d.moments);
}

// Live updates in dev: a save from the FX lab changes fx.json, and Vite hands the new module here
// instead of reloading the page (a battle in another tab keeps going, with the new look).
if (import.meta.hot) {
  import.meta.hot.accept('./fx.json', (m) => {
    if (m) replaceFx((m as unknown as { default: FxData }).default);
  });
}
