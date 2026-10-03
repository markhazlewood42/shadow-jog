/**
 * Small in-page dialogs for the editor: ask for a name, confirm a destructive step, show information.
 *
 * Why not `window.confirm` and `window.prompt`: the browser's own boxes look foreign, block the page's timers, and
 * need special handling in tests. These are plain elements, styled like the rest of the editor, that return a
 * promise. Enter confirms, Esc cancels, and the first button or field is focused.
 */
import { h } from './dom';

/** Show a dialog with a title, a body and buttons; resolves with the label of the button pressed (or null for Esc / a click outside). */
export function showDialog(title: string, body: Node[], buttons: string[], primary: string, initialFocus?: () => HTMLElement | null): Promise<string | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const done = (value: string | null): void => {
      overlay.remove();
      previous?.focus?.();
      resolve(value);
    };
    const row = h('div', { class: 'dlg-buttons' }, ...buttons.map((b) => h('button', { class: b === primary ? 'primary' : '', type: 'button', onclick: () => done(b) }, b)));
    const overlay = h(
      'div',
      {
        class: 'dlg-back',
        onmousedown: (e: Event) => {
          if (e.target === overlay) done(null);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            done(null);
          } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            e.stopPropagation();
            done(primary);
          }
        },
      },
      h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), ...body, row),
    );
    document.body.append(overlay);
    (initialFocus?.() ?? (row.querySelector('button.primary') as HTMLElement | null))?.focus();
  });
}

/** "Throw away 6 changes to street?" Resolves true on the confirming button. */
export async function confirmBox(title: string, message: string, yes: string, no = 'Cancel'): Promise<boolean> {
  return (await showDialog(title, [h('p', {}, message)], [no, yes], yes)) === yes;
}

/** Ask for one line of text. Resolves with the text, or null if cancelled. */
export async function promptBox(title: string, label: string, value: string, ok = 'OK'): Promise<string | null> {
  const input = h('input', { type: 'text', value, spellcheck: 'false', 'aria-label': label });
  const result = await showDialog(title, [h('label', { class: 'dlg-field' }, h('span', {}, label), input)], ['Cancel', ok], ok, () => {
    queueMicrotask(() => input.select());
    return input;
  });
  return result === ok ? input.value : null;
}

/** Show a table or text and one Close button. */
export async function infoBox(title: string, body: Node): Promise<void> {
  await showDialog(title, [body], ['Close'], 'Close');
}
