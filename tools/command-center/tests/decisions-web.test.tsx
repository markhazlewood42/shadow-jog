// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DecisionDetail, type DocDecision, type DocPage, MAX_NOTE_CHARS, type Panel } from '../src/shared/types';
import { DecisionRoute } from '../src/web/decisions/DecisionPage';
import { DecisionBanner } from '../src/web/decisions/DecisionBanner';
import { DocView } from '../src/web/docs/DocView';

// The decision page in a DOM (the simulated one of happy-dom): what it shows for the answer of the server, what it does when Mark answers, and
// what it keeps when something fails. How it looks and behaves in a real browser is the job of e2e/decisions.spec.ts. The server is a stub
// of fetch, and the stream of events is a stub too, so that a test can say "the server told the page that something changed".

// Tells React that a test drives it, so that `act` waits for effects and updates.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- a made-up decision ----

const OPTIONS = [
  { id: 'A', text: 'Keep the cache in the data folder.' },
  { id: 'B', text: 'Move the cache to the temp folder.' },
  { id: 'C', text: 'Move the cache to a new folder next to the data folder.' },
];

function detail(over: Partial<DecisionDetail> = {}): DecisionDetail {
  return {
    number: 41,
    title: 'Decision: Where should the cache live?',
    url: 'https://github.com/fixture-owner/fixture-repo/issues/41',
    state: 'open',
    question: 'Where should the cache live?',
    context: 'The cache grows without a limit.',
    options: OPTIONS,
    recommended: 'C',
    docs: [{ docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'storage', heading: 'Storage' }],
    raisedBy: 'Session one, branch cache-folder',
    waitsOn: 'The cache change in PR 12',
    createdAt: '2026-10-05T10:00:00Z',
    answer: null,
    problem: null,
    sections: [{ docId: 'docs/guides/setup.md', anchor: 'storage', heading: 'Storage', html: '<h2 id="storage">Storage</h2><p>Burrow keeps its data in one folder.</p>' }],
    ...over,
  };
}
const good = (data: DecisionDetail): Panel<DecisionDetail> => ({ ok: true, data, updatedAt: '2026-10-06T12:00:00Z' });
const answered = (over: Partial<DecisionDetail> = {}): DecisionDetail =>
  detail({ state: 'answered', answer: { option: 'C', note: 'Because it keeps the cache.', at: '2026-10-06T11:00:00Z', complete: true }, ...over });

// ---- a stub server ----

type Reply = { status: number; body: unknown };
const json = ({ status, body }: Reply) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Server = {
  /** What `GET /api/decisions/41` answers now. */
  detail: Reply;
  /** What each `POST /api/decisions/41/answer` answers: the first call gets the first reply, and the last one repeats. */
  answers: Reply[];
  gets: number;
  posts: { body: unknown; headers: Headers }[];
  /** Holds the answer of the next POST until `release()` is called. */
  hold(): () => void;
};

let server: Server;
let release: (() => void) | null = null;

function installServer(): void {
  server = {
    detail: { status: 200, body: good(detail()) },
    answers: [{ status: 200, body: { ok: true } }],
    gets: 0,
    posts: [],
    hold() {
      return () => release?.();
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        server.posts.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
        const reply = server.answers[Math.min(server.posts.length - 1, server.answers.length - 1)] as Reply;
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((done) => {
            release = done;
          });
        }
        return json(reply);
      }
      if (String(url).startsWith('/api/decisions/')) {
        server.gets += 1;
        return json(server.detail);
      }
      throw new Error(`the page asked for ${url}, which this test does not serve`);
    }),
  );
}
let holdNext = false;

/** A stand-in for EventSource: the test says what the server "sends" with `emit`. */
class FakeEventSource {
  static instance: FakeEventSource | null = null;
  private readonly listeners = new Map<string, ((message: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instance = this;
  }
  addEventListener(type: string, listener: (message: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    FakeEventSource.instance = null;
  }
  emit(type: string, data: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) });
  }
}

