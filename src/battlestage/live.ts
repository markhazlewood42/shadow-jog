/**
 * The stage that draws the SHIPPED battle (M3 task 6; docs/engine/m3-brief.md sections 1 and 4). A `BattleStageScene` (the backdrop, the floor, the figures, the push camera)
 * that also holds the HUD, the floating numbers, the effects layer and the defeat wash, and follows the battle scene (`scenes/battle.ts`) tick by tick.
 *
 * HOW IT FITS. Under `?engine=sje` the battle's routing (`game/systems.ts` `runBattle`) asks the registered provider (`liveopen.ts`) for a stage, which is run FIRST, so it sits
 * under the battle scene on the scene stack. The battle scene keeps state and flow, and plays the engine's events through `PlaybackView` as it always did (`battlekit/playback.ts`
 * is unchanged); this scene READS the battle scene (`host`) in its own `fixedUpdate` and `prerender`, as the old renderer did, and shows it:
 *
 *   per `Disp` of the battle (the display state of each fighter)    ->  a `Figure` (alpha, hop, lunge, shake, flash, the on-stage bar)
 *   `scene.fx` (`FxLayer`, the Canvas 2D painters, unchanged)       ->  a `CanvasImage` of the world's size, scaled to the stage, drawn each frame
 *   `scene.floaters`                                                ->  `LiveNumbers` (images, the same motion rule)
 *   `scene.banner` (the small one), the party, the foes, the order   ->  the `Hud` (a view from `liveview.ts`)
 *   `scene.push`, `game.shakeX/Y`, `scene.defeatT`                  ->  the push camera, the camera's shake, the wash over the stage
 *
 * The battle scene sits above this one and draws only the old UI (menus, panels, cut-ins, the intro) on a clear canvas, and passes updates down (`passUpdate`), so this scene's
 * `fixedUpdate` runs after the battle's own. Positions the battle needs (`pos`, `headPos`, `footX`) are answered here, converted to WORLD pixels (the numbers the battle and `FxLayer` use);
 * the stage works in its own screen pixels, `k` of them per world pixel, and that division is the only conversion.
 *
 * What is NOT here (named, not hidden): the move animations of the spike (the strikes and casts of a hero's sheet: a hero keeps its idle loop through a move and shows the hit as a
 * red blink, a lunge and the effects), the hero poses (hurt, victory), the enemies' attack and cast motions, the impact frame's white cut-out, the Warden's conduits.
 */
import { BHT, BW } from '../art/worldsize';
import type { Pt } from '../battle/fx';
import type { BattleScene } from '../scenes/battle';
import type { BattleStage } from '../scenes/battlekit/stageseam';
import { type CanvasImage, drawText, type Graphics, must } from '../sje';
import { SCREEN_H, SCREEN_W } from './config';
import { Hud, type HudFaces, type HudGeo } from './hud';
import { liveView, viewSignature } from './liveview';
import { LiveNumbers } from './livenumbers';
import { FX_DEPTH, HERO_HIT_TINT, HIT_FLASH, DOWN_ALPHA, WASH, WASH_DEPTH } from './liveparams';
import { BattleStageScene, type BattleStageInit } from './stagescene';
import { faceTexture } from './textures';
import type { Figure } from './figure';
import type { HudView } from './demo';

/** Screen pixels of the stage per world pixel of the battle (the stage's width over the world's). Today 1.5 (the 480-wide layout); 2 when the stage is laid out at 640x360 (task 9). */
export const STAGE_PER_WORLD = SCREEN_W / BW;

/** Glyph effects (spell runes, numbers) are drawn with the game's font, no shadow, as the old picture did. */
const glyph = (c: CanvasRenderingContext2D, ch: string, x: number, y: number, col: string): void => void drawText(c, ch, x, y, { color: col, shadow: false });

/** The current stage, for the DEV hook and the tests (null when no battle is on). */
let current: LiveStageScene | null = null;
export function liveStage(): LiveStageScene | null {
  return current;
}

/** What `describe` returns. */
export interface LiveDescription {
  stageId: string;
  frame: number;
  worldFrame: number;
  k: number;
  figures: Array<{ id: string; side: string; x: number; y: number; depth: number; alpha: number; flash: number; tint: number; down: boolean; ring: string | null; bar: { ratio: number; tag: string } | null; offX: number; offY: number; bodyDx: number }>;
  order: string[];
  camera: { zoom: number; x: number; y: number };
  hud: { builds: number; phase: string | null; banner: string | null; active: number | null; target: number | null; regions: number };
  numbers: number;
  wash: number;
  fxDrawn: boolean;
}

