import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { E2E_DIR } from './fake-gh';

// Copy and Download on a doc page (design 5.7, revision 2): the split button under the header of a doc, its
// menu, and the files and the clipboard text that it makes. The fixture repo is in the work folder of the
// end-to-end server, so a test reads the doc file from disk and compares it with what the page made.

const REPO = join(E2E_DIR, 'repo');
const file = (...parts: string[]) => readFileSync(join(REPO, ...parts), 'utf8');

/** The doc of most tests: a plain LF file with a frontmatter, a title, and a place in the "Guides" section. */
const SETUP = { slug: 'guides/setup', path: ['docs', 'guides', 'setup.md'], title: 'Setup guide' };

/** The repo of the fixture config (e2e/server.ts): the header of the copied text names it. */
const REPO_URL = 'https://github.com/fixture-owner/fixture-repo/blob/main';

const documentOf = (page: Page) => page.getByRole('region', { name: 'Document' });

/** The main button as it rests. Its name is the words it shows, so it is found by any of the four. */
const mainButton = (page: Page) => documentOf(page).getByRole('button', { name: /^(Copy for LLM|Copied|Copy failed|Download failed)$/ });
const moreButton = (page: Page) => documentOf(page).getByRole('button', { name: 'More', exact: true });
// Windows keeps text on the clipboard with CR LF line ends and gives it back that way. The page writes the text as it is, so the line ends are put back to LF here.
const clipboard = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

/** The words that a screen reader gets: the status region of the toolbar, which is on the page from the start. */
const statusOf = (page: Page) => documentOf(page).locator('[role="status"][aria-live="polite"]');

