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

/** Set by `installTips`: closes the floating bubble (used when a click opens a panel that the bubble would sit on top of). */
let closeBubble: () => void = () => {};
export function hideTips(): void {
  closeBubble();
}

/**
 * Show the text of any element that has `data-tip` in one floating bubble (a "?" button, or a toolbar button that
 * wants a longer explanation than the browser's own `title` gives). One bubble for the whole page, placed with
 * `position: fixed`, so a panel that scrolls or clips its contents cannot cut the text off. Call once at start-up.
 *
 * Where the bubble opens (so it never covers the label it explains): a tip in a side panel opens BESIDE THE WHOLE
 * PANEL, over the stage view (left of the right panel, right of the left panel); a tip in the toolbar, or anywhere
 * when the panels are stacked on a narrow window, opens just below the thing.
 */
export function installTips(): void {
  const bubble = h('div', { id: 'tipbubble', role: 'tooltip', hidden: true });
  document.body.append(bubble);
  let current: HTMLElement | null = null;
  /** Until this time (ms), a scroll is probably the one `focus()` caused by bringing the focused "?" into view. */
  let focusScrollUntil = 0;
  const hide = (): void => {
    current = null;
    bubble.hidden = true;
  };
  closeBubble = hide;
  const place = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const panel = el.closest('aside');
    const pr = panel?.getBoundingClientRect();
    let x: number;
    let y: number;
    if (pr && pr.width < window.innerWidth * 0.6) {
      // Beside the whole panel, level with the "?" (clear of the label, which is inside the panel).
      const panelOnRight = pr.left + pr.width / 2 > window.innerWidth / 2;
      x = panelOnRight ? pr.left - b.width - 8 : pr.right + 8;
      y = r.top + r.height / 2 - b.height / 2;
    } else {
      // Below the element (above it when there is no room underneath).
      x = r.left;
      y = r.bottom + 8;
      if (y + b.height > window.innerHeight - 8) y = r.top - b.height - 8;
    }
    bubble.style.left = `${Math.min(Math.max(8, x), window.innerWidth - b.width - 8)}px`;
    bubble.style.top = `${Math.min(Math.max(8, y), window.innerHeight - b.height - 8)}px`;
  };
  const show = (el: HTMLElement): void => {
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    bubble.textContent = text;
    bubble.hidden = false;
    place(el);
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
    if (!el) return;
    // Focusing scrolls the panel so the "?" is in view. That scroll must not close the bubble that the focus just opened.
    focusScrollUntil = performance.now() + 300;
    show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!owner(e.target)) hide();
  });
  // A panel that scrolls under the bubble would leave it behind: close it. The scroll that FOCUS caused (a few ms after the bubble opened) only moves it to follow the "?".
  document.addEventListener(
    'scroll',
    () => {
      if (current && performance.now() < focusScrollUntil) place(current);
      else hide();
    },
    true,
  );
}
