/** Field menu: party overview plus Items / Techs / Equip / Status / Combos / Save / Options. */
import { buildChar } from '../art/chars';
import { getPortrait } from '../art/portraits';
import { sfx } from '../audio/sfx';
import { ABILITIES, COMBOS } from '../data/abilities';
import { ITEMS, type ItemDef } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS, xpFor } from '../data/party';
import type { Ctx } from '../engine/canvas';
import { drawParagraph, drawText, measure } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { applyEffects } from '../game/fielduse';
import { canEquip, equip, knownAbilities, memberStats } from '../game/party';
import { formatPlayTime, locationName, readMeta, SLOTS, writeSave, type SlotId } from '../game/save';
import { flags, state, type EquipSlot, type MemberId, type MemberState } from '../game/state';
import { drawBar, drawDivider, drawSelect, drawWindow, hpColor, UI } from '../ui/draw';
import { ListMenu, type ListItem } from '../ui/list';
import { OptionsScene } from './options';

/** Combo log entries visible at once (36px each under the header). */
const COMBO_ROWS = 6;

type Mode = 'main' | 'pickMember' | 'items' | 'itemTarget' | 'techs' | 'techTarget' | 'equipSlots' | 'equipList' | 'status' | 'combos' | 'save' | 'saveConfirm';

export type MenuResult = { kind: 'close' } | { kind: 'special'; item: string } | { kind: 'title' };

const SLOT_NAMES: Record<EquipSlot, string> = { weapon: 'Weapon', body: 'Body', head: 'Head', mod: 'Mod' };

export class MenuScene extends Scene<MenuResult> {
  override opaque = false;
  private mode: Mode = 'main';
  private main = new ListMenu<string>([], 8);
  private sub = new ListMenu<string>([], 12);
  private comboScroll = 0;
  private memberIdx = 0;
  private purpose: 'techs' | 'equip' | 'status' = 'status';
  private pendingItem: string | null = null;
  private pendingTech: { user: MemberId; id: string } | null = null;
  private equipSlot: EquipSlot = 'weapon';
  private toast: { text: string; t: number } | null = null;
  private t = 0;
  private saveSlot: SlotId = 1;

  constructor(canSave = true) {
    super();
    this.main.setItems([
      { label: 'Items', value: 'items' },
      { label: 'Techs', value: 'techs' },
      { label: 'Equip', value: 'equip' },
      { label: 'Status', value: 'status' },
      { label: 'Combos', value: 'combos' },
      { label: 'Save', value: 'save', enabled: canSave },
      { label: 'Options', value: 'options' },
      { label: 'Close', value: 'close' },
    ]);
  }

  override enter(): void {
    sfx('confirm');
  }

  private get members(): MemberState[] {
    return state.party.map((id) => state.members[id]!).filter(Boolean);
  }

  private say(text: string): void {
    this.toast = { text, t: 0 };
  }

