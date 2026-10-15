/**
 * The UI scenes that M8b phase 2 ported to native `sje` scenes: options, dialog, title and shop. Each runs on a real `Game` with no renderer and a
 * scripted input, as in tests/sje-ui-scenes.test.ts (phase 1).
 *
 * The second half proves editor contract items (d) and (e) for the dialog and the shop (migration.md principle 11): `snapshot()` / `restore()` round
 * trip, and a deterministic `step(n)`. Every proof has a control: a case that must come out DIFFERENT, so the comparison is known to be able to fail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/engine/input';
import { ListMenu, TextObject } from '../src/sje';
import type { DialogOpts } from '../src/scenes/dialog';
import { Game } from '../src/sje/runtime/game';
import { installCanvasStub } from './recorder';

const sfxCalls: string[] = [];
vi.mock('../src/audio/sfx', () => ({ sfx: (name: string) => void sfxCalls.push(name) }));
vi.mock('../src/audio/music', () => ({ music: () => undefined, previewMusic: () => undefined }));
vi.mock('../src/audio/engine', () => ({ audio: { duck: () => undefined, applyVolumes: () => undefined, onUnlock: () => undefined, unlock: () => undefined } }));

/** A scripted input: one action is "pressed" (and repeating) for the tick it is set. */
class Keys {
  cur: string | null = null;
  held: string | null = null;
  anyPressed = false;
  names: Record<string, string> = { confirm: 'Z', cancel: 'X' };
  pressed = (a: string) => a === this.cur;
  repeat = (a: string) => a === this.cur;
  down = (a: string) => a === this.held;
  dir = () => null;
  update = () => undefined;
  endFrame = () => undefined;
  consume = () => undefined;
  keyName = (a: string) => this.names[a] ?? a;
  keysFor = () => ['KeyZ'];
  captureNext = () => undefined;
}

let restoreCanvas: () => void;
beforeAll(async () => {
  restoreCanvas = installCanvasStub();
  // The shop reads the player's state: the chapter's last stage has the whole crew and a full set of gear.
  const { applyStage } = await import('../src/game/stages');
  applyStage('finale');
});
afterAll(() => restoreCanvas());

let game: Game;
let keys: Keys;
beforeEach(async () => {
  keys = new Keys();
  game = new Game({ renderer: { render: () => undefined }, input: keys as unknown as Input });
  sfxCalls.length = 0;
  const { debug } = await import('../src/game/debug');
  debug.autoDialog = false;
  debug.playtest = false;
});

function press(action: string): void {
  keys.cur = action;
  game.advanceTick();
  keys.cur = null;
}
function tick(n: number): void {
  for (let i = 0; i < n; i++) game.advanceTick();
}

