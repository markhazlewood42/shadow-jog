/**
 * The battle stage as a scene of the Shadow Jog Engine (step B1 of the engine-platform spike): the Phaser spike's
 * `StageScene` run through the translation table (docs/engine/migration.md section 6). The FINAL stage design drawn from a stage
 * config: the painted 3/4 floor, the heroes on the left and the enemies on the right, each standing on a depth row with a contact
 * shadow and drawn in the right overlap order. The HUD is off in this slice, and so are the move animations and the edit mode (M3).
 *
 * If you have not met a scene before, the ideas this file uses (the engine follows Phaser's, see docs/engine/README.md):
 *
 *  - A **Scene** is one screen of the game. The engine calls `create` once (build the objects) and `fixedUpdate(tick)` 60 times a
 *    second. The scene owns what it created: when it closes, its display list is destroyed.
 *  - A **Sprite** is a picture on the stage with a position, a depth, an origin and a current frame. The **origin** is the point of
 *    the picture that sits at the sprite's x,y: ours is the feet, so "x,y" means "where this figure stands".
 *  - **Depth** is a number; the engine draws from the smallest to the largest. We use the feet's y (`depthFor` in config.ts), so
 *    whoever stands nearer the viewer draws on top.
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
 */
import { type Container, DEPTH, must, Scene } from '../sje';
import { MEMBERS } from '../data/party';
import { ENEMIES } from '../data/enemies';
import type { MemberId } from '../game/state';
import { type AxesFile, axisFor, enemySlots, type StageConfig, type StageFile, stageOf } from './config';
import { type FacingFile, figureFor, isMirrored } from './facing';
import { Figure, type FigureSpec, type SheetPlay, type Side } from './figure';
import { idleFrame } from './idle';
import type { HeroesFile } from './proportions';
import { addEnemy, bakeStage, type CrewInfo, type EnemyTexture, type FigureArt, type SheetMeta, pruneTextures, PREFIX, registerCrew } from './textures';

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
}

/** The stage's own default group of enemies. */
const DEFAULT_SET = '3';

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
  private setKey: string;

  constructor(private readonly init0: BattleStageInit) {
    super();
    this.stage = stageOf(init0.stages, init0.stageId);
    this.setKey = init0.setKey ?? DEFAULT_SET;
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
    const init = this.init0;
    const lineup = init.lineup ?? this.stage.demo.lineup;
    this.crew = registerCrew(this.textures, init.metas, lineup, init.standIns, init.heroes ?? {});
    // The wall and the floor, baked into one 480x270 picture (floor.ts): the backdrop band of the depth table.
    const picture = bakeStage(this.textures, this.stage);
    this.add.image(0, 0, picture.key).setOrigin(0, 0).setDepth(DEPTH.BACKDROP);
    this.makeParty(lineup);
    this.makeEnemies(init.enemies ?? this.stage.demo.rosters[this.setKey] ?? [], this.setKey);
    this.refresh();
    // The engine destroys the display list when the scene closes; forget the figures (they are gone) so nothing reads a dead object.
    this.events.once('shutdown', () => {
      this.figures.length = 0;
    });
  }

  /** One step of game time (1/60 s). Everything that moves is chosen from the tick counter here. (Deviation E2: Phaser's variable `update(time, delta)` is gone, see the header.) */
  fixedUpdate(): void {
    this.frame++;
    this.worldFrame++;
    for (const f of this.figures) f.tick(this.worldFrame);
  }

  // ---------------------------------------------------------------- building

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

  /**
   * Apply the marks (who has a ring) and restyle everyone, then drop the shadow and ring pictures nobody shows any more (they are made
   * on demand from numbers, and a stage that changes size would otherwise leave one behind each time).
   */
  refresh(): void {
    const init = this.init0;
    for (const f of this.figures) {
      f.active = false;
      f.target = false;
    }
    const hero = init.active === undefined ? undefined : this.side('party')[init.active];
    if (hero) hero.active = true;
    const aimed = init.target === undefined ? undefined : this.side('enemy')[init.target];
    if (aimed) aimed.target = true;
    this.restyleAll();
    pruneTextures(this.textures, PREFIX.shadow, new Set(this.figures.flatMap((f) => f.partTextures())));
    pruneTextures(this.textures, PREFIX.ring, new Set(this.figures.flatMap((f) => f.partTextures())));
  }

  /** Restyle every figure from its state. */
  private restyleAll(): void {
    for (const f of this.figures) f.restyle({ stage: this.stage, textures: this.textures, worldFrame: this.worldFrame });
  }

  /** The sorting group of one figure, by id (what a test reads to see how the parts draw). */
  figureGroup(id: string): Container {
    return must(this.figures.find((f) => f.id === id), `figure "${id}"`).container;
  }
}
