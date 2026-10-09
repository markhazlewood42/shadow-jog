/**
 * The UI layout test (docs/PIVOT-640.md, PL4, WP4): each screen is drawn once, with a fixture state,
 * onto the layout recorder (`tests/recorder.ts`), and the record is checked:
 *
 *   1. every rect, image and clip lies inside the screen (0..W by 0..H);
 *   2. every text box lies inside the window that draws it;
 *   3. a tall pane's list takes the rows its window has room for (row counts follow the height);
 *   4. (advisory, rubric R5) the share of each window's inner width and height that holds content.
 *
 * The fixtures: the chapter's last stage (four crew members, every combo, a long bestiary), a bag with
 * every item in it, each member's Status page, the shop open on its buy list, its sell list, a
 * quantity popup and the equip popup, the modals, and the dialog in each of its shapes.
 *
 * Two controls keep the checks honest, and they stay in the suite: a window drawn at `W - 10` must fail
 * check 1, and the very same scenes drawn at 480x270 (the screen size mocked) must pass every check,
 * so the checks do not fire on a layout that was right.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EQUIP_STATS_H, EQUIP_STATS_W, SHOP_DETAIL_X } from '../src/ui/layout';
import {
  drive,
  FakeInput,
  fakeGame,
  installCanvasStub,
  Layout,
  listsNotFollowingHeight,
  outsideFrame,
  paneShares,
  recordingContext,
  setLayout,
  tapListRender,
  textOutsideWindow,
  type PaneShare,
  type WinRec,
} from './recorder';

// The font and window drawing go through the recorder's taps (the game's own code is not changed).
vi.mock('../src/engine/font', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/font')>();
  const r = await import('./recorder');
  return { ...real, drawText: r.tapText(real.drawText as never, real.measure), drawParagraph: r.tapParagraph(real.drawParagraph as never, real.wrap, real.measure) };
});
vi.mock('../src/ui/draw', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/draw')>();
  const r = await import('./recorder');
  return { ...real, drawWindow: r.tapWindow(real.drawWindow as never) };
});

let restoreDocument: () => void;
beforeAll(() => {
  restoreDocument = installCanvasStub();
});
afterAll(() => restoreDocument());

/** A scene as the test needs it: its update and render, and the fields it keeps private. */
interface AnyScene {
  game: unknown;
  update(): void;
  render(ctx: unknown): void;
  [k: string]: unknown;
}

/** One screen, drawn: a name, and what it drew. */
interface Shot {
  name: string;
  layout: Layout;
}

/** The longest line of dialogue the test uses: four lines on a page at the capped text width. */
const LONG =
  'Listen to me, all three of you. The Annex was built to keep things in, not out, and whoever opened that door knew exactly what was behind it. We go in quiet, we take what we came for, and nobody touches the glass. If the lights go red, you run, and you do not look back.';

/**
 * Draw every fixture screen, at the screen size the module graph holds (`size`: null for the real one,
 * or a smaller one mocked for the control). The scenes are imported fresh each time, so the size is the
 * one they were loaded with.
 */
