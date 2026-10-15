/**
 * ListMenu (UI kit, M8a): the cursor, the scroll window, the wrap, the locked rows, the sounds and the highlight ease behave as the old
 * `ListMenu` of `src/ui/list.ts`, and the rows it shows are where the old `render` drew them.
 *
 * The parity test runs the OLD list and the new one on the same random script of key presses (seeded, so it is the same on every run) and
 * compares, after every tick: the result, the cursor, the scroll, the sounds, every text the old `render` drew (what, where, in which color
 * and alignment), and the highlight rectangle. Controls: a list with one changed number (a row height) fails the same comparison.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/sje/runtime/inputdevice';
import { ListMenu as OldList } from '../src/ui/list';
import { ListMenu, type ListAction, type ListInput, type ListItem, listRows, scrollFor, stepIndex, type UiSound } from '../src/sje/ui/listmenu';
import { TEXT } from '../src/sje/display/font';
import { TextObject } from '../src/sje/ui/textobject';
import { UI } from '../src/sje/ui/params';
import { fakeHost, installFakeDocument, recorder, seeded } from './sjeuikit';

// The old list plays its sounds through sfx() and draws through the engine font: both are recorded here.
const sounds: string[] = [];
vi.mock('../src/audio/sfx', () => ({ sfx: (name: string) => void sounds.push(name) }));
interface TextCall {
  text: string;
  x: number;
  y: number;
  align: string;
  color: string | undefined;
}
const drawn: TextCall[] = [];
vi.mock('../src/sje/display/font', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sje/display/font')>();
  return {
    ...real,
    drawText: (ctx: never, text: string, x: number, y: number, opts: NonNullable<Parameters<typeof real.drawText>[4]> = {}) => {
      drawn.push({ text, x, y, align: opts.align ?? 'left', color: opts.color });
      return real.drawText(ctx, text, x, y, opts);
    },
  };
});

vi.spyOn(console, 'warn').mockImplementation(() => undefined);

let restore: () => void;
beforeAll(() => {
  restore = installFakeDocument();
});
afterAll(() => restore());
beforeEach(() => {
  sounds.length = 0;
  drawn.length = 0;
});

/** One action "pressed" (and repeating) for one update, as in tests/ui-list.test.ts. */
type Press = ListAction | null;
const oldInput = (a: Press): Input => ({ pressed: (x: string) => x === a, repeat: (x: string) => x === a, down: () => false }) as unknown as Input;
const newInput = (a: Press): ListInput => ({ justPressed: (x) => x === a, repeat: (x) => x === a });

const items = (n: number): ListItem<number>[] => Array.from({ length: n }, (_, i) => ({ label: `Row ${i}`, value: i }));

/** A list with every kind of row: plain, right-hand text, icon, locked with a reason, a long label, a custom color. */
function mixed(n: number): ListItem<number>[] {
  return Array.from({ length: n }, (_, i) => {
    const it: ListItem<number> = { label: `Item number ${i}`, value: i };
    if (i % 3 === 1) it.right = `x${i * 7}`;
    if (i % 4 === 2) {
      it.icon = '*';
      it.iconColor = UI.pink;
    }
    if (i % 5 === 3) {
      it.enabled = false;
      it.why = `Locked ${i}`;
    }
    if (i === 6) it.label = 'A label so long that it has to be cut with an ellipsis before the right text';
    if (i === 6) it.right = '1,200g';
    if (i % 7 === 4) it.color = UI.amber;
    return it;
  });
}

const sceneOf = (menu: ListMenu<number>): { text: string; x: number; y: number; align: string; color: string | undefined }[] =>
  menu.list
    .filter((c): c is TextObject => c instanceof TextObject && c.visible && c.text !== '' && c.style.align !== 'center')
    .map((t) => ({ text: t.text, x: t.x, y: t.y, align: t.style.align ?? 'left', color: t.style.color ?? TEXT }));

const key = (t: { text: string; x: number; y: number; align: string; color: string | undefined }): string => `${t.text}|${t.x}|${t.y}|${t.align}|${t.color}`;

/** The rectangle the old render filled for the selection (a fillRect in the select color), or null. */
function oldHighlight(log: string[]): { x: number; y: number; w: number; h: number } | null {
  for (let i = 0; i < log.length; i++) {
    if (log[i] === `fillStyle=${JSON.stringify(UI.select)}`) {
      const m = /^fillRect\((.*)\)$/.exec(log[i + 1] ?? '');
      if (m?.[1]) {
        const n = m[1].split(',').map(Number);
        return { x: n[0] ?? 0, y: n[1] ?? 0, w: n[2] ?? 0, h: n[3] ?? 0 };
      }
    }
  }
  return null;
}

