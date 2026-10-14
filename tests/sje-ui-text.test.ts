/**
 * TextObject (UI kit, M8a): the text it paints is what `drawText` and `drawParagraph` paint (the same calls, in the same order, onto a recording
 * canvas), its picture is sized to fit, it repaints only when something changed, and it leaves no texture behind.
 * Each check has a control: the comparison is made to fail on purpose (a wrong offset, a wrong style) and the test says so.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawParagraph, drawText, GLYPH_H, LINE_H, measure } from '../src/sje/display/font';
import { layoutText, paintText, TextObject } from '../src/sje/ui/textobject';
import { calls, canvases, fakeHost, installFakeDocument, recorder } from './sjeuikit';

vi.spyOn(console, 'warn').mockImplementation(() => undefined);

let restore: () => void;
beforeAll(() => {
  restore = installFakeDocument();
  // Build the font atlas and the tinted copies once, so the canvases they make do not count in the tests below.
  const r = recorder();
  for (const color of ['#f4f1ff', '#3fe0f0', '#ff5a5a']) drawText(r.ctx, 'Aa', 0, 0, { color });
});
afterAll(() => restore());

/** The log of the font's own call, for the same text at the same place. */
function oldDraw(text: string, x: number, y: number, opts: Parameters<typeof drawText>[4] = {}): string[] {
  const r = recorder();
  drawText(r.ctx, text, x, y, opts);
  return calls(r.log);
}
function newDraw(text: string, style: Parameters<typeof layoutText>[1], x: number, y: number): string[] {
  const r = recorder();
  const lay = layoutText(text, style);
  // The object sits with its anchor at (x, y), so the picture's left edge is at x - ax: move every glyph the layout draws by that.
  const dx = x - lay.ax;
  const shifted = new Proxy(r.ctx as unknown as Record<string, unknown>, {
    get: (t, name) => {
      if (name !== 'drawImage') return t[name as string];
      return (...a: number[]) => (t.drawImage as (...b: unknown[]) => void)(a[0], a[1], a[2], a[3], a[4], (a[5] ?? 0) + dx, (a[6] ?? 0) + y, a[7], a[8]);
    },
  }) as unknown as CanvasRenderingContext2D;
  paintText(shifted, lay, style);
  return calls(r.log);
}

describe('layoutText: the picture is the size of the text, and the anchor is inside it', () => {
  it('a left-aligned line: width is the measure plus one pixel of shadow, height is a glyph row plus one, the anchor is at the left edge', () => {
    const lay = layoutText('Hello');
    expect(lay.w).toBe(measure('Hello') + 1);
    expect(lay.h).toBe(GLYPH_H + 1);
    expect(lay.ax).toBe(0);
  });

  it('no shadow: one pixel narrower and shorter', () => {
    const lay = layoutText('Hello', { shadow: false });
    expect(lay.w).toBe(measure('Hello'));
    expect(lay.h).toBe(GLYPH_H);
  });

  it('center puts the anchor floor(width / 2) from the left (the rule of drawText); right puts it at the end of the letters', () => {
    const w = measure('Centered');
    expect(layoutText('Centered', { align: 'center' }).ax).toBe(Math.floor(w / 2));
    expect(layoutText('Centered', { align: 'right' }).ax).toBe(w);
    // An odd width is where floor and round differ.
    expect(measure('Odd')).toBeGreaterThan(0);
    expect(layoutText('Odd', { align: 'center' }).ax).toBe(Math.floor(measure('Odd') / 2));
  });

  it('wrapped text is as high as its lines and as wide as its widest line', () => {
    const lay = layoutText('one two three four five six seven eight nine ten', { wrapWidth: 60 });
    expect(lay.lines.length).toBeGreaterThan(2);
    expect(lay.h).toBe((lay.lines.length - 1) * LINE_H + GLYPH_H + 1);
    expect(lay.w).toBe(Math.max(...lay.widths) + 1);
    expect(Math.max(...lay.widths)).toBeLessThanOrEqual(60);
  });

  it('empty text is a one-pixel picture, not a zero-size canvas', () => {
    const lay = layoutText('');
    expect(lay.w).toBeGreaterThanOrEqual(1);
    expect(lay.h).toBeGreaterThanOrEqual(1);
  });

  it('centered wrapped lines of different widths all fit: the picture reaches left of the anchor by half the widest line', () => {
    const lay = layoutText('short words and a much longer last line here', { wrapWidth: 70, align: 'center' });
    for (let i = 0; i < lay.lines.length; i++) {
      expect(lay.xs[i]).toBeGreaterThanOrEqual(0);
      expect((lay.xs[i] ?? 0) + (lay.widths[i] ?? 0) + 1).toBeLessThanOrEqual(lay.w);
    }
  });
});

