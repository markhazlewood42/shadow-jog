/** Battle presentation: command entry, targeting, event playback, rewards. */
import { buildChar } from '../art/chars';
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
import { drawText, measure } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { Rng, rng as globalRng } from '../engine/rng';
import { equipRegen, grantXp, knownAbilities, type LevelUp } from '../game/party';
import { settings } from '../game/settings';
import { debug } from '../game/debug';
import { removeItem, state, type MemberId } from '../game/state';
import { drawBar, drawWindow, hpColor, UI } from '../ui/draw';
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
  flash: number;
  shake: number;
  hop: number;
  alpha: number;
  dying: number;
  lunge: number;
  hidden: boolean;
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
const PARTY_BOTTOM = 111;

const STATUS_LABEL: Partial<Record<StatusId, [string, string]>> = {
  poison: ['PSN', '#b07cff'], burn: ['BRN', '#ff8a4a'], stun: ['STN', '#ffe07a'], blind: ['BLD', '#8b8fa8'],
  jammed: ['JAM', '#3fe0f0'], exposed: ['EXP', '#ff6fc8'], regen: ['RGN', '#86f08c'], hijacked: ['HAX', '#3fe0f0'],
  atk_up: ['ATK↑', '#ffcc3d'], def_up: ['DEF↑', '#6ff3ff'], res_up: ['RES↑', '#b99bff'], agi_up: ['AGI↑', '#86f08c'],
  atk_down: ['ATK↓', '#ff6b6b'], def_down: ['DEF↓', '#ff6b6b'], agi_down: ['AGI↓', '#ff6b6b'], guard: ['GRD', '#6ff3ff'], lockon: ['LOCK', '#ff3a3a'], cover: ['COVR', '#d8c08a'],
};

const STATUS_WORD: Partial<Record<StatusId, string>> = {
  poison: 'POISONED', burn: 'BURNING', stun: 'STUNNED', blind: 'BLINDED', jammed: 'JAMMED', exposed: 'EXPOSED', regen: 'REGEN',
  hijacked: 'HIJACKED', atk_up: 'ATK UP', def_up: 'DEF UP', res_up: 'RES UP', agi_up: 'AGI UP', atk_down: 'ATK DOWN', def_down: 'DEF DOWN',
  agi_down: 'SLOWED', lockon: 'LOCKED ON', guard: 'GUARD', cover: 'COVERING',
};

export class BattleScene extends Scene<'win' | 'lose' | 'run'> {
  private battle: Battle;
  private world: Surface;
  private bg: BattleBg;
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
  private listMenu = new ListMenu<string>([], 7);
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
  private partyArt = new Map<number, HTMLCanvasElement[]>();
  private dead = new Set<number>();

  constructor(setup: BattleSetup) {
    super();
    this.setup = setup;
    this.bg = battleBg(setup.bg);
    this.world = surface(BW, BHT);
    const party = state.party.map((id, i) => partyCombatant(state.members[id]!, i, i));
    const group = setup.enemies ?? pickGroup(setup.encounter);
    const enemies = enemyParty(group);
    const regen: Record<number, number> = {};
    party.forEach((p) => (regen[p.uid] = equipRegen(state.members[p.key as MemberId]!)));
    this.battle = new Battle(party, enemies, new Rng(globalRng.int(1, 2 ** 30)), {
      canRun: setup.canRun ?? true,
      useItem: (id) => removeItem(id, 1),
      regen,
    });
    for (const u of this.battle.units) this.initDisp(u);
    for (const p of party) {
      const spr = buildChar(LOOKS[p.key as keyof typeof LOOKS]);
      this.partyArt.set(p.uid, spr.frames.up);
    }
  }

