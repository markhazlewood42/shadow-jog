/**
 * Enemy definitions and encounter tables for Chapter 1 (M3 task 8, decision 5).
 *
 * The data is JSON now: `enemies.json` (the 21 records, plus how each picture faces, whether the stage mirrors it, and its
 * foot-axis shift) and `encounters.json` (the groups). This file is the typed loader. `checkEnemies` and `checkEncounters` list
 * every problem in plain words (like `checkFx`), and the loaders throw with that list, so a bad edit stops the game at start.
 * `ENEMIES` and `ENCOUNTERS` are the same objects as before the move (`tests/enemies-data.test.ts` proves it against a frozen copy).
 * The look fields do not go into `EnemyDef`: they are in `ENEMY_LOOKS`, by enemy id.
 *
 * Design notes that were comments in the old file are the `note` of a record (`ENEMY_NOTES`). Two of them were about groups: the
 * Sinkline "mixed pack" (something for every element, and a hunter) and the Annex squads, not pairs (the pressure climbs into
 * the boss instead of dipping; `tests/balance.test.ts` checks the Annex costs more than the Sinkline).
 */
import type { Element, Family, StatusId } from '../battle/types';
import encountersJson from './encounters.json';
import enemiesJson from './enemies.json';

export interface EnemyMove {
  id: string;
  w: number;
  /** Condition gate for the move. */
  when?: 'ally_hurt' | 'shield_ally' | 'no_atk_buff' | 'no_def_buff' | 'no_res_buff' | 'lockon_ready' | 'no_lockon' | 'hp_below_half' | 'every_3';
}

export interface EnemyDef {
  id: string;
  name: string;
  family: Family;
  sprite: string;
  /** Optional palette tint for sprite variants. */
  tint?: string;
  hp: number;
  atk: number;
  def: number;
  mnd: number;
  res: number;
  agi: number;
  xp: number;
  cred: number;
  drops?: { id: string; chance: number }[];
  weak?: Partial<Record<Element, number>>;
  immune?: StatusId[];
  moves: EnemyMove[];
  boss?: boolean;
  /** Custom AI routine key (bosses). */
  ai?: string;
  /** Bestiary flavor. */
  lore: string;
  /** Basic attack element. */
  element?: Element;
}

export const FAMILY_WEAK: Record<Family, Partial<Record<Element, number>>> = {
  // Chrome conducts: street muscle is wired, so a taser is the answer to a ganger as much as to a drone.
  human: { shock: 1.25, cyber: 0.6 },
  machine: { shock: 1.5, cyber: 2, mana: 0.6, fire: 0.9 },
  beast: { fire: 1.5, cyber: 0.25 },
  spirit: { phys: 0.5, mana: 1.75, shock: 0.6, cyber: 0 },
  ghoul: { fire: 1.75, mana: 1.3, cyber: 0.25 },
};

export const FAMILY_IMMUNE: Record<Family, StatusId[]> = {
  human: ['jammed', 'hijacked'],
  machine: ['poison', 'burn'],
  beast: ['jammed', 'hijacked'],
  spirit: ['poison', 'jammed', 'hijacked', 'blind'],
  ghoul: ['poison', 'jammed', 'hijacked'],
};

export interface EncounterGroup {
  w: number;
  e: string[];
}

// ------------------------------------------------------------------ the loader

/** Which way an enemy picture faces as drawn (a description for people; the stage mirrors by `mirror`). */
export type PictureFacing = 'left' | 'right' | 'front';

/** How the stage shows an enemy: what the picture is, whether it is flipped to face the heroes, and a foot-anchor shift. */
export interface EnemyLook {
  picture: { facing: PictureFacing; note: string };
  mirror: boolean;
  /** Whole-pixel foot-anchor correction (`axes.json` keys these by sprite). */
  axis?: { x: number; y: number };
}

/** One record of `enemies.json`: an `EnemyDef` plus its look and an optional design note. */
export type EnemyRecord = EnemyDef & EnemyLook & { note?: string };