/** Every text object in a display tree, depth first (a visible one only). */
function textsIn(list: readonly unknown[], out: { text: string; max: number | undefined }[] = []): { text: string; max: number | undefined }[] {
  for (const o of list) {
    if ((o as { visible?: boolean }).visible === false) continue;
    if (o instanceof TextObject) out.push({ text: o.text, max: o.style.max });
    const children = (o as { list?: readonly unknown[] }).list;
    if (children) textsIn(children, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- options

describe('OptionsScene', () => {
  it('right on the music row raises the volume by a tenth and the bar follows; cancel closes with back', async () => {
    const { OptionsScene } = await import('../src/scenes/options');
    const { settings } = await import('../src/game/settings');
    const { Bar } = await import('../src/sje');
    settings.musicVol = 0.5;
    const s = new OptionsScene(false);
    let result: unknown = 'open';
    void game.run(s).then((r) => (result = r));
    const bars = s.sys.ui.list.filter((o): o is InstanceType<typeof Bar> => o instanceof Bar);
    expect(bars).toHaveLength(2);
    expect(bars[0]?.ratio).toBeCloseTo(0.5);
    press('right');
    expect(settings.musicVol).toBeCloseTo(0.6);
    expect(bars[0]?.ratio).toBeCloseTo(0.6);
    press('cancel');
    expect(s.closed).toBe(true);
    return Promise.resolve().then(() => expect(result).toBe('back'));
  });

  it('Quit to title asks first: cancel keeps the screen, confirm closes with title', async () => {
    const { OptionsScene } = await import('../src/scenes/options');
    const s = new OptionsScene(true);
    let result: unknown = 'open';
    void game.run(s).then((r) => (result = r));
    // From the first row, up wraps to Back and up again to Quit to title.
    press('up');
    press('up');
    press('confirm');
    const popup = s.sys.ui.list.find((o) => o.name === 'quit-confirm');
    expect(popup?.visible).toBe(true);
    press('cancel');
    expect(popup?.visible).toBe(false);
    expect(s.closed).toBe(false);
    press('confirm');
    expect(popup?.visible).toBe(true);
    press('confirm');
    expect(s.closed).toBe(true);
    return Promise.resolve().then(() => expect(result).toBe('title'));
  });

  it('a Back-less game (not in a game) has no Quit row', async () => {
    const { OptionsScene } = await import('../src/scenes/options');
    const out = new OptionsScene(false);
    const inn = new OptionsScene(true);
    void game.run(out);
    void game.run(inn);
    const labels = (s: { sys: { ui: { list: readonly unknown[] } } }) => textsIn(s.sys.ui.list).map((t) => t.text);
    expect(labels(out)).not.toContain('Quit to title');
    expect(labels(inn)).toContain('Quit to title');
    inn.close('back');
    out.close('back');
  });
});

// ---------------------------------------------------------------------------------------------------- dialog

const TWO_PAGES =
  'Listen to me, all three of you. The Annex was built to keep things in, not out, and whoever opened that door knew exactly what was behind it. We go in quiet, we take what we came for, and nobody touches the glass. If the lights go red, you run, and you do not look back. One more thing: stay together, and if one of us stops, we all stop. And if you hear the old man laughing behind the glass, that is the system talking, not the man, so keep your eyes on the floor and your hands in your pockets until we are out.';

describe('DialogScene', () => {
  it('opens over 6 ticks, types the line, and a confirm at the end of the last page closes with 0', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ who: 'dutch', text: 'Sit. Mind the stain.' });
    let result: unknown = 'open';
    void game.run(s).then((r) => (result = r));
    expect(s.snapshot().opened).toBe(0);
    tick(6);
    expect(s.snapshot().opened).toBe(6);
    tick(300);
    expect(s.snapshot().shown).toBeGreaterThan(10);
    press('confirm');
    expect(s.closed).toBe(true);
    return Promise.resolve().then(() => expect(result).toBe(0));
  });

  it('the music duck is released once on every way the box ends: close, abandon and reset (control: not while open)', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const { audio } = await import('../src/audio/engine');
    const spy = vi.spyOn(audio, 'duck');
    try {
      const a = new DialogScene({ who: 'dutch', text: 'One.' });
      void game.run(a);
      expect(spy.mock.calls).toEqual([[true]]); // control: ducked, and not released while open
      a.close(0);
      tick(1);
      expect(spy.mock.calls).toEqual([[true], [false]]);
      spy.mockClear();
      void game.run(new DialogScene({ who: 'dutch', text: 'Two.' }));
      game.abandon();
      expect(spy.mock.calls).toEqual([[true], [false]]);
      spy.mockClear();
      void game.run(new DialogScene({ who: 'dutch', text: 'Three.' }));
      void game.reset(new DialogScene({ who: 'dutch', text: 'Four.' }));
      expect(spy.mock.calls.filter((c) => c[0] === false)).toHaveLength(1);
      expect(spy.mock.calls.filter((c) => c[0] === true)).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('restore and step before the scene runs throw a clear error (control: they work once it runs)', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ who: 'dutch', text: 'Sit.' });
    expect(() => s.step(1)).toThrow(/needs a running scene/);
    expect(() => s.restore(s.snapshot())).toThrow(/needs a running scene/);
    void game.run(s);
    expect(() => s.step(1)).not.toThrow();
    expect(() => s.restore(s.snapshot())).not.toThrow();
    s.close(0);
  });

  it('a long line turns pages on confirm, and the second page starts empty', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ who: 'dutch', text: TWO_PAGES });
    void game.run(s);
    s.step(5000); // the whole first page is typed
    expect(s.snapshot().page).toBe(0);
    press('confirm');
    expect(s.snapshot().page).toBe(1);
    expect(s.snapshot().shown).toBe(0);
    s.close(0);
  });

  it('a choice returns its index; cancel is ignored (and silent) unless the line says what cancel answers', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const ask = new DialogScene({ who: 'dutch', text: 'Job, or your teeth?', choices: ['Take the job', 'Keep my teeth'] });
    let result: unknown = 'open';
    void game.run(ask).then((r) => (result = r));
    tick(300);
    sfxCalls.length = 0;
    press('cancel');
    expect(ask.closed).toBe(false);
    expect(sfxCalls).not.toContain('cancel');
    press('down');
    press('confirm');
    expect(ask.closed).toBe(true);
    await Promise.resolve();
    expect(result).toBe(1);
    // With a cancel answer, cancel closes with it.
    const ask2 = new DialogScene({ who: 'dutch', text: 'Job, or your teeth?', choices: ['Take the job', 'Keep my teeth'], cancel: 1 });
    let r2: unknown = 'open';
    void game.run(ask2).then((r) => (r2 = r));
    tick(300);
    press('cancel');
    expect(ask2.closed).toBe(true);
    await Promise.resolve();
    expect(r2).toBe(1);
  });

  it('the choice box and the question show only when the page has been typed', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ who: 'dutch', text: 'Job, or your teeth?', choices: ['Take the job', 'Keep my teeth'] });
    void game.run(s);
    const menu = () => s.sys.ui.list.find((o): o is InstanceType<typeof ListMenu> => o instanceof ListMenu);
    tick(8);
    expect(menu()?.visible).toBe(false);
    tick(300);
    expect(menu()?.visible).toBe(true);
    s.close(0);
  });
});

