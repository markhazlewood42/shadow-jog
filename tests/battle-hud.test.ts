/**
 * The battle's windows as kit parts (M8c group G; docs/engine/m8-brief.md, the Record).
 *
 * A real `BattleScene` runs on a real `Game` here, with no renderer and a scripted input, as in tests/battle-native.test.ts. The HUD (`battlekit/hud.ts`) and the two
 * result panels (`battlekit/panels.ts`) are display objects in the scene's ui layer, so a test reads them there. Every proof that something DOES happen has a control:
 * a case where it must not, so the check is known to be able to fail.
 *
 *   1. The menus and the top lines sit where the battle geometry says (the numbers of `battlekit/geom.ts`), and only in the mode that shows them.
 *   2. A box is built again only when what it shows changes; a pulse and a slide move an object and never build it again.
 *   3. The damage ghost of a bar is the old `drawLag` arithmetic.
 *   4. The banner fades its text and band, and its window frame stays solid (as it always did).
 *   5. The two result panels: the tally, the level-up beats.
 *   6. Ten fights in a row leave no texture and no object behind.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/sje/runtime/inputdevice';
import { drawLag } from '../src/scenes/battlekit/sprites';
import { barPixels } from '../src/scenes/uiops';
import { Bar, type Container, type GameObject, NineSlice, TextObject } from '../src/sje';
import { barRects } from '../src/sje/ui/bar';
import { Game } from '../src/sje/runtime/game';
import { layoutOfNative } from './nativelayout';
import { installCanvasStub } from './recorder';
import { recorder } from './sjeuikit';

vi.mock('../src/audio/sfx', () => ({ sfx: () => undefined }));
vi.mock('../src/audio/music', () => ({ music: () => undefined, previewMusic: () => undefined, pushMusic: () => undefined, popMusic: () => undefined }));
vi.mock('../src/audio/engine', () => ({ audio: { duck: () => undefined, applyVolumes: () => undefined, onUnlock: () => undefined, unlock: () => undefined } }));

/** A scripted input: one action can be held for a tick. */
class Keys {
  held: string | null = null;
  pressed = (a: string) => a === this.held;
  repeat = (a: string) => a === this.held;
  down = () => false;
  carry = () => undefined;
  dir = () => null;
  update = () => undefined;
  endFrame = () => undefined;
  consume = () => undefined;
  keyName = (a: string) => ({ confirm: 'Z', cancel: 'X' })[a] ?? a;
  keysFor = () => ['KeyZ'];
  captureNext = () => undefined;
}

let restoreCanvas: () => void;
let realIntro: unknown;
beforeAll(async () => {
  restoreCanvas = installCanvasStub();
  // The shatter intro is a flow of its own; these tests start from the round menu.
  const { BattleScene } = await import('../src/scenes/battle');
  const proto = BattleScene.prototype as unknown as { intro: unknown };
  realIntro = proto.intro;
  proto.intro = async () => undefined;
});
afterAll(async () => {
  const { BattleScene } = await import('../src/scenes/battle');
  (BattleScene.prototype as unknown as { intro: unknown }).intro = realIntro;
  restoreCanvas();
});

let keys: Keys;
let game: Game;
beforeEach(async () => {
  keys = new Keys();
  game = new Game({ renderer: { render: () => undefined }, input: keys as unknown as Input });
  const { applyStage } = await import('../src/game/stages');
  applyStage('finale');
});

/** A loose view of the scene: the test reads and sets what the scene keeps private. */
type Loose = Record<string, unknown> & { sys: { ui: Container }; close(r?: unknown): void };

async function open(enemies: string[] = ['rustfang_punk', 'scrap_hound']): Promise<Loose> {
  const { BattleScene } = await import('../src/scenes/battle');
  const b = new BattleScene({ encounter: 'street', enemies, bg: 'street' }) as unknown as Loose;
  void game.run(b as never);
  game.advanceTick();
  b.introT = 999;
  for (const e of (b.battle as { enemies: { uid: number }[] }).enemies) (b.d as (uid: number) => { alpha: number })(e.uid).alpha = 1;
  (b.startRound as () => void)();
  game.advanceTick();
  return b;
}

/** The same objects, in the same order (identity, not a deep compare: a box built again has equal-looking new objects). */
const same = (a: readonly unknown[] | undefined, b: readonly unknown[]): boolean => !!a && a.length === b.length && a.every((o, i) => o === b[i]);

