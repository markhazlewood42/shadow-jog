/**
 * Status icons for the party table (Phaser spike `spike/phaser-stage`): poison, burn, stun, guard, the stat buffs
 * and the rest, each a 5x5 pixel picture written out as text (the same trick as `icons.ts`), with a dark outline
 * added when it becomes a texture. A hero's row shows up to three, most urgent first, so a glance at the table
 * says who is poisoned or stunned and who is guarding.
 *
 * Which statuses a hero has comes from the battle engine's own `StatusState` list (the DISPLAYED state in a live
 * fight, so an icon appears when the effect lands, not before). Nothing here draws or touches the engine; the texture is
 * made by `statusIconTexture` in `hudkit.ts`.
 */
import type { StatusId } from '../battle/types';
import { UI } from './hudcolours';

export interface StatusLook {
  /** A short plain name (for tests, tooltips and the docs). */
  name: string;
  colour: string;
  /** Five rows of five: "#" is a lit pixel. */
  rows: readonly string[];
}

const UP = ['..#..', '.###.', '#.#.#', '..#..', '..#..'];
const DOWN = ['..#..', '..#..', '#.#.#', '.###.', '..#..'];

const ATK = '#ff8a6a';
const DEF = '#6aa8ff';
const RES = '#b07cff';
const AGI = '#62e06a';

export const STATUS_LOOK: Readonly<Record<StatusId, StatusLook>> = {
  stun: { name: 'Stunned', colour: UI.amber, rows: ['#.#.#', '.###.', '#####', '.###.', '#.#.#'] },
  hijacked: { name: 'Hijacked', colour: UI.violet, rows: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] },
  jammed: { name: 'Jammed', colour: UI.pink, rows: ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'] },
  blind: { name: 'Blind', colour: '#b2a9cc', rows: ['.....', '.###.', '#####', '.###.', '.....'] },
  poison: { name: 'Poisoned', colour: UI.green, rows: ['..#..', '.###.', '#####', '#####', '.###.'] },
  burn: { name: 'Burning', colour: '#ff8a3d', rows: ['..#..', '.##..', '.###.', '#####', '.###.'] },
  exposed: { name: 'Exposed', colour: UI.foe, rows: ['.###.', '#...#', '#.#.#', '#...#', '.###.'] },
  guard: { name: 'Guarding', colour: DEF, rows: ['#####', '#####', '#####', '.###.', '..#..'] },
  cover: { name: 'Covering', colour: UI.cyan, rows: ['#####', '#...#', '#...#', '.#.#.', '..#..'] },
  lockon: { name: 'Locked on', colour: UI.amber, rows: ['..#..', '.#.#.', '#####', '.#.#.', '..#..'] },
  regen: { name: 'Regen', colour: UI.green, rows: ['..#..', '..#..', '#####', '..#..', '..#..'] },
  atk_up: { name: 'Attack up', colour: ATK, rows: UP },
  def_up: { name: 'Defence up', colour: DEF, rows: UP },
  res_up: { name: 'Resist up', colour: RES, rows: UP },
  agi_up: { name: 'Speed up', colour: AGI, rows: UP },
  atk_down: { name: 'Attack down', colour: ATK, rows: DOWN },
  def_down: { name: 'Defence down', colour: DEF, rows: DOWN },
  agi_down: { name: 'Speed down', colour: AGI, rows: DOWN },
};

/** Most urgent first: what stops a hero acting, then damage over time, then guards, then the stat changes. */
const ORDER: readonly StatusId[] = ['stun', 'hijacked', 'jammed', 'blind', 'poison', 'burn', 'exposed', 'guard', 'cover', 'lockon', 'regen', 'atk_up', 'def_up', 'res_up', 'agi_up', 'atk_down', 'def_down', 'agi_down'];

/** The side of one status icon picture, outline included. */
export const STATUS_ICON_SIZE = 7;
/** How many a row shows. */
export const STATUS_MAX = 3;

/** The statuses to draw for a hero, most urgent first, at most `STATUS_MAX`; the count left out comes second. */
export function pickStatuses(ids: readonly StatusId[]): { shown: StatusId[]; more: number } {
  const have = ORDER.filter((id) => ids.includes(id));
  return { shown: have.slice(0, STATUS_MAX), more: Math.max(0, have.length - STATUS_MAX) };
}
