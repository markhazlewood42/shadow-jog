import { describe, expect, it } from 'vitest';
import { formatJson } from '../src/tools/jsonfmt';
import { changedLines } from '../src/tools/linediff';
import { UNDO_LIMIT, UndoStack } from '../src/tools/undo';

describe('the shared undo stack', () => {
  it('goes back one step at a time and forward again', () => {
    const u = new UndoStack();
    u.record('a');
    u.record('b');
    expect(u.undo('c')).toBe('b');
    expect(u.undo('b')).toBe('a');
    expect(u.undo('a')).toBeNull();
    expect(u.redo('a')).toBe('b');
    expect(u.redo('b')).toBe('c');
    expect(u.redo('c')).toBeNull();
  });

  it('a new change ends the redo history', () => {
    const u = new UndoStack();
    u.record('a');
    u.undo('b');
    expect(u.canRedo).toBe(true);
    u.record('a');
    expect(u.canRedo).toBe(false);
  });

  it('keeps 100 steps and forgets the oldest', () => {
    expect(UNDO_LIMIT).toBe(100);
    const u = new UndoStack();
    for (let i = 0; i < 130; i++) u.record(String(i));
    expect(u.depth).toBe(100);
    let last = '';
    let cur = 'now';
    for (;;) {
      const back = u.undo(cur);
      if (back === null) break;
      last = back;
      cur = back;
    }
    expect(last).toBe('30');
  });

  it('clear forgets everything', () => {
    const u = new UndoStack();
    u.record('a');
    u.clear();
    expect(u.canUndo || u.canRedo).toBe(false);
  });
});

describe('the stable JSON format', () => {
  it('writes plain objects and arrays that fit on one line, and spreads the rest one field per line', () => {
    const text = formatJson({ rows: [{ y: 140 }, { y: 157 }], colors: ['#000000', '#ffffff'], slot: { x: 46, row: 4 }, nested: { a: { b: 1 } }, empty: [], none: {} });
    expect(text).toBe(
      ['{', '  "rows": [', '    { "y": 140 },', '    { "y": 157 }', '  ],', '  "colors": ["#000000", "#ffffff"],', '  "slot": { "x": 46, "row": 4 },', '  "nested": {', '    "a": { "b": 1 }', '  },', '  "empty": [],', '  "none": {}', '}', ''].join('\n'),
    );
  });

  it('is ordinary JSON, and printing the same value twice gives the same text', () => {
    const v = { a: [1, 2, { b: null, c: 'x' }], d: { e: [true, false] }, long: 'x'.repeat(120) };
    expect(JSON.parse(formatJson(v))).toEqual(v);
    expect(formatJson(JSON.parse(formatJson(v)))).toBe(formatJson(v));
  });

  it('breaks a one-liner that is too wide', () => {
    const wide = { values: Array.from({ length: 40 }, (_, i) => i * 1000) };
    expect(formatJson(wide).split('\n').length).toBeGreaterThan(3);
  });
});

describe('which lines changed', () => {
  it('reports the lines of the new text that are new or different', () => {
    const before = ['a', 'b', 'c', 'd'].join('\n');
    expect(changedLines(before, ['a', 'B', 'c', 'd'].join('\n'))).toEqual([1]);
    expect(changedLines(before, ['a', 'b', 'x', 'c', 'd'].join('\n'))).toEqual([2]);
    expect(changedLines(before, ['a', 'b', 'd'].join('\n'))).toEqual([]);
    expect(changedLines(before, before)).toEqual([]);
  });
});
