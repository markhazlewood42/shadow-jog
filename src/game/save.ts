/** Save slots in localStorage: 3 manual slots + 1 autosave. */
import { ABILITIES, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { ITEMS } from '../data/items';
import { getMap } from '../data/maps';
import { MEMBERS } from '../data/party';
import { rng } from '../engine/rng';
import { SAVE_VERSION, setState, state, type EquipSlot, type GameState, type MemberId } from './state';

export type SlotId = 'auto' | 1 | 2 | 3;
export const SLOTS: SlotId[] = [1, 2, 3];

export interface SaveMeta {
  slot: SlotId;
  when: number;
  location: string;
  leaderLevel: number;
  party: string[];
  playFrames: number;
  cred: number;
}

interface SaveFile {
  meta: SaveMeta;
  state: GameState;
}

const key = (slot: SlotId) => `shadowjog.save.${slot}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function locationName(mapId: string): string {
  try {
    return getMap(mapId).name;
  } catch {
    return mapId;
  }
}

export function writeSave(slot: SlotId, playFrames: number): boolean {
  const st = storage();
  if (!st) return false;
  state.playFrames = playFrames;
  state.rngState = rng.state;
  const lead = state.members[state.party[0]!];
  const meta: SaveMeta = {
    slot,
    when: Date.now(),
    location: locationName(state.map),
    leaderLevel: lead?.level ?? 1,
    party: state.party.map((id) => MEMBERS[id].name),
    playFrames,
    cred: state.cred,
  };
  try {
    st.setItem(key(slot), JSON.stringify({ meta, state } satisfies SaveFile));
    return true;
  } catch {
    return false;
  }
}

export function readMeta(slot: SlotId): SaveMeta | null {
  const raw = storage()?.getItem(key(slot));
  if (!raw) return null;
  try {
    const m = (JSON.parse(raw) as Partial<SaveFile>).meta;
    const ok = !!m && typeof m.when === 'number' && typeof m.location === 'string' && typeof m.leaderLevel === 'number'
      && Array.isArray(m.party) && typeof m.playFrames === 'number' && typeof m.cred === 'number';
    return ok ? m : null;
  } catch {
    return null;
  }
}

export type SlotStatus = 'empty' | 'ok' | 'damaged';

/** Whether a slot holds a save that will actually load (full parse and validation, not just the header). */
export function slotStatus(slot: SlotId): SlotStatus {
  if (!storage()?.getItem(key(slot))) return 'empty';
  return readMeta(slot) && loadSave(slot) ? 'ok' : 'damaged';
}

export function loadSave(slot: SlotId): GameState | null {
  const raw = storage()?.getItem(key(slot));
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as SaveFile;
    if (!f.state || (f.state.version ?? 0) > SAVE_VERSION) return null;
    const s = migrate(f.state);
    return validState(s) ? sanitize(s) : null;
  } catch {
    return null;
  }
}

function migrate(s: GameState): GameState {
  // Fill in any fields added after the save was written.
  s.combos ??= [];
  s.bestiary ??= {};
  s.weakSeen ??= {};
  s.resistSeen ??= {};
  s.immuneSeen ??= {};
  s.lastOrders ??= {};
  s.lastEntrance ??= null;
  s.battles ??= 0;
  s.dir ??= 'down';
  s.steps ??= 0;
  s.flags ??= {};
  return s;
}

const MEMBER_IDS: MemberId[] = ['kit', 'rook', 'hex', 'sable'];

/** Structural validation: a save that passes this can be loaded without crashing. */
export function validState(s: GameState): boolean {
  if (typeof s !== 'object' || s === null) return false;
  if (!Array.isArray(s.party) || s.party.length === 0) return false;
  if (!s.party.every((id) => MEMBER_IDS.includes(id) && s.members?.[id])) return false;
  for (const id of s.party) {
    const m = s.members[id]!;
    if (typeof m.level !== 'number' || typeof m.hp !== 'number' || typeof m.tp !== 'number' || typeof m.equip !== 'object' || !m.uses || !Array.isArray(m.ailments)) return false;
  }
  if (typeof s.map !== 'string' || typeof s.x !== 'number' || typeof s.y !== 'number') return false;
  try {
    getMap(s.map);
  } catch {
    return false;
  }
  if (typeof s.inventory !== 'object' || s.inventory === null || typeof s.flags !== 'object' || typeof s.cred !== 'number') return false;
  if (!s.lastTown || !mapExists(s.lastTown.map)) return false;
  for (const book of [s.bestiary, s.weakSeen, s.resistSeen, s.immuneSeen, s.lastOrders]) {
    if (typeof book !== 'object' || book === null) return false;
  }
  return Array.isArray(s.combos);
}

function mapExists(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  try {
    getMap(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Content references: ids that no longer exist (a renamed item, a hand-edited save) are dropped
 * rather than rejecting the whole save, so a stale id can never crash a menu later. Runs after
 * validState, so the containers are known to be the right shape.
 */
export function sanitize(s: GameState): GameState {
  const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  for (const [id, n] of Object.entries(s.inventory)) if (!ITEMS[id] || !count(n)) delete s.inventory[id];
  for (const id of s.party) {
    const m = s.members[id]!;
    for (const [slot, item] of Object.entries(m.equip)) {
      if (typeof item !== 'string' || ITEMS[item]?.slot !== slot) delete m.equip[slot as EquipSlot];
    }
    for (const [ab, n] of Object.entries(m.uses)) if (!ABILITIES[ab] || typeof n !== 'number') delete m.uses[ab];
    m.ailments = m.ailments.filter((a) => typeof a === 'string');
    m.hp = Math.max(0, m.hp);
  }
  for (const book of [s.bestiary, s.weakSeen, s.resistSeen, s.immuneSeen]) {
    for (const k of Object.keys(book)) if (!ENEMIES[k]) delete book[k];
  }
  for (const book of [s.weakSeen, s.resistSeen, s.immuneSeen]) {
    for (const k of Object.keys(book)) if (!Array.isArray(book[k])) delete book[k];
  }
  for (const [k, n] of Object.entries(s.bestiary)) if (!count(n)) delete s.bestiary[k];
  s.combos = s.combos.filter((c) => COMBOS.some((d) => d.id === c));
  for (const [id, o] of Object.entries(s.lastOrders)) {
    if (!o || typeof o.cmd !== 'string' || (o.id !== undefined && !ABILITIES[o.id] && !ITEMS[o.id])) delete s.lastOrders[id as MemberId];
  }
  if (s.lastEntrance && !mapExists(s.lastEntrance.map)) s.lastEntrance = null;
  return s;
}

export function applySave(s: GameState): void {
  setState(s);
  if (s.rngState) rng.state = s.rngState;
}

/** Any slot in use, loadable or not (so Load is offered and a damaged slot can be seen). */
export function hasAnySave(): boolean {
  return (['auto', 1, 2, 3] as SlotId[]).some((s) => slotStatus(s) !== 'empty');
}

/** The most recently written slot; with `loadable`, the most recent one that will actually load. */
export function latestSlot(loadable = false): SlotId | null {
  let best: SaveMeta | null = null;
  for (const s of ['auto', 1, 2, 3] as SlotId[]) {
    const m = readMeta(s);
    if (m && (!best || m.when > best.when) && (!loadable || slotStatus(s) === 'ok')) best = { ...m, slot: s };
  }
  return best?.slot ?? null;
}

export function formatPlayTime(frames: number): string {
  const secs = Math.floor(frames / 60);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