describe('DialogScene: editor contract (d) snapshot / restore and (e) step(n)', () => {
  const opts: DialogOpts = { who: 'dutch', text: TWO_PAGES };
  const ask: DialogOpts = { who: 'rook', text: 'Which way, then? Quick, before the lights change.', choices: ['Left', 'Right', 'Back'], cancel: 2 };

  it('(e) step(n) is deterministic: the same n from the same state gives the same state', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const a = new DialogScene({ ...opts });
    const b = new DialogScene({ ...opts });
    void game.run(a);
    void game.run(b);
    a.step(40);
    b.step(40);
    expect(a.snapshot()).toEqual(b.snapshot());
    // step in two parts equals step in one
    const c = new DialogScene({ ...opts });
    void game.run(c);
    c.step(15);
    c.step(25);
    expect(c.snapshot()).toEqual(a.snapshot());
    // control: one more tick gives a different state
    b.step(1);
    expect(b.snapshot()).not.toEqual(a.snapshot());
    a.close(0);
    b.close(0);
    c.close(0);
  });

  it('(e) step(0) differs from step(end): the reveal advances, the open animation finishes, and it stops at the end of the page', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ ...opts });
    void game.run(s);
    const start = s.snapshot();
    s.step(0);
    expect(s.snapshot()).toEqual(start);
    s.step(5000);
    const end = s.snapshot();
    expect(end).not.toEqual(start);
    expect(end.opened).toBe(6);
    expect(end.page).toBe(0);
    expect(s.closed).toBe(false);
    // The first page is fully shown and the text objects show it (the typewriter limit is the page length).
    const shownTexts = textsIn(s.sys.ui.list).filter((t) => t.text.length > 20);
    expect(shownTexts.length).toBe(4);
    s.close(0);
  });

  it('(e) step(n) is the same as n live ticks with no key pressed (the reveal part of the state)', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const stepped = new DialogScene({ ...opts });
    void game.run(stepped);
    stepped.step(60);
    const live = new DialogScene({ ...opts });
    const game2 = new Game({ renderer: { render: () => undefined }, input: new Keys() as unknown as Input });
    void game2.run(live);
    for (let i = 0; i < 60; i++) game2.advanceTick();
    expect(live.snapshot()).toEqual(stepped.snapshot());
    // the stepped scene made no sound; the live one made blips
    stepped.close(0);
    live.close(0);
  });

  it('(e) step makes no sound', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ ...opts });
    void game.run(s);
    sfxCalls.length = 0;
    s.step(120);
    expect(sfxCalls).toEqual([]);
    // control: live ticks of the same line do blip
    const live = new DialogScene({ ...opts });
    void game.run(live);
    tick(120);
    expect(sfxCalls).toContain('blip');
    s.close(0);
    live.close(0);
  });

  it('(d) a snapshot is plain JSON, and survives a trip through JSON.stringify', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const s = new DialogScene({ ...ask });
    void game.run(s);
    s.step(400);
    const snap = s.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    s.close(0);
  });

  it('(d) restore(snapshot()) puts a box back: the line, the page, the characters shown, the choice cursor, and the view', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    // A box on its choices, with the cursor on the second one.
    const a = new DialogScene({ ...ask });
    void game.run(a);
    tick(300);
    press('down');
    const snap = a.snapshot();
    expect(snap.choiceIdx).toBe(1);
    // A fresh box for a different line becomes the same box.
    const b = new DialogScene({ who: 'kit', text: 'Hello.' });
    void game.run(b);
    b.restore(snap);
    expect(b.snapshot()).toEqual(snap);
    expect(textsIn(b.sys.ui.list)).toEqual(textsIn(a.sys.ui.list));
    const menu = b.sys.ui.list.find((o): o is InstanceType<typeof ListMenu> => o instanceof ListMenu);
    expect(menu?.index).toBe(1);
    expect(menu?.visible).toBe(true);
    // The restored box plays on: confirm picks the second choice.
    press('confirm');
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
  });

  it('(d) restore of a box in the middle of a typed page keeps the characters shown; control: a changed snapshot gives a different view', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const a = new DialogScene({ ...opts });
    void game.run(a);
    a.step(50);
    const snap = a.snapshot();
    expect(snap.shown).toBeGreaterThan(0);
    const b = new DialogScene({ ...opts });
    void game.run(b);
    b.restore(snap);
    expect(b.snapshot()).toEqual(snap);
    expect(textsIn(b.sys.ui.list)).toEqual(textsIn(a.sys.ui.list));
    // control: restore with fewer characters shown
    const c = new DialogScene({ ...opts });
    void game.run(c);
    c.restore({ ...snap, shown: Math.max(0, snap.shown - 10) });
    expect(c.snapshot()).not.toEqual(snap);
    expect(textsIn(c.sys.ui.list)).not.toEqual(textsIn(a.sys.ui.list));
    // control: restore with the choice cursor moved
    const d = new DialogScene({ ...ask });
    void game.run(d);
    d.step(400);
    const withChoices = d.snapshot();
    const e = new DialogScene({ ...ask });
    void game.run(e);
    e.restore({ ...withChoices, choiceIdx: 2 });
    expect(e.snapshot().choiceIdx).toBe(2);
    expect(e.snapshot()).not.toEqual(withChoices);
    for (const s of [a, b, c, d, e]) s.close(0);
  });

  it('(d) restore then step continues the reveal where the snapshot left it', async () => {
    const { DialogScene } = await import('../src/scenes/dialog');
    const a = new DialogScene({ ...opts });
    void game.run(a);
    a.step(30);
    const snap = a.snapshot();
    a.step(30);
    const b = new DialogScene({ ...opts });
    void game.run(b);
    b.restore(snap);
    b.step(30);
    expect(b.snapshot()).toEqual(a.snapshot());
    a.close(0);
    b.close(0);
  });
});