interface Config {
  name: string;
  n: number;
  rows: number;
  cols: number;
  width: number;
  list: (n: number) => ListItem<number>[];
  empty?: string;
}
const CONFIGS: Config[] = [
  { name: 'a plain column of 12, 5 rows', n: 12, rows: 5, cols: 1, width: 180, list: items },
  { name: 'a mixed column of 14, 6 rows', n: 14, rows: 6, cols: 1, width: 220, list: mixed },
  { name: 'a short list that fits', n: 3, rows: 6, cols: 1, width: 120, list: mixed },
  { name: 'a grid of 11 in 3 columns, 3 rows', n: 11, rows: 3, cols: 3, width: 240, list: mixed },
  { name: 'a grid of 8 in 2 columns, 2 rows', n: 8, rows: 2, cols: 2, width: 200, list: items },
  { name: 'an empty list with a message', n: 0, rows: 4, cols: 1, width: 150, list: items, empty: 'Nothing here.' },
];

describe('the cursor and the scroll window: the same rules as the old list', () => {
  it('stepIndex: wraps in one column, stops at the edges of a grid, ignores left and right in one column', () => {
    expect(stepIndex(0, 5, 1, 'up')).toBe(4);
    expect(stepIndex(4, 5, 1, 'down')).toBe(0);
    expect(stepIndex(2, 5, 1, 'left')).toBe(2);
    expect(stepIndex(2, 5, 1, 'right')).toBe(2);
    expect(stepIndex(1, 9, 3, 'up')).toBe(1);
    expect(stepIndex(7, 9, 3, 'down')).toBe(7);
    expect(stepIndex(4, 9, 3, 'up')).toBe(1);
    expect(stepIndex(0, 9, 3, 'left')).toBe(0);
    expect(stepIndex(8, 9, 3, 'right')).toBe(8);
    expect(stepIndex(0, 0, 1, 'down')).toBe(0);
  });

  it('scrollFor: the window follows the cursor down and up, and never leaves rows hidden above a short list', () => {
    expect(scrollFor(6, 0, 4, 1, 10)).toBe(3);
    expect(scrollFor(2, 3, 4, 1, 10)).toBe(2);
    expect(scrollFor(2, 7, 4, 1, 3)).toBe(0);
    expect(scrollFor(8, 0, 2, 3, 11)).toBe(1);
  });

  it('wraps from the top to the bottom and back (the old test)', () => {
    const m = new ListMenu(fakeHost(), 0, 0, items(5), { rows: 3 });
    expect(m.update(newInput('up'))).toBe('move');
    expect(m.index).toBe(4);
    expect(m.update(newInput('down'))).toBe('move');
    expect(m.index).toBe(0);
  });

  it('scrolls to keep the cursor inside the visible rows (the old test)', () => {
    const m = new ListMenu(fakeHost(), 0, 0, items(10), { rows: 4 });
    for (let i = 0; i < 6; i++) m.update(newInput('down'));
    expect(m.index).toBe(6);
    expect(m.scroll).toBe(3);
    for (let i = 0; i < 4; i++) m.update(newInput('up'));
    expect(m.index).toBe(2);
    expect(m.scroll).toBe(2);
  });

  it('a locked row says why while it is selected, and only then (the old test)', () => {
    const m = new ListMenu<string>(
      fakeHost(),
      0,
      0,
      [
        { label: 'New', value: 'new' },
        { label: 'Load', value: 'load', enabled: false, why: 'No saved games yet.' },
      ],
      { rows: 3 },
    );
    expect(m.why).toBeUndefined();
    m.update(newInput('down'));
    expect(m.why).toBe('No saved games yet.');
    expect(m.update(newInput('confirm'))).toBe('blocked');
    m.update(newInput('up'));
    expect(m.why).toBeUndefined();
  });

  it('refuses to confirm a disabled row, and an empty list answers only cancel (the old tests)', () => {
    const locked = new ListMenu<string>(fakeHost(), 0, 0, [{ label: 'Save', value: 'save', enabled: false }]);
    expect(locked.update(newInput('confirm'))).toBe('blocked');
    const empty = new ListMenu<number>(fakeHost(), 0, 0, []);
    expect(empty.update(newInput('down'))).toBe(null);
    expect(empty.update(newInput('confirm'))).toBe(null);
    expect(empty.update(newInput('cancel'))).toBe('cancel');
    expect(empty.current).toBeUndefined();
  });

  it('clamps the cursor when the list shrinks (the old test)', () => {
    const m = new ListMenu(fakeHost(), 0, 0, items(8), { rows: 4 });
    for (let i = 0; i < 7; i++) m.update(newInput('down'));
    m.setItems(items(3));
    expect(m.index).toBe(2);
    expect(m.scroll).toBe(0);
  });

  it('update with no input only animates: nothing moves, nothing is answered', () => {
    const m = new ListMenu(fakeHost(), 0, 0, items(5));
    expect(m.update()).toBe(null);
    expect(m.index).toBe(0);
  });
});

