import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import type { DocPage, DocsListing, NavItem, NavSection, Panel } from '../src/shared/types';
import { E2E_DIR } from './fake-gh';

// The docs site in a browser, on the sample docs of fixtures/repo (e2e/server.ts copies them into a
// temp git repo and sorts them with fixtures/nav.json). Two tests change a doc on disk and put it
// back: the server watches the files, so the open page must follow.

/** The fixture repo of the end-to-end server (createE2eRuntime puts it in this folder). */
const REPO = join(E2E_DIR, 'repo');
const MOVING_DOC = join(REPO, 'docs', 'live-edit', 'moving.md');

async function readPanel<T>(request: APIRequestContext, path: string): Promise<T> {
  const answer = await request.get(path);
  const panel = (await answer.json()) as Panel<T>;
  if (!panel.ok) throw new Error(`${path} answered an error: ${panel.error.message}`);
  return panel.data;
}

const readListing = (request: APIRequestContext) => readPanel<DocsListing>(request, '/api/docs');

/** The article region of a doc page: the frame that holds the doc. */
const documentOf = (page: Page) => page.getByRole('region', { name: 'Document' });

/** Where the page keeps the sticky header: the top of the doc must stay below it. */
const headerBottom = (page: Page) => page.locator('header').first().evaluate((header) => header.getBoundingClientRect().bottom);

/** The doc items of a section, as the tree and the cards list them. */
const docItems = (section: NavSection) => section.items.filter((item): item is Extract<NavItem, { kind: 'doc' }> => item.kind === 'doc');

