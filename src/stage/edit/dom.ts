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

// ------------------------------------------------------------------ tooltips ("?" help)

/**
 * A small "?" button that explains a setting in plain words when the pointer rests on it or the keyboard focuses it.
 * Write the text for a beginner: what the setting is, then what you will SEE change, one idea per sentence.
 * The text also becomes the button's accessible name, so a screen reader reads it.
 */
export function tip(text: string): HTMLElement {
  return h('button', { type: 'button', class: 'qm', 'data-tip': text, 'aria-label': `Help: ${text}` }, '?');
}

/**
 * Show the text of any element that has `data-tip` in one floating bubble (a "?" button, or a toolbar button that
 * wants a longer explanation than the browser's own `title` gives). One bubble for the whole page, placed with
 * `position: fixed`, so a panel that scrolls or clips its contents cannot cut the text off. Call once at start-up.
 */
export function installTips(): void {
  const bubble = h('div', { id: 'tipbubble', role: 'tooltip', hidden: true });
  document.body.append(bubble);
  let current: HTMLElement | null = null;
  const hide = (): void => {
    current = null;
    bubble.hidden = true;
  };
  const show = (el: HTMLElement): void => {
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    bubble.textContent = text;
    bubble.hidden = false;
    const r = el.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    // Prefer the side with more room: panels on the right open their tips to the left, and the other way round.
    const left = r.left + r.width / 2 > window.innerWidth / 2 ? r.left - b.width - 8 : r.right + 8;
    const x = Math.min(Math.max(8, left), window.innerWidth - b.width - 8);
    // Toolbar items open their tip below; side panel items open it level with the "?".
    const below = r.top < 90;
    const y = below ? r.bottom + 8 : r.top + r.height / 2 - b.height / 2;
    bubble.style.left = `${x}px`;
    bubble.style.top = `${Math.min(Math.max(8, y), window.innerHeight - b.height - 8)}px`;
  };
  const owner = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null);
  document.addEventListener('pointerover', (e) => {
    const el = owner(e.target);
    if (el && el !== current) show(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = owner(e.target);
    if (el && el === current && !el.contains(e.relatedTarget as Node | null) && document.activeElement !== el) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = owner(e.target);
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!owner(e.target)) hide();
  });
  // A panel that scrolls under the bubble would leave it behind.
  document.addEventListener('scroll', hide, true);
}
