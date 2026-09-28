/** Save slots in localStorage: 3 manual slots + 1 autosave. */
import { ABILITIES, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { ITEMS } from '../data/items';
import { getMap } from '../data/maps';
import { MEMBERS } from '../data/party';
import { streams } from '../engine/rng';
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

/** Play time (frames) at the last successful save or load: the baseline for "unsaved progress". */
let savedAt = 0;

/** Frames of play since the game was last saved or loaded. */
export function unsavedFrames(playFrames: number): number {
  return Math.max(0, playFrames - savedAt);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A slot's raw text, or null. Reading can throw too (blocked storage, a revoked origin), not just writing. */
function readRaw(slot: SlotId): string | null {
  try {
    return storage()?.getItem(key(slot)) ?? null;
  } catch {
    return null;
  }
}

/** A real number: JSON can carry 1e999 (Infinity), and a hand-edited save can carry anything. */
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  state.rngState = streams.encounter.state;
  state.rngBattle = streams.battle.state;
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
    savedAt = playFrames;
    return true;
  } catch {
    return false;
  }
}

export function readMeta(slot: SlotId): SaveMeta | null {
  const raw = readRaw(slot);
  if (!raw) return null;
  try {
    const m = (JSON.parse(raw) as Partial<SaveFile>).meta;
    const ok = !!m && num(m.when) && typeof m.location === 'string' && num(m.leaderLevel)
      && Array.isArray(m.party) && num(m.playFrames) && num(m.cred);
    return ok ? m : null;
  } catch {
    return null;
  }
}

export type SlotStatus = 'empty' | 'ok' | 'damaged';

/** Whether a slot holds a save that will actually load (full parse and validation, not just the header). */
export function slotStatus(slot: SlotId): SlotStatus {
  if (!readRaw(slot)) return 'empty';
  return readMeta(slot) && loadSave(slot) ? 'ok' : 'damaged';
}

export function loadSave(slot: SlotId): GameState | null {
  const raw = readRaw(slot);
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
  // Saves from before the Places list: infer where the crew has been from the story so far.
  const seen: [string, boolean][] = [
    ['lantern_row', true], ['world', !!s.flags.met_dutch], ['rustyard', !!s.flags.rustyard_gate],
    ['sinkline_1', !!s.flags.sinkline_gate], ['annex', !!s.flags.annex_key], ['dock', !!s.flags.betrayal],
  ];
  for (const [id, been] of seen) if (been) s.flags[`visit:${id}`] ??= true;
  // Now it has every field this version expects: say so, so a later migration starts from here.
  s.version = SAVE_VERSION;
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
    if (!num(m.level) || !num(m.hp) || !num(m.tp) || typeof m.equip !== 'object' || !m.uses || !Array.isArray(m.ailments)) return false;
  }
  if (!onMap(s.map, s.x, s.y)) return false;
  if (typeof s.inventory !== 'object' || s.inventory === null || typeof s.flags !== 'object' || !num(s.cred)) return false;
  if (!s.lastTown || !onMap(s.lastTown.map, s.lastTown.x, s.lastTown.y)) return false;
  for (const book of [s.bestiary, s.weakSeen, s.resistSeen, s.immuneSeen, s.lastOrders]) {
    if (typeof book !== 'object' || book === null) return false;
  }
  return Array.isArray(s.combos);
}

/** A position the player can actually be put at: a known map, whole-tile coordinates inside it. */
function onMap(id: unknown, x: unknown, y: unknown): boolean {
  if (!mapExists(id) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const t = getMap(id as string).terrain;
  return (y as number) >= 0 && (y as number) < t.length && (x as number) >= 0 && (x as number) < (t[0]?.length ?? 0);
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
    m.level = Math.min(99, Math.max(1, Math.floor(m.level)));
    m.hp = Math.max(0, Math.floor(m.hp));
    m.tp = Math.max(0, Math.floor(m.tp));
    if (!num(m.xp) || m.xp < 0) m.xp = 0;
  }
  s.cred = Math.max(0, Math.floor(s.cred));
  // Counters only feed displays and pacing: a bad one resets rather than rejecting the save.
  for (const k of ['steps', 'playFrames', 'battles'] as const) if (!num(s[k]) || s[k] < 0) s[k] = 0;
  for (const k of ['rngState', 'rngBattle'] as const) if (!num(s[k])) delete (s as Partial<GameState>)[k];
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
  if (s.lastEntrance && !onMap(s.lastEntrance.map, s.lastEntrance.x, s.lastEntrance.y)) s.lastEntrance = null;
  return s;
}

export function applySave(s: GameState): void {
  setState(s);
  savedAt = s.playFrames;
  if (s.rngState) streams.encounter.state = s.rngState;
  if (s.rngBattle) streams.battle.state = s.rngBattle;
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
