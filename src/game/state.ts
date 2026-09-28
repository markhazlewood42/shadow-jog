/** Persistent game state (serialized to save files). Pure data — no DOM access. */
import type { Dir } from '../art/chars';

export type MemberId = 'kit' | 'rook' | 'hex' | 'sable';

export type EquipSlot = 'weapon' | 'body' | 'head' | 'mod';

export interface MemberState {
  id: MemberId;
  level: number;
  xp: number;
  hp: number;
  tp: number;
  /** Remaining uses per skill id (restored on rest). */
  uses: Record<string, number>;
  equip: Partial<Record<EquipSlot, string>>;
  /** Persistent ailments that survive battle (poison, down). */
  ailments: string[];
}

export interface GameState {
  version: number;
  party: MemberId[];
  members: Partial<Record<MemberId, MemberState>>;
  inventory: Record<string, number>;
  cred: number;
  flags: Record<string, number | boolean | string>;
  map: string;
  x: number;
  y: number;
  dir: Dir;
  lastTown: { map: string; x: number; y: number };
  /** Dungeon entrance to return to with a Getaway Chit. */
  lastEntrance: { map: string; x: number; y: number } | null;
  steps: number;
  playFrames: number;
  combos: string[];
  bestiary: Record<string, number>;
  /** Elements each enemy kind has been seen to be weak to (shown on the target cursor). */
  weakSeen: Record<string, string[]>;
  /** Last round's battle orders per member (for "Repeat"). */
  lastOrders: Partial<Record<MemberId, { cmd: string; id?: string }>>;
  rngState: number;
  battles: number;
}

export const SAVE_VERSION = 1;

export function newState(): GameState {
  return {
    version: SAVE_VERSION,
    party: [],
    members: {},
    inventory: {},
    cred: 0,
    flags: {},
    map: 'rook_flat',
    x: 6,
    y: 6,
    dir: 'down',
    lastTown: { map: 'lantern_row', x: 36, y: 16 },
    lastEntrance: null,
    steps: 0,
    playFrames: 0,
    combos: [],
    bestiary: {},
    weakSeen: {},
    lastOrders: {},
    rngState: 1,
    battles: 0,
  };
}

/** The live state. Replaced wholesale on load / new game. */
export let state: GameState = newState();

export function setState(s: GameState): void {
  state = s;
}

export const flags = {
  get(name: string): number | boolean | string | undefined {
    return state.flags[name];
  },
  has(name: string): boolean {
    return !!state.flags[name];
  },
  set(name: string, v: number | boolean | string = true): void {
    state.flags[name] = v;
  },
  inc(name: string, by = 1): number {
    const v = (Number(state.flags[name]) || 0) + by;
    state.flags[name] = v;
    return v;
  },
  clear(name: string): void {
    delete state.flags[name];
  },
};

export function itemCount(id: string): number {
  return state.inventory[id] ?? 0;
}

export function addItem(id: string, qty = 1): void {
  state.inventory[id] = Math.min(99, (state.inventory[id] ?? 0) + qty);
  if (state.inventory[id]! <= 0) delete state.inventory[id];
}

export function removeItem(id: string, qty = 1): boolean {
  const have = state.inventory[id] ?? 0;
  if (have < qty) return false;
  if (have === qty) delete state.inventory[id];
  else state.inventory[id] = have - qty;
  return true;
}