async function openDoc(page: Page, slug = SETUP.slug, heading = SETUP.title): Promise<void> {
  await page.goto(`/docs/${slug}`);
  await expect(documentOf(page).getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

/** The expected header of the copied text for a doc of the fixture repo. */
const headerOf = (title: string, id: string) => `${title}\n${id} ${REPO_URL}/${id}\n\n`;

test.describe('Copy and Download on a doc page', () => {
  test('doc page has a split button with Copy for LLM and a menu with Download as markdown', async ({ page }) => {
    await openDoc(page);
    const main = mainButton(page);
    const more = moreButton(page);
    await expect(main).toHaveText('Copy for LLM');
    await expect(main.locator('svg.lucide-copy')).toHaveCount(1);
    await expect(more.locator('svg.lucide-chevron-down')).toHaveCount(1);

    // The two buttons are one group, side by side, with no gap between them.
    const group = documentOf(page).getByRole('group');
    await expect(group).toHaveCount(1);
    await expect(group.getByRole('button')).toHaveCount(2);
    const [mainBox, moreBox] = await Promise.all([main.boundingBox(), more.boundingBox()]);
    expect(Math.abs((mainBox?.x ?? 0) + (mainBox?.width ?? 0) - (moreBox?.x ?? 0))).toBeLessThanOrEqual(2);

    // It sits under the header of the doc and above its text.
    const bottomOf = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())?.y ?? NaN;
    const headerY = await bottomOf(page.getByLabel('Document details'));
    const headingY = await bottomOf(documentOf(page).getByRole('heading', { level: 1, name: SETUP.title }));
    const mainY = (mainBox?.y ?? NaN) + (mainBox?.height ?? NaN);
    expect(mainBox?.y ?? NaN).toBeGreaterThan(headerY);
    expect(mainY).toBeLessThan(headingY);

    // The arrow opens a menu with two entries, each with its icon.
    await more.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Copy for LLM', 'Download as markdown']);
    await expect(menu.getByRole('menuitem', { name: 'Copy for LLM' }).locator('svg.lucide-copy')).toHaveCount(1);
    await expect(menu.getByRole('menuitem', { name: 'Download as markdown' }).locator('svg.lucide-download')).toHaveCount(1);
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(more).toHaveAttribute('aria-haspopup', 'true');
  });

  test('copy puts the header and the file text on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const text = file(...SETUP.path);
    expect(text).not.toContain('\r'); // a browser may change line ends on the clipboard, so this doc has none to change
    expect(text.startsWith('---\ntype: guide')).toBe(true); // the frontmatter is part of the text

    await openDoc(page);
    await mainButton(page).click();
    await expect(mainButton(page)).toHaveText('Copied');
    expect(await clipboard(page)).toBe(`${headerOf('Setup guide', 'docs/guides/setup.md')}${text}`);

    // The menu entry does the same.
    await page.evaluate(() => navigator.clipboard.writeText('something else'));
    await moreButton(page).click();
    await page.getByRole('menuitem', { name: 'Copy for LLM' }).click();
    // The button still says Copied from the first copy, so the clipboard is polled until the second copy has landed.
    await expect.poll(() => clipboard(page)).toBe(`${headerOf('Setup guide', 'docs/guides/setup.md')}${text}`);
    await expect(mainButton(page)).toHaveText('Copied');

    // A doc outside docs/ has its own repo path in the header.
    await openDoc(page, 'status', 'Fixture Project'); // the title in the frontmatter is not the first heading
    await mainButton(page).click();
    await expect(mainButton(page)).toHaveText('Copied');
    expect((await clipboard(page)).startsWith(headerOf('Fixture Project, Status', 'status.md'))).toBe(true);
  });

  test('copy shows Copied and then Copy failed when the clipboard write fails', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDoc(page);
    const main = mainButton(page);

    // 1. A copy that works: the words and the check for 2 seconds, then the button as it was.
    await main.click();
    await expect(main).toHaveText('Copied');
    await expect(main.locator('svg.lucide-check')).toHaveCount(1);
    await expect(statusOf(page)).toHaveText('Copied');
    await page.waitForTimeout(1000);
    await expect(main).toHaveText('Copied'); // still there after 1 second
    await expect(main).toHaveText('Copy for LLM', { timeout: 3000 });
    await expect(main.locator('svg.lucide-copy')).toHaveCount(1);
    await expect(statusOf(page)).toHaveText('');

    // 2. A copy that the browser refuses (a permission that was said no to): the button says so, and does not say Copied.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    });
    await main.click();
    await expect(main).toHaveText('Copy failed');
    await expect(main.locator('svg.lucide-circle-alert')).toHaveCount(1);
    await expect(statusOf(page)).toHaveText('Copy failed');
    await page.waitForTimeout(1000);
    await expect(main).toHaveText('Copy failed');
    await expect(main).toHaveText('Copy for LLM', { timeout: 3000 });
    await expect(statusOf(page)).toHaveText('');
  });

  test('a source that cannot be fetched shows Copy failed or Download failed, and the button comes back', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDoc(page);
    // The server does not answer for the source (the page itself and its other data are not touched).
    await page.route('**/api/docs/guides/setup/source', (route) => route.fulfill({ status: 500, body: 'no' }));
    await page.evaluate(() => navigator.clipboard.writeText('kept'));

    await mainButton(page).click();
    await expect(mainButton(page)).toHaveText('Copy failed');
    expect(await clipboard(page)).toBe('kept'); // a failed copy leaves the clipboard as it was
    await expect(mainButton(page)).toHaveText('Copy for LLM', { timeout: 4000 });

    await moreButton(page).click();
    await page.getByRole('menuitem', { name: 'Download as markdown' }).click();
    await expect(mainButton(page)).toHaveText('Download failed');
    await expect(mainButton(page).locator('svg.lucide-circle-alert')).toHaveCount(1);
    await expect(statusOf(page)).toHaveText('Download failed');
    await expect(mainButton(page)).toHaveText('Copy for LLM', { timeout: 4000 });
  });

  test('download saves the file text under the file name', async ({ page }) => {
    await openDoc(page);
    await moreButton(page).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download as markdown' }).click()]);
    expect(download.suggestedFilename()).toBe('setup.md');
    const saved = readFileSync(await download.path());
    expect(saved.equals(readFileSync(join(REPO, ...SETUP.path)))).toBe(true);

    // A doc with Windows line ends and a name in another folder: the same bytes, and the name of the file only.
    await openDoc(page, 'crlf', 'Windows line endings');
    await moreButton(page).click();
    const [second] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download as markdown' }).click()]);
    expect(second.suggestedFilename()).toBe('crlf.md');
    expect(readFileSync(await second.path()).equals(readFileSync(join(REPO, 'docs', 'crlf.md')))).toBe(true);
    // The menu is closed after a choice.
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the menu works with the keyboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDoc(page);
    const more = moreButton(page);
    const menu = page.getByRole('menu');

    // Enter opens the menu, Escape closes it, and the focus returns to the arrow.
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();

    // Space opens it too.
    await page.keyboard.press('Space');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // ArrowDown opens it with the first entry in focus, and ArrowDown again moves to the second.
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy for LLM' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Download as markdown' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: 'Copy for LLM' })).toBeFocused();

    // Enter chooses the focused entry: the copy happens, and the menu closes.
    await page.evaluate(() => navigator.clipboard.writeText('something else'));
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(mainButton(page)).toHaveText('Copied');
    expect(await clipboard(page)).toContain('type: guide');

    // The second entry by the keyboard: a download.
    await more.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    expect(download.suggestedFilename()).toBe('setup.md');

    // The menu has ARIA roles: a menu with items, opened by a button that says so.
    await more.press('Enter');
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(more).toHaveAttribute('aria-haspopup', 'true');
    await page.keyboard.press('Escape');
  });

  test('no toolbar on the overview, the Gone page and the decision table', async ({ page }) => {
    const toolbarCount = () => page.getByRole('button', { name: /^(Copy for LLM|Copied|Copy failed|Download failed|More)$/ }).count();

    // The overview.
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1, name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Overview' }).getByRole('region', { name: 'Guides', exact: true })).toBeVisible();
    expect(await toolbarCount()).toBe(0);

    // An address that no doc has.
    await page.goto('/docs/no/such/doc');
    await expect(page.getByRole('heading', { level: 1, name: 'Doc not found' })).toBeVisible();
    expect(await toolbarCount()).toBe(0);

    // The decision table draws three docs in one table, so it has no single file.
    await page.goto('/docs/decisions');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('table').first()).toBeVisible();
    expect(await toolbarCount()).toBe(0);

    // And a doc has it, so the check above is not blind.
    await openDoc(page);
    expect(await toolbarCount()).toBe(2);
  });

  test('the source route answers over HTTP with the file text and its headers', async ({ request }) => {
    const answer = await request.get(`/api/docs/${SETUP.slug}/source`);
    expect(answer.status()).toBe(200);
    expect(answer.headers()['content-type']).toBe('text/markdown; charset=utf-8');
    expect(answer.headers()['x-content-type-options']).toBe('nosniff');
    expect(answer.headers()['cache-control']).toBe('no-store');
    expect(await answer.text()).toBe(file(...SETUP.path));
    expect((await request.get('/api/docs/no/such/doc/source')).status()).toBe(404);
  });
});
