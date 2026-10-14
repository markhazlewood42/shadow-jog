import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { NOW, liveAnswer, liveState, richWorld, snapshot } from '../../fixtures/hosted/world';
import { expectAtMostTwoAmberItems } from '../look';
import { type Mock, mockApi, setTabVisible } from './mock-api';

// The hosted page in a browser (design.md sections 4.3, 5.9 and 7). There is no Command Center server here: the page is the VITE_HOSTED build served by
// `vite preview`, and every test plays the Vercel functions with page.route() (see mock-api.ts and playwright.hosted.config.ts).
// The clock of the page starts at NOW, so ages and the 14-day rule are the same on every day the test runs.
//
// If CC_SHOTS_DIR is set, two tests also save a picture there (the Workstreams view and an error state). The tests never write into the repo.

const SHOTS_DIR = process.env.CC_SHOTS_DIR;
async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, name), fullPage: true });
}

const world = richWorld();
const workstreams = (page: Page) => page.getByRole('region', { name: 'Workstreams', exact: true });
const notice = (page: Page) => page.getByRole('status').filter({ hasText: /Reporter|Live data/ });

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
  page.on('console', (message) => {
    // A mocked 4xx or 5xx answer makes Chromium log "Failed to load resource". That is the browser's note about the test's own mock, not a fault of the page.
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('Failed to load resource')) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

/**
 * Moves the clock of the page forward in steps of one second. The page schedules its next poll when the answer of the last one has arrived, which takes real time, so one
 * big jump would skip polls. After each step the test waits a moment, so that the answers arrive.
 */
async function advance(page: Page, ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 1000) {
    await page.clock.runFor(1000);
    await page.waitForTimeout(15);
  }
}

/** The page asks the functions it knows and no other endpoint. */
const expectNoStrayRequests = (mock: Mock) => expect(mock.unexpected).toEqual([]);

