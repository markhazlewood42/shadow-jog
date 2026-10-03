/**
 * The battle stage as a Phaser Scene (spike `spike/phaser-stage`, step 1): the backdrop, Mark's four
 * heroes on the left and the enemies on the right, each standing on a depth row with a contact shadow and
 * drawn in the right overlap order. No HUD and no battle yet; those are later steps.
 *
 * If you have not met Phaser before, the ideas this file uses:
 *
 *  - A **Scene** is one screen of the game with a life cycle Phaser calls for us: `init` (receive data),
 *    `preload` (queue files to download), `create` (build the objects once everything has arrived) and
 *    `update` (every frame). The *Scene* owns what it created; Phaser frees it when the scene shuts down.
 *  - A **Sprite** is a picture on the stage with a position, a depth, an origin and (for a sprite) a
 *    playing animation. The **origin** is the point of the picture that sits at the sprite's x,y: ours is
 *    the feet, so "x,y" means "where this fighter stands".
 *  - **Depth** is a number; Phaser draws objects from the smallest depth to the largest. We use the feet's
 *    y (see `depthFor` in config.ts), so whoever stands nearer the viewer draws on top.
 *  - **Everything about the layout is read from the stage config** (`src/data/stages.json`), never written
 *    into this file. Each fighter is a small record (`Fighter`) that remembers its slot, so an edit mode can
 *    later grab one, change its slot and call `place` again; `applyStage` re-lays the whole stage out after
 *    the config changes.
 *  - **update() and the fixed step.** Phaser calls `update` once per screen refresh, and screens refresh
 *    at 60, 75, 120 or 144 Hz. Battle logic must not run faster on a faster screen, so `update` adds the
 *    time since the last call to an accumulator and runs `tick()` once for every 1/60 s it holds. The
 *    battle engine counts frames (it replays as animation at 60 a second), and this is how it will be fed.
 */
import Phaser from 'phaser';
import { ENEMIES } from '../data/enemies';
import { depthFor, enemySlots, rowTint, slotPoint, type Slot, type StageConfig, type StageFile, stageOf } from './config';
import type { FootAnchor } from './feet';
import { enemyIdle, type IdleKind } from './idle';
import { addBackdrop, addEnemy, addShadow, addStandInSheets, CREW_LINEUP, idleKey, queueCrewSheets, registerCrew, sheetKey, type BackdropTextures, type SheetMeta } from './textures';

/** What the lab hands the scene when it starts it. */
export interface StageInit {
  stages: StageFile;
  stageId: string;
  /** Each crew member's sheet description (fetched before the game started). */
  metas: Record<string, SheetMeta>;
  /** True when Mark's sheets were not there and `metas` describe code-drawn stand-ins (nothing to load). */
  standIns: boolean;
  /** The enemies of the fight, as keys of `ENEMIES` (1 to 4 of them). */
  enemies: string[];
  /** Called with a readable message if something fails; the lab shows it on the page. */
  onError: (message: string) => void;
}

/** Layers other than the fighters themselves (which use `depthFor`, 150000 and up). */
const BACKDROP_DEPTH = -1;
const FOREGROUND_DEPTH = 1_000_000;

/** One standing figure on the stage: the picture, its shadow, and the slot it was given. */
export interface Fighter {
  id: string;
  side: 'party' | 'enemy';
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  slot: Slot;
  /** Shadow width in screen pixels. */
  shadowWidth: number;
  idle: IdleKind;
  /** Keeps two of a kind out of step in their idle motion. */
  uid: number;
  /** Where the feet are (the slot's point); idle motion is added on top. */
  baseX: number;
  baseY: number;
}

/** The fixed simulation step: 60 ticks a second. */
const STEP_MS = 1000 / 60;
/** At most this many catch-up ticks in one frame, then drop the backlog (a stalled tab must not replay minutes). */
const MAX_CATCH_UP = 5;

export class StageScene extends Phaser.Scene {
  /** The party and the enemies, in slot order. Public so tools can reach them. */
  readonly fighters: Fighter[] = [];
  /** Frames simulated so far (60 a second of game time). */
  frame = 0;

  private init0!: StageInit;
  private stage!: StageConfig;
  private backdrop!: BackdropTextures;
  private anchors: Record<string, FootAnchor> = {};
  private acc = 0;

  constructor() {
    super('stage');
  }

