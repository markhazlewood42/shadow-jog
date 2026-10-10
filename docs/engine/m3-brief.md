---
type: plan
title: "Shadow Jog Engine — M3 build brief"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m3, plan, battle-stage]
---

# M3 Battle stage: build brief

Source: [migration.md](migration.md) "M3 Battle stage", [scene-graph.md](scene-graph.md) sections 5 and 7, [interfaces.md](interfaces.md), [tooling-and-testing.md](tooling-and-testing.md) section 5, [m2-brief.md](m2-brief.md) (format; the `FxSystem` this builds on), `docs/spikes/side-battle-stage.md` (the stage design), and the lean loop in `CLAUDE.md`. Branch: `engine-m3-battle-stage` (from `main` after PR #48), in its own worktree, next to M1b. Pass lines were written before any code. **Nothing is built until Mark approves this brief.**

Spike code is read from the archive tags, never merged: `archive/phaser-stage-2026-10-09` (`src/stage`, 57 files; Battle Stage Editor in `src/stage/edit/`, Battle Test in `battletest.ts`), `archive/engine-platform-2026-10-09` (`src/battlestage`, 22 files: `figure.ts`, `textures.ts`, `config.ts`; parity in `e2e/sjestageparity.ts`, `tests/sjestage-parity.test.ts`, `scripts/stage-data-parity.mjs`).

## 1. Goal

- Under `?engine=sje`, the battle plays on a Pixi stage: backdrop, floor, `Figure`s with shadows, the battle HUD, and the `battle/fx.ts` painters, all driven by today's `battle.ts` through `PlaybackView`.
- The battle rules (`src/battle/engine.ts`, `ai.ts`) do not change. A scripted run with seed 7 gives the same status trace as the legacy path.
- The default path (no flag) does not change in behavior.
- Not in M3: the Battle Stage Editor and Battle Test **port** (milestone ET, principle 11; M3 only builds the data and contract they will need), UI scenes (M4), the field (M5), 3D (M7), `TextObject` (M4, E14), `pixi-filters`.
- Exit check (migration.md): a scripted Battle Test (seed 7) with an identical status trace, pixel parity within a tolerance Mark agrees, and Mark's look review of the pictures.

## 2. Survey facts that change the plan

- migration.md says "about 3,400 lines call Phaser". The survey counts about 4,440 lines in 9 files of `src/stage` that import Phaser (`stagescene`, `stageedit`, `hud`, `textures`, `hudkit`, `livefx`, `boot`, `labhook`, `stills`). About 5,000 lines of `src/stage` are pure logic. The editor (`edit/*`, about 5,000 lines) is **not** ported in M3.
- `src/battlestage` (Phase 0) already holds the Pixi slice: `figure.ts` (282), `stagescene.ts` (243), `textures.ts` (556), the pure files copied from the spike. It has **no HUD and no `PlaybackView`**. The HUD (`src/stage/hud.ts`, 657 lines, Phaser) is a real port.
- `src/data/enemies.ts` has 21 enemies, 4 bosses, and about 25 encounter groups. It has **no** picture, mirror or axis field. Those live in the stage JSONs (`enemyfacing`, `axes`). The data-file move has to merge both.
- Stage configs: two stages (`street`, `sewer`), 350 lines each, in 480x270 numbers.
- `src/engine/font.ts` (400 lines) has about 35 importers. Moving it into `src/sje` means a re-export from the old path, not 35 edits.

## 3. Open decisions for Mark (recommendation first; the build uses it unless Mark says otherwise)

1. **How parity is measured at 640x360.** The Phaser spike cannot be the reference (it has no 640x360 stage). Recommend two checks. (a) **Regression parity:** lay the stage out at 480x270 numbers in a 640x360 frame, as Phase 0 did, and require 0 differing pixels against the existing `gpu`/`soft` goldens at 3 frames, then all stages. This proves the port is faithful. (b) **New layout:** the 640x360 layout is judged by Mark from pictures, then pinned as new goldens (`gpu` and `soft`). No numeric gate on the new look.
2. **World layer reach (240x135 became 320x180).** Recommend the Phase 0 way: bake at 2x on a canvas, as the spike does. `setGrain(2)` stays unbuilt (no caller needs it; principle 6).
3. **Battle push camera (up to 1.09x).** Neither rounding setting keeps one pixel grid at 1.09x. Recommend: keep 1.09x and accept the measured uneven texels (99 px on GPU, 128 on SwiftShader). Mark sees the push in the pictures and decides. A pixel-clean push needs a different zoom (whole-pixel steps) and a retimed move. That is a look change, so it waits for his word.
4. **Stage data at 640x360.** Principle 8 forbids a silent change. Recommend: the 480x270 stage JSONs stay byte for byte as the source. A new `stages-640` set is written by a documented script (`scripts/stage-640.mjs`, a fixed transform: center the 480x270 layout, add the extra 160 px of floor and sky as the config defines), then Mark reviews the pictures and edits values where he wants.
5. **Enemy and troop data format.** Recommend one JSON file per kind: `src/data/enemies.json` (the 21 `E()` records plus `picture`, `mirror`, `axis`) and `src/data/encounters.json` (the groups), read by a typed loader with a `check` function (like `checkFx`). `enemies.ts` becomes the loader. A parity test proves the loaded objects equal today's objects (deep equal). Mark approves the shape before Builder C starts (Task 8).
6. **One `Raw` type.** Recommend the engine's `{ w, h, data }`. The stage's `{ w, h, px }` is renamed at the boundary in the spike files that move.

## 4. Tasks, in build order

1. **Survey the callers.** List what `battle.ts` and `battlekit/*` call on the renderer, `FxLayer` and `PlaybackView`. List every `Figure` input. Put the lists in the builder report.
2. **TextureManager.** Move `addCanvasOnce` and `variantOf` into the engine `TextureManager`; add `readPixels(key)`; use one `Raw` type. `src/battlestage/textures.ts` shrinks to game-side calls.
3. **Config.** `config.ts` uses the engine `depthFor`; the Phase 0 pin test now asserts one function. Move `src/engine/font.ts` into `src/sje` with a re-export at the old path.
4. **Figure and scene.** Promote `src/battlestage` to the shipped `BattleStageScene` (backdrop, floor, `Figure`, shadows, depth, flip, camera push) on the M1 scene runtime. Its data comes from the stage JSON.
5. **HUD.** Port `Hud` (turn timeline, party table, target box, damage numbers, banner) to Pixi objects. Text uses the old game font through a canvas painter until M4's `TextObject`. Layout reads `HudLayout`; presets stay data.
6. **PlaybackView and fx.** `battle.ts` drives the stage through `PlaybackView`. Port the `battle/fx.ts` painters (1,208 lines, Canvas 2D) to `CanvasImage` painters or `FxSystem` calls. `FxLayer`'s method signatures do not change.
7. **Battle Test seam (not the editor).** A headless battle driver (the spike's `battleflow.ts` logic, pure) runs a seeded battle and returns a status trace. The DEV hook exposes it. The editor port is milestone ET.
8. **Enemy data move.** Decision 5. Loader, `check`, deep-equal test.
9. **640x360 layout.** Decision 4: script, new stage JSONs, pictures.
10. **Parity harness.** Port `e2e/sjestageparity.ts` and the fixtures. Part (a) of decision 1 in CI (`gpu` and `soft` sets, strict compare with the renderer mask). Part (b) pictures are local.
11. **Routing, DEV hook, docs.** Under the flag the battle scene is the new one. DEV hook: `stage` (figures, depths, camera), `battleTrace(seed)`. `CHANGELOG.md`; `GLOSSARY.md` and `CONCEPTS.md` (Figure, depth, push camera, parity); `DEVELOPING.md` recipe; `.claude/skills/engine/SKILL.md`; `tooling-and-testing.md` (section 5 parity method, section 7 costs); `frame-and-rendering.md`.
12. **CI.** Add the new specs to the `e2e` job. Pictures and the GPU run stay local.

## 5. Editor contract (principle 11)

M3 does not port the editor, but it must not make it harder. (a) Every stage value an editor changes (positions, rows, shadows, HUD layout, facing, axes) is in the stage JSON or the enemy file, with a `check` function. (b) `BattleStageScene.loadStage(config)` swaps a config in a running scene and rejects bad data (control: bad data leaves the old stage). (c) `snapshot()` / `restore()` of the scene state as plain JSON, and `step(n)` on the headless driver. (d) No Pixi object leaves the scene. (e) What stays in code on purpose, because it is the form and not the tuning: the depth formula, the flip rule, the contact-shadow shape.

## 6. Hard pass lines

1. `npm run check` exits 0 (judge by exit code).
2. `npx vitest run tests/battlestage*.test.ts tests/sjestage-parity.test.ts tests/enemies-data.test.ts tests/balance.test.ts tests/economy.test.ts` exits 0. The enemy and encounter objects loaded from JSON deep-equal the old `enemies.ts` objects (control: one changed field fails).
3. **Status trace.** The Battle Test driver with seed 7 gives a trace byte-identical to the legacy path for the scripted battle (street and sewer). Control: seed 8 differs.
4. **Regression parity.** `npx playwright test e2e/sje-stage-parity.spec.ts --reporter=line` exits 0 on SwiftShader: 0 pixels outside the renderer mask, at most 1/255 inside it, at 3 frames then all stages. Controls: a 2/255 step fails; a one-pixel shadow move fails.
5. No mixed block at device pixel ratio 1 and 1.5 on the new stage with the full effect stack (0 uneven k-by-k blocks).
6. Battle plays end to end under the flag: `npx playwright test e2e/sje-battle.spec.ts --reporter=line` runs a win, a loss, a flee and a boss intro; it reads `__SJ__` for the state and checks the HUD pixels. 0 GL errors and 0 console warnings.
7. Default path unchanged: `npx playwright test e2e/playthrough.spec.ts e2e/prod.spec.ts e2e/battle*.spec.ts --reporter=line` exits 0. `__SJ__` stays absent in production.
8. `git diff --stat main...HEAD -- src/battle/engine.ts src/battle/ai.ts src/battle/types.ts src/data/abilities.ts src/data/party.ts src/data/fx.json` is empty (principle 8). `enemies.ts` changes only as the loader. The 480x270 stage JSONs are byte for byte unchanged.
9. `npm run budget` exits 0. The `boot` class holds no `pixi.js` module. At the end, set `GZIP_TOTAL_MAX` to the measured total rounded up to the next 1 kB, with a dated comment (Mark's one-bigger-total rule).
10. `npx playwright test e2e/sje-canaries.spec.ts e2e/sje-draws.spec.ts e2e/sje-shell.spec.ts e2e/sje-fx.spec.ts --reporter=line` exits 0. `sje-draws` gets a battle-frame case (draw calls and binds as an upper bound). The leak test is flat across 10 battle enter and exit cycles.
11. Imports: `pixi.js` only in `src/sje/*`, `src/battlestage`, `src/sje-lab`. `tests/sje-imports.test.ts` updated and passing. No non-null `!` in `src/sje/` or `src/battle/`. `tests/screen-literals.test.ts` passes (the 640x360 layout reads `W` and `H`, or the stage JSON).
12. `tests/sje-stage-contract.test.ts` proves section 5: `check` rejects bad data and `loadStage` keeps the old stage; `restore(snapshot())` gives the same frame hash; `step(n)` equals n ticks. The reader checks no look constant hides in code outside the stage data.
13. **Pictures for Mark** (evidence, not a gate): `media/m3-stage/` holds old against new for intro, command, attack, spell, crit, victory and a boss, at 480x270-in-640x360 and at the new 640x360 layout, `gpu` set.
14. **GPU run, once, at the end (principle 12), by the main session:** `npm run perf`. Frame interval p95 within 5% of the bare page with a battle on; cost p95 at most 8 ms. Numbers go in `tooling-and-testing.md` section 7.
15. `CHANGELOG.md`, `GLOSSARY.md` and the record table below are filled.
16. **Playable checkpoints (Mark).** *Checkpoint 1, after Builder B (before round 1):* `http://localhost:3007/?engine=sje` plays battles with every effect; the main session starts the server and gives the URL. A look change Mark asks for is a named fix and does not count against the 3-round cap. *Checkpoint 2, after the last fix round:* same build, pictures (line 13) and perf numbers (line 14) ready; Mark merges or sends work back.

## 7. Verifier plan (lean loop)

| Agent | Model, effort | Job |
|---|---|---|
| Builder A | sonnet, high | Tasks 1 to 4, 10: textures, config, font, scene, parity harness. |
| Builder B | sonnet, high | Tasks 5 to 7: HUD, `PlaybackView`, fx painters, headless driver. Starts after A is committed. |
| Builder C | sonnet, high | Tasks 8, 9, 11, 12: enemy data (after Mark approves the shape), 640 layout, routing, docs, CI. |
| Runner | sonnet, medium | Pass lines 1 to 10 and 12. Re-runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 8, 11, 12; the HUD port against `hud.ts` (every element); the fx port against `fx.ts`; no vacuous test. |

- Every builder prompt: no `Co-Authored-By` line in any commit (repo rule over the harness reminder).
- Pass: every line holds, no Critical or Important finding open. Minor findings are named fixes. A fix round: one fresh verifier checks only the named findings. Cap 3 rounds, then Mark gets the evidence.
- No attacker: no write path, trust rule or save format changes. (The enemy JSON is read-only data.)
- Perf (line 14) is run by the main session after the last fix round.

## 8. Risks

- **HUD port size.** 657 lines of Phaser text and shapes; text stays on canvas painters until M4. Risk is layout drift; the pictures are the check.
- **`fx.ts` port.** 1,208 lines of Canvas 2D. Keeping `FxLayer`'s signatures keeps `battle.ts` unchanged.
- **Parity at the 1.09x push.** Uneven texels are known (decision 3). The regression parity frames avoid the push; the push gets its own picture pair.
- **Conflicts with the M1b branch:** `status.md`, `docs/roadmap/roadmap.json`, `CHANGELOG.md`. Keep edits small; merge `main` before each commit.
- **Scope creep:** editor, `TextObject`, field scenes. All stay out.

## 9. Record

| Step | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Brief | this file | — | decisions 1 to 6 approved by Mark with the recommendations, incl. enemy JSON shape (2026-10-09) | — |
| A: task 1 | `m3-survey.md`: what `battle.ts`, `FxLayer` and `PlaybackView` call; every `Figure` input; the coordinate trap | — | done | — |
| A: task 2 | `TextureManager.addCanvasOnce`, `variantOf`, `readPixels`; one `Raw` = `{ w, h, data }` (the stage's `px` is gone); `interfaces.md` synced | `tests/sje-textures.test.ts` 6 tests, haze test runs the real bake | done | — |
| A: task 3 | `config.ts` `depthFor` calls the engine's, `PART` is the engine's table (pin test now asserts one function); `src/engine/font.ts` moved to `src/sje/display/font.ts`, old path re-exports | `src/engine` diff: that one file; 9th file in the shipped-game import list | done | — |
| A: task 4 | `src/battlestage` promoted (from the archive tag: it was not on `main`); `BattleStageScene` gets `push`, `loadStage`, `snapshot`, `restore`, `setMarks`; `checkStageConfig`; `src/art/battlebg480.ts` keeps the 240x135 painters for the regression layout | `tests/sje-stage-contract.test.ts` 12 tests; push test in pixels (zoom 1.09, back to the plain frame) | done; `step(n)` is task 7 | — |
| A: task 10 | parity harness on the M1 runtime (`/sjestage.html`, `e2e/sje-stage-parity.spec.ts`); goldens now cover the sewer and its boss group; made from the Phaser tag with `scripts/sjestage-refs.mjs` (street goldens came out byte identical) | 7 frames x `gpu` and `soft`: 0 px differ at all, strict gate exact; controls: 2/255 step, 1-px shadow, ring, body moves all fail; 640x360 frame: 0 of 100,800 outside pixels are not the void | done | parity found one real difference (idle sway at tick 0), fixed in `refresh()` |
| A: pass line 5 | effect stack on the stage, dpr 1 and 1.5 | 0 uneven 3x3 blocks, control finds some | holds | — |
| A: pass line 10 | `sje-canaries`, `sje-draws`, `sje-shell`, `sje-fx`, `sje-stage-parity`, `playthrough` on SwiftShader | 104 passed, 7 skipped (Mark's art mode, not on CI), exit 0 | holds | — |
| A: battle frame, `sje-draws` | stage slice + five moments at `full`: draws 13, binds 17 (bare stage: 3 and 4); 10 enter and exit cycles leave GL counts flat; budgets 16 and 20 | SwiftShader and GPU agree | holds; Builder B re-measures with the HUD and fx painters | — |
| B: task 5 | HUD on the engine: `hud.ts`, `hudkit.ts` (text, windows, chips as canvas painters over the game font), `hudlayout`, `hudstatus`, `icons`, `combo`, `demo`, `faceTexture`; every region of the spike's `Hud` (timeline, party table, command strip, foe box, banner, combo, active tag, target label, low-health marks, damage numbers). Boxes are in the scene's `ui` layer, marks in the world. `menus: 'game'` leaves the strip to the old menus | 3 pure HUD test files ported from the Phaser tag: 44 tests | done | — |
| B: task 7 | `battledrive.ts`: `makeScript`, `applyEvent`, `Disp` from the spike; `BattleDrive.step(n)` on a fixed timetable; `battleTrace` (the driver) and `legacyTrace` (the engine called as `BattleScene.executeRound` calls it). DEV hook `battleTrace(seed, o)` and `battleStage` (not `stage`: `__SJ__.stage(name)` is the game's own) | `tests/battlestage-drive.test.ts` 19 tests; `step(n)` cases in `sje-stage-contract` | done | the spike's `applyEvent` did not clear a fallen fighter's statuses (the engine does, in `kill`): fixed, the trace found it |
| B: pass line 3 | seed 7 trace, driver against legacy path, street and sewer, groups "3" and "boss+1" (fixture), and the shipped data as an invariant | lines equal; 0 drift; controls: seed 8 differs, dropping status events gives drift and another trace, another order policy differs | holds | the legacy path is the engine called in the scene's order with the game's own Auto orders (`autoOrders`), not the browser scene: the scene needs a canvas |
| B: task 6 | the shipped battle drawn by a stage under `?engine=sje`: seam `battlekit/stageseam.ts`, `BattleScene.attachStage`, `runBattle` asks the provider (`sje/boot.ts` registers `battlestage/liveopen.ts`, lazy); `LiveStageScene` follows `Disp`, floaters, banner, push and shake; `FxLayer` painters unchanged, drawn into a `CanvasImage`; old renderer draws only the old UI over the stage; `playback.ts` and `fx.ts` unchanged | `e2e/sje-battle.spec.ts` 5 tests (win, loss, flee, boss intro, old path control); `tests/battlestage-live.test.ts` 22 tests | done | not ported (named): move animations and hero poses of the spike, the impact frame's white cut-out, the Warden's conduits, the stage JSON's 640 layout (task 9: the stage is still the 480x270 layout, so the effects layer is scaled 1.5 and the old menus overlap the HUD) |
| B: pass line 6 | win, loss, flee, boss intro under the flag; HUD pixels in the party table and the foe box, none where no HUD stands; draw order rule; stage gone after each fight | 5 passed on SwiftShader (CI=1, 38 s); 0 console warnings, 0 errors | holds | — |
| B: pass line 10 | `sje-canaries`, `sje-draws`, `sje-shell`, `sje-fx`, `playthrough` on SwiftShader; `sje-draws` has a case for the shipped battle: stage, HUD, battle effects and the whole stack | 61 passed (canaries, shell, fx, playthrough); draws 20 and binds 17 per frame with the stack (waiting for orders: 18 and 17), 4 canvas uploads; 10 enter and exit cycles leave textures 49, buffers 26, framebuffers 10, programs 4, vaos 13 flat | holds | — |
| B: pass line 7 | default path: `playthrough` passed; no `e2e/battle*.spec.ts` exists; `prod.spec` needs the preview server on port 3008, which this builder may not use: not run here. The shipped bundle has no `battleTrace` and no `__SJ__` | `npm run budget`: game total gzip 436.2 kB over 394 kB (the new lazy chunk `liveopen` is 39.8 kB gzip: the whole stage, loaded only under the flag); the boot class holds no pixi | open | the main session sets `GZIP_TOTAL_MAX` at the end (line 9) and runs `prod.spec` |
| B: pass lines 11, 12 | imports: `battlestage` takes the engine from the facade only and holds no Pixi (`tests/sje-imports.test.ts` 25 passed); no `!` in the new files; `step(n)` case in the contract test; `src/battle/engine.ts`, `ai.ts`, `types.ts`, `abilities.ts`, `party.ts`, `fx.json` unchanged | `npm run check` exit 0: 63 files, 928 tests | holds | — |
| B: pass line 5, live | the shipped battle with the stage, the HUD, battle effects and a floating number on screen, `fx=full`, device pixel ratio 1 (1920x1080) and 1.5 (1280x720) | 0 uneven 3x3 blocks at both; control: a ratio of 2 finds uneven blocks | holds | the effects layer is scaled 1.5 stage pixels per world pixel until task 9 (640x360 layout: 2). The block check cannot see it (it is inside the back buffer, which is scaled as a whole), so the pictures show it |
| C: task 8 | enemy and encounter data as JSON (`enemies.json` with `picture`, `mirror`, `axis`, `note`; `encounters.json`); `enemies.ts` is the loader with `checkEnemies`, `checkEncounters`, `loadEnemies`, `loadEncounters`; the look fields are in `ENEMY_LOOKS`, not in `EnemyDef`; JSON imports carry `with { type: 'json' }` (the Playwright specs load the file in Node). `enemyfacing.json` and `axes.json` stay as they are (the stage and the parity pins read them); a test proves the merged look equals them | `tests/enemies-data.test.ts` 8 tests: 21 enemies and 11 tables (37 groups) deep-equal a frozen copy of the old objects (`tests/fixtures/enemies/old-enemies.json`, made before the move); control: one changed field fails; 11 kinds of bad edit named in plain words | done | the frozen copy is the proof of the move: retire it, or edit it with the data, when a stat changes on purpose |
| C: pins | `inputs.json` pins `enemies.ts` and `enemies.json` (`notInPhaser`: the Phaser checkout has the data in its `enemies.ts` only); `scripts/sjestage-repin.mjs` moves the pins without new pictures | parity after the re-pin: 40 passed, 7 skipped (Mark's art mode), 0 differing pixels (SwiftShader, `CI=1`) | done | — |
| C: task 9 | `scripts/stage-640.mjs` (fixed transform: 80 across, 45 down, floor to 360, sky from the 320x180 art, HUD to the edges, legacy push as stage data) writes `stages-640.json` and `hud-640.json`; a stage has `screen`, `push`, `wallOffset`; checks, floor, sewer wall, HUD labels, effects layer (k = 2), wash, draw-order tie-break and rules follow the stage's screen; `?stageset=480` loads the first set; the old top lines (message, tell, help) and the victory panel start at `BattleStage.topClear` (below the HUD's top boxes) | `tests/battlestage-640.test.ts` 16 tests (files equal the transform, numbers moved as documented, 480 files carry no 640 data, bad `screen`/`push`/`wallOffset` named, painters make a 640x360 picture); `npm run check` exit 0: 65 files, 952 tests; `sje-battle` 7 passed with the HUD boxes of `hud-640.json` and 0 uneven 3x3 blocks over the whole 640x360 frame | done | looks are NOT tuned: Mark reviews the pictures |
| C: pictures | `e2e/sje-pictures.spec.ts` (local, `M3_PICTURES=1`): intro, command, list, target, attack, spell, crit, victory, boss in `old`, `480in640` and `new640`; `media/m3-stage/gpu/` (Edge, RTX 4070) with `index.html` | 27 pictures, none missing, 1.8 min | done | the `soft` set was not made (GPU set only) |
| C: task 11 | `CHANGELOG.md`, `GLOSSARY.md` (13 rows, 2 rows updated), `CONCEPTS.md` (6 entries), `DEVELOPING.md` recipe, `tooling-and-testing.md` section 5 (parity method) and a section 7 note (perf numbers left for the main session), `frame-and-rendering.md` 6.7, `.claude/skills/engine/SKILL.md`, `status.md` (3 lines) | — | done | — |
| C: task 12 | `ci.yml` e2e job runs `sje-battle` and `sje-stage-parity`; the contract tests run in `npm test`; perf and pictures stay local | — | done | — |
| C: pass line 9, numbers | `npm run budget` exit 1: game total gzip 440.7 kB against 394 kB (436.2 kB at Builder B). Classes: boot 195.2, lazy-2d 193.6 (includes the flag-only `liveopen` chunk, 41.0 kB, and 11.2 kB of Pixi that is never downloaded), lazy-other 52.0, first play on the flag 377.5. The default path (boot + lazy-other) is 247.2 kB | the script sums EVERY chunk into one total and has a separate cap only for `lazy-3d`: it cannot count `liveopen` as flag-only | open | the main session sets `GZIP_TOTAL_MAX` (Mark's one-bigger-total rule), or adds a class for the stage chunk |