test.describe('the Workstreams view', () => {
  test('shows one card for each workstream, grouped by roadmap lane, with the PR, the checks, the live session, the worktree and the blocking decision', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');

    await expect(page).toHaveTitle('Workstreams · Shadow Jog Command Center');
    await expect(workstreams(page)).toContainText(/Updated \d\d:\d\d:\d\d/);

    const engine = page.getByRole('region', { name: 'Engine path' });
    const card = engine.getByRole('article', { name: 'M6 flip default' });
    await expect(card).toContainText('In review');
    await expect(card).toContainText('engine-m6-flip');
    await expect(card).toContainText('Roadmap M1');
    await expect(card.getByRole('link', { name: /M6: flip the default/ })).toHaveAttribute('href', /\/pull\/41$/);
    await expect(card).toContainText('Approved');
    await expect(card).toContainText('Checks passed');
    await expect(card.getByRole('list', { name: 'Live sessions' })).toContainText('Flip the default');
    await expect(card.getByRole('list', { name: 'Live sessions' })).toContainText('working');
    await expect(card).toContainText('C:/work/shadow-jog-m6');
    await expect(card).toContainText('2 changed');
    await expect(card).not.toContainText('Next for Mark');
    await expect(card.getByRole('link', { name: 'Decision #61' })).toHaveAttribute('href', '/decisions/61');

    // The lane order is the roadmap's. A card with no PR says so. The PR decides "merged": the file of this card says "active".
    await expect(page.getByRole('region', { name: 'Side paths' }).getByRole('article', { name: 'Side lab' })).toContainText('No PR');
    const merged = engine.getByRole('article', { name: 'Recent merged' });
    await expect(merged).toContainText('Merged');
    await expect(merged).not.toContainText('Active');

    expectNoStrayRequests(mock);
    await shot(page, 'workstreams-view.png');
  });

  test('shows a bad file as a row with its path and its error, and a bot branch as a neutral "no workstream" row', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');

    const invalid = page.getByRole('region', { name: 'Invalid workstream files' });
    await expect(invalid).toContainText('docs/workstreams/broken-file.md');
    await expect(invalid).toContainText('state must be one of active, review, blocked, parked, merged');
    await expect(invalid.getByRole('listitem')).toHaveCount(1);

    const none = page.getByRole('region', { name: 'Branches with no workstream' });
    await expect(none).toContainText('dependabot/npm_and_yarn/vite-9');
    await expect(none).toContainText('no workstream');
    await expect(none.getByRole('link', { name: 'PR #55' })).toBeVisible();
    // The bot branch is not in the red list.
    await expect(invalid).not.toContainText('dependabot');

    // The bad file is the focal item of the page; the Look allows two amber items.
    await expectAtMostTwoAmberItems(page);
  });

  test('hides a merged workstream 14 days after its PR merged, and says how many it hid', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(page.getByRole('article', { name: 'Recent merged' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Old merged' })).toHaveCount(0);
    await expect(workstreams(page)).toContainText('1 merged row older than 14 days is hidden');
  });

  test('shows "Loading" until the snapshot arrives', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot, delayMs: 1500 }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(workstreams(page).getByRole('status')).toContainText('Loading');
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();
  });

  test('shows the error of a failed snapshot with its reason and a Retry button, and recovers on Retry', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { status: 502, json: { error: 'the store could not be reached', kind: 'store-error' } }, live: { json: world.live } });
    await page.goto('/workstreams');

    const panel = workstreams(page);
    await expect(panel.getByRole('alert')).toContainText('The server answered 502: the store could not be reached.');
    await expect(panel.getByRole('alert')).toContainText('http-502');
    await expect(panel).toContainText('Not updated yet');
    await shot(page, 'workstreams-error-502.png');

    mock.snapshot = { json: world.snapshot };
    await panel.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });

  test('names the reporter when it is not running, and keeps the pushed work on the page', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: liveAnswer('not-running') } });
    await page.goto('/workstreams');
    await expect(notice(page)).toContainText('Reporter not running');
    const card = page.getByRole('article', { name: 'M6 flip default' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('list', { name: 'Live sessions' })).toHaveCount(0);
  });

  test('says "reporter offline since" and keeps the last sessions of a reporter that stopped writing', async ({ page }) => {
    await mockApi(page, {
      snapshot: { json: world.snapshot },
      live: { json: liveAnswer('offline', { ...(world.live.live as ReturnType<typeof liveState>), writtenAt: '2026-10-12T11:50:00.000Z' }) },
    });
    await page.goto('/workstreams');
    await expect(notice(page)).toContainText(/Reporter offline since \d\d:\d\d:\d\d/);
    await expect(page.getByRole('article', { name: 'M6 flip default' }).getByRole('list', { name: 'Live sessions' })).toContainText('Flip the default');
  });

  test('says that the live value is unreadable when the reporter wrote something else than the contract', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: { reporter: { state: 'online', writtenAt: '2026-10-12T12:00:00.000Z', ageSeconds: 1, offlineAfterSeconds: 150 }, live: { writtenAt: '2026-10-12T12:00:00.000Z', sessions: 7, worktrees: [] } } } });
    await page.goto('/workstreams');
    await expect(notice(page)).toContainText('Live data is unreadable: sessions must be a list');
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();
  });
});

