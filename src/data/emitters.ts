/**
 * Particle emitter presets for the GPU effects layer (engine/particles.ts has the fields and their
 * units). Tune freely: each is one burst's look. Positions are back-buffer pixels (480×270), so a
 * speed of 2 crosses the screen in four seconds; lives are frames at 60/s.
 *
 * Only drawn with GPU effects on (Options). The battle's own effects (battle/fx.ts) still play
 * underneath either way; these add light, heat and debris on top.
 */
import type { EmitterPreset } from '../engine/particles';

export const EMITTERS = {
  /** A blade or fist landing: white-hot sparks flying off the struck side. */
  hit_sparks: {
    count: [12, 18], life: [14, 26], speed: [2.6, 5.2], spread: 120, gravity: 0.12, drag: 0.92,
    size: [2.4, 1.2], colors: ['#ffffff', '#ffe07a', '#ff8a3a'], alpha: [1, 0], shape: 'spark', stretch: 3,
  },
  /** A critical: the same, bigger and brighter, and a ring of light. */
  crit_sparks: {
    count: [24, 32], life: [18, 32], speed: [3.2, 6.6], spread: 360, gravity: 0.1, drag: 0.92,
    size: [2.8, 1.2], colors: ['#ffffff', '#fff04a', '#ff8a3a'], alpha: [1, 0], shape: 'spark', stretch: 3.2,
  },
  crit_ring: {
    count: [1, 1], life: [18, 18], speed: [0, 0], size: [10, 70], colors: ['#fff6c8', '#ffb23a'], alpha: [0.9, 0], shape: 'ring',
  },
  /** FIRE: embers that rise and flicker out, over a hot flash. */
  embers: {
    count: [18, 26], life: [36, 70], speed: [0.8, 2.6], angle: -90, spread: 140, radius: 8, gravity: -0.03, drag: 0.94,
    size: [5, 1.5], colors: ['#fff2b0', '#ffb23a', '#ff4a1a', '#6a1a10'], alpha: [1, 0], shape: 'soft', wobble: 1.2,
  },
  fire_flash: {
    count: [1, 1], life: [14, 14], speed: [0, 0], size: [40, 70], colors: ['#ffcf6a', '#ff5a1a'], alpha: [0.7, 0], shape: 'soft',
  },
  /** SHOCK: short, fast arcs that snap outward and die. */
  arcs: {
    count: [16, 22], life: [8, 16], speed: [3.5, 7], spread: 360, drag: 0.84,
    size: [2, 1.2], colors: ['#ffffff', '#9ae8ff', '#3f8af0'], alpha: [1, 0], shape: 'spark', stretch: 3.6,
  },
  /** MANA: slow motes that drift up in a loose column, a spirit's light. */
  motes: {
    count: [14, 20], life: [40, 70], speed: [0.2, 0.9], angle: -90, spread: 90, radius: 14, gravity: -0.02, drag: 0.97,
    size: [6, 2], colors: ['#f0e2ff', '#c3a0ff', '#6a4ad0'], alpha: [0.9, 0], shape: 'soft', wobble: 2,
  },
  /** CYBER: pixel shards that pop off and fall, a glitch coming apart. */
  glitch: {
    count: [14, 22], life: [18, 34], speed: [1, 3], spread: 360, radius: 6, gravity: 0.08, drag: 0.92,
    size: [3, 1], colors: ['#62ffd0', '#3fe0f0', '#ff4fb0'], alpha: [1, 0.2], shape: 'square', blend: 'alpha', snap: true,
  },
  /** A heal: green-gold motes rising off the member. */
  heal_motes: {
    count: [12, 18], life: [30, 50], speed: [0.3, 1.1], angle: -90, spread: 70, radius: 12, gravity: -0.03, drag: 0.96,
    size: [5, 1.5], colors: ['#f2ffe0', '#86f08c', '#2a9a5a'], alpha: [1, 0], shape: 'soft', wobble: 1.4,
  },
  /** An enemy going down: its light scattering. */
  dissolve: {
    count: [20, 30], life: [24, 44], speed: [0.4, 1.6], angle: -90, spread: 200, radius: 16, gravity: -0.02, drag: 0.95,
    size: [4.5, 1.2], colors: ['#ffffff', '#c9b8ff', '#5a4a8a'], alpha: [0.9, 0], shape: 'soft',
  },
  /** A combo landing: a wide shower of gold on top of the element's own burst. */
  combo_burst: {
    count: [40, 56], life: [20, 44], speed: [2.4, 6.4], spread: 360, gravity: 0.08, drag: 0.92,
    size: [3, 1.2], colors: ['#ffffff', '#ffe07a', '#ff9a3a', '#a03a2a'], alpha: [1, 0], shape: 'spark', stretch: 3,
  },
} satisfies Record<string, EmitterPreset>;

export type EmitterId = keyof typeof EMITTERS;
