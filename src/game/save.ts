/** Save slots in localStorage: 3 manual slots + 1 autosave. */
import { getMap } from '../data/maps';
import { MEMBERS } from '../data/party';
import { rng } from '../engine/rng';
import { SAVE_VERSION, setState, state, type GameState, type MemberId } from './state';

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
    return (JSON.parse(raw) as SaveFile).meta;
  } catch {
    return null;
  }
}

export function loadSave(slot: SlotId): GameState | null {
  const raw = storage()?.getItem(key(slot));
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as SaveFile;
    if (!f.state || (f.state.version ?? 0) > SAVE_VERSION) return null;
    const s = migrate(f.state);
    return validState(s) ? s : null;
  } catch {
    return null;
  }
}

function migrate(s: GameState): GameState {
  // Fill in any fields added after the save was written.
  s.combos ??= [];
  s.bestiary ??= {};
  s.lastOrders ??= {};
  s.lastEntrance ??= null;
  s.battles ??= 0;
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
  if (typeof s.inventory !== 'object' || typeof s.flags !== 'object' || typeof s.cred !== 'number') return false;
  if (!s.lastTown || typeof s.lastTown.map !== 'string') return false;
  return true;
}

export function applySave(s: GameState): void {
  setState(s);
  if (s.rngState) rng.state = s.rngState;
}

export function hasAnySave(): boolean {
  return (['auto', 1, 2, 3] as SlotId[]).some((s) => readMeta(s));
}

export function latestSlot(): SlotId | null {
  let best: SaveMeta | null = null;
  for (const s of ['auto', 1, 2, 3] as SlotId[]) {
    const m = readMeta(s);
    if (m && (!best || m.when > best.when)) best = m;
  }
  return best?.slot ?? null;
}

export function formatPlayTime(frames: number): string {
  const secs = Math.floor(frames / 60);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