export class LiveStageScene extends BattleStageScene implements BattleStage {
  /** The scale from world pixels to stage pixels. */
  readonly k: number;
  private hud: Hud | null = null;
  private numbers: LiveNumbers | null = null;
  private fxImage: CanvasImage | null = null;
  private wash: Graphics | null = null;
  private washAlpha = -1;
  private partyFigs: Figure[] = [];
  private enemyFigs: Figure[] = [];
  private shownKeys: string[] = [];
  private signature = '';
  private lastPush: unknown = null;
  private marks = '';
  private fxShown = false;
  /** The view the HUD shows now (for the hook and the tests). */
  view: HudView | null = null;
  /** How many times the HUD was rebuilt (a rebuild is the costly part: a test holds it far under one per tick). */
  hudBuilds = 0;
  private closing = false;

  constructor(
    init: BattleStageInit,
    private readonly host: BattleScene,
    k = STAGE_PER_WORLD,
  ) {
    super(init);
    this.k = k;
  }

  override create(): void {
    super.create();
    current = this;
    this.cacheFigures();
    // The effects: a world-sized canvas, drawn with the old painters, shown scaled up by the stage's ratio, in the world so it moves with the push and a shake.
    this.fxImage = this.add.canvasImage(0, 0, BW, BHT).setScale(this.k).setDepth(FX_DEPTH);
    this.wash = this.add.graphics();
    this.wash.setDepth(WASH_DEPTH);
    this.sys.ui.add(this.wash);
    this.hud = new Hud(this, this.faces(), 'game');
    this.numbers = new LiveNumbers(this, this.k);
    this.events.on('prerender', this.draw, this);
    this.events.once('shutdown', () => {
      if (current === this) current = null;
      this.hud = null;
      this.numbers = null;
      this.fxImage = null;
      this.wash = null;
      this.partyFigs = [];
      this.enemyFigs = [];
    });
    this.follow(true);
  }

  override fixedUpdate(): void {
    // A heavy hit freezes the battle: the stage holds its idle motion too (the world's own clock stops, the real one counts).
    if (this.host.frozen) {
      this.frame++;
      return;
    }
    super.fixedUpdate();
    this.follow(false);
    this.hud?.tick(this.worldFrame);
  }

  // ---------------------------------------------------------------- following the battle

  private cacheFigures(): void {
    this.partyFigs = this.side('party');
    this.enemyFigs = this.side('enemy');
    this.shownKeys = this.enemies.slice();
  }

  /** The people on stage match the battle's roster: a summon adds enemies, a phase change swaps one. */
  private matchRoster(): void {
    const foes = this.host.battle.enemies;
    let same = foes.length === this.shownKeys.length;
    for (let i = 0; same && i < foes.length; i++) if (foes[i]?.key !== this.shownKeys[i]) same = false;
    if (same) return;
    try {
      this.setEnemies(foes.map((e) => e.key));
    } catch (e) {
      // The stage has no slots for this many (a group bigger than its largest set): keep the figures it has, and say so once.
      console.warn(`[battle stage] ${e instanceof Error ? e.message : String(e)}`);
      this.shownKeys = foes.map((x) => x.key);
      return;
    }
    this.cacheFigures();
  }