const tick = (n = 1): void => {
  for (let i = 0; i < n; i++) game.advanceTick();
};
/** Press an action for one tick. */
const press = (a: string): void => {
  keys.held = a;
  game.advanceTick();
  keys.held = null;
};

/** Every visible object under a container, depth first. */
function all(c: Container): GameObject[] {
  const out: GameObject[] = [];
  const go = (list: readonly GameObject[]): void => {
    for (const o of list) {
      if (!o.visible) continue;
      out.push(o);
      if ('list' in o) go((o as Container).list);
    }
  };
  go(c.list);
  return out;
}
const hud = (b: Loose) => b.hud as Record<string, { box: Container; key: string } & Container> & { cards: { box: Container; ring: GameObject | null }[]; cutins: Map<unknown, Container> };

describe('the menus and the top lines sit where the geometry says', () => {
  it('the round menu: its window, its list, and the help line under the top of the frame', async () => {
    const { CMD_W, HUD, MENU_ABOVE_PANEL, MENU_X, PANEL_Y, ROUND_MENU_H } = await import('../src/scenes/battlekit/geom');
    const b = await open();
    const lay = layoutOfNative(b.sys.ui);
    const x = MENU_X, y = PANEL_Y - ROUND_MENU_H - MENU_ABOVE_PANEL;
    const win = lay.windows.find((w) => w.title === 'ROUND 1');
    expect(win).toMatchObject({ x, y, w: CMD_W, h: ROUND_MENU_H });
    expect(lay.lists).toHaveLength(1);
    expect(lay.lists[0]).toMatchObject({ x: x + 8, y: y + 8, w: CMD_W - 12, rows: 4 });
    // The four labels are texts inside the window.
    for (const label of ['Fight', 'Repeat', 'Auto', 'Run']) expect(lay.texts.some((t) => t.text === label)).toBe(true);
    // The help line is a plain window, centered, at the top of the strip.
    const help = lay.texts.find((t) => t.text === 'Give each crew member orders.');
    expect(help).toBeDefined();
    expect(help?.y).toBe(HUD.topY + 4);
    // Control: in another mode the round window is gone, and the help line with it.
    (b.nextActor as () => void)();
    tick();
    const after = layoutOfNative(b.sys.ui);
    expect(after.windows.some((w) => w.title === 'ROUND 1')).toBe(false);
    expect(after.texts.some((t) => t.text === 'Give each crew member orders.')).toBe(false);
  });

  it('the command menu keeps the acting member’s name and color; the list window stacks above it', async () => {
    const { CMD_W, MENU_ABOVE_PANEL, MENU_X, PANEL_Y, listWindowW } = await import('../src/scenes/battlekit/geom');
    const b = await open();
    (b.nextActor as () => void)();
    tick();
    let lay = layoutOfNative(b.sys.ui);
    const actor = b.actor as { name: string };
    const cmdWin = lay.windows.find((w) => w.title === actor.name.toUpperCase());
    expect(cmdWin).toBeDefined();
    const items = (b.cmdMenu as { items: unknown[] }).items.length;
    const h = items * 11 + 12;
    expect(cmdWin).toMatchObject({ x: MENU_X, y: PANEL_Y - h - MENU_ABOVE_PANEL, w: CMD_W, h });
    expect(lay.lists[0]).toMatchObject({ x: MENU_X + 7, y: PANEL_Y - h - MENU_ABOVE_PANEL + 7, w: CMD_W - 8 });
    // Open the second command (the tech list).
    press('down');
    press('confirm');
    lay = layoutOfNative(b.sys.ui);
    const listWin = lay.windows.find((w) => w.title?.includes('·'));
    expect(listWin).toBeDefined();
    const listItems = (b.listMenu as { items: { label: string; icon?: string; right?: string }[] }).items;
    expect(listItems.length).toBeGreaterThan(0);
    const widths = await import('../src/sje');
    let widest = widths.measure('Nothing to use.');
    for (const it of listItems) widest = Math.max(widest, widths.measure(it.label) + (it.icon ? widths.measure(it.icon) + 3 : 0) + (it.right ? widths.measure(it.right) + 12 : 0));
    const w = listWindowW(widest);
    const lh = Math.min(5, Math.max(1, listItems.length)) * 11 + 14;
    expect(listWin).toMatchObject({ x: MENU_X, y: PANEL_Y - h - MENU_ABOVE_PANEL - lh - 4, w, h: lh });
    // Both lists are on screen, and the command window is still up under the list.
    expect(lay.lists).toHaveLength(2);
    expect(lay.windows.some((win) => win.title === actor.name.toUpperCase())).toBe(true);
    // Control: cancel closes the list window again.
    press('cancel');
    expect(layoutOfNative(b.sys.ui).windows.some((win) => win.title?.includes('·'))).toBe(false);
  });

  it('a message and a small banner stack at the top; a big banner replaces the message', async () => {
    const { HUD } = await import('../src/scenes/battlekit/geom');
    const b = await open();
    b.message = { text: 'Rook is ready.', t: 0 };
    tick();
    let lay = layoutOfNative(b.sys.ui);
    expect(lay.texts.find((t) => t.text === 'Rook is ready.')?.y).toBe(HUD.topY + 4);
    b.banner = { text: 'Slash', t: 10, color: '#ffcc3d' };
    tick();
    lay = layoutOfNative(b.sys.ui);
    expect(lay.texts.find((t) => t.text === 'Slash')?.y).toBe(HUD.topY + 4);
    expect(lay.texts.find((t) => t.text === 'Rook is ready.')?.y).toBe(HUD.topY + 24);
    b.banner = { text: 'OVERLOAD', t: 10, color: '#ffcc3d', big: true, sub: 'a big one' };
    tick();
    lay = layoutOfNative(b.sys.ui);
    expect(lay.texts.some((t) => t.text === 'Rook is ready.')).toBe(false);
    expect(lay.texts.find((t) => t.text === 'a big one')?.y).toBe(HUD.actionBannerY + 22);
  });

  it('the target box sits on the far side from its target and shows an enemy’s name and what the crew knows', async () => {
    const { HUD } = await import('../src/scenes/battlekit/geom');
    const { TARGET_INFO_W } = await import('../src/ui/layout');
    const b = await open();
    (b.nextActor as () => void)();
    b.mode = 'target';
    b.targetList = (b.battle as { enemies: { uid: number }[] }).enemies.map((e) => e.uid);
    b.targetIdx = 0;
    tick();
    const lay = layoutOfNative(b.sys.ui);
    const box = lay.windows.find((w) => w.w === TARGET_INFO_W);
    expect(box).toBeDefined();
    expect(box?.y).toBe(HUD.targetY);
    expect(lay.texts.some((t) => t.text === 'Rustfang Punk' || t.text.startsWith('Rustfang'))).toBe(true);
    // Control: aim at the other enemy and the text changes.
    b.targetIdx = 1;
    tick();
    expect(layoutOfNative(b.sys.ui).texts.some((t) => t.text.startsWith('Scrap'))).toBe(true);
  });
});