test.describe('the Now page on the hosted data layer', () => {
  test('fills Your move from the decisions and the live asks (no PR), the Pull requests panel from the PRs, and Running from the live sessions', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/');

    const yourMove = page.getByRole('region', { name: 'Your move', exact: true });
    await expect(yourMove).toContainText(/Updated \d\d:\d\d:\d\d/);
    const list = yourMove.getByRole('list', { name: 'What waits for Mark' });
    await expect(list).toContainText('Decision #61: Who owns the ruleset?');
    await expect(list.getByRole('link', { name: 'Rename the required checks in the ruleset (session: Flip the default)' })).toHaveAttribute('href', '/agents#session-s1');
    // A PR is not a source of Your move any more: it shows in the Pull requests panel only.
    await expect(list).not.toContainText('PR #41');
    // Decisions first, then the live asks. Every item has a link to a place to act.
    const lines = await list.getByRole('listitem').allInnerTexts();
    expect(lines[0]).toContain('Decision #61');
    expect(lines[1]).toContain('Rename the required checks');
    expect(lines).toHaveLength(2);
    await expect(yourMove.getByRole('note', { name: 'Incomplete list' })).toHaveCount(0);

    await expect(page.getByRole('region', { name: 'Running', exact: true })).toContainText('Flip the default');
    await expect(page.getByRole('region', { name: 'Pull requests', exact: true })).toContainText('M6: flip the default');
    // The Live label follows the polls, not an event stream.
    await expect(page.getByText('Live: on')).toBeVisible();
    // The Links panel is made on the page: the repo, and the roadmap of this site.
    await expect(page.getByRole('region', { name: 'Links', exact: true }).getByRole('link', { name: 'GitHub repo' })).toHaveAttribute('href', 'https://github.com/markhazlewood42/shadow-jog');
    // The navigation has the Workstreams link in the hosted build.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workstreams' })).toHaveAttribute('href', '/workstreams');
    expectNoStrayRequests(mock);
  });

  test('hides every live ask and says "Reporter offline" when the live key is older than 150 s, and keeps the decisions and the PRs', async ({ page }) => {
    await mockApi(page, {
      snapshot: { json: world.snapshot },
      live: { json: liveAnswer('offline', { ...(world.live.live as ReturnType<typeof liveState>), writtenAt: '2026-10-12T11:50:00.000Z' }) },
    });
    await page.goto('/');
    const yourMove = page.getByRole('region', { name: 'Your move', exact: true });
    const list = yourMove.getByRole('list', { name: 'What waits for Mark' });
    await expect(list).toContainText('Decision #61: Who owns the ruleset?');
    await expect(list).not.toContainText('PR #41');
    await expect(list).not.toContainText('Rename the required checks');
    await expect(yourMove.getByRole('note', { name: 'Incomplete list' })).toContainText(/Reporter offline since \d\d:\d\d:\d\d\. Live asks are hidden\./);
  });

  test('shows "Reporter not running" in the Running panel and on the Agents page, never a blank box', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: liveAnswer('not-running') } });
    await page.goto('/');
    const running = page.getByRole('region', { name: 'Running', exact: true });
    await expect(running.getByRole('alert')).toContainText('Reporter not running');
    await expect(running.getByRole('alert')).toContainText('reporter-not-running');
    await expect(running.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Agents' }).click();
    await expect(page.getByRole('region', { name: 'Agents', exact: true }).getByRole('alert')).toContainText('Reporter not running');
  });

  test('draws the live sessions on the Agents page, with one box for each agent: label, state, model and run time', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/agents');
    const agents = page.getByRole('region', { name: 'Agents', exact: true });
    await expect(agents).toContainText('Flip the default');
    // The note of the first build is gone: the boxes are drawn here too.
    await expect(page.getByText(/Sessions only/)).toHaveCount(0);
    const boxes = agents.locator('[data-box="agent"]');
    await expect(boxes).toHaveCount(3);
    const box = (label: string) => agents.locator('[data-box="agent"]').filter({ hasText: label });
    await expect(box('runner')).toHaveAttribute('data-state', 'running');
    await expect(box('runner')).toContainText('sonnet · 3 min');
    await expect(box('builder')).toHaveAttribute('data-state', 'running');
    await expect(box('builder')).toContainText('fable · 9 min');
    await expect(box('reader')).toHaveAttribute('data-state', 'done');
    await expect(box('reader')).toContainText('done');

    // The whole last box is in the panel: no frame clips its lower border. The check runs at once, while the entry animation of the boxes (a fade and a slide of 8 px) may
    // still run: a box that slides is 8 px lower than its place, and the cluster has room for that. Then it runs again when the animations have ended.
    const expectLastBoxInPanel = async () => {
      const panel = await agents.boundingBox();
      const last = await boxes.last().boundingBox();
      const cluster = await agents.locator('[data-cluster]').first().boundingBox();
      if (panel === null || last === null || cluster === null) throw new Error('the panel, the cluster or the last box has no box on the page');
      expect(last.y + last.height).toBeLessThanOrEqual(cluster.y + cluster.height);
      expect(cluster.y + cluster.height).toBeLessThan(panel.y + panel.height);
    };
    await expectLastBoxInPanel();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await expectLastBoxInPanel();
    // The hosted page has no file path, so no box has a Copy button (the session box too).
    await expect(agents.getByRole('button', { name: 'Copy path' })).toHaveCount(0);
    await shot(page, 'hosted-agents-2.png');
  });

  test('keeps the Reporter offline error on the Agents page', async ({ page }) => {
    await mockApi(page, {
      snapshot: { json: world.snapshot },
      live: { json: liveAnswer('offline', { ...(world.live.live as ReturnType<typeof liveState>), writtenAt: '2026-10-12T11:50:00.000Z' }) },
    });
    await page.goto('/agents');
    await expect(page.getByRole('region', { name: 'Agents', exact: true }).getByRole('alert')).toContainText('Reporter offline');
  });

  test('shows the Status panel error when main has no status.md, and keeps the other rows', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/');
    const status = page.getByRole('region', { name: 'Status', exact: true });
    await expect(status).toContainText('Unavailable');
    await expect(status).toContainText('status-missing');
    await expect(status).toContainText(/CI on main/);
  });
});

