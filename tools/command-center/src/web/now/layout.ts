// Where Mark put the panels of the Now page. The glass panels can be dragged (they snap to a grid), and the page keeps the arrangement in the
// browser's localStorage, so it is the same after a reload. Nothing is written to the server or to the repo. This file knows nothing about
// the glass or about React: it is a map from a panel's id to how far the panel was moved, and the two ways to read it and write it.

/** The panels of the Now page, in the order of the page (the most important one first). */
export const PANEL_IDS = ['your-move', 'running', 'pull-requests', 'status', 'links'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** How far a panel was moved from where the page lays it out, in pixels. (x to the right, y down.) */
export type Offset = { x: number; y: number };

/** The moved panels. A panel that was never moved has no entry. An empty layout is the arrangement that the page starts with. */
export type Layout = Partial<Record<PanelId, Offset>>;

/** The key of the layout in localStorage. The page has no other saved state of this kind. */
export const LAYOUT_KEY = 'cc.now.layout';

/** The part of `Storage` that the layout uses. localStorage is one, and a test makes another. */
export type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** No panel is farther from its place than this many pixels: a bigger number is garbage (a hand edit, another page's value), and the panel would be out of reach. */
const MAX_OFFSET = 100_000;

/**
 * The browser's localStorage, or null when there is none. Reading `window.localStorage` can itself throw (a browser that blocks site data
 * does it), so the read is guarded, and a page that cannot keep its arrangement still works.
 */
function browserStorage(): LayoutStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An offset that is two finite numbers of a sane size, or null. */
function offsetOf(value: unknown): Offset | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_OFFSET || Math.abs(y) > MAX_OFFSET) return null;
  return { x, y };
}

/**
 * The saved arrangement. Anything that cannot be used is left out, and the rest is kept: text that is not JSON, JSON that is not an object, an
 * id that the page does not have, an offset that is not two numbers, and a storage that throws all give the panels their default places.
 */
export function loadLayout(storage: LayoutStorage | null = browserStorage()): Layout {
  let saved: unknown;
  try {
    const text = storage?.getItem(LAYOUT_KEY) ?? null;
    if (text === null) return {};
    saved = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(saved)) return {};
  const layout: Layout = {};
  for (const id of PANEL_IDS) {
    const offset = offsetOf(saved[id]);
    if (offset !== null) layout[id] = offset;
  }
  return layout;
}

/**
 * Keeps the arrangement. "Reset layout" saves an empty one. Only the panels that the page has are written. A write that fails (the storage is
 * blocked or full) is ignored: the arrangement then lasts until the page is closed, and nothing else is lost.
 */
export function saveLayout(layout: Layout, storage: LayoutStorage | null = browserStorage()): void {
  const known: Layout = {};
  for (const id of PANEL_IDS) {
    const offset = offsetOf(layout[id]);
    if (offset !== null) known[id] = offset;
  }
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify(known));
  } catch {
    // Nothing to do: see above.
  }
}
