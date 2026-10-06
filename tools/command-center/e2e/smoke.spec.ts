import { expect, test } from '@playwright/test';

// The smoke test of the shell: the page loads from the real server on port 3010, looks the way
// the Look rule says, and shows the server's health. It also checks that a failing source shows
// its own error and leaves the rest of the page alone.

const ORIGIN = 'http://127.0.0.1:3010';

test.describe('the shell', () => {
  // These tests are about the page around the panels (its fonts, its requests, its error states), not about the glass. With the glass off, the page does not wait for a
  // GPU to compile shaders, and a run of this file alone does not depend on how fast the GPU of the machine is. (e2e/now.spec.ts tests the glass.)
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cc.now.glass', 'off'));
  });

  test('shows the navy page with Geist text under the title "Shadow Jog Command Center", and asks for nothing from another host', async ({ page }) => {
    const requested: string[] = [];
    const problems: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    // A console error or warning would also catch a blocked script or style (the content policy says so there).
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

    await page.goto('/');

    await expect(page).toHaveTitle('Shadow Jog Command Center');
    await expect(page.getByRole('heading', { level: 1, name: 'Shadow Jog Command Center' })).toBeVisible();

    // Navy page (paper) and white text (ink), from the tokens.
    const colours = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
    }));
    expect(colours.background).toBe('rgb(13, 12, 31)');
    expect(colours.text).toBe('rgb(244, 241, 255)');

    // Geist: the heading is set in it and its files were loaded. So is Geist Mono, which the version is set in.
    await page.evaluate(() => document.fonts.ready);
    const loadedFaces = await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll('"', '')));
    expect(loadedFaces).toContain('Geist Variable');
    expect(loadedFaces).toContain('Geist Mono Variable');
    const headingFont = await page.getByRole('heading', { level: 1 }).evaluate((h1) => getComputedStyle(h1).fontFamily);
    expect(headingFont).toMatch(/^"?Geist Variable"?/);

    // The page asked this server and nobody else: no font host, no CDN. The font files came from here.
    const foreign = requested.filter((url) => !url.startsWith(`${ORIGIN}/`) && !url.startsWith('data:'));
    expect(foreign).toEqual([]);
    expect(requested.filter((url) => /\.woff2(\?|$)/.test(url)).length).toBeGreaterThan(0);

    expect(problems).toEqual([]);
  });

  test('shows the links of the server config in the Links panel and says that live updates are on', async ({ page, request }) => {
    await page.goto('/');

    // The Links panel reads /api/health: the game address and the links of the config. The fixture config lists the game too, and it is shown once.
    const links = page.getByRole('region', { name: 'Links', exact: true });
    await expect(links).toContainText(/Updated \d\d:\d\d:\d\d/);
    await expect(links.getByRole('link', { name: 'Game' })).toHaveAttribute('href', 'http://localhost:3007');
    await expect(links.getByRole('link', { name: 'GitHub repo' })).toHaveAttribute('href', 'https://github.com/fixture-owner/fixture-repo');
    await expect(links.getByRole('link')).toHaveCount(2);

    // The event stream hello arrived.
    await expect(page.getByText('Live updates: on')).toBeVisible();

    // The same data, straight from the API.
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, name: 'Shadow Jog Command Center', gameUrl: 'http://localhost:3007' });
  });

  test('loads a panel once more when the event stream says hello, so a change made while the page was loading is not missed', async ({ page }) => {
    let healthRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/health') healthRequests += 1;
    });
    await page.goto('/');
    await expect(page.getByText('Live updates: on')).toBeVisible();
    // One request for the first load, one more after the hello.
    await expect.poll(() => healthRequests).toBeGreaterThanOrEqual(2);
  });

  test('a failing health request shows an error with Retry in its own panel and keeps the rest of the page', async ({ page }) => {
    await page.route('**/api/health', (route) => route.abort());
    await page.goto('/');

    // Only the Links panel reads /api/health, so it is the only panel with an error: the others load from their own routes.
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Cannot reach the command center server');
    await expect(alert).toContainText('network');
    await expect(page.getByRole('region', { name: 'Links', exact: true })).toContainText('Not updated yet');
    // One broken source never blanks the page.
    await expect(page.getByRole('heading', { level: 1, name: 'Shadow Jog Command Center' })).toBeVisible();
    await expect(page.getByText('Live updates: on')).toBeVisible();

    // The server comes back, and Retry brings the panel back.
    await page.unroute('**/api/health');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole('region', { name: 'Links', exact: true })).toContainText(/Updated \d\d:\d\d:\d\d/);
  });

  test('refuses a request that names another host, as DNS rebinding would', async ({ request }) => {
    const foreign = await request.get('/api/health', { headers: { host: 'evil.example' } });
    expect(foreign.status()).toBe(403);
    const own = await request.get('/api/health', { headers: { host: 'localhost:3010' } });
    expect(own.status()).toBe(200);
  });
});
