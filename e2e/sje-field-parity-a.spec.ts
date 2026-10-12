/**
 * The field on the stage against the old field: the PARITY HARNESS of milestone M5 (docs/engine/m5-brief.md task 8 and pass line 4, decision 4a). Method:
 * docs/engine/tooling-and-testing.md section 5, "M5 parity method".
 *
 * REGRESSION PARITY. A state is a map, a tile, a story-flag preset with a few flags changed, the ambient, the weather, the seed and the field tick
 * (`tests/fixtures/sjefield/cases.json`: all 15 maps, plus day and night, rain on and off, flags, a seed, the camera at the corners of the world map, the banner, and the full
 * effect stack on a GPU). The REFERENCES are pictures of the LEGACY path (the Canvas 2D field that M6 deleted), made at M5 by `e2e/sje-field-refs.spec.ts` (removed in M6; it is in git history) in two
 * kinds, `gpu` (a hardware browser) and `soft` (SwiftShader, what CI runs). This spec puts the new path in the same state on a page with a fake clock, to the same field tick,
 * and compares what the player sees (the window at zoom 2) with the reference of its kind.
 *
 * TWO TIERS (see the result in `e2e/sjefieldparity.ts`):
 *  - THE STRICT GATE of the brief: 0 differing pixels outside the renderer mask (where the `gpu` and `soft` references differ), at most 1/255 inside it. It does NOT hold for lit
 *    frames (the light map is multiplied by Pixi's GL blend, the old path multiplies in Skia, and they round differently). Its numbers are printed for every state; it only fails
 *    the run when `SJEFIELD_STRICT=1`.
 *  - THE MEASURED BOUNDS: what was measured, rounded up, per kind and effects level. A regression guard: it fails when the new field drifts further from the old one. It is not
 *    the gate and not a decision about the tolerance (that is Mark's, brief decision 4).
 *  Controls that must FAIL the bounds: a 2/255 step, an actor one pixel off, a wrong light radius.
 *
 * Also checked: the inputs are pinned (the SHA-256 of every map file the references depend on; a changed file fails first with the command that makes the references again),
 * every map of the game has a state, the new frame is crisp (no uneven 2x2 block) and the page logs nothing.
 *
 * Run it:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-field-parity-a.spec.ts --reporter=line   (the bundled Chromium on SwiftShader, like CI: the `soft` set)
 *          PW_PORT=3012 npx playwright test e2e/sje-field-parity-a.spec.ts --reporter=line       (Edge on the GPU: the `gpu` set)
 *          SJEFIELD_STRICT=1 ...   also fail on the strict gate (it fails today: see the numbers it prints)
 *          SJEFIELD_SHOTS=<folder> saves the new picture, the reference and a diff picture of every state.
 */
import { test } from '@playwright/test';
import { CASES } from './sjefieldkit';
import { inputsBody, PART_SLICES, stateBody } from './sjefieldparityparts';

// Part A: the inputs check and the first 8 states (the town street and its variants, and the world map and its variants). The field parity set is four files, a to d, so that CI can put them in different shards.
test.describe('field parity: the inputs', () => {
  test('every input of the references is pinned, and every map of the game has a state', () => {
    inputsBody();
  });
});

test.describe('field parity: the new field against the old one', () => {
  test.setTimeout(240_000);
  for (const c of CASES.slice(...PART_SLICES[0]!)) {
    test(`${c.id}: ${c.note}`, async ({ browser }) => {
      await stateBody(browser, c);
    });
  }
});
