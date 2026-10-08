import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import type { Decision, Panel } from '../src/shared/types';
import { E2E_DIR } from './fake-gh';

// The engine review in a browser, on the frozen engine docs of fixtures/repo (copies of the Shadow
// Jog docs as they were on main at 959ddf4, before Mark's final approval): the decision list at
// /docs/decisions, and the Previous and Next buttons of the engine docs. The approval commit of the
// fixture server is the first commit of the fixture repo, which holds these docs as they are. Two
// tests change a doc on disk and put it back: the server watches the files, so the open page follows.

/** The fixture repo of the end-to-end server (createE2eRuntime puts it in this folder). */
const REPO = join(E2E_DIR, 'repo');
const DECISIONS_DOC = join(REPO, 'docs', 'engine', 'decisions.md');

async function readDecisions(request: APIRequestContext): Promise<Decision[]> {
  const panel = (await (await request.get('/api/engine/decisions')).json()) as Panel<Decision[]>;
  if (!panel.ok) throw new Error(`/api/engine/decisions answered an error: ${panel.error.message}`);
  return panel.data;
}

/** A page must not log an error or a warning to the console: a blocked script or style shows up there. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

const table = (page: Page) => page.getByRole('table', { name: 'Decisions' });
/** The rows of decisions (not the header row and not the heading of a group). */
const decisionRows = (page: Page) => table(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^[ECD]\d+$/ }) });
const rowOf = (page: Page, number: string) => table(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: number, exact: true }) });
const statusFilter = (page: Page) => page.getByRole('radiogroup', { name: 'Filter by status' });
const documentOf = (page: Page) => page.getByRole('region', { name: 'Document' });

/**
 * The words that the page itself says, one entry for each line on screen, and its hidden text (ARIA labels and tooltips). The table cells that hold the text of the
 * decisions (question, answer, milestone, who decides) are data and not ours to shorten, so the page hides them first. The status cell is ours, and stays.
 */
