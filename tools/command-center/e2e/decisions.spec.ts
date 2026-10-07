import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import type { DecisionDetail, DecisionsInfo, DocPageData, Panel } from '../src/shared/types';
import { E2E_DIR, FAKE_VIEWER, type GhIssueStore, readGhCalls, readGhIssues, resetGh, setGhIssues, setGhMode } from './fake-gh';
import { amberItems, contrastOf, expectAtMostTwoAmberItems, tokenColors } from './look';

// The decision inbox in a browser: the page of a decision, the form that answers it, the banner on a doc, and the guards of the one write
// route. The server is the real one (e2e/server.ts), with a fixture repo of sample docs and a fake gh that remembers its issues
// (fixtures/gh/issues.json: all made up). No test writes to GitHub: the three writes of an answer go to the fake, which records them.
//
// The decisions that these tests use, from the fixture:
//   41  open, three options (the recommended one is C), links to three sections of docs/guides/setup.md (one of them is not in the doc)
//   42  an issue of a stranger, with the label decision: not a decision
//   43  open, with a "Decision: B" comment from a look-alike login: still open
//   44  answered a day ago by Mark
//   45  closed, and the label decided was put on by another account: not an answer
//   46  open, with a body that is not the template
//   47  open, with markup in the title, the question and the options

/** The fixture repo of the end-to-end server (createE2eRuntime puts it in this folder). */
const REPO = join(E2E_DIR, 'repo');
const SETUP_DOC = join(REPO, 'docs', 'guides', 'setup.md');
const SETUP_ORIGINAL = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'repo', 'docs', 'guides', 'setup.md'), 'utf8');

/** The moment that the dates of fixtures/gh/issues.json are counted from: "answered in the last week" must hold on any day. */
const FIXTURE_NOW = Date.parse('2026-10-06T12:00:00Z');

/** The fixture issues with every date moved so that the fixture's clock is now. */
function issuesFromNow(): GhIssueStore {
  const shift = Date.now() - FIXTURE_NOW;
  const text = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'gh', 'issues.json'), 'utf8');
  const moved = text.replace(/"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)"/g, (_all, iso: string) => `"${new Date(Date.parse(iso) + shift).toISOString().replace(/\.\d{3}Z$/, 'Z')}"`);
  return JSON.parse(moved) as GhIssueStore;
}

/** Puts the fixture issues into the fake gh and makes the server read them (the end-to-end server lets a forced refresh through at once). */
async function seed(request: APIRequestContext, store: GhIssueStore = issuesFromNow()): Promise<void> {
  resetGh();
  setGhIssues(store);
  const res = await request.get('/api/decisions?refresh=1');
  expect(res.status()).toBe(200);
  const panel = (await res.json()) as Panel<DecisionsInfo>;
  expect(panel.ok).toBe(true);
}

test.beforeEach(async ({ request }) => {
  await seed(request);
});
test.afterEach(async ({ request }) => {
  resetGh();
  writeFileSync(SETUP_DOC, SETUP_ORIGINAL);
  await request.get('/api/decisions?refresh=1');
});

/** The calls that wrote to the fake gh: `issue comment`, `issue edit` and `issue close`. */
const writes = () => readGhCalls().filter((call) => call.args[0] === 'issue' && ['comment', 'edit', 'close'].includes(call.args[1] ?? ''));
const writeNames = () => writes().map((call) => call.args.slice(0, 2).join(' '));

/** The comments that the fake repository holds for an issue. */
const commentsOf = (number: number) => (readGhIssues()?.issues.find((issue) => issue.number === number)?.comments ?? []) as { author: { login: string }; body: string }[];

/** A page must not log an error or a warning to the console: a blocked script or style shows up there. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

const decisionOf = (page: Page) => page.getByRole('region', { name: 'Decision', exact: true });
const form = (page: Page) => page.getByRole('form', { name: 'Answer this decision' });
/** The option of the form with this id: its radio button is hidden, and the click goes to the words of the option. */
const optionOf = (page: Page, words: RegExp) => form(page).getByRole('radiogroup').getByText(words);