  // ------------------------------------------------------------------ update
  update(): void {
    this.t++;
    if (this.toast && ++this.toast.t > 120) this.toast = null;
    const inp = this.game.input;
    switch (this.mode) {
      case 'main': {
        const r = this.main.update(inp);
        if (r === 'cancel' || (r === 'confirm' && this.main.current!.value === 'close') || inp.pressed('menu')) {
          this.close({ kind: 'close' });
          return;
        }
        if (r !== 'confirm') return;
        const v = this.main.current!.value;
        if (v === 'items') this.openItems();
        else if (v === 'techs' || v === 'equip' || v === 'status') {
          this.purpose = v;
          this.mode = 'pickMember';
        } else if (v === 'combos') {
          this.comboScroll = 0;
          this.mode = 'combos';
        }
        else if (v === 'save') {
          this.buildSaveList();
          this.mode = 'save';
        } else if (v === 'options') void this.game.run(new OptionsScene(true)).then((r) => r === 'title' && this.close({ kind: 'title' }));
        break;
      }
      case 'pickMember':
      case 'itemTarget':
      case 'techTarget': {
        const n = this.members.length;
        if (inp.repeat('up')) { this.memberIdx = (this.memberIdx + n - 1) % n; sfx('cursor'); }
        if (inp.repeat('down')) { this.memberIdx = (this.memberIdx + 1) % n; sfx('cursor'); }
        if (inp.pressed('cancel')) {
          sfx('cancel');
          this.mode = this.mode === 'itemTarget' ? 'items' : this.mode === 'techTarget' ? 'techs' : 'main';
          return;
        }
        if (!inp.pressed('confirm')) return;
        const m = this.members[this.memberIdx]!;
        if (this.mode === 'itemTarget') this.useItemOn(m);
        else if (this.mode === 'techTarget') this.useTechOn(m);
        else if (this.purpose === 'techs') this.openTechs(m);
        else if (this.purpose === 'equip') this.openEquip(m);
        else {
          sfx('confirm');
          this.mode = 'status';
        }
        break;
      }
      case 'items': {
        const r = this.sub.update(inp);
        if (r === 'cancel') this.mode = 'main';
        else if (r === 'confirm') {
          const id = this.sub.current!.value;
          const it = ITEMS[id]!;
          if (it.special) {
            this.close({ kind: 'special', item: id });
            return;
          }
          this.pendingItem = id;
          if (it.target === 'allies') this.useItemOnAll();
          else this.mode = 'itemTarget';
        }
        break;
      }
      case 'techs': {
        const r = this.sub.update(inp);
        if (r === 'cancel') this.mode = 'pickMember';
        else if (r === 'confirm') {
          const id = this.sub.current!.value;
          const ab = ABILITIES[id]!;
          this.pendingTech = { user: this.members[this.memberIdx]!.id, id };
          if (ab.target === 'allies') this.useTechOnAll();
          else if (ab.target === 'self') this.useTechOn(this.members[this.memberIdx]!);
          else this.mode = 'techTarget';
        }
        break;
      }
      case 'equipSlots': {
        const r = this.sub.update(inp);
        if (r === 'cancel') this.mode = 'pickMember';
        else if (r === 'confirm') {
          this.equipSlot = this.sub.current!.value as EquipSlot;
          this.openEquipList();
        }
        break;
      }
      case 'equipList': {
        const r = this.sub.update(inp);
        if (r === 'cancel') {
          this.openEquip(this.members[this.memberIdx]!);
          return;
        }
        if (r === 'confirm') {
          const v = this.sub.current!.value;
          const m = this.members[this.memberIdx]!;
          equip(m, v === '__none' ? null : v, this.equipSlot);
          sfx('buy');
          this.openEquip(m);
        }
        break;
      }
      case 'status': {
        const n = this.members.length;
        if (inp.repeat('left') || inp.repeat('up')) { this.memberIdx = (this.memberIdx + n - 1) % n; sfx('cursor'); }
        if (inp.repeat('right') || inp.repeat('down')) { this.memberIdx = (this.memberIdx + 1) % n; sfx('cursor'); }
        if (inp.pressed('cancel') || inp.pressed('confirm')) {
          sfx('cancel');
          this.mode = 'pickMember';
        }
        break;
      }
      case 'combos': {
        const max = Math.max(0, COMBOS.length - COMBO_ROWS);
        if (inp.repeat('down') && this.comboScroll < max) { this.comboScroll++; sfx('cursor'); }
        else if (inp.repeat('up') && this.comboScroll > 0) { this.comboScroll--; sfx('cursor'); }
        else if (inp.pressed('cancel') || inp.pressed('confirm')) {
          sfx('cancel');
          this.mode = 'main';
        }
        break;
      }
      case 'save': {
        const r = this.sub.update(inp);
        if (r === 'cancel') this.mode = 'main';
        else if (r === 'confirm') {
          this.saveSlot = Number(this.sub.current!.value) as SlotId;
          if (readMeta(this.saveSlot)) this.mode = 'saveConfirm';
          else this.doSave();
        }
        break;
      }
      case 'saveConfirm':
        if (inp.pressed('confirm')) this.doSave();
        else if (inp.pressed('cancel')) {
          sfx('cancel');
          this.mode = 'save';
        }
        break;
    }
  }

  // ------------------------------------------------------------------ items
  private itemList(): ListItem<string>[] {
    const order: Record<string, number> = { use: 0, weapon: 1, body: 2, head: 3, mod: 4, loot: 5, key: 6 };
    return Object.keys(state.inventory)
      .filter((id) => ITEMS[id] && (state.inventory[id] ?? 0) > 0)
      .sort((a, b) => order[ITEMS[a]!.kind]! - order[ITEMS[b]!.kind]! || ITEMS[a]!.name.localeCompare(ITEMS[b]!.name))
      .map((id) => {
        const it = ITEMS[id]!;
        const usable = it.kind === 'use' && !!it.field;
        return {
          label: it.name, value: id, right: it.kind === 'key' ? '' : `×${state.inventory[id]}`, enabled: usable,
          icon: kindIcon(it), iconColor: kindColor(it),
        };
      });
  }

