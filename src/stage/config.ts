/**
 * The battle stage as DATA (Phaser spike `spike/phaser-stage`): the FINAL stage design from the side-view spike
 * (`docs/spikes/side-battle-stage.md`, section 4), as types, a checker and the small pure helpers every part of the
 * stage uses. Nothing here draws anything and nothing imports Phaser, so a unit test can check it and an edit mode
 * can change it and save it as `src/data/stages.json` (the same way the FX lab saves `fx.json`).
 *
 * One entry of the file is one **stage**: a backdrop with its horizon, a floor painted to agree with a side-on
 * camera, five depth rows, where the four heroes and each size of enemy group stand, the contact shadow, the
 * sort rule, and where every HUD region sits. Mark's four reference screenshots and the three design rounds
 * that produced it are in the design doc; this file only holds the result.
 *
 * A few ideas, in plain words:
 *
 *  - **Depth rows.** The floor is seen from above at an angle, so something standing further back is drawn
 *    higher on the screen. A row is one such line: its `y` is where a fighter's FEET land. Rows are listed back
 *    to front (smallest y first). A slot names a row, so moving a fighter to another row is one number, and the
 *    fighter's height on screen follows.
 *  - **Slots.** A slot is a place to stand: a row and an `x` (and, rarely, a small `dy` nudge). The party has
 *    four, on the left; enemies have a slot set for each group size ("1" to "6", and "boss", "boss+1",
 *    "boss+2"), on the right, because one big enemy stands in the middle while six stand in a crowd.
 *  - **Depth sorting.** Whoever's feet are lower on the screen is nearer and is drawn on top. Phaser draws objects
 *    in order of their `depth` number, so `depthFor` turns a foot position into that number. A fighter is made
 *    of several parts (body, shadow, ring, health bar...) and they all share the fighter's number plus a small
 *    fraction (`PART`), so the whole figure sorts as one unit: a nearer fighter covers all of a farther one,
 *    including its health bar.
 *  - **The HUD is data too.** Each region (the turn timeline, the party table, the command icons, the enemy
 *    box, the skill banner, the combo counter) has a box and a rule for when it shows. The widgets that draw
 *    them read the boxes from here.
 *
 * All the numbers are whole screen pixels on the game's 480x270 screen, so nothing lands between pixels.
 *
 * Besides the design the file carries a small `demo` block (who stands in the lab's party, which enemies fill
 * each group size, and the settings of the example fight). That is the lab's own, not part of the design: a
 * real battle is given its party and troop by the game.
 */

export const SCREEN_W = 480;
export const SCREEN_H = 270;

/** The party is always four; groups of enemies run from 1 to 6, with an optional boss. */
export const PARTY_SIZE = 4;
export const MAX_ENEMIES = 6;

/** The enemy slot sets every stage must have, in the order a picker lists them. */
export const SET_KEYS = ['1', '2', '3', '4', '5', '6', 'boss', 'boss+1', 'boss+2'] as const;
export type SetKey = (typeof SET_KEYS)[number];

/** How many enemies stand in a set. */
export function setSize(key: string): number {
  if (key === 'boss') return 1;
  if (key.startsWith('boss+')) return 1 + Number(key.slice(5));
  return Number(key);
}

/** The set key for a fight of `count` enemies, the first of which is a boss or not. */
export function setKeyFor(count: number, bossFirst: boolean): SetKey {
  if (bossFirst) return (count <= 1 ? 'boss' : `boss+${count - 1}`) as SetKey;
  return String(count) as SetKey;
}

export type Show = 'always' | 'input' | 'action' | 'never';

/** The picture behind everything: sky, skyline, buildings, or a replacement back wall. */
export interface StageBackdrop {
  /** Which of the game's procedural backdrops (`src/art/battlebg.ts`). */
  id: string;
  /**
   * "reproject": keep the backdrop's sky and buildings, move them by `shiftY`, and paint a new floor below the horizon.
   * "replace": the old art is a perspective box (a tunnel), so a separate side-on back wall is painted (`wallId`).
   */
  mode: 'reproject' | 'replace';
  /** Screen row where the floor's far edge meets the backdrop. Target 100 (the design allows 92 to 112). */
  horizonY: number;
  /** How far to move the old picture up (negative) so its own kerb row lands on `horizonY`: `horizonY` minus the picture's own kerb row. */
  shiftY: number;
  /** Dithered fade at the top of the screen, so tall buildings cut by the shift fade into the sky instead of a hard edge. */
  skyFade?: { height: number; color: string; amount: number } | null;
  /** Replacement back-wall id, used only when `mode` is "replace". */
  wallId?: string;
  /** Layers that slide at different speeds when the camera pans (not drawn yet; the shipped stages have none). */
  layers?: Array<{ id: string; y: number; speed: number }>;
  /** Optional framing drawn OVER the fighters at the screen edges (not drawn yet; the shipped stages have none). */
  foreground?: { id: string; y: number; alpha?: number } | null;
  /** Weather or ambient effect ("rain", "drips"), or null (named only; not drawn yet). */
  ambient?: string | null;
}

