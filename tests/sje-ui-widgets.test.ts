/**
 * Bar, Cursor, the palette and the helpers (UI kit, M8a): each is compared with the old function of `src/ui/draw.ts` it replaces, on a recording canvas,
 * for a spread of inputs. Controls: a changed color, ratio or frame makes the comparison fail.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawBar, drawCursor, drawMore, hpColor as oldHpColor, keyLegend as oldKeyLegend, OVERLAY_DIM as OLD_DIM, UI as OLD_UI } from '../src/ui/draw';
import { Bar, barRects } from '../src/sje/ui/bar';
import { Cursor, cursorNudge, moreVisible } from '../src/sje/ui/cursor';
import { hpColor, keyLegend, OVERLAY_DIM, SELECT_FILL, UI, UI_DEFAULTS } from '../src/sje/ui/params';
import { Graphics } from '../src/sje/display/graphics';
import { fakeHost, filledRects, glyphBlits, installFakeDocument, recorder } from './sjeuikit';

vi.spyOn(console, 'warn').mockImplementation(() => undefined);

let restore: () => void;
beforeAll(() => {
  restore = installFakeDocument();
});
afterAll(() => restore());

describe('the palette and the small helpers are the old ones', () => {
  it('UI and OVERLAY_DIM hold the old values, key for key', () => {
    expect(UI).toEqual(OLD_UI);
    expect(OVERLAY_DIM).toBe(OLD_DIM);
  });

  it('control: a changed color is not equal', () => {
    expect({ ...UI, cyan: '#000000' }).not.toEqual(OLD_UI);
  });

  it('SELECT_FILL is UI.select as a number and an alpha', () => {
    expect(UI.select).toBe(`rgba(${(SELECT_FILL.color >> 16) & 255},${(SELECT_FILL.color >> 8) & 255},${SELECT_FILL.color & 255},${SELECT_FILL.alpha})`);
  });

  it('hpColor gives the old color at every tenth, and at the edges', () => {
    for (const r of [0, 0.1, 0.2, 0.25, 0.26, 0.3, 0.5, 0.51, 0.7, 1, 1.5]) expect(hpColor(r)).toBe(oldHpColor(r));
  });

  it('keyLegend builds the old text, with and without a confirm label', () => {
    const keys = { keyName: (a: string) => ({ confirm: 'Z', cancel: 'X' })[a] ?? a };
    expect(keyLegend(keys)).toBe(oldKeyLegend(keys as never));
    expect(keyLegend(keys, 'close', 'choose')).toBe(oldKeyLegend(keys as never, 'close', 'choose'));
    expect(keyLegend(keys, 'close', 'choose')).toBe('{c}Z{/} choose   {c}X{/} close');
  });

  it('the defaults are frozen, so a copy is the way to change one', () => {
    expect(Object.isFrozen(UI_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(UI_DEFAULTS.window)).toBe(true);
    expect(() => {
      (UI_DEFAULTS.window as { alpha: number }).alpha = 0.1;
    }).toThrow();
  });
});

describe('Bar paints the rectangles the old drawBar fills', () => {
  const sizes: [number, number][] = [
    [90, 3],
    [40, 2],
    [1, 1],
    [200, 6],
  ];
  const ratios = [0, 0.001, 0.25, 0.5, 0.999, 1, 1.7, -0.3];

  for (const [w, h] of sizes) {
    it(`${w}x${h} at every ratio, with its own color and with a custom back`, () => {
      for (const ratio of ratios) {
        for (const back of [undefined, '#112233']) {
          const r = recorder();
          drawBar(r.ctx as never, 30, 40, w, h, ratio, UI.green, back);
          const old = filledRects(r.log).map((q) => ({ x: q.x - 30, y: q.y - 40, w: q.w, h: q.h, color: JSON.parse(q.style) as string, alpha: q.alpha }));
          const now = barRects(w, h, ratio, UI.green, back ? { ...UI_DEFAULTS.bar, back } : UI_DEFAULTS.bar);
          expect(now, `ratio ${ratio}`).toEqual(old);
        }
      }
    });
  }

  it('control: another ratio or color is a different list', () => {
    expect(barRects(90, 3, 0.5, UI.green)).not.toEqual(barRects(90, 3, 0.6, UI.green));
    expect(barRects(90, 3, 0.5, UI.green)).not.toEqual(barRects(90, 3, 0.5, UI.red));
    expect(barRects(90, 3, 0, UI.green)).toHaveLength(2);
    expect(barRects(90, 3, 1, UI.green)).toHaveLength(4);
  });

  it('the object clamps the ratio, repaints only when something changed, and frees what it made', () => {
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    const bar = new Bar(fakeHost(), 10, 20, 90, 3, UI.cyan, 0.5);
    const painted = clear.mock.calls.length;
    bar.setRatio(0.5);
    bar.setColor(UI.cyan);
    bar.setSize(90, 3);
    expect(clear.mock.calls.length).toBe(painted);
    bar.setRatio(3);
    expect(bar.ratio).toBe(1);
    expect(clear.mock.calls.length).toBe(painted + 1);
    bar.setRatio(-2);
    expect(bar.ratio).toBe(0);
    bar.setColor(UI.red);
    bar.setSize(50, 4);
    expect(clear.mock.calls.length).toBe(painted + 4);
    expect([bar.x, bar.y]).toEqual([10, 20]);
    bar.destroy();
    expect(bar.destroyed).toBe(true);
    clear.mockRestore();
  });
});

describe('Cursor moves and blinks as the old drawCursor and drawMore did', () => {
  it('the chevron is nudged by the old sine at every frame of two seconds', () => {
    for (let f = 0; f < 120; f++) {
      const r = recorder();
      drawCursor(r.ctx as never, 20, 8, f);
      const blits = glyphBlits(r.log);
      // The shadow is drawn first, one pixel right and down; the glyph last.
      const glyph = blits[blits.length - 1];
      expect(glyph?.x, `frame ${f}`).toBe(20 + cursorNudge(f));
      expect(glyph?.y).toBe(8);
    }
    // Control: the nudge is not constant, and moves both ways.
    const seen = new Set(Array.from({ length: 120 }, (_, f) => cursorNudge(f)));
    expect(seen.size).toBeGreaterThan(2);
  });

  it('the more arrow shows exactly when the old drawMore drew it', () => {
    for (let f = 0; f < 200; f++) {
      const r = recorder();
      drawMore(r.ctx as never, 5, 5, f);
      expect(moreVisible(f), `frame ${f}`).toBe(glyphBlits(r.log).length > 0);
    }
    expect(moreVisible(0)).toBe(true);
    expect(moreVisible(20)).toBe(false);
    expect(moreVisible(40)).toBe(true);
  });

  it('the object keeps its home place, adds the nudge, and takes a new home', () => {
    const host = fakeHost();
    const c = new Cursor(host, 20, 8);
    expect(c.text).toBe('▶');
    for (const f of [0, 5, 9, 17, 33, 90]) {
      c.setFrame(f);
      expect([c.x, c.y], `frame ${f}`).toEqual([20 + cursorNudge(f), 8]);
    }
    c.setHome(50, 30);
    expect(c.y).toBe(30);
    expect(c.x).toBe(50 + cursorNudge(90));
    c.destroy();
  });

  it('the more arrow blinks by visibility and does not move', () => {
    const c = new Cursor(fakeHost(), 5, 5, 'more');
    expect(c.text).toBe('▼');
    for (let f = 0; f < 100; f++) {
      c.setFrame(f);
      expect(c.visible, `frame ${f}`).toBe(moreVisible(f));
      expect([c.x, c.y]).toEqual([5, 5]);
    }
    c.destroy();
  });

  it('a parameter override reaches the rule: a slower blink, a wider nudge', () => {
    expect(moreVisible(20, { ...UI_DEFAULTS.cursor, blinkFrames: 40 })).toBe(true);
    expect(moreVisible(20)).toBe(false);
    const wide = { ...UI_DEFAULTS.cursor, nudge: 5 };
    expect(Math.max(...Array.from({ length: 60 }, (_, f) => cursorNudge(f, wide)))).toBe(5);
  });
});
