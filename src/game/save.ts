/** Save slots in localStorage: 3 manual slots + 1 autosave. */
import { ABILITIES, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { ITEMS } from '../data/items';
import { getMap } from '../data/maps';
import { levelForXp, MEMBERS, xpFor } from '../data/party';
import { reconcileParty } from './party';
import { streams } from '../engine/rng';
import { SAVE_VERSION, setState, state, type EquipSlot, type GameState, type MemberId } from './state';
import { APP_VERSION } from '../version';
import { OBJ } from '../story/chapter1';

/**
 * Objective texts whose wording changed after saves had stored them. The current objective is saved as plain text
 * (flags.objective), so a save keeps the old wording until the story sets a new objective; loading swaps an exact
 * old text for today's. Old text -> today's text.
 */
const RENAMED_OBJECTIVES: Record<string, string> = {
  // Hex uses they/them (Mark's canon, 2026-10-03).
  'Find Hex. She lives above Chrome+Circuit, by the canal.': OBJ.hex,
};

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
  /** The game version (package.json) that wrote this save, such as '0.2.0-dev'. Absent on saves
   *  written before 0.2.0: that is fine, it is only shown to the player, never needed to load. */
  appVersion?: string;
}

interface SaveFile {
  meta: SaveMeta;
  state: GameState;
}

const key = (slot: SlotId) => `shadowjog.save.${slot}`;

/** Play time (frames) at the last successful save or load: the baseline for "unsaved progress". */
let savedAt = 0;

/** A new game has nothing saved yet: its unsaved progress counts from zero, not from whatever
 *  save was loaded earlier in this tab (which would silence the unload prompt and tab-hide
 *  autosave until the new game's clock caught up). */
export function resetSaveBaseline(): void {
  savedAt = 0;
}

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
    appVersion: APP_VERSION,
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

/**
 * What a slot holds: nothing ('empty'), a save that will load ('ok'), a broken one ('damaged'),
 * or a good save written by a NEWER save format than this build understands ('newer'). A newer
 * save is not damaged: it is fine, this build is just too old to read it. It is never loaded and
 * never silently replaced.
 */
export type SlotStatus = 'empty' | 'ok' | 'damaged' | 'newer';

/** The save-format number a slot's raw text claims, or null when it can't be read as a save at all. */
function savedFormat(raw: string): number | null {
  try {
    const v = (JSON.parse(raw) as Partial<SaveFile>).state?.version;
    return num(v) ? v : null;
  } catch {
    return null;
  }
}

/** Whether a slot holds a save that will actually load (full parse and validation, not just the header). */
export function slotStatus(slot: SlotId): SlotStatus {
  const raw = readRaw(slot);
  if (!raw) return 'empty';
  // Checked first, and on the raw text: a newer build may have reshaped the header too, so the
  // header and the state can't be trusted to validate here.
  if ((savedFormat(raw) ?? 0) > SAVE_VERSION) return 'newer';
  return readMeta(slot) && loadSave(slot) ? 'ok' : 'damaged';
}

/**
 * The game version that wrote a slot, for the "saved by a newer version" line. Null when the save
 * predates the field, or holds anything but a plain version string (letters, digits, dots, plus
 * and minus: what package.json versions use, and all the bitmap font can draw safely).
 */
export function savedByVersion(slot: SlotId): string | null {
  const raw = readRaw(slot);
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as Partial<SaveFile>).meta?.appVersion;
    return typeof v === 'string' && /^[0-9A-Za-z.+-]{1,24}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function loadSave(slot: SlotId): GameState | null {
  const raw = readRaw(slot);
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as SaveFile;
    if (!f.state || (f.state.version ?? 0) > SAVE_VERSION) return null;
    const s = migrateTo(f.state, SAVE_VERSION);
    return validState(s) ? sanitize(s) : null;
  } catch {
    return null;
  }
}

/**
 * Structural migrations, one per version step: MIGRATIONS[v] turns a v save into a v + 1 save
 * (a renamed field, a reshaped record). They run in order from the save's version. Purely
 * additive changes need no step: backfill() below fills anything missing at any version. A
 * change that renames or reshapes adds a step here and bumps SAVE_VERSION.
 */
