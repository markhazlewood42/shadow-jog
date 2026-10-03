/** Shared by the stage lab's specs (e2e/stagelab*.spec.ts): where pictures go, whether Mark's sprites are here, and how to open the page. */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const SHOTS = process.env.STAGELAB_SHOTS ?? join(tmpdir(), 'stagelab-shots');
export const MEDIA = process.env.STAGELAB_MEDIA;
/**
 * `STAGELAB_NO_SPRITES=1` pretends Mark's folder is missing, the way a CI checkout of the public repo has it: every request for it is
 * answered with the app's own page (200, text/html), which is what Vite really sends for an unknown path. Run the specs that way
 * to see exactly what CI will see.
 */
export const PRETEND_NO_SPRITES = !!process.env.STAGELAB_NO_SPRITES;
export const HAVE_SPRITES = !PRETEND_NO_SPRITES && existsSync(join(process.cwd(), 'spritefusion-tests', 'extracted', 'kit-battle-idle', 'metadata.json'));

/** Answer every request for Mark's sheets the way Vite does when the folder is not there. */
export async function hideSprites(page: Page): Promise<void> {
  await page.route('**/spritefusion-tests/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>app</title>' }));
}

/** Hide the status line and the pickers (page text laid over the canvas's corners, whose anti-aliased letters are not game pixels). */
export async function hideStatus(page: Page): Promise<void> {
  await page.addStyleTag({ content: '#status, #labbar { display: none !important; }' });
}

/** Open the lab, collecting every console error and page error; resolves when the scene has drawn (or has failed). */
export async function openLab(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Without Mark's folder a real 404 for his sheets would be logged by the browser; the lab shows stand-in figures instead: expected, not a failure.
    // (Vite answers an unknown path with the app's page rather than a 404, so usually there is nothing to filter.)
    if (!HAVE_SPRITES && /404/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  if (PRETEND_NO_SPRITES) await hideSprites(page);
  await page.goto(`/stagelab.html${query}`);
  await page.waitForFunction(() => window.__stagelab?.ready === true || !!window.__stagelab?.error, undefined, { timeout: 30_000 });
  return errors;
}


/**
 * The design's figure rules that Mark's own enemy slots break today (his edits in the Battle Stage Editor, commit
 * 6364bb5; measured with his foot-anchor corrections from `axes.json`, as the editor and Battle Test draw them), as "<stage> <enemy count>: <rule text>" (the text comes from `src/stage/rules.ts`). They are his taste calls,
 * so the stage lab's rule test accepts them and the editor's test expects them to show as warnings. When he moves those
 * enemies (or changes a rule), edit this list; both specs follow.
 */
export const MARKS_FIGURE_BREAKS = [
  'street boss: 1 fighter reaches into the top HUD band (above y 45)',
  'street boss+2: 1 fighter reaches into the top HUD band (above y 45)',
  'sewer 6: the gap between the heroes and the enemies is 37 px (need 55)',
  "sewer 6: the nearest enemy's left edge is 244 (need 260 or more)",
];