  /**
   * Bring the stage in line with the battle for this tick: who is where and how they look (from the display state `Disp`), the camera (push and shake), the marks (who has
   * a ring), and the HUD when anything it shows changed.
   */
  private follow(first: boolean): void {
    const h = this.host;
    const k = this.k;
    this.matchRoster();
    const party = h.battle.party;
    const foes = h.battle.enemies;
    // The figures, one by one, from the display state.
    for (let i = 0; i < this.partyFigs.length; i++) {
      const f = this.partyFigs[i];
      const u = party[i];
      if (!f || !u) continue;
      const d = h.d(u.uid);
      const blink = d.flash > 0 && d.flash % 4 < 2;
      f.down = d.hp <= 0 && u.hp <= 0;
      f.alpha = f.down ? DOWN_ALPHA : d.alpha;
      f.tint = blink ? HERO_HIT_TINT : 0;
      f.flash = 0;
      f.bodyDx = d.shake > 0 ? (d.shake % 4 < 2 ? 2 : -2) * k : 0;
      f.offX = Math.round(d.lunge * k);
      f.offY = -Math.round(d.hop * k);
    }
    for (let i = 0; i < this.enemyFigs.length; i++) {
      const f = this.enemyFigs[i];
      const u = foes[i];
      if (!f || !u) continue;
      const d = h.d(u.uid);
      const blink = d.flash > 0 && d.flash % 4 < 2;
      f.alpha = d.alpha;
      f.flash = blink ? HIT_FLASH : 0;
      f.bodyDx = d.shake > 0 ? (d.shake % 4 < 2 ? 2 : -2) * k : 0;
      f.offX = -Math.round(d.lunge * k);
      f.offY = 0;
      const dead = d.dying > 0 || u.hp <= 0;
      f.bar = dead ? null : { ratio: Math.max(0, d.shownHp / u.base.maxHp), tag: h.twins(u) ? String.fromCharCode(65 + h.dupIndex(u)) : '' };
    }
    // Who has a ring: the member giving orders and the foe or ally under the cursor, or (while a round plays) whoever acts.
    const marks = this.marksOf();
    if (marks !== this.marks) {
      this.marks = marks;
      const [a, t] = marks.split(',').map((x) => (x === '' ? undefined : Number(x)));
      this.setMarks(a, t);
    } else this.restyle();
    // The camera: the old battle's push (a big hit) starts one here when the battle makes a new one; the shake is the game's.
    const push = h.push;
    if (push && push !== this.lastPush) this.push({ x: push.x * k, y: push.y * k });
    this.lastPush = push;
    this.setShake(Math.round(this.game.shakeX), Math.round(this.game.shakeY));
    // The HUD, when anything it shows changed.
    this.updateHud(first);
    this.numbers?.update(h.floaters);
  }

  /** Who has a ring, as text ("1,0": hero 1 and foe 0), so a change is a change of the text. */
  private marksOf(): string {
    const h = this.host;
    const b = h.battle;
    let active: number | undefined;
    let target: number | undefined;
    if (h.mode === 'command' || h.mode === 'list' || h.mode === 'target') {
      const a = h.actor;
      if (a) active = b.party.findIndex((p) => p.uid === a.uid);
    } else if (h.mode === 'play') {
      const first = (b.roundOrder[b.roundAt] ?? [])[0];
      const i = first === undefined ? -1 : b.party.findIndex((p) => p.uid === first);
      if (i >= 0) active = i;
    }
    if (h.mode === 'target') {
      const uid = h.targetList[h.targetIdx];
      const u = uid === undefined ? undefined : b.unit(uid);
      if (u?.side === 'enemy') target = b.enemies.findIndex((e) => e.uid === u.uid);
    }
    return `${active !== undefined && active >= 0 ? active : ''},${target !== undefined && target >= 0 ? target : ''}`;
  }

  private geo(): HudGeo {
    return { party: this.partyFigs.map((f) => this.geoOf(f)), foes: this.enemyFigs.map((f) => this.geoOf(f)) };
  }

  /** Rebuild the HUD's objects when the numbers they show changed (a bar moved, a turn began) or a fighter they are placed by moved. */
  private updateHud(first: boolean): void {
    const hud = this.hud;
    if (!hud) return;
    const view = liveView(this.host);
    const geo = this.geo();
    // The labels over the stage follow the figures, so where they stand is part of what changed.
    let sig = viewSignature(view);
    for (const g of geo.party) sig += `|${g.x},${g.top},${g.left},${g.right}`;
    for (const g of geo.foes) sig += `|${g.x},${g.top},${g.left},${g.right}`;
    if (!first && sig === this.signature) return;
    this.signature = sig;
    this.view = view;
    hud.render(this.config, view, geo);
    this.hudBuilds++;
  }

  // ---------------------------------------------------------------- the draw phase

