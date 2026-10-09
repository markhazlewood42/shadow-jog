/**
 * Shop: buy with quantity + party equip comparison, sell anything that isn't a key item.
 * Gear bought here can be put on straight away (a picker after the purchase), and loot can be
 * sold in one go.
 */
import { FAMILY_WEAK } from '../data/enemies';
import { elementMark, markElements } from './battlekit/tables';
import { buildChar } from '../art/chars';
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import { ITEMS, sellPrice } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS } from '../data/party';
import { SHOPS, type ShopDef } from '../data/shops';
import type { Ctx } from '../engine/canvas';
import { drawParagraph, drawText, fitText, measure } from '../engine/font';
import { LIST_ROW_H, rowsFor, SHOP_COMPARE_W, SHOP_DETAIL_GAP, SHOP_LIST_W, SHOP_LIST_X, SHOP_TOP } from '../ui/layout';
import { Scene, W, H } from '../engine/game';
import { canEquip, equip, memberStats, SLOT_NAMES } from '../game/party';
import { flags, state, type MemberState } from '../game/state';
import { drawDivider, drawWindow, keyLegend, UI, OVERLAY_DIM } from '../ui/draw';
import { ListMenu, type ListItem } from '../ui/list';

type Mode = 'root' | 'buy' | 'sell' | 'qty' | 'equip' | 'junk';

/** The sell list's first row when there's loot: sell every piece at once. */
const ALL_LOOT = '__all_loot__';

/**
 * Rows of the buy and sell list: its window runs from SHOP_TOP to 8 px above the screen's bottom,
 * and the first row is 8 px into it (the list keeps 6 px under its last row). Follows the height.
 */
const shopRows = (): number => rowsFor(H - 8 - SHOP_TOP - 8 - 6, LIST_ROW_H);

/** Enemy families in the order the shop lists them, and how it names them. */
const FAMILY_ORDER = ['human', 'machine', 'beast', 'spirit', 'ghoul'] as const;
const FAMILY_PLURAL: Record<(typeof FAMILY_ORDER)[number], string> = { human: 'people', machine: 'machines', beast: 'beasts', spirit: 'spirits', ghoul: 'ghouls' };

export class ShopScene extends Scene<void> {
  override opaque = false;
  override curtain = true;
  private shop: ShopDef;
  private mode: Mode = 'root';
  private root = new ListMenu<string>([{ label: 'Buy', value: 'buy' }, { label: 'Sell', value: 'sell' }, { label: 'Leave', value: 'leave' }], 3);
  private list = new ListMenu<string>([], shopRows());
  private qty = 1;
  private qtyMode: 'buy' | 'sell' = 'buy';
  /** After buying gear: who puts it on now (member ids, then 'none'). */
  private equipList = new ListMenu<string>([], 5);
  private equipItem = '';
  /** Sell-all-loot confirmation. */
  private junkList = new ListMenu<string>([{ label: 'Sell it all', value: 'yes' }, { label: 'Keep it', value: 'no' }], 2);
  private line: string;
  private t = 0;

  constructor(id: string) {
    super();
    this.shop = SHOPS[id]!;
    this.line = this.shop.greeting;
  }

  update(): void {
    this.t++;
    if (autoClose(this.t, 80)) {
      this.close();
      return;
    }
    const inp = this.game.input;
    switch (this.mode) {
      case 'root': {
        const r = this.root.update(inp);
        if (r === 'cancel' || (r === 'confirm' && this.root.current!.value === 'leave')) {
          this.close();
          return;
        }
        if (r === 'confirm') {
          if (this.root.current!.value === 'buy') this.openBuy();
          else this.openSell();
        }
        break;
      }
      case 'buy':
      case 'sell': {
        const r = this.list.update(inp);
        if (r === 'cancel') {
          this.mode = 'root';
          return;
        }
        if (r === 'blocked' && this.mode === 'buy') {
          // Say why: a greyed-out row with no reason reads as a bug.
          const it = ITEMS[this.list.current!.value]!;
          this.line = `That’s ${(this.price(it.id) - state.cred).toLocaleString('en-US')}¢ more than you’ve got.`;
        }
        if (r === 'confirm') {
          const id = this.list.current!.value;
          if (id === ALL_LOOT) {
            this.junkList.index = 0;
            this.mode = 'junk';
            return;
          }
          this.qtyMode = this.mode;
          // Loot is only ever sold, so the whole stack is the likely answer; gear and supplies start at one.
          this.qty = this.mode === 'sell' && ITEMS[id]?.kind === 'loot' ? this.maxQty(id) : 1;
          this.mode = 'qty';
        }
        break;
      }
      case 'equip': {
        const r = this.equipList.update(inp);
        if (r === 'cancel' || (r === 'confirm' && this.equipList.current!.value === 'none')) {
          this.backToBuy();
          return;
        }
        if (r === 'confirm') this.equipNow(this.equipList.current!.value);
        break;
      }
      case 'junk': {
        const r = this.junkList.update(inp);
        if (r === 'cancel' || (r === 'confirm' && this.junkList.current!.value === 'no')) {
          this.mode = 'sell';
          return;
        }
        if (r === 'confirm') this.sellAllLoot();
        break;
      }
      case 'qty': {
        const id = this.list.current!.value;
        const max = this.maxQty(id);
        if (inp.repeat('right') || inp.repeat('up')) { this.qty = Math.min(max, this.qty + 1); sfx('cursor'); }
        if (inp.repeat('left') || inp.repeat('down')) { this.qty = Math.max(1, this.qty - 1); sfx('cursor'); }
        if (inp.pressed('cancel')) {
          sfx('cancel');
          this.mode = this.qtyMode;
          return;
        }
        if (inp.pressed('confirm')) this.transact(id);
        break;
      }
    }
  }

