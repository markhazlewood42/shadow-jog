import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';
import { E2E_DIR, type GhIssueStore, resetGh, setGhIssues, setGhMode } from './fake-gh';
import { amberItems, expectAtMostTwoAmberItems, tokenColors, worstTextContrast } from './look';

// The Now page (/) in a browser: five panels that are glass (PlasmaUI, drawn in WebGL) or plain boxes, over the fixture server (e2e/server.ts) with a fake gh,
// a throwaway git repo and made-up session files. The sessions, the pull requests and the decisions that these tests use are all made up, and a test that
// changes the fixture puts it back. Every test starts in a new browser context, so the saved arrangement and the glass switch (localStorage) start empty.

const PANELS = ['Your move', 'Running', 'Pull requests', 'Status', 'Links'] as const;

const REPO = join(E2E_DIR, 'repo');
const PROJECTS = join(E2E_DIR, 'claude-projects'); // `claude.projectsRoot` of the end-to-end config
const WHOLE = join(PROJECTS, 'fixture-shadow-jog'); // `claude.folders`
const DIST = join(import.meta.dirname, '..', 'dist');
const ORIGIN = 'http://127.0.0.1:3010'; // the end-to-end server (playwright.config.ts names the same address)
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

/** The key under which the page keeps the switch of the glass, and the one under which it keeps the arrangement of the panels (see src/web/now). */
const GLASS_KEY = 'cc.now.glass';
const LAYOUT_KEY = 'cc.now.layout';

const panel = (page: Page, name: (typeof PANELS)[number]) => page.getByRole('region', { name, exact: true });
const glassSwitch = (page: Page) => page.getByRole('button', { name: 'Glass panels' });

/** A page must not log an error or a warning to the console: a blocked script or style shows up there, and so does a PlasmaUI that cannot start. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

/** Waits until every panel has loaded: each one says when it was updated. */
async function allLoaded(page: Page): Promise<void> {
  for (const name of PANELS) await expect(panel(page, name)).toContainText(/Updated \d\d:\d\d:\d\d/);
}

/** Whether this browser can make a WebGL2 context. The glass tests need one, and say so when it cannot. */
const hasWebGL2 = (page: Page) => page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);

/** Where an element is on the page (not in the window: a scroll does not move it), in pixels. */
const placeOf = (target: Locator) =>
  target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
  });

/** Where an element is once it has stopped moving: a panel springs into place after a drag, and the same place twice in a row, 300 ms apart, is a place. */
async function settledPlaceOf(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let before = await placeOf(target);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await target.page().waitForTimeout(300);
    const now = await placeOf(target);
    if (Math.abs(now.x - before.x) < 0.5 && Math.abs(now.y - before.y) < 0.5) return now;
    before = now;
  }
  throw new Error('The panel did not stop moving within 9 seconds.');
}

// ---- made-up data ----

/** The moment that the dates of fixtures/gh are counted from: "merged in the last week" and "answered in the last week" must hold on any day. */
const FIXTURE_NOW = Date.parse('2026-10-06T12:00:00Z');

/** A fixture file with every date moved so that the fixture's clock is now. */
function fixtureFromNow(file: string): string {
  const shift = Date.now() - FIXTURE_NOW;
  const text = readFileSync(join(FIXTURES, 'gh', file), 'utf8');
  return text.replace(/"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)"/g, (_all, iso: string) => `"${new Date(Date.parse(iso) + shift).toISOString().replace(/\.\d{3}Z$/, 'Z')}"`);
}

/** Puts the fixture's pull requests and decision issues into the fake gh, and makes the server read them (the end-to-end server lets a forced refresh through at once). */
async function seedGithub(request: APIRequestContext): Promise<void> {
  resetGh();
  setGhIssues(JSON.parse(fixtureFromNow('issues.json')) as GhIssueStore);
  setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: fixtureFromNow('prs.json') } } });
  await request.get('/api/github?refresh=1');
  await request.get('/api/decisions?refresh=1');
}

async function resetGithub(request: APIRequestContext): Promise<void> {
  resetGh();
  await request.get('/api/github?refresh=1');
  await request.get('/api/decisions?refresh=1');
}

