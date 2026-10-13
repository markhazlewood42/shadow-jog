---
type: plan
title: "Shadow Jog Engine — ET build brief"
project: shadow-jog
created: 2026-10-13
updated: 2026-10-13
tags: [engine, et, plan, editors, tools]
---

# ET Editor port: build brief

Source: [migration.md](migration.md) "Editors and tools" track 1, principle 11 (the editor contract), principle 12 (GPU timing), "M8 Remove legacy", [et-survey.md](et-survey.md) (all facts below come from it), [m6-brief.md](m6-brief.md) (format), `docs/TOOLING-UI.md`, and the lean loop in `CLAUDE.md`. Branch: `engine-et-editor-port` (from `main` after M7). **Nothing is built until Mark approves this brief.** Task 1 re-checks every survey fact.

## 1. Goal

- Every existing tool opens, edits, saves and previews on the new engine, and no tool file reaches `engine/game`, `display`, `postfx` or `moments`, or `LegacyScene` or `LegacyShape`. The 14 tools are in the survey, section 2.
- The Battle Stage Editor and Battle Test exist on the new engine. They are built from the archive tag `archive/phaser-stage-2026-10-09`, because M3 did not port them.
- Every tool has a test that opens it. 6 of the 12 tools that exist have none today.
- Not in ET: new tool features (`TOOLING-UI.md` 4.5 stays later), the Editor suite, the 27 game files that still import the old engine (M8, or M4), `src/engine` deletion (M8), the real hacking scene, frame-by-frame moves (`TOOLING-UI.md` 6.2).
- Exit check (migration.md): every existing tool opens, edits, saves and previews on the new engine, and the old-engine tool code is gone before M8.

## 2. Survey facts that change the plan

- **Two of the 14 tools do not exist on this branch.** The Battle Stage Editor is 16 files and 5,541 lines on the archive tag, plus a 378-line page. The migration text says "with M3". `m3-brief.md:21` moved it to ET. ET builds it.
- **5 tools depend on the old engine:** the art viewers (5 scenes) and the trailer (direct, `extends Scene`), the field show hooks and the dev routes file (direct, type imports), and the FX lab (indirect, through `scenes/battlekit/gpufx.ts:43`, plus `LegacyShape`). 7 are clean: the DEV menu, the animation editor, art review, art swap, the stage lab, the engine lab and the 3D entry.
- **The boundary with M8 is 8 of 35 files.** 35 files outside `src/engine` import the old engine. 8 are tools (ET). 27 are game code (M8): 15 scenes, 5 battle or field kit files, 7 boot and glue files.
- **The shipped stage leaves out the spike's move animations** (`src/battlestage/live.ts:19`). The spike's Battle Test plays them from `moves.json` (only on the archive). That is decision 2.
- **Two stage data sets exist.** The game reads the 640 set (`stages-640.json`, `hud-640.json`). The archive editor writes the 480 set. That is decision 4.
- **Five tools have no browser test.** The DEV menu cannot be mounted under Playwright (`devmenu.ts:39`). The animation editor and the art review have write endpoints with no dry run.
- **The shipped bundle holds no tool code**, and has 0.3 kB (total) and 0.5 kB (first play) of room. ET touches one shipped game file at most (`gpufx.ts`).
- **Principle 12 (GPU timing) does not apply**, unless the diff touches `src/sje/render/`, `src/sje/display/` or `src/sje/three/`. No planned task does. Pass line 11 checks it. The engine has no `Zone` or `pick`; if the editor needs one, task 1 says where it goes, and a change in `src/sje/display/` would trigger one `npm run perf`.
- **Contradiction:** migration.md M8 deletes four paths; its file table deletes `src/engine/*`. ET does not depend on which is right. M8's brief must pick.

## 3. Open decisions for Mark (recommendation first; the build uses it unless Mark says otherwise)

