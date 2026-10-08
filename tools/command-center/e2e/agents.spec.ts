import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';
import { E2E_DIR } from './fake-gh';
import { amberItems, contrastOf, expectAtMostTwoAmberItems, tokenColors } from './look';

// The Agents page (/agents) in a browser: the sessions of the last week with their agents and workflows, over the fixture server (e2e/server.ts). The tests write made-up
// session files into the folders that the end-to-end config names (and delete them afterwards), ask the server to look again, and open the page. Every title, description
// and name below is made up. The server decides which sessions are listed and in what order (and the page only draws them), so some of these tests are also tests of that window.

const REPO = join(E2E_DIR, 'repo'); // the one root of the end-to-end config
const ELSEWHERE = join(E2E_DIR, 'elsewhere'); // a folder that is not inside it
const PROJECTS = join(E2E_DIR, 'claude-projects'); // `claude.projectsRoot` of the end-to-end config
const WHOLE = join(PROJECTS, 'fixture-shadow-jog'); // `claude.folders`: every session in it is Shadow Jog's
const MIXED = join(PROJECTS, 'fixture-home-base'); // `claude.cwdMatchFolders`: a session counts only when its working folder is inside the root

/** Where the page says that Claude Code keeps its session files (see src/web/agents/SessionCard.tsx). */
const CLAUDE_PROJECTS = '~/.claude/projects';

const ID = (n: number) => `e2e00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY_SECONDS = 24 * 60 * 60;

// ---- made-up session files ----

type Line = Record<string, unknown>;

/**
 * One moment for a whole fixture. Every time in it is counted from this one moment, so the length between two of its times is exact: the real clock moves a little
 * between two calls of Date.now, and a length of 360.000 s that comes out as 359.998 s would show as "5 min" and not "6 min".
 */
function clock() {
  const base = Date.now();
  return { at: (secondsAgo: number) => new Date(base - secondsAgo * 1000).toISOString(), ms: (secondsAgo: number) => base - secondsAgo * 1000 };
}

const line = (type: 'user' | 'assistant', timestamp: string, cwd: string, message: Line, extra: Line = {}): Line => ({ type, timestamp, cwd, gitBranch: 'fixture-branch', sessionId: 'e2e', entrypoint: 'claude-desktop', message, ...extra });
const prompt = (text: string, timestamp: string, cwd = REPO) => line('user', timestamp, cwd, { role: 'user', content: text });
const reply = (text: string, timestamp: string, cwd = REPO) => line('assistant', timestamp, cwd, { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] });
/** A tool result after the last reply: the session (or agent) works again. */
const toolResult = (timestamp: string, cwd = REPO) => line('user', timestamp, cwd, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_e2e', content: 'made up' }] }, { toolUseResult: { ok: true } });
const box = (light: string, items: string[]) => `${light} Two files changed.\n\n---\n### 👉 Your move\n${items.map((item) => `- [ ] ${item}`).join('\n')}`;
const prLink = (number: number): Line => ({ type: 'pr-link', prNumber: number, prUrl: `https://github.com/fixture-owner/fixture-repo/pull/${number}`, prRepository: 'fixture-owner/fixture-repo' });

