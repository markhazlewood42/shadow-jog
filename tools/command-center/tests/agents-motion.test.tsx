// @vitest-environment happy-dom
import { act, useMemo } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '../src/web/agents/CopyButton';
import { EXIT_MS, FLASH_MS, useFlash, useLeaving } from '../src/web/agents/motion';

// The parts of the Agents diagram that have a state over time: the Copy button (Check for 2 seconds, or Copy failed for 2 seconds), a box that stays for 200 ms to fade out,
// and a line that flashes for 1 second when its count grows. They are driven here with a fake clock, which a browser test cannot do. Whether the CSS then really fades and
// slides is the job of e2e/agents.spec.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** Lets the time of the page move, and React with it. */
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

/** Says whether the person asked for less motion. The page asks the browser at the moment it needs to know. */
function setReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduced && query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

// ---- the Copy button ----

describe('the Copy button', () => {
  const button = () => container.querySelector('button') as HTMLButtonElement;
  const status = () => button().getAttribute('data-copy');
  const labels = () => (container.textContent ?? '').trim();

  async function clickIt(): Promise<void> {
    await act(async () => {
      button().click();
    });
  }

  /** Gives the page a clipboard that does what `writeText` does, or none at all (a page that is not a secure page has none). */
  function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText === undefined ? undefined : { writeText } });
  }

  it('is a button named Copy path, with the copy icon', () => {
    act(() => root.render(<CopyButton path="/fixture/session.jsonl" />));
    expect(button().getAttribute('aria-label')).toBe('Copy path');
    expect(button().getAttribute('type')).toBe('button');
    expect(status()).toBe('idle');
    expect(button().querySelector('svg')?.getAttribute('class')).toContain('lucide-copy');
    expect(labels()).toBe('');
  });

  it('copies the path, shows a check for 2 seconds, and then the copy icon again', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    act(() => root.render(<CopyButton path="/fixture/session.jsonl" />));
    await clickIt();

    expect(writeText).toHaveBeenCalledExactlyOnceWith('/fixture/session.jsonl');
    expect(status()).toBe('copied');
    expect(button().querySelector('svg')?.getAttribute('class')).toContain('lucide-check');
    // The name of the button does not change: only the icon does. The result is also said in words, for a person who cannot see the icon change.
    expect(button().getAttribute('aria-label')).toBe('Copy path');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied');

    await advance(1999);
    expect(status()).toBe('copied');
    await advance(1);
    expect(status()).toBe('idle');
    expect(button().querySelector('svg')?.getAttribute('class')).toContain('lucide-copy');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('a second copy starts the 2 seconds again', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    act(() => root.render(<CopyButton path="/p" />));
    await clickIt();
    await advance(1500);
    await clickIt();
    await advance(1500);
    // 3 seconds after the first copy, but 1.5 seconds after the second one.
    expect(status()).toBe('copied');
    await advance(500);
    expect(status()).toBe('idle');
  });

  it('shows the alert icon and the label Copy failed for 2 seconds when the browser refuses', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    act(() => root.render(<CopyButton path="/p" />));
    await clickIt();

    expect(status()).toBe('failed');
    expect(button().querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-alert');
    expect(labels()).toBe('Copy failed');
    expect(button().getAttribute('aria-label')).toBe('Copy path');
    await advance(1999);
    expect(status()).toBe('failed');
    await advance(1);
    expect(status()).toBe('idle');
    expect(labels()).toBe('');
  });

  it('says Copy failed too when the page has no clipboard at all, and never says Copied', async () => {
    // The call throws before it can be rejected: there is nothing to call.
    stubClipboard(undefined);
    act(() => root.render(<CopyButton path="/p" />));
    await clickIt();
    expect(status()).toBe('failed');
    expect(container.textContent).not.toContain('Copied');
  });

  it('stops its timer when it leaves the page', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    act(() => root.render(<CopyButton path="/p" />));
    await clickIt();
    act(() => root.render(<p>gone</p>));
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---- a box that stays to fade out ----

describe('useLeaving', () => {
  function List({ items }: { items: string[] }) {
    const shown = useLeaving(items, (item) => item);
    return (
      <ul>
        {shown.map(({ item, leaving }) => (
          <li key={item} data-leaving={leaving ? 'true' : undefined}>
            {item}
          </li>
        ))}
      </ul>
    );
  }
  const rows = () => [...container.querySelectorAll('li')].map((row) => `${row.textContent}${row.getAttribute('data-leaving') === 'true' ? ' (leaving)' : ''}`);

  it('keeps an item that left for 200 ms, marked as leaving, and then drops it', async () => {
    expect(EXIT_MS).toBe(200);
    act(() => root.render(<List items={['a', 'b', 'c']} />));
    expect(rows()).toEqual(['a', 'b', 'c']);

    act(() => root.render(<List items={['a', 'c']} />));
    expect(rows().sort()).toEqual(['a', 'b (leaving)', 'c']);
    await advance(199);
    expect(rows().sort()).toEqual(['a', 'b (leaving)', 'c']);
    await advance(1);
    expect(rows()).toEqual(['a', 'c']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an item that left in its own place, as the same element, so that its fade can run', async () => {
    act(() => root.render(<List items={['a', 'b', 'c']} />));
    const before = [...container.querySelectorAll('li')];
    act(() => root.render(<List items={['a', 'c']} />));
    // React moves an element that changes its place, and a moved element does not run its CSS transition: the leaving item must stay between its old neighbors.
    expect(rows()).toEqual(['a', 'b (leaving)', 'c']);
    expect([...container.querySelectorAll('li')]).toEqual(before);
    await advance(200);
    expect(rows()).toEqual(['a', 'c']);
  });

  it('keeps items that left together, and one whose neighbor left later, each in its own place', async () => {
    act(() => root.render(<List items={['a', 'b', 'c', 'd']} />));
    act(() => root.render(<List items={['a', 'd']} />));
    expect(rows()).toEqual(['a', 'b (leaving)', 'c (leaving)', 'd']);
    // The first item leaves too, while the others still fade: the one that had it as a neighbor still stands after it, and an item that left first of all stands first.
    act(() => root.render(<List items={['d']} />));
    expect(rows()).toEqual(['a (leaving)', 'b (leaving)', 'c (leaving)', 'd']);
    act(() => root.render(<List items={['d', 'e']} />));
    expect(rows()).toEqual(['a (leaving)', 'b (leaving)', 'c (leaving)', 'd', 'e']);
    await advance(200);
    expect(rows()).toEqual(['d', 'e']);
  });

  it('does not delay an item that was never there, and a list that did not change keeps nothing', async () => {
    act(() => root.render(<List items={['a']} />));
    act(() => root.render(<List items={['a', 'b']} />));
    expect(rows()).toEqual(['a', 'b']);
    act(() => root.render(<List items={['a', 'b']} />));
    expect(rows()).toEqual(['a', 'b']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an item that comes back while it fades is a normal item again, and one box', async () => {
    act(() => root.render(<List items={['a', 'b']} />));
    act(() => root.render(<List items={['a']} />));
    await advance(100);
    act(() => root.render(<List items={['a', 'b']} />));
    expect(rows()).toEqual(['a', 'b']);
    // The old timer of the item must not remove it now, and must not remove it when it leaves again later.
    await advance(150);
    expect(rows()).toEqual(['a', 'b']);
    act(() => root.render(<List items={['a']} />));
    await advance(150);
    expect(rows().sort()).toEqual(['a', 'b (leaving)']);
    await advance(50);
    expect(rows()).toEqual(['a']);
  });

  it('keeps each item for its own 200 ms when several leave at different times', async () => {
    act(() => root.render(<List items={['a', 'b', 'c']} />));
    act(() => root.render(<List items={['b', 'c']} />));
    await advance(120);
    act(() => root.render(<List items={['c']} />));
    expect(rows().sort()).toEqual(['a (leaving)', 'b (leaving)', 'c']);
    await advance(80);
    expect(rows().sort()).toEqual(['b (leaving)', 'c']);
    await advance(120);
    expect(rows()).toEqual(['c']);
  });

  it('drops an item at once when the person asked for less motion', async () => {
    setReducedMotion(true);
    act(() => root.render(<List items={['a', 'b']} />));
    act(() => root.render(<List items={['a']} />));
    expect(rows()).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when the list leaves the page', async () => {
    act(() => root.render(<List items={['a', 'b']} />));
    act(() => root.render(<List items={['a']} />));
    act(() => root.render(<p>gone</p>));
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---- a line that flashes when its count grows ----

describe('useFlash', () => {
  function Counts({ counts }: { counts: Record<string, number> }) {
    // The map is made again when the counts are new, as a page makes it again at every load of the data, and not at every render (the hook compares it with the last one).
    const map = useMemo(() => new Map(Object.entries(counts)), [counts]);
    const flashing = useFlash(map);
    return <p>{[...flashing].map(([key, token]) => `${key}:${token}`).join(',')}</p>;
  }
  const flashing = () => container.querySelector('p')?.textContent;

  it('flashes a line for 1 second when its count grows, and not at the first look', async () => {
    expect(FLASH_MS).toBe(1000);
    act(() => root.render(<Counts counts={{ a: 2 }} />));
    expect(flashing()).toBe('');
    act(() => root.render(<Counts counts={{ a: 3 }} />));
    expect(flashing()).toBe('a:1');
    await advance(999);
    expect(flashing()).toBe('a:1');
    await advance(1);
    expect(flashing()).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not flash for a count that stays, falls, or is new', async () => {
    act(() => root.render(<Counts counts={{ a: 3, b: 1 }} />));
    act(() => root.render(<Counts counts={{ a: 3, b: 1 }} />));
    expect(flashing()).toBe('');
    act(() => root.render(<Counts counts={{ a: 2, b: 1 }} />));
    expect(flashing()).toBe('');
    // A line that is new has its count from the start: it arrives by the fade-in and not by a flash.
    act(() => root.render(<Counts counts={{ a: 2, b: 1, c: 5 }} />));
    expect(flashing()).toBe('');
  });

  it('starts again when the count grows again during the flash, with a new token', async () => {
    act(() => root.render(<Counts counts={{ a: 1 }} />));
    act(() => root.render(<Counts counts={{ a: 2 }} />));
    expect(flashing()).toBe('a:1');
    await advance(600);
    act(() => root.render(<Counts counts={{ a: 3 }} />));
    expect(flashing()).toBe('a:2');
    // 1 second after the first growth is only 0.4 seconds after the second one.
    await advance(400);
    expect(flashing()).toBe('a:2');
    await advance(600);
    expect(flashing()).toBe('');
  });

  it('flashes nothing when the person asked for less motion', async () => {
    setReducedMotion(true);
    act(() => root.render(<Counts counts={{ a: 1 }} />));
    act(() => root.render(<Counts counts={{ a: 2 }} />));
    expect(flashing()).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when it leaves the page', async () => {
    act(() => root.render(<Counts counts={{ a: 1 }} />));
    act(() => root.render(<Counts counts={{ a: 2 }} />));
    act(() => root.render(<p>gone</p>));
    expect(vi.getTimerCount()).toBe(0);
  });
});
