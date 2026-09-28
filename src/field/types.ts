/** Map definition types (authoring format). */
import type { Space } from '../audio/engine';
import type { CharLook, Dir } from '../art/chars';
import type { ScriptFn } from '../game/script';

export type TerrainId =
  | 'void' | 'asphalt' | 'roadline' | 'crosswalk' | 'sidewalk' | 'alley' | 'puddle' | 'grate' | 'water' | 'bridge'
  | 'wall' | 'plaza' | 'dirt' | 'grass' | 'rubble' | 'rail' | 'junk'
  // interiors
  | 'floor_wood' | 'floor_tile' | 'floor_metal' | 'floor_carpet' | 'floor_concrete' | 'iwall'
  // dungeon
  | 'd_floor' | 'd_wall' | 'd_water' | 'd_shallow' | 'd_catwalk' | 'd_track' | 'lab_floor' | 'lab_wall' | 'lab_door' | 'lab_laser' | 'lab_laser_off'
  | 'lab_floor_steel' | 'lab_floor_frost' | 'lab_floor_contain'
  // world map
  | 'w_ruins' | 'w_road' | 'w_barrens' | 'w_toxic' | 'w_park' | 'w_highway' | 'w_bridge' | 'w_block';

export type BuildingStyle = 'brick' | 'concrete' | 'metal' | 'tile' | 'glass' | 'shanty' | 'corp';

export interface SignDef {
  text: string;
  color: string;
  /** Tile column offset within the building (default centered). */
  x?: number | undefined;
  vertical?: boolean | undefined;
  /** Row offset (for vertical signs) in tiles from the top of the facade. */
  flicker?: boolean | undefined;
}

export interface BuildingDef {
  kind: 'building';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Facade rows at the bottom of the footprint (default 2). */
  facade?: number | undefined;
  style: BuildingStyle;
  /** Door columns (absolute tile x). Doors are on the bottom row. */
  doors?: number[] | undefined;
  /** Door that looks shuttered (not enterable, decorative). */
  shutters?: number[] | undefined;
  sign?: SignDef | undefined;
  signs?: SignDef[] | undefined;
  awning?: string | undefined;
  /** Glass shop windows instead of apartment windows on the ground floor. */
  shopfront?: boolean | undefined;
  seed?: number | undefined;
  roof?: 'flat' | 'garden' | 'billboard' | undefined;
  billboard?: { text: string; color: string } | undefined;
}

export type PropKind =
  | 'lamp' | 'vending' | 'barrel' | 'firebarrel' | 'crates' | 'dumpster' | 'trash' | 'car' | 'wreck' | 'hydrant'
  | 'bench' | 'stall' | 'pillar' | 'tree' | 'wildtree' | 'shrine' | 'pole' | 'planter' | 'terminal' | 'pipe_v' | 'steam' | 'barrier' | 'cone'
  | 'holo' | 'poster' | 'counter' | 'shelf' | 'bed' | 'table' | 'stool' | 'couch' | 'plant' | 'screen'
  | 'capsule' | 'bar' | 'rack' | 'desk' | 'pod' | 'server' | 'tank' | 'fence' | 'sandbags' | 'tent' | 'pylon'
  | 'catwalk_rail' | 'train' | 'valve' | 'cryopod' | 'door_lab' | 'jukebox' | 'arcade' | 'sign_post' | 'bollard'
  | 'window' | 'lampfloor' | 'sign_board' | 'tires' | 'body' | 'ladder' | 'tag' | 'banner' | 'crest' | 'memorial';

export interface PropDef {
  kind: PropKind;
  x: number;
  y: number;
  /** Variant / color. */
  color?: string | undefined;
  text?: string | undefined;
  w?: number | undefined;
  h?: number | undefined;
  dir?: Dir | undefined;
  /** Walkable despite being a prop. */
  pass?: boolean | undefined;
  id?: string | undefined;
  /** Only placed while this holds (evaluated when the map is built; part of the map cache key). */
  when?: ((flags: Record<string, unknown>) => boolean) | undefined;
}

export interface LightDef {
  x: number;
  y: number;
  r: number;
  color: string;
  i?: number | undefined;
  flicker?: boolean | undefined;
  /** Pixel coordinates instead of tiles. */
  px?: boolean | undefined;
  /** Only lit while this holds (evaluated when the map is built). */
  when?: ((flags: Record<string, unknown>) => boolean) | undefined;
}