  private openItems(): void {
    this.sub.setItems(this.itemList());
    this.sub.rows = 14;
    this.mode = 'items';
  }

  private useItemOn(m: MemberState): void {
    const it = ITEMS[this.pendingItem!]!;
    const r = applyEffects(it.effects ?? [], m, 0, MEMBERS[m.id].name);
    if (!r.ok) {
      sfx('buzz');
      this.say(r.text);
      return;
    }
    sfx('heal_field');
    state.inventory[it.id]! -= 1;
    if (state.inventory[it.id]! <= 0) delete state.inventory[it.id];
    this.say(r.text);
    this.sub.setItems(this.itemList());
    if (!state.inventory[it.id]) this.mode = 'items';
  }

  private useItemOnAll(): void {
    const it = ITEMS[this.pendingItem!]!;
    const texts = this.members.map((m) => applyEffects(it.effects ?? [], m, 0, MEMBERS[m.id].name)).filter((r) => r.ok);
    if (!texts.length) {
      sfx('buzz');
      this.say('It would have no effect.');
      return;
    }
    sfx('heal_field');
    state.inventory[it.id]! -= 1;
    if (state.inventory[it.id]! <= 0) delete state.inventory[it.id];
    this.say('The crew feels better.');
    this.sub.setItems(this.itemList());
  }

  // ------------------------------------------------------------------ techs
  private openTechs(m: MemberState): void {
    const all = [...knownAbilities(m, 'tech'), ...knownAbilities(m, 'skill')];
    if (!all.length) {
      sfx('buzz');
      this.say(`${MEMBERS[m.id].name} relies on steel, not magic.`);
      return;
    }
    sfx('confirm');
    this.sub.setItems(
      all.map((id) => {
        const ab = ABILITIES[id]!;
        const cost = ab.kind === 'tech' ? `${ab.cost} ${MEMBERS[m.id].tpLabel}` : `${m.uses[id] ?? 0}/${ab.uses}`;
        const affordable = ab.kind === 'tech' && m.tp >= (ab.cost ?? 0) && m.hp > 0;
        return { label: ab.name, value: id, right: cost, enabled: !!ab.field && affordable, icon: ab.kind === 'tech' ? '•' : '★', iconColor: ab.kind === 'tech' ? UI.cyan : UI.amber };
      }),
    );
    this.sub.rows = 12;
    this.mode = 'techs';
  }

  private useTechOn(target: MemberState): void {
    const { user, id } = this.pendingTech!;
    const u = state.members[user]!;
    const ab = ABILITIES[id]!;
    if (u.tp < (ab.cost ?? 0)) {
      sfx('buzz');
      this.say('Not enough TP.');
      return;
    }
    const r = applyEffects(ab.effects, target, memberStats(u).mnd, MEMBERS[target.id].name);
    if (!r.ok) {
      sfx('buzz');
      this.say(r.text);
      return;
    }
    u.tp -= ab.cost ?? 0;
    sfx('heal_field');
    this.say(r.text);
    this.openTechs(u);
    this.mode = ab.target === 'self' ? 'techs' : 'techTarget';
  }

  private useTechOnAll(): void {
    const { user, id } = this.pendingTech!;
    const u = state.members[user]!;
    const ab = ABILITIES[id]!;
    if (u.tp < (ab.cost ?? 0)) return;
    const res = this.members.map((m) => applyEffects(ab.effects, m, memberStats(u).mnd, MEMBERS[m.id].name)).filter((r) => r.ok);
    if (!res.length) {
      sfx('buzz');
      this.say('Everyone is already fine.');
      return;
    }
    u.tp -= ab.cost ?? 0;
    sfx('heal_field');
    this.say('Healing rain washes over the crew.');
    this.openTechs(u);
  }

  // ------------------------------------------------------------------ equip
  private openEquip(m: MemberState): void {
    sfx('confirm');
    this.sub.setItems(
      (['weapon', 'body', 'head', 'mod'] as EquipSlot[]).map((slot) => ({
        label: SLOT_NAMES[slot], value: slot, right: m.equip[slot] ? ITEMS[m.equip[slot]!]!.name : '—',
      })),
    );
    this.sub.rows = 4;
    this.mode = 'equipSlots';
  }

