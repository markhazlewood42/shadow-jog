/**
 * The battle stage as a Phaser Scene (spike `spike/phaser-stage`): the backdrop, Mark's four heroes on the
 * left and the enemies on the right, each standing on a depth row with a contact shadow and drawn in the
 * right overlap order. No HUD and no battle yet; those are later steps. An EDIT MODE seam is here already:
 * turn it on and every fighter can be picked up and dropped on another depth row.
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
 *  - **Everything about the layout is read from the stage config** (`src/data/stages.json`), never written
 *    into this file: where the horizon is, the rows, the slots, who stands in them, which enemies fight and
 *    how big their pixels are drawn. Each fighter is a small record (`Fighter`) that remembers its slot, so an
 *    edit mode can grab one, change its slot and call `place` again; `applyStage` re-lays the whole stage out
 *    (and rebuilds whatever a change needs: the backdrop, the party, the enemy set) after the config changes.
 *  - **update() and the fixed step.** Phaser calls `update` once per screen refresh, and screens refresh
 *    at 60, 75, 120 or 144 Hz. Battle logic must not run faster on a faster screen, so `update` adds the
 *    time since the last call to an accumulator and runs `tick()` once for every 1/60 s it holds. The
 *    battle engine counts frames (it replays as animation at 60 a second), and this is how it will be fed.
 *  - **Everything that moves is driven from that tick**: the enemies' idle sway AND the heroes' sheet frames
 *    (`idleFrame`), not Phaser's own animation clock. Same tick number, same picture, every run: a replay is
 *    deterministic, and a hit-pause is "stop calling tick" and everything holds together.
 */
import Phaser from 'phaser';
import { ENEMIES } from '../data/enemies';
import { depthFor, enemyScaleFor, enemyShadowWidth, enemySlots, rowTint, type Slot, type StageConfig, type StageFile, SCREEN_H, SCREEN_W, slotPoint, snapSlot, stageOf } from './config';
import type { FootAnchor } from './feet';
import { enemyIdle, idleFrame, type IdleKind } from './idle';
import { addBackdrop, addEnemy, addShadow, addStandInSheets, type BackdropTextures, pruneShadows, queueCrewSheets, registerCrew, type SheetMeta, sheetKey } from './textures';

/** What the lab hands the scene when it starts it. */
export interface StageInit {
  stages: StageFile;
  stageId: string;
  /** Each crew member's sheet description (fetched before the game started). */
  metas: Record<string, SheetMeta>;
  /** True when Mark's sheets were not there and `metas` describe code-drawn stand-ins (nothing to load). */
  standIns: boolean;
  /** Enemies to show instead of the stage's own demo `fight` (keys of `ENEMIES`, 1 to 4). */
  enemies?: string[];
  /** Called with a readable message if something fails; the lab shows it on the page. */
  onError: (message: string) => void;
}

/** Layers other than the fighters themselves (which use `depthFor`, 150000 and up). */
const BACKDROP_DEPTH = -1;
const GUIDE_DEPTH = 900_000;
const FOREGROUND_DEPTH = 1_000_000;

/** How a crew member's idle sheet plays: frames, speed and where in the loop this one starts. */
interface SheetPlay {
  fps: number;
  count: number;
  phase: number;
}

/** One standing figure on the stage: the picture, its shadow, and the slot it was given. */
export interface Fighter {
  id: string;
  side: 'party' | 'enemy';
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  slot: Slot;
  idle: IdleKind;
  /** Keeps two of a kind out of step in their idle motion. */
  uid: number;
  /** Where the feet are (the slot's point); idle motion is added on top. */
  baseX: number;
  baseY: number;
  /** A hero's idle sheet (frames come from the tick); absent for enemies, which sway instead. */
  sheet?: SheetPlay;
  /** An enemy's art: its sprite key (for `enemyScale`), its natural pixel size on screen and its shadow width at that size. */
  art?: { spriteKey: string; naturalScale: number; shadow: number };
}

/** The fixed simulation step: 60 ticks a second. */
const STEP_MS = 1000 / 60;
/** At most this many catch-up ticks in one frame, then drop the backlog (a stalled tab must not replay minutes). */
const MAX_CATCH_UP = 5;

/** The pieces of the backdrop, kept so a moved horizon can reposition them. */
interface BackdropLayers {
  wall: Phaser.GameObjects.Image;
  /** One pixel row of the wall's top, stretched to fill the gap when the horizon is lower than the baked one. */
  wallTop: Phaser.GameObjects.Image;
  floor: Phaser.GameObjects.Image;
  /** One pixel row of the floor's bottom, stretched to fill the gap when the horizon is higher than the baked one. */
  floorBottom: Phaser.GameObjects.Image;
  front: Phaser.GameObjects.Image | null;
}

