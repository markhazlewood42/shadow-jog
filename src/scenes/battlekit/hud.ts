/**
 * The battle's windows as kit parts (M8c group G; docs/engine/m8-brief.md, "Mark decided on 2026-10-15: port those windows in M8c").
 *
 * Until now `render.ts` painted every window, text, bar and menu of the battle with canvas calls into the scene's one `CanvasImage`. This file holds the same
 * screens as display objects in the scene's ui layer, the way the M8b scenes do: `NineSlice` windows, `TextObject` texts, `Bar`s and kit `ListMenu`s. The scene
 * keeps state and flow; this reads it (`sync`) and never changes game state.
 *
 * Which part is which:
 *   - Windows and text: the tell, the top banner and message, the help and description line, the round, command and list windows, the target box, the party
 *     cards and the enemy status (these two only without a stage), the victory and level-up panels (`panels.ts`), the names in the cut-ins.
 *   - Menus: the round, command and list menus are kit `ListMenu`s (the scene owns them and gives them the keys).
 *   - Bars: the kit `Bar`, with its damage ghost.
 *   - Still canvas pictures, because they are ART: the portrait faces, the enemy and party sprites and the whole world (`render.ts`), the big action banner
 *     (a gradient band and 2x letters), the VICTORY banner (3x letters with a light sweep), the turn-order strip's face frames, a cut-in's frame and portrait, Hex's
 *     deck, the amber chips (a tell's mark, a status chip, a new-skill tag) and the plates under them.
 *   - Plain `Graphics`: none here. (The dim, the divider and the select highlight are the only ones the kit allows; the battle needs none of them.)
 *
 * When a box is built again: a box that has many small parts (a card, an enemy's status, the target box, the top lines) is described as plain ops (`uiops.ts`)
 * and built again only when the JSON of its ops changes. A part that moves smoothly (a cut-in sliding, a window's pulse) is never built again for it: its
 * container moves or its alpha changes.
 */
import { drawMiniDeck } from '../../art/deck';
import { enemyArt } from '../../art/enemies';
import { getPortrait } from '../../art/portraits';
import type { Combatant, Element } from '../../battle/types';
import { ABILITIES } from '../../data/abilities';
import { ENEMIES, FAMILY_WEAK } from '../../data/enemies';
import { ITEMS } from '../../data/items';
import { MEMBERS } from '../../data/party';
import { state, type MemberId } from '../../game/state';
import { Bar, CanvasImage, Container, drawText, fitText, type GameObject, hpColor, ListMenu, measure, TextObject, UI, wrap } from '../../sje';
import { H, W } from '../../sje/core/size';
import { TARGET_INFO_W } from '../../ui/layout';
import type { BattleScene } from '../battle';
import { uiSound } from '../uisound';
import { ViewBuilder } from '../uiview';
import { drawVictoryBanner } from './banner';
import { BANNER_H, CARD_H, CARD_RAISE, CARD_W, CMD_W, DECK_CUT_LIFE, HUD, listWindowW, MENU_ABOVE_PANEL, MENU_X, ORDER_BOTTOM, ORDER_FACE, ORDER_LABEL_ABOVE, ORDER_RIGHT, ORDER_STEP_OUT, ORDER_THUMB, ORDER_TOP, orderStripLayout, PANEL_Y, ROUND_MENU_H, WORLD_SCALE } from './geom';
import { ELEMENT_COLOR, ELEMENT_ICON, ELEMENT_TAG, ELEMENTS, elementMark, markElements, STATUS_LABEL, statusName } from './tables';
import { artTop, drawBig, enemyThumb } from './sprites';
import { applyOps, barPixels, LAG_COLOR, type Op } from '../uiops';
import type { Cutin } from './playback';

/** Who is acting: one bright color for the bouncing arrow, their status card and their turn-order entry. Picking a target uses the menu cursor's cyan instead. */
export const ACTIVE = '#fff04a';
/** An enemy's tell: amber, the color of a warning. */
const TELL_COLOR = '#ffb23a';
export const AIMING = '#6ff3ff';
const DARK = '#0a0913';

/** How the street names each kind of enemy (the target box's hint line). */
const FAMILY_NAME: Record<string, string> = { human: 'Chromed', machine: 'Machine', beast: 'Beast', spirit: 'Spirit', ghoul: 'Ghoul' };

/** A made box: the container, and the key of what it shows. */
interface Keyed {
  box: Container;
  key: string;
}

/** The ops of one box, and what moves without a rebuild. */
interface Card extends Keyed {
  ring: CanvasImage | null;
}

/** An op without what animates: a text line's string, a bar's fill and ghost. */
function shapeOf(o: Op): Op {
  if (o.k === 'text') return { ...o, s: '' };
  if (o.k === 'bar') return { ...o, fill: 0, lag: 0 };
  return o;
}

/** Bring the parts that `applyOps` made for `ops` up to date: the strings of the text lines and the fill and ghost of the bars. The part for op i is child i of the box. */
function patchOps(box: Container, ops: readonly Op[]): void {
  const parts = box.list;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const part = parts[i];
    if (o?.k === 'text' && part instanceof TextObject) part.setText(o.s);
    else if (o?.k === 'bar' && part instanceof Bar) {
      part.setRatio(o.w > 0 ? o.fill / o.w : 0);
      part.setGhost(o.lag > o.fill && o.w > 0 ? { ratio: o.lag / o.w, color: LAG_COLOR } : null);
    }
  }
}

export class BattleHud {
  // The layers, in the order the old picture drew them (the first is the lowest).
  private enemyLayer!: Container;
  private cardLayer!: Container;
  private tellBox!: Keyed;
  private bannerBox!: Keyed;
  private menuLayer!: Container;
  private topLineBox!: Keyed;
  private targetBox!: Keyed;
  private orderLayer!: Container;
  private cutinLayer!: Container;
  private victoryBanner: CanvasImage | null = null;
  private victoryT = -1;

  // The menus (the scene reads them: `current`, `items`, `index`).
  roundMenu!: ListMenu<string>;
  cmdMenu!: ListMenu<string>;
  listMenu!: ListMenu<string>;
  private roundWin!: Keyed;
  private cmdWin!: Keyed;
  private listWin!: Keyed;

