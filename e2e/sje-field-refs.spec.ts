/**
 * Makes the REFERENCE pictures of the field parity harness (M5 task 8, `e2e/sje-field-parity.spec.ts`) from the LEGACY path: the game without `?engine=sje`, whose Canvas 2D
 * field is the thing the new field must equal. LOCAL ONLY: it does nothing unless `M5_REFS=1`, and it is not in the CI list.
 *
 *   M5_REFS=1 PW_PORT=3012 npx playwright test e2e/sje-field-refs.spec.ts --reporter=line        (Edge on the GPU: writes the `gpu` set)
 *   M5_REFS=1 CI=1 PW_PORT=3012 npx playwright test e2e/sje-field-refs.spec.ts --reporter=line   (the bundled Chromium on SwiftShader: writes the `soft` set)
 *
 * It writes tests/fixtures/sjefield/<kind>/<case>.png (1280x720 (the game at zoom 2, as the player sees it), one per state of cases.json) and tests/fixtures/sjefield/manifest.json (the SHA-256 of every map file the
 * pictures depend on, the field tick of each picture, and how many 2x2 blocks of the screenshot were not flat). Run it for both kinds, then commit.
 * A picture only needs to be made again when the legacy field itself changed on purpose (a map, a prop's art, the lighting): the new field must still equal it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { CASES, DEFAULT_FRAME, DIR, INPUTS, rendererKind, ROOT, shoot, writeRef } from './sjefieldkit';

const ON = process.env.M5_REFS === '1';

/** The file as hashed: LF line ends, so a Windows checkout and a Linux one agree. */
export const pinText = (rel: string): string => createHash('sha256').update(readFileSync(join(ROOT, rel), 'utf8').replaceAll('\r\n', '\n'), 'utf8').digest('hex');

test.describe('field parity references (legacy path)', () => {
  test.skip(!ON, 'local only: set M5_REFS=1');
  test.setTimeout(1_800_000);

  test('make the references from the old field', async ({ browser }) => {
    const manifestPath = join(DIR, 'manifest.json');
    const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>) : {};
    const frames: Record<string, number> = {};
    let kind: 'gpu' | 'soft' | null = null;
    for (const c of CASES) {
      const s = await shoot(browser, c, false);
      try {
        kind ??= await rendererKind(s.page.page);
        if (c.kinds && !c.kinds.includes(kind)) {
          console.log(`${kind} ${c.id}: skipped (the old path cannot draw this state on this kind of renderer)`);
          continue;
        }
        if (s.frame !== (c.frame ?? DEFAULT_FRAME)) throw new Error(`${c.id}: the tick is ${s.frame}`);
        if (s.page.problems.length) throw new Error(`${c.id}: the page logged ${s.page.problems.join(' | ')}`);
        writeRef(kind, c.id, s.png);
        frames[c.id] = s.frame;
        console.log(`${kind} ${c.id}: tick ${s.frame}, ${s.uneven} uneven 2x2 blocks, map ${s.info.map}, ${s.info.lights} lights`);
      } finally {
        await s.page.close();
      }
    }
    const inputs = Object.fromEntries(INPUTS.map((f) => [f, pinText(f)]));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, generatedBy: 'e2e/sje-field-refs.spec.ts', inputs, [`frames-${kind}`]: frames }, null, 1)}\n`);
  });
});
