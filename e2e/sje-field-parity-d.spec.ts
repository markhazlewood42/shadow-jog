/**
 * The controls of the field parity harness of milestone M5 (docs/engine/m5-brief.md task 8, decision 4a). Method: docs/engine/tooling-and-testing.md section 5, "M5 parity method".
 *
 * Part D proves that the measured bounds of parts A to C can fail. It runs 6 controls: two base states (`CONTROL_IDS`: `lantern_row` and `bar`), each broken in three ways (a 2/255 step in the
 * new picture, an actor one pixel off, a wrong light radius). Every control must FAIL the bounds. A control that passes means that the bounds are too loose.
 * It has no state list of its own and does not check the pinned inputs, the crisp frame or SJEFIELD_SHOTS. It reads the reference pictures of its two base states only.
 *
 * Run it:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-field-parity-d.spec.ts --reporter=line   (the bundled Chromium on SwiftShader, like CI)
 */
import { test } from '@playwright/test';
import { CONTROL_IDS, lightControl, nudgeControl, stepControl } from './sjefieldparityparts';

// Part D: the 6 controls (each one must FAIL the measured bounds).
test.describe('field parity: the bounds can fail (controls)', () => {
  test.setTimeout(240_000);
  for (const id of CONTROL_IDS) {
    test(`${id}: a 2/255 step is rejected`, async ({ browser }) => {
      await stepControl(browser, id);
    });
    test(`${id}: an actor one pixel off is rejected`, async ({ browser }) => {
      await nudgeControl(browser, id);
    });
    test(`${id}: a wrong light radius is rejected`, async ({ browser }) => {
      await lightControl(browser, id);
    });
  }
});
