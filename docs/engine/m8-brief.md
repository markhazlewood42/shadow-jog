---
type: plan
title: "Shadow Jog Engine — M8 build brief"
project: shadow-jog
created: 2026-10-14
updated: 2026-10-14
status: approved by Mark 2026-10-14 ("Plan looks good"); build starts with M8a
tags: [engine, m8, plan, remove-legacy]
---

# M8 remove legacy: build brief

Source: [migration.md](migration.md) "M8 Remove legacy" (M8a to M8d), "M4 UI scenes (optional)", principles 4, 8, 11 and 12, the milestone table, "Content moves to data files", the file table in section 5, [et-brief.md](et-brief.md) (format, section 9 and its tail), `tests/et-tools.test.ts` (the exemption lists), [interfaces.md](interfaces.md) (`TextObject`, `NineSlice`), and the lean loop in `CLAUDE.md`. This brief lives on `engine-m8-remove-legacy` (from `main`, after ET, which merged as PR #86 on 2026-10-14). Each phase gets its own branch when it starts. **Nothing is built until Mark approves this whole brief.** The decisions of section 3 are answered.

Facts in section 2 come from a read-only survey on 2026-10-14 (grep and reads, no build). Task 1 re-checks the facts that carry risk.

## Phases (Mark, 2026-10-14)

Four phases. Each is its own PR, lean loop and merge, and leaves the game playable. The order is fixed: M8a, M8b, M8c, M8d. M8 waits for M7 and ET, which are done.

| Phase | Scope | PR | Exit check |
|---|---|---|---|
| M8a | UI kit in `src/sje/ui` (tasks 1 to 3). Shop and dialogue data format, Mark approves it first, then the data move (tasks 2 and 5). | Own PR | Kit unit tests and the 10-cycle leak test green. Data values identical. Perf follows the diff rule. |
| M8b | The 13 UI scenes, small to big (tasks 4, 6, 7). | Own PR, after M8a | Layout tests and the scene specs green. Pictures to Mark. Perf run once (real GPU). |
| M8c | Battle and field scenes (tasks 8 and 9). Larger than M8b: battle and field draw their own windows (`battlekit/render.ts`, 1035 lines) and need the kit. | Own PR, after M8b | Seed 7 trace holds. Playthrough and parity specs green. |
| M8d | Delete the old engine, `LegacyScene` and the exemptions. Move the kept files into `src/sje`. Docs, the 5 PR #86 follow-ups, changelog (tasks 10 to 21). | Own PR, after M8c | `tsc`, Biome and all specs green. No deleted-file import. No `src/engine`. |

Hard pass lines per phase (section 4 numbers): **M8a** 1, 6, 8, 9, 10, 12, 13, 16. **M8b** 1, 4, 6, 7, 9, 10, 12, 13. **M8c** 1, 4, 6, 9, 10, 12, 13. **M8d** 1 to 3, 5, 6, 9 to 15. Each line also carries its phase tag.

## 1. Goal

- Mark decided on 2026-10-14: M8 ports every scene to a native sje scene. This absorbs the optional M4 UI scenes. Then the old engine is deleted, and `src/engine/` no longer exists.
- Scenes to port: 15 files in `src/scenes` (battle, card, controls, deck, dialog, ending, field, gameover, menu, options, panels, placemap, saveload, shop, title) and their kits (`battlekit`, `fieldkit`).
- Delete: `src/engine/game.ts`, `display.ts`, `postfx.ts`, `moments.ts` (not on migration.md's list; it imports `postfx`). Delete `LegacyScene`, the `?engine=` mentions, and the ET exemptions in `tests/et-tools.test.ts`.
- Move the 11 kept `src/engine` files into `src/sje` and update every importer (decision 2).
- Move shop and dialogue content to data files, with a format Mark approves first (decision 3).
- Build the missing UI kit that M4 never built: `TextObject`, `NineSlice`, `ListMenu`, bar and cursor. Today none of them exists in `src/sje` (they are only declared in `interfaces.check.ts:187`).
- Do the 5 small follow-ups from the ET and PR reviews and close ET pass line 17.
- Not in M8: new game features, new tools, other data file moves (enemies, maps), the trailer (#84), the Editor suite, visible changes a player or Mark did not ask for.
- Exit check (migration.md): `tsc`, Biome and all specs green. A scan shows nothing imports the deleted files, and no `src/engine` folder is left.

## 2. Survey facts that change the plan

- **No native UI kit exists.** The 13 UI scenes draw with `drawText` and `drawWindow` into a canvas (`src/sje/display/font.ts:299`, `src/ui/draw.ts:52`). They run through `LegacyScene` and `CanvasImage`. A native port needs the kit first (task 3). migration.md counts about 270 `drawText` and 57 `drawWindow` sites.
- **The deletion list is larger than the migration text.** `moments.ts` goes too. `src/engine/gl/` is already gone.
- **Importers of the old `Scene` (`engine/game`):** the 15 scene files above. Type-only or helper users: `battlekit/{playback,render,stageseam}`, `fieldkit/fieldseam`, `battlestage/liveopen.ts`, `fieldstage/fieldopen.ts`, `fieldstage/stagescene.ts` (`postfx`), `game/systems.ts`, `story/newgame.ts`, `boot.ts`, `sje/boot.ts` (the bridge) and `dev/stageedit/battleglue.ts`. `src/battle`, `src/field`, `src/art` and `src/data` import none.
- **Tests that import the old files:** `game-cases.ts`, `game.test.ts`, `gpufx.test.ts`, `shake.test.ts`, `sje-field-stage.test.ts`, `sje-fx.test.ts`, `sje-game.test.ts`, `sje-runtime.test.ts`, `display.test.ts`, `sje-display.test.ts`, `atmosphere.test.ts`, `layout.test.ts`, `ui-layout.test.ts`. `sje-imports.test.ts` and `et-tools.test.ts` check paths. e2e dynamic imports: `sje-bench.spec.ts:146`, `sje-shell.spec.ts:192`, `sjefxkit.ts:15`, `economy.spec.ts`.
- **`LegacyScene`** is in `src/sje/runtime/legacyscene.ts` and re-exported in `src/sje/index.ts:39`. It is used by `runtime/{game,gameapi,gameobjectfactory,scene}.ts`, `display/canvasimage.ts`, `interfaces.check.ts`, `scripts/lib/interface-check.mjs`, `dev/viewers/base.ts`, `scenes/field.ts` and four tests. About 18 files say `?engine=` (stale comments; `main.ts:23` only warns in dev).
- **The shim files.** `engine/font.ts`, `rng.ts`, `particles.ts` and `fxdata.ts` re-export `src/sje` code (`tests/sje-imports.test.ts:307` to `320` pins this). `engine/game.ts` also holds the `LegacyShape` types that `sje/runtime/gameapi.ts` mirrors. Task 1 lists what in `game.ts` is still used by value.
- **Kept `src/engine` files and where they go (decision 2).** About 102 files in `src`, `tests`, `e2e` and `scripts` import them. sje already holds equivalents of some, so those merge and the duplicate goes. Task 1 confirms each home before the move.

| Old file | New home | Note |
|---|---|---|
| `font`, `rng`, `particles`, `fxdata` | `sje/display/font`, `sje/core/rng`, `sje/fx/particles`, `sje/fx/fxdata` | Shims. Delete them and point importers at the real file. |
| `assert` (10 lines) | `sje/core/assert` (15 lines) | Compare, keep one, merge any missing export. |
| `input` (243 lines, the `Input` class) | `sje/runtime/inputdevice.ts` | `sje/runtime/input.ts` (`ActionMap`, 45 lines) wraps it today by a type import. After the move it imports the class directly. Not merged into one file: devices and action map are two jobs. |
| `canvas`, `color`, `errors`, `perf` | `sje/core/canvas`, `sje/core/color`, `sje/core/errors`, `sje/core/perf` | `canvas` goes in `core`, not `display`, so principle 12 stays honest (see pass line 12). |
| `shake` | `sje/fx/shake` | Pairs with `cameraeffects` and the fx system. Task 1 checks for a duplicate. |

- **Specs that cover ported scenes (grep of `e2e/`):** `playthrough`, `economy`, `gameover`, `gpufx`, `shots`, `playtest`, `chaos`, `default-path`, `sje-battle`, `sje-field`, `sje-field-parity-a` to `d`, `sje-stage-parity`, `battletest`, `sje-canaries`, `prod`. There is no spec per UI scene.
- **Layout heuristics of the original build** (the source for the port, decision 4): `src/ui/layout.ts` (the box sizes and text widths), `src/ui/draw.ts` (window frame, palette, text), `src/ui/list.ts` (cursor, scroll), `docs/PIVOT-640.md` (the 640x360 layout rules, WP4), `tests/layout.test.ts` (text fits its box) and `tests/ui-layout.test.ts` with `tests/recorder.ts` (every rect inside the screen, every text box inside its window, row counts, content share). No separate UI doc exists. `docs/TOOLING-UI.md` is for tools, not for game scenes.
- **Shop and dialogue content today:** `src/data/shops.ts`, `src/data/speakers.ts`, and the dialogue lines in `src/story/chapter1.ts` and `scenes/dialog.ts`. Task 1 lists the exact exports and their users.
- **W/H** come from `src/sje/core/size.ts`. No `src` file imports them from the old path.
- **Docs:** `docs/ARCHITECTURE.md` names old files at lines 51, 58, 74, 80, 85, 93 ("Until M8" at 56). `DEVELOPING.md:200` mentions `?engine=sje`. `scripts/bundle-budget.mjs` has comments only. The project `CLAUDE.md` names `src/engine/game.ts` for `W` and `H` and has a `src/engine/` non-null rule; both move to `src/sje`.
- **The follow-ups (tasks 16 to 20)** come from the PR #86 reviews. ET pass line 17 is Mark's checkpoint, passed 2026-10-14 ("tested, look good").

## 3. Decisions (answered 2026-10-14)

1. **Phases: four (Mark, 2026-10-14).** Mark first approved a split into three PRs. On 2026-10-14 he split M8 into four phases, each its own PR, lean loop and merge. M8a = UI kit, shop and dialogue data format and the data move. M8b = the 13 UI scenes. M8c = battle and field. M8d = the deletion, the kept-file move, docs and follow-ups. Port order: kit, small scenes (card, controls, gameover, ending, placemap, saveload), options, dialog, title, shop, deck, panels, menu, battle, field, delete. Each phase leaves the game working.
2. **The kept `src/engine` files move into `src/sje`.** Mark: "I don't mind big diffs. I prefer not to leave cleanup for later. Clean it up while we're in here spinning up the new engine." M8 moves assert, canvas, color, errors, font, fxdata, input, particles, perf, rng and shake (table in section 2), updates every importer, and `src/engine/` no longer exists.
   - **When: M8d, as its own commit after the deletion (task 14).** Reason: the UI scenes of M8b and the scenes of M8c import these files. A move in M8a would put about 100 import edits into the kit review. After the deletion, the four deleted files need no edit, and the scenes are final, so each importer is edited once. The move is a `git mv` commit, then an import-rewrite commit, so a reader sees renames as renames. Mechanical: no logic change.
   - **Perf rule:** principle 12 names `src/sje/render`, `display` and `three`. The move puts no file in those folders (`canvas` goes to `core`). A move of non-draw files therefore must not trigger a perf run. Pass line 12 states this and checks it.
3. **Shop and dialogue content moves to data files in M8** (Mark: yes). Principle 8 says Mark approves the file format first, so task 2 proposes it and stops. Values stay identical. See task 2 and 5, and section 6.
4. **No pixel comparison tests** (Mark: "overkill and finicky"). Each UI scene is ported by best guess with the layout heuristics of the original build (section 2). Existing layout and unit tests stay green. The e2e specs that touch these scenes stay green. The runner takes pictures per ported scene, and the main session sends them to Mark. Mark said this round will not end in editors (editors come after Chapter 1), so he does not design the layouts now. Risk: a look drift is judged by Mark's eye from pictures (section 8).

## 4. Hard pass lines

1. *[All phases]* `npm run check` exits 0 (tsc, Biome, unit). Judge by exit code.
2. *[M8d]* **Nothing imports the deleted files.** `git grep -nE "engine/(game|display|postfx|moments)" -- src tests e2e scripts` prints nothing. The 4 files do not exist. **Control:** the same scan run on `main` prints files, so the scan can find a string.
3. *[M8d]* **No `LegacyScene`, `LegacyShape` or `LegacyGameSurface`, and no `?engine=`.** `git grep -nE "LegacyScene|LegacyShape|LegacyGameSurface|engine=(sje|legacy)" -- src tests e2e scripts docs/DEVELOPING.md docs/ARCHITECTURE.md` prints nothing. Mentions in history docs (`docs/engine/*`, `CHANGELOG.md`) are allowed.
4. *[M8b for the UI scenes, M8c for all]* **No scene is a legacy scene.** `git grep -n "from '../engine/game'" src/scenes` prints nothing. Every scene class extends the sje `Scene`. `Game.run(oldScene)` has no caller.
5. *[M8d]* **The exemptions are gone.** In `tests/et-tools.test.ts`: `FORBIDDEN`, `GAME_BOUNDARY`, `DIRECT_ONLY`, `DYNAMIC_GAME`, `BATTLE_TEST_DYNAMIC`, `BATTLE_TEST_GLUE` and `BATTLE_TEST_FILES` are removed, or reduced to a check that no tool reaches a deleted path. `sje-imports.test.ts` lines 97 to 99 (`engine/input`) and the shim pins (307 to 320) match the new state. **Control:** a tool file given a dynamic import of a deleted path makes the test red.
6. *[All phases, for the scenes the phase ports]* **Every spec for a ported scene is green:** `npx playwright test e2e/playthrough.spec.ts e2e/economy.spec.ts e2e/gameover.spec.ts e2e/gpufx.spec.ts e2e/shots.spec.ts e2e/playtest.spec.ts e2e/chaos.spec.ts e2e/default-path.spec.ts e2e/sje-battle.spec.ts e2e/sje-field.spec.ts e2e/sje-field-parity-a.spec.ts e2e/sje-field-parity-b.spec.ts e2e/sje-field-parity-c.spec.ts e2e/sje-field-parity-d.spec.ts e2e/sje-stage-parity.spec.ts e2e/battletest.spec.ts e2e/sje-canaries.spec.ts e2e/prod.spec.ts --reporter=line` exits 0 (`CI=1 PW_PORT=3012`). Task 1 fixes this list by grep. The full CI run on the PR is green.
7. *[M8b]* **UI scenes: the layout tests hold and Mark has the pictures** (decision 4). `tests/layout.test.ts`, `tests/ui-layout.test.ts` and every other existing unit test that touches a UI scene are green and still run against the ported scenes (no test is deleted or loosened to pass). The runner writes one picture per ported scene to `media/m8-ui/` at 1280x720, and the main session sends them to Mark. The pictures are evidence for Mark's eye, not a gate the runner can pass or fail. There is no pixel comparison test.
8. *[M8a]* **The kit exists and is tested.** `TextObject`, `NineSlice`, `ListMenu`, bar and cursor have unit tests and leave no leak in the 10-cycle scene test (`tests/sje-ui-leak.test.ts`).
9. *[All phases]* **The game plays.** `e2e/playthrough.spec.ts` and the gameover spec are green on the final commit of each phase. Title, menu, shop, save and load, options and a battle each run once in a test with the real scene.
10. *[All phases]* **Design data and the game rules are untouched** (principle 8). `git diff --stat main...HEAD -- src/data src/battle src/field src/art src/audio src/story` prints nothing, except the named type-only edits in `src/story/newgame.ts` and `src/game/systems.ts`, and the shop and dialogue move of decision 3 (M8a: the new data files, their loader, and the TypeScript files they replace). The two named type-only edits land in M8d. `src/data/*.json` that exist on `main` have no diff at all. **Values identical (M8a):** a test loads the new data and compares it to a snapshot of the old TypeScript values taken before the move. `tests/balance.test.ts` and `tests/economy.test.ts` are green.
11. *[M8d]* **The tool follow-ups hold.** Tasks 16 to 20 each have a test that fails without the fix. ET pass line 17 reads "passed 2026-10-14, Mark" in `et-brief.md`.
12. *[All phases]* **Principle 12 (GPU timing).** Run `git diff --stat main...HEAD -- src/sje/render src/sje/display src/sje/three`. If it prints a file, the main session runs `npm run perf` once on Mark's machine before the PR is ready and records the numbers. The UI kit goes in a new folder `src/sje/ui/` so the check stays honest. **M8a** adds the UI draw path, so the main session runs `npm run perf` once at the end of M8a, whatever the diff says. **M8b and M8c** follow the diff rule. **M8d** follows it too: removing `LegacyScene` edits `display/canvasimage.ts`, so expect one run there. **The kept-file move alone must print nothing:** no moved file lands in `render`, `display` or `three`, and the check is run on the move commits by themselves (`git diff --stat <before-move>..<after-move> -- <the three folders>` prints nothing).
13. *[All phases]* **Bundle.** `npm run budget` exits 0. The old engine files leave the bundle, so the total must not rise. If the kit raises it, a new cap needs Mark's yes (his one-bigger-total rule). `e2e/prod.spec.ts` stays green.
14. *[M8d]* **Docs.** `ARCHITECTURE.md` (the old-file headings at the lines in section 2), `DEVELOPING.md` (line 200 and the tool list), `migration.md` (the M8a to M8d rows, the file table and the "Content moves to data files" table), and in every phase `docs/roadmap/roadmap.json` (status of its row, then `npm run roadmap`), `TOOLING-UI.md` (the Battle Test glue notes), `et-brief.md` (line 17), the project `CLAUDE.md` (`W`/`H` path and the `src/engine/` non-null rule), `CHANGELOG` via `changelog.d/engine-m8-remove-legacy.md`, and the Record below are updated. `git diff --name-only main...HEAD` lists them.
15. *[M8d]* **`src/engine` is gone.** The folder does not exist. `git grep -nE "(from|import\()\s*['\"][./]*(\.\./)*engine/" -- src tests e2e scripts` prints nothing. **Control:** the same scan on `main` prints files.
16. *[M8a]* **The data format was approved before the scene port.** The Record holds Mark's approval of the shop and dialogue format (task 2) with its date, and the commit of task 6 comes after it.

## 5. Tasks, in build order

1. *(M8a)* **Survey re-check.** List by grep: the value uses of `engine/game.ts` (not types), what `postfx` and `moments` give the battle and field scenes today, the `drawText` and `drawWindow` call count per scene, the per-scene spec list for pass line 6, the exact shop and dialogue exports and their users, and the home of each kept engine file (does `sje` already hold `shake` or `assert`?). Check that battle and field draw nothing themselves (their stage scenes draw). Write the findings in the Record. Stop and ask if a fact breaks the group plan.
2. *(M8a)* **Propose the data format for shops and dialogue, then STOP for Mark's approval.** Write a short section (in `docs/engine/` or `docs/DEVELOPING.md`, task 1 picks): the JSON shape, the loader with a checker like `checkHacks`/`checkFx` (a bad file fails loud, with the file and field in the message), and the round-trip test (load, save, load gives the same data). Show a sample of one shop and one dialogue. The main session sends it to Mark. **No scene that reads these data (task 6) starts before Mark approves.** Task 3 may run while Mark reads, because it does not touch this content.
3. *(M8a)* **Group A, the UI kit** in `src/sje/ui/`: `TextObject` (on the engine font), `NineSlice` (the window frame of `ui/draw.ts`), `ListMenu` (cursor, scroll, wrap, from `src/ui/list.ts`), bar and cursor. A `UiScene` helper base only if two scenes need the same code. Unit tests. Build only what a scene in B to D calls (principle 6).
4. *(M8b)* **Group B:** card, controls, gameover, ending, placemap, saveload as native scenes. Layout by the heuristics of section 2. Update `ui-layout.test.ts` to draw the new scenes. Pictures to `media/m8-ui/`.
5. *(M8a)* **Data move, after Mark's approval of task 2:** write the shop and dialogue data files, the loader and the checker, the round-trip test, and the values-identical test (pass line 10). The old TypeScript content is replaced by the loader. `tests/balance.test.ts` and `tests/economy.test.ts` stay green.
6. *(M8b)* **Group C:** options, dialog, title, shop. Options uses `game.fx` instead of `postfx`. Shop and dialog read the data of task 5. Pictures.
7. *(M8b)* **Group D:** deck, panels, menu. The three largest UI scenes (369, 500 and 888 lines). Pictures. End of M8b.
8. *(M8c)* **Group E, battle:** `scenes/battle.ts` and `battlekit` become a native scene over `BattleStageScene`. `postfx` and `moments` calls go to `game.fx`. `stageseam.ts` and `liveopen.ts` lose the `Game` type. Seed 7 status trace equals `battleTrace(7)` (the M3 control).
9. *(M8c)* **Group F, field:** `scenes/field.ts` and `fieldkit` the same way over `FieldStageScene`. `fieldseam.ts`, `fieldopen.ts` and `fieldstage/stagescene.ts` lose `postfx`. The playthrough spec is the control. End of M8c.
10. *(M8d)* **Types and helpers:** `game/systems.ts`, `story/newgame.ts`, `boot.ts` and `sje/boot.ts` use the sje `Game`. `SHAKE_PIXEL_GAIN`, `Display` and `Game` types come from `src/sje`. `stageedit/boot.ts` and `engine/input` as migration.md line 343 says.
11. *(M8d)* **Tool clean-up:** `battleglue.ts` calls the sje scene and `game.fx`. Remove the exemption lists (pass line 5). Rewrite the tests of section 2 to the new classes; the W/H dynamic imports use `src/sje/core/size`.
12. *(M8d)* **Delete** `engine/game.ts`, `display.ts`, `postfx.ts`, `moments.ts`. Pass line 2.
13. *(M8d)* **Remove `LegacyScene`** and its types, its tests, its `interfaces.check.ts` and `interface-check.mjs` entries, and every `?engine=` comment. Pass line 3.
14. *(M8d)* **Move the kept `src/engine` files** into `src/sje` by the table in section 2: one `git mv` commit, one import-rewrite commit (about 100 files, mechanical), one commit that merges `assert` and the `Input` wiring and deletes the shims. Update the `sje-imports.test.ts` pins. Delete the empty `src/engine/`. Pass lines 12 (the move alone prints nothing) and 15.
15. *(M8d)* **Docs and checks:** `ARCHITECTURE.md`, `DEVELOPING.md`, `migration.md`, `TOOLING-UI.md`, the project `CLAUDE.md`, the bundle comments, the Record.
16. *(M8d)* **Follow-up 1:** record ET pass line 17 as passed in `docs/engine/et-brief.md` (Mark, 2026-10-14, "tested, look good"). A doc line, so it lands with the other follow-ups in M8d.
17. *(M8d)* **Follow-up 2:** an in-flight guard in `save()` in `src/dev/stageedit/stageedit.ts`. A second Save while one runs does nothing. Test: two calls, one POST.
18. *(M8d)* **Follow-up 3:** `serve.ts` wraps `new URL` in `isRoot` and `isDry` and answers 400 on a bad URL. Test: a malformed request line gets 400 and the server stays up.
19. *(M8d)* **Follow-up 4:** the `serve.ts` POST body reads go through `withBody` (`src/dev/endpoint.ts`). The 413 and 500 tests of `tests/stageedit-save.test.ts` stay green.
20. *(M8d)* **Follow-up 5:** the Battle Test e2e samples one tick early (`src/dev/stageedit/battletest.ts:131`). Fix the sample point and add an assertion that fails with the old offset.
21. *(M8d)* **Changelog:** add `changelog.d/engine-m8-remove-legacy.md` (not written now; the format is in `changelog.d/README.md`).

Groups are commits. M8a = tasks 1 to 3 and 5. M8b = tasks 4, 6 and 7. M8c = tasks 8 and 9. M8d = tasks 10 to 21. Each phase is a full branch and PR and leaves the game playable. Tasks 2 and 5 need Mark's approval of the data format first (pass line 16).

## 6. Editor contract (principle 11)

(a) Every new scene reads its text and its numbers from the same sources as before: `src/data/*`, the `ui/draw.ts` palette and the font. Shop and dialogue content is the exception that moves: it now loads from data files (b). No visible value changes. (b) **Shop and dialogue data files** have: (1) their tunables and content in one documented JSON shape with the old values as the defaults; (2) a loader that reads the file and a checker that rejects a bad one, plus a save path covered by the round-trip test; (3) a hot-reload: the loader can re-read the file into a running game without a restart; (4) `snapshot()` and `restore()` of the live state that uses them (shop stock and cursor, the dialogue line and choice position), so a tool can capture and resume; (5) a deterministic `step(n)` for the dialog text reveal, so a tool can scrub it. Task 2 proposes the exact shapes and Mark approves them. A shop or conversation editor is not built in M8. (c) The kit takes plain data (`ListMenu` items, `NineSlice` size) and shows it; it holds no game state, so a future editor can preview a window. (d) Battle and field keep their stage seams (`snapshot`, `restore`, `loadStage`, `loadMap`) unchanged. (e) Battle Test runs the sje battle scene directly after task 11. Tools do not import game boot files.

## 7. Verifier plan (lean loop)

| Agent | Model, effort | Job |
|---|---|---|
| Builder per group (A, B, data move, C, D, E, F, G) | sonnet, high | One group each, in order. A builder starts after the last one is committed. Groups E and F may run in parallel only in separate checkouts, which the repo rule forbids (no extra worktree folders), so they run in turn. The kept-file move (task 14) is its own builder. |
| Runner | sonnet, medium | The pass lines of the phase (see Phases). Runs the expensive suites once. Makes the pictures of pass line 7. Runs the controls. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 2 to 5, 7 (no test deleted or loosened), 10 (values identical, data file matches the approved format), 13, 15; the scan results; no leftover shim. |

- No attacker for the port. M8 changes no write path, trust rule or save format. The follow-ups in tasks 17 to 19 touch the Save path of `serve.ts`, but only by a guard, a 400 and a shared helper that has an attacker-tested history (`withBody`). **Recommend one attacker, sonnet, medium, in M8d only**, on `/__stage/*` with a malformed URL, a double Save and an oversize body. Mark can cut it.
- Every builder prompt: no `Co-Authored-By` line and no `Claude-Session` trailer in any commit. No agent kills a process by name. Ports 3007 and 3009 are not touched. Playwright runs with `CI=1 PW_PORT=3012`.
- Pass: every hard line holds, no Critical or Important finding is open. A Minor finding is a named fix. A fix round: one fresh verifier checks only the named findings. Cap 3 rounds.
- **Quality gate for M8 (Mark, 2026-10-14; this overrides "rubric scores do not gate" of the lean loop for this milestone).** Each verifier gives a score out of 10 on a rubric written before the work (correctness, tests that can fail, fit with the engine design, docs and records). A phase passes only when the hard lines hold, no Critical or Important finding is open, and every verifier score is at least 8.5. Below 8.5, a fix round with a fresh verifier on the named findings (cap 3, then bring Mark the evidence). Every worker and verifier uses the smallest model that fits: haiku for reads, scans and the reader; sonnet for builders and the runner; effort low or medium (high for a builder in a last round). Opus only when a smaller model failed a round, and only for that part. Say why in the Record. Verifiers are fresh agents that did not write the work.
- **Hops (Mark, 2026-10-14).** M8 may chain up to 6 automatic handoffs before Mark must approve (`Handoff hop N (cap 6)` in each prompt). A pending decision still stops the chain: the task 2 data format needs Mark's approval.
- The main session keeps `docs/workstreams/engine-m8-remove-legacy.md` true, sends the pictures to Mark, and relays the data format proposal. Perf (line 12) runs by its own rule.

## 8. Risks

- **The size.** 15 scenes in all (13 UI scenes in M8b, battle and field in M8c) (about 6,000 lines with the kits), about 60 files, plus about 100 importer edits in the move. The four phases and the groups cap the diff of each review. The move is renames plus import lines, so it reads fast.
- **Look drift.** Without pixel tests, a canvas `drawText` and a `TextObject` can differ by a pixel (rounding, blend), and a layout can shift. Only the layout tests and Mark's eye on the pictures catch it. Mark accepted this (decision 4). The pictures go to him per group, not only at the end of the PR, so a drift is found early.
- **The data format waits for Mark.** Task 5 (the data move) cannot start until he approves task 2, and the shop and dialog scenes (task 6, M8b) read that data. Order: propose the format first, so he reads it while the kit is built.
- **Values drift in the data move.** A typo changes a price or a line. The values-identical test and the balance and economy tests catch this.
- **The kit is built on demand.** Principle 6 says build only what a scene calls. A kit class that nothing calls is cut.
- **Battle and field are not UI.** Their risk is the seams and the timing of `postfx` and `moments`. Seed traces and the parity specs are the controls.
- **Hidden `Game` coupling.** The old `Game` has members that scenes use by value (`runBeneath`, `fade`, `shake`). Task 1 lists them. A missing member in the sje `Game` is a stop-and-ask.
- **The move hides a merge.** Merging `Input` and `ActionMap`, and `assert`, is the only logic touch in task 14. Keep it in its own commit with the unit tests.
- **GPU timing.** The UI port changes the draw path. Pass line 12 says the main session runs `npm run perf` once at the end of M8b, where the scenes move onto the new draw path (M8a only builds the kit).
- **Bundle.** A new kit may exceed the caps while the deletion lowers the total. Order the deletion early in M8d and measure.
- **Conflicts** in `status.md`, `CHANGELOG.md` (use `changelog.d`), `docs/roadmap/roadmap.json`. Merge `main` before each commit.
- **Scope creep:** other data file moves, new UI features, a menu redesign, Editor suite work.

## 9. Record

| Step | What | Result | Verdict | Fix or note |
|---|---|---|---|---|
| M8a task 3 | `tests/pacing.test.ts` counting rule | `proseChars` no longer counts comments and template literals of `chapter1.ts`. Story count 18,896 to 18,468. Budgets unchanged | noted | Rule change, not a budget change |
| M8a order | Survey `b9e2eb4` after the data move `efcfe15` | Approval status `a931767` came before the survey, so pass line 16 holds | holds | |
| M8a caps | Bundle caps raised with Mark's yes, 2026-10-14 | First play 395.9 to 402.1 kB. Total 456 to 462.5 kB. Commits `787f29e`, `162069a` | approved | |
| M8a deferral | Data-layer items (d) `snapshot/restore` and (e) `step(n)` | Deferred to M8b, approved by Mark 2026-10-14 | approved | See `m8a-data-format.md` section 7 |
| M8a pass line 12 | Perf | `render`, `display` and `three` diff is empty. `npm run perf` run by Mark 2026-10-14 on RTX 4070: 14 of 16 passed first, 2 failed (battle live ratio 0.93 against 0.95, HackScene cost p95 9.40 ms against 8 ms). Both are in M1 and M7 tests outside the M8a diff. Rerun of the 2 with Chrome closed: both pass. Battle: interval p95 16.90 ms (bare 16.90), cost p95 5.40 ms. HackScene: interval p95 16.90 ms, cost p95 4.90 ms | pass | Mark |

### Known gaps for M8b

- `ActionMap` has no `keyName`. M8b needs it for `keyLegend`.
- There is no `scene.add` helper. Use `sys.ui.add`.
- The divider, the select highlight and `OVERLAY_DIM` are plain `Graphics`.
- The `onSound` callback maps to sfx.
- There is no `UiScene` base class yet.
- The level table in `docs/engine/README.md` lacks level 2.6. Do this in M8d.

### M8b phase 2 (options, dialog, title, shop)

| Step | What | Result | Verdict | Fix or note |
|---|---|---|---|---|
| Phase 1 finding | Test that `Game.run` of the old class refuses a native scene | `tests/game.test.ts`, commit `0cf8e68` | done | |
| Group C | Options, dialog, title and shop are native `UiScene`s | Commit `be3fc23`. Options reads `game.fx.active`, not `postfx`. The old `Game.reset` type takes a native scene | done | Dialog choice highlight is 1 px taller than the old one (the kit `ListMenu` uses `rowH` for it) |
| Editor items d and e | `snapshot()`, `restore()` and `step(n)` on dialog and shop | `tests/sje-ui-scenes-2.test.ts`, each proof has a control | done | See `m8a-data-format.md` section 8 |

### M8b phase 3 (deck, panels, menu)

| Step | What | Result | Verdict | Fix or note |
|---|---|---|---|---|
| Group D | Deck, panels and menu are native `UiScene`s | Commits `e2e2db4` (scenes and `src/scenes/uiview.ts`), `6515abd` (layout test and unit tests). All 13 UI scenes are native: `git grep -n "from '../engine/game'" src/scenes` prints only `battle.ts` and `field.ts` (M8c) | done | Pass line 4 holds for the UI scenes |
| Build | Pages with many small parts (menu, deck prompt and line box) are built again only when what they show changes. Lists are kit `ListMenu`s, placed per mode. Art (deck, chip, panel frames) is canvas pictures | `ViewBuilder` makes only kit parts, plus the divider and select highlight as plain `Graphics` | done | Panels: the shake follows `game.shakeX` in `prerender`. The deck boot log has no clip: a test proves its lines fit the screen |
| Layout test | `tests/ui-layout.test.ts` reads the native menu, deck and panels | Menu pages by key presses, deck in 3 modes, 7 comic pages. The deck plate is `DECK_PLATE` in `deck.ts` (it is painted into the art canvas) | done | No test is deleted or loosened |
| Unit tests | `tests/sje-ui-scenes-3.test.ts`, 16 tests, each proof has a control | Menu flow, toast, page rebuild, deck seating flow, panel flow, shake, title card, 10-cycle leak for all three | done | |
| Pacing test | `proseChars('src/scenes/panels.ts', true)` | Comments drop out, as for `chapter1.ts` (the new comments pair backticks across lines and inflated the story count to 80 min). Count 2,745 to 2,468 | noted | Rule change, not a budget change |
| Specs | Pass line 6 list (without `prod.spec`, which needs the preview on 3008) with `CI=1 PW_PORT=3012` | 235 passed, 27 skipped. 3 failed first: `gameover` render fault (the native menu has no `render`: the spec now throws in a `prerender` handler) and `shots` 39 (the deck hook reads `sj.game.top`). Both fixed, then all of `shots.spec.ts` (36) passed | done | Spec fixes in commit `ec1b749` |
| Pictures | `M8_PICTURES=1`: 36 pictures in `media/m8-ui/` (menu 11, deck 4, panels 4, plus phases 1 and 2) | None missing | for Mark | |
| Pass lines 10 and 12 | `git diff --stat main...HEAD` over `src/data src/battle src/field src/art src/audio src/story`, and over `src/sje/render src/sje/display src/sje/three` | Both print nothing | holds | No `npm run perf` needed for M8b |
| Pass line 13 | `npm run budget` | **Over the caps.** First play 410.8 kB (cap 408), total 472.6 kB (cap 468.5), lazy-3d 146.7 kB (cap 160). The caps are not changed here | open | Mark decides: raise the caps (about 2.8 and 4.1 kB over) or trim |

### M8c group E (battle)

| Step | What | Result | Verdict | Fix or note |
|---|---|---|---|---|
| Port | `BattleScene` extends the sje `Scene`. It paints `render(ctx)` into one `CanvasImage` on `prerender`. `enter` is `create`, `update` is `fixedUpdate`, `exit` is the `shutdown` event | Commit `0a60e94`. `battlekit/render.ts` still draws the old UI with canvas calls into that image. It is not moved to kit parts | done | Open: a kit port of `render.ts` is not in this group. M8d does not need it |
| Effects | Each `postfx` call is `this.game.fx` | `clear`, `clip` (create), `clear` (shutdown), `rate` with hit stop (`fixedUpdate`), `glowLayer`, `bloom`, `ui`, `active` (render). `later` and the moments of `playback.ts` use `v.game.fx` | done | |
| Moments | `playMoment(FX, name, x, y)` is `game.fx.playMoment(name, x, y)` | The `intro` moment at the screen middle, and every `gpu*` call of `playback.ts`. Same data (`fx.json` through `loadData`), same effects clock | done | The old copy in `engine/moments.ts` has no caller in the battle |
| Seams | `stageseam.ts` and `liveopen.ts` take the sje `Game` type | `git grep -n "from '../engine/game'" src/scenes` prints only `field.ts` | done | `game/systems.ts` casts `game` to the sje `Game` for `battleStages.open`. M8d task 10 removes the cast |
| Battle Test | `battleglue.ts` no longer routes `postfx` | Battle Test runs a fight (`battletest.spec.ts` green). Pins in `et-tools.test.ts` and `sje-imports.test.ts` now expect no `postfx` or `route` edge in `src/dev`, each with a control | done | The exemption lists stay for M8d task 11 |
| Seed 7 control | Live scene trace equals `battleTrace(7)` | `tests/battle-native.test.ts` (unit, real scene on a real `Game`) and `e2e/battletest.spec.ts` pass line 9. Controls: seed 8 differs, one changed word differs | holds | |
| Timing proofs | Intro moment tick, hit stop, shake, flash, effects cleared on close | `tests/battle-native.test.ts` (5 tests) and `tests/playback.test.ts` (3 new). Mutating the code turned 4 of them red | holds | |
| Unit tests | `npm run check` | exit 0. 112 files, 2019 tests. `ui-layout.test.ts` reads the native scene with `nativeKeys` and stubs the intro; no test deleted or loosened | holds | |
| Specs | `sje-battle`, `battletest`, `sje-stage-parity`, `gpufx`, `gameover`, `playthrough` with `CI=1 PW_PORT=3012` | 102 passed, 21 skipped, exit 0 | holds | |
| Pass lines 10, 12, 13 | Diff scans and `npm run budget` | Lines 10 and 12 print nothing. Budget exits 0: first play 411.4 kB (cap 412), total 473.2 kB (cap 473.8) | holds | Total rose 0.6 kB since M8b (472.6 kB) |

### M8c group F (field)

| Step | What | Result | Verdict | Fix or note |
|---|---|---|---|---|
| Port | `FieldScene` extends the sje `Scene`. It paints `render(ctx)` into one `CanvasImage` on `prerender`. `enter` is `create`, `update` is `fixedUpdate`, `exit` is the `shutdown` event | Commit `4692f87`. With a stage under it and no dev overlay, the scene clears its canvas once and hides it (the old `blank` rule). `paintSnapshot` draws the canvas only when it is visible. `fieldkit/*` needed no change except one call | done | The method `load` is now `loadAt`. The sje `Scene` owns the name `load` (its loader). One caller in `fieldkit/api.ts` |
| Effects | `postfx.glowLayer()` and `postfx.bloom` are `game.fx.glowLayer()` and `game.fx.bloom` | Two places: `field.ts` (`renderLegacy`) and `fieldstage/stagescene.ts` (`paint`). Values stay 0.9 for a town and 0.5 for a room. The field had no `moments` call and no other `postfx` call | done | `fadeOut(14)`, `fadeIn(14)`, `shake` and `flash` were `game.*` calls already. They are unchanged |
| Seams | `fieldseam.ts` and `fieldopen.ts` take the sje `Game` type. `stagescene.ts` loses `postfx` | `fieldopen.ts` has no cast any more. `snapshot`, `restore`, `loadStage` and `loadMap` are unchanged (editor contract d) | done | |
| Stack lookup | The field is not in the old `game.stack` | `dev/fieldshow.ts` reads `game.scene.scenes`. `boot.ts` reads it through `const sje = game as unknown as SjeGame`. `game/systems.ts` casts the same way for `game.top === f` | done | Three casts in all: `src/boot.ts:48`, `src/game/systems.ts:154` (these two are group F) and `src/game/systems.ts:368` (the battle stage open, group E). M8d task 10 removes them with the other `Game` type edits. They are the only new shims (finding F2 of the review: this row said two) |
| Pass line 4 | `git grep -n "from '../engine/game'" src/scenes` | Prints nothing. No class in `src` extends the old `Scene`. `Game.run(oldScene)` has no caller in `src` (every `run` and `reset` call takes a native scene) | holds | `src/boot.ts`, `game/systems.ts`, `story/newgame.ts` and `sje/boot.ts` still import the old `Game` type. M8d task 10 |
| Timing proofs | Warp fade, shake, flash, glow, stage open and close, snapshot and restore | `tests/field-native.test.ts`, 12 tests. Fade level at ticks 7, 14, 21 and 28. The map loads on tick 14. Shake moves `view().cx` by `game.shakeX`. Mutating the code turned a test red in 6 of 6 tries (fade 13, no shake in the camera, bloom 0.8, no stage close, stage opaque, no `blank`) | holds | Seam test uses the real `FieldScene` as the source of the real `FieldStageScene` |
| Test edits | `sje-field-stage.test.ts` glow test spies on `game.fx.glowLayer`. `sje-imports.test.ts` lists `field.ts`, `fieldseam.ts` and `boot.ts` as facade users. The seam rule allows the facade only, with a control. `e2e/gameover.spec.ts` throws from `fixedUpdate`, not `update` | No test deleted. The seam rule now allows one edge (`src/sje`, type only) and rejects a deeper file and the stage code, each with a control | holds | |
| Unit tests | `npm run check` | exit 0. 113 files, 2031 tests. `balance` and `economy`: 57 passed | holds | |
| Specs | `playthrough`, `sje-field`, `sje-field-parity-a` to `-d`, `default-path`, `economy`, `gameover`; then `gpufx`, `playtest`, `chaos`, `sje-canaries`, `sje-battle`, `battletest`, `sje-stage-parity`, `shots` with `CI=1 PW_PORT=3012` | First run: 93 passed, 2 failed (`gameover` fault test set `update` on a native scene). After the fix: 184 passed, 21 skipped, exit 0. `docs/screenshots` was reverted. `prod.spec` was not run (it needs the preview on 3008) | holds | `prod.spec` is for the runner |
| Pass lines 10, 12, 13 | Diff scans and `npm run budget` | Lines 10 and 12 print nothing. Budget exits 0: first play 411.1 kB (cap 412), total 472.9 kB (cap 473.8) | holds | Total fell 0.3 kB since group E (473.2 kB) |

### M8c group G (battle and field UI kit)

| Step | What | Result | Verdict | Fix or note |
|---|---|---|---|---|
| Decision | Mark decided on 2026-10-15 to port the windows of the battle and the field in M8c. | The brief row for M8c said these scenes "need the kit". Groups E and F left their windows as canvas calls. Group G moves them to kit parts. This closes the open item of group E. | recorded | |
| Survey | Each window and each picture of `render.ts` and of the field, sorted into kit part or canvas art. | Kit parts: tell, top banner, message, help and description lines, round, command and list menus, target box, party cards and enemy status (no stage only), cut-in names, victory panel, level-up panel, field objective box, field banner text. Canvas art: the world, fighters, effects and floaters (they zoom with the push camera), impact frame, intro glass, bloom light, big action banner (band and 2x letters), VICTORY banner (3x letters and sweep), face frames of the turn strip, cut-in frame and face, Hex deck, amber chips, level-up wheel and big level number, field banner scrim, emotes, cue, curtains, weather. | done | No plain `Graphics` is added. The kit allows three: the dim, the divider and the select highlight. The battle needs none. |
| Battle build | `battlekit/hud.ts` (the HUD), `battlekit/panels.ts` (victory and level-up panels) and `src/scenes/uiops.ts` (the plain-data ops). `render.ts` keeps the art only (1,036 lines before, 479 now). The three menus are kit `ListMenu`s that the HUD makes in `create`. | Commit `dbdc09c`. The kit `Bar` gets an optional ghost (`setGhost`) for the damage trail and the level-up gain: it is the old `drawLag` arithmetic, proved against `drawLag` calls. The battle does not use `game.fx.ui` any more. | done | `endPanel` is a panel object now (`!!endPanel` still works for the specs). |
| Field build | `fieldkit/hud.ts`: the objective box (a plate picture and `TextObject` lines) and the banner text. | Commits `e52b484` and `351bc4d`. Emotes, cue, curtains, weather and dust stay canvas art. | done | |
| Parity catch | `e2e/sje-field-parity-a.spec.ts` case `lantern_row-banner` failed on the first field port: largest step 3/255, bound 2. | A separate GPU blend of the semi-clear banner band caused it. The band and the rule are canvas art in the screen layer again (`renderBanner`). The text stays kit. The case passes: largest step 2/255. The bound is not changed. | fixed | A test proves the band and the rule calls. |
| Build rule | A box is described as plain ops. It is built again only when the JSON of its ops changes. A pulse, a slide and a fade change an alpha, a position or a scale. | `tests/battle-hud.test.ts` (16 tests) and `tests/field-hud.test.ts` (7 tests), each proof with a control. The "built once" checks compare object identity. Mutating the code turned a test red in 7 of 7 tries. | holds | |
| Layout and leak | The layout test reads the native battle. A 10-cycle test runs for the battle and for the field. | `tests/ui-layout.test.ts` has the same checks and the same screens, and it puts the `intro` override back in a `finally`. `tests/layout.test.ts` is unchanged and green. Both leak tests end with the texture count where it began, and a control leaks one window on purpose. | holds | The test "has screens to check" now has a 20 s timeout (5 s was not enough when the whole suite runs at once). |
| Named differences | Where the kit port is not the same pixel. | (1) Enemy status bar, no stage only: the kit `Bar` has a 1 px outline `#07060d` over the plate `#0a0913`. The old plate ring was a few levels lighter. (2) The windows were in the scene canvas, under the stage HUD. They are in the ui layer now, so they draw over the stage HUD. (3) The objective box and the banner text are not in the screen snapshot that the battle intro shatters. (4) The banner keeps its old fade rule: the text fades and the window frame stays solid. | named | Pictures from `M3_PICTURES=1`: command menu, list, victory and boss look as before. |
| Review fix F1 | The seam rule of `fieldseam.ts` allowed any `src/sje` target. | It now enforces a type-only import. The control goes red on a value import and stays green on `import type`. | fixed | Commit `45c5173` |
| Review fix F2 | The row "Stack lookup" of group F said two casts. | Three casts: `src/boot.ts:48`, `src/game/systems.ts:154` and `src/game/systems.ts:368`. The row says so. | fixed | |
| Review fix F4 | The workstream file said "Next: the M8c rubric". | State active, updated 2026-10-15, next: verification of the kit port. | fixed | Commit `45c5173` |
| Review fix F5 | `roadmap.json` said M8a was next. | M8a is done (PR #94 merged 2026-10-14). `npm run roadmap` wrote the chart. `tests/roadmap.test.ts` is green. | fixed | Commit `45c5173` |
| Review fix F6 | `ui-layout.test.ts` replaced `BattleScene.prototype.intro` for the whole file. | The block restores it in a `finally`. | fixed | Commit `dbdc09c` |
| Runner note | Every `game.run` caller takes the sje `Game`. | `new Game(` appears once in `src`, in `src/sje/runtime/game.ts:212`. `src/sje/boot.ts:139` passes that object to `boot()` in `src/boot.ts`, whose `run` calls (lines 110 to 118) go to it. `liveopen.ts:94` (`game.run(stage)`) and `battleglue.ts:186,190` take `Game` from `../sje`. | holds | The old `engine/game.ts` class is only a type in `src`. It refuses a native scene. |
| Unit tests | `npm run check` | Exit 0. 115 files, 2,055 tests (2,031 before). Seed 7 trace test (`tests/battle-native.test.ts`) is green. | holds | |
| Specs | `sje-battle`, `battletest`, `sje-stage-parity`, `gpufx`, `gameover`, `playthrough`, `sje-field`, `shots` and `sje-field-parity-a` to `-d` with `CI=1 PW_PORT=3012` | 183 passed, 27 skipped, 0 failed. `docs/screenshots` was reverted. | holds | `prod.spec` is for the runner. |
| Pass lines 10 and 12 | Diff scans over `src/data src/battle src/field src/art src/audio src/story` and over `src/sje/render src/sje/display src/sje/three` | Both print nothing. | holds | The kit edits are in `src/sje/ui/bar.ts` and `src/sje/index.ts`. |
| Pass line 13 | `npm run budget` | **Exit 1.** Total 474.7 kB (cap 473.8 kB), 0.9 kB over. First play 411.1 kB (cap 412 kB). The growth is in the battle chunk (the HUD and the panels). | open | Caps are not changed. Mark decides: raise the total cap by about 1 kB or trim. |
| Pass line 13, cap | Mark raised the total cap to 475.5 kB on 2026-10-15 (temporary, until M8d) | `npm run budget` exits 0. Total 474.7 kB (cap 475.5 kB). First play 411.1 kB (cap 412 kB) | approved | Mark |