/** A page must not log an error or a warning to the console: a blocked script or style shows up there. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

test.describe('the docs site', () => {
  test('the overview shows a card for each section with last-changed dates', async ({ page, request }) => {
    const problems = watchConsole(page);
    const { nav } = await readListing(request);
    expect(nav.map((section) => section.title)).toEqual(['Start here', 'Guides', 'Diagrams and links', 'Live edits', 'Engine design', 'Decisions', 'Project records']);

    await page.goto('/docs');
    await expect(page).toHaveTitle(/^Docs/);
    await expect(page.getByRole('heading', { level: 1, name: 'Docs' })).toBeVisible();
    const overview = page.getByRole('region', { name: 'Overview' });
    await expect(overview).toContainText(/Updated \d\d:\d\d:\d\d/); // when the panel was last updated

    for (const section of nav) {
      const card = overview.getByRole('region', { name: section.title, exact: true });
      await expect(card).toBeVisible();
      // The key pages of a card: the first five docs, each with the day it last changed.
      for (const item of docItems(section).slice(0, 5)) {
        const row = card.getByRole('listitem').filter({ has: page.getByRole('link', { name: item.title, exact: true }) });
        await expect(row.getByRole('link', { name: item.title, exact: true })).toHaveAttribute('href', `/docs/${item.slug}`);
        await expect(row.locator('time')).toHaveText(item.updated);
        await expect(row.locator('time')).toHaveAttribute('datetime', item.updated);
      }
    }

    // Known days: from the frontmatter, and from git (the sample docs are in the first or second commit of the fixture repo).
    const dateOf = async (section: string, title: string) =>
      overview.getByRole('region', { name: section, exact: true }).getByRole('listitem').filter({ hasText: title }).locator('time').textContent();
    expect(await dateOf('Guides', 'Setup guide')).toBe('2026-01-10');
    expect(await dateOf('Guides', 'Glossary')).toBe('2026-01-08');
    expect(await dateOf('Guides', 'A plain doc')).toBe('2026-01-01');
    expect(await dateOf('Start here', 'First doc')).toBe('2026-01-02');

    // A card that holds more than five docs lists the first five, and one click shows the rest.
    const guides = overview.getByRole('region', { name: 'Guides', exact: true });
    await expect(guides.getByRole('listitem')).toHaveCount(5);
    await guides.getByRole('button', { name: /Show all 6/ }).click();
    await expect(guides.getByRole('listitem')).toHaveCount(6);
    await expect(guides.getByRole('link', { name: 'Repeated headings' })).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('every fixture doc is within two clicks of /docs', async ({ page, request }) => {
    const { docs, nav } = await readListing(request);
    expect(docs.length).toBeGreaterThanOrEqual(10);
    // Every doc is in a section (the "Other" section holds the ones that no section names).
    const sectionOf = new Map<string, NavSection>();
    for (const section of nav) for (const item of docItems(section)) sectionOf.set(item.slug, section);
    expect(docs.filter((doc) => !sectionOf.has(doc.slug)).map((doc) => doc.slug)).toEqual([]);

    for (const doc of docs) {
      await page.goto('/docs');
      const tree = page.getByRole('navigation', { name: 'Docs sections' });
      const link = tree.getByRole('link', { name: doc.title, exact: true });
      // Click 1: open the section of the doc (every section starts folded on /docs, and a folded section
      // holds no visible link). Click 2: the doc. A click on a link that is not there fails the test.
      await expect(link).toBeHidden();
      await tree.getByRole('button', { name: (sectionOf.get(doc.slug) as NavSection).title, exact: true }).click();
      await link.click();
      await expect(page).toHaveURL(`/docs/${doc.slug}`);
      await expect(documentOf(page).getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(`^${doc.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  });

  test('a doc shows its header (type, status, updated), outline and backlinks', async ({ page, request }) => {
    const problems = watchConsole(page);
    const doc = await readPanel<DocPage>(request, '/api/docs/guides/setup');
    await page.goto('/docs/guides/setup');

    const article = documentOf(page);
    await expect(article.getByRole('heading', { level: 1, name: 'Setup guide' })).toBeVisible();
    await expect(article).toContainText(/Updated \d\d:\d\d:\d\d/); // the panel's own time of the last update

    const details = page.getByLabel('Document details');
    await expect(details.getByText('Type', { exact: true })).toBeVisible();
    await expect(details.getByText('guide', { exact: true })).toBeVisible();
    await expect(details.getByText('Status', { exact: true })).toBeVisible();
    await expect(details.getByText('approved', { exact: true })).toBeVisible();
    await expect(details.getByText('Updated', { exact: true })).toBeVisible();
    await expect(details.locator('time')).toHaveText('2026-01-10');

    // The outline lists the headings the server found, in order, each linking to its id.
    const outline = page.getByRole('navigation', { name: 'Outline' });
    const links = outline.getByRole('link');
    await expect(links).toHaveCount(doc.headings.length);
    expect(doc.headings.length).toBeGreaterThanOrEqual(10);
    for (const [i, heading] of doc.headings.entries()) {
      await expect(links.nth(i)).toHaveText(heading.text);
      await expect(links.nth(i)).toHaveAttribute('href', `/docs/guides/setup#${heading.id}`);
    }

    // The backlinks: the docs that link here.
    const linkedFrom = page.getByRole('navigation', { name: 'Linked from' });
    await expect(linkedFrom.getByRole('link')).toHaveCount(doc.backlinks.length);
    await expect(linkedFrom.getByRole('link', { name: 'Glossary' })).toHaveAttribute('href', '/docs/reference/glossary');

    // A doc that nothing links to says so, and a doc with no frontmatter shows its date and where it came from.
    await page.goto('/docs/first');
    await expect(page.getByRole('navigation', { name: 'Linked from' })).toContainText('No other doc links here');
    await expect(page.getByLabel('Document details').locator('time')).toHaveText('2026-01-02');
    await expect(page.getByLabel('Document details')).toContainText('from git');

    expect(problems).toEqual([]);
  });

  test('an outline link scrolls to its heading', async ({ page }) => {
    await page.goto('/docs/guides/setup');
    const outline = page.getByRole('navigation', { name: 'Outline' });
    const heading = page.locator('.doc-html h2#troubleshooting');
    await expect(heading).toBeVisible();
    await expect(heading).not.toBeInViewport(); // far down the doc

    await outline.getByRole('link', { name: 'Troubleshooting' }).click();
    await expect(page).toHaveURL(/\/docs\/guides\/setup#troubleshooting$/);
    await expect(heading).toBeInViewport();
    // The heading stops below the sticky header, not under it.
    const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual((await headerBottom(page)) - 1);
    expect(top).toBeLessThan(260);

    // A heading can have the same id as an element of the page. Here "Root" is #root, which the page itself also has.
    await outline.getByRole('link', { name: 'Root', exact: true }).click();
    await expect(page).toHaveURL(/#root$/);
    await expect(page.locator('.doc-html h2#root')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

    // An address with a hash opens at that heading.
    await page.goto('/docs/guides/setup#uninstalling');
    await expect(page.locator('.doc-html h2#uninstalling')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  });

  test('an internal link navigates without a page load', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/docs/no-frontmatter');
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'A plain doc' })).toBeVisible();
    // A mark on the window: a real page load would wipe it.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__ccStillHere = true;
    });

    await documentOf(page).getByRole('link', { name: 'The tables doc' }).click();
    await expect(page).toHaveURL(/\/docs\/tables#alignment$/);
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'Tables' })).toBeVisible();
    await expect(page).toHaveTitle(/^Tables/);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ccStillHere)).toBe(true);

    // The browser's Back button works across the two docs, again with no load.
    await page.goBack();
    await expect(page).toHaveURL(/\/docs\/no-frontmatter$/);
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'A plain doc' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ccStillHere)).toBe(true);

    expect(problems).toEqual([]);
  });

  test('a link to code opens GitHub in a new tab, and the doc stays where it is', async ({ page, context }) => {
    // No test reaches the network: the answer from GitHub is made up here.
    await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>GitHub stand-in</title>' }));
    await page.goto('/docs/guides/setup');
    const link = documentOf(page).getByRole('link', { name: 'the sample build script' });
    const codeAddress = 'https://github.com/fixture-owner/fixture-repo/blob/main/scripts/build.sh';
    await expect(link).toHaveAttribute('href', codeAddress);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);

    const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await expect(opened).toHaveURL(codeAddress);
    await opened.close();
    await expect(page).toHaveURL(/\/docs\/guides\/setup$/);
  });

  test('a broken link shows its marker', async ({ page }) => {
    // The doc has a link that starts with "javascript:". If it were a real link, a click would run it.
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/docs/broken-link');
    const article = documentOf(page);
    const markers = article.locator('.doc-html .broken-link');
    await expect(markers).toHaveCount(4);
    for (const marker of await markers.all()) {
      await expect(marker).toBeVisible();
      await expect(marker).toHaveAttribute('title', /\S/); // the reason
    }
    await expect(markers.first()).toHaveAttribute('title', /does not exist/);

    // The marker is not only a colour: a dashed line under the words and a label after them.
    const style = await markers.first().evaluate((el) => ({
      line: getComputedStyle(el).textDecorationLine,
      kind: getComputedStyle(el).textDecorationStyle,
      label: getComputedStyle(el, '::after').content,
    }));
    expect(style.line).toContain('underline');
    expect(style.kind).toBe('dashed');
    expect(style.label).toMatch(/broken/i);
    // A marker is not a link.
    await expect(article.locator('.doc-html a.broken-link, .doc-html span.broken-link a')).toHaveCount(0);

    // A link that works is a link, and the doc says how many do not.
    await expect(article.getByRole('link', { name: 'A link to a doc that exists' })).toHaveAttribute('href', '/docs/no-frontmatter');
    await expect(article.getByText(/4 broken links/)).toBeVisible();

    // Clicking every marker does nothing: no page change and no script.
    for (const marker of await markers.all()) await marker.click();
    await expect(page).toHaveURL(/\/docs\/broken-link$/);
    expect(dialogs).toEqual([]);
  });

  test('a doc cannot run script: its raw tags show as text', async ({ page }) => {
    const problems = watchConsole(page); // a script that the content policy blocked would show up here
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/docs/hostile');
    const body = documentOf(page).locator('.doc-html');
    await expect(body.getByRole('heading', { level: 1, name: 'A doc with hostile text' })).toBeVisible();

    // The tags are words on the page.
    await expect(body).toContainText("<script>window.__ccHostile = 'a script ran'</script>");
    await expect(body).toContainText('onerror="window.__ccHostile');
    await expect(body).toContainText('<iframe src="https://example.invalid/frame"></iframe>');
    // They are not elements: the doc holds only the elements that markdown makes.
    await expect(body.locator('script, iframe, img, [onclick], [onerror]')).toHaveCount(0);

    // Nothing ran, also not when the words are clicked.
    await body.getByText('A raw anchor').click();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ccHostile)).toBeUndefined();
    expect(dialogs).toEqual([]);
    expect(problems).toEqual([]);

    // A heading with a tag in it keeps the words, and its id is made of letters, digits and dashes only.
    await expect(body.locator('h2')).toHaveText('A heading with a tag in it: <b>bold</b>');
    await expect(body.locator('h2')).toHaveAttribute('id', /^[\p{L}\p{N}_-]+$/u);
    await expect(page.getByRole('navigation', { name: 'Outline' }).getByRole('link')).toHaveText('A heading with a tag in it: <b>bold</b>');
  });

  test('a diagram opens a zoom view, Esc closes it and the editable-source link stays', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/docs/diagram');
    const image = documentOf(page).locator('.doc-html img[data-zoom]');
    await expect(image).toBeVisible();
    const src = await image.getAttribute('src');
    expect(src).toMatch(/^\/files\/[0-9a-f]{8}\/flow\.png$/);
    // The picture loaded (a broken picture has no width).
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    const source = documentOf(page).getByRole('link', { name: 'diagrams/flow.html' });
    await expect(source).toHaveAttribute('href', /^\/files\/[0-9a-f]{8}\/flow\.html$/);

    await image.click();
    const dialog = page.getByRole('dialog', { name: 'Diagram' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('src', src as string);
    expect(await dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // The link to the editable source is in the zoom view too, and goes to the same file.
    const zoomSource = dialog.getByRole('link', { name: 'Editable source' });
    await expect(zoomSource).toHaveAttribute('href', (await source.getAttribute('href')) as string);
    await expect(zoomSource).toHaveAttribute('target', '_blank');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // The link to the editable source stays in the doc, and the page still works.
    await expect(source).toBeVisible();
    await expect(image).toBeVisible();

    // Opening it again works, and the keyboard opens it too.
    await image.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    expect(problems).toEqual([]);
  });

  test('search finds a body word and Enter opens the hit', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/docs');
    const box = page.getByRole('combobox', { name: 'Search docs' });
    await box.fill('wombat'); // a word in the body of one doc, in no title and no heading

    const hit = page.getByRole('option', { name: /Setup guide/ });
    await expect(hit).toBeVisible();
    await expect(hit).toContainText('wombat'); // the snippet shows the match, as plain text
    await expect(hit).toContainText('Storage'); // the heading of the part that matched
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(box).toHaveAttribute('aria-expanded', 'true');

    await box.press('Enter');
    await expect(page).toHaveURL(/\/docs\/guides\/setup$/);
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'Setup guide' })).toBeVisible();
    await expect(page.getByRole('listbox')).toBeHidden();

    // The search is on every doc page, finds a heading too, and the arrow keys choose a hit.
    await box.fill('doc');
    await expect(page.getByRole('option').nth(1)).toBeVisible();
    const first = page.getByRole('option').first();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await box.press('ArrowDown');
    await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    const second = await page.getByRole('option').nth(1).getAttribute('href');
    await box.press('Enter');
    await expect(page).toHaveURL(second as string);

    // The list is closed after a hit was opened. The down arrow opens it again; it closes when the focus
    // leaves the box, and opens when the box gets the focus back.
    await expect(page.getByRole('listbox')).toBeHidden();
    await box.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await box.press('Tab');
    await expect(page.getByRole('listbox')).toBeHidden();
    await box.focus();
    await expect(page.getByRole('listbox')).toBeVisible();

    // No match says so, and Esc clears the box and closes the list.
    await box.fill('zzzzzz');
    await expect(page.getByText(/No docs match/)).toBeVisible();
    await box.press('Escape');
    await expect(box).toHaveValue('');
    await expect(page.getByText(/No docs match/)).toBeHidden();

    expect(problems).toEqual([]);
  });

  test('Enter in the search box acts on the text at once, also before the answer is in', async ({ page }) => {
    // The server answers a search after 700 ms, so that Enter comes while the answer is on its way.
    await page.route('**/api/search**', async (route) => {
      await new Promise((done) => setTimeout(done, 700));
      await route.continue();
    });
    const box = page.getByRole('combobox', { name: 'Search docs' });

    // Enter right after typing: the typing pause is not over, so nothing was asked yet. One Enter is enough.
    await page.goto('/docs');
    await box.fill('wombat');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/docs\/guides\/setup$/);
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'Setup guide' })).toBeVisible();

    // Enter after the pause, while the slow answer is on its way.
    await page.goto('/docs');
    const asked = page.waitForRequest('**/api/search**');
    await box.fill('quokka');
    await asked;
    await box.press('Enter');
    await expect(page).toHaveURL(/\/docs\/reference\/glossary$/);

    // Text that is typed on after Enter is another search: the first one must not open its hit.
    await page.goto('/docs');
    await box.fill('wombat');
    await box.press('Enter');
    await box.fill('zzzzzz');
    await expect(page.getByText(/No docs match/)).toBeVisible();
    await expect(page).toHaveURL(/\/docs$/);

    // Enter on a text that has no hit opens nothing, and the list says so.
    await box.press('Enter');
    await expect(page.getByText(/No docs match/)).toBeVisible();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test('a fixture edit updates the open page within 5 s', async ({ page }) => {
    const original = readFileSync(MOVING_DOC, 'utf8');
    try {
      await page.goto('/docs/live-edit/moving');
      await expect(documentOf(page).getByText('The first version of the text.')).toBeVisible();
      // A mark on the window: the page must update itself, not reload.
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__ccStillHere = true;
      });

      writeFileSync(MOVING_DOC, original.replace('The first version of the text.', 'The edited version of the text.'));
      await expect(documentOf(page).getByText('The edited version of the text.')).toBeVisible({ timeout: 5000 });
      await expect(documentOf(page).getByText('The first version of the text.')).toBeHidden();
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ccStillHere)).toBe(true);
    } finally {
      writeFileSync(MOVING_DOC, original);
    }
    // The page follows the file back, so the next test starts from the same text.
    await expect(documentOf(page).getByText('The first version of the text.')).toBeVisible({ timeout: 5000 });
  });

  test('a renamed open doc shows "moved or deleted" with a suggestion', async ({ page }) => {
    const movedTo = join(REPO, 'docs', 'live-edit', 'old', 'moving.md');
    try {
      await page.goto('/docs/live-edit/moving');
      await expect(documentOf(page).getByRole('heading', { level: 1, name: 'A doc that tests move around' })).toBeVisible();

      mkdirSync(join(REPO, 'docs', 'live-edit', 'old'), { recursive: true });
      renameSync(MOVING_DOC, movedTo);

      const gone = page.getByRole('heading', { level: 1, name: /moved or deleted/i });
      await expect(gone).toBeVisible({ timeout: 8000 });
      await expect(page.getByText('/docs/live-edit/moving')).toBeVisible(); // the address that has no doc now
      // The doc has the same file name in another folder: it is offered.
      const suggestion = page.getByRole('link', { name: 'A doc that tests move around' }).first();
      await expect(suggestion).toHaveAttribute('href', '/docs/live-edit/old/moving');
      await expect(page.getByRole('link', { name: /docs overview/i })).toHaveAttribute('href', '/docs');

      await suggestion.click();
      await expect(page).toHaveURL(/\/docs\/live-edit\/old\/moving$/);
      await expect(documentOf(page).getByRole('heading', { level: 1, name: 'A doc that tests move around' })).toBeVisible();
    } finally {
      mkdirSync(join(REPO, 'docs', 'live-edit'), { recursive: true });
      try {
        renameSync(movedTo, MOVING_DOC);
      } catch {
        // The file is already back, or never moved: nothing to put back.
      }
      rmSync(join(REPO, 'docs', 'live-edit', 'old'), { recursive: true, force: true });
    }
    // The old address shows the doc again once the file is back.
    await page.goto('/docs/live-edit/moving');
    await expect(documentOf(page).getByRole('heading', { level: 1, name: 'A doc that tests move around' })).toBeVisible({ timeout: 8000 });
  });

  test('an unreachable server shows an error state with Retry', async ({ page }) => {
    // Every API call fails, as if the server had stopped.
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/docs');

    const overview = page.getByRole('region', { name: 'Overview' });
    await expect(overview.getByRole('alert')).toContainText('Cannot reach the command center server');
    await expect(overview).toContainText('Not updated yet');
    // One broken source never blanks the page: the header, the search and the tree's own frame are still there.
    await expect(page.getByRole('combobox', { name: 'Search docs' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sections' }).getByRole('alert')).toBeVisible();

    // The server comes back. Retry brings the overview back.
    await page.unroute('**/api/**');
    await overview.getByRole('button', { name: 'Retry' }).click();
    await expect(overview.getByRole('alert')).toBeHidden();
    await expect(overview).toContainText(/Updated \d\d:\d\d:\d\d/);
    await expect(overview.getByRole('region', { name: 'Guides', exact: true })).toBeVisible();

    // A doc page has the same error state, and keeps the search and the tree.
    await page.route('**/api/docs/guides/setup', (route) => route.abort());
    await page.goto('/docs/guides/setup');
    const article = documentOf(page);
    await expect(article.getByRole('alert')).toContainText('Cannot reach the command center server');
    await expect(page.getByRole('navigation', { name: 'Docs sections' })).toBeVisible();
    await page.unroute('**/api/docs/guides/setup');
    await article.getByRole('button', { name: 'Retry' }).click();
    await expect(article.getByRole('heading', { level: 1, name: 'Setup guide' })).toBeVisible();
  });
});

// The "done when" check of the docs pages: on the real repo, and not on the sample docs, the overview
// has a card for every section of the nav and no card called "Other" (every doc is placed). It needs a
// command center server that runs on the real repo, so it runs only when CC_REAL_URL names one:
//   CC_NO_OPEN=1 node --import tsx src/server/main.ts --config <a config like the tool's own, with port 3011>
//   CC_REAL_URL=http://127.0.0.1:3011 npx playwright test e2e/docs.spec.ts -g "real repo"
const realUrl = process.env.CC_REAL_URL ?? '';

test.describe('on the real repo', () => {
  test.skip(realUrl === '', 'set CC_REAL_URL to the address of a command center server that runs on the real repo');

  test('the overview lists every section, and "Other" is empty', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: realUrl, viewport: { width: 1280, height: 720 } });
    try {
      const page = await context.newPage();
      const { docs, nav } = await readListing(page.request);
      expect(nav.map((section) => section.title)).toEqual([
        'Start here',
        'Game design',
        'Engine design',
        'Decisions',
        'Architecture and development',
        'Spikes and research',
        'Quality',
        'Project records',
        'Command center',
      ]);

      await page.goto('/docs');
      const overview = page.getByRole('region', { name: 'Overview' });
      await expect(overview.getByRole('heading', { level: 3 })).toHaveText(nav.map((section) => section.title));
      await expect(overview.getByRole('region', { name: 'Other', exact: true })).toHaveCount(0);
      await expect(overview).toContainText(`${docs.length} docs in ${nav.length} sections.`);
      // Every doc is in a section: the sections hold as many docs as there are docs.
      const placed = nav.reduce((count, section) => count + docItems(section).length, 0);
      expect(placed).toBe(docs.length);
    } finally {
      await context.close();
    }
  });
});
