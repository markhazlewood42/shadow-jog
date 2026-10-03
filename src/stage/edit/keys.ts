/**
 * The Battle Stage Editor's keyboard shortcuts as ONE table (`docs/TOOLING-UI.md` 2.6). The same table drives the
 * key handler and the list on the "Keys" button, so what the button says is always what the keys do.
 *
 * Rules the table keeps: nothing uses a key the browser owns (the `RESERVED` list: F5, F12, Ctrl+R, Ctrl+L, Ctrl+T,
 * Ctrl+N, Ctrl+W, and the Alt letters that open the address bar and the browser menu: Alt+D, Alt+F, Alt+E); and shortcuts
 * are ignored while the cursor is in a text field (except Ctrl+S, which saves from anywhere), the way the animation
 * editor does. A combo is written like "Ctrl+Shift+Z"; "Ctrl" also means the Command key on a Mac. The Align keys are
 * Ctrl+Alt+letter: browsers leave those alone (Alt+letter alone is the browser's menu on Windows).
 */

export interface KeyDef {
  id: string;
  /** Combos that trigger it; the first is shown on the Keys list. */
  combos: string[];
  label: string;
  group: 'File' | 'Edit' | 'Move' | 'Align' | 'View' | 'Test';
  /** Run even while typing in a text field. */
  everywhere?: boolean;
}

/** One mouse trick, for the "Mouse" group of the Keys list (not a key, so the key handler never reads it; `interact.ts` does the work). */
export interface MouseDef {
  gesture: string;
  label: string;
}

export const KEYS: KeyDef[] = [
  { id: 'save', combos: ['Ctrl+S'], label: 'Save the files that changed (stages.json, hud.json, axes.json)', group: 'File', everywhere: true },
  { id: 'undo', combos: ['Ctrl+Z'], label: 'Undo (100 steps)', group: 'Edit' },
  { id: 'redo', combos: ['Ctrl+Y', 'Ctrl+Shift+Z'], label: 'Redo', group: 'Edit' },
  { id: 'duplicate', combos: ['Ctrl+D'], label: 'Duplicate the stage', group: 'File' },
  { id: 'find', combos: ['Ctrl+F'], label: 'Find a stage in the list', group: 'File' },
  { id: 'prev', combos: ['PageUp'], label: 'Previous stage', group: 'File' },
  { id: 'next', combos: ['PageDown'], label: 'Next stage', group: 'File' },
  { id: 'selectAll', combos: ['Ctrl+A'], label: 'Select every fighter of the side', group: 'Edit' },
  { id: 'deselect', combos: ['Escape'], label: 'Deselect, close a dialog, cancel a drag', group: 'Edit' },
  { id: 'copy', combos: ['Ctrl+C'], label: 'Copy the stage as JSON (when nothing is typed)', group: 'Edit' },
  { id: 'left', combos: ['ArrowLeft'], label: 'Nudge left 1 px', group: 'Move' },
  { id: 'right', combos: ['ArrowRight'], label: 'Nudge right 1 px', group: 'Move' },
  { id: 'up', combos: ['ArrowUp'], label: 'Nudge up 1 px (a fighter: one row back)', group: 'Move' },
  { id: 'down', combos: ['ArrowDown'], label: 'Nudge down 1 px (a fighter: one row forward)', group: 'Move' },
  { id: 'left8', combos: ['Shift+ArrowLeft'], label: 'Nudge left 8 px', group: 'Move' },
  { id: 'right8', combos: ['Shift+ArrowRight'], label: 'Nudge right 8 px', group: 'Move' },
  { id: 'up8', combos: ['Shift+ArrowUp'], label: 'Nudge up 8 px', group: 'Move' },
  { id: 'down8', combos: ['Shift+ArrowDown'], label: 'Nudge down 8 px', group: 'Move' },
  { id: 'forward', combos: ['Ctrl+]'], label: 'Bring the fighter forward (within its row)', group: 'Move' },
  { id: 'back', combos: ['Ctrl+['], label: 'Send the fighter back (within its row)', group: 'Move' },
  // Align (Figma's letters: A left, H centre, D right, W top, V middle, S bottom) on Ctrl+Alt. Plain Alt+D is the browser's address bar, Alt+F and Alt+E its menu; Ctrl+Alt+letter is left alone.
  { id: 'alignLeft', combos: ['Ctrl+Alt+A'], label: 'Align left (one thing: to the stage; several: to each other)', group: 'Align' },
  { id: 'alignCentre', combos: ['Ctrl+Alt+H'], label: 'Align centre', group: 'Align' },
  { id: 'alignRight', combos: ['Ctrl+Alt+D'], label: 'Align right', group: 'Align' },
  { id: 'alignBack', combos: ['Ctrl+Alt+W'], label: 'Align to the back row (a HUD box: to the top)', group: 'Align' },
  { id: 'alignMiddle', combos: ['Ctrl+Alt+V'], label: 'Align to the middle row (a HUD box: the middle)', group: 'Align' },
  { id: 'alignFront', combos: ['Ctrl+Alt+S'], label: 'Align to the front row (a HUD box: to the bottom)', group: 'Align' },
  { id: 'spreadAcross', combos: ['Ctrl+Alt+Shift+H'], label: 'Spread 3 or more evenly across', group: 'Align' },
  { id: 'spreadDepth', combos: ['Ctrl+Alt+Shift+V'], label: 'Spread 3 or more evenly over the rows (a HUD box: down)', group: 'Align' },
  { id: 'grid', combos: ['G'], label: 'Snap to the 8 px grid on / off (hold Ctrl while dragging to flip it for one drag)', group: 'View' },
  { id: 'lock', combos: ['L'], label: 'Lock / unlock the selection’s layer (a locked layer cannot be picked)', group: 'View' },
  { id: 'leftPanel', combos: ['P'], label: 'Show / hide the left panel (more room for the stage on a small screen)', group: 'View' },
  { id: 'hud', combos: ['H'], label: 'Show / hide the HUD boxes', group: 'View' },
  { id: 'mode', combos: ['E'], label: 'Edit / Play', group: 'View' },
  { id: 'help', combos: ['?'], label: 'Help: what is a stage?', group: 'View' },
  { id: 'test', combos: ['Ctrl+Enter'], label: 'Battle Test', group: 'Test' },
];

