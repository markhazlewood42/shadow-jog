/**
 * The battle stage as a scene of the Shadow Jog Engine: the Phaser spike's `StageScene` run through the translation table (docs/engine/migration.md
 * section 6), built in the engine-platform spike (step B1) and promoted to the shipped `BattleStageScene` in M3 (task 4). The FINAL stage design drawn
 * from a stage config: the painted 3/4 floor, the heroes on the left and the enemies on the right, each standing on a depth row with a contact shadow and
 * drawn in the right overlap order, plus the push camera, the editor contract (`loadStage`, `snapshot`, `restore`) and the marks (`setMarks`).
 * The HUD, the move animations and the effects are added by the next tasks of M3 (5 to 7); the Battle Stage Editor is milestone ET.
 *
 * If you have not met a scene before, the ideas this file uses (the engine follows Phaser's, see docs/engine/README.md):
 *
 *  - A **Scene** is one screen of the game. The engine calls `create` once (build the objects) and `fixedUpdate(tick)` 60 times a
 *    second. The scene owns what it created: when it closes, its display list is destroyed.
 *  - A **Sprite** is a picture on the stage with a position, a depth, an origin and a current frame. The **origin** is the point of
 *    the picture that sits at the sprite's x,y: ours is the feet, so "x,y" means "where this figure stands".
 *  - **Depth** is a number; the engine draws from the smallest to the largest. We use the feet's y (`depthFor` in config.ts, which calls the engine's),
 *    so whoever stands nearer the viewer draws on top.
 *  - **A figure is a unit** (`Figure`): one container, with the body, the shadow and the ring inside it as a sorting group.
 *  - **Everything about the layout is read from the stage config** (`src/data/stages.json`), never written into this file.
 *  - **The fixed step.** The engine's loop calls `fixedUpdate` once per 1/60 s of game time, however fast the screen refreshes. The
 *    spike's scene kept its own accumulator for this (`update(_t, delta)` with `STEP_MS` and `MAX_CATCH_UP`): that is deleted, the
 *    engine's `FixedLoop` does it for every scene. Everything that moves is driven from the tick: the enemies' idle sway AND the
 *    heroes' sheet frames (`idleFrame`), not an animation clock. Same tick number, same picture, every run.
 *
 * Two things differ from the spike on purpose:
 *  - A scene object runs once (the engine refuses a closed scene), so a "restart" is a new `BattleStageScene` with the same
 *    `BattleStageInit`. Textures live in the game's `TextureManager`, shared by every scene, and are found again by name, so a
 *    restart does no work beyond making new objects (and leaks nothing: the lab's test counts GL objects).
 *  - The assets are loaded BEFORE the scene runs (`loadStageAssets` in boot.ts), because `create` is never async. The spike loaded
 *    them in `preload`.
 *
 * The editor contract (principle 11; docs/engine/m3-brief.md section 5). No Pixi object leaves the scene: a caller gets plain data (`snapshot`, `figures`'
 * `describe`) and the `Figure` wrappers. A stage swapped in by `loadStage` is checked first with the rules of the file (`checkStageConfig`), and bad data
 * leaves the old stage as it was. `snapshot()` is plain JSON and `restore(snapshot())` gives the same frame. What stays in code on purpose, because it is
 * the form and not the tuning: the depth formula, the flip rule, the contact-shadow shape.
 */
import { BG_IDS } from '../art/battlebg480';
import { ENEMIES } from '../data/enemies';
import { MEMBERS } from '../data/party';
import type { MemberId } from '../game/state';
import { type Container, DEPTH, type ImageObject, must, Scene } from '../sje';
import { type AxesFile, axisFor, checkStageConfig, enemySlots, SCREEN_H, SCREEN_W, type StageConfig, type StageFile, stageOf } from './config';
import { type FacingFile, figureFor, isMirrored } from './facing';
import { Figure, type FigureSpec, type SheetPlay, type Side } from './figure';
import { idleFrame } from './idle';
import { STAGE_KNOWN } from './known';
import type { HeroesFile } from './proportions';
import type { FigureGeo } from './hud';
import { LEGACY_PUSH, type PushSpec, pushView, pushZoom } from './push';
import { addEnemy, bakeStage, type CrewInfo, type EnemyTexture, type FigureArt, PREFIX, pruneTextures, registerCrew, type SheetMeta } from './textures';