1. **How far each tool is ported.** Recommend: engine-free, no new features. Every tool file imports none of the old engine. The FX lab becomes a real new-engine `Scene`. `gpuSpell` and `gpuCast` take the effects object as an argument: the game passes `postfx`, the lab passes `game.fx`. The lab also calls `game.fx.loadData` after each edit (survey section 7). The 5 viewers and the trailer card move to a new-engine scene base. All tool code lives in `src/dev`. Alternative: keep `LegacyShape` for the FX lab, the viewers and the trailer until M8. That is less change now, but the exit check is not met and M8 must convert 7 scenes.
2. **Battle Test depth.** Option A: port the spike's Battle Test whole: `battleflow`, `perform`, `moves`, `strike`, `controls`, `kneel`, `stills`, `fx` and `moves.json` (about 2,000 lines plus 21 kB of data; E24 asks whether `moves.json` is your data, safe default yes). Option B (recommended): the dialog and options port with the editor. The fight runs on the game's own `BattleScene` over the live stage, with the page's unsaved stage swapped in through `loadStage`. It plays what the game plays, with no move animations, as the shipped stage does. A would add a second performer that the game never uses. Task 1 checks that the editor page can run `BattleScene` over its stage. **If it cannot, the builder stops and reports. It does not fall back to A without Mark.**
3. **Tools nobody uses.** Recommend: port all. This is a confirmation: no costed alternative exists, because dropping a tool only shrinks the work. The viewers are 215 lines. The trailer is 202 lines and `scripts/trailer.mjs` re-shoots it after any art change. Art swap is the in-game try of the art review. Name any tool you do not use. The builder then deletes the tool, its `tools.ts` entry, its route and its doc lines, and the pass lines shrink.
4. **Which stage files the editor writes.** Recommend: the 640 set only (`stages-640.json`, `hud-640.json`, plus the shared `axes.json`, `enemyfacing.json`, `heroes.json`). The 480 set stays frozen for the parity fixtures. Alternative: both, with a switch. That doubles the save path.
5. **Merge ET into M8.** Recommend no. ET ends when 8 tool files and 2 new tools are on the new engine. M8 is the deletion of `src/engine` and the conversion of 27 game files, with M4 optional. One PR for both would hide the editor review in a deletion PR.

## 4. Hard pass lines

