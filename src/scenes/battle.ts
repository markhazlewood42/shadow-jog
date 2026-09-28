/** Battle presentation: command entry, targeting, event playback, rewards. */
import { battler, type Battler, type Pose } from '../art/battlers';
import { getPortrait } from '../art/portraits';
import { battleBg, type BattleBg } from '../art/battlebg';
import { enemyArt, type EnemyArt } from '../art/enemies';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { Battle, type Timing, type TimingPrompt } from '../battle/engine';
import { FxLayer, type Pt } from '../battle/fx';
import { enemyParty, partyCombatant, writeBack } from '../battle/setup';
import type { Ability, Combatant, Command, Element } from '../battle/types';
import { ABILITIES, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { ITEMS } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS } from '../data/party';
import { surface, type Ctx, type Surface } from '../engine/canvas';
import { drawText, fitText, measure, wrap } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { keyLabel } from '../engine/input';
import { Rng, streams } from '../engine/rng';
import { equipRegen, grantXp, knownAbilities, levelProgress, type LevelUp } from '../game/party';
import { battleSpeed, settings } from '../game/settings';
import { flags, removeItem, state, type MemberId } from '../game/state';
import { bandGradient, drawBar, drawWindow, hpColor, UI } from '../ui/draw';
import { ListMenu } from '../ui/list';
import { LEVELUP_TEXT_W, TARGET_INFO_W } from '../ui/layout';
import { drawVictoryBanner } from './battlekit/banner';
import { battleDriver } from './battlekit/driver';
import { TimingWindow, drawRing, timingWord } from './battlekit/timing';
import { playEvent, type PlaybackView } from './battlekit/playback';
import type { Disp, Floater } from './battlekit/types';
import { autoOrders, choiceItems, comboActors, comboHint, commandItems, mostHurt, repeatOrders } from './battlekit/orders';
import { ShatterIntro } from './battlekit/intro';
import { DISSOLVE_STEPS, ENEMY_POSE_T, RIM, dissolved, drawBig, drawLag, enemyThumb, marked, mirrored, opaqueTop, rimOf, silhouetteCache, variant } from './battlekit/sprites';
import { AFTERIMAGES, ELEMENTS, ELEMENT_COLOR, ELEMENT_TAG, STATUS_LABEL, groupNames, pickGroup, statusName, summarize } from './battlekit/tables';

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

const BW = 240, BHT = 135;
const PANEL_Y = 214;
/** Party feet sit well below the panel top (107): an over-the-shoulder view of heads, shoulders and raised arms. */
const PARTY_BOTTOM = 127;
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
/** Battle menus hug the screen edge; CMD_W fits "Programs"/"Spirits" plus the cursor. */
const MENU_X = 4, CMD_W = 84;

export class BattleScene extends Scene<'win' | 'lose' | 'run'> {
  private battle: Battle;
  private world: Surface;
  private bg: BattleBg;
  /** Rim-light colour for enemies against this backdrop. */
  private rim: string;
  private fx = new FxLayer();
  private mode: Mode = 'intro';
  private disp = new Map<number, Disp>();
  /** The same display states as a list, for the per-tick sweep (a Map iterator allocates). */
  private dispList: Disp[] = [];
  private floaters: Floater[] = [];
  private frame = 0;
  private setup: BattleSetup;
  // Command entry
  private cmds: Command[] = [];
  private actorIdx = 0;
  private roundMenu = new ListMenu<string>([], 4);
  private cmdMenu = new ListMenu<string>([], 5);
  private listMenu = new ListMenu<string>([], 5);
  private listKind: 'tech' | 'skill' | 'item' = 'tech';
  private pending: { type: Command['type']; id?: string | undefined; ability: Ability } | null = null;
  private targetList: number[] = [];
  private targetIdx = 0;
  private reserved: Record<string, number> = {};
  // Presentation
  private banner: { text: string; sub?: string; t: number; color: string; big?: boolean } | null = null;
  private message: { text: string; t: number } | null = null;
  private introT = 0;
  private endPanel: ((ctx: Ctx) => void) | null = null;
  private waitingConfirm: (() => void) | null = null;
  /** Frames the scene has been waiting on the player (for a registered driver). */
  private idleT = 0;
  /** The timed press on the action being played (battlekit/timing.ts). */
  private timing = new TimingWindow();
  private readonly drawOrder: Combatant[] = [];
  /** Portrait cut-ins sliding across the screen for combos and big crits. */
  private cutins: { key: string; face: string; t: number; fromLeft: boolean; life: number }[] = [];
  private lastActor: Combatant | null = null;
  /** Wrapped top-line text, rebuilt only when the text changes. */
  private topKey = '';
  private topLines: { l: string; c: string }[] = [];
  private topW = 0;
  /** Frames of freeze-frame left (heavy hits). */
  private hitstop = 0;
  private partyArt = new Map<number, Battler>();
  private dead = new Set<number>();

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

