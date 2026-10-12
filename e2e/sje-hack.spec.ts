/**
 * The 3D mode on the GAME page (M7; docs/engine/m7-brief.md pass lines 4 to 13). SKELETON written by Builder A (task 2): every case is a `test.fixme` that names
 * the task that turns it on, so a run reports them as skipped instead of passing nothing. The lab page keeps the cube cases (`e2e/sje-scene3d.spec.ts`,
 * `e2e/sje-canaries.spec.ts`); these cases run a `HackScene` on the real game loop, through a story script and the real door.
 *
 * What the cases assume (task 6 builds it; change this header if the build differs):
 *  - `window.__SJ__.hack(idOrDef, opts?)` starts a hack through the real field script runner (`s.hack`, so the policy loop and the door run) and resolves a `HackOutcome`.
 *    `idOrDef` is an id of `src/data/hacks.json` or a `HackDef`; `opts` has `frame` ('shared-context' | 'canvas-copy'), `contextGraceMs`, `hud`, and `alternative` ('success' | 'fail').
 *  - `window.__SJ__.hackState()` gives `{ running, tick, scene }` of the running `HackScene`, and `__SJ__.step(n)` drives it on the real loop.
 *  - `?scene=hack` opens the same scene on its own (DEV route), for the pictures.
 *  - The DEV door env can be replaced for one call (`probe: () => false`, a chunk loader that rejects), because a booted game always has WebGL 2 and the probe keeps its context.
 * Ports from the Phase 0 spike (`spike/engine-platform:e2e/sje3d.spec.ts`): story bridge (line 383), fallback (520), lifetime (841), canary (889).
 * The controls of each pass line are listed beside its case; a case without its control does not count.
 */
import { test } from '@playwright/test';

test.describe('the story bridge on the real loop (pass lines 4 and 5)', () => {
  // Task 6. A script: say a 2D line, await the hack, say a 2D line. Once `success` (test-short), once `fail` (test-fail). After it, the same 2D scene is back with its state unchanged.
  // The 3D picture is non-blank and a HUD panel is on screen; 0 GL errors, 0 console errors and warnings. CONTROL: a script that does not await shows its second line before the hack ends.
  test.fixme('a 2D line, the hack, a 2D line: the story continues with the result (success)', async () => {});
  test.fixme('a hack the player fails (traceLimit low): outcome fail, via played, the story continues', async () => {});

  // Task 6. game.abandon() and game.reset() in the middle of a hack: outcome fail, via dropped, one hack started, no retry, no second scene, the result within 1 s.
  // CONTROL: the default policy on a context loss does retry (so the case can tell a drop from a loss).
  test.fixme('game.abandon() in the middle of a hack: fail / dropped, no retry, within 1 s', async () => {});
  test.fixme('game.reset() in the middle of a hack: fail / dropped, no retry, within 1 s', async () => {});
});

test.describe('no WebGL 2, and a chunk that fails (pass line 6)', () => {
  // Task 6. The door with an injected probe that returns false: unsupported / no-webgl2 in under 500 ms, 0 requests for the 3D chunk, the story plays its 2D alternative.
  // A booted game that has WebGL 2 never gives no-webgl2. CONTROL: probe true gives no `unsupported`.
  test.fixme('probe false: unsupported / no-webgl2 at once, no chunk request, the 2D alternative plays', async () => {});

  // Task 6. page.route aborts the chunk request: unsupported / chunk-failed, the story continues, one console error from the door only. CONTROL: the same route left open gives a played hack.
  test.fixme('the chunk request is aborted: unsupported / chunk-failed, the story continues', async () => {});
});

test.describe('context lost for good, and back in time (pass lines 7 and 8)', () => {
  // Task 6. loseContext() in the middle of a hack and no restore: aborted / context-lost at most 2000 ms after the loss (expected 1000 to 1100), in both frame modes. 0 console errors.
  // The default policy retries once, the retry ends at once, the story gets success. CONTROL: contextGraceMs 2500 fails the 2 s line.
  test.fixme('shared-context: lost for good ends within 2 s of the loss, and the story gets success after one retry', async () => {});
  test.fixme('canvas-copy: lost for good ends within 2 s of the loss', async () => {});

  // Task 6. Restore at 500 ms: the scene carries on and its picture at tick N has the hash of a run with no loss; 0 console warnings.
  // Restore at 1500 ms (after the grace): the result was already aborted / context-lost, the restore throws and warns nothing, and a new hack draws the hash of a fresh page at the same tick.
  // CONTROL: a build that skips the rewrap shows a stale picture (the lab canary, re-run on the game page).
  test.fixme('a restore at 500 ms: the scene carries on with the picture it would have drawn', async () => {});
  test.fixme('a restore at 1500 ms: already ended, silent, and a new hack draws the fresh-page picture', async () => {});
});

test.describe('leak (pass line 9)', () => {
  // Task 6. 10 enter and exit cycles of HackScene after 4 warm-up entries, in both frame modes: textures, buffers, programs, VAOs and framebuffers return to the baseline,
  // hostsCreated stays { shared: 1, private: 0 } in the shared mode, the JS heap after a forced collection grows by at most 5%. CONTROL: a deliberate leak of 6 textures shows +6.
  test.fixme('10 cycles in shared-context: GPU counts back to the baseline, one host, heap within 5%', async () => {});
  test.fixme('10 cycles in canvas-copy: GPU counts back to the baseline', async () => {});
});

test.describe('the hand-off canary and the hidden scene on the game page (pass lines 10 and 11)', () => {
  // Task 6. A filtered container with a transparent gap over the running HackScene shows the 3D picture through the gap. CONTROL: the lab case with the clean-up off still fails.
  test.fixme('a filtered container with a gap over a running HackScene shows the 3D picture', async () => {});

  // Task 5 (the fix in SceneManager.prerender) and task 6 (the test scene). A test scene closes itself inside its own prerender; the scene under it is a HackScene that was hidden
  // while its sim ran on: the first frame after the reveal equals a fresh render and differs from the picture before the hide. CONTROL: a mutant prerender with no second pass fails.
  test.fixme('a cover that closes inside its own prerender: the HackScene under it shows a fresh frame at once, not a stale one', async () => {});
});

test.describe('determinism, pixels and colors at 640x360 (pass lines 12 and 13)', () => {
  // Task 6. The same tick count gives the same pixel hash on two loads; 1 x 333, 333 x 1 and 3 x 111 ticks give the same hash. CONTROL: a different seed gives a different hash.
  test.fixme('the same tick count gives the same picture on two loads, however the ticks are split', async () => {});

  // Task 6. HUD panels and text equal a Canvas 2D drawing (0 differing pixels); HUD text 7:1 against its panel; every k-by-k block is one flat color at DPR 1 and 1.5 with the HUD
  // over the 3D; a Three color #ff2080 reaches the screen as written. CONTROL: a wrong scale finds uneven blocks.
  test.fixme('the HUD equals a Canvas 2D drawing, with 7:1 text and crisp blocks at DPR 1 and 1.5', async () => {});
  test.fixme('a Three color #ff2080 reaches the screen unchanged', async () => {});
});
