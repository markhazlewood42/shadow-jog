/**
 * The battle's moments for the GPU effects layer (engine/postfx.ts). Playback calls these as events
 * land; each turns a moment into light and motion: a blow throws its damage type's particles away
 * from whoever struck it, a critical splits the colour and sends a shockwave, a combo lands with a
 * wide shower and a flare, a heal lifts green motes, the fallen scatter their light.
 *
 * Positions come in battle-world coordinates (240×135) and go out in screen pixels (×2). With GPU
 * effects off, every call returns at once and the battle looks as it always has.
 */
import type { Pt } from '../../battle/fx';
import type { Element } from '../../battle/types';
import { EMITTERS } from '../../data/emitters';
import type { EmitterPreset } from '../../engine/particles';
import { postfx } from '../../engine/postfx';

/** Each damage type's burst. */
const BURST: Record<Element, EmitterPreset> = {
  phys: EMITTERS.hit_sparks,
  fire: EMITTERS.embers,
  shock: EMITTERS.arcs,
  mana: EMITTERS.motes,
  cyber: EMITTERS.glitch,
};

const deg = (from: Pt, to: Pt) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/**
 * A blow landing on `at`. `tier` is its weight (0 a tap .. 3 a crushing hit, as playback grades
 * it); `from` is the attacker, when there is one, so debris flies the way the blow travelled.
 */
export function gpuHit(at: Pt, from: Pt | null, el: Element, tier: number, o: { crit: boolean; weak: boolean; combo: boolean }): void {
  if (!postfx.active) return;
  const x = at.x * 2, y = at.y * 2;
  const away = from ? deg(from, at) : undefined;
  postfx.emit(BURST[el], x, y, { ...(away === undefined ? {} : { angle: away }), scale: 0.6 + tier * 0.3 + (o.weak ? 0.4 : 0) });
  if (el === 'fire') postfx.emit(EMITTERS.fire_flash, x, y);
  if (o.combo) {
    postfx.emit(EMITTERS.combo_burst, x, y);
    postfx.shock(x, y, { strength: 6, reach: 170, life: 36, width: 14 });
    postfx.aberrate(3.5, x, y);
    postfx.flare(0.7);
  } else if (o.crit) {
    postfx.emit(EMITTERS.crit_sparks, x, y);
    postfx.emit(EMITTERS.crit_ring, x, y);
    postfx.shock(x, y, { strength: 4, reach: 120 });
    postfx.aberrate(2.5, x, y);
    postfx.flare(0.3);
  } else if (tier >= 2) {
    postfx.shock(x, y, { strength: 2.4, reach: 80, life: 22 });
  }
}

/** A heal on `at` (a perfect press: a brighter, fuller one). */
export function gpuHeal(at: Pt, crit: boolean): void {
  if (!postfx.active) return;
  postfx.emit(EMITTERS.heal_motes, at.x * 2, at.y * 2, { scale: crit ? 1.8 : 1 });
  if (crit) postfx.flare(0.35);
}

/** An enemy going down: its light scatters; a boss's with a shockwave. */
export function gpuDown(at: Pt, boss: boolean): void {
  if (!postfx.active) return;
  const x = at.x * 2, y = at.y * 2;
  postfx.emit(EMITTERS.dissolve, x, y, { scale: boss ? 2.5 : 1 });
  if (boss) {
    postfx.shock(x, y, { strength: 7, reach: 240, life: 44, width: 18 });
    postfx.flare(1.4);
  }
}

/** A boss changing form: the air ripples out from it. */
export function gpuPhase(at: Pt): void {
  if (!postfx.active) return;
  const x = at.x * 2, y = at.y * 2;
  postfx.shock(x, y, { strength: 8, reach: 260, life: 48, width: 20 });
  postfx.aberrate(4, x, y);
  postfx.emit(EMITTERS.motes, x, y, { scale: 3 });
  postfx.flare(1.5);
}
