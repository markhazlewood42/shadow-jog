import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';
import type { AgentsLive, Panel } from '../src/shared/types';
import {
  ID,
  LABELS,
  MIXED,
  PROCESSES,
  TITLES,
  WORKFLOW_RUN,
  agentCall,
  agentFile,
  clock,
  filler,
  journalFile,
  prompt,
  resetWorld,
  sendMessage,
  sessionFile,
  toolResult,
  writeAgent,
  writeLines,
  writeProcess,
  writeSession,
  writeWorld,
} from './agents-world';
import { amberItems, contrastOf, expectAtMostTwoAmberItems, tokenColors } from './look';

// The Agents page (/agents) in a browser: a live diagram of the sessions that run now, with their agents and workflows, over the fixture server (e2e/server.ts). The tests write
// a made-up world (e2e/agents-world.ts: process files, session files, agent files, a workflow journal), ask the server to look again, and open the page. The server decides
// what is alive and in what order (and the page only draws it), so some of these tests are also tests of that rule. Every title, label and message below is made up.

test.beforeEach(() => resetWorld());
test.afterEach(async ({ request }) => {
  resetWorld();
  await request.get('/api/agents?refresh=1');
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

async function refreshAgents(request: APIRequestContext): Promise<AgentsLive> {
  const res = await request.get('/api/agents?refresh=1');
  expect(res.status()).toBe(200);
  const panel = (await res.json()) as Panel<AgentsLive>;
  if (!panel.ok) throw new Error(`The agents panel failed: ${panel.error.message}`);
  return panel.data;
}

const panel = (page: Page) => page.getByRole('region', { name: 'Agents', exact: true });
const sessionBoxes = (page: Page) => panel(page).locator('[data-box="session"]');
const allBoxes = (page: Page) => panel(page).locator('[role="group"][data-box]');
/** A box by its title or label. A box is a group that its title names. */
const boxOf = (page: Page, title: string) => panel(page).getByRole('group', { name: title, exact: true });
const clusterOf = (page: Page, sessionId: string) => panel(page).locator(`[data-cluster="${sessionId}"]`);
const textList = (page: Page) => panel(page).getByRole('list', { name: 'Sessions and agents' });
const detailOf = (box: Locator) => box.locator('[data-part="detail"]');
const titleOf = (box: Locator) => box.locator('[data-part="title"]');
const copyButton = (box: Locator) => box.getByRole('button', { name: 'Copy path' });

/** Opens the page and waits until the diagram has loaded. */
async function openAgents(page: Page, path = '/agents'): Promise<void> {
  await page.goto(path);
  await expect(panel(page)).toContainText(/Updated \d\d:\d\d:\d\d/);
}

/** Waits until nothing moves: the boxes have slid to their places and every fade is over. A measurement of a box in motion would be a measurement of a place it is passing. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

/**
 * What the page did while a test looked away. A recorder in the page looks at every change of the page (and every 20 ms) and notes whether a box was marked as leaving and which
 * CSS animations and transitions ran, by name: `animation:cc-box-in` is a box that faded in, `animation:cc-flash` a line that flashed, `transition:transform` a box that slid,
 * `transition:opacity` a box or line that faded out, `transition:d` a line that moved with its box. It also notes which counts flashed (by the id of their box). A test asks what
 * happened since the last `reset`.
 */
async function recordMotion(page: Page) {
  await page.addInitScript(() => {
    const seen = { leaving: false, names: new Set<string>(), flashed: new Set<string>() };
    (window as unknown as { __motion: typeof seen }).__motion = seen;
    const look = () => {
      if (document.querySelector('[data-leaving="true"]')) seen.leaving = true;
      for (const count of document.querySelectorAll('[data-count][class*="animate-cc-flash"]')) seen.flashed.add(count.getAttribute('data-count') ?? '');
      for (const animation of document.getAnimations()) {
        if (animation instanceof CSSAnimation) seen.names.add(`animation:${animation.animationName}`);
        else if (animation instanceof CSSTransition) seen.names.add(`transition:${animation.transitionProperty}`);
      }
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true });
    setInterval(look, 20);
  });
  return {
    seen: () =>
      page.evaluate(() => {
        const motion = (window as unknown as { __motion: { leaving: boolean; names: Set<string>; flashed: Set<string> } }).__motion;
        return { leaving: motion.leaving, names: [...motion.names].sort(), flashed: [...motion.flashed].sort() };
      }),
    reset: () =>
      page.evaluate(() => {
        const motion = (window as unknown as { __motion: { leaving: boolean; names: Set<string>; flashed: Set<string> } }).__motion;
        motion.leaving = false;
        motion.names.clear();
        motion.flashed.clear();
      }),
  };
}

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * The geometry of the diagram as the browser draws it, in the coordinates of the page: the rectangle of every box, the label "+N more" and the count of every cluster, and the
 * segments of every line (read from the path, offset by the place of its SVG layer). A pure measurement: the tests below judge it.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const rectOf = (element: Element): { left: number; top: number; right: number; bottom: number } => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const clusters = [...document.querySelectorAll('[data-cluster]')].map((cluster) => {
      const svg = cluster.querySelector('svg[data-lines]');
      const origin = svg === null ? { left: 0, top: 0 } : svg.getBoundingClientRect();
      const lines = [...cluster.querySelectorAll('path[data-line]')].map((path) => {
        const numbers = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: origin.left + (numbers[i] as number), y: origin.top + (numbers[i + 1] as number) });
        return { kind: path.getAttribute('data-line') ?? '', owner: path.getAttribute('data-owner') ?? '', points };
      });
      return {
        id: cluster.getAttribute('data-cluster') ?? '',
        rect: rectOf(cluster),
        boxes: [...cluster.querySelectorAll('[role="group"][data-box]')].map((box) => ({ kind: box.getAttribute('data-box') ?? '', title: box.querySelector('[data-part="title"]')?.textContent ?? '', rect: rectOf(box) })),
        more: [...cluster.querySelectorAll('[data-more]')].map((label) => rectOf(label)),
        counts: [...cluster.querySelectorAll('[data-count]')].map((label) => ({ owner: label.getAttribute('data-count') ?? '', rect: rectOf(label) })),
        lines,
      };
    });
    return clusters;
  });
}

const overlap = (a: Rect, b: Rect, tolerance = 0.5): boolean => a.left < b.right - tolerance && b.left < a.right - tolerance && a.top < b.bottom - tolerance && b.top < a.bottom - tolerance;