describe('paintText draws exactly what drawText draws', () => {
  const cases: [string, Parameters<typeof layoutText>[1]][] = [
    ['Menu', {}],
    ['Colored {c}cyan{/} text', { color: '#ff5a5a' }],
    ['Right edge', { align: 'right' }],
    ['Middle of the line', { align: 'center' }],
    ['No shadow here', { shadow: false }],
    ['A dark shadow', { shadow: '#123456' }],
    ['Typewriter reveal', { max: 6 }],
    ['', {}],
  ];

  for (const [text, style] of cases) {
    it(`"${text}" ${JSON.stringify(style)}`, () => {
      const old = oldDraw(text, 40, 7, { ...(style?.align ? { align: style.align } : {}), ...(style?.color ? { color: style.color } : {}), ...(style?.shadow !== undefined ? { shadow: style.shadow } : {}), ...(style?.max !== undefined ? { max: style.max } : {}) });
      const now = newDraw(text, style, 40, 7);
      expect(now).toEqual(old);
    });
  }

  it('control: a one-pixel offset is caught by the comparison', () => {
    expect(newDraw('Menu', {}, 41, 7)).not.toEqual(oldDraw('Menu', 40, 7));
    expect(newDraw('Menu', { color: '#ff5a5a' }, 40, 7)).not.toEqual(oldDraw('Menu', 40, 7));
  });

  it('wrapped text draws what drawParagraph draws, line by line, with the typewriter count carried across the lines', () => {
    const text = 'The Annex was built to keep things in, not out, and whoever opened that door knew exactly what was behind it.';
    for (const max of [undefined, 15, 40, 0]) {
      const r = recorder();
      drawParagraph(r.ctx, text, 12, 30, 90, { ...(max !== undefined ? { max } : {}) });
      const now = newDraw(text, { wrapWidth: 90, ...(max !== undefined ? { max } : {}) }, 12, 30);
      // drawParagraph draws line i at y + i * 10; newDraw draws it at y + i * 10 too (the anchor row is 30).
      expect(now).toEqual(calls(r.log));
    }
  });

  it('a centered paragraph centers each line on the anchor, as drawParagraph with align center does', () => {
    const text = 'a short line and then another longer line that wraps';
    const r = recorder();
    drawParagraph(r.ctx, text, 100, 4, 70, { align: 'center' });
    expect(newDraw(text, { wrapWidth: 70, align: 'center' }, 100, 4)).toEqual(calls(r.log));
  });
});

describe('the TextObject', () => {
  const host = fakeHost();
  const keys = () => host.textures.getTextureKeys().length;

  it('shows a canvas of the layout size, with the anchor on a whole pixel', () => {
    const t = new TextObject(host, 20, 30, 'Status', { align: 'center' });
    const lay = layoutText('Status', { align: 'center' });
    expect(t.width).toBe(lay.w);
    expect(t.height).toBe(lay.h);
    expect(t.originX * t.width).toBe(lay.ax);
    expect(t.originY).toBe(0);
    expect([t.x, t.y]).toEqual([20, 30]);
    t.destroy();
  });

  it('paints the text into its own canvas, as drawText paints it', () => {
    const t = new TextObject(host, 0, 0, 'Hello {c}there{/}', { color: '#3fe0f0' });
    const canvas = host.textures.entryOf(t.texture.key).canvas as unknown as { log: string[] };
    const mine = calls(canvas.log).filter((l) => l.startsWith('drawImage('));
    const old = oldDraw('Hello {c}there{/}', 0, 0, { color: '#3fe0f0' }).filter((l) => l.startsWith('drawImage('));
    expect(mine).toEqual(old);
    t.destroy();
  });

  it('the same string and style again repaints nothing', () => {
    const t = new TextObject(host, 0, 0, 'Same', { color: '#3fe0f0' });
    const canvas = host.textures.entryOf(t.texture.key).canvas as unknown as { log: string[] };
    const before = canvas.log.length;
    t.setText('Same');
    t.setStyle({ color: '#3fe0f0' });
    t.setStyle({ align: 'left' });
    expect(canvas.log.length).toBe(before);
    // Control: a different color (the same size, so the same canvas) does repaint.
    t.setStyle({ color: '#ff5a5a' });
    expect(canvas.log.length).toBeGreaterThan(before);
    t.destroy();
  });

  it('a string of the same size reuses the canvas (the typewriter: the size is of the full string, so it never changes)', () => {
    const t = new TextObject(host, 0, 0, 'Typewriter line', { max: 0 });
    const key = t.texture.key;
    const canvasCount = canvases.length;
    for (let n = 1; n <= 15; n++) t.setStyle({ max: n });
    expect(t.texture.key).toBe(key);
    expect(canvases.length).toBe(canvasCount);
    t.destroy();
  });

  it('a string of another size takes a new canvas and gives the old one back: the texture count does not grow', () => {
    const base = keys();
    const t = new TextObject(host, 0, 0, 'ab');
    expect(keys()).toBe(base + 1);
    const first = t.texture.key;
    t.setText('a much longer string than before');
    expect(t.texture.key).not.toBe(first);
    expect(host.textures.exists(first)).toBe(false);
    expect(keys()).toBe(base + 1);
    expect(t.width).toBe(measure('a much longer string than before') + 1);
    t.destroy();
    expect(keys()).toBe(base);
  });

  it('no leak: 200 changes of the string leave one texture, and destroy leaves none', () => {
    const base = keys();
    const t = new TextObject(host, 0, 0, '');
    for (let i = 0; i < 200; i++) t.setText('x'.repeat(i % 17));
    expect(keys()).toBe(base + 1);
    t.destroy();
    expect(keys()).toBe(base);
  });

  it('control: a texture that is made and not freed raises the count (the leak check can see a leak)', () => {
    const base = keys();
    host.textures.createCanvas('leaky-text', 3, 3);
    expect(keys()).toBe(base + 1);
    host.textures.remove('leaky-text');
  });

  it('textWidth and lines report the laid-out text', () => {
    const t = new TextObject(host, 0, 0, 'one two three four five six seven', { wrapWidth: 50 });
    expect(t.lines.length).toBeGreaterThan(1);
    expect(t.textWidth).toBeLessThanOrEqual(50);
    t.setStyle({ wrapWidth: undefined });
    expect(t.lines).toEqual(['one two three four five six seven']);
    t.destroy();
  });

  it('a destroyed text refuses setText with a message that names it', () => {
    const t = new TextObject(host, 0, 0, 'gone');
    t.destroy();
    expect(() => t.setText('again')).toThrow(/destroyed/);
  });
});