  private openEquipList(): void {
    const m = this.members[this.memberIdx]!;
    const items: ListItem<string>[] = Object.keys(state.inventory)
      .filter((id) => ITEMS[id]?.slot === this.equipSlot && (state.inventory[id] ?? 0) > 0)
      .map((id) => ({ label: ITEMS[id]!.name, value: id, right: `×${state.inventory[id]}`, enabled: canEquip(m, id) }));
    if (m.equip[this.equipSlot]) items.push({ label: '(Remove)', value: '__none', color: UI.dim });
    if (!items.length) {
      sfx('buzz');
      this.say('Nothing to equip there.');
      return;
    }
    this.sub.setItems(items);
    this.sub.rows = 8;
    this.mode = 'equipList';
  }

  // ------------------------------------------------------------------ save
  private buildSaveList(): void {
    this.sub.setItems(
      SLOTS.map((s) => {
        const meta = readMeta(s);
        return { label: `Slot ${s}`, value: String(s), right: meta ? `${meta.location} · Lv${meta.leaderLevel} · ${formatPlayTime(meta.playFrames)}` : 'Empty' };
      }),
    );
    this.sub.rows = 3;
  }

  private doSave(): void {
    const ok = writeSave(this.saveSlot, this.game.playFrames);
    if (ok) {
      sfx('save');
      this.say(`Saved to slot ${this.saveSlot}.`);
    } else {
      sfx('buzz');
      this.say('Couldn\'t save — browser storage is unavailable.');
    }
    this.buildSaveList();
    this.mode = 'save';
  }

  // ------------------------------------------------------------------ render
  render(ctx: Ctx): void {
    ctx.fillStyle = 'rgba(7,6,13,0.55)';
    ctx.fillRect(0, 0, W, H);
    if (this.mode === 'status') {
      this.renderStatus(ctx);
      this.renderToast(ctx);
      return;
    }
    if (this.mode === 'combos') {
      this.renderCombos(ctx);
      return;
    }
    // Main command column
    drawWindow(ctx, 8, 8, 92, this.main.items.length * 11 + 14, { title: 'MENU' });
    this.main.render(ctx, 15, 15, 82, this.mode === 'main');
    // Info
    drawWindow(ctx, 8, H - 74, 92, 66, { plain: true });
    drawText(ctx, `{y}${state.cred.toLocaleString('en-US')}¢`, 16, H - 68);
    drawText(ctx, formatPlayTime(this.game.playFrames), 16, H - 56, { color: UI.dim });
    drawParagraph(ctx, locationName(state.map), 16, H - 44, 80, { color: UI.cyan, lineH: 10 });
    const obj = flags.get('objective') as string | undefined;
    if (obj) {
      drawWindow(ctx, 108, H - 30, W - 116, 22, { plain: true, accent: UI.amber });
      drawText(ctx, `{y}▶{/} ${obj}`, 116, H - 24);
    }
    // Right side: party cards or sub-list
    const listModes: Mode[] = ['items', 'techs', 'equipSlots', 'equipList', 'save', 'saveConfirm'];
    if (listModes.includes(this.mode) || this.mode === 'itemTarget' || this.mode === 'techTarget') {
      if (this.mode === 'items' || this.mode === 'itemTarget') this.renderItems(ctx);
      else if (this.mode === 'techs' || this.mode === 'techTarget') this.renderTechs(ctx);
      else if (this.mode === 'equipSlots' || this.mode === 'equipList') this.renderEquip(ctx);
      else this.renderSave(ctx);
      if (this.mode === 'itemTarget' || this.mode === 'techTarget') this.renderCards(ctx, 300, true);
    } else this.renderCards(ctx, 108, this.mode === 'pickMember');
    this.renderToast(ctx);
  }

  private renderToast(ctx: Ctx): void {
    if (!this.toast) return;
    const tw = Math.min(W - 40, measure(this.toast.text) + 20);
    drawWindow(ctx, (W - tw) / 2, 6, tw, 17, { plain: true, accent: UI.green });
    drawText(ctx, this.toast.text, W / 2, 10, { align: 'center' });
  }

