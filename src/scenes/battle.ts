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
import { MEMBERS } from '../data/party';
import { surface, type Ctx, type Surface } from '../engine/canvas';
import { drawText, fitText } from '../engine/font';
import { Scene, W } from '../engine/game';
import { Rng, streams } from '../engine/rng';
import { equipRegen, grantXp, levelProgress, type LevelUp } from '../game/party';
import { battleSpeed, settings } from '../game/settings';
import { flags, removeItem, state, type MemberId } from '../game/state';
import { drawBar, drawWindow, UI } from '../ui/draw';
import { ListMenu } from '../ui/list';
import { LEVELUP_TEXT_W } from '../ui/layout';
import { battleDriver } from './battlekit/driver';
import { TimingWindow, timingWord } from './battlekit/timing';
import { playEvent, type Cutin, type PlaybackView } from './battlekit/playback';
import { BattleRenderer } from './battlekit/render';
import { BHT, BW, MENU_X, PARTY_BOTTOM } from './battlekit/geom';
import type { Disp, Floater } from './battlekit/types';
import { autoOrders, choiceItems, comboActors, comboHint, commandItems, mostHurt, repeatOrders } from './battlekit/orders';
import { RIM, opaqueTop } from './battlekit/sprites';
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
 * Regular enemies stand further back on the floor than the background's ground line, so the
 * party's heads (top ≈ y 81) sit below their feet; bosses stay forward and loom.
 */
const ENEMY_LIFT = 14, BOSS_LIFT = 4;
/**
 * The top prompt / banner strip (UI y 6-23, world y 0-12): a sprite whose first opaque row would
 * sit under it is placed lower, so a tall boss's head is never hidden behind "Give each crew
 * member orders" (the Warden's visor was).
 */
const PROMPT_CLEAR = 14;
function clearOfPrompt(y: number, canvas: HTMLCanvasElement): number {
  return Math.max(y, PROMPT_CLEAR - opaqueTop(canvas));
}

export class BattleScene extends Scene<'win' | 'lose' | 'run'> {
  battle: Battle;
  world: Surface;
  bg: BattleBg;
  /** Rim-light colour for enemies against this backdrop. */
  rim: string;
  fx = new FxLayer();
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
  roundMenu = new ListMenu<string>([], 4);
  cmdMenu = new ListMenu<string>([], 5);
  listMenu = new ListMenu<string>([], 5);
  listKind: 'tech' | 'skill' | 'item' = 'tech';
  private pending: { type: Command['type']; id?: string | undefined; ability: Ability } | null = null;
  targetList: number[] = [];
  targetIdx = 0;
  private reserved: Record<string, number> = {};
  // Presentation
  banner: { text: string; sub?: string; t: number; color: string; big?: boolean } | null = null;
  message: { text: string; t: number } | null = null;
  introT = 0;
  endPanel: ((ctx: Ctx) => void) | null = null;
  private waitingConfirm: (() => void) | null = null;
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

  /** Everything the scene draws (battlekit/render.ts); the scene keeps state and flow. */
  private readonly renderer = new BattleRenderer(this);

  render(ctx: Ctx): void {
    this.renderer.render(ctx);
  }