export interface FloorGrid {
  /** Distance between joints at the bottom of the screen. */
  spacing: number;
  /** Row where the joint lines would meet. Must be -200 or less, so they look nearly upright. */
  vanishY: number;
  color: string;
  /** Joint strength at the horizon (0 to 1). */
  alpha: number;
  /** Joint strength at the camera, so joints get clearer up close. */
  nearAlpha?: number;
  /** Offset every other band's joints by half a slab, like laid paving. */
  stagger?: boolean;
}

export interface FloorStripe {
  y: number;
  h: number;
  color: string;
  alpha: number;
  /** [on, off] dash lengths in pixels, or null for solid. */
  dash?: [number, number] | null;
}

/** The ground the fighters stand on, painted fresh so it agrees with a side-on camera. */
export interface StageFloor {
  /** Top of the floor (equal to `backdrop.horizonY`). A 2 px kerb is painted here: the edge colour, then a dark shadow row. */
  y0: number;
  /** Bottom of the floor (270; the HUD covers its lowest part). */
  y1: number;
  /** "bands": stripes that grow toward the camera; "grid": bands plus near-upright joints; "texture": bands with a shrinking texture. */
  style: 'bands' | 'grid' | 'texture';
  /** Two colours the bands alternate between. */
  colors: [string, string];
  /** Kerb colour along the far edge, or null. */
  edge?: string | null;
  /** Height in pixels of the first (furthest) band. */
  bandStart: number;
  /** Each band is this many times taller than the one above it (1.15 to 1.3 reads as seen from above). */
  bandGrowth: number;
  /** A lit dithered line on top of each band; its strength goes from `far` at the horizon to `near` at the camera (0 to 1). */
  seam?: { color: string; far: number; near: number };
  /** For style "grid": the slab joints. */
  grid?: FloorGrid;
  /** Speckle texture and how much finer it gets toward the horizon (0 to 1). */
  texture?: { id: string; shrink: number };
  /** A faint lit line halfway between neighbouring depth rows, so each row reads as its own lane. */
  laneSeams?: { color: string; alpha: number } | null;
  /** Painted lines that run LEFT TO RIGHT. Keep them behind the back row or under the HUD, never between rows. */
  stripes?: FloorStripe[];
  /** Puddle reflections. They are placed away from every slot so nobody stands in one. */
  reflections?: { colors: string[]; count: number } | null;
  /** Bright backdrop pixels mirrored into the floor just below the kerb; `streaks` adds vertical neon streaks (0 = none). */
  neonSpill?: { reach: number; strength: number; streaks?: number } | null;
  /** The far floor dithers toward this colour over `reach` pixels. */
  haze?: { color: string; amount: number; reach: number } | null;
  /** Colour wash over the whole floor, or null. */
  tint?: { color: string; amount: number } | null;
  /** Random seed for flecks and puddles, so a stage always looks the same. */
  seed?: number;
}

/** One depth row: where feet land. */
export interface DepthRow {
  y: number;
}

/** A place to stand: a row (an index into `rows`, 0 = back), the x of the feet's middle, and an optional small nudge from the row line. */
export interface PartySlot {
  x: number;
  row: number;
  dy?: number;
}

export interface EnemySlot extends PartySlot {
  /** "boss" slots get the boss shadow and a wider health bar. Default "regular". */
  size?: 'regular' | 'boss';
}

/** The slot type the helpers take (a party slot or an enemy slot). */
export type Slot = PartySlot | EnemySlot;

/** The dark oval under every fighter that plants them on the floor. */
export interface ShadowStyle {
  kind: 'oval' | 'none';
  /** Width as a share of the sprite's width, clamped to `minW`..`maxW`. Bosses use `bossWidthScale` up to `bossMaxW`. */
  widthScale: number;
  minW: number;
  maxW: number;
  bossWidthScale: number;
  bossMaxW: number;
  /** Height = width / aspect. */
  aspect: number;
  color: string;
  alpha: number;
  /** Strength of the 1 px dithered rim. */
  edgeAlpha: number;
  /** Ring around the acting fighter's shadow (the target gets the same ring in amber). */
  activeRing?: { color: string; extraW: number } | null;
}

/** Haze: rows further back are blended a little toward a fog colour. */
export interface DepthTint {
  fog: string;
  /** Blend per row, back row first, 0 to 0.15 each. */
  amounts: number[];
  /** Keep the acting fighter and its target untinted. */
  exemptActive: boolean;
}

/** How fighters are layered when they overlap. */
export interface SortRule {
  /** Draw in order of feet row: higher on screen first, so lower figures cover them. */
  by: 'feetY';
  /** On a tie, draw the one further from the screen centre first, then party before enemies. */
  tie: 'outerFirst';
  /** A lunging attacker borrows its target's feet row plus this many pixels while in contact. */
  lungeOverTarget: number;
}

export interface HudRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "always", "input" (while choosing), "action" (while an action plays), or "never". */
  show: Show;
  /** 0 = fully see-through, 1 = solid. */
  opacity?: number;
}