test.describe('polling', () => {
  test('polls /api/snapshot every 15 s and /api/live every 10 s while the tab is visible, pauses when it is hidden, and refreshes when it shows', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();
    const start = { snapshot: mock.hits.snapshot, live: mock.hits.live };

    await advance(page, 31_000);
    expect(mock.hits.snapshot - start.snapshot).toBe(2);
    expect(mock.hits.live - start.live).toBe(3);

    await setTabVisible(page, false);
    const hidden = { snapshot: mock.hits.snapshot, live: mock.hits.live };
    await advance(page, 60_000);
    expect(mock.hits.snapshot - hidden.snapshot).toBe(0);
    expect(mock.hits.live - hidden.live).toBe(0);

    await setTabVisible(page, true);
    await expect.poll(() => mock.hits.snapshot - hidden.snapshot).toBe(1);
    await expect.poll(() => mock.hits.live - hidden.live).toBe(1);
  });

  test('shows a change that a poll finds, without a reload', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(page.getByRole('article', { name: 'Side lab' })).toBeVisible();

    const next = structuredClone(world.snapshot);
    next.workstreams = next.workstreams.filter((entry) => entry.branch !== 'side-lab');
    mock.snapshot = { json: next };
    await advance(page, 16_000);
    await expect(page.getByRole('article', { name: 'Side lab' })).toHaveCount(0);
  });

  test('keeps the last data under an error when a later poll fails (stale), and recovers on the next good poll', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();

    mock.snapshot = { status: 503, json: { error: 'rate limited', kind: 'rate-limited' } };
    await advance(page, 16_000);
    const panel = workstreams(page);
    await expect(panel.getByRole('alert')).toContainText('The server answered 503: rate limited.');
    await expect(panel).toContainText('Last updated');
    await expect(panel).toContainText('Last good data');
    await expect(page.getByText('Live: off')).toHaveCount(0); // This label is on the Now page only.

    mock.snapshot = { json: world.snapshot };
    await advance(page, 16_000);
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('a lost login (design section 7)', () => {
  test('shows the banner "Login expired" when a poll is redirected to the login page, and marks the panels as stale', async ({ page }) => {
    const mock = await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Login expired' })).toHaveCount(0);

    mock.snapshot = { status: 302, body: '', headers: { location: 'https://vercel.com/login?next=x' } };
    await advance(page, 16_000);
    const banner = page.getByRole('alert').filter({ hasText: 'Login expired. Reload the page to sign in again.' }).first();
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Reload' })).toBeVisible();
    // The panel keeps its data and says that it is old.
    await expect(workstreams(page)).toContainText('Last good data');
    await expect(page.getByRole('article', { name: 'M6 flip default' })).toBeVisible();
  });

  test('treats an answer of 200 that is not JSON (the login page) as a lost login', async ({ page }) => {
    await mockApi(page, { snapshot: { status: 200, body: '<!doctype html><html><body>Log in to Vercel</body></html>', contentType: 'text/html' }, live: { json: world.live } });
    await page.goto('/workstreams');
    await expect(page.getByRole('alert').filter({ hasText: 'Login expired' }).first()).toBeVisible();
    await expect(workstreams(page)).toContainText('login-expired');
  });

  test('treats a 401 as a lost login', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { status: 401, body: 'Authentication Required', contentType: 'text/html' } });
    await page.goto('/workstreams');
    await expect(page.getByRole('alert').filter({ hasText: 'Login expired' }).first()).toBeVisible();
  });
});