  constructor(setup: BattleSetup) {
    super();
    this.setup = setup;
    this.bg = battleBg(setup.bg);
    this.rim = RIM[setup.bg] ?? '#ffc27a';
    this.world = surface(BW, BHT);
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

  override enter(): void {
    music(this.setup.music ?? (this.setup.boss ? 'boss' : 'battle'), 0);
    void this.intro();
  }

  // ------------------------------------------------------------------ timing helpers
  private speed(): number {
    return battleSpeed().mult;
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
    for (let t = 0; t < 30; t += this.speed()) {
      this.introT = Math.floor(t);
      for (const e of this.battle.enemies) this.d(e.uid).alpha = Math.min(1, t / 20);
      await this.game.wait(1);
    }
    this.introT = 999;
    const names = groupNames(this.battle.enemies);
    this.say(this.setup.boss ? `${names} blocks the way!` : `${names} ${this.battle.enemies.length > 1 ? 'appear' : 'appears'}!`);
    await this.w(46);
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
      void this.executeRound();
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
    return [...this.battle.alive('enemy')].sort((x, y) => this.enemyPos(x).x - this.enemyPos(y).x);
  }

  private autoCommands(): Command[] {
    return autoOrders(this.actors());
  }

  private repeatCommands(): Command[] {
    return repeatOrders(this.actors());
  }

  // ------------------------------------------------------------------ update
  update(): void {
    this.frame++;
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
      if (dd.hop > 0) dd.hop = Math.max(0, dd.hop - 0.6);
      if (dd.poseT > 0) dd.poseT--;
      if (dd.afterimage > 0) dd.afterimage--;
      if (dd.lunge > 0) dd.lunge = Math.max(0, dd.lunge - (dd.lunge > 6 ? 1.2 : 0.5));
      // Bars: shown values chase the real ones; the damage ghost holds, then drains.
      dd.shownHp += Math.abs(dd.hp - dd.shownHp) < 0.5 ? dd.hp - dd.shownHp : (dd.hp - dd.shownHp) * 0.22;
      dd.shownTp += Math.abs(dd.tp - dd.shownTp) < 0.5 ? dd.tp - dd.shownTp : (dd.tp - dd.shownTp) * 0.22;
      if (dd.hp >= dd.lagHp) {
        dd.lagHp = dd.hp;
        dd.lagHold = 0;
      } else if (dd.lagHold < 24) dd.lagHold++;
      else dd.lagHp = Math.max(dd.hp, dd.lagHp - Math.max(0.8, (dd.lagHp - dd.hp) * 0.08));
      if (dd.dying > 0) {
        dd.dying++;
        dd.alpha = Math.max(0, 1 - dd.dying / 28);
      }
    }
    for (const f of this.floaters) f.t++;
    for (const c of this.cutins) c.t++;
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
          void this.executeRound();
        }
        return;
      }
    }
    if (this.waitingConfirm && inp.pressed('confirm')) {
      const cb = this.waitingConfirm;
      this.waitingConfirm = null;
      sfx('confirm');
      cb();
      return;
    }
    switch (this.mode) {
      case 'round': {
        const r = this.roundMenu.update(inp);
        if (r === 'confirm') {
          const v = this.roundMenu.current!.value;
          if (v === 'fight') this.nextActor();
          else if (v === 'auto') {
            this.cmds = this.autoCommands();
            void this.executeRound();
          } else if (v === 'repeat') {
            this.cmds = this.repeatCommands();
            void this.executeRound();
          } else if (v === 'run') {
            this.cmds = [{ actor: this.actors()[0]!.uid, type: 'run' }];
            void this.executeRound();
          }
        }
        break;
      }
      case 'command': {
        const r = this.cmdMenu.update(inp);
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
        const r = this.listMenu.update(inp);
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

  /** Wait out the late side of the window (if nobody has pressed yet), then take the grade. */
  private async settleTiming(): Promise<Timing> {
    while (this.timing.lateLeft(this.game.frame) > 0) await this.game.wait(1);
    const g = this.timing.grade();
    this.timing.disarm();
    return g;
  }

  /** The first time each kind of press comes up, say how it works (with the player's own key). */
  private teachTiming(p: TimingPrompt): void {
    const flag = p.kind === 'strike' ? 'tut_strike' : 'tut_brace';
    if (flags.has(flag)) return;
    flags.set(flag);
    const key = this.game.input.keyName('confirm');
    this.say(p.kind === 'strike' ? `Press ${key} as the gold ring closes: a harder hit.` : `Press ${key} as the blue ring closes: brace and take less.`);
  }

  /** A press landed (or whiffed): say so over the target and give it a sound. */
  private onTimed(r: Timing | 'early' | 'late'): void {
    const p = this.timing.prompt;
    if (!p) return;
    const word = timingWord(p.kind, r);
    // One word per press: on the struck enemy, or on each member braced.
    const on = p.kind === 'strike' ? p.targets.slice(0, 1) : p.targets;
    for (const uid of on) this.floatOn(uid, word.text, word.color, 'label');
    if (r === 'perfect') sfx(p.kind === 'strike' ? 'timed_perfect' : 'parry');
    else if (r === 'good') sfx('timed_good');
    else {
      sfx('miss');
      // The first whiff says what it cost, once.
      if (!flags.has('tut_whiff')) {
        flags.set('tut_whiff');
        this.say(p.kind === 'strike' ? 'Off the beat: an overswing hits softer. Better no press than a guess.' : 'Off the beat: tensed at the wrong moment, it hurts more. Better no press than a guess.');
      }
    }
  }

  pos(uid: number): Pt {
    const u = this.battle.unit(uid);
    if (!u) return { x: BW / 2, y: 60 };
    return u.side === 'enemy' ? this.enemyCenter(u) : this.partyPos(u);
  }

  /** Where a number pops: over an enemy's head (clear of its HP bar), or over a party member. */
  private floatPos(uid: number): Pt {
    const u = this.battle.unit(uid);
    if (u?.side !== 'enemy') return this.pos(uid);
    const { x, y, art } = this.enemyPos(u);
    return { x: x + art.canvas.width / 2, y: Math.max(22, y + opaqueTop(art.canvas) + 4) };
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
    // 12px a row: 7px glyphs, their shadow, and air (the hit's bounce reaches 3px). Near the top
    // of the frame the stack grows downward instead, so the clamp can't pile rows on each other.
    this.floaters.push({ text, x: p.x, y: Math.max(22 + stacked * 12, p.y - 8 - stacked * 12), t: 0, color, style, uid });
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
    const start = this.frame;
    // Tally ticks while the numbers count up.
    void (async () => {
      for (let i = 0; i < 7 && this.endPanel; i++) {
        sfx('cursor', 1 + i * 0.06);
        await this.game.wait(4);
      }
    })();
    this.bannerStart = -1;
    await this.panel((ctx) => {
      const t = this.frame - start;
      const tally = Math.min(1, t / 28), fill = Math.min(1, Math.max(0, (t - 10) / 44));
      const w = 272, h = 58 + dropNames.length * 11 + bars.length * 13;
      const x = (W - w) / 2, y = 44;
      drawWindow(ctx, x, y, w, h, { title: 'VICTORY', accent: UI.amber });
      drawText(ctx, `{y}${Math.round(r.xp * tally)}{/} XP each`, x + 14, y + 14);
      drawText(ctx, `{y}${Math.round(r.cred * tally).toLocaleString('en-US')}¢{/} cred`, x + 14, y + 26);
      drawText(ctx, `Wallet: ${Math.round(walletBefore + r.cred * tally).toLocaleString('en-US')}¢`, x + w - 14, y + 26, { color: UI.dim, align: 'right' });
      // Each survivor's progress to the next level fills; a level-up fills, flips and rolls over.
      bars.forEach((b, i) => {
        const by = y + 42 + i * 13;
        const up = b.lv1 > b.lv0, flipped = up && fill >= 0.6;
        const ratio = !up ? b.r0 + (b.r1 - b.r0) * fill : !flipped ? b.r0 + (1 - b.r0) * (fill / 0.6) : b.r1 * ((fill - 0.6) / 0.4);
        drawText(ctx, MEMBERS[b.id].name, x + 14, by, { color: MEMBERS[b.id].color });
        drawText(ctx, `Lv ${flipped ? b.lv1 : b.lv0}`, x + 70, by, { color: flipped ? UI.amber : UI.dim });
        drawBar(ctx, x + 104, by + 3, 110, 4, ratio, flipped ? UI.amber : UI.cyan);
        if (flipped && this.frame % 24 < 16) drawText(ctx, 'LV UP!', x + w - 14, by, { color: UI.amber, align: 'right' });
      });
      const dy = y + 46 + bars.length * 13;
      if (dropNames.length) {
        drawText(ctx, 'Found:', x + 14, dy, { color: UI.dim });
        dropNames.forEach((n, i) => {
          drawText(ctx, n, x + 54, dy + i * 11, { color: UI.cyan });
        });
      }
      if (this.frame % 40 < 28) drawText(ctx, '▼', x + w - 16, y + h - 13, { color: UI.cyan });
    });
    for (const u of ups) {
      sfx('levelup');
      const name = MEMBERS[u.id].name;
      const gains = Object.entries(u.gains).filter(([, v]) => (v ?? 0) > 0);
      await this.panel((ctx) => {
        const w = 230, h = 58 + Math.ceil(gains.length / 2) * 11 + u.learned.length * 11;
        const x = (W - w) / 2, y = 56;
        drawWindow(ctx, x, y, w, h, { title: 'LEVEL UP', accent: MEMBERS[u.id].color });
        drawText(ctx, `${name} reached {y}Lv ${u.level}{/}!`, x + 14, y + 14);
        gains.forEach(([k, v], i) => {
          drawText(ctx, `${k.toUpperCase()} {g}+${v}{/}`, x + 14 + (i % 2) * 100, y + 30 + Math.floor(i / 2) * 11);
        });
        const ly = y + 34 + Math.ceil(gains.length / 2) * 11;
        u.learned.forEach((id, i) => {
          drawText(ctx, fitText(`Learned {c}${ABILITIES[id]!.name}{/}!`, LEVELUP_TEXT_W), x + 14, ly + i * 11);
        });
        if (this.frame % 40 < 28) drawText(ctx, '▼', x + w - 16, y + h - 13, { color: UI.cyan });
      });
    }
    state.battles++;
    this.close('win');
  }

  defeatT = 0;

  private async defeat(): Promise<void> {
    this.mode = 'end';
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

  private panel(draw: (ctx: Ctx) => void): Promise<void> {
    if (battleDriver()?.hurry()) return Promise.resolve();
    return new Promise((res) => {
      this.endPanel = draw;
      this.waitingConfirm = () => {
        this.endPanel = null;
        res();
      };
    });
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
      const gap = 6;
      const total = living.reduce((n, e) => n + enemyArt(ENEMIES[e.key]!.sprite).canvas.width, 0) + gap * Math.max(0, living.length - 1);
      let x = Math.round((BW - total) / 2);
      living.forEach((e, i) => {
        const art = enemyArt(ENEMIES[e.key]!.sprite);
        const ground = this.bg.ground - (e.boss ? BOSS_LIFT : ENEMY_LIFT) - (e.key === 'lurker' ? 4 : 0);
        const back = e.boss ? 0 : (i % 2) * 4;
        next.set(e.uid, { x, y: clearOfPrompt(ground - art.canvas.height - back, art.canvas), art });
        x += art.canvas.width + gap;
      });
      // The fallen keep their last spot while they dissolve.
      for (const e of this.battle.enemies) if (!next.has(e.uid) && prev.has(e.uid)) next.set(e.uid, prev.get(e.uid)!);
      this.layout = next;
    }
    let p = this.layout.get(u.uid);
    if (!p) {
      const art = enemyArt(ENEMIES[u.key]!.sprite);
      p = { x: Math.round((BW - art.canvas.width) / 2), y: clearOfPrompt(this.bg.ground - (u.boss ? BOSS_LIFT : ENEMY_LIFT) - art.canvas.height, art.canvas), art };
      this.layout.set(u.uid, p);
    }
    return p;
  }

  private enemyCenter(u: Combatant): Pt {
    const p = this.enemyPos(u);
    return { x: p.x + p.art.canvas.width / 2, y: p.y + p.art.canvas.height * 0.45 };
  }

  partyPos(u: Combatant): Pt {
    const n = this.battle.party.length;
    const i = u.order ?? 0;
    return { x: Math.round(BW / 2 + (i - (n - 1) / 2) * 44), y: PARTY_BOTTOM - 34 };
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
    return p.y + p.art.canvas.height;
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

  /** Left edge of party member i's status card. */
  boxX(i: number): number {
    const n = this.battle.party.length;
    const w = 116;
    const total = n * w + (n - 1) * 3;
    return Math.round((W - total) / 2) + i * (w + 3);
  }

  /** Something is winding up a big move: the round deserves fresh orders, not muscle memory. */
  telegraphed(): boolean {
    return this.battle.alive('enemy').some((u) => u.memory.breath || u.memory.charging || u.memory.spin || u.memory.surge);
  }

  /**
   * Command and ability windows sit in the screen corner on the actor's side. Party sprites
   * never reach the outer 90px, so the acting character is never covered by their own menu.
   */
  menuX(a: Combatant, w: number): number {
    return this.partyPos(a).x * 2 < W / 2 ? MENU_X : W - MENU_X - w;
  }
}
