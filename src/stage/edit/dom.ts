/**
 * Small helpers for building the editor's panels with plain DOM (no framework: the editor is a dev page, and
 * the other tools, `src/dev/rigedit.ts` and `src/dev/fxlab.ts`, are written the same way).
 */

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/**
 * Make an element: `h('button', { class: 'tb', onclick: fn, title: 'Save' }, 'Save')`. Props starting with "on" are
 * event listeners; `class`, `dataset` and `style` are set directly; `true` sets a bare attribute; `false`, null and
 * undefined are skipped, which keeps conditional bits of a panel on one line.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v as Record<string, string>);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

/** The element with this id, or a readable error (a page that is missing a piece should say which). */
export function byId<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`The page has no element #${id}`);
  return el as unknown as T;
}

/** True when a key press or click happened inside something you type in, where editor shortcuts must stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'submit'].includes(target.type);
  return false;
}

/** Read a browser-storage value without letting a blocked or full storage break the page. */
export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Write a browser-storage value; silently does nothing when storage is unavailable (these are conveniences, not data). */
export function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: remembered choices are a convenience, so carry on.
  }
}
