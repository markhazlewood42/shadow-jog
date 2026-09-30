/**
 * The battle's moments for the GPU effects layer. Playback calls these as events land; what each
 * one looks like is data (src/data/fx.json, "moments"), designed in the FX lab (`?scene=fxlab`).
 * A hit plays its damage type's moment (`hit.fire`...), plus `crit`, `combo` or `hit.heavy` on
 * top; heals, kills and a boss's change of form have their own.
 *
 * Positions come in battle-world coordinates (240×135) and go out in screen pixels (×2). With GPU
 * effects off, every call returns at once and the battle looks as it always has.
 */
import type { Pt } from '../../battle/fx';
import type { Element } from '../../battle/types';
import { FX } from '../../data/fx';
import { playMoment } from '../../engine/moments';
import { postfx } from '../../engine/postfx';

const deg = (from: Pt, to: Pt) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/**
 * A blow landing on `at`. `tier` is its weight (0 a tap .. 3 a crushing hit, as playback grades
 * it); `from` is the attacker, when there is one, so debris flies the way the blow travelled.
 */
export function gpuHit(at: Pt, from: Pt | null, el: Element, tier: number, o: { crit: boolean; weak: boolean; combo: boolean }): void {
  if (!postfx.active) return;
  const x = at.x * 2, y = at.y * 2;
  const opts = { ...(from ? { angle: deg(from, at) } : {}), weight: 0.6 + tier * 0.3 + (o.weak ? 0.4 : 0) };
  playMoment(FX, `hit.${el}`, x, y, opts);
  if (o.combo) playMoment(FX, 'combo', x, y, opts);
  else if (o.crit) playMoment(FX, 'crit', x, y, opts);
  else if (tier >= 2) playMoment(FX, 'hit.heavy', x, y, opts);
}

/** A heal on `at` (a perfect press: its own, fuller moment). */
export function gpuHeal(at: Pt, crit: boolean): void {
  playMoment(FX, crit ? 'heal.perfect' : 'heal', at.x * 2, at.y * 2);
}

/** An enemy going down (a boss: its own moment). */
export function gpuDown(at: Pt, boss: boolean): void {
  playMoment(FX, boss ? 'down.boss' : 'down', at.x * 2, at.y * 2);
}

/** A boss changing form. */
export function gpuPhase(at: Pt): void {
  playMoment(FX, 'phase', at.x * 2, at.y * 2);
}