/** What the lab hands the scene when it starts it. */
export interface BattleStageInit {
  stages: StageFile;
  stageId: string;
  /** Each crew member's sheet description (the sheets themselves are already in the texture manager). */
  metas: Record<string, SheetMeta>;
  /** True when Mark's sheets were not there and `metas` describe code-drawn stand-ins. */
  standIns: boolean;
  /** Which crew stand in the party slots, in order. Default: the stage's own lineup (`demo.lineup`). */
  lineup?: readonly string[];
  /** Which enemy group (a key of `enemySets`: "1" to "6", "boss", "boss+1", "boss+2"). Default "3". */
  setKey?: string;
  /** The enemies, keys of `ENEMIES`, in the slots of the group. Default: the stage's own roster for the group. */
  enemies?: readonly string[];
  /** The party member that has the ring under it (the acting hero), and the enemy that has the ring (the target), as indexes. None by default. */
  active?: number;
  target?: number;
  /** Foot-anchor corrections per sprite (`src/data/axes.json`); none when absent. */
  axes?: AxesFile;
  /** Which enemy sprites the stage mirrors so they face the heroes (`src/data/enemyfacing.json`); none are mirrored when absent. */
  facing?: FacingFile;
  /** How tall and how broad each hero stands (`src/data/heroes.json`); every hero as drawn when absent. */
  heroes?: HeroesFile;
  /** The push camera's numbers (zoom, ramp, length). Default: the legacy battle's, `LEGACY_PUSH`. */
  push?: PushSpec;
}

/** The stage's own default group of enemies. */
const DEFAULT_SET = '3';

/** What a snapshot keeps of one figure: the state that the battle changes and the scene does not rebuild from the stage (a lunge, a knock-back, a fade). */
export interface FigureState {
  id: string;
  x: number;
  y: number;
  sortY: number;
  bodyDx: number;
  offX: number;
  offY: number;
  alpha: number;
}

/**
 * The whole state of a running stage as plain JSON (`JSON.parse(JSON.stringify(s))` equals `s`). `restore` builds the same frame from it. It holds the
 * stage config in use, because `loadStage` can change it while the scene runs.
 */
export interface StageSnapshot {
  version: 1;
  stage: StageConfig;
  setKey: string;
  lineup: string[];
  enemies: string[];
  /** The marks: the index of the hero with the ring and of the enemy with the ring, or null. */
  active: number | null;
  target: number | null;
  frame: number;
  worldFrame: number;
  /** The push camera: where it leans and how many frames in, or null at rest. */
  push: { x: number; y: number; t: number } | null;
  figures: FigureState[];
}

export class BattleStageScene extends Scene<void> {
  /** The party and the enemies, party first. Public so tools and tests can reach them. */
  readonly figures: Figure[] = [];
  /** Ticks simulated so far (60 a second of game time). It counts from this scene's own start. */
  frame = 0;
  /** Ticks of WORLD time: it will stop during a hitstop (M3); `frame` keeps counting real ticks. */
  worldFrame = 0;

  private stage: StageConfig;
  private crew: Record<string, CrewInfo> = {};
  private enemyKeys: string[] = [];
  private lineup: string[] = [];
  private setKey: string;
  private active: number | undefined;
  private target: number | undefined;
  private backdrop: ImageObject | null = null;
  private leaning: { x: number; y: number; t: number } | null = null;
  /** The screen shake: how far the stage is moved this frame (the HUD is not: it is in the `ui` layer). */
  private shakeX = 0;
  private shakeY = 0;
  private readonly pushSpec: PushSpec;

