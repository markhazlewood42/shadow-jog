import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type APIRequestContext, type Locator, type Page, chromium, expect, test } from '@playwright/test';
import type { AgentsLive, Panel, StatusInfo } from '../src/shared/types';
import { E2E_DIR, type GhIssueStore, resetGh, setGhIssues, setGhMode } from './fake-gh';
import { amberItems, expectAtMostTwoAmberItems, tokenColors, worstTextContrast } from './look';

// The Now page (/) in a browser: five panels that are glass (PlasmaUI, drawn in WebGL) or plain boxes, over the fixture server (e2e/server.ts) with a fake gh,
// a throwaway git repo and made-up session files. The sessions, the pull requests and the decisions that these tests use are all made up, and a test that
// changes the fixture puts it back. Every test starts in a new browser context, so the saved arrangement and the glass switch (localStorage) start empty.

const PANELS = ['Your move', 'Running', 'Pull requests', 'Status', 'Links'] as const;

const REPO = join(E2E_DIR, 'repo');
const PROJECTS = join(E2E_DIR, 'claude-projects'); // `claude.projectsRoot` of the end-to-end config
const PROCESSES = join(E2E_DIR, 'claude-sessions'); // `claude.sessionsRoot` of the end-to-end config: the process list of the fixture world
const WHOLE = join(PROJECTS, 'fixture-shadow-jog'); // `claude.folders`
const DIST = join(import.meta.dirname, '..', 'dist');
const ORIGIN = 'http://127.0.0.1:3010'; // the end-to-end server (playwright.config.ts names the same address)
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

/** The key under which the page keeps the switch of the glass, and the one under which it keeps the arrangement of the panels (see src/web/now). */
const GLASS_KEY = 'cc.now.glass';
const LAYOUT_KEY = 'cc.now.layout';

/** The CI runner has no GPU, so playwright.config.ts starts every test with the glass off (as for a user who turned it off). A test that needs the glass drawn skips on CI. */
const NO_GPU = !!process.env.CI;
const NO_GPU_REASON = 'needs a GPU: the CI runner has none';

const panel = (page: Page, name: (typeof PANELS)[number]) => page.getByRole('region', { name, exact: true });
const glassSwitch = (page: Page) => page.getByRole('button', { name: 'Glass panels' });
const decisionOf = (page: Page) => page.getByRole('region', { name: 'Decision', exact: true });

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

// ---- the process list of the fixture world: where the Running panel starts ----
// A process file names a pid, and the server checks that the pid runs. A test cannot start Claude, so it starts a program that only waits and writes a process
// file for the pid of that program. The program ends by itself after a minute, in case a test dies before it can stop it. A session whose program was stopped leaves the
// list at once. The fixture world has no process folder until a test makes one: until then the server decides by the file ages (the fallback), and from then on by the process list.

/** The programs that the tests started, so that the end of every test can stop them. */
const waiting: ChildProcess[] = [];

/** Starts a program that only waits, and gives its pid and the way to stop it. The pid stands for a Claude process that runs. */
function startLiveProcess(): { pid: number; stop: () => void } {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
  waiting.push(child);
  if (child.pid === undefined) throw new Error('A program for a live pid could not be started.');
  return { pid: child.pid, stop: () => void child.kill() };
}

