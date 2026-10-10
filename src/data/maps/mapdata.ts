/**
 * Map data (M5 task 3, decision 1): a map is a JSON file of plain values plus a behavior module of code, joined here into today's `MapDef`.
 *
 *   src/data/maps/<id>.json   grid, legend, structures, props, lights, npcs, warps, events, chests, patches, weather ... (what an editor changes)
 *   src/data/maps/<id>.ts     the `MapBehavior`: `when` predicates and story scripts, each under a string id (what only a programmer changes)
 *
 * The JSON refers to code by id, always as a plain string:
 *   - `"when": "gate_unpassed"` is a key of `behavior.when` (a function of the story flags, like today's `(f) => !f.rustyard_gate`);
 *   - `"run"`, `"blocked"`, `"onEnter"` are keys of `behavior.scripts` (a `ScriptFn`);
 *   - `"talk"` is a list of lines (plain data, `string[]`) or one string, a key of `behavior.scripts`;
 *   - an npc's `"look"` is a string, a key of `LOOKS` (the shared object, so `art/drawn.ts`'s identity check still works), or an inline `CharLook`.
 *
 * `checkMap` lists every problem in plain words (like `checkEnemies`); `joinMap` throws with that list, so a bad edit stops at load, and
 * otherwise returns the `MapDef`. `tests/mapdata.test.ts` proves the join gives the same object as the old TypeScript map (a frozen copy).
 *
 * What the check does NOT do: look at the terrain characters. A character with no legend entry falls to `void` in `FieldMap`; `tests/maps.test.ts`
 * and `tests/mapgraph.ts` already walk every map. It does not check that a warp's target map exists either (the registry's tests do).
 */
import type { CharLook } from '../../art/chars';
import type { ChestDef, EventDef, LightDef, MapDef, NpcDef, PropDef, PropKind, TerrainId, WarpDef } from '../../field/types';
import type { ScriptFn } from '../../game/script';
import { LOOKS } from '../looks';

/** A function of the story flags: whether a prop, light, npc, warp, event, chest or patch is there. */
export type Predicate = (flags: Record<string, unknown>) => boolean;

/** The code of one map, under ids. */
export interface MapBehavior {
  when: Record<string, Predicate>;
  scripts: Record<string, ScriptFn>;
}

/** An id of a predicate in `behavior.when`. */
type WhenRef = string;
/** An id of a script in `behavior.scripts`. */
type ScriptRef = string;

/** `T` with the `when` field as an id. */
type WithWhenRef<T extends { when?: unknown }> = Omit<T, 'when'> & { when?: WhenRef | undefined };

export interface NpcData extends Omit<NpcDef, 'when' | 'talk' | 'look'> {
  look: string | CharLook;
  talk?: string | string[] | undefined;
  when?: WhenRef | undefined;
}
export interface WarpData extends Omit<WarpDef, 'when' | 'blocked'> {
  when?: WhenRef | undefined;
  blocked?: ScriptRef | undefined;
}
export interface EventData extends Omit<EventDef, 'when' | 'run'> {
  when?: WhenRef | undefined;
  run: ScriptRef;
}
export interface PatchData {
  when: WhenRef;
  rects: [number, number, number, number, string][];
}

/** The shape of a map file, with code as ids. (A JSON import types its strings as `string`; `checkMap` is what proves the shape.) */
export interface MapData extends Omit<MapDef, 'props' | 'lights' | 'npcs' | 'warps' | 'events' | 'chests' | 'patches' | 'onEnter'> {
  props?: WithWhenRef<PropDef>[] | undefined;
  lights?: WithWhenRef<LightDef>[] | undefined;
  npcs?: NpcData[] | undefined;
  warps?: WarpData[] | undefined;
  events?: EventData[] | undefined;
  chests?: WithWhenRef<ChestDef>[] | undefined;
  patches?: PatchData[] | undefined;
  onEnter?: ScriptRef | undefined;
}

// ---- what is allowed -----------------------------------------------------------------------------------------------------------------