describe('parity with the old ListMenu on a random script', () => {
  const actions: Press[] = ['up', 'down', 'left', 'right', 'confirm', 'cancel', null, null, 'down', 'down'];

  for (const cfg of CONFIGS) {
    for (const focused of [true, false]) {
      it(`${cfg.name}${focused ? '' : ', not focused'}`, () => {
        const host = fakeHost();
        const heard: UiSound[] = [];
        const next = seeded(cfg.n * 31 + cfg.cols * 7 + (focused ? 1 : 2));
        const old = new OldList<number>(cfg.list(cfg.n), cfg.rows, cfg.cols);
        const now = new ListMenu<number>(host, 0, 0, cfg.list(cfg.n), { rows: cfg.rows, cols: cfg.cols, width: cfg.width, onSound: (s) => heard.push(s) });
        if (cfg.empty) now.empty = cfg.empty;
        now.focused = focused;
        const ctx = recorder();
        let compared = 0;
        for (let tick = 0; tick < 160; tick++) {
          const a = actions[Math.floor(next() * actions.length)] ?? null;
          sounds.length = 0;
          heard.length = 0;
          drawn.length = 0;
          ctx.log.length = 0;
          const r1 = old.update(oldInput(a));
          old.render(ctx.ctx as never, 0, 0, cfg.width, focused, cfg.empty);
          const r2 = now.update(newInput(a));
          // What the old list drew, and what the new one shows.
          expect(r2, `tick ${tick} ${a}`).toBe(r1);
          expect(now.index, `tick ${tick} index`).toBe(old.index);
          expect(now.scroll, `tick ${tick} scroll`).toBe(old.scroll);
          expect(heard, `tick ${tick} sounds`).toEqual(sounds);
          expect(sceneOf(now).map(key).sort(), `tick ${tick} texts`).toEqual(drawn.map(key).sort());
          expect(now.highlightRect, `tick ${tick} highlight`).toEqual(oldHighlight(ctx.log));
          compared += drawn.length;
          // A tool that edits the list mid-run (the shop refills its rows): the same new items on both.
          if (tick % 53 === 52) {
            const fewer = cfg.list(Math.max(0, cfg.n - 4));
            old.setItems(fewer);
            now.setItems(fewer);
          }
        }
        expect(compared).toBeGreaterThan(cfg.n === 0 && !cfg.empty ? -1 : 0);
      });
    }
  }

  it('control: a list built with a different row height does not match the old one', () => {
    const old = new OldList<number>(items(8), 4, 1);
    const now = new ListMenu<number>(fakeHost(), 0, 0, items(8), { rows: 4, rowH: 12, width: 150 });
    const ctx = recorder();
    old.update(oldInput('down'));
    drawn.length = 0;
    old.render(ctx.ctx as never, 0, 0, 150, true);
    now.update(newInput('down'));
    expect(sceneOf(now).map(key).sort()).not.toEqual(drawn.map(key).sort());
  });

  it('control: a different locked-row reason shows as a different text', () => {
    const a = new ListMenu<number>(fakeHost(), 0, 0, mixed(6), { rows: 6 });
    const b = new ListMenu<number>(fakeHost(), 0, 0, mixed(6), { rows: 6 });
    b.setItems(mixed(6).map((it) => ({ ...it, why: 'other' })));
    for (let i = 0; i < 3; i++) {
      a.update(newInput('down'));
      b.update(newInput('down'));
    }
    expect(a.why).toBe('Locked 3');
    expect(b.why).toBe('other');
  });
});