  private isEquip(id: string): boolean {
    return !!ITEMS[id]?.slot;
  }

  private maxQty(id: string): number {
    if (this.qtyMode === 'sell') return state.inventory[id] ?? 0;
    const it = ITEMS[id]!;
    const room = 99 - (state.inventory[id] ?? 0);
    return Math.max(1, Math.min(room, Math.floor(state.cred / Math.max(1, this.price(it.id)))));
  }

  private openBuy(): void {
    this.list.setItems(
      this.shop.items.map((id) => {
        const it = ITEMS[id]!;
        // Out of reach reads as a price problem (red), not as an item you can never have.
        const price = this.price(id);
        const afford = price <= state.cred;
        return { label: it.name, value: id, right: `${price}¢`, enabled: afford, rightColor: afford ? undefined : '#c85a64' };
      }),
    );
    this.list.index = 0;
    this.mode = 'buy';
    this.line = 'Take a look.';
  }

  private openSell(): void {
    const ids = Object.keys(state.inventory).filter((id) => ITEMS[id] && ITEMS[id]!.kind !== 'key' && (state.inventory[id] ?? 0) > 0 && sellPrice(id) > 0);
    if (!ids.length) {
      sfx('buzz');
      this.line = 'You’ve got nothing I want.';
      return;
    }
    ids.sort((a, b) => (ITEMS[b]!.kind === 'loot' ? 1 : 0) - (ITEMS[a]!.kind === 'loot' ? 1 : 0) || ITEMS[a]!.name.localeCompare(ITEMS[b]!.name));
    const rows: ListItem<string>[] = ids.map((id) => ({ label: ITEMS[id]!.name, value: id, right: `${sellPrice(id)}¢ ×${state.inventory[id]}`, color: ITEMS[id]!.kind === 'loot' ? UI.violet : undefined }));
    const loot = this.lootTotal();
    if (loot.count) rows.unshift({ label: 'Sell all loot', value: ALL_LOOT, right: `${loot.cred}¢`, color: UI.amber });
    this.list.setItems(rows);
    this.list.index = 0;
    this.mode = 'sell';
    this.line = 'What are you selling?';
  }

  /** Every piece of loot you're carrying: how many, and what it all fetches. */
  private lootTotal(): { count: number; cred: number; ids: string[] } {
    const ids = Object.keys(state.inventory).filter((id) => ITEMS[id]?.kind === 'loot' && (state.inventory[id] ?? 0) > 0 && sellPrice(id) > 0);
    let count = 0, cred = 0;
    for (const id of ids) {
      const n = state.inventory[id] ?? 0;
      count += n;
      cred += sellPrice(id) * n;
    }
    return { count, cred, ids };
  }

  private sellAllLoot(): void {
    const loot = this.lootTotal();
    for (const id of loot.ids) delete state.inventory[id];
    state.cred += loot.cred;
    sfx('cred');
    this.line = `${loot.cred.toLocaleString('en-US')}¢ for the lot. Pleasure.`;
    this.openSell();
    if (this.mode !== 'sell') this.mode = 'root';
    else this.list.index = 0;
  }