  private initDisp(u: Combatant): void {
    this.disp.set(u.uid, { hp: u.hp, tp: u.tp, flash: 0, shake: 0, hop: 0, alpha: u.side === 'enemy' ? 0 : 1, dying: 0, lunge: 0, hidden: false });
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
      for (const e of this.battle.enemies) {
        e.hp = 0;
        this.battle.defeated.push(e.key);
      }
      this.battle.outcome = 'win';
      await this.victory();
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
      { label: 'Repeat', value: 'repeat', enabled: anyOrders },
      { label: 'Auto', value: 'auto' },
      { label: 'Run', value: 'run', enabled: this.battle.canRun && !this.setup.boss },
    ]);
    this.roundMenu.index = 0;
    this.mode = 'round';
  }

  private actors(): Combatant[] {
    return this.battle.party.filter((p) => p.hp > 0);
  }

  private get actor(): Combatant | undefined {
    return this.actors()[this.actorIdx];
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
    this.fx.update();
    if (this.fx.flash) {
      this.game.flash(this.fx.flash.color, this.fx.flash.frames);
      this.fx.flash = null;
    }
    if (this.fx.shake && settings.shake) {
      this.game.shake(this.fx.shake, 3);
    }
    this.fx.shake = 0;
    for (const dd of this.disp.values()) {
      if (dd.flash > 0) dd.flash--;
      if (dd.shake > 0) dd.shake--;
      if (dd.hop > 0) dd.hop = Math.max(0, dd.hop - 0.6);
      if (dd.lunge > 0) dd.lunge = Math.max(0, dd.lunge - 0.5);
      if (dd.dying > 0) {
        dd.dying++;
        dd.alpha = Math.max(0, 1 - dd.dying / 28);
      }
    }
    for (const f of this.floaters) f.t++;
    this.floaters = this.floaters.filter((f) => f.t < 50);
    if (this.banner) {
      this.banner.t++;
      if (this.banner.t > (this.banner.big ? 70 : 60)) this.banner = null;
    }
    if (this.message) {
      this.message.t++;
      if (this.message.t > 90) this.message = null;
    }
    const inp = this.game.input;
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

  private async playEvent(e: BattleEvent): Promise<void> {
    switch (e.t) {
      case 'act': {
        const actor = this.battle.unit(e.actor)!;
        const dd = this.d(e.actor);
        const color = actor.side === 'party' ? MEMBERS[actor.key as MemberId].color : '#ff8a8a';
        this.showBanner(e.kind === 'attack' || e.name === 'Attack' ? `${actor.name}` : `${actor.name}: ${e.name}`, color);
        if (actor.side === 'party') {
          dd.hop = 8;
          sfx(e.kind === 'tech' ? 'cast' : 'swing');
        } else {
          dd.flash = 8;
          dd.lunge = 5;
          sfx('enemy_act');
        }
        const cry = e.kind === 'enemy' ? ABILITIES[Object.keys(ABILITIES).find((k) => ABILITIES[k]!.name === e.name) ?? '']?.cry : undefined;
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
        for (const a of e.actors) this.d(a).hop = 10;
        sfx('combo');
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
        const p = this.pos(e.target);
        if (e.amount === 0) this.float('NO EFFECT', p, '#8b8fa8', false);
        else {
          this.float(String(e.amount), p, e.crit ? '#ffe07a' : e.weak ? '#ffa24a' : e.resist ? '#b8bcd0' : u.side === 'party' ? '#ff9a9a' : '#ffffff', true);
          if (e.crit) this.float('CRITICAL', { x: p.x, y: p.y - 10 }, '#ffe07a', false);
          else if (e.weak) this.float('WEAK!', { x: p.x, y: p.y - 10 }, '#ffa24a', false);
          else if (e.resist) this.float('RESIST', { x: p.x, y: p.y - 10 }, '#b8bcd0', false);
        }
        sfx(e.crit ? 'crit' : u.side === 'party' ? 'hurt' : 'hit');
        if (e.crit && settings.shake) this.game.shake(8, 3);
        await this.w(14);
        break;
      }
      case 'miss':
        this.float('MISS', this.pos(e.target), '#b8bcd0', false);
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
          if (e.on) sfx(e.status.endsWith('_up') || e.status === 'regen' ? 'buff' : 'debuff');
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
          this.say('Couldn\'t get away!');
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
        if (settings.shake) this.game.shake(30, 4);
        this.showBanner(`${e.name}!`, '#b89aff', true);
        dd.hp = e.hp;
        dd.alpha = 0;
        dd.dying = 0;
        music('boss2', 0);
        for (let t = 0; t < 30; t++) {
          dd.alpha = t / 30;
          await this.game.wait(1);
        }
        await this.w(20);
        break;
      }
      case 'analyze': {
        const u = this.battle.unit(e.target)!;
        const weak = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k.toUpperCase());
        const res = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k.toUpperCase());
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
  private async victory(): Promise<void> {
    this.mode = 'end';
    music(this.setup.boss ? 'victory_boss' : 'victory', 0);
    const living = this.battle.party.filter((p) => p.hp > 0);
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
        dropNames.forEach((n, i) => drawText(ctx, n, x + 54, y + 42 + i * 11, { color: UI.cyan }));
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
        gains.forEach(([k, v], i) => drawText(ctx, `${k.toUpperCase()} {g}+${v}{/}`, x + 14 + (i % 2) * 100, y + 30 + Math.floor(i / 2) * 11));
        const ly = y + 34 + Math.ceil(gains.length / 2) * 11;
        u.learned.forEach((id, i) => drawText(ctx, `Learned {c}${ABILITIES[id]!.name}{/}!`, x + 14, ly + i * 11));
        if (this.frame % 40 < 28) drawText(ctx, '▼', x + w - 16, y + h - 13, { color: UI.cyan });
      });
    }
    state.battles++;
    this.close('win');
  }

  private async defeat(): Promise<void> {
    this.mode = 'end';
    music('gameover', 0);
    this.say('The crew has fallen…');
    await this.w(debug.autoLose ? 2 : 90);
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
  private layoutKey = '';
  private layoutVersion = 0;

  /** Enemy placement, recomputed only when the roster changes (deaths, summons, phase shifts). */
  private enemyPos(u: Combatant): { x: number; y: number; art: EnemyArt } {
    const key = `${this.battle.units.length}:${this.dead.size}:${this.layoutVersion}`;
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
        const ground = e.key === 'lurker' ? this.bg.ground - 4 : this.bg.ground;
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
      p = { x: Math.round((BW - art.canvas.width) / 2), y: this.bg.ground - art.canvas.height, art };
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
    return { x: Math.round(BW / 2 + (i - (n - 1) / 2) * 44), y: PARTY_BOTTOM - 20 };
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
    const enemies = this.battle.enemies.filter((e) => this.d(e.uid).alpha > 0.01);
    enemies.sort((a, b) => this.enemyPos(a).y + this.enemyPos(a).art.canvas.height - (this.enemyPos(b).y + this.enemyPos(b).art.canvas.height));
    for (const e of enemies) this.drawEnemy(g, e, f);
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
      const rise = fl.big ? Math.min(8, fl.t * 1.2) - Math.max(0, fl.t - 10) * 0 : fl.t * 0.4;
      const bounce = fl.big && fl.t < 12 ? Math.abs(Math.sin(fl.t * 0.5)) * 4 : 0;
      g.globalAlpha = fl.t > 38 ? Math.max(0, 1 - (fl.t - 38) / 12) : 1;
      drawText(g, fl.text, Math.round(fl.x), Math.round(fl.y - rise - bounce), { color: fl.color, align: 'center', shadow: '#0a0913' });
      g.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world.canvas, 0, 0, W, H);
    // Intro shatter
    if (this.setup.intro && this.introT < 30) this.drawShatter(ctx);
    this.renderUi(ctx);
  }

  private drawShatter(ctx: Ctx): void {
    const img = this.setup.intro!;
    const t = this.introT;
    const strips = 12;
    const sh = H / strips;
    for (let i = 0; i < strips; i++) {
      const dir = i % 2 ? 1 : -1;
      const dx = dir * Math.pow(t / 30, 2) * W * 1.1;
      ctx.globalAlpha = Math.max(0, 1 - t / 30);
      ctx.drawImage(img, 0, i * sh * (img.height / H), img.width, sh * (img.height / H), dx, i * sh, W, sh);
    }
    ctx.globalAlpha = 1;
  }

  private drawEnemy(g: Ctx, e: Combatant, f: number): void {
    const dd = this.d(e.uid);
    const { x, y, art } = this.enemyPos(e);
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
      g.drawImage(silhouetteCache(art.canvas, k < 0.3 ? '#ffffff' : '#ff4fb0'), dx, dy + (art.canvas.height - hh), art.canvas.width, hh);
      g.globalAlpha = 1;
      return;
    }
    g.globalAlpha = alpha;
    g.drawImage(art.canvas, dx, dy);
    if (this.bg.tintAmt > 0) {
      // Ambient tint: multiply-ish wash using the background light color.
      g.globalAlpha = alpha * this.bg.tintAmt;
      g.drawImage(silhouetteCache(art.canvas, this.bg.tint), dx, dy);
      g.globalAlpha = alpha;
    }
    if (art.glow) g.drawImage(art.glow, dx, dy);
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      g.globalAlpha = 0.85 * alpha;
      g.drawImage(silhouetteCache(art.canvas, '#ffffff'), dx, dy);
    }
    g.globalAlpha = 1;
    // Status pips for enemies
    let sx = dx + art.canvas.width / 2 - 8;
    for (const s of e.status) {
      const lab = STATUS_LABEL[s.id];
      if (!lab || s.id === 'guard') continue;
      g.fillStyle = lab[1];
      g.fillRect(Math.round(sx), dy - 3, 3, 2);
      sx += 4;
    }
  }

  private drawPartyMember(g: Ctx, p: Combatant, f: number): void {
    const dd = this.d(p.uid);
    const frames = this.partyArt.get(p.uid)!;
    const pos = this.partyPos(p);
    const active = (this.mode === 'command' || this.mode === 'list' || this.mode === 'target') && this.actor?.uid === p.uid;
    const down = dd.hp <= 0 && p.hp <= 0;
    let frame = frames[0]!;
    if (active && Math.floor(f / 16) % 2) frame = frames[1]!;
    let ox = 0;
    if (dd.shake > 0) ox = dd.shake % 4 < 2 ? 2 : -2;
    const x = Math.round(pos.x - frame.width / 2 + ox);
    const y = Math.round(PARTY_BOTTOM - frame.height - dd.hop - (active ? 2 : 0) - dd.lunge);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(pos.x - 6, PARTY_BOTTOM - 1, 12, 2);
    if (down) {
      g.globalAlpha = 0.5;
      g.drawImage(silhouetteCache(frame, '#3a3450'), x, y + 6, frame.width, frame.height - 6);
      g.globalAlpha = 1;
      return;
    }
    g.drawImage(frame, x, y);
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      g.globalAlpha = 0.6;
      g.drawImage(silhouetteCache(frame, '#ff5a5a'), x, y);
      g.globalAlpha = 1;
    }
  }

  private drawArrow(g: Ctx, uid: number, f: number): void {
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
      y = PARTY_BOTTOM - 32;
    }
    const b = Math.round(Math.sin(f * 0.25) * 2);
    g.fillStyle = '#0a0913';
    g.fillRect(x - 3, y - 6 + b, 7, 1);
    g.fillStyle = '#ffe07a';
    for (let i = 0; i < 4; i++) g.fillRect(x - 3 + i, y - 5 + b + i, 7 - i * 2, 1);
  }

  // ------------------------------------------------------------------ UI (1x)
  private renderUi(ctx: Ctx): void {
    this.renderPanel(ctx);
    // Top line: action banner or message
    if (this.banner) {
      const b = this.banner;
      const a = b.t < 6 ? b.t / 6 : b.t > (b.big ? 60 : 50) ? Math.max(0, 1 - (b.t - (b.big ? 60 : 50)) / 10) : 1;
      ctx.globalAlpha = a;
      if (b.big) {
        const y = 92;
        const grd = ctx.createLinearGradient(0, 0, W, 0);
        grd.addColorStop(0, 'rgba(10,8,20,0)');
        grd.addColorStop(0.15, 'rgba(10,8,20,0.9)');
        grd.addColorStop(0.85, 'rgba(10,8,20,0.9)');
        grd.addColorStop(1, 'rgba(10,8,20,0)');
        ctx.fillStyle = grd;
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
    if (this.endPanel) this.endPanel(ctx);
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
      drawText(ctx, m.name, x + 7, y + 5, { color: down ? UI.disabled : m.color });
      drawText(ctx, down ? 'DOWN' : `Lv${p.level}`, x + 110, y + 5, { color: down ? UI.red : UI.dim, align: 'right' });
      // Queued command indicator
      const queued = this.cmds.find((c) => c.actor === p.uid);
      if (queued && (this.mode === 'command' || this.mode === 'list' || this.mode === 'target')) {
        const inCombo = this.comboActors.has(p.uid);
        drawText(ctx, inCombo ? '★' : '•', x + 52, y + 5, { color: inCombo ? UI.amber : UI.green });
      }
      const ratio = dd.hp / p.base.maxHp;
      drawText(ctx, 'HP', x + 7, y + 17, { color: UI.dim });
      drawText(ctx, `${Math.max(0, Math.round(dd.hp))}/${p.base.maxHp}`, x + 110, y + 17, { align: 'right', color: ratio < 0.25 && !down ? UI.red : UI.text });
      drawBar(ctx, x + 7, y + 28, 102, 2, ratio, hpColor(ratio));
      if (p.base.maxTp > 0) {
        drawText(ctx, m.tpLabel, x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${dd.tp}/${p.base.maxTp}`, x + 110, y + 33, { align: 'right' });
        drawBar(ctx, x + 7, y + 44, 102, 2, dd.tp / p.base.maxTp, UI.cyan);
      } else {
        // Rook: skill charges instead of TP
        const total = knownAbilities(state.members[p.key as MemberId]!, 'skill').reduce((n, id) => n + (p.uses[id] ?? 0), 0);
        drawText(ctx, 'SKILL', x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${total} uses`, x + 110, y + 33, { align: 'right' });
      }
      // Status tags
      let sx = x + 60;
      for (const s of p.status) {
        const lab = STATUS_LABEL[s.id];
        if (!lab || s.id === 'guard' || s.id === 'cover') continue;
        if (sx > x + 84) break;
        drawText(ctx, lab[0], sx, y + 17, { color: lab[1] });
        sx += measure(lab[0]) + 3;
        break;
      }
    });
  }

  private renderRoundMenu(ctx: Ctx): void {
    const x = 16, y = PANEL_Y - 60;
    drawWindow(ctx, x, y, 84, 54, { title: 'ROUND ' + (this.battle.round + 1) });
    this.roundMenu.render(ctx, x + 8, y + 8, 72);
    const help: Record<string, string> = {
      fight: 'Give each crew member orders.',
      repeat: 'Repeat last round\'s orders.',
      auto: 'Everyone attacks.',
      run: this.battle.canRun && !this.setup.boss ? 'Try to escape.' : 'You can\'t run from this fight.',
    };
    const h = help[this.roundMenu.current?.value ?? ''] ?? '';
    const tw = measure(h) + 16;
    drawWindow(ctx, x + 90, PANEL_Y - 24, tw, 17, { plain: true });
    drawText(ctx, h, x + 98, PANEL_Y - 20, { color: UI.dim });
  }

  private renderCmdMenu(ctx: Ctx, active = true): void {
    const a = this.actor;
    if (!a) return;
    const i = this.battle.party.indexOf(a);
    const x = Math.min(W - 92, this.boxX(i) + 4);
    const h = this.cmdMenu.items.length * 11 + 12;
    const y = PANEL_Y - h - 8;
    drawWindow(ctx, x, y, 86, h, { accent: MEMBERS[a.key as MemberId].color, title: a.name.toUpperCase() });
    this.cmdMenu.render(ctx, x + 7, y + 7, 78, active);
  }

  private renderList(ctx: Ctx): void {
    const x = 118, y = 44, w = 244, h = 7 * 11 + 14;
    drawWindow(ctx, x, y, w, h, { title: this.listKind === 'item' ? 'ITEMS' : this.listKind === 'skill' ? 'SKILLS' : (this.cmdMenu.items.find((i) => i.value === 'tech')?.label ?? 'TECHS').toUpperCase() });
    if (!this.listMenu.items.length) drawText(ctx, 'Nothing to use.', x + 12, y + 10, { color: UI.dim });
    this.listMenu.render(ctx, x + 8, y + 8, w - 14);
    const cur = this.listMenu.current;
    if (!cur) return;
    const desc = this.listKind === 'item' ? ITEMS[cur.value]!.desc : ABILITIES[cur.value]!.desc;
    // Combo hint: would this choice pair with an order already given?
    const hint = this.listKind === 'item' ? '' : this.comboHint(cur.value);
    const dh = hint ? 30 : 19;
    drawWindow(ctx, x, y - dh - 12, w, dh, { plain: true, accent: hint ? UI.amber : UI.cyan });
    drawText(ctx, desc, x + 8, y - dh - 8, { color: '#d8d6ec' });
    if (hint) drawText(ctx, hint, x + 8, y - dh + 3, { color: UI.amber });
  }

  private renderTargetInfo(ctx: Ctx): void {
    const uid = this.targetList[this.targetIdx];
    const u = uid !== undefined ? this.battle.unit(uid) : undefined;
    if (!u) return;
    const w = 190, x = (W - w) / 2, y = 44;
    drawWindow(ctx, x, y, w, u.side === 'enemy' && u.analyzed ? 30 : 19, { plain: true, accent: UI.amber });
    drawText(ctx, u.name, x + 8, y + 5, { color: u.side === 'enemy' ? '#ffd0d0' : MEMBERS[u.key as MemberId]?.color ?? UI.text });
    if (u.side === 'enemy') {
      if (u.analyzed) {
        drawBar(ctx, x + 8, y + 19, w - 70, 3, u.hp / u.base.maxHp, hpColor(u.hp / u.base.maxHp));
        drawText(ctx, `${u.hp}/${u.base.maxHp}`, x + w - 8, y + 15, { align: 'right', color: UI.dim });
        const weak = Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k.toUpperCase());
        if (weak.length) drawText(ctx, `WEAK ${weak.join(' ')}`, x + w - 8, y + 5, { align: 'right', color: UI.amber });
      } else {
        const bestiary = state.bestiary[u.key] ?? 0;
        drawText(ctx, bestiary ? `Defeated ×${bestiary}` : 'Unknown', x + w - 8, y + 5, { align: 'right', color: UI.dim });
      }
    } else {
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

function groupNames(es: Combatant[]): string {
  const counts = new Map<string, number>();
  for (const e of es) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const parts = [...counts.entries()].map(([n, c]) => (c > 1 ? `${c} ${n}s` : n));
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]!;
}

