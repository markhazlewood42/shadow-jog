/**
 * The battle's moments for the GPU effects layer. Playback calls these as events land; what each
 * one looks like is data (src/data/fx.json, "moments"), designed in the FX lab (`?scene=fxlab`).
 * A hit plays its damage type's moment (`hit.fire`...), plus `crit`, `combo` or `hit.heavy` on
 * top; heals, kills and a boss's change of form have their own. A spell (any move with an effect,
 * by its fx id) also gathers at the caster as they wind up (`cast.<fx>`) and lands on each target
 * with the effect's impact (`spell.<fx>`): the heat haze over Firebrand's flames, the stage dimming
 * for Overload, the tear in the screen where Spike hits.
 *
 * Positions come in battle-world coordinates (BW×BHT, half the screen) and go out in screen pixels
 * (times WORLD_SCALE). With GPU effects off, every call returns at once and the battle looks as it
 * always has.
 */
import type { Pt } from '../../battle/fx';
import type { Element } from '../../battle/types';
import { FX } from '../../data/fx';
import { playMoment } from '../../engine/moments';
import { postfx } from '../../engine/postfx';
import { WORLD_SCALE } from './geom';

const deg = (from: Pt, to: Pt) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/**
 * A blow landing on `at`. `tier` is its weight (0 a tap .. 3 a crushing hit, as playback grades
 * it); `from` is the attacker, when there is one, so debris flies the way the blow travelled.
 */
export function gpuHit(at: Pt, from: Pt | null, el: Element, tier: number, o: { crit: boolean; weak: boolean; combo: boolean }): void {
  if (!postfx.active) return;
  const x = at.x * WORLD_SCALE, y = at.y * WORLD_SCALE;
  const opts = { ...(from ? { angle: deg(from, at) } : {}), weight: 0.6 + tier * 0.3 + (o.weak ? 0.4 : 0) };
  playMoment(FX, `hit.${el}`, x, y, opts);
  if (o.combo) playMoment(FX, 'combo', x, y, opts);
  else if (o.crit) playMoment(FX, 'crit', x, y, opts);
  else if (tier >= 2) playMoment(FX, 'hit.heavy', x, y, opts);
}

/** A move winding up at `at`: its power gathering there (`cast.<fx>`; most moves have none). */
export function gpuCast(fx: string, at: Pt): void {
  playMoment(FX, `cast.${fx}`, at.x * WORLD_SCALE, at.y * WORLD_SCALE);
}

/** A move's effect landing on each target, `impact` effect frames from now (`spell.<fx>`). */
export function gpuSpell(fx: string, targets: Pt[], impact: number): void {
  if (!postfx.active || !FX.moments[`spell.${fx}`]) return;
  const land = () => {
    for (const t of targets) playMoment(FX, `spell.${fx}`, t.x * WORLD_SCALE, t.y * WORLD_SCALE);
  };
  if (impact > 0) postfx.later(impact, land);
  else land();
}

/** A heal on `at` (a perfect press: its own, fuller moment). */
export function gpuHeal(at: Pt, crit: boolean): void {
  playMoment(FX, crit ? 'heal.perfect' : 'heal', at.x * WORLD_SCALE, at.y * WORLD_SCALE);
}

/** An enemy going down (a boss: its own moment). */
export function gpuDown(at: Pt, boss: boolean): void {
  playMoment(FX, boss ? 'down.boss' : 'down', at.x * WORLD_SCALE, at.y * WORLD_SCALE);
}

/** A boss changing form. */
export function gpuPhase(at: Pt): void {
  playMoment(FX, 'phase', at.x * WORLD_SCALE, at.y * WORLD_SCALE);
}