  private readonly enemies = new Map<number, Keyed>();
  private readonly cards: Card[] = [];
  private readonly cutins = new Map<Cutin, Container>();
  private deck: { img: CanvasImage; t: number } | null = null;
  /** The text objects and pictures of the banner that fade with its alpha. */
  private fade: GameObject[] = [];
  private order: { key: string; entries: { box: Container; pulse: CanvasImage | null }[] } = { key: '', entries: [] };
  private orderLabel!: Keyed;

  constructor(private readonly s: BattleScene) {}

  /** Make the layers and the three menus. Call it from the scene's `create` (a display object needs the running scene). */
  create(): void {
    const s = this.s;
    const ui = s.sys.ui;
    const layer = (name: string): Container => {
      const c = new Container(s, 0, 0, name);
      ui.add(c);
      return c;
    };
    const keyed = (c: Container): Keyed => ({ box: c, key: '' });
    this.enemyLayer = layer('battle-enemy-status');
    this.cardLayer = layer('battle-cards');
    this.tellBox = keyed(layer('battle-tell'));
    this.bannerBox = keyed(layer('battle-banner'));
    this.menuLayer = layer('battle-menus');
    this.topLineBox = keyed(layer('battle-topline'));
    this.targetBox = keyed(layer('battle-target'));
    this.orderLayer = layer('battle-order');
    this.cutinLayer = layer('battle-cutins');
    this.orderLabel = keyed(new Container(s, 0, 0, 'battle-order-label'));
    this.orderLayer.add(this.orderLabel.box);
    const menu = (rows: number): ListMenu<string> => {
      const l = new ListMenu<string>(s, 0, 0, [], { rows, onSound: uiSound });
      l.setVisible(false);
      return l;
    };
    const win = (): Keyed => {
      const box = new Container(s, 0, 0, 'battle-window');
      return { box, key: '' };
    };
    // The windows are made and styled on the first sync that shows them; the menus are kit lists (the old `ListMenu(items, rows)`: 4, 5 and 5 rows).
    this.roundWin = win();
    this.cmdWin = win();
    this.listWin = win();
    this.roundMenu = menu(4);
    this.cmdMenu = menu(5);
    this.listMenu = menu(5);
    this.menuLayer.add([this.roundWin.box, this.roundMenu, this.cmdWin.box, this.cmdMenu, this.listWin.box, this.listMenu]);
  }

  /** Bring every object up to date with the scene. Cheap, and safe to call again on the same state. */
  sync(): void {
    this.syncEnemyStatus();
    this.syncCards();
    this.syncTell();
    this.syncBanner();
    this.syncMenus();
    this.syncTopLine();
    this.syncTarget();
    this.syncOrder();
    this.syncCutins();
    this.syncVictoryBanner();
    this.s.endPanel?.update();
  }

  // ------------------------------------------------------------------ small helpers

  private get stage(): boolean {
    return !!this.s.stage;
  }

  /** Make `key`'s box again (and only then). `make` returns the ops, or null to leave the box empty. */
  private rebuild(k: Keyed, ops: readonly Op[] | null, extra = '', inPlace = false): boolean {
    // `inPlace`: the key leaves out what animates (the text of a line, the fill and ghost of a bar). The same key then updates those parts in place; the box is built again only when its structure changes.
    const key = ops ? extra + JSON.stringify(inPlace ? ops.map(shapeOf) : ops) : '';
    if (key === k.key) {
      if (inPlace && ops) patchOps(k.box, ops);
      return false;
    }
    k.key = key;
    k.box.removeAll(true);
    if (ops) applyOps(this.s, k.box, ops);
    return true;
  }

  /** Top of the top-line strip: under a pinned tell when there is one (the old `topY`). */
  private topY(): number {
    const base = this.s.stage ? this.s.stage.topClear : HUD.topY;
    return this.s.tell ? base + (HUD.topYUnderTell - HUD.topY) : base;
  }

  // ------------------------------------------------------------------ the tell

  /** A pinned enemy tell: an amber box across the top, with a warning mark, flashing as it arrives. */
  private syncTell(): void {
    const t = this.s.tell;
    let ops: Op[] | null = null;
    if (t) {
      const fr = HUD.frame, y = this.s.stage ? this.s.stage.topClear : HUD.topY;
      const text = fitText(t.text, fr.w - 56);
      const tw = measure(text) + 34;
      const x = Math.round(fr.x + (fr.w - tw) / 2);
      const flash = t.t < 24 && (t.t >> 2) % 2 === 0;
      ops = [
        { k: 'win', x, y, w: tw, h: 17, style: { plain: true, accent: flash ? '#ffffff' : TELL_COLOR } },
        { k: 'rect', x: x + 8, y: y + 3, w: 9, h: 11, color: TELL_COLOR },
        { k: 'text', x: x + 11, y: y + 4, s: '!', style: { color: '#1a1020', shadow: false } },
        { k: 'text', x: x + 22, y: y + 4, s: text, style: { color: '#ffe2a8' } },
      ];
    }
    this.rebuild(this.tellBox, ops);
  }

  // ------------------------------------------------------------------ the top line: banner and message