describe('a box is built again only when what it shows changes', () => {
  it('the target box: the same objects on the next tick, new ones when the target changes', async () => {
    const b = await open();
    (b.nextActor as () => void)();
    b.mode = 'target';
    b.targetList = (b.battle as { enemies: { uid: number }[] }).enemies.map((e) => e.uid);
    b.targetIdx = 0;
    tick();
    const box = hud(b).targetBox as unknown as { box: Container };
    const first = [...box.box.list];
    expect(first.length).toBeGreaterThan(2);
    tick(5);
    expect(same(box.box.list, first)).toBe(true);
    // Control: another target is another box.
    b.targetIdx = 1;
    tick();
    expect(box.box.list.some((o, i) => o !== first[i])).toBe(true);
  });

  it('the tell: built once per string and flash state, and gone with the tell', async () => {
    const b = await open();
    b.tell = { text: 'The Warden is charging!', t: 30, actor: 1, done: false };
    tick();
    const tellBox = hud(b).tellBox as unknown as { box: Container };
    const first = [...tellBox.box.list];
    expect(first.some((o) => o instanceof NineSlice)).toBe(true);
    expect(first.some((o) => o instanceof TextObject && o.text === 'The Warden is charging!')).toBe(true);
    // After the flash (t >= 24) nothing about it changes; the window frame is the same object.
    (b.tell as { t: number }).t = 40;
    tick(4);
    expect(same(tellBox.box.list, first)).toBe(true);
    // Control: clear the tell and the box is empty.
    b.tell = null;
    tick();
    expect(tellBox.box.list).toHaveLength(0);
  });

  it('a party card under no stage: a pulse changes the ring’s alpha and builds nothing; HP that moves a pixel builds the card again', async () => {
    const b = await open(['rustfang_punk']);
    (b.nextActor as () => void)();
    tick();
    const cards = hud(b).cards;
    expect(cards.length).toBe((b.battle as { party: unknown[] }).party.length);
    const card = cards[0];
    expect(card?.ring).not.toBeNull();
    const first = [...(card?.box.list ?? [])];
    const alphas = new Set<number>();
    for (let i = 0; i < 12; i++) {
      tick();
      alphas.add(Math.round((card?.ring?.alpha ?? 0) * 1000));
    }
    expect(alphas.size).toBeGreaterThan(3);
    expect(same(card?.box.list, first)).toBe(true);
    // The HP bar is 75 px: a change of a fraction of a pixel is the same box.
    const party = (b.battle as { party: { uid: number; base: { maxHp: number } }[] }).party;
    const p = party[0];
    const dd = (b.d as (uid: number) => { shownHp: number; hp: number }).call(b, p?.uid ?? 0);
    const before = dd.shownHp;
    dd.shownHp = before - (p?.base.maxHp ?? 100) / 75 / 8;
    tick();
    expect(same(card?.box.list, first)).toBe(true);
    // Control: a drop of many pixels (and its number) builds the card again.
    dd.hp = Math.round(before / 2);
    dd.shownHp = before / 2;
    tick();
    expect(card?.box.list.some((o, i) => o !== first[i])).toBe(true);
  });

  it('a cut-in slides by moving its container; it is built once', async () => {
    const b = await open();
    b.mode = 'play';
    const c = { key: 'kit', face: 'smirk', t: 1, fromLeft: true, life: 56, row: 0 };
    (b.cutins as unknown[]).push(c);
    tick();
    const map = hud(b).cutins;
    const box = map.get(c);
    expect(box).toBeDefined();
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) {
      xs.push(box?.x ?? 0);
      tick();
    }
    // Moving right toward its rest place, and still the same container in the map.
    expect(xs[5]).toBeGreaterThan(xs[0] ?? 0);
    expect(map.get(c)).toBe(box);
    // Control: once the cut-in has run its life, its container is destroyed and forgotten.
    c.t = c.life + 1;
    tick();
    expect(map.has(c)).toBe(false);
    expect(box?.destroyed).toBe(true);
  });

  it('enemy status (no stage): the HP bar plate is the same objects until the bar moves a pixel', async () => {
    const b = await open(['rustfang_punk']);
    b.mode = 'round';
    tick();
    const enemies = hud(b).enemies as unknown as Map<number, { box: Container }>;
    const e = (b.battle as { enemies: { uid: number; base: { maxHp: number } }[] }).enemies[0];
    const k = enemies.get(e?.uid ?? -1);
    expect(k).toBeDefined();
    const first = [...(k?.box.list ?? [])];
    expect(first.length).toBeGreaterThanOrEqual(2);
    tick(3);
    expect(same(k?.box.list, first)).toBe(true);
    // Control: a hit that takes a third of the HP moves the bar, in place (the same objects, no rebuild).
    const bar = k?.box.list.find((o): o is Bar => o instanceof Bar);
    const r0 = bar?.ratio ?? 0;
    const dd = (b.d as (uid: number) => { shownHp: number }).call(b, e?.uid ?? 0);
    dd.shownHp = (e?.base.maxHp ?? 30) * 0.6;
    tick();
    expect(same(k?.box.list, first)).toBe(true);
    expect(bar?.ratio).toBeLessThan(r0);
  });
});

