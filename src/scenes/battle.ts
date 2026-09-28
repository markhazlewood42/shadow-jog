/** Battle presentation: command entry, targeting, event playback, rewards. */
import { battler, type Battler, type Pose } from '../art/battlers';
import { getPortrait } from '../art/portraits';
import { battleBg, type BattleBg } from '../art/battlebg';
import { enemyArt, type EnemyArt } from '../art/enemies';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { Battle } from '../battle/engine';
import { FxLayer, type Pt } from '../battle/fx';
import { enemyParty, partyCombatant, writeBack } from '../battle/setup';
import type { Ability, BattleEvent, Combatant, Command, StatusId } from '../battle/types';
import { ABILITIES, COMBOS } from '../data/abilities';
import { ENCOUNTERS, ENEMIES } from '../data/enemies';
import { ITEMS } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS } from '../data/party';
import { silhouette, surface, type Ctx, type Surface } from '../engine/canvas';
import { drawText, fitText, measure, wrap } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { Rng, rng as globalRng } from '../engine/rng';
import { equipRegen, grantXp, knownAbilities, type LevelUp } from '../game/party';
import { settings } from '../game/settings';
import { debug, PLAYTEST_ROUNDS } from '../game/debug';
import { learn, removeItem, state, type MemberId } from '../game/state';
import { bandGradient, drawBar, drawWindow, hpColor, UI } from '../ui/draw';
import { ListMenu, type ListItem } from '../ui/list';

export interface BattleSetup {
  encounter: string;
  enemies?: string[];
  bg: string;
  canRun?: boolean;
  boss?: boolean;
  music?: string;
  intro?: HTMLCanvasElement;
}

type Mode = 'intro' | 'round' | 'command' | 'list' | 'target' | 'play' | 'end';

interface Disp {
  hp: number;
  tp: number;
  /** What the bars and numbers show: eases toward hp/tp so changes read as motion. */
  shownHp: number;
  shownTp: number;
  /** The pale "damage ghost" segment that trails behind a hit. */
  lagHp: number;
  lagHold: number;
  flash: number;
  shake: number;
  hop: number;
  alpha: number;
  dying: number;
  lunge: number;
  hidden: boolean;
  /** Party action pose and how many frames it holds (idle when 0). */
  pose: Pose;
  poseT: number;
  /** Frames of speed afterimages left (Flash Step, Hundred Rain). */
  afterimage: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  t: number;
  color: string;
  big: boolean;
}

const BW = 240, BHT = 135;
const PANEL_Y = 214;
/** Party feet sit well below the panel top (107): an over-the-shoulder view of heads, shoulders and raised arms. */
const PARTY_BOTTOM = 127;
/**
 * Regular enemies stand further back on the floor than the background's ground line, so the
 * party's heads (top ≈ y 81) sit below their feet; bosses stay forward and loom.
 */
const ENEMY_LIFT = 14, BOSS_LIFT = 4;
/** Battle menus hug the screen edge; CMD_W fits "Programs"/"Spirits" plus the cursor. */
const MENU_X = 4, CMD_W = 84;

const STATUS_LABEL: Partial<Record<StatusId, [string, string]>> = {
  poison: ['PSN', '#b07cff'], burn: ['BRN', '#ff8a4a'], stun: ['STN', '#ffe07a'], blind: ['BLD', '#8b8fa8'],
  jammed: ['JAM', '#3fe0f0'], exposed: ['EXP', '#ff6fc8'], regen: ['RGN', '#86f08c'], hijacked: ['HAX', '#3fe0f0'],
  atk_up: ['ATK↑', '#ffcc3d'], def_up: ['DEF↑', '#6ff3ff'], res_up: ['RES↑', '#b99bff'], agi_up: ['AGI↑', '#86f08c'],
  atk_down: ['ATK↓', '#ff6b6b'], def_down: ['DEF↓', '#ff6b6b'], agi_down: ['AGI↓', '#ff6b6b'], guard: ['GRD', '#6ff3ff'], lockon: ['LOCK', '#ff3a3a'], cover: ['COVR', '#d8c08a'],
};

const STATUS_SFX: Partial<Record<StatusId, string>> = {
  poison: 'st_poison', burn: 'st_burn', stun: 'st_stun', blind: 'st_blind', jammed: 'st_jammed', hijacked: 'st_jammed',
};

/** A status id as the crew would say it. */
function statusName(st: string): string {
  return st === 'hijacked' ? 'HIJACK' : st.replace('_', ' ').toUpperCase();
}

/** Offsets and opacity of the speed ghosts behind a dashing party member. */
const AFTERIMAGES: [number, number, number][] = [[-7, 5, 0.35], [7, 9, 0.22], [0, 13, 0.14]];

/** Short element tags and colours for the weakness readout. */
const ELEMENTS = ['phys', 'fire', 'shock', 'cyber', 'mana'] as const;
const ELEMENT_TAG: Record<(typeof ELEMENTS)[number], string> = { phys: 'PHYS', fire: 'FIRE', shock: 'SHOCK', cyber: 'CYBER', mana: 'MANA' };
const ELEMENT_COLOR: Record<(typeof ELEMENTS)[number], string> = { phys: '#e0dcd0', fire: '#ffa24a', shock: '#9ae8ff', cyber: '#3fe0f0', mana: '#b99bff' };

