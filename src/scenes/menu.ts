/** Field menu: party overview plus Items / Techs / Equip / Status / Combos / Save / Options. */
import { buildChar } from '../art/chars';
import { enemyArt } from '../art/enemies';
import { getPortrait } from '../art/portraits';
import { sfx } from '../audio/sfx';
import { ABILITIES, chapterCombos, COMBOS } from '../data/abilities';
import { ENEMIES } from '../data/enemies';
import { markElements } from './battlekit/tables';

const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'body', 'head', 'mod'];

/** A member as they'd be with `id` (or nothing) in `slot`: for comparing stats before choosing. */
function trialWith(m: MemberState, slot: EquipSlot, id: string | null): MemberState {
  const trial: MemberState = { ...m, equip: { ...m.equip } };
  if (id === null) delete trial.equip[slot];
  else if (canEquip(m, id)) trial.equip[slot] = id;
  return trial;
}

/** What a piece would change, in a gear row: the biggest one or two stat moves, or no change. */
function gearDiff(m: MemberState, slot: EquipSlot, id: string | null): string {
  const a = memberStats(m), b = memberStats(trialWith(m, slot, id));
  const moves = GEAR_STATS.map(([k, label]) => ({ label, d: b[k] - a[k] })).filter((s) => s.d !== 0);
  if (!moves.length) {
    // No number moves, but the piece may still do something: say what, rather than "same".
    const it = id ? ITEMS[id] : undefined;
    const does = [it?.element && it.element !== 'phys' ? markElements(it.element.toUpperCase()) : '', it?.regen ? 'regen' : '', it?.immune?.length ? 'ward' : ''].filter(Boolean);
    return does.length ? does.join(' ') : '{d}same{/}';
  }
  return moves
    .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
    .slice(0, 2)
    .map((s) => `${s.d > 0 ? '{g}+' : '{r}'}${s.d}{/} ${s.label}`)
    .join(' ');
}
const GEAR_STATS: readonly (readonly [keyof ReturnType<typeof memberStats>, string])[] = [
  ['atk', 'ATK'], ['def', 'DEF'], ['mnd', 'MND'], ['res', 'RES'], ['agi', 'AGI'], ['maxHp', 'HP'], ['maxTp', 'TP'], ['crit', 'CRIT'], ['hit', 'HIT'],
];
import { ITEMS, type ItemDef } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS, xpFor } from '../data/party';
import type { Ctx } from '../engine/canvas';
import { drawParagraph, drawText, fitText, measure, wrap } from '../engine/font';
import {
  BESTIARY_BOX_H, BESTIARY_BOX_W, CARD_BAR_W, CARD_COMPACT_H, CARD_GAP, CARD_H, COMBO_ROW_H, COMBO_TEXT_W, COMBO_TOP, EQUIP_BOTTOM_PAD, EQUIP_DESC_GAP, EQUIP_DESC_W,
  EQUIP_GAP, EQUIP_SLOTS_H, EQUIP_STATS_H, EQUIP_STATS_W, EQUIP_STATS_Y, LIST_ROW_H, MENU_DESC_ROOM, MENU_LIST_BOTTOM_PAD, MENU_PANE_X, MENU_RAIL_W, MENU_RAIL_X, MENU_SIDE_LIST_TOP,
  MENU_SIDE_LIST_W, menuCardStrip, menuPaneW, rowsFor, STATUS_ABILITY_COL_W, STATUS_ABILITY_COLS, STATUS_ABILITY_ROWS, STATUS_ABILITY_TEXT_W, STATUS_ABILITY_X, STATUS_BIO_W, STATUS_DIVIDER_Y,
  STATUS_LOWER_Y, STATUS_ROW_H, STATUS_STATS_W, STATUS_STATS_X, STATUS_TEXT_X, STATUS_WOUND_W, TARGET_CARD_GAP, TARGET_PANE_W,
} from '../ui/layout';
import { Scene, W, H } from '../engine/game';
import { applyEffects } from '../game/fielduse';
import { canEquip, currentWound, equip, knownAbilities, lockedAbilities, maxUses, memberStats, SLOT_NAMES } from '../game/party';
import { formatPlayTime, locationName, readMeta, SLOTS, savedByVersion, slotStatus, writeSave, type SlotId } from '../game/save';
import { flags, state, type EquipSlot, type MemberId, type MemberState } from '../game/state';
import { drawBar, drawDivider, drawSelect, drawWindow, keyLegend, hpColor, UI, OVERLAY_DIM } from '../ui/draw';
import { ListMenu, type ListItem } from '../ui/list';
import { OptionsScene } from './options';
import { PlaceMapScene } from './placemap';

/**
 * Rows of the lists that follow the window height (docs/PIVOT-640.md, WP4): each is `rowsFor` of the
 * room its window leaves under the list's first row, so a taller screen shows more rows and no edit
 * is needed. The shared ones are here; the Equip gear list's own is in `gearRows`.
 */