type Line = Record<string, unknown>;
const time = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const ID = (n: number) => `e2e00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = (type: 'user' | 'assistant', secondsAgo: number, message: Line, extra: Line = {}): Line => ({ type, timestamp: time(secondsAgo), cwd: REPO, gitBranch: 'fixture-branch', sessionId: 'e2e', entrypoint: 'claude-desktop', message, ...extra });
const prompt = (text: string, secondsAgo: number) => line('user', secondsAgo, { role: 'user', content: text });
const reply = (text: string, secondsAgo: number) => line('assistant', secondsAgo, { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] });
/** A tool result after the last reply: the session works again (see tests/sessions-parse.test.ts). */
const toolResult = (secondsAgo: number) => line('user', secondsAgo, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_e2e', content: 'made up' }] }, { toolUseResult: { ok: true } });
const box = (light: string, items: string[]) => `${light} Two files changed.\n\n---\n### 👉 Your move\n${items.map((item) => `- [ ] ${item}`).join('\n')}`;

function writeLines(file: string, lines: Line[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

/**
 * Makes the sessions of the tests, all of them live (their last write is now):
 * - one that works, with a running agent, an agent that ended 4 minutes ago, and a workflow that has done 2 of its 3 agents;
 * - one that waits for Mark with a yellow box of two lines, and one with a red box of one line.
 */
function writeSessions(): void {
  writeLines(join(WHOLE, `${ID(1)}.jsonl`), [prompt('Build the Now page of the command center\nsecond line of the prompt', 1800), reply('On it.', 1700), toolResult(4)]);
  const agents = join(WHOLE, ID(1), 'subagents');
  writeLines(join(agents, 'agent-run00001.jsonl'), [prompt('made up', 240), toolResult(5)]);
  writeFileSync(join(agents, 'agent-run00001.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Explore the fixture engine docs', model: 'sonnet' }));
  writeLines(join(agents, 'agent-done0001.jsonl'), [prompt('made up', 600), reply('Done.', 240)]);
  writeFileSync(join(agents, 'agent-done0001.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Check the milestone table', model: 'sonnet' }));
  const run = join(agents, 'workflows', 'wf_00000001-aaa');
  mkdirSync(run, { recursive: true });
  const journal: Line[] = [
    { type: 'launched' },
    { type: 'started', key: 'Research/1', agentId: 'w0000001', label: 'a', phase: 'Research' },
    { type: 'started', key: 'Research/2', agentId: 'w0000002', label: 'b', phase: 'Research' },
    { type: 'started', key: 'Build/1', agentId: 'w0000003', label: 'c', phase: 'Build' },
    { type: 'result', key: 'Research/1', agentId: 'w0000001', result: 'made up' },
    { type: 'result', key: 'Research/2', agentId: 'w0000002', result: 'made up' },
  ];
  writeFileSync(join(run, 'journal.jsonl'), `${journal.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  writeLines(join(run, 'agent-w0000003.jsonl'), [prompt('made up', 100), toolResult(3)]);
  mkdirSync(join(WHOLE, ID(1), 'workflows', 'scripts'), { recursive: true });
  writeFileSync(join(WHOLE, ID(1), 'workflows', 'scripts', 'fixture-build-wf_00000001-aaa.js'), '// made up\n');

  writeLines(join(WHOLE, `${ID(2)}.jsonl`), [prompt('Review the engine docs for the fixture', 3000), reply(box('🟡', ['Review the diff', 'Tell me to commit']), 600)]);
  writeLines(join(WHOLE, `${ID(3)}.jsonl`), [prompt('Fix the failing check on the gadget branch', 5000), reply(box('🔴', ['Look at the failing `e2e` job']), 1200)]);
}

async function refreshSessions(request: APIRequestContext): Promise<void> {
  expect((await request.get('/api/sessions?refresh=1')).status()).toBe(200);
}

test.afterEach(async ({ request }) => {
  rmSync(PROJECTS, { recursive: true, force: true });
  await request.get('/api/sessions?refresh=1');
});

// The first time that a browser starts the glass, its GPU compiles the shaders of PlasmaUI. A browser with no GPU (a software renderer, as headless browsers often are)
// needs seconds for that, and the page waits for it: more than the 10 seconds that a check may take, in a slow run. The compiled shaders are kept for the rest of the run,
// so one visit before the tests pays for all of them, with a time limit of its own.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage();
  try {
    await page.goto(`${ORIGIN}/`);
    if (await hasWebGL2(page)) await page.locator('section[data-plasma-draggable]').first().waitFor({ timeout: 100_000 });
  } finally {
    await page.close();
  }
});

// ---- the five panels, plain and glass ----

test.describe('the panels', () => {
  test('five panels show in plain mode', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Shadow Jog Command Center' })).toBeVisible();

    // The switch turns the glass off: the same five panels, as plain boxes, and no canvas for the GPU to draw.
    await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'true');
    await glassSwitch(page).click();
    await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('canvas')).toHaveCount(0);
    for (const name of PANELS) {
      await expect(panel(page, name)).toBeVisible();
      await expect(panel(page, name).getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
      // A plain panel has the navy fill and the lavender frame of the Look, and no glass behavior: it is not draggable.
      await expect(panel(page, name)).not.toHaveAttribute('data-plasma-draggable');
    }
    const colors = await tokenColors(page);
    const plain = await panel(page, 'Links').evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, frame: getComputedStyle(element).borderTopColor }));
    expect(plain.frame).toBe(colors.ruleSolid);
    expect(plain.background).toBe(colors.paper2);
    // The order of the page: what waits for Mark first, then what runs, the pull requests, the status, the links.
    const order = await page.locator('main section[aria-label]').evaluateAll((sections) => sections.map((section) => section.getAttribute('aria-label')).filter((name) => ['Your move', 'Running', 'Pull requests', 'Status', 'Links'].includes(name ?? '')));
    expect(order).toEqual([...PANELS]);
    expect(problems).toEqual([]);
  });

  test('glass on makes a canvas when WebGL2 exists', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    // The test needs a browser with WebGL2 (the browsers of this tool's tests have one). Without it, it would say nothing about the glass.
    expect(await hasWebGL2(page), 'this browser has no WebGL2: the glass cannot be tested in it').toBe(true);
    await allLoaded(page);

    // The glass is on at the start: one canvas that covers the window and that a screen reader skips, and the panels are PlasmaUI surfaces that can be dragged.
    await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'true');
    const canvas = page.locator('canvas[aria-hidden="true"]');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toBeVisible();
    const size = page.viewportSize();
    expect(await canvas.boundingBox()).toMatchObject({ x: 0, y: 0, width: size?.width, height: size?.height });
    for (const name of PANELS) await expect(panel(page, name)).toHaveAttribute('data-plasma-draggable', 'true');
    // The canvas draws: the margin beside the panels is the field of the glass, with contours in it, where the plain page is one flat color.
    expect(await distinctColors(page, { x: 0, y: 150, width: 20, height: 400 })).toBeGreaterThan(8);
    await glassSwitch(page).click();
    await expect(canvas).toHaveCount(0);
    expect(await distinctColors(page, { x: 0, y: 150, width: 20, height: 400 })).toBe(1);
    expect(problems).toEqual([]);
  });

  test('no WebGL2 gives plain panels and a notice', async ({ page }) => {
    // A browser with no WebGL2 says no to the context that the glass needs.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return kind === 'webgl2' ? null : Reflect.apply(original, this, [kind, ...rest]);
      } as unknown as typeof original;
    });
    const problems = watchConsole(page);
    await page.goto('/');
    await allLoaded(page);

    await expect(page.getByText('The glass panels need WebGL2, and this browser does not have it. The panels are plain.')).toBeVisible();
    // There is nothing to switch, so there is no switch, and no canvas, and the five panels are the plain ones.
    await expect(glassSwitch(page)).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    for (const name of PANELS) {
      await expect(panel(page, name)).toBeVisible();
      await expect(panel(page, name)).not.toHaveAttribute('data-plasma-draggable');
    }
    expect(problems).toEqual([]);
  });

  test('the glass switch survives a reload', async ({ page }) => {
    await page.goto('/');
    await allLoaded(page);
    await expect(page.locator('canvas')).toHaveCount(1);

    // Off, and still off after a reload (the choice is in localStorage, so the page does not even start the canvas).
    await glassSwitch(page).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), GLASS_KEY)).toBe('off');
    await page.reload();
    await allLoaded(page);
    await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('canvas')).toHaveCount(0);

    // On again, and still on after a reload.
    await glassSwitch(page).click();
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.reload();
    await allLoaded(page);
    await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('canvas')).toHaveCount(1);
  });
});

test.describe('the arrangement', () => {
  // A tall window, so that all the panels are in view and no scroll is needed to drag one.
  test.use({ viewport: { width: 1280, height: 1500 } });

  test('a dragged panel keeps its place after a reload and Reset layout restores it', async ({ page }) => {
    await page.goto('/');
    expect(await hasWebGL2(page), 'this browser has no WebGL2: panels cannot be dragged without the glass').toBe(true);
    await allLoaded(page);
    const links = panel(page, 'Links');
    const start = await settledPlaceOf(links);

    // Drag the Links panel down by its title. (It is the last of the panels, and the Status panel beside it is taller, so there is room below it.)
    const title = await links.getByRole('heading', { name: 'Links', exact: true }).boundingBox();
    if (title === null) throw new Error('The title of the Links panel has no box.');
    await page.mouse.move(title.x + 10, title.y + 5);
    await page.mouse.down();
    await page.mouse.move(title.x + 10, title.y + 65, { steps: 6 });
    await page.mouse.move(title.x + 10, title.y + 165, { steps: 6 });
    await page.mouse.up();

    // The panel settles on the grid or against a neighbor, and the arrangement is kept in the browser.
    const moved = await settledPlaceOf(links);
    expect(moved.y - start.y).toBeGreaterThan(60);
    const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY)) ?? '{}') as { links?: { x: number; y: number } };
    expect(Math.abs((saved.links?.y ?? Number.NaN) - (moved.y - start.y))).toBeLessThan(2);

    // After a reload the panel is where it was left.
    await page.reload();
    await allLoaded(page);
    const reloaded = await settledPlaceOf(panel(page, 'Links'));
    expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(2);
    expect(Math.abs(reloaded.y - moved.y)).toBeLessThan(2);

    // Reset layout puts it back where the page lays it out, and forgets the arrangement.
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await allLoaded(page);
    const reset = await settledPlaceOf(panel(page, 'Links'));
    expect(Math.abs(reset.x - start.x)).toBeLessThan(2);
    expect(Math.abs(reset.y - start.y)).toBeLessThan(2);
    expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY)) ?? '{}')).toEqual({});
  });
});

/** How many different colors there are in a part of the page, as the pixels of a screenshot show them. */
async function distinctColors(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const picture = await page.screenshot({ clip, type: 'png' });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('No 2D context to read the picture with.');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) colors.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0));
    return colors.size;
  }, picture.toString('base64'));
}

// ---- what each panel says ----

test.describe('the data of the panels', () => {
  test.afterEach(async ({ request }) => {
    await resetGithub(request);
  });

  test('an open decision is the first item of Your move and links to its page', async ({ page, request }) => {
    await seedGithub(request);
    await page.goto('/');
    const items = panel(page, 'Your move').getByRole('list', { name: 'What waits for Mark' }).getByRole('listitem');
    await expect(items.first()).toContainText('Decision #41: Where should Burrow keep its cache?');
    await expect(items.first().getByRole('link')).toHaveAttribute('href', '/decisions/41');
    // The open decisions of the fixture come first, in the order of their numbers. The one whose body is not the template says so, and links to the issue on GitHub.
    await expect(items.nth(1)).toContainText('Decision #43: Should the log be kept?');
    await expect(items.nth(2)).toContainText('Decision #46 is unreadable:');
    await expect(items.nth(2).getByRole('link')).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo/issues/46');
    // The text of an issue is shown as text: the markup in the title of decision 47 is characters, not a tag.
    await expect(items.nth(3)).toContainText('Decision #47: <b>Bold</b> or plain?');
    await expect(panel(page, 'Your move').locator('b')).toHaveCount(0);
    // The count in the header is the number of items.
    const count = await items.count();
    await expect(panel(page, 'Your move').getByRole('heading', { name: 'Your move' }).locator('xpath=following-sibling::*[1]')).toContainText(String(count));

    // The link opens the page of the decision, inside the site.
    await items.first().getByRole('link').click();
    await expect(page).toHaveURL('/decisions/41');
    await expect(page.getByRole('heading', { level: 1, name: 'Where should Burrow keep its cache?' })).toBeVisible();
  });

  test('gh signed out: only the PR panel shows an error', async ({ page, request }) => {
    await seedGithub(request);
    await page.goto('/');
    await allLoaded(page);
    await expect(panel(page, 'Pull requests')).toContainText('Fixture: the widget is ready to merge');
    await expect(page.getByRole('alert')).toHaveCount(0);

    // gh is signed out, and the server looks again: the pull requests and the decisions cannot be read, and the page hears of it.
    setGhMode({ mode: 'signed-out' });
    await request.get('/api/github?refresh=1');
    await request.get('/api/decisions?refresh=1');
    const alert = page.getByRole('alert');
    await expect(alert).toHaveCount(1);
    await expect(panel(page, 'Pull requests').getByRole('alert')).toContainText('gh is not signed in to GitHub');
    await expect(panel(page, 'Pull requests').getByRole('alert')).toContainText('gh-not-signed-in');
    await expect(panel(page, 'Pull requests').getByRole('button', { name: 'Retry' })).toBeVisible();
    // The pull requests that it knew stay under the error, with the time of that data.
    await expect(panel(page, 'Pull requests')).toContainText('Showing the last good data');
    await expect(panel(page, 'Pull requests')).toContainText('Fixture: the widget is ready to merge');
    // Every other panel goes on: no error, and its own data. Your move says which of its sources it could not read, as a notice and not as an error.
    for (const name of ['Your move', 'Running', 'Status', 'Links'] as const) await expect(panel(page, name).getByRole('alert')).toHaveCount(0);
    const notice = panel(page, 'Your move').getByRole('note', { name: 'Sources that could not be read' });
    await expect(notice).toContainText('The list may be incomplete');
    await expect(notice).toContainText('Pull request:');
    await expect(notice).toContainText('Decision:');
    await expect(notice).toContainText('gh is not signed in to GitHub');
    await expect(panel(page, 'Your move').getByRole('listitem').filter({ hasText: 'Pick the gadget colour' })).toHaveCount(1); // the status items are still there
    await expect(panel(page, 'Status')).toContainText('Right now (2026-01-02)');

    // gh works again: Retry brings the panel back, and the notice goes with it.
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: fixtureFromNow('prs.json') } } });
    await panel(page, 'Pull requests').getByRole('button', { name: 'Retry' }).click();
    await expect(alert).toHaveCount(0);
    await request.get('/api/decisions?refresh=1');
    await expect(notice).toHaveCount(0);
  });

  test('each panel has an empty state', async ({ page }) => {
    // The server's answers are replaced by empty ones, so every panel has nothing to show.
    const empty = <T,>(data: T) => ({ ok: true, data, updatedAt: new Date().toISOString() });
    await page.route('**/api/now/your-move', (route) => route.fulfill({ json: empty({ items: [], missing: [] }) }));
    await page.route('**/api/sessions', (route) => route.fulfill({ json: empty({ sessions: [], scanned: 0, skipped: 0, hiddenSdk: 0 }) }));
    await page.route('**/api/github', (route) => route.fulfill({ json: empty({ open: [], merged: [] }) }));
    await page.route('**/api/status', (route) => route.fulfill({ json: empty({ updated: null, rightNow: { heading: 'Right now', html: '' }, nextUpForMark: [], milestones: [] }) }));
    await page.route('**/api/git', (route) => route.fulfill({ json: empty({ current: null, ahead: null, behind: null, branches: [], commits: [] }) }));
    await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, name: 'Shadow Jog Command Center', version: '0.0.0', startedAt: new Date().toISOString(), gameUrl: 'http://localhost:3007', links: [] } }));
    await page.goto('/');
    await allLoaded(page);

    await expect(panel(page, 'Your move')).toContainText('Nothing waits for you right now.');
    await expect(panel(page, 'Your move').getByRole('list')).toHaveCount(0);
    await expect(panel(page, 'Running')).toContainText('Nothing is running right now.');
    await expect(panel(page, 'Pull requests')).toContainText('No open pull requests.');
    await expect(panel(page, 'Pull requests')).toContainText('No pull request was merged in the last 7 days.');
    await expect(panel(page, 'Status')).toContainText('This section of status.md has no text.');
    await expect(panel(page, 'Status')).toContainText('No milestones are listed.');
    await expect(panel(page, 'Status')).toContainText('No branch is checked out');
    await expect(panel(page, 'Links')).toContainText('No other links are set.');
    // The game is still a link: it is the one thing that the panel always has.
    await expect(panel(page, 'Links').getByRole('link', { name: 'Game' })).toHaveAttribute('href', 'http://localhost:3007');
    // An empty list has no amber count: nothing waits, so nothing is marked as the one thing that matters, and the page has no amber item at all.
    await expect(page.getByText('Live updates: on')).toBeVisible();
    expect(await amberItems(page)).toEqual([]);
  });

  test('each panel shows its last update time', async ({ page }) => {
    await page.goto('/');
    await allLoaded(page);
    for (const name of PANELS) {
      // The time of day for a person, and the exact moment in the element, which is a time that is not in the future.
      const updated = panel(page, name).locator('header time');
      await expect(updated).toHaveText(/^\d\d:\d\d:\d\d$/);
      const moment = Date.parse((await updated.getAttribute('datetime')) ?? '');
      expect(Number.isNaN(moment), name).toBe(false);
      expect(moment, name).toBeLessThanOrEqual(Date.now() + 5_000);
    }
  });

  test('the status panel shows the branch, ahead and behind, and 5 commits', async ({ page, request }) => {
    // The fixture repo has two commits and no upstream. A bare repo plays the remote: the fixture's two commits are pushed to it, one more is made there
    // (so the branch is behind by one, once git has fetched it), and three are made here (so it is ahead by three). Five commits are then the newest five.
    const remote = join(E2E_DIR, 'now-remote.git');
    const other = join(E2E_DIR, 'now-other');
    const identity = { GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: 'author@fixture.example', GIT_COMMITTER_NAME: 'Fixture Author', GIT_COMMITTER_EMAIL: 'author@fixture.example' };
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...identity } }).trim();
    const original = git(REPO, 'rev-parse', 'HEAD');
    try {
      rmSync(remote, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
      mkdirSync(remote, { recursive: true });
      git(remote, 'init', '--bare', '--quiet', '--initial-branch=main');
      git(REPO, 'remote', 'add', 'now-e2e', remote);
      git(REPO, 'push', '--quiet', '-u', 'now-e2e', 'main');
      git(E2E_DIR, 'clone', '--quiet', remote, other);
      git(other, 'commit', '--allow-empty', '--quiet', '-m', 'Only on the remote');
      git(other, 'push', '--quiet', 'origin', 'main');
      git(REPO, 'fetch', '--quiet', 'now-e2e');
      for (const n of [1, 2, 3]) git(REPO, 'commit', '--allow-empty', '--quiet', '-m', `Local change ${n}`);
      await request.get('/api/git?refresh=1');

      await page.goto('/');
      await allLoaded(page);
      const status = panel(page, 'Status');
      const branch = status.getByRole('region', { name: 'Branch' });
      await expect(branch).toContainText('main');
      await expect(branch).toContainText('ahead 3');
      await expect(branch).toContainText('behind 1');
      await expect(branch).toContainText('of now-e2e/main');
      const commits = status.getByRole('region', { name: 'Recent commits' }).getByRole('listitem');
      await expect(commits).toHaveCount(5);
      await expect(commits.nth(0)).toContainText('Local change 3');
      await expect(commits.nth(2)).toContainText('Local change 1');
      await expect(commits.nth(3)).toContainText('Add the second doc');
      await expect(commits.nth(4)).toContainText('Add the first doc');
      await expect(commits.nth(0)).toContainText('Fixture Author');
      await expect(commits.nth(0).locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);
    } finally {
      git(REPO, 'reset', '--hard', '--quiet', original);
      try {
        git(REPO, 'remote', 'remove', 'now-e2e');
      } catch {
        // The test failed before it made the remote.
      }
      rmSync(remote, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
      await request.get('/api/git?refresh=1');
    }
  });

  test('a running agent bar has no value and a finished one is full', async ({ page, request }) => {
    writeSessions();
    // A session that a script started is left out and counted: the panel says how many it hides.
    writeLines(join(WHOLE, `${ID(9)}.jsonl`), [{ ...prompt('made up sdk run', 30), entrypoint: 'sdk-py' }, { ...reply('Done.', 20), entrypoint: 'sdk-py' }]);
    await refreshSessions(request);
    await page.goto('/');
    const running = panel(page, 'Running');
    await expect(running).toContainText('Build the Now page of the command center');

    // A running agent reports no percent done: its bar has no value (it moves). A finished one is full. They are told apart by their names.
    const runningAgent = running.getByRole('progressbar', { name: /Explore the fixture engine docs/ });
    await expect(runningAgent).toBeVisible();
    await expect(runningAgent).not.toHaveAttribute('aria-valuenow');
    await expect(running.getByRole('listitem').filter({ hasText: 'Explore the fixture engine docs' })).toContainText('running');
    const finishedAgent = running.getByRole('progressbar', { name: /Check the milestone table/ });
    await expect(finishedAgent).toHaveAttribute('aria-valuenow', '100');
    await expect(running.getByRole('listitem').filter({ hasText: 'Check the milestone table' })).toContainText('done');
    // A workflow has real progress: 2 agents done of the 3 that started, and the phases say where.
    const workflow = running.getByRole('progressbar', { name: /fixture-build/ });
    await expect(workflow).toHaveAttribute('aria-valuenow', '67');
    await expect(running.getByRole('listitem').filter({ hasText: 'fixture-build' })).toContainText('2 of 3 agents done. Phases: Research 2/2, Build 0/1');
    // The sessions: one works (a bar that moves), and the two that wait for Mark have empty bars.
    await expect(running.getByRole('progressbar', { name: /working: Build the Now page/ })).not.toHaveAttribute('aria-valuenow');
    await expect(running.getByRole('progressbar', { name: /waiting for you: Review the engine docs/ })).toHaveAttribute('aria-valuenow', '0');
    // The automated run is counted, and nothing of it is on the page.
    await expect(running).toContainText('1 automated SDK run is hidden');
    await expect(page.getByText('made up sdk run')).toHaveCount(0);
  });
});

// ---- the Look ----

test.describe('the Look', () => {
  test.afterEach(async ({ request }) => {
    await resetGithub(request);
  });

  test('every mix of status lights in Your move keeps the page to two amber items, with the glass on and off', async ({ page, request }) => {
    // Sessions that wrote a red, a yellow and a green box, several lines each, next to decisions, pull requests and the status items. The lights are told by a word
    // and a shape, never by an amber fill, so the list can have any number of them and the page still has the one amber item of Your move (its count).
    await seedGithub(request);
    writeSessions();
    writeLines(join(WHOLE, `${ID(4)}.jsonl`), [prompt('A session with a green light', 2000), reply(box('🟢', ['Nothing is urgent', 'Look when you like', 'One more line']), 300)]);
    writeLines(join(WHOLE, `${ID(5)}.jsonl`), [prompt('A session with no light', 2100), reply('No light here.\n\n---\n### 👉 Your move\n- [ ] A line from a reply with no light', 310)]);
    await refreshSessions(request);

    await page.goto('/');
    await allLoaded(page);
    await expect(page.getByText('Live updates: on')).toBeVisible();
    const items = panel(page, 'Your move').getByRole('list', { name: 'What waits for Mark' }).getByRole('listitem');
    for (const light of ['Red light', 'Yellow light', 'Green light']) await expect(items.filter({ hasText: light }).first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(15);

    const colors = await tokenColors(page);
    for (const mode of ['glass', 'plain'] as const) {
      if (mode === 'plain') {
        await glassSwitch(page).click();
        await expect(page.locator('canvas')).toHaveCount(0);
      }
      await expectAtMostTwoAmberItems(page);
      // The one amber item is the count of Your move.
      const amber = await amberItems(page);
      expect(amber, mode).toHaveLength(1);
      expect(amber[0], mode).toContain('items wait for you');
      // The lights are not amber: their words and icons are the soft text color.
      const light = items.filter({ hasText: 'Red light' }).first().getByText('Red light');
      expect(await light.evaluate((element) => getComputedStyle(element).color), mode).toBe(colors.soft);
    }
  });

  test('the text on the glass keeps the 4.5 to 1 floor of the Look, wherever it stands on the page, at both sizes', async ({ page, request }) => {
    // The glass is drawn by the GPU behind the page, and shows through the panels, so the contrast of a text on it can only be read from the picture: the test
    // hides the text, takes a picture of what is behind it, and finds the text with the least contrast. The page has every kind of text: titles, links, the small
    // `soft` labels (the lowest ratio of the set), the lights of the sessions, the bars, the chips, and the html of the status.
    await seedGithub(request);
    writeSessions();
    await refreshSessions(request);
    await page.goto('/');
    expect(await hasWebGL2(page), 'this browser has no WebGL2: the glass cannot be measured in it').toBe(true);
    await allLoaded(page);
    await expect(page.locator('section[data-plasma-draggable]')).toHaveCount(PANELS.length);

    for (const size of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(600); // the canvas follows the window
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let top = 0; top < total; top += size.height - 100) {
        await page.evaluate((y) => window.scrollTo(0, y), top);
        await page.waitForTimeout(400);
        const worst = await worstTextContrast(page);
        expect(worst.ratio, `${size.width}x${size.height}, scrolled to ${top}: "${worst.text}" (${worst.color}) at ${worst.x},${worst.y}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('a panel in an error state keeps the Look: an ink icon, and two amber items at most', async ({ page }) => {
    // Two panels fail at once (the pull requests and the status): the icons of their errors are ink, so the page does not gain an amber item for each.
    await page.route('**/api/github', (route) => route.fulfill({ json: { ok: false, error: { code: 'gh-not-signed-in', message: 'gh is not signed in to GitHub.' }, updatedAt: null, lastGood: null } }));
    await page.route('**/api/health', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveCount(2);
    const colors = await tokenColors(page);
    for (const alert of await page.getByRole('alert').all()) await expect(alert.locator('svg').first()).toHaveCSS('color', colors.ink);
    await expectAtMostTwoAmberItems(page);
  });
});

// ---- the build: PlasmaUI is only in the chunk of the Now page ----

test.describe('the build', () => {
  /** Text that only PlasmaUI's code has: the class of its panels, the attribute of a dragged one, and the prefix of its console messages. */
  const PLASMA_MARKERS = ['plasma-panel', 'data-plasma-draggable', '[plasma-ui]'];
  const hasPlasma = (file: string) => {
    const code = readFileSync(join(DIST, file), 'utf8');
    return PLASMA_MARKERS.some((marker) => code.includes(marker));
  };

  type ManifestEntry = { file: string; src?: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[] };

  test('the docs chunk holds no plasma-ui code (build manifest scan)', async ({ page }) => {
    // The manifest that Vite writes next to the build (vite.config.ts asks for it) names each chunk, what it imports up front and what it imports when needed.
    const manifest = JSON.parse(readFileSync(join(DIST, '.vite', 'manifest.json'), 'utf8')) as Record<string, ManifestEntry>;
    const entry = Object.values(manifest).find((candidate) => candidate.isEntry === true);
    if (entry === undefined) throw new Error('The manifest has no entry chunk.');

    // Everything that the page loads before any route: the entry chunk and the chunks it imports (each of those, in turn, up front).
    const upFront = new Set<string>();
    const visit = (chunk: ManifestEntry) => {
      if (upFront.has(chunk.file)) return;
      upFront.add(chunk.file);
      for (const key of chunk.imports ?? []) {
        const next = manifest[key];
        if (next !== undefined) visit(next);
      }
    };
    visit(entry);
    expect([...upFront].filter((file) => file.endsWith('.js')).length).toBeGreaterThan(0);
    for (const file of upFront) if (file.endsWith('.js')) expect(hasPlasma(file), `${file} is loaded by every page`).toBe(false);

    // The chunk of the Now page is loaded when that page is asked for, and it is the one that has PlasmaUI (so the scan is not blind).
    const now = Object.values(manifest).find((candidate) => candidate.src?.endsWith('now/NowPage.tsx') === true);
    if (now === undefined) throw new Error('The manifest has no chunk for the Now page.');
    expect(entry.dynamicImports?.some((key) => manifest[key]?.file === now.file)).toBe(true);
    expect(upFront.has(now.file)).toBe(false);
    expect(hasPlasma(now.file)).toBe(true);
    // No chunk of the build but that one (and the ones that it alone imports) holds PlasmaUI.
    const withPlasma = readdirSync(join(DIST, 'assets')).filter((name) => name.endsWith('.js') && hasPlasma(join('assets', name)));
    expect(withPlasma).toEqual([now.file.replace(/^assets\//, '')]);

    // The same, as a browser sees it: the docs pages and the page of a decision download no chunk with PlasmaUI, and the Now page downloads it.
    const downloaded: string[] = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith('/assets/') && path.endsWith('.js')) downloaded.push(path.slice('/assets/'.length));
    });
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goto('/decisions/41');
    await expect(page.locator('main')).toBeVisible();
    expect(downloaded.length).toBeGreaterThan(0);
    expect(downloaded.filter((name) => hasPlasma(join('assets', name)))).toEqual([]);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Shadow Jog Command Center' })).toBeVisible();
    await expect(panel(page, 'Links')).toBeVisible();
    expect(downloaded.filter((name) => hasPlasma(join('assets', name)))).toEqual([now.file.replace(/^assets\//, '')]);
  });
});