  constructor(private readonly init0: BattleStageInit) {
    super();
    this.stage = stageOf(init0.stages, init0.stageId);
    this.setKey = init0.setKey ?? DEFAULT_SET;
    this.active = init0.active;
    this.target = init0.target;
    this.pushSpec = init0.push ?? LEGACY_PUSH;
  }

  /** The stage config in use. */
  get config(): StageConfig {
    return this.stage;
  }

  /** The enemy keys on stage right now, in slot order. */
  get enemies(): readonly string[] {
    return this.enemyKeys;
  }

  override create(): void {
    this.lineup = [...(this.init0.lineup ?? this.stage.demo.lineup)];
    this.build(this.init0.enemies ?? this.stage.demo.rosters[this.setKey] ?? []);
    // The engine destroys the display list when the scene closes; forget the figures (they are gone) so nothing reads a dead object.
    this.events.once('shutdown', () => {
      this.figures.length = 0;
      this.backdrop = null;
    });
  }

  /** One step of game time (1/60 s). Everything that moves is chosen from the tick counter here. (Deviation E2: Phaser's variable `update(time, delta)` is gone, see the header.) */
  fixedUpdate(): void {
    this.frame++;
    this.worldFrame++;
    for (const f of this.figures) f.tick(this.worldFrame);
    if (this.leaning) {
      this.leaning.t++;
      if (this.leaning.t >= this.pushSpec.lifeFrames) this.leaning = null;
      this.applyPush();
    }
  }

  // ---------------------------------------------------------------- building

  /** Make everything the stage shows from the current config, lineup and marks: the picture, the party and the enemies (in the slots of the current group). */
  private build(enemies: readonly string[]): void {
    const init = this.init0;
    this.crew = registerCrew(this.textures, init.metas, this.lineup, init.standIns, init.heroes ?? {});
    // The wall and the floor, baked into one 480x270 picture (floor.ts): the backdrop band of the depth table.
    const picture = bakeStage(this.textures, this.stage);
    this.backdrop = this.add.image(0, 0, picture.key).setOrigin(0, 0).setDepth(DEPTH.BACKDROP);
    this.makeParty(this.lineup);
    this.makeEnemies(enemies, this.setKey);
    this.refresh();
  }

  /** Destroy what `build` made (the figures and the picture's object; the textures stay in the texture manager and are found again by name). */
  private clearStage(): void {
    for (const f of this.figures) f.destroy();
    this.figures.length = 0;
    this.backdrop?.destroy();
    this.backdrop = null;
  }

  /** Build the heroes from the lineup, in the party slots. */
  private makeParty(lineup: readonly string[]): void {
    lineup.forEach((id, i) => {
      const slot = this.stage.party[i];
      const meta = this.init0.metas[id];
      const info = this.crew[id];
      if (!slot || !meta || !info) throw new Error(`No slot, sheet or feet for ${id}`);
      // Start the loops on different frames so the heroes do not bounce in unison.
      const sheet: SheetPlay = { fps: meta.fps, count: meta.frame_count, phase: (i * 3) % meta.frame_count };
      this.addFigure({
        id,
        side: 'party',
        name: MEMBERS[id as MemberId]?.name ?? id,
        boss: false,
        slot,
        baseTex: info.texture,
        fig: info.fig,
        art: info.fig,
        mirror: false,
        idle: 'still',
        uid: i,
        cellW: info.frameW,
        cellH: info.frameH,
        axisKey: id,
        sheet,
      });
    });
  }