async function drawAll(size: { W: number; H: number } | null): Promise<{ shots: Shot[]; W: number; H: number }> {
  vi.resetModules();
  if (size) {
    vi.doMock('../src/engine/game', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/engine/game')>()), ...size }));
  } else vi.doUnmock('../src/engine/game');
  const { W, H } = await import('../src/engine/game');
  const { applyStage } = await import('../src/game/stages');
  const { ITEMS } = await import('../src/data/items');
  const { state } = await import('../src/game/state');
  const { ListMenu } = await import('../src/ui/list');
  const real = ListMenu.prototype.render;
  // biome-ignore lint/suspicious/noExplicitAny: the tap's `this` is the list, whose type this test does not need.
  ListMenu.prototype.render = tapListRender(real as any) as typeof real;

  const shots: Shot[] = [];
  const ctx = recordingContext();
  const input = new FakeInput();
  /** Bind a scene to the fake game, run its first update if asked, and draw it once. */
  const take = (name: string, scene: AnyScene): void => {
    const layout = new Layout();
    setLayout(layout);
    try {
      scene.render(ctx);
    } finally {
      setLayout(null);
    }
    shots.push({ name, layout });
  };
  const bind = <T>(scene: T): T & AnyScene => {
    (scene as unknown as AnyScene).game = fakeGame(input);
    return scene as T & AnyScene;
  };

  applyStage('finale');
  // A full bag: one of every item, a few of each.
  state.inventory = Object.fromEntries(Object.keys(ITEMS).map((id) => [id, 3]));

  // ---- the field menu
  const { MenuScene } = await import('../src/scenes/menu');
  const menu = () => bind(new MenuScene(true));
  /** Move the main list's cursor to a row by its label. */
  const goto = (m: AnyScene, label: string): void => {
    const main = m.main as { items: { label: string }[]; index: number };
    const i = main.items.findIndex((it) => it.label === label);
    if (i < 0) throw new Error(`no ${label} in the menu`);
    main.index = i;
  };
  {
    const m = menu();
    take('menu: party cards', m);
    goto(m, 'Items');
    drive(m, input, ['confirm']);
    take('menu: items', m);
    drive(m, input, ['confirm']);
    take('menu: item target', m);
  }
  for (const [i, who] of ['kit', 'rook', 'hex', 'sable'].entries()) {
    const m = menu();
    goto(m, 'Techs');
    drive(m, input, ['confirm', ...Array<string>(i).fill('down'), 'confirm']);
    take(`menu: techs, ${who}`, m);
  }
  {
    const m = menu();
    goto(m, 'Equip');
    drive(m, input, ['confirm', 'confirm']);
    take('menu: equip slots', m);
    drive(m, input, ['confirm']);
    take('menu: equip gear list', m);
  }
  for (const [i, who] of ['kit', 'rook', 'hex', 'sable'].entries()) {
    const m = menu();
    goto(m, 'Status');
    drive(m, input, ['confirm', ...Array<string>(i).fill('down'), 'confirm']);
    take(`menu: status, ${who}`, m);
  }
  {
    // Rook, wounded: the status page with the wound line, and his locked abilities.
    const m = menu();
    delete state.flags.rook_mended;
    state.flags.rook_wounded = true;
    goto(m, 'Status');
    drive(m, input, ['confirm', 'down', 'confirm']);
    take('menu: status, rook (wounded)', m);
  }
  for (const label of ['Combos', 'Bestiary', 'Places', 'Save']) {
    const m = menu();
    goto(m, label);
    drive(m, input, ['confirm']);
    take(`menu: ${label.toLowerCase()}`, m);
  }

  // ---- the shop
  const { ShopScene } = await import('../src/scenes/shop');
  {
    const s = bind(new ShopScene('lr_weapons'));
    state.cred = 900;
    take('shop: root', s);
    drive(s, input, ['confirm']);
    take('shop: buy', s);
    drive(s, input, ['down', 'confirm']);
    take('shop: quantity', s);
    drive(s, input, ['cancel', 'cancel', 'down', 'confirm']);
    take('shop: sell', s);
    drive(s, input, ['confirm']);
    take('shop: sell all loot', s);
  }

  // ---- the modals
  const { OptionsScene } = await import('../src/scenes/options');
  take('options', bind(new OptionsScene(true)));
  const { SaveScene } = await import('../src/scenes/saveload');
  take('save slots', bind(new SaveScene('save')));
  take('load slots', bind(new SaveScene('load')));
  const { ControlsScene } = await import('../src/scenes/controls');
  take('controls', bind(new ControlsScene()));
  const { CardScene } = await import('../src/scenes/card');
  take('card', bind(new CardScene('Tutorial', 'Hold X to run. Press Z to talk to people and open things. The menu is on C, and it holds your items, techs, gear and the map of everywhere you have been so far.')));

  // ---- the dialog
  const { DialogScene } = await import('../src/scenes/dialog');
  const say = (name: string, opts: ConstructorParameters<typeof DialogScene>[0]): void => {
    const d = bind(new DialogScene(opts));
    for (let i = 0; i < 400; i++) d.update();
    take(`dialog: ${name}`, d);
  };
  say('one line', { who: 'dutch', text: 'Sit. Mind the stain.' });
  say('four-line page', { who: 'dutch', text: LONG });
  say('narration, four-line page', { who: null, text: LONG });
  say('a choice', { who: 'dutch', text: 'You want the job, or you want to keep your teeth?', choices: ['Take the job', 'Keep my teeth', 'Ask about the pay'] });
  say('at the top', { who: 'rook', text: 'Up. Dutch called.', top: true });

  // The map of a place (the plan, scaled to the screen), where the stub canvases allow it.
  try {
    const { PlaceMapScene } = await import('../src/scenes/placemap');
    take('place map', bind(new PlaceMapScene('lantern_row')));
  } catch (e) {
    console.warn('place map not drawn here:', (e as Error).message);
  }
  ListMenu.prototype.render = real;
  return { shots, W, H };
}

/** The room a scene keeps under its list for a description (the Items and Techs panes), for check 3. */
const reserve = (win: WinRec): number => (win.title === 'ITEMS' || win.title?.includes('·') ? 32 : 0);
/** The shortest window a list is judged in for check 3: the rail, a small menu and a popup have a fixed row count. */
const TALL = 150;

/** Run checks 1 to 3 over the shots; returns every finding, labeled. */
function findings(shots: Shot[], W: number, H: number): string[] {
  const out: string[] = [];
  for (const { name, layout } of shots) {
    for (const d of outsideFrame(layout, W, H)) out.push(`${name}: a ${d.op} at ${Math.round(d.x)},${Math.round(d.y)} ${Math.round(d.w)}x${Math.round(d.h)} leaves the screen`);
    for (const t of textOutsideWindow(layout)) out.push(`${name}: the text "${t.text.slice(0, 30)}" leaves its window (${t.win.title ?? 'untitled'})`);
    for (const l of listsNotFollowingHeight(layout, TALL, reserve)) out.push(`${name}: a list in "${l.win.title ?? 'untitled'}": ${l.why}`);
  }
  return out;
}

describe('every screen draws inside the frame (PL4)', () => {
  it('has screens to check (a test that draws nothing proves nothing)', async () => {
    const { shots } = await drawAll(null);
    expect(shots.length).toBeGreaterThanOrEqual(30);
    for (const s of shots) expect(s.layout.draws.length, s.name).toBeGreaterThan(5);
    expect(shots.some((s) => s.layout.windows.length > 0 && s.layout.lists.length > 0)).toBe(true);
  });

  it('1 to 3: every rect is on screen, every text is inside its window, and the tall panes’ lists follow the height', async () => {
    const { shots, W, H } = await drawAll(null);
    expect(findings(shots, W, H)).toEqual([]);
  });

  it('the same screens drawn at 480x270 also pass (the checks do not fire on a layout that was right)', async () => {
    const { shots, W, H } = await drawAll({ W: 480, H: 270 });
    expect([W, H]).toEqual([480, 270]);
    expect(shots.length).toBeGreaterThanOrEqual(30);
    expect(findings(shots, W, H)).toEqual([]);
  });

  it('a window drawn at W - 10 fails check 1 (the control: the check can fail)', async () => {
    const { W, H } = await drawAll(null);
    const { drawWindow } = await import('../src/ui/draw');
    const layout = new Layout();
    setLayout(layout);
    drawWindow(recordingContext(), W - 10, 100, 100, 60, { title: 'TOO FAR' });
    setLayout(null);
    expect(outsideFrame(layout, W, H).length).toBeGreaterThan(0);
    // And one drawn inside the frame passes.
    const ok = new Layout();
    setLayout(ok);
    drawWindow(recordingContext(), W - 108, 100, 100, 60, { title: 'FITS' });
    setLayout(null);
    expect(outsideFrame(ok, W, H)).toEqual([]);
  });

  it('a text wider than its window fails check 2 (the control)', async () => {
    const { drawWindow } = await import('../src/ui/draw');
    const { drawText } = await import('../src/engine/font');
    const layout = new Layout();
    setLayout(layout);
    const ctx = recordingContext();
    drawWindow(ctx, 20, 20, 60, 30);
    drawText(ctx, 'A line far too long for this window', 24, 30);
    setLayout(null);
    expect(textOutsideWindow(layout).length).toBe(1);
  });

  it('a list that keeps the rows of a smaller screen fails check 3 (the control)', async () => {
    const { H } = await drawAll(null);
    const { ListMenu } = await import('../src/ui/list');
    const { drawWindow } = await import('../src/ui/draw');
    const real = ListMenu.prototype.render;
    // biome-ignore lint/suspicious/noExplicitAny: see drawAll.
    ListMenu.prototype.render = tapListRender(real as any) as typeof real;
    const layout = new Layout();
    setLayout(layout);
    const ctx = recordingContext();
    drawWindow(ctx, 8, 8, 200, H - 16);
    new ListMenu(Array.from({ length: 40 }, (_, i) => ({ label: `Row ${i}`, value: i })), 12).render(ctx, 16, 24, 180);
    setLayout(null);
    ListMenu.prototype.render = real;
    expect(listsNotFollowingHeight(layout, TALL).length).toBe(1);
  });
});

describe('how much of each pane holds content (rubric R5, advisory)', () => {
  /**
   * Panes that are short by design, or tied to a few rows of data, are exempt from the 60% and 50%
   * lines. Each has its reason: the line says what the pane is. A pane that is neither exempt nor
   * above the lines is a finding for the reader (and the table below says by how much).
   */
  const byTitle = (re: RegExp) => (win: WinRec) => re.test(win.title ?? '');
  const EXEMPT: [(win: WinRec) => boolean, string][] = [
    [byTitle(/^MENU$/), 'the command rail: one row per command, as tall as its list'],
    [byTitle(/^ITEMS$|·/), 'a list pane: its rows are the bag, and the empty rows are the room the bag grows into'],
    [byTitle(/^EQUIP /), 'the slots window: four rows by design'],
    [byTitle(/^SAVE$/), 'three slot rows by design'],
    [byTitle(/^OBJECTIVE$/), 'one or two lines of text, a box sized to them'],
    [byTitle(/^(OPTIONS|CONTROLS|SAVE GAME|LOAD GAME)$/), 'a centered modal sized to its rows (D8: modals stay as they are)'],
    [byTitle(/^(BUY|SELL)$/), 'a list pane of the shop: its rows are the stock, the rest is room for it'],
    [byTitle(/^(BESTIARY|PLACES)/), 'a list pane: its rows are what the crew has met or visited'],
    [byTitle(/^WEAPON$|^BODY$|^HEAD$|^MOD$/), 'the gear list of the slot: its rows are what is in the bag'],
    [(win) => !win.title && win.w === EQUIP_STATS_W && win.h === EQUIP_STATS_H, 'the Equip stats box: seven short rows (a label, a value, and an arrow with the new value)'],
    [(win) => !win.title && win.x === SHOP_DETAIL_X, 'the shop detail pane: one item’s text and a row per crew member; its height is the list’s'],
  ];
  const exempt = (win: WinRec): string | null => EXEMPT.find(([is]) => is(win))?.[1] ?? null;

  it('reports the share of every window, and each window outside the exemption list spans 60% of its width and 50% of its height', async () => {
    const { shots, W, H } = await drawAll(null);
    const table: { shot: string; share: PaneShare }[] = [];
    for (const s of shots) for (const share of paneShares(s.layout, W, H)) table.push({ shot: s.name, share });
    // The panes a person reads as content: not the small plain boxes (a card, a toast, a popup, a status block).
    const judged = table.filter(({ share }) => share.win.w >= 150 && share.win.h >= 60 && !exempt(share.win) && share.items > 0);
    const low = judged.filter(({ share }) => share.wShare < 0.6 || share.hShare < 0.5);
    const lines = judged.map(({ shot, share }) => `${shot} / ${share.win.title ?? 'untitled'} ${share.win.w}x${share.win.h}: ${Math.round(share.wShare * 100)}% x ${Math.round(share.hShare * 100)}%`);
    console.info(`R5 panes judged (${judged.length}):\n${lines.join('\n')}`);
    expect(low.map(({ shot, share }) => `${shot} / ${share.win.title ?? 'untitled'}: ${Math.round(share.wShare * 100)}% x ${Math.round(share.hShare * 100)}%`)).toEqual([]);
  });
});