/** The mouse tricks, shown in a "Mouse" group on the Keys list. */
export const MOUSE: MouseDef[] = [
  { gesture: 'Click', label: 'Select the thing under the pointer' },
  { gesture: 'Shift+click', label: 'Add it to the selection, or take it out if it is already in (also in the Who’s standing here list; Ctrl+click does the same there)' },
  { gesture: 'Drag', label: 'Move the selection (one undo step)' },
  { gesture: 'Shift+drag', label: 'Lock the move to sideways or up and down, whichever way you went further' },
  { gesture: 'Ctrl+drag', label: 'Flip the grid and row snapping for that one drag' },
];

/** The browser owns these; no editor key may take them (a test checks the table against this list). */
export const RESERVED = ['F5', 'F6', 'F11', 'F12', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+L', 'Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Tab', 'Alt+D', 'Alt+F', 'Alt+E', 'Alt+Left', 'Alt+Right', 'Alt+Home'];

/** The combo a key event is, written the way the table writes them ("Ctrl+Shift+Z", "ArrowLeft", "Escape"). */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string }): string {
  // With Alt held, some layouts (a Mac's Option key) type another character; the key's position tells which letter it is.
  const key = e.altKey && e.code?.startsWith('Key') ? e.code.slice(3) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // Shift is part of the combo only for non-letter keys and when the table asks for it ("Shift+ArrowLeft", "Ctrl+Shift+Z").
  if (e.shiftKey && !(key.length === 1 && !/[A-Z]/.test(key))) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Which table entry a key event triggers, or null. */
export function matchKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string }): KeyDef | null {
  const combo = comboOf(e);
  // Ctrl+] / Ctrl+[ may arrive with Shift on some layouts; accept either.
  const loose = combo.replace('Shift+', '');
  return KEYS.find((k) => k.combos.includes(combo) || (/[[\]]/.test(combo) && k.combos.includes(loose))) ?? null;
}

/** "Esc" reads better than "Escape" on the Keys list, and arrows read better as arrows. */
export function shown(combo: string): string {
  return combo.replace('Escape', 'Esc').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓');
}