  /** After buying gear: offer it to whoever in the party can wear it, if anyone. */
  private offerEquip(id: string): boolean {
    const who = state.party.map((p) => state.members[p]).filter((m): m is MemberState => !!m && canEquip(m, id));
    const slot = ITEMS[id]?.slot;
    // Nobody who could newly put it on (it only fits someone already wearing one): no question to ask.
    if (!slot || !who.some((m) => m.equip[slot] !== id)) return false;
    this.equipItem = id;
    this.equipList.setItems([
      ...who.map((m) => {
        const on = m.equip[slot] === id;
        const worn = m.equip[slot];
        return { label: MEMBERS[m.id].name, value: m.id, color: MEMBERS[m.id].color, enabled: !on, why: 'Already wearing one.', right: on ? 'Equipped' : worn ? `swap ${ITEMS[worn]?.name ?? ''}` : undefined };
      }),
      { label: 'Not now', value: 'none' },
    ]);
    this.equipList.index = Math.max(0, this.equipList.items.findIndex((r) => r.enabled !== false));
    this.mode = 'equip';
    return true;
  }

  private equipNow(memberId: string): void {
    const m = state.members[memberId as MemberState['id']];
    const it = ITEMS[this.equipItem];
    if (!m || !it?.slot) return;
    equip(m, it.id, it.slot);
    sfx('equip');
    this.line = `${MEMBERS[m.id].name} puts on the ${it.name}.`;
    // More copies and someone else who could use one: keep the picker up; otherwise back to the shelf.
    if ((state.inventory[it.id] ?? 0) > 0 && this.offerEquip(it.id) && this.equipList.items.some((r) => r.value !== 'none' && r.enabled !== false)) return;
    this.backToBuy();
  }

  private backToBuy(): void {
    const id = this.equipItem;
    this.openBuy();
    this.list.index = Math.max(0, this.shop.items.indexOf(id));
  }

  /** What this keeper asks for an item (the list price, less any discount you've earned). */
  private price(id: string): number {
    const base = ITEMS[id]!.price;
    const d = this.shop.discount;
    return d && flags.has(d.flag) ? Math.round(base * d.mult) : base;
  }