  /** The action banner (small, or the big band) and the message under it. The banner fades in and out: its text and band take the alpha, the window frame does not (as it always was). */
  private syncBanner(): void {
    const s = this.s;
    const fr = HUD.frame, cx = fr.x + fr.w / 2, top = this.topY();
    // A small banner is the stage HUD's too; the big one (a band across the frame) is still drawn here.
    const banner = this.stage && s.banner && !s.banner.big ? null : s.banner;
    const msg = s.message?.text;
    const msgShown = msg !== undefined && !banner?.big;
    const msgY = banner && !banner.big ? top + 20 : top;
    const key = JSON.stringify([banner ? [!!banner.big, banner.text, banner.sub ?? '', banner.color] : 0, msgShown ? msg : '', top, msgY]);
    const box = this.bannerBox;
    if (key !== box.key) {
      box.key = key;
      box.box.removeAll(true);
      this.fade = [];
      const b = new ViewBuilder(s, box.box);
      if (banner) {
        if (banner.big) {
          // The big banner: a band across the HUD frame, with a rule 40 px in from each side, and the title at 2x. Art, so one picture.
          const y = HUD.actionBannerY;
          const band = b.pic(fr.x, y, fr.w, BANNER_H, (c) => {
            const g = c.createLinearGradient(0, 0, fr.w, 0);
            g.addColorStop(0, 'rgba(10,8,20,0)');
            g.addColorStop(0.15, 'rgba(10,8,20,0.9)');
            g.addColorStop(0.85, 'rgba(10,8,20,0.9)');
            g.addColorStop(1, 'rgba(10,8,20,0)');
            c.fillStyle = g;
            c.fillRect(0, 0, fr.w, BANNER_H);
            c.fillStyle = banner.color;
            c.fillRect(40, 0, fr.w - 80, 1);
            c.fillRect(40, BANNER_H - 1, fr.w - 80, 1);
            drawBig(c, banner.text, cx - fr.x, 4, banner.color);
          });
          this.fade.push(band);
          if (banner.sub) this.fade.push(b.text(cx, y + 22, banner.sub, { align: 'center', color: '#ffffff' }));
        } else {
          const tw = measure(banner.text) + 24;
          b.win(Math.round(cx - tw / 2), top, tw, 17, { plain: true, accent: banner.color });
          this.fade.push(b.text(cx, top + 4, banner.text, { align: 'center', color: banner.color }));
        }
      }
      if (msgShown) {
        const tw = Math.min(fr.w - 20, measure(msg) + 24);
        b.win(Math.round(cx - tw / 2), msgY, tw, 17, { plain: true });
        b.text(cx, msgY + 4, msg, { align: 'center' });
      }
    }
    if (banner) {
      const bt = banner.t, hold = banner.big ? 60 : 50;
      const a = bt < 6 ? bt / 6 : bt > hold ? Math.max(0, 1 - (bt - hold) / 10) : 1;
      for (const o of this.fade) o.setAlpha(a);
    }
  }

  // ------------------------------------------------------------------ the menus

  /** Place a menu's window (made once, then restyled and resized) and show or hide the pair. */
  private placeWin(k: Keyed, on: boolean, x: number, y: number, w: number, h: number, style: { title?: string; accent?: string; alpha?: number }): void {
    const ops: Op[] | null = on ? [{ k: 'win', x, y, w, h, style }] : null;
    this.rebuild(k, ops);
  }

  private syncMenus(): void {
    const s = this.s;
    const mode = s.mode;
    const a = s.actor;
    // The round menu.
    const rx = MENU_X, ry = PANEL_Y - ROUND_MENU_H - MENU_ABOVE_PANEL;
    this.placeWin(this.roundWin, mode === 'round', rx, ry, CMD_W, ROUND_MENU_H, { title: `ROUND ${s.battle.round + 1}` });
    this.roundMenu.setVisible(mode === 'round');
    if (mode === 'round') {
      this.roundMenu.setPosition(rx + 8, ry + 8);
      if (this.roundMenu.width !== CMD_W - 12) this.roundMenu.width = CMD_W - 12;
    }
    // The command menu (stays up, dimmed, under the list).
    const showCmd = (mode === 'command' || mode === 'list') && !!a;
    if (showCmd && a) {
      const active = mode === 'command';
      const h = this.cmdMenuH();
      const x = s.menuX(a, CMD_W), y = PANEL_Y - h - MENU_ABOVE_PANEL;
      this.placeWin(this.cmdWin, true, x, y, CMD_W, h, { accent: MEMBERS[a.key as MemberId].color, title: a.name.toUpperCase(), alpha: active ? 1 : 0.85 });
      this.cmdMenu.setPosition(x + 7, y + 7);
      if (this.cmdMenu.width !== CMD_W - 8) this.cmdMenu.width = CMD_W - 8;
      if (this.cmdMenu.focused !== active) this.cmdMenu.focused = active;
    } else this.placeWin(this.cmdWin, false, 0, 0, 0, 0, {});
    this.cmdMenu.setVisible(showCmd);
    // The list window, stacked above the command window and above the party's heads, so the field stays readable.
    const showList = mode === 'list' && !!a;
    if (showList && a) {
      const items = this.listMenu.items;
      let widest = measure('Nothing to use.');
      for (const it of items) widest = Math.max(widest, measure(it.label) + (it.icon ? measure(it.icon) + 3 : 0) + (it.right ? measure(it.right) + 12 : 0));
      const w = listWindowW(widest);
      const h = Math.min(this.listMenu.rows, Math.max(1, items.length)) * 11 + 14;
      const cmdTop = PANEL_Y - this.cmdMenuH() - MENU_ABOVE_PANEL;
      const x = s.menuX(a, w), y = cmdTop - h - 4;
      const kind = s.listKind === 'item' ? 'Items' : s.listKind === 'skill' ? 'Skills' : this.cmdMenu.items.find((i) => i.value === 'tech')?.label ?? 'Techs';
      this.placeWin(this.listWin, true, x, y, w, h, { title: `${a.name} · ${kind}`.toUpperCase(), accent: MEMBERS[a.key as MemberId].color });
      this.listMenu.setPosition(x + 8, y + 8);
      if (this.listMenu.width !== w - 14) this.listMenu.width = w - 14;
      if (this.listMenu.empty !== 'Nothing to use.') this.listMenu.empty = 'Nothing to use.';
    } else this.placeWin(this.listWin, false, 0, 0, 0, 0, {});
    this.listMenu.setVisible(showList);
  }

  /** The command window's height: 11 px a row, and 12 for its border, title and padding. The list window stacks above it. */
  private cmdMenuH(): number {
    return this.cmdMenu.items.length * 11 + 12;
  }

  // ------------------------------------------------------------------ the help line and the description line

