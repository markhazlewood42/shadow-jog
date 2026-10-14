/**
 * NineSlice (UI kit, M8a): the frame it paints is the frame the old `drawWindow` paints. Both are drawn onto a recording canvas and every call is
 * compared (the shadow, the gradient, the scanlines, the outline, the trim, the brackets, the title tab, the key legend). Then the object: its picture
 * is exactly as big as everything the frame draws, its corner stays on x,y, a new size repaints, and nothing leaks.
 * Controls: a changed number in the style or the size makes the comparison fail.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawTab, drawWindow, type WindowOpts } from '../src/ui/draw';
import { NineSlice, paintTab, paintWindow, windowBounds, type WindowStyle } from '../src/sje/ui/nineslice';
import { UI_DEFAULTS } from '../src/sje/ui/params';
import { calls, fakeHost, filledRects, glyphBlits, installFakeDocument, recorder } from './sjeuikit';

vi.spyOn(console, 'warn').mockImplementation(() => undefined);

let restore: () => void;
beforeAll(() => {
  restore = installFakeDocument();
});
afterAll(() => restore());

// The old drawWindow keeps a gradient per (y, height), so each case below uses its own y and height, and the old function builds its gradient every time.
let nextY = 1000;
function both(w: number, h: number, style: WindowStyle, x = 10): { old: string[]; now: string[]; y: number } {
  const y = nextY++;
  const a = recorder();
  drawWindow(a.ctx as never, x, y, w, h, style as WindowOpts);
  const b = recorder();
  paintWindow(b.ctx, x, y, w, h, style);
  return { old: calls(a.log), now: calls(b.log), y };
}

describe('paintWindow makes the same calls as the old drawWindow', () => {
  const cases: [string, number, number, WindowStyle][] = [
    ['plain defaults', 200, 90, {}],
    ['a plain popup', 120, 50, { plain: true }],
    ['an accent color', 160, 60, { accent: '#ff4fb0' }],
    ['a title tab', 180, 70, { title: 'STATUS' }],
    ['a key legend', 300, 80, { footer: '{c}X{/} back' }],
    ['title, footer, accent and alpha together', 250, 120, { title: 'Bag', footer: 'Z ok', accent: '#62e06a', alpha: 0.8 }],
    ['narrower than the trim limit', 36, 30, {}],
    ['exactly the trim limit', 40, 30, {}],
    ['odd size', 131, 77, { plain: true, alpha: 0.5 }],
    ['the whole screen', 640, 360, {}],
  ];

  for (const [name, w, h, style] of cases) {
    it(name, () => {
      const { old, now } = both(w, h, style);
      expect(now.length).toBeGreaterThan(20);
      expect(now).toEqual(old);
    });
  }

  it('fractional positions round the way the old function rounded them', () => {
    const y = nextY++;
    const a = recorder();
    drawWindow(a.ctx as never, 10.6, y + 0.4, 100.5, 40.4, {});
    const b = recorder();
    paintWindow(b.ctx, 10.6, y + 0.4, 100.5, 40.4, {});
    expect(calls(b.log)).toEqual(calls(a.log));
  });

  it('paintTab is the old drawTab', () => {
    const a = recorder();
    drawTab(a.ctx as never, 20, 30, 'Gear', '#ff5a5a');
    const b = recorder();
    paintTab(b.ctx, 20, 30, 'Gear', '#ff5a5a');
    expect(calls(b.log)).toEqual(calls(a.log));
  });

  it('control: a different accent, alpha or size is a different log', () => {
    const base = both(160, 60, {}).now;
    expect(both(160, 60, { accent: '#ff4fb0' }).now).not.toEqual(base);
    expect(both(160, 60, { alpha: 0.5 }).now).not.toEqual(base);
    expect(both(161, 60, {}).now).not.toEqual(base);
    // And a changed number in the parameters: a wider tick step moves the trim.
    const y = nextY++;
    const r = recorder();
    paintWindow(r.ctx, 10, y, 160, 60, {}, { ...UI_DEFAULTS.window, tickStep: 20 });
    const d = recorder();
    paintWindow(d.ctx, 10, y, 160, 60, {});
    expect(calls(r.log)).not.toEqual(calls(d.log));
  });
});

describe('windowBounds: the picture is as big as what the frame draws', () => {
  const styles: [string, number, number, WindowStyle][] = [
    ['bare', 200, 90, {}],
    ['title', 180, 70, { title: 'STATUS' }],
    ['long title on a narrow window', 60, 40, { title: 'A VERY LONG WINDOW TITLE' }],
    ['footer', 300, 80, { footer: '{c}X{/} back' }],
    ['footer wider than the window', 40, 30, { footer: 'a long key legend line here' }],
    ['both', 250, 120, { title: 'Bag', footer: 'Z ok' }],
  ];

  for (const [name, w, h, style] of styles) {
    it(`${name}: every rectangle and glyph the painter draws lies inside the picture, and the picture has no empty margin`, () => {
      const b = windowBounds(w, h, style);
      const r = recorder();
      paintWindow(r.ctx, b.padL, b.padT, w, h, style);
      const boxes = [...filledRects(r.log).map(({ x, y, w: rw, h: rh }) => ({ x, y, w: rw, h: rh })), ...glyphBlits(r.log)];
      expect(boxes.length).toBeGreaterThan(20);
      const left = Math.min(...boxes.map((q) => q.x));
      const top = Math.min(...boxes.map((q) => q.y));
      const right = Math.max(...boxes.map((q) => q.x + q.w));
      const bottom = Math.max(...boxes.map((q) => q.y + q.h));
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(b.w);
      expect(bottom).toBeLessThanOrEqual(b.h);
      // Tight on the sides that matter: the window's own corner is the top-left unless a tab sticks out, and nothing is drawn past the bounds.
      expect(right).toBe(b.w);
      expect(bottom).toBe(b.h);
      expect(left).toBe(0);
      expect(top).toBe(0);
    });
  }

  it('control: bounds that ignore the tab would cut it off (the check sees a rectangle above the picture)', () => {
    const b = windowBounds(180, 70, {});
    const r = recorder();
    paintWindow(r.ctx, b.padL, b.padT, 180, 70, { title: 'STATUS' });
    expect(Math.min(...filledRects(r.log).map((q) => q.y))).toBeLessThan(0);
  });
});

describe('the NineSlice object', () => {
  const host = fakeHost();
  const keys = () => host.textures.getTextureKeys().length;

  it('keeps the window corner on x,y whatever sticks out of it', () => {
    for (const style of [{}, { title: 'STATUS' }, { footer: 'Z ok' }, { title: 'Both', footer: 'Z ok' }] as WindowStyle[]) {
      const win = new NineSlice(host, 24, 36, 150, 70, style);
      const b = windowBounds(150, 70, style);
      expect(win.width).toBe(b.w);
      expect(win.originX * win.width).toBe(b.padL);
      expect(win.originY * win.height).toBe(b.padT);
      expect([win.x, win.y]).toEqual([24, 36]);
      expect([win.boxW, win.boxH]).toEqual([150, 70]);
      win.destroy();
    }
  });

  it('paints the frame at the picture offset', () => {
    const win = new NineSlice(host, 0, 0, 150, 70, { title: 'STATUS' });
    const b = windowBounds(150, 70, { title: 'STATUS' });
    const canvas = host.textures.entryOf(win.texture.key).canvas as unknown as { log: string[] };
    const outline = filledRects(canvas.log).find((q) => q.w === 150 && q.h === 1 && q.style === '"#07060d"' && q.alpha === 1);
    expect(outline).toMatchObject({ x: b.padL, y: b.padT });
    win.destroy();
  });

  it('setSize paints the frame again for the new size: the picture grows, the old texture goes, the count stays', () => {
    const base = keys();
    const win = new NineSlice(host, 0, 0, 100, 40);
    const first = win.texture.key;
    expect(keys()).toBe(base + 1);
    win.setSize(220, 120);
    expect([win.boxW, win.boxH]).toEqual([220, 120]);
    expect(win.width).toBe(220 + UI_DEFAULTS.window.shadowOffset);
    expect(win.texture.key).not.toBe(first);
    expect(host.textures.exists(first)).toBe(false);
    expect(keys()).toBe(base + 1);
    // The new picture is the new frame.
    const canvas = host.textures.entryOf(win.texture.key).canvas as unknown as { log: string[] };
    expect(filledRects(canvas.log).some((q) => q.w === 220 && q.h === 1)).toBe(true);
    win.destroy();
    expect(keys()).toBe(base);
  });

  it('the same size or the same style repaints nothing; a new accent does', () => {
    const win = new NineSlice(host, 0, 0, 100, 40, { accent: '#ff4fb0' });
    const canvas = host.textures.entryOf(win.texture.key).canvas as unknown as { log: string[] };
    const before = canvas.log.length;
    win.setSize(100, 40);
    win.setSize(100.2, 39.8);
    win.setStyle({ accent: '#ff4fb0' });
    expect(canvas.log.length).toBe(before);
    win.setStyle({ accent: '#62e06a' });
    expect(canvas.log.length).toBeGreaterThan(before);
    expect(win.style.accent).toBe('#62e06a');
    win.destroy();
  });

  it('a title added later grows the picture and keeps the corner on x,y; taking it away puts the picture back', () => {
    const win = new NineSlice(host, 5, 9, 120, 50);
    const bare = win.height;
    win.setStyle({ title: 'MAP' });
    expect(win.height).toBeGreaterThan(bare);
    expect(win.originY * win.height).toBe(windowBounds(120, 50, { title: 'MAP' }).padT);
    win.setStyle({ title: undefined });
    expect(win.height).toBe(bare);
    win.destroy();
  });

  it('no leak: 50 resizes leave one texture, and destroy leaves none', () => {
    const base = keys();
    const win = new NineSlice(host, 0, 0, 50, 30);
    for (let i = 0; i < 50; i++) win.setSize(50 + i, 30 + (i % 7));
    expect(keys()).toBe(base + 1);
    win.destroy();
    expect(keys()).toBe(base);
  });

  it('a parameter override reaches the paint: a fainter body', () => {
    const win = new NineSlice(host, 0, 0, 100, 40, {}, { alpha: 0.5 });
    const canvas = host.textures.entryOf(win.texture.key).canvas as unknown as { log: string[] };
    expect(canvas.log).toContain('globalAlpha=0.5');
    win.destroy();
  });
});
