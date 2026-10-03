/**
 * The battle stage as a Phaser Scene (spike `spike/phaser-stage`): the FINAL stage design drawn natively in
 * Phaser from a stage config: the painted 3/4 floor, Mark's four heroes on the left, the enemies on the right,
 * each standing on a depth row with a contact shadow and drawn in the right overlap order, and the side-view HUD.
 * An EDIT MODE seam is here already: turn it on and every fighter can be picked up and dropped on another row.
 *
 * If you have not met Phaser before, the ideas this file uses:
 *
 *  - A **Scene** is one screen of the game with a life cycle Phaser calls for us: `init` (receive data),
 *    `preload` (queue files to download), `create` (build the objects once everything has arrived) and
 *    `update` (every frame). The *Scene* owns what it created; Phaser frees it when the scene shuts down.
 *  - A **Sprite** is a picture on the stage with a position, a depth, an origin and a current frame. The
 *    **origin** is the point of the picture that sits at the sprite's x,y: ours is the feet, so "x,y" means
 *    "where this fighter stands". A **frame** is one cell of a sprite sheet.
 *  - **Depth** is a number; Phaser draws objects from the smallest depth to the largest. We use the feet's
 *    y (see `depthFor` in config.ts), so whoever stands nearer the viewer draws on top.
 *  - **A figure is a unit.** One fighter is several Phaser objects: the body sprite, the contact shadow, a
 *    ring under the feet, the health bar, and (while it strikes) an effects picture. They are all given the
 *    fighter's one depth number plus a fixed fraction (`PART`), so a nearer fighter covers ALL of a farther
 *    one, health bar included. (Drawing bars last, over everything, was the design's known gap.)
 *  - **Everything about the layout is read from the stage config** (`src/data/stages.json`), never written
 *    into this file: the horizon, the floor, the rows, the slots, the shadow, the HUD boxes. Each fighter is a
 *    small record (`Fighter`) that remembers its slot, so an edit mode can grab one, change its slot and call
 *    `place` again; `applyStage` re-lays the whole stage out after the config changes.
 *  - **The view.** What the HUD and the fighters' markers show (who is choosing, who is aimed at, health,
 *    the combo counter) comes from a `HudView` (`demo.ts`), made from the game's real data. `refresh` builds
 *    it for the current stage, enemy group and phase and applies it to everyone.
 *  - **update() and the fixed step.** Phaser calls `update` once per screen refresh, and screens refresh
 *    at 60, 75, 120 or 144 Hz. Battle logic must not run faster on a faster screen, so `update` adds the
 *    time since the last call to an accumulator and runs `tick()` once for every 1/60 s it holds. The
 *    battle engine counts frames (it replays as animation at 60 a second), and this is how it will be fed.
 *  - **Everything that moves is driven from that tick**: the enemies' idle sway AND the heroes' sheet frames
 *    (`idleFrame`), not Phaser's own animation clock. Same tick number, same picture, every run: a replay is
 *    deterministic, and a hit-pause is "stop calling tick" and everything holds together.
 */
import Phaser from 'phaser';
import { ABILITIES } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { MEMBERS } from '../data/party';
import type { MemberId } from '../game/state';
import { type AxesFile, axisFor, type FigureBox, depthFor, enemySlots, type PartySlot, partDepth, SCREEN_H, SCREEN_W, setKeyFor, shadowHeight, shadowWidth, slotPoint, snapSlot, type StageConfig, type StageFile, stageOf } from './config';
import { buildHudView, type HudView, type Phase } from './demo';
import { queueStrikeArt, registerStills, STRIKE_ART, type StillInfo } from './stills';
import { loadMoves, type MoveFile } from './moves';
import movesJson from '../data/moves.json';
import { cutSheet } from './feet';
import { kneelRaw } from './kneel';
import { drawCut, drawPalm, drawPath, drawSparks, newFxLayer } from './fx';
import { Hud, type HudFaces, type HudGeo } from './hud';
import { enemyIdle, idleFrame, type IdleKind } from './idle';
import {
  addEnemy,
  bakeStage,
  effectsTexture,
  faceTexture,
  type FigureArt,
  flashTexture,
  tintTexture,
  hazedTexture,
  type CrewInfo,
  PREFIX,
  pruneTextures,
  queueCrewSheets,
  registerCrew,
  ringTexture,
  type SheetMeta,
  addCanvasOnce,
  addStandInSheets,
  crisp,
  rawToCanvas,
  readTexture,
  shadowTexture,
  sheetKey,
  stagePictureKey,
  type StageTextures,
} from './textures';

/** What the lab hands the scene when it starts it. */
export interface StageInit {
  stages: StageFile;
  stageId: string;
  /** Each crew member's sheet description (fetched before the game started). */
  metas: Record<string, SheetMeta>;
  /** True when Mark's sheets were not there and `metas` describe code-drawn stand-ins (nothing to load). */
  standIns: boolean;
  /** Which enemy group to start with (a key of `enemySets`: "1" to "6", "boss", "boss+1", "boss+2"). Default "3". */
  setKey?: string;
  /** Which moment of the example turn to show. Default "choose". */
  phase?: Phase;
  /** Called with a readable message if something fails; the lab shows it on the page. */
  onError: (message: string) => void;
  /** Foot-anchor corrections per sprite (`src/data/axes.json`); none when absent. */
  axes?: AxesFile;
}

/** Layers other than the fighters themselves (which use `depthFor`, below 300,000). */
const BACKDROP_DEPTH = -1;
const GUIDE_DEPTH = 900_000;

/** How a crew member's idle sheet plays: frames, speed and where in the loop this one starts. */
interface SheetPlay {
  fps: number;
  count: number;
  phase: number;
}