  private transact(id: string): void {
    const it = ITEMS[id]!;
    if (this.qtyMode === 'buy') {
      const cost = this.price(it.id) * this.qty;
      if (cost > state.cred) {
        sfx('buzz');
        this.line = 'Cred first, then goods.';
        return;
      }
      state.cred -= cost;
      state.inventory[id] = (state.inventory[id] ?? 0) + this.qty;
      sfx('buy');
      this.line = this.qty > 1 ? `${this.qty} ${it.name}s. ${this.shop.thanks}` : this.shop.thanks;
      this.equipItem = id;
      // Gear: offer to put it on here rather than sending you to the menu.
      if (this.isEquip(id) && this.offerEquip(id)) return;
      this.backToBuy();
    } else {
      const have = state.inventory[id] ?? 0;
      const n = Math.min(have, this.qty);
      state.cred += sellPrice(id) * n;
      state.inventory[id] = have - n;
      if (state.inventory[id]! <= 0) delete state.inventory[id];
      sfx('cred');
      this.line = `${sellPrice(id) * n}¢ for the ${it.name}. Pleasure.`;
      const prev = this.list.index;
      this.openSell();
      if (this.mode === 'sell') this.list.index = Math.min(prev, this.list.items.length - 1);
      else this.mode = 'root';
    }
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = OVERLAY_DIM;
    ctx.fillRect(0, 0, W, H);
    const acc = this.shop.accent;
    // Header + keeper line
    drawWindow(ctx, 8, 8, W - 16, 30, { title: this.shop.name, accent: acc });
    drawText(ctx, `{#${acc.slice(1)}}${this.shop.keeper}:{/} ${this.line}`, 16, 18);
    // Root menu + wallet
    drawWindow(ctx, 8, SHOP_TOP, 80, 42, { accent: acc });
    this.root.render(ctx, 15, SHOP_TOP + 6, 70, this.mode === 'root');
    drawWindow(ctx, 8, H - 30, 80, 22, { plain: true });
    drawText(ctx, `{y}${state.cred.toLocaleString('en-US')}¢`, 80, H - 24, { align: 'right' });
    if (this.mode === 'root') return;
    // List
    const lx = SHOP_LIST_X, lw = SHOP_LIST_W;
    const selling = this.mode === 'sell' || this.mode === 'junk' || (this.qtyMode === 'sell' && this.mode === 'qty');
    drawWindow(ctx, lx, SHOP_TOP, lw, H - 8 - SHOP_TOP, { title: selling ? 'SELL' : 'BUY', accent: acc, footer: keyLegend(this.game.input) });
    this.list.rows = shopRows();
    this.list.render(ctx, lx + 8, SHOP_TOP + 8, lw - 14, this.mode === 'buy' || this.mode === 'sell', this.mode === 'sell' ? 'Nothing to sell.' : 'Sold out.');
    // Detail panel (kept on screen, with a hint, even when the list is empty).
    const dx = lx + lw + SHOP_DETAIL_GAP, dw = W - dx - 8;
    drawWindow(ctx, dx, SHOP_TOP, dw, H - 8 - SHOP_TOP, { plain: true });
    const cur = this.list.current;
    if (!cur) {
      drawParagraph(ctx, this.mode === 'sell' ? 'Loot and spare gear you pick up can be sold here.' : 'Check back later.', dx + 8, SHOP_TOP + 6, dw - 16, { color: UI.dim, lineH: 10 });
      return;
    }
    if (cur.value === ALL_LOOT) {
      this.renderLootSummary(ctx, dx, dw);
      if (this.mode === 'junk') this.renderJunkConfirm(ctx, lx, lw);
      return;
    }
    const it = ITEMS[this.mode === 'equip' ? this.equipItem : cur.value]!;
    drawText(ctx, it.name, dx + 8, SHOP_TOP + 6, { color: UI.cyan });
    drawText(ctx, `Owned: ${state.inventory[it.id] ?? 0}`, dx + dw - 8, SHOP_TOP + 6, { align: 'right', color: UI.dim });
    let top = SHOP_TOP + 18;
    if (it.slot) {
      // Which slot it takes comes first, as a tag: the thing to know before the flavour text.
      const tag = SLOT_NAMES[it.slot].toUpperCase();
      const tw = measure(tag) + 8;
      ctx.fillStyle = '#2a3a58';
      ctx.fillRect(dx + 8, top - 2, tw, 10);
      ctx.fillStyle = UI.cyan;
      ctx.fillRect(dx + 8, top - 2, 1, 10);
      drawText(ctx, tag, dx + 12, top - 1, { color: '#ffffff', shadow: false });
      // Only the crew you've met: a name you don't know yet is a spoiler, and no use to you.
      // Gear anyone can wear lists all four: that's "Anyone", not the members met so far.
      const anyone = !it.who || Object.keys(MEMBERS).every((id) => it.who?.includes(id as MemberState['id']));
      const met = it.who?.filter((w) => !!state.members[w as MemberState['id']]);
      const who = anyone ? 'Anyone' : met?.length ? `${met.map((w) => MEMBERS[w as MemberState['id']]?.name ?? w).join(', ')} only` : 'No one in the crew';
      drawText(ctx, fitText(who, dw - 24 - tw), dx + 14 + tw, top - 1, { color: UI.dim });
      top += 13;
    }
    const lines = drawParagraph(ctx, markElements(it.desc), dx + 8, top, dw - 16, { color: '#d0cee4', lineH: 10 });
    let y = top + 6 + lines * 10;
    if (it.element && it.element !== 'phys') {
      // What the element bites and what shrugs it off, from the battle's own weakness table.
      const bites = FAMILY_ORDER.filter((f) => (FAMILY_WEAK[f][it.element!] ?? 1) > 1).map((f) => FAMILY_PLURAL[f]);
      const shrugs = FAMILY_ORDER.filter((f) => (FAMILY_WEAK[f][it.element!] ?? 1) < 1).map((f) => FAMILY_PLURAL[f]);
      const text = `${elementMark(it.element)}{y}${it.element.toUpperCase()}{/}${bites.length ? ` bites ${bites.join(', ')}` : ''}${shrugs.length ? `; ${shrugs.join(', ')} shrug it off` : ''}.`;
      y += 10 * drawParagraph(ctx, text, dx + 8, y - 4, dw - 16, { color: UI.dim, lineH: 10 });
    }
    const short = this.price(it.id) - state.cred;
    if (this.mode === 'buy' && short > 0) {
      drawText(ctx, `Need ${short.toLocaleString('en-US')}¢ more`, dx + 8, y - 4, { color: UI.red });
      y += 10;
    }
    if (this.isEquip(it.id)) {
      drawDivider(ctx, dx + 6, y, dw - 12);
      y += 6;
      for (const m of state.party.map((p) => state.members[p]!).filter(Boolean)) {
        this.drawCompare(ctx, m, it.id, dx + 8, y, dw - 16);
        y += 22;
      }
    }
    if (this.mode === 'qty') {
      const price = this.qtyMode === 'buy' ? this.price(it.id) : sellPrice(it.id);
      const w = 150, x = lx + (lw - w) / 2, qy = this.popupY(36);
      drawWindow(ctx, x, qy, w, 36, { accent: UI.amber, alpha: 1 });
      drawText(ctx, `Quantity  ◀ {y}${this.qty}{/} ▶`, x + 10, qy + 7);
      drawText(ctx, `${this.qtyMode === 'buy' ? 'Total' : 'You get'}: ${(price * this.qty).toLocaleString('en-US')}¢`, x + 10, qy + 19, { color: UI.dim });
    }
    if (this.mode === 'equip') {
      const w = 176, h = 22 + this.equipList.items.length * 11, x = lx + (lw - w) / 2, ey = this.popupY(h);
      drawWindow(ctx, x, ey, w, h, { title: 'EQUIP NOW?', accent: UI.amber, alpha: 1 });
      this.equipList.render(ctx, x + 8, ey + 10, w - 14, true);
    }
  }