  /** Build the enemies from these keys of `ENEMIES`, in the slots of group `setKey`. */
  private makeEnemies(keys: readonly string[], setKey: string): void {
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
      const art = this.enemyArt(def.sprite, copy);
      this.addFigure({
        id: `${key}#${i}`,
        side: 'enemy',
        name: def.name,
        boss: slot.size === 'boss' || !!def.boss,
        slot,
        baseTex: art.tex.key,
        fig: art.fig,
        art: art.tex.fig,
        mirror: art.mirror,
        idle: art.tex.idle,
        uid: i,
        cellW: art.tex.width,
        cellH: art.tex.height,
        axisKey: def.sprite,
      });
    });
  }

  /**
   * An enemy sprite's picture and measurements as the stage draws it. The facing file (`enemyfacing.json`) says whether this
   * sprite is mirrored to face the heroes: then the figure is the MIRROR IMAGE of the measured art (feet, edges, face and pixels
   * reversed about the feet, `mirrorFigure`), so every reader of `fig` sees the picture that is on the screen. The picture itself
   * is not copied: the sprite is flipped (`setFlipX`).
   */
  private enemyArt(sprite: string, copy: number): { tex: EnemyTexture; mirror: boolean; fig: FigureArt } {
    const tex = addEnemy(this.textures, sprite, copy);
    const mirror = isMirrored(this.init0.facing ?? {}, sprite);
    return { tex, mirror, fig: figureFor(tex.fig, mirror) };
  }

  private addFigure(spec: FigureSpec): Figure {
    // A hero starts on the frame of tick 0; an enemy is one picture.
    const first = spec.sheet ? idleFrame(this.worldFrame, spec.sheet.fps, spec.sheet.count, spec.sheet.phase) : undefined;
    const f = new Figure(this, spec, this.stage, first);
    f.applyAxis(axisFor(this.init0.axes ?? {}, f.axisKey));
    f.place(this.stage, spec.slot);
    // Party first in the list, then enemies: keep that order whichever side is built.
    this.figures.push(f);
    return f;
  }

  /** The figures of one side, in slot order. */
  side(side: Side): Figure[] {
    return this.figures.filter((f) => f.side === side);
  }

  // ---------------------------------------------------------------- the state of the figures

  /** Who has a ring: the acting hero and the target, as indexes into the party and the enemies (none when absent). Restyles at once. */
  setMarks(active?: number, target?: number): void {
    this.active = active;
    this.target = target;
    this.refresh();
  }

  /**
   * Apply the marks (who has a ring) and restyle everyone, then drop the shadow and ring pictures nobody shows any more (they are made
   * on demand from numbers, and a stage that changes size would otherwise leave one behind each time).
   */
  refresh(): void {
    for (const f of this.figures) {
      f.active = false;
      f.target = false;
    }
    const hero = this.active === undefined ? undefined : this.side('party')[this.active];
    if (hero) hero.active = true;
    const aimed = this.target === undefined ? undefined : this.side('enemy')[this.target];
    if (aimed) aimed.target = true;
    this.restyleAll();
    // A restyle puts every body at rest; the idle sway of this tick is laid back on, so a figure never shows a frame of rest between two ticks. At tick 0 too: the
    // Phaser references show the sway of tick 0 (a hovering eel is already off its feet).
    for (const f of this.figures) f.tick(this.worldFrame);
    pruneTextures(this.textures, PREFIX.shadow, new Set(this.figures.flatMap((f) => f.partTextures())));
    pruneTextures(this.textures, PREFIX.ring, new Set(this.figures.flatMap((f) => f.partTextures())));
  }

  /**
   * Restyle every figure from its state, and lay this tick's idle motion back on. A live battle sets the figures' state every tick (the display state of the battle) and calls this;
   * `refresh` does the same and also changes the marks and removes pictures nobody shows any more, which is more than a tick needs.
   */
  restyle(): void {
    this.restyleAll();
    for (const f of this.figures) f.tick(this.worldFrame);
  }

  /** Restyle every figure from its state. */
  private restyleAll(): void {
    for (const f of this.figures) f.restyle({ stage: this.stage, textures: this.textures, worldFrame: this.worldFrame });
  }

  /** The sorting group of one figure, by id (what a test reads to see how the parts draw). */
  figureGroup(id: string): Container {
    return must(this.figures.find((f) => f.id === id), `figure "${id}"`).container;
  }

  // ---------------------------------------------------------------- the push camera

  /**
   * The camera leans in toward `focus` (screen pixels of the stage) for `pushSpec.lifeFrames` ticks and eases back (decision 3: up to 1.09x, kept as it was).
   * It scales the scene's world layer, which holds the picture and every figure. A push that is already running starts again.
   */
  push(focus: { x: number; y: number }): void {
    this.leaning = { x: focus.x, y: focus.y, t: 0 };
    this.applyPush();
  }

  /** Move the stage by this much this frame (a screen shake, in screen pixels; the sign is the direction the picture moves). Zero puts it back. */
  setShake(dx: number, dy: number): void {
    if (dx === this.shakeX && dy === this.shakeY) return;
    this.shakeX = dx;
    this.shakeY = dy;
    this.applyPush();
  }

  /** Is the camera leaning now? */
  get pushing(): boolean {
    return this.leaning !== null;
  }

  /**
   * Scale the world layer and move it with the camera, not with the layer's own position: the draw phase writes the layer's position from the camera's scroll every
   * frame (`Camera.apply`), so a position set here would be overwritten. The scroll is the window's corner times the zoom, rounded to whole pixels by the camera.
   */
  private applyPush(): void {
    const cam = this.cameras.main;
    if (!this.leaning) {
      this.sys.world.setScale(1);
      cam.setScroll(0 - this.shakeX, 0 - this.shakeY);
      return;
    }
    const view = pushView(this.leaning, pushZoom(this.leaning.t, this.pushSpec), SCREEN_W, SCREEN_H);
    this.sys.world.setScale(view.zoom);
    cam.setScroll(-view.offsetX - this.shakeX, -view.offsetY - this.shakeY);
  }

  /**
   * Replace the enemies on stage with these (keys of `ENEMIES`), in the slots of the group their number and kind call for ("1" to "6", "boss", "boss+1", "boss+2"). A
   * summon in a live battle does this: the group grows by the ones called in. A group the stage has no slots for throws and changes nothing.
   */
  setEnemies(keys: readonly string[]): void {
    const setKey = setKeyFor(keys, this.stage);
    for (const f of this.figures.filter((x) => x.side === 'enemy')) f.destroy();
    this.figures.splice(0, this.figures.length, ...this.figures.filter((x) => x.side === 'party'));
    this.makeEnemies(keys, setKey);
    this.refresh();
  }

  /** Where a figure is on the screen now: its feet and the edges of its drawn pixels (its knock-back included), for the labels placed relative to it. */
  geoOf(f: Figure): FigureGeo {
    const b = f.fig.box;
    const dx = f.bodyDx + f.offX;
    return { x: f.x, y: f.y, top: f.y + 1 + f.offY - (f.fig.foot.y - b.y0), left: f.x + dx + (b.x0 - f.fig.foot.x), right: f.x + dx + (b.x1 + 1 - f.fig.foot.x), boss: f.boss };
  }

  // ---------------------------------------------------------------- the editor contract (section 5 of docs/engine/m3-brief.md)

  /**
   * Swap another stage config into the running scene: the picture and every figure are rebuilt for it, standing in the same lineup and group. The config is checked
   * first, with the rules of the stage file (`checkStageConfig`); a config the file would refuse throws one readable message and the scene keeps the stage it had.
   */
  loadStage(next: StageConfig): void {
    const problems = checkStageConfig(next, BG_IDS, STAGE_KNOWN);
    if (problems.length > 0) throw new Error(`The stage "${next.id}" is not valid, so the scene keeps "${this.stage.id}":\n - ${problems.join('\n - ')}`);
    const enemies = [...this.enemyKeys];
    this.clearStage();
    this.stage = next;
    this.build(enemies);
  }

  /** The whole state as plain JSON. `restore` on this scene, or on another one made from the same `BattleStageInit`, shows the same frame. */
  snapshot(): StageSnapshot {
    return JSON.parse(
      JSON.stringify({
        version: 1,
        stage: this.stage,
        setKey: this.setKey,
        lineup: this.lineup,
        enemies: this.enemyKeys,
        active: this.active ?? null,
        target: this.target ?? null,
        frame: this.frame,
        worldFrame: this.worldFrame,
        push: this.leaning ? { x: this.leaning.x, y: this.leaning.y, t: this.leaning.t } : null,
        figures: this.figures.map((f) => ({ id: f.id, x: f.x, y: f.y, sortY: f.sortY, bodyDx: f.bodyDx, offX: f.offX, offY: f.offY, alpha: f.alpha })),
      } satisfies StageSnapshot),
    ) as StageSnapshot;
  }

  /** Build the state of a snapshot. The stage in it is checked like a `loadStage` stage; bad data throws and changes nothing. */
  restore(s: StageSnapshot): void {
    if (s.version !== 1) throw new Error(`Cannot restore a stage snapshot of version ${String(s.version)} (this is version 1)`);
    const problems = checkStageConfig(s.stage, BG_IDS, STAGE_KNOWN);
    if (problems.length > 0) throw new Error(`The snapshot's stage "${s.stage.id}" is not valid, so the scene keeps "${this.stage.id}":\n - ${problems.join('\n - ')}`);
    // The roster must fit the stage before anything is torn down, so a bad snapshot cannot leave half a stage.
    if (s.lineup.length > s.stage.party.length) throw new Error(`The snapshot has ${s.lineup.length} heroes but the stage has ${s.stage.party.length} party slots`);
    const unknown = s.enemies.find((key) => !ENEMIES[key]);
    if (unknown !== undefined) throw new Error(`The snapshot has an enemy "${unknown}" that is not in the game`);
    if (enemySlots(s.stage, s.setKey).length !== s.enemies.length) throw new Error(`The set "${s.setKey}" of the stage has ${enemySlots(s.stage, s.setKey).length} slots but the snapshot has ${s.enemies.length} enemies`);
    this.clearStage();
    this.stage = s.stage;
    this.setKey = s.setKey;
    this.lineup = [...s.lineup];
    this.active = s.active ?? undefined;
    this.target = s.target ?? undefined;
    this.frame = s.frame;
    this.worldFrame = s.worldFrame;
    this.build(s.enemies);
    for (const saved of s.figures) {
      const f = this.figures.find((x) => x.id === saved.id);
      if (!f) throw new Error(`The snapshot has a figure "${saved.id}" that the stage does not`);
      f.x = saved.x;
      f.y = saved.y;
      f.sortY = saved.sortY;
      f.bodyDx = saved.bodyDx;
      f.offX = saved.offX;
      f.offY = saved.offY;
      f.alpha = saved.alpha;
    }
    this.leaning = s.push ? { ...s.push } : null;
    this.applyPush();
    // The styles of the restored state, with the idle motion of this tick.
    this.refresh();
  }
}

/**
 * The enemy group a list of keys stands in: "boss" when the first is a boss and it is alone, "boss+N" with N helpers, else the number ("1" to "6"). Throws when the stage has no
 * slots for it.
 */
export function setKeyFor(keys: readonly string[], stage: StageConfig): string {
  const first = keys[0] ? ENEMIES[keys[0]] : undefined;
  const key = first?.boss ? (keys.length === 1 ? 'boss' : `boss+${keys.length - 1}`) : String(keys.length);
  if (enemySlots(stage, key).length !== keys.length) throw new Error(`The stage "${stage.id}" has no enemy group "${key}" for ${keys.length} enemies`);
  return key;
}