  private draw(): void {
    const h = this.host;
    // The effects: the old painters, into the effects canvas, once per frame, while any is alive (and once more to clear it when the last is gone).
    const img = this.fxImage;
    if (img) {
      const ring = !!h.timing.prompt && h.timing.isOpen;
      if (h.fx.busy || ring || this.fxShown) {
        img.ctx.clearRect(0, 0, BW, BHT);
        h.fx.render(img.ctx, glyph);
        h.drawOverStage(img.ctx);
        img.refresh();
        this.fxShown = h.fx.busy || ring;
      }
    }
    // The defeat wash over the stage (the old picture drained the frame toward red-black).
    const w = this.wash;
    if (w) {
      const a = h.defeatT > 0 ? Math.min(WASH.max, h.defeatT / WASH.frames) : 0;
      if (a !== this.washAlpha) {
        this.washAlpha = a;
        w.clear();
        if (a > 0) w.fillStyle(WASH.color, a).fillRect(0, 0, SCREEN_W, SCREEN_H);
      }
    }
  }

  // ---------------------------------------------------------------- what the battle asks (world pixels)

  /** The figure of a fighter by the battle's uid. */
  figureOf(uid: number): Figure | undefined {
    const b = this.host.battle;
    const p = b.party.findIndex((u) => u.uid === uid);
    if (p >= 0) return this.partyFigs[p];
    const e = b.enemies.findIndex((u) => u.uid === uid);
    return e >= 0 ? this.enemyFigs[e] : undefined;
  }

  pos(uid: number): Pt {
    const f = this.figureOf(uid);
    if (!f) return { x: BW / 2, y: BHT / 2 };
    const b = f.fig.box;
    // The middle of the drawn pixels, from the feet.
    const cx = f.x + f.bodyDx + f.offX + ((b.x0 + b.x1 + 1) / 2 - f.fig.foot.x);
    const cy = f.y + 1 + f.offY - (f.fig.foot.y - (b.y0 + b.y1 + 1) / 2);
    return { x: cx / this.k, y: cy / this.k };
  }

  headPos(uid: number): Pt {
    const f = this.figureOf(uid);
    if (!f) return { x: BW / 2, y: BHT / 2 };
    const g = this.geoOf(f);
    return { x: (f.x + f.bodyDx + f.offX) / this.k, y: g.top / this.k + 4 };
  }

  footX(uid: number): number {
    const f = this.figureOf(uid);
    return f ? f.x / this.k : BW / 2;
  }

  /** Face pictures for the HUD's chips, cut from the figures on the stage. */
  private faces(): HudFaces {
    const of = (list: () => Figure[], index: number): Figure => must(list()[index], `a figure ${index} to cut a face from`);
    const cut = (f: Figure, size: number): string => faceTexture(this.textures, `${f.id}${f.mirror ? '-m' : ''}`, f.fig, size);
    return {
      party: (i, size) => cut(of(() => this.partyFigs, i), size),
      foe: (i, size) => cut(of(() => this.enemyFigs, i), size),
    };
  }

  /**
   * The stage as plain data, for the DEV hook and the tests (the editor contract, principle 11: no Pixi object leaves the scene): who stands where, in what draw order, the camera,
   * and what the HUD shows. The figures are in the order of the battle (party first), `order` is their ids from the back of the draw order to the front.
   */
  describe(): LiveDescription {
    const figures = this.figures.map((f) => {
      const p = f.describe();
      return { id: f.id, side: f.side, x: f.x, y: f.y, depth: p.depth, alpha: f.alpha, flash: f.flash, tint: f.tint, down: f.down, ring: f.active ? 'active' : f.target ? 'target' : null, bar: f.bar ? { ...f.bar } : null, offX: f.offX, offY: f.offY, bodyDx: f.bodyDx };
    });
    const world = this.sys.world;
    return {
      stageId: this.config.id,
      frame: this.frame,
      worldFrame: this.worldFrame,
      k: this.k,
      figures,
      order: [...figures].sort((a, b) => a.depth - b.depth).map((f) => f.id),
      camera: { zoom: world.scaleX, x: world.x, y: world.y },
      hud: { builds: this.hudBuilds, phase: this.view?.phase ?? null, banner: this.view?.banner ?? null, active: this.view?.active ?? null, target: this.view?.target ?? null, regions: this.hud?.objects.length ?? 0 },
      numbers: this.numbers?.count ?? 0,
      wash: Math.max(0, this.washAlpha),
      fxDrawn: this.fxShown,
    };
  }

  /** Take the stage off the scene stack. */
  override close(): void {
    if (this.closing || this.closed) return;
    this.closing = true;
    super.close();
  }
}
