/**
 * The stage as the Battle Stage Editor holds it (ET task 5): the game's own `BattleStageScene` of the Shadow Jog Engine with the HUD on it, behind the small set of calls the
 * editor's other files make. In the Phaser spike the editor talked to `StageScene` (`fighters`, `boxOf`, `pick`, `applyStage`, `setAxes`...). That class is gone, so this file is
 * the whole translation, and it is the ONLY place the editor reaches into the scene:
 *
 *   spike `StageScene`                       here
 *   --------------------------------------   ----------------------------------------------------------------------------------------
 *   `applyStage(stage)` (hot reload)         `StageHost.setStage`  -> `BattleStageScene.loadStage` (checked first; bad data keeps the old stage)
 *   `fighters`                               `fighters`            = the scene's `figures` (`Figure`)
 *   `boxOf(f)`                               `boxOf`               -> `BattleStageScene.geoOf`
 *   `pick(x, y)` (Phaser alpha lookup)       `pick`                -> `Figure.describe()` + `TextureManager.readPixels` (the editor's own; nothing was added to the engine)
 *   `setPhase` and the drawn HUD             `EditorScene`         owns a `Hud` and rebuilds it from `buildHudView` after every change
 *   `setAxes`, `setFacing`, `setHeroes`      `StageHost.setData`   they are fields of `BattleStageInit`, so a change makes a NEW scene on the same stage (a scene runs once)
 *   `figureBoxesFor`, `heroSize`             the same names here, worked out from the figures and the baked crew sheets
 *   undo (the editor's own `Session`)        `snapshot` / `restore` of the scene keep the frame and the figures' state across a rebuild
 *
 * Nothing here draws a copy of the stage: every change goes into the scene the game's battle uses, so what the editor shows is what the game shows.
 */
import { type AxesFile, axisFor, enemySlots, type FigureBox, slotPoint, type StageConfig } from '../../battlestage/config';
import { buildHudView, type HudView, type Phase } from '../../battlestage/demo';
import { type FacingFile, figureFor, isMirrored } from '../../battlestage/facing';
import type { Figure } from '../../battlestage/figure';
import { type FigureGeo, Hud, type HudFaces } from '../../battlestage/hud';
import type { HeroesFile } from '../../battlestage/proportions';
import { boxOf } from '../../battlestage/sfgeom';
import { type BattleStageInit, BattleStageScene, setKeyFor } from '../../battlestage/stagescene';
import { AS_DRAWN, addEnemy, bakeCrew, type FigureArt, faceTexture, type SheetMeta, stagePictureKey } from '../../battlestage/textures';
import { ENEMIES } from '../../data/enemies';
import { type Game, must } from '../../sje';

/** How strongly a pixel must show to be picked: the same threshold the spike used (alpha above 8 of 255). */
const PICK_ALPHA = 8;

/** The scene the editor runs: the stage scene plus the HUD of the moment on show. */
export class EditorScene extends BattleStageScene {
  /** Which moment of the example turn the HUD shows. */
  phase: Phase = 'choose';
  private hud: Hud | null = null;
  private view: HudView | null = null;
  /** The marks (rings) the current moment asks for; `setMarks` runs only when they change, so `refresh` never loops. */
  private marked = '';

  override create(): void {
    super.create();
    this.hud = new Hud(this, this.faces(), 'hud');
    this.events.once('shutdown', () => {
      this.hud = null;
    });
    this.drawHud();
  }

  override fixedUpdate(): void {
    super.fixedUpdate();
    // The low-health blink follows the stage clock.
    this.hud?.tick(this.worldFrame);
  }

  /** Every change of the stage ends in a `refresh`, so the HUD is rebuilt there. */
  override refresh(): void {
    super.refresh();
    this.drawHud();
  }

  /** The HUD that is drawn now (the specs read its boxes: `box('commands')` is the container of that region, absent when it is hidden). */
  get hudNow(): Hud | null {
    return this.hud;
  }

  /** What the HUD shows now: the moment, who acts, the banner (the specs read it). */
  get viewNow(): HudView | null {
    return this.view;
  }

