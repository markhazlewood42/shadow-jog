// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Panel } from '../src/shared/types';
import { Decisions } from '../src/web/docs/Decisions';

// The words of the engine decision table at /docs/decisions (Task 20; design 5.8): labels and links, and a sentence only where a reader would be lost
// without it. The page here is the real one (heading, panel, table), drawn in a DOM with a stub of the server. The decisions themselves (question, answer,
// who decides) are data from the docs and stay as they are. The sample ones are short, so what is long on this page is the page's own wording.

// Tells React that a test drives it, so that `act` waits for effects and updates.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'E1',
    number: 'E1',
    source: 'engine',
    question: 'How behavior is written',
    answer: 'Phaser style',
    milestone: 'Phase 0',
    who: 'Mark',
    option: 'A',
    status: 'approved',
    change: null,
    docSlug: 'engine/decisions',
    anchor: 'e1-how-behavior-is-written',
    ...over,
  };
}

/** Every status, an edit and an addition, and the three docs that hold decisions. */
const SAMPLE: Decision[] = [
  decision(),
  decision({ id: 'E2', number: 'E2', question: 'Name of the hook', status: 'changed', change: 'edited', anchor: 'e2-name' }),
  decision({ id: 'E3', number: 'E3', question: 'A new decision', option: null, milestone: null, who: 'Agent (FYI)', status: 'changed', change: 'added', anchor: null }),
  decision({ id: 'D5', number: 'D5', source: 'phase-0.2', question: 'What happens to PixelLab?', answer: 'OPEN (2026-10-04).', option: null, milestone: null, status: 'open', docSlug: 'PHASE-0.2', anchor: 'decisions-for-mark' }),
  decision({ id: 'C1', number: 'C1', source: 'engine-update', question: 'roundPixels off', answer: 'Accept.', option: 'Accepted 2026-10-05', milestone: null, docSlug: 'engine/README', anchor: null }),
];
/** The same list with every decision approved: a filter on Open or Changed leaves nothing. */
const ALL_APPROVED = SAMPLE.map((entry) => ({ ...entry, status: 'approved' as const, change: null }));

const good = (data: Decision[]): Panel<Decision[]> => ({ ok: true, data, updatedAt: '2026-10-06T12:00:00Z' });
const failed = (lastGood: Decision[] | null): Panel<Decision[]> => ({
  ok: false,
  error: { code: 'engine-table-columns', message: 'docs/engine/decisions.md lacks these columns: "Who decides".' },
  updatedAt: lastGood === null ? null : '2026-10-06T12:00:00Z',
  lastGood: lastGood === null ? null : { data: lastGood, updatedAt: '2026-10-06T12:00:00Z' },
});

// ---- the page ----

let answer: Panel<Decision[]>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  answer = good(SAMPLE);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/engine/decisions')) return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
      throw new Error(`the page asked for ${url}, which this test does not serve`);
    }),
  );
  // The page listens to the event stream of the server. This one never says anything.
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  document.title = '';
});

/** Lets the page finish what it started (a fetch, and the re-draw after it). */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

/** The count of pages drawn. It is the key of the router, so that every `show` starts a new page that loads the list again. */
let pages = 0;

/** Draws the page and, unless `loading` is set, waits for the answer of the server. */
async function show(options: { loading?: boolean } = {}): Promise<void> {
  act(() => {
    root.render(
      <MemoryRouter key={pages++} initialEntries={['/docs/decisions']}>
        <Decisions />
      </MemoryRouter>,
    );
  });
  if (options.loading !== true) await settle();
}

/** Presses a filter button as a person does, by the word at the start of its name. */
async function filterBy(word: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((candidate) => (candidate.textContent ?? '').startsWith(word));
  if (button === undefined) throw new Error(`no filter button called ${word}`);
  await act(async () => {
    button.click();
  });
  await settle();
}

const text = () => container.textContent ?? '';

// ---- the sentences of the page ----

/** The words of a text: the pieces that hold a letter or a digit (a lone dot or a separator is not a word). */
const wordsOf = (words: string): number => words.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;

/** A contraction ("don't", "it's", "you'll"). The possessive "Mark's answer" is not one. */
const CONTRACTION = /\b(?:\w+n't|\w+'(?:ll|re|ve|d|m)|(?:it|that|there|here|let|what|who|he|she)'s)\b/i;

/**
 * The sentences that the page says: every block of text (a paragraph, a heading, a label, a table cell, a button) cut at . ! and ?, and the hidden text
 * (placeholders, ARIA labels, tooltips). The text of the decisions is in it as well: it is short in the sample, and the page's own wording is what can be long.
 */
function sentencesOnPage(): string[] {
  const blocks = new Map<Element, string[]>();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const piece = (node.textContent ?? '').trim();
    const parent = node.parentElement;
    if (piece === '' || parent === null) continue;
    const block = parent.closest('p, h1, h2, h3, li, dt, dd, th, td, label, button, [role="note"], [role="alert"], [role="status"]') ?? parent;
    blocks.set(block, [...(blocks.get(block) ?? []), piece]);
  }
  const texts = [...blocks.values()].map((pieces) => pieces.join(' '));
  for (const element of container.querySelectorAll('[placeholder], [aria-label], [title]')) {
    for (const name of ['placeholder', 'aria-label', 'title']) {
      const value = element.getAttribute(name);
      if (value !== null) texts.push(value);
    }
  }
  return texts.flatMap((block) => block.split(/(?<=[.!?])\s+/)).filter((sentence) => sentence !== '');
}

