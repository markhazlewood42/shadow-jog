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

// Colours say what KIND of status it is, the same everywhere: a buff arrow is cyan, a debuff arrow is red, poison is purple, fire
// is orange, healing is green, shields are blue. The shape says WHICH one: the four stats each have their own arrow.
const BUFF = UI.cyan;
const DEBUFF = '#ff6b6b';
const POISON = '#c27cff';

/** The four stats' arrows, pointing up (a buff); a debuff is the same drawing upside down. */
const ATK_UP = ['..#..', '.###.', '#####', '..#..', '..#..']; // a fat arrow: strength
const DEF_UP = ['..#..', '.###.', '..#..', '.....', '#####']; // an arrow over a floor: a wall
const RES_UP = ['..#..', '.###.', '#.#.#', '.#.#.', '..#..']; // an arrow whose tail splits: resistance spreads
const AGI_UP = ['..#..', '.###.', '..#..', '.###.', '..#..']; // two chevrons stacked: speed
const flip = (rows: readonly string[]): readonly string[] => [...rows].reverse();

export const STATUS_LOOK: Readonly<Record<StatusId, StatusLook>> = {
  stun: { name: 'Stunned', colour: UI.amber, rows: ['#.#.#', '.###.', '#####', '.###.', '#.#.#'] },
  hijacked: { name: 'Hijacked', colour: UI.pink, rows: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] },
  jammed: { name: 'Jammed', colour: '#e0e4ff', rows: ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'] },
  blind: { name: 'Blind', colour: '#9aa0c8', rows: ['.....', '.###.', '#####', '.###.', '.....'] },
  poison: { name: 'Poisoned', colour: POISON, rows: ['..#..', '.###.', '#####', '#####', '.###.'] },
  burn: { name: 'Burning', colour: '#ff8a3d', rows: ['..#..', '.##..', '.###.', '#####', '.###.'] },
  exposed: { name: 'Exposed', colour: DEBUFF, rows: ['.###.', '#...#', '#.#.#', '#...#', '.###.'] },
  guard: { name: 'Guarding', colour: '#6aa8ff', rows: ['#####', '#####', '#####', '.###.', '..#..'] },
  cover: { name: 'Covering', colour: '#6aa8ff', rows: ['#####', '#...#', '#...#', '.#.#.', '..#..'] },
  lockon: { name: 'Locked on', colour: UI.amber, rows: ['..#..', '.#.#.', '#####', '.#.#.', '..#..'] },
  regen: { name: 'Regen', colour: UI.green, rows: ['..#..', '..#..', '#####', '..#..', '..#..'] },
  atk_up: { name: 'Attack up', colour: BUFF, rows: ATK_UP },
  def_up: { name: 'Defence up', colour: BUFF, rows: DEF_UP },
  res_up: { name: 'Resist up', colour: BUFF, rows: RES_UP },
  agi_up: { name: 'Speed up', colour: BUFF, rows: AGI_UP },
  atk_down: { name: 'Attack down', colour: DEBUFF, rows: flip(ATK_UP) },
  def_down: { name: 'Defence down', colour: DEBUFF, rows: flip(DEF_UP) },
  agi_down: { name: 'Speed down', colour: DEBUFF, rows: flip(AGI_UP) },
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