  private d(uid: number): Disp {
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
  private w(frames: number): Promise<void> {
    const fast = this.game.input.down('confirm') || this.game.input.down('cancel') ? 1.6 : 1;
    return this.game.wait(Math.max(1, Math.round(frames / this.speed() / fast)));
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

  private actors(): Combatant[] {
    return this.battle.party.filter((p) => p.hp > 0);
  }

  /** The member giving orders: the actorIdx-th living party member (no array built; read every frame). */
  private get actor(): Combatant | undefined {
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

  private comboActors = new Set<number>();
  private hintKey = '';
  private hintText = '';

  /** Recompute which queued actors form combos (call whenever `cmds` changes). */
  private refreshCombos(): void {
    comboActors(this.cmds, this.battle.units, this.comboActors);
    this.hintKey = '';
  }

  /** Would choosing `id` now fuse with an order already given? Cached per cursor position. */
  private comboHint(id: string): string {
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
    if (this.hitstop > 0) {
      // Freeze-frame on heavy hits: everything holds, the event script waits it out.
      this.hitstop--;
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
    const code = this.game.input.keysFor('confirm')[0];
    const key = code ? keyLabel(code) : 'Confirm';
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
  }

  private pos(uid: number): Pt {
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
        scene.hitstop = frames;
        return scene.game.wait(frames);
      },
      markDead: (uid) => {
        scene.dead.add(uid);
      },
      relayout: () => {
        scene.layoutVersion++;
      },
      comboId: (name) => scene.comboId(name),
      timingArmed: () => scene.timing.armed && !scene.timing.isOpen,
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

  private defeatT = 0;

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
  private enemyPos(u: Combatant): { x: number; y: number; art: EnemyArt } {
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

  private partyPos(u: Combatant): Pt {
    const n = this.battle.party.length;
    const i = u.order ?? 0;
    return { x: Math.round(BW / 2 + (i - (n - 1) / 2) * 44), y: PARTY_BOTTOM - 34 };
  }

  // ------------------------------------------------------------------ render
  render(ctx: Ctx): void {
    const g = this.world.ctx;
    const f = this.frame;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg.canvas, 0, 0);
    if (this.bg.glow) g.drawImage(this.bg.glow, 0, 0);
    this.bg.anim?.(g, f);
    // Enemies, back to front
    // Back to front, into a reused buffer.
    const order = this.drawOrder;
    order.length = 0;
    for (const e of this.battle.enemies) if (this.d(e.uid).alpha > 0.01) order.push(e);
    order.sort(this.byFeet);
    for (const e of order) this.drawEnemy(g, e, f);
    // Party (back view)
    for (const p of this.battle.party) this.drawPartyMember(g, p, f);
    // Foreground framing (rails, cables) over the fighters; FX and numbers stay on top of it.
    if (this.bg.fg) g.drawImage(this.bg.fg, 0, 0);
    this.fx.render(g, (c, ch, x, y, col) => drawText(c, ch, x, y, { color: col, shadow: false }));
    // A timed press: the ring closing on each target.
    const tp = this.timing.prompt;
    if (tp && this.timing.isOpen) {
      for (const uid of tp.targets) {
        const p = this.pos(uid);
        drawRing(g, p.x, p.y, this.game.frame, this.timing);
      }
    }
    // Targeting arrows (world space)
    if (this.mode === 'target') {
      const t = this.targetList[this.targetIdx];
      if (t !== undefined) this.drawArrow(g, t, f);
    }
    // Floaters
    for (const fl of this.floaters) {
      // Hits and labels pop up, hold and drift together (so a WEAK!/CRITICAL keeps its row over
      // its number the whole time); only the hit bounces. DoT ticks sink.
      const hit = fl.style === 'hit';
      const pop = 8 * (1 - (1 - Math.min(1, fl.t / 8)) ** 3);
      const rise = fl.style === 'tick' ? -Math.min(8, fl.t * 0.25) : pop + Math.max(0, fl.t - 24) * 0.15;
      const bounce = hit && fl.t >= 8 && fl.t < 20 ? Math.abs(Math.sin((fl.t - 8) * 0.52)) * 3 * (1 - (fl.t - 8) / 12) : 0;
      g.globalAlpha = fl.t > 38 ? Math.max(0, 1 - (fl.t - 38) / 12) : 1;
      drawText(g, fl.text, Math.round(fl.x), Math.round(fl.y - rise - bounce), { color: fl.color, align: 'center', shadow: '#0a0913' });
      g.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
    // Shake moves the battlefield only: HP bars, numbers and menus stay put.
    const shx = this.game.shakeX, shy = this.game.shakeY;
    if (shx || shy) {
      ctx.fillStyle = '#07060d';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(this.world.canvas, shx, shy, W, H);
    if (this.defeatT > 0) {
      // The killing blow drains the frame toward red-black.
      this.defeatT++;
      ctx.fillStyle = `rgba(36,0,10,${Math.min(0.62, this.defeatT / 70).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    // Intro shatter
    if (this.setup.intro && this.introT < 30) {
      if (!this.shatter) this.shatter = new ShatterIntro(this.setup.intro);
      this.shatter.draw(ctx, this.introT);
    }
    this.renderUi(ctx);
  }

  /** Shards of the field snapshot: a jittered triangle mesh, each flying out from the centre. */
  /** The frame the fight broke out of, shattering (built on the first intro frame). */
  private shatter: ShatterIntro | null = null;

  private feetY(e: Combatant): number {
    const p = this.enemyPos(e);
    return p.y + p.art.canvas.height;
  }

  /** 0 for the first enemy of its kind in this fight, 1 for the second, ... */
  /** Draw order for enemies: back to front by where their feet are (one comparator, made once). */
  private readonly byFeet = (a: Combatant, b: Combatant): number => this.feetY(a) - this.feetY(b);

  private dupIndex(e: Combatant): number {
    let n = 0;
    for (const o of this.battle.enemies) {
      if (o === e) return n;
      if (o.key === e.key) n++;
    }
    return n;
  }

  private drawEnemy(g: Ctx, e: Combatant, f: number): void {
    const dd = this.d(e.uid);
    const { x, y, art } = this.enemyPos(e);
    const dup = this.dupIndex(e);
    // Duplicates: a distinct individual where the sprite has one, else a palette and mirror.
    // Creatures get both: their own anatomy, and the tint, mirror and markings on top.
    const who = dup ? enemyArt(ENEMIES[e.key]!.sprite, dup) : art;
    const flip = (c: HTMLCanvasElement) => (dup % 2 ? mirrored(c) : c);
    const creature = e.family === 'beast' || e.family === 'machine' || e.family === 'spirit';
    // The strike frame through the lunge of an attack (from rearing back to the settle).
    const k = dd.poseT > 0 && dd.pose === 'attack' ? ENEMY_POSE_T - dd.poseT : -1;
    const src = who.attack && k >= 6 && k < 18 ? who.attack : who;
    // Humans with their own individual art still get the squad armband (marked()).
    const canvas = who.individual && !creature ? marked(flip(src.canvas), e.family ?? '', dup) : marked(variant(src.canvas, dup), e.family ?? '', dup);
    const glow = who.individual && !creature ? src.glow && flip(src.glow) : src.glow && variant(src.glow, dup);
    let ox = 0, oy = 0;
    switch (art.idle) {
      case 'hover': oy = Math.round(Math.sin(f * 0.08 + e.uid) * 2); break;
      case 'bob': oy = Math.round(Math.sin(f * 0.1 + e.uid) * 1); break;
      case 'sway': ox = Math.round(Math.sin(f * 0.05 + e.uid) * 2); oy = Math.round(Math.sin(f * 0.1) * 1); break;
      case 'breathe': oy = (Math.floor((f + e.uid * 13) / 30) % 2); break;
      case 'flicker': oy = Math.round(Math.sin(f * 0.06 + e.uid) * 2); break;
    }
    if (dd.shake > 0) ox += dd.shake % 4 < 2 ? 2 : -2;
    oy += Math.round(dd.lunge);
    // Body motion while acting or reeling (battle-world pixels; the party is below).
    let castGlow = 0;
    if (dd.poseT > 0) {
      const k = dd.pose === 'hurt' ? 16 - dd.poseT : ENEMY_POSE_T - dd.poseT;
      switch (dd.pose) {
        case 'attack': // rear back, lunge down at the crew, settle
          oy += k < 9 ? -Math.round(k / 3) : k < 15 ? Math.round((k - 9) * 1.6) - 3 : Math.max(0, 7 - (k - 15));
          break;
        case 'aim': // shoulder the kick
          oy += k >= 10 && k < 16 ? -2 : 0;
          ox += k >= 10 && k < 13 ? (e.uid % 2 ? 1 : -1) : 0;
          break;
        case 'cast': // lift and gather light
          oy -= Math.round(Math.min(3, k / 3) * (k < 24 ? 1 : Math.max(0, 1 - (k - 24) / 8)));
          castGlow = Math.sin(Math.min(1, k / 22) * Math.PI) * 0.45;
          break;
        case 'hurt': // knocked back, then recover
          oy -= k < 6 ? 2 : k < 12 ? 1 : 0;
          ox += k < 10 ? (e.uid % 2 ? 2 : -2) : 0;
          break;
      }
    }
    const dx = x + ox, dy = y + oy;
    // Shadow
    if (art.shadow) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      const cx = x + art.canvas.width / 2;
      const gy = y + art.canvas.height - 1;
      g.fillRect(Math.round(cx - art.shadow / 2), gy, art.shadow, 2);
      g.fillRect(Math.round(cx - art.shadow / 2 + 2), gy + 2, art.shadow - 4, 1);
    }
    let alpha = dd.alpha;
    if (art.idle === 'flicker') alpha *= 0.82 + 0.18 * Math.sin(f * 0.2 + e.uid);
    if (dd.dying > 0) {
      // Defeat: a brief white blink over the intact sprite, then it breaks up block by block
      // from the top, drifting up as it goes.
      const k = Math.min(1, dd.dying / 28);
      const lift = Math.round(k * 4);
      g.drawImage(dissolved(canvas, Math.min(DISSOLVE_STEPS, Math.floor(k * (DISSOLVE_STEPS + 1)))), dx, dy - lift);
      if (dd.dying < 6) {
        g.globalAlpha = 0.5 * (1 - dd.dying / 6);
        g.drawImage(silhouetteCache(canvas, '#ffffff'), dx, dy - lift);
      }
      g.globalAlpha = 1;
      return;
    }
    if (e.key === 'warden') this.drawConduits(g, dx, dy, art.canvas.width, f, !!e.memory.charging);
    // Rim light in a colour the backdrop doesn't use, so no enemy blends into the set.
    g.globalAlpha = alpha * 0.55;
    g.drawImage(rimOf(canvas, this.rim), dx - 1, dy - 1);
    g.globalAlpha = alpha;
    g.drawImage(canvas, dx, dy);
    if (this.bg.tintAmt > 0) {
      // Ambient tint: multiply-ish wash using the background light color.
      g.globalAlpha = alpha * this.bg.tintAmt;
      g.drawImage(silhouetteCache(canvas, this.bg.tint), dx, dy);
      g.globalAlpha = alpha;
    }
    if (glow) g.drawImage(glow, dx, dy);
    if (castGlow > 0) {
      g.globalAlpha = alpha * castGlow;
      g.drawImage(silhouetteCache(canvas, '#e8d8ff'), dx, dy);
      g.globalAlpha = alpha;
    }
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      // A blink, not a blank: the sprite's detail stays visible under the white, so a still
      // caught on this frame reads as a hit rather than a white smear.
      g.globalAlpha = 0.55 * alpha;
      g.drawImage(silhouetteCache(canvas, '#ffffff'), dx, dy);
    }
    g.globalAlpha = 1;
  }

  /** The Warden is wired into the facility: sagging conduits run from its frame to the screen edges. */
  private drawConduits(g: Ctx, x: number, y: number, w: number, f: number, charging: boolean): void {
    const runs: [number, number, number, number, number][] = [
      [x + 10, y + 24, -6, y + 4, 10],
      [x + w - 10, y + 24, BW + 6, y, 12],
      [x + 14, y + 44, -6, y + 58, 6],
      [x + w - 14, y + 44, BW + 6, y + 62, 6],
    ];
    const pulse = charging ? '#ff5a4a' : '#6ff3ff';
    const speed = charging ? 0.05 : 0.018;
    runs.forEach(([x0, y0, x1, y1, sag], i) => {
      const n = Math.ceil(Math.abs(x1 - x0));
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const px = Math.round(x0 + (x1 - x0) * t), py = Math.round(y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag);
        g.fillStyle = '#16121e';
        g.fillRect(px, py - 1, 1, 3);
        g.fillStyle = '#3a3448';
        g.fillRect(px, py - 1, 1, 1);
      }
      // Energy runs along each line into the machine.
      for (let k = 0; k < 2; k++) {
        const t = 1 - ((f * speed + i * 0.27 + k * 0.5) % 1);
        const px = Math.round(x0 + (x1 - x0) * t), py = Math.round(y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag);
        g.fillStyle = pulse;
        g.fillRect(px - 1, py, 3, 1);
      }
    });
  }

  private drawPartyMember(g: Ctx, p: Combatant, f: number): void {
    const dd = this.d(p.uid);
    const art = this.partyArt.get(p.uid)!;
    const pos = this.partyPos(p);
    const active = (this.mode === 'command' || this.mode === 'list' || this.mode === 'target') && this.actor?.uid === p.uid;
    const down = dd.hp <= 0 && p.hp <= 0;
    const pose: Pose = dd.poseT > 0 ? dd.pose : 'idle';
    const frame = art.frames[pose];
    let ox = 0;
    if (dd.shake > 0) ox = dd.shake % 4 < 2 ? 2 : -2;
    if (pose === 'hurt') ox += 1;
    // Idle breathing: a 1px rise, staggered per member; faster and higher while choosing orders.
    const breathe = pose === 'idle' ? (Math.floor((f + p.uid * 23) / (active ? 16 : 34)) % 2) * (active ? 2 : 1) : 0;
    const x = Math.round(pos.x - frame.width / 2 + ox);
    const y = Math.round(PARTY_BOTTOM - frame.height - dd.hop - dd.lunge - breathe + (pose === 'hurt' ? 2 : 0));
    if (down) {
      g.globalAlpha = 0.5;
      g.drawImage(silhouetteCache(art.frames.hurt, '#3a3450'), x, y + 10);
      g.globalAlpha = 1;
      return;
    }
    if (dd.afterimage > 0) {
      // Speed ghosts trailing behind and to either side.
      for (const [gx, gy, a] of AFTERIMAGES) {
        g.globalAlpha = a * (dd.afterimage / 22);
        g.drawImage(silhouetteCache(frame, MEMBERS[p.key as MemberId].color), x + gx, y + gy);
      }
      g.globalAlpha = 1;
    }
    g.drawImage(frame, x, y);
    const glow = art.glow[pose];
    if (glow) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.75 + 0.25 * Math.sin(f * 0.5);
      g.drawImage(glow, x, y);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    if (active && this.mode !== 'target') this.drawArrow(g, p.uid, f, MEMBERS[p.key as MemberId].color);
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      g.globalAlpha = 0.45;
      g.drawImage(silhouetteCache(frame, '#ff5a5a'), x, y);
      g.globalAlpha = 1;
    }
  }

  private drawArrow(g: Ctx, uid: number, f: number, color = '#ffe07a'): void {
    const u = this.battle.unit(uid);
    if (!u) return;
    let x: number, y: number;
    if (u.side === 'enemy') {
      const p = this.enemyPos(u);
      x = p.x + p.art.canvas.width / 2;
      y = p.y - 4;
    } else {
      const p = this.partyPos(u);
      x = p.x;
      y = PARTY_BOTTOM - this.partyArt.get(uid)!.headH - 3;
    }
    const b = Math.round(Math.sin(f * 0.25) * 2);
    g.fillStyle = '#0a0913';
    g.fillRect(x - 3, y - 6 + b, 7, 1);
    g.fillStyle = color;
    for (let i = 0; i < 4; i++) g.fillRect(x - 3 + i, y - 5 + b + i, 7 - i * 2, 1);
  }

  // ------------------------------------------------------------------ UI (1x)
  /** Labelled status chips over each enemy (screen space, so they stay small and legible). */
  /**
   * Over each enemy, stacked upward from the head: an HP bar (always shown), active status
   * chips, and any weaknesses the crew has found (by Analyze or by landing a weak hit).
   */
  private renderEnemyStatus(ctx: Ctx): void {
    for (const e of this.battle.enemies) {
      if (e.hp <= 0) continue;
      const dd = this.d(e.uid);
      if (dd.dying > 0 || dd.alpha < 0.5) continue;
      const { x, y, art } = this.enemyPos(e);
      const cx0 = Math.round((x + art.canvas.width / 2) * 2);
      let row = Math.max(24, (y + opaqueTop(art.canvas)) * 2 - 6);
      // HP bar (bosses get a wider one).
      const bw = e.boss ? 72 : 30;
      const ratio = Math.max(0, dd.shownHp / e.base.maxHp);
      // A solid dark plate and a 3px bar, so it holds up over bright signage.
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(cx0 - bw / 2 - 2, row - 2, bw + 4, 7);
      ctx.fillStyle = '#2a2838';
      ctx.fillRect(cx0 - bw / 2, row, bw, 3);
      ctx.fillStyle = hpColor(ratio);
      ctx.fillRect(cx0 - bw / 2, row, Math.round(bw * ratio), 3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(cx0 - bw / 2, row, Math.round(bw * ratio), 1);
      drawLag(ctx, cx0 - bw / 2, row, bw, 3, ratio, dd.lagHp / e.base.maxHp);
      row -= 11;
      // While numbers are rising off this enemy, its chips and WEAK tag step aside (the HP bar
      // stays): the two text systems share the rows above its head.
      let floating = false;
      for (const f of this.floaters) if (f.uid === e.uid && f.t < 50) floating = true;
      if (floating) continue;
      // Status chips: measure, then draw (two passes, nothing allocated per frame).
      let count = 0, total = 0;
      for (const s of e.status) {
        const l = STATUS_LABEL[s.id];
        if (!l || s.id === 'guard') continue;
        if (count < 3) total += measure(l[0]) + 5;
        count++;
      }
      if (count) {
        const more = count - Math.min(count, 3);
        if (more) total += measure(`+${more}`) + 3;
        let cx = Math.round(cx0 - total / 2);
        let drawn = 0;
        for (const s of e.status) {
          const l = STATUS_LABEL[s.id];
          if (!l || s.id === 'guard' || drawn === 3) continue;
          const w = measure(l[0]) + 4;
          ctx.fillStyle = '#0a0913';
          ctx.fillRect(cx, row, w, 9);
          ctx.fillStyle = l[1];
          ctx.fillRect(cx, row + 8, w, 1);
          drawText(ctx, l[0], cx + 2, row + 1, { color: l[1], shadow: false });
          cx += w + 1;
          drawn++;
        }
        if (more) drawText(ctx, `+${more}`, cx + 1, row + 1, { color: UI.dim });
        row -= 11;
      }
      // Known weaknesses.
      const seen = state.weakSeen[e.key];
      let n = 0, width = measure('WEAK') + 2;
      for (const el of ELEMENTS) {
        if (e.analyzed ? (e.weak?.[el] ?? 1) > 1 : seen?.includes(el)) {
          width += measure(ELEMENT_TAG[el]) + 3;
          n++;
        }
      }
      if (!n) continue;
      let wx = Math.round(cx0 - width / 2);
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(wx - 2, row, width + 4, 9);
      drawText(ctx, 'WEAK', wx, row + 1, { color: UI.amber, shadow: false });
      wx += measure('WEAK') + 4;
      for (const el of ELEMENTS) {
        if (!(e.analyzed ? (e.weak?.[el] ?? 1) > 1 : seen?.includes(el))) continue;
        drawText(ctx, ELEMENT_TAG[el], wx, row + 1, { color: ELEMENT_COLOR[el], shadow: false });
        wx += measure(ELEMENT_TAG[el]) + 3;
      }
    }
  }

  private renderUi(ctx: Ctx): void {
    if (this.mode !== 'intro') this.renderEnemyStatus(ctx);
    this.renderPanel(ctx);
    // Top line: action banner or message
    if (this.banner) {
      const b = this.banner;
      const a = b.t < 6 ? b.t / 6 : b.t > (b.big ? 60 : 50) ? Math.max(0, 1 - (b.t - (b.big ? 60 : 50)) / 10) : 1;
      ctx.globalAlpha = a;
      if (b.big) {
        const y = 92;
        bigBandGrad ??= bandGradient(ctx, 0, W, 0.15, 0.9);
        ctx.fillStyle = bigBandGrad;
        ctx.fillRect(0, y, W, 32);
        ctx.fillStyle = b.color;
        ctx.fillRect(40, y, W - 80, 1);
        ctx.fillRect(40, y + 31, W - 80, 1);
        drawBig(ctx, b.text, W / 2, y + 4, b.color);
        if (b.sub) drawText(ctx, b.sub, W / 2, y + 22, { align: 'center', color: '#ffffff' });
      } else {
        const tw = measure(b.text) + 24;
        drawWindow(ctx, (W - tw) / 2, 6, tw, 17, { plain: true, accent: b.color });
        drawText(ctx, b.text, W / 2, 10, { align: 'center', color: b.color });
      }
      ctx.globalAlpha = 1;
    } else if (this.message) {
      const tw = Math.min(W - 20, measure(this.message.text) + 24);
      drawWindow(ctx, (W - tw) / 2, 6, tw, 17, { plain: true });
      drawText(ctx, this.message.text, W / 2, 10, { align: 'center' });
    }
    if (this.message && this.banner && !this.banner.big) {
      const tw = Math.min(W - 20, measure(this.message.text) + 24);
      drawWindow(ctx, (W - tw) / 2, 26, tw, 17, { plain: true });
      drawText(ctx, this.message.text, W / 2, 30, { align: 'center' });
    }
    switch (this.mode) {
      case 'round':
        this.renderRoundMenu(ctx);
        break;
      case 'command':
        this.renderCmdMenu(ctx);
        break;
      case 'list':
        this.renderCmdMenu(ctx, false);
        this.renderList(ctx);
        break;
      case 'target':
        this.renderTargetInfo(ctx);
        break;
    }
    if (this.mode === 'round' || this.mode === 'command' || this.mode === 'list' || this.mode === 'target') this.renderOrder(ctx);
    this.renderCutins(ctx);
    if (this.bannerStart >= 0) drawVictoryBanner(ctx, this.frame - this.bannerStart);
    if (this.endPanel) this.endPanel(ctx);
  }

  /** Frame the victory banner started, or -1. */
  private bannerStart = -1;

  /** The coming round's turn order, cached against the orders given so far. */
  private order: { key: number; list: number[][] } | null = null;

  /** Turn order as it stands: orders given so far, everyone else assumed to attack. */
  private turnOrder(): number[][] {
    const key = this.battle.round * 100 + this.cmds.length;
    if (this.order?.key === key) return this.order.list;
    const given = new Set(this.cmds.map((c) => c.actor));
    const rest: Command[] = this.actors().filter((p) => !given.has(p.uid)).map((p) => ({ actor: p.uid, type: 'attack', target: -1 }));
    const list = this.battle.previewOrder([...this.cmds, ...rest]);
    this.order = { key, list };
    return list;
  }

  /**
   * The turn-order strip (top left while orders are given): who acts when this round, as faces,
   * updating as orders go in (Guard goes first, items early, a combo as one). The member giving
   * orders is outlined; the enemy being aimed at is too.
   */
  private renderOrder(ctx: Ctx): void {
    const list = this.turnOrder();
    const y = 8;
    let x = 8;
    drawText(ctx, 'TURN', x, y + 4, { color: UI.dim });
    x += measure('TURN') + 5;
    const acting = this.mode === 'round' ? undefined : this.actor?.uid;
    const aimed = this.mode === 'target' ? this.targetList[this.targetIdx] : undefined;
    for (const actors of list) {
      const w = actors.length * 13 + 1;
      const lead = this.battle.unit(actors[0]!);
      if (!lead) continue;
      const hot = actors.includes(acting ?? -1) || actors.includes(aimed ?? -1);
      const edge = actors.length > 1 ? '#ffe07a' : lead.side === 'party' ? MEMBERS[lead.key as MemberId].color : '#ff6a6a';
      ctx.fillStyle = hot ? '#ffffff' : edge;
      ctx.fillRect(x - 1, y - 1, w + 2, 16);
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(x, y, w, 14);
      actors.forEach((uid, i) => {
        const u = this.battle.unit(uid);
        if (!u) return;
        const img = u.side === 'party' ? getPortrait(u.key, 'neutral') : enemyThumb(enemyArt(ENEMIES[u.key]!.sprite).canvas);
        if (img) ctx.drawImage(img, x + 1 + i * 13, y + 1, 12, 12);
        // Two of a kind: which one (their squad number, as marked on them).
        const dup = u.side === 'enemy' ? this.dupIndex(u) : 0;
        if (dup) drawText(ctx, String(dup + 1), x + i * 13 + 9, y + 6, { color: '#ffffff' });
      });
      if (hot) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + Math.floor(w / 2) - 1, y + 16, 3, 1);
        ctx.fillRect(x + Math.floor(w / 2), y + 17, 1, 1);
      }
      x += w + 4;
    }
  }


  private renderCutins(ctx: Ctx): void {
    for (const c of this.cutins) {
      if (c.t > c.life) continue;
      const m = MEMBERS[c.key as MemberId];
      const port = getPortrait(c.key, c.face);
      if (!m || !port) continue;
      // Slide in fast, hold, slide back out.
      const inK = Math.min(1, c.t / 8), outK = Math.max(0, (c.t - (c.life - 10)) / 10);
      const k = (1 - (1 - inK) ** 3) * (1 - outK);
      const w = 132, h = 58, y = c.fromLeft ? 132 : 132 + 0;
      const x = c.fromLeft ? Math.round(-w + k * (w + 12)) : Math.round(W - k * (w + 12));
      ctx.fillStyle = 'rgba(10,9,19,0.92)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(c.fromLeft ? x + w - 3 : x, y, 3, h);
      const px = c.fromLeft ? x + w - 58 : x + 8;
      ctx.fillStyle = UI.outline;
      ctx.fillRect(px - 1, y + 4, 50, 50);
      ctx.drawImage(port, px, y + 5, 48, 48);
      drawText(ctx, m.name.toUpperCase(), c.fromLeft ? x + 10 : x + 62, y + 22, { color: m.color });
    }
  }

  private boxX(i: number): number {
    const n = this.battle.party.length;
    const w = 116;
    const total = n * w + (n - 1) * 3;
    return Math.round((W - total) / 2) + i * (w + 3);
  }

  private renderPanel(ctx: Ctx): void {
    const party = this.battle.party;
    party.forEach((p, i) => {
      const dd = this.d(p.uid);
      const m = MEMBERS[p.key as MemberId];
      const active = (this.mode === 'command' || this.mode === 'list' || this.mode === 'target') && this.actor?.uid === p.uid;
      const targeted = this.mode === 'target' && this.targetList[this.targetIdx] === p.uid;
      const x = this.boxX(i) + (dd.shake > 0 ? (dd.shake % 4 < 2 ? 1 : -1) : 0);
      const y = PANEL_Y - (active ? 3 : 0);
      drawWindow(ctx, x, y, 116, 52, { accent: active || targeted ? m.color : '#3a3f6e', plain: !(active || targeted), alpha: 0.94 });
      const down = dd.hp <= 0;
      const ratio = dd.hp / p.base.maxHp;
      // Portrait: the member's face reacts to the fight.
      const face = down || (dd.poseT > 0 && dd.pose === 'hurt') || ratio < 0.3 ? 'hurt' : dd.poseT > 0 && dd.pose === 'victory' ? 'happy' : 'neutral';
      const port = getPortrait(p.key, face);
      ctx.fillStyle = UI.outline;
      ctx.fillRect(x + 4, y + 4, 26, 26);
      if (port) {
        if (down) ctx.globalAlpha = 0.35;
        ctx.drawImage(port, x + 5, y + 5, 24, 24);
        ctx.globalAlpha = 1;
      }
      drawText(ctx, m.name, x + 34, y + 5, { color: down ? UI.disabled : m.color });
      drawText(ctx, down ? 'DOWN' : `Lv${p.level}`, x + 110, y + 5, { color: down ? UI.red : UI.dim, align: 'right' });
      // Queued command mark on the portrait's corner.
      const queued = this.cmds.find((c) => c.actor === p.uid);
      if (queued && (this.mode === 'command' || this.mode === 'list' || this.mode === 'target')) {
        const inCombo = this.comboActors.has(p.uid);
        drawText(ctx, inCombo ? '★' : '•', x + 24, y + 3, { color: inCombo ? UI.amber : UI.green });
      }
      drawText(ctx, 'HP', x + 34, y + 17, { color: UI.dim });
      const shown = Math.max(0, dd.shownHp) / p.base.maxHp;
      drawText(ctx, `${Math.max(0, Math.round(dd.shownHp))}/${p.base.maxHp}`, x + 110, y + 17, { align: 'right', color: ratio < 0.25 && !down ? UI.red : UI.text });
      drawBar(ctx, x + 34, y + 28, 75, 2, shown, hpColor(shown));
      drawLag(ctx, x + 34, y + 28, 75, 2, shown, dd.lagHp / p.base.maxHp);
      if (p.base.maxTp > 0) {
        drawText(ctx, m.tpLabel, x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${Math.round(dd.shownTp)}/${p.base.maxTp}`, x + 110, y + 33, { align: 'right' });
        drawBar(ctx, x + 7, y + 44, 102, 2, dd.shownTp / p.base.maxTp, UI.cyan);
      } else {
        // Rook: skill charges instead of TP, with the same bar (charges left of the full set).
        const known = knownAbilities(state.members[p.key as MemberId]!, 'skill');
        const total = known.reduce((n, id) => n + (p.uses[id] ?? 0), 0);
        const full = known.reduce((n, id) => n + (ABILITIES[id]!.uses ?? 0), 0);
        drawText(ctx, 'SKILL', x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${total}/${full} uses`, x + 110, y + 33, { align: 'right' });
        drawBar(ctx, x + 7, y + 44, 102, 2, full ? total / full : 0, UI.amber);
      }
      // Status: the first ailment tagged on the portrait's lower edge, plus a count.
      let tags = 0;
      for (const st of p.status) {
        const lab = STATUS_LABEL[st.id];
        if (!lab || st.id === 'guard' || st.id === 'cover') continue;
        if (tags++ === 0) {
          ctx.fillStyle = 'rgba(10,9,19,0.85)';
          ctx.fillRect(x + 5, y + 21, measure(lab[0]) + 3, 8);
          drawText(ctx, lab[0], x + 6, y + 21, { color: lab[1], shadow: false });
        }
      }
      if (tags > 1) drawText(ctx, `+${tags - 1}`, x + 8 + measure('WWW'), y + 21, { color: UI.dim, shadow: false });
    });
  }

  /** One or two centred lines in the top slot, where action banners play during a round. */
  private topLine(ctx: Ctx, text: string, color: string = UI.dim, second?: { text: string; color: string }): void {
    // Text wider than the screen wraps onto a second line instead of running off the window.
    const key = `${text}|${second?.text ?? ''}|${color}`;
    if (key !== this.topKey) {
      const maxW = W - 44;
      const lines = wrap(text, maxW).map((l) => ({ l, c: color }));
      const extra = second ? wrap(second.text, maxW).map((l) => ({ l, c: second.color })) : [];
      this.topKey = key;
      this.topLines = [...lines, ...extra];
      this.topW = Math.min(W - 20, Math.max(...this.topLines.map((a) => measure(a.l))) + 24);
    }
    const all = this.topLines, tw = this.topW;
    drawWindow(ctx, (W - tw) / 2, 6, tw, 6 + all.length * 11, { plain: true, accent: second ? second.color : UI.cyan });
    all.forEach((a, i) => {
      drawText(ctx, a.l, W / 2, 10 + i * 11, { align: 'center', color: a.c });
    });
  }

  /** Something is winding up a big move: the round deserves fresh orders, not muscle memory. */
  private telegraphed(): boolean {
    return this.battle.alive('enemy').some((u) => u.memory.breath || u.memory.charging || u.memory.spin || u.memory.surge);
  }

  private renderRoundMenu(ctx: Ctx): void {
    const x = MENU_X, y = PANEL_Y - 60;
    drawWindow(ctx, x, y, 84, 54, { title: `ROUND ${this.battle.round + 1}` });
    this.roundMenu.render(ctx, x + 8, y + 8, 72);
    const help: Record<string, string> = {
      fight: 'Give each crew member orders.',
      repeat: this.telegraphed() ? 'Something big is coming. Give fresh orders.' : 'Repeat last round’s orders.',
      auto: this.setup.boss ? 'Not against a boss. Give orders.' : 'Everyone attacks.',
      run: this.battle.canRun && !this.setup.boss ? 'Try to escape.' : 'You can’t run from this fight.',
    };
    const h = help[this.roundMenu.current?.value ?? ''];
    if (h && !this.banner && !this.message) this.topLine(ctx, h);
  }

  /**
   * Command and ability windows sit in the screen corner on the actor's side. Party sprites
   * never reach the outer 90px, so the acting character is never covered by their own menu.
   */
  private menuX(a: Combatant, w: number): number {
    return this.partyPos(a).x * 2 < W / 2 ? MENU_X : W - MENU_X - w;
  }

  private renderCmdMenu(ctx: Ctx, active = true): void {
    const a = this.actor;
    if (!a) return;
    const h = this.cmdMenu.items.length * 11 + 12;
    const x = this.menuX(a, CMD_W), y = PANEL_Y - h - 6;
    drawWindow(ctx, x, y, CMD_W, h, { accent: MEMBERS[a.key as MemberId].color, title: a.name.toUpperCase(), alpha: active ? 1 : 0.85 });
    this.cmdMenu.render(ctx, x + 7, y + 7, CMD_W - 8, active);
  }

  private renderList(ctx: Ctx): void {
    const a = this.actor;
    if (!a) return;
    // Stacked above the command window, and above the party's heads, so the field stays readable.
    const items = this.listMenu.items;
    const widest = items.reduce((m, it) => Math.max(m, measure(it.label) + (it.right ? measure(it.right) + 12 : 0)), measure('Nothing to use.'));
    const w = Math.min(190, Math.max(120, widest + 30));
    const h = Math.min(this.listMenu.rows, Math.max(1, items.length)) * 11 + 14;
    const cmdTop = PANEL_Y - (this.cmdMenu.items.length * 11 + 12) - 6;
    const x = this.menuX(a, w), y = cmdTop - h - 4;
    const kind = this.listKind === 'item' ? 'Items' : this.listKind === 'skill' ? 'Skills' : this.cmdMenu.items.find((i) => i.value === 'tech')?.label ?? 'Techs';
    drawWindow(ctx, x, y, w, h, { title: `${a.name} · ${kind}`.toUpperCase(), accent: MEMBERS[a.key as MemberId].color });
    this.listMenu.render(ctx, x + 8, y + 8, w - 14, true, 'Nothing to use.');
    const cur = this.listMenu.current;
    if (!cur) return;
    const desc = this.listKind === 'item' ? ITEMS[cur.value]!.desc : ABILITIES[cur.value]!.desc;
    // Combo hint: would this choice pair with an order already given?
    const hint = this.listKind === 'item' ? '' : this.comboHint(cur.value);
    this.topLine(ctx, desc, '#d8d6ec', hint ? { text: hint, color: UI.amber } : undefined);
  }

  private renderTargetInfo(ctx: Ctx): void {
    const uid = this.targetList[this.targetIdx];
    const u = uid !== undefined ? this.battle.unit(uid) : undefined;
    if (!u) return;
    const w = TARGET_INFO_W, x = (W - w) / 2, y = 44;
    if (u.side === 'enemy') {
      // Analyzed: the whole chart. Otherwise what the crew has learned the hard way.
      const weak = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k) : (state.weakSeen[u.key] ?? []);
      const res = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k) : (state.resistSeen[u.key] ?? []);
      const imm = u.analyzed ? (u.immune ?? []) : (state.immuneSeen[u.key] ?? []);
      const notes: [string, string][] = [];
      // Element names as the chips over the enemies write them (ELEMENT_TAG), everywhere.
      if (res.length) notes.push([`RESISTS ${res.map((el) => ELEMENT_TAG[el as Element]).join(' ')}`, '#b8bcd0']);
      if (imm.length) notes.push([`IMMUNE ${imm.map(statusName).join(' ')}`, '#c9b8ff']);
      drawWindow(ctx, x, y, w, 19 + (u.analyzed ? 11 : 0) + notes.length * 10, { plain: true, accent: UI.amber });
      drawText(ctx, u.name, x + 8, y + 5, { color: '#ffd0d0' });
      const bestiary = state.bestiary[u.key] ?? 0;
      if (weak.length) drawText(ctx, fitText(`WEAK ${weak.map((el) => ELEMENT_TAG[el as Element]).join(' ')}`, w - 24 - measure(u.name)), x + w - 8, y + 5, { align: 'right', color: UI.amber });
      else if (!u.analyzed) drawText(ctx, bestiary ? `Defeated ×${bestiary}` : 'Unknown', x + w - 8, y + 5, { align: 'right', color: UI.dim });
      let ny = y + 15;
      if (u.analyzed) {
        drawBar(ctx, x + 8, y + 19, w - 70, 3, u.hp / u.base.maxHp, hpColor(u.hp / u.base.maxHp));
        drawText(ctx, `${u.hp}/${u.base.maxHp}`, x + w - 8, y + 15, { align: 'right', color: UI.dim });
        ny += 11;
      }
      for (const [text, color] of notes) {
        drawText(ctx, fitText(text, w - 16), x + 8, ny, { color });
        ny += 10;
      }
    } else {
      drawWindow(ctx, x, y, w, 19, { plain: true, accent: UI.amber });
      drawText(ctx, u.name, x + 8, y + 5, { color: MEMBERS[u.key as MemberId]?.color ?? UI.text });
      drawText(ctx, `${u.hp}/${u.base.maxHp}`, x + w - 8, y + 5, { align: 'right', color: UI.dim });
    }
  }
}

let bigBandGrad: CanvasGradient | null = null;