/** A segment of a line crosses the inside of a box (a segment that only touches the edge does not). Lines are level or plumb, so the test is two comparisons. */
function crosses(p: { x: number; y: number }, q: { x: number; y: number }, box: Rect, tolerance = 0.5): boolean {
  const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
  const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
  return overlap({ left: x1 - 0.01, right: x2 + 0.01, top: y1 - 0.01, bottom: y2 + 0.01 }, { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, tolerance);
}

// ---- the diagram ----

test.describe('the diagram', () => {
  test('agents page shows live sessions as boxes with state and run time', async ({ page, request }) => {
    const problems = watchConsole(page);
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);

    await expect(page).toHaveTitle('Agents · Shadow Jog Command Center');
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();

    // Three sessions, in the order of the API: the one that started first comes first. The session whose process ended is not drawn, and none of its words are on the page.
    const sessions = sessionBoxes(page);
    await expect(sessions).toHaveCount(3);
    await expect(sessions.locator('[data-part="title"]')).toHaveText([...TITLES]);
    await expect(page.getByText(/LEAK-/)).toHaveCount(0);
    await expect(page.locator(`[data-cluster="${ID(4)}"]`)).toHaveCount(0);

    // For each: the state word with its dot (filled while it works, an outline while it waits for Mark), and how long it has run. The first prompt of the first session has a
    // second line, and only the first line is its title.
    const rows: [string, string, string, RegExp][] = [
      [TITLES[0], 'working', 'filled', /^working · (40|41) min$/],
      [TITLES[1], 'waiting', 'outlined', /^waiting · (12|13) min$/],
      [TITLES[2], 'working', 'filled', /^working · (1|2) min$/],
    ];
    for (const [title, state, dot, detail] of rows) {
      const box = boxOf(page, title);
      await expect(box, title).toHaveAttribute('data-state', state);
      await expect(detailOf(box), title).toHaveText(detail);
      await expect(box.locator('[data-dot]'), title).toHaveAttribute('data-dot', dot);
    }
    await expect(page.getByText('second line of the prompt')).toHaveCount(0);

    // A box is small: 240 by 52 pixels, with one line for the title and one for the detail. A path is not text on the page; the Copy button replaces it.
    for (const box of await sessions.all()) {
      const size = await box.boundingBox();
      expect([size?.width, size?.height]).toEqual([240, 52]);
      for (const part of [titleOf(box), detailOf(box)]) {
        const line = await part.boundingBox();
        expect(line?.height, 'one line').toBeLessThanOrEqual(17);
      }
    }
    await expect(panel(page)).not.toContainText('.jsonl');
    await expect(page.locator('a[href^="file:" i]')).toHaveCount(0);

    // The page has no sentence: the heading, the boxes and the lists are all that it holds. The panel has no paragraph while the sources are good.
    await expect(panel(page).locator('p').filter({ hasNotText: /^(Updated|Last updated)/ })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('agents page shows agents with model and time and a finished agent dimmed', async ({ page, request }) => {
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);
    await settled(page);

    const running = boxOf(page, LABELS.running);
    const nested = boxOf(page, LABELS.nested);
    const done = boxOf(page, LABELS.done);
    // The model as a family name, then how long the agent has run. A finished agent shows "done" in place of a time.
    for (const box of [running, nested, done]) await expect(box).toHaveAttribute('data-box', 'agent');
    await expect(running).toHaveAttribute('data-state', 'running');
    await expect(detailOf(running)).toHaveText(/^fable · [45] min$/);
    await expect(detailOf(nested)).toHaveText(/^haiku · [34] min$/);
    await expect(done).toHaveAttribute('data-state', 'done');
    await expect(detailOf(done)).toHaveText('sonnet · done');
    for (const box of [running, nested, done]) {
      const size = await box.boundingBox();
      expect([size?.width, size?.height]).toEqual([216, 44]);
    }

    // An agent that stopped (silent for 90 minutes) and one that finished more than 5 minutes ago are not drawn.
    await expect(panel(page).getByText('Retry the stalled export')).toHaveCount(0);
    await expect(panel(page).getByText('Check an old table')).toHaveCount(0);

    // The finished agent is dimmed with the tokens: the frame is the hairline and the text is quieter. The live agent has the lavender frame and the ink title.
    const colors = await tokenColors(page);
    await expect(titleOf(running)).toHaveCSS('color', colors.ink);
    await expect(detailOf(running)).toHaveCSS('color', colors.muted);
    await expect(running.locator(':scope > div')).toHaveCSS('border-top-color', colors.ruleSolid);
    await expect(titleOf(done)).toHaveCSS('color', colors.muted);
    await expect(detailOf(done)).toHaveCSS('color', colors.soft);
    await expect(done.locator(':scope > div')).not.toHaveCSS('border-top-color', colors.ruleSolid);
    // The dimmed text keeps the floor of 4.5 to 1, as every text does: the box is dimmed by color and not by opacity.
    await expect(done).toHaveCSS('opacity', '1');
    for (const target of [titleOf(done), detailOf(done), titleOf(running), detailOf(running)]) {
      const { ratio, text, fill } = await contrastOf(target);
      expect(ratio, `${await target.textContent()}: ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }

    // The nested agent is one level to the right of the agent that started it, and in the row below it.
    const [parent, child] = [await running.boundingBox(), await nested.boundingBox()];
    expect((child?.x ?? 0) - (parent?.x ?? 0)).toBeCloseTo(56, 0);
    expect(child?.y).toBeCloseTo((parent?.y ?? 0) + 44 + 12, 0);
  });

  test('agents page shows a workflow as one box with a progress chip', async ({ page, request }) => {
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);

    const workflow = boxOf(page, LABELS.workflow);
    await expect(workflow).toHaveAttribute('data-box', 'workflow');
    // One chip: the newest phase of the journal, and the agents done of the agents started (2 of 3, in two phases).
    await expect(detailOf(workflow)).toHaveText('Build · 2 of 3');
    await expect(workflow.locator('[data-chip]')).toHaveText('Build · 2 of 3');
    const size = await workflow.boundingBox();
    expect([size?.width, size?.height]).toEqual([216, 44]);
    // The workflow has one box, and its agents have none: the box counts them.
    await expect(panel(page).locator('[data-box="workflow"]')).toHaveCount(1);
    await expect(panel(page).getByText(/build1/)).toHaveCount(0);
    // A workflow with a journal has a Copy button.
    await expect(copyButton(workflow)).toHaveCount(1);
  });

  test('agents page draws spawn lines and a message line with its count', async ({ page, request }) => {
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);
    await settled(page);

    const cluster = clusterOf(page, ID(1));
    // A solid line with an arrow from the trunk to each box that was started: the three agents and the workflow. A trunk under the session, and one under the agent that
    // started another agent.
    await expect(cluster.locator('path[data-line="spawn"]')).toHaveCount(4);
    await expect(cluster.locator('path[data-line="trunk"]')).toHaveCount(2);
    for (const spawn of await cluster.locator('path[data-line="spawn"]').all()) {
      await expect(spawn).toHaveAttribute('marker-end', /^url\(#cc-arrow-/);
      await expect(spawn).not.toHaveAttribute('stroke-dasharray');
    }
    await expect(cluster.locator('marker')).toHaveCount(1);

    // A dashed line with a count for the agents that had messages: 2 for the first agent, and 1 for the one that it started. None at 0: the finished agent and the workflow
    // have no dashed line. The text of a message is never on the page.
    const messages = cluster.locator('path[data-line="messages"]');
    await expect(messages).toHaveCount(2);
    await expect(messages.first()).toHaveAttribute('stroke-dasharray', /\d/);
    await expect(messages.nth(0)).toHaveAttribute('data-owner', 'run00001');
    await expect(messages.nth(1)).toHaveAttribute('data-owner', 'nest0001');
    await expect(cluster.locator('[data-count="run00001"]')).toHaveText('2');
    await expect(cluster.locator('[data-count="nest0001"]')).toHaveText('1');
    await expect(cluster.locator('path[data-line="messages"][data-owner="done0001"]')).toHaveCount(0);
    await expect(cluster.locator(`path[data-line="messages"][data-owner="${WORKFLOW_RUN}"]`)).toHaveCount(0);
    await expect(page.getByText(/LEAK-/)).toHaveCount(0);

    // Each spawn line ends at the left edge of its box, at the middle of the box (the point of the arrow touches the box and does not go into it).
    const [measured] = (await measure(page)).filter((entry) => entry.id === ID(1));
    expect(measured).toBeDefined();
    const spawns = measured?.lines.filter((line) => line.kind === 'spawn') ?? [];
    const byTitle = new Map(measured?.boxes.map((box) => [box.title, box.rect]));
    const owners: Record<string, string> = { done0001: LABELS.done, run00001: LABELS.running, nest0001: LABELS.nested, [WORKFLOW_RUN]: LABELS.workflow };
    expect(spawns.map((line) => line.owner).sort()).toEqual(Object.keys(owners).sort());
    for (const line of spawns) {
      const rect = byTitle.get(owners[line.owner] as string) as Rect;
      const tip = line.points.at(-1) as { x: number; y: number };
      expect(tip.x, line.owner).toBeCloseTo(rect.left - 1, 0);
      expect(tip.y, line.owner).toBeCloseTo((rect.top + rect.bottom) / 2, 0);
    }
  });

  test('agents page marks a count that may be short with a plus', async ({ page, request }) => {
    // The file of the session is larger than the part of it that the server reads (1 MiB), so the count of its messages may be short: the page shows "3+".
    const c = clock();
    writeSession(ID(1), [
      prompt('A session with a big file', c.at(900)),
      filler(1_200_000),
      agentCall('toolu_big', c.at(300)),
      sendMessage('big00001', 'toolu_b1', c.at(200)),
      sendMessage('big00001', 'toolu_b2', c.at(150)),
      sendMessage('big00001', 'toolu_b3', c.at(100)),
      toolResult(c.at(4)),
    ]);
    writeAgent(ID(1), 'big00001', { description: 'Talk to the parent', model: 'claude-sonnet-5-5', toolUseId: 'toolu_big', lines: [prompt('made up', c.at(250)), toolResult(c.at(5))] });
    writeProcess(1, ID(1), 'busy', 900);
    const found = await refreshAgents(request);
    expect(found.sessions[0]?.nodes[0]?.messages).toEqual({ count: 3, approximate: true });
    await openAgents(page);

    await expect(clusterOf(page, ID(1)).locator('[data-count]')).toHaveText(['3+']);
    await expect(textList(page)).toContainText('Talk to the parent, sonnet, running, 4 min, 3+ messages');
  });

  test('agents page shows the empty state and the fallback label', async ({ page, request }) => {
    const problems = watchConsole(page);
    // A process list with no process in it: nothing runs. One label, and nothing else.
    mkdirSync(PROCESSES, { recursive: true });
    expect(await refreshAgents(request)).toEqual({ sessions: [], hiddenScripts: 0, source: 'process-list' });
    await openAgents(page);
    const labels = panel(page).locator('p').filter({ hasNotText: /^(Updated|Last updated)/ });
    await expect(labels).toHaveText(['No active session']);
    await expect(panel(page).locator('[data-cluster]')).toHaveCount(0);
    await expect(panel(page).getByRole('list')).toHaveCount(0);
    await expect(panel(page).getByRole('alert')).toHaveCount(0);

    // The process folder goes away, as with a Claude Code that has none: the file ages decide, nothing is recent, and the label says that the list is not there. The open page
    // hears of the change and shows it by itself.
    rmSync(PROCESSES, { recursive: true, force: true });
    await refreshAgents(request);
    await expect(labels).toHaveText(['Process list unavailable', 'No active session']);
    await expect(panel(page).getByText('Process list unavailable', { exact: true })).toBeVisible();

    // With the file ages, a session that wrote lately is drawn, and the label stays above it. A session in the process list is back when the folder is.
    const c = clock();
    writeSession(ID(1), [prompt('A session found by its file age', c.at(120)), toolResult(c.at(3))]);
    const found = await refreshAgents(request);
    expect(found.source).toBe('file-age');
    await expect(sessionBoxes(page)).toHaveCount(1);
    await expect(titleOf(sessionBoxes(page).first())).toHaveText('A session found by its file age');
    await expect(labels).toHaveText(['Process list unavailable']);
    // The label is above the diagram.
    const [label, box] = [await panel(page).getByText('Process list unavailable', { exact: true }).boundingBox(), await sessionBoxes(page).first().boundingBox()];
    expect(label?.y).toBeLessThan(box?.y ?? 0);

    writeProcess(1, ID(1), 'busy', 120);
    await refreshAgents(request);
    await expect(labels).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('agents page shows the hidden runs label', async ({ page, request }) => {
    // Two sessions that a script started (the entrypoint says so) and one of Mark's. The script runs are left out and counted, and none of their words are on the page.
    const c = clock();
    writeSession(ID(1), [prompt('The session of Mark', c.at(300)), toolResult(c.at(4))]);
    writeSession(ID(2), [prompt('LEAK-script-run-one', c.at(200), { entrypoint: 'sdk-py' }), { ...toolResult(c.at(4)), entrypoint: 'sdk-py' }]);
    writeProcess(1, ID(1), 'busy', 300);
    writeProcess(2, ID(2), 'busy', 200);
    const one = await refreshAgents(request);
    expect(one.hiddenScripts).toBe(1);
    await openAgents(page);

    const labels = panel(page).locator('p').filter({ hasNotText: /^(Updated|Last updated)/ });
    await expect(labels).toHaveText(['1 script run hidden']);
    await expect(sessionBoxes(page)).toHaveCount(1);
    await expect(page.getByText(/LEAK-/)).toHaveCount(0);

    // Another script starts: the count goes up on the open page, and the plural is right.
    writeSession(ID(3), [prompt('LEAK-script-run-two', c.at(100), { entrypoint: 'sdk-ts' }), { ...toolResult(c.at(4)), entrypoint: 'sdk-ts' }]);
    writeProcess(3, ID(3), 'busy', 100);
    await refreshAgents(request);
    await expect(labels).toHaveText(['2 script runs hidden']);
    await expect(page.getByText(/LEAK-/)).toHaveCount(0);
    // The label is above the diagram.
    const [label, box] = [await panel(page).getByText('2 script runs hidden', { exact: true }).boundingBox(), await sessionBoxes(page).first().boundingBox()];
    expect(label?.y).toBeLessThan(box?.y ?? 0);
  });

  test('agents page puts three clusters in a row in a wide window and one column at 800 px', async ({ page, request }) => {
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);
    await settled(page);

    const tops = async () => Promise.all((await sessionBoxes(page).all()).map(async (box) => (await box.boundingBox()) as { x: number; y: number }));
    // 1280 px: side by side, in the order of the API, left to right.
    const wide = await tops();
    expect(new Set(wide.map((box) => box.y)).size).toBe(1);
    expect(wide.map((box) => box.x)).toEqual([...wide.map((box) => box.x)].sort((a, b) => a - b));
    expect(new Set(wide.map((box) => box.x)).size).toBe(3);

    // 800 px: one column. The same order, top to bottom, at one left edge.
    await page.setViewportSize({ width: 800, height: 720 });
    await settled(page);
    const narrow = await tops();
    expect(new Set(narrow.map((box) => box.x)).size).toBe(1);
    expect(narrow.map((box) => box.y)).toEqual([...narrow.map((box) => box.y)].sort((a, b) => a - b));
    expect(new Set(narrow.map((box) => box.y)).size).toBe(3);
    // No horizontal scroll bar for the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('agents page shows 12 children and a plain label for the rest', async ({ page, request }) => {
    // One session with 14 agents. The diagram draws 12 and counts the other 2 in a label; the text list names all 14.
    const c = clock();
    const lines = [prompt('A session with many agents', c.at(2000))];
    for (let i = 1; i <= 14; i += 1) lines.push(agentCall(`toolu_many${i}`, c.at(1500 - i * 10)));
    writeSession(ID(1), [...lines, toolResult(c.at(4))]);
    for (let i = 1; i <= 14; i += 1) {
      const id = `many${String(i).padStart(4, '0')}`;
      writeAgent(ID(1), id, { description: `Agent number ${i}`, model: 'claude-sonnet-5-5', toolUseId: `toolu_many${i}`, lines: [prompt('made up', c.at(1400 - i * 10)), toolResult(c.at(6))] });
    }
    writeProcess(1, ID(1), 'busy', 2000);
    await refreshAgents(request);
    await openAgents(page);

    await expect(panel(page).locator('[data-box="agent"]')).toHaveCount(12);
    await expect(panel(page).getByRole('group', { name: 'Agent number 12', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('group', { name: 'Agent number 13', exact: true })).toHaveCount(0);
    const more = panel(page).locator('[data-more]');
    await expect(more).toHaveCount(1);
    await expect(more).toHaveText('+2 more');
    // A plain label: not a button, not a link, not in the tab order.
    expect(await more.evaluate((label) => [label.tagName, label.closest('a, button') === null, label.getAttribute('tabindex')])).toEqual(['SPAN', true, null]);
    await expect(panel(page).getByRole('button', { name: /more/ })).toHaveCount(0);
    await expect(panel(page).getByRole('link')).toHaveCount(0);
    // The list names all of them.
    for (let i = 1; i <= 14; i += 1) await expect(textList(page)).toContainText(`Agent number ${i}, sonnet, running`);
    // The label is under the 12th box, in the column of the boxes.
    const [last, label] = [await panel(page).getByRole('group', { name: 'Agent number 12', exact: true }).boundingBox(), await more.boundingBox()];
    expect(label?.y).toBeGreaterThanOrEqual((last?.y ?? 0) + (last?.height ?? 0));
    expect(label?.x).toBeCloseTo(last?.x ?? 0, 0);
  });

  test('a new agent appears within 5 seconds', async ({ page, request }) => {
    const c = clock();
    writeSession(ID(1), [prompt('A session with one agent', c.at(600)), toolResult(c.at(4))]);
    writeAgent(ID(1), 'first001', { description: 'The first agent', model: 'claude-sonnet-5-5', lines: [prompt('made up', c.at(250)), toolResult(c.at(5))] });
    writeProcess(1, ID(1), 'busy', 600);
    await refreshAgents(request);
    await openAgents(page);
    await expect(panel(page).locator('[data-box="agent"]')).toHaveCount(1);
    await settled(page);

    // A second agent starts. The test asks the server for nothing and does not reload the page: the server looks at the files every 3 seconds, says that the agents changed, and the
    // open page loads them again and draws the new box.
    const started = Date.now();
    writeAgent(ID(1), 'second01', { description: 'The second agent', model: 'claude-fable-5-1', lines: [prompt('made up', new Date().toISOString()), toolResult(new Date().toISOString())] });
    await expect(boxOf(page, 'The second agent')).toBeVisible({ timeout: 5000 });
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(detailOf(boxOf(page, 'The second agent'))).toHaveText(/^fable · \d+ s$/);
    // The first box did not move or change, and the new one is in the row below it.
    await settled(page);
    const [first, second] = [await boxOf(page, 'The first agent').boundingBox(), await boxOf(page, 'The second agent').boundingBox()];
    expect(second?.x).toBeCloseTo(first?.x ?? 0, 0);
    expect(second?.y).toBeCloseTo((first?.y ?? 0) + 44 + 12, 0);
  });

  test('a session whose process ends leaves the diagram, and one that starts comes into it, with no reload', async ({ page, request }) => {
    const c = clock();
    writeSession(ID(1), [prompt('The first session', c.at(600)), toolResult(c.at(4))]);
    writeProcess(1, ID(1), 'busy', 600);
    await refreshAgents(request);
    const motion = await recordMotion(page);
    await openAgents(page);
    await expect(sessionBoxes(page)).toHaveCount(1);

    // A second session starts: its file and its process file. It stands after the first (the order of the start).
    writeSession(ID(2), [prompt('The second session', c.at(30)), toolResult(c.at(3))]);
    writeProcess(2, ID(2), 'idle', 30);
    await refreshAgents(request);
    await expect(sessionBoxes(page).locator('[data-part="title"]')).toHaveText(['The first session', 'The second session']);
    await expect(boxOf(page, 'The second session')).toHaveAttribute('data-state', 'waiting');

    // The first session's program ends: its file stays in the folder, and the session leaves at once.
    writeProcess(1, ID(1), 'busy', 600, false);
    await refreshAgents(request);
    await expect(sessionBoxes(page).locator('[data-part="title"]')).toHaveText(['The second session']);
    await expect(page.locator('[data-leaving]')).toHaveCount(0, { timeout: 2000 });
    await expect(panel(page).locator('[data-cluster]')).toHaveCount(1);
    // The cluster stayed for its 200 ms, marked as leaving, and faded out before it left the page.
    const left = await motion.seen();
    expect(left.leaving, 'the cluster faded out').toBe(true);
    expect(left.names).toContain('transition:opacity');
  });
});

// ---- Copy ----

test.describe('Copy', () => {
  test('a box copies its file path', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);

    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    const session = boxOf(page, TITLES[0]);
    const button = copyButton(session);
    await expect(button).toHaveAttribute('data-copy', 'idle');
    await expect(button.locator('svg.lucide-copy')).toHaveCount(1);
    await button.click();
    expect(await clipboard()).toBe(sessionFile(ID(1)));
    // After a copy the icon is a check for 2 seconds, and then the copy icon is back. The name of the button does not change.
    await expect(button).toHaveAttribute('data-copy', 'copied');
    await expect(button.locator('svg.lucide-check')).toHaveCount(1);
    await expect(button).toHaveAccessibleName('Copy path');
    await expect(button).toHaveAttribute('data-copy', 'idle', { timeout: 4000 });
    await expect(button.locator('svg.lucide-copy')).toHaveCount(1);

    // Each box copies its own file: an agent its agent file, and a workflow its journal.
    await copyButton(boxOf(page, LABELS.running)).click();
    expect(await clipboard()).toBe(agentFile(ID(1), 'run00001'));
    await copyButton(boxOf(page, LABELS.nested)).click();
    expect(await clipboard()).toBe(agentFile(ID(1), 'nest0001'));
    await copyButton(boxOf(page, LABELS.workflow)).click();
    expect(await clipboard()).toBe(journalFile(ID(1), WORKFLOW_RUN));
    await copyButton(boxOf(page, TITLES[2])).click();
    expect(await clipboard()).toBe(sessionFile(ID(3), MIXED));

    // A button for every box with a file, and each one is a button with the same name; the title of its box is the context that a screen reader says before it.
    await expect(panel(page).getByRole('button', { name: 'Copy path' })).toHaveCount(await allBoxes(page).count());
    for (const box of await allBoxes(page).all()) await expect(copyButton(box)).toHaveCount(1);
  });

  test('a copy that the browser refuses shows the label Copy failed', async ({ page, request }) => {
    // The browser says no to the clipboard (a permission that was refused, or a page that is not a secure page): the button must not look as if it had copied.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);

    const box = boxOf(page, LABELS.running);
    const button = copyButton(box);
    await button.click();
    await expect(button).toHaveAttribute('data-copy', 'failed');
    await expect(button.locator('svg.lucide-circle-alert')).toHaveCount(1);
    await expect(box.getByText('Copy failed', { exact: true })).toBeVisible();
    await expect(box.getByRole('status')).toHaveText('Copy failed');
    await expect(box.getByText('Copied')).toHaveCount(0);
    // 2 seconds later the label is gone and the button is ready again. The box did not change its size.
    await expect(button).toHaveAttribute('data-copy', 'idle', { timeout: 4000 });
    await expect(box.getByText('Copy failed')).toHaveCount(0);
    const size = await box.boundingBox();
    expect([size?.width, size?.height]).toEqual([216, 44]);
  });
});

// ---- the text list ----

test.describe('the text list', () => {
  test('agents page has a text list of every session and agent', async ({ page, request }) => {
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);

    const list = textList(page);
    await expect(list).toBeAttached();
    // The list is hidden from the eye (one pixel, clipped) and not from a screen reader.
    const size = await list.boundingBox();
    expect(size === null || (size.width <= 1 && size.height <= 1)).toBe(true);
    // Every session and every agent, in text: the title, the state and the time; the label, the model and the state. The agents that another agent started are in its list.
    const items = list.locator('li > span');
    await expect(items).toHaveText([
      /^Build the Agents page of the command center, working, (40|41) min$/,
      'Check the milestone table, sonnet, done',
      /^Explore the fixture engine docs, fable, running, [45] min, 2 messages$/,
      /^Read one doc of the fixture, haiku, running, [34] min, 1 message$/,
      'fixture-build, workflow, running, Build · 2 of 3',
      /^Review the engine docs for the fixture, waiting, (12|13) min$/,
      /^Update the glossary from the home-base folder, working, (1|2) min$/,
    ]);
    // The innermost item that holds the label of the first agent is the item of that agent (the item of the session holds it too, and comes first).
    const nested = list.locator('li', { hasText: LABELS.running }).last().locator(':scope > ul > li');
    await expect(nested).toHaveCount(1);
    await expect(nested).toContainText(LABELS.nested);
    // Not in the list: the agents that stopped, and the session whose process ended.
    await expect(list).not.toContainText('Retry the stalled export');
    await expect(list).not.toContainText('LEAK-');
    // The list holds no path and no message text.
    await expect(list).not.toContainText('.jsonl');
  });

  test('the words of a session file show as text, never as markup', async ({ page, request }) => {
    // A title, the label of an agent and the name of a workflow all come from files that a session wrote, so any of them can hold anything. None may become an element.
    const c = clock();
    writeSession(ID(1), [prompt('<b>Bold</b> and <i>italic</i> title', c.at(600)), agentCall('toolu_x', c.at(300)), toolResult(c.at(4))]);
    writeAgent(ID(1), 'markup01', { description: '<img src=x onerror="window.__pwned = 1"> described', model: 'claude-sonnet-5-5', toolUseId: 'toolu_x', lines: [prompt('made up', c.at(250)), toolResult(c.at(5))] });
    writeProcess(1, ID(1), 'busy', 600);
    await refreshAgents(request);
    await openAgents(page);

    await expect(boxOf(page, '<b>Bold</b> and <i>italic</i> title')).toBeVisible();
    await expect(boxOf(page, '<img src=x onerror="window.__pwned = 1"> described')).toBeVisible();
    await expect(textList(page)).toContainText('<img src=x onerror="window.__pwned = 1"> described');
    // No element came out of any of them, and nothing ran.
    await expect(page.locator('main').locator('b, i, u, s, img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

// ---- the geometry ----

test.describe('the geometry', () => {
  /**
   * A busy world: the three sessions of `writeWorld`; a fourth with 13 agents (the last is left out), 123 messages to one of them, and an agent that another agent started; and a
   * fifth, the one that began first, with a chain of five agents that each started the next, which is wider than a column (496 pixels).
   */
  function writeBusyWorld(): void {
    writeWorld();
    const c = clock();
    const lines = [prompt('A busy session with many agents', c.at(2000))];
    for (let i = 1; i <= 13; i += 1) lines.push(agentCall(`toolu_busy${i}`, c.at(1500 - i * 10)));
    for (let i = 0; i < 123; i += 1) lines.push(sendMessage('busy0003', `toolu_bm${i}`, c.at(900 - i)));
    writeSession(ID(5), [...lines, toolResult(c.at(4))]);
    for (let i = 1; i <= 13; i += 1) {
      const id = `busy${String(i).padStart(4, '0')}`;
      const own = i === 2 ? [agentCall('toolu_inner', c.at(1000))] : [];
      writeAgent(ID(5), id, { description: `Busy agent ${i}`, model: 'claude-sonnet-5-5', toolUseId: `toolu_busy${i}`, lines: [prompt('made up', c.at(1400 - i * 10)), ...own, toolResult(c.at(6))] });
    }
    writeAgent(ID(5), 'inner001', { description: 'The inner agent', model: 'claude-haiku-4-5', toolUseId: 'toolu_inner', lines: [prompt('made up', c.at(900)), toolResult(c.at(7))] });
    writeProcess(5, ID(5), 'busy', 2000);

    // The chain: the session started the first agent, the first started the second, and so on.
    writeSession(ID(6), [prompt('A session with a deep chain of agents', c.at(3200)), agentCall('toolu_deep1', c.at(3000)), toolResult(c.at(4))]);
    for (let i = 1; i <= 5; i += 1) {
      const next = i < 5 ? [agentCall(`toolu_deep${i + 1}`, c.at(2900 - i * 100))] : [];
      writeAgent(ID(6), `deep000${i}`, { description: `Deep agent ${i}`, model: 'claude-sonnet-5-5', toolUseId: `toolu_deep${i}`, lines: [prompt('made up', c.at(3000 - i * 100)), ...next, toolResult(c.at(6))] });
    }
    writeProcess(6, ID(6), 'busy', 3000);
  }

  /** The part of a box that Mark can see: a cluster is a scroll box, and what is outside it is clipped. A box that is clipped away has no visible part. */
  const visible = (rect: Rect, cluster: Rect): Rect | null => {
    const clipped = { left: Math.max(rect.left, cluster.left), top: Math.max(rect.top, cluster.top), right: Math.min(rect.right, cluster.right), bottom: Math.min(rect.bottom, cluster.bottom) };
    return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
  };

  test('agents page keeps its boxes apart and its lines out of boxes', async ({ page, request }) => {
    writeBusyWorld();
    await refreshAgents(request);
    await openAgents(page);
    await expect(panel(page).locator('[data-cluster]')).toHaveCount(5);

    for (const size of [{ width: 1280, height: 720 }, { width: 800, height: 720 }, { width: 560, height: 720 }]) {
      await page.setViewportSize(size);
      await settled(page);
      const clusters = await measure(page);
      const boxes = clusters.flatMap((cluster) => cluster.boxes.map((box) => ({ ...box, cluster: cluster.id, visible: visible(box.rect, cluster.rect) })));
      expect(boxes.length, 'the boxes are there').toBeGreaterThan(25);
      const deep = clusters.find((cluster) => cluster.id === ID(6));
      expect(deep?.boxes, 'the chain is drawn').toHaveLength(6);

      // No two boxes overlap, also across two clusters: a box that sticks out of its cluster is clipped by it, so only what can be seen counts. No label "+N more" overlaps a box.
      for (const [i, one] of boxes.entries()) {
        for (const other of boxes.slice(i + 1)) {
          if (one.visible === null || other.visible === null) continue;
          expect(overlap(one.visible, other.visible), `${size.width}px: ${one.title} and ${other.title} overlap`).toBe(false);
        }
      }
      for (const cluster of clusters) {
        for (const label of cluster.more) for (const box of cluster.boxes) expect(overlap(label, box.rect), `${size.width}px: a label "+N more" overlaps ${box.title}`).toBe(false);
      }

      // No segment of a line enters a box of its cluster, and no count (the label on a dashed line) overlaps a box.
      let segments = 0;
      for (const cluster of clusters) {
        for (const line of cluster.lines) {
          for (let i = 1; i < line.points.length; i += 1) {
            segments += 1;
            for (const box of cluster.boxes) expect(crosses(line.points[i - 1] as { x: number; y: number }, line.points[i] as { x: number; y: number }, box.rect), `${size.width}px: the ${line.kind} line of ${line.owner} crosses ${box.title}`).toBe(false);
          }
        }
        for (const count of cluster.counts) for (const box of cluster.boxes) expect(overlap(count.rect, box.rect), `${size.width}px: the count of ${count.owner} overlaps ${box.title}`).toBe(false);
      }
      expect(segments, 'the lines are there').toBeGreaterThan(25);

      // The page never needs a horizontal scroll bar, whatever the width of a cluster: a cluster that is wider than its column scrolls inside itself.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${size.width}px: the page has no horizontal scroll`).toBe(true);
      // The first box of every cluster is at the top left of it, and no box is above its cluster or left of it.
      for (const cluster of clusters) {
        for (const box of cluster.boxes) {
          expect(box.rect.left, `${box.title} inside its cluster`).toBeGreaterThanOrEqual(cluster.rect.left - 0.5);
          expect(box.rect.top).toBeGreaterThanOrEqual(cluster.rect.top - 0.5);
          expect(box.rect.bottom).toBeLessThanOrEqual(cluster.rect.bottom + 0.5);
        }
      }
    }

    // The chain is 496 pixels wide, wider than a column of 352: every column is as wide as the chain, so in a wide window nothing of it is cut off (two columns, and not three).
    // A window that is narrower than the chain scrolls that cluster inside itself, and never the page.
    const chain = (width: number) => page.setViewportSize({ width, height: 720 }).then(() => settled(page)).then(() => clusterOf(page, ID(6)).evaluate((cluster) => ({ scrolls: cluster.scrollWidth > cluster.clientWidth, overflow: getComputedStyle(cluster).overflowX, width: cluster.clientWidth })));
    const wide = await chain(1280);
    expect(wide.scrolls).toBe(false);
    expect(wide.width).toBeGreaterThanOrEqual(496);
    expect(await chain(560)).toMatchObject({ scrolls: true, overflow: 'auto' });
    const firsts = (await sessionBoxes(page).all()).map(async (box) => (await box.boundingBox())?.x);
    expect(new Set(await Promise.all(firsts)).size, 'one column at 560 px').toBe(1);
  });
});

// ---- motion ----

test.describe('motion', () => {
  test('agents page respects reduced motion', async ({ page, request }) => {
    test.setTimeout(90_000);
    const c = clock();
    // One session with three agents, in this order of start: the one that talks, the one that leaves, and the one that stays (it is below the one that leaves, so it slides up).
    const session = sessionFile(ID(1));
    const sessionLines = (messages: number, stayMessages = 0) => [
      prompt('A session that changes', c.at(900)),
      agentCall('toolu_a', c.at(400)),
      agentCall('toolu_b', c.at(390)),
      agentCall('toolu_c', c.at(380)),
      ...Array.from({ length: messages }, (_, i) => sendMessage('talk0001', `toolu_t${i}`, c.at(300 - i))),
      ...Array.from({ length: stayMessages }, (_, i) => sendMessage('stay0001', `toolu_s${i}`, c.at(200 - i))),
      toolResult(c.at(1)),
    ];
    const agent = (description: string, id: string, call: string, startedAgo: number) =>
      writeAgent(ID(1), id, { description, model: 'claude-sonnet-5-5', toolUseId: call, lines: [prompt('made up', c.at(startedAgo)), toolResult(c.at(5))] });
    writeLines(session, sessionLines(1));
    agent('The agent that talks', 'talk0001', 'toolu_a', 350);
    agent('The agent that leaves', 'gone0001', 'toolu_b', 340);
    agent('The agent that stays', 'stay0001', 'toolu_c', 330);
    writeProcess(1, ID(1), 'busy', 900);
    await refreshAgents(request);
    const motion = await recordMotion(page);
    const removeAgent = (id: string) => {
      rmSync(agentFile(ID(1), id));
      rmSync(join(agentFile(ID(1), id), '..', `agent-${id}.meta.json`));
    };

    // ---- motion allowed ----
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openAgents(page);
    await settled(page);
    const talks = boxOf(page, 'The agent that talks');
    // A box slides with a transition on `transform` of 200 ms, and a box that is new has an animation that fades it in.
    const slide = await talks.evaluate((box) => ({ property: getComputedStyle(box).transitionProperty, seconds: Number.parseFloat(getComputedStyle(box).transitionDuration) }));
    expect(slide.property).toContain('transform');
    expect(slide.seconds).toBe(0.2);
    expect(await talks.locator(':scope > div').evaluate((body) => getComputedStyle(body).animationName)).toBe('cc-box-in');
    await motion.reset();

    // The count of a box grows (1 to 2), and a box gets its first message (0 to 1): both dashed lines flash for one second, and then stop.
    writeLines(session, sessionLines(2, 1));
    await refreshAgents(request);
    await expect(clusterOf(page, ID(1)).locator('[data-count="talk0001"]')).toHaveText('2');
    await expect(clusterOf(page, ID(1)).locator('[data-count="stay0001"]')).toHaveText('1');
    await expect.poll(async () => (await motion.seen()).names, { timeout: 3000 }).toContain('animation:cc-flash');
    await expect(clusterOf(page, ID(1)).locator('[class*="animate-cc-flash"]')).toHaveCount(0, { timeout: 3000 });
    expect((await motion.seen()).flashed).toEqual(['stay0001', 'talk0001']);

    // A new agent comes: it fades in.
    await motion.reset();
    agent('A new agent', 'newb0001', 'toolu_d', 100);
    await refreshAgents(request);
    await expect(boxOf(page, 'A new agent')).toBeVisible();
    expect((await motion.seen()).names).toContain('animation:cc-box-in');
    await settled(page);

    // An agent leaves: its box stays for 200 ms, marked as leaving, and fades; the boxes below it slide up, and their lines move with them.
    await motion.reset();
    removeAgent('gone0001');
    await refreshAgents(request);
    await expect(boxOf(page, 'The agent that leaves')).toHaveCount(0, { timeout: 3000 });
    const left = await motion.seen();
    expect(left.leaving, 'the box faded out while it left').toBe(true);
    expect(left.names).toEqual(expect.arrayContaining(['transition:opacity', 'transition:transform', 'transition:d']));

    // ---- less motion asked for ----
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settled(page);
    await motion.reset();
    // Nothing is set to slide, fade or animate.
    expect(await talks.evaluate((box) => getComputedStyle(box).transitionDuration)).toBe('0s');
    expect(await talks.locator(':scope > div').evaluate((body) => getComputedStyle(body).animationName)).toBe('none');

    // A count grows again, an agent comes, and another leaves. No flash, no fade, no slide: nothing ran at all, no box was marked as leaving, and the box that left is gone at once.
    writeLines(session, sessionLines(3, 1));
    agent('Another new agent', 'newc0001', 'toolu_e', 90);
    await refreshAgents(request);
    await expect(clusterOf(page, ID(1)).locator('[data-count="talk0001"]')).toHaveText('3');
    await expect(boxOf(page, 'Another new agent')).toBeVisible();
    removeAgent('newb0001');
    await refreshAgents(request);
    await expect(boxOf(page, 'A new agent')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await motion.seen()).toEqual({ leaving: false, names: [], flashed: [] });
  });
});

// ---- links and error states ----

test.describe('links and errors', () => {
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

  test('a session in Your move opens the Agents page at that session', async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
    // A short, narrow window: one column, so the second cluster is below the fold and the page has to scroll to it.
    await page.setViewportSize({ width: 800, height: 420 });
    writeWorld();
    await refreshAgents(request);
    expect((await request.get('/api/sessions?refresh=1')).status()).toBe(200);
    await page.goto('/');

    const item = page.getByRole('region', { name: 'Your move', exact: true }).getByRole('listitem').filter({ hasText: 'Review the diff' });
    const link = item.getByRole('link', { name: /Review the diff/ });
    await expect(link).toHaveAttribute('href', `/agents#session-${ID(2)}`);
    await link.click();

    // The page scrolled to the cluster of the session once its data was there.
    await expect(page).toHaveURL(`/agents#session-${ID(2)}`);
    await expect(boxOf(page, TITLES[1])).toBeVisible();
    await expect(boxOf(page, TITLES[1])).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // The page does not pull itself back when the data loads again: Mark can scroll away.
    await page.evaluate(() => window.scrollTo(0, 0));
    writeAgent(ID(3), 'late0001', { description: 'A late agent', model: 'claude-sonnet-5-5', lines: [prompt('made up', new Date().toISOString()), toolResult(new Date().toISOString())], folder: MIXED });
    await refreshAgents(request);
    await expect(boxOf(page, 'A late agent')).toBeVisible();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // A link to a session that is not live goes nowhere, and the page says nothing about it.
    await openAgents(page, `/agents#session-${ID(99)}`);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(sessionBoxes(page)).toHaveCount(3);
  });

  test('an unreadable agents list keeps its last good diagram under the error, and a retry brings the new one', async ({ page, request }) => {
    const c = clock();
    writeSession(ID(1), [prompt('A session that was drawn', c.at(300)), toolResult(c.at(4))]);
    writeProcess(1, ID(1), 'busy', 300);
    await refreshAgents(request);
    await openAgents(page);
    await expect(boxOf(page, 'A session that was drawn')).toBeVisible();

    // The next load fails. (The server's answer is replaced: a made-up failure, because the files cannot be made to fail on purpose.)
    await page.route('**/api/agents', (route) => route.fulfill({ json: { ok: false, error: { code: 'agents-failed', message: 'The live sessions could not be read (EACCES).' }, updatedAt: null, lastGood: null } }));
    writeSession(ID(2), [prompt('A session that started later', c.at(60)), toolResult(c.at(3))]);
    writeProcess(2, ID(2), 'busy', 60);
    await refreshAgents(request);

    const alert = panel(page).getByRole('alert');
    await expect(alert).toContainText('The live sessions could not be read (EACCES).');
    await expect(alert).toContainText('agents-failed');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The panel says when it last had good data, and shows that diagram under the error. The page around it is there.
    await expect(panel(page)).toContainText(/Last updated \d\d:\d\d:\d\d/);
    await expect(panel(page)).toContainText('Last good data');
    await expect(boxOf(page, 'A session that was drawn')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expectAtMostTwoAmberItems(page);
    // The icon of the error is ink, as in every panel: the one or two amber items of a page are not spent on an error.
    const colors = await tokenColors(page);
    await expect(alert.locator('svg').first()).toHaveCSS('color', colors.ink);

    // The server answers again. Retry loads the diagram, and the error and the old data go.
    await page.unroute('**/api/agents');
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(panel(page)).not.toContainText('Last good data');
    await expect(sessionBoxes(page)).toHaveCount(2);
    await expect(boxOf(page, 'A session that started later')).toBeVisible();
  });
});

// ---- the Look ----

test.describe('the Look', () => {
  test('the page spends no amber, and its small text keeps the 4.5 to 1 floor', async ({ page, request }) => {
    writeWorld();
    await refreshAgents(request);
    await openAgents(page);
    await settled(page);
    // No amber is needed on this page: a dot is ink, a state is a word, a line is the soft color, and a button is the neutral one. Also no shadow and no glow on a box.
    expect(await amberItems(page)).toEqual([]);
    for (const box of await allBoxes(page).all()) {
      await expect(box.locator(':scope > div')).toHaveCSS('box-shadow', 'none');
      await expect(box.locator(':scope > div')).toHaveCSS('filter', 'none');
    }

    const session = boxOf(page, TITLES[0]);
    for (const target of [
      titleOf(session),
      detailOf(session),
      titleOf(boxOf(page, LABELS.running)),
      detailOf(boxOf(page, LABELS.running)),
      boxOf(page, LABELS.workflow).locator('[data-chip]'),
      titleOf(boxOf(page, LABELS.done)),
      detailOf(boxOf(page, LABELS.done)),
    ]) {
      const { ratio, text, fill } = await contrastOf(target);
      expect(ratio, `${await target.textContent()}: ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }

    // The same for the labels above the diagram, and the label of the cap.
    rmSync(PROCESSES, { recursive: true, force: true });
    await refreshAgents(request);
    await expect(panel(page).getByText('Process list unavailable', { exact: true })).toBeVisible();
    const { ratio } = await contrastOf(panel(page).getByText('Process list unavailable', { exact: true }));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(await amberItems(page)).toEqual([]);
  });
});