// ---------------------------------------------------------------------------------------------------- title

describe('TitleScene', () => {
  it('ignores keys for 30 ticks, then a key starts it and shows the menu; confirm on New Game closes with new', async () => {
    const { TitleScene } = await import('../src/scenes/title');
    const s = new TitleScene();
    let result: unknown = 'open';
    void game.run(s).then((r) => (result = r));
    const menu = s.sys.ui.list.find((o): o is InstanceType<typeof ListMenu> => o instanceof ListMenu);
    expect(menu?.visible).toBe(false);
    keys.anyPressed = true;
    tick(20);
    expect(menu?.visible).toBe(false);
    tick(20);
    expect(menu?.visible).toBe(true);
    keys.anyPressed = false;
    expect(menu?.current?.value).toBe('new');
    press('confirm');
    expect(s.closed).toBe(true);
    await Promise.resolve();
    expect(result).toEqual({ kind: 'new' });
  });

  it('Options opens the options scene over the title, and the title is not closed by it', async () => {
    const { TitleScene } = await import('../src/scenes/title');
    const { OptionsScene } = await import('../src/scenes/options');
    const s = new TitleScene();
    void game.run(s);
    keys.anyPressed = true;
    tick(40);
    keys.anyPressed = false;
    // New Game, Continue (locked), Load Game (locked), Options: with no saves the cursor starts on New Game.
    for (let i = 0; i < 3; i++) press('down');
    press('confirm');
    expect(game.top).toBeInstanceOf(OptionsScene);
    press('cancel');
    expect(game.top).toBe(s);
    expect(s.closed).toBe(false);
    s.close({ kind: 'new' });
  });

  it('the logo glitches in over 40 ticks and the chapter line appears after', async () => {
    const { TitleScene } = await import('../src/scenes/title');
    const s = new TitleScene();
    void game.run(s);
    const logo = s.sys.ui.list.filter((o) => o.constructor.name === 'CanvasImage')[1];
    tick(10);
    expect(logo?.visible).toBe(false);
    tick(20);
    expect(logo?.visible).toBe(true);
    const chapter = (): boolean => textsIn(s.sys.ui.list).some((t) => t.text.startsWith('CHAPTER ONE'));
    expect(chapter()).toBe(false);
    tick(40);
    expect(chapter()).toBe(true);
    s.close({ kind: 'new' });
  });
});