describe('the damage ghost of a bar is the old drawLag', () => {
  it('barRects with a ghost paints the stretch from the fill to the ghost, in the pale color, as drawLag did', () => {
    const w = 75, h = 2;
    for (const [shown, lag] of [[0.5, 0.8], [0.2, 0.21], [0.9, 1], [0.1, 0.1], [0.6, 0.4], [0, 0.3]] as const) {
      const r = recorder();
      drawLag(r.ctx, 0, 0, w, h, shown, lag);
      const old = r.log.filter((l) => l.startsWith('fillRect'));
      const px = barPixels(w, shown, lag);
      const ghost = px.lag > px.fill ? [{ x: px.fill, y: 0, w: px.lag - px.fill, h, color: '#ffd7c0', alpha: 1 }] : [];
      const rects = barRects(w, h, px.fill / w, '#62e06a', undefined, px.lag > px.fill ? { ratio: px.lag / w, color: '#ffd7c0' } : null);
      expect(rects.slice(rects.length - ghost.length)).toEqual(ghost.length ? ghost : rects.slice(rects.length));
      // The old call painted one rect, or none: the same count, the same x and width.
      expect(old.length).toBe(ghost.length);
      if (old[0] && ghost[0]) expect(old[0]).toBe(`fillRect(${ghost[0].x},0,${ghost[0].w},${h})`);
    }
  });

  it('control: no ghost, no extra rectangle; a ghost short of the fill adds none', () => {
    const plain = barRects(75, 2, 0.5, '#62e06a');
    expect(barRects(75, 2, 0.5, '#62e06a', undefined, null)).toEqual(plain);
    expect(barRects(75, 2, 0.5, '#62e06a', undefined, { ratio: 0.4, color: '#ffd7c0' })).toEqual(plain);
    expect(barRects(75, 2, 0.5, '#62e06a', undefined, { ratio: 0.8, color: '#ffd7c0' })).toHaveLength(plain.length + 1);
  });
});