// ---- the page ----

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  holdNext = false;
  release = null;
  installServer();
  vi.stubGlobal('EventSource', FakeEventSource);
  // The page of this run holds the write token in a <meta> tag, and sends it back with an answer.
  document.head.innerHTML = '<meta name="cc-token" content="token-for-the-test">';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
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

async function show(number: number | string = 41): Promise<void> {
  act(() => {
    root.render(
      // The key makes a new router for each address: a router reads its first address once, and a test that shows another number must start again.
      <MemoryRouter key={number} initialEntries={[`/decisions/${number}`]}>
        <Routes>
          <Route path="/decisions/:number" element={<DecisionRoute />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await settle();
}

const text = () => container.textContent ?? '';
const radio = (id: string) => container.querySelector<HTMLInputElement>(`input[type="radio"][value="${id}"]`);
const noteBox = () => container.querySelector<HTMLTextAreaElement>('textarea');
const sendButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]');
const alert = () => container.querySelector('[role="alert"]');

/** Picks an option as a person does: a click on its radio button. */
async function choose(id: string): Promise<void> {
  const input = radio(id);
  if (input === null) throw new Error(`no option ${id} in the form`);
  await act(async () => {
    input.click();
  });
}

/** Types into the note: sets the value the way the browser does, and tells React with an input event. */
async function typeNote(words: string): Promise<void> {
  const box = noteBox();
  if (box === null) throw new Error('no note box in the form');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setValue?.call(box, words);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(button: HTMLButtonElement | null): Promise<void> {
  if (button === null) throw new Error('no button to press');
  await act(async () => {
    button.click();
  });
  await settle();
}

describe('the decision page', () => {
  it('shows the question, the context, the options with the recommended one marked, who raised it and what waits on it', async () => {
    await show();
    expect(container.querySelector('h1')?.textContent).toBe('Where should the cache live?'); // the "Decision:" of the title is left off: the page says it is a decision
    expect(text()).toContain('Decision #41');
    expect(text()).toContain('Open'); // the state, in a word
    expect(text()).toContain('The cache grows without a limit.');
    expect(text()).toContain('Session one, branch cache-folder');
    expect(text()).toContain('The cache change in PR 12');
    expect(text()).toContain('2026-10-05');
    for (const option of OPTIONS) expect(text()).toContain(option.text);
    // The recommended option says so in a word (an icon and a word, not a colour alone), and only that one.
    expect(text().match(/Recommended/g)).toHaveLength(1);
    expect(container.querySelector('a[href="https://github.com/fixture-owner/fixture-repo/issues/41"]')?.getAttribute('target')).toBe('_blank');
    // The panel says when it was last updated.
    expect(container.querySelector('time[datetime="2026-10-06T12:00:00Z"]')).not.toBeNull();
    expect(document.title).toBe('Decision #41 · Shadow Jog Command Center');
  });

  it('shows the linked sections inline, with the doc and the heading they come from and a link to them in the docs', async () => {
    await show();
    const section = container.querySelector('section[aria-label="docs/guides/setup.md#storage"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('docs/guides/setup.md');
    expect(section?.querySelector('.doc-html h2#storage')?.textContent).toBe('Storage');
    expect(section?.textContent).toContain('Burrow keeps its data in one folder.');
    expect(section?.querySelector('a[href="/docs/guides/setup#storage"]')?.textContent).toBe('Open in the docs');
  });

  it('issue text is plain text (a script tag shows as text)', async () => {
    // Markup in every place that the issue gives words: the title, the question, the context, an option, who raised it, what waits on it.
    const markup = '<script>window.__pwned = true</script>';
    server.detail = {
      status: 200,
      body: good(
        detail({
          title: 'Decision: <b>Bold</b> or plain?',
          question: `Should the shop show ${markup} as text?`,
          context: 'A line with <img src=x onerror="window.__pwned = true"> in it.',
          options: [{ id: 'A', text: 'Show <i>this</i> as it is.' }, { id: 'B', text: 'Strip it.' }],
          raisedBy: '<u>Session</u>',
          waitsOn: '<svg onload="window.__pwned = true"></svg>',
        }),
      ),
    };
    await show();
    // The characters are on the page ...
    expect(text()).toContain(markup);
    expect(text()).toContain('<b>Bold</b> or plain?');
    expect(text()).toContain('<img src=x onerror="window.__pwned = true">');
    expect(text()).toContain('Show <i>this</i> as it is.');
    // ... and they made no element: no script, no picture, no bold, no italic, no underline, and no element with a handler (the icons of the page are svg, and have none).
    for (const tag of ['script', 'img', 'b', 'i', 'u']) {
      const inIssue = [...container.querySelectorAll(tag)].filter((element) => !element.closest('.doc-html'));
      expect(inIssue, tag).toHaveLength(0);
    }
    expect(container.querySelectorAll('[onload], [onerror]')).toHaveLength(0);
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  // The test above shows the places that every state shows. These show the places that only some states show, one test for each: the options of a decision that is answered or closed,
  // the note of an answer, the doc of a linked section, the words that the server gives for a failed answer, and the sentence about what is wrong with the body of an issue. Each of these
  // places must put the words in as text. A place that switched to html would show an element that the text made, and one of these tests would fail.
  const SCRIPT = '<script>window.__pwned = true</script>';
  const IMG = '<img src=x onerror="window.__pwned = true">';

  /** The words are on the page as they are, and made no element outside the docs' own html: no script, picture, bold, italic or underline, no handler, and nothing ran. */
  function expectOnlyText(words: string[]): void {
    for (const word of words) expect(text(), word).toContain(word);
    for (const tag of ['script', 'img', 'b', 'i', 'u']) {
      expect([...container.querySelectorAll(tag)].filter((element) => !element.closest('.doc-html')), tag).toHaveLength(0);
    }
    expect(container.querySelectorAll('[onload], [onerror]')).toHaveLength(0);
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  }

  it('issue text is plain text in the options of an answered decision', async () => {
    // OptionList: the list of a decision that has no form.
    server.detail = {
      status: 200,
      body: good(
        answered({
          options: [
            { id: 'A', text: `Show <i>this</i> as it is ${SCRIPT}` },
            { id: 'B', text: `Strip it ${IMG}` },
          ],
        }),
      ),
    };
    await show();
    expect(container.querySelector('form')).toBeNull();
    expectOnlyText([`Show <i>this</i> as it is ${SCRIPT}`, `Strip it ${IMG}`]);
  });

  it('issue text is plain text in the note of an answer', async () => {
    // DecisionCard: the answer of an answered decision, with the note that Mark's comment has.
    server.detail = { status: 200, body: good(detail({ state: 'answered', answer: { option: 'C', note: `Because <b>bold</b> ${IMG} and ${SCRIPT}`, at: '2026-10-06T11:00:00Z', complete: true } })) };
    await show();
    expectOnlyText([`Because <b>bold</b> ${IMG} and ${SCRIPT}`]);
  });

  it('issue text is plain text in the doc and the heading of a linked section', async () => {
    // LinkedSection: the bar with the doc and the heading id that the issue names, the label of the section, and the notice for a heading that is not there.
    const docId = 'docs/<b>bold</b>/<i>x</i>.md';
    const anchor = `<u>head</u>${IMG}`;
    server.detail = {
      status: 200,
      body: good(detail({ docs: [{ docId, slug: 'bold/x', anchor, heading: null }], sections: [{ docId, anchor, heading: null, html: null }] })),
    };
    await show();
    expectOnlyText([docId, `#${anchor}`]);
    // The label of the section is the same words, as an attribute (not read as html either).
    expect(container.querySelector('section[aria-label]:not([aria-label="Decision"])')?.getAttribute('aria-label')).toBe(`${docId}#${anchor}`);
  });

  it('issue text is plain text in the error of a failed answer', async () => {
    // FailureBox: the message that the server gives. It holds the words of gh, which can hold anything that an issue or a label name holds.
    server.answers = [{ status: 502, body: { ok: false, step: 'label', error: { code: 'gh-failed', message: `gh said ${SCRIPT} and <b>stop</b> ${IMG}` } } }];
    await show();
    await choose('A');
    await press(sendButton());
    expect(alert()).not.toBeNull();
    expectOnlyText([`gh said ${SCRIPT} and <b>stop</b> ${IMG}`]);
  });

  it('issue text is plain text in the sentence about a problem with the body', async () => {
    // Notice: the problem that the server found. The server's own words, and it must not become html either, whatever words come into it.
    server.detail = { status: 200, body: good(detail({ question: '', options: [], recommended: null, problem: `The body has <b>marks</b> ${SCRIPT}` })) };
    await show();
    expectOnlyText([`The body has <b>marks</b> ${SCRIPT}`]);
  });

  it('a missing anchor shows a notice, not an error', async () => {
    server.detail = {
      status: 200,
      body: good(
        detail({
          docs: [
            { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'storage', heading: 'Storage' },
            { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'no-such-heading', heading: null },
          ],
          sections: [
            { docId: 'docs/guides/setup.md', anchor: 'storage', heading: 'Storage', html: '<h2 id="storage">Storage</h2><p>Burrow keeps its data in one folder.</p>' },
            { docId: 'docs/guides/setup.md', anchor: 'no-such-heading', heading: null, html: null },
          ],
        }),
      ),
    };
    await show();
    const missing = container.querySelector('section[aria-label="docs/guides/setup.md#no-such-heading"]');
    expect(missing?.querySelector('[role="note"]')?.textContent).toContain('This section was not found in the docs: docs/guides/setup.md#no-such-heading');
    // A notice and not an error: nothing is announced as an alert, the panel has no error state, and the other section is shown as usual.
    expect(alert()).toBeNull();
    expect(text()).not.toContain('Retry');
    expect(container.querySelector('section[aria-label="docs/guides/setup.md#storage"]')?.textContent).toContain('Burrow keeps its data in one folder.');
    // The link to the doc stays, so that Mark can look for the heading.
    expect(missing?.querySelector('a[href="/docs/guides/setup#no-such-heading"]')).not.toBeNull();
  });

  it('says that no decision has the number, with no retry, for a number that the server does not have', async () => {
    server.detail = { status: 404, body: { ok: false, error: { code: 'decision-not-found', message: 'No open decision has the number 41.' }, updatedAt: null, lastGood: null } };
    await show();
    expect(container.querySelector('h1')?.textContent).toBe('No decision has the number 41');
    expect(text()).toContain('No open decision has the number 41.');
    expect(text()).not.toContain('Retry');
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    // A number that cannot be an issue number does not even ask the server.
    const before = server.gets;
    await show('abc');
    expect(container.querySelector('h1')?.textContent).toBe('This is not the number of a decision');
    expect(server.gets).toBe(before);
  });

  it('shows the error of the panel with its Retry button, and the last decision under it, when the server cannot read GitHub', async () => {
    server.detail = {
      status: 200,
      body: { ok: false, error: { code: 'gh-offline', message: 'GitHub cannot be reached.' }, updatedAt: '2026-10-06T11:00:00Z', lastGood: { data: detail(), updatedAt: '2026-10-06T11:00:00Z' } },
    };
    await show();
    expect(alert()?.textContent).toContain('GitHub cannot be reached.');
    expect(text()).toContain('Retry');
    expect(text()).toContain('Where should the cache live?'); // the last good decision
    expect(text()).toContain('Last updated');
  });
});

describe('the answer form', () => {
  it('has a radio button for each option, a note box and a Send button that waits for a choice', async () => {
    await show();
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(noteBox()?.getAttribute('maxlength')).toBe(String(MAX_NOTE_CHARS)); // the number of the server, from the shared types: the box stops where the server would refuse
    expect(sendButton()?.textContent).toContain('Send answer');
    expect(sendButton()?.disabled).toBe(true); // nothing is chosen
    await choose('B');
    expect(radio('B')?.checked).toBe(true);
    expect(sendButton()?.disabled).toBe(false);
  });

  it('sends the option and the note with the token of the page, once, and shows the answered decision when the server says so', async () => {
    await show();
    await choose('C');
    await typeNote('Because it keeps the cache over a restart.');
    server.detail = { status: 200, body: good(answered()) }; // what the server will say when the page reads the decision again
    await press(sendButton());

    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.body).toEqual({ option: 'C', note: 'Because it keeps the cache over a restart.' });
    expect(server.posts[0]?.headers.get('x-cc-token')).toBe('token-for-the-test');
    expect(server.posts[0]?.headers.get('content-type')).toBe('application/json');
    // The page read the decision again at once (it does not wait for an event), and shows it as answered: no form, the answer, the chosen option marked.
    expect(container.querySelector('form')).toBeNull();
    expect(text()).toContain('Answered');
    expect(text()).toContain('Mark answered C');
    expect(text()).toContain('Because it keeps the cache.');
    expect(text()).toContain("Mark's answer");
  });

  it('leaves the note out of the request when it is empty', async () => {
    await show();
    await choose('A');
    await press(sendButton());
    expect(server.posts[0]?.body).toEqual({ option: 'A' });
  });

  it('a write failure shows an error state and keeps the choice and the note in the form', async () => {
    server.answers = [
      { status: 502, body: { ok: false, step: 'label', error: { code: 'gh-failed', message: 'gh failed: failed to change the labels: HTTP 502: Bad Gateway' } } },
      { status: 200, body: { ok: true } },
    ];
    await show();
    await choose('B');
    await typeNote('Because the temp folder is cleaned for us.');
    await press(sendButton());

    // The error is shown, in words that say what is done and what is not, with the message of gh and the code.
    expect(alert()?.textContent).toContain('Your answer is posted on GitHub as a comment, but the labels of the issue were not changed.');
    expect(alert()?.textContent).toContain('failed to change the labels: HTTP 502: Bad Gateway');
    expect(alert()?.textContent).toContain('gh-failed');
    expect(alert()?.textContent).toContain('does not post the comment a second time');
    // The icon of the error is ink: with the state chip and the Retry button, an amber icon would be a third amber item, and the Look allows one or two on a page.
    expect(alert()?.querySelector('svg')?.getAttribute('class')).toContain('text-cc-ink');
    expect(alert()?.outerHTML).not.toContain('cc-accent');
    // The form still has the choice and the note, and offers a retry.
    expect(radio('B')?.checked).toBe(true);
    expect(noteBox()?.value).toBe('Because the temp folder is cleaned for us.');
    expect(sendButton()?.textContent).toContain('Retry');
    expect(sendButton()?.disabled).toBe(false);
    // The page read the decision again (GitHub may have changed), and the form is still there.
    expect(server.gets).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('form')).not.toBeNull();

    // The retry sends the same choice and the same note, and clears the error when it works.
    server.detail = { status: 200, body: good(answered()) };
    await press(sendButton());
    expect(server.posts.map((post) => post.body)).toEqual([
      { option: 'B', note: 'Because the temp folder is cleaned for us.' },
      { option: 'B', note: 'Because the temp folder is cleaned for us.' },
    ]);
    expect(alert()).toBeNull();
    expect(text()).toContain('Answered');
  });

  it('says in words which step failed: the comment, the label swap or the close, and when nothing was written', async () => {
    const steps: [object, string][] = [
      [{ step: 'comment', error: { code: 'gh-offline', message: 'GitHub cannot be reached.' } }, 'Your answer was not posted on GitHub.'],
      [{ step: 'close', error: { code: 'gh-failed', message: 'gh failed: x' } }, 'Your answer is posted and the labels are changed, but the issue is not closed.'],
      [{ error: { code: 'already-answered', message: 'Decision #41 is already answered: A.' } }, 'Your answer was not sent.'],
      [{ error: { code: 'label-missing', message: 'The label "decided" does not exist in fixture-owner/fixture-repo.' }, step: 'label' }, 'the labels of the issue were not changed'],
    ];
    for (const [body, words] of steps) {
      server.answers = [{ status: 502, body: { ok: false, ...body } }];
      server.posts = [];
      await show();
      await choose('A');
      await press(sendButton());
      expect(alert()?.textContent, JSON.stringify(body)).toContain(words);
      act(() => root.render(<div />)); // the next round starts with a fresh page
      await settle();
    }
  });

  it('keeps the choice and the note when the page draws its data again after a reload that failed', async () => {
    await show();
    await choose('C');
    await typeNote('A note that must survive.');
    // The server tells the page that something changed, and then it cannot read GitHub: the panel draws its last good data in another place, with an error.
    server.detail = {
      status: 200,
      body: { ok: false, error: { code: 'gh-not-signed-in', message: 'gh is not signed in to GitHub.' }, updatedAt: '2026-10-06T12:00:00Z', lastGood: { data: detail(), updatedAt: '2026-10-06T12:00:00Z' } },
    };
    await act(async () => {
      FakeEventSource.instance?.emit('changed', { module: 'decisions', at: '2026-10-06T12:01:00Z' });
    });
    await settle();
    expect(text()).toContain('gh is not signed in to GitHub.');
    expect(radio('C')?.checked).toBe(true);
    expect(noteBox()?.value).toBe('A note that must survive.');
    // And it comes back whole when GitHub can be read again.
    server.detail = { status: 200, body: good(detail()) };
    await act(async () => {
      FakeEventSource.instance?.emit('changed', { module: 'decisions', at: '2026-10-06T12:02:00Z' });
    });
    await settle();
    expect(alert()).toBeNull();
    expect(radio('C')?.checked).toBe(true);
    expect(noteBox()?.value).toBe('A note that must survive.');
  });

  it('sends one request for a double click: the button and the fields are off while the answer is on its way', async () => {
    await show();
    await choose('A');
    holdNext = true;
    const button = sendButton();
    await act(async () => {
      button?.click();
    });
    await settle();
    expect(server.posts).toHaveLength(1);
    expect(sendButton()?.disabled).toBe(true);
    expect(sendButton()?.textContent).toContain('Sending');
    expect(noteBox()?.disabled).toBe(true);
    await act(async () => {
      sendButton()?.click();
      sendButton()?.click();
      // The form can also be sent by another way than the button (the Enter key in a field of it): the form refuses while an answer is on its way.
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(server.posts).toHaveLength(1);
    // The answer arrives.
    server.detail = { status: 200, body: good(answered()) };
    await act(async () => {
      release?.();
    });
    await settle();
    expect(server.posts).toHaveLength(1);
    expect(text()).toContain('Answered');
  });

  it('draws the form only for an open decision that has options; an answered one shows the answer and the options without buttons', async () => {
    server.detail = { status: 200, body: good(answered()) };
    await show();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.querySelector('ol[aria-label="Options"]')?.textContent).toContain('Move the cache to a new folder next to the data folder.');
    expect(text()).toContain('Mark answered C');

    // Closed with no complete answer: a notice, the options, and no form.
    server.detail = { status: 200, body: good(detail({ state: 'closed', answer: { option: 'A', note: null, at: '2026-10-05T16:00:00Z', complete: false } })) };
    await act(async () => {
      FakeEventSource.instance?.emit('changed', { module: 'decisions', at: 'x' });
    });
    await settle();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('closed on GitHub');
    expect(container.querySelector('ol[aria-label="Options"]')).not.toBeNull();

    // An open decision with no options (a body outside the template): the problem, and no form.
    server.detail = { status: 200, body: good(detail({ question: '', options: [], recommended: null, docs: [], sections: [], problem: 'The body of this issue does not follow the decision template.' })) };
    await act(async () => {
      FakeEventSource.instance?.emit('changed', { module: 'decisions', at: 'y' });
    });
    await settle();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('does not follow the decision template');
  });

  it('starts from an answer that stopped half way: the option is chosen and the note is in the box, so that Retry finishes it', async () => {
    server.detail = { status: 200, body: good(detail({ answer: { option: 'B', note: 'Posted, but not finished.', at: '2026-10-06T11:00:00Z', complete: false } })) };
    await show();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('An answer was posted on GitHub as a comment (option B)');
    expect(radio('B')?.checked).toBe(true);
    expect(noteBox()?.value).toBe('Posted, but not finished.');
    expect(sendButton()?.disabled).toBe(false);
    server.detail = { status: 200, body: good(answered()) };
    await press(sendButton());
    expect(server.posts[0]?.body).toEqual({ option: 'B', note: 'Posted, but not finished.' });
  });

  it('lets Mark pick another option for an answer that stopped half way, and sends that one with the note that he types', async () => {
    server.detail = { status: 200, body: good(detail({ answer: { option: 'B', note: 'Posted, but not finished.', at: '2026-10-06T11:00:00Z', complete: false } })) };
    await show();
    await choose('A');
    await typeNote('I changed my mind.');
    expect(radio('A')?.checked).toBe(true);
    expect(noteBox()?.value).toBe('I changed my mind.');
    await press(sendButton());
    expect(server.posts[0]?.body).toEqual({ option: 'A', note: 'I changed my mind.' });
  });
});

describe('the banner on a doc page', () => {
  const DOC: DocPage & { decisions?: readonly DocDecision[] | null } = {
    id: 'docs/guides/setup.md',
    slug: 'guides/setup',
    title: 'Setup guide',
    type: 'guide',
    status: 'approved',
    updated: '2026-01-10',
    updatedFrom: 'frontmatter',
    html: '<h1 id="setup-guide">Setup guide</h1><p>Intro.</p><h2 id="installing">Installing</h2><p>Install it.</p><h2 id="storage">Storage</h2><p>Storage text.</p>',
    headings: [
      { level: 2, text: 'Installing', id: 'installing' },
      { level: 2, text: 'Storage', id: 'storage' },
    ],
    backlinks: [],
    brokenLinks: [],
    frontmatterError: null,
  };
  const DECISION: DocDecision = { number: 41, title: 'Decision: Where should the cache live?', anchor: 'storage' };

  const renderDoc = (doc: typeof DOC) =>
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/docs/guides/setup']}>
          <DocView doc={doc} />
        </MemoryRouter>,
      );
    });

  it('shows the banner in front of the heading that the decision links to, with the question as text and a link to the decision', () => {
    renderDoc({ ...DOC, decisions: [DECISION] });
    const banner = container.querySelector('aside[aria-label="Open decision 41"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('A decision waits for Mark on this section');
    expect(banner?.textContent).toContain('Where should the cache live?');
    expect(banner?.textContent).not.toContain('Decision: Where'); // the prefix of the template is left off
    expect(banner?.querySelector('a[href="/decisions/41"]')?.textContent).toContain('Decision #41');
    // The banner is right in front of the heading "Storage", after the text of "Installing", and in no other place.
    const order = [...container.querySelectorAll('.doc-html > *')].map((part) => (part.tagName.toLowerCase() === 'aside' ? 'banner' : part.querySelector('h2#storage') ? 'storage' : part.querySelector('h2#installing') ? 'installing' : 'other'));
    expect(order).toEqual(['installing', 'banner', 'storage']);
    expect(container.querySelectorAll('aside[aria-label^="Open decision"]')).toHaveLength(1);
    // A page with one banner has it in amber: it is the first one.
    expect(banner?.className).toContain('border-cc-accent');
  });

  it('draws the first banner of the page in amber and the others in the lavender frame, so that the page keeps to the amber items of the Look', () => {
    // The list of the decisions is not in the order of the page. The order of the page is 47 (no such heading: above the doc), 43 and 41 (Installing), then 41 (Storage).
    const decisions: DocDecision[] = [
      { number: 41, title: 'Decision: A?', anchor: 'storage' },
      { number: 43, title: 'Decision: B?', anchor: 'installing' },
      { number: 41, title: 'Decision: A?', anchor: 'installing' },
      { number: 47, title: 'Decision: C?', anchor: 'no-such-heading' },
    ];
    renderDoc({ ...DOC, decisions });
    const banners = [...container.querySelectorAll('aside[aria-label^="Open decision"]')];
    expect(banners.map((banner) => banner.getAttribute('aria-label'))).toEqual(['Open decision 47', 'Open decision 43', 'Open decision 41', 'Open decision 41']);
    const [first, ...others] = banners;
    expect(first?.className).toContain('border-cc-accent');
    expect(first?.className).toContain('cc-focal');
    expect(first?.querySelector('svg')?.getAttribute('class')).toContain('text-cc-accent');
    expect(others).toHaveLength(3);
    for (const banner of others) {
      expect(banner.className).toContain('border-cc-rule-solid');
      expect(banner.className).not.toContain('cc-focal');
      expect(banner.querySelector('svg')?.getAttribute('class')).toContain('text-cc-ink');
      expect(banner.outerHTML).not.toContain('cc-accent'); // no amber in the frame, the icon or the text
    }

    // The amber one is the first of the page as it is now: when the decisions change, the next banner takes it.
    renderDoc({ ...DOC, decisions: decisions.slice(0, 2) });
    const later = [...container.querySelectorAll('aside[aria-label^="Open decision"]')];
    expect(later.map((banner) => [banner.getAttribute('aria-label'), banner.className.includes('border-cc-accent')])).toEqual([
      ['Open decision 43', true],
      ['Open decision 41', false],
    ]);
  });

  it('shows a banner for a heading that the doc does not have above the whole doc, so that it never disappears', () => {
    renderDoc({ ...DOC, decisions: [{ number: 41, title: 'Decision: Q?', anchor: 'no-such-heading' }] });
    const first = container.querySelector('.doc-html')?.firstElementChild;
    expect(first?.tagName.toLowerCase()).toBe('aside');
  });

  it('shows a title with markup as text', () => {
    renderDoc({ ...DOC, decisions: [{ number: 7, title: 'Decision: <script>window.__pwned = true</script>', anchor: 'storage' }] });
    expect(container.querySelector('aside[aria-label="Open decision 7"]')?.textContent).toContain('<script>window.__pwned = true</script>');
    expect(container.querySelector('aside script')).toBeNull();
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('draws nothing for a doc with no decisions, and says that the banners are missing when the decisions could not be read', () => {
    const banners = () => container.querySelectorAll('aside[aria-label^="Open decision"]');
    renderDoc({ ...DOC, decisions: [] });
    expect(banners()).toHaveLength(0);
    expect(container.querySelector('[role="note"]')).toBeNull();
    renderDoc({ ...DOC, decisions: null });
    expect(banners()).toHaveLength(0);
    expect(container.querySelector('[role="note"]')?.textContent).toContain('Decision banners are not shown on this page');
    // A doc that comes with no `decisions` field at all (the other users of DocView) is drawn as before.
    renderDoc({ ...DOC });
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('DecisionBanner on its own: the number of the decision is in the link and the label, and only the lead banner is amber', () => {
    const show = (lead: boolean) =>
      act(() => {
        root.render(
          <MemoryRouter>
            <DecisionBanner decision={{ number: 12, title: 'Decision: Use the new folder?', anchor: 'x' }} lead={lead} />
          </MemoryRouter>,
        );
      });
    show(true);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/decisions/12');
    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('Open decision 12');
    expect(container.querySelector('aside')?.outerHTML).toContain('cc-accent');
    show(false);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/decisions/12');
    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('Open decision 12');
    expect(container.querySelector('aside')?.outerHTML).not.toContain('cc-accent');
  });
});
