/**
 * Mark's CURRENT design data (`src/data/*.json`) in the Battle Stage Editor: invariants only. He edits those files with the
 * tool, so this spec never names a value of his (a position, a size, a warning). It checks that the editor starts on them, that
 * every hero is there, and that the Warnings chip and list say exactly what the rule module computes for the same stages: whatever
 * that is, even nothing. A warning is advice, so it never fails a run. The editor's behaviour is tested on the frozen fixture in
 * the other `stageedit*` specs. Rule: `docs/DEVELOPING.md`, "Tests vs design data".
 *
 * The scratch copy is opened with `data: 'current'` and is never saved, so nothing here writes a file.
 */
import { expect, test } from '@playwright/test';
import { dropScratch, flush, openEditor, ruleKeys, scratchName } from './stageeditkit';

test('the editor starts on Mark’s current files with every hero present, and its warnings are exactly what the rules compute for them', async ({ page }) => {
  const scratch = scratchName('shipped');
  try {
    const { errors } = await openEditor(page, scratch, '', { data: 'current' });
    // Every hero has proportions, and the file is in the editor's data.
    const heroes = await page.evaluate(() => Object.keys(window.__stageedit?.session.data.heroes ?? {}).sort());
    expect(heroes).toEqual(['hex', 'kit', 'rook', 'sable']);
    // Nothing is unsaved: the editor shows the files as they are on disk.
    expect(await page.evaluate(() => window.__stageedit?.session.dirty)).toBe(false);
    // The chip and the list agree with the rule module, whatever it says.
    const expected = await ruleKeys(page);
    await expect(page.locator('#b-warn')).toHaveText(`Warnings (${expected.length})`);
    await page.locator('#b-warn').click();
    const keys = await page.locator('#warnpop .wi').evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? ''));
    expect(keys.sort()).toEqual(expected);
    await flush(page);
    expect(errors).toEqual([]);
  } finally {
    dropScratch(scratch);
  }
});