describe('the engine decision table', () => {
  it('engine table shows labels instead of the long intro and the empty-state sentences', async () => {
    await show();

    // The intro is gone: the heading stands alone, and the panel is the next thing on the page.
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Decisions');
    expect(heading?.nextElementSibling?.getAttribute('aria-label')).toBe('Decisions');
    expect(container.querySelector('h1 ~ p')).toBeNull();
    for (const old of ['Every decision of the engine design', 'it waits for Mark', 'approval commit', 'unchanged since']) expect(text()).not.toContain(old);

    // A group says how many decisions it holds as a label, and its source is a link: no "from" between them.
    const groups = [...container.querySelectorAll('tbody')];
    expect(groups).toHaveLength(3);
    const [engine, phase, update] = groups.map((group) => group.querySelector('th[scope="rowgroup"]'));
    expect(engine?.textContent).toBe('Engine design3 decisions · docs/engine/decisions.md');
    expect(phase?.textContent).toBe('Phase 0.2 plan1 decision · docs/PHASE-0.2.md');
    expect(update?.textContent).toBe('Phase 0 update1 decision · docs/engine/README.md');
    expect(engine?.querySelector('a')?.getAttribute('href')).toBe('/docs/engine/decisions');
    expect(phase?.querySelector('a')?.getAttribute('href')).toBe('/docs/PHASE-0.2');
    expect(update?.querySelector('a')?.getAttribute('href')).toBe('/docs/engine/README');
    expect(text()).not.toMatch(/decisions? from/);

    // The counts of a source stay a label: "3 decisions: 2 changed, 1 approved".
    expect(text()).toContain('3 decisions: 2 changed, 1 approved');

    // A filter that leaves nothing says it in a label. Nothing is open or changed here, and an empty list says "No decisions" under each filter.
    answer = good(ALL_APPROVED);
    await show();
    await filterBy('Open');
    expect(container.querySelector('table')).toBeNull();
    expect(text()).toContain('No open decisions');
    await filterBy('Changed');
    expect(text()).toContain('No changed decisions');
    await filterBy('Approved');
    expect(container.querySelectorAll('tbody')).toHaveLength(3);
    expect(text()).not.toContain('No approved decisions');

    answer = good([]);
    await show();
    expect(container.querySelector('table')).toBeNull();
    expect(text()).toContain('No decisions');
    await filterBy('Open');
    expect(text()).toContain('No open decisions');
    await filterBy('Changed');
    expect(text()).toContain('No changed decisions');
    await filterBy('Approved');
    expect(text()).toContain('No approved decisions');

    // The four sentences of the old text are gone.
    for (const old of ['No decisions were found in the three docs.', 'No decision is open for Mark.', 'No decision has changed since the approval.', 'No decision is approved.']) {
      expect(text()).not.toContain(old);
    }
  });

  it('engine table shows no sentence over 20 words', async () => {
    const seen: string[] = [];
    const collect = () => seen.push(...sentencesOnPage());

    // Loading, before the answer of the server.
    await show({ loading: true });
    collect();
    await settle();

    // The table with every status, under each filter.
    collect();
    for (const filter of ['Open', 'Changed', 'Approved', 'All']) {
      await filterBy(filter);
      collect();
    }

    // A list where a filter leaves nothing, and a list with no decision at all.
    for (const list of [ALL_APPROVED, []]) {
      answer = good(list);
      await show();
      collect();
      for (const filter of ['Open', 'Changed', 'Approved']) {
        await filterBy(filter);
        collect();
      }
    }

    // The failed panel, with no old data and with the data of before under the error.
    for (const lastGood of [null, SAMPLE]) {
      answer = failed(lastGood);
      await show();
      collect();
    }

    // The scan saw the real page (known labels are in it), and not one sentence is long or holds a contraction.
    for (const known of ['Decisions', 'Loading…', 'No decisions', 'No open decisions', 'No changed decisions', 'No approved decisions', 'Retry']) {
      expect(seen, known).toContain(known);
    }
    expect(seen.some((sentence) => sentence.startsWith('3 decisions'))).toBe(true);
    expect(seen.some((sentence) => sentence.startsWith('Last good data:'))).toBe(true);
    expect(seen.filter((sentence) => wordsOf(sentence) > 20)).toEqual([]);
    expect(seen.filter((sentence) => CONTRACTION.test(sentence))).toEqual([]);
  });
});
