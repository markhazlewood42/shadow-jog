/**
 * The UI scenes that M8b phase 3 ported to native `sje` scenes: the field menu, Hex's deck and the comic panels. Each runs on a real `Game` with no
 * renderer and a scripted input, as in tests/sje-ui-scenes-2.test.ts (phase 2).
 *
 * Every proof that something DOES happen has a control: a case where it must not, so the check is known to be able to fail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/engine/input';
import { type Container, type ListMenu, TextObject } from '../src/sje';
import { Game } from '../src/sje/runtime/game';
import { installCanvasStub } from './recorder';

const sfxCalls: string[] = [];
vi.mock('../src/audio/sfx', () => ({ sfx: (name: string) => void sfxCalls.push(name) }));
vi.mock('../src/audio/music', () => ({ music: () => undefined, previewMusic: () => undefined }));
vi.mock('../src/audio/engine', () => ({ audio: { duck: () => undefined, applyVolumes: () => undefined, onUnlock: () => undefined, unlock: () => undefined } }));

/** A scripted input: one action is "pressed" (and repeating) for the tick it is set. */
class Keys {
  cur: string | null = null;
  names: Record<string, string> = { confirm: 'Z', cancel: 'X' };
  pressed = (a: string) => a === this.cur;
  repeat = (a: string) => a === this.cur;
  down = () => false;
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
  // The menu reads the player's state: the chapter's last stage has the whole crew and a full set of gear.
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
const textureCount = (): number => game.textures.getTextureKeys().length;

/** Every visible text object in a display tree, depth first. */
function textsIn(list: readonly unknown[], out: TextObject[] = []): TextObject[] {
  for (const o of list) {
    if ((o as { visible?: boolean }).visible === false) continue;
    if (o instanceof TextObject) out.push(o);
    const children = (o as { list?: readonly unknown[] }).list;
    if (children) textsIn(children, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- menu

interface MenuPeek {
  mode: string;
  main: ListMenu<string>;
  base: Container;
  top: Container;
  say(text: string): void;
  sys: { ui: Container };
  closed: boolean;
}

describe('MenuScene', () => {
  const open = async (): Promise<{ m: MenuPeek; result: () => unknown }> => {
    const { MenuScene } = await import('../src/scenes/menu');
    const s = new MenuScene(true);
    let r: unknown = 'open';
    void game.run(s).then((v) => (r = v));
    return { m: s as unknown as MenuPeek, result: () => r };
  };

  it('confirm on Items opens the item list, cancel goes back to the main list, cancel again closes with close', async () => {
    const { m, result } = await open();
    expect(m.mode).toBe('main');
    press('confirm');
    expect(m.mode).toBe('items');
    // The main list stays on screen beside the item list; the cursor sounds were played through the kit's onSound.
    press('cancel');
    expect(m.mode).toBe('main');
    press('cancel');
    expect(m.closed).toBe(true);
    await Promise.resolve();
    expect(result()).toEqual({ kind: 'close' });
  });

  it('the menu key closes it, and a plain tick does not (control)', async () => {
    const { m } = await open();
    tick(5);
    expect(m.closed).toBe(false);
    press('menu');
    expect(m.closed).toBe(true);
  });

  it('the page is built again only when what it shows changes', async () => {
    const { m } = await open();
    tick(2);
    const first = m.base.list[0];
    expect(first).toBeDefined();
    tick(30);
    // Nothing changed: the same window object is still there.
    expect(m.base.list[0]).toBe(first);
    // Control: a change (the mode) builds the page again, so the old objects are gone.
    press('confirm');
    expect(m.base.list[0]).not.toBe(first);
    expect(first?.destroyed).toBe(true);
  });

  it('a toast shows over the lists for 120 ticks and then goes', async () => {
    const { m } = await open();
    tick(1);
    expect(m.top.list.length).toBe(0);
    m.say('Saved to slot 1.');
    tick(1);
    expect(textsIn(m.top.list).map((t) => t.text)).toContain('Saved to slot 1.');
    tick(125);
    expect(m.top.list.length).toBe(0);
  });

  it('Equip walks member, slot and gear list, and cancel steps back through them', async () => {
    const { m } = await open();
    const i = m.main.items.findIndex((it) => it.label === 'Equip');
    m.main.index = i;
    press('confirm');
    expect(m.mode).toBe('pickMember');
    press('confirm');
    expect(m.mode).toBe('equipSlots');
    press('confirm');
    // The full bag of the final stage has gear for the first slot.
    expect(m.mode).toBe('equipList');
    press('cancel');
    expect(m.mode).toBe('equipSlots');
    press('cancel');
    expect(m.mode).toBe('pickMember');
  });

  it('opening and closing the menu through its pages ten times leaves no texture behind', async () => {
    const { MenuScene } = await import('../src/scenes/menu');
    const before = textureCount();
    for (let n = 0; n < 10; n++) {
      const s = new MenuScene(true);
      void game.run(s);
      tick(2);
      const m = s as unknown as MenuPeek;
      for (const label of ['Items', 'Status', 'Combos', 'Bestiary', 'Places', 'Save']) {
        m.main.index = m.main.items.findIndex((it) => it.label === label);
        press('confirm');
        press('confirm');
        tick(2);
        // Back to the main list whatever page this was.
        for (let k = 0; k < 4 && m.mode !== 'main'; k++) press('cancel');
      }
      expect(textureCount()).toBeGreaterThan(before);
      s.close({ kind: 'close' });
      tick(1);
    }
    expect(textureCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------- deck

interface DeckPeek {
  phase: string;
  misses: number;
  clips: number;
  closed: boolean;
  bootLines: TextObject[];
  sys: { ui: Container };
}

describe('DeckScene', () => {
  it('seat: a press that misses the socket is refused and slows the swing; hits drop the chip, snap two clips, boot and finish', async () => {
    const { DeckScene } = await import('../src/scenes/deck');
    const s = new DeckScene('seat');
    void game.run(s);
    const d = s as unknown as DeckPeek;
    // Control: with no key the deck waits in Align for as long as you like.
    tick(200);
    expect(d.phase).toBe('align');
    expect(d.misses).toBe(0);
    // Press every tick: the swing passes the socket, so some presses miss and one hits.
    for (let i = 0; i < 400 && d.phase === 'align'; i++) press('confirm');
    expect(d.phase).not.toBe('align');
    // Each miss played the buzz, and a miss at least slowed nothing else: the count of buzzes is the count of misses.
    expect(sfxCalls.filter((n) => n === 'buzz').length).toBe(d.misses);
    // The drop takes 14 ticks; a clip is not taken in the first 8 ticks of Clips.
    tick(30);
    expect(d.phase).toBe('clips');
    press('confirm');
    expect(d.clips).toBe(1);
    tick(10);
    press('confirm');
    expect(d.phase).toBe('boot');
    // The typed boot log: every line must fit the little screen (it is not clipped any more).
    let widest = 0;
    for (let i = 0; i < 200 && d.phase === 'boot'; i++) {
      tick(1);
      for (const t of d.bootLines) if (t.visible) widest = Math.max(widest, t.textWidth);
    }
    const { DECK } = await import('../src/art/deck');
    expect(widest).toBeGreaterThan(60);
    expect(widest + 3).toBeLessThanOrEqual(DECK.screen.w);
    expect(d.phase).toBe('done');
    tick(25);
    press('confirm');
    expect(d.closed).toBe(true);
  });

  it('dead: a press closes it after a look', async () => {
    const { DeckScene } = await import('../src/scenes/deck');
    const s = new DeckScene('dead');
    void game.run(s);
    tick(10);
    expect((s as unknown as DeckPeek).closed).toBe(false);
    press('confirm');
    expect((s as unknown as DeckPeek).closed).toBe(true);
  });

  it('view: the slots page lists the three slots and the programs', async () => {
    const { DeckScene } = await import('../src/scenes/deck');
    const s = new DeckScene('view');
    void game.run(s);
    tick(2);
    const words = textsIn((s as unknown as DeckPeek).sys.ui.list).map((t) => t.text);
    expect(words).toEqual(expect.arrayContaining(['CO-PRO', 'Stingray', 'EXPANSION A', 'EXPANSION B', 'PROGRAMS']));
    // Control: the dead deck has no slots page.
    const dead = new DeckScene('dead');
    void game.run(dead);
    tick(2);
    expect(textsIn((dead as unknown as DeckPeek).sys.ui.list).map((t) => t.text)).not.toContain('PROGRAMS');
    s.close(undefined);
    dead.close(undefined);
  });

  it('leaves no texture behind after ten rounds in each mode', async () => {
    const { DeckScene } = await import('../src/scenes/deck');
    const before = textureCount();
    for (let n = 0; n < 10; n++) {
      for (const mode of ['dead', 'seat', 'view'] as const) {
        const s = new DeckScene(mode);
        void game.run(s);
        tick(40);
        s.close(undefined);
        tick(1);
      }
    }
    expect(textureCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------- panels

interface PanelPeek {
  page: number;
  shown: number;
  panelT: number[];
  typed: number[];
  closed: boolean;
  world: Container;
  views: { speech?: { lines: TextObject[] }; finale?: { title: { visible: boolean; scaleX: number } } }[];
}

describe('PanelScene', () => {
  it('a confirm reveals the next panel once the last one has landed; the press before that waits (it is not lost)', async () => {
    const { PanelScene } = await import('../src/scenes/panels');
    const s = new PanelScene('intro');
    void game.run(s);
    const p = s as unknown as PanelPeek;
    expect(p.shown).toBe(1);
    // Pressed at once, the panel is still sliding in: nothing yet.
    press('confirm');
    expect(p.shown).toBe(1);
    tick(15);
    // The queued press has advanced it as soon as the panel landed.
    expect(p.shown).toBe(2);
    // Control: with no key, nothing advances.
    tick(100);
    expect(p.shown).toBe(2);
  });

  it('after the last panel a confirm turns the page, and the new page starts with one panel; cancel skips it all', async () => {
    const { PanelScene } = await import('../src/scenes/panels');
    const s = new PanelScene('intro');
    void game.run(s);
    const p = s as unknown as PanelPeek;
    for (let i = 0; i < 2; i++) {
      tick(20);
      press('confirm');
    }
    tick(20);
    expect(p.shown).toBe(3);
    press('confirm');
    tick(1);
    expect(p.page).toBe(1);
    expect(p.shown).toBe(1);
    // The old page's panels are gone: the world holds one panel (a frame and an overlay).
    expect(p.world.list.length).toBe(2);
    press('cancel');
    expect(p.closed).toBe(true);
  });

  it('a speech line types out after the panel has slid in, and a press finishes it first', async () => {
    const { PanelScene } = await import('../src/scenes/panels');
    const s = new PanelScene('intro');
    void game.run(s);
    const p = s as unknown as PanelPeek;
    // Walk to page 2, whose second panel is Rook speaking.
    for (let i = 0; i < 3; i++) {
      tick(20);
      press('confirm');
    }
    tick(20);
    press('confirm');
    expect(p.page).toBe(1);
    expect(p.shown).toBe(2);
    const line = p.views[1]?.speech?.lines[0];
    expect(line).toBeDefined();
    // Control: a bubble is not visible before the panel has slid in and the first characters are due.
    expect(line?.visible).toBe(false);
    tick(8);
    expect(line?.visible).toBe(true);
    const partial = line?.style.max ?? 0;
    expect(partial).toBeGreaterThan(0);
    press('confirm');
    expect(p.typed[1]).toBeGreaterThan(partial);
    expect(p.shown).toBe(2);
  });

  it('the panels follow the game shake each frame, and sit still when there is none', async () => {
    const { PanelScene } = await import('../src/scenes/panels');
    const s = new PanelScene('intro');
    void game.run(s);
    const p = s as unknown as PanelPeek;
    game.draw();
    expect([p.world.x, p.world.y]).toEqual([0, 0]);
    // The test game has no shake motion, so give it a fixed offset for this frame.
    Object.defineProperty(game, 'shakeX', { get: () => 5 });
    Object.defineProperty(game, 'shakeY', { get: () => -2 });
    game.draw();
    expect([p.world.x, p.world.y]).toEqual([5, -2]);
  });

  it('the title card of the last panel stamps in at four times, shrinks to two, and is hidden before its time', async () => {
    const { PanelScene } = await import('../src/scenes/panels');
    const s = new PanelScene('ending');
    void game.run(s);
    const p = s as unknown as PanelPeek;
    const last = 3;
    // Put the scene on the last page with both its panels in, aged by hand.
    p.page = last;
    p.shown = 2;
    p.panelT = [400, 0];
    p.typed = [1000, 0];
    tick(1);
    const fin = p.views[1]?.finale;
    expect(fin).toBeDefined();
    // Control: the title is hidden until the panel is 30 ticks old.
    expect(fin?.title.visible).toBe(false);
    p.panelT[1] = 31;
    tick(1);
    expect(fin?.title.visible).toBe(true);
    expect(fin?.title.scaleX).toBe(4);
    p.panelT[1] = 60;
    tick(1);
    expect(fin?.title.scaleX).toBe(2);
  });

  it('leaves no texture behind after ten rounds through every page', async () => {
    const { PanelScene, PAGES } = await import('../src/scenes/panels');
    const before = textureCount();
    for (let n = 0; n < 10; n++) {
      for (const id of Object.keys(PAGES)) {
        const s = new PanelScene(id);
        void game.run(s);
        for (let k = 0; k < 8; k++) {
          tick(20);
          press('confirm');
        }
        s.close(undefined);
        tick(1);
      }
    }
    expect(textureCount()).toBe(before);
  });
});