  private renderCards(ctx: Ctx, x: number, picking: boolean): void {
    const w = W - x - 8;
    const compact = x > 200;
    const ms = this.members;
    const cardH = compact ? 44 : 50;
    ms.forEach((m, i) => {
      const y = 8 + i * (cardH + 4);
      const sel = picking && i === this.memberIdx;
      const def = MEMBERS[m.id];
      drawWindow(ctx, x, y, w, cardH, { plain: !sel, accent: sel ? def.color : undefined });
      if (sel) drawSelect(ctx, x + 2, y + 2, w - 4, cardH - 4, 'rgba(63,224,240,0.08)');
      const s = memberStats(m);
      const port = getPortrait(m.id, 'neutral');
      if (port && !compact) ctx.drawImage(port, x + 5, y + 5, 40, 40);
      else {
        const spr = buildChar(LOOKS[m.id]).frames.down[0]!;
        ctx.drawImage(spr, x + 6, y + 6, spr.width * (compact ? 1 : 1.5), spr.height * (compact ? 1 : 1.5));
      }
      const tx = x + (compact ? 28 : 52);
      drawText(ctx, def.name, tx, y + 6, { color: def.color });
      drawText(ctx, `Lv ${m.level}`, tx + (compact ? 60 : 64), y + 6, { color: UI.dim });
      if (!compact) drawText(ctx, def.role, x + w - 8, y + 6, { color: UI.dim, align: 'right' });
      const down = m.hp <= 0;
      const bw = compact ? w - (tx - x) - 60 : 120;
      drawText(ctx, down ? '{r}DOWN{/}' : 'HP', tx, y + 18, { color: UI.dim });
      drawBar(ctx, tx + 20, y + 21, bw, 2, m.hp / s.maxHp, hpColor(m.hp / s.maxHp));
      drawText(ctx, `${m.hp}/${s.maxHp}`, tx + 26 + bw + (compact ? 50 : 60), y + 18, { align: 'right' });
      if (s.maxTp > 0) {
        drawText(ctx, def.tpLabel, tx, y + 30, { color: UI.dim });
        drawBar(ctx, tx + 20, y + 33, bw, 2, m.tp / s.maxTp, UI.cyan);
        drawText(ctx, `${m.tp}/${s.maxTp}`, tx + 26 + bw + (compact ? 50 : 60), y + 30, { align: 'right' });
      }
      if (!compact) {
        const next = xpFor(m.level + 1) - m.xp;
        drawText(ctx, `NEXT ${next}`, x + w - 8, y + 18, { color: UI.dim, align: 'right' });
        if (m.ailments.length) drawText(ctx, m.ailments.map((a) => a.toUpperCase()).join(' '), x + w - 8, y + 30, { color: UI.violet, align: 'right' });
      }
    });
  }

  private renderItems(ctx: Ctx): void {
    const x = 108, w = this.mode === 'itemTarget' ? 186 : W - 116;
    const h = H - 16 - 34;
    drawWindow(ctx, x, 8, w, h, { title: 'ITEMS' });
    this.sub.rows = Math.floor((h - 40) / 11);
    this.sub.render(ctx, x + 8, 16, w - 14, this.mode === 'items', 'Your pockets are empty.');
    const cur = this.sub.current;
    if (cur) {
      drawDivider(ctx, x + 6, 8 + h - 30, w - 12);
      drawParagraph(ctx, ITEMS[cur.value]!.desc, x + 8, 8 + h - 26, w - 16, { color: '#d0cee4', lineH: 10 });
    }
  }

  private renderTechs(ctx: Ctx): void {
    const m = this.members[this.memberIdx]!;
    const x = 108, w = this.mode === 'techTarget' ? 186 : W - 116;
    const h = H - 16 - 34;
    drawWindow(ctx, x, 8, w, h, { title: `${MEMBERS[m.id].name.toUpperCase()} · ${m.tp}/${memberStats(m).maxTp} ${MEMBERS[m.id].tpLabel}`, accent: MEMBERS[m.id].color });
    this.sub.render(ctx, x + 8, 16, w - 14, this.mode === 'techs', 'Nothing learned yet.');
    const cur = this.sub.current;
    if (cur) {
      const ab = ABILITIES[cur.value]!;
      drawDivider(ctx, x + 6, 8 + h - 30, w - 12);
      drawParagraph(ctx, ab.desc + (ab.field ? '' : ' {d}(Battle only){/}'), x + 8, 8 + h - 26, w - 16, { color: '#d0cee4', lineH: 10 });
    }
  }

