---
type: plan
title: "Shadow Jog Engine — M7 build brief"
project: shadow-jog
created: 2026-10-12
updated: 2026-10-12
status: draft, decisions open
tags: [engine, m7, plan, 3d]
---

# M7 3D mode: build brief

Source: [migration.md](migration.md) "M7 3D mode" and principles 8, 11 and 12, [m1b-brief.md](m1b-brief.md) (the 3D proof and its item 6), [frame-and-rendering.md](frame-and-rendering.md) sections 7.2 to 7.4, [interfaces.md](interfaces.md) section 12, [decisions.md](decisions.md) (E3, E17, E19, C2, C5, C12 at line 84) and [README.md](README.md) line 44 (C4), `docs/IDEAS.md` entry 2, [m6-brief.md](m6-brief.md) (format), and the lean loop in `CLAUDE.md`. Branch: `engine-m7-3d-mode` (from `main` at 86ec305, after PR #76). Pass lines come first in value: they were written before any task. **Nothing is built until Mark approves this brief and answers the decisions of section 3.**

Facts in section 2 come from a read-only survey on 2026-10-12 ([m7-survey.md](m7-survey.md); grep, reads of the Phase 0 branch, and `npm run budget`). Task 1 re-checks the facts that carry risk.

## 1. Goal

- A story script can `await s.hack(...)` in the shipped game build. The call starts the real `Scene3D` on the real loop with the Phase 0 test scene (`HackScene` and its pure sim), and the script gets a result back. The call never hangs.
- The 3D code stays in one lazy chunk (`lazy-3d`, cap 160 kB gzip, C5). A player who never hacks never downloads it.
- Every end of a hack is a value: `success`, `fail`, `aborted` (`context-lost`, `user`, `error`) or `unsupported` (`no-webgl2`, `chunk-failed`). The story policy of E19 applies, with `via: 'dropped'` for a dropped story.
- The hidden-scene 3D draw skip is proved with no stale frame. The context grace is decided against a real context loss.
- Not in M7: the real hacking scene (its design, input, gameplay and look are a separate iteration, `docs/IDEAS.md` entry 2), the look of the Phase 0 scene, a hack in Chapter 1 (unless Mark picks D1 option C), deleting `src/engine` (M8), M4 scenes, the other editors (ET).
- Exit check (migration.md): the 10-cycle leak test, the context-loss test and the canary tests pass. After the flip, `unsupported` shows only when the 3D chunk fails to load. On a path with no WebGL 2, `s.hack` returns `unsupported` with reason `no-webgl2` (moved here from M1b, [m1b-brief.md](m1b-brief.md) item 6).

## 2. Survey facts that change the plan

- **The draw skip is built; one gap is left.** `SceneManager.prerender()` computes visibility first and skips hidden scenes, so a hidden `Scene3D` does not draw. migration.md says the opposite. The gap: the second `refreshLayout()` at the end of `prerender()` reveals the scene under a scene that closed inside its own `prerender` (a `Scene3D` that lost its context does). The revealed scene shows a stale texture for one frame. Survey section 5.
- **The grace is not built.** M1b built `Scene3D` to end at the first draw after a loss. The 1 s grace of C4 exists only on the spike branch. The `lost` flag never clears and `gpuReleased` never resets. Survey section 6.
- **`src/hack3d/` does not exist, and game code cannot import it.** `tests/sje-imports.test.ts:159` forbids it. M7 adds one seam file and widens the rule for that file alone. Survey section 4.
- **The spike `HackScene` does not fit today's `Scene3D`.** It uses `threeScene`, `camera`, `createHud()`, `dispose3D()` and `started`. The built class has `world3D`, `camera3D` and no hooks. The HUD layout is for 270 px height. Survey section 3.
- **After M6 a booted game always has WebGL 2.** The `no-webgl2` result can only come from the door with an injected probe (`DoorEnv`). The probe keeps its context once it succeeds, so a test cannot patch it in a booted page. Survey section 4.
- **The budget has no room, and one rule fails.** Total 451.9 of 452 kB, first play 391.6 of 392.4 kB. Check 2 of `scripts/bundle-budget.mjs` fails on any Three module in the game build. Check 3 (480 kB raw) fails for a 3D chunk: the lab's is 554.2 kB raw, 137.8 kB gzip. Expected game `lazy-3d`: 143 to 146 kB gzip. Survey section 7.
- **No prod test hook exists.** `__SJ__` is DEV only and `prod.spec.ts:49` asserts it is absent. A prod test can load the hashed chunk and watch requests, not run a hack. Survey section 8.
- **`ScriptApi` is one object** (`src/scenes/fieldkit/api.ts`, `battle` at line 61). `hack` follows `battle` and `shop` through `fieldHooks`. Chapter 1 has no hack beat.
- **Contradiction 1:** interfaces.md types `ScriptApi.hack` as `Promise<HackResult>`, and builds a story loop that returns `HackOutcome`. See D4.
- **Contradiction 2:** migration.md and frame-and-rendering.md 7.4 say the no-WebGL 2 check runs "on the legacy path". The legacy path is gone since M6. The check runs on the door seam (pass line 6).
- **Carry items:** `scripts/sjestage-refs.mjs:57` is stale (the crew moved to `public/art/crew/`). The `Date.now()` in `sje-battle.spec.ts` is a polling bound, not a seed. Neither is on the M7 path. They stay open.

**Decided by the session** (small choices, no decision for Mark):

- A hack definition is plain data in `src/data/hacks.json`, checked by `checkHacks` (the condition of E3). Fields: `id`, `seed`, `ticks`, `iceCount`, `traceLimit`, `hitCost`, optional `policy`. The file is new, so principle 8 holds. Approving this brief approves the format.
- One seam file, `src/game/hackseam.ts`, imports `src/hack3d/door.ts` and `result.ts` only. The import test allows that file and nothing else.
- `Scene3D` gets an option `contextGraceMs` (default 1000), two optional hooks (`createHud`, `dispose3D`, as the Phase 0 sketch had them), and a restore path that clears `lost` and `gpuReleased`.
- The HUD stays (it proves 2D over 3D on the real engine) and its layout derives from `H`. The camera does not change.
- The test scene has no input and no quit key. It runs on autopilot for `ticks` ticks. The real hacking iteration adds input.
- No preload of the 3D chunk. The door fetches it at the first hack. No shipped hack exists to warm for.
- One definition of `HackResult` stays. Task 3 picks the file and makes the other a type re-export.
- The `lazy-3d` class is exempt from the 480 kB raw chunk cap and gets its own raw cap of measured plus 5%. Three is one module graph and the build rules forbid named groups.
- The new game-page spec is `e2e/sje-hack.spec.ts`, in shard 6/8 (349 s, the smallest measured). The prod chunk-load case goes into `prod.spec.ts`, so WebKit runs it and Firefox skips it by `browserName` (no WebGL 2 on CI Firefox).
- The sim keeps ticking while a cover hides it. No cover scene exists in M7.
- `colorprobe.ts` is not ported. The lab canary covers exact colors.

## 3. Open decisions for Mark (recommendation first; the build uses it unless Mark says otherwise)

Raised as decision issues: D1 [#77](https://github.com/markhazlewood42/shadow-jog/issues/77), D2 [#78](https://github.com/markhazlewood42/shadow-jog/issues/78), D4 [#79](https://github.com/markhazlewood42/shadow-jog/issues/79). D3 keeps the approved C4 (1 s), so the session decides it with A; Mark can still overrule it.

D1. **How does the game reach 3D in M7?**
- A (recommended). A DEV entry only: a `?scene=hack` route and a `__SJ__.hack` hook, plus test scripts that call `s.hack` through the real field script runner. Chapter 1 does not change. The 3D chunk ships in the build and a prod spec proves it loads. Consequence: no player sees the test scene. A prod run of a hack waits for the real hacking iteration.
- B. A, plus a hidden URL flag in the shipped build that runs a hack. Consequence: prod can run a hack in a test, and any player can open an unreviewed test scene.
- C. Wire a hack beat into Chapter 1 now. Consequence: players meet a 15 s scene with no input and an unreviewed look, and the story needs a design that does not exist (`docs/IDEAS.md` entry 2).

D2. **Budget re-set (E17, Mark's one-bigger-total rule).**
- A. Count the 3D chunk in the total: total about 599 kB (451.9 + about 145 + about 1.5), first play about 394 kB. Consequence: the total gates a chunk that no one downloads until a hack.
- B (recommended). The total excludes `lazy-3d`, and `bundle-budget.mjs` gets a new `lazy-3d` check for the game build (today the 160 kB check runs only for the lab): total 454 kB (451.9 plus about 1.5 for the door, rounded up to the next 1 kB), first play measured plus 1 kB (about 394 kB), `lazy-3d` 160 kB (C5, confirmed; expected 143 to 146 kB). Consequence: the everyday alarm stays sharp, as it did when the stages were a separate class, and the 3D chunk has its own cap. The numbers are set from the first build, not from this estimate.
- C. Keep the 3D chunk out of the production build until a real hack ships (DEV only). Consequence: no re-set now, but the prod path of the chunk (hashed name, base path) is untested until later.

D3. **The context grace of the watchdog (C4).**
- A (recommended). Keep 1 s, as a named option. A context that returns between 1 and 2 s is given up on, and E19 retries once, then auto-succeeds. Consequence: the research line "resolves within 2 seconds of the loss" holds (1,015 to 1,034 ms measured). A real loss test in the real game confirms or changes it.
- B. 2 s, and move the line to 3 s. Consequence: more lost contexts recover without a retry, and every dead context holds the player 1 s longer.
- C. No grace (the code as M1b built it). Consequence: the shortest wait, and a loss of 50 ms ends the hack and costs a retry.

D4. **What does `s.hack` return?**
- A (recommended). **This changes an approved interface and needs Mark's explicit yes:** interfaces.md section 12 approves `hack(def: HackDef): Promise<HackResult>`, and B is that sketch. `s.hack(def, playAlternative?)` returns a `HackOutcome` (`outcome`, `via`, `results`) with the E19 policy applied. `via: 'dropped'` means the story must end. Consequence: one place applies the policy, and no story repeats it. interfaces.md section 12 is updated.
- B. `s.hack(def)` returns the raw `HackResult` (the approved sketch, no change to the interface). Each story runs the policy through a helper. Consequence: a story that forgets `dropped` hangs on a dead stack.
- C. Both: `s.hack` raw and `s.hackPlay` with policy. Consequence: two entry points to keep true.

## 4. Hard pass lines

1. `npm run check` exits 0 (judge by exit code).
2. **Result contract.** `npx vitest run tests/hack3d-result.test.ts tests/hack3d-door.test.ts` exits 0. The door never rejects. Cases: `success`, `fail`, `aborted` with each reason, `unsupported / no-webgl2` (the chunk loader is never called), `unsupported / chunk-failed`, a context already lost (`aborted / context-lost` at once), a drop during the chunk load (`aborted / user`, no scene started). `decideHack` covers the full policy table: only `context-lost` retries once, `user` never retries, `error` never retries, `dropped` ends. **Control:** a mutant door that rethrows a chunk error fails the suite.
3. **Hacks are data.** `npx vitest run tests/hack3d-data.test.ts` exits 0: `src/data/hacks.json` passes `checkHacks`, a JSON round trip is equal, and `checkHacks` rejects a function, `NaN`, a negative count and an unknown key. The test scene reads its definition from the file. `grep -rn "makeHackDef" src` prints only the data loader. **Control:** a definition with a function field fails.
4. **The story bridge on the real loop.** `npx playwright test e2e/sje-hack.spec.ts --reporter=line` exits 0 with these cases on the game page: a script says a 2D line, awaits the hack, says a 2D line (the story continues with the result, and after the hack the same 2D scene is back with its state unchanged: the transition from 2D to 3D and back), once for `success` and once for `fail` (a low `traceLimit`). The 3D picture is non-blank and a HUD panel is on screen. 0 GL errors, 0 console errors and warnings. **Control:** a script that does not await the hack shows its second line before the hack ends.
5. **A dropped story ends.** In the same spec: `game.abandon()` and `game.reset()` in the middle of a hack each give `outcome: 'fail'`, `via: 'dropped'`, one hack started, no retry, no second scene, and the result arrives within 1 s. **Control:** the default policy on a context loss does retry (so the case can tell a drop from a loss).
6. **Exit check: no WebGL 2, and a chunk that fails.** In the same spec: the door with an injected probe that returns `false` gives `unsupported / no-webgl2` in under 500 ms, makes 0 requests for the 3D chunk, and the story plays its 2D alternative. A booted game that has WebGL 2 never gives `no-webgl2`. With the chunk request aborted (`page.route`), the result is `unsupported / chunk-failed`, the story continues, and the page logs one console error from the door only. **Controls:** probe `true` gives no `unsupported`; the same route left open gives a played hack.
7. **Context lost for good.** The context is lost in the middle of a hack and not restored: the hack resolves `aborted / context-lost` at most 2,000 ms after the loss (page clock, from `loseContext()` to the result; expected 1,000 to 1,100 ms with D3 option A), in both frame modes (`shared-context`, `canvas-copy`). 0 console errors. The default policy retries once, the retry ends at once, and the story gets `success`. **Control:** with `contextGraceMs: 2500` the same case fails the 2 s line.
8. **Context back in time, and late.** Restore at 500 ms: the scene carries on, and its picture at tick N has the same hash as a run with no loss; 0 console warnings. Restore at 1,500 ms (after the grace): the result was already `aborted / context-lost`, the restore throws and warns nothing, and a new hack started after the restore draws the same hash as a fresh page at the same tick. **Control:** a build that skips the rewrap shows a stale picture (the existing canary case, re-run on the game page).
9. **Leak.** 10 enter and exit cycles of `HackScene` on the game page, after 4 warm-up entries, in both frame modes: counts of textures, buffers, programs, VAOs and framebuffers return to the baseline, `hostsCreated` stays `{ shared: 1, private: 0 }` in the shared mode, and the JS heap after a forced collection grows by at most 5%. **Control:** a deliberate leak of 6 textures shows +6.
10. **Canaries.** `npx playwright test e2e/sje-canaries.spec.ts e2e/sje-scene3d.spec.ts --reporter=line` exits 0 (the lab, unchanged in meaning; the context-loss case of `sje-scene3d` is updated for the grace). One new case on the game page: a filtered container with a transparent gap over the running `HackScene` shows the 3D picture through the gap. **Control:** the existing negative case in `sje-canaries` still fails when the hand-off clean-up is off.
11. **Hidden scenes draw no 3D frame, and none is stale.** `npx vitest run tests/sje-scene3d.test.ts tests/sje-runtime.test.ts` exits 0 with new cases on a fake frame: a `Scene3D` under an opaque scene calls `frame.render` 0 times over 30 draws; when the cover closes in a tick, the first drawn frame renders before Pixi draws; when the cover closes **inside its own `prerender`**, the scene under it renders in that same frame (the second pass). On the game page, a pixel case uses a test scene that closes itself inside its own `prerender` (the trigger is the closed-self check at `scenemanager.ts:432`, inside `430-435`; a cover that closes in a tick is caught by the first `refreshLayout()` and cannot fail the mutant). The scene under it is a `HackScene` that was hidden while its sim ran on: the first frame after the reveal equals a fresh render and differs from the picture before the hide. **Control:** a mutant `prerender()` with no second pass fails both the unit case and the pixel case.
12. **Determinism and state.** In the game: the same tick count gives the same pixel hash on two page loads, and 1 x 333, 333 x 1 and 3 x 111 ticks give the same hash. `HackSim` gives the same state hash after 2,000 ticks at 60, 144 and 30 Hz and with hitches (T0). `snapshot()` at tick 300, `restore()` into a new sim, then 600 ticks equals 900 straight ticks. **Control:** a different seed gives a different hash.
13. **Pixels and colors at 640x360.** The HUD panels and text equal a Canvas 2D drawing with 0 differing pixels. HUD text has a contrast of at least 7:1 against its panel. Every k-by-k block is one flat color at device pixel ratio 1 and 1.5 with the HUD over the 3D. A Three color `#ff2080` reaches the screen as written. **Control:** a wrong scale finds uneven blocks (the existing crisp control).
14. **Bundle.** `npm run budget` exits 0 with the caps of D2. The game build has a `lazy-3d` chunk that holds Three, and no other chunk holds Three. `boot` and `first play` hold no Three. `grep -n "import(" src/hack3d/door.ts` shows one dynamic import of the chunk. A normal run in `e2e/default-path.spec.ts` (title, field, battle, Options) makes 0 requests for the 3D chunk. The new `prod.spec.ts` case loads the hashed chunk from the preview server by its manifest name (WebKit and Chromium; Firefox skips). **Controls:** a static `import 'three'` in `src/hack3d/door.ts` fails the budget (run once, revert); a wrong chunk name makes the `import()` reject.
15. **The 2D game is unchanged.** `npx playwright test e2e/playthrough.spec.ts e2e/chaos.spec.ts e2e/default-path.spec.ts e2e/gameover.spec.ts --reporter=line` exits 0 and `git diff --stat main...HEAD -- tests/fixtures` shows no change. `git diff --stat main...HEAD -- src/field src/battle src/art src/story src/scenes/field.ts src/scenes/battle.ts` is empty, and `src/data` changes only by `hacks.json`.
16. **Imports.** `npx vitest run tests/sje-imports.test.ts` exits 0: Three is imported only under `src/sje/three` and `src/hack3d`; `src/hack3d/door.ts` and `result.ts` import no Three; `src/hack3d/sim` imports nothing from `src/engine`; `src/game/hackseam.ts` is the only game file that imports `hack3d`; `src/hack3d/index.ts` is reached only by the door's dynamic import. `tests/screen-literals.test.ts` passes. **Control:** the existing negative cases.
17. **GPU run, once, at the end (principle 12), by the main session:** `npm run perf` with a new game-page case (the running `HackScene` with bloom and the HUD). Interval p95 within 5% of the bare page, cost p95 at most 8 ms. The 2D, live-battle and field cases still pass their lines. A negative control (extra 3D frames per frame) fails both rules. The cold and warm first-entry times are recorded, not gated. Numbers go in `tooling-and-testing.md` section 7.
18. **Docs and CI.** `CHANGELOG.md`, `GLOSSARY.md` (hack definition, door, outcome, grace, seam), `interfaces.md` section 12 (the D4 shape and the built shape), `frame-and-rendering.md` 7.4 (the grace result, and the "legacy path" sentence), `tooling-and-testing.md` sections 7 and 10, `docs/CI.md` and `ci.yml` (the spec in shard 6/8), and the record table below are filled. `npx vitest run tests/ci-shards.test.ts` exits 0.
19. **Playable checkpoint (Mark).** After the last fix round, the main session gives the DEV URL of the hack scene, the pictures in `media/m7-3d/` (the look is evidence, not graded) and the perf numbers. Mark merges or names fixes.

## 5. Tasks, in build order

1. **Survey, then record.** `docs/engine/m7-survey.md`: re-check sections 1, 5, 6 and 7 with runs. Write the stale-frame case as a failing test. Run the budget with a stub door. Compile the spike `HackScene` against today's `Scene3D` and list the errors.
2. **Specs first.** Port `hack3d-{result,sim,hud,dispose}` tests and add `hack3d-door`, `hack3d-data`, the hidden-scene cases and the grace cases (fake timers). Write the skeleton of `e2e/sje-hack.spec.ts` from the spike cases (story bridge, fallback, lifetime). Run them red.
3. **Data and the story side.** `src/hack3d/{result,door}.ts`, `src/hack3d/sim` (with `snapshot`/`restore`, `Rng` from the facade), `src/data/hacks.json` and `checkHacks`, `src/game/hackseam.ts`, `ScriptApi.hack` (shape per D4), `fieldHooks.hack`, the binding in `src/game/systems.ts`, the import-test seam. Pick the one `HackResult` file.
4. **The scene.** `Scene3D`: `contextGraceMs`, the restore path, `createHud` and `dispose3D` hooks (per D3). `HackScene`, `look`, `hud` (layout from `H`), `startHack` on today's class.
5. **Hidden skip.** `SceneManager.prerender()` runs the `prerender` of a scene that the second `refreshLayout()` revealed. Unit and pixel cases of pass line 11.
6. **Entry points (per D1).** `?scene=hack` route and `__SJ__.hack(id, opts)` in DEV. The game-page cases of lines 4 to 13.
7. **Budget, CI and prod.** `scripts/bundle-budget.mjs`: check 2 inverted, check 3 split by class, caps per D2 with a dated comment. `ci.yml` and `docs/CI.md`. The `prod.spec.ts` chunk case and the `default-path.spec.ts` request assertion.
8. **Perf case and docs.** The game-page 3D case in `perf.spec.ts`. Docs of pass line 18. Carry items stay open unless the diff touches them.

## 6. Editor contract (principle 11)

(a) A hack's tunables are the fields of `HackDef` in `src/data/hacks.json`, documented in `checkHacks`. The grace is the engine option `contextGraceMs`. The bloom values and the look constants stay in code: the real hacking scene replaces the look, and no tool drives it now. (b) The file loads and saves through `checkHacks`, with a round-trip test. (c) A definition is read when a hack starts, so `__SJ__.hack(id)` picks up an edited file after a dev reload. A running hack does not swap. (d) `HackSim.snapshot()` and `restore()` are new; the look is derived from the sim, so the scene needs none. (e) `HackSim.step()` runs one tick, and `__SJ__.step(n)` drives the scene on the real loop. Control: pass line 12 (snapshot, restore and equal state) and line 3 (a bad file is rejected).

## 7. Verifier plan (lean loop)

| Agent | Model, effort | Job |
|---|---|---|
| Builder A | sonnet, high | Tasks 1 to 4 (survey, specs, data and story side, the scene). |
| Builder B | sonnet, high | Tasks 5 to 8 (hidden skip, entry points, budget, CI, prod, perf case, docs). Starts after A is committed. |
| Runner | sonnet, medium | Pass lines 1 to 16 and 18. Runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 11, 15 and 16; the dispose order and the `finally` that settles a dropped hack; no vacuous test; the controls really fail. |

- Every builder prompt: no `Co-Authored-By` line and no `Claude-Session` trailer in any commit. Every agent call sets `effort`.
- Pass: every line holds, no Critical or Important finding open. A Minor finding is a named fix. A fix round: one fresh verifier checks only the named findings. Cap 3 rounds.
- No attacker: M7 changes no write path, no trust rule and no save format. A hack result is not saved. A story can store it in a flag, and M7 adds no such script.
- Perf (line 17) is run by the main session after the last fix round, on the real GPU, never in CI.

## 8. Risks

- **Budget:** the first build decides the real numbers. The estimates (D2) can be off by a few kB. Three is one chunk, so it cannot be cut by splitting.
- **The spike scene is old code.** It was written for a 270 px picture and for a `Scene3D` that has changed. Expect more rework than a copy. Task 1 lists the errors first.
- **A restore path in `Scene3D`** touches the shared context, `releaseGpuData` and Three's own restore handler. The order is fragile (frame-and-rendering.md 7.2, rule 3). Pass line 8 guards it.
- **Browsers:** the game-page 3D cases run on Chromium with SwiftShader only. WebKit runs the chunk load case in `prod.spec.ts`. CI Firefox has no WebGL 2. A WebKit-only fault in a running hack stays unseen until the real hack iteration.
- **Hidden sim:** `update3D` keeps running under an opaque cover. No M7 scene covers a hack. The real iteration decides the pause rule.
- **Conflicts** in `CHANGELOG.md` and `docs/roadmap/roadmap.json`. Keep edits small. Merge `main` before each commit. `status.md` changes only by a PR to `main`.
- **Scope creep:** input, sound, a real look, a Chapter 1 beat, a preload.

## 9. Record

| Step | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Brief | this file and `m7-survey.md`. Decisions D1 to D4 open | — | draft | — |
| A: task 1 | | | | |
| A: tasks 2 to 4 | | | | |
| B: tasks 5 to 8 | | | | |
| Runner | pass lines 1 to 16 and 18 | — | — | — |
| Reader | diff read | — | — | — |
| Pass line 17 (GPU run) | `npm run perf` on the real GPU, numbers in `tooling-and-testing.md` section 7 | | | |
| Open | Line 19, Mark's checkpoint | pictures in `media/m7-3d/` | waiting | |