/** The item or tech list's window height: the screen less its margins and the room under the window. */
const listPaneH = (): number => H - 16 - MENU_LIST_BOTTOM_PAD;
/** Rows of the Items and Techs lists: the window less its header, and the room kept for the description. */
const paneRows = (): number => rowsFor(listPaneH() - MENU_DESC_ROOM, LIST_ROW_H);
/** Rows of the Bestiary and Places lists (the window runs the screen's height, 8 px in from the edges). */
const sideListRows = (): number => rowsFor(H - 8 - MENU_SIDE_LIST_TOP - 8, LIST_ROW_H);
/** Combo log entries visible at once (36px each under the header). */
const comboRows = (): number => rowsFor(H - 8 - COMBO_TOP, COMBO_ROW_H);
/** Rows of the Equip gear list: the gear window runs to EQUIP_BOTTOM_PAD above the screen's bottom; the list starts 8 px into it and keeps 6 px under its last row. */
const gearRows = (): number => rowsFor(H - EQUIP_BOTTOM_PAD - (EQUIP_STATS_Y + 8) - 6, LIST_ROW_H);

/** Display names for enemy families. */
const FAMILY_NAME: Record<string, string> = { human: 'Human', machine: 'Machine', beast: 'Beast', spirit: 'Spirit', ghoul: 'Ghoul' };

type Mode = 'places' | 'bestiary' | 'main' | 'pickMember' | 'items' | 'itemTarget' | 'techs' | 'techTarget' | 'equipSlots' | 'equipList' | 'status' | 'combos' | 'save' | 'saveConfirm';

export type MenuResult = { kind: 'close' } | { kind: 'special'; item: string } | { kind: 'title' };

export class MenuScene extends Scene<MenuResult> {
  override opaque = false;
  override curtain = true;
  private mode: Mode = 'main';
  private main = new ListMenu<string>([], 9);
  private beasts = new ListMenu<string>([], sideListRows());
  private places = new ListMenu<string>([], sideListRows());
  private sub = new ListMenu<string>([], paneRows());
  private comboScroll = 0;
  private memberIdx = 0;
  private purpose: 'techs' | 'equip' | 'status' = 'status';
  private pendingItem: string | null = null;
  private pendingTech: { user: MemberId; id: string } | null = null;
  private equipSlot: EquipSlot = 'weapon';
  /** The gear list beside the slots (the slots themselves use `sub`). */
  private gear = new ListMenu<string>([], gearRows());
  private toast: { text: string; t: number } | null = null;
  private t = 0;
  private saveSlot: SlotId = 1;
  /** Whether the slot in the confirm prompt was saved by a newer version. Read once on entering the prompt: slotStatus does storage reads and a full validation, too costly per frame. */
  private saveSlotNewer = false;

