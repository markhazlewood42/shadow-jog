/** Shared by the stage lab's specs (e2e/stagelab*.spec.ts): where pictures go, whether Mark's sprites are here, and how to open the page. */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const SHOTS = process.env.STAGELAB_SHOTS ?? join(tmpdir(), 'stagelab-shots');
export const MEDIA = process.env.STAGELAB_MEDIA;
export const HAVE_SPRITES = existsSync(join(process.cwd(), 'spritefusion-tests', 'extracted', 'kit-battle-idle', 'metadata.json'));

/** Open the lab, collecting every console error and page error; resolves when the scene has drawn (or has failed). */
export async function openLab(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Without Mark's folder the lab asks for his sheets, gets a 404 (the browser logs that) and shows stand-in figures instead: expected, not a failure.
    if (!HAVE_SPRITES && /404/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  await page.goto(`/stagelab.html${query}`);
  await page.waitForFunction(() => window.__stagelab?.ready === true || !!window.__stagelab?.error, undefined, { timeout: 30_000 });
  return errors;
}