  /** Phaser calls this first, with whatever was passed to `scene.add(..., data)`. */
  init(data: StageInit): void {
    // A restarted scene is the same object again: forget the last run's fighters (Phaser has destroyed their sprites).
    this.fighters.length = 0;
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
    if (!this.init0.standIns) queueCrewSheets(this.load, this.textures, this.init0.metas);
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
    const { stage } = this;
    if (this.init0.standIns) addStandInSheets(this.textures, this.init0.metas);
    this.anchors = registerCrew(this.textures, this.anims, this.init0.metas);
    this.backdrop = addBackdrop(this.textures, stage.backdrop);

    this.add.image(0, 0, this.backdrop.back).setOrigin(0, 0).setDepth(BACKDROP_DEPTH);
    // Rails and cables in the corners, in front of everyone.
    if (this.backdrop.front) this.add.image(0, 0, this.backdrop.front).setOrigin(0, 0).setDepth(FOREGROUND_DEPTH);

    // The party: back to front, one slot each.
    CREW_LINEUP.forEach((member, i) => {
      const slot = stage.party[i];
      const meta = this.init0.metas[member.id];
      const anchor = this.anchors[member.id];
      if (!slot || !meta || !anchor) throw new Error(`No slot, sheet or feet for ${member.id}`);
      // Origin = the feet as a fraction of the picture, so the sprite's position is where they stand.
      const sprite = this.add.sprite(0, 0, sheetKey(member.id)).setOrigin(anchor.x / meta.frame_w, anchor.y / meta.frame_h);
      // Start the loops on different frames so the four do not bounce in unison.
      sprite.play({ key: idleKey(member.id), startFrame: (i * 3) % meta.frame_count });
      this.fighters.push(this.makeFighter(member.id, 'party', sprite, slot, stage.shadow.width, 'still', i));
    });

    // The enemies, in the slot set for how many there are.
    const slots = enemySlots(stage, this.init0.enemies.length);
    const copies = new Map<string, number>();
    this.init0.enemies.forEach((key, i) => {
      const def = ENEMIES[key];
      const slot = slots[i];
      if (!def || !slot) throw new Error(`Unknown enemy "${key}" or no slot for it`);
      // A second punk is a different individual, not the same sprite twice.
      const copy = copies.get(def.sprite) ?? 0;
      copies.set(def.sprite, copy + 1);
      const tex = addEnemy(this.textures, def.sprite, copy, this.backdrop);
      // Origin bottom-centre: the art is drawn with its feet on the canvas's bottom edge.
      const sprite = this.add.sprite(0, 0, tex.key).setOrigin(0.5, 1).setScale(tex.displayScale);
      this.fighters.push(this.makeFighter(`${key}#${i}`, 'enemy', sprite, slot, tex.shadow, tex.idle, i));
    });

    this.applyStage(stage);
  }

  private makeFighter(id: string, side: Fighter['side'], sprite: Phaser.GameObjects.Sprite, slot: Slot, shadowWidth: number, idle: IdleKind, uid: number): Fighter {
    const shadow = this.add.image(0, 0, addShadow(this.textures, 8, 3));
    // A tag an edit mode can read back from whatever the pointer picks (`setData`/`getData` hang small values on any game object).
    sprite.setData('fighterId', id);
    return { id, side, sprite, shadow, slot, shadowWidth, idle, uid, baseX: 0, baseY: 0 };
  }

  /** (Re)lay everything out from a stage config: the call an editor makes after changing it. */
  applyStage(stage: StageConfig): void {
    this.stage = stage;
    for (const f of this.fighters) this.place(f, f.slot);
  }

  /** Put one fighter in a slot: position, depth, row tint and shadow all follow from the config. */
  place(f: Fighter, slot: Slot): void {
    f.slot = slot;
    const p = slotPoint(this.stage, slot);
    f.baseX = p.x;
    f.baseY = p.y;
    f.sprite.setPosition(p.x, p.y).setDepth(depthFor(p.y, p.x));
    const tint = rowTint(this.stage, slot.row);
    if (tint === 0xffffff) f.sprite.clearTint();
    else f.sprite.setTint(tint);
    // The shadow sits just beneath its own fighter in the draw order, so a nearer fighter covers it.
    const w = f.side === 'party' ? this.stage.shadow.width : f.shadowWidth;
    if (w <= 0) {
      f.shadow.setVisible(false);
      return;
    }
    const h = Math.max(2, Math.round(w * this.stage.shadow.ratio));
    f.shadow
      .setTexture(addShadow(this.textures, w, h))
      .setVisible(true)
      .setPosition(p.x, p.y)
      .setAlpha(this.stage.shadow.alpha)
      .setDepth(depthFor(p.y, p.x) - 0.5);
  }

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

  /** One step of game time (1/60 s). Today it only moves the enemies' idle sway; the battle replay will run here. */
  private tick(): void {
    this.frame++;
    for (const f of this.fighters) {
      if (f.side !== 'enemy') continue;
      const o = enemyIdle(f.idle, this.frame, f.uid);
      f.sprite.setPosition(f.baseX + o.x, f.baseY + o.y);
    }
  }
}
