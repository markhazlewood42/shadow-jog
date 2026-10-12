import { expect, test } from '@playwright/test';

// The local build has no Workstreams view yet (design.md section 11.3, step 6): its navigation must not offer the page, the docs navigation must not list it,
// and the address says that the hosted page has the view. The hosted build is tested in e2e/hosted/ (npm run e2e:hosted).

test.describe('Workstreams in the local build', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
  });

  test('is not in the main navigation of the Now page, the docs or the Agents page', async ({ page }) => {
    for (const path of ['/', '/docs', '/agents']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workstreams' })).toHaveCount(0);
    }
  });

  test('is not in the docs sections (tests/hosted-mode.test.tsx checks the filter that hides the nav.json entry)', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('navigation', { name: 'Docs sections' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workstreams' })).toHaveCount(0);
  });

  test('the address says that the hosted page has the view, and does not ask the server for workstreams', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await page.goto('/workstreams');
    await expect(page.getByRole('heading', { level: 1, name: 'Workstreams' })).toBeVisible();
    await expect(page.getByText('The hosted page has this view. The local server gets it later.')).toBeVisible();
    expect(requested.filter((path) => path.includes('workstream') && path !== '/workstreams')).toEqual([]);
    expect(requested).not.toContain('/api/snapshot');
    expect(requested).not.toContain('/api/live');
  });
});