/** One standing figure on the stage: its parts (picture, shadow, ring, bar), the slot it was given and what is happening to it. */
export interface Fighter {
  id: string;
  side: 'party' | 'enemy';
  name: string;
  boss: boolean;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  /** The ring under the feet: cyan for the acting hero, amber for the target; hidden otherwise. */
  ring: Phaser.GameObjects.Image;
  /** A dotted ring at the spot an attacker left, shown while it lunges. */
  home: Phaser.GameObjects.Image;
  /** The health bar under an enemy's shadow (drawn with the figure in the depth sort); absent for heroes. */
  bar: Phaser.GameObjects.Graphics | null;
  slot: PartySlot;
  /** The slot's feet (home) and where the feet are now (they differ while an attacker lunges). */
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  /** Knockback of the body only (its shadow stays on the floor). */
  bodyDx: number;
  /** Which sprite this is for the foot-anchor corrections: a crew id, or an enemy's sprite key. */
  axisKey: string;
  /** The figure as measured from its pixels, before any foot-anchor correction (`fig` is this with the correction applied). */
  measured: FigureArt;
  /** The feet row this figure sorts by: its own, or while lunging in contact the target's row plus one. */
  sortY: number;
  idle: IdleKind;
  /** Keeps two of a kind out of step in their idle motion. */
  uid: number;
  /** A hero's idle sheet (frames come from the tick); absent for enemies, which sway instead. */
  sheet?: SheetPlay;
  /** The texture before haze or flash, and what the art knows about itself. */
  baseTex: string;
  fig: FigureArt;
  /** The face name used for the HUD chips. */
  faceName: string;
  shadowW: number;
  active: boolean;
  target: boolean;
  flash: boolean;
  /** How strong the white flash is while `flash` is on (0 to 1; four visible steps), and the red wash over the picture (0 to 1). */
  flashAmt: number;
  tintAmt: number;
  /** The draw-order number now. */
  depth: number;
  /** The picture a move put on this fighter (one of Rook's strike stills), or null for its own idle picture. */
  still: StillInfo | null;
  /** The move's offset from the feet (facing already applied) and the picture's opacity. */
  offX: number;
  offY: number;
  alpha: number;
  /** Defeated: a hero stays dimmed, an enemy is gone. */
  down: boolean;
  /** The size of the idle picture's cell, for the origin when the idle picture comes back after a still. */
  cellW: number;
  cellH: number;
  /** Which picture and frame the sprite shows now ("texture|frame"), so a restyle only touches Phaser when it changed. */
  shown: string;
}

/** What a live battle (`battletest.ts`) lends the scene: a step it takes every tick, and whether the world is frozen (a hitstop). */
export interface LiveHook {
  tick(): void;
  readonly frozen: boolean;
}

/** The fixed simulation step: 60 ticks a second. */
const STEP_MS = 1000 / 60;
/** At most this many catch-up ticks in one frame, then drop the backlog (a stalled tab must not replay minutes). */
const MAX_CATCH_UP = 5;

export class StageScene extends Phaser.Scene {
  /** The party and the enemies, party first. Public so tools can reach them. */
  readonly fighters: Fighter[] = [];
  /** Frames simulated so far (60 a second of game time). */
  frame = 0;
  /** Whether the pointer can pick fighters up (set with `setEditMode`). */
  editMode = false;

  private init0!: StageInit;
  private stage!: StageConfig;
  private pic!: StageTextures;
  private picture: Phaser.GameObjects.Image | null = null;
  private guide: Phaser.GameObjects.Graphics | null = null;
  private fx: Phaser.GameObjects.Image | null = null;
  private hud: Hud | null = null;
  private crew: Record<string, CrewInfo> = {};
  private axesFile: AxesFile = {};
  private enemyKeys: string[] = [];
  private setKey = '3';
  private phase: Phase = 'choose';
  private view!: HudView;
  private acc = 0;
  /** Ticks of WORLD time: it stops during a hitstop (`frame` keeps counting real ticks). */
  worldFrame = 0;
  /** The HUD view of a live battle, or null while the lab's example turn is shown. */
  liveView: HudView | null = null;
  live: LiveHook | null = null;
  /** How many game ticks one real 1/60 s makes: 1 or 2 (the Battle Test's speed option). */
  speed = 1;
  private stillTable: Record<string, StillInfo> | null = null;
  private moveTable: MoveFile | null = null;

  constructor() {
    super('stage');
  }

  /** The stage config in use (what `applyStage` last set). */
  get config(): StageConfig {
    return this.stage;
  }

  /** The enemy keys on stage right now, in slot order. */
  get enemies(): readonly string[] {
    return this.enemyKeys;
  }

  /** The enemy group in use ("3", "boss"...). */
  get enemySet(): string {
    return this.setKey;
  }

  /** The moment of the example turn shown. */
  get currentPhase(): Phase {
    return this.phase;
  }

  /** What the HUD is showing now. */
  get currentView(): HudView {
    return this.view;
  }

  /** The HUD (its containers are reachable for tests and tools). */
  get hudObjects(): Hud | null {
    return this.hud;
  }

  /** The foot-anchor corrections in use. */
  get axes(): AxesFile {
    return this.axesFile;
  }

  /** The stage picture's texture key. */
  get pictureKey(): string {
    return this.pic.key;
  }

  /** Phaser calls this first, with whatever was passed to `scene.add(..., data)`. */
  init(data: StageInit): void {
    // A restarted scene is the same object again: forget the last run's objects (Phaser has destroyed their sprites).
    this.fighters.length = 0;
    this.picture = null;
    this.guide = null;
    this.fx = null;
    this.hud = null;
    this.frame = 0;
    this.worldFrame = 0;
    this.liveView = null;
    this.live = null;
    this.stillTable = null;
    this.acc = 0;
    this.init0 = data;
    this.axesFile = data.axes ?? {};
    this.stage = stageOf(data.stages, data.stageId);
    this.setKey = data.setKey ?? '3';
    this.phase = data.phase ?? 'choose';
  }