async function pageWords(page: Page): Promise<string[]> {
  const { lines, hidden } = await page.evaluate(() => {
    for (const cell of document.querySelectorAll<HTMLElement>('tbody td:nth-child(-n+5)')) cell.style.display = 'none';
    const attributes = [...document.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((element) =>
      ['aria-label', 'title', 'placeholder'].flatMap((name) => element.getAttribute(name) ?? []),
    );
    return { lines: document.body.innerText.split('\n'), hidden: attributes };
  });
  return [...lines, ...hidden].map((line) => line.trim()).filter((line) => line !== '');
}

test.describe('the engine review', () => {
  test('the list filters by status and a row opens its doc at the anchor', async ({ page, request }) => {
    const problems = watchConsole(page);
    const decisions = await readDecisions(request);
    // 25 E decisions, 17 of the phase plan and the 7 choices of the Phase 0 update. The frozen README still says that it waits for
    // Mark, so its 7 choices are open, and so is decision 5 of the phase plan (it says OPEN).
    expect(decisions).toHaveLength(49);
    expect(decisions.filter((decision) => decision.status === 'open').map((decision) => decision.id).sort()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'D5']);
    expect(decisions.filter((decision) => decision.status === 'changed')).toEqual([]);

    await page.goto('/docs/decisions');
    await expect(page).toHaveTitle(/^Decisions/);
    await expect(page.getByRole('heading', { level: 1, name: 'Decisions' })).toBeVisible();
    await expect(decisionRows(page)).toHaveCount(49);
    for (const group of ['Engine design', 'Phase 0.2 plan', 'Phase 0 update']) {
      await expect(table(page).getByRole('rowheader', { name: new RegExp(`^${group}`) })).toBeVisible();
    }
    // The page says when it was updated, as every panel does.
    await expect(page.getByRole('region', { name: 'Decisions' })).toContainText(/Updated \d\d:\d\d:\d\d/);

    // Open: the eight that wait for Mark. The group of the E decisions has none left, so it is not drawn.
    await expect(statusFilter(page).getByRole('radio', { name: /^All 49/ })).toBeChecked();
    await statusFilter(page).getByRole('radio', { name: /^Open 8/ }).click();
    await expect(decisionRows(page)).toHaveCount(8);
    for (const row of await decisionRows(page).all()) await expect(row).toContainText('Open');
    await expect(table(page).getByRole('rowheader', { name: /^Engine design/ })).toHaveCount(0);
    await expect(rowOf(page, 'D5')).toBeVisible();
    await expect(rowOf(page, 'C1')).toBeVisible();

    // Changed: none yet, and the list says so in a label instead of showing an empty table.
    await statusFilter(page).getByRole('radio', { name: /^Changed 0/ }).click();
    await expect(page.getByText('No changed decisions', { exact: true })).toBeVisible();
    await expect(table(page)).toHaveCount(0);

    // Approved: the other 41, all three groups.
    await statusFilter(page).getByRole('radio', { name: /^Approved 41/ }).click();
    await expect(decisionRows(page)).toHaveCount(41);
    for (const row of await decisionRows(page).all()) await expect(row).toContainText('Approved');
    await statusFilter(page).getByRole('radio', { name: /^All/ }).click();
    await expect(decisionRows(page)).toHaveCount(49);

    // A row opens its doc at the heading of the decision, and the doc scrolls there.
    // The heading and its anchor are those of the frozen copy in fixtures/repo, not those of main's docs/engine/decisions.md.
    const anchorOf = (id: string) => decisions.find((decision) => decision.id === id)?.anchor;
    expect(anchorOf('E1')).toBe('e1-how-is-behavior-written');
    await rowOf(page, 'E1').getByRole('link', { name: 'How behavior is written' }).click();
    await expect(page).toHaveURL(/\/docs\/engine\/decisions#e1-how-is-behavior-written$/);
    await expect(page.locator('.doc-html h2#e1-how-is-behavior-written')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

    // The same for a decision of the phase plan and a choice of the Phase 0 update, which are in other docs.
    await page.goBack();
    await expect(decisionRows(page)).toHaveCount(49);
    await rowOf(page, 'D5').getByRole('link').click();
    await expect(page).toHaveURL(/\/docs\/PHASE-0\.2#decisions-for-mark$/);
    await expect(page.locator('.doc-html h2#decisions-for-mark')).toBeInViewport();

    await page.goBack();
    await expect(decisionRows(page)).toHaveCount(49);
    expect(anchorOf('C1')).toBe('what-the-phase-0-spike-changed-2026-10-05');
    await rowOf(page, 'C1').getByRole('link').click();
    await expect(page).toHaveURL(/\/docs\/engine\/README#what-the-phase-0-spike-changed-2026-10-05$/);
    await expect(page.locator('.doc-html h2#what-the-phase-0-spike-changed-2026-10-05')).toBeInViewport();

    // The link of a group goes to the doc itself.
    await page.goBack();
    await table(page).getByRole('link', { name: 'docs/engine/decisions.md' }).click();
    await expect(page).toHaveURL(/\/docs\/engine\/decisions$/);
    expect(problems).toEqual([]);
  });

  test('engine table shows labels instead of the long intro and the empty-state sentences', async ({ page }) => {
    await page.goto('/docs/decisions');
    await expect(decisionRows(page)).toHaveCount(49);

    // The heading stands alone: the long intro that explained the three statuses is gone, and the panel comes next.
    await expect(page.getByRole('heading', { level: 1, name: 'Decisions' })).toBeVisible();
    for (const old of ['Every decision of the engine design', 'it waits for Mark', 'the approval commit', 'unchanged since']) await expect(page.getByText(old)).toHaveCount(0);

    // A group says how many decisions it holds as a label, and its doc is a link: no "from" between them.
    const group = table(page).getByRole('rowheader', { name: /^Engine design/ });
    await expect(group).toContainText(/^Engine design\s*\d+ decisions · docs\/engine\/decisions\.md$/);
    await expect(group.getByRole('link', { name: 'docs/engine/decisions.md' })).toHaveAttribute('href', '/docs/engine/decisions');
    await expect(page.getByText(/\d+ decisions? from/)).toHaveCount(0);

    // A filter that leaves nothing says it in a label (the fixture docs have no changed decision), and no empty table stands under it.
    await statusFilter(page).getByRole('radio', { name: /^Changed 0/ }).click();
    await expect(page.getByText('No changed decisions', { exact: true })).toBeVisible();
    await expect(page.getByText('No decision has changed since the approval.')).toHaveCount(0);
    await expect(table(page)).toHaveCount(0);
  });

  test('engine table shows no sentence over 20 words', async ({ page }) => {
    await page.goto('/docs/decisions');
    await expect(decisionRows(page)).toHaveCount(49);

    // Every filter: the full table, the open ones, the empty "Changed" and the approved ones.
    const seen: string[] = [];
    for (const name of [/^All/, /^Open/, /^Changed/, /^Approved/]) {
      await statusFilter(page).getByRole('radio', { name }).click();
      seen.push(...(await pageWords(page)));
    }

    // The scan saw the real page, and not one sentence is long or holds a contraction (design 5.8).
    for (const known of ['Decisions', 'No changed decisions', 'Engine design', 'Filter by status']) expect(seen.some((line) => line.includes(known)), known).toBe(true);
    for (const sentence of seen.flatMap((line) => line.split(/(?<=[.!?])\s+/))) {
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
      expect(sentence, sentence).not.toMatch(/\w'(t|s|re|ve|ll|d|m)\b/i);
    }
  });

  test('the filter works with the keyboard: the arrow keys move between the buttons and Space chooses one', async ({ page }) => {
    await page.goto('/docs/decisions');
    await expect(decisionRows(page)).toHaveCount(49);
    await statusFilter(page).getByRole('radio', { name: /^All/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(statusFilter(page).getByRole('radio', { name: /^Open/ })).toBeFocused();
    // Moving the focus does not choose: the list is still the whole list until Space.
    await expect(statusFilter(page).getByRole('radio', { name: /^All/ })).toBeChecked();
    await expect(decisionRows(page)).toHaveCount(49);
    await page.keyboard.press('Space');
    await expect(statusFilter(page).getByRole('radio', { name: /^Open/ })).toBeChecked();
    await expect(decisionRows(page)).toHaveCount(8);
  });

  test('an edit of a decision shows as changed within 8 s with no reload, and putting it back clears it', async ({ page, request }) => {
    const problems = watchConsole(page);
    const original = readFileSync(DECISIONS_DOC, 'utf8');
    await page.goto('/docs/decisions');
    await expect(decisionRows(page)).toHaveCount(49);
    // A mark on the window: a page load would wipe it.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__ccStillHere = true;
    });

    try {
      writeFileSync(DECISIONS_DOC, original.replace('Phaser style: scene code and small subclasses', 'Phaser style: scene code, small subclasses and helpers'));
      const row = rowOf(page, 'E1');
      await expect(row).toContainText('Changed', { timeout: 8000 });
      await expect(row).toContainText('edited');
      // The counts follow: the summary of the doc, and the filter button.
      await expect(page.getByRole('list', { name: 'Decisions by source' })).toContainText('1 changed');
      await expect(statusFilter(page).getByRole('radio', { name: /^Changed 1/ })).toBeVisible();
      expect((await readDecisions(request)).find((decision) => decision.id === 'E1')).toMatchObject({ status: 'changed', change: 'edited' });

      // The filter shows just that one, and it stays on Changed when the list is made again.
      await statusFilter(page).getByRole('radio', { name: /^Changed/ }).click();
      await expect(decisionRows(page)).toHaveCount(1);
      await expect(rowOf(page, 'E1')).toBeVisible();

      // Put the text back: nothing is changed again.
      writeFileSync(DECISIONS_DOC, original);
      await expect(page.getByText('No changed decisions', { exact: true })).toBeVisible({ timeout: 8000 });
      await expect(statusFilter(page).getByRole('radio', { name: /^Changed 0/ })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ccStillHere)).toBe(true);
      expect(problems).toEqual([]);
    } finally {
      writeFileSync(DECISIONS_DOC, original);
    }
  });

  test('a table that lost a column shows an error that names it, with Retry, beside the list it read before', async ({ page }) => {
    const original = readFileSync(DECISIONS_DOC, 'utf8');
    await page.goto('/docs/decisions');
    await expect(decisionRows(page)).toHaveCount(49);

    try {
      // The header "Who decides" is renamed: the module cannot tell who decides, so it says what is missing.
      writeFileSync(DECISIONS_DOC, original.replace('| Who decides |', '| Decider |'));
      const panel = page.getByRole('region', { name: 'Decisions' });
      const alert = panel.getByRole('alert');
      await expect(alert).toContainText('lacks these columns: "Who decides"', { timeout: 8000 });
      await expect(alert).toContainText('docs/engine/decisions.md');
      await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
      // The list of before is still there under the error, and the panel says so.
      await expect(panel).toContainText('Last good data');
      await expect(decisionRows(page)).toHaveCount(49);

      // The column comes back: the error goes by itself.
      writeFileSync(DECISIONS_DOC, original);
      await expect(alert).toBeHidden({ timeout: 8000 });
      await expect(decisionRows(page)).toHaveCount(49);
    } finally {
      writeFileSync(DECISIONS_DOC, original);
    }
  });

  test('an engine doc ends with Previous and Next: the first has no Previous and the last no Next', async ({ page }) => {
    const problems = watchConsole(page);
    // The fixture has three engine docs that the README's reading order names: the README itself, the migration plan (a made-up stand-in that holds the
    // milestones of the status panel) and the decisions. The README's order puts the migration plan between the other two.
    await page.goto('/docs/engine/README');
    await expect(documentOf(page).getByRole('heading', { level: 1 }).first()).toBeVisible();
    const buttons = page.getByRole('navigation', { name: 'Reading order' });
    await expect(buttons.getByRole('link', { name: /^Next/ })).toHaveAttribute('href', '/docs/engine/migration');
    await expect(buttons.getByRole('link', { name: /^Next/ })).toContainText('Shadow Jog Engine — Migration (fixture)');
    await expect(buttons.getByRole('link', { name: /^Previous/ })).toHaveCount(0);

    // The buttons are at the end of the doc, under its text.
    const end = await buttons.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const lastHeading = await documentOf(page).locator('.doc-html h2').last().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(end).toBeGreaterThan(lastHeading);

    await buttons.getByRole('link', { name: /^Next/ }).click();
    await expect(page).toHaveURL(/\/docs\/engine\/migration$/);
    await expect(documentOf(page).getByRole('heading', { level: 1 }).first()).toContainText('Migration');
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // a new doc opens at its top
    // The middle doc has both buttons.
    const middle = page.getByRole('navigation', { name: 'Reading order' });
    await expect(middle.getByRole('link', { name: /^Previous/ })).toHaveAttribute('href', '/docs/engine/README');
    await expect(middle.getByRole('link', { name: /^Next/ })).toHaveAttribute('href', '/docs/engine/decisions');

    await middle.getByRole('link', { name: /^Next/ }).click();
    await expect(page).toHaveURL(/\/docs\/engine\/decisions$/);
    await expect(documentOf(page).getByRole('heading', { level: 1 }).first()).toContainText('Decisions');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const last = page.getByRole('navigation', { name: 'Reading order' });
    await expect(last.getByRole('link', { name: /^Previous/ })).toHaveAttribute('href', '/docs/engine/migration');
    await expect(last.getByRole('link', { name: /^Next/ })).toHaveCount(0);

    await last.getByRole('link', { name: /^Previous/ }).click();
    await expect(page).toHaveURL(/\/docs\/engine\/migration$/);

    // A doc that is not in the reading order has no such buttons.
    await page.goto('/docs/guides/setup');
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'Setup guide' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Reading order' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});