export interface HudLayout {
  /** The starting layout the regions override: "timeline-bottom3" is this design. */
  preset: 'timeline-bottom3' | 'ff-strip' | 'action-left' | 'ps4-panels';
  /** Turn order: chips on a line, party above, enemies below, NOW chip at the left. */
  turnOrder: HudRegion & { style: 'timeline' | 'column'; chip: number; nowChip: number };
  /** The action menu: a row of icons with a label line, or text rows. */
  commands: HudRegion & { style: 'icons' | 'list'; icon?: number; rowH?: number };
  /** One compact row per hero: face, name, HP bar, HP numbers, resource label and value. */
  partyStatus: HudRegion & { style: 'rows' | 'panels'; rowH: number; face: number };
  /** The enemy box (foe list while choosing, target details while targeting or acting), plus health bars under each enemy. */
  enemyInfo: HudRegion & { barsOnStage: { w: number; h: number; gapBelowShadow: number } | null; names?: 'target' | 'always' | 'never' };
  /** Skill name or input prompt. */
  banner: HudRegion;
  /** Hit counter and total damage. */
  combo: HudRegion;
  /** A name tab above the acting hero's head. */
  activeTag?: { show: 'always' | 'never'; gapAboveHead: number };
  /** Limits the editor warns about. */
  limits: { maxScreenShare: number; maxBottomBand: number; minClearAboveBottom: number };
}

/** Who one lab party member is, for real numbers: a level and gear, read through the game's own stat code. */
export interface DemoMember {
  id: string;
  level: number;
  equip?: Record<string, string>;
  /** Story flags that have passed (they unlock abilities and mend Rook), as the game's own tests set them. */
  flags?: string[];
}

/** What the example fight does in the lab's "acting" state: who hits whom with what, and how it is drawn. */
export interface DemoAct {
  attacker: string;
  /** Ability id (`src/data/abilities.ts`). */
  skill: string;
  /** Index of the enemy hit, in the roster of the shown set. */
  target: number;
  /** Which picture the hit makes. */
  fx: 'cut' | 'palm';
  /** How far past the target's edge the attacker's weapon or fist reaches into it (a sword reaches further than a fist). */
  reach: number;
}

/** The lab's own settings for a stage (not part of the design). */
export interface StageDemo {
  /** Crew ids in party order: slot 0 (the lead, front-most hero) first. */
  lineup: string[];
  /** The loadouts the lab's party is built from (same order as `lineup`). */
  party: DemoMember[];
  /** Enemy keys (`ENEMIES`) for each group size; a boss set lists the boss first. */
  rosters: Record<string, string[]>;
  /** Seed of the example round (it decides the turn order the timeline shows). */
  seed: number;
  act: DemoAct;
}

/** Everything about how one battle stage LOOKS and where everyone STANDS, as plain data. */
export interface StageConfig {
  /** Format version, so old files can be upgraded later. Always 1 for now. */
  version: 1;
  /** Short id: the key it has in the stage file. */
  id: string;
  /** Human-readable name for the editor's list. */
  name: string;
  backdrop: StageBackdrop;
  floor: StageFloor;
  /** Depth rows, from the BACK (highest on screen) to the FRONT (lowest). Slots refer to rows by index (0 = back row). */
  rows: DepthRow[];
  /** Where the heroes stand. Index 0 = the party's lead, the front-most hero. Heroes face right. */
  party: PartySlot[];
  /** Where enemies stand, one layout per group size. Enemies face left. */
  enemySets: Record<string, EnemySlot[]>;
  shadow: ShadowStyle;
  depthTint?: DepthTint;
  sort: SortRule;
  hud: HudLayout;
  demo: StageDemo;
}

export type StageFile = Record<string, StageConfig>;

// ------------------------------------------------------------------ checking a file

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

/** What else the checker can be told exists, so a typo is caught before it silently shows nothing. */
export interface Known {
  /** Enemy keys (`ENEMIES`) and which of them are bosses. */
  enemies?: readonly string[];
  bosses?: readonly string[];
  /** Crew ids that have a sheet. */
  crew?: readonly string[];
}

/** Collects problems in plain words, each prefixed with where it is. */
class Problems {
  readonly list: string[] = [];
  constructor(private readonly prefix: string) {}
  add(path: string, msg: string): void {
    this.list.push(`${this.prefix}${path ? ` ${path}` : ''}: ${msg}`);
  }
  int(path: string, v: unknown, lo: number, hi: number): v is number {
    if (isInt(v) && v >= lo && v <= hi) return true;
    this.add(path, `must be a whole number from ${lo} to ${hi}`);
    return false;
  }
  num(path: string, v: unknown, lo: number, hi: number): v is number {
    if (isNum(v) && v >= lo && v <= hi) return true;
    this.add(path, `must be a number from ${lo} to ${hi}`);
    return false;
  }
  hex(path: string, v: unknown): v is string {
    if (isHex(v)) return true;
    this.add(path, 'must look like #rrggbb');
    return false;
  }
  oneOf<T extends string>(path: string, v: unknown, options: readonly T[]): v is T {
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return true;
    this.add(path, `must be one of ${options.join(', ')}`);
    return false;
  }
  obj(path: string, v: unknown): v is Record<string, unknown> {
    if (isObj(v)) return true;
    this.add(path, 'is missing or not an object');
    return false;
  }
}