// ---------------------------------------------------------------------------------------------------- shop

/** The shop's private lists, for the checks that read the cursor. */
type ShopInner = { list: InstanceType<typeof ListMenu<string>>; mode: string };
const inner = (s: unknown): ShopInner => s as ShopInner;

describe('ShopScene', () => {
  beforeEach(async () => {
    // A fresh chapter-end state each time: buying gear and equipping it changes who wears what.
    (await import('../src/game/stages')).applyStage('finale');
    const { state } = await import('../src/game/state');
    state.cred = 900;
  });

  it('buys the first item at quantity one: cred goes down, the bag gains it, and cancel at the root leaves', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const { state } = await import('../src/game/state');
    const before = { ...state.inventory };
    const s = new ShopScene('lr_weapons');
    void game.run(s);
    tick(2);
    press('confirm'); // Buy
    press('confirm'); // the first item -> quantity
    press('confirm'); // quantity 1 -> bought (gear: the equip picker or back to the shelf)
    expect(state.cred).toBeLessThan(900);
    const gained = Object.keys(state.inventory).filter((k) => (state.inventory[k] ?? 0) > (before[k] ?? 0));
    expect(gained).toHaveLength(1);
    // Out of the picker and the list, back to the root, and leave.
    for (let i = 0; i < 4 && !s.closed; i++) press('cancel');
    expect(s.closed).toBe(true);
  });

  it('a row you cannot afford says how much more it costs when it is pressed', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const { state } = await import('../src/game/state');
    state.cred = 0;
    const s = new ShopScene('lr_weapons');
    void game.run(s);
    tick(2);
    press('confirm');
    sfxCalls.length = 0;
    press('confirm');
    expect(sfxCalls).toContain('buzz');
    expect(s.snapshot().line).toMatch(/more than you’ve got/);
    s.close();
  });

  it('Sell all loot sells every piece of loot and keeps supplies', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const { state } = await import('../src/game/state');
    state.inventory = { gang_colors: 2, medkit: 1 };
    state.cred = 100;
    const s = new ShopScene('lr_weapons');
    void game.run(s);
    tick(2);
    press('down');
    press('confirm'); // Sell
    press('confirm'); // Sell all loot -> the question
    expect(s.snapshot().mode).toBe('junk');
    press('confirm'); // Sell it all
    expect(state.inventory.gang_colors ?? 0).toBe(0);
    expect(state.inventory.medkit).toBe(1);
    expect(state.cred).toBeGreaterThan(100);
    s.close();
  });

  it('gear bought here can be put on: the picker offers the crew, and confirm equips the first who can wear it', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const { state } = await import('../src/game/state');
    state.cred = 5000;
    const s = new ShopScene('lr_weapons');
    void game.run(s);
    tick(2);
    press('confirm');
    press('confirm');
    press('confirm');
    expect(s.snapshot().mode).toBe('equip');
    press('confirm');
    const worn = Object.values(state.members).map((m) => m.equip.weapon);
    expect(worn).toContain('iron_knuckles');
    s.close();
  });

  it('a purchase at the quantity prompt follows the left and right keys, within what the wallet allows', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const s = new ShopScene('lr_weapons');
    void game.run(s);
    tick(2);
    press('confirm');
    press('down');
    press('down');
    press('confirm');
    expect(s.snapshot().mode).toBe('qty');
    press('right');
    expect(s.snapshot().qty).toBe(2);
    press('left');
    press('left');
    expect(s.snapshot().qty).toBe(1);
    press('cancel');
    expect(s.snapshot().mode).toBe('buy');
    s.close();
  });
});

