// Ad-hoc screenshot helper: node scripts/shot.mjs <query> <out.png> [waitMs] [keys...]
// Keys are Playwright key names pressed in order with a short delay, e.g. "Enter" "ArrowDown".
// A key of the form "js:<expr>" evaluates <expr> in the page instead.
import { chromium } from '@playwright/test';

const [query = '', out = 'shot.png', waitMs = '800', ...keys] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:3007/${query ? '?' + query : ''}`);
await page.waitForTimeout(Number(waitMs));
for (const k of keys) {
  if (k.startsWith('js:')) await page.evaluate(k.slice(3));
  else if (k.startsWith('wait:')) await page.waitForTimeout(Number(k.slice(5)));
  else { await page.keyboard.press(k); await page.waitForTimeout(120); }
}
await page.waitForTimeout(200);
await page.locator('#screen').screenshot({ path: out });
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
