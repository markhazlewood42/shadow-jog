/**
 * Rig v2's traced frames, loaded at startup from `public/art/rig/` (written by
 * scripts/art/trace.mjs) rather than built into the code: pixel data is bulky, and the game's
 * script bundle has a size budget. Until it loads (or if it can't), characters use the
 * letter-grid rig, so nothing breaks; boot says so if it fails.
 */
import type { Dir } from '../chars';
import type { Traced } from './rig';

/** Field characters: a standing frame per facing. */
export const TRACED: Record<string, Record<Dir, Traced>> = {};
/** Battle backs: one frame each, with where it sits on its 128x128 canvas. */
export const BATTLE_TRACED: Record<string, Traced & { ox: number; oy: number }> = {};
/** Enemies: one frame each, keyed by the game's sprite name. */
export const ENEMY_TRACED: Record<string, Traced> = {};

/** Load the traced frames. Resolves with how many characters came in; rejects if none could. */
export async function loadRigData(base = 'art/rig/'): Promise<number> {
  const get = async (file: string) => {
    const res = await fetch(base + file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    return res.json();
  };
  const [field, battle, enemies] = await Promise.all([get('field.json'), get('battle.json'), get('enemies.json')]);
  Object.assign(TRACED, field);
  Object.assign(BATTLE_TRACED, battle);
  Object.assign(ENEMY_TRACED, enemies);
  return Object.keys(TRACED).length;
}
