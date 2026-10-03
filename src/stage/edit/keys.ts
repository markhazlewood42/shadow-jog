/**
 * The Battle Stage Editor's keyboard shortcuts as ONE table (`docs/TOOLING-UI.md` 2.6). The same table drives the
 * key handler and the list on the "Keys" button, so what the button says is always what the keys do.
 *
 * Rules the table keeps: nothing uses a key the browser or the operating system owns (the `RESERVED` list: F5, F12,
 * Ctrl+R, Ctrl+L, Ctrl+T, Ctrl+N, Ctrl+W, the Alt letters that open the address bar and the browser menu, and the
 * chords Windows uses itself, see `unsafeReason`); and shortcuts are ignored while the cursor is in a text field
 * (except Ctrl+S, which saves from anywhere), the way the animation editor does. A combo is written like
 * "Ctrl+Shift+Z"; "Ctrl" also means the Command key on a Mac.
 *
 * The Align keys are SINGLE LETTERS with no modifier, the way a design tool does it (they work only while the cursor is
 * not in a text field). Every modifier chord was a trap: Ctrl+Alt+letter is AltGr+letter on a Windows keyboard that is
 * not US (it types characters such as @ { [ and the euro sign), Ctrl+Alt+arrows turns the screen over on some Windows
 * graphics drivers, and Alt+Shift switches the input language. A plain letter is the same key on every layout.
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
  // Align: one plain letter each, no modifier. A, D, W and S are Figma's letters for left, right, top and bottom (and the keys a game uses to move). C is Centre, M is Middle, X spreads along x (across) and Y along y (over the rows). H is already the HUD overlay, so Figma's H for centre is not used.
  { id: 'alignLeft', combos: ['A'], label: 'Align left (one thing: to the stage; several: to each other)', group: 'Align' },
  { id: 'alignCentre', combos: ['C'], label: 'Align centre', group: 'Align' },
  { id: 'alignRight', combos: ['D'], label: 'Align right', group: 'Align' },
  { id: 'alignBack', combos: ['W'], label: 'Align to the back row (a HUD box: to the top)', group: 'Align' },
  { id: 'alignMiddle', combos: ['M'], label: 'Align to the middle row (a HUD box: the middle)', group: 'Align' },
  { id: 'alignFront', combos: ['S'], label: 'Align to the front row (a HUD box: to the bottom)', group: 'Align' },
  { id: 'spreadAcross', combos: ['X'], label: 'Spread 3 or more evenly across (along x)', group: 'Align' },
  { id: 'spreadDepth', combos: ['Y'], label: 'Spread 3 or more evenly over the rows, or down for a HUD box (along y)', group: 'Align' },
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

/**
 * The browser and the operating system own these; no editor key may take them (a test checks the table against this list).
 * Three kinds:
 *  - the browser's own keys (reload, tabs, DevTools, the address bar and the menu on Alt);
 *  - AltGr chords. On a Windows keyboard that is not US, the right Alt key (AltGr) is reported as Ctrl+Alt together, and
 *    AltGr+letter or digit TYPES a character (@ { [ ] } \ | the euro sign...). A shortcut on Ctrl+Alt would fire while someone types;
 *  - Windows shortcuts: Ctrl+Alt+arrows turns the screen over on some graphics drivers, Ctrl+Alt+Delete is the security
 *    screen, and Alt+Shift (pressed on its own) switches the input language.
 */
export const RESERVED = [
  'F5', 'F6', 'F11', 'F12', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+L', 'Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Tab', 'Alt+D', 'Alt+F', 'Alt+E', 'Alt+Left', 'Alt+Right', 'Alt+Home',
  // AltGr on a non-US layout types characters (German: Q is @, E is the euro sign, 7 8 9 0 are { [ ] }; French: 2 3 4 5 6 8 9 0 are ~ # { [ | \ ^ @).
  'Ctrl+Alt+Q', 'Ctrl+Alt+E', 'Ctrl+Alt+A', 'Ctrl+Alt+D', 'Ctrl+Alt+H', 'Ctrl+Alt+S', 'Ctrl+Alt+V', 'Ctrl+Alt+W', 'Ctrl+Alt+2', 'Ctrl+Alt+3', 'Ctrl+Alt+4', 'Ctrl+Alt+5', 'Ctrl+Alt+6', 'Ctrl+Alt+7', 'Ctrl+Alt+8', 'Ctrl+Alt+9', 'Ctrl+Alt+0',
  // Screen rotation on some Windows graphics drivers, and the security screen.
  'Ctrl+Alt+ArrowLeft', 'Ctrl+Alt+ArrowRight', 'Ctrl+Alt+ArrowUp', 'Ctrl+Alt+ArrowDown', 'Ctrl+Alt+Delete',
  // Alt+Shift switches the input language; a chord that holds both is never safe.
  'Alt+Shift+A', 'Alt+Shift+D', 'Alt+Shift+Tab',
];

/**
 * Why a combo may never be a shortcut, or null when it may. A general version of `RESERVED` that catches a whole class
 * (every Ctrl+Alt chord, every chord with Alt and Shift together), so a new key cannot slip through by being a letter nobody listed.
 */
export function unsafeReason(combo: string): string | null {
  const mods = new Set(combo.split('+').slice(0, -1));
  if (mods.has('Ctrl') && mods.has('Alt')) return 'Ctrl+Alt is AltGr on a Windows keyboard that is not US: it types characters, and Ctrl+Alt+arrows turns the screen on some drivers';
  if (mods.has('Alt') && mods.has('Shift')) return 'Alt+Shift switches the input language on Windows';
  if (RESERVED.includes(combo)) return 'the browser or the operating system owns it';
  return null;
}

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