function checkFloor(p: Problems, raw: Record<string, unknown>, horizon: number | null): void {
  const f = raw.floor;
  if (!p.obj('floor', f)) return;
  if (p.int('floor.y1', f.y1, 1, SCREEN_H) && isInt(f.y0) && f.y1 <= f.y0) p.add('floor', 'y1 must be below y0');
  if (p.int('floor.y0', f.y0, 0, SCREEN_H) && horizon !== null && f.y0 !== horizon) p.add('floor.y0', `must equal the backdrop's horizonY (${horizon})`);
  p.oneOf('floor.style', f.style, ['bands', 'grid', 'texture']);
  if (!Array.isArray(f.colors) || f.colors.length !== 2 || !f.colors.every(isHex)) p.add('floor.colors', 'needs two #rrggbb colours');
  if (f.edge !== undefined && f.edge !== null) p.hex('floor.edge', f.edge);
  p.num('floor.bandStart', f.bandStart, 1, 20);
  p.num('floor.bandGrowth', f.bandGrowth, 1, 2);
  if (f.seam !== undefined) {
    if (p.obj('floor.seam', f.seam)) {
      p.hex('floor.seam.color', f.seam.color);
      p.num('floor.seam.far', f.seam.far, 0, 1);
      p.num('floor.seam.near', f.seam.near, 0, 1);
    }
  }
  if (f.style === 'grid' && !isObj(f.grid)) p.add('floor.grid', 'a "grid" floor needs a grid block');
  if (f.grid !== undefined && p.obj('floor.grid', f.grid)) {
    p.int('floor.grid.spacing', f.grid.spacing, 8, 240);
    if (!isNum(f.grid.vanishY) || f.grid.vanishY > -200) p.add('floor.grid.vanishY', 'must be -200 or less, so the joints look nearly upright');
    p.hex('floor.grid.color', f.grid.color);
    p.num('floor.grid.alpha', f.grid.alpha, 0, 1);
    if (f.grid.nearAlpha !== undefined) p.num('floor.grid.nearAlpha', f.grid.nearAlpha, 0, 1);
  }
  if (isObj(f.texture)) p.num('floor.texture.shrink', f.texture.shrink, 0, 1);
  if (isObj(f.laneSeams)) {
    p.hex('floor.laneSeams.color', f.laneSeams.color);
    p.num('floor.laneSeams.alpha', f.laneSeams.alpha, 0, 1);
  }
  if (f.stripes !== undefined) {
    if (!Array.isArray(f.stripes)) p.add('floor.stripes', 'must be a list');
    else
      f.stripes.forEach((s: unknown, i) => {
        if (!p.obj(`floor.stripes[${i}]`, s)) return;
        p.int(`floor.stripes[${i}].y`, s.y, 0, SCREEN_H);
        p.int(`floor.stripes[${i}].h`, s.h, 1, 20);
        p.hex(`floor.stripes[${i}].color`, s.color);
        p.num(`floor.stripes[${i}].alpha`, s.alpha, 0, 1);
        if (s.dash !== undefined && s.dash !== null && !(Array.isArray(s.dash) && s.dash.length === 2 && s.dash.every((n) => isInt(n) && n >= 0))) p.add(`floor.stripes[${i}].dash`, 'must be [on, off] whole numbers');
      });
  }
  if (isObj(f.reflections)) {
    if (!Array.isArray(f.reflections.colors) || !f.reflections.colors.length || !f.reflections.colors.every(isHex)) p.add('floor.reflections.colors', 'needs at least one #rrggbb colour');
    p.int('floor.reflections.count', f.reflections.count, 0, 20);
  }
  if (isObj(f.neonSpill)) {
    p.int('floor.neonSpill.reach', f.neonSpill.reach, 0, 80);
    p.num('floor.neonSpill.strength', f.neonSpill.strength, 0, 1);
  }
  if (isObj(f.haze)) {
    p.hex('floor.haze.color', f.haze.color);
    p.num('floor.haze.amount', f.haze.amount, 0, 1);
    p.int('floor.haze.reach', f.haze.reach, 1, 120);
  }
  if (f.seed !== undefined) p.int('floor.seed', f.seed, 0, 2 ** 31);
}

function checkSlots(p: Problems, path: string, slots: unknown, count: number, rowCount: number, side: 'party' | 'enemy'): void {
  if (!Array.isArray(slots) || slots.length !== count) {
    p.add(path, `needs exactly ${count} slots`);
    return;
  }
  const seen = new Set<string>();
  slots.forEach((s: unknown, i) => {
    if (!isObj(s) || !isInt(s.row) || !isInt(s.x)) {
      p.add(`${path}[${i}]`, 'needs a whole-number row and x');
      return;
    }
    if (s.row < 0 || s.row >= rowCount) p.add(`${path}[${i}]`, `row ${s.row} is not one of the ${rowCount} rows`);
    if (s.dy !== undefined && !isInt(s.dy)) p.add(`${path}[${i}]`, 'dy must be a whole number');
    // The party stands on the left half of the screen and the enemies on the right.
    if (side === 'party' ? s.x < 0 || s.x >= SCREEN_W / 2 : s.x < SCREEN_W / 2 || s.x > SCREEN_W) p.add(`${path}[${i}]`, `x ${s.x} is on the wrong side of the screen`);
    if (s.size !== undefined && s.size !== 'regular' && s.size !== 'boss') p.add(`${path}[${i}]`, 'size must be "regular" or "boss"');
    const k = `${s.row}:${s.x}:${s.dy ?? 0}`;
    if (seen.has(k)) p.add(`${path}[${i}]`, 'two fighters on the same spot');
    seen.add(k);
  });
}