  private renderEquip(ctx: Ctx): void {
    const m = this.members[this.memberIdx]!;
    const x = 108, w = W - 116;
    drawWindow(ctx, x, 8, w, 64, { title: `EQUIP · ${MEMBERS[m.id].name.toUpperCase()}`, accent: MEMBERS[m.id].color });
    if (this.mode === 'equipSlots') this.sub.render(ctx, x + 8, 16, w - 14, true);
    else {
      (['weapon', 'body', 'head', 'mod'] as EquipSlot[]).forEach((slot, i) => {
        const on = slot === this.equipSlot;
        drawText(ctx, SLOT_NAMES[slot], x + 17, 16 + i * 11, { color: on ? UI.cyan : UI.dim });
        drawText(ctx, m.equip[slot] ? ITEMS[m.equip[slot]!]!.name : '—', x + w - 14, 16 + i * 11, { align: 'right', color: on ? UI.text : UI.dim });
      });
    }
    // Stats comparison
    const cur = memberStats(m);
    let preview = cur;
    if (this.mode === 'equipList' && this.sub.current) {
      const v = this.sub.current.value;
      const trial: MemberState = { ...m, equip: { ...m.equip } };
      if (v === '__none') delete trial.equip[this.equipSlot];
      else if (canEquip(m, v)) trial.equip[this.equipSlot] = v;
      preview = memberStats(trial);
    }
    drawWindow(ctx, x, 78, 150, 88, { plain: true });
    const rows: [string, keyof typeof cur][] = [['ATK', 'atk'], ['DEF', 'def'], ['MND', 'mnd'], ['RES', 'res'], ['AGI', 'agi'], ['HP', 'maxHp'], ['TP', 'maxTp']];
    rows.forEach(([label, k], i) => {
      const a = cur[k], b = preview[k];
      drawText(ctx, label, x + 10, 84 + i * 11, { color: UI.dim });
      drawText(ctx, String(a), x + 70, 84 + i * 11, { align: 'right' });
      if (b !== a) {
        drawText(ctx, '→', x + 80, 84 + i * 11, { color: UI.dim });
        drawText(ctx, String(b), x + 118, 84 + i * 11, { align: 'right', color: b > a ? UI.green : UI.red });
      }
    });
    if (this.mode === 'equipList') {
      drawWindow(ctx, x + 156, 78, w - 156, H - 78 - 38, { title: SLOT_NAMES[this.equipSlot].toUpperCase() });
      this.sub.render(ctx, x + 164, 86, w - 170, true);
      if (this.sub.items.length === 1 && this.sub.items[0]!.value === '__none')
        drawParagraph(ctx, `No other ${SLOT_NAMES[this.equipSlot].toLowerCase()} gear in the bag. Shops and chests have more.`, x + 164, 104, w - 176, { color: UI.dim, lineH: 10 });
      const it = this.sub.current && this.sub.current.value !== '__none' ? ITEMS[this.sub.current.value] : null;
      if (it) {
        drawParagraph(ctx, it.desc + (canEquip(m, it.id) ? '' : ` {r}${MEMBERS[m.id].name} can't use this.{/}`), x + 10, 172, 142, { color: '#d0cee4', lineH: 10 });
      }
    }
  }

  private renderSave(ctx: Ctx): void {
    const x = 108, w = W - 116;
    drawWindow(ctx, x, 8, w, 50, { title: 'SAVE' });
    this.sub.render(ctx, x + 8, 16, w - 14, this.mode === 'save');
    if (this.mode === 'saveConfirm') {
      drawWindow(ctx, x + 40, 70, w - 80, 30, { accent: UI.amber });
      drawText(ctx, `Overwrite slot ${this.saveSlot}?  {y}Confirm{/} = yes · {d}Cancel{/} = no`, x + w / 2, 80, { align: 'center' });
    }
  }