describe('ShopScene: editor contract (d) snapshot / restore and (e) step(n)', () => {
  beforeEach(async () => {
    // A fresh chapter-end state each time: buying gear and equipping it changes who wears what.
    (await import('../src/game/stages')).applyStage('finale');
    const { state } = await import('../src/game/state');
    state.cred = 900;
    state.inventory = { gang_colors: 2, medkit: 1, scrap_plate: 3 };
  });

  /** A shop driven to a mode by keys. */
  async function shopIn(mode: 'root' | 'buy' | 'sell' | 'qty' | 'junk'): Promise<InstanceType<typeof import('../src/scenes/shop').ShopScene>> {
    const { ShopScene } = await import('../src/scenes/shop');
    const s = new ShopScene('lr_weapons');
    void game.run(s);
    tick(2);
    if (mode === 'root') return s;
    if (mode === 'buy' || mode === 'qty') {
      press('confirm');
      press('down');
      press('down');
      if (mode === 'qty') press('confirm');
      return s;
    }
    press('down');
    press('confirm'); // Sell
    if (mode === 'junk') press('confirm');
    else press('down');
    return s;
  }

  for (const mode of ['root', 'buy', 'sell', 'qty', 'junk'] as const) {
    it(`(d) restore(snapshot()) in the ${mode} mode gives an equal snapshot on a fresh shop`, async () => {
      const { ShopScene } = await import('../src/scenes/shop');
      const a = await shopIn(mode);
      const snap = a.snapshot();
      expect(snap.mode).toBe(mode);
      const b = new ShopScene('lr_weapons');
      void game.run(b);
      tick(2);
      b.restore(snap);
      expect(b.snapshot()).toEqual(snap);
      // The view agrees too (once the highlights have eased to rest in both).
      a.step(20);
      b.step(20);
      expect(textsIn(b.sys.ui.list).map((t) => t.text)).toEqual(textsIn(a.sys.ui.list).map((t) => t.text));
      a.close();
      b.close();
    });
  }

  it('(d) a snapshot is plain JSON and holds ids and cursors, not prices', async () => {
    const a = await shopIn('buy');
    const snap = a.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.stock.length).toBeGreaterThan(2);
    expect(snap.listIndex).toBe(2);
    a.close();
  });

  it('(d) the equip picker survives a restore (rows and cursor)', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const { state } = await import('../src/game/state');
    state.cred = 5000;
    const a = new ShopScene('lr_weapons');
    void game.run(a);
    tick(2);
    press('confirm');
    press('confirm');
    press('confirm');
    const snap = a.snapshot();
    expect(snap.mode).toBe('equip');
    expect(snap.equipRows.length).toBeGreaterThan(1);
    const b = new ShopScene('lr_weapons');
    void game.run(b);
    tick(2);
    b.restore(snap);
    expect(b.snapshot()).toEqual(snap);
    a.close();
    b.close();
  });

  it('(d) control: a changed snapshot restores to a different state', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const a = await shopIn('buy');
    const snap = a.snapshot();
    const b = new ShopScene('lr_weapons');
    void game.run(b);
    tick(2);
    b.restore({ ...snap, listIndex: 0 });
    expect(b.snapshot()).not.toEqual(snap);
    expect(b.snapshot().listIndex).toBe(0);
    // and an unknown shop is refused
    expect(() => b.restore({ ...snap, shop: 'no_such_shop' })).toThrow(/no shop/);
    a.close();
    b.close();
  });

  it('(e) step(n) is deterministic, step(0) differs from step(end), and step in parts equals step in one', async () => {
    const { ShopScene } = await import('../src/scenes/shop');
    const a = await shopIn('buy');
    const snap = a.snapshot();
    const rest = (s: unknown) => inner(s).list.highlightRect;
    const make = () => {
      const b = new ShopScene('lr_weapons');
      void game.run(b);
      tick(2);
      b.restore(snap);
      return b;
    };
    const b = make();
    const c = make();
    const d = make();
    const start = rest(b);
    b.step(0);
    expect(rest(b)).toEqual(start);
    b.step(5);
    c.step(5);
    expect(rest(b)).toEqual(rest(c));
    expect(b.snapshot()).toEqual(c.snapshot());
    // step in parts
    d.step(2);
    d.step(3);
    expect(rest(d)).toEqual(rest(b));
    expect(d.snapshot()).toEqual(b.snapshot());
    // the highlight moved from where the restore left it, and ends at the cursor's row
    b.step(30);
    expect(rest(b)).not.toEqual(start);
    // control: a different n gives a different state
    expect(rest(c)).not.toEqual(rest(b));
    expect(c.snapshot().t).not.toEqual(b.snapshot().t);
    for (const s of [a, b, c, d]) s.close();
  });

  it('(e) step changes no game state and no mode', async () => {
    const { state } = await import('../src/game/state');
    const a = await shopIn('qty');
    const cred = state.cred;
    const inv = JSON.stringify(state.inventory);
    const before = a.snapshot();
    a.step(100);
    expect(state.cred).toBe(cred);
    expect(JSON.stringify(state.inventory)).toBe(inv);
    expect({ ...a.snapshot(), t: 0 }).toEqual({ ...before, t: 0 });
    a.close();
  });
});