describe('the banner fades its text and band; its window frame stays solid', () => {
  it('a small banner at t = 3 has its text at half alpha and a solid window; at t = 20 both are solid', async () => {
    const b = await open();
    b.banner = { text: 'Slash', t: 2, color: '#ffcc3d' };
    tick();
    const box = (hud(b).bannerBox as unknown as { box: Container }).box;
    const win = box.list.find((o) => o instanceof NineSlice);
    const text = box.list.find((o) => o instanceof TextObject && o.text === 'Slash');
    expect(win?.alpha).toBe(1);
    // The banner's tick counter was 2, then the tick made it 3: 3 / 6.
    expect(text?.alpha).toBeCloseTo(0.5, 5);
    (b.banner as { t: number }).t = 20;
    tick();
    expect(box.list.find((o) => o instanceof TextObject && o.text === 'Slash')?.alpha).toBe(1);
    // Fading out at the end: t = 55 is half way through the last ten.
    (b.banner as { t: number }).t = 54;
    tick();
    expect(box.list.find((o) => o instanceof TextObject && o.text === 'Slash')?.alpha).toBeCloseTo(0.5, 5);
    expect(box.list.find((o) => o instanceof NineSlice)?.alpha).toBe(1);
  });
});

describe('the result panels', () => {
  it('the victory panel counts up: XP, cred and wallet follow the clock, the bar fills, and LV UP! shows once the bar rolls over', async () => {
    const { VictoryPanel } = await import('../src/scenes/battlekit/panels');
    const b = await open();
    let t = 0;
    const panel = new VictoryPanel(b as never, { xp: 120, cred: 3400, walletBefore: 1000, bars: [{ id: 'kit', lv0: 3, r0: 0.5, lv1: 4, r1: 0.2 }], dropNames: ['Medkit x2'], y: 44 }, () => t);
    const texts = (): string[] => all(b.sys.ui).filter((o): o is TextObject => o instanceof TextObject).map((o) => o.text);
    expect(texts()).toContain('{y}0{/} XP each');
    expect(texts()).toContain('Lv 3');
    t = 54;
    b.frame = 8;
    panel.update();
    expect(texts()).toContain('{y}120{/} XP each');
    expect(texts()).toContain('Wallet: 4,400¢');
    expect(texts()).toContain('Lv 4');
    expect(texts()).toContain('LV UP!');
    // Control: a clock back at the start and a blink in its off half show none of it.
    t = 0;
    b.frame = 20;
    panel.update();
    expect(texts()).not.toContain('LV UP!');
    expect(texts()).not.toContain('{y}120{/} XP each');
    panel.destroy();
    expect(all(b.sys.ui).some((o) => o instanceof TextObject && o.text.endsWith('XP each'))).toBe(false);
  });

  it('the level-up panel: stats count in turn, the restore line and each new skill show on their beats, and the arrow waits for the end', async () => {
    const { LevelUpPanel, levelUpBeats } = await import('../src/scenes/battlekit/panels');
    const b = await open();
    const u = {
      id: 'kit',
      level: 5,
      from: { hp: 100, tp: 20, atk: 10, def: 8, mnd: 6, agi: 12 },
      to: { hp: 112, tp: 22, atk: 12, def: 9, mnd: 7, agi: 13 },
      learned: [Object.keys((await import('../src/data/abilities')).ABILITIES)[1] as string],
    };
    const beats = levelUpBeats(u as never);
    let t = 0;
    const panel = new LevelUpPanel(b as never, u as never, () => t);
    const texts = (): string[] => all(b.sys.ui).filter((o): o is TextObject => o instanceof TextObject).map((o) => o.text);
    expect(texts()).toContain('100');
    expect(texts()).not.toContain('+12');
    expect(texts().some((s) => s.startsWith('{g}Fully restored'))).toBe(false);
    expect(texts()).not.toContain('NEW SKILL');
    t = beats.rowAt(0) + 12;
    b.frame = 0;
    panel.update();
    expect(texts()).toContain('112');
    expect(texts()).toContain('+12');
    t = beats.end;
    panel.update();
    expect(texts().some((s) => s.startsWith('{g}Fully restored'))).toBe(true);
    expect(texts().some((s) => s === 'NEW SKILL' || s === 'NEW TECH')).toBe(true);
    expect(texts()).toContain('▼');
    // Control: the arrow is in its off half of the blink.
    b.frame = 30;
    panel.update();
    expect(texts()).not.toContain('▼');
    panel.destroy();
  });

  it('the level-up panel: an unknown learned id has no row, and the known one after it shows on its own beat', async () => {
    const { LevelUpPanel, levelUpBeats } = await import('../src/scenes/battlekit/panels');
    const b = await open();
    const known = Object.keys((await import('../src/data/abilities')).ABILITIES)[1] as string;
    const u = {
      id: 'kit',
      level: 5,
      from: { hp: 100, tp: 20, atk: 10, def: 8, mnd: 6, agi: 12 },
      to: { hp: 112, tp: 22, atk: 12, def: 9, mnd: 7, agi: 13 },
      learned: ['no_such_ability', known],
    };
    const beats = levelUpBeats(u as never);
    let t = beats.learnAt(0) + 2;
    const panel = new LevelUpPanel(b as never, u as never, () => t);
    const chips = (): number => all(b.sys.ui).filter((o): o is TextObject => o instanceof TextObject && o.visible && (o.text === 'NEW SKILL' || o.text === 'NEW TECH')).length;
    // The first beat has come, but its id has no row. The known id (index 1) waits for its own beat.
    b.frame = 0;
    panel.update();
    expect(chips()).toBe(0);
    t = beats.learnAt(1);
    panel.update();
    expect(chips()).toBe(1);
    panel.destroy();
  });
});