  private renderStatus(ctx: Ctx): void {
    const m = this.members[this.memberIdx]!;
    const def = MEMBERS[m.id];
    const s = memberStats(m);
    drawWindow(ctx, 8, 8, W - 16, H - 16, { title: `STATUS  ◀ ${this.memberIdx + 1}/${this.members.length} ▶`, accent: def.color });
    const port = getPortrait(m.id, 'neutral');
    if (port) ctx.drawImage(port, 18, 20, 64, 64);
    else {
      const spr = buildChar(LOOKS[m.id]).frames.down[0]!;
      ctx.drawImage(spr, 28, 22, spr.width * 2.5, spr.height * 2.5);
    }
    drawText(ctx, def.name, 94, 22, { color: def.color });
    drawText(ctx, def.role, 94, 34, { color: UI.dim });
    drawText(ctx, `Level {y}${m.level}{/}`, 94, 48);
    drawText(ctx, `XP ${m.xp.toLocaleString('en-US')}  ·  Next in ${(xpFor(m.level + 1) - m.xp).toLocaleString('en-US')}`, 94, 60, { color: UI.dim });
    drawParagraph(ctx, def.bio, 94, 74, 200, { color: '#d0cee4', lineH: 10 });
    // Stats
    const sx = 310;
    const rows: [string, string][] = [
      ['HP', `${m.hp}/${s.maxHp}`], [def.tpLabel === '—' ? 'TP' : def.tpLabel, s.maxTp ? `${m.tp}/${s.maxTp}` : '—'],
      ['ATK', String(s.atk)], ['DEF', String(s.def)], ['MND', String(s.mnd)], ['RES', String(s.res)], ['AGI', String(s.agi)], ['CRIT', `${s.crit}%`],
    ];
    rows.forEach(([k, v], i) => {
      drawText(ctx, k, sx, 22 + i * 11, { color: UI.dim });
      drawText(ctx, v, W - 22, 22 + i * 11, { align: 'right' });
    });
    drawDivider(ctx, 16, 118, W - 32);
    drawText(ctx, 'EQUIPMENT', 18, 124, { color: UI.cyan });
    (['weapon', 'body', 'head', 'mod'] as EquipSlot[]).forEach((slot, i) => {
      drawText(ctx, SLOT_NAMES[slot], 18, 137 + i * 11, { color: UI.dim });
      drawText(ctx, m.equip[slot] ? ITEMS[m.equip[slot]!]!.name : '—', 70, 137 + i * 11);
    });
    drawText(ctx, 'ABILITIES', 240, 124, { color: UI.cyan });
    const abs = knownAbilities(m);
    abs.forEach((id, i) => {
      const ab = ABILITIES[id]!;
      const col = i < 9 ? 0 : 1;
      drawText(ctx, `${ab.kind === 'tech' ? '•' : '★'} ${ab.name}`, 240 + col * 110, 137 + (i % 9) * 11, { color: ab.kind === 'tech' ? '#d0f4ff' : '#ffe8b0' });
    });
  }

  private renderCombos(ctx: Ctx): void {
    drawWindow(ctx, 8, 8, W - 16, H - 16, { title: 'COMBO LOG', accent: UI.amber });
    drawText(ctx, 'Choose the right pair of abilities in the same round and they fuse.', 18, 22, { color: UI.dim });
    const found = COMBOS.filter((c) => state.combos.includes(c.id)).length;
    drawText(ctx, `${found}/${COMBOS.length} found`, W - 18, 22, { align: 'right', color: UI.amber });
    const first = this.comboScroll;
    if (first > 0) drawText(ctx, '▲', W - 24, 32, { color: UI.cyan });
    if (first + COMBO_ROWS < COMBOS.length) drawText(ctx, '▼', W - 24, H - 20, { color: UI.cyan });
    COMBOS.slice(first, first + COMBO_ROWS).forEach((c, i) => {
      const y = 40 + i * 36;
      const known = state.combos.includes(c.id);
      const ab = ABILITIES[c.id]!;
      const names = c.parts.map((p) => `${MEMBERS[p.member as MemberId].name}: ${ABILITIES[p.ability]!.name}`).join('  +  ');
      drawText(ctx, known ? `★ ${ab.name}` : '★ ???', 18, y, { color: known ? UI.amber : UI.disabled });
      drawText(ctx, known ? names : 'Hint: ' + c.hint, 30, y + 11, { color: known ? '#d0cee4' : UI.dim });
      if (known) drawText(ctx, ab.desc, 30, y + 22, { color: UI.dim });
    });
  }
}

function kindIcon(it: ItemDef): string {
  return it.kind === 'use' ? '+' : it.kind === 'key' ? '*' : it.kind === 'loot' ? '$' : '#';
}

function kindColor(it: ItemDef): string {
  return it.kind === 'use' ? UI.green : it.kind === 'key' ? UI.amber : it.kind === 'loot' ? UI.violet : UI.cyan;
}
