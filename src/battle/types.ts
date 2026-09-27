/** Battle domain types. Pure data — no DOM. */

export type Element = 'phys' | 'fire' | 'shock' | 'mana' | 'cyber';
export type Family = 'human' | 'machine' | 'beast' | 'spirit' | 'ghoul';
export type StatusId =
  | 'poison' | 'burn' | 'stun' | 'blind' | 'jammed' | 'guard' | 'exposed' | 'regen' | 'hijacked'
  | 'atk_up' | 'def_up' | 'res_up' | 'agi_up' | 'atk_down' | 'def_down' | 'agi_down' | 'lockon' | 'cover';

export type TargetKind = 'enemy' | 'enemies' | 'ally' | 'allies' | 'self' | 'ally_down' | 'random_enemies' | 'none';

export type Effect =
  | {
      type: 'damage';
      /** Physical uses ATK vs DEF; tech uses power + MND vs RES. */
      stat: 'atk' | 'mnd';
      power?: number;
      mult?: number;
      hits?: number;
      critBonus?: number;
      ignoreDef?: boolean;
      /** Damage is a % of target max HP (gravity-style). */
      pct?: number;
      /** Heals the user for this fraction of damage dealt. */
      drain?: number;
      /** Only affects this family (e.g. cyber programs). */
    }
  | { type: 'heal'; power?: number; pct?: number }
  | { type: 'status'; status: StatusId; chance: number; turns?: number; only?: Family[] }
  | { type: 'cure'; statuses: StatusId[] | 'all' }
  | { type: 'buff'; status: StatusId; turns: number }
  | { type: 'revive'; pct: number }
  | { type: 'tp'; amount: number }
  | { type: 'analyze' }
  | { type: 'escape' }
  | { type: 'summon'; enemies: string[]; max: number };

export interface Ability {
  id: string;
  name: string;
  desc: string;
  kind: 'tech' | 'skill' | 'item' | 'enemy' | 'combo' | 'attack';
  cost?: number;
  uses?: number;
  target: TargetKind;
  element?: Element;
  effects: Effect[];
  /** Added to effective agility when ordering turns. */
  priority?: number;
  /** Visual effect id for the battle scene. */
  fx: string;
  /** Can be used from the field menu. */
  field?: boolean;
  /** Short flavor shown on the action banner (enemy moves). */
  cry?: string;
}

export interface Stats {
  maxHp: number;
  maxTp: number;
  atk: number;
  def: number;
  mnd: number;
  res: number;
  agi: number;
  /** Bonus crit chance in % from gear. */
  crit: number;
  /** Bonus hit chance in % from gear. */
  hit: number;
}

export interface StatusState {
  id: StatusId;
  turns: number;
  /** For hijacked / cover: who applied it. */
  src?: number;
}

export interface Combatant {
  /** Unique within the battle. Party members 0..3, enemies 10+. */
  uid: number;
  side: 'party' | 'enemy';
  /** Member id or enemy def id. */
  key: string;
  name: string;
  level: number;
  hp: number;
  tp: number;
  base: Stats;
  status: StatusState[];
  /** Skills remaining uses. */
  uses: Record<string, number>;
  family?: Family;
  weak?: Partial<Record<Element, number>>;
  immune?: StatusId[];
  /** Enemy AI script id. */
  ai?: string;
  /** Enemy is a boss (can't flee, immune to instant effects). */
  boss?: boolean;
  /** Whether the enemy has been analyzed (shows HP / weaknesses). */
  analyzed?: boolean;
  /** Weapon element for basic attacks. */
  weaponElement?: Element;
  /** Boss phase counter and misc AI memory. */
  memory: Record<string, number>;
  /** Row slot for enemies (layout). */
  slot?: number;
  /** Party order index. */
  order?: number;
}

export type CommandType = 'attack' | 'tech' | 'skill' | 'item' | 'guard' | 'run';

export interface Command {
  actor: number;
  type: CommandType;
  /** Ability or item id. */
  id?: string;
  /** Target uid (single-target commands). -1 = auto. */
  target?: number;
}

export type BattleEvent =
  | { t: 'turn'; actor: number }
  | { t: 'act'; actor: number; name: string; kind: Ability['kind']; fx: string; targets: number[]; element?: Element }
  | { t: 'combo'; name: string; actors: number[]; fx: string; targets: number[] }
  | { t: 'damage'; target: number; amount: number; crit: boolean; element: Element; weak: boolean; resist: boolean; hp: number }
  | { t: 'miss'; target: number }
  | { t: 'heal'; target: number; amount: number; hp: number }
  | { t: 'tp'; target: number; amount: number; tp: number }
  | { t: 'status'; target: number; status: StatusId; on: boolean }
  | { t: 'down'; target: number }
  | { t: 'revive'; target: number; hp: number }
  | { t: 'msg'; text: string }
  | { t: 'flee'; ok: boolean }
  | { t: 'summon'; uids: number[] }
  | { t: 'phase'; target: number; key: string; name: string; hp: number }
  | { t: 'analyze'; target: number }
  | { t: 'fail'; actor: number; reason: string }
  | { t: 'tick'; target: number; amount: number; status: StatusId; hp: number };

export type Outcome = 'win' | 'lose' | 'fled' | null;