  /** The HUD for the stage as it is, for this moment: the same `buildHudView` the lab uses, over the enemies standing now. */
  private drawHud(): void {
    const hud = this.hud;
    if (!hud) return;
    const roster = [...this.enemies];
    const view = buildHudView(this.config.demo, setKeyFor(roster, this.config), this.phase, roster);
    // The rings follow the moment: who is choosing, and who is aimed at. `setMarks` calls `refresh`, which comes back here with the marks unchanged.
    const marks = `${view.active}|${view.target ?? ''}`;
    if (marks !== this.marked) {
      this.marked = marks;
      this.setMarks(view.active, view.target ?? undefined);
      return;
    }
    this.view = view;
    this.pose(view);
    hud.render(this.config, view, this.geo());
  }

  /**
   * The figures for this moment of the example turn, as the spike's editor showed them: every figure at home, an enemy's health bar on the stage (the letter A, B of a twin),
   * and in the Act moment the attacker standing at the target's feet row with its weapon in reach, borrowing the target's sort row plus a pixel so its body draws over the
   * target's, and the target flashing and knocked back 3 px (its shadow stays). The spike also drew the effects picture of the cut and a dotted ring at the attacker's home:
   * the engine's stage has neither (the live battle's effects are the game's painters; `src/battlestage/live.ts`), so they are not here.
   */
  private pose(view: HudView): void {
    const party = this.figures.filter((f) => f.side === 'party');
    const foes = this.figures.filter((f) => f.side === 'enemy');
    for (const f of this.figures) {
      f.x = f.baseX;
      f.y = f.baseY;
      f.sortY = f.baseY;
      f.bodyDx = 0;
      f.flash = 0;
    }
    foes.forEach((f, i) => {
      const v = view.foes[i];
      f.bar = v ? { ratio: v.maxHp > 0 ? v.hp / v.maxHp : 0, tag: v.tag } : null;
    });
    const hero = party[view.active];
    const aimed = view.target === null ? undefined : foes[view.target];
    if (view.phase === 'act' && view.act && hero && aimed) {
      const targetLeft = aimed.baseX + (aimed.fig.box.x0 - aimed.fig.foot.x);
      const heroRight = hero.fig.box.x1 + 1 - hero.fig.foot.x;
      hero.x = targetLeft - heroRight + this.config.demo.act.reach + 4;
      hero.y = aimed.baseY;
      hero.sortY = aimed.baseY + this.config.sort.lungeOverTarget;
      aimed.flash = 1;
      aimed.bodyDx = 3;
    }
    this.restyle();
  }

  private geo(): { party: FigureGeo[]; foes: FigureGeo[] } {
    return { party: this.figures.filter((f) => f.side === 'party').map((f) => this.geoOf(f)), foes: this.figures.filter((f) => f.side === 'enemy').map((f) => this.geoOf(f)) };
  }

  /** Face pictures for the HUD's chips, cut from the figures on the stage (as the live battle does). */
  private faces(): HudFaces {
    const of = (side: 'party' | 'enemy', index: number): Figure => must(this.figures.filter((f) => f.side === side)[index], `a ${side} figure ${index} to cut a face from`);
    const cut = (f: Figure, size: number): string => faceTexture(this.textures, `${f.id}${f.mirror ? '-m' : ''}`, f.fig, size);
    return { party: (i, size) => cut(of('party', i), size), foe: (i, size) => cut(of('enemy', i), size) };
  }
}

/** The data a scene is made from besides the stage: the three files that are fields of `BattleStageInit`. */
export interface HostData {
  axes: AxesFile;
  facing: FacingFile;
  heroes: HeroesFile;
}

/** What the editor needs of the crew's pictures (they are already in the game's texture manager). */
export interface HostArt {
  metas: Record<string, SheetMeta>;
  standIns: boolean;
}

/** One alpha raster of a picture, kept for picking. */
interface Alpha {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/**
 * The editor's handle on the running stage. The scene can be replaced (when the axes, the facing or the heroes change), so the rest of the editor holds THIS object, which always
 * answers for the scene that is running now.
 */
export class StageHost {
  private current: EditorScene;
  private data: HostData;
  private readonly alpha = new Map<string, Alpha>();

  private constructor(
    private readonly game: Game,
    private readonly art: HostArt,
    scene: EditorScene,
    data: HostData,
  ) {
    this.current = scene;
    this.data = data;
  }

  /**
   * Run a scene for this stage. `lineup`, `enemies` and `setKey` choose who stands in it. The scene is up (built, drawn on the next frame) when this resolves.
   */
  static start(game: Game, art: HostArt, data: HostData, stage: StageConfig, enemies: readonly string[], phase: Phase): StageHost {
    const scene = StageHost.sceneFor(art, data, stage, enemies, phase);
    void game.run(scene);
    return new StageHost(game, art, scene, data);
  }