const STATUS_WORD: Partial<Record<StatusId, string>> = {
  poison: 'POISONED', burn: 'BURNING', stun: 'STUNNED', blind: 'BLINDED', jammed: 'JAMMED', exposed: 'EXPOSED', regen: 'REGEN',
  hijacked: 'HIJACKED', atk_up: 'ATK UP', def_up: 'DEF UP', res_up: 'RES UP', agi_up: 'AGI UP', atk_down: 'ATK DOWN', def_down: 'DEF DOWN',
  agi_down: 'SLOWED', lockon: 'LOCKED ON', guard: 'GUARD', cover: 'COVERING',
};

export class BattleScene extends Scene<'win' | 'lose' | 'run'> {
  private battle: Battle;
  private world: Surface;
  private bg: BattleBg;
  /** Rim-light colour for enemies against this backdrop. */
  private rim: string;
  private fx = new FxLayer();
  private mode: Mode = 'intro';
  private disp = new Map<number, Disp>();
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
  private pending: { type: Command['type']; id?: string; ability: Ability } | null = null;
  private targetList: number[] = [];
  private targetIdx = 0;
  private reserved: Record<string, number> = {};
  // Presentation
  private banner: { text: string; sub?: string; t: number; color: string; big?: boolean } | null = null;
  private message: { text: string; t: number } | null = null;
  private introT = 0;
  private endPanel: ((ctx: Ctx) => void) | null = null;
  private waitingConfirm: (() => void) | null = null;
  private playtestT = 0;
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
    this.battle = new Battle(party, enemies, new Rng(globalRng.int(1, 2 ** 30)), {
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
    this.disp.set(u.uid, { hp: u.hp, tp: u.tp, shownHp: u.hp, shownTp: u.tp, lagHp: u.hp, lagHold: 0, flash: 0, shake: 0, hop: 0, alpha: u.side === 'enemy' ? 0 : 1, dying: 0, lunge: 0, hidden: false, pose: 'idle', poseT: 0, afterimage: 0 });
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
    return [1, 1, 1.5, 2.2][settings.battleSpeed] ?? 1;
  }
  private w(frames: number): Promise<void> {
    const fast = this.game.input.down('confirm') || this.game.input.down('cancel') ? 1.6 : 1;
    return this.game.wait(Math.max(1, Math.round(frames / this.speed() / fast)));
  }

  private async intro(): Promise<void> {
    this.mode = 'intro';
    if (debug.autoLose) {
      for (const p of this.battle.party) p.hp = 0;
      this.battle.outcome = 'lose';
      await this.defeat();
      return;
    }
    if (debug.autoBattle) {
      await this.forceWin();
      return;
    }
    sfx('encounter');
    for (let t = 0; t < 30; t++) {
      this.introT = t;
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
    this.cmds = [];
    this.comboActors.clear();
    this.reserved = {};
    this.actorIdx = -1;
    const anyOrders = state.party.some((id) => state.lastOrders[id]);
    this.roundMenu.setItems([
      { label: 'Fight', value: 'fight' },
      { label: 'Repeat', value: 'repeat', enabled: anyOrders && !this.telegraphed() },
      { label: 'Auto', value: 'auto', enabled: !this.setup.boss },
      { label: 'Run', value: 'run', enabled: this.battle.canRun && !this.setup.boss },
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
    const m = state.members[a.key as MemberId]!;
    const techs = knownAbilities(m, 'tech');
    const skills = knownAbilities(m, 'skill');
    const items: ListItem<string>[] = [{ label: 'Attack', value: 'attack' }];
    if (techs.length) items.push({ label: MEMBERS[a.key as MemberId].tpLabel === 'KI' ? 'Ki Arts' : a.key === 'hex' ? 'Programs' : 'Spirits', value: 'tech' });
    if (skills.length) items.push({ label: 'Skills', value: 'skill' });
    items.push({ label: 'Item', value: 'item', enabled: this.battleItems().length > 0 });
    items.push({ label: 'Guard', value: 'guard' });
    this.cmdMenu.setItems(items);
    this.cmdMenu.index = 0;
  }

  private battleItems(): string[] {
    return Object.keys(state.inventory).filter((id) => ITEMS[id]?.battle && (state.inventory[id] ?? 0) - (this.reserved[id] ?? 0) > 0);
  }

  private openList(kind: 'tech' | 'skill' | 'item'): void {
    const a = this.actor!;
    const m = state.members[a.key as MemberId]!;
    this.listKind = kind;
    let items: ListItem<string>[];
    if (kind === 'item') {
      items = this.battleItems().map((id) => ({ label: ITEMS[id]!.name, value: id, right: `×${(state.inventory[id] ?? 0) - (this.reserved[id] ?? 0)}` }));
    } else {
      items = knownAbilities(m, kind).map((id) => {
        const ab = ABILITIES[id]!;
        const ok = kind === 'tech' ? a.tp >= (ab.cost ?? 0) : (a.uses[id] ?? 0) > 0;
        const right = kind === 'tech' ? `${ab.cost} ${MEMBERS[a.key as MemberId].tpLabel}` : `${a.uses[id] ?? 0}/${ab.uses}`;
        return { label: ab.name, value: id, right, enabled: ok };
      });
    }
    this.listMenu.setItems(items);
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
    this.targetIdx = Math.max(0, ab.target === 'ally' ? this.targetList.indexOf(this.mostHurt()) : 0);
    this.mode = 'target';
  }

  private mostHurt(): number {
    const alive = this.battle.party.filter((p) => p.hp > 0);
    return [...alive].sort((x, y) => x.hp / x.base.maxHp - y.hp / y.base.maxHp)[0]?.uid ?? -1;
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
    this.comboActors.clear();
    for (const c of Battle.findCombos(this.cmds, this.battle.units)) {
      this.comboActors.add(c.a.actor);
      this.comboActors.add(c.b.actor);
    }
    this.hintKey = '';
  }

  /** Would choosing `id` now fuse with an order already given? Cached per cursor position. */
  private comboHint(id: string): string {
    const actor = this.actor;
    if (!actor || this.listKind === 'item') return '';
    const key = `${actor.uid}:${this.listKind}:${id}:${this.cmds.length}`;
    if (key === this.hintKey) return this.hintText;
    this.hintKey = key;
    const trial = [...this.cmds, { actor: actor.uid, type: this.listKind, id, target: -1 } as Command];
    const combos = Battle.findCombos(trial, this.battle.units).filter((c) => c.a.actor === actor.uid || c.b.actor === actor.uid);
    this.hintText = !combos.length ? '' : state.combos.includes(combos[0]!.combo) ? `★ COMBO: ${ABILITIES[combos[0]!.combo]!.name}` : '★ Something resonates… (combo!)';
    return this.hintText;
  }

  private enemiesByX(): Combatant[] {
    return this.battle.alive('enemy').sort((x, y) => this.enemyPos(x).x - this.enemyPos(y).x);
  }

  private autoCommands(): Command[] {
    return this.actors().map((a) => ({ actor: a.uid, type: 'attack' as const, target: -1 }));
  }

  private repeatCommands(): Command[] {
    const out: Command[] = [];
    const reserved: Record<string, number> = {};
    for (const a of this.actors()) {
      const o = state.lastOrders[a.key as MemberId];
      let cmd: Command = { actor: a.uid, type: 'attack', target: -1 };
      if (o && o.cmd !== 'run') {
        if (o.cmd === 'tech' && o.id && a.tp >= (ABILITIES[o.id]?.cost ?? 0)) cmd = { actor: a.uid, type: 'tech', id: o.id, target: -1 };
        else if (o.cmd === 'skill' && o.id && (a.uses[o.id] ?? 0) > 0) cmd = { actor: a.uid, type: 'skill', id: o.id, target: -1 };
        else if (o.cmd === 'item' && o.id && (state.inventory[o.id] ?? 0) - (reserved[o.id] ?? 0) > 0) {
          cmd = { actor: a.uid, type: 'item', id: o.id, target: -1 };
          reserved[o.id] = (reserved[o.id] ?? 0) + 1;
        } else if (o.cmd === 'guard') cmd = { actor: a.uid, type: 'guard' };
      }
      out.push(cmd);
    }
    return out;
  }

  // ------------------------------------------------------------------ update
  update(): void {
    this.frame++;
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
    for (const dd of this.disp.values()) {
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
    if (debug.playtest && (this.waitingConfirm || this.mode === 'round')) {
      // Playtest capture: linger on the menu / result panel, then pick Auto / continue.
      if (++this.playtestT > (this.waitingConfirm ? 110 : 40)) {
        this.playtestT = 0;
        if (this.waitingConfirm) {
          const cb = this.waitingConfirm;
          this.waitingConfirm = null;
          cb();
        } else {
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
    const events = this.battle.resolveRound(this.cmds);
    for (const e of events) await this.playEvent(e);
    await this.w(10);
    // Refresh displayed HP/TP to the authoritative values.
    for (const u of this.battle.units) {
      const dd = this.d(u.uid);
      dd.tp = u.tp;
      if (u.hp > 0) dd.hp = u.hp;
    }
    if (debug.playtest && this.battle.outcome !== 'win') {
      // Playtest capture: a few real rounds for the camera, then a guaranteed win so the run keeps moving.
      const low = this.battle.party.some((p) => p.hp < p.base.maxHp * 0.35);
      if (this.battle.outcome === 'lose' || low || this.battle.round >= PLAYTEST_ROUNDS) {
        for (const p of this.battle.party) p.hp = Math.max(p.hp, 1);
        await this.forceWin();
        return;
      }
    }
    const o = this.battle.outcome;
    if (o === 'win') await this.victory();
    else if (o === 'lose') await this.defeat();
    else if (o === 'fled') await this.fled();
    else this.startRound();
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

  private async playEvent(e: BattleEvent): Promise<void> {
    switch (e.t) {
      case 'act': {
        const actor = this.battle.unit(e.actor)!;
        this.lastActor = actor;
        const dd = this.d(e.actor);
        const color = actor.side === 'party' ? MEMBERS[actor.key as MemberId].color : '#ff8a8a';
        this.showBanner(e.kind === 'attack' || e.name === 'Attack' ? `${actor.name}` : `${actor.name}: ${e.name}`, color);
        if (actor.side === 'party') {
          const pose = actionPose(actor.key, e.kind, e.targets.map((t) => this.battle.unit(t)?.side), e.fx);
          dd.lunge = pose === 'attack' || pose === 'thrust' ? 14 : 6;
          this.setPose(actor, pose, 34);
          if (e.fx === 'flash_step' || e.fx === 'rain_hits') dd.afterimage = 22;
          sfx(e.kind === 'tech' ? 'cast' : 'swing');
        } else {
          dd.flash = 8;
          dd.lunge = 5;
          sfx('enemy_act');
        }
        const cry = e.kind === 'enemy' ? ABILITIES[e.id]?.cry : undefined;
        if (cry) this.say(cry);
        await this.w(e.kind === 'attack' ? 8 : 16);
        const timing = this.fx.play(e.fx, this.pos(e.actor), e.targets.map((t) => this.pos(t)), e.element === 'shock' ? '#9ae8ff' : undefined);
        sfx(fxSound(e.fx));
        await this.w(timing.impact);
        break;
      }
      case 'combo': {
        const names = e.actors.map((a) => this.battle.unit(a)!.name).join(' + ');
        const first = !state.combos.includes(this.comboId(e.name));
        if (first) state.combos.push(this.comboId(e.name));
        for (const a of e.actors) {
          this.d(a).hop = 10;
          const u = this.battle.unit(a)!;
          if (u.side === 'party') this.setPose(u, u.key === 'hex' || u.key === 'sable' ? 'cast' : 'attack', 70);
        }
        sfx('combo');
        // Each combo lands with its own voice under the shared fanfare.
        const sting = COMBO_STING[this.comboId(e.name)];
        if (sting) void this.game.wait(10).then(() => sfx(sting));
        e.actors.forEach((a, i) => {
          const u = this.battle.unit(a)!;
          if (u.side === 'party') this.cutins.push({ key: u.key, face: 'angry', t: 0, fromLeft: i === 0, life: 70 });
        });
        this.banner = { text: `★ ${e.name.toUpperCase()} ★`, sub: first ? `${names}  —  COMBO DISCOVERED!` : names, t: 0, color: '#ffe07a', big: true };
        this.game.flash('#ffffff', 6);
        await this.w(40);
        const timing = this.fx.play(e.fx, this.pos(e.actors[0]!), e.targets.map((t) => this.pos(t)));
        sfx(fxSound(e.fx));
        await this.w(timing.impact);
        break;
      }
      case 'damage': {
        const dd = this.d(e.target);
        const u = this.battle.unit(e.target)!;
        dd.hp = e.hp;
        dd.shake = 12;
        dd.flash = u.side === 'enemy' ? 5 : 8;
        if (u.side === 'party' && e.hp > 0) this.setPose(u, 'hurt', 16);
        const p = this.floatPos(e.target);
        if (e.amount === 0) this.float('NO EFFECT', p, '#8b8fa8', false);
        else {
          this.float(String(e.amount), p, e.crit ? '#ffe07a' : e.weak ? '#ffa24a' : e.resist ? '#b8bcd0' : u.side === 'party' ? '#ff9a9a' : '#ffffff', true);
          if (e.crit) this.float('CRITICAL', { x: p.x, y: p.y - 10 }, '#ffe07a', false);
          else if (e.weak) this.float('WEAK!', { x: p.x, y: p.y - 10 }, '#ffa24a', false);
          else if (e.resist) this.float('RESIST', { x: p.x, y: p.y - 10 }, '#b8bcd0', false);
          // Field notes: what the crew learns the hard way sticks (target info, bestiary).
          if (u.side === 'enemy') {
            if (e.weak) learn(state.weakSeen, u.key, e.element);
            else if (e.resist) learn(state.resistSeen, u.key, e.element);
          }
        }
        sfx(e.crit ? 'crit' : u.side === 'party' ? 'hurt' : 'hit');
        // A critical on a boss gets the striker's face.
        if (e.crit && u.boss && this.lastActor?.side === 'party' && !this.cutins.length) {
          this.cutins.push({ key: this.lastActor.key, face: 'smirk', t: 0, fromLeft: true, life: 45 });
        }
        // Weight by share of the target's max HP: light taps barely move the camera, big hits stop time.
        const share = e.amount / u.base.maxHp;
        const tier = e.crit || share >= 0.4 ? 3 : share >= 0.2 ? 2 : share >= 0.08 ? 1 : 0;
        if (tier) this.game.shake(4 + tier * 3, tier + 1 + (e.crit ? 1 : 0));
        if (tier >= 2) {
          this.hitstop = tier === 3 ? 5 : 3;
          await this.game.wait(this.hitstop);
        }
        await this.w(14);
        break;
      }
      case 'miss':
        this.float('MISS', this.floatPos(e.target), '#b8bcd0', false);
        sfx('miss');
        await this.w(14);
        break;
      case 'heal':
        this.d(e.target).hp = e.hp;
        this.float(`+${e.amount}`, this.pos(e.target), '#86f08c', true);
        sfx('heal');
        await this.w(12);
        break;
      case 'tp':
        this.d(e.target).tp = e.tp;
        this.float(`+${e.amount} TP`, this.pos(e.target), '#6ff3ff', false);
        sfx('heal');
        await this.w(12);
        break;
      case 'status': {
        const word = STATUS_WORD[e.status];
        if (word && e.status !== 'guard' && e.status !== 'cover') {
          const col = STATUS_LABEL[e.status]?.[1] ?? '#ffffff';
          if (e.on) this.float(word, { x: this.pos(e.target).x, y: this.pos(e.target).y - 6 }, col, false);
          if (e.on) sfx(STATUS_SFX[e.status] ?? (e.status.endsWith('_up') || e.status === 'regen' ? 'buff' : 'debuff'));
          await this.w(e.on ? 12 : 2);
        }
        break;
      }
      case 'down': {
        const u = this.battle.unit(e.target)!;
        const dd = this.d(e.target);
        dd.hp = 0;
        if (u.side === 'enemy') {
          dd.flash = 10;
          dd.dying = 1;
          sfx('enemy_die');
          this.dead.add(u.uid);
          state.bestiary[u.key] = (state.bestiary[u.key] ?? 0) + 1;
        } else {
          sfx('ko');
          this.say(`${u.name} is down!`);
        }
        await this.w(u.side === 'enemy' ? 16 : 26);
        break;
      }
      case 'revive':
        this.d(e.target).hp = e.hp;
        this.float('REVIVED', this.pos(e.target), '#ffe07a', false);
        sfx('revive');
        await this.w(18);
        break;
      case 'msg':
        this.say(e.text);
        await this.w(40);
        break;
      case 'immune': {
        const u = this.battle.unit(e.target)!;
        this.float('IMMUNE', this.floatPos(e.target), '#c9b8ff', false);
        if (u.side === 'enemy') learn(state.immuneSeen, u.key, e.status);
        this.say(`${u.name} is immune to ${statusName(e.status)}.`);
        sfx('miss');
        await this.w(24);
        break;
      }
      case 'fail':
        this.say(e.reason);
        this.d(e.actor).shake = 6;
        await this.w(32);
        break;
      case 'flee':
        if (e.ok) {
          this.say('The crew slips away!');
          sfx('flee');
          for (const p of this.battle.party) this.d(p.uid).hidden = false;
        } else {
          this.say('Couldn’t get away!');
          sfx('buzz');
        }
        await this.w(40);
        break;
      case 'summon':
        for (const uid of e.uids) {
          const u = this.battle.unit(uid)!;
          this.initDisp(u);
        }
        sfx('summon');
        for (let t = 0; t < 20; t++) {
          for (const uid of e.uids) this.d(uid).alpha = t / 20;
          await this.game.wait(1);
        }
        await this.w(10);
        break;
      case 'phase': {
        this.layoutVersion++;
        const dd = this.d(e.target);
        sfx('phase');
        this.game.flash('#ffffff', 20);
        this.game.shake(30, 4);
        this.showBanner(`${e.name}!`, '#b89aff', true);
        dd.hp = e.hp;
        dd.alpha = 0;
        dd.dying = 0;
        music(null, 10);
        for (let t = 0; t < 30; t++) {
          dd.alpha = t / 30;
          await this.game.wait(1);
        }
        music('boss2', 0, 1.6);
        await this.w(20);
        break;
      }
      case 'analyze': {
        const u = this.battle.unit(e.target)!;
        const weak = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k.toUpperCase());
        const res = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k.toUpperCase());
        // Analyze writes what it finds into the crew's notes (bestiary, target cursor).
        if (u.side === 'enemy') {
          for (const el of weak) learn(state.weakSeen, u.key, el.toLowerCase());
          for (const el of res) learn(state.resistSeen, u.key, el.toLowerCase());
          for (const st of u.immune ?? []) learn(state.immuneSeen, u.key, st);
        }
        this.say(`${u.name}: HP ${u.hp}/${u.base.maxHp}${weak.length ? `  WEAK ${weak.join(' ')}` : ''}${res.length ? `  RESISTS ${res.join(' ')}` : ''}`);
        await this.w(70);
        break;
      }
      case 'tick': {
        const dd = this.d(e.target);
        dd.hp = e.hp;
        dd.shake = 6;
        const col = STATUS_LABEL[e.status]?.[1] ?? '#ffffff';
        this.float(String(e.amount), this.pos(e.target), col, true);
        sfx('tick');
        await this.w(12);
        break;
      }
      case 'turn':
        break;
    }
  }

  private comboId(name: string): string {
    return COMBOS.find((c) => ABILITIES[c.id]?.name === name)?.id ?? name;
  }

  private float(text: string, p: Pt, color: string, big: boolean): void {
    // Stack floaters that land on the same spot.
    const near = this.floaters.filter((f) => Math.abs(f.x - p.x) < 8 && f.t < 20).length;
    this.floaters.push({ text, x: p.x, y: p.y - 8 - near * 9, t: 0, color, big });
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
    for (let i = 0; i < 3; i++) {
      for (const p of living) this.d(p.uid).hop = 6;
      await this.game.wait(14);
    }
    const r = this.battle.rewards();
    state.cred += r.cred;
    for (const id of r.drops) state.inventory[id] = Math.min(99, (state.inventory[id] ?? 0) + 1);
    // Write back first so level-ups apply to the post-battle HP.
    this.writeBack();
    const ups: LevelUp[] = [];
    for (const p of living) ups.push(...grantXp(state.members[p.key as MemberId]!, r.xp));
    const dropNames = summarize(r.drops.map((id) => ITEMS[id]!.name));
    await this.panel((ctx) => {
      const w = 260, h = 70 + dropNames.length * 11;
      const x = (W - w) / 2, y = 60;
      drawWindow(ctx, x, y, w, h, { title: 'VICTORY', accent: UI.amber });
      drawText(ctx, `{y}${r.xp}{/} XP each`, x + 14, y + 14);
      drawText(ctx, `{y}${r.cred.toLocaleString('en-US')}¢{/} cred`, x + 14, y + 26);
      drawText(ctx, `Wallet: ${state.cred.toLocaleString('en-US')}¢`, x + w - 14, y + 26, { color: UI.dim, align: 'right' });
      if (dropNames.length) {
        drawText(ctx, 'Found:', x + 14, y + 42, { color: UI.dim });
        dropNames.forEach((n, i) => {
          drawText(ctx, n, x + 54, y + 42 + i * 11, { color: UI.cyan });
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
          drawText(ctx, `Learned {c}${ABILITIES[id]!.name}{/}!`, x + 14, ly + i * 11);
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
    await this.w(debug.autoLose ? 2 : 55);
    music('gameover', 0);
    this.say('The crew has fallen…');
    await this.w(debug.autoLose ? 2 : 80);
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
    if (debug.autoBattle) return Promise.resolve();
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
        next.set(e.uid, { x, y: ground - art.canvas.height - back, art });
        x += art.canvas.width + gap;
      });
      // The fallen keep their last spot while they dissolve.
      for (const e of this.battle.enemies) if (!next.has(e.uid) && prev.has(e.uid)) next.set(e.uid, prev.get(e.uid)!);
      this.layout = next;
    }
    let p = this.layout.get(u.uid);
    if (!p) {
      const art = enemyArt(ENEMIES[u.key]!.sprite);
      p = { x: Math.round((BW - art.canvas.width) / 2), y: this.bg.ground - (u.boss ? BOSS_LIFT : ENEMY_LIFT) - art.canvas.height, art };
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
    order.sort((a, b) => this.feetY(a) - this.feetY(b));
    for (const e of order) this.drawEnemy(g, e, f);
    // Party (back view)
    for (const p of this.battle.party) this.drawPartyMember(g, p, f);
    this.fx.render(g, (c, ch, x, y, col) => drawText(c, ch, x, y, { color: col, shadow: false }));
    // Targeting arrows (world space)
    if (this.mode === 'target') {
      const t = this.targetList[this.targetIdx];
      if (t !== undefined) this.drawArrow(g, t, f);
    }
    // Floaters
    for (const fl of this.floaters) {
      // Damage numbers pop up with a decaying bounce, then hold and drift; small text just rises.
      const rise = fl.big ? 8 * (1 - (1 - Math.min(1, fl.t / 8)) ** 3) + Math.max(0, fl.t - 24) * 0.15 : fl.t * 0.4;
      const bounce = fl.big && fl.t >= 8 && fl.t < 20 ? Math.abs(Math.sin((fl.t - 8) * 0.52)) * 3 * (1 - (fl.t - 8) / 12) : 0;
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
    if (this.setup.intro && this.introT < 30) this.drawShatter(ctx);
    this.renderUi(ctx);
  }

  /** Shards of the field snapshot: a jittered triangle mesh, each flying out from the centre. */
  private shards: { pts: [number, number][]; cx: number; cy: number; vx: number; vy: number; spin: number }[] | null = null;

  private buildShards(): void {
    const cols = 9, rows = 5;
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const grid: [number, number][][] = [];
    for (let j = 0; j <= rows; j++) {
      grid.push([]);
      for (let i = 0; i <= cols; i++) {
        const edge = i === 0 || j === 0 || i === cols || j === rows;
        const jx = edge ? 0 : (rnd() - 0.5) * (W / cols) * 0.7;
        const jy = edge ? 0 : (rnd() - 0.5) * (H / rows) * 0.7;
        grid[j]!.push([(i * W) / cols + jx, (j * H) / rows + jy]);
      }
    }
    this.shards = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = grid[j]![i]!, b = grid[j]![i + 1]!, c = grid[j + 1]![i + 1]!, d = grid[j + 1]![i]!;
        const tris = (i + j) % 2 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const pts of tris as [number, number][][]) {
          const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
          const dx = cx - W / 2, dy = cy - H / 2, len = Math.hypot(dx, dy) || 1;
          const sp = 3 + rnd() * 4;
          this.shards.push({ pts, cx, cy, vx: (dx / len) * sp, vy: (dy / len) * sp - 2 - rnd() * 2, spin: (rnd() - 0.5) * 0.3 });
        }
      }
  }

  private drawShatter(ctx: Ctx): void {
    const img = this.setup.intro!;
    const t = this.introT;
    if (!this.shards) this.buildShards();
    const CRACK = 6;
    if (t < CRACK) {
      // The frame freezes and cracks spread from the centre along the shard seams.
      ctx.drawImage(img, 0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      const reach = ((t + 1) / CRACK) * Math.hypot(W, H) * 0.55;
      ctx.beginPath();
      for (const sh of this.shards!) {
        if (Math.hypot(sh.cx - W / 2, sh.cy - H / 2) > reach) continue;
        const [p0, p1, p2] = sh.pts;
        ctx.moveTo(p0![0], p0![1]);
        ctx.lineTo(p1![0], p1![1]);
        ctx.lineTo(p2![0], p2![1]);
        ctx.closePath();
      }
      ctx.stroke();
      return;
    }
    const k = t - CRACK;
    ctx.globalAlpha = Math.max(0, 1 - k / 24);
    for (const sh of this.shards!) {
      const ox = sh.vx * k, oy = sh.vy * k + 0.35 * k * k;
      ctx.save();
      ctx.translate(sh.cx + ox, sh.cy + oy);
      ctx.rotate(sh.spin * k);
      ctx.beginPath();
      ctx.moveTo(sh.pts[0]![0] - sh.cx, sh.pts[0]![1] - sh.cy);
      ctx.lineTo(sh.pts[1]![0] - sh.cx, sh.pts[1]![1] - sh.cy);
      ctx.lineTo(sh.pts[2]![0] - sh.cx, sh.pts[2]![1] - sh.cy);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, -sh.cx, -sh.cy, W, H);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private feetY(e: Combatant): number {
    const p = this.enemyPos(e);
    return p.y + p.art.canvas.height;
  }

  /** 0 for the first enemy of its kind in this fight, 1 for the second, ... */
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
    const who = dup ? enemyArt(ENEMIES[e.key]!.sprite, dup) : art;
    const flip = (c: HTMLCanvasElement) => (dup % 2 ? mirrored(c) : c);
    const canvas = who.individual ? flip(who.canvas) : variant(art.canvas, dup);
    const glow = who.individual ? who.glow && flip(who.glow) : art.glow && variant(art.glow, dup);
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
      // Dissolve: shrink vertically and fade with a white flash.
      const k = Math.min(1, dd.dying / 28);
      g.globalAlpha = Math.max(0, 1 - k);
      const hh = Math.round(art.canvas.height * (1 - k * 0.5));
      g.drawImage(silhouetteCache(canvas, k < 0.3 ? '#ffffff' : '#ff4fb0'), dx, dy + (art.canvas.height - hh), art.canvas.width, hh);
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
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      g.globalAlpha = 0.85 * alpha;
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
      g.globalAlpha = 0.6;
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
      ctx.fillStyle = 'rgba(10,9,19,0.85)';
      ctx.fillRect(cx0 - bw / 2 - 1, row - 1, bw + 2, 4);
      ctx.fillStyle = hpColor(ratio);
      ctx.fillRect(cx0 - bw / 2, row, Math.round(bw * ratio), 2);
      drawLag(ctx, cx0 - bw / 2, row, bw, 2, ratio, dd.lagHp / e.base.maxHp);
      row -= 11;
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
          ctx.fillStyle = 'rgba(10,9,19,0.85)';
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
      ctx.fillStyle = 'rgba(10,9,19,0.85)';
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
    this.renderCutins(ctx);
    if (this.endPanel) this.endPanel(ctx);
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
        // Rook: skill charges instead of TP
        const total = knownAbilities(state.members[p.key as MemberId]!, 'skill').reduce((n, id) => n + (p.uses[id] ?? 0), 0);
        drawText(ctx, 'SKILL', x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${total} uses`, x + 110, y + 33, { align: 'right' });
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

  /** A boss is winding up a big move: the round deserves fresh orders, not muscle memory. */
  private telegraphed(): boolean {
    return this.battle.alive('enemy').some((u) => u.boss && (u.memory.breath || u.memory.charging));
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
    const w = 190, x = (W - w) / 2, y = 44;
    if (u.side === 'enemy') {
      // Analyzed: the whole chart. Otherwise what the crew has learned the hard way.
      const weak = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k) : (state.weakSeen[u.key] ?? []);
      const res = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k) : (state.resistSeen[u.key] ?? []);
      const imm = u.analyzed ? (u.immune ?? []) : (state.immuneSeen[u.key] ?? []);
      const notes: [string, string][] = [];
      if (res.length) notes.push([`RESISTS ${res.map((el) => el.toUpperCase()).join(' ')}`, '#b8bcd0']);
      if (imm.length) notes.push([`IMMUNE ${imm.map(statusName).join(' ')}`, '#c9b8ff']);
      drawWindow(ctx, x, y, w, 19 + (u.analyzed ? 11 : 0) + notes.length * 10, { plain: true, accent: UI.amber });
      drawText(ctx, u.name, x + 8, y + 5, { color: '#ffd0d0' });
      const bestiary = state.bestiary[u.key] ?? 0;
      if (weak.length) drawText(ctx, `WEAK ${weak.map((el) => el.toUpperCase()).join(' ')}`, x + w - 8, y + 5, { align: 'right', color: UI.amber });
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

// ------------------------------------------------------------------ helpers
function pickGroup(encounter: string): string[] {
  const groups = ENCOUNTERS[encounter];
  if (!groups?.length) throw new Error(`Unknown encounter ${encounter}`);
  const total = groups.reduce((n, g) => n + g.w, 0);
  let r = globalRng.next() * total;
  for (const g of groups) {
    r -= g.w;
    if (r <= 0) return g.e;
  }
  return groups[0]!.e;
}

function groupNames(es: readonly Combatant[]): string {
  const counts = new Map<string, number>();
  for (const e of es) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const parts = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c} ${n}s` : n));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]!;
}

function summarize(names: string[]): string[] {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

const silCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
const topCache = new WeakMap<HTMLCanvasElement, number>();
/** First row with any opaque pixel (sprite canvases carry padding); measured once per canvas. */
/** The trailing "damage ghost" between the shown value and where it was a moment ago. */
function drawLag(ctx: Ctx, x: number, y: number, w: number, h: number, shown: number, lag: number): void {
  if (lag <= shown + 0.004) return;
  const a = Math.round(w * Math.max(0, shown)), b = Math.round(w * Math.min(1, lag));
  if (b <= a) return;
  ctx.fillStyle = '#ffd7c0';
  ctx.fillRect(x + a, y, b - a, h);
}

function opaqueTop(c: HTMLCanvasElement): number {
  let top = topCache.get(c);
  if (top === undefined) {
    top = 0;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    scan: for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]! > 0) {
      top = y;
      break scan;
    }
    topCache.set(c, top);
  }
  return top;
}

const flipCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** Horizontally mirrored copy (cached): every other duplicate enemy faces the other way. */
/** Rim-light colour per battle backdrop: a light the enemies catch that the set doesn't have. */
const RIM: Record<string, string> = {
  street: '#ffc27a', barrens: '#9ae8ff', rustyard: '#9ae8ff', park: '#ffd0f0',
  sewer: '#ffcf7a', junction: '#ffcf7a', lab: '#ff6a7a', core: '#8ae8ff',
};

const rimCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
/** A 1px rim on a sprite's top edges and upper sides, on a canvas 2px larger. */
function rimOf(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let m = rimCache.get(src);
  if (!m) {
    m = new Map();
    rimCache.set(src, m);
  }
  let c = m.get(color);
  if (!c) {
    const w = src.width, h = src.height;
    const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
    const op = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 40;
    const s = surface(w + 2, h + 2);
    s.ctx.fillStyle = color;
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        // Light from above: every top edge, and the sides only on the upper half.
        if (op(x, y)) continue;
        if (op(x, y + 1) || (y < h * 0.5 && (op(x - 1, y) || op(x + 1, y)))) s.ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    c = s.canvas;
    m.set(color, c);
  }
  return c;
}

function mirrored(src: HTMLCanvasElement): HTMLCanvasElement {
  let c = flipCache.get(src);
  if (!c) {
    const s = surface(src.width, src.height);
    s.ctx.translate(src.width, 0);
    s.ctx.scale(-1, 1);
    s.ctx.drawImage(src, 0, 0);
    c = s.canvas;
    flipCache.set(src, c);
  }
  return c;
}

/**
 * The n-th copy of an enemy in a fight gets its own look: a shifted palette (and every other
 * copy faces the other way), so a pair reads as two individuals, not twins. Cached per copy.
 */
const variantCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
const VARIANT_FILTERS = ['', 'hue-rotate(32deg) saturate(1.2) brightness(0.9)', 'hue-rotate(-38deg) saturate(1.1) brightness(1.05)', 'hue-rotate(80deg) brightness(0.92)'];
function variant(src: HTMLCanvasElement, dup: number): HTMLCanvasElement {
  if (dup === 0) return src;
  let list = variantCache.get(src);
  if (!list) {
    list = [];
    variantCache.set(src, list);
  }
  let v = list[dup];
  if (!v) {
    const s = surface(src.width, src.height);
    s.ctx.filter = VARIANT_FILTERS[dup % VARIANT_FILTERS.length] || 'none';
    s.ctx.drawImage(dup % 2 ? mirrored(src) : src, 0, 0);
    v = s.canvas;
    list[dup] = v;
  }
  return v;
}

function silhouetteCache(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let m = silCache.get(src);
  if (!m) {
    m = new Map();
    silCache.set(src, m);
  }
  let c = m.get(color);
  if (!c) {
    c = silhouette(src, color);
    m.set(color, c);
  }
  return c;
}

/** Large banner text: the bitmap font drawn at 2× via an offscreen buffer. */
const bigBuf = surface(W, 12);
function drawBig(ctx: Ctx, text: string, cx: number, y: number, color: string): void {
  bigBuf.ctx.clearRect(0, 0, W, 12);
  const w = drawText(bigBuf.ctx, text, 1, 1, { color, shadow: '#1a1020' });
  ctx.drawImage(bigBuf.canvas, 0, 0, w + 3, 12, Math.round(cx - w), y, (w + 3) * 2, 24);
}

let bigBandGrad: CanvasGradient | null = null;

/** A signature sting per combo, layered under the shared combo fanfare. */
const COMBO_STING: Record<string, string> = {
  combo_thunder_rift: 'sting_rift',
  combo_target_lock: 'sting_lock',
  combo_ghost_circuit: 'sting_circuit',
  combo_pyre_storm: 'sting_pyre',
  combo_spirit_walk: 'sting_crow',
  combo_lifeline: 'sting_life',
  combo_crows_wing: 'sting_ward',
};

function fxSound(fx: string): string {
  if (['slash', 'claw', 'whip', 'arc_cut', 'moonfall', 'flash_step'].includes(fx)) return 'slash';
  if (['gunfire', 'shot', 'target_lock'].includes(fx)) return 'gun';
  if (['lightning', 'zap', 'thunder_rift', 'pyre_storm'].includes(fx)) return 'zap';
  if (['fire', 'fire_all', 'explosion'].includes(fx)) return 'fire';
  if (['code', 'glitch', 'scan', 'ghost_circuit'].includes(fx)) return 'code';
  if (['heal', 'heal_all', 'heal_self', 'revive', 'cleanse', 'tp', 'lifeline'].includes(fx)) return 'heal';
  if (['punch', 'bite', 'crush', 'palm', 'coil', 'rain_hits'].includes(fx)) return 'punch';
  if (['crow', 'spirit_walk', 'crows_wing', 'dark', 'wail', 'smog'].includes(fx)) return 'spirit';
  if (fx === 'beam') return 'beam';
  if (fx === 'wave') return 'wave';
  return 'hit';
}

/** Which battle pose a party action plays: blades and fists strike, programs and spirits are cast. */
function actionPose(key: string, kind: Ability['kind'], targets: (string | undefined)[], fx = ''): Pose {
  if (kind === 'item') return 'item';
  if (fx === 'palm' || fx === 'coil') return 'thrust';
  if (fx === 'gunfire' || fx === 'shot') return 'aim';
  if (fx === 'shield' || fx === 'buff' || fx === 'guard' || fx === 'roar' || fx === 'crows_wing') return 'brace';
  if (kind === 'attack' || kind === 'skill') return 'attack';
  const onAllies = targets.length > 0 && targets.every((t) => t === 'party');
  if (key === 'kit' && !onAllies) return 'attack';
  return 'cast';
}
