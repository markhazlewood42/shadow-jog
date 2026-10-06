import { describe, expect, it } from 'vitest';
import { LAYOUT_KEY, type Layout, PANEL_IDS, loadLayout, saveLayout } from '../src/web/now/layout';

// The arrangement of the panels of the Now page is kept in the browser's localStorage, and nothing else about the page is. These tests use a
// made-up storage (a Map), so no browser is needed. localStorage can hold anything (another version of the page wrote it, a person edited it, it can be
// full or blocked), so reading it must never throw and never give back something the page cannot use.

/** A storage that keeps its values in a Map, like the real one keeps them in the browser. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

/** A storage that throws on every use, as a browser does when site data is blocked or the quota is full. */
const brokenStorage = {
  getItem: () => {
    throw new Error('SecurityError: storage is blocked');
  },
  setItem: () => {
    throw new Error('QuotaExceededError: storage is full');
  },
};

describe('layout', () => {
  it('layout: bad JSON and unknown ids are ignored, save round-trips, storage that throws is ignored', () => {
    // Nothing saved yet, and a value that is not JSON: both give the default arrangement (no offsets).
    expect(loadLayout(memoryStorage())).toEqual({});
    expect(loadLayout(memoryStorage({ [LAYOUT_KEY]: '{not json' }))).toEqual({});
    // JSON that is not an object of offsets.
    for (const text of ['null', '7', '"text"', '[1,2]', 'true']) expect(loadLayout(memoryStorage({ [LAYOUT_KEY]: text })), text).toEqual({});

    // An id that the page does not have is dropped, and so is an offset that is not two finite numbers, but a good one next to them stays.
    const mixed = JSON.stringify({
      running: { x: 48, y: -24 },
      'no-such-panel': { x: 1, y: 1 },
      links: { x: '48', y: 0 },
      status: { x: 1 },
      'pull-requests': { x: Number.NaN, y: 0 },
      'your-move': null,
    });
    expect(loadLayout(memoryStorage({ [LAYOUT_KEY]: mixed }))).toEqual({ running: { x: 48, y: -24 } });
    // A number so large that it can only be garbage is not an offset either: the panel would be out of reach.
    expect(loadLayout(memoryStorage({ [LAYOUT_KEY]: JSON.stringify({ running: { x: 1e12, y: 0 } }) }))).toEqual({});

    // Saving and loading again gives back the same arrangement, and the stored text holds only the ids that the page has.
    const store = memoryStorage();
    const layout: Layout = { 'your-move': { x: 0, y: 24 }, running: { x: -48, y: 96 }, links: { x: 24.5, y: 0 } };
    saveLayout(layout, store);
    expect(loadLayout(store)).toEqual(layout);
    saveLayout({ ...layout, 'no-such-panel': { x: 5, y: 5 } } as Layout, store);
    expect(Object.keys(JSON.parse(store.map.get(LAYOUT_KEY) ?? '{}') as object).sort()).toEqual(['links', 'running', 'your-move']);

    // "Reset layout" saves the empty arrangement: nothing is left to load.
    saveLayout({}, store);
    expect(loadLayout(store)).toEqual({});

    // A storage that throws is ignored on both sides: the page still works, with the default arrangement and without a saved one.
    expect(loadLayout(brokenStorage)).toEqual({});
    expect(() => saveLayout(layout, brokenStorage)).not.toThrow();
    // No storage at all (a browser with none, or a page that is not in a browser) is the same.
    expect(loadLayout(null)).toEqual({});
    expect(() => saveLayout(layout, null)).not.toThrow();
  });

  it('knows the five panels of the Now page, in the order of the page', () => {
    expect(PANEL_IDS).toEqual(['your-move', 'running', 'pull-requests', 'status', 'links']);
  });
});
