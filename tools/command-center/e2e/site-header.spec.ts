import { type Page, expect, test } from '@playwright/test';

// The header of the site is the same on every page (Mark, 2026-10-14: "The nav jumps between pages"). This measures it in a real browser: the title and the links stand at the
// same place, to the pixel, on every page, at 1280 px wide, and a phone-wide window has no sideways scroll. tests/site-header.test.tsx checks the markup of each route.

const PAGES = ['/', '/docs/roadmap/README', '/docs', '/agents', '/decisions/41', '/workstreams'] as const;

type Box = { x: number; y: number; width: number; height: number };

async function measure(page: Page) {
  const box = async (selector: string): Promise<Box> => {
    const found = await page.locator(selector).first().boundingBox();
    if (found === null) throw new Error(`no box for ${selector}`);
    return found;
  };
  return { header: await box('header'), title: await box('header a'), nav: await box('header nav[aria-label="Main"]') };
}

test.describe('the header of the site', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
  });

  test('has the same height, title and navigation box on every page at 1280 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const seen: Record<string, Awaited<ReturnType<typeof measure>>> = {};
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      seen[path] = await measure(page);
    }
    const [first, ...others] = Object.values(seen);
    for (const other of others) expect(other).toEqual(first);
    // The links sit against the right edge of the page content.
    expect((first?.nav.x ?? 0) + (first?.nav.width ?? 0)).toBeGreaterThan(1200);
  });

  test('has one header and one Main navigation, with the links in order, and marks the current page', async ({ page }) => {
    for (const [path, current] of [
      ['/', 'Now'],
      ['/docs/roadmap/README', 'Roadmap'],
      ['/docs', 'Docs'],
      ['/agents', 'Agents'],
    ] as const) {
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: 'Main' });
      await expect(nav).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(nav.getByRole('link')).toHaveText(['Now', 'Roadmap', 'Docs', 'Agents']);
      await expect(nav.locator('a[aria-current="page"]')).toHaveText(current);
    }
  });

  test('stays at the top of the window when the page scrolls', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 400));
    const top = await page.locator('header').first().evaluate((header) => header.getBoundingClientRect().top);
    expect(top).toBe(0);
  });

  test('the docs search box is in the Docs page body and on no other page', async ({ page }) => {
    await page.goto('/docs');
    const search = page.getByRole('combobox', { name: 'Search docs' });
    await expect(search).toBeVisible();
    expect(await search.evaluate((input) => input.closest('header') === null)).toBe(true);
    for (const path of ['/', '/agents', '/decisions/41']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Search docs' })).toHaveCount(0);
    }
  });

  test('on a Docs page the title and the search box share one row, and the side nav and the text start under it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const [path, title] of [['/docs', 'Docs'], ['/docs/guides/setup', 'Setup guide']] as const) {
      await page.goto(path);
      const h1 = page.getByRole('heading', { level: 1, name: title });
      const search = page.getByRole('combobox', { name: 'Search docs' });
      await expect(h1).toBeVisible();
      const [h, s, header] = await Promise.all([h1.boundingBox(), search.boundingBox(), page.locator('header').first().boundingBox()]);
      if (h === null || s === null || header === null) throw new Error('no box');
      // Title at the left, search at the right, on the same line: their vertical ranges overlap.
      expect(h.x + h.width, path).toBeLessThan(s.x);
      expect(Math.min(h.y + h.height, s.y + s.height) - Math.max(h.y, s.y), path).toBeGreaterThan(0);
      // No row of the search alone above them: the title is within 40 px of the header, and the side nav starts beside the row, not under it.
      expect(h.y - (header.y + header.height), path).toBeLessThan(40);
      const nav = await page.getByRole('region', { name: 'Sections', exact: true }).boundingBox();
      expect(nav?.y ?? Number.NaN, path).toBeLessThan(Math.min(h.y + h.height, s.y + s.height));
    }
  });

  test('on a phone the search box wraps under the title, and the Docs page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const path of ['/docs', '/docs/guides/setup']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
      const [h, s] = await Promise.all([page.getByRole('heading', { level: 1 }).first().boundingBox(), page.getByRole('combobox', { name: 'Search docs' }).boundingBox()]);
      expect((s?.y ?? Number.NaN) - ((h?.y ?? 0) + (h?.height ?? 0)), path).toBeGreaterThanOrEqual(0);
    }
  });

  test('fits a phone: no sideways scroll on any page, and the title and links are all in the window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const heights = new Set<number>();
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
      const { header, nav } = await measure(page);
      expect(nav.x, path).toBeGreaterThanOrEqual(0);
      expect(nav.x + nav.width, path).toBeLessThanOrEqual(390);
      heights.add(header.height);
    }
    // The header has one height on every page here too.
    expect(heights.size).toBe(1);
  });
});