  /** Queue the downloads; Phaser holds `create` until they have all arrived. */
  preload(): void {
    // (The loader drops its listeners when the scene shuts down, so a restart does not stack them.)
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.init0.onError(`A file did not load: ${file.url as string} (is the spritefusion-tests link in place?)`);
    });
    // Every crew member we have a description for, so the party can be reordered without loading anything new.
    if (!this.init0.standIns) {
      queueCrewSheets(this.load, this.textures, this.init0.metas, Object.keys(this.init0.metas));
      // Rook's three strike drawings. Nothing is drawn from them until a Battle Test builds his strike.
      queueStrikeArt(this.load, this.textures);
    }
  }

  create(): void {
    try {
      this.build();
    } catch (e) {
      // A failure here would otherwise leave a black canvas and one line in the console.
      if (e instanceof Error && e.stack) console.error(e.stack);
      this.init0.onError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  private build(): void {
    if (this.init0.standIns) addStandInSheets(this.textures, this.init0.metas);
    this.crew = registerCrew(this.textures, this.anims, this.init0.metas, Object.keys(this.init0.metas), this.init0.standIns);

    for (const a of Object.values(STRIKE_ART)) if (this.textures.exists(a.key)) crisp(this.textures.get(a.key));
    this.hud = new Hud(this, this.faces());
    this.buildPicture();
    this.guide = this.add.graphics().setDepth(GUIDE_DEPTH).setVisible(this.editMode);
    this.drawGuide();
    this.makeParty();
    this.makeEnemies(this.stage.demo.rosters[this.setKey] ?? [], this.setKey);
    this.refresh();

    // Edit mode: one scene-wide listener hears every drag (it is only fired for objects made draggable).
    this.input.on('drag', (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
      const f = this.fighters.find((x) => x.sprite === obj);
      if (f) {
        this.place(f, snapSlot(this.stage, f.side, dragX, dragY));
        // The labels that follow a figure (the acting hero's name tab, the target's) move with it.
        this.hud?.render(this.stage, this.view, this.geo());
      }
    });
    this.setEditMode(this.editMode);
  }

  // ---------------------------------------------------------------- picture

  /** (Re)make the stage picture (wall and painted floor) for the current config. */
  private buildPicture(floorFrom?: StageConfig): void {
    this.pic = bakeStage(this.textures, this.stage, floorFrom);
    if (this.picture) this.picture.setTexture(this.pic.key);
    else this.picture = this.add.image(0, 0, this.pic.key).setOrigin(0, 0).setDepth(BACKDROP_DEPTH);
  }

  /** The edit-mode guide: the horizon, the floor's edges and the depth rows as thin lines (hidden outside edit mode). */
  private drawGuide(): void {
    const g = this.guide;
    if (!g) return;
    const { rows, floor, backdrop } = this.stage;
    g.clear();
    const line = (y: number, colour: number, alpha: number): void => {
      g.fillStyle(colour, alpha).fillRect(0, y, SCREEN_W, 1);
    };
    for (const r of rows) line(r.y, 0xffffff, 0.18);
    // (The floor's top is the horizon, drawn below in cyan.)
    line(floor.y1 - 1, 0xffd35a, 0.7);
    line(backdrop.horizonY, 0x5ae8ff, 0.85);
  }

  // ---------------------------------------------------------------- fighters

  /** Face pictures for the HUD chips, cut from the sprites on the stage. */
  private faces(): HudFaces {
    const of = (side: Fighter['side'], index: number): Fighter => {
      const f = this.fighters.filter((x) => x.side === side)[index];
      if (!f) throw new Error(`No ${side} fighter ${index} to cut a face from`);
      return f;
    };
    return {
      party: (i, size) => {
        const f = of('party', i);
        return faceTexture(this.textures, f.faceName, f.fig, size);
      },
      foe: (i, size) => {
        const f = of('enemy', i);
        return faceTexture(this.textures, f.faceName, f.fig, size);
      },
    };
  }

  /** Build the four heroes from the stage's lineup, in the party slots. */
  private makeParty(): void {
    this.removeSide('party');
    this.stage.demo.lineup.forEach((id, i) => {
      const slot = this.stage.party[i];
      const meta = this.init0.metas[id];
      const info = this.crew[id];
      if (!slot || !meta || !info) throw new Error(`No slot, sheet or feet for ${id}`);
      // Start the loops on different frames so the four do not bounce in unison.
      const sheet: SheetPlay = { fps: meta.fps, count: meta.frame_count, phase: (i * 3) % meta.frame_count };
      // Origin = the feet as a fraction of the picture, so the sprite's position is where they stand.
      const sprite = this.add.sprite(0, 0, sheetKey(id), idleFrame(this.frame, sheet.fps, sheet.count, sheet.phase));
      const f = this.makeFighter(id, 'party', MEMBERS[id as MemberId]?.name ?? id, false, sprite, slot, 'still', i, sheetKey(id), info.fig, id, id);
      f.sheet = sheet;
      this.place(f, slot);
    });
  }

  /** Build the enemies from these keys of `ENEMIES`, in the slots of set `setKey`. */
  private makeEnemies(keys: readonly string[], setKey: string): void {
    this.removeSide('enemy');
    this.enemyKeys = [...keys];
    this.setKey = setKey;
    const slots = enemySlots(this.stage, setKey);
    if (slots.length !== keys.length) throw new Error(`The set "${setKey}" has ${slots.length} slots but ${keys.length} enemies were given`);
    const copies = new Map<string, number>();
    keys.forEach((key, i) => {
      const def = ENEMIES[key];
      const slot = slots[i];
      if (!def || !slot) throw new Error(`Unknown enemy "${key}" or no slot for it`);
      // A second punk is a different individual, not the same sprite twice.
      const copy = copies.get(def.sprite) ?? 0;
      copies.set(def.sprite, copy + 1);
      const tex = addEnemy(this.textures, def.sprite, copy);
      const sprite = this.add.sprite(0, 0, tex.key);
      const f = this.makeFighter(`${key}#${i}`, 'enemy', def.name, slot.size === 'boss' || !!def.boss, sprite, slot, tex.idle, i, tex.key, tex.fig, `${def.sprite}-${copy}`, def.sprite);
      this.place(f, slot);
    });
  }

  /** Destroy one side's fighters (every part) so a replacement does not leave stray objects behind. */
  private removeSide(side: Fighter['side']): void {
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const f = this.fighters[i];
      if (f?.side !== side) continue;
      for (const part of [f.sprite, f.shadow, f.ring, f.home, f.bar]) part?.destroy();
      this.fighters.splice(i, 1);
    }
  }

  private makeFighter(id: string, side: Fighter['side'], name: string, boss: boolean, sprite: Phaser.GameObjects.Sprite, slot: PartySlot, idle: IdleKind, uid: number, baseTex: string, fig: FigureArt, faceName: string, axisKey: string): Fighter {
    const stub = this.stage.shadow;
    const shadow = this.add.image(0, 0, shadowTexture(this.textures, 16, stub)).setVisible(false);
    const ring = this.add.image(0, 0, ringTexture(this.textures, 24, '#3fe0f0')).setVisible(false);
    const home = this.add.image(0, 0, ringTexture(this.textures, 24, '#3fe0f0', true)).setVisible(false);
    const bar = side === 'enemy' && this.stage.hud.enemyInfo.barsOnStage ? this.add.graphics() : null;
    // A tag an edit mode can read back from whatever the pointer picks (`setData`/`getData` hang small values on any game object).
    sprite.setData('fighterId', id);
    const f: Fighter = {
      id, side, name, boss, sprite, shadow, ring, home, bar, slot, baseX: 0, baseY: 0, x: 0, y: 0, bodyDx: 0, axisKey, measured: fig, sortY: 0, idle, uid, baseTex, fig, faceName, shadowW: 0,
      active: false, target: false, flash: false, flashAmt: 1, tintAmt: 0, depth: 0,
      still: null, offX: 0, offY: 0, alpha: 1, down: false, cellW: sprite.width, cellH: sprite.height, shown: '',
    };
    this.applyAxis(f);
    // Party first in the list, then enemies: keep that order whichever side is rebuilt.
    if (side === 'party') this.fighters.splice(this.fighters.filter((x) => x.side === 'party').length, 0, f);
    else this.fighters.push(f);
    if (this.editMode) this.grabbable(f, true);
    return f;
  }

  /**
   * Set a fighter's feet from its measured ones plus the foot-anchor correction for its sprite (`axes.json`). The
   * sprite's ORIGIN is the point of the picture that stands at the sprite's position, so shifting the origin by one
   * pixel moves the whole figure one pixel the other way, which is exactly what a measured foot that was a pixel off needs.
   */
  private applyAxis(f: Fighter): void {
    const shift = axisFor(this.axesFile, f.axisKey);
    f.fig = { ...f.measured, foot: { x: f.measured.foot.x + shift.x, y: f.measured.foot.y + shift.y } };
    this.applyOrigin(f);
  }

  /** The sprite's origin: the feet of its idle picture, or the axis of the still a move put on it (plus this sprite's foot-anchor correction). */
  private applyOrigin(f: Fighter): void {
    if (f.still) {
      const shift = axisFor(this.axesFile, f.axisKey);
      f.sprite.setOrigin((f.still.axisX + shift.x) / f.still.w, (f.still.axisY + shift.y) / f.still.h);
    } else f.sprite.setOrigin(f.fig.foot.x / f.cellW, f.fig.foot.y / f.cellH);
  }

  /** Use these foot-anchor corrections from now on: every figure is re-anchored and drawn again. */
  setAxes(axes: AxesFile): void {
    this.axesFile = axes;
    for (const f of this.fighters) this.applyAxis(f);
    this.refresh();
  }

  /**
   * The fighter under a point of the screen (game pixels), or null. It looks at the drawn pixels, so the empty
   * corner of a sprite's cell is not a hit, and when two fighters overlap the one drawn on top (nearer) wins.
   * This is how an editor picks things without making the sprites interactive in Phaser's own input system.
   */
  pick(x: number, y: number): Fighter | null {
    const hits = [...this.fighters].sort((a, b) => b.depth - a.depth);
    for (const f of hits) {
      const s = f.sprite;
      const px = Math.floor(x - s.x + s.originX * s.width);
      const py = Math.floor(y - s.y + s.originY * s.height);
      if (px < 0 || py < 0 || px >= s.width || py >= s.height) continue;
      if (this.textures.getPixelAlpha(px, py, s.texture.key, s.frame.name) > 8) return f;
    }
    return null;
  }

  /** Where one fighter is on the screen now: its feet and the edges of its drawn pixels. */
  boxOf(f: Fighter): HudGeo['party'][number] {
    return this.geoOf(f);
  }

  /** Make a fighter pickable (or not) by the pointer. The hit test follows the drawn pixels, so clicking the empty corner of a cell misses. */
  private grabbable(f: Fighter, on: boolean): void {
    if (on) f.sprite.setInteractive({ pixelPerfect: true, alphaTolerance: 1, draggable: true, useHandCursor: true });
    else f.sprite.disableInteractive();
  }

  /** Turn edit mode on or off: fighters become draggable and the guide lines show. */
  setEditMode(on: boolean): void {
    this.editMode = on;
    for (const f of this.fighters) this.grabbable(f, on);
    this.guide?.setVisible(on);
  }

  // ---------------------------------------------------------------- changing what is shown

  /**
   * Re-lay everything out from a changed stage config: the call an editor makes after changing it. Rebuilds
   * only what a change needs: a changed floor or backdrop repaints the picture, a different stage swaps its
   * party and enemy group; otherwise everything just moves.
   *
   * The floor keeps puddles clear of every slot, so moving a slot normally repaints the floor and the puddles
   * jump. An editor dragging a fighter passes the stage as it was when the drag began as `floorFrom`: the floor is
   * then painted from THAT stage's slots, so it holds still during the drag, and one last call without it repaints.
   */
  applyStage(stage: StageConfig, floorFrom?: StageConfig): void {
    const before = this.stage;
    this.stage = stage;
    const repaint = stagePictureKey(stage, floorFrom) !== this.pic.key;
    if (repaint) this.buildPicture(floorFrom);
    const newKeys = stage.id !== before.id;
    if (stage.demo.lineup.join() !== before.demo.lineup.join() || newKeys) this.makeParty();
    if (newKeys) this.makeEnemies(stage.demo.rosters[this.setKey] ?? this.enemyKeys, this.setKey);
    else {
      // Slots changed? Move everyone to the config's slots.
      const set = enemySlots(stage, this.setKey);
      let p = 0;
      let e = 0;
      for (const f of this.fighters) this.place(f, (f.side === 'party' ? stage.party[p++] : set[e++]) ?? f.slot);
    }
    this.drawGuide();
    this.refresh();
  }

  /** Show another stage of the file by id ("street", "sewer"). */
  showStage(id: string): void {
    this.applyStage(stageOf(this.init0.stages, id));
  }

  /** Show another enemy group of this stage ("1" to "6", "boss", "boss+1", "boss+2") with the stage's own roster for it. */
  setEnemySet(key: string): void {
    const roster = this.stage.demo.rosters[key];
    if (!roster) throw new Error(`Stage "${this.stage.id}" has no roster for "${key}"`);
    this.makeEnemies(roster, key);
    this.refresh();
  }

  /** Replace the enemies with these (keys of `ENEMIES`), standing in the slot set for that many (the boss set when the first is a boss). */
  setEnemies(keys: readonly string[], setKey?: string): void {
    this.makeEnemies(keys, setKey ?? setKeyFor(keys.length, !!ENEMIES[keys[0] ?? '']?.boss));
    this.refresh();
  }

  /** Show another moment of the example turn: "choose" (the menu is open), "target" (picking whom to hit) or "act" (an action plays). */
  setPhase(phase: Phase): void {
    this.phase = phase;
    this.refresh();
  }

  /** The stage config as it stands now, with the fighters' current slots written back (what a Save would store). */
  currentStage(): StageConfig {
    const out = JSON.parse(JSON.stringify(this.stage)) as StageConfig;
    out.party = this.fighters.filter((f) => f.side === 'party').map((f) => ({ ...f.slot }));
    const original = this.stage.enemySets[this.setKey] ?? [];
    out.enemySets[this.setKey] = this.fighters
      .filter((f) => f.side === 'enemy')
      .map((f, i) => {
        const size = original[i]?.size;
        return size ? { ...f.slot, size } : { ...f.slot };
      });
    return out;
  }

  /** Put one fighter in a slot: position, depth, haze, size and shadow all follow from the config. */
  place(f: Fighter, slot: PartySlot): void {
    f.slot = slot;
    // `slotPoint` keeps the feet inside the floor, so nothing stands on the wall or off the bottom of the screen.
    const p = slotPoint(this.stage, slot);
    f.baseX = p.x;
    f.baseY = p.y;
    f.x = p.x;
    f.y = p.y;
    f.sortY = p.y;
    f.bodyDx = 0;
    this.restyle(f);
  }

  /**
   * Rebuild the view for the current stage, enemy group and phase and apply it to everyone: who is active or
   * aimed at, the health bars, the lunge and flash of an action that plays, then the HUD.
   */
  refresh(): void {
    if (!this.hud) return;
    if (this.liveView) {
      this.refreshLive();
      return;
    }
    this.view = buildHudView(this.stage.demo, this.setKey, this.phase, this.enemyKeys);
    const v = this.view;
    const party = this.fighters.filter((f) => f.side === 'party');
    const foes = this.fighters.filter((f) => f.side === 'enemy');
    for (const f of this.fighters) {
      f.x = f.baseX;
      f.y = f.baseY;
      f.sortY = f.baseY;
      f.bodyDx = 0;
      f.active = false;
      f.target = false;
      f.flash = false;
    }
    const hero = party[v.active];
    if (hero) hero.active = true;
    const aimed = v.target === null ? undefined : foes[v.target];
    if (aimed) aimed.target = true;

    let fxImage: string | null = null;
    if (v.phase === 'act' && v.act && hero && aimed) {
      const act = v.act;
      const homeX = hero.baseX;
      const homeY = hero.baseY;
      // The attacker arrives at the target's feet row, just left of it, so the weapon or fist meets its body.
      const targetLeft = aimed.baseX + (aimed.fig.box.x0 - aimed.fig.foot.x);
      const heroRight = hero.fig.box.x1 + 1 - hero.fig.foot.x;
      hero.x = targetLeft - heroRight + this.stage.demo.act.reach + 4;
      hero.y = aimed.baseY;
      // While in contact the attacker borrows the target's feet row plus a pixel, so its body draws over the target's.
      hero.sortY = aimed.baseY + this.stage.sort.lungeOverTarget;
      aimed.flash = true;
      aimed.bodyDx = 3; // a 3 px knockback of the body (its shadow stays put)

      const layer = newFxLayer(SCREEN_W, SCREEN_H);
      drawPath(layer, { x: homeX, y: homeY }, { x: hero.x, y: hero.y });
      const g = this.geoOf(aimed);
      if (act.fx === 'cut') {
        const cx = aimed.baseX;
        const cy = aimed.baseY - Math.floor((aimed.fig.box.y1 - aimed.fig.box.y0 + 1) / 2);
        drawCut(layer, { x: cx - 30, y: cy - 26 }, { x: cx + 26, y: cy + 22 }, 4.0, { x: 6, y: -8 });
        drawCut(layer, { x: cx - 20, y: cy - 30 }, { x: cx + 32, y: cy + 4 }, 2.4, { x: 4, y: -6 });
        drawSparks(layer, cx, cy);
      } else drawPalm(layer, g.left + 6, aimed.baseY - Math.floor((aimed.fig.box.y1 - aimed.fig.box.y0 + 1) / 2) + 4);
      fxImage = effectsTexture(this.textures, layer);
    }
    for (const f of this.fighters) this.restyle(f);
    this.applyFx(fxImage, hero);
    // Only the current action's effects picture is kept.
    pruneTextures(this.textures, PREFIX.fx, new Set(fxImage ? [fxImage] : []));

    // The home marker: a dotted ring where the attacker started.
    for (const f of this.fighters) f.home.setVisible(false);
    if (v.phase === 'act' && hero && (hero.x !== hero.baseX || hero.y !== hero.baseY)) {
      hero.home
        .setTexture(ringTexture(this.textures, hero.shadowW + (this.stage.shadow.activeRing?.extraW ?? 6), this.stage.shadow.activeRing?.color ?? '#3fe0f0', true))
        .setPosition(hero.baseX, hero.baseY + 1)
        .setDepth(partDepth(hero.depth, 'ring'))
        .setVisible(true);
    }
    this.hud.render(this.stage, v, this.geo());
    pruneTextures(this.textures, PREFIX.shadow, new Set(this.fighters.map((f) => f.shadow.texture.key)));
    pruneTextures(this.textures, PREFIX.ring, new Set(this.fighters.flatMap((f) => [f.ring.texture.key, f.home.texture.key])));
  }

  /**
   * The live battle's version of `refresh`: the view comes from the fight (`liveView`), and nothing about where the
   * fighters stand or what they are doing is reset, because the performer owns that tick by tick. This marks who is
   * acting and who is aimed at, restyles everyone (depth, shadow, haze, flash) and redraws the HUD.
   */
  refreshLive(): void {
    const v = this.liveView;
    if (!this.hud || !v) return;
    this.view = v;
    const party = this.fighters.filter((f) => f.side === 'party');
    const foes = this.fighters.filter((f) => f.side === 'enemy');
    for (const f of this.fighters) {
      f.active = false;
      f.target = false;
    }
    const hero = party[v.active];
    if (hero) hero.active = true;
    const aimed = v.target === null ? undefined : foes[v.target];
    if (aimed) aimed.target = true;
    const ally = v.allyTarget === null || v.allyTarget === undefined ? undefined : party[v.allyTarget];
    if (ally) ally.target = true;
    for (const f of this.fighters) this.restyle(f);
    this.hud.render(this.stage, v, this.geo());
    pruneTextures(this.textures, PREFIX.shadow, new Set(this.fighters.map((f) => f.shadow.texture.key)));
    pruneTextures(this.textures, PREFIX.ring, new Set(this.fighters.flatMap((f) => [f.ring.texture.key, f.home.texture.key])));
  }

  /** Redraw the HUD and the figures' markers for the current view without rebuilding anything (a health bar moved). */
  redrawLive(): void {
    this.refreshLive();
  }

  /** Re-style one fighter after the performer changed its pose, position or flash. */
  restyleFighter(f: Fighter): void {
    this.restyle(f);
  }

  /** Where a figure is now, for effects and labels placed relative to it. */
  figureGeo(f: Fighter): HudGeo['party'][number] {
    return this.geoOf(f);
  }

  /**
   * The picture of a fallen hero (`$down` in the move file): the hero's own idle drawing with rows taken out of the legs
   * (see `kneel.ts`), made once. It stands on the same feet as the idle cell, so the sprite's origin is the idle's.
   */
  downStill(f: Fighter): StillInfo {
    const key = `still-down-${f.id}`;
    if (!this.textures.exists(key)) {
      const raw = kneelRaw(f.measured.raw, f.measured.box, f.side === 'party' ? 1 : -1);
      addCanvasOnce(this.textures, key, rawToCanvas(raw));
    }
    return { texture: key, w: f.measured.raw.w, h: f.measured.raw.h, axisX: f.measured.foot.x, axisY: f.measured.foot.y };
  }

  /**
   * A summon: more enemies join the fight. They take the slots of the enemy group that is as big as the new total (so the
   * boss keeps its place and the newcomers stand where the stage's designer put them), and are returned in the order the
   * engine numbered them. Their health bars and HUD chips follow because the fight's view lists them.
   */
  addEnemies(keys: readonly string[]): Fighter[] {
    const have = this.fighters.filter((f) => f.side === 'enemy');
    const total = have.length + keys.length;
    const bossFirst = !!ENEMIES[this.enemyKeys[0] ?? '']?.boss;
    const wanted = this.stage.enemySets[setKeyFor(total, bossFirst)] ?? this.stage.enemySets[this.setKey] ?? [];
    const copies = new Map<string, number>();
    for (const f of have) copies.set(f.axisKey, (copies.get(f.axisKey) ?? 0) + 1);
    const out: Fighter[] = [];
    keys.forEach((key, i) => {
      const def = ENEMIES[key];
      const slot = wanted[have.length + i] ?? wanted[wanted.length - 1] ?? have[have.length - 1]?.slot;
      if (!def || !slot) throw new Error(`Cannot summon "${key}": unknown enemy or no slot for it`);
      const copy = copies.get(def.sprite) ?? 0;
      copies.set(def.sprite, copy + 1);
      const tex = addEnemy(this.textures, def.sprite, copy);
      const sprite = this.add.sprite(0, 0, tex.key);
      const f = this.makeFighter(`${key}#${have.length + i}`, 'enemy', def.name, !!def.boss, sprite, { ...slot }, tex.idle, have.length + i, tex.key, tex.fig, `${def.sprite}-${copy}`, def.sprite);
      this.enemyKeys.push(key);
      this.place(f, f.slot);
      out.push(f);
    });
    return out;
  }

  /** A boss phase change: this enemy is now another one (the Warden's mech shell breaks and the spirit inside is loose). Same place, new picture, name and bar. */
  transformEnemy(f: Fighter, key: string): void {
    const def = ENEMIES[key];
    if (!def) throw new Error(`Cannot become "${key}": unknown enemy`);
    const tex = addEnemy(this.textures, def.sprite, 0);
    f.name = def.name;
    f.boss = f.boss || !!def.boss;
    f.baseTex = tex.key;
    f.measured = tex.fig;
    f.idle = tex.idle;
    f.faceName = `${def.sprite}-0`;
    f.axisKey = def.sprite;
    f.cellW = tex.width;
    f.cellH = tex.height;
    f.shown = '';
    f.sprite.setData('fighterId', `${key}#${f.uid}`);
    f.id = `${key}#${f.uid}`;
    const at = this.fighters.filter((x) => x.side === 'enemy').indexOf(f);
    if (at >= 0) this.enemyKeys[at] = key;
    this.applyAxis(f);
    this.restyle(f);
  }

  /** The move file (checked once) and Rook's stills (built on first use: the pixel work is not paid by pages that never battle). */
  battleAssets(): { moves: MoveFile; stills: Record<string, StillInfo> } {
    if (!this.moveTable) {
      this.moveTable = loadMoves(movesJson, { abilities: new Set(Object.keys(ABILITIES)), actors: new Set(Object.keys(this.init0.metas)) });
    }
    if (!this.stillTable) {
      const fighter = (id: string): { idle: ReturnType<typeof cutSheet>; foot: CrewInfo['foot'] } => {
        const meta = this.init0.metas[id];
        const info = this.crew[id];
        if (!meta || !info) throw new Error(`${id} is not in this stage lab, so his or her moves cannot be built`);
        return { idle: cutSheet(readTexture(this.textures, sheetKey(id)), meta.frame_w, meta.frame_count), foot: info.foot };
      };
      this.stillTable = registerStills({ textures: this.textures, fighters: { 'sf-rook': fighter('rook'), 'sf-kit': fighter('kit') }, read: (key) => readTexture(this.textures, key), standIns: this.init0.standIns }, this.moveTable.stills);
    }
    return { moves: this.moveTable, stills: this.stillTable };
  }

  /**
   * Bake the pictures a fight will need before it starts (the white flash of every fighter and of every still), so no hit
   * has to read pixels back from the graphics card on the very tick it lands.
   */
  prebake(): void {
    // Every strength of flash a fade passes through (the red wash a hero gets is baked on first use: it depends on the row's haze).
    for (const f of this.fighters) {
      for (const level of [1, 0.75, 0.5, 0.25]) flashTexture(this.textures, f.baseTex, level);
    }
    for (const s of Object.values(this.stillTable ?? {})) {
      for (const level of [1, 0.75, 0.5, 0.25]) flashTexture(this.textures, s.texture, level);
    }
    for (const f of this.fighters) if (f.side === 'party') this.downStill(f);
  }

  /** Start showing a live battle's view (null goes back to the lab's example turn). */
  setLive(view: HudView | null, hook: LiveHook | null): void {
    this.liveView = view;
    this.live = hook;
    if (!view) this.refresh();
    else this.refreshLive();
  }

  /**
   * Leave the live battle: the enemies go back to the group the test started with (a summon added some, a boss phase changed
   * one), and the lab's own example turn is shown again.
   */
  endLive(keys: readonly string[], setKey: string): void {
    this.live = null;
    this.liveView = null;
    this.makeEnemies(keys, setKey);
    this.refresh();
  }

  /** The effects picture of an action in progress, as part of the attacker's figure (it sorts with it: just over its body). */
  private applyFx(key: string | null, owner: Fighter | undefined): void {
    if (!key || !owner) {
      this.fx?.destroy();
      this.fx = null;
      return;
    }
    if (this.fx) this.fx.setTexture(key);
    else this.fx = this.add.image(0, 0, key).setOrigin(0, 0);
    this.fx.setDepth(partDepth(owner.depth, 'smear'));
  }

  /** Where a figure is on the screen now (its edges include the body's knockback), for the labels placed relative to it. */
  private geoOf(f: Fighter): HudGeo['party'][number] {
    const b = f.fig.box;
    const dx = f.bodyDx;
    return { x: f.x, y: f.y, top: f.y + 1 - (f.fig.foot.y - b.y0), left: f.x + dx + (b.x0 - f.fig.foot.x), right: f.x + dx + (b.x1 + 1 - f.fig.foot.x), boss: f.boss };
  }

  private geo(): HudGeo {
    return { party: this.fighters.filter((f) => f.side === 'party').map((f) => this.geoOf(f)), foes: this.fighters.filter((f) => f.side === 'enemy').map((f) => this.geoOf(f)) };
  }

  /** Every figure's size on screen, for the design's checks that need it (the lane between the sides, the edges...). */
  figureBoxes(): FigureBox[] {
    return this.fighters.map((f) => {
      const g = this.geoOf(f);
      return { x: f.baseX, y: f.baseY, left: g.left, right: g.right, top: g.top, boss: f.boss, side: f.side };
    });
  }

  /**
   * Everything about one figure that follows from its state: which picture (hazed by depth, or the white flash),
   * where each part sits and what depth number it draws at, the shadow and ring sizes, the health bar.
   */
  private restyle(f: Fighter): void {
    const st = this.stage;
    // The picture: a hit flash, else the depth haze for this row (the acting hero and the target are exempt), else as drawn.
    // (While a move shows one of its stills, that picture takes the place of the fighter's own, with the same haze and flash.)
    const base = f.still ? f.still.texture : f.baseTex;
    let tex = base;
    if (f.flash) tex = flashTexture(this.textures, base, f.flashAmt);
    else if (f.down && f.side === 'party') tex = hazedTexture(this.textures, base, '#1a1d33', 0.55);
    else {
      if (st.depthTint) {
        const amount = st.depthTint.exemptActive && (f.active || f.target) ? 0 : (st.depthTint.amounts[f.slot.row] ?? 0);
        tex = hazedTexture(this.textures, base, st.depthTint.fog, amount);
      }
      // A red wash over a hero who has just been hit.
      if (f.tintAmt > 0) tex = tintTexture(this.textures, tex, f.tintAmt);
    }
    // A hero's idle picture is one cell of a sheet, so say which; a still or an enemy's art is a single picture.
    const frame = f.still || !f.sheet ? undefined : idleFrame(this.worldFrame, f.sheet.fps, f.sheet.count, f.sheet.phase);
    const want = `${tex}|${frame ?? ''}`;
    if (f.shown !== want) {
      f.sprite.setTexture(tex, frame);
      f.shown = want;
      this.applyOrigin(f);
    }
    f.sprite.setAlpha(f.alpha);

    // The draw order: every part of the figure shares one number (plus its own fraction), so the whole figure sorts as one unit.
    f.depth = depthFor(f.sortY, f.x, f.side, f.slot.order ?? 0);
    f.sprite.setPosition(f.x + f.bodyDx + f.offX, f.y + 1 + f.offY).setDepth(f.depth);

    // The contact shadow: a flat oval on the floor under the feet (it stays at floor height and follows only x and depth).
    const sprW = f.fig.box.x1 + 1 - f.fig.box.x0;
    f.shadowW = shadowWidth(st, sprW, f.boss);
    if (f.shadowW <= 0) f.shadow.setVisible(false);
    else {
      f.shadow.setTexture(shadowTexture(this.textures, f.shadowW, st.shadow)).setVisible(true).setPosition(f.x, f.y + 1).setDepth(partDepth(f.depth, 'shadow'));
    }

    // The ring under the acting hero (cyan) and the target (amber).
    f.ring.setDepth(partDepth(f.depth, 'ring'));
    const ringSpec = f.active ? st.shadow.activeRing : f.target ? { color: '#ffcc3d', extraW: st.shadow.activeRing?.extraW ?? 6 } : null;
    if (ringSpec && f.shadowW > 0) f.ring.setTexture(ringTexture(this.textures, f.shadowW + ringSpec.extraW, ringSpec.color)).setVisible(true).setPosition(f.x, f.y + 1).setDepth(partDepth(f.depth, 'ring'));
    else f.ring.setVisible(false);

    // The health bar, drawn with its owner: under the shadow, in the sort (a nearer fighter's body covers it).
    // A fallen enemy takes its shadow, ring and health bar with it as it fades.
    const gone = f.side === 'enemy' && f.down && f.alpha <= 0;
    f.shadow.setAlpha(f.alpha);
    f.ring.setAlpha(f.alpha);
    if (gone) {
      f.shadow.setVisible(false);
      f.ring.setVisible(false);
    }
    this.drawBar(f);
    f.bar?.setVisible(!gone);
    f.bar?.setAlpha(f.alpha);
  }

  private drawBar(f: Fighter): void {
    const spec = this.stage.hud.enemyInfo.barsOnStage;
    if (!f.bar || !spec) return;
    const foe = this.view?.foes[this.fighters.filter((x) => x.side === 'enemy').indexOf(f)];
    f.bar.clear();
    if (!foe) return;
    const w = f.boss ? 64 : spec.w;
    const h = f.boss ? 3 : spec.h;
    const shadowH = f.shadowW > 0 ? shadowHeight(this.stage, f.shadowW) : 0;
    const by = 1 + Math.floor(shadowH / 2) + spec.gapBelowShadow;
    const ratio = Math.max(0, Math.min(1, foe.hp / foe.maxHp));
    const colour = ratio > 0.5 ? 0x62e06a : ratio > 0.25 ? 0xffcc3d : 0xff5a5a;
    const fw = Math.round(w * ratio);
    f.bar.fillStyle(0x07060d, 1).fillRect(-Math.floor(w / 2) - 1, by - 1, w + 2, h + 2);
    f.bar.fillStyle(0x241f3a, 1).fillRect(-Math.floor(w / 2), by, w, h);
    if (fw > 0) {
      f.bar.fillStyle(colour, 1).fillRect(-Math.floor(w / 2), by, fw, h);
      f.bar.fillStyle(0xffffff, 0.45).fillRect(-Math.floor(w / 2), by, fw, 1);
    }
    f.bar.setPosition(f.x, f.y).setDepth(partDepth(f.depth, 'bar'));
  }

  // ---------------------------------------------------------------- time

  /** Phaser calls this every screen refresh; the accumulator turns that into a steady 60 ticks a second. */
  override update(_time: number, delta: number): void {
    this.acc += Math.min(delta, 250) * this.speed;
    let ticks = 0;
    while (this.acc >= STEP_MS && ticks < MAX_CATCH_UP) {
      this.tick();
      this.acc -= STEP_MS;
      ticks++;
    }
    if (ticks === MAX_CATCH_UP) this.acc = 0;
  }

  /** Run `n` ticks right now, without waiting for the clock: how a test (or a replay scrubber) reaches a given moment. */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }

  /**
   * One step of game time (1/60 s). Everything that moves is chosen from `this.frame` here: the heroes'
   * sheet frames and the enemies' sway. The battle replay will run here too, and a hit-pause will simply
   * skip this call for a few frames so every figure holds still together.
   */
  private tick(): void {
    this.frame++;
    // A hitstop freezes the world: no idle animation moves, and the live battle's own clocks wait too.
    if (!this.live?.frozen) this.worldFrame++;
    this.live?.tick();
    for (const f of this.fighters) {
      if (f.down) continue;
      if (f.sheet) {
        // A hero's idle loop plays only while no move has put a still on it.
        if (!f.still) {
          const frame = idleFrame(this.worldFrame, f.sheet.fps, f.sheet.count, f.sheet.phase);
          f.sprite.setFrame(frame);
          f.shown = `${f.sprite.texture.key}|${frame}`;
        }
      } else {
        const o = enemyIdle(f.idle, this.worldFrame, f.uid);
        f.sprite.setPosition(f.x + f.bodyDx + f.offX + o.x, f.y + 1 + f.offY + o.y);
      }
    }
  }
}
