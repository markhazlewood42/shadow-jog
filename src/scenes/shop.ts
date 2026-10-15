/**
 * Shop: buy with quantity + party equip comparison, sell anything that isn't a key item.
 * Gear bought here can be put on straight away (a picker after the purchase), and loot can be
 * sold in one go. Native sje scene (M8b).
 *
 * Editor contract (migration.md principle 11), items (d) and (e):
 *  - `snapshot()` / `restore(snap)`: the live state of the shop as plain data (the mode, the item ids on the open list, the cursor and scroll of each
 *    list, the quantity, the keeper's line). The shop's stock and the player's bag are game data, not scene state: a restore rebuilds the lists from them.
 *  - `step(n)`: advance n ticks of the shop's animation (the highlight easing to its row, the cursor nudge) with no keys pressed. The same n from the
 *    same state gives the same state.
 */
import { buildChar } from '../art/chars';
import { sfx } from '../audio/sfx';
import { FAMILY_WEAK } from '../data/enemies';
import { ITEMS, sellPrice } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS } from '../data/party';
import { SHOPS, type ShopDef } from '../data/shops';
import { autoClose } from '../game/debug';
import { canEquip, equip, memberStats, SLOT_NAMES } from '../game/party';
import { flags, type MemberState, state } from '../game/state';
import { Container, fitText, Graphics, layoutText, type ListItem, ListMenu, measure, NineSlice, TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { COMPARE_SPRITE_GAP, COMPARE_SPRITE_SCALE, LIST_ROW_H, rowsFor, SHOP_COMPARE_W, SHOP_DETAIL_GAP, SHOP_LIST_W, SHOP_LIST_X, SHOP_TOP } from '../ui/layout';
import { elementMark, markElements } from './battlekit/tables';
import { UiScene } from './uiscene';
import { uiSound } from './uisound';

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

/** The live state of a shop as plain data (editor contract item d). */
export interface ShopSnapshot {
  /** The shop's id in `shops.json`. */
  shop: string;
  mode: Mode;
  /** The keeper's line. */
  line: string;
  /** The quantity being asked for, and whether it is a purchase or a sale. */
  qty: number;
  qtyMode: 'buy' | 'sell';
  /** The gear just bought, offered to the party (empty when none). */
  equipItem: string;
  rootIndex: number;
  /** The item ids on the open buy or sell list, in order (the stock on the shelf, or the sellable bag), and the cursor and scroll on it. */
  stock: string[];
  listIndex: number;
  listScroll: number;
  /** The rows of the equip picker (member ids, then 'none') and its cursor. */
  equipRows: string[];
  equipIndex: number;
  junkIndex: number;
  /** The shop's own tick counter. */
  t: number;
}

export class ShopScene extends UiScene<void> {
  private shop: ShopDef;
  private mode: Mode = 'root';
  private qty = 1;
  private qtyMode: 'buy' | 'sell' = 'buy';
  /** After buying gear: who puts it on now (member ids, then 'none'). */
  private equipItem = '';
  private line: string;

  // The lists are kit `ListMenu`s, built in `create` (a display object needs the running scene).
  private root!: ListMenu<string>;
  private list!: ListMenu<string>;
  private equipList!: ListMenu<string>;
  /** Sell-all-loot confirmation. */
  private junkList!: ListMenu<string>;

  private header!: NineSlice;
  private keeper!: TextObject;
  private wallet!: TextObject;
  private listWin!: NineSlice;
  private detailWin!: NineSlice;
  /** The detail pane's contents, made again whenever what they show changes. */
  private detail!: Container;
  private detailKey = '';
  private qtyPopup!: Container;
  private qtyText!: TextObject;
  private qtyTotal!: TextObject;
  private equipPopup!: Container;
  private equipWin!: NineSlice;
  private junkPopup!: Container;

  constructor(private shopId: string) {
    super();
    this.opaque = false;
    this.curtain = true;
    this.shop = SHOPS[shopId] as ShopDef;
    this.line = this.shop.greeting;
  }

  override create(): void {
    const ui = this.sys.ui;
    const acc = this.shop.accent;
    this.dim();
    // Header + keeper line
    this.header = new NineSlice(this, 8, 8, W - 16, 30, { title: this.shop.name, accent: acc });
    ui.add(this.header);
    this.keeper = new TextObject(this, 16, 18, '');
    ui.add(this.keeper);
    // Root menu + wallet
    ui.add(new NineSlice(this, 8, SHOP_TOP, 80, 42, { accent: acc }));
    this.root = new ListMenu<string>(this, 15, SHOP_TOP + 6, [{ label: 'Buy', value: 'buy' }, { label: 'Sell', value: 'sell' }, { label: 'Leave', value: 'leave' }], { rows: 3, width: 70, onSound: uiSound });
    ui.add(this.root);
    ui.add(new NineSlice(this, 8, H - 30, 80, 22, { plain: true }));
    this.wallet = new TextObject(this, 80, H - 24, '', { align: 'right' });
    ui.add(this.wallet);
    // The list pane and the detail pane (hidden at the root).
    const lx = SHOP_LIST_X;
    const lw = SHOP_LIST_W;
    this.listWin = new NineSlice(this, lx, SHOP_TOP, lw, H - 8 - SHOP_TOP, { title: 'BUY', accent: acc, footer: this.legend() });
    ui.add(this.listWin);
    this.list = new ListMenu<string>(this, lx + 8, SHOP_TOP + 8, [], { rows: shopRows(), width: lw - 14, onSound: uiSound });
    ui.add(this.list);
    const dx = lx + lw + SHOP_DETAIL_GAP;
    this.detailWin = new NineSlice(this, dx, SHOP_TOP, W - dx - 8, H - 8 - SHOP_TOP, { plain: true });
    ui.add(this.detailWin);
    this.detail = new Container(this, 0, 0, 'detail');
    ui.add(this.detail);
    // The popups are made once and shown when their mode comes (they are added after the detail, so they draw over it).
    this.equipList = new ListMenu<string>(this, 8, 10, [], { rows: 5, width: 176 - 14, onSound: uiSound });
    this.junkList = new ListMenu<string>(this, 8, 12, [{ label: 'Sell it all', value: 'yes' }, { label: 'Keep it', value: 'no' }], { rows: 2, width: 150 - 14, onSound: uiSound });
    this.qtyPopup = new Container(this, 0, 0, 'qty-popup');
    this.qtyPopup.add(new NineSlice(this, 0, 0, 150, 36, { accent: UI.amber, alpha: 1 }));
    this.qtyText = new TextObject(this, 10, 7, '');
    this.qtyTotal = new TextObject(this, 10, 19, '', { color: UI.dim });
    this.qtyPopup.add([this.qtyText, this.qtyTotal]);
    this.equipPopup = new Container(this, 0, 0, 'equip-popup');
    this.equipWin = new NineSlice(this, 0, 0, 176, 22, { title: 'EQUIP NOW?', accent: UI.amber, alpha: 1 });
    this.equipPopup.add([this.equipWin, this.equipList]);
    this.junkPopup = new Container(this, 0, 0, 'junk-popup');
    this.junkPopup.add([new NineSlice(this, 0, 0, 150, 44, { title: 'SELL ALL LOOT?', accent: UI.amber, alpha: 1 }), this.junkList]);
    ui.add([this.qtyPopup, this.equipPopup, this.junkPopup]);
    this.refreshView();
  }

  protected tick(): void {
    if (autoClose(this.t, 80)) {
      this.close();
      return;
    }
    this.play();
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.refreshView();
  }

  /** One tick of the shop's rules, with the player's keys. The lists that do not have the cursor only animate. */
  private play(): void {
    const inp = this.input.actions;
    const active = this.mode === 'root' ? this.root : this.mode === 'buy' || this.mode === 'sell' ? this.list : this.mode === 'equip' ? this.equipList : this.mode === 'junk' ? this.junkList : null;
    for (const l of [this.root, this.list, this.equipList, this.junkList]) if (l !== active) l.update();
    switch (this.mode) {
      case 'root': {
        const r = this.root.update(inp);
        if (r === 'cancel' || (r === 'confirm' && this.root.current?.value === 'leave')) {
          this.close();
          return;
        }
        if (r === 'confirm') {
          if (this.root.current?.value === 'buy') this.openBuy();
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
          const it = ITEMS[this.list.current?.value ?? ''];
          if (it) this.line = `That’s ${(this.price(it.id) - state.cred).toLocaleString('en-US')}¢ more than you’ve got.`;
        }
        if (r === 'confirm') {
          const id = this.list.current?.value ?? '';
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
        if (r === 'cancel' || (r === 'confirm' && this.equipList.current?.value === 'none')) {
          this.backToBuy();
          return;
        }
        if (r === 'confirm') this.equipNow(this.equipList.current?.value ?? '');
        break;
      }
      case 'junk': {
        const r = this.junkList.update(inp);
        if (r === 'cancel' || (r === 'confirm' && this.junkList.current?.value === 'no')) {
          this.mode = 'sell';
          return;
        }
        if (r === 'confirm') this.sellAllLoot();
        break;
      }
      case 'qty': {
        const id = this.list.current?.value ?? '';
        const max = this.maxQty(id);
        if (inp.repeat('right') || inp.repeat('up')) { this.qty = Math.min(max, this.qty + 1); sfx('cursor'); }
        if (inp.repeat('left') || inp.repeat('down')) { this.qty = Math.max(1, this.qty - 1); sfx('cursor'); }
        if (inp.justPressed('cancel')) {
          sfx('cancel');
          this.mode = this.qtyMode;
          return;
        }
        if (inp.justPressed('confirm')) this.transact(id);
        break;
      }
    }
  }

  private isEquip(id: string): boolean {
    return !!ITEMS[id]?.slot;
  }

  private maxQty(id: string): number {
    if (this.qtyMode === 'sell') return state.inventory[id] ?? 0;
    const it = ITEMS[id];
    if (!it) return 1;
    const room = 99 - (state.inventory[id] ?? 0);
    return Math.max(1, Math.min(room, Math.floor(state.cred / Math.max(1, this.price(it.id)))));
  }

  /** The buy list's rows, from the shop's data and the player's cred. */
  private buyRows(): ListItem<string>[] {
    return this.shop.items.map((id) => {
      const it = ITEMS[id] as NonNullable<(typeof ITEMS)[string]>;
      // Out of reach reads as a price problem (red), not as an item you can never have.
      const price = this.price(id);
      const afford = price <= state.cred;
      return { label: it.name, value: id, right: `${price}¢`, enabled: afford, rightColor: afford ? undefined : '#c85a64' };
    });
  }

  /** The sell list's rows, from the player's bag. Empty when there is nothing the keeper wants. */
  private sellRows(): ListItem<string>[] {
    const ids = Object.keys(state.inventory).filter((id) => ITEMS[id] && ITEMS[id]?.kind !== 'key' && (state.inventory[id] ?? 0) > 0 && sellPrice(id) > 0);
    ids.sort((a, b) => (ITEMS[b]?.kind === 'loot' ? 1 : 0) - (ITEMS[a]?.kind === 'loot' ? 1 : 0) || (ITEMS[a]?.name ?? '').localeCompare(ITEMS[b]?.name ?? ''));
    const rows: ListItem<string>[] = ids.map((id) => ({ label: ITEMS[id]?.name ?? id, value: id, right: `${sellPrice(id)}¢ ×${state.inventory[id]}`, color: ITEMS[id]?.kind === 'loot' ? UI.violet : undefined }));
    const loot = this.lootTotal();
    if (loot.count) rows.unshift({ label: 'Sell all loot', value: ALL_LOOT, right: `${loot.cred}¢`, color: UI.amber });
    return rows;
  }

  private openBuy(): void {
    this.list.setItems(this.buyRows());
    this.list.index = 0;
    this.mode = 'buy';
    this.line = 'Take a look.';
  }

  private openSell(): void {
    const rows = this.sellRows();
    if (!rows.length) {
      sfx('buzz');
      this.line = 'You’ve got nothing I want.';
      return;
    }
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

  /** The equip picker's rows for a piece of gear: the members who can wear it, then 'Not now'. Null when nobody could newly put it on. */
  private equipRows(id: string): ListItem<string>[] | null {
    const who = state.party.map((p) => state.members[p]).filter((m): m is MemberState => !!m && canEquip(m, id));
    const slot = ITEMS[id]?.slot;
    // Nobody who could newly put it on (it only fits someone already wearing one): no question to ask.
    if (!slot || !who.some((m) => m.equip[slot] !== id)) return null;
    return [
      ...who.map((m) => {
        const on = m.equip[slot] === id;
        const worn = m.equip[slot];
        return { label: MEMBERS[m.id].name, value: m.id, color: MEMBERS[m.id].color, enabled: !on, why: 'Already wearing one.', right: on ? 'Equipped' : worn ? `swap ${ITEMS[worn]?.name ?? ''}` : undefined };
      }),
      { label: 'Not now', value: 'none' },
    ];
  }

  /** After buying gear: offer it to whoever in the party can wear it, if anyone. */
  private offerEquip(id: string): boolean {
    const rows = this.equipRows(id);
    if (!rows) return false;
    this.equipItem = id;
    this.equipList.setItems(rows);
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
    const base = ITEMS[id]?.price ?? 0;
    const d = this.shop.discount;
    return d && flags.has(d.flag) ? Math.round(base * d.mult) : base;
  }

  private transact(id: string): void {
    const it = ITEMS[id];
    if (!it) return;
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
      if ((state.inventory[id] ?? 0) <= 0) delete state.inventory[id];
      sfx('cred');
      this.line = `${sellPrice(id) * n}¢ for the ${it.name}. Pleasure.`;
      const prev = this.list.index;
      this.openSell();
      if (this.mode === 'sell') this.list.index = Math.min(prev, this.list.items.length - 1);
      else this.mode = 'root';
    }
  }

  // ---- editor contract (d) and (e) --------------------------------------------------------------------------

  /** The live state of the shop as plain data. `restore(snapshot())` on a shop with the same game state puts it back. */
  snapshot(): ShopSnapshot {
    return {
      shop: this.shopId,
      mode: this.mode,
      line: this.line,
      qty: this.qty,
      qtyMode: this.qtyMode,
      equipItem: this.equipItem,
      rootIndex: this.root.index,
      stock: this.list.items.map((r) => r.value),
      listIndex: this.list.index,
      listScroll: this.list.scroll,
      equipRows: this.equipList.items.map((r) => r.value),
      equipIndex: this.equipList.index,
      junkIndex: this.junkList.index,
      t: this.t,
    };
  }

  /**
   * Put a snapshot back. The lists are rebuilt from the shop's data and the player's bag (the snapshot holds ids and cursors, not prices), then the
   * cursors are set. Call it on a running scene. A shop id that is not in `shops.json` throws.
   */
  restore(s: ShopSnapshot): void {
    const shop = SHOPS[s.shop];
    if (!shop) throw new Error(`ShopScene.restore: no shop "${s.shop}"`);
    this.shop = shop;
    this.shopId = s.shop;
    this.mode = s.mode;
    this.line = s.line;
    this.qty = s.qty;
    this.qtyMode = s.qtyMode;
    this.equipItem = s.equipItem;
    this.t = s.t;
    this.root.index = s.rootIndex;
    // Which list is open: a quantity question and the equip picker sit over the list they came from.
    const kind = s.mode === 'qty' ? s.qtyMode : s.mode === 'equip' ? 'buy' : s.mode === 'junk' ? 'sell' : s.mode;
    if (kind === 'buy') this.list.setItems(this.buyRows());
    else if (kind === 'sell') this.list.setItems(this.sellRows());
    else this.list.setItems([]);
    this.list.index = s.listIndex;
    this.list.scroll = s.listScroll;
    const picker = s.mode === 'equip' ? this.equipRows(s.equipItem) : null;
    this.equipList.setItems(picker ?? []);
    this.equipList.index = s.equipIndex;
    this.junkList.index = s.junkIndex;
    this.header.setStyle({ title: shop.name, accent: shop.accent });
    this.detailKey = '';
    this.refreshView();
  }

  /**
   * Advance n ticks of the shop's animation with no keys pressed: the highlights ease toward their rows and the cursors nudge. It changes no game
   * state and no mode. The same n from the same state gives the same state.
   */
  step(n: number): void {
    for (let i = 0; i < n; i++) {
      this.t++;
      for (const l of [this.root, this.list, this.equipList, this.junkList]) l.update();
    }
    this.refreshView();
  }

  // ---- the picture --------------------------------------------------------------------------------------------

  /** Where a popup over the list goes: just under the chosen row (its title tab clear of the row), or just over it when there's no room below; opaque, so the list doesn't ghost through. */
  private popupY(h: number): number {
    const row = SHOP_TOP + 8 + (this.list.index - this.list.scroll) * LIST_ROW_H;
    const below = row + 16;
    return below + h <= H - 12 ? below : Math.max(50, row - h - 6);
  }

  /** Bring every object up to date with the shop's state. */
  private refreshView(): void {
    const acc = this.shop.accent;
    const lx = SHOP_LIST_X;
    const lw = SHOP_LIST_W;
    this.header.setStyle({ title: this.shop.name, accent: acc });
    this.keeper.setText(`{#${acc.slice(1)}}${this.shop.keeper}:{/} ${this.line}`);
    this.wallet.setText(`{y}${state.cred.toLocaleString('en-US')}¢`);
    this.root.focused = this.mode === 'root';
    const listed = this.mode !== 'root';
    const selling = this.mode === 'sell' || this.mode === 'junk' || (this.qtyMode === 'sell' && this.mode === 'qty');
    this.listWin.setVisible(listed);
    this.list.setVisible(listed);
    this.detailWin.setVisible(listed);
    if (listed) {
      this.listWin.setStyle({ title: selling ? 'SELL' : 'BUY', accent: acc, footer: this.legend() });
      this.list.rows = shopRows();
      this.list.focused = this.mode === 'buy' || this.mode === 'sell';
      this.list.empty = this.mode === 'sell' ? 'Nothing to sell.' : 'Sold out.';
    }
    this.refreshDetail(listed);
    // The quantity question.
    const qtyOn = this.mode === 'qty' && !!this.list.current;
    this.qtyPopup.setVisible(qtyOn);
    if (qtyOn) {
      const id = this.list.current?.value ?? '';
      const price = this.qtyMode === 'buy' ? this.price(id) : sellPrice(id);
      this.qtyPopup.setPosition(lx + (lw - 150) / 2, this.popupY(36));
      this.qtyText.setText(`Quantity  ◀ {y}${this.qty}{/} ▶`);
      this.qtyTotal.setText(`${this.qtyMode === 'buy' ? 'Total' : 'You get'}: ${(price * this.qty).toLocaleString('en-US')}¢`);
    }
    // The equip picker.
    this.equipPopup.setVisible(this.mode === 'equip');
    if (this.mode === 'equip') {
      const h = 22 + this.equipList.items.length * 11;
      this.equipWin.setSize(176, h);
      this.equipPopup.setPosition(lx + (lw - 176) / 2, this.popupY(h));
      this.equipList.focused = true;
    }
    // The sell-all question.
    const junkOn = this.mode === 'junk' && this.list.current?.value === ALL_LOOT;
    this.junkPopup.setVisible(junkOn);
    if (junkOn) {
      this.junkPopup.setPosition(lx + (lw - 150) / 2, this.popupY(44));
      this.junkList.focused = true;
    }
  }

  /** The detail pane (the chosen item's text, or the loot summary): made again only when what it shows has changed. */
  private refreshDetail(listed: boolean): void {
    this.detail.setVisible(listed);
    if (!listed) return;
    const cur = this.list.current;
    const itemId = this.mode === 'equip' ? this.equipItem : cur?.value ?? '';
    const loot = cur?.value === ALL_LOOT ? this.lootTotal() : null;
    // Everything the pane shows: the item, the wallet and bag (the "Need N more" line and the owned count), what the party wears (the compare rows).
    const worn = this.isEquip(itemId) ? JSON.stringify(state.party.map((p) => state.members[p]?.equip)) : '';
    const key = [this.mode, this.qtyMode, itemId, cur ? 1 : 0, state.cred, state.inventory[itemId] ?? 0, loot ? `${loot.count},${loot.cred},${loot.ids.length}` : '', worn, this.list.items.length].join('|');
    if (key === this.detailKey) return;
    this.detailKey = key;
    this.detail.removeAll(true);
    this.buildDetail(this.detail, cur);
  }

  private buildDetail(box: Container, cur: ListItem<string> | undefined): void {
    const lx = SHOP_LIST_X;
    const lw = SHOP_LIST_W;
    const dx = lx + lw + SHOP_DETAIL_GAP;
    const dw = W - dx - 8;
    const text = (x: number, y: number, str: string, style: ConstructorParameters<typeof TextObject>[4] = {}): TextObject => {
      const t = new TextObject(this, x, y, str, style);
      box.add(t);
      return t;
    };
    /** A wrapped paragraph; returns how many lines it takes. */
    const paragraph = (str: string, x: number, y: number, w: number, color: string): number => {
      const style = { wrapWidth: w, lineHeight: 10, color };
      text(x, y, str, style);
      return layoutText(str, style).lines.length;
    };
    if (!cur) {
      paragraph(this.mode === 'sell' ? 'Loot and spare gear you pick up can be sold here.' : 'Check back later.', dx + 8, SHOP_TOP + 6, dw - 16, UI.dim);
      return;
    }
    if (cur.value === ALL_LOOT) {
      this.buildLootSummary(box, dx, dw);
      return;
    }
    const it = ITEMS[this.mode === 'equip' ? this.equipItem : cur.value];
    if (!it) return;
    text(dx + 8, SHOP_TOP + 6, it.name, { color: UI.cyan });
    text(dx + dw - 8, SHOP_TOP + 6, `Owned: ${state.inventory[it.id] ?? 0}`, { align: 'right', color: UI.dim });
    let top = SHOP_TOP + 18;
    if (it.slot) {
      // Which slot it takes comes first, as a tag: the thing to know before the flavour text.
      const tag = SLOT_NAMES[it.slot].toUpperCase();
      const tw = measure(tag) + 8;
      box.add(this.picture(dx + 8, top - 2, tw, 10, (ctx) => {
        ctx.fillStyle = '#2a3a58';
        ctx.fillRect(0, 0, tw, 10);
        ctx.fillStyle = UI.cyan;
        ctx.fillRect(0, 0, 1, 10);
      }));
      text(dx + 12, top - 1, tag, { color: '#ffffff', shadow: false });
      // Only the crew you've met: a name you don't know yet is a spoiler, and no use to you.
      // Gear anyone can wear lists all four: that's "Anyone", not the members met so far.
      const anyone = !it.who || Object.keys(MEMBERS).every((id) => it.who?.includes(id as MemberState['id']));
      const met = it.who?.filter((w) => !!state.members[w as MemberState['id']]);
      const who = anyone ? 'Anyone' : met?.length ? `${met.map((w) => MEMBERS[w as MemberState['id']]?.name ?? w).join(', ')} only` : 'No one in the crew';
      text(dx + 14 + tw, top - 1, fitText(who, dw - 24 - tw), { color: UI.dim });
      top += 13;
    }
    const lines = paragraph(markElements(it.desc), dx + 8, top, dw - 16, '#d0cee4');
    let y = top + 6 + lines * 10;
    if (it.element && it.element !== 'phys') {
      // What the element bites and what shrugs it off, from the battle's own weakness table.
      const el = it.element;
      const bites = FAMILY_ORDER.filter((f) => (FAMILY_WEAK[f][el] ?? 1) > 1).map((f) => FAMILY_PLURAL[f]);
      const shrugs = FAMILY_ORDER.filter((f) => (FAMILY_WEAK[f][el] ?? 1) < 1).map((f) => FAMILY_PLURAL[f]);
      const str = `${elementMark(el)}{y}${el.toUpperCase()}{/}${bites.length ? ` bites ${bites.join(', ')}` : ''}${shrugs.length ? `; ${shrugs.join(', ')} shrug it off` : ''}.`;
      y += 10 * paragraph(str, dx + 8, y - 4, dw - 16, UI.dim);
    }
    const short = this.price(it.id) - state.cred;
    if (this.mode === 'buy' && short > 0) {
      text(dx + 8, y - 4, `Need ${short.toLocaleString('en-US')}¢ more`, { color: UI.red });
      y += 10;
    }
    if (this.isEquip(it.id)) {
      this.divider(box, dx + 6, y, dw - 12);
      y += 6;
      for (const m of state.party.map((p) => state.members[p]).filter((m): m is MemberState => !!m)) {
        this.buildCompare(box, m, it.id, dx + 8, y, dw - 16);
        y += 22;
      }
    }
  }

  /** The sell-all row's detail: what goes, and what it fetches. */
  private buildLootSummary(box: Container, dx: number, dw: number): void {
    const loot = this.lootTotal();
    const text = (x: number, y: number, str: string, style: ConstructorParameters<typeof TextObject>[4] = {}): void => void box.add(new TextObject(this, x, y, str, style));
    text(dx + 8, SHOP_TOP + 6, 'All loot', { color: UI.violet });
    text(dx + dw - 8, SHOP_TOP + 6, `${loot.count} pieces`, { align: 'right', color: UI.dim });
    let y = SHOP_TOP + 20;
    for (const id of loot.ids.slice(0, 14)) {
      text(dx + 8, y, fitText(ITEMS[id]?.name ?? id, dw - 60), { color: '#d0cee4' });
      text(dx + dw - 8, y, `×${state.inventory[id]}`, { align: 'right', color: UI.dim });
      y += 10;
    }
    if (loot.ids.length > 14) {
      text(dx + 8, y, `+${loot.ids.length - 14} more`, { color: UI.dim });
      y += 10;
    }
    this.divider(box, dx + 6, y + 2, dw - 12);
    text(dx + 8, y + 8, `{y}${loot.cred.toLocaleString('en-US')}¢{/} for the lot`);
  }

  /** The thin two-tone line between the sections of the detail pane (the old `drawDivider`). One of the three plain Graphics the kit allows. */
  private divider(box: Container, x: number, y: number, w: number): void {
    const g = new Graphics(this, 0, 0).fillStyle(0x2c2a58, 1).fillRect(x, y, w, 1).fillStyle(0x0a0918, 1).fillRect(x, y + 1, w, 1);
    g.name = 'divider';
    box.add(g);
  }

  /** One crew member's row under a piece of gear: their sprite, their name, and what wearing it changes. */
  private buildCompare(box: Container, m: MemberState, id: string, x: number, y: number, w: number): void {
    const spr = buildChar(LOOKS[m.id]).frames.down[0] as HTMLCanvasElement;
    const sw = Math.ceil(spr.width * COMPARE_SPRITE_SCALE);
    const sh = spr.height * COMPARE_SPRITE_SCALE;
    // A character sprite is art: a canvas picture.
    box.add(this.picture(x, y - 4, sw, sh, (ctx) => ctx.drawImage(spr, 0, 0, sw, sh)));
    // The name and the stat changes start clear of the sprite (Mark, Review 4: they overlapped before).
    const tx = x + sw + COMPARE_SPRITE_GAP;
    box.add(new TextObject(this, tx, y, MEMBERS[m.id].name, { color: MEMBERS[m.id].color }));
    if (!canEquip(m, id)) {
      box.add(new TextObject(this, x + w, y, 'can’t use', { align: 'right', color: UI.disabled }));
      return;
    }
    const it = ITEMS[id] as NonNullable<(typeof ITEMS)[string]>;
    const slot = it.slot as NonNullable<typeof it.slot>;
    const cur = memberStats(m);
    const trial = memberStats({ ...m, equip: { ...m.equip, [slot]: id } });
    const diffs: string[] = [];
    for (const [k, label] of [['atk', 'ATK'], ['def', 'DEF'], ['mnd', 'MND'], ['res', 'RES'], ['agi', 'AGI']] as const) {
      const d = trial[k] - cur[k];
      if (d) diffs.push(`${d > 0 ? '{g}' : '{r}'}${label}${d > 0 ? '+' : ''}${d}{/}`);
    }
    const equipped = m.equip[slot] === id;
    const str = equipped ? '{c}Equipped{/}' : diffs.length ? diffs.join(' ') : '{d}no change{/}';
    box.add(new TextObject(this, tx, y + 10, fitText(str, SHOP_COMPARE_W - (tx - x))));
  }
}