function checkRegion(p: Problems, path: string, r: unknown): void {
  if (!p.obj(path, r)) return;
  p.int(`${path}.x`, r.x, 0, SCREEN_W);
  p.int(`${path}.y`, r.y, 0, SCREEN_H);
  p.int(`${path}.w`, r.w, 1, SCREEN_W);
  p.int(`${path}.h`, r.h, 1, SCREEN_H);
  p.oneOf(`${path}.show`, r.show, ['always', 'input', 'action', 'never']);
  if (r.opacity !== undefined) p.num(`${path}.opacity`, r.opacity, 0, 1);
  if (isInt(r.x) && isInt(r.w) && r.x + r.w > SCREEN_W) p.add(path, 'reaches past the right edge of the screen');
  if (isInt(r.y) && isInt(r.h) && r.y + r.h > SCREEN_H) p.add(path, 'reaches past the bottom edge of the screen');
}

function checkHud(p: Problems, h: unknown): void {
  if (!p.obj('hud', h)) return;
  p.oneOf('hud.preset', h.preset, ['timeline-bottom3', 'ff-strip', 'action-left', 'ps4-panels']);
  for (const k of ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo']) checkRegion(p, `hud.${k}`, h[k]);
  if (isObj(h.turnOrder)) {
    p.int('hud.turnOrder.chip', h.turnOrder.chip, 6, 40);
    p.int('hud.turnOrder.nowChip', h.turnOrder.nowChip, 6, 40);
  }
  if (isObj(h.commands) && h.commands.icon !== undefined) p.int('hud.commands.icon', h.commands.icon, 8, 40);
  if (isObj(h.partyStatus)) {
    p.int('hud.partyStatus.rowH', h.partyStatus.rowH, 6, 30);
    p.int('hud.partyStatus.face', h.partyStatus.face, 4, 30);
  }
  if (isObj(h.enemyInfo) && isObj(h.enemyInfo.barsOnStage)) {
    p.int('hud.enemyInfo.barsOnStage.w', h.enemyInfo.barsOnStage.w, 4, 100);
    p.int('hud.enemyInfo.barsOnStage.h', h.enemyInfo.barsOnStage.h, 1, 10);
    p.int('hud.enemyInfo.barsOnStage.gapBelowShadow', h.enemyInfo.barsOnStage.gapBelowShadow, 0, 20);
  }
  if (!isObj(h.limits)) p.add('hud.limits', 'is missing');
}

function checkDemo(p: Problems, d: unknown, known: Known): void {
  if (!p.obj('demo', d)) return;
  const names = (path: string, v: unknown, min: number, max: number, list: readonly string[] | undefined, unique: boolean): void => {
    if (!Array.isArray(v) || v.length < min || v.length > max) {
      p.add(path, `needs ${min === max ? `exactly ${min}` : `${min} to ${max}`} names`);
      return;
    }
    const seen = new Set<string>();
    v.forEach((n: unknown, i) => {
      if (typeof n !== 'string' || !n) p.add(`${path}[${i}]`, 'needs a name');
      else {
        if (list && !list.includes(n)) p.add(`${path}[${i}]`, `"${n}" is not one that exists`);
        if (unique && seen.has(n)) p.add(`${path}[${i}]`, `"${n}" appears twice`);
        seen.add(n);
      }
    });
  };
  names('demo.lineup', d.lineup, PARTY_SIZE, PARTY_SIZE, known.crew, true);
  if (!Array.isArray(d.party) || d.party.length !== PARTY_SIZE) p.add('demo.party', `needs exactly ${PARTY_SIZE} members`);
  else
    d.party.forEach((m: unknown, i) => {
      if (!isObj(m) || typeof m.id !== 'string' || !isInt(m.level)) p.add(`demo.party[${i}]`, 'needs an id and a whole-number level');
      else if (Array.isArray(d.lineup) && d.lineup[i] !== m.id) p.add(`demo.party[${i}]`, `must be the same crew member as demo.lineup[${i}] ("${String(d.lineup[i])}")`);
    });
  if (!p.obj('demo.rosters', d.rosters)) return;
  for (const key of SET_KEYS) {
    const r = d.rosters[key];
    names(`demo.rosters["${key}"]`, r, setSize(key), setSize(key), known.enemies, false);
    if (key.startsWith('boss') && Array.isArray(r) && known.bosses && !known.bosses.includes(String(r[0]))) p.add(`demo.rosters["${key}"]`, 'a boss set must list the boss first');
  }
  p.int('demo.seed', d.seed, 0, 2 ** 31);
  if (p.obj('demo.act', d.act)) {
    if (typeof d.act.attacker !== 'string' || !d.act.attacker) p.add('demo.act.attacker', 'needs a crew id');
    else if (Array.isArray(d.lineup) && !d.lineup.includes(d.act.attacker)) p.add('demo.act.attacker', 'is not in the lineup');
    if (typeof d.act.skill !== 'string' || !d.act.skill) p.add('demo.act.skill', 'needs an ability id');
    p.int('demo.act.target', d.act.target, 0, MAX_ENEMIES - 1);
    p.oneOf('demo.act.fx', d.act.fx, ['cut', 'palm']);
    p.int('demo.act.reach', d.act.reach, 0, 40);
  }
}

/**
 * Everything wrong with a stage file, in plain words (empty when it is fine). `knownBackdrops`, when given, is
 * the list of backdrop ids the art can paint, so a typo is caught before it silently shows the default; `known`
 * does the same for enemy keys and crew ids. This checks that the file is well-formed and can be drawn; whether
 * the LAYOUT follows the design's rules (horizon 92 to 112, row gaps, HUD share...) is `checkLayout`.
 */
export function checkStages(data: unknown, knownBackdrops?: readonly string[], known: Known = {}): string[] {
  if (!isObj(data) || !Object.keys(data).length) return ['stages: needs at least one stage'];
  const out: string[] = [];
  for (const [id, raw] of Object.entries(data)) {
    const p = new Problems(`stage "${id}"`);
    if (!isObj(raw)) {
      out.push(`stage "${id}": not an object`);
      continue;
    }
    if (raw.version !== 1) p.add('', 'version must be 1');
    if (raw.id !== id) p.add('', `its id ("${String(raw.id)}") must match its key in the file`);
    if (typeof raw.name !== 'string' || !raw.name) p.add('', 'needs a name');
    let horizon: number | null = null;
    if (p.obj('backdrop', raw.backdrop)) {
      const b = raw.backdrop;
      if (typeof b.id !== 'string' || !b.id) p.add('backdrop.id', 'needs a backdrop id');
      else if (knownBackdrops && !knownBackdrops.includes(b.id)) p.add('backdrop.id', `"${b.id}" is not one the art can paint`);
      if (p.oneOf('backdrop.mode', b.mode, ['reproject', 'replace']) && b.mode === 'replace' && typeof b.wallId !== 'string') p.add('backdrop.wallId', 'a "replace" backdrop needs a wallId');
      if (p.int('backdrop.horizonY', b.horizonY, 0, SCREEN_H)) horizon = b.horizonY;
      p.int('backdrop.shiftY', b.shiftY, -SCREEN_H, SCREEN_H);
      if (isObj(b.skyFade)) {
        p.int('backdrop.skyFade.height', b.skyFade.height, 1, 60);
        p.hex('backdrop.skyFade.color', b.skyFade.color);
        p.num('backdrop.skyFade.amount', b.skyFade.amount, 0, 1);
      }
    }
    checkFloor(p, raw, horizon);
    // Rows: back to front, every one inside the floor.
    let rowCount = 0;
    const floor = isObj(raw.floor) ? raw.floor : {};
    if (!Array.isArray(raw.rows) || raw.rows.length < 2 || raw.rows.length > 6) p.add('rows', 'needs 2 to 6 depth rows');
    else {
      rowCount = raw.rows.length;
      let prev = -1;
      raw.rows.forEach((r: unknown, i) => {
        if (!isObj(r) || !isInt(r.y)) {
          p.add(`rows[${i}]`, 'needs a whole-number y');
          return;
        }
        if (r.y <= prev) p.add(`rows[${i}]`, `rows go back to front, so y must grow (${r.y} after ${prev})`);
        prev = r.y;
        if (isInt(floor.y0) && isInt(floor.y1) && (r.y < floor.y0 || r.y > floor.y1)) p.add(`rows[${i}]`, `y ${r.y} is outside the floor`);
      });
    }
    checkSlots(p, 'party', raw.party, PARTY_SIZE, rowCount, 'party');
    if (p.obj('enemySets', raw.enemySets)) for (const key of SET_KEYS) checkSlots(p, `enemySets["${key}"]`, raw.enemySets[key], setSize(key), rowCount, 'enemy');
    if (p.obj('shadow', raw.shadow)) {
      const s = raw.shadow;
      p.oneOf('shadow.kind', s.kind, ['oval', 'none']);
      p.num('shadow.widthScale', s.widthScale, 0.1, 2);
      p.int('shadow.minW', s.minW, 2, 100);
      p.int('shadow.maxW', s.maxW, 2, 100);
      p.num('shadow.bossWidthScale', s.bossWidthScale, 0.1, 2);
      p.int('shadow.bossMaxW', s.bossMaxW, 2, 200);
      p.num('shadow.aspect', s.aspect, 1, 10);
      p.hex('shadow.color', s.color);
      p.num('shadow.alpha', s.alpha, 0, 1);
      p.num('shadow.edgeAlpha', s.edgeAlpha, 0, 1);
      if (isObj(s.activeRing)) {
        p.hex('shadow.activeRing.color', s.activeRing.color);
        p.int('shadow.activeRing.extraW', s.activeRing.extraW, 0, 40);
      }
    }
    if (raw.depthTint !== undefined && p.obj('depthTint', raw.depthTint)) {
      const d = raw.depthTint;
      p.hex('depthTint.fog', d.fog);
      if (!Array.isArray(d.amounts) || d.amounts.length !== rowCount || !d.amounts.every((n) => isNum(n) && n >= 0 && n <= 0.15)) p.add('depthTint.amounts', `needs one number from 0 to 0.15 for each of the ${rowCount} rows`);
      if (typeof d.exemptActive !== 'boolean') p.add('depthTint.exemptActive', 'must be true or false');
    }
    if (p.obj('sort', raw.sort)) {
      p.oneOf('sort.by', raw.sort.by, ['feetY']);
      p.oneOf('sort.tie', raw.sort.tie, ['outerFirst']);
      p.int('sort.lungeOverTarget', raw.sort.lungeOverTarget, 0, 10);
    }
    checkHud(p, raw.hud);
    checkDemo(p, raw.demo, known);
    out.push(...p.list);
  }
  return out;
}

/** The stage file, checked. Throws a readable error listing every problem (a bad stage must not half-load). */
export function loadStages(data: unknown, knownBackdrops?: readonly string[], known: Known = {}): StageFile {
  const problems = checkStages(data, knownBackdrops, known);
  if (problems.length) throw new Error(`stages.json is not valid:\n - ${problems.join('\n - ')}`);
  return data as StageFile;
}

/** One stage by id, or a readable error naming the ones there are. */
export function stageOf(file: StageFile, id: string): StageConfig {
  const s = file[id];
  if (!s) throw new Error(`No stage "${id}" (there is: ${Object.keys(file).join(', ')})`);
  return s;
}

// ------------------------------------------------------------------ the design's rules (what an editor warns about)

/** Where the old street picture's kerb row sits: `shiftY` is `horizonY` minus this. */
export const ART_KERB_ROW = 132;

/**
 * The design's acceptance rules for a stage's LAYOUT, in plain words (empty when it passes): the horizon sits at
 * 92 to 112, depth rows are 14 to 24 px apart, the HUD's always-on share of the screen is under the limit, the
 * bottom band leaves room above it, and enough floor shows between the HUD bands. These are the checks the
 * design's mockup script printed; an editor shows them as warnings and a unit test runs them over every stage.
 * (The rules that need the sprites' sizes, such as the lane between the sides, are `checkFigures`.)
 */
export function checkLayout(s: StageConfig): string[] {
  const out: string[] = [];
  const hz = s.backdrop.horizonY;
  if (hz < 92 || hz > 112) out.push(`horizon ${hz} is outside 92 to 112`);
  if (s.backdrop.mode === 'reproject' && s.backdrop.shiftY !== hz - ART_KERB_ROW) out.push(`shiftY ${s.backdrop.shiftY} should be ${hz - ART_KERB_ROW} so the old picture's kerb lands on the horizon`);
  const ys = s.rows.map((r) => r.y);
  const gaps = ys.slice(1).map((y, i) => y - (ys[i] ?? 0));
  if (gaps.some((g) => g < 14 || g > 24)) out.push(`row gaps ${gaps.join(', ')} are not all 14 to 24`);
  const h = s.hud;
  const area = h.turnOrder.w * h.turnOrder.h + h.partyStatus.w * h.partyStatus.h;
  const share = area / (SCREEN_W * SCREEN_H);
  if (share > h.limits.maxScreenShare) out.push(`always-on HUD takes ${(share * 100).toFixed(1)}% of the screen (limit ${h.limits.maxScreenShare * 100}%)`);
  const band = h.partyStatus.y;
  if (SCREEN_H - band > h.limits.maxBottomBand) out.push(`bottom band is ${SCREEN_H - band} px tall (limit ${h.limits.maxBottomBand})`);
  const last = Math.max(...ys);
  // The deepest shadow sits just under the front row's feet (its height is half the oval plus a row of rim).
  const lowest = last + Math.ceil(s.shadow.maxW / s.shadow.aspect / 2) + 2;
  if (band - lowest < h.limits.minClearAboveBottom) out.push(`front shadow ends ${band - lowest} px above the bottom band (need ${h.limits.minClearAboveBottom})`);
  if ((band - s.floor.y0) / SCREEN_H < 0.45) out.push(`only ${(((band - s.floor.y0) / SCREEN_H) * 100).toFixed(1)}% of the screen shows floor between the HUD bands (need 45%)`);
  return out;
}

/** A figure's size on screen, for the rules that need it: its feet and the edges of its drawn pixels. */
export interface FigureBox {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  boss: boolean;
  side: 'party' | 'enemy';
}

/**
 * The design's rules that need the sprites' real sizes (the browser reports the boxes): a lane of at least 55 px
 * between the sides, the nearest enemy no further left than 260, no enemy past 476, and nothing reaching into the
 * top HUD band. Plain words again; empty means it passes.
 */
export function checkFigures(s: StageConfig, figures: readonly FigureBox[]): string[] {
  const out: string[] = [];
  const heroes = figures.filter((f) => f.side === 'party');
  const foes = figures.filter((f) => f.side === 'enemy');
  if (heroes.length && foes.length) {
    const lane = Math.min(...foes.map((f) => f.left)) - Math.max(...heroes.map((f) => f.right));
    if (lane < 55) out.push(`the lane between the sides is ${lane} px (need 55)`);
    const nearest = Math.min(...foes.map((f) => f.left));
    if (nearest < 260) out.push(`the nearest enemy's left edge is ${nearest} (need 260 or more)`);
    const far = Math.max(...foes.map((f) => f.right));
    if (far > SCREEN_W - 4) out.push(`an enemy reaches x ${far} (keep it at ${SCREEN_W - 4} or less)`);
  }
  const topBand = s.hud.turnOrder.y + s.hud.turnOrder.h;
  const high = figures.filter((f) => f.top < topBand);
  if (high.length) out.push(`${high.length} figure(s) reach into the top HUD band (y ${topBand})`);
  return out;
}

// ------------------------------------------------------------------ slots and depth

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The enemy slots for a set key ("3", "boss+1"...), or a readable error. */
export function enemySlots(stage: StageConfig, key: string): EnemySlot[] {
  const set = stage.enemySets[key];
  if (!set) throw new Error(`Stage "${stage.name}" has no enemy slots for "${key}" (it has: ${Object.keys(stage.enemySets).join(', ')})`);
  return set;
}

/**
 * A slot's feet position on the screen: the row's y plus the slot's nudge, always inside the floor and the
 * screen, even if the stage was edited so a row now sits outside it. That is how the floor's `y0` and `y1` do
 * their job (nobody can stand on the wall or below the screen), and what an editor's drag relies on.
 */
export function slotPoint(stage: StageConfig, slot: Slot): { x: number; y: number } {
  const row = stage.rows[slot.row];
  if (!row) throw new Error(`Slot names row ${slot.row}, which stage "${stage.name}" does not have`);
  return { x: clamp(slot.x, 0, SCREEN_W), y: clamp(row.y + (slot.dy ?? 0), stage.floor.y0, stage.floor.y1) };
}

/**
 * The slot a dragged fighter lands on: the nearest depth row to where the pointer is (the row snaps, the way
 * RPG Maker snaps a troop member to its grid) and the x kept on the fighter's own half of the screen. Pure,
 * so a test can drag without a browser.
 */
export function snapSlot(stage: StageConfig, side: 'party' | 'enemy', x: number, y: number): { row: number; x: number } {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  stage.rows.forEach((r, i) => {
    const d = Math.abs(clamp(r.y, stage.floor.y0, stage.floor.y1) - y);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  const half = SCREEN_W / 2;
  return { row: best, x: Math.round(side === 'party' ? clamp(x, 0, half - 1) : clamp(x, half, SCREEN_W)) };
}

/** A fighter's contact-shadow width: its sprite's width times the stage's share, kept between the stage's limits (a boss has its own). */
export function shadowWidth(stage: StageConfig, spriteW: number, boss: boolean): number {
  const s = stage.shadow;
  if (s.kind === 'none') return 0;
  if (boss) return Math.round(Math.min(s.bossMaxW, spriteW * s.bossWidthScale));
  return Math.round(Math.max(s.minW, Math.min(s.maxW, spriteW * s.widthScale)));
}

/** The shadow oval's height for a width. */
export function shadowHeight(stage: StageConfig, width: number): number {
  return Math.max(4, Math.round(width / stage.shadow.aspect));
}

/**
 * The draw-order number for a fighter whose feet are at (x, y): nearer (lower on screen) draws on top. On one
 * row the design says the one further from the screen centre draws first (so the two nearest the middle, which
 * overlap most, end up on top) and a hero before an enemy. Multiplied up so the tie-break never outweighs a
 * row. Every part of a fighter (shadow, ring, body, health bar...) adds its own small `PART` offset to this.
 */
export function depthFor(y: number, x: number, side: 'party' | 'enemy' = 'party'): number {
  const closeness = 240 - Math.min(240, Math.abs(x - SCREEN_W / 2));
  return y * 1000 + closeness * 2 + (side === 'enemy' ? 1 : 0);
}

/**
 * The feet row a fighter sorts by: its own, or while lunging in contact the target's row plus
 * `sort.lungeOverTarget`, so the attacker's body draws over the one it is hitting.
 */
export function sortRow(stage: StageConfig, feetY: number, lungeTargetY?: number): number {
  return lungeTargetY === undefined ? feetY : lungeTargetY + stage.sort.lungeOverTarget;
}

/** The parts of one figure and how far each sits from the figure's own depth number (a figure's whole group stays between its neighbours' numbers). */
export const PART = {
  shadow: -0.5,
  ring: -0.4,
  body: 0,
  smear: 0.1,
  bar: 0.25,
} as const;

/** The depth number of one part of a figure. */
export function partDepth(figureDepth: number, part: keyof typeof PART): number {
  return figureDepth + PART[part];
}