  private static sceneFor(art: HostArt, data: HostData, stage: StageConfig, enemies: readonly string[], phase: Phase): EditorScene {
    const init: BattleStageInit = {
      stages: { [stage.id]: stage },
      stageId: stage.id,
      metas: art.metas,
      standIns: art.standIns,
      lineup: stage.demo.lineup,
      setKey: setKeyFor(enemies, stage),
      enemies: [...enemies],
      axes: data.axes,
      facing: data.facing,
      heroes: data.heroes,
    };
    const scene = new EditorScene(init);
    scene.phase = phase;
    return scene;
  }

  /** The scene that is running (a spec reads it through the test hook). */
  get scene(): EditorScene {
    return this.current;
  }

  // ---------------------------------------------------------------- what the editor reads

  /** The figures, party first (the spike's `fighters`). */
  get fighters(): Figure[] {
    return this.current.figures;
  }

  /** The enemy keys on stage now, in slot order. */
  get enemies(): readonly string[] {
    return this.current.enemies;
  }

  /** The stage config in use. */
  get config(): StageConfig {
    return this.current.config;
  }

  /** The moment of the example turn on show. */
  get phase(): Phase {
    return this.current.phase;
  }

  /** What the HUD shows now: the moment, who acts, the banner. */
  get viewNow(): HudView | null {
    return this.current.viewNow;
  }

  /** The key of the baked picture of the stage on show (it changes when the floor or the wall is repainted). */
  get pictureKey(): string {
    return stagePictureKey(this.current.config);
  }

  /** The HUD that is drawn now: `box(name)` is the container of a region, `objects` everything it has. */
  get hudObjects(): Hud | null {
    return this.current.hudNow;
  }

  /** Where one figure is on the screen now: its feet and the edges of its drawn pixels. */
  boxOf(f: Figure): FigureGeo {
    return this.current.geoOf(f);
  }

  /**
   * The figure under a point of the screen (game pixels), or null. It looks at the drawn pixels, so the empty corner of a sprite's cell is not a hit, and when two
   * figures overlap the one drawn on top (nearer) wins. Built from `Figure.describe()` (where the body is, which picture and frame, how it is flipped) and
   * `TextureManager.readPixels` (the picture's alpha): the engine has no pick of its own and needs none.
   */
  pick(x: number, y: number): Figure | null {
    const parts = this.fighters.map((f) => ({ f, d: f.describe() }));
    parts.sort((a, b) => b.d.depth - a.d.depth);
    for (const { f, d } of parts) {
      const b = d.body;
      const a = this.alphaOf(b.texture, b.frame);
      const px = Math.floor(x - (d.x + b.x) + b.originX * a.w);
      const py = Math.floor(y - (d.y + b.y) + b.originY * a.h);
      if (px < 0 || py < 0 || px >= a.w || py >= a.h) continue;
      // A mirrored picture is drawn reversed, so the pixel under the pointer is the one on the other side of the picture.
      const col = b.flipX ? a.w - 1 - px : px;
      if ((a.data[(py * a.w + col) * 4 + 3] ?? 0) > PICK_ALPHA) return f;
    }
    return null;
  }

  /** The pixels of one frame of a picture, read back once and kept (the hazed pictures change with the stage, so the cache is cleared when it grows). */
  private alphaOf(texture: string, frame: string | number | undefined): Alpha {
    const name = `${texture}|${frame ?? ''}`;
    const have = this.alpha.get(name);
    if (have) return have;
    if (this.alpha.size > 96) this.alpha.clear();
    const raw = this.game.textures.readPixels(texture, frame);
    this.alpha.set(name, raw);
    return raw;
  }

  /** How big a hero's figure is in the art as drawn and on the stage now (frame 0's drawn bounds, in pixels), or null for someone who is not on this stage. */
  heroSize(id: string): { drawn: { w: number; h: number }; now: { w: number; h: number } } | null {
    const meta = this.art.metas[id];
    if (!meta || !this.fighters.some((f) => f.id === id)) return null;
    const info = bakeCrew(this.game.textures, id, meta, this.data.heroes[id] ?? AS_DRAWN, this.art.standIns);
    const first = info.drawn.frames[0];
    if (!first) return null;
    const size = (b: { x0: number; x1: number; y0: number; y1: number }): { w: number; h: number } => ({ w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 });
    return { drawn: size(boxOf(first)), now: size(info.fig.box) };
  }