function summarize(names: string[]): string[] {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

const silCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
function silhouetteCache(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let m = silCache.get(src);
  if (!m) silCache.set(src, (m = new Map()));
  let c = m.get(color);
  if (!c) m.set(color, (c = silhouette(src, color)));
  return c;
}

/** Large banner text: the bitmap font drawn at 2× via an offscreen buffer. */
const bigBuf = surface(W, 12);
function drawBig(ctx: Ctx, text: string, cx: number, y: number, color: string): void {
  bigBuf.ctx.clearRect(0, 0, W, 12);
  const w = drawText(bigBuf.ctx, text, 1, 1, { color, shadow: '#1a1020' });
  ctx.drawImage(bigBuf.canvas, 0, 0, w + 3, 12, Math.round(cx - w), y, (w + 3) * 2, 24);
}

function fxSound(fx: string): string {
  if (['slash', 'claw', 'whip', 'arc_cut', 'moonfall', 'flash_step'].includes(fx)) return 'slash';
  if (['gunfire', 'shot', 'target_lock'].includes(fx)) return 'gun';
  if (['lightning', 'zap', 'thunder_rift', 'pyre_storm'].includes(fx)) return 'zap';
  if (['fire', 'fire_all', 'explosion'].includes(fx)) return 'fire';
  if (['code', 'glitch', 'scan', 'ghost_circuit'].includes(fx)) return 'code';
  if (['heal', 'heal_all', 'heal_self', 'revive', 'cleanse', 'tp', 'lifeline'].includes(fx)) return 'heal';
  if (['punch', 'bite', 'crush', 'palm', 'coil', 'rain_hits'].includes(fx)) return 'punch';
  if (['crow', 'spirit_walk', 'dark', 'wail', 'smog'].includes(fx)) return 'spirit';
  if (fx === 'beam') return 'beam';
  if (fx === 'wave') return 'wave';
  return 'hit';
}