/** Every terrain id. A `Record` over the union, so adding a terrain to `TerrainId` is a type error here until it is listed. */
const TERRAIN: Record<TerrainId, true> = {
  void: true, asphalt: true, roadline: true, crosswalk: true, sidewalk: true, alley: true, puddle: true, grate: true, water: true, bridge: true,
  wall: true, plaza: true, dirt: true, grass: true, rubble: true, rail: true, junk: true,
  floor_wood: true, floor_tile: true, floor_metal: true, floor_carpet: true, floor_concrete: true, iwall: true,
  d_floor: true, d_wall: true, d_water: true, d_shallow: true, d_catwalk: true, d_track: true, lab_floor: true, lab_wall: true, lab_door: true,
  lab_laser: true, lab_laser_off: true, lab_floor_steel: true, lab_floor_frost: true, lab_floor_contain: true, lab_floor_plate: true,
  d_wall_crack: true, junk_loose: true,
  w_ruins: true, w_road: true, w_barrens: true, w_toxic: true, w_park: true, w_highway: true, w_bridge: true, w_block: true,
};

/** Every prop kind, the same way. */
const PROP_KINDS: Record<PropKind, true> = {
  lamp: true, vending: true, barrel: true, firebarrel: true, crates: true, dumpster: true, trash: true, car: true, wreck: true, hydrant: true,
  bench: true, stall: true, pillar: true, tree: true, wildtree: true, shrine: true, pole: true, planter: true, terminal: true, pipe_v: true, steam: true,
  barrier: true, cone: true, holo: true, poster: true, counter: true, shelf: true, bed: true, table: true, stool: true, couch: true, plant: true, screen: true,
  capsule: true, bar: true, rack: true, garments: true, desk: true, pod: true, server: true, tank: true, fence: true, sandbags: true, tent: true, pylon: true,
  catwalk_rail: true, train: true, valve: true, cryopod: true, door_lab: true, jukebox: true, arcade: true, sign_post: true, bollard: true,
  window: true, lampfloor: true, sign_board: true, tires: true, body: true, ladder: true, tag: true, banner: true, crest: true, memorial: true, bedroll: true,
  laser: true, loom: true, lure: true, panel_loose: true, binding_circle: true, hazard_lane: true, dome: true, mast: true, watertower: true,
};

const KINDS = ['town', 'interior', 'dungeon', 'world'] as const;
const WEATHERS = ['rain', 'drip', 'dust', 'none'] as const;
const DIRS = ['down', 'up', 'left', 'right'] as const;
const SPACES = ['room', 'hall', 'cave', 'tunnel'] as const;
const STYLES = ['brick', 'concrete', 'metal', 'tile', 'glass', 'shanty', 'corp'] as const;
const ROOFS = ['flat', 'garden', 'billboard'] as const;
const EVENT_ON = ['touch', 'action'] as const;
const CHEST_KINDS = ['crate', 'locker', 'case'] as const;
const CRITTERS = ['cat', 'crow'] as const;

const MAP_FIELDS = ['id', 'name', 'kind', 'terrain', 'legend', 'structures', 'props', 'npcs', 'warps', 'events', 'chests', 'lights', 'ambient', 'weather', 'music', 'space', 'encounters', 'onEnter', 'strings', 'banner', 'bannerSub', 'voidColor', 'town', 'battleBg', 'patches', 'entrance'];
const BUILDING_FIELDS = ['kind', 'x', 'y', 'w', 'h', 'facade', 'style', 'doors', 'shutters', 'sign', 'signs', 'awning', 'shopfront', 'seed', 'roof', 'billboard'];
const PROP_FIELDS = ['kind', 'x', 'y', 'color', 'text', 'w', 'h', 'dir', 'pass', 'id', 'when'];
const LIGHT_FIELDS = ['x', 'y', 'r', 'color', 'i', 'flicker', 'px', 'when'];
const NPC_FIELDS = ['id', 'x', 'y', 'dir', 'look', 'name', 'move', 'radius', 'talk', 'when', 'fixedDir', 'critter'];
const WARP_FIELDS = ['x', 'y', 'w', 'h', 'to', 'tx', 'ty', 'dir', 'door', 'when', 'blocked', 'confirm'];
const EVENT_FIELDS = ['id', 'x', 'y', 'w', 'h', 'on', 'run', 'once', 'when'];
const CHEST_FIELDS = ['id', 'x', 'y', 'item', 'qty', 'cred', 'kind', 'when'];
const ZONE_FIELDS = ['table', 'rate', 'terrain', 'rect', 'bg'];
const PATCH_FIELDS = ['when', 'rects'];
const STRING_FIELDS = ['a', 'b', 'sag', 'lanterns'];
const ENTRANCE_FIELDS = ['map', 'x', 'y'];