export const MIGRATIONS: Record<number, (s: GameState) => void> = {
  // v1 -> v2: the Neural Buffer stopped fitting Rook (he has no TP for it to hold). One he was
  // wearing goes back in the bag, where anyone else can put it on.
  1: (s) => {
    const rook = s.members.rook;
    if (rook?.equip.mod === 'neural_buffer') {
      delete rook.equip.mod;
      s.inventory.neural_buffer = (s.inventory.neural_buffer ?? 0) + 1;
    }
  },
  // v2 -> v3: the retune after Mark's first playthrough (2026-09-29). Levels are rarer on a new XP
  // curve, Rook is a level-10 veteran, and some abilities come from story flags. A save keeps the
  // XP it earned: levels are worked out again on the new curve (never below a member's starting
  // level, so Rook is his 10), and the beats the crew has passed set their flags (Hex's Stingray
  // and Rook's re-tune once they have joined; Rook's mending once Sable has).
  2: (s) => {
    s.flags ??= {};
    if (s.flags.hex_joined) {
      s.flags.stingray_seated = true;
      s.flags.rook_tuned = true;
    }
    if (s.flags.sable_joined) s.flags.rook_mended = true;
    for (const m of Object.values(s.members)) {
      if (!m || !MEMBERS[m.id]) continue;
      const lv = Math.max(MEMBERS[m.id].startLevel, levelForXp(m.xp));
      m.level = lv;
      m.xp = Math.max(m.xp, xpFor(lv));
    }
  },
};

/** Bring a save from its version up to `target`: each step in order, then the backfill. */
export function migrateTo(s: GameState, target: number): GameState {
  for (let v = s.version ?? 0; v < target; v++) MIGRATIONS[v]?.(s);
  backfill(s);
  // Now it has every field this version expects: say so, so a later migration starts from here.
  s.version = target;
  return s;
}

function backfill(s: GameState): void {
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
  // An objective stored with wording that has since changed (runs for current-format saves too).
  const objective = s.flags.objective;
  const renamed = typeof objective === 'string' && Object.hasOwn(RENAMED_OBJECTIVES, objective) ? RENAMED_OBJECTIVES[objective] : undefined;
  if (renamed !== undefined) s.flags.objective = renamed;
}

const MEMBER_IDS: MemberId[] = ['kit', 'rook', 'hex', 'sable'];
/** A plain object (not null, not an array): what a save's maps (equipment, skill charges) must be. */
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural validation: a save that passes this can be loaded without crashing. */
export function validState(s: GameState): boolean {
  if (typeof s !== 'object' || s === null) return false;
  if (!Array.isArray(s.party) || s.party.length === 0) return false;
  if (!plain(s.members) || !s.party.every((id) => MEMBER_IDS.includes(id) && s.members[id])) return false;
  // Every stored member, not just the party: loading reconciles them all (reconcileParty), and a
  // benched one with a bad shape would crash it as surely (Copilot review of PR #1, 2026-10-02).
  // (`uses: true` used to pass and then crash the load, when charges were written into it.)
  for (const [id, m] of Object.entries(s.members)) {
    if (m === undefined) continue;
    if (!MEMBER_IDS.includes(id as MemberId) || !plain(m)) return false;
    if (!num(m.level) || !num(m.hp) || !num(m.tp) || !plain(m.equip) || !plain(m.uses) || !Array.isArray(m.ailments)) return false;
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
  for (const m of Object.values(s.members)) {
    if (!m) continue;
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
  // HP and TP within today's maximums, and charges for every skill the crew now knows.
  reconcileParty();
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

/** Play time as H:MM, or H:MM:SS with `seconds` (the results screen: a short run isn't 0:00). */
export function formatPlayTime(frames: number, seconds = false): string {
  const secs = Math.floor(frames / 60);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${h}:${String(m).padStart(2, '0')}${seconds ? `:${String(s).padStart(2, '0')}` : ''}`;
}
