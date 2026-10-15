/** Battle presentation: command entry, targeting, event playback, rewards. */
import { battler, type Battler, type Pose } from '../art/battlers';
import { battleBg, type BattleBg } from '../art/battlebg';
import { enemyArt, type EnemyArt } from '../art/enemies';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { Battle, type Timing, type TimingPrompt } from '../battle/engine';
import { FxLayer, type Pt } from '../battle/fx';
import { enemyParty, partyCombatant, writeBack } from '../battle/setup';
import type { Ability, Combatant, Command } from '../battle/types';
import { ABILITIES, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { ITEMS } from '../data/items';
import { LOOKS } from '../data/looks';
import { must } from '../engine/assert';
import { surface, type Ctx, type Surface } from '../engine/canvas';
import { type CanvasImage, type ListMenu, Scene } from '../sje';
import { W, H } from '../sje/core/size';
import { Rng, streams } from '../engine/rng';
import { equipRegen, grantXp, levelProgress, type LevelUp } from '../game/party';
import { battleSpeed, settings } from '../game/settings';
import { flags, removeItem, state, type MemberId } from '../game/state';
import { battleDriver } from './battlekit/driver';
import { TimingWindow, timingWord } from './battlekit/timing';
import { playEvent, type Cutin, type PlaybackView } from './battlekit/playback';
import { BattleHud } from './battlekit/hud';
import { type BattlePanel, LevelUpPanel, levelUpBeats, VictoryPanel } from './battlekit/panels';
import { BattleRenderer } from './battlekit/render';
import type { BattleStage } from './battlekit/stageseam';
import { BHT, BW, DECK_CUT_LIFE, ENEMY_MID_AT, FIELD_MID, floaterStart, HUD, MENU_X, PANEL_Y, PARTY_BOTTOM, PARTY_MID, partyX, placeEnemies, type EnemyBox } from './battlekit/geom';
import { CRACK, INTRO_T } from './battlekit/intro';
import type { Disp, Floater } from './battlekit/types';
import { autoOrders, choiceItems, comboActors, comboHint, commandItems, mostHurt, repeatOrders } from './battlekit/orders';
import { RIM, artTop } from './battlekit/sprites';
import { groupNames, pickGroup, summarize } from './battlekit/tables';

export interface BattleSetup {
  encounter: string;
  enemies?: string[] | undefined;
  bg: string;
  canRun?: boolean | undefined;
  boss?: boolean | undefined;
  music?: string | undefined;
  intro?: HTMLCanvasElement | undefined;
}

type Mode = 'intro' | 'round' | 'command' | 'list' | 'target' | 'play' | 'end';

/**
 * The battle's pace, set after Mark's first playthrough (2026-09-29: moves "go by pretty quickly
 * and I can't appreciate them"). Every move's animation (poses, effects, cut-ins, damage numbers)
 * runs on one clock at FX_PACE effect frames per real frame at Normal battle speed, so it all
 * slows together and stays in sync. Then each action lets its effect finish (up to LINGER_MAX
 * frames) and holds TURN_GAP frames before the next one steps up.
 */
const FX_PACE = 0.65, LINGER_MAX = 50, TURN_GAP = 22;
/** An enemy's memory flags that mean it's winding up a telegraphed move (its tell still stands). */
const WINDUPS = ['breath', 'charging', 'spin', 'surge'] as const;
/** The least time a tell stays up (real frames): two seconds, plus about 30 characters a second. */
function tellMin(text: string): number {
  return 120 + 2 * text.length;
}
export class BattleScene extends Scene<'win' | 'lose' | 'run'> {
  battle: Battle;
  world: Surface;
  /** Enemies, at screen resolution, between the backdrop and the front layer. */
  enemyLayer: Surface;
  /** The party, effects, rings, arrows and numbers: a transparent world-scale layer over the enemies. */
  front: Surface;
  bg: BattleBg;
  /** Rim-light colour for enemies against this backdrop. */
  rim: string;
  fx = new FxLayer(BW, BHT);
  mode: Mode = 'intro';
  private disp = new Map<number, Disp>();
  /** The same display states as a list, for the per-tick sweep (a Map iterator allocates). */
  private dispList: Disp[] = [];
  floaters: Floater[] = [];
  frame = 0;
  setup: BattleSetup;
  // Command entry
  cmds: Command[] = [];
  private actorIdx = 0;
  /** The three menus are kit lists, made in `create` by the HUD (a display object needs the running scene). */
  roundMenu!: ListMenu<string>;
  cmdMenu!: ListMenu<string>;
  listMenu!: ListMenu<string>;
  listKind: 'tech' | 'skill' | 'item' = 'tech';
  private pending: { type: Command['type']; id?: string | undefined; ability: Ability } | null = null;
  targetList: number[] = [];
  targetIdx = 0;
  private reserved: Record<string, number> = {};
  // Presentation
  banner: { text: string; sub?: string; t: number; color: string; big?: boolean } | null = null;
  message: { text: string; t: number } | null = null;
  /**
   * An enemy's tell, pinned at the top of the screen over everything else there: it stays until
   * the enemy that gave it has acted on it (a charge stays up through the orders for the next
   * round), and for at least as long as it takes to read.
   */
  tell: { text: string; t: number; actor: number; done: boolean } | null = null;
  introT = 0;
  /** Effect frames into Hex's deck cut-in (-1: not showing). */
  deckT = -1;
  /** The open results panel (battlekit/panels.ts), or null. */
  endPanel: BattlePanel | null = null;
  private waitingConfirm: (() => void) | null = null;
  /** The open results panel's finish-first hooks (see panel()). */
  private panelFinish: { done: () => boolean; skip: () => void } | null = null;
  /** Frames the scene has been waiting on the player (for a registered driver). */
  private idleT = 0;
  /** The timed press on the action being played (battlekit/timing.ts). */
  timing = new TimingWindow();
  readonly drawOrder: Combatant[] = [];
  /** Portrait cut-ins sliding across the screen for combos and big crits. */
  cutins: Cutin[] = [];
  private lastActor: Combatant | null = null;
  /** Frames of freeze-frame left (heavy hits). */
  private hitstop = 0;
  partyArt = new Map<number, Battler>();
  private dead = new Set<number>();

  /** The art the scene draws into its canvas (battlekit/render.ts); the scene keeps state and flow. */
  private readonly renderer = new BattleRenderer(this);

  /** Every window, text, bar and menu of the battle, as kit parts in the ui layer (battlekit/hud.ts). */
  private readonly hud = new BattleHud(this);

  /**
   * The stage that draws the battle (battlekit/stageseam.ts), or null: the renderer then draws everything, as it always did. With a stage the
   * renderer draws only the effects of the old picture (the impact frame, the intro, the bloom's light) on a clear canvas, and the windows are kit parts (battlekit/hud.ts), so this scene lets the stage show through and the stage scene below keep running.
   */
  stage: BattleStage | null = null;

  /** Put a stage under this scene. Call it before the scene runs. */
  attachStage(stage: BattleStage): void {
    this.stage = stage;
    this.opaque = false;
    this.passUpdate = true;
  }

  /** What the stage cannot draw itself: the ring of a timed press, into the stage's effects layer (world pixels). */
  drawOverStage(g: Ctx): void {
    this.renderer.drawOverStage(g);
  }

  /** The battle is frozen for a heavy hit (the stage holds its idle motion too). */
  get frozen(): boolean {
    return this.hitstop > 0;
  }

  /**
   * One frame of this scene's own canvas: the whole picture when there is no stage, else the art that the stage cannot draw (battlekit/render.ts). The canvas of
   * `image` starts clear every frame, as a legacy scene above the base did. The effects layer `game.fx` takes the glow when it is on. The windows are not in this canvas: they are kit parts in the ui layer.
   */
  render(ctx: Ctx): void {
    this.renderer.render(ctx);
  }

  /** True when this scene's canvas holds a picture (so the next frame must clear and upload it). Starts true: the first frame uploads. */
  private canvasDirty = true;

  /** The `prerender` handler: paint `render` into the scene's canvas image and upload it. A throw still uploads the (clear) canvas, then reaches the engine's guard. */
  private paint(): void {
    const image = this.image;
    if (!image) return;
    const ctx = image.ctx;
    // Under a stage most frames draw nothing here: skip the clear and the upload when the last frame drew nothing either (the canvas is still clear).
    const was = this.canvasDirty;
    this.canvasDirty = true;
    if (was) ctx.clearRect(0, 0, W, H);
    ctx.save();
    try {
      // The windows are display objects: bring them up to date with the state as it stands for this frame (a flow that ran after the tick may have changed it).
      this.hud.sync();
      this.canvasDirty = this.renderer.render(ctx);
    } finally {
      ctx.restore();
      if (was || this.canvasDirty) image.refresh();
    }
  }

  /** A picture of this scene for the screen snapshot (`Game.ctx`): its canvas as last painted. Its windows are display objects and are not in it: the only snapshot (`snapshotScreen`, before a battle starts) never sees a battle. */
  override paintSnapshot(ctx: CanvasRenderingContext2D): void {
    if (this.image?.visible) ctx.drawImage(this.image.canvas, 0, 0);
  }

  constructor(setup: BattleSetup) {
    super();
    this.setup = setup;
    this.bg = battleBg(setup.bg);
    this.rim = RIM[setup.bg] ?? '#ffc27a';
    this.world = surface(BW, BHT);
    // Enemies paint onto a screen-resolution layer (creatures are finer than the world), and the
    // party, effects and numbers onto a clear world layer in front of them (battlekit/render.ts).
    this.enemyLayer = surface(W, H);
    this.front = surface(BW, BHT);
    const party = state.party.map((id, i) => partyCombatant(state.members[id]!, i, i));
    const group = setup.enemies ?? pickGroup(setup.encounter);
    const enemies = enemyParty(group);
    const regen: Record<number, number> = {};
    for (const p of party) regen[p.uid] = equipRegen(state.members[p.key as MemberId]!);
    this.battle = new Battle(party, enemies, new Rng(streams.battle.int(1, 2 ** 30)), {
      canRun: setup.canRun ?? true,
      useItem: (id) => removeItem(id, 1),
      regen,
    });
    for (const u of this.battle.units) this.initDisp(u);
    for (const p of party) {
      this.partyArt.set(p.uid, battler(p.key, LOOKS[p.key as keyof typeof LOOKS]));
    }
  }

  private setPose(u: Combatant, pose: Pose, frames: number): void {
    const dd = this.d(u.uid);
    dd.pose = pose;
    dd.poseT = frames;
  }

  private initDisp(u: Combatant): void {
    const dd: Disp = { hp: u.hp, tp: u.tp, shownHp: u.hp, shownTp: u.tp, lagHp: u.hp, lagHold: 0, flash: 0, shake: 0, hop: 0, alpha: u.side === 'enemy' ? 0 : 1, dying: 0, lunge: 0, hidden: false, pose: 'idle', poseT: 0, afterimage: 0 };
    const old = this.disp.get(u.uid);
    if (old) this.dispList[this.dispList.indexOf(old)] = dd;
    else this.dispList.push(dd);
    this.disp.set(u.uid, dd);
  }

  d(uid: number): Disp {
    return this.disp.get(uid)!;
  }

  /** Has this fighter been shown yet? A summoned enemy has a display state only once playback reaches its summon. */
  hasDisp(uid: number): boolean {
    return this.disp.has(uid);
  }

  /** Counts up when the roster of the field changes on screen (a summon arrives, a boss changes form): the stage swaps its figures then, not when the engine decided. */
  get rosterVersion(): number {
    return this.layoutVersion;
  }

  /** This scene's canvas (the whole art picture when there is no stage, else the impact frame, the intro and the bloom's light). Null before `create` and after the scene is gone. */
  private image: CanvasImage | null = null;

  override create(): void {
    const fx = this.game.fx;
    // GPU particles stay on the battlefield: above the status cards.
    fx.clear();
    fx.clip = { x: 0, y: 0, w: W, h: PANEL_Y };
    this.image = this.add.canvasImage(0, 0, W, H);
    // The windows, text, bars and menus are kit parts in the ui layer (above the stage HUD, as every UI scene's are).
    this.hud.create();
    this.roundMenu = this.hud.roundMenu;
    this.cmdMenu = this.hud.cmdMenu;
    this.listMenu = this.hud.listMenu;
    this.events.on('prerender', this.paint, this);
    this.events.once('shutdown', () => {
      // However the fight ends (won, lost, fled, or abandoned after a fault), its effects end with it.
      this.image = null;
      fx.clear();
    });
    music(this.setup.music ?? (this.setup.boss ? 'boss' : 'battle'), 0);
    this.flow(this.intro());
  }

  /**
   * An error from one of the battle's async flows (the intro, a round), held for update() to
   * rethrow. Uncaught, it would end the chain and leave the fight hanging with nothing to notice;
   * rethrown each tick, the game's fault handling sees it and recovers (round 13's stability review).
   */
  private flowError: unknown = null;
  private flow(p: Promise<void>): void {
    p.catch((e: unknown) => {
      this.flowError = e;
    });
  }

  // ------------------------------------------------------------------ timing helpers
  private speed(): number {
    return battleSpeed().mult;
  }
  /**
   * Effect frames per real frame: the battle pace, Battle Speed, and held confirm/cancel. Not
   * while a timed press is armed: pressing confirm on the beat mustn't speed up the blow.
   */
  private animRate(): number {
    const held = !this.timing.armed && (this.game.input.down('confirm') || this.game.input.down('cancel'));
    return FX_PACE * this.speed() * (held ? 1.6 : 1);
  }
  /** Frames at the player's pace: Battle Speed, and faster still while confirm or cancel is held. */
  scaled(frames: number): number {
    const fast = this.game.input.down('confirm') || this.game.input.down('cancel') ? 1.6 : 1;
    return Math.max(1, Math.round(frames / this.speed() / fast));
  }
  private w(frames: number): Promise<void> {
    return this.game.wait(this.scaled(frames));
  }

  private async intro(): Promise<void> {
    this.mode = 'intro';
    const resolved = battleDriver()?.resolveAtOnce() ?? null;
    if (resolved === 'lose') {
      for (const p of this.battle.party) p.hp = 0;
      this.battle.outcome = 'lose';
      await this.defeat();
      return;
    }
    if (resolved === 'win') {
      await this.forceWin();
      return;
    }
    sfx('encounter');
    // The shatter keeps pace with the battle-speed setting, like everything after it.
    for (let t = 0; t < INTRO_T; t += this.speed()) {
      this.introT = Math.floor(t);
      for (const e of this.battle.enemies) this.d(e.uid).alpha = Math.min(1, Math.max(0, (t - INTRO_T * 0.35) / (INTRO_T * 0.5)));
      // The glass breaks: the air ripples out from the middle of the screen (GPU effects).
      if (t < CRACK && t + this.speed() >= CRACK) this.game.fx.playMoment('intro', W / 2, H / 2);
      await this.game.wait(1);
    }
    this.introT = 999;
    for (const e of this.battle.enemies) this.d(e.uid).alpha = 1;
    const names = groupNames(this.battle.enemies);
    this.say(this.setup.boss ? `${names} blocks the way!` : `${names} ${this.battle.enemies.length > 1 ? 'appear' : 'appears'}!`);
    await this.w(58);
    this.startRound();
  }

  // ------------------------------------------------------------------ command entry
  private startRound(): void {
    if (this.battle.outcome) return;
    // Initiative for the coming round, rolled now so the order strip shows the real order.
    this.battle.rollInitiative();
    this.cmds = [];
    this.comboActors.clear();
    this.reserved = {};
    this.actorIdx = -1;
    const anyOrders = state.party.some((id) => state.lastOrders[id]);
    this.roundMenu.setItems([
      { label: 'Fight', value: 'fight' },
      { label: 'Repeat', value: 'repeat', enabled: anyOrders && !this.telegraphed() },
      // Locked options say why at a glance, not only when highlighted.
      { label: 'Auto', value: 'auto', enabled: !this.setup.boss, right: this.setup.boss ? 'boss' : undefined },
      { label: 'Run', value: 'run', enabled: this.battle.canRun && !this.setup.boss, right: this.setup.boss || !this.battle.canRun ? 'no' : undefined },
    ]);
    this.roundMenu.index = 0;
    this.mode = 'round';
  }

  actors(): Combatant[] {
    return this.battle.party.filter((p) => p.hp > 0);
  }

  /** The member giving orders: the actorIdx-th living party member (no array built; read every frame). */
  get actor(): Combatant | undefined {
    let n = 0;
    for (const p of this.battle.party) if (p.hp > 0 && n++ === this.actorIdx) return p;
    return undefined;
  }

  private nextActor(): void {
    this.actorIdx++;
    const a = this.actor;
    if (!a) {
      this.flow(this.executeRound());
      return;
    }
    this.buildCmdMenu(a);
    this.mode = 'command';
  }

  private prevActor(): void {
    if (this.actorIdx <= 0) {
      this.cmds = [];
      this.reserved = {};
      this.mode = 'round';
      return;
    }
    this.actorIdx--;
    const a = this.actor!;
    const removed = this.cmds.find((c) => c.actor === a.uid);
    if (removed?.type === 'item' && removed.id) this.reserved[removed.id] = (this.reserved[removed.id] ?? 1) - 1;
    this.cmds = this.cmds.filter((c) => c.actor !== a.uid);
    this.refreshCombos();
    this.buildCmdMenu(a);
    this.mode = 'command';
  }

  private buildCmdMenu(a: Combatant): void {
    this.cmdMenu.setItems(commandItems(a, this.reserved));
    this.cmdMenu.index = 0;
  }

  private openList(kind: 'tech' | 'skill' | 'item'): void {
    this.listKind = kind;
    this.listMenu.setItems(choiceItems(this.actor!, kind, this.reserved));
    this.listMenu.index = 0;
    this.listMenu.scroll = 0;
    this.mode = 'list';
  }

  private choose(type: Command['type'], id: string | undefined, ab: Ability): void {
    this.pending = { type, id, ability: ab };
    switch (ab.target) {
      case 'enemy':
        this.targetList = this.enemiesByX().map((e) => e.uid);
        break;
      case 'ally':
        this.targetList = this.battle.party.filter((p) => p.hp > 0).map((p) => p.uid);
        break;
      case 'ally_down':
        this.targetList = this.battle.party.filter((p) => p.hp <= 0).map((p) => p.uid);
        if (!this.targetList.length) {
          sfx('buzz');
          this.say('No one needs that.');
          this.pending = null;
          return;
        }
        break;
      default:
        this.commit(-1);
        return;
    }
    // Default target: remember a sensible choice (the first enemy, or self for heals).
    this.targetIdx = Math.max(0, ab.target === 'ally' ? this.targetList.indexOf(mostHurt(this.battle.party)) : 0);
    this.mode = 'target';
  }

  private commit(target: number): void {
    const a = this.actor!;
    const p = this.pending!;
    this.cmds.push({ actor: a.uid, type: p.type, id: p.id, target });
    if (p.type === 'item' && p.id) this.reserved[p.id] = (this.reserved[p.id] ?? 0) + 1;
    state.lastOrders[a.key as MemberId] = { cmd: p.type, id: p.id };
    this.pending = null;
    this.refreshCombos();
    if (this.comboActors.has(a.uid)) sfx('combo_ready');
    this.nextActor();
  }

  comboActors = new Set<number>();
  private hintKey = '';
  private hintText = '';

  /** Recompute which queued actors form combos (call whenever `cmds` changes). */
  private refreshCombos(): void {
    comboActors(this.cmds, this.battle.units, this.comboActors);
    this.hintKey = '';
  }

  /** Would choosing `id` now fuse with an order already given? Cached per cursor position. */
  comboHint(id: string): string {
    const actor = this.actor;
    if (!actor || this.listKind === 'item') return '';
    const key = `${actor.uid}:${this.listKind}:${id}:${this.cmds.length}`;
    if (key === this.hintKey) return this.hintText;
    this.hintKey = key;
    this.hintText = comboHint(this.cmds, this.battle.units, actor, this.listKind, id);
    return this.hintText;
  }

  private enemiesByX(): Combatant[] {
    const stage = this.stage;
    if (stage) return [...this.battle.alive('enemy')].sort((x, y) => stage.footX(x.uid) - stage.footX(y.uid));
    return [...this.battle.alive('enemy')].sort((x, y) => this.enemyPos(x).x - this.enemyPos(y).x);
  }

  private autoCommands(): Command[] {
    return autoOrders(this.actors());
  }

  private repeatCommands(): Command[] {
    return repeatOrders(this.actors());
  }

  // ------------------------------------------------------------------ update
  fixedUpdate(): void {
    this.step();
    // A scene that closed in this tick has had its objects destroyed.
    if (!this.closed) this.hud.sync();
  }

  private step(): void {
    if (this.flowError) throw this.flowError;
    this.frame++;
    this.fx.rate = this.animRate();
    // GPU particles and shockwaves run on the battle's animation clock too, and hold in a hit pause.
    this.game.fx.rate = this.hitstop > 0 ? 0 : this.fx.rate;
    if (this.timing.isOpen && !this.timing.result) {
      // A registered driver (a test harness) presses on the beat by itself.
      const auto = battleDriver()?.timing() ?? null;
      const now = this.game.frame;
      const pressed = auto ? now === this.timing.impactAt + (auto === 'good' ? -6 : 0) : this.game.input.pressed('confirm');
      if (pressed) {
        const r = this.timing.press(now);
        if (r) this.onTimed(r);
      }
    }
    if (this.push) {
      this.push.t++;
      if (this.push.t >= this.push.life) this.push = null;
    }
    if (this.impactT > 0) this.impactT--;
    if (this.hitstop > 0) {
      // Freeze-frame on heavy hits: everything holds, the event script waits it out. A press
      // made during the freeze isn't lost: it carries to the first frame after (unless a ring is
      // armed: that press was judged above, or belongs to a ring that hasn't opened).
      this.hitstop--;
      if (!this.timing.armed) {
        this.game.input.carry('confirm');
        this.game.input.carry('cancel');
      }
      return;
    }
    this.fx.update();
    if (this.fx.flash) {
      this.game.flash(this.fx.flash.color, this.fx.flash.frames);
      this.fx.flash = null;
    }
    if (this.fx.shake) {
      const s = this.fx.shake;
      this.game.shake(6 + s, s >= 10 ? 5 : s >= 6 ? 4 : s >= 4 ? 3 : 2);
    }
    this.fx.shake = 0;
    for (let i = 0; i < this.dispList.length; i++) {
      const dd = this.dispList[i]!;
      if (dd.flash > 0) dd.flash--;
      if (dd.shake > 0) dd.shake--;
      // Bodies in motion run on the effect clock (see FX_PACE), so a pose and its effect stay in step.
      const r = this.fx.rate;
      if (dd.hop > 0) dd.hop = Math.max(0, dd.hop - 0.6 * r);
      if (dd.poseT > 0) dd.poseT = Math.max(0, dd.poseT - r);
      if (dd.afterimage > 0) dd.afterimage = Math.max(0, dd.afterimage - r);
      if (dd.lunge > 0) dd.lunge = Math.max(0, dd.lunge - (dd.lunge > 6 ? 1.2 : 0.5) * r);
      // Bars: shown values chase the real ones; the damage ghost holds, then drains.
      dd.shownHp += Math.abs(dd.hp - dd.shownHp) < 0.5 ? dd.hp - dd.shownHp : (dd.hp - dd.shownHp) * 0.22;
      dd.shownTp += Math.abs(dd.tp - dd.shownTp) < 0.5 ? dd.tp - dd.shownTp : (dd.tp - dd.shownTp) * 0.22;
      if (dd.hp >= dd.lagHp) {
        dd.lagHp = dd.hp;
        dd.lagHold = 0;
      } else if (dd.lagHold < 24) dd.lagHold++;
      else dd.lagHp = Math.max(dd.hp, dd.lagHp - Math.max(0.8, (dd.lagHp - dd.hp) * 0.08));
      if (dd.dying > 0) {
        dd.dying += this.fx.rate;
        dd.alpha = Math.max(0, 1 - dd.dying / 28);
      }
    }
    for (const f of this.floaters) f.t += this.fx.rate;
    // Cut-ins keep real time: they belong to the combo's name card, which holds a fixed beat, and
    // must be gone before the blow they announce lands.
    for (const c of this.cutins) c.t++;
    if (this.deckT >= 0) this.deckT = this.deckT + this.fx.rate > DECK_CUT_LIFE ? -1 : this.deckT + this.fx.rate;
    if (this.cutins.length && this.cutins.every((c) => c.t > c.life)) this.cutins.length = 0;
    // Compact finished floaters in place (no per-tick array).
    let live = 0;
    for (const fl of this.floaters) if (fl.t < 50) this.floaters[live++] = fl;
    this.floaters.length = live;
    if (this.banner) {
      this.banner.t++;
      if (this.banner.t > (this.banner.big ? 70 : 60)) this.banner = null;
    }
    if (this.message) {
      this.message.t++;
      if (this.message.t > 90) this.message = null;
    }
    if (this.tell) {
      this.tell.t++;
      const teller = this.battle.unit(this.tell.actor);
      if (!teller || teller.hp <= 0 || (this.tell.done && this.tell.t >= tellMin(this.tell.text))) this.tell = null;
    }
    const inp = this.game.input;
    // A registered driver (a test harness) may act on a waiting panel or round menu.
    const driver = battleDriver();
    if (driver && (this.waitingConfirm || this.mode === 'round')) {
      const move = driver.act(!!this.waitingConfirm, ++this.idleT);
      if (move) {
        this.idleT = 0;
        if (move === 'confirm' && this.waitingConfirm) {
          const cb = this.waitingConfirm;
          this.waitingConfirm = null;
          cb();
        } else if (move === 'auto' && this.mode === 'round') {
          this.cmds = this.autoCommands();
          this.flow(this.executeRound());
        }
        return;
      }
    }
    if (this.waitingConfirm && inp.pressed('confirm')) {
      if (this.panelFinish && !this.panelFinish.done()) {
        this.panelFinish.skip();
        sfx('cursor');
        return;
      }
      const cb = this.waitingConfirm;
      this.waitingConfirm = null;
      sfx('confirm');
      cb();
      return;
    }
    switch (this.mode) {
      case 'round': {
        const r = this.roundMenu.update(this.input.actions);
        if (r === 'confirm') {
          const v = this.roundMenu.current!.value;
          if (v === 'fight') this.nextActor();
          else if (v === 'auto') {
            this.cmds = this.autoCommands();
            this.flow(this.executeRound());
          } else if (v === 'repeat') {
            this.cmds = this.repeatCommands();
            this.flow(this.executeRound());
          } else if (v === 'run') {
            this.cmds = [{ actor: this.actors()[0]!.uid, type: 'run' }];
            this.flow(this.executeRound());
          }
        }
        break;
      }
      case 'command': {
        const r = this.cmdMenu.update(this.input.actions);
        if (r === 'cancel') this.prevActor();
        else if (r === 'confirm') {
          const v = this.cmdMenu.current!.value;
          if (v === 'attack') this.choose('attack', undefined, ABILITIES.attack!);
          else if (v === 'guard') {
            this.pending = { type: 'guard', ability: ABILITIES.attack! };
            this.commit(-1);
          } else this.openList(v as 'tech' | 'skill' | 'item');
        }
        break;
      }
      case 'list': {
        // The command menu stays up under the list: it takes no keys, but its highlight still moves.
        this.cmdMenu.update();
        const r = this.listMenu.update(this.input.actions);
        if (r === 'cancel') this.mode = 'command';
        else if (r === 'confirm') {
          const id = this.listMenu.current!.value;
          if (this.listKind === 'item') {
            const it = ITEMS[id]!;
            this.choose('item', id, { id: `item:${id}`, name: it.name, desc: it.desc, kind: 'item', target: it.target ?? 'ally', effects: it.effects ?? [], fx: it.fx ?? 'item' });
          } else this.choose(this.listKind, id, ABILITIES[id]!);
        }
        break;
      }
      case 'target': {
        const n = this.targetList.length;
        if (inp.repeat('left') || inp.repeat('up')) { this.targetIdx = (this.targetIdx + n - 1) % n; sfx('cursor'); }
        if (inp.repeat('right') || inp.repeat('down')) { this.targetIdx = (this.targetIdx + 1) % n; sfx('cursor'); }
        if (inp.pressed('confirm')) { sfx('confirm'); this.commit(this.targetList[this.targetIdx]!); }
        else if (inp.pressed('cancel')) {
          sfx('cancel');
          this.mode = this.pending?.type === 'attack' ? 'command' : 'list';
          this.pending = null;
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ execution
  private async executeRound(): Promise<void> {
    this.mode = 'play';
    for (const e of this.battle.startRound(this.cmds)) await playEvent(this.view, e);
    // Each action is declared, played up to its hit (a ring closing, if it offers a timed press),
    // then resolved with how the press landed.
    for (let step = this.battle.next(); step; step = this.battle.next()) {
      const mode = settings.timing;
      this.timing.arm(step.prompt && mode === 'on' ? step.prompt : null);
      if (this.timing.prompt) this.teachTiming(this.timing.prompt);
      for (const e of step.events) await playEvent(this.view, e);
      const grade: Timing = !step.prompt || mode === 'off' ? 'none' : mode === 'assist' ? 'good' : await this.settleTiming();
      for (const e of this.battle.land(grade)) await playEvent(this.view, e);
      await this.afterAction();
    }
    for (const e of this.battle.endRound()) await playEvent(this.view, e);
    this.timing.arm(null);
    await this.w(10);
    // Refresh displayed HP/TP to the authoritative values.
    for (const u of this.battle.units) {
      const dd = this.d(u.uid);
      dd.tp = u.tp;
      if (u.hp > 0) dd.hp = u.hp;
    }
    if (this.battle.outcome !== 'win' && battleDriver()?.endAsWin(this.battle)) {
      for (const p of this.battle.party) p.hp = Math.max(p.hp, 1);
      await this.forceWin();
      return;
    }
    const o = this.battle.outcome;
    if (o === 'win') await this.victory();
    else if (o === 'lose') await this.defeat();
    else if (o === 'fled') await this.fled();
    else this.startRound();
  }

  /**
   * Between actions: let the move's effect play out (up to a cap: some leave embers drifting),
   * then a beat with nothing moving, so each action reads as its own before the next one starts.
   */
  private async afterAction(): Promise<void> {
    // The enemy that gave the tell has now done what it said, or its windup is over some other way
    // (stunned or jammed mid-charge, or the tell was an outcome: "the surge fizzles out").
    if (this.tell) {
      const teller = this.battle.unit(this.tell.actor);
      const winding = !!teller && WINDUPS.some((k) => teller.memory[k]);
      if (this.lastActor?.uid === this.tell.actor || !winding) this.tell.done = true;
    }
    if (this.battle.outcome) return;
    for (let i = 0; i < LINGER_MAX && this.fx.busy; i++) await this.game.wait(1);
    await this.w(TURN_GAP);
  }

  /** Wait out the late side of the window (if nobody has pressed yet), then take the grade. */
  private async settleTiming(): Promise<Timing> {
    while (this.timing.lateLeft(this.game.frame) > 0) await this.game.wait(1);
    const g = this.timing.grade();
    this.timing.disarm();
    return g;
  }

  /** The first time each kind of press comes up, say how it works (with the player's own key). */
  private teachTiming(p: TimingPrompt): void {
    const flag = `tut_${p.kind}`;
    if (flags.has(flag)) return;
    flags.set(flag);
    const key = this.game.input.keyName('confirm');
    this.say(
      p.kind === 'strike' ? `Press ${key} as the gold ring closes: a harder hit.`
      : p.kind === 'mend' ? `Press ${key} as the green ring closes: a stronger heal.`
      : `Press ${key} as the blue ring closes: brace and take less.`,
    );
  }

  /** A press landed (or whiffed): say so over the target and give it a sound. */
  private onTimed(r: Timing | 'early' | 'late'): void {
    const p = this.timing.prompt;
    if (!p) return;
    const word = timingWord(p.kind, r);
    // One word per press: on the struck enemy, or on each member braced.
    const on = p.kind === 'strike' ? p.targets.slice(0, 1) : p.targets;
    for (const uid of on) this.floatOn(uid, word.text, word.color, 'label');
    if (r === 'perfect') sfx(p.kind === 'brace' ? 'parry' : 'timed_perfect');
    else if (r === 'good') sfx('timed_good');
    else {
      sfx('miss');
      // The first whiff says what it cost, once.
      if (!flags.has('tut_whiff')) {
        flags.set('tut_whiff');
        this.say(p.kind === 'strike' ? 'Off the beat: an overswing hits softer. Better no press than a guess.' : p.kind === 'mend' ? 'Off the beat: a rushed heal mends a little less. Better no press than a guess.' : 'Off the beat: tensed at the wrong moment, it hurts more. Better no press than a guess.');
      }
    }
  }

  pos(uid: number): Pt {
    const u = this.battle.unit(uid);
    if (!u) return { x: BW / 2, y: FIELD_MID };
    if (this.stage) return this.stage.pos(uid);
    return u.side === 'enemy' ? this.enemyCenter(u) : this.partyPos(u);
  }

  /** Where a number pops: over an enemy's head (clear of its HP bar), or over a party member. */
  private floatPos(uid: number): Pt {
    const u = this.battle.unit(uid);
    if (this.stage && u) return this.stage.headPos(uid);
    if (u?.side !== 'enemy') return this.pos(uid);
    const { x, y, art } = this.enemyPos(u);
    return { x: x + art.w / 2, y: y + artTop(art) + 4 };
  }

  /** The scene as playback sees it (battlekit/playback.ts): a narrow view, built once. */
  private readonly view: PlaybackView = (() => {
    // The view's getters and methods close over the scene.
    const scene = this;
    return {
      get battle() {
        return scene.battle;
      },
      get fx() {
        return scene.fx;
      },
      get game() {
        return scene.game;
      },
      get lastActor() {
        return scene.lastActor;
      },
      set lastActor(u: Combatant | null) {
        scene.lastActor = u;
      },
      d: (uid) => scene.d(uid),
      pos: (uid) => scene.pos(uid),
      w: (frames) => scene.w(frames),
      floatOn: (uid, text, color, style) => scene.floatOn(uid, text, color, style),
      say: (text) => scene.say(text),
      tell: (text, actor) => {
        scene.tell = { text, t: 0, actor, done: false };
        // Its own act clears it: forget any earlier act by this enemy.
        scene.lastActor = null;
      },
      showBanner: (text, color, big) => scene.showBanner(text, color, big),
      setBanner: (b) => {
        scene.banner = b;
      },
      endBanner: () => {
        // Jump into the last frames of the fade-out.
        if (scene.banner) scene.banner.t = Math.max(scene.banner.t, scene.banner.big ? 66 : 56);
      },
      setPose: (u, pose, frames) => scene.setPose(u, pose, frames),
      initDisp: (u) => scene.initDisp(u),
      cutin: (c) => {
        scene.cutins.push(c);
      },
      cutinCount: () => scene.cutins.length,
      hitstop: (frames) => {
        // Players can turn freeze-frames off (Options → Hit pause).
        if (!settings.hitPause) return Promise.resolve();
        // At the player's pace like every other wait: a faster battle gets shorter freezes.
        const f = scene.scaled(frames);
        scene.hitstop = f;
        return scene.game.wait(f);
      },
      markDead: (uid) => {
        scene.dead.add(uid);
      },
      relayout: () => {
        scene.layoutVersion++;
      },
      comboId: (name) => scene.comboId(name),
      impact: (uid, color) => {
        const u = scene.battle.unit(uid);
        if (!u) return;
        const p = scene.pos(uid);
        scene.push = { x: p.x, y: p.y, t: 0, life: 20 };
        // The cut-out is a full-screen flash: only with Screen flash at Full.
        if (u.side === 'enemy' && settings.flash >= 2) {
          scene.impactT = 2;
          scene.impactOn = u;
          scene.impactColor = color;
        }
      },
      timingArmed: () => (scene.timing.armed && !scene.timing.isOpen ? scene.timing.prompt!.profile : null),
      anim: (frames) => scene.fx.realFrames(frames),
      label: (u) => scene.label(u),
      deckCutin: () => {
        scene.deckT = 0;
      },
      openTiming: (lead) => scene.timing.open(scene.game.frame, lead),
    };
  })();

  private comboId(name: string): string {
    return COMBOS.find((c) => ABILITIES[c.id]?.name === name)?.id ?? name;
  }

  /**
   * Pop text over a combatant. Every floater for a target uses the same anchor (floatPos) and
   * stacks above the ones still showing, so a damage number and a status word never overlap.
   */
  private floatOn(uid: number, text: string, color: string, style: Floater['style']): void {
    const p = this.floatPos(uid);
    let stacked = 0;
    for (const f of this.floaters) if (f.uid === uid && f.t < 26) stacked++;
    // One row per floater already showing; near the top of the frame the stack grows downward
    // instead (floaterStart in battlekit/geom.ts, which keeps every number out of the top text band).
    this.floaters.push({ text, x: p.x, y: floaterStart(p.y, stacked), t: 0, color, style, uid });
  }

  private say(text: string): void {
    this.message = { text, t: 0 };
  }

  private showBanner(text: string, color: string, big = false): void {
    this.banner = { text, t: 0, color, big };
  }

  // ------------------------------------------------------------------ outcomes
  /** Debug: every enemy down, rewards granted as normal. */
  private async forceWin(): Promise<void> {
    for (const e of this.battle.alive('enemy')) {
      e.hp = 0;
      this.battle.defeated.push(e.key);
      // A win resolved at once still met these enemies: the bestiary counts them, as a fought
      // win's 'down' events would.
      state.bestiary[e.key] = (state.bestiary[e.key] ?? 0) + 1;
    }
    this.battle.outcome = 'win';
    await this.victory();
  }

  private async victory(): Promise<void> {
    this.mode = 'end';
    this.tell = null;
    music(this.setup.boss ? 'victory_boss' : 'victory', 0);
    const living = this.battle.party.filter((p) => p.hp > 0);
    for (const p of living) this.setPose(p, 'victory', 100000);
    this.fx.play('victory', this.pos(living[0]?.uid ?? 0), living.map((p) => this.pos(p.uid)));
    sfx('cheer');
    // The banner sweeps in over the hops; the rewards panel takes over from it.
    this.bannerStart = this.frame;
    for (let i = 0; i < 3; i++) {
      for (const p of living) this.d(p.uid).hop = 6;
      await this.game.wait(14);
    }
    const r = this.battle.rewards();
    const walletBefore = state.cred;
    state.cred += r.cred;
    for (const id of r.drops) state.inventory[id] = Math.min(99, (state.inventory[id] ?? 0) + 1);
    // Write back first so level-ups apply to the post-battle HP.
    this.writeBack();
    const ups: LevelUp[] = [];
    const bars: { id: MemberId; lv0: number; r0: number; lv1: number; r1: number }[] = [];
    for (const p of living) {
      const m = state.members[p.key as MemberId]!;
      const lv0 = m.level, r0 = levelProgress(m.level, m.xp);
      ups.push(...grantXp(m, r.xp));
      bars.push({ id: m.id, lv0, r0, lv1: m.level, r1: levelProgress(m.level, m.xp) });
    }
    const dropNames = summarize(r.drops.map((id) => ITEMS[id]!.name));
    let start = this.frame;
    this.bannerStart = -1;
    const tallied = this.panel(
      // Under a stage the panel starts below the stage HUD's top boxes (the turn timeline reaches row 45), as the other top lines do (topClear).
      () => new VictoryPanel(this, { xp: r.xp, cred: r.cred, walletBefore, bars, dropNames, y: this.stage ? Math.max(44, this.stage.topClear) : 44 }, () => this.frame - start),
      { done: () => this.frame - start >= 54, skip: () => { start = this.frame - 54; } },
    );
    // Tally ticks while the numbers count up (started once the panel is up: until round 2 of
    // Mark's notes they ran before it and so never played).
    let tallying = true;
    void (async () => {
      for (let i = 0; i < 7 && tallying; i++) {
        sfx('cursor', 1 + i * 0.06);
        await this.game.wait(4);
      }
    })();
    await tallied;
    tallying = false;
    for (const u of ups) await this.levelUpPanel(u);
    state.battles++;
    this.close('win');
  }

  defeatT = 0;

  private async defeat(): Promise<void> {
    this.mode = 'end';
    this.tell = null;
    // The last blow lands in silence: the music cuts, the frame flashes and drains, the crew
    // buckles; only then the dirge.
    music(null, 4);
    sfx('ko');
    this.game.flash('#ff2a4a', 16);
    this.game.shake(26, 4);
    for (const p of this.battle.party) this.setPose(p, 'hurt', 400);
    this.defeatT = 1;
    const hurry = battleDriver()?.hurry() ?? false;
    await this.w(hurry ? 2 : 55);
    music('gameover', 0);
    this.say('The crew has fallen…');
    await this.w(hurry ? 2 : 80);
    // Out to black, not a cut: Game Over fades up from it.
    await this.game.fadeOut(hurry ? 2 : 40);
    this.writeBack();
    this.close('lose');
  }

  private async fled(): Promise<void> {
    this.mode = 'end';
    for (let t = 0; t < 24; t++) {
      for (const p of this.battle.party) this.d(p.uid).lunge = -t;
      await this.game.wait(1);
    }
    this.writeBack();
    this.close('run');
  }

  private writeBack(): void {
    for (const p of this.battle.party) writeBack(p, state.members[p.key as MemberId]!);
  }

  /**
   * Hold a results panel until confirm. With `finish`, a press while it's still counting up
   * completes it instead (the same key the player was just hitting for timed presses; a stray
   * press mustn't throw away the tally).
   */
  private panel(make: () => BattlePanel, finish?: { done: () => boolean; skip: () => void }): Promise<void> {
    if (battleDriver()?.hurry()) return Promise.resolve();
    return new Promise((res) => {
      this.endPanel = make();
      this.panelFinish = finish ?? null;
      this.waitingConfirm = () => {
        this.endPanel?.destroy();
        this.endPanel = null;
        this.panelFinish = null;
        res();
      };
    });
  }

  /**
   * A level-up, as a moment (Mark's playthrough: "show the stats filling up, and make it feel more
   * special. Leveling up music sting"): a fanfare, the member lit up, each stat counting up in
   * turn with its bar filling to the new mark, then the full restore, then anything learned.
   */
  private async levelUpPanel(u: LevelUp): Promise<void> {
    music('levelup', 6);
    const { stats, rowAt, restoredAt, learnAt, end } = levelUpBeats(u);
    let start = this.frame;
    // Sounds on their beats: a tick as each stat counts (rising), a chime for the restore, a
    // key-item flourish for each thing learned. Skipping ahead plays whatever it jumped past.
    // Started once the panel is up, and stopped by its own flag (not `endPanel`, which the next
    // panel sets again in the same tick this one closes).
    const cues = [...stats.map((_, i) => rowAt(i)), restoredAt, ...u.learned.map((_, j) => learnAt(j))];
    let open = true;
    const playCues = async () => {
      let fired = 0;
      while (open && fired < cues.length) {
        const t = this.frame - start;
        let played = false;
        while (fired < cues.length && t >= (cues[fired] ?? 0)) {
          if (!played) sfx(fired < stats.length ? 'blip' : fired === stats.length ? 'heal' : 'keyitem', 1 + fired * 0.12);
          played = true;
          fired++;
        }
        await this.game.wait(1);
      }
    };
    const shown = this.panel(() => new LevelUpPanel(this, u, () => this.frame - start), { done: () => this.frame - start >= end, skip: () => { start = this.frame - end; } });
    void playCues();
    await shown;
    open = false;
  }

  // ------------------------------------------------------------------ layout
  private layout = new Map<number, { x: number; y: number; art: EnemyArt }>();
  private layoutKey = -1;
  private layoutVersion = 0;

  /** Enemy placement, recomputed only when the roster changes (deaths, summons, phase shifts). */
  enemyPos(u: Combatant): { x: number; y: number; art: EnemyArt } {
    // Numeric layout key (roster size, fallen, phase changes): recomputed per call without allocating.
    const key = this.battle.units.length * 1e6 + this.dead.size * 1e3 + this.layoutVersion;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      const prev = this.layout;
      const next = new Map<number, { x: number; y: number; art: EnemyArt }>();
      const living = this.battle.enemies.filter((e) => !this.dead.has(e.uid)).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
      const arts = living.map((e) => enemyArt(must(ENEMIES[e.key], 'enemy data').sprite));
      // The row rule is battlekit/geom.ts placeEnemies (pure, so the tests check it): one spot per
      // enemy, in the same order, so spot `i` belongs to enemy `i`.
      const spots = placeEnemies(living.map((e, i) => this.enemyBox(e, must(arts[i], 'enemy art'))), this.bg.ground);
      for (const [i, e] of living.entries()) {
        const spot = must(spots[i], 'enemy spot'), art = must(arts[i], 'enemy art');
        next.set(e.uid, { x: spot.x, y: spot.y, art });
      }
      // The fallen keep their last spot while they dissolve.
      for (const e of this.battle.enemies) if (!next.has(e.uid) && prev.has(e.uid)) next.set(e.uid, prev.get(e.uid)!);
      this.layout = next;
    }
    let p = this.layout.get(u.uid);
    if (!p) {
      const art = enemyArt(ENEMIES[u.key]!.sprite);
      const spot = must(placeEnemies([this.enemyBox(u, art)], this.bg.ground)[0], 'enemy spot');
      p = { x: spot.x, y: spot.y, art };
      this.layout.set(u.uid, p);
    }
    return p;
  }

  /** What the enemy row's rule needs of one enemy: its art's size and top row, and whether it is a boss or the Lurker. */
  private enemyBox(e: Combatant, art: EnemyArt): EnemyBox {
    return { w: art.w, h: art.h, top: artTop(art), boss: !!e.boss, lurker: e.key === 'lurker' };
  }

  private enemyCenter(u: Combatant): Pt {
    const p = this.enemyPos(u);
    return { x: p.x + p.art.w / 2, y: p.y + p.art.h * ENEMY_MID_AT };
  }

  partyPos(u: Combatant): Pt {
    const n = this.battle.party.length;
    const i = u.order ?? 0;
    // Each hero stands over the middle of their own status card (partyX), whatever the party size.
    return { x: partyX(i, n), y: PARTY_BOTTOM - PARTY_MID };
  }

  // ------------------------------------------------------------------ state the renderer reads

  /** The camera push on a big hit (battle-world focus point; frames). */
  push: { x: number; y: number; t: number; life: number } | null = null;
  /** Impact frame: frames left, the unit it's on, and its accent colour. */
  impactT = 0;
  impactOn: Combatant | null = null;
  impactColor = '#ffe07a';
  /** Frame the victory banner started, or -1. */
  bannerStart = -1;

  private feetY(e: Combatant): number {
    const p = this.enemyPos(e);
    return p.y + p.art.h;
  }

  /** Draw order for enemies: back to front by where their feet are (one comparator, made once). */
  readonly byFeet = (a: Combatant, b: Combatant): number => this.feetY(a) - this.feetY(b);

  /** 0 for the first enemy of its kind in this fight, 1 for the second, ... */
  dupIndex(e: Combatant): number {
    let n = 0;
    for (const o of this.battle.enemies) {
      if (o === e) return n;
      if (o.key === e.key) n++;
    }
    return n;
  }

  /** How the UI names a combatant: two or more of a kind get a letter each ("Glowrat A", "Glowrat B"). */
  label(u: Combatant): string {
    if (u.side !== 'enemy') return u.name;
    return this.twins(u) ? `${u.name} ${String.fromCharCode(65 + this.dupIndex(u))}` : u.name;
  }

  /** Whether another enemy in this fight shares this one's kind (counted without allocating: the strip asks every frame). */
  twins(u: Combatant): boolean {
    for (const o of this.battle.enemies) if (o !== u && o.key === u.key) return true;
    return false;
  }

  /** Left edge of party member i's status card. */
  boxX(i: number): number {
    return HUD.cardX(i, this.battle.party.length);
  }

  /** Something is winding up a big move: the round deserves fresh orders, not muscle memory. */
  telegraphed(): boolean {
    return this.battle.alive('enemy').some((u) => WINDUPS.some((k) => u.memory[k]));
  }

  /**
   * Command and ability windows sit in the bottom-left corner, whoever is acting (the turn-order
   * strip keeps the right edge): the same place every time, so the eye never has to hunt for them
   * (Mark's playthrough, 2026-09-29). The heroes stand over their status cards, which are centered.
   * With the chapter's three members the left hero's edge is at about x 180, and the widest list
   * the data builds ends at about x 146, so no one is covered (tests/battle-geom.test.ts, "the list
   * window"). A list can be 210 wide (`LIST_MAX_W`), and with four members the left hero's edge is
   * at about x 120, so a four-member party's longest list would overlap that hero's side.
   */
  menuX(_a: Combatant, _w: number): number {
    return MENU_X;
  }
}