// ---- the check -----------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Every problem with a map file, in plain words. `behavior` is the map's code: an id the data uses must be in it, and an entry of it that no data
 * uses is a problem too (that is how a script lost in a move shows up).
 */
export function checkMap(data: unknown, behavior: MapBehavior): string[] {
  if (!isObj(data)) return ['map: the file must be an object'];
  const out: string[] = [];
  const usedWhen = new Set<string>();
  const usedScripts = new Set<string>();
  const at = `map "${isText(data.id) ? data.id : '?'}"`;

  const fields = (o: Obj, allowed: readonly string[], where: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push(`${where}: "${k}" is not a field of this`);
  };
  const pred = (v: unknown, where: string): void => {
    if (v === undefined) return;
    if (!isText(v)) out.push(`${where}: when must be text, the id of a predicate`);
    else if (!(v in behavior.when)) out.push(`${where}: when "${v}" is not in the behavior module (it has: ${Object.keys(behavior.when).join(', ') || 'nothing'})`);
    else usedWhen.add(v);
  };
  const script = (v: unknown, name: string, where: string, required = false): void => {
    if (v === undefined) {
      if (required) out.push(`${where}: ${name} is needed, the id of a script`);
      return;
    }
    if (!isText(v)) out.push(`${where}: ${name} must be text, the id of a script`);
    else if (!(v in behavior.scripts)) out.push(`${where}: ${name} "${v}" is not in the behavior module (it has: ${Object.keys(behavior.scripts).join(', ') || 'nothing'})`);
    else usedScripts.add(v);
  };
  const list = (v: unknown, name: string): unknown[] | null => {
    if (v === undefined) return null;
    if (!Array.isArray(v)) {
      out.push(`${at}: ${name} must be a list`);
      return null;
    }
    return v;
  };
  const place = (o: Obj, w: string, size = false): void => {
    if (!isInt(o.x) || !isInt(o.y)) out.push(`${w}: x and y must be whole numbers (tiles)`);
    for (const k of size ? ['w', 'h'] : []) if (!isInt(o[k]) || (o[k] as number) < 1) out.push(`${w}: ${k} must be a whole number, 1 or more`);
    for (const k of size ? [] : ['w', 'h']) if (o[k] !== undefined && (!isInt(o[k]) || (o[k] as number) < 1)) out.push(`${w}: ${k} must be a whole number, 1 or more`);
  };
  const ids = (items: unknown[], name: string): void => {
    const seen = new Set<string>();
    for (const it of items) {
      if (!isObj(it) || !isText(it.id)) continue;
      if (seen.has(it.id)) out.push(`${at}: two ${name} have the id "${it.id}"`);
      seen.add(it.id);
    }
  };

  fields(data, MAP_FIELDS, at);
  if (!isText(data.id)) out.push(`${at}: id must be text`);
  if (!isText(data.name)) out.push(`${at}: name must be text`);
  if (!oneOf(KINDS, data.kind)) out.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
  if (!isText(data.music)) out.push(`${at}: music must be text`);
  if (!isText(data.ambient) || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(data.ambient)) out.push(`${at}: ambient must be a color like #605a86`);
  if (data.weather !== undefined && !oneOf(WEATHERS, data.weather)) out.push(`${at}: weather must be one of ${WEATHERS.join(', ')}`);
  if (data.space !== undefined && !oneOf(SPACES, data.space)) out.push(`${at}: space must be one of ${SPACES.join(', ')}`);
  for (const k of ['banner', 'bannerSub', 'voidColor', 'battleBg'] as const) if (data[k] !== undefined && !isText(data[k])) out.push(`${at}: ${k} must be text`);
  if (data.town !== undefined && typeof data.town !== 'boolean') out.push(`${at}: town must be true or false`);
  script(data.onEnter, 'onEnter', at);

  const rows = data.terrain;
  if (!Array.isArray(rows) || !rows.length || !rows.every((r) => typeof r === 'string')) out.push(`${at}: terrain must be a list of rows of text, at least one`);
  const height = Array.isArray(rows) ? rows.length : 0;
  const width = Array.isArray(rows) ? Math.max(0, ...rows.map((r) => (typeof r === 'string' ? r.length : 0))) : 0;
  const inside = (o: Obj, w: string, size = false): void => {
    if (!isInt(o.x) || !isInt(o.y) || !height) return;
    const ww = size && isInt(o.w) ? o.w : 1;
    const hh = size && isInt(o.h) ? o.h : 1;
    if (o.x < 0 || o.y < 0 || o.x + ww > width || o.y + hh > height) out.push(`${w}: it is at ${o.x},${o.y} but the map is ${width} by ${height} tiles`);
  };

  if (!isObj(data.legend)) out.push(`${at}: legend must be an object, one terrain id per character`);
  else {
    for (const [ch, id] of Object.entries(data.legend)) {
      if ([...ch].length !== 1) out.push(`${at}: legend key "${ch}" must be one character`);
      if (typeof id !== 'string' || !(id in TERRAIN)) out.push(`${at}: legend "${ch}" is "${String(id)}", which is not a terrain`);
    }
  }

  list(data.structures, 'structures')?.forEach((s, i) => {
    const w = `${at}, structure ${i + 1}`;
    if (!isObj(s)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(s, BUILDING_FIELDS, w);
    if (s.kind !== 'building') out.push(`${w}: kind must be "building"`);
    place(s, w, true);
    inside(s, w, true);
    if (!oneOf(STYLES, s.style)) out.push(`${w}: style must be one of ${STYLES.join(', ')}`);
    if (s.roof !== undefined && !oneOf(ROOFS, s.roof)) out.push(`${w}: roof must be one of ${ROOFS.join(', ')}`);
  });

  const props = list(data.props, 'props');
  props?.forEach((p, i) => {
    const w = `${at}, prop ${i + 1}`;
    if (!isObj(p)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(p, PROP_FIELDS, w);
    if (typeof p.kind !== 'string' || !(p.kind in PROP_KINDS)) out.push(`${w}: kind "${String(p.kind)}" is not a prop`);
    place(p, w);
    inside(p, w);
    if (p.dir !== undefined && !oneOf(DIRS, p.dir)) out.push(`${w}: dir must be one of ${DIRS.join(', ')}`);
    pred(p.when, w);
  });

  list(data.lights, 'lights')?.forEach((l, i) => {
    const w = `${at}, light ${i + 1}`;
    if (!isObj(l)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(l, LIGHT_FIELDS, w);
    if (!isNum(l.x) || !isNum(l.y)) out.push(`${w}: x and y must be numbers`);
    if (!isNum(l.r) || l.r <= 0) out.push(`${w}: r (the radius) must be a number above 0`);
    if (!isText(l.color) || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(l.color)) out.push(`${w}: color must be a color like #86f08c`);
    if (l.i !== undefined && (!isNum(l.i) || l.i < 0)) out.push(`${w}: i (the intensity) must be a number, 0 or more`);
    pred(l.when, w);
  });

  const npcs = list(data.npcs, 'npcs');
  npcs?.forEach((n, i) => {
    const w = `${at}, npc ${isObj(n) && isText(n.id) ? `"${n.id}"` : i + 1}`;
    if (!isObj(n)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(n, NPC_FIELDS, w);
    if (!isText(n.id)) out.push(`${w}: id must be text`);
    place(n, w);
    inside(n, w);
    if (n.dir !== undefined && !oneOf(DIRS, n.dir)) out.push(`${w}: dir must be one of ${DIRS.join(', ')}`);
    if (typeof n.look === 'string') {
      if (!(n.look in LOOKS)) out.push(`${w}: look "${n.look}" is not in LOOKS`);
    } else if (!isObj(n.look) || !isText(n.look.skin) || !isText(n.look.hair)) out.push(`${w}: look must be the name of a look or a look object (with skin, hair ...)`);
    if (n.name !== undefined && !isText(n.name)) out.push(`${w}: name must be text`);
    if (n.critter !== undefined && !oneOf(CRITTERS, n.critter)) out.push(`${w}: critter must be one of ${CRITTERS.join(', ')}`);
    if (n.radius !== undefined && (!isInt(n.radius) || n.radius < 0)) out.push(`${w}: radius must be a whole number, 0 or more`);
    if (n.move !== undefined && n.move !== 'static' && n.move !== 'wander' && !(isObj(n.move) && Array.isArray(n.move.path))) out.push(`${w}: move must be "static", "wander" or an object with a path`);
    if (n.talk !== undefined) {
      if (Array.isArray(n.talk)) {
        if (!n.talk.length || !n.talk.every((t) => typeof t === 'string')) out.push(`${w}: talk as a list must be lines of text, at least one`);
      } else script(n.talk, 'talk', w);
    }
    pred(n.when, w);
  });
  if (npcs) ids(npcs, 'npcs');

  list(data.warps, 'warps')?.forEach((x, i) => {
    const w = `${at}, warp ${i + 1}`;
    if (!isObj(x)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(x, WARP_FIELDS, w);
    place(x, w);
    inside(x, w, true);
    if (!isText(x.to)) out.push(`${w}: to must be text, the id of a map`);
    if (!isInt(x.tx) || !isInt(x.ty)) out.push(`${w}: tx and ty must be whole numbers`);
    if (x.dir !== undefined && !oneOf(DIRS, x.dir)) out.push(`${w}: dir must be one of ${DIRS.join(', ')}`);
    if (x.confirm !== undefined && !isText(x.confirm)) out.push(`${w}: confirm must be text`);
    pred(x.when, w);
    script(x.blocked, 'blocked', w);
  });

  const events = list(data.events, 'events');
  events?.forEach((e, i) => {
    const w = `${at}, event ${isObj(e) && isText(e.id) ? `"${e.id}"` : i + 1}`;
    if (!isObj(e)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(e, EVENT_FIELDS, w);
    if (!isText(e.id)) out.push(`${w}: id must be text`);
    place(e, w);
    inside(e, w, true);
    if (!oneOf(EVENT_ON, e.on)) out.push(`${w}: on must be one of ${EVENT_ON.join(', ')}`);
    if (e.once !== undefined && typeof e.once !== 'boolean') out.push(`${w}: once must be true or false`);
    pred(e.when, w);
    script(e.run, 'run', w, true);
  });
  if (events) ids(events, 'events');

  const chests = list(data.chests, 'chests');
  chests?.forEach((c, i) => {
    const w = `${at}, chest ${isObj(c) && isText(c.id) ? `"${c.id}"` : i + 1}`;
    if (!isObj(c)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(c, CHEST_FIELDS, w);
    if (!isText(c.id)) out.push(`${w}: id must be text`);
    place(c, w);
    inside(c, w);
    if (c.item !== undefined && !isText(c.item)) out.push(`${w}: item must be text`);
    if (c.qty !== undefined && (!isInt(c.qty) || c.qty < 1)) out.push(`${w}: qty must be a whole number, 1 or more`);
    if (c.cred !== undefined && (!isInt(c.cred) || c.cred < 0)) out.push(`${w}: cred must be a whole number, 0 or more`);
    if (c.item === undefined && c.cred === undefined) out.push(`${w}: a chest needs an item or cred`);
    if (c.kind !== undefined && !oneOf(CHEST_KINDS, c.kind)) out.push(`${w}: kind must be one of ${CHEST_KINDS.join(', ')}`);
    pred(c.when, w);
  });
  if (chests) ids(chests, 'chests');

  list(data.encounters, 'encounters')?.forEach((z, i) => {
    const w = `${at}, encounter zone ${i + 1}`;
    if (!isObj(z)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(z, ZONE_FIELDS, w);
    if (!isText(z.table)) out.push(`${w}: table must be text`);
    if (!isNum(z.rate) || z.rate <= 0) out.push(`${w}: rate must be a number above 0`);
    if (z.terrain !== undefined && (!Array.isArray(z.terrain) || !z.terrain.every((t) => typeof t === 'string' && t in TERRAIN))) out.push(`${w}: terrain must be a list of terrain ids`);
    if (z.rect !== undefined && (!Array.isArray(z.rect) || z.rect.length !== 4 || !z.rect.every(isInt))) out.push(`${w}: rect must be four whole numbers [x, y, w, h]`);
    if (z.bg !== undefined && !isText(z.bg)) out.push(`${w}: bg must be text`);
  });

  list(data.strings, 'strings')?.forEach((s, i) => {
    const w = `${at}, string ${i + 1}`;
    if (!isObj(s)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(s, STRING_FIELDS, w);
    for (const k of ['a', 'b']) if (!Array.isArray(s[k]) || s[k].length !== 2 || !s[k].every(isNum)) out.push(`${w}: ${k} must be two numbers [x, y]`);
    if (s.sag !== undefined && !isNum(s.sag)) out.push(`${w}: sag must be a number`);
    if (s.lanterns !== undefined && (!Array.isArray(s.lanterns) || !s.lanterns.every((c) => typeof c === 'string'))) out.push(`${w}: lanterns must be a list of colors`);
  });

  list(data.patches, 'patches')?.forEach((p, i) => {
    const w = `${at}, patch ${i + 1}`;
    if (!isObj(p)) {
      out.push(`${w}: must be an object`);
      return;
    }
    fields(p, PATCH_FIELDS, w);
    if (p.when === undefined) out.push(`${w}: a patch needs a when (a patch that always applies is a change to the terrain)`);
    pred(p.when, w);
    if (!Array.isArray(p.rects) || !p.rects.length) out.push(`${w}: rects must be a list, at least one [x, y, w, h, character]`);
    else {
      for (const r of p.rects as unknown[]) {
        if (!Array.isArray(r) || r.length !== 5 || !r.slice(0, 4).every(isInt) || typeof r[4] !== 'string' || [...r[4]].length !== 1) out.push(`${w}: each rect needs four whole numbers and one character`);
        else if (height && (r[0] < 0 || r[1] < 0 || r[0] + r[2] > width || r[1] + r[3] > height)) out.push(`${w}: rect ${JSON.stringify(r)} is outside the map (${width} by ${height})`);
      }
    }
  });

  if (data.entrance !== undefined) {
    if (!isObj(data.entrance)) out.push(`${at}: entrance must be an object {map, x, y}`);
    else {
      fields(data.entrance, ENTRANCE_FIELDS, `${at}, entrance`);
      if (!isText(data.entrance.map) || !isInt(data.entrance.x) || !isInt(data.entrance.y)) out.push(`${at}: entrance needs a map (text) and whole-number x and y`);
    }
  }

  for (const id of Object.keys(behavior.when)) if (!usedWhen.has(id)) out.push(`${at}: the behavior module has the predicate "${id}", which no data uses (a reference was lost)`);
  for (const id of Object.keys(behavior.scripts)) if (!usedScripts.has(id)) out.push(`${at}: the behavior module has the script "${id}", which no data uses (a reference was lost)`);
  return out;
}

// ---- the join ------------------------------------------------------------------------------------------------------------------------

/**
 * The map file and its behavior, checked (throws a readable error listing every problem), joined into a `MapDef`.
 * Code comes from the behavior module by id, so a joined `when` or script IS the module's export (the same function object).
 */
export function joinMap(data: unknown, behavior: MapBehavior): MapDef {
  const problems = checkMap(data, behavior);
  if (problems.length) throw new Error(`a map file is not valid:\n - ${problems.join('\n - ')}`);
  const m = data as MapData;
  const when = <T extends { when?: WhenRef | undefined }>(o: T): Omit<T, 'when'> & { when?: Predicate } => {
    const { when: id, ...rest } = o;
    return id === undefined ? rest : { ...rest, when: behavior.when[id] as Predicate };
  };
  const { props, lights, npcs, warps, events, chests, patches, onEnter, ...rest } = m;
  const def: MapDef = { ...rest };
  if (props) def.props = props.map(when) as PropDef[];
  if (lights) def.lights = lights.map(when) as LightDef[];
  if (chests) def.chests = chests.map(when) as ChestDef[];
  if (patches) def.patches = patches.map((p) => ({ when: behavior.when[p.when] as Predicate, rects: p.rects }));
  if (npcs) {
    def.npcs = npcs.map((n) => {
      const { look, talk, when: w, ...r } = n;
      const out: NpcDef = { ...r, look: typeof look === 'string' ? LOOKS[look as keyof typeof LOOKS] : look };
      if (talk !== undefined) out.talk = typeof talk === 'string' ? (behavior.scripts[talk] as ScriptFn) : talk;
      if (w !== undefined) out.when = behavior.when[w] as Predicate;
      return out;
    });
  }
  if (warps) {
    def.warps = warps.map((x) => {
      const { when: w, blocked, ...r } = x;
      const out: WarpDef = { ...r };
      if (w !== undefined) out.when = behavior.when[w] as Predicate;
      if (blocked !== undefined) out.blocked = behavior.scripts[blocked] as ScriptFn;
      return out;
    });
  }
  if (events) {
    def.events = events.map((e) => {
      const { when: w, run, ...r } = e;
      const out: EventDef = { ...r, run: behavior.scripts[run] as ScriptFn };
      if (w !== undefined) out.when = behavior.when[w] as Predicate;
      return out;
    });
  }
  if (onEnter !== undefined) def.onEnter = behavior.scripts[onEnter] as ScriptFn;
  return def;
}