  /** The boxes of the figures on stage now (the same numbers `figureBoxesFor` gives for the group on show). */
  figureBoxes(): FigureBox[] {
    return this.fighters.map((f) => {
      const g = this.boxOf(f);
      return { x: g.x, y: g.y, top: g.top, left: g.left, right: g.right, boss: g.boss, side: f.side };
    });
  }

  /** The proportions in use. */
  get heroes(): HeroesFile {
    return this.data.heroes;
  }

  /**
   * The figures' sizes as they WOULD be for any stage and enemy group, without changing what is shown: the heroes of this scene's crew in the stage's party slots, and these
   * enemies in that group's slots. The editor uses it to check the design's rules for every enemy count at once, not only the one on screen.
   */
  figureBoxesFor(stage: StageConfig, setKey: string, roster: readonly string[]): FigureBox[] {
    const out: FigureBox[] = [];
    const box = (fig: Pick<FigureArt, 'box' | 'foot'>, boss: boolean, side: FigureBox['side'], slot: Parameters<typeof slotPoint>[1]): FigureBox => {
      const p = slotPoint(stage, slot);
      const b = fig.box;
      return { x: p.x, y: p.y, top: p.y + 1 - (fig.foot.y - b.y0), left: p.x + (b.x0 - fig.foot.x), right: p.x + (b.x1 + 1 - fig.foot.x), boss, side };
    };
    const crew = this.fighters.filter((f) => f.side === 'party');
    stage.party.forEach((slot, i) => {
      const f = crew[i];
      if (f) out.push(box(f.fig, false, 'party', slot));
    });
    const slots = enemySlots(stage, setKey);
    const copies = new Map<string, number>();
    roster.forEach((key, i) => {
      const def = ENEMIES[key];
      const slot = slots[i];
      if (!def || !slot) return;
      // The same numbering the scene uses: a second punk is the second copy of the sprite.
      const copy = copies.get(def.sprite) ?? 0;
      copies.set(def.sprite, copy + 1);
      const tex = addEnemy(this.game.textures, def.sprite, copy);
      const art = figureFor(tex.fig, isMirrored(this.data.facing, def.sprite));
      const shift = axisFor(this.data.axes, def.sprite);
      out.push(box({ box: art.box, foot: { x: art.foot.x + shift.x, y: art.foot.y + shift.y } }, slot.size === 'boss' || !!def.boss, 'enemy', slot));
    });
    return out;
  }

  // ---------------------------------------------------------------- what the editor changes

  /** Hot reload: swap this stage into the running scene (the hot reload of the editor contract). Bad data throws one readable message and the old stage stays. */
  setStage(stage: StageConfig): void {
    this.current.loadStage(stage);
  }

  /** Stand these enemies in the slots of the group their number calls for. A no-op when they already stand there. */
  setEnemies(roster: readonly string[]): void {
    if (roster.join() === this.current.enemies.join()) return;
    this.current.setEnemies(roster);
  }

  /** Show another moment of the example turn. */
  setPhase(phase: Phase): void {
    if (phase === this.current.phase) return;
    this.current.phase = phase;
    this.current.refresh();
  }

  /**
   * New axes, facing or heroes. These are fields of the scene's `BattleStageInit`, which the scene reads when it builds, so a change makes a new scene on the same stage (a scene
   * runs once). The new scene keeps the frame and the state of the old one (`snapshot` and `restore`), so the idle motion does not jump. Returns true when a scene was made.
   */
  setData(next: HostData): boolean {
    const same = JSON.stringify(next.axes) === JSON.stringify(this.data.axes) && JSON.stringify(next.facing) === JSON.stringify(this.data.facing) && JSON.stringify(next.heroes) === JSON.stringify(this.data.heroes);
    if (same) return false;
    const old = this.current;
    const state = old.snapshot();
    const phase = old.phase;
    this.data = next;
    const fresh = StageHost.sceneFor(this.art, next, old.config, old.enemies, phase);
    old.close();
    void this.game.run(fresh);
    this.current = fresh;
    // The same frame and the same figures' state (a lunge, a fade), on the new data.
    fresh.restore({ ...state, stage: fresh.config });
    return true;
  }

  /** Close the scene (the editor page is going away, or a test is done with it). */
  close(): void {
    this.current.close();
  }
}