async function readDecisions(request: APIRequestContext): Promise<DecisionsInfo> {
  const panel = (await (await request.get('/api/decisions')).json()) as Panel<DecisionsInfo>;
  if (!panel.ok) throw new Error(`/api/decisions answered an error: ${panel.error.message}`);
  return panel.data;
}

test.describe('the page of a decision', () => {
  test('shows the question, the options with the recommendation, and the linked doc sections inline', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/decisions/41');
    await expect(page).toHaveTitle('Decision #41 · Shadow Jog Command Center');
    await expect(page.getByRole('heading', { level: 1, name: 'Where should Burrow keep its cache?' })).toBeVisible();

    const decision = decisionOf(page);
    await expect(decision).toContainText('Decision #41');
    await expect(decision).toContainText(/Updated \d\d:\d\d:\d\d/); // the panel says when it was updated
    await expect(decision).toContainText('Where should Burrow keep its cache folder?'); // the question of the body
    await expect(decision).toContainText('The cache is the only part of the storage that grows without a limit.'); // the context
    await expect(decision).toContainText('Session fixture-session-1, branch `feature/cache-folder`.'); // raised by, as the text that the issue has
    await expect(decision).toContainText('The cache change in PR 12.');
    await expect(decision.getByRole('link', { name: /Open the issue on GitHub/ })).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo/issues/41');

    // The three options, and the recommendation on option C only.
    const options = form(page).getByRole('radio');
    await expect(options).toHaveCount(3);
    await expect(form(page).getByText('Recommended')).toHaveCount(1);
    await expect(optionOf(page, /Move it to a new `cache` folder/)).toBeVisible();
    await expect(form(page).getByRole('radiogroup')).toContainText('Recommended');

    // The linked sections are in the page, as the doc has them: the heading and the text under it, with the doc they come from. The last
    // link names a heading that the doc does not have: that is a notice, and not an error.
    const storage = decision.getByRole('region', { name: 'docs/guides/setup.md#storage' });
    await expect(storage.getByRole('heading', { level: 2, name: 'Storage' })).toBeVisible();
    await expect(storage).toContainText('Burrow keeps its data in one folder, and the folder has three parts.');
    await expect(storage).not.toContainText('Upgrading'); // the next section of the doc is not part of this one
    await expect(decision.getByRole('region', { name: 'docs/guides/setup.md#first-run' })).toContainText('The first run builds the index.');
    const missing = decision.getByRole('region', { name: 'docs/guides/setup.md#no-such-heading' });
    await expect(missing.getByRole('note')).toContainText('This section was not found in the docs: docs/guides/setup.md#no-such-heading');
    await expect(decision.getByRole('alert')).toHaveCount(0);

    // A link in the page opens the doc at the heading, inside the site.
    await storage.getByRole('link', { name: 'Open in the docs' }).click();
    await expect(page).toHaveURL('/docs/guides/setup#storage');
    expect(problems).toEqual([]);
  });

  test('issue text with markup shows as text and runs nothing', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/decisions/47');
    const decision = decisionOf(page);
    await expect(decision).toContainText('Should the shop show <script>window.__pwned = true</script> as text, and **not** as bold?');
    await expect(decision).toContainText('<img src=x onerror="window.__pwned = true">');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('<b>Bold</b> or plain?');
    // Nothing was made of it: no handler ran, and the only script in the page is the app's own.
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
    expect(await page.locator('script').count()).toBe(1);
    expect(await page.locator('main img, main b, main i').count()).toBe(0);
    expect(problems).toEqual([]);
  });

  test('says that no decision has the number for an issue of another account, a forged answer and an old one', async ({ page, request }) => {
    // Only the open decisions of Mark and his answers of the last week are listed: not the stranger's 42, not 45 (the label came from another account), not 40 (a month old).
    const info = await readDecisions(request);
    expect(info.open.map((issue) => issue.number)).toEqual([41, 43, 46, 47]);
    expect(info.recent.map((issue) => issue.number)).toEqual([44]);

    for (const number of [42, 45, 40, 999]) {
      expect((await request.get(`/api/decisions/${number}`)).status(), `issue ${number}`).toBe(404);
      await page.goto(`/decisions/${number}`);
      await expect(page.getByRole('heading', { level: 1, name: `No decision has the number ${number}` })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(page.getByRole('form')).toHaveCount(0);
    }
    await page.goto('/decisions/abc');
    await expect(page.getByRole('heading', { level: 1, name: 'This is not the number of a decision' })).toBeVisible();
  });

  test('a body that is not the template shows the problem, and offers no form', async ({ page }) => {
    await page.goto('/decisions/46');
    const decision = decisionOf(page);
    await expect(decision.getByRole('note').first()).toContainText('does not follow the decision template');
    await expect(decision.getByRole('link', { name: /Open the issue on GitHub/ })).toBeVisible();
    await expect(page.getByRole('form')).toHaveCount(0);
  });

  test('an answered decision shows the answer and the options without a form, and a decision with a forged answer is still open', async ({ page }) => {
    await page.goto('/decisions/44');
    const decision = decisionOf(page);
    await expect(decision).toContainText('Answered');
    await expect(decision).toContainText('Mark answered B');
    await expect(decision).toContainText('Green looks better on the dark page. Check it again after the next release.');
    await expect(decision.getByText("Mark's answer")).toBeVisible();
    await expect(page.getByRole('form')).toHaveCount(0);

    // 43 has a "Decision: B" from a look-alike login. It is open, and shows no answer.
    await page.goto('/decisions/43');
    await expect(decisionOf(page)).not.toContainText('Mark answered');
    await expect(form(page)).toBeVisible();
  });

  test('the page shows the current text of the linked section after the doc changes', async ({ page }) => {
    await page.goto('/decisions/41');
    const storage = decisionOf(page).getByRole('region', { name: 'docs/guides/setup.md#storage' });
    await expect(storage).toContainText('The index holds the notes about your files.');

    // The doc is edited on disk. The server watches the files, and tells the open page, which reads the section again.
    writeFileSync(SETUP_DOC, SETUP_ORIGINAL.replace('The index holds the notes about your files.', 'The index now holds the notes about your files and a map of them.'));
    await expect(storage).toContainText('The index now holds the notes about your files and a map of them.', { timeout: 15_000 });
    await expect(storage).not.toContainText('The index holds the notes about your files.');
  });
});