  /**
   * Where a popup over the list goes: just under the chosen row (its title tab clear of the row),
   * or just over it when there's no room below; opaque, so the list doesn't ghost through.
   */
  private popupY(h: number): number {
    const row = SHOP_TOP + 8 + (this.list.index - this.list.scroll) * LIST_ROW_H;
    const below = row + 16;
    return below + h <= H - 12 ? below : Math.max(50, row - h - 6);
  }

  /** The sell-all row's detail: what goes, and what it fetches. */
  private renderLootSummary(ctx: Ctx, dx: number, dw: number): void {
    const loot = this.lootTotal();
    drawText(ctx, 'All loot', dx + 8, SHOP_TOP + 6, { color: UI.violet });
    drawText(ctx, `${loot.count} pieces`, dx + dw - 8, SHOP_TOP + 6, { align: 'right', color: UI.dim });
    let y = SHOP_TOP + 20;
    for (const id of loot.ids.slice(0, 14)) {
      drawText(ctx, fitText(ITEMS[id]!.name, dw - 60), dx + 8, y, { color: '#d0cee4' });
      drawText(ctx, `×${state.inventory[id]}`, dx + dw - 8, y, { align: 'right', color: UI.dim });
      y += 10;
    }
    if (loot.ids.length > 14) {
      drawText(ctx, `+${loot.ids.length - 14} more`, dx + 8, y, { color: UI.dim });
      y += 10;
    }
    drawDivider(ctx, dx + 6, y + 2, dw - 12);
    drawText(ctx, `{y}${loot.cred.toLocaleString('en-US')}¢{/} for the lot`, dx + 8, y + 8);
  }

  private renderJunkConfirm(ctx: Ctx, lx: number, lw: number): void {
    const w = 150, x = lx + (lw - w) / 2, qy = this.popupY(44);
    drawWindow(ctx, x, qy, w, 44, { title: 'SELL ALL LOOT?', accent: UI.amber, alpha: 1 });
    this.junkList.render(ctx, x + 8, qy + 12, w - 14, true);
  }

  private drawCompare(ctx: Ctx, m: MemberState, id: string, x: number, y: number, w: number): void {
    const spr = buildChar(LOOKS[m.id]).frames.down[0]!;
    ctx.drawImage(spr, x, y - 4, spr.width * 0.8, spr.height * 0.8);
    drawText(ctx, MEMBERS[m.id].name, x + 18, y, { color: MEMBERS[m.id].color });
    if (!canEquip(m, id)) {
      drawText(ctx, 'can’t use', x + w, y, { align: 'right', color: UI.disabled });
      return;
    }
    const it = ITEMS[id]!;
    const cur = memberStats(m);
    const trial = memberStats({ ...m, equip: { ...m.equip, [it.slot!]: id } });
    const diffs: string[] = [];
    for (const [k, label] of [['atk', 'ATK'], ['def', 'DEF'], ['mnd', 'MND'], ['res', 'RES'], ['agi', 'AGI']] as const) {
      const d = trial[k] - cur[k];
      if (d) diffs.push(`${d > 0 ? '{g}' : '{r}'}${label}${d > 0 ? '+' : ''}${d}{/}`);
    }
    const equipped = m.equip[it.slot!] === id;
    const text = equipped ? '{c}Equipped{/}' : diffs.length ? diffs.join(' ') : '{d}no change{/}';
    drawText(ctx, fitText(text, SHOP_COMPARE_W), x + 18, y + 10);
  }
}