export interface NpcDef {
  id: string;
  x: number;
  y: number;
  dir?: Dir | undefined;
  look: CharLook;
  name?: string | undefined;
  move?: 'static' | 'wander' | { path: [number, number][] } | undefined;
  radius?: number | undefined;
  talk?: ScriptFn | string[] | undefined;
  /** Only present when this returns true. */
  when?: ((flags: Record<string, unknown>) => boolean) | undefined;
  /** Doesn't turn to face the player (e.g. busy cook). */
  fixedDir?: boolean | undefined;
  /** Animal sprite instead of a character look. */
  critter?: 'cat' | 'crow' | undefined;
  /** Enemy-like sprite key instead of a character look. */
}

export interface WarpDef {
  x: number;
  y: number;
  w?: number | undefined;
  h?: number | undefined;
  to: string;
  tx: number;
  ty: number;
  dir?: Dir | undefined;
  /** Door sound + fade (default true). */
  door?: boolean | undefined;
  when?: ((flags: Record<string, unknown>) => boolean) | undefined;
  /** Script to run instead when `when` fails. */
  blocked?: ScriptFn | undefined;
  /** Ask before going (a point of no return); declining steps back off the tile. */
  confirm?: string | undefined;
}

export interface EventDef {
  id: string;
  x: number;
  y: number;
  w?: number | undefined;
  h?: number | undefined;
  on: 'touch' | 'action';
  run: ScriptFn;
  /** Run at most once (flag `ev:<map>:<id>`). */
  once?: boolean | undefined;
  when?: ((flags: Record<string, unknown>) => boolean) | undefined;
}

export interface ChestDef {
  id: string;
  x: number;
  y: number;
  item?: string | undefined;
  qty?: number | undefined;
  cred?: number | undefined;
  kind?: 'crate' | 'locker' | 'case' | undefined;
  /** Only present once this holds (a chest behind a secret that hasn't been found). */
  when?: ((flags: Record<string, unknown>) => boolean) | undefined;
}

export interface EncounterZone {
  table: string;
  /** Average steps between encounters. */
  rate: number;
  /** Restrict to terrain ids (world map); omit = everywhere walkable. */
  terrain?: TerrainId[] | undefined;
  /** Restrict to a rectangle [x, y, w, h]. */
  rect?: [number, number, number, number] | undefined;
  /** Battle background for this zone. */
  bg?: string | undefined;
}

export interface MapDef {
  id: string;
  name: string;
  kind: 'town' | 'interior' | 'dungeon' | 'world';
  terrain: string[];
  legend: Record<string, TerrainId>;
  structures?: BuildingDef[] | undefined;
  props?: PropDef[] | undefined;
  npcs?: NpcDef[] | undefined;
  warps?: WarpDef[] | undefined;
  events?: EventDef[] | undefined;
  chests?: ChestDef[] | undefined;
  lights?: LightDef[] | undefined;
  /** Multiply color for the light map. */
  ambient: string;
  weather?: 'rain' | 'drip' | 'dust' | 'none' | undefined;
  music: string;
  /** Acoustic space, when the place's song doesn't set one (a story cue used as a place's theme). */
  space?: Space | undefined;
  encounters?: EncounterZone[] | undefined;
  onEnter?: ScriptFn | undefined;
  /** Overhead cables / lantern strings: [x0, y0, x1, y1] in tiles, sag px, color. */
  strings?: { a: [number, number]; b: [number, number]; sag?: number | undefined; lanterns?: string[] | undefined }[] | undefined;
  /** Map shown in area-title banner on entry. */
  banner?: string | undefined;
  bannerSub?: string | undefined;
  /** Interior tint of void area. */
  voidColor?: string | undefined;
  /** Town tier for shops / last-town bookkeeping. */
  town?: boolean | undefined;
  /** Default battle background for fights on this map. */
  battleBg?: string | undefined;
  /** Terrain rewrites applied when a condition holds (e.g. a drained junction). */
  patches?: { when: (flags: Record<string, unknown>) => boolean; rects: [number, number, number, number, string][] }[] | undefined;
  /** Dungeon entrance point for Getaway Chits (tile in the parent map). */
  entrance?: { map: string; x: number; y: number } | undefined;
}