  private syncTopLine(): void {
    const s = this.s;
    let spec: { text: string; color: string; second?: { text: string; color: string } } | null = null;
    if (s.mode === 'round') {
      const help: Record<string, string> = {
        fight: 'Give each crew member orders.',
        repeat: s.telegraphed() ? 'Something big is coming. Give fresh orders.' : s.roundMenu.items[1]?.enabled === false ? 'No orders to repeat yet.' : 'Repeat last round’s orders.',
        auto: s.setup.boss ? 'Not against a boss. Give orders.' : 'Everyone attacks.',
        run: s.battle.canRun && !s.setup.boss ? 'Try to escape.' : 'You can’t run from this fight.',
      };
      const h = help[s.roundMenu.current?.value ?? ''];
      if (h && !s.banner && !s.message) spec = { text: h, color: UI.dim };
    } else if (s.mode === 'list') {
      const cur = s.listMenu.current;
      if (cur && s.actor) {
        const desc = s.listKind === 'item' ? ITEMS[cur.value]?.desc ?? '' : ABILITIES[cur.value]?.desc ?? '';
        // Combo hint: would this choice pair with an order already given?
        const hint = s.listKind === 'item' ? '' : s.comboHint(cur.value);
        spec = { text: markElements(desc), color: '#d8d6ec', ...(hint ? { second: { text: hint, color: UI.amber } } : {}) };
      }
    }
    let ops: Op[] | null = null;
    if (spec) {
      // Text wider than the screen wraps onto a second line instead of running off the window.
      const fr = HUD.frame;
      const maxW = fr.w - 44;
      const second = spec.second;
      const lines = [...wrap(spec.text, maxW).map((l) => ({ l, c: spec.color })), ...(second ? wrap(second.text, maxW).map((l) => ({ l, c: second.color })) : [])];
      const tw = Math.min(fr.w - 20, Math.max(...lines.map((a) => measure(a.l))) + 24);
      const y = this.topY(), cx = fr.x + fr.w / 2;
      ops = [
        { k: 'win', x: Math.round(cx - tw / 2), y, w: tw, h: 6 + lines.length * 11, style: { plain: true, accent: second ? second.color : UI.cyan } },
        ...lines.map((a, i): Op => ({ k: 'text', x: cx, y: y + 4 + i * 11, s: a.l, style: { align: 'center', color: a.c } })),
      ];
    }
    this.rebuild(this.topLineBox, ops);
  }

  // ------------------------------------------------------------------ the target box

