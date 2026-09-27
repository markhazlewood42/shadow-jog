/** Map definition types (authoring format). */
import type { CharLook, Dir } from '../art/chars';
import type { ScriptFn } from '../game/script';

export type TerrainId =
  | 'void' | 'asphalt' | 'roadline' | 'crosswalk' | 'sidewalk' | 'alley' | 'puddle' | 'grate' | 'water' | 'bridge'
  | 'wall' | 'plaza' | 'dirt' | 'grass' | 'rubble' | 'rail'
  // interiors
  | 'floor_wood' | 'floor_tile' | 'floor_metal' | 'floor_carpet' | 'floor_concrete' | 'iwall'
  // dungeon
  | 'd_floor' | 'd_wall' | 'd_water' | 'd_shallow' | 'd_catwalk' | 'd_track' | 'lab_floor' | 'lab_wall'
  // world map
  | 'w_ruins' | 'w_road' | 'w_barrens' | 'w_toxic' | 'w_park' | 'w_highway' | 'w_bridge' | 'w_block';

export type BuildingStyle = 'brick' | 'concrete' | 'metal' | 'tile' | 'glass' | 'shanty' | 'corp';

export interface SignDef {
  text: string;
  color: string;
  /** Tile column offset within the building (default centered). */
  x?: number;
  vertical?: boolean;
  /** Row offset (for vertical signs) in tiles from the top of the facade. */
  flicker?: boolean;
}

export interface BuildingDef {
  kind: 'building';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Facade rows at the bottom of the footprint (default 2). */
  facade?: number;
  style: BuildingStyle;
  /** Door columns (absolute tile x). Doors are on the bottom row. */
  doors?: number[];
  /** Door that looks shuttered (not enterable, decorative). */
  shutters?: number[];
  sign?: SignDef;
  signs?: SignDef[];
  awning?: string;
  /** Glass shop windows instead of apartment windows on the ground floor. */
  shopfront?: boolean;
  seed?: number;
  roof?: 'flat' | 'garden' | 'billboard';
  billboard?: { text: string; color: string };
}

export type PropKind =
  | 'lamp' | 'vending' | 'barrel' | 'firebarrel' | 'crates' | 'dumpster' | 'trash' | 'car' | 'wreck' | 'hydrant'
  | 'bench' | 'stall' | 'pillar' | 'tree' | 'planter' | 'terminal' | 'pipe_v' | 'steam' | 'barrier' | 'cone'
  | 'holo' | 'poster' | 'counter' | 'shelf' | 'bed' | 'table' | 'stool' | 'couch' | 'plant' | 'screen'
  | 'capsule' | 'bar' | 'rack' | 'desk' | 'pod' | 'server' | 'tank' | 'fence' | 'sandbags' | 'tent' | 'pylon'
  | 'catwalk_rail' | 'train' | 'valve' | 'cryopod' | 'door_lab' | 'jukebox' | 'arcade' | 'sign_post' | 'bollard';

export interface PropDef {
  kind: PropKind;
  x: number;
  y: number;
  /** Variant / color. */
  color?: string;
  text?: string;
  w?: number;
  h?: number;
  dir?: Dir;
  /** Walkable despite being a prop. */
  pass?: boolean;
  id?: string;
}

export interface LightDef {
  x: number;
  y: number;
  r: number;
  color: string;
  i?: number;
  flicker?: boolean;
  /** Pixel coordinates instead of tiles. */
  px?: boolean;
}

export interface NpcDef {
  id: string;
  x: number;
  y: number;
  dir?: Dir;
  look: CharLook;
  name?: string;
  move?: 'static' | 'wander' | { path: [number, number][] };
  radius?: number;
  talk?: ScriptFn | string[];
  /** Only present when this returns true. */
  when?: (flags: Record<string, unknown>) => boolean;
  /** Doesn't turn to face the player (e.g. busy cook). */
  fixedDir?: boolean;
  /** Enemy-like sprite key instead of a character look. */
}

export interface WarpDef {
  x: number;
  y: number;
  w?: number;
  h?: number;
  to: string;
  tx: number;
  ty: number;
  dir?: Dir;
  /** Door sound + fade (default true). */
  door?: boolean;
  when?: (flags: Record<string, unknown>) => boolean;
  /** Script to run instead when `when` fails. */
  blocked?: ScriptFn;
}

export interface EventDef {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  on: 'touch' | 'action';
  run: ScriptFn;
  /** Run at most once (flag `ev:<map>:<id>`). */
  once?: boolean;
  when?: (flags: Record<string, unknown>) => boolean;
}

export interface ChestDef {
  id: string;
  x: number;
  y: number;
  item?: string;
  qty?: number;
  cred?: number;
  kind?: 'crate' | 'locker' | 'case';
}

export interface EncounterZone {
  table: string;
  /** Average steps between encounters. */
  rate: number;
  /** Restrict to terrain ids (world map); omit = everywhere walkable. */
  terrain?: TerrainId[];
  /** Restrict to a rectangle [x, y, w, h]. */
  rect?: [number, number, number, number];
}

export interface MapDef {
  id: string;
  name: string;
  kind: 'town' | 'interior' | 'dungeon' | 'world';
  terrain: string[];
  legend: Record<string, TerrainId>;
  structures?: BuildingDef[];
  props?: PropDef[];
  npcs?: NpcDef[];
  warps?: WarpDef[];
  events?: EventDef[];
  chests?: ChestDef[];
  lights?: LightDef[];
  /** Multiply color for the light map. */
  ambient: string;
  weather?: 'rain' | 'drip' | 'dust' | 'none';
  music: string;
  encounters?: EncounterZone[];
  onEnter?: ScriptFn;
  /** Overhead cables / lantern strings: [x0, y0, x1, y1] in tiles, sag px, color. */
  strings?: { a: [number, number]; b: [number, number]; sag?: number; lanterns?: string[]; }[];
  /** Map shown in area-title banner on entry. */
  banner?: string;
  bannerSub?: string;
  /** Interior tint of void area. */
  voidColor?: string;
  /** Town tier for shops / last-town bookkeeping. */
  town?: boolean;
}