/** Writes the process file of a session: its pid, and busy or idle, and a start `ranSeconds` ago. (The server reads the session id, the start and the status; the rest stays here.) */
function writeProcess(pid: number, sessionId: string, status: 'busy' | 'idle', ranSeconds: number): void {
  mkdirSync(PROCESSES, { recursive: true });
  writeFileSync(join(PROCESSES, `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: REPO, startedAt: Date.now() - ranSeconds * 1000, status }));
}

/** Asks the agents module to look now, and gives what it found. The Running panel shows the same data. */
async function refreshAgents(request: APIRequestContext): Promise<AgentsLive> {
  const res = await request.get('/api/agents?refresh=1');
  expect(res.status()).toBe(200);
  const panel = (await res.json()) as Panel<AgentsLive>;
  if (!panel.ok) throw new Error(`The agents panel failed: ${panel.error.message}`);
  return panel.data;
}

test.afterEach(async ({ request }) => {
  for (const child of waiting.splice(0)) child.kill();
  rmSync(PROJECTS, { recursive: true, force: true });
  rmSync(PROCESSES, { recursive: true, force: true });
  await request.get('/api/sessions?refresh=1');
  await request.get('/api/agents?refresh=1');
});

// The first time that a browser starts the glass, its GPU compiles the shaders of PlasmaUI. A browser with no GPU (a software renderer, as headless browsers often are)
// needs seconds for that, and the page waits for it: more than the 10 seconds that a check may take, in a slow run. The compiled shaders are kept for the rest of the run,
// so one visit before the tests pays for all of them, with a time limit of its own.
test.beforeAll(async ({ browser }) => {
  // On CI the glass is off and no shader is compiled. (A page of this hook gets no storage state of the config either, so a visit here would load the glass.)
  if (NO_GPU) return;
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
    // On CI the glass is off from the start (see playwright.config.ts), so there is nothing to switch.
    if (!NO_GPU) {
      await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'true');
      await glassSwitch(page).click();
    }
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
    test.skip(NO_GPU, NO_GPU_REASON);
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

  test('glass canvas spans the window width, scrollbar included', async () => {
    test.skip(NO_GPU, NO_GPU_REASON);
    // PlasmaUI 0.7.0 draws on a region of the window size (innerWidth x innerHeight), and its canvas is `width: 100%`, which is the page width without the scrollbar. When the
    // two differ, every drawn frame is squeezed toward the left, and the frames stop matching the panels. The canvas must be as wide as the window, scrollbar included.
    // Playwright hides the scrollbars of a headless browser, and then the two widths are the same and the test would say nothing, so this test starts a browser of its own
    // that keeps them. A fresh browser compiles the shaders again, so it has a longer limit.
    test.setTimeout(120_000);
    const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'msedge' }), ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      // A short window: the fixture page is taller than it, so the window has a scrollbar.
      const page = await browser.newPage({ viewport: { width: 1280, height: 500 } });
      await page.goto(`${ORIGIN}/`);
      expect(await hasWebGL2(page), 'this browser has no WebGL2: the glass cannot be tested in it').toBe(true);
      await allLoaded(page);
      const canvas = page.locator('canvas[aria-hidden="true"]');
      await expect(canvas).toHaveCount(1, { timeout: 100_000 });
      const widths = await page.evaluate(() => ({ window: window.innerWidth, page: document.documentElement.clientWidth }));
      expect(widths.page, 'the window has a scrollbar: the page is narrower than the window').toBeLessThan(widths.window);

      const measure = () =>
        canvas.evaluate((element) => {
          const target = element as HTMLCanvasElement;
          const rect = target.getBoundingClientRect();
          return { width: rect.width, height: rect.height, backingWidth: target.width, backingHeight: target.height, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
        });
      const size = await measure();
      expect(size.width, 'the canvas is as wide as the window').toBe(size.innerWidth);
      expect(size.height, 'the canvas is as tall as the window').toBe(size.innerHeight);
      // The renderer sizes the backing store on its own frame, so the scale of the two axes is read until it settles.
      await expect
        .poll(async () => {
          const now = await measure();
          return Math.abs(now.backingWidth / now.width - now.backingHeight / now.height);
        })
        .toBeLessThan(0.005);

      // The time in the header of each glass panel is clear of the right edge of its panel by the inset.
      for (const name of PANELS) {
        const gap = await panel(page, name).evaluate((frame) => {
          const time = frame.querySelector(':scope > header')?.lastElementChild;
          return time === null || time === undefined ? Number.NaN : frame.getBoundingClientRect().right - time.getBoundingClientRect().right;
        });
        expect(gap, `${name}: the time is clear of the right edge`).toBeGreaterThanOrEqual(MIN_HEADER_INSET);
      }
    } finally {
      await browser.close();
    }
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

    await expect(page.getByText('No WebGL2: plain panels', { exact: true })).toBeVisible();
    await expect(page.getByText('The glass panels need WebGL2')).toHaveCount(0);
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
    test.skip(NO_GPU, NO_GPU_REASON);
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

/** The inset that Mark asked for after he used the tool: the time in a panel header must clear the rounded corner by a clear margin (in pixels, on both sides). */
const MIN_HEADER_INSET = 20;

/** What the header of a panel measures: its two insets, the corner radius of the frame, and how far the end of its last child is from the frame's right edge. */
const headerOf = (target: Locator) =>
  target.evaluate((frame) => {
    const header = frame.querySelector(':scope > header');
    if (header === null) throw new Error('This panel has no header.');
    const style = getComputedStyle(header);
    const last = header.lastElementChild?.getBoundingClientRect();
    return {
      left: Number.parseFloat(style.paddingLeft),
      right: Number.parseFloat(style.paddingRight),
      radius: Number.parseFloat(getComputedStyle(frame).borderTopRightRadius),
      gap: last === undefined ? Number.NaN : frame.getBoundingClientRect().right - last.right,
    };
  });

test.describe('the header of a panel', () => {
  test('S1 panel header has equal insets', async ({ page, request }) => {
    await page.goto('/');
    await allLoaded(page);
    // Glass on and off: the two modes draw the same frame, and the header is inside it in both.
    for (const mode of NO_GPU ? ['plain'] : ['glass', 'plain']) {
      if (mode === 'plain' && !NO_GPU) {
        await glassSwitch(page).click();
        await expect(page.locator('canvas')).toHaveCount(0);
      }
      for (const name of PANELS) {
        const header = await headerOf(panel(page, name));
        expect(header.right, `${name} (${mode}): right inset equals left inset`).toBe(header.left);
        expect(header.right, `${name} (${mode}): the inset is at least the corner radius`).toBeGreaterThanOrEqual(header.radius);
        expect(header.right, `${name} (${mode}): the inset is the one that Mark asked for`).toBeGreaterThanOrEqual(MIN_HEADER_INSET);
        // The end of the "updated" time clears the corner by the inset (a pixel of border is the one thing that the box adds).
        expect(header.gap, `${name} (${mode}): the time is clear of the right edge`).toBeGreaterThanOrEqual(header.right - 0.5);
      }
    }

    // The frame of the other pages is the same component, so it has the same header.
    await seedGithub(request);
    try {
      await page.goto('/decisions/41');
      const decision = await headerOf(decisionOf(page));
      expect(decision.right).toBe(decision.left);
      expect(decision.right).toBeGreaterThanOrEqual(Math.max(decision.radius, MIN_HEADER_INSET));
    } finally {
      await resetGithub(request);
    }
  });
});

test.describe('a page that cannot be shown', () => {
  test('a Now page file that fails to load shows an error with Reload, and Reload brings the page back', async ({ page }) => {
    // The file of the Now page is a chunk of its own with a hash in its name. When the server is restarted with a new build, an old tab asks for a name that is gone.
    await page.route('**/assets/NowPage-*.js', (route) => route.abort());
    await page.goto('/');
    const alert = page.getByRole('alert');
    // One short line that says to reload, and then the message of the error (which is data).
    await expect(alert.getByText('Reload the page. If the server restarts, the page files can change.', { exact: true })).toBeVisible();
    await expect(alert).not.toContainText('could not be shown');
    await expect(alert).not.toContainText('Reload to get the new one.');
    // The page is not left blank: the error says what is wrong. (The page that failed to load is not there, so it has no title.)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);

    // The file is there again, and Reload loads the page.
    await page.unroute('**/assets/NowPage-*.js');
    await alert.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Shadow Jog Command Center' })).toBeVisible();
    await allLoaded(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('the arrangement', () => {
  // A tall window, so that all the panels are in view and no scroll is needed to drag one.
  test.use({ viewport: { width: 1280, height: 1500 } });

  test('a dragged panel keeps its place after a reload and Reset layout restores it', async ({ page }) => {
    test.skip(NO_GPU, NO_GPU_REASON);
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
    // The pull requests that it knew stay under the error, with the time of that data, as a label.
    await expect(panel(page, 'Pull requests')).toContainText(/Last good data: \d\d:\d\d:\d\d/);
    await expect(panel(page, 'Pull requests')).not.toContainText('Showing the last good data');
    await expect(panel(page, 'Pull requests')).toContainText('Fixture: the widget is ready to merge');
    // Every other panel goes on: no error, and its own data. Your move says which of its sources it could not read, as a notice and not as an error.
    for (const name of ['Your move', 'Running', 'Status', 'Links'] as const) await expect(panel(page, name).getByRole('alert')).toHaveCount(0);
    const notice = panel(page, 'Your move').getByRole('note', { name: 'Incomplete list' });
    await expect(notice.getByText('Incomplete list', { exact: true })).toBeVisible();
    await expect(notice).not.toContainText('may be incomplete');
    await expect(notice).toContainText('Pull request:');
    await expect(notice).toContainText('Decision:');
    await expect(notice).toContainText('gh is not signed in to GitHub');
    await expect(panel(page, 'Your move').getByRole('listitem').filter({ hasText: 'Pick the gadget color' })).toHaveCount(1); // the status items are still there
    await expect(panel(page, 'Status').getByRole('link', { name: '3 for you' })).toBeVisible();

    // gh works again: Retry brings the panel back, and the notice goes with it.
    setGhMode({ mode: 'ok', replies: { 'pr list': { stdout: fixtureFromNow('prs.json') } } });
    await panel(page, 'Pull requests').getByRole('button', { name: 'Retry' }).click();
    await expect(alert).toHaveCount(0);
    await request.get('/api/decisions?refresh=1');
    await expect(notice).toHaveCount(0);
  });

  test('S2 pull requests panel shows open PRs and one merged link', async ({ page, request }) => {
    await seedGithub(request);
    await page.goto('/');
    await allLoaded(page);
    const prs = panel(page, 'Pull requests');

    // The five open pull requests of the fixture are rows.
    await expect(prs).toContainText('Open (5)');
    for (const title of ['the widget is ready to merge', 'the gadget breaks a test', 'a draft that is not ready', 'checks are still running', 'no checks yet']) {
      await expect(prs.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    }

    // The merged ones (and the closed one) are not listed: no group, no row, no count. The server still sends them (see the panels spec).
    await expect(prs).not.toContainText('Merged in the last 7 days');
    for (const title of ['merged yesterday', 'merged earlier this week', 'merged last week', 'closed without a merge']) await expect(prs).not.toContainText(title);
    await expect(prs.getByRole('listitem')).toHaveCount(5);

    // One link for them, to the filtered view of the repository, in a new tab like the other links that leave the site.
    const merged = prs.getByRole('link', { name: 'Merged pull requests' });
    await expect(merged).toHaveCount(1);
    await expect(merged).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo/pulls?q=is%3Apr+is%3Amerged');
    await expect(merged).toHaveAttribute('target', '_blank');
    await expect(merged).toHaveAttribute('rel', /noreferrer/);
    // It sits under the last open row.
    const rows = await prs.getByRole('listitem').last().boundingBox();
    const link = await merged.boundingBox();
    expect(link?.y).toBeGreaterThan((rows?.y ?? Number.POSITIVE_INFINITY) + (rows?.height ?? 0) - 1);
    await expectAtMostTwoAmberItems(page);
  });

  test('now page empty states are labels', async ({ page }) => {
    // The server's answers are replaced by empty ones, so every panel has nothing to show.
    const empty = <T,>(data: T) => ({ ok: true, data, updatedAt: new Date().toISOString() });
    await page.route('**/api/now/your-move', (route) => route.fulfill({ json: empty({ items: [], missing: [] }) }));
    await page.route('**/api/agents', (route) => route.fulfill({ json: empty({ sessions: [], hiddenScripts: 0, source: 'process-list' }) }));
    await page.route('**/api/github', (route) => route.fulfill({ json: empty({ open: [], merged: [] }) }));
    await page.route('**/api/status', (route) => route.fulfill({ json: empty({ updated: null, nextUpForMark: [], milestone: { current: null, problem: null }, milestones: [] }) }));
    await page.route('**/api/git', (route) => route.fulfill({ json: empty({ current: null, ahead: null, behind: null, branches: [], commits: [] }) }));
    await page.route('**/api/ci', (route) => route.fulfill({ json: empty({ state: 'none', createdAt: null, url: null }) }));
    await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, name: 'Shadow Jog Command Center', version: '0.0.0', startedAt: new Date().toISOString(), gameUrl: 'http://localhost:3007', githubRepo: 'fixture-owner/fixture-repo', links: [] } }));
    await page.goto('/');
    await allLoaded(page);

    // Each empty state is a label of a few words, and not a sentence (design 5.8).
    await expect(panel(page, 'Your move').getByText('Nothing for you', { exact: true })).toBeVisible();
    await expect(panel(page, 'Your move').getByRole('list')).toHaveCount(0);
    await expect(panel(page, 'Running').getByText('No active session', { exact: true })).toBeVisible();
    await expect(panel(page, 'Running').getByRole('list')).toHaveCount(0);
    await expect(panel(page, 'Running')).not.toContainText('Process list unavailable');
    await expect(panel(page, 'Pull requests').getByText('No open PRs', { exact: true })).toBeVisible();
    // The link to the merged ones is there when nothing is open too: it is not about the list.
    await expect(panel(page, 'Pull requests').getByRole('link', { name: 'Merged pull requests' })).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo/pulls?q=is%3Apr+is%3Amerged');
    // The Status panel has a label for each empty value, and the strip has no squares.
    for (const label of ['No branch', 'no run', 'Nothing for you', 'No date', 'No commits', 'Not started']) await expect(panel(page, 'Status')).toContainText(label);
    await expect(panel(page, 'Status').getByRole('listitem')).toHaveCount(0);
    // The Links panel always has the game, as a link. The label under it says that the config has no more.
    await expect(panel(page, 'Links').getByText('No other links', { exact: true })).toBeVisible();
    await expect(panel(page, 'Links').getByRole('link', { name: 'Game' })).toHaveAttribute('href', 'http://localhost:3007');
    // An empty list has no amber count: nothing waits, so nothing is marked as the one thing that matters, and the page has no amber item at all.
    await expect(page.getByText('Live: on', { exact: true })).toBeVisible();
    expect(await amberItems(page)).toEqual([]);

    // Nothing else on the page is a sentence either: each line of its text is a label, a number, a date or a link, of six words at most, with no full stop at the end.
    const lines = (await page.locator('main').innerText()).split('\n').map((line) => line.trim()).filter((line) => line !== '');
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(6);
      expect(line, line).not.toMatch(/[.!?;]$/);
    }
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

  test('links panel shows labels without addresses', async ({ page }) => {
    await page.goto('/');
    await allLoaded(page);
    const links = panel(page, 'Links');

    // The fixture config has two links: the game and the repo. Each is its label and the icon of a link that leaves the site, and nothing more.
    const items = links.getByRole('list', { name: 'Links' }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText('Game');
    await expect(items.nth(1)).toHaveText('GitHub repo');
    for (const item of await items.all()) {
      await expect(item.getByRole('link')).toHaveCount(1);
      await expect(item.locator('svg')).toHaveCount(1);
      await expect(item.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    }

    // The address belongs to the link, and is not written out anywhere on the panel.
    await expect(links.getByRole('link', { name: 'Game' })).toHaveAttribute('href', 'http://localhost:3007');
    await expect(links.getByRole('link', { name: 'GitHub repo' })).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo');
    expect(await links.innerText()).not.toMatch(/https?:|localhost|github\.com|3007/);

    // The label for "no more links" is for a config with one link only, and the panel has no sentence of help.
    await expect(links).not.toContainText('No other links');
    await expect(links).not.toContainText('command-center.config.json');
  });
});

// ---- the Running panel: the sessions that are alive now, from the process list ----

test.describe('the Running panel', () => {
  test('running panel lists active sessions and links to the agents page', async ({ page, request }) => {
    // The first session has a running agent, a finished agent and a workflow at work. None of them is a row: the Agents page draws them.
    writeSessions();
    // A session that a script started is left out and counted: the panel says how many it hides, and none of its words are on the page.
    writeLines(join(WHOLE, `${ID(9)}.jsonl`), [{ ...prompt('made up sdk run', 30), entrypoint: 'sdk-py' }, { ...reply('Done.', 20), entrypoint: 'sdk-py' }]);
    // Three Claude processes run: the first works, the second waits for Mark, and the third is the script.
    writeProcess(startLiveProcess().pid, ID(1), 'busy', 40 * 60 + 15);
    writeProcess(startLiveProcess().pid, ID(2), 'idle', 12 * 60 + 15);
    writeProcess(startLiveProcess().pid, ID(9), 'busy', 90);
    const found = await refreshAgents(request);
    expect(found.source).toBe('process-list');
    expect(found.sessions.map((session) => session.id)).toEqual([ID(1), ID(2)]);
    expect(found.hiddenScripts).toBe(1);

    const requested: string[] = [];
    page.on('request', (message) => requested.push(new URL(message.url()).pathname));
    await page.goto('/');
    const running = panel(page, 'Running');
    const rows = running.getByRole('list', { name: 'Active sessions' }).getByRole('listitem');

    // One row for each session, in the order of the API (the oldest first): the title, the state word and the time since the start.
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText('Build the Now page of the command center working 40 min');
    await expect(rows.nth(1)).toHaveText('Review the engine docs for the fixture waiting 12 min');
    // The whole row is the link: it is one link, it leads to the Agents page, and its words are the words of the row.
    for (const [index, row] of (await rows.all()).entries()) {
      await expect(row.getByRole('link')).toHaveCount(1);
      await expect(row.getByRole('link')).toHaveAttribute('href', `/agents#session-${ID(index + 1)}`);
      await expect(row.getByRole('link')).not.toHaveAttribute('target');
    }
    await expect(rows.nth(1).getByRole('link')).toHaveText('Review the engine docs for the fixture waiting 12 min');

    // No row for an agent or a workflow, and no bar. The run of the script is counted, and none of its words are on the page. The process list is good, so no fallback label.
    for (const text of ['Explore the fixture engine docs', 'Check the milestone table', 'fixture-build']) await expect(running).not.toContainText(text);
    await expect(running.getByRole('progressbar')).toHaveCount(0);
    await expect(running.getByText('1 script run hidden', { exact: true })).toBeVisible();
    await expect(running).not.toContainText('Process list unavailable');
    await expect(page.getByText('made up sdk run')).toHaveCount(0);

    // The panel reads the live agents, and no longer the list of the sessions.
    expect(requested).toContain('/api/agents');
    expect(requested).not.toContain('/api/sessions');

    // A row opens the Agents page inside the site: no new page is loaded.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__ccStillHere = true;
    });
    await rows.nth(1).getByRole('link').click();
    await expect(page).toHaveURL(`/agents#session-${ID(2)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ccStillHere)).toBe(true);
  });

  test('G6: a Running row opens the Agents page at its session', async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
    // A short, narrow window: one column, so the second cluster is below the fold and the page has to scroll to it.
    await page.setViewportSize({ width: 800, height: 420 });
    writeSessions();
    writeProcess(startLiveProcess().pid, ID(1), 'busy', 40 * 60 + 15);
    writeProcess(startLiveProcess().pid, ID(2), 'idle', 12 * 60 + 15);
    await refreshAgents(request);
    await page.goto('/');
    await panel(page, 'Running').getByRole('list', { name: 'Active sessions' }).getByRole('listitem').nth(1).getByRole('link').click();
    await expect(page).toHaveURL(`/agents#session-${ID(2)}`);
    // The page scrolled to the cluster of the session once its data was there.
    const cluster = page.locator(`[id="session-${ID(2)}"]`);
    await expect(cluster).toBeVisible();
    await expect(cluster).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('running panel shows the empty state and the fallback label', async ({ page, request }) => {
    // The fixture world has no process folder and no session file. The server decides by the file ages, finds nothing, and says so.
    expect(await refreshAgents(request)).toEqual({ sessions: [], hiddenScripts: 0, source: 'file-age' });
    await page.goto('/');
    const running = panel(page, 'Running');
    await expect(running.getByText('No active session', { exact: true })).toBeVisible();
    await expect(running.getByText('Process list unavailable', { exact: true })).toBeVisible();
    await expect(running.getByRole('list')).toHaveCount(0);
    await expect(running.getByRole('alert')).toHaveCount(0);

    // The process folder appears, with no process in it. The label goes by itself, when the server looks again and tells the open page. The empty state stays.
    mkdirSync(PROCESSES, { recursive: true });
    await expect(running.getByText('Process list unavailable')).toHaveCount(0, { timeout: 10_000 });
    await expect(running.getByText('No active session', { exact: true })).toBeVisible();
  });

  test('running panel adds a row when a session starts and drops it when the session ends', async ({ page, request }) => {
    mkdirSync(PROCESSES, { recursive: true });
    await refreshAgents(request);
    await page.goto('/');
    const running = panel(page, 'Running');
    await expect(running.getByText('No active session', { exact: true })).toBeVisible();

    // A session starts: its file, and the file of its process. The server looks every 3 seconds and tells the open page, which loads the panel again: the test asks for nothing.
    writeSessions();
    const live = startLiveProcess();
    writeProcess(live.pid, ID(1), 'busy', 20);
    await expect(running.getByText('Build the Now page of the command center')).toBeVisible({ timeout: 8_000 });
    await expect(running.getByText('No active session')).toHaveCount(0);

    // Its process ends. The row goes, and the empty state comes back.
    live.stop();
    await expect(running.getByText('No active session', { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(running.getByRole('listitem')).toHaveCount(0);
  });
});

// ---- the status panel: five rows with links, and the milestone strip ----

test.describe('the status panel', () => {
  const STATUS_MD = join(REPO, 'status.md');
  const REPO_ADDRESS = 'https://github.com/fixture-owner/fixture-repo';
  const RUN_URL = `${REPO_ADDRESS}/actions/runs/4242`;

  /** The squares of the fixture's migration doc, in the order of its table: the words of each, and where it links (Phase 0 has no heading in the doc, so it links to the doc). */
  const SQUARES = [
    { name: 'Phase 0 Platform spike', href: '/docs/engine/migration' },
    { name: 'M0 Kernel', href: '/docs/engine/migration#m0-kernel' },
    { name: 'M1b 3D proof (parallel with M2)', href: '/docs/engine/migration#m1b-3d-proof' },
    { name: 'M2 Stage', href: '/docs/engine/migration#m2-stage' },
  ];

  /** The row of the panel with this label (its `dt`). The strip under the rows is not a row, and has no `dt`. */
  const rowOf = (page: Page, label: string) =>
    panel(page, 'Status')
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label.replace(/[.]/g, '\\.')}$`) }) });
  const stripOf = (page: Page) => panel(page, 'Status').getByRole('list', { name: 'Milestones' });
  const squaresOf = (page: Page) => stripOf(page).getByRole('listitem').getByRole('link');

  /** What `gh run list` prints for one run of main, made 2 hours ago (and a little more, so that the age is "2 h" for a long time). */
  const run = (status: string, conclusion: string) => JSON.stringify([{ status, conclusion, url: RUN_URL, createdAt: new Date(Date.now() - 2 * 3_600_000 - 30_000).toISOString() }]);

  /** Makes the fake gh answer the CI look with this text, and makes the server look at once (an open page then hears of it). */
  async function setRun(request: APIRequestContext, stdout: string): Promise<void> {
    setGhMode({ mode: 'ok', replies: { 'run list': { stdout } } });
    expect((await request.get('/api/ci?refresh=1')).status()).toBe(200);
  }

  /**
   * Runs `body` while the fixture repo has a remote called origin (a bare repo) that is one commit ahead of the fixture's two (so the branch is behind by one, once git
   * has fetched it), and while the branch has three commits of its own (so it is ahead by three). The repo is put back as it was. `body` gets the id of the newest commit.
   */
  async function withOrigin(request: APIRequestContext, body: (head: string) => Promise<void>): Promise<void> {
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
      git(REPO, 'remote', 'add', 'origin', remote);
      git(REPO, 'push', '--quiet', '-u', 'origin', 'main');
      git(E2E_DIR, 'clone', '--quiet', remote, other);
      git(other, 'commit', '--allow-empty', '--quiet', '-m', 'Only on the remote');
      git(other, 'push', '--quiet', 'origin', 'main');
      git(REPO, 'fetch', '--quiet', 'origin');
      for (const n of [1, 2, 3]) git(REPO, 'commit', '--allow-empty', '--quiet', '-m', `Local change ${n}`);
      expect((await request.get('/api/git?refresh=1')).status()).toBe(200);
      await body(git(REPO, 'rev-parse', 'HEAD'));
    } finally {
      git(REPO, 'reset', '--hard', '--quiet', original);
      try {
        git(REPO, 'remote', 'remove', 'origin');
      } catch {
        // The test failed before it made the remote.
      }
      rmSync(remote, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
      await request.get('/api/git?refresh=1');
    }
  }

  test.afterEach(async ({ request }) => {
    resetGh();
    await request.get('/api/ci?refresh=1');
  });

  test('status panel shows five rows with links', async ({ page, request }) => {
    await setRun(request, run('completed', 'success'));
    await withOrigin(request, async (head) => {
      const problems = watchConsole(page);
      await page.goto('/');
      await allLoaded(page);
      const status = panel(page, 'Status');

      // Five rows, in this order, each a label (a dt) and a value (a dd). The milestone strip is not a row.
      await expect(status.locator('dl > div')).toHaveCount(5);
      await expect(status.locator('dl dt')).toHaveText(['Branch', 'CI on main', 'Next up', 'status.md', 'Last commit']);
      await expect(status.locator('dl dd')).toHaveCount(5);

      // Branch: the name is a link to the branch on GitHub (in a new tab, as the other links that leave the site), and the standing is muted text after it.
      const branch = rowOf(page, 'Branch');
      const branchLink = branch.getByRole('link', { name: 'main', exact: true });
      await expect(branchLink).toHaveAttribute('href', `${REPO_ADDRESS}/tree/main`);
      await expect(branchLink).toHaveAttribute('target', '_blank');
      await expect(branchLink).toHaveAttribute('rel', /noreferrer/);
      await expect(branch.getByRole('link')).toHaveCount(1);
      await expect(branch).toContainText('ahead 3, behind 1');

      // CI on main: the word and the age are the link to the run.
      const ciLink = rowOf(page, 'CI on main').getByRole('link');
      await expect(ciLink).toHaveText('passing 2 h ago');
      await expect(ciLink).toHaveAttribute('href', RUN_URL);
      await expect(ciLink).toHaveAttribute('target', '_blank');
      await expect(ciLink.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);

      // Next up: how many items wait for Mark (the fixture's status.md has three), as a link to the status doc page, which stays on this site.
      const nextUp = rowOf(page, 'Next up').getByRole('link');
      await expect(nextUp).toHaveText('3 for you');
      await expect(nextUp).toHaveAttribute('href', '/docs/status');
      await expect(nextUp).not.toHaveAttribute('target', '_blank');

      // status.md: the date of its last update (month and day, and the year only when it is not this year), as a link to the same page.
      const updated = rowOf(page, 'status.md').getByRole('link');
      await expect(updated).toHaveText(new Date().getFullYear() === 2026 ? 'updated Jan 2' : 'updated Jan 2, 2026');
      await expect(updated).toHaveAttribute('href', '/docs/status');

      // Last commit: its age, as a link to the commit on GitHub. The newest commit was made a moment ago.
      const commit = rowOf(page, 'Last commit').getByRole('link');
      await expect(commit).toHaveText(/^(just now|\d+ min ago)$/);
      await expect(commit).toHaveAttribute('href', `${REPO_ADDRESS}/commit/${head}`);
      await expect(commit).toHaveAttribute('target', '_blank');
      expect(problems).toEqual([]);

      // The strip under the rows: the label, and one square for each milestone of the table, none of them current while the key says "none".
      await expect(status.getByText('Milestone', { exact: true })).toBeVisible();
      await expect(squaresOf(page)).toHaveCount(SQUARES.length);
      await expect(status.getByText('Not started')).toBeVisible();

      // CI in its other states: running and failing are links to the run, and "no run" (an empty list, or a run with no verdict) has no link and no age.
      for (const [stdout, word, linked] of [
        [run('in_progress', ''), 'running', true],
        [run('completed', 'failure'), 'failing', true],
        [run('completed', 'cancelled'), 'no run', false],
        ['[]', 'no run', false],
      ] as const) {
        await setRun(request, stdout);
        const ci = rowOf(page, 'CI on main');
        await expect(ci).toContainText(word);
        await expect(ci.getByRole('link')).toHaveCount(linked ? 1 : 0);
        await expect(ci.locator('time')).toHaveCount(linked ? 1 : 0);
      }

      // A link of the panel that stays on the site opens the page without loading a new one.
      await nextUp.click();
      await expect(page).toHaveURL(/\/docs\/status$/);
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Fixture Project');
    });
  });

  test('status panel marks the current milestone and links each square', async ({ page, request }) => {
    // The key of status.md says M0: the file is edited, and the server hears of it through the file watcher, so the open page changes by itself.
    const original = readFileSync(STATUS_MD, 'utf8');
    expect(original).toContain('milestone: none');
    try {
      await page.addInitScript((key) => localStorage.setItem(key, 'off'), GLASS_KEY); // plain panels: the colors are those of the styles, with no glass behind them
      await page.goto('/');
      await allLoaded(page);
      await expect(squaresOf(page)).toHaveCount(SQUARES.length);
      for (const square of await squaresOf(page).all()) await expect(square).toHaveAttribute('data-state', 'later'); // "none": every square is outlined

      writeFileSync(STATUS_MD, original.replace('milestone: none', 'milestone: M0'));
      await expect.poll(async () => ((await (await request.get('/api/status')).json()) as { data?: { milestone?: { current: string | null } } }).data?.milestone?.current, { timeout: 15_000 }).toBe('M0');

      const status = panel(page, 'Status');
      const squares = squaresOf(page);
      // Before the current milestone a square is filled, the current one is marked, and after it a square is outlined. Each links to its heading in the doc page.
      await expect(squares.nth(1)).toHaveAttribute('data-state', 'current');
      expect(await squares.evaluateAll((links) => links.map((link) => link.getAttribute('data-state')))).toEqual(['done', 'current', 'later', 'later']);
      expect(await squares.evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))).toEqual(SQUARES.map((square) => square.name));
      // A square has no words, so its name is also its tooltip: a mouse finds out which milestone it is by resting on it.
      expect(await squares.evaluateAll((links) => links.map((link) => link.getAttribute('title')))).toEqual(SQUARES.map((square) => square.name));
      expect(await squares.evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(SQUARES.map((square) => square.href));
      expect(await squares.evaluateAll((links) => links.map((link) => link.getAttribute('aria-current')))).toEqual([null, 'step', null, null]);

      // The look of the three states: filled with the muted color, amber, and a lavender outline with no fill.
      const colors = await tokenColors(page);
      const paint = (index: number) => squares.nth(index).evaluate((link) => ({ fill: getComputedStyle(link).backgroundColor, line: getComputedStyle(link).borderTopColor }));
      expect(await paint(0)).toEqual({ fill: colors.muted, line: colors.muted });
      expect(await paint(1)).toEqual({ fill: colors.accent, line: colors.accent });
      expect(await paint(2)).toEqual({ fill: 'rgba(0, 0, 0, 0)', line: colors.ruleSolid });
      expect(await paint(3)).toEqual({ fill: 'rgba(0, 0, 0, 0)', line: colors.ruleSolid });

      // Next to the strip stands the current milestone, as a link to its heading.
      const current = status.locator('a', { hasText: 'M0 Kernel' });
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('href', '/docs/engine/migration#m0-kernel');
      await expect(status.getByText('Not started')).toHaveCount(0);

      // The current square is the one amber item of the panel, and the page keeps to its two: with the glass off and with it on.
      for (const mode of NO_GPU ? (['plain'] as const) : (['plain', 'glass'] as const)) {
        if (mode === 'glass') {
          await glassSwitch(page).click();
          await expect(glassSwitch(page)).toHaveAttribute('aria-pressed', 'true');
        }
        const amber = await amberItems(page);
        expect(amber.filter((item) => item.startsWith('a[M0 Kernel]')), mode).toHaveLength(1);
        expect(amber.filter((item) => /^a\[(Phase 0|M1b|M2)/.test(item)), mode).toEqual([]);
        await expectAtMostTwoAmberItems(page);
      }

      // A square is a link of the router: it opens the doc page at the heading of its milestone, without loading a new page.
      await squares.nth(2).click();
      await expect(page).toHaveURL(/\/docs\/engine\/migration#m1b-3d-proof$/);
      await expect(page.getByRole('heading', { level: 3, name: 'M1b 3D proof' })).toBeInViewport();
    } finally {
      writeFileSync(STATUS_MD, original);
      await expect.poll(async () => ((await (await request.get('/api/status')).json()) as { data?: { milestone?: { current: string | null; problem: string | null } } }).data?.milestone, { timeout: 15_000 }).toEqual({ current: null, problem: null });
    }
  });

  test('a milestone key that is missing or names no milestone shows an error label and no filled or current square', async ({ page }) => {
    const info = (milestone: { current: string | null; problem: 'missing' | 'unknown' | null }) => ({
      ok: true,
      updatedAt: new Date().toISOString(),
      data: { updated: '2026-01-02', nextUpForMark: [], milestone, milestones: SQUARES.map((square, index) => ({ id: square.name.split(' ')[0], name: '', scope: '', anchor: index === 0 ? null : `anchor-${index}` })) },
    });
    for (const [milestone, label] of [
      [{ current: null, problem: 'missing' }, 'Milestone key missing'],
      [{ current: null, problem: 'unknown' }, 'Unknown milestone'],
      // A key that the server called good, but that names a milestone the list does not have (the page never guesses either).
      [{ current: 'M9', problem: null }, 'Unknown milestone'],
    ] as const) {
      await page.unroute('**/api/status');
      await page.route('**/api/status', (route) => route.fulfill({ json: info(milestone) }));
      await page.goto('/');
      const status = panel(page, 'Status');
      await expect(status.getByText(label, { exact: true })).toBeVisible();
      await expect(status.getByText('Not started')).toHaveCount(0);
      // The rows stay, and every square is outlined.
      await expect(status.locator('dl > div')).toHaveCount(5);
      await expect(squaresOf(page)).toHaveCount(SQUARES.length);
      expect(await squaresOf(page).evaluateAll((links) => links.map((link) => link.getAttribute('data-state')))).toEqual(['later', 'later', 'later', 'later']);
      await expect(stripOf(page).locator('[aria-current]')).toHaveCount(0);
      await expect(stripOf(page).getByRole('link').first()).toHaveAttribute('href', '/docs/engine/migration');
    }
  });

  test('status panel keeps Next up and status.md when the milestone table of the migration doc is broken, and only the strip says Unavailable', async ({ page, request }) => {
    // The real server and the real fixture repo: the column "One-line scope" of the milestone table is renamed, as an edit of the engine docs can do. The status module still reads
    // status.md in the same load, and sends it as the data under the error of the table.
    const MIGRATION_MD = join(REPO, 'docs', 'engine', 'migration.md');
    const original = readFileSync(MIGRATION_MD, 'utf8');
    const header = '| Milestone | One-line scope | Touches |';
    expect(original).toContain(header);
    const readStatus = async () => (await (await request.get('/api/status')).json()) as Panel<StatusInfo>;
    try {
      writeFileSync(MIGRATION_MD, original.replace(header, '| Milestone | Scope | Touches |'));
      await expect
        .poll(async () => {
          const reply = await readStatus();
          return reply.ok ? 'ok' : reply.error.code;
        }, { timeout: 15_000 })
        .toBe('milestones-table-missing');

      // What the server sends: the error of the table, and the complete data of status.md under it (three items and the date). The rows are drawn from that data.
      const broken = await readStatus();
      if (broken.ok || broken.lastGood === null) throw new Error('The status panel should have failed with data under the error.');
      expect(broken.lastGood.data.nextUpForMark).toHaveLength(3);
      expect(broken.lastGood.data.updated).toBe('2026-01-02');
      expect(broken.lastGood.data.milestones).toEqual([]);

      await page.addInitScript((key) => localStorage.setItem(key, 'off'), GLASS_KEY);
      await page.goto('/');
      await allLoaded(page);
      const status = panel(page, 'Status');

      // Five rows, and four of them show a value. Next up and status.md show the data of status.md, as links to its page.
      await expect(status.locator('dl > div')).toHaveCount(5);
      await expect(rowOf(page, 'Next up').getByRole('link')).toHaveText('3 for you');
      await expect(rowOf(page, 'Next up').getByRole('link')).toHaveAttribute('href', '/docs/status');
      await expect(rowOf(page, 'status.md').getByRole('link')).toHaveText(new Date().getFullYear() === 2026 ? 'updated Jan 2' : 'updated Jan 2, 2026');
      for (const label of ['Branch', 'CI on main', 'Next up', 'status.md', 'Last commit']) {
        await expect(rowOf(page, label), label).not.toContainText('Unavailable');
        await expect(rowOf(page, label).getByRole('button', { name: 'Retry' }), label).toHaveCount(0);
      }

      // The strip is the one place that says Unavailable, with the code of the table and a Retry button. It has no squares.
      await expect(status.getByText('Unavailable')).toHaveCount(1);
      await expect(status.getByText('milestones-table-missing', { exact: true })).toBeVisible();
      await expect(status.getByRole('button', { name: 'Retry Milestone' })).toBeVisible();
      await expect(stripOf(page)).toHaveCount(0);
      // The panel is not an alert and not blank: it has its rows and its time.
      await expect(status.getByRole('alert')).toHaveCount(0);
      await expect(status.locator('header time')).toHaveText(/^\d\d:\d\d:\d\d$/);
    } finally {
      writeFileSync(MIGRATION_MD, original);
      await expect.poll(async () => (await readStatus()).ok, { timeout: 15_000 }).toBe(true);
    }

    // The table is mended: the open page hears of it and the strip has its squares again, with no reload.
    await expect(squaresOf(page)).toHaveCount(SQUARES.length);
    await expect(panel(page, 'Status').getByText('Unavailable')).toHaveCount(0);
  });

  test('status panel shows an error row when a source fails and keeps the other rows', async ({ page, request }) => {
    await setRun(request, run('completed', 'success'));
    const failedPanel = (code: string, lastGood: unknown = null) => ({ ok: false, error: { code, message: `The ${code} source could not be read.` }, updatedAt: null, lastGood });

    // Each source on its own: the rows that need it show an error label, the code of the failure and a Retry button, and every other row shows its value.
    const cases = [
      { source: 'status', route: '**/api/status', code: 'status-missing', reply: () => ({ json: failedPanel('status-missing') }), failing: ['Next up', 'status.md'], stripFails: true, staying: ['Branch', 'CI on main', 'Last commit'] },
      { source: 'git', route: '**/api/git', code: 'git-failed', reply: () => ({ json: failedPanel('git-failed') }), failing: ['Branch', 'Last commit'], stripFails: false, staying: ['CI on main', 'Next up', 'status.md'] },
      // The CI source has an older run (the panel carries it as lastGood): the row still says "Unavailable" and does not show the run that may be out of date.
      {
        source: 'ci',
        route: '**/api/ci',
        code: 'gh-not-signed-in',
        reply: () => ({ json: failedPanel('gh-not-signed-in', { data: { state: 'passing', createdAt: new Date().toISOString(), url: RUN_URL }, updatedAt: new Date().toISOString() }) }),
        failing: ['CI on main'],
        stripFails: false,
        staying: ['Branch', 'Next up', 'status.md', 'Last commit'],
      },
      // The health reply has the name of the repo on GitHub, which the links of the branch and of the last commit are made from.
      { source: 'health', route: '**/api/health', code: 'internal-error', reply: () => ({ status: 500, json: { ok: false, error: { code: 'internal-error', message: 'The server failed. Read its console for the cause.' } } }), failing: ['Branch', 'Last commit'], stripFails: false, staying: ['CI on main', 'Next up', 'status.md'] },
    ];
    // What each row says when its sources are good (the fixture repo has no upstream, and its last commit is old).
    const VALUES: Record<string, RegExp> = {
      Branch: /^main\s*no upstream$/,
      'CI on main': /^passing 2 h ago$/,
      'Next up': /^3 for you$/,
      'status.md': /^updated Jan 2/,
      'Last commit': /\d+ d ago$/,
    };

    await page.addInitScript((key) => localStorage.setItem(key, 'off'), GLASS_KEY);
    for (const item of cases) {
      await page.route(item.route, (route) => route.fulfill(item.reply()));
      await page.goto('/');
      const status = panel(page, 'Status');
      await expect(status.locator('dl > div')).toHaveCount(5);

      for (const label of item.failing) {
        const failing = rowOf(page, label);
        await expect(failing, `${item.source}: ${label}`).toContainText('Unavailable');
        await expect(failing, `${item.source}: ${label}`).toContainText(item.code);
        await expect(failing.getByRole('button', { name: 'Retry' })).toBeVisible();
        await expect(failing.getByRole('link')).toHaveCount(0);
        await expect(failing, `${item.source}: ${label} shows no value`).not.toHaveText(VALUES[label] as RegExp);
      }
      for (const label of item.staying) {
        const staying = rowOf(page, label);
        await expect(staying, `${item.source}: ${label}`).not.toContainText('Unavailable');
        await expect(staying.locator('dd'), `${item.source}: ${label}`).toHaveText(VALUES[label] as RegExp);
        await expect(staying.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      }
      // The strip is the status source's too: it says "Unavailable" when that source failed, and keeps its squares otherwise.
      if (item.stripFails) {
        await expect(status.getByText('Unavailable')).toHaveCount(item.failing.length + 1);
        await expect(stripOf(page)).toHaveCount(0);
      } else {
        await expect(status.getByText('Unavailable')).toHaveCount(item.failing.length);
        await expect(squaresOf(page)).toHaveCount(SQUARES.length);
      }
      // The panel is not an alert and not blank: it still has its rows and its time, and nothing else on the page shows an error of this source.
      await expect(status.getByRole('alert')).toHaveCount(0);
      await expect(status.locator('header time')).toHaveText(/^\d\d:\d\d:\d\d$/);

      // Retry asks the failed source again: the source works now, and the rows come back with their values.
      await page.unroute(item.route);
      await rowOf(page, item.failing[0] as string).getByRole('button', { name: 'Retry' }).click();
      await expect(status.getByText('Unavailable')).toHaveCount(0);
      for (const label of [...item.failing, ...item.staying]) await expect(rowOf(page, label).locator('dd'), `${item.source}: ${label} after Retry`).toHaveText(VALUES[label] as RegExp);
    }
  });

  test('with no source good, the status panel shows the error of its sources and a Retry button', async ({ page }) => {
    // The server is not there at all: every request fails, and no row could say anything. The panel shows the error of its sources once, and a Retry button.
    for (const path of ['**/api/status', '**/api/git', '**/api/ci', '**/api/health']) await page.route(path, (route) => route.abort());
    await page.addInitScript((key) => localStorage.setItem(key, 'off'), GLASS_KEY);
    await page.goto('/');
    const status = panel(page, 'Status');
    const alert = status.getByRole('alert');
    await expect(alert).toContainText('Cannot reach the command center server');
    await expect(alert).toContainText('network');
    await expect(status.locator('dl')).toHaveCount(0);
    await expect(status.locator('header')).toContainText('Not updated yet');

    // The server answers again: Retry loads the four sources, and the rows are there.
    for (const path of ['**/api/status', '**/api/git', '**/api/ci', '**/api/health']) await page.unroute(path);
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(status.locator('dl > div')).toHaveCount(5);
    await expect(status.getByRole('alert')).toHaveCount(0);
  });

  test('status panel has no right-now text, no milestone list and no commit list', async ({ page }) => {
    await page.goto('/');
    await allLoaded(page);
    const status = panel(page, 'Status');
    await expect(status.locator('dl > div')).toHaveCount(5);

    // The text of status.md is not on the panel, and neither are the milestone names and scope, and the subjects of the commits. (The Your move panel may show the
    // Next up items: this is the Status panel only.)
    for (const text of [
      'Right now',
      'The widget is done',
      'Review the widget pictures',
      'Pick the gadget color',
      'A short last item',
      'Platform spike',
      'A spike that tests the design',
      'The loop and the first scene',
      'Add the second doc',
      'Add the first doc',
      'Fixture Author',
      'Recent commits',
      'Milestones',
    ]) {
      await expect(status.getByText(text), text).toHaveCount(0);
    }
    // There is no region of its own for any of these parts, and the only heading is the title of the panel.
    for (const name of ['Right now', 'Milestones', 'Recent commits', 'Branch']) await expect(status.getByRole('region', { name })).toHaveCount(0);
    await expect(status.getByRole('heading')).toHaveText(['Status']);
    // The only lists are the five rows (a description list) and the strip: the strip holds squares with no words in them, and nothing lists the commits or the milestones as text.
    await expect(status.locator('ul, ol')).toHaveCount(1);
    await expect(status.locator('ol')).toHaveAttribute('aria-label', 'Milestones');
    await expect(status.locator('dl')).toHaveCount(1);
    for (const square of await squaresOf(page).all()) await expect(square).toHaveText('');
    await expect(status.getByRole('listitem')).toHaveCount(SQUARES.length);

    // Every piece of text on the panel is a label, a number, a date or a link: none has a sentence's end, and none is longer than the longest name of a milestone.
    const pieces = await status.evaluate((root) => {
      const found: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text !== '') found.push(text);
      }
      return found;
    });
    expect(pieces.length).toBeGreaterThan(10);
    for (const piece of pieces) {
      expect(piece.split(' ').length, piece).toBeLessThanOrEqual(6);
      expect(piece, piece).not.toMatch(/[.!?:;]$/);
    }
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
    await expect(page.getByText('Live: on', { exact: true })).toBeVisible();
    const items = panel(page, 'Your move').getByRole('list', { name: 'What waits for Mark' }).getByRole('listitem');
    for (const light of ['Red light', 'Yellow light', 'Green light']) await expect(items.filter({ hasText: light }).first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(15);

    const colors = await tokenColors(page);
    for (const mode of NO_GPU ? (['plain'] as const) : (['glass', 'plain'] as const)) {
      if (mode === 'plain' && !NO_GPU) {
        await glassSwitch(page).click();
        await expect(page.locator('canvas')).toHaveCount(0);
      }
      await expectAtMostTwoAmberItems(page);
      // The one amber item is the count of Your move.
      const amber = await amberItems(page);
      expect(amber, mode).toHaveLength(1);
      // The words after the number are for a screen reader: "N items for you".
      expect(amber[0], mode).toMatch(/\d+ items for you/);
      expect(amber[0], mode).not.toContain('wait');
      // The lights are not amber: their words and icons are the soft text color.
      const light = items.filter({ hasText: 'Red light' }).first().getByText('Red light');
      expect(await light.evaluate((element) => getComputedStyle(element).color), mode).toBe(colors.soft);
    }
  });

  test('the text on the glass keeps the 4.5 to 1 floor of the Look, wherever it stands on the page, at both sizes', async ({ page, request }) => {
    test.skip(NO_GPU, NO_GPU_REASON);
    // The glass is drawn by the GPU behind the page, and shows through the panels, so the contrast of a text on it can only be read from the picture: the test
    // hides the text, takes a picture of what is behind it, and finds the text with the least contrast. The page has every kind of text: titles, links, the small
    // `soft` labels (the lowest ratio of the set), the lights of the items of Your move, the chips of the pull requests, and the rows and the milestone strip of the Status.
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