test.describe('answering a decision', () => {
  test('E2E: Mark picks an option, adds a note and sends, the fake gh records one comment, one label and one close, and the page reads Answered', async ({ page, request }) => {
    const problems = watchConsole(page);
    await page.goto('/decisions/41');
    await expect(form(page).getByRole('button', { name: 'Send answer' })).toBeDisabled(); // nothing is chosen yet

    await optionOf(page, /Move it to a new `cache` folder/).click();
    await form(page).getByLabel('Note (optional)').fill('It keeps the cache over a restart, and a backup can skip it.');
    await form(page).getByRole('button', { name: 'Send answer' }).click();

    // The page reads the decision again by itself, and shows it as answered.
    const decision = decisionOf(page);
    await expect(decision).toContainText('Mark answered C');
    await expect(decision).toContainText('It keeps the cache over a restart, and a backup can skip it.');
    await expect(decision.getByText('Answered', { exact: true })).toBeVisible();
    await expect(page.getByRole('form')).toHaveCount(0);

    // The fake gh recorded one comment, one label swap and one close, in that order, each in the one shape that the runner allows.
    const repo = 'fixture-owner/fixture-repo';
    expect(writes().map((call) => call.args)).toEqual([
      ['issue', 'comment', '--repo', repo, '41', '--body', 'Decision: C. It keeps the cache over a restart, and a backup can skip it.'],
      ['issue', 'edit', '--repo', repo, '41', '--add-label', 'decided', '--remove-label', 'decision'],
      ['issue', 'close', '--repo', repo, '41'],
    ]);
    const stored = readGhIssues()?.issues.find((issue) => issue.number === 41);
    expect(stored?.state).toBe('CLOSED');
    expect(stored?.labels.map((label) => label.name)).toEqual(['decided']);
    expect(commentsOf(41).at(-1)).toMatchObject({ author: { login: FAKE_VIEWER }, body: 'Decision: C. It keeps the cache over a restart, and a backup can skip it.' });

    // The list of the server has it too: no longer open, and the newest of the answers.
    const info = await readDecisions(request);
    expect(info.open.map((issue) => issue.number)).not.toContain(41);
    expect(info.recent.map((issue) => issue.number)).toEqual([41, 44]);
    expect(problems).toEqual([]);
  });

  test('a write failure shows an error state and keeps the choice and the note, and the retry finishes the answer with one comment', async ({ page }) => {
    // The label swap fails: the comment is posted, the issue is still open.
    setGhMode({ mode: 'write-fails', step: 'edit' });
    await page.goto('/decisions/41');
    await optionOf(page, /Move it to the temp folder/).click();
    await form(page).getByLabel('Note (optional)').fill('The temp folder is cleaned for us.');
    await form(page).getByRole('button', { name: 'Send answer' }).click();

    // The error says what is done and what is not, and the form keeps what Mark chose and typed. The page has read the decision again, and it is still there.
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Your answer is posted on GitHub as a comment, but the labels of the issue were not changed.');
    await expect(alert).toContainText('failed to change the labels: HTTP 502: Bad Gateway');
    await expect(alert).toContainText('gh-failed');
    // The Look: a page has one or two amber items. The icon of the error is ink, so the amber ones are the state chip and the Retry button.
    await expect(alert.locator('svg').first()).toHaveCSS('color', (await tokenColors(page)).ink);
    await expectAtMostTwoAmberItems(page);
    await expect(form(page).getByRole('radio', { name: /Move it to the temp folder/ })).toBeChecked();
    await expect(form(page).getByLabel('Note (optional)')).toHaveValue('The temp folder is cleaned for us.');
    await expect(form(page).getByRole('button', { name: 'Retry' })).toBeEnabled();
    // The page read the half answer from GitHub: it says so, and the decision is open still.
    await expect(decisionOf(page).getByRole('note').first()).toContainText('An answer was posted on GitHub as a comment (option B)');
    await expect(decisionOf(page).getByText('Open', { exact: true })).toBeVisible();
    expect(writeNames()).toEqual(['issue comment', 'issue edit']);

    // GitHub works again. The retry starts at the label swap, so there is no second comment.
    setGhMode({ mode: 'ok' });
    await form(page).getByRole('button', { name: 'Retry' }).click();
    await expect(decisionOf(page)).toContainText('Mark answered B');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(writeNames()).toEqual(['issue comment', 'issue edit', 'issue edit', 'issue close']);
    expect(commentsOf(41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
    expect(commentsOf(41).at(-1)?.body).toBe('Decision: B. The temp folder is cleaned for us.');
  });

  test('a label that the repository lacks is named in the error, and the retry works when it is made', async ({ page, request }) => {
    const store = issuesFromNow();
    await seed(request, { ...store, labels: ['decision'] }); // no label "decided"
    await page.goto('/decisions/43');
    await optionOf(page, /Keep it for a week/).click();
    await form(page).getByRole('button', { name: 'Send answer' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The label "decided" does not exist in fixture-owner/fixture-repo');
    await expect(alert).toContainText('label-missing');
    await expect(form(page).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(writeNames()).toEqual(['issue comment', 'issue edit']);

    // Mark makes the label. The retry finishes the answer.
    setGhIssues({ ...(readGhIssues() as GhIssueStore), labels: ['decision', 'decided'] });
    await form(page).getByRole('button', { name: 'Retry' }).click();
    await expect(decisionOf(page)).toContainText('Mark answered A');
    expect(writeNames()).toEqual(['issue comment', 'issue edit', 'issue edit', 'issue close']);
  });

  test('when gh cannot be read the page shows the error with the last decision under it, keeps the form, and recovers', async ({ page, request }) => {
    await page.goto('/decisions/41');
    await optionOf(page, /Keep it in the data folder/).click();
    await form(page).getByLabel('Note (optional)').fill('A note that stays.');

    // gh is signed out, and the server looks again: the decisions panel fails and the page hears of it.
    setGhMode({ mode: 'signed-out' });
    await request.get('/api/decisions?refresh=1');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('gh is not signed in to GitHub');
    await expect(alert).toContainText('gh-not-signed-in');
    // The icon of the panel's alert is ink, so with the state chip and the Send answer button (a choice is made) the page has two amber items, not three.
    await expect(alert.locator('svg').first()).toHaveCSS('color', (await tokenColors(page)).ink);
    await expectAtMostTwoAmberItems(page);
    await expect(decisionOf(page)).toContainText(/Last updated \d\d:\d\d:\d\d/);
    // The decision is still there (the last good data), and so are the choice and the note.
    await expect(decisionOf(page)).toContainText('Where should Burrow keep its cache folder?');
    await expect(form(page).getByRole('radio', { name: /Keep it in the data folder/ })).toBeChecked();
    await expect(form(page).getByLabel('Note (optional)')).toHaveValue('A note that stays.');

    setGhMode({ mode: 'ok' });
    await request.get('/api/decisions?refresh=1');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(form(page).getByRole('radio', { name: /Keep it in the data folder/ })).toBeChecked();
    await expect(form(page).getByLabel('Note (optional)')).toHaveValue('A note that stays.');
  });
});

test.describe('the banner on a doc', () => {
  const bannerOf = (page: Page, number: number) => page.locator('.doc-html').getByRole('complementary', { name: `Open decision ${number}` });

  test('E2E: a doc shows the banner above the linked heading', async ({ page }) => {
    await page.goto('/docs/guides/setup');
    const docRegion = page.getByRole('region', { name: 'Document' });
    await expect(docRegion.getByRole('heading', { level: 1, name: 'Setup guide' })).toBeVisible();

    // Decision 41 links to "Storage": its banner is right above that heading. No heading comes between them.
    const storage = docRegion.locator('h2#storage');
    const banner = bannerOf(page, 41).first();
    await expect(banner).toContainText('A decision waits for Mark on this section');
    await expect(banner).toContainText('Where should Burrow keep its cache?');
    const placement = await page.evaluate(() => {
      const heading = document.querySelector('.doc-html h2#storage');
      const before = heading?.parentElement?.previousElementSibling ?? null;
      const rects = { banner: before?.getBoundingClientRect().bottom ?? NaN, heading: heading?.getBoundingClientRect().top ?? NaN };
      return { label: before?.getAttribute('aria-label') ?? null, next: before?.nextElementSibling?.firstElementChild?.id ?? null, ...rects };
    });
    expect(placement.label).toBe('Open decision 41');
    expect(placement.next).toBe('storage'); // the heading is the first thing after the banner
    expect(placement.banner).toBeLessThanOrEqual(placement.heading);
    await expect(storage).toBeVisible();

    // Each link has its banner: "First run" for 41, "Installing" for 43 and 47, and the heading that the doc lacks goes to the top of the doc.
    await expect(page.locator('.doc-html h2#first-run').locator('xpath=../preceding-sibling::*[1]')).toHaveAttribute('aria-label', 'Open decision 41');
    await expect(page.locator('.doc-html h2#installing').locator('xpath=../preceding-sibling::*[1]')).toHaveAttribute('aria-label', /^Open decision (43|47)$/);
    await expect(bannerOf(page, 41)).toHaveCount(3);
    expect(await page.evaluate(() => document.querySelector('.doc-html')?.firstElementChild?.getAttribute('aria-label'))).toBe('Open decision 41');
    // No banner for the stranger's issue, for the forged answer and for the answered decision.
    for (const number of [42, 44, 45]) await expect(bannerOf(page, number)).toHaveCount(0);

    // The link in the banner opens the page of the decision.
    await banner.getByRole('link', { name: /Decision #41/ }).click();
    await expect(page).toHaveURL('/decisions/41');
    await expect(page.getByRole('heading', { level: 1, name: 'Where should Burrow keep its cache?' })).toBeVisible();
  });

  test('takes its banners away when the decision is answered, without a reload', async ({ page, request }) => {
    await page.goto('/docs/guides/setup');
    await expect(bannerOf(page, 41).first()).toBeVisible();

    // The decision is answered through the route, as the page of the decision does it (the token of this run is in the page).
    const token = await page.locator('meta[name="cc-token"]').getAttribute('content');
    const answer = await request.post('/api/decisions/41/answer', { headers: { 'x-cc-token': token ?? '' }, data: { option: 'A' } });
    expect(answer.status()).toBe(200);

    // The server tells the open doc that the decisions changed, and the doc is read again: no banner for 41 is left, and the others stay.
    await expect(bannerOf(page, 41)).toHaveCount(0, { timeout: 15_000 });
    await expect(bannerOf(page, 43)).toHaveCount(1);
  });

  test('a doc that no decision links to has no banner', async ({ page }) => {
    await page.goto('/docs/reference/glossary');
    await expect(page.getByRole('region', { name: 'Document' }).getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('complementary', { name: /Open decision/ })).toHaveCount(0);
  });

  test('the doc route lists the open decisions that link to the doc, one entry for each link, in the order of the decisions', async ({ request }) => {
    // (The route says `decisions: null` only when the source has no list at all, which the unit tests cover: the source of this server has one.)
    const panel = (await (await request.get('/api/docs/guides/setup')).json()) as Panel<DocPageData>;
    expect(panel.ok && panel.data.decisions?.map((banner) => [banner.number, banner.anchor])).toEqual([
      [41, 'storage'],
      [41, 'first-run'],
      [41, 'no-such-heading'],
      [43, 'installing'],
      [47, 'installing'],
    ]);
  });
});

test.describe('the Look: amber and contrast', () => {
  test('E2E: a doc with many banners keeps to two amber items: the first banner is amber, and the others have the lavender frame and an ink icon', async ({ page }) => {
    await page.goto('/docs/guides/setup');
    const banners = page.locator('.doc-html aside[aria-label^="Open decision"]');
    await expect(banners).toHaveCount(5); // decision 41 links three headings, and 43 and 47 one each
    const colors = await tokenColors(page);
    const seen = await banners.evaluateAll((elements) =>
      elements.map((element) => {
        const icon = element.querySelector('svg');
        return { label: element.getAttribute('aria-label'), frame: getComputedStyle(element).borderTopColor, icon: icon === null ? '' : getComputedStyle(icon).color };
      }),
    );
    // The first banner of the page is the amber one (here the one for the heading that the doc lacks, which goes to the top).
    expect(seen[0]).toEqual({ label: 'Open decision 41', frame: colors.accent, icon: colors.accent });
    for (const banner of seen.slice(1)) expect(banner, banner.label ?? '').toMatchObject({ frame: colors.ruleSolid, icon: colors.ink });
    // The page has the amber banner and the amber current item of the section tree, and nothing else.
    await expectAtMostTwoAmberItems(page);
    expect((await amberItems(page)).some((item) => item.startsWith('aside[Open decision 41]'))).toBe(true);
  });

  test('E2E: the page of an open decision has one amber item while nothing is chosen (the Open chip), and two when an option is chosen (the chip and Send answer)', async ({ page }) => {
    await page.goto('/decisions/41');
    const send = form(page).getByRole('button', { name: 'Send answer' });
    await expect(send).toBeDisabled();
    await expect(decisionOf(page).getByText('Open', { exact: true })).toBeVisible();
    const before = await amberItems(page);
    expect(before, before.join(' | ')).toHaveLength(1);
    expect(before.some((item) => item.includes('Send answer'))).toBe(false);

    await optionOf(page, /Move it to a new `cache` folder/).click();
    await expect(send).toBeEnabled();
    await expect(send).toHaveCSS('background-color', (await tokenColors(page)).accent); // the fill has finished its change
    const after = await amberItems(page);
    expect(after, after.join(' | ')).toHaveLength(2);
    expect(after.some((item) => item.includes('Send answer'))).toBe(true);
  });

  test('E2E: the disabled Send answer button keeps the 4.5 to 1 floor of the profile, with its fade counted, and it is not amber', async ({ page }) => {
    await page.goto('/decisions/41');
    const send = form(page).getByRole('button', { name: 'Send answer' });
    await expect(send).toBeDisabled();
    await expect(send).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)'); // no fill: the amber one is for a button that can be pressed
    const colors = await tokenColors(page);
    const off = await contrastOf(send);
    expect(off.text).toBe(colors.soft);
    expect(off.fill).not.toBe(colors.accent);
    expect(off.ratio).toBeGreaterThanOrEqual(4.5);

    // The fill and the label change together, at once: a fade of the fill alone shows the dark label on the empty fill for a frame or two (1.2 to 1) when the button turns on.
    // A person who asks for less motion has no transition at all.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(send).toHaveCSS('transition-property', 'transform, box-shadow');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(send).toHaveCSS('transition-property', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Pressable: the amber fill with the dark label, far above the floor.
    await optionOf(page, /Move it to a new `cache` folder/).click();
    await expect(send).toBeEnabled();
    await expect(send).toHaveCSS('background-color', colors.accent);
    expect((await contrastOf(send)).ratio).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('the answer route of the live server', () => {
  const pageToken = async (request: APIRequestContext) => {
    const html = await (await request.get('/')).text();
    return /<meta name="cc-token" content="([^"]*)"/.exec(html)?.[1] ?? '';
  };

  test('refuses a request without the token of the page, with a wrong token, or from another site, and writes nothing', async ({ request }) => {
    const token = await pageToken(request);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const path = '/api/decisions/41/answer';
    const data = { option: 'A' };

    expect((await request.post(path, { data })).status()).toBe(403); // no token
    expect((await request.post(path, { data, headers: { 'x-cc-token': 'wrong' } })).status()).toBe(403);
    expect((await request.post(path, { data, headers: { 'x-cc-token': `${token}x` } })).status()).toBe(403);
    expect((await request.post(path, { data, headers: { 'x-cc-token': token, origin: 'http://evil.example' } })).status()).toBe(403); // another site
    expect((await request.post(path, { data, headers: { 'x-cc-token': token, 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
    expect((await request.post(path, { data: 'option=A', headers: { 'x-cc-token': token, 'content-type': 'text/plain' } })).status()).toBe(415);
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      expect((await request.fetch(path, { method, headers: { 'x-cc-token': token }, data })).status(), method).toBe(405);
    }
    expect(writes()).toEqual([]);
    // The fake gh got no call at all for them, not even a read of the issue.
    expect(readGhCalls().filter((call) => call.args[0] === 'issue' && call.args[1] === 'view')).toEqual([]);

    // With everything right it goes through.
    const answered = await request.post(path, { data, headers: { 'x-cc-token': token } });
    expect(answered.status()).toBe(200);
    expect(writeNames()).toEqual(['issue comment', 'issue edit', 'issue close']);
  });

  test('refuses a replay and an option that the issue does not have', async ({ request }) => {
    const token = await pageToken(request);
    const post = (number: number, data: unknown) => request.post(`/api/decisions/${number}/answer`, { data, headers: { 'x-cc-token': token } });
    expect((await post(41, { option: 'Z' })).status()).toBe(422);
    expect((await post(42, { option: 'A' })).status()).toBe(404); // the stranger's issue
    expect((await post(44, { option: 'A' })).status()).toBe(409); // answered already
    expect(writes()).toEqual([]);

    const [first, second] = await Promise.all([post(41, { option: 'C' }), post(41, { option: 'C' })]);
    expect([first.status(), second.status()].sort()).toEqual([200, 409]);
    expect((await post(41, { option: 'C' })).status()).toBe(409);
    expect(writeNames()).toEqual(['issue comment', 'issue edit', 'issue close']);
  });

  test('GET /api/decisions/<n> answers the decision with its sections as a panel', async ({ request }) => {
    const panel = (await (await request.get('/api/decisions/41')).json()) as Panel<DecisionDetail>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data.sections.map((section) => section.heading)).toEqual(['Storage', 'First run', null]);
  });
});