function writeLines(file: string, lines: Line[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

/** Sets the time of last write of a file: the age of a session is the age of its newest file. */
function touch(file: string, ms: number): void {
  utimesSync(file, new Date(ms), new Date(ms));
}

function writeAgent(sessionDir: string, id: string, description: string, lines: Line[], touchedAt?: number): void {
  const file = join(sessionDir, 'subagents', `agent-${id}.jsonl`);
  writeLines(file, lines);
  writeFileSync(join(sessionDir, 'subagents', `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description, model: 'sonnet' }));
  if (touchedAt !== undefined) touch(file, touchedAt);
}

/** A workflow run: its journal (rows `started` and `result`), its script (the name of the workflow) and one agent file for each agent that is still at work. */
function writeWorkflow(sessionDir: string, run: string, name: string, phases: { name: string; started: number; done: number }[], working: string[] = []): void {
  const runDir = join(sessionDir, 'subagents', 'workflows', run);
  const rows: Line[] = [{ type: 'launched' }];
  for (const phase of phases) {
    for (let i = 1; i <= phase.started; i += 1) rows.push({ type: 'started', key: `${phase.name}/${i}`, agentId: `${phase.name.toLowerCase()}${i}`, label: 'made up', phase: phase.name });
    for (let i = 1; i <= phase.done; i += 1) rows.push({ type: 'result', key: `${phase.name}/${i}`, agentId: `${phase.name.toLowerCase()}${i}`, result: 'made up' });
  }
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'journal.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  for (const agent of working) writeLines(join(runDir, `agent-${agent}.jsonl`), [prompt('made up', new Date().toISOString()), toolResult(new Date().toISOString())]);
  mkdirSync(join(sessionDir, 'workflows', 'scripts'), { recursive: true });
  writeFileSync(join(sessionDir, 'workflows', 'scripts', `${name}-${run}.js`), '// made up\n');
}

/**
 * Seven sessions of the last week, from the two folders of the config, each last written at its own time, and one of eight days ago. Newest first (by the time of the last write):
 *   1 working (now): a pull request, a running, a finished and a stopped agent, a workflow at work (2 of 3 agents done in two phases) and a workflow that is done
 *   2 waiting for Mark (10 min ago), with a yellow "Your move" box
 *   3 waiting, in the home-base folder (15 min ago): listed because its working folder is inside the root
 *   4 unknown state (30 min ago): the file holds only notes of Claude Code, and no conversation
 *   5 idle (5 h ago), with a finished agent: it ran 2 h 30 min
 *   6 idle (3 days ago): it ran 45 min
 *   7 idle (6 days ago): it ran 10 min
 * Session 8 was last written 8 days ago and is not listed.
 */
function writeWeek(): void {
  const c = clock();

  const first = join(WHOLE, `${ID(1)}.jsonl`);
  writeLines(first, [prompt('Build the agents page of the command center\nsecond line of the prompt', c.at(1830)), prLink(12), reply('On it.', c.at(1700)), toolResult(c.at(4))]);
  const one = join(WHOLE, ID(1));
  writeAgent(one, 'run00001', 'Explore the fixture engine docs', [prompt('made up', c.at(240)), toolResult(c.at(5))]);
  writeAgent(one, 'done0001', 'Check the milestone table', [prompt('made up', c.at(600)), reply('Done.', c.at(240))]);
  writeAgent(one, 'stop0001', 'Retry the stalled export', [prompt('made up', c.at(5400)), toolResult(c.at(5300))], c.ms(5300));
  writeWorkflow(one, 'wf_00000001-aaa', 'fixture-build', [{ name: 'Research', started: 2, done: 2 }, { name: 'Build', started: 1, done: 0 }], ['build1']);
  writeWorkflow(one, 'wf_00000002-bbb', 'fixture-review', [{ name: 'Read', started: 2, done: 2 }]);

  const second = join(WHOLE, `${ID(2)}.jsonl`);
  writeLines(second, [prompt('Review the engine docs for the fixture', c.at(3000)), reply(box('🟡', ['Review the diff', 'Tell me to commit']), c.at(600))]);
  touch(second, c.ms(600));

  const third = join(MIXED, `${ID(3)}.jsonl`);
  writeLines(third, [prompt('Update the glossary from the home-base folder', c.at(2700)), reply('Done.', c.at(900))]);
  touch(third, c.ms(900));

  // Only notes of Claude Code (lines of types that the server knows, and none of a conversation): the state of the session is unknown. The first note says when it began.
  const fourth = join(WHOLE, `${ID(4)}.jsonl`);
  writeLines(fourth, [{ type: 'last-prompt', lastPrompt: 'made up', timestamp: c.at(2400) }, { type: 'mode', mode: 'normal' }]);
  touch(fourth, c.ms(1800));

  const fifth = join(WHOLE, `${ID(5)}.jsonl`);
  writeLines(fifth, [prompt('Fix the failing check on the gadget branch', c.at(27000)), reply('Fixed.', c.at(18000))]);
  writeAgent(join(WHOLE, ID(5)), 'idle0001', 'Look at the failing e2e job', [prompt('made up', c.at(26000)), reply('Done.', c.at(25000))], c.ms(25000));
  touch(fifth, c.ms(18000));

  const sixth = join(WHOLE, `${ID(6)}.jsonl`);
  writeLines(sixth, [prompt('Plan the engine migration milestones', c.at(3 * DAY_SECONDS + 2700)), reply('Planned.', c.at(3 * DAY_SECONDS))]);
  touch(sixth, c.ms(3 * DAY_SECONDS));

  const seventh = join(WHOLE, `${ID(7)}.jsonl`);
  writeLines(seventh, [prompt('Sketch the first tileset', c.at(6 * DAY_SECONDS + 600)), reply('Sketched.', c.at(6 * DAY_SECONDS))]);
  touch(seventh, c.ms(6 * DAY_SECONDS));

  const eighth = join(WHOLE, `${ID(8)}.jsonl`);
  writeLines(eighth, [prompt('A session older than a week', c.at(8 * DAY_SECONDS + 600)), reply('Done.', c.at(8 * DAY_SECONDS))]);
  touch(eighth, c.ms(8 * DAY_SECONDS));
}

/** The titles of `writeWeek`, newest first. A session with no prompt is titled "Session" and the first 8 characters of its id. */
const WEEK_TITLES = [
  'Build the agents page of the command center',
  'Review the engine docs for the fixture',
  'Update the glossary from the home-base folder',
  'Session e2e00000',
  'Fix the failing check on the gadget branch',
  'Plan the engine migration milestones',
  'Sketch the first tileset',
];

async function refreshSessions(request: APIRequestContext): Promise<void> {
  expect((await request.get('/api/sessions?refresh=1')).status()).toBe(200);
}

test.beforeEach(() => rmSync(PROJECTS, { recursive: true, force: true }));
test.afterEach(async ({ request }) => {
  rmSync(PROJECTS, { recursive: true, force: true });
  await request.get('/api/sessions?refresh=1');
});

// ---- what the tests look at ----

/** A page must not log an error or a warning to the console: a blocked script or style shows up there, and so does a list that React cannot key. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

const sessionsPanel = (page: Page) => page.getByRole('region', { name: 'Sessions', exact: true });
const cardOf = (page: Page, title: string) => page.getByRole('article', { name: title, exact: true });
/** The agents and the workflows of a card, one row each. */
const rowsOf = (card: Locator) => card.getByRole('list', { name: /^Agents and workflows of / });
const rowOf = (card: Locator, words: string) => rowsOf(card).getByRole('listitem').filter({ hasText: words });

/** Opens the page and waits until the list has loaded. */
async function openAgents(page: Page, path = '/agents'): Promise<void> {
  await page.goto(path);
  await expect(sessionsPanel(page)).toContainText(/Updated \d\d:\d\d:\d\d/);
}

// ---- the list ----

test.describe('the list', () => {
  test('lists the sessions of the last week, newest first, with agents and workflows, state and run time', async ({ page, request }) => {
    const problems = watchConsole(page);
    writeWeek();
    await refreshSessions(request);
    await openAgents(page);

    await expect(page).toHaveTitle('Agents · Shadow Jog Command Center');
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();

    // The seven sessions of the week, the newest first (by the last write, across both folders). The session of eight days ago is not listed.
    const cards = sessionsPanel(page).getByRole('article');
    await expect(cards.getByRole('heading', { level: 3 })).toHaveText(WEEK_TITLES);
    await expect(page.getByText('A session older than a week')).toHaveCount(0);

    // The state of each session, in words, and how long it ran. A session that is over ran from its first line to its last write, so its length is exact. One that is live has run
    // until now, so its length depends on the clock of the run: it is "30 min" a few seconds after the fixture was made.
    const states: [string, string, string | RegExp][] = [
      [WEEK_TITLES[0] as string, 'working', /^(30|31) min$/],
      [WEEK_TITLES[1] as string, 'waiting for you', /^(50|51) min$/],
      [WEEK_TITLES[2] as string, 'waiting for you', /^(45|46) min$/],
      [WEEK_TITLES[3] as string, 'unknown', '10 min'],
      [WEEK_TITLES[4] as string, 'idle', '2 h 30 min'],
      [WEEK_TITLES[5] as string, 'idle', '45 min'],
      [WEEK_TITLES[6] as string, 'idle', '10 min'],
    ];
    for (const [title, state, runTime] of states) {
      const card = cardOf(page, title);
      await expect(card.getByText(state, { exact: true }), `${title}: state`).toBeVisible();
      await expect(card.getByText(runTime, { exact: typeof runTime === 'string' }).first(), `${title}: run time`).toBeVisible();
    }

    // The agents and workflows of the first session. A workflow that is at work comes first, then the one that is done; the agents follow, the one that runs first.
    const first = cardOf(page, WEEK_TITLES[0] as string);
    await expect(rowsOf(first).getByRole('listitem')).toHaveCount(5);
    await expect(rowsOf(first).getByRole('listitem').nth(0)).toContainText('fixture-build');
    await expect(rowsOf(first).getByRole('listitem').nth(1)).toContainText('fixture-review');
    await expect(rowsOf(first).getByRole('listitem').nth(2)).toContainText('Explore the fixture engine docs');
    await expect(rowsOf(first).getByRole('listitem').nth(3)).toContainText('Check the milestone table');
    await expect(rowsOf(first).getByRole('listitem').nth(4)).toContainText('Retry the stalled export');

    // A workflow shows how many of its agents are done (its bar), its state, and how long it has run. The agents of a workflow have no row of their own.
    const building = rowOf(first, 'fixture-build');
    await expect(building).toContainText('running');
    await expect(building).toContainText('2 of 3 agents done');
    await expect(building.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
    await expect(building).toContainText(/\d+ s|\d+ min/);
    const reviewing = rowOf(first, 'fixture-review');
    await expect(reviewing).toContainText('done');
    await expect(reviewing).toContainText('2 of 2 agents done');
    await expect(reviewing.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    // An agent that runs has a bar that moves (no value). One that finished has a full bar and the length it ran (6 min: from 10 min ago to 4 min ago).
    // One that stopped has an empty bar, and the length between its first and its last line (100 s).
    const running = rowOf(first, 'Explore the fixture engine docs');
    await expect(running).toContainText('running');
    await expect(running.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    const finished = rowOf(first, 'Check the milestone table');
    await expect(finished).toContainText('done');
    await expect(finished).toContainText('6 min');
    await expect(finished.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    const stopped = rowOf(first, 'Retry the stalled export');
    await expect(stopped).toContainText('stopped');
    await expect(stopped).toContainText('1 min');
    await expect(stopped.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    // What the session says about itself: when it started and was last active, its branch, and the pull request that it linked (a link to GitHub).
    await expect(first).toContainText('fixture-branch');
    await expect(first.getByRole('link', { name: /PR #12/ })).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo/pull/12');
    await expect(first.locator('time')).not.toHaveCount(0);

    // The idle session has its own agent, a session with no agent has no list, and the agents of a session are not in another card.
    await expect(rowsOf(cardOf(page, WEEK_TITLES[4] as string)).getByRole('listitem')).toHaveCount(1);
    await expect(rowsOf(cardOf(page, WEEK_TITLES[4] as string))).toContainText('Look at the failing e2e job');
    await expect(rowsOf(cardOf(page, WEEK_TITLES[5] as string))).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a session with many agents shows the five that matter and a button for the rest', async ({ page, request }) => {
    // Seven agents of one session: six are done and the oldest of them all is still at work. A page that kept the order of the server (the newest first) would hide it.
    const c = clock();
    const file = join(WHOLE, `${ID(1)}.jsonl`);
    writeLines(file, [prompt('Run many agents', c.at(7200)), reply('Started.', c.at(7100)), toolResult(c.at(3))]);
    const session = join(WHOLE, ID(1));
    writeAgent(session, 'still001', 'Agent that still runs', [prompt('made up', c.at(7000)), toolResult(c.at(4))]);
    for (let n = 1; n <= 6; n += 1) writeAgent(session, `done000${n}`, `Agent number ${n}`, [prompt('made up', c.at(3600 - n * 100)), reply('Done.', c.at(3500 - n * 100))]);
    await refreshSessions(request);
    await openAgents(page);

    const card = cardOf(page, 'Run many agents');
    const rows = rowsOf(card).getByRole('listitem');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('Agent that still runs');
    await expect(rows.nth(1)).toContainText('Agent number 6'); // the newest of the finished ones
    const more = card.getByRole('button', { name: 'Show all 7 agents' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    await more.click();
    await expect(rows).toHaveCount(7);
    const fewer = card.getByRole('button', { name: 'Show fewer agents' });
    await expect(fewer).toHaveAttribute('aria-expanded', 'true');
    await fewer.click();
    await expect(rows).toHaveCount(5);
  });

  test('a session that starts while the page is open shows without a reload, on top', async ({ page, request }) => {
    const c = clock();
    writeLines(join(WHOLE, `${ID(1)}.jsonl`), [prompt('The session that was there first', c.at(7200)), reply('Done.', c.at(7000))]);
    touch(join(WHOLE, `${ID(1)}.jsonl`), c.ms(7000));
    await refreshSessions(request);
    await openAgents(page);
    await expect(sessionsPanel(page).getByRole('article')).toHaveCount(1);

    // A new session begins. The server looks at the files (every 10 seconds, and here at once), says that the sessions changed, and the page loads them again by itself.
    writeLines(join(WHOLE, `${ID(2)}.jsonl`), [prompt('The session that began later', c.at(60)), toolResult(c.at(5))]);
    await refreshSessions(request);
    await expect(sessionsPanel(page).getByRole('article').getByRole('heading', { level: 3 })).toHaveText(['The session that began later', 'The session that was there first']);
    await expect(sessionsPanel(page)).toContainText(/Updated \d\d:\d\d:\d\d/);
  });

  test('the words of a session file show as text, never as markup', async ({ page, request }) => {
    // A title, an agent's description, a branch and the name of a phase all come from files that a session wrote, so any of them can hold anything. None may become an element.
    const c = clock();
    const file = join(WHOLE, `${ID(1)}.jsonl`);
    writeLines(file, [{ ...prompt('<b>Bold</b> and <i>italic</i> title', c.at(600)), gitBranch: 'feature/<u>branch</u>' }, { ...toolResult(c.at(4)), gitBranch: 'feature/<u>branch</u>' }]);
    const session = join(WHOLE, ID(1));
    writeAgent(session, 'markup01', '<img src=x onerror="window.__pwned = 1"> described', [prompt('made up', c.at(300)), toolResult(c.at(5))]);
    writeWorkflow(session, 'wf_00000001-aaa', 'fixture-build', [{ name: '<s>Phase</s> one', started: 1, done: 0 }], ['phase01']);
    await refreshSessions(request);
    await openAgents(page);

    const card = cardOf(page, '<b>Bold</b> and <i>italic</i> title');
    await expect(card).toBeVisible();
    await expect(card.getByText('feature/<u>branch</u>', { exact: true })).toBeVisible();
    await expect(rowOf(card, '<img src=x onerror="window.__pwned = 1"> described')).toBeVisible();
    await rowOf(card, 'fixture-build').getByRole('button', { name: /^Phases/ }).click();
    await expect(card.getByText('<s>Phase</s> one', { exact: true })).toBeVisible();
    // No element came out of any of them, and nothing ran.
    await expect(page.locator('main').locator('b, i, u, s, img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('the top bar of the Now page and of the docs links to the Agents page', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Agents' }).click();
    await expect(page).toHaveURL('/agents');
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    // The Agents page marks itself as the current page, and leads back to the others.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL('/docs');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Agents' })).toBeVisible();
  });
});

// ---- a workflow ----

test.describe('a workflow', () => {
  test('a workflow expands to its phases (done of started)', async ({ page, request }) => {
    writeWeek();
    await refreshSessions(request);
    await openAgents(page);

    const first = cardOf(page, WEEK_TITLES[0] as string);
    const workflow = rowOf(first, 'fixture-build');
    const toggle = workflow.getByRole('button', { name: /^Phases/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(workflow.getByRole('list', { name: 'Phases of fixture-build' })).toHaveCount(0);

    // Open: one line for each phase, in the order of the journal, with the agents done of the agents started, and a bar with the same two numbers.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const phases = workflow.getByRole('list', { name: 'Phases of fixture-build' }).getByRole('listitem');
    await expect(phases).toHaveCount(2);
    await expect(phases.nth(0)).toContainText('Research');
    await expect(phases.nth(0)).toContainText('2 of 2 agents done');
    await expect(phases.nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(phases.nth(1)).toContainText('Build');
    await expect(phases.nth(1)).toContainText('0 of 1 agents done');
    await expect(phases.nth(1).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    // The other workflow is still closed, and a second press closes this one.
    await expect(rowOf(first, 'fixture-review').getByRole('button', { name: /^Phases/ })).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(workflow.getByRole('list', { name: 'Phases of fixture-build' })).toHaveCount(0);
  });
});

// ---- the files ----

test.describe('the files', () => {
  test('a file path shows with a Copy button and no file:// link', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    writeWeek();
    await refreshSessions(request);
    await openAgents(page);

    const first = cardOf(page, WEEK_TITLES[0] as string);
    const sessionFile = `${CLAUDE_PROJECTS}/fixture-shadow-jog/${ID(1)}.jsonl`;
    const agentFiles = `${CLAUDE_PROJECTS}/fixture-shadow-jog/${ID(1)}/subagents`;
    // The path is text, and the card has a button that copies it. (A web page cannot open a file: address, so the page offers no link to the file.)
    await expect(first.getByText(sessionFile, { exact: true })).toBeVisible();
    await expect(first.getByText(agentFiles, { exact: true })).toBeVisible();
    await expect(first.getByText('Session file', { exact: true })).toBeVisible();

    const copy = first.getByRole('button', { name: /^Copy the path of the session file/ });
    await expect(copy).toHaveText('Copy');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sessionFile);

    // The folder of the agent files has its own button, and it copies its own path.
    await first.getByRole('button', { name: /^Copy the path of the agent files/ }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(agentFiles);

    // The journal of a workflow is in its phases, with its own button.
    await rowOf(first, 'fixture-build').getByRole('button', { name: /^Phases/ }).click();
    const journal = `${CLAUDE_PROJECTS}/fixture-shadow-jog/${ID(1)}/subagents/workflows/wf_00000001-aaa/journal.jsonl`;
    await expect(rowOf(first, 'fixture-build').getByText(journal, { exact: true })).toBeVisible();
    await rowOf(first, 'fixture-build').getByRole('button', { name: /^Copy the path of the journal/ }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(journal);

    // A session of the home-base folder has the path of that folder.
    await expect(cardOf(page, WEEK_TITLES[2] as string).getByText(`${CLAUDE_PROJECTS}/fixture-home-base/${ID(3)}.jsonl`, { exact: true })).toBeVisible();

    // No address of the page is a file: address, and no path is inside a link.
    await expect(page.locator('a[href^="file:" i]')).toHaveCount(0);
    await expect(first.getByText(sessionFile, { exact: true }).locator('xpath=ancestor-or-self::a')).toHaveCount(0);
    // Each Copy button says which path it copies, so a list of them is not "Copy, Copy, Copy" for a screen reader.
    const names = await page.getByRole('button', { name: /^Copy the path of/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(names.length);
  });

  test('a copy that the browser refuses says so', async ({ page, request }) => {
    // The browser says no to the clipboard (a permission that was refused, or a page that is not a secure context): the page must not look as if it had copied.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    writeWeek();
    await refreshSessions(request);
    await openAgents(page);

    const first = cardOf(page, WEEK_TITLES[0] as string);
    const copy = first.getByRole('button', { name: /^Copy the path of the session file/ });
    await copy.click();
    await expect(first.getByRole('alert')).toContainText('Could not copy the path. Select it and copy it by hand.');
    await expect(copy).toHaveText('Copy');
    // The path is still there to select: one click selects all of it.
    await first.getByText(`${CLAUDE_PROJECTS}/fixture-shadow-jog/${ID(1)}.jsonl`, { exact: true }).click();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(`${CLAUDE_PROJECTS}/fixture-shadow-jog/${ID(1)}.jsonl`);
  });
});

// ---- a list that is empty, and a page that cannot be read ----

test.describe('what the page says when there is nothing to list, or it cannot read the files', () => {
  test('an empty state shows when no session matches', async ({ page, request }) => {
    const problems = watchConsole(page);
    // Three recent files, and none of them is a session to list: two are about other projects, and a script started the third.
    const c = clock();
    writeLines(join(MIXED, `${ID(1)}.jsonl`), [prompt('LEAK-other-project', c.at(60), ELSEWHERE), reply('Done.', c.at(50), ELSEWHERE)]);
    writeLines(join(MIXED, `${ID(2)}.jsonl`), [{ type: 'last-prompt', lastPrompt: 'LEAK-no-working-folder' }, { type: 'mode', mode: 'normal' }]);
    writeLines(join(WHOLE, `${ID(3)}.jsonl`), [{ ...prompt('LEAK-automated-run', c.at(40)), entrypoint: 'sdk-py' }, { ...reply('Done.', c.at(30)), entrypoint: 'sdk-py' }]);
    await refreshSessions(request);
    await openAgents(page);

    const panel = sessionsPanel(page);
    await expect(panel).toContainText('No session matches.');
    await expect(panel).toContainText('3 recent session files were looked at.');
    await expect(panel).toContainText('2 are not about Shadow Jog, or could not be read.');
    await expect(panel).toContainText('1 automated SDK run is hidden');
    // Nothing is listed, and nothing of the files that were left out is on the page.
    await expect(panel.getByRole('article')).toHaveCount(0);
    await expect(panel.getByRole('list')).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(/LEAK-/)).toHaveCount(0);

    // The files go away and the page, which is still open, says that there is no file: it hears of the change and loads again.
    rmSync(PROJECTS, { recursive: true, force: true });
    await refreshSessions(request);
    await expect(panel).toContainText('No session matches.');
    await expect(panel).toContainText('No session file was written in the recent window (7 days by default).');
    await expect(panel).not.toContainText('were looked at');
    expect(problems).toEqual([]);
  });

  test('an unknown file format shows the Sessions error state', async ({ page, request }) => {
    const problems = watchConsole(page);
    // Claude Code changed how it writes a session: the lines have no type that this tool knows. It is the one case where the module cannot tell a session from a stray file.
    writeLines(join(WHOLE, `${ID(1)}.jsonl`), [{ kind: 'greeting', data: 'LEAK-new-format' }, { kind: 'reply' }]);
    await refreshSessions(request);
    await page.goto('/agents');

    const panel = sessionsPanel(page);
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('unknown file format');
    await expect(alert).toContainText('sessions-unknown-format');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The panel says when it last had good data (the server loaded the folders before this test, and had none to list then), and shows that data under the error.
    await expect(panel).toContainText(/Last updated \d\d:\d\d:\d\d/);
    await expect(panel).toContainText('Last good data');
    // The error is the panel's own: the rest of the page is there, and the text of the files is not.
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2, name: 'Sessions' })).toBeVisible();
    await expect(page.getByText(/LEAK-/)).toHaveCount(0);
    await expectAtMostTwoAmberItems(page);
    // The icon of the error is ink, as in every panel: the one or two amber items of a page are not spent on an error.
    const colors = await tokenColors(page);
    await expect(alert.locator('svg').first()).toHaveCSS('color', colors.ink);

    // The files are mended (a session in a format that is known) and the server looks again. The page hears of the change and loads the list again by itself: the error goes
    // and the session comes, with no reload and no press of Retry.
    writeLines(join(WHOLE, `${ID(1)}.jsonl`), [prompt('A session in the known format', new Date().toISOString()), reply('Done.', new Date().toISOString())]);
    await refreshSessions(request);
    await expect(cardOf(page, 'A session in the known format')).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel).not.toContainText('Last good data');
    // A failed panel is an answer with status 200 (see routes/panel.ts), so the error is the page's own and the console has nothing to say.
    expect(problems).toEqual([]);
  });
});

// ---- the link from "Your move" ----

test.describe('the link from Your move', () => {
  test('a session in Your move opens the Agents page at that session, and the page marks it', async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
    // A short window, so that the second session is below the fold and the page has to scroll to it.
    await page.setViewportSize({ width: 1280, height: 600 });
    writeWeek();
    await refreshSessions(request);
    await page.goto('/');

    // The item of the session's box is a link to its card.
    const item = page.getByRole('region', { name: 'Your move', exact: true }).getByRole('listitem').filter({ hasText: 'Review the diff' });
    const link = item.getByRole('link', { name: /Review the diff/ });
    await expect(link).toHaveAttribute('href', `/agents#session-${ID(2)}`);
    await link.click();

    await expect(page).toHaveURL(`/agents#session-${ID(2)}`);
    const target = cardOf(page, 'Review the engine docs for the fixture');
    await expect(target).toBeVisible();
    // The page scrolled to it, and marked it: the card is the one amber item of the page (the Look), and it says so for a screen reader.
    await expect(target).toHaveAttribute('aria-current', 'location');
    await expect(target).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.locator('article[aria-current="location"]')).toHaveCount(1);
    const colors = await tokenColors(page);
    await expect(target).toHaveCSS('border-top-color', colors.accent);
    expect(await amberItems(page)).toHaveLength(1);
    // The other cards are as they were: not marked, and not amber.
    await expect(cardOf(page, WEEK_TITLES[0] as string)).not.toHaveAttribute('aria-current', 'location');
    await expect(cardOf(page, WEEK_TITLES[0] as string)).not.toHaveCSS('border-top-color', colors.accent);
  });

  test('a link to a session that is not in the list says so, and marks nothing', async ({ page, request }) => {
    writeWeek();
    await refreshSessions(request);
    // The session of eight days ago has a file, and the page does not list it (the same would hold for a session that was never there).
    await openAgents(page, `/agents#session-${ID(8)}`);

    const note = sessionsPanel(page).getByRole('note', { name: 'Session not found' });
    await expect(note).toContainText('The session in the link is not in this list.');
    await expect(page.locator('article[aria-current="location"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The list itself is whole.
    await expect(sessionsPanel(page).getByRole('article')).toHaveCount(WEEK_TITLES.length);

    // A fragment that is not the link of a session is not a session that is missing.
    await openAgents(page, '/agents#something-else');
    await expect(sessionsPanel(page).getByRole('note', { name: 'Session not found' })).toHaveCount(0);
  });
});

// ---- the Look ----

test.describe('the Look', () => {
  test('the page keeps to two amber items in every state, and its small text keeps the 4.5 to 1 floor', async ({ page, request }) => {
    writeWeek();
    await refreshSessions(request);
    await openAgents(page);
    // The list has no amber: a pull request link is cyan, a state is a word, a bar is ink, and a button is the neutral one.
    expect(await amberItems(page)).toEqual([]);

    const first = cardOf(page, WEEK_TITLES[0] as string);
    await rowOf(first, 'fixture-build').getByRole('button', { name: /^Phases/ }).click();
    expect(await amberItems(page)).toEqual([]);

    // Every kind of small text of a card stands on the navy of the panel with 4.5 to 1 or more.
    for (const target of [
      first.getByRole('heading', { level: 3 }),
      first.getByText('working', { exact: true }),
      first.getByText('Session file', { exact: true }),
      first.getByText(`${CLAUDE_PROJECTS}/fixture-shadow-jog/${ID(1)}.jsonl`, { exact: true }),
      first.getByText('fixture-branch'),
      first.getByRole('link', { name: /PR #12/ }),
      rowOf(first, 'Explore the fixture engine docs').getByText(/^running/),
      rowOf(first, 'Explore the fixture engine docs').getByText(/^general-purpose/),
      rowOf(first, 'fixture-build').getByText('Research'),
    ]) {
      const { ratio, text, fill } = await contrastOf(target.first());
      expect(ratio, `${await target.first().textContent()}: ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }

    // The page of a session that was linked to has the one amber item, whichever state the page is in.
    await openAgents(page, `/agents#session-${ID(5)}`);
    expect(await amberItems(page)).toHaveLength(1);
    await expectAtMostTwoAmberItems(page);
  });
});