test.describe('the hosted build', () => {
  // The hosted page only reads (design 2.2). The write call of the answer form is left out of the build, not only hidden: the build is the page that Vercel serves.
  test('holds no call to the answer endpoint and no write token header', () => {
    const assets = join(import.meta.dirname, '..', '..', 'dist-hosted', 'assets');
    const code = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assets, name), 'utf8'))
      .join('\n');
    // The right build was read: it holds the address that the hosted page polls.
    expect(code).toContain('/api/snapshot');
    expect(code).not.toContain('/answer');
    expect(code).not.toContain('X-CC-Token');
  });
});

test.describe('decisions and docs', () => {
  test('shows a decision read-only, with a note and no answer form', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/decisions/61');
    await expect(page.getByRole('region', { name: 'Decision', exact: true })).toContainText('Who owns the ruleset?');
    await expect(page.getByRole('note').filter({ hasText: 'Read-only on the hosted page' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Answer this decision' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /answer|submit/i })).toHaveCount(0);
  });

  test('says "not found" for a decision that is not in the snapshot', async ({ page }) => {
    await mockApi(page, { snapshot: { json: world.snapshot }, live: { json: world.live } });
    await page.goto('/decisions/999');
    await expect(page.getByRole('heading', { name: 'Decision not found' })).toBeVisible();
  });

  test('reads a doc through /api/docs/<repo path> and links to the docs of this site', async ({ page }) => {
    const mock = await mockApi(page, {
      snapshot: { json: snapshot() },
      docs: (path) => (path === 'docs/foo.md' ? '---\ntitle: Foo doc\ntype: guide\nstatus: ready\nupdated: 2026-10-01\n---\n\n# Foo\n\nSee [the bar doc](./bar.md) and [the board](https://example.com/x).\n' : null),
    });
    await page.goto('/docs/foo');
    await expect(page.getByRole('heading', { level: 1, name: 'Foo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'the bar doc' })).toHaveAttribute('href', '/docs/bar');
    await expect(page.getByRole('link', { name: 'the board' })).toHaveAttribute('href', 'https://example.com/x');
    await expect(page.getByRole('region', { name: 'Document' })).toContainText('2026-10-01');
    expect(mock.hits.docs).toContain('docs/foo.md');
    expectNoStrayRequests(mock);
  });

  test('shows "Doc not found" for an address that no path has', async ({ page }) => {
    await mockApi(page, { snapshot: { json: snapshot() } });
    await page.goto('/docs/no/such/doc');
    await expect(page.getByRole('heading', { name: 'Doc not found' })).toBeVisible();
  });

  test('lists the docs of nav.json and the Workstreams page in the docs navigation', async ({ page }) => {
    await mockApi(page, { snapshot: { json: snapshot() } });
    await page.goto('/docs');
    const sections = page.getByRole('region', { name: 'Sections' });
    await expect(sections).toBeVisible();
    // A section opens when it is clicked.
    await sections.getByRole('button', { name: 'Command center' }).click();
    await expect(sections.getByRole('link', { name: 'Workstreams' })).toHaveAttribute('href', '/workstreams');
    await sections.getByRole('button', { name: 'Start here' }).click();
    await expect(sections.getByRole('link', { name: 'status' })).toBeVisible();
  });

  test('says that search needs the local server', async ({ page }) => {
    await mockApi(page, { snapshot: { json: snapshot() } });
    await page.goto('/docs');
    await page.getByRole('combobox').fill('engine');
    await expect(page.getByText('Search needs the local server.')).toBeVisible();
  });
});