1. `npm run check` exits 0 (judge by exit code).
2. **No old engine in tool code.** New `tests/et-tools.test.ts` builds the value-import closure of each tool entry and fails on `src/engine/{game,display,postfx,moments}.ts`, on `LegacyScene` or `LegacyShape`. Entries: the DEV menu, FX lab, animation editor, art review, art swap, trailer, every viewer, the stage editor, Battle Test, `sje-lab/stagelab.ts`, `sje-lab/lab.ts`. For `fieldshow.ts` and `devroutes.ts` it checks direct imports only (they start game scenes). **The trailer is a closure check, and today it fails:** `src/dev/trailer.ts:21` value-imports `autosavePolicy` from `../game/systems`, and that closure reaches `scenes/battle.ts` and `engine/moments`. Task 3 removes the import. `tests/sje-imports.test.ts:278-290` loses its allowance for type imports of `Game` and `LegacyShape` in `src/dev`. **Control:** a fixture graph with one forbidden edge must fail in the test, and the runner adds `import '../engine/postfx'` to `src/dev/fxlab.ts` once, expects red, and reverts.
3. **Build files and scripts.** `grep -n "src/engine" vite.config.ts` prints nothing. `grep -n "/src/engine/" scripts/pixellab/*.mjs` prints nothing. The FX lab's save endpoint still passes `e2e/fxlab.spec.ts` test 3.
4. **Every tool opens in a browser test.** `npx playwright test e2e/tools.spec.ts e2e/fxlab.spec.ts --reporter=line` exits 0. `tools.spec.ts` has one case for each of: the DEV menu, animation editor, art review, art swap (`?art=review`), the 5 viewer routes, the trailer card, the stage lab, the Battle Stage Editor and Battle Test. Four tools get no new case, because a named spec already opens them: the engine lab (`e2e/sje-canaries.spec.ts`), the 3D entry (`e2e/sje-hack-a` to `-d`), the field show hooks (`e2e/sje-field.spec.ts`) and the dev routes (`tests/devroutes-hack.test.ts`, `tests/devroutes-ticks.test.ts`, and the specs above). Task 2 checks that each of these still judges a state. Each case judges a state (a count, an "Unsaved" status, a non-void canvas), not only "no error". **Controls:** the DEV menu is absent without the test's `navigator.webdriver` override (the guard is real); an unknown `?scene=` shows the title, not a viewer.
5. **Dry runs on the two endpoints without one.** `POST /__rig/skeleton?dry=1` and `POST /__artpass/review?dry=1` check and write nothing. **Controls:** a bad body gets 400 with a problem, and the hash of `public/art/rig/skeleton.json` and `media/art-pass/review.json` is the same before and after the run.
6. **Battle Stage Editor.** Every archive case is ported or dropped with a reason in the Record. The archive has about 81 e2e and about 112 unit cases (a static count with the loops and `it.each` rows expanded; survey section 3). `npx vitest run tests/stageedit*.test.ts` and `npx playwright test e2e/stageedit*.spec.ts --reporter=line` exit 0. The Record's counts must add up to the recount of task 2 (`npx playwright test --list` and `npx vitest list` on the ported files), not to a fixed number. One case does the full round trip: edit, Save, reload, find it. **Control:** a HUD change that pushes a stage's box off the screen is refused with the archive's message and writes nothing.
7. **The save path is safe.** `/__stage/stages` refuses a cross-site POST (403) and bad data (400), writes all files of one Save or none, and writes only the 640 set (decision 4). `git status --porcelain src/data public/art/rig` is empty after every test run (tests use `tests/fixtures/stagedata/`). `media/` is git-ignored, so `git status` cannot see it: the hash of `media/art-pass/review.json` is the same before and after the run (as in line 5). **Control:** the same request with `Sec-Fetch-Site: same-origin` and `?dry=1` gets 200.
8. **Design data is untouched** (principle 8). `git diff --stat main...HEAD -- src/data` prints nothing (with decision 2 A, only a new `src/data/moves.json`, after Mark's yes on E24).
9. **Battle Test.** An unsaved edit of a slot, then Start, puts that slot's figure at the edited place (`__SJ__.battleStage`). The seed-7 status trace equals `battleTrace(7)`; seed 8 differs (the M3 control). Esc returns to the editor with the selection and the undo history intact.
10. **The game is unchanged** (principle 8). `git diff --stat main...HEAD -- src/battle src/field src/game src/art src/audio src/story` prints nothing. In `src/scenes`, only the 5 moved viewers, `battlekit/gpufx.ts` and its callers (an argument, no behavior) may differ: `git diff --name-only main...HEAD -- src/scenes` lists only those files. `npx vitest run tests/gpufx.test.ts tests/sje-fx.test.ts` exits 0.
11. **Principle 12.** `git diff --stat main...HEAD -- src/sje/render src/sje/display src/sje/three` prints nothing, so no GPU run is needed. If it prints, the main session runs `npm run perf` once before the PR is ready and records the numbers.
12. **Bundle.** `npm run budget` exits 0 with the caps unchanged (total 455.7 of 456 kB, first play 395.4 of 395.9 kB). `grep -l "stageedit\|FxLabScene\|mountDevMenu\|rigedit\|BattleTest" dist/assets/*.js` prints nothing. **Control:** the same grep for `SHADOW JOG failed to start` prints a file, so the grep can find a string. `e2e/prod.spec.ts` stays green.
13. **CI places the new specs.** `npx vitest run tests/ci-shards.test.ts` exits 0 with `e2e/tools.spec.ts` and the editor specs in shards (or in `NOT_IN_CI` with a reason), and `ci.yml` lists them.
14. **The effects contract is the real path.** `fxlab.spec.ts` gets one case: after an edit, `game.fx` plays the edited moment through `loadData`, and a bad edit leaves the old data in place. **Control:** the case fails if `loadData` is not called (the lab replaces `FX` with a copy).
15. `CHANGELOG.md`, `DEVELOPING.md` (section 4: the tool list), `TOOLING-UI.md` (sections 3 and 4.5: built on the new engine), `migration.md` (the ET row and the file table), the survey corrections and the Record below are filled. **Check:** `git diff --name-only main...HEAD` lists `CHANGELOG.md`, `DEVELOPING.md`, `docs/TOOLING-UI.md`, `docs/engine/migration.md`, `docs/engine/et-survey.md` and `docs/engine/et-brief.md`. `sed -n '/^## 9. Record/,$p' docs/engine/et-brief.md | grep -c '^| [A-Z]'` is at least 6 (the header, the two brief-verify rows, and one row for each of builders A, B and C), and `sed -n '/^## 9. Record/,$p' docs/engine/et-brief.md | grep -cE '[|] *[|]'` prints 0 (no empty Record cell). The main session updates `roadmap.json` and runs `npm run roadmap` at close.
16. **Pictures for Mark** (evidence, not a gate): `media/et-editors/` holds the stage editor, Battle Test, FX lab, DEV menu and one viewer at 1280x720 and 1440x900.
17. **Playable checkpoint (Mark).** After the last fix round, the main session gives `http://localhost:3007/stageedit.html`, the FX lab, the pictures and the Record. Mark edits a stage, saves, battle tests, and merges or names fixes.

## 5. Tasks, in build order

1. **Survey re-check.** Re-count survey sections 2, 4 and 5. Read the archive's `edit/overlay.ts`, `hit.ts` and `stageedit.ts` (`stageedit.ts` has 24 `Phaser.` or `scene.` matches on 21 lines. The other two have none): does the editor need engine hit testing, and which `Figure` and stage calls does it make? Check that the editor page can run `BattleScene` (decision 2). Record corrections in `et-survey.md`.
2. **Specs first.** `tests/et-tools.test.ts` and the changed rule in `sje-imports.test.ts`; `e2e/tools.spec.ts`; the two `?dry=1` seams; the archive's cases copied under new names (recount them with `npx playwright test --list` and `npx vitest list`). Run them red against the current code. Controls of lines 2, 4 and 5.
3. **Re-base the small tools** (one kind of change). The 5 viewers move to `src/dev/viewers/` on a new-engine scene base. The trailer card uses `game.fx.glowLayer`, and `trailer.ts` stops value-importing `game/systems` (`:21`, `autosavePolicy`, set at `:114-115`): move `autosavePolicy` into a small module that imports no engine, or pass it in. `fieldshow.ts` and `devroutes.ts` take the new `Game`. The FX lab becomes a `Scene`, with the `gpufx.ts` argument and `loadData`. `vite.config.ts` and `render-current.mjs` use `src/sje` paths. No change to the animation editor, art review, art swap, stage lab, engine lab or 3D entry.
4. **Stage data path.** `/__stage/stages` and `/__stage/hud` in `vite.config.ts`, the save module (`edit/save.ts`) and its checks against the 640 set.
5. **Battle Stage Editor.** The 16 files into `src/dev/stageedit/`, the page `stageedit.html`, the `tools.ts` entry, the breadcrumb. `stageedit.ts` is the only editor file that imports Phaser; it moves to the new stage API (`loadStage`, `snapshot`, `restore`, `Figure`).
6. **Battle Test** (decision 2). The dialog, then the fight.
7. **Docs and Record.** Pass line 15.

## 6. Editor contract (principle 11)

(a) Each tool keeps its data file as the only source: `fx.json`, the stage set, `skeleton.json`, `review.json`. (b) Each save goes through the checker the game loads the file with (`checkFx`, `prepareSave` over `loadStages` and its siblings, `rig2/check`). (c) Hot reload: the FX lab calls `game.fx.loadData` (pass line 14); the stage editor calls `BattleStageScene.loadStage` (`stagescene.ts:407`); the animation editor and the art review do not hot-reload into a running game (the game reads their files at startup). **Gap named:** closes with the Animation Composer in the Editor suite. (d) The stage editor uses `snapshot` and `restore` (`stagescene.ts:417`, `:436`). (e) Battle Test uses the driver's `step(n)` (`battledrive.ts:364`). What stays in code: panel layouts and shortcut tables. No Pixi object leaves `src/sje`. **Gaps in the FX lab:** (a) editing `FxParams` and (d)/(e) scrubbing do not exist in the lab. They are new features, so they go to the Editor suite (survey section 7). **Control:** pass lines 6, 9 and 14.

## 7. Verifier plan (lean loop)

| Agent | Model, effort | Job |
|---|---|---|
| Builder A | sonnet, high | Tasks 1 to 3. |
| Builder B | sonnet, high | Tasks 4 and 5. Starts after A is committed. |
| Builder C | sonnet, high | Tasks 6 and 7. Starts after B is committed. |
| Runner | sonnet, medium | Pass lines 1 to 14. Runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 2, 3, 6 (the case count), 8, 10, 11, 12; no vacuous test; controls really fail. |
| Attacker | sonnet, medium | Only the save paths (pass lines 5 and 7): the new `/__stage/stages` (the only one that writes; `/__stage/hud` is GET only, so the attacker checks that a POST there is refused), and the two `?dry=1` seams. Cross-site and look-alike origins, oversize body, a path in a file name, a half-written Save. |

- Every builder prompt: no `Co-Authored-By` line and no `Claude-Session` trailer in any commit.
- Pass: every hard line holds, no Critical or Important finding open. A Minor finding is a named fix. A fix round: one fresh verifier checks only the named findings. Cap 3 rounds.
- No agent writes a workstream file. The main session keeps `docs/workstreams/engine-et-editor-port.md` true.
- Perf (line 11) runs only if the diff touches the three folders.

## 8. Risks

- **The editor is a Phaser design at 480x270.** Its zoom tables, its screen size and about 81 e2e cases assume that size. The 640 set changes the numbers. Task 1 and the ported cases find them.
- **Battle Test A would double the performer.** B depends on one unchecked fact (task 1).
- **A canvas smaller than the picture** shows two Pixi warnings (M6 Record, fix round 1). The editor's side panels can cause it on a small window.
- **Test seams are not features.** The two `?dry=1` flags and the `navigator.webdriver` override are for tests. A write path changed, so the attacker checks it.
- **`gpufx.ts` is a shipped file.** The total has 0.3 kB of room. Line 12 decides, and a re-set follows Mark's one-bigger-total rule.
- **Conflicts** in `status.md`, `CHANGELOG.md`, `docs/roadmap/roadmap.json`. Keep edits small; merge `main` before each commit.
- **Scope creep:** `TOOLING-UI.md` 4.5 changes, M4 scenes, move animations, the Editor suite.

## 9. Record

| Step | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Brief verify r1 | Pass lines 2, 4, 6, 7, 10 and 15 got checks, and the trailer closure fix was added; archive counts recounted; the FX lab gaps and decision 3 reworded | 3 Important, 7 Minor | FAIL → fixed | Trailer `game/systems` import (task 3, line 2); `media/` hash (line 7); line 15 command; line 4 case list; line 10 command; case counts; `/__stage/hud` GET only; task 1 hit count; FX lab gaps; decision 3 |
| Brief verify r2 | Fix round checked the 10 named findings and the "five files in one Save" claim | 0 Important, 3 Minor | PASS | Decision 3 recommendation first; task 1 names `stageedit.ts` as the file with the matches; line 15 row count and empty-cell check |