  /**
   * What the target box says about an enemy, worked out when the target or the crew's notes change (not every frame): its weaknesses as far as they're known,
   * its resistances and immunities, and before anything is known, the street wisdom about its kind ("likely weak", with a question mark).
   */
  private targetNotes(u: Combatant): { weak: string; guess: string; notes: [string, string][] } {
    const seenW = state.weakSeen[u.key]?.length ?? 0, seenR = state.resistSeen[u.key]?.length ?? 0, seenI = state.immuneSeen[u.key]?.length ?? 0;
    const key = `${u.uid}|${u.analyzed ? 1 : 0}|${seenW}|${seenR}|${seenI}`;
    if (this.targetCache?.key === key) return this.targetCache.value;
    // Analyzed: the whole chart. Otherwise what the crew has learned the hard way.
    const weak = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k) : (state.weakSeen[u.key] ?? []);
    const res = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k) : (state.resistSeen[u.key] ?? []);
    const imm = u.analyzed ? (u.immune ?? []) : (state.immuneSeen[u.key] ?? []);
    const notes: [string, string][] = [];
    // Element names as the chips over the enemies write them (ELEMENT_TAG), everywhere.
    if (res.length) notes.push([`RESISTS ${res.map((el) => `${elementMark(el as Element)}${ELEMENT_TAG[el as Element]}`).join(' ')}`, '#b8bcd0']);
    if (imm.length) notes.push([`IMMUNE ${imm.map(statusName).join(' ')}`, '#c9b8ff']);
    // Nothing learned yet: what everyone on the street knows about its kind.
    let guess = '';
    if (!weak.length && u.family) {
      const own = ENEMIES[u.key]?.weak;
      const fam = Object.entries(FAMILY_WEAK[u.family] ?? {}).filter(([k, v]) => (v ?? 1) > 1 && (own?.[k as Element] ?? 2) > 1).map(([k]) => `${elementMark(k as Element)}${ELEMENT_TAG[k as Element]}`);
      if (fam.length) guess = `${FAMILY_NAME[u.family]}: likely weak to ${fam.join(' ')}?`;
    }
    const value = { weak: weak.length ? `WEAK ${weak.map((el) => `${elementMark(el as Element)}${ELEMENT_TAG[el as Element]}`).join(' ')}` : '', guess, notes };
    if (guess) value.notes.unshift([guess, '#b89a66']);
    this.targetCache = { key, value };
    return value;
  }
  private targetCache: { key: string; value: { weak: string; guess: string; notes: [string, string][] } } | null = null;

  private syncTarget(): void {
    const s = this.s;
    const uid = s.mode === 'target' ? s.targetList[s.targetIdx] : undefined;
    const u = uid !== undefined ? s.battle.unit(uid) : undefined;
    let ops: Op[] | null = null;
    if (u) {
      // The box sits on the far side of the screen from its target (clear of the turn-order strip on the right), so it never covers the target or the arrow over it.
      const w = TARGET_INFO_W, y = HUD.targetY, fr = HUD.frame;
      const tx = s.pos(u.uid).x * WORLD_SCALE;
      const x = HUD.targetBoxX(tx < fr.x + fr.w / 2, w);
      const name = s.label(u);
      if (u.side === 'enemy') {
        const { weak, notes } = this.targetNotes(u);
        ops = [
          { k: 'win', x, y, w, h: 19 + (u.analyzed ? 11 : 0) + notes.length * 10, style: { plain: true, accent: UI.amber } },
          { k: 'text', x: x + 8, y: y + 5, s: name, style: { color: '#ffd0d0' } },
        ];
        const bestiary = state.bestiary[u.key] ?? 0;
        if (weak) ops.push({ k: 'text', x: x + w - 8, y: y + 5, s: fitText(weak, w - 24 - measure(name)), style: { align: 'right', color: UI.amber } });
        else if (!u.analyzed) ops.push({ k: 'text', x: x + w - 8, y: y + 5, s: bestiary ? `Defeated ×${bestiary}` : 'Unknown', style: { align: 'right', color: UI.dim } });
        let ny = y + 15;
        if (u.analyzed) {
          const bar = barPixels(w - 70, u.hp / u.base.maxHp, 0);
          ops.push({ k: 'bar', x: x + 8, y: y + 19, w: w - 70, h: 3, fill: bar.fill, lag: 0, color: hpColor(u.hp / u.base.maxHp) });
          ops.push({ k: 'text', x: x + w - 8, y: y + 15, s: `${u.hp}/${u.base.maxHp}`, style: { align: 'right', color: UI.dim } });
          ny += 11;
        }
        for (const [text, color] of notes) {
          ops.push({ k: 'text', x: x + 8, y: ny, s: fitText(text, w - 16), style: { color } });
          ny += 10;
        }
      } else {
        ops = [
          { k: 'win', x, y, w, h: 19, style: { plain: true, accent: UI.amber } },
          { k: 'text', x: x + 8, y: y + 5, s: name, style: { color: MEMBERS[u.key as MemberId]?.color ?? UI.text } },
          { k: 'text', x: x + w - 8, y: y + 5, s: `${u.hp}/${u.base.maxHp}`, style: { align: 'right', color: UI.dim } },
        ];
      }
    }
    this.rebuild(this.targetBox, ops, '', true);
  }

  // ------------------------------------------------------------------ the party cards (without a stage)

  /** The status card of each party member, in the bottom row. With a stage under the battle, the stage HUD has its own table and these are not made. */
  private syncCards(): void {
    const s = this.s;
    const party = this.stage ? [] : s.battle.party;
    for (let i = 0; i < Math.max(party.length, this.cards.length); i++) {
      let card = this.cards[i];
      if (!card) {
        card = { box: new Container(s, 0, 0, 'battle-card'), key: '', ring: null };
        this.cardLayer.add(card.box);
        this.cards[i] = card;
      }
      const p = party[i];
      if (!p) {
        if (card.key) {
          card.box.removeAll(true);
          card.key = '';
          card.ring = null;
        }
        continue;
      }
      const dd = s.d(p.uid);
      const m = MEMBERS[p.key as MemberId];
      const inOrders = s.mode === 'command' || s.mode === 'list' || s.mode === 'target';
      const active = inOrders && s.actor?.uid === p.uid;
      const targeted = s.mode === 'target' && s.targetList[s.targetIdx] === p.uid;
      const x = s.boxX(i), y = PANEL_Y - (active ? CARD_RAISE : 0);
      const lit = active || targeted;
      const down = dd.hp <= 0;
      const ratio = dd.hp / p.base.maxHp;
      const face = down || (dd.poseT > 0 && dd.pose === 'hurt') || ratio < 0.3 ? 'hurt' : dd.poseT > 0 && dd.pose === 'victory' ? 'happy' : 'neutral';
      const ops: Op[] = [
        { k: 'win', x, y, w: CARD_W, h: CARD_H, style: { accent: lit ? m.color : '#3a3f6e', plain: !lit, alpha: 0.94 } },
        { k: 'face', x: x + 4, y: y + 4, who: p.key, face, down },
        { k: 'text', x: x + 34, y: y + 5, s: m.name, style: { color: down ? UI.disabled : m.color } },
        { k: 'text', x: x + 110, y: y + 5, s: down ? 'DOWN' : `Lv${p.level}`, style: { color: down ? UI.red : UI.dim, align: 'right' } },
      ];
      // Queued command mark on the portrait's corner.
      const queued = s.cmds.find((c) => c.actor === p.uid);
      if (queued && inOrders) {
        const inCombo = s.comboActors.has(p.uid);
        ops.push({ k: 'text', x: x + 24, y: y + 3, s: inCombo ? '★' : '•', style: { color: inCombo ? UI.amber : UI.green } });
      }
      const shown = Math.max(0, dd.shownHp) / p.base.maxHp;
      const hpBar = barPixels(75, shown, dd.lagHp / p.base.maxHp);
      ops.push({ k: 'text', x: x + 34, y: y + 17, s: 'HP', style: { color: UI.dim } });
      ops.push({ k: 'text', x: x + 110, y: y + 17, s: `${Math.max(0, Math.round(dd.shownHp))}/${p.base.maxHp}`, style: { align: 'right', color: ratio < 0.25 && !down ? UI.red : UI.text } });
      ops.push({ k: 'bar', x: x + 34, y: y + 28, w: 75, h: 2, fill: hpBar.fill, lag: hpBar.lag, color: hpColor(shown) });
      if (p.base.maxTp > 0) {
        ops.push({ k: 'text', x: x + 7, y: y + 33, s: m.tpLabel, style: { color: UI.dim } });
        ops.push({ k: 'text', x: x + 110, y: y + 33, s: `${Math.round(dd.shownTp)}/${p.base.maxTp}`, style: { align: 'right' } });
        ops.push({ k: 'bar', x: x + 7, y: y + 44, w: 102, h: 2, fill: barPixels(102, dd.shownTp / p.base.maxTp, 0).fill, lag: 0, color: UI.cyan });
      } else {
        // Rook: skill charges instead of TP, with the same bar (charges left of the full set).
        let total = 0, full = 0;
        for (const id in p.maxUses) {
          total += p.uses[id] ?? 0;
          full += p.maxUses[id] ?? 0;
        }
        ops.push({ k: 'text', x: x + 7, y: y + 33, s: 'SKILL', style: { color: UI.dim } });
        ops.push({ k: 'text', x: x + 110, y: y + 33, s: `${total}/${full} uses`, style: { align: 'right' } });
        ops.push({ k: 'bar', x: x + 7, y: y + 44, w: 102, h: 2, fill: barPixels(102, full ? total / full : 0, 0).fill, lag: 0, color: UI.amber });
      }
      // Status: the first ailment tagged on the portrait's lower edge, plus a count.
      let tags = 0;
      for (const st of p.status) {
        const lab = STATUS_LABEL[st.id];
        if (!lab || st.id === 'guard' || st.id === 'cover') continue;
        if (tags++ === 0) {
          ops.push({ k: 'rect', x: x + 5, y: y + 21, w: measure(lab[0]) + 3, h: 8, color: 'rgba(10,9,19,0.85)' });
          ops.push({ k: 'text', x: x + 6, y: y + 21, s: lab[0], style: { color: lab[1], shadow: false } });
        }
      }
      if (tags > 1) ops.push({ k: 'text', x: x + 8 + measure('WWW'), y: y + 21, s: `+${tags - 1}`, style: { color: UI.dim, shadow: false } });
      // The ring of the card that gives orders or is aimed at: its color and place are part of the key, its pulse is not.
      const ringColor = lit ? (targeted ? AIMING : ACTIVE) : '';
      const changed = this.rebuild(card, ops, `${ringColor}|${x}|${y}|`, true);
      if (changed) {
        card.ring = null;
        if (ringColor) {
          // Two pixels outside the window in the acting colour (the old four rects), breathing, so it reads from across the room.
          card.ring = new ViewBuilder(s, card.box).pic(x - 2, y - 2, CARD_W + 4, CARD_H + 4, (c) => {
            c.fillStyle = ringColor;
            c.fillRect(0, 0, CARD_W + 4, 2);
            c.fillRect(0, CARD_H + 2, CARD_W + 4, 2);
            c.fillRect(0, 2, 2, CARD_H);
            c.fillRect(CARD_W + 2, 2, 2, CARD_H);
          });
        }
      }
      card.ring?.setAlpha(0.6 + 0.4 * Math.sin(s.frame * 0.18));
      card.box.x = dd.shake > 0 ? (dd.shake % 4 < 2 ? 1 : -1) : 0;
    }
  }

  // ------------------------------------------------------------------ enemy status (without a stage)

  /**
   * Over each enemy, stacked upward from the head: an HP bar (always shown), active status chips, and any weaknesses the crew has found (by Analyze or by landing a
   * weak hit). Without a stage only; a stage draws its own foe box and bars.
   */
  private syncEnemyStatus(): void {
    const s = this.s;
    const live = new Set<number>();
    if (!this.stage && s.mode !== 'intro') {
      for (const e of s.battle.enemies) {
        if (e.hp <= 0) continue;
        const dd = s.d(e.uid);
        if (dd.dying > 0 || dd.alpha < 0.5) continue;
        live.add(e.uid);
        let k = this.enemies.get(e.uid);
        if (!k) {
          k = { box: new Container(s, 0, 0, 'battle-enemy-status-box'), key: '' };
          this.enemyLayer.add(k.box);
          this.enemies.set(e.uid, k);
        }
        this.rebuild(k, this.enemyOps(e), '', true);
      }
    }
    // An enemy that left (dead, dying, hidden) loses its box; one that comes back gets a new one.
    for (const [uid, k] of this.enemies) {
      if (live.has(uid)) continue;
      k.box.destroy();
      this.enemies.delete(uid);
    }
  }

  private enemyOps(e: Combatant): Op[] {
    const s = this.s;
    const dd = s.d(e.uid);
    const ops: Op[] = [];
    const { x, y, art } = s.enemyPos(e);
    const cx0 = Math.round((x + art.w / 2) * WORLD_SCALE);
    let row = Math.max(HUD.statusTop, (y + artTop(art)) * WORLD_SCALE - 6);
    // HP bar (bosses get a wider one), on a solid dark plate and a 3px bar, so it holds up over bright signage.
    const bw = e.boss ? 72 : 30;
    const ratio = Math.max(0, dd.shownHp / e.base.maxHp);
    const bar = barPixels(bw, ratio, dd.lagHp / e.base.maxHp);
    ops.push({ k: 'rect', x: cx0 - bw / 2 - 2, y: row - 2, w: bw + 4, h: 7, color: DARK });
    ops.push({ k: 'bar', x: cx0 - bw / 2, y: row, w: bw, h: 3, fill: bar.fill, lag: bar.lag, color: hpColor(ratio), back: '#2a2838', shine: 0.35 });
    row -= 11;
    // While numbers are rising off this enemy, its chips and WEAK tag step aside (the HP bar stays): the two text systems share the rows above its head.
    for (const f of s.floaters) if (f.uid === e.uid && f.t < 50) return ops;
    // Status chips: measure, then place.
    let count = 0, total = 0;
    for (const st of e.status) {
      const l = STATUS_LABEL[st.id];
      if (!l || st.id === 'guard') continue;
      if (count < 3) total += measure(l[0]) + 5;
      count++;
    }
    if (count) {
      const more = count - Math.min(count, 3);
      if (more) total += measure(`+${more}`) + 3;
      let cx = Math.round(cx0 - total / 2);
      let drawn = 0;
      for (const st of e.status) {
        const l = STATUS_LABEL[st.id];
        if (!l || st.id === 'guard' || drawn === 3) continue;
        const w = measure(l[0]) + 4;
        ops.push({ k: 'rect', x: cx, y: row, w, h: 9, color: DARK });
        ops.push({ k: 'rect', x: cx, y: row + 8, w, h: 1, color: l[1] });
        ops.push({ k: 'text', x: cx + 2, y: row + 1, s: l[0], style: { color: l[1], shadow: false } });
        cx += w + 1;
        drawn++;
      }
      if (more) ops.push({ k: 'text', x: cx + 1, y: row + 1, s: `+${more}`, style: { color: UI.dim } });
      row -= 11;
    }
    // Known weaknesses.
    const seen = state.weakSeen[e.key];
    const known = ELEMENTS.filter((el) => (e.analyzed ? (e.weak?.[el] ?? 1) > 1 : seen?.includes(el)));
    if (!known.length) return ops;
    let width = measure('WEAK') + 2;
    for (const el of known) width += measure(ELEMENT_ICON[el]) + 3;
    let wx = Math.round(cx0 - width / 2);
    ops.push({ k: 'rect', x: wx - 2, y: row, w: width + 4, h: 9, color: DARK });
    ops.push({ k: 'text', x: wx, y: row + 1, s: 'WEAK', style: { color: UI.amber, shadow: false } });
    wx += measure('WEAK') + 4;
    for (const el of known) {
      // The same symbols as the battle menus, so "weak to this" matches "this move is".
      ops.push({ k: 'text', x: wx, y: row + 1, s: ELEMENT_ICON[el], style: { color: ELEMENT_COLOR[el], shadow: false } });
      wx += measure(ELEMENT_ICON[el]) + 3;
    }
    return ops;
  }

  // ------------------------------------------------------------------ the turn-order strip (without a stage)

  /** The coming round's turn order, cached against the orders given so far. */
  private turnCache: { key: number; list: number[][] } | null = null;

  private turnOrder(): readonly number[][] {
    const s = this.s;
    const key = s.battle.round * 100 + s.cmds.length;
    if (this.turnCache?.key === key) return this.turnCache.list;
    const given = new Set(s.cmds.map((c) => c.actor));
    const rest = s.actors().filter((p) => !given.has(p.uid)).map((p) => ({ actor: p.uid, type: 'attack' as const, target: -1 }));
    const list = s.battle.previewOrder([...s.cmds, ...rest]);
    this.turnCache = { key, list };
    return list;
  }

  /**
   * The turn-order strip, down the right edge (the menus keep the left): who acts when this round, as faces. While orders are given it updates as they go in and
   * outlines the member giving orders and the enemy being aimed at. While the round plays it is the real queue: the entry acting now stands out, the ones done fade
   * back. Each entry is a picture (faces in a frame); the "TURN" label and the "+N" count are texts; the breathing ring of the entry acting now is its own picture
   * whose alpha pulses. Without a stage only (the stage HUD has its own timeline).
   */
  private syncOrder(): void {
    const s = this.s;
    const shown = !this.stage && (s.mode === 'round' || s.mode === 'command' || s.mode === 'list' || s.mode === 'target' || s.mode === 'play');
    const playing = s.mode === 'play';
    const list = shown ? (playing ? s.battle.roundOrder : this.turnOrder()) : [];
    if (!list.length) {
      if (this.order.key) {
        this.orderLayer.removeAll(true);
        this.orderLabel = { box: new Container(s, 0, 0, 'battle-order-label'), key: '' };
        this.orderLayer.add(this.orderLabel.box);
        this.order = { key: '', entries: [] };
      }
      return;
    }
    const at = playing ? s.battle.roundAt : -1;
    const side = 'right' as const;
    const faces: number[] = [];
    for (const acts of list) faces.push(acts.length);
    const rects = orderStripLayout(faces, side);
    const edgeX = ORDER_RIGHT;
    const acting = s.mode === 'round' || playing ? undefined : s.actor?.uid;
    const aimed = s.mode === 'target' ? s.targetList[s.targetIdx] : undefined;
    // What decides the pictures: the order, who is up, who is aimed at, and the twins' letters.
    const key = JSON.stringify([list, at, acting ?? -1, aimed ?? -1, rects.length, s.battle.units.length]);
    const pulse = 0.6 + 0.4 * Math.sin(s.frame * 0.18);
    if (key !== this.order.key) {
      this.orderLayer.removeAll(true);
      this.orderLabel = { box: new Container(s, 0, 0, 'battle-order-label'), key: '' };
      this.orderLayer.add(this.orderLabel.box);
      const entries: { box: Container; pulse: CanvasImage | null }[] = [];
      const lb = new ViewBuilder(s, this.orderLabel.box);
      lb.text(edgeX, ORDER_TOP - ORDER_LABEL_ABOVE, 'TURN', { color: UI.dim, align: side });
      for (let k = 0; k < rects.length; k++) {
        const actors = list[k], rr = rects[k];
        const lead = actors?.[0] !== undefined ? s.battle.unit(actors[0]) : undefined;
        if (!actors || !rr || !lead) continue;
        const now = playing ? k === at : actors.includes(acting ?? -1);
        const hot = now || actors.includes(aimed ?? -1);
        const done = playing && k < at;
        // The entry acting now steps out toward the field, so the eye finds it without reading faces.
        const r = now ? { x: rr.x - ORDER_STEP_OUT, y: rr.y, w: rr.w, h: rr.h } : rr;
        const edge = actors.length > 1 ? '#ffe07a' : lead.side === 'party' ? MEMBERS[lead.key as MemberId].color : '#ff6a6a';
        const box = new Container(s, 0, 0, 'battle-order-entry');
        const b = new ViewBuilder(s, box);
        let ring: CanvasImage | null = null;
        if (now) {
          // A two-pixel frame in the acting colour, breathing, over a solid dark plate.
          b.pic(r.x - 3, r.y - 3, r.w + 6, r.h + 6, (c) => {
            c.fillStyle = DARK;
            c.fillRect(0, 0, r.w + 6, r.h + 6);
          });
          ring = b.pic(r.x - 2, r.y - 2, r.w + 4, r.h + 4, (c) => {
            c.fillStyle = ACTIVE;
            c.fillRect(0, 0, r.w + 4, r.h + 4);
          });
        }
        // The entry itself: its frame (when it is not the one acting), the dark plate, the faces, the twins' letters and the pointer.
        const pad = 8;
        b.pic(r.x - pad, r.y - 3, r.w + pad + 3, r.h + 6, (c) => {
          c.translate(pad - r.x, 3 - r.y);
          if (!now) {
            c.fillStyle = hot ? AIMING : edge;
            c.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
          }
          c.fillStyle = DARK;
          c.fillRect(r.x, r.y, r.w, r.h);
          for (let i = 0; i < actors.length; i++) {
            const u = s.battle.unit(actors[i] ?? -1);
            if (!u) continue;
            const eart = u.side === 'party' ? null : enemyArt(ENEMIES[u.key]?.sprite ?? '');
            const img = eart ? enemyThumb(eart.canvas, eart.res) : getPortrait(u.key, 'neutral');
            if (img) c.drawImage(img, r.x + 1 + i * ORDER_FACE, r.y + 1, ORDER_THUMB, ORDER_THUMB);
            // Two of a kind: which one, by the letter in its name (Glowrat A, Glowrat B).
            if (u.side === 'enemy' && s.twins(u)) {
              const lx = r.x + i * ORDER_FACE + 8, ly = r.y + 6;
              c.fillStyle = DARK;
              c.fillRect(lx - 1, ly - 1, 7, 9);
              drawText(c, String.fromCharCode(65 + s.dupIndex(u)), lx, ly, { color: '#ffffff', shadow: false });
            }
          }
          if (hot) {
            // A pointer on the inside edge, toward the field.
            c.fillStyle = now ? ACTIVE : AIMING;
            const px = r.x - 6;
            c.fillRect(px, r.y + 4, 3, 7);
            c.fillRect(px - 1, r.y + 5, 1, 5);
            c.fillRect(px - 2, r.y + 6, 1, 3);
          }
        });
        if (done) box.setAlpha(0.35);
        this.orderLayer.add(box);
        entries.push({ box, pulse: ring });
      }
      if (rects.length < list.length) new ViewBuilder(s, this.orderLabel.box).text(edgeX, ORDER_BOTTOM - 2, `+${list.length - rects.length}`, { color: UI.dim, align: side });
      this.order = { key, entries };
    }
    for (const e of this.order.entries) e.pulse?.setAlpha(pulse);
  }

  // ------------------------------------------------------------------ cut-ins

  /** Hex's deck, up over their card while a program runs: slides up, scrolls code, slides away. It is art that changes with the clock, so it paints again each tick it is up. */
  private syncDeck(): void {
    const s = this.s;
    const t = s.deckT;
    const i = s.battle.party.findIndex((p) => p.key === 'hex');
    if (t < 0 || i < 0) {
      if (this.deck) this.deck.img.setVisible(false);
      return;
    }
    const inK = Math.min(1, t / 8), outK = Math.max(0, (t - (DECK_CUT_LIFE - 8)) / 8);
    const k = (1 - (1 - inK) ** 3) * (1 - outK);
    const x = s.boxX(i) + CARD_W - 80, y = Math.round(PANEL_Y - 4 - k * 44);
    if (!this.deck) {
      const img = new CanvasImage(s, 0, 0, 80, 48);
      img.ctx.imageSmoothingEnabled = false;
      this.cutinLayer.add(img);
      this.deck = { img, t: Number.NaN };
    }
    const d = this.deck;
    d.img.setVisible(true);
    d.img.setPosition(x - 4, y - 4);
    if (d.t !== t) {
      d.t = t;
      const c = d.img.ctx;
      c.clearRect(0, 0, 80, 48);
      c.fillStyle = 'rgba(10,9,19,0.9)';
      c.fillRect(0, 0, 80, 48);
      c.fillStyle = '#c3a0ff';
      c.fillRect(0, 0, 80, 1);
      drawMiniDeck(c, 4, 4, t);
      d.img.refresh();
    }
  }

  private syncCutins(): void {
    const s = this.s;
    this.syncDeck();
    const live = new Set<Cutin>();
    for (const c of s.cutins) {
      if (c.t > c.life) continue;
      const m = MEMBERS[c.key as MemberId];
      const port = getPortrait(c.key, c.face);
      if (!m || !port) continue;
      live.add(c);
      // It rests where the HUD layout says (above the cards, clear of the turn strip) and slides in from the screen's edge.
      const rest = HUD.cutinRect(c.fromLeft, c.row ?? 0, !!c.line);
      const { w, h, y } = rest;
      let box = this.cutins.get(c);
      if (!box) {
        box = new Container(s, 0, 0, 'battle-cutin');
        const b = new ViewBuilder(s, box);
        b.pic(0, y, w, h, (g) => {
          g.fillStyle = 'rgba(10,9,19,0.92)';
          g.fillRect(0, 0, w, h);
          g.fillStyle = m.color;
          g.fillRect(0, 0, w, 2);
          g.fillRect(0, h - 2, w, 2);
          g.fillRect(c.fromLeft ? w - 3 : 0, 0, 3, h);
          const px = c.fromLeft ? w - 58 : 8;
          g.fillStyle = UI.outline;
          g.fillRect(px - 1, 4, 50, 50);
          g.drawImage(port, px, 5, 48, 48);
        });
        const tx = c.fromLeft ? 10 : 62;
        if (c.line) {
          b.text(tx, y + 10, m.name.toUpperCase(), { color: m.color });
          b.para(`“${c.line}”`, tx, y + 23, w - 72, { color: UI.text, lineH: 11 });
        } else b.text(tx, y + 22, m.name.toUpperCase(), { color: m.color });
        this.cutinLayer.add(box);
        this.cutins.set(c, box);
      }
      // Slide in fast, hold, slide back out.
      const inK = Math.min(1, c.t / 8), outK = Math.max(0, (c.t - (c.life - 10)) / 10);
      const k = (1 - (1 - inK) ** 3) * (1 - outK);
      box.x = c.fromLeft ? Math.round(-w + k * (rest.x + w)) : Math.round(W - k * (W - rest.x));
    }
    for (const [c, box] of this.cutins) {
      if (live.has(c)) continue;
      box.destroy();
      this.cutins.delete(c);
    }
  }

  // ------------------------------------------------------------------ the VICTORY banner

  /** VICTORY at 3x: art that changes every tick of its slide and sweep, so it is one picture painted again for each tick it is up (and not otherwise). */
  private syncVictoryBanner(): void {
    const s = this.s;
    if (s.bannerStart < 0) {
      if (this.victoryBanner) this.victoryBanner.setVisible(false);
      this.victoryT = -1;
      return;
    }
    if (!this.victoryBanner) {
      this.victoryBanner = new CanvasImage(s, 0, 0, W, H);
      this.victoryBanner.ctx.imageSmoothingEnabled = false;
      s.sys.ui.add(this.victoryBanner);
    }
    const t = s.frame - s.bannerStart;
    this.victoryBanner.setVisible(true);
    if (t === this.victoryT) return;
    this.victoryT = t;
    const c = this.victoryBanner.ctx;
    c.clearRect(0, 0, W, H);
    drawVictoryBanner(c, t);
    this.victoryBanner.refresh();
  }
}