export class StageScene extends Phaser.Scene {
  /** The party and the enemies, party first. Public so tools can reach them. */
  readonly fighters: Fighter[] = [];
  /** Frames simulated so far (60 a second of game time). */
  frame = 0;
  /** Whether the pointer can pick fighters up (set with `setEditMode`). */
  editMode = false;
  /** Whether the per-row depth tints are showing: Phaser's `setTint` is WebGL-only, so on the canvas renderer they are not. */
  rowTintsApplied = false;

  private init0!: StageInit;
  private stage!: StageConfig;
  private backdrop!: BackdropTextures;
  private layers: BackdropLayers | null = null;
  private guide: Phaser.GameObjects.Graphics | null = null;
  private anchors: Record<string, FootAnchor> = {};
  private lineup: string[] = [];
  private enemyKeys: string[] = [];
  private acc = 0;

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

  /** Phaser calls this first, with whatever was passed to `scene.add(..., data)`. */
  init(data: StageInit): void {
    // A restarted scene is the same object again: forget the last run's objects (Phaser has destroyed their sprites).
    this.fighters.length = 0;
    this.layers = null;
    this.guide = null;
    this.frame = 0;
    this.acc = 0;
    this.init0 = data;
    this.stage = stageOf(data.stages, data.stageId);
  }

