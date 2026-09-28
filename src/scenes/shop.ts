/** Shop: buy with quantity + party equip comparison, sell anything that isn't a key item. */
import { buildChar } from '../art/chars';
import { sfx } from '../audio/sfx';
import { autoClose } from '../game/debug';
import { ITEMS, sellPrice } from '../data/items';
import { LOOKS } from '../data/looks';
import { MEMBERS } from '../data/party';
import { SHOPS, type ShopDef } from '../data/shops';
import type { Ctx } from '../engine/canvas';
import { drawParagraph, drawText } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { canEquip, memberStats } from '../game/party';
import { state, type MemberState } from '../game/state';
import { drawDivider, drawWindow, UI } from '../ui/draw';
import { ListMenu } from '../ui/list';

type Mode = 'root' | 'buy' | 'sell' | 'qty';

export class ShopScene extends Scene<void> {
  override opaque = false;
  private shop: ShopDef;
  private mode: Mode = 'root';
  private root = new ListMenu<string>([{ label: 'Buy', value: 'buy' }, { label: 'Sell', value: 'sell' }, { label: 'Leave', value: 'leave' }], 3);
  private list = new ListMenu<string>([], 11);
  private qty = 1;
  private qtyMode: 'buy' | 'sell' = 'buy';
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
        if (r === 'confirm') {
          this.qtyMode = this.mode;
          this.qty = 1;
          this.mode = 'qty';
        }
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
    return Math.max(1, Math.min(room, Math.floor(state.cred / Math.max(1, it.price))));
  }

  private openBuy(): void {
    this.list.setItems(
      this.shop.items.map((id) => {
        const it = ITEMS[id]!;
        return { label: it.name, value: id, right: `${it.price}¢`, enabled: it.price <= state.cred };
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
      this.line = 'You\'ve got nothing I want.';
      return;
    }
    ids.sort((a, b) => (ITEMS[b]!.kind === 'loot' ? 1 : 0) - (ITEMS[a]!.kind === 'loot' ? 1 : 0) || ITEMS[a]!.name.localeCompare(ITEMS[b]!.name));
    this.list.setItems(ids.map((id) => ({ label: ITEMS[id]!.name, value: id, right: `${sellPrice(id)}¢ ×${state.inventory[id]}`, color: ITEMS[id]!.kind === 'loot' ? UI.violet : undefined })));
    this.list.index = 0;
    this.mode = 'sell';
    this.line = 'What are you selling?';
  }

  private transact(id: string): void {
    const it = ITEMS[id]!;
    if (this.qtyMode === 'buy') {
      const cost = it.price * this.qty;
      if (cost > state.cred) {
        sfx('buzz');
        this.line = 'Cred first, then goods.';
        return;
      }
      state.cred -= cost;
      state.inventory[id] = (state.inventory[id] ?? 0) + this.qty;
      sfx('buy');
      this.line = this.qty > 1 ? `${this.qty} ${it.name}s. ${this.shop.thanks}` : this.shop.thanks;
      this.openBuy();
      this.list.index = this.shop.items.indexOf(id);
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
    ctx.fillStyle = 'rgba(7,6,13,0.55)';
    ctx.fillRect(0, 0, W, H);
    const acc = this.shop.accent;
    // Header + keeper line
    drawWindow(ctx, 8, 8, W - 16, 30, { title: this.shop.name, accent: acc });
    drawText(ctx, `{#${acc.slice(1)}}${this.shop.keeper}:{/} ${this.line}`, 16, 18);
    // Root menu + wallet
    drawWindow(ctx, 8, 46, 80, 42, { accent: acc });
    this.root.render(ctx, 15, 52, 70, this.mode === 'root');
    drawWindow(ctx, 8, H - 30, 80, 22, { plain: true });
    drawText(ctx, `{y}${state.cred.toLocaleString('en-US')}¢`, 80, H - 24, { align: 'right' });
    if (this.mode === 'root') return;
    // List
    const lx = 96, lw = 196;
    drawWindow(ctx, lx, 46, lw, H - 54, { title: this.mode === 'sell' || this.qtyMode === 'sell' && this.mode === 'qty' ? 'SELL' : 'BUY', accent: acc });
    this.list.render(ctx, lx + 8, 54, lw - 14, this.mode !== 'qty', this.mode === 'sell' ? 'Nothing to sell.' : 'Sold out.');
    // Detail panel (kept on screen, with a hint, even when the list is empty).
    const dx = lx + lw + 6, dw = W - dx - 8;
    drawWindow(ctx, dx, 46, dw, H - 54, { plain: true });
    const cur = this.list.current;
    if (!cur) {
      drawParagraph(ctx, this.mode === 'sell' ? 'Loot and spare gear you pick up can be sold here.' : 'Check back later.', dx + 8, 52, dw - 16, { color: UI.dim, lineH: 10 });
      return;
    }
    const it = ITEMS[cur.value]!;
    drawText(ctx, it.name, dx + 8, 52, { color: UI.cyan });
    drawText(ctx, `Owned: ${state.inventory[it.id] ?? 0}`, dx + dw - 8, 52, { align: 'right', color: UI.dim });
    const lines = drawParagraph(ctx, it.desc, dx + 8, 64, dw - 16, { color: '#d0cee4', lineH: 10 });
    let y = 70 + lines * 10;
    if (this.isEquip(it.id)) {
      drawDivider(ctx, dx + 6, y, dw - 12);
      y += 6;
      for (const m of state.party.map((p) => state.members[p]!).filter(Boolean)) {
        this.drawCompare(ctx, m, it.id, dx + 8, y, dw - 16);
        y += 22;
      }
    }
    if (this.mode === 'qty') {
      const price = this.qtyMode === 'buy' ? it.price : sellPrice(it.id);
      const w = 150, x = lx + (lw - w) / 2, qy = 120;
      drawWindow(ctx, x, qy, w, 36, { accent: UI.amber });
      drawText(ctx, `Quantity  ◀ {y}${this.qty}{/} ▶`, x + 10, qy + 7);
      drawText(ctx, `${this.qtyMode === 'buy' ? 'Total' : 'You get'}: ${(price * this.qty).toLocaleString('en-US')}¢`, x + 10, qy + 19, { color: UI.dim });
    }
  }

  private drawCompare(ctx: Ctx, m: MemberState, id: string, x: number, y: number, w: number): void {
    const spr = buildChar(LOOKS[m.id]).frames.down[0]!;
    ctx.drawImage(spr, x, y - 4, spr.width * 0.8, spr.height * 0.8);
    drawText(ctx, MEMBERS[m.id].name, x + 18, y, { color: MEMBERS[m.id].color });
    if (!canEquip(m, id)) {
      drawText(ctx, 'can\'t use', x + w, y, { align: 'right', color: UI.disabled });
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
    drawText(ctx, text, x + 18, y + 10);
  }
}