describe('the why line, the sounds and the settings', () => {
  it('shows the reason of the selected locked row, centered at the anchor, in amber for a moment after a press and dim afterwards', () => {
    const m = new ListMenu<number>(fakeHost(), 10, 20, mixed(6), { rows: 6, width: 200, buzzFrames: 24 });
    m.setWhyAt(100, 80);
    const whyOf = () => m.list.find((c): c is TextObject => c instanceof TextObject && c.style.align === 'center');
    expect(whyOf()?.visible).toBe(false);
    for (let i = 0; i < 3; i++) m.update(newInput('down'));
    expect(m.why).toBe('Locked 3');
    expect(whyOf()?.visible).toBe(true);
    expect(whyOf()?.text).toBe('Locked 3');
    expect([whyOf()?.x, whyOf()?.y]).toEqual([100, 80]);
    expect(whyOf()?.style.color).toBe(UI.dim);
    expect(m.update(newInput('confirm'))).toBe('blocked');
    // The old rule: amber while (buzzT >> 2) is even, so the first frames flash.
    const colors = new Set<string | undefined>();
    for (let i = 0; i < 30; i++) {
      m.update();
      colors.add(whyOf()?.style.color);
    }
    expect(colors).toEqual(new Set([UI.amber, UI.dim]));
    // And it ends dim.
    expect(whyOf()?.style.color).toBe(UI.dim);
  });

  it('plays cursor, confirm and cancel sounds when sounds is on; a refused press buzzes even when it is off', () => {
    const heard: UiSound[] = [];
    const m = new ListMenu<number>(fakeHost(), 0, 0, mixed(5), { rows: 5, onSound: (s) => heard.push(s) });
    m.update(newInput('down'));
    m.update(newInput('confirm'));
    m.update(newInput('cancel'));
    expect(heard).toEqual(['cursor', 'confirm', 'cancel']);
    heard.length = 0;
    m.sounds = false;
    // The cursor is on row 1; row 3 is the locked one.
    m.update(newInput('down'));
    m.update(newInput('down'));
    expect(m.current?.enabled).toBe(false);
    m.update(newInput('confirm'));
    expect(heard).toEqual(['buzz']);
  });

  it('works with no sound handler at all', () => {
    const m = new ListMenu<number>(fakeHost(), 0, 0, items(3));
    expect(() => {
      m.update(newInput('down'));
      m.update(newInput('confirm'));
    }).not.toThrow();
  });

  it('rows, cols, rowH and width can be set at any time and the rows follow at once', () => {
    const m = new ListMenu<number>(fakeHost(), 0, 0, items(10), { rows: 3, width: 100 });
    const labels = () => sceneOf(m).filter((t) => t.text.startsWith('Row'));
    expect(labels()).toHaveLength(3);
    m.rows = 6;
    expect(labels()).toHaveLength(6);
    expect(labels().map((t) => t.y)).toEqual([0, 11, 22, 33, 44, 55]);
    m.rowH = 14;
    expect(labels().map((t) => t.y)).toEqual([0, 14, 28, 42, 56, 70]);
    m.cols = 2;
    expect(labels()).toHaveLength(10);
    m.cols = 1;
    m.index = 9;
    expect(m.scroll).toBe(4);
    m.scroll = 0;
    // The window cannot be set to a place where the cursor is out of view.
    expect(m.scroll).toBe(4);
  });

  it('the first row of the window is the first row shown: scrolling by hand moves the rows', () => {
    const m = new ListMenu<number>(fakeHost(), 0, 0, items(10), { rows: 3, width: 100 });
    m.index = 5;
    expect(sceneOf(m).filter((t) => t.text.startsWith('Row')).map((t) => t.text)).toEqual(['Row 3', 'Row 4', 'Row 5']);
  });

  it('shows the empty message in place of rows, and the scroll arrows only when there is more above or below', () => {
    const m = new ListMenu<number>(fakeHost(), 0, 0, [], { rows: 3, width: 100 });
    m.empty = 'Nothing.';
    expect(sceneOf(m)).toEqual([expect.objectContaining({ text: 'Nothing.', x: 4, y: 0 })]);
    m.setItems(items(10));
    expect(sceneOf(m).map((t) => t.text)).not.toContain('Nothing.');
    const arrows = () => sceneOf(m).filter((t) => t.text === '▲' || t.text === '▼').map((t) => t.text);
    expect(arrows()).toEqual(['▼']);
    m.index = 5;
    expect(arrows().sort()).toEqual(['▲', '▼']);
    m.index = 9;
    expect(arrows()).toEqual(['▲']);
  });

  it('listRows gives each visible row its place: label after the cursor room and the icon, right text ending six pixels from the column edge', () => {
    const g = listRows(mixed(8), 0, 4, 1, 11, 200);
    expect(g).toHaveLength(4);
    expect(g[0]).toMatchObject({ i: 0, rx: 0, ry: 0, labelX: 9, rightX: 194, colW: 200 });
    expect(g[2]?.labelX).toBeGreaterThan(9);
    expect(g[1]?.room).toBeLessThan(g[0]?.room ?? 0);
    expect(listRows(items(7), 1, 2, 3, 11, 90).map((r) => [r.rx, r.ry])).toEqual([[0, 0], [30, 0], [60, 0], [0, 11]]);
  });
});