  /** Queue the downloads; Phaser holds `create` until they have all arrived. */
  preload(): void {
    // (The loader drops its listeners when the scene shuts down, so a restart does not stack them.)
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.init0.onError(`A file did not load: ${file.url as string} (is the spritefusion-tests link in place?)`);
    });
    // Every crew member we have a description for, so the party can be reordered without loading anything new.
    if (!this.init0.standIns) queueCrewSheets(this.load, this.textures, this.init0.metas, Object.keys(this.init0.metas));
  }

  create(): void {
    try {
      this.build();
    } catch (e) {
      // A failure here would otherwise leave a black canvas and one line in the console.
      this.init0.onError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  private build(): void {
    if (this.init0.standIns) addStandInSheets(this.textures, this.init0.metas);
    this.anchors = registerCrew(this.textures, this.anims, this.init0.metas, Object.keys(this.init0.metas));
    this.rowTintsApplied = this.game.renderer.type === Phaser.WEBGL;

    this.buildBackdrop();
    this.guide = this.add.graphics().setDepth(GUIDE_DEPTH).setVisible(this.editMode);
    this.drawGuide();
    this.setParty(this.stage.lineup);
    this.setEnemies(this.init0.enemies ?? this.stage.fight);

    // Edit mode: one scene-wide listener hears every drag (it is only fired for objects made draggable).
    this.input.on('drag', (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number) => {
      const f = this.fighters.find((x) => x.sprite === obj);
      if (f) this.place(f, snapSlot(this.stage, f.side, dragX, dragY));
    });
    this.setEditMode(this.editMode);
  }

  // ---------------------------------------------------------------- backdrop

  /** (Re)make the backdrop pictures for `stage.backdrop`, positioned for `stage.horizon`. */
  private buildBackdrop(): void {
    if (this.layers) {
      for (const o of [this.layers.wall, this.layers.wallTop, this.layers.floor, this.layers.floorBottom, this.layers.front]) o?.destroy();
    }
    this.backdrop = addBackdrop(this.textures, this.stage.backdrop);
    const b = this.backdrop.back;
    this.layers = {
      // The wall hangs from the horizon line (origin = its bottom-left) and the floor starts on it (origin = its top-left).
      wall: this.add.image(0, 0, b, 'wall').setOrigin(0, 1).setDepth(BACKDROP_DEPTH),
      wallTop: this.add.image(0, 0, b, 'wallTop').setOrigin(0, 0).setDepth(BACKDROP_DEPTH),
      floor: this.add.image(0, 0, b, 'floor').setOrigin(0, 0).setDepth(BACKDROP_DEPTH),
      floorBottom: this.add.image(0, 0, b, 'floorBottom').setOrigin(0, 0).setDepth(BACKDROP_DEPTH),
      // Rails and cables in the corners, in front of everyone.
      front: this.backdrop.front ? this.add.image(0, 0, this.backdrop.front).setOrigin(0, 0).setDepth(FOREGROUND_DEPTH) : null,
    };
    this.layoutBackdrop();
  }

  /**
   * Put the wall and floor where `stage.horizon` says. The baked picture has its wall/floor line at
   * `artHorizon`; moving the horizon slides the wall and floor with it and stretches the picture's top or
   * bottom pixel row over whatever gap that opens, so dragging the horizon always leaves a complete
   * backdrop. (Whole pixels only: the strips are scaled by whole numbers.)
   */
  private layoutBackdrop(): void {
    const l = this.layers;
    if (!l) return;
    const h = this.stage.horizon;
    const art = this.backdrop.artHorizon;
    l.wall.setPosition(0, h);
    l.floor.setPosition(0, h);
    const topGap = Math.max(0, h - art);
    l.wallTop.setVisible(topGap > 0).setPosition(0, 0).setDisplaySize(SCREEN_W, Math.max(1, topGap));
    const bottomGap = Math.max(0, art - h);
    l.floorBottom.setVisible(bottomGap > 0).setPosition(0, SCREEN_H - bottomGap).setDisplaySize(SCREEN_W, Math.max(1, bottomGap));
  }

  /** The edit-mode guide: the horizon, the floor band and the depth rows as thin lines (hidden outside edit mode). */
  private drawGuide(): void {
    const g = this.guide;
    if (!g) return;
    const { horizon, floor, rows } = this.stage;
    g.clear();
    const line = (y: number, colour: number, alpha: number): void => {
      g.fillStyle(colour, alpha).fillRect(0, y, SCREEN_W, 1);
    };
    for (const r of rows) line(r.y, 0xffffff, 0.18);
    line(floor.top, 0xffd35a, 0.7);
    line(floor.bottom - 1, 0xffd35a, 0.7);
    line(horizon, 0x5ae8ff, 0.85);
  }

  // ---------------------------------------------------------------- fighters

  /** Replace the party with these crew ids, one per party slot, back to front. */
  setParty(ids: readonly string[]): void {
    this.removeSide('party');
    this.lineup = [...ids];
    ids.forEach((id, i) => {
      const slot = this.stage.party[i];
      const meta = this.init0.metas[id];
      const anchor = this.anchors[id];
      if (!slot || !meta || !anchor) throw new Error(`No slot, sheet or feet for ${id}`);
      // Start the loops on different frames so the four do not bounce in unison.
      const sheet: SheetPlay = { fps: meta.fps, count: meta.frame_count, phase: (i * 3) % meta.frame_count };
      // Origin = the feet as a fraction of the picture, so the sprite's position is where they stand.
      const sprite = this.add.sprite(0, 0, sheetKey(id), idleFrame(this.frame, sheet.fps, sheet.count, sheet.phase)).setOrigin(anchor.x / meta.frame_w, anchor.y / meta.frame_h);
      const f = this.makeFighter(id, 'party', sprite, slot, 'still', i);
      f.sheet = sheet;
      this.place(f, slot);
    });
  }

  /** Replace the enemies with these (keys of `ENEMIES`, 1 to 4), standing in the slot set for that many. */
  setEnemies(keys: readonly string[]): void {
    this.removeSide('enemy');
    this.enemyKeys = [...keys];
    const slots = enemySlots(this.stage, keys.length);
    const copies = new Map<string, number>();
    keys.forEach((key, i) => {
      const def = ENEMIES[key];
      const slot = slots[i];
      if (!def || !slot) throw new Error(`Unknown enemy "${key}" or no slot for it`);
      // A second punk is a different individual, not the same sprite twice.
      const copy = copies.get(def.sprite) ?? 0;
      copies.set(def.sprite, copy + 1);
      const tex = addEnemy(this.textures, def.sprite, copy, this.backdrop);
      // Origin bottom-centre: the art is drawn with its feet on the canvas's bottom edge. Rounded to a whole pixel
      // column (an 85-pixel-wide picture has its middle at 42.5, half a pixel off the grid) so the sprite never sits between pixels.
      const sprite = this.add.sprite(0, 0, tex.key).setOrigin(Math.round(tex.width / 2) / tex.width, 1);
      const f = this.makeFighter(`${key}#${i}`, 'enemy', sprite, slot, tex.idle, i);
      f.art = { spriteKey: def.sprite, naturalScale: tex.naturalScale, shadow: tex.shadow };
      this.place(f, slot);
    });
  }

  /** Destroy one side's fighters (sprites and shadows) so a replacement does not leave stray objects behind. */
  private removeSide(side: Fighter['side']): void {
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const f = this.fighters[i];
      if (f?.side !== side) continue;
      f.sprite.destroy();
      f.shadow.destroy();
      this.fighters.splice(i, 1);
    }
  }

  private makeFighter(id: string, side: Fighter['side'], sprite: Phaser.GameObjects.Sprite, slot: Slot, idle: IdleKind, uid: number): Fighter {
    const shadow = this.add.image(0, 0, addShadow(this.textures, 8, 3));
    // A tag an edit mode can read back from whatever the pointer picks (`setData`/`getData` hang small values on any game object).
    sprite.setData('fighterId', id);
    const f: Fighter = { id, side, sprite, shadow, slot, idle, uid, baseX: 0, baseY: 0 };
    // Party first in the list, then enemies: keep that order whichever side is rebuilt.
    if (side === 'party') this.fighters.splice(this.fighters.filter((x) => x.side === 'party').length, 0, f);
    else this.fighters.push(f);
    if (this.editMode) this.grabbable(f, true);
    return f;
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

  /**
   * Re-lay everything out from a changed stage config: the call an editor makes after changing it.
   * Rebuilds only what a change needs: a new backdrop (its enemy pictures are washed with its light, so they
   * are remade too), a new party order, another set of enemies; otherwise everything just moves.
   */
  applyStage(stage: StageConfig): void {
    const before = this.stage;
    this.stage = stage;
    if (stage.backdrop !== before.backdrop) {
      this.buildBackdrop();
      this.setEnemies(this.enemyKeys);
    } else this.layoutBackdrop();
    if (stage.lineup.join() !== this.lineup.join()) this.setParty(stage.lineup);
    // Slots changed? Move everyone to the config's slots (a different head-count is `setEnemies`' job).
    const enemySet = enemySlots(stage, this.enemyKeys.length);
    let p = 0;
    let e = 0;
    for (const f of this.fighters) this.place(f, (f.side === 'party' ? stage.party[p++] : enemySet[e++]) ?? f.slot);
    this.drawGuide();
  }

  /** The stage config as it stands now, with the fighters' current slots written back (what a Save would store). */
  currentStage(): StageConfig {
    const out = JSON.parse(JSON.stringify(this.stage)) as StageConfig;
    out.party = this.fighters.filter((f) => f.side === 'party').map((f) => ({ ...f.slot }));
    out.enemies[String(this.enemyKeys.length)] = this.fighters.filter((f) => f.side === 'enemy').map((f) => ({ ...f.slot }));
    return out;
  }

  /** Put one fighter in a slot: position, depth, row tint, size and shadow all follow from the config. */
  place(f: Fighter, slot: Slot): void {
    f.slot = slot;
    // `slotPoint` keeps the feet inside the floor band, so nothing stands on the wall or off the bottom of the screen.
    const p = slotPoint(this.stage, slot);
    f.baseX = p.x;
    f.baseY = p.y;
    f.sprite.setPosition(p.x, p.y).setDepth(depthFor(p.y, p.x));
    // Row tint is a multiply tint, which Phaser only draws in WebGL (`rowTintsApplied` says whether it does here).
    const tint = rowTint(this.stage, slot.row);
    if (tint === 0xffffff) f.sprite.clearTint();
    else f.sprite.setTint(tint);

    // An enemy's size comes from the stage: `enemyScale` screen pixels per art pixel, else the art's own.
    let shadowWidth = this.stage.shadow.width;
    if (f.art) {
      const scale = enemyScaleFor(this.stage, f.art.spriteKey, f.art.naturalScale);
      f.sprite.setScale(scale);
      // The art's shadow was sized for its natural scale; keep it in proportion if the sprite is drawn bigger or smaller.
      shadowWidth = enemyShadowWidth(this.stage, (f.art.shadow * scale) / f.art.naturalScale);
    }
    // The shadow sits just beneath its own fighter in the draw order, so a nearer fighter covers it.
    if (shadowWidth <= 0) f.shadow.setVisible(false);
    else {
      const h = Math.max(2, Math.round(shadowWidth * this.stage.shadow.ratio));
      f.shadow
        .setTexture(addShadow(this.textures, shadowWidth, h))
        .setVisible(true)
        .setPosition(p.x, p.y)
        .setAlpha(this.stage.shadow.alpha)
        .setDepth(depthFor(p.y, p.x) - 0.5);
    }
    this.releaseShadows();
  }

  /** Drop the shadow textures no fighter shows any more (a size slider would otherwise leave one behind per step). */
  private releaseShadows(): void {
    pruneShadows(this.textures, new Set(this.fighters.map((f) => f.shadow.texture.key)));
  }

  // ---------------------------------------------------------------- time

  /** Phaser calls this every screen refresh; the accumulator turns that into a steady 60 ticks a second. */
  override update(_time: number, delta: number): void {
    this.acc += Math.min(delta, 250);
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
    for (const f of this.fighters) {
      if (f.sheet) f.sprite.setFrame(idleFrame(this.frame, f.sheet.fps, f.sheet.count, f.sheet.phase));
      else {
        const o = enemyIdle(f.idle, this.frame, f.uid);
        f.sprite.setPosition(f.baseX + o.x, f.baseY + o.y);
      }
    }
  }
}