describe('ten fights in a row leave nothing behind', () => {
  it('open, show the menus, a banner, a cut-in and the victory panel, close: the texture count and the display list return to where they began', async () => {
    const { VictoryPanel } = await import('../src/scenes/battlekit/panels');
    const before = game.textures.getTextureKeys().length;
    for (let i = 0; i < 10; i++) {
      const b = await open();
      (b.nextActor as () => void)();
      b.banner = { text: 'Slash', t: 10, color: '#ffcc3d' };
      b.tell = { text: 'Charging', t: 40, actor: 1, done: false };
      (b.cutins as unknown[]).push({ key: 'kit', face: 'smirk', t: 20, fromLeft: true, life: 56, row: 0 });
      tick(3);
      press('down');
      press('confirm');
      b.endPanel = new VictoryPanel(b as never, { xp: 1, cred: 1, walletBefore: 0, bars: [{ id: 'kit', lv0: 1, r0: 0, lv1: 1, r1: 0.5 }], dropNames: [], y: 44 }, () => 30);
      tick(3);
      const ui = b.sys.ui;
      b.close('win');
      tick();
      game.draw();
      expect(ui.destroyed).toBe(true);
    }
    expect(game.textures.getTextureKeys().length).toBe(before);
  });

  it('control: a window made and not added to the display list is a leak, and the count sees it', async () => {
    const before = game.textures.getTextureKeys().length;
    const b = await open();
    new NineSlice(b as never, 0, 0, 50, 30);
    b.close('win');
    tick();
    game.draw();
    expect(game.textures.getTextureKeys().length).toBe(before + 1);
  });
});