  constructor(canSave = true) {
    super();
    this.main.setItems([
      { label: 'Items', value: 'items' },
      { label: 'Techs', value: 'techs' },
      { label: 'Equip', value: 'equip' },
      { label: 'Status', value: 'status' },
      // Hex's deck, once the Stingray is in it (the slots later chapters' parts go in).
      ...(flags.has('stingray_seated') && state.party.includes('hex') ? [{ label: 'Deck', value: 'deck' }] : []),
      { label: 'Combos', value: 'combos' },
      { label: 'Bestiary', value: 'bestiary' },
      { label: 'Places', value: 'places' },
      { label: 'Save', value: 'save', enabled: canSave },
      { label: 'Options', value: 'options' },
      { label: 'Close', value: 'close' },
    ]);
    // Every entry on screen: the window is sized to the list, so nothing (Close) scrolls away.
    this.main.rows = this.main.items.length;
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
        } else if (v === 'bestiary') {
          this.beasts.setItems(
            Object.keys(ENEMIES)
              .filter((k) => (state.bestiary[k] ?? 0) > 0)
              .map((k) => ({ label: ENEMIES[k]!.name, value: k, right: `×${state.bestiary[k]}` })),
          );
          this.beasts.index = 0;
          this.beasts.scroll = 0;
          this.mode = 'bestiary';
        }
        else if (v === 'places') {
          this.places.setItems(
            PLACES.filter((p) => state.flags[`visit:${p.id}`]).map((p) => ({ label: p.name, value: p.id, right: p.id === state.map ? 'here' : undefined })),
          );
          this.places.index = Math.max(0, this.places.items.findIndex((i) => i.value === state.map));
          this.mode = 'places';
        }
        else if (v === 'save') {
          this.buildSaveList();
          this.mode = 'save';
        } else if (v === 'options') void this.game.run(new OptionsScene(true)).then((r) => r === 'title' && this.close({ kind: 'title' }));
        else if (v === 'deck') void import('./deck').then(({ DeckScene }) => this.game.run(new DeckScene('view')));
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
        // The gear for the highlighted slot is already showing (with what each piece would change);
        // confirm moves into that list (Mark's playthrough: "don't make me click in to a slot to
        // see what's available").
        const r = this.sub.update(inp);
        if (r === 'cancel') this.mode = 'pickMember';
        else if (r === 'move') this.refreshGear();
        else if (r === 'confirm') {
          if (!this.gear.items.length) {
            sfx('buzz');
            this.say('Nothing to equip there.');
            return;
          }
          this.equipSlot = this.sub.current!.value as EquipSlot;
          this.mode = 'equipList';
        }
        break;
      }
      case 'equipList': {
        const r = this.gear.update(inp);
        if (r === 'cancel') {
          this.mode = 'equipSlots';
          return;
        }
        if (r === 'confirm') {
          const v = this.gear.current!.value;
          const m = this.members[this.memberIdx]!;
          equip(m, v === '__none' ? null : v, this.equipSlot);
          sfx('equip');
          this.openEquip(m, false);
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
      case 'bestiary': {
        const r = this.beasts.update(inp);
        if (r === 'cancel') this.mode = 'main';
        break;
      }
      case 'places': {
        const r = this.places.update(inp);
        if (r === 'cancel') this.mode = 'main';
        else if (r === 'confirm' && this.places.current) void this.game.run(new PlaceMapScene(this.places.current.value));
        break;
      }
      case 'combos': {
        const max = Math.max(0, COMBOS.length - comboRows());
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
          // A newer-version save always asks first, even when its header can't be read.
          const newer = slotStatus(this.saveSlot) === 'newer';
          if (readMeta(this.saveSlot) || newer) {
            this.saveSlotNewer = newer;
            this.mode = 'saveConfirm';
          } else this.doSave();
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
    this.sub.rows = paneRows();
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
        const cost = ab.kind === 'tech' ? `${ab.cost} ${MEMBERS[m.id].tpLabel}` : `${m.uses[id] ?? 0}/${maxUses(m.id, id)}`;
        const affordable = ab.kind === 'tech' && m.tp >= (ab.cost ?? 0) && m.hp > 0;
        return { label: ab.name, value: id, right: cost, enabled: !!ab.field && affordable, icon: ab.kind === 'tech' ? '•' : '★', iconColor: ab.kind === 'tech' ? UI.cyan : UI.amber };
      }),
    );
    this.sub.rows = paneRows();
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
  /** The slot list (first time in: from the top; after equipping: where the cursor was). */
  private openEquip(m: MemberState, fresh = true): void {
    if (fresh) sfx('confirm');
    this.sub.setItems(
      EQUIP_SLOTS.map((slot) => ({
        label: SLOT_NAMES[slot], value: slot, right: m.equip[slot] ? ITEMS[m.equip[slot]!]!.name : '—',
      })),
    );
    if (fresh) this.sub.index = 0;
    this.sub.rows = EQUIP_SLOTS.length;
    this.mode = 'equipSlots';
    this.refreshGear();
  }

  /**
   * The gear in the bag for the highlighted slot, each row with what it would change: the one
   * or two biggest stat moves against what's worn now, or who it's for if this member can't.
   */
  private refreshGear(): void {
    const m = this.members[this.memberIdx]!;
    const slot = (this.sub.current?.value ?? 'weapon') as EquipSlot;
    const items: ListItem<string>[] = Object.keys(state.inventory)
      .filter((id) => ITEMS[id]?.slot === slot && (state.inventory[id] ?? 0) > 0)
      .map((id) => {
        const ok = canEquip(m, id);
        return {
          label: `${ITEMS[id]!.name}${(state.inventory[id] ?? 0) > 1 ? ` ×${state.inventory[id]}` : ''}`,
          value: id,
          right: ok ? gearDiff(m, slot, id) : 'can’t use',
          enabled: ok,
          why: ok ? undefined : `${MEMBERS[m.id].name} can’t use this.`,
        };
      });
    if (m.equip[slot]) items.push({ label: '(Remove)', value: '__none', color: UI.dim, right: gearDiff(m, slot, null) });
    this.gear.setItems(items);
    this.gear.index = 0;
    this.gear.scroll = 0;
  }

  // ------------------------------------------------------------------ save
  private buildSaveList(): void {
    this.sub.setItems(
      SLOTS.map((s) => {
        if (slotStatus(s) === 'newer') {
          const v = savedByVersion(s);
          return { label: `Slot ${s}`, value: String(s), right: v ? `Saved by a newer version (v${v})` : 'Saved by a newer version' };
        }
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
      this.say('Couldn’t save — browser storage is unavailable.');
    }
    this.buildSaveList();
    this.mode = 'save';
  }

  // ------------------------------------------------------------------ render
  render(ctx: Ctx): void {
    // Near-opaque: the world is a faint presence behind the menu, never readable signage.
    ctx.fillStyle = OVERLAY_DIM;
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
    if (this.mode === 'bestiary') {
      this.renderBestiary(ctx);
      return;
    }
    if (this.mode === 'places') {
      this.renderPlaces(ctx);
      return;
    }
    // Main command column
    const rail = MENU_RAIL_X + 8;
    drawWindow(ctx, MENU_RAIL_X, 8, MENU_RAIL_W, this.main.items.length * 11 + 14, { title: 'MENU' , footer: keyLegend(this.game.input, 'close') });
    this.main.render(ctx, rail - 1, 15, MENU_RAIL_W - 10, this.mode === 'main');
    // Info
    drawWindow(ctx, MENU_RAIL_X, H - 74, MENU_RAIL_W, 66, { plain: true });
    drawText(ctx, `{y}${state.cred.toLocaleString('en-US')}¢`, rail, H - 68);
    drawText(ctx, formatPlayTime(this.game.playFrames), rail, H - 56, { color: UI.dim });
    drawParagraph(ctx, locationName(state.map), rail, H - 44, MENU_RAIL_W - 12, { color: UI.cyan, lineH: 10 });
    const obj = flags.get('objective') as string | undefined;
    if (obj) {
      // Wrapped to the box (it grows upward for a second line), never drawn past its frame.
      const paneW = menuPaneW();
      const lines = wrap(obj, paneW - 28);
      const h = 12 + lines.length * 10;
      drawWindow(ctx, MENU_PANE_X, H - 8 - h, paneW, h, { plain: true, accent: UI.amber, title: 'OBJECTIVE' });
      for (const [i, ln] of lines.entries()) drawText(ctx, (i === 0 ? '{y}▶{/} ' : '   ') + ln, MENU_PANE_X + 8, H - 2 - h + 4 + i * 10);
    }
    // Right side: party cards or sub-list (Items and Techs keep the party in compact cards beside the list)
    const listModes: Mode[] = ['items', 'techs', 'equipSlots', 'equipList', 'save', 'saveConfirm'];
    if (listModes.includes(this.mode) || this.mode === 'itemTarget' || this.mode === 'techTarget') {
      const picking = this.mode === 'itemTarget' || this.mode === 'techTarget';
      const { w, cardX } = this.listLayout(picking);
      if (this.mode === 'items' || this.mode === 'itemTarget') {
        this.renderItems(ctx, w);
        if (cardX !== null) this.renderCards(ctx, cardX, picking, true);
      } else if (this.mode === 'techs' || this.mode === 'techTarget') {
        this.renderTechs(ctx, w);
        if (cardX !== null) this.renderCards(ctx, cardX, picking, true);
      } else if (this.mode === 'equipSlots' || this.mode === 'equipList') this.renderEquip(ctx);
      else this.renderSave(ctx);
    } else this.renderCards(ctx, MENU_PANE_X, this.mode === 'pickMember', false);
    this.renderToast(ctx);
  }

  /**
   * The Items and Techs lists and the party's cards beside them. With room (640 wide) the list is a
   * capped pane and the cards are always in the strip beside it. With none (480x270, or the
   * `?panes=stretch` review variant), the list keeps its full width, and while the player picks who gets
   * an item or a tech it narrows to `TARGET_PANE_W` and the cards come back beside it, as they did.
   */
  private listLayout(picking: boolean): { w: number; cardX: number | null } {
    const strip = menuCardStrip();
    if (strip) return { w: menuPaneW(), cardX: strip.x };
    return picking ? { w: TARGET_PANE_W, cardX: MENU_PANE_X + TARGET_PANE_W + TARGET_CARD_GAP } : { w: menuPaneW(), cardX: null };
  }

  private renderToast(ctx: Ctx): void {
    if (!this.toast) return;
    // Centred in the space right of the MENU column, never over it.
    const left = MENU_PANE_X, room = W - left - 8;
    const tw = Math.min(room, measure(this.toast.text) + 20);
    const tx = left + (room - tw) / 2;
    drawWindow(ctx, tx, 6, tw, 17, { plain: true, accent: UI.green });
    drawText(ctx, fitText(this.toast.text, tw - 12), tx + tw / 2, 10, { align: 'center' });
  }

  /** The party's cards from `x` to the right margin: full (portrait, role, next level), or compact (sprite, name, bars). */
  private renderCards(ctx: Ctx, x: number, picking: boolean, compact: boolean): void {
    const w = W - x - 8;
    const ms = this.members;
    const cardH = compact ? CARD_COMPACT_H : CARD_H;
    ms.forEach((m, i) => {
      const y = 8 + i * (cardH + CARD_GAP);
      const sel = picking && i === this.memberIdx;
      const def = MEMBERS[m.id];
      drawWindow(ctx, x, y, w, cardH, { plain: !sel, accent: sel ? def.color : undefined });
      if (sel) drawSelect(ctx, x + 2, y + 2, w - 4, cardH - 4, 'rgba(63,224,240,0.08)');
      const s = memberStats(m);
      const port = getPortrait(m.id, 'neutral');
      // A compact card draws the sprite at 1x and starts its text just past the sprite's canvas (it is
      // wider than the 22 px the old layout assumed, so the name used to sit over the sprite's hat).
      let tx = x + 52;
      if (port && !compact) ctx.drawImage(port, x + 5, y + 5, 40, 40);
      else {
        const spr = buildChar(LOOKS[m.id]).frames.down[0]!;
        ctx.drawImage(spr, x + 6, y + 6, spr.width * (compact ? 1 : 1.5), spr.height * (compact ? 1 : 1.5));
        if (compact) tx = x + 6 + spr.width + 2;
      }
      drawText(ctx, def.name, tx, y + 6, { color: def.color });
      drawText(ctx, `Lv ${m.level}`, compact ? x + w - 7 : tx + 64, y + 6, { color: UI.dim, align: compact ? 'right' : 'left' });
      if (!compact) drawText(ctx, def.role, x + w - 8, y + 6, { color: UI.dim, align: 'right' });
      const down = m.hp <= 0;
      // Numbers right-align inside the card, just past the bar (a compact card: at its edge, and the
      // bar stops short of the widest reading, "999/999"). The bar is CARD_BAR_W on a full card, so
      // the numbers move with the card and never sit across a gap from the bar.
      const widest = measure('999/999');
      const numX = compact ? x + w - 7 : tx + 20 + CARD_BAR_W + 8 + widest;
      const bw = compact ? numX - widest - 6 - (tx + 20) : CARD_BAR_W;
      drawText(ctx, down ? '{r}DOWN{/}' : 'HP', tx, y + 18, { color: UI.dim });
      drawBar(ctx, tx + 20, y + 21, bw, 2, m.hp / s.maxHp, hpColor(m.hp / s.maxHp));
      drawText(ctx, `${m.hp}/${s.maxHp}`, numX, y + 18, { align: 'right' });
      if (s.maxTp > 0) {
        drawText(ctx, def.tpLabel, tx, y + 30, { color: UI.dim });
        drawBar(ctx, tx + 20, y + 33, bw, 2, m.tp / s.maxTp, UI.cyan);
        drawText(ctx, `${m.tp}/${s.maxTp}`, numX, y + 30, { align: 'right' });
      }
      if (!compact) {
        const next = xpFor(m.level + 1) - m.xp;
        drawText(ctx, `NEXT ${next}`, x + w - 8, y + 18, { color: UI.dim, align: 'right' });
        if (m.ailments.length) drawText(ctx, m.ailments.map((a) => a.toUpperCase()).join(' '), x + w - 8, y + 30, { color: UI.violet, align: 'right' });
      }
    });
  }

  private renderItems(ctx: Ctx, w: number): void {
    const x = MENU_PANE_X;
    const h = listPaneH();
    drawWindow(ctx, x, 8, w, h, { title: 'ITEMS' , footer: keyLegend(this.game.input) });
    this.sub.rows = paneRows();
    this.sub.render(ctx, x + 8, 16, w - 14, this.mode === 'items', 'Your pockets are empty.');
    const cur = this.sub.current;
    if (cur) {
      drawDivider(ctx, x + 6, 8 + h - 30, w - 12);
      drawParagraph(ctx, markElements(ITEMS[cur.value]!.desc), x + 8, 8 + h - 26, w - 16, { color: '#d0cee4', lineH: 10 });
    }
  }

  private renderTechs(ctx: Ctx, w: number): void {
    const m = this.members[this.memberIdx]!;
    const x = MENU_PANE_X;
    const h = listPaneH();
    this.sub.rows = paneRows();
    drawWindow(ctx, x, 8, w, h, { title: `${MEMBERS[m.id].name.toUpperCase()} · ${m.tp}/${memberStats(m).maxTp} ${MEMBERS[m.id].tpLabel}`, accent: MEMBERS[m.id].color , footer: keyLegend(this.game.input) });
    this.sub.render(ctx, x + 8, 16, w - 14, this.mode === 'techs', 'Nothing learned yet.');
    const cur = this.sub.current;
    if (cur) {
      const ab = ABILITIES[cur.value]!;
      drawDivider(ctx, x + 6, 8 + h - 30, w - 12);
      drawParagraph(ctx, markElements(ab.desc) + (ab.field ? '' : ' {d}(Battle only){/}'), x + 8, 8 + h - 26, w - 16, { color: '#d0cee4', lineH: 10 });
    }
  }

  private renderEquip(ctx: Ctx): void {
    const m = this.members[this.memberIdx]!;
    const x = MENU_PANE_X, w = menuPaneW();
    const listing = this.mode === 'equipList';
    const slot = (listing ? this.equipSlot : this.sub.current?.value ?? 'weapon') as EquipSlot;
    drawWindow(ctx, x, 8, w, EQUIP_SLOTS_H, { title: `EQUIP · ${MEMBERS[m.id].name.toUpperCase()}`, accent: MEMBERS[m.id].color });
    this.sub.render(ctx, x + 8, 16, w - 14, !listing);
    // Stats comparison: against the piece under the cursor, once you're in the gear list.
    const cur = memberStats(m);
    let preview = cur;
    if (listing && this.gear.current) {
      const v = this.gear.current.value;
      preview = memberStats(trialWith(m, slot, v === '__none' ? null : v));
    }
    drawWindow(ctx, x, EQUIP_STATS_Y, EQUIP_STATS_W, EQUIP_STATS_H, { plain: true });
    const rows: [string, keyof typeof cur][] = [['ATK', 'atk'], ['DEF', 'def'], ['MND', 'mnd'], ['RES', 'res'], ['AGI', 'agi'], ['HP', 'maxHp'], ['TP', 'maxTp']];
    rows.forEach(([label, k], i) => {
      const a = cur[k], b = preview[k];
      const ry = EQUIP_STATS_Y + 6 + i * 11;
      drawText(ctx, label, x + 10, ry, { color: UI.dim });
      drawText(ctx, String(a), x + 70, ry, { align: 'right' });
      if (b !== a) {
        drawText(ctx, '→', x + 80, ry, { color: UI.dim });
        drawText(ctx, String(b), x + 118, ry, { align: 'right', color: b > a ? UI.green : UI.red });
      }
    });
    // The slot's gear, always in view: dimmed while you're choosing a slot, live once you're in it.
    const gx = x + EQUIP_STATS_W + EQUIP_GAP, gw = w - EQUIP_STATS_W - EQUIP_GAP;
    drawWindow(ctx, gx, EQUIP_STATS_Y, gw, H - EQUIP_BOTTOM_PAD - EQUIP_STATS_Y, { title: SLOT_NAMES[slot].toUpperCase(), accent: listing ? MEMBERS[m.id].color : undefined });
    const none = `No other ${SLOT_NAMES[slot].toLowerCase()} gear in the bag. Shops and chests have more.`;
    const gy = EQUIP_STATS_Y + 8;
    this.gear.rows = gearRows();
    if (!this.gear.items.length) drawParagraph(ctx, none, gx + 8, gy, gw - 20, { color: UI.dim, lineH: 10 });
    else {
      this.gear.render(ctx, gx + 8, gy, gw - 14, listing);
      if (this.gear.items.length === 1 && this.gear.items[0]!.value === '__none') drawParagraph(ctx, none, gx + 8, gy + 18, gw - 20, { color: UI.dim, lineH: 10 });
    }
    // Under the stats: the piece under the cursor, or (choosing a slot) what's worn there now.
    const id = listing ? (this.gear.current && this.gear.current.value !== '__none' ? this.gear.current.value : null) : (m.equip[slot] ?? null);
    const it = id ? ITEMS[id] : null;
    if (it) {
      const note = canEquip(m, it.id) ? '' : ` {r}${MEMBERS[m.id].name} can’t use this.{/}`;
      drawParagraph(ctx, `${listing ? '' : '{d}Worn:{/} '}${markElements(it.desc)}${note}`, x + 10, EQUIP_STATS_Y + EQUIP_STATS_H + EQUIP_DESC_GAP, EQUIP_DESC_W, { color: '#d0cee4', lineH: 10 });
    }
  }

  private renderSave(ctx: Ctx): void {
    const x = MENU_PANE_X, w = menuPaneW();
    drawWindow(ctx, x, 8, w, 50, { title: 'SAVE' });
    this.sub.render(ctx, x + 8, 16, w - 14, this.mode === 'save');
    if (this.mode === 'saveConfirm') {
      drawWindow(ctx, x + 40, 70, w - 80, 30, { accent: UI.amber });
      drawText(ctx, `${this.saveSlotNewer ? `Slot ${this.saveSlot} is newer. Replace?` : `Overwrite slot ${this.saveSlot}?`}  {y}Confirm{/} = yes · {d}Cancel{/} = no`, x + w / 2, 80, { align: 'center' });
    }
  }

  private renderStatus(ctx: Ctx): void {
    const m = this.members[this.memberIdx]!;
    const def = MEMBERS[m.id];
    const s = memberStats(m);
    drawWindow(ctx, 8, 8, W - 16, H - 16, { title: `STATUS  ◀ ${this.memberIdx + 1}/${this.members.length} ▶`, accent: def.color , footer: keyLegend(this.game.input, 'back') });
    const port = getPortrait(m.id, 'neutral');
    if (port) ctx.drawImage(port, 18, 20, 64, 64);
    else {
      const spr = buildChar(LOOKS[m.id]).frames.down[0]!;
      ctx.drawImage(spr, 28, 22, spr.width * 2.5, spr.height * 2.5);
    }
    drawText(ctx, def.name, STATUS_TEXT_X, 22, { color: def.color });
    drawText(ctx, def.role, STATUS_TEXT_X, 34, { color: UI.dim });
    drawText(ctx, `Level {y}${m.level}{/}`, STATUS_TEXT_X, 48);
    drawText(ctx, `XP ${m.xp.toLocaleString('en-US')}  ·  Next in ${(xpFor(m.level + 1) - m.xp).toLocaleString('en-US')}`, STATUS_TEXT_X, 60, { color: UI.dim });
    const bioLines = drawParagraph(ctx, def.bio, STATUS_TEXT_X, 74, STATUS_BIO_W, { color: '#d0cee4', lineH: 10 });
    const wound = currentWound(m.id);
    if (wound) {
      // What the wound costs, in numbers, so the tutorial's promise can be checked here.
      const pct = (k: number) => `-${Math.round((1 - k) * 100)}%`;
      drawText(ctx, fitText(`{r}WOUNDED{/}  {d}HP ${pct(wound.hp)}  ATK ${pct(wound.atk)}  AGI ${pct(wound.agi)}{/}`, STATUS_WOUND_W), STATUS_TEXT_X, 76 + bioLines * 10);
    }
    // Stats: a block as wide as STATUS_STATS_W at the window's right, labels left and values right (a
    // label and its value stay near each other; the old column put them 308 px apart at this width).
    const sx = STATUS_STATS_X;
    const rows: [string, string][] = [
      ['HP', `${m.hp}/${s.maxHp}`], [def.tpLabel === '—' ? 'TP' : def.tpLabel, s.maxTp ? `${m.tp}/${s.maxTp}` : '—'],
      ['ATK', String(s.atk)], ['DEF', String(s.def)], ['MND', String(s.mnd)], ['RES', String(s.res)], ['AGI', String(s.agi)], ['CRIT', `${s.crit}%`],
    ];
    rows.forEach(([k, v], i) => {
      drawText(ctx, k, sx, 22 + i * STATUS_ROW_H, { color: UI.dim });
      drawText(ctx, v, sx + STATUS_STATS_W, 22 + i * STATUS_ROW_H, { align: 'right' });
    });
    drawDivider(ctx, 16, STATUS_DIVIDER_Y, W - 32);
    drawText(ctx, 'EQUIPMENT', 18, STATUS_DIVIDER_Y + 6, { color: UI.cyan });
    (['weapon', 'body', 'head', 'mod'] as EquipSlot[]).forEach((slot, i) => {
      drawText(ctx, SLOT_NAMES[slot], 18, STATUS_LOWER_Y + i * STATUS_ROW_H, { color: UI.dim });
      drawText(ctx, m.equip[slot] ? ITEMS[m.equip[slot]!]!.name : '—', 70, STATUS_LOWER_Y + i * STATUS_ROW_H);
    });
    // The abilities run down columns of STATUS_ABILITY_ROWS, from STATUS_ABILITY_X, each column
    // STATUS_ABILITY_COL_W wide (three at this width; the nine-row pitch is the old one).
    drawText(ctx, 'ABILITIES', STATUS_ABILITY_X, STATUS_DIVIDER_Y + 6, { color: UI.cyan });
    const slotXY = (i: number): [number, number] => [STATUS_ABILITY_X + (Math.floor(i / STATUS_ABILITY_ROWS) % STATUS_ABILITY_COLS) * STATUS_ABILITY_COL_W, STATUS_LOWER_Y + (i % STATUS_ABILITY_ROWS) * STATUS_ROW_H];
    const abs = knownAbilities(m);
    abs.forEach((id, i) => {
      const ab = ABILITIES[id]!;
      const [ax, ay] = slotXY(i);
      drawText(ctx, fitText(`${ab.kind === 'tech' ? '•' : '★'} ${ab.name}`, STATUS_ABILITY_TEXT_W), ax, ay, { color: ab.kind === 'tech' ? '#d0f4ff' : '#ffe8b0' });
    });
    // What the story is still holding back (Rook's skills, while he's hurt): shown greyed, so the
    // player knows there's more to come.
    const locked = lockedAbilities(m);
    locked.forEach((id, j) => {
      const [ax, ay] = slotXY(abs.length + j);
      drawText(ctx, fitText(`× ${ABILITIES[id]!.name}`, STATUS_ABILITY_TEXT_W), ax, ay, { color: UI.disabled });
    });
    // The key to the greyed rows, once, on the header line (a suffix on each row didn't fit).
    if (locked.length) drawText(ctx, '× locked for now', W - 22, STATUS_DIVIDER_Y + 6, { align: 'right', color: UI.disabled });
  }

  /** Every enemy the crew has beaten: what it looks like, what hurts it, and field notes. */
  private renderBestiary(ctx: Ctx): void {
    const n = Object.keys(ENEMIES).filter((k) => !ENEMIES[k]!.boss || (state.bestiary[k] ?? 0) > 0).length;
    drawWindow(ctx, 8, 8, MENU_SIDE_LIST_W, H - 16, { title: `BESTIARY ${this.beasts.items.length}/${n}`, accent: UI.amber , footer: keyLegend(this.game.input) });
    this.beasts.rows = sideListRows();
    this.beasts.render(ctx, 16, MENU_SIDE_LIST_TOP, MENU_SIDE_LIST_W - 14, true, 'Nothing logged yet. Win a fight.');
    const cur = this.beasts.current;
    const x = 8 + MENU_SIDE_LIST_W + 6, w = W - x - 8;
    drawWindow(ctx, x, 8, w, H - 16, { plain: true });
    if (!cur) return;
    const e = ENEMIES[cur.value]!;
    const kills = state.bestiary[e.id] ?? 0;
    // Portrait box with the battle sprite, as large as whole pixels allow.
    const ea = enemyArt(e.sprite);
    const art = ea.canvas;
    const box = { x: x + 8, y: 16, w: BESTIARY_BOX_W, h: BESTIARY_BOX_H };
    ctx.fillStyle = '#0c0b14';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    // Sized by its battle-world size (creatures' art is finer than the world): whole screen pixels
    // per world pixel where they fit, else scaled down to fit the box.
    const fit = Math.min(box.w / ea.w, box.h / ea.h);
    const k = fit >= 1 ? Math.min(2, Math.floor(fit)) : fit;
    const dw = Math.round(ea.w * k), dh = Math.round(ea.h * k);
    ctx.drawImage(art, Math.round(box.x + (box.w - dw) / 2), Math.round(box.y + box.h - dh - 4), dw, dh);
    const tx = box.x + box.w + 10;
    drawText(ctx, e.name, tx, 18, { color: e.boss ? UI.amber : UI.cyan });
    drawText(ctx, FAMILY_NAME[e.family] ?? e.family, tx, 30, { color: UI.dim });
    drawText(ctx, `Defeated ×${kills}`, tx, 44);
    // HP becomes known after a few kills.
    drawText(ctx, kills >= 3 ? `HP ${e.hp}` : 'HP ???', tx, 56, { color: kills >= 3 ? UI.text : UI.disabled });
    // Field notes: only what the crew has actually seen.
    const rows: [string, string[], string][] = [
      ['Weak', state.weakSeen[e.id] ?? [], UI.amber],
      ['Resists', state.resistSeen[e.id] ?? [], '#b8bcd0'],
      ['Immune', (state.immuneSeen[e.id] ?? []).map((st) => (st === 'hijacked' ? 'hijack' : st)), '#c9b8ff'],
    ];
    rows.forEach(([label, seen, color], i) => {
      drawText(ctx, label, tx, 72 + i * 12, { color: UI.dim });
      // Damage types with their symbols, as the battle writes them; statuses (Immune) as words.
      const text = seen.length ? seen.map((v) => (label === 'Immune' ? v.toUpperCase() : markElements(v.toUpperCase()))).join(' ') : 'not seen yet';
      drawText(ctx, fitText(text, x + w - tx - 58), tx + 48, 72 + i * 12, { color: seen.length ? color : UI.disabled });
    });
    drawDivider(ctx, x + 6, 128, w - 12);
    drawParagraph(ctx, e.lore, x + 10, 136, w - 20, { color: '#d0cee4', lineH: 11 });
    drawParagraph(ctx, 'Notes are logged when a hit lands weak or is resisted, when a status fails to stick, or when Hex runs Analyze.', x + 10, H - 34, w - 20, { color: UI.dim, lineH: 10 });
  }

  /** Places the crew has been: what each is for and how to get there, plus the objective. */
  private renderPlaces(ctx: Ctx): void {
    drawWindow(ctx, 8, 8, MENU_SIDE_LIST_W, H - 16, { title: 'PLACES', accent: UI.cyan , footer: keyLegend(this.game.input) });
    this.places.rows = sideListRows();
    this.places.render(ctx, 16, MENU_SIDE_LIST_TOP, MENU_SIDE_LIST_W - 14, true, 'Nowhere yet.');
    const x = 8 + MENU_SIDE_LIST_W + 6, w = W - x - 8;
    drawWindow(ctx, x, 8, w, H - 16, { plain: true });
    const cur = PLACES.find((p) => p.id === this.places.current?.value);
    if (cur) {
      drawText(ctx, cur.name, x + 10, 18, { color: UI.cyan });
      if (cur.id === state.map) drawText(ctx, 'You are here', x + w - 10, 18, { align: 'right', color: UI.amber });
      // The blocks flow down from each paragraph's own height, so a longer text pushes the next block
      // along, and a shorter one does not leave a gap.
      const aboutLines = drawParagraph(ctx, cur.about, x + 10, 34, w - 20, { color: '#d0cee4', lineH: 11 });
      const split = 34 + aboutLines * 11 + 8;
      drawDivider(ctx, x + 6, split, w - 12);
      drawText(ctx, 'Getting there', x + 10, split + 8, { color: UI.dim });
      drawParagraph(ctx, cur.route, x + 10, split + 20, w - 20, { color: '#b8bcd0', lineH: 11 });
      drawText(ctx, `${this.game.input.keyName('confirm')}: map`, x + w - 10, split + 8, { color: UI.cyan, align: 'right' });
    }
    const obj = state.flags.objective;
    if (typeof obj === 'string' && obj) {
      drawDivider(ctx, x + 6, H - 58, w - 12);
      drawText(ctx, 'Objective', x + 10, H - 50, { color: UI.amber });
      drawParagraph(ctx, obj, x + 10, H - 38, w - 20, { color: '#ffe7a0', lineH: 11 });
    }
  }

  private renderCombos(ctx: Ctx): void {
    drawWindow(ctx, 8, 8, W - 16, H - 16, { title: 'COMBO LOG', accent: UI.amber , footer: keyLegend(this.game.input) });
    drawText(ctx, 'Choose the right pair of abilities in the same round and they fuse.', 18, 22, { color: UI.dim });
    const found = COMBOS.filter((c) => state.combos.includes(c.id)).length;
    drawText(ctx, `${found}/${chapterCombos().length} found`, W - 18, 22, { align: 'right', color: UI.amber });
    const first = this.comboScroll;
    if (first > 0) drawText(ctx, '▲', W - 24, 32, { color: UI.cyan });
    const rows = comboRows();
    if (first + rows < COMBOS.length) drawText(ctx, '▼', W - 24, H - 20, { color: UI.cyan });
    COMBOS.slice(first, first + rows).forEach((c, i) => {
      const y = COMBO_TOP + i * COMBO_ROW_H;
      const known = state.combos.includes(c.id);
      const ab = ABILITIES[c.id]!;
      const names = c.parts.map((p) => `${MEMBERS[p.member as MemberId].name}: ${ABILITIES[p.ability]!.name}`).join('  +  ');
      drawText(ctx, known ? `★ ${ab.name}` : '★ ???', 18, y, { color: known ? UI.amber : UI.disabled });
      // One the crew can't reach yet says so, rather than leaving a hint nobody can act on.
      const hint = c.later && !known ? 'Not in this chapter: the crew hasn’t learned its parts yet.' : `Hint: ${c.hint}`;
      drawText(ctx, fitText(known ? names : hint, COMBO_TEXT_W), 30, y + 11, { color: known ? '#d0cee4' : UI.dim });
      if (known) drawText(ctx, fitText(markElements(ab.desc), COMBO_TEXT_W), 30, y + 22, { color: UI.dim });
    });
  }
}

/** The places a player can have been, in the order the chapter reaches them. */
const PLACES: { id: string; name: string; about: string; route: string }[] = [
  { id: 'lantern_row', name: 'Lantern Row', about: 'Home turf. The Drowned Saint (Dutch’s bar), Doc Yun’s clinic, the shops, Sleeptube capsules, Mama Ono’s noodles. Rook’s flat and Hex’s den are on the south row.', route: 'The east end of the street opens onto the Sprawl.' },
  { id: 'world', name: 'The Sprawl', about: 'The Lower Wards between the neighbourhoods: the Barrens to the east, Hollowmere Park, the canal. The arcology road north is sealed.', route: 'Lantern Row is west. The Rustyard is north-east up the highway spur. The Sinkline station is south, over the canal bridge.' },
  { id: 'rustyard', name: 'The Rustyard', about: 'A scav camp in the Barrens, squeezed by the Rustfang gang. Old Mags trades the best salvage in the Wards.', route: 'From the Sprawl, follow the old highway spur north-east.' },
  { id: 'sinkline_1', name: 'The Sinkline · B1', about: 'The flooded metro, drowned since ’61. The pump station is south down the maintenance corridor; the junction is east.', route: 'The station entrance is south of the canal bridge.' },
  { id: 'annex', name: 'K-M Annex 7', about: 'A Kessler-Mori research annex, officially decommissioned. Officially.', route: 'A maintenance hatch at the bottom of the Sinkline’s junction.' },
  { id: 'dock', name: 'Loading Dock 7', about: 'Where Mr. Pale said to bring the core.', route: 'The Annex freight lift comes up here.' },
];

function kindIcon(it: ItemDef): string {
  return it.kind === 'use' ? '+' : it.kind === 'key' ? '*' : it.kind === 'loot' ? '$' : '#';
}

function kindColor(it: ItemDef): string {
  return it.kind === 'use' ? UI.green : it.kind === 'key' ? UI.amber : it.kind === 'loot' ? UI.violet : UI.cyan;
}
