import type { Page, Route } from '@playwright/test';
import { liveAnswer, snapshot } from '../../fixtures/hosted/world';

// The Vercel functions, played by page.route() (design.md section 6). A test sets what each endpoint answers and can change it while the page runs, for
// example to make the next poll fail. Every request to /api/ that no rule here expects is recorded in `unexpected`, and a test checks that the list is empty:
// the hosted page must not ask for /api/health, /api/events or any other endpoint of the local server.

export type Reply = {
  status?: number;
  /** A JSON body. */
  json?: unknown;
  /** A text body (used when `json` is not given). */
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  /** Waits this long before it answers, in real time (the page clock of the test does not apply to the route handler). */
  delayMs?: number;
};

export type Mock = {
  snapshot: Reply | (() => Reply);
  live: Reply | (() => Reply);
  /** The text of a doc by repo path, or null for a 404. */
  docs: (path: string) => string | null;
  /** What `POST /api/answer` answers. A function gets the parsed body of the request. */
  answer: Reply | ((body: unknown) => Reply);
  /** `answer` holds every request body that the page posted, and the headers that the test checks. */
  hits: { snapshot: number; live: number; docs: string[]; answer: { body: unknown; contentType: string | undefined; method: string }[] };
  unexpected: string[];
};

const resolveReply = (reply: Reply | (() => Reply)): Reply => (typeof reply === 'function' ? reply() : reply);

export async function mockApi(page: Page, initial: Partial<Pick<Mock, 'snapshot' | 'live' | 'docs' | 'answer'>> = {}): Promise<Mock> {
  const mock: Mock = {
    snapshot: initial.snapshot ?? { json: snapshot() },
    live: initial.live ?? { json: liveAnswer('not-running') },
    docs: initial.docs ?? (() => null),
    answer: initial.answer ?? { status: 500, json: { ok: false, error: { code: 'not-mocked', message: 'The test did not mock the answer.' } } },
    hits: { snapshot: 0, live: 0, docs: [], answer: [] },
    unexpected: [],
  };

  async function answer(route: Route, reply: Reply): Promise<void> {
    if (reply.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    await route.fulfill({
      status: reply.status ?? 200,
      ...(reply.json !== undefined ? { json: reply.json } : { body: reply.body ?? '', contentType: reply.contentType ?? 'application/json' }),
      ...(reply.headers === undefined ? {} : { headers: reply.headers }),
    });
  }

  // The first rule is the last to match (Playwright tries the newest rule first), so this one catches only what nothing below answers.
  await page.route('**/api/**', async (route) => {
    mock.unexpected.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 404, json: { error: 'not mocked', kind: 'test' } });
  });
  await page.route('**/api/snapshot', async (route) => {
    mock.hits.snapshot += 1;
    await answer(route, resolveReply(mock.snapshot));
  });
  await page.route('**/api/live', async (route) => {
    mock.hits.live += 1;
    await answer(route, resolveReply(mock.live));
  });
  await page.route('**/api/answer', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as unknown;
    mock.hits.answer.push({ body, contentType: request.headers()['content-type'], method: request.method() });
    await answer(route, typeof mock.answer === 'function' ? mock.answer(body) : mock.answer);
  });
  await page.route(/\/api\/docs\/.+/, async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/docs/'.length);
    mock.hits.docs.push(path);
    const text = mock.docs(path);
    if (text === null) await route.fulfill({ status: 404, json: { error: 'not found', kind: 'not-found' } });
    else await route.fulfill({ status: 200, body: text, contentType: 'text/markdown; charset=utf-8' });
  });
  return mock;
}

/** Hides the tab (the page sees `document.visibilityState === 'hidden'` and a `visibilitychange` event), or shows it again. */
export async function setTabVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((show) => {
    Object.defineProperty(document, 'visibilityState', { value: show ? 'visible' : 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: !show, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}