const FAMILIES = ['human', 'machine', 'beast', 'spirit', 'ghoul'] as const satisfies readonly Family[];
const ELEMENTS = ['phys', 'fire', 'shock', 'mana', 'cyber'] as const satisfies readonly Element[];
const STATUSES = [
  'poison', 'burn', 'stun', 'blind', 'jammed', 'guard', 'exposed', 'regen', 'hijacked',
  'atk_up', 'def_up', 'res_up', 'agi_up', 'atk_down', 'def_down', 'agi_down', 'lockon', 'cover',
] as const satisfies readonly StatusId[];
const WHEN = [
  'ally_hurt', 'shield_ally', 'no_atk_buff', 'no_def_buff', 'no_res_buff', 'lockon_ready', 'no_lockon', 'hp_below_half', 'every_3',
] as const satisfies readonly NonNullable<EnemyMove['when']>[];
const FACINGS = ['left', 'right', 'front'] as const satisfies readonly PictureFacing[];
const STATS = ['hp', 'atk', 'def', 'mnd', 'res', 'agi', 'xp', 'cred'] as const;
/** Every field a record may have. Anything else is a typo that would silently do nothing. */
const FIELDS: readonly string[] = [
  'id', 'name', 'family', 'sprite', 'tint', 'boss', 'ai', 'element', 'drops', 'weak', 'immune', 'moves', 'lore', 'picture', 'mirror', 'axis', 'note', ...STATS,
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Everything wrong with a candidate enemies file (empty when it is good to play), one problem per line in plain words. */
export function checkEnemies(data: unknown): string[] {
  if (!isObj(data) || !isObj(data.enemies)) return ['enemies: the file needs an "enemies" object, one record per enemy'];
  const out: string[] = [];
  const entries = Object.entries(data.enemies);
  if (!entries.length) out.push('enemies: the file has no enemy');
  const spriteOwner = new Map<string, string>();
  for (const [key, r] of entries) {
    const at = `enemy "${key}"`;
    if (!isObj(r)) {
      out.push(`${at}: must be an object`);
      continue;
    }
    for (const k of Object.keys(r)) if (!FIELDS.includes(k)) out.push(`${at}: "${k}" is not a field of an enemy`);
    if (r.id !== key) out.push(`${at}: id must be "${key}" (the key)`);
    if (!isText(r.name)) out.push(`${at}: name must be text`);
    if (!oneOf(FAMILIES, r.family)) out.push(`${at}: family must be one of ${FAMILIES.join(', ')}`);
    if (!isText(r.sprite)) out.push(`${at}: sprite must be text`);
    else {
      const other = spriteOwner.get(r.sprite);
      if (other) out.push(`${at}: the sprite "${r.sprite}" is also used by "${other}" (the look is per sprite, so one enemy each)`);
      spriteOwner.set(r.sprite, key);
    }
    for (const k of STATS) {
      const v = r[k];
      if (!isInt(v) || v < 0) out.push(`${at}: ${k} must be a whole number, 0 or more`);
    }
    if (isInt(r.hp) && r.hp < 1) out.push(`${at}: hp must be at least 1`);
    if (r.tint !== undefined && !isText(r.tint)) out.push(`${at}: tint must be text`);
    if (r.boss !== undefined && typeof r.boss !== 'boolean') out.push(`${at}: boss must be true or false`);
    if (r.ai !== undefined && !isText(r.ai)) out.push(`${at}: ai must be text`);
    if (r.element !== undefined && !oneOf(ELEMENTS, r.element)) out.push(`${at}: element must be one of ${ELEMENTS.join(', ')}`);
    if (!isText(r.lore)) out.push(`${at}: lore must be text`);
    if (r.note !== undefined && typeof r.note !== 'string') out.push(`${at}: note must be text`);
    if (r.drops !== undefined) {
      if (!Array.isArray(r.drops)) out.push(`${at}: drops must be a list`);
      else {
        for (const d of r.drops as unknown[]) {
          if (!isObj(d) || !isText(d.id) || !isNum(d.chance) || d.chance <= 0 || d.chance > 1) out.push(`${at}: each drop needs an id and a chance above 0 and at most 1`);
        }
      }
    }
    if (r.weak !== undefined) {
      if (!isObj(r.weak)) out.push(`${at}: weak must be an object of element: multiplier`);
      else {
        for (const [el, m] of Object.entries(r.weak)) {
          if (!oneOf(ELEMENTS, el)) out.push(`${at}: weak "${el}" is not an element`);
          else if (!isNum(m) || m < 0) out.push(`${at}: weak "${el}" must be a number, 0 or more`);
        }
      }
    }
    if (r.immune !== undefined && (!Array.isArray(r.immune) || !r.immune.every((s) => oneOf(STATUSES, s)))) out.push(`${at}: immune must be a list of status ids`);
    if (!Array.isArray(r.moves) || !r.moves.length) out.push(`${at}: moves must be a list with at least one move`);
    else {
      for (const m of r.moves as unknown[]) {
        if (!isObj(m) || !isText(m.id) || !isNum(m.w) || m.w <= 0) out.push(`${at}: each move needs an id and a weight above 0`);
        else if (m.when !== undefined && !oneOf(WHEN, m.when)) out.push(`${at}: move "${m.id}" has an unknown "when" (${WHEN.join(', ')})`);
        else {
          for (const k of Object.keys(m)) if (k !== 'id' && k !== 'w' && k !== 'when') out.push(`${at}: move "${m.id}" has an unknown field "${k}"`);
        }
      }
    }
    const p = r.picture;
    if (!isObj(p)) out.push(`${at}: picture must be an object with facing and note`);
    else {
      if (!oneOf(FACINGS, p.facing)) out.push(`${at}: picture.facing must be "left", "right" or "front"`);
      if (!isText(p.note)) out.push(`${at}: picture.note must say in a sentence why`);
    }
    if (typeof r.mirror !== 'boolean') out.push(`${at}: mirror must be true or false`);
    if (r.axis !== undefined) {
      const a = r.axis;
      if (!isObj(a) || !isInt(a.x) || !isInt(a.y)) out.push(`${at}: axis needs whole-number x and y`);
      else if (Math.abs(a.x) > 16 || Math.abs(a.y) > 16) out.push(`${at}: an axis shift of more than 16 pixels is probably a mistake`);
    }
  }
  return out;
}

/** Everything wrong with a candidate encounters file. `enemyIds` are the enemies a group may name. */
export function checkEncounters(data: unknown, enemyIds: readonly string[]): string[] {
  if (!isObj(data) || !isObj(data.encounters)) return ['encounters: the file needs an "encounters" object, one list of groups per table'];
  const out: string[] = [];
  for (const [table, groups] of Object.entries(data.encounters)) {
    const at = `encounter table "${table}"`;
    if (!Array.isArray(groups) || !groups.length) {
      out.push(`${at}: must be a list with at least one group`);
      continue;
    }
    (groups as unknown[]).forEach((g, i) => {
      const gat = `${at}, group ${i + 1}`;
      if (!isObj(g) || !isNum(g.w) || g.w <= 0 || !Array.isArray(g.e)) {
        out.push(`${gat}: needs a weight w above 0 and a list e of enemy ids`);
        return;
      }
      if (!g.e.length || g.e.length > 4) out.push(`${gat}: a group has 1 to 4 enemies`);
      for (const id of g.e as unknown[]) if (typeof id !== 'string' || !enemyIds.includes(id)) out.push(`${gat}: "${String(id)}" is not an enemy`);
      for (const k of Object.keys(g)) if (k !== 'w' && k !== 'e') out.push(`${gat}: unknown field "${k}"`);
    });
  }
  return out;
}

/** The loaded enemy data: the definitions (as the game always had them), the looks, and the design notes. */
export interface LoadedEnemies {
  enemies: Record<string, EnemyDef>;
  looks: Record<string, EnemyLook>;
  notes: Record<string, string>;
}

/** The enemies file, checked (throws a readable error listing every problem), split into `EnemyDef`, `EnemyLook` and the notes. */
export function loadEnemies(data: unknown): LoadedEnemies {
  const problems = checkEnemies(data);
  if (problems.length) throw new Error(`enemies.json is not valid:\n - ${problems.join('\n - ')}`);
  const records = (data as { enemies: Record<string, EnemyRecord> }).enemies;
  const enemies: Record<string, EnemyDef> = {};
  const looks: Record<string, EnemyLook> = {};
  const notes: Record<string, string> = {};
  for (const [key, r] of Object.entries(records)) {
    const { picture, mirror, axis, note, ...def } = r;
    enemies[key] = def;
    looks[key] = axis ? { picture, mirror, axis } : { picture, mirror };
    if (note) notes[key] = note;
  }
  return { enemies, looks, notes };
}

/** The encounters file, checked against the enemy ids (throws a readable error listing every problem). */
export function loadEncounters(data: unknown, enemyIds: readonly string[]): Record<string, EncounterGroup[]> {
  const problems = checkEncounters(data, enemyIds);
  if (problems.length) throw new Error(`encounters.json is not valid:\n - ${problems.join('\n - ')}`);
  return (data as { encounters: Record<string, EncounterGroup[]> }).encounters;
}

const LOADED = loadEnemies(enemiesJson);

export const ENEMIES: Record<string, EnemyDef> = LOADED.enemies;
/** How the stage shows each enemy, by enemy id. */
export const ENEMY_LOOKS: Record<string, EnemyLook> = LOADED.looks;
/** The design note of an enemy (why it is tuned the way it is), by enemy id. */
export const ENEMY_NOTES: Record<string, string> = LOADED.notes;
export const ENCOUNTERS: Record<string, EncounterGroup[]> = loadEncounters(encountersJson, Object.keys(ENEMIES));
