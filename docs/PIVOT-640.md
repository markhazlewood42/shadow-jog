---
type: design
title: "Shadow Jog — The move to 640x360: criteria, rubric and record"
project: shadow-jog
created: 2026-10-07
updated: 2026-10-07
status: criteria committed 2026-10-07, before any code of the move. Mark approved the move on 2026-10-05 ("Let's pivot. Better now than later.")
tags: [engine, design, verification, pivot-640]
---

# Shadow Jog: the move to 640x360

This file is the contract for the move of the shipped game from 480x270 to 640x360. It holds the exit criteria, the rubric, the numbers fixed before any code, the decisions that still wait on Mark, and the record of each step. It exists before the first code change of the move. A criterion written after a result does not count.

**Where it comes from.** Mark chose 640x360 on 2026-10-05 after the B3 mock. He gave his final design approval the same day. `docs/engine/migration.md` records the move as the "Pre-M0 640x360 move" and amends principle 4 for it. The plan behind this file (`PLAN.md`, 2026-10-05) and the site inventory (`INVENTORY.md`, 398 sites) live in Mark's git-ignored media folder, not in the repo. This file adapts section 7 of that plan.

**What changed since the plan.**

- One branch and one pull request for the whole move: `resolution-640x360`. There are no stacked pull requests. Every work package lands on this branch in order. Mark merges the one pull request at the end.
- No hours, agent-days, prices or cost checkpoints anywhere (Mark, 2026-10-05). Effort means which files a step touches.
- The decisions that were "before any work" are answered. D1: option A, principle 4 amended (`docs/engine/migration.md`, principle 4 and the Pre-M0 row). D3: option a, the Phaser spike is frozen. D4: the design docs record 640x360 (done on `main`). D0 (the price) is gone with the cost model.
- CI runs three jobs at the same time since 2026-10-06 (PR #19). A pull request takes about 7 minutes. CI runs only on pull requests and on `main`, so a branch push alone starts no run.
- Builders and verifiers run on the model the main session picks. This file sets no model.

---

## Work packages on this branch

The packages land on `resolution-640x360` in this order. Each one ends with the loop below. The row ids are rows of `INVENTORY.md`.

| WP | What it does | Mark sees |
|---|---|---|
| WP0 | Baselines, probe, scan, criteria: this file, the three tools (`scripts/contact-sheet.mjs`, `scripts/pixel-diff.mjs`, `scripts/check-shots.mjs`), the literal scan (`tests/screen-literals.test.ts`), the 480x270 baseline shots and perf numbers, and the bare-flip probe pictures. Rows 14, 18, 213, 234. | Review 0: the probe contact sheets and the perf numbers at both sizes. |
| WP1 | One size source, same pixels: `BW` and `BHT` derive from `W` and `H` through one `WORLD_SCALE`; `main.ts`, `fieldmap.ts`, `postfx.ts`, `battle/fx.ts` and the FX lab read the shared size; `pan()` centers a map smaller than the view; the comments that said 480x270. Every baseline shot has 0 differing pixels. Rows 1, 6, 10-12, 16-17, 47-48, 52, 60, 84-85, 94, 130, 137, 139, 143, 358-360, 383, 386. | None, by design. The pixel-diff report is the evidence. |
| WP2 | The flip, the 2x viewport, the engine floor: `W = 640`, `H = 360`; the viewport 1280x720 in the config and the scripts; the shake scale (D10); the snap-rule test (D14); the perf gates (D15); the expected-failure list. Rows 2-5, 7-9, 13, 75, 79-80, 91, 140-141, 148, 187, 209, 215-216, 223-224, 333-334, 388. | Review 1: the effects sheet, D11, and early pictures of one interior, the Dock and the Rustyard. |
| WP2a | Battle mock (throwaway, no commit to the branch): the boxed battle beside the laid-out battle in two compositions, with one enemy and with four. | Review 1: D2 and D5. |
| WP2b | Battle composition slice, only under D2 option a: the world at 320x180, `PANEL_Y`, `PARTY_BOTTOM`, the ground rows, the street backdrop, the framing, both HUD options. Rows 49-51, 56, 61-62, 123-124, 128, 144-145, 177-179. | Review 2: the four composition pictures, D6. |
| WP3 | Field, maps, cutscenes: weather counts by area, the maps smaller than the view (D7), the walk of every map and cutscene for pop-ins (D17), the map-size test. Rows 15, 19-24, 74, 83, 86-90, 92-93, 95, 186, 188-204, 226-227. | Review 3: pictures of every small map and every pop-in, D7, D17. |
| WP4 | Dialog, menus, shop, modals: the layout recorder and its two negative controls, the dialog cap (D8), row counts from `H`, the status page re-laid, the dialog wrap test. Rows 25-33, 44-45, 96-97, 100-114, 120, 184-185, 357. | Review 4: the dialog in both variants, D8. |
| WP5 | Title, ending, game over, comic panels, deck: the title world at 320x180, the 17 panel rects, the ending and game-over positions, the deck placement. Rows 34-43, 72, 98-99, 115-119, 122, 183, 207. | Review 5: the new compositions, a 5x logo and a 3x panel to compare, D9. |
| WP6 | The old battle, the rest: the other seven backdrops, banners and cut-ins, the impact-frame radius, the Warden conduits, one pass over every effect id. Rows 53-55, 57-59, 63-71, 73, 125-127, 129, 131-136, 138, 142, 146, 176, 219, 225, 304, 361. | Review 6: each backdrop with 1 to 4 enemies and the Warden. |
| WP7 | Tests, e2e, evidence, scripts: `docs/screenshots` regenerated, the evidence and `perf.txt`, the render scripts, the reconciliation table, the D20 note. Rows 46, 76-78, 121, 147, 205-206, 208, 210-212, 214, 218, 220-222, 335-336. | Review 7: the regenerated set and the Deck window view. The pull request to `main` opens for Mark. |
| WP8 | Docs, wiki, changelog: `ARCHITECTURE.md`, `DEVELOPING.md`, `CONCEPTS.md`, the GDD line (his file), the wiki pages. Rows 81-82, 149, 217, 260-270, 337-340, 381-382, 395-398. | Review 8: the diff. |

**Rules for every package.**

- **Branch.** Push each commit as the work goes. Nobody commits to `main`. The one pull request is a draft until WP7, so CI runs on every push after it opens.
- **Review.** A Copilot review on the pull request: monitor on, fix, reply, resolve. One shared `CHANGELOG.md` entry under "Unreleased", extended by each package.
- **Drift check before each package.** `git fetch`, then `git rev-list --left-right --count HEAD...origin/main`. If `main` moved, merge `origin/main` into the branch (a merge, not a rebase), then run the scan test and the unit tests before the package starts.
- **Main keeps moving.** New layout work on `main` uses `W` and `H`. The scan test fails a new literal.
- **Content rule.** The walk in WP3, the title world in WP5 and the backdrops in WP2b and WP6 show things that were off screen or that get a new composition. Agents list them with pictures and options. They change no story or map data without Mark's written yes per item (D7 c, D17 c). A default applies only if he is silent after the pictures, and only a code-only default: limit the camera, or fade or letterbox the scene (D17).
- **Reviews do not block independent packages.** The agent starts the next package while Mark reviews the last one, except at a hard stop and except for a decision that needs his yes.

---

## Decisions for Mark

Mark decides the look. Agents check exactness, coverage and stability. A decision that is asked at a review comes with the pictures of its options. The recommendation applies only if he is silent after he saw them. A major decision (one that blocks work, changes an approved design, or touches more than one session or branch) is raised as a GitHub decision issue, as `CLAUDE.md` ("Decisions for Mark") says; the review pictures go with it.

**Open: Mark decides.**

| D | Question | Asked at | Recommendation |
|---|---|---|---|
| D2 | How much of the old battle and the old field? a: re-lay both, repaint the 8 backdrops at 320x180. b: box the battle in a centered 480x270 frame until M3. c: box the battle and the field until M3 and M5. | Review 1, from the WP2a mock | a, with backdrops painted at 320x180 and shown at 2x |
| D5 | Where do the extra 160x90 pixels go in battle? 1: bottom-anchor the party, panel and ground; the extra rows become sky. 2: add floor below and spread the formation. 3: keep the rows and center everything. | Review 1 (the other 7 backdrops at Review 6) | 1 for the old battle |
| D6 | Old battle HUD: 1: hug the screen edges. 2: stay in a centered 480x270 block. | Review 2 | 1 |
| D7 | Maps smaller than the screen (Rustyard 544x448, Loading Dock 7 320x224, nine interiors). a: accept the void. b: an edge-fill or themed surround (code only). c: enlarge the map (his written yes per map). | Review 3 (one interior, the Dock and the Rustyard at Review 1) | Rustyard b, Dock b, interiors a |
| D8 | UI widths. Dialog: full width, or a box capped at 464 px and centered. Menu panes: stretch, or cap list rows near 360 px. Shop: widen the list or cap the detail pane. | Review 4 | Cap the dialog at 464 px (every line wraps as today). Cap list widths near 360 px. Widen the shop list to about 240 px. |
| D9 | Title and comic art: the new skyline composition, the logo at 4x or 5x, the 17 panel rects, portraits at 2x or 3x. | Review 5 | Keep 4x and 2x. He confirms the compositions. |
| D11 | `fx.json` shockwave reach (his data): scale the 3 screen-wide values by 1.33 (`intro` 320 to 427, `phase` 260 to 347, `down.boss` 240 to 320), or keep them. | Review 1 | Scale. He approves it in the FX lab. No other `fx.json` value changes. |
| D17 | Content that now shows at 640x360 (pop-ins, cropped sets, exposed edges). Per item: a: limit the camera (code). b: fade or letterbox (code). c: move the content (story or map data, his written yes). | Review 3 | He picks per item. The silent default is code only: a at a camera edge, b for a cutscene beat. |

**Defaults unless Mark objects.**

| D | Default | Where |
|---|---|---|
| D10 | Feel items keep their on-screen size where the feel is a screen effect: the shake scales by 4/3 in `game.shake`, rounded to whole game pixels. Glow and haze stay as they are, because they are tied to the art. | WP2. Review 1 shows the effects sheet. |
| D14 | Keep the 90% snap rule of the Fill mode. At 640x360, 1080p gives 3x, 1440p 4x, 4K 6x and the Deck window 2x. WP2 adds a unit test of the snap table. The engine rule (E13) is decided at M1. | WP2. Review 1. |
| D15 | Perf is an agent call. Optimize first (skip the full-screen shell fill when the room fills the screen, merge the light multiply and the overhead copy, clip the overhead layer), then re-set the software gates inside the PL8 ceiling with a written note. The question goes to Mark only if the ceiling is still breached. | WP2, WP7. |
| D20 | The shipped bundle alarm (236 kB gzip, `scripts/bundle-budget.mjs`) is raised by the measured delta only, with the delta and its causes in the pull request. A delta above 4 kB needs its reason first. The work does not stop at 236 kB. | WP7. |

**Answered or not on this branch.** D1, D3 and D4 are answered (above). D12 and D13 are his stage data, before M3. D16 (delete `sfgeom.ts` at M3, the mock at M0) and D18 (the spike time box) belong to the engine milestones. D19 (merges) is moot: one branch, one pull request, Mark merges it.

---

## The loop

1. The exit criteria (hard pass lines), the rubric and the numeric ceilings exist before the code.
2. The builder checks its own work: lint, types, unit tests, the shots it needs. This is necessary. It is not verification.
3. Three fresh verifier agents score the rubric. Each has its own lens (below). Each score needs evidence: test output, a picture, or a `path:line`. A score with no evidence counts as 5 at most.
4. **Pass** needs all three: every hard pass line holds, every criterion median is 7 or more, and the average of the medians is 8 or more.
5. **Fail** sends the findings to the builder. The cap is 3 rounds. After round 3 the work stops and comes to Mark with the evidence. Nobody lowers a pass line.
6. Mark decides the look. Agents check exactness, coverage and stability.

## The three lenses

| Lens | What the verifier does | Main evidence |
|---|---|---|
| Correctness and tests | Runs the tests. Reads the diff. Checks each pass line. Tries to break it: re-adds a `480` literal, shrinks a window, loads an old save, plays a cutscene to the end, removes an expected-failure marker. | Test output, failing cases |
| Design conformance and code quality | Checks `src` for edits under `src/sje` (there must be none on `main`) and for `src/engine` edits outside the list of principle 4. Checks that shared names live in one place, that comments help a newcomer, that there is no dead code, and that the CHANGELOG, CONCEPTS and GLOSSARY rules hold. | `path:line` |
| Visual and runtime | Renders every screen at 640x360 on the GPU and on software. Views 10 key screens at 1080p (k=3) and at the Deck window (k=2). Runs the coverage check, the recorder report and the expectation list below. Measures frame time. | Pictures, pixel counts, timings |

## Hard pass lines

| # | Pass line | How it is checked |
|---|---|---|
| PL1 | **One source of the size.** `tests/screen-literals.test.ts` passes. The pending list (`tests/screen-literals.pending.json`) shrinks at each package and is empty at WP7. Every entry of the allow list (`tests/screen-literals.allow.json`) has a reason. A literal on neither list fails the test from WP0 on. **Scope.** The scan covers screen-size tokens only: 480, 270, 240, 135, 239, 479, 269 and 640, 360, 320, 180, 639, 359, 319, 179, as whole tokens in code (comments and strings are ignored). A derived value such as 464, 472, 262 or `W-16` passes it. So an empty pending list does not prove that the 48 tuned-layout sites are done. PL4 (the recorder), R1 (the reconciliation table) and the expectation list below carry that proof. | Unit test. A temp file with a bare `480` must fail it. The advisory report of `scripts/derived-literals.mjs` is read at WP7. |
| PL2 | **Same pixels.** After WP1 every baseline shot at 480x270 has 0 differing pixels. The baseline is stable first: two runs of one build match, masked shots aside. Baseline and result use the same viewport (960x540), so the compare is in game pixels. **Mask list (WP0):** 47 of the 72 shots the spec writes differ between two runs of one build, because they animate (rain, water, idle motion, blinking, a clock). They are listed in the Record below and in `media/pivot-640/baseline/mask.json`. A masked shot is not exempt: it must still have 0 differing pixels on every pixel that is the same in both baseline runs (the pixels that do not animate), which `pixel-diff.mjs --stable-from` checks. So a layout change cannot hide behind the mask. | `scripts/pixel-diff.mjs --mask --stable-from` report |
| PL3 | **Smoke check at 640x360.** In every full-screen shot not on the void-allowed list, the L-shaped area outside the old 480x270 frame (x at or beyond 480, or y at or beyond 270, in game pixels) holds at least 5% pixels that are not the clear color. This catches an empty void. It does **not** catch stretched layers, clipped text or misregistered layers. PL4, the geometry tests and the expectation list carry those checks. | `scripts/check-shots.mjs` over the regenerated set. The void-allowed list and the clear colors are in `scripts/pivot-640.json`, which mirrors this file. |
| PL4 | **No layout rect leaves the frame, and the battle layers register.** The layout recorder (built in WP4) runs over the menu panes, the shop, the modals, the dialog, the title, the ending pages, game over, the deck, the battle menus, the turn strip and the cut-ins. Every rect lies inside `W` by `H`. Every text box lies inside the window that draws it. List rows follow `H`. All 17 comic panels lie inside `8..W-8` by `8..H-18`. The exit labels and the battle strips keep their existing checks. The battle world, enemy and front layers use one scale. | `tests/recorder.ts`, `tests/ui-layout.test.ts`, `tests/layout.test.ts`, `tests/battle-geom.test.ts`. Two negative controls: a window drawn at `W-10` fails, and the old layout at 480x270 passes. |
| PL5 | **Art does not change.** `git diff --stat origin/main -- public/` is empty. Code-drawn art (battle backdrops, title world) changes only as the packages above list. | git diff |
| PL6 | **Mark's data is safe.** `git diff origin/main -- src/data src/story` is empty, with two exceptions. (a) The 3 `fx.json` values, if D11 says yes. (b) A map or story edit that cites Mark's written yes for that item in the pull request (D7 c, D17 c). A diff line outside both fails PL6. | git diff, reviewer |
| PL7 | **Scale table.** Pixel-perfect gives an exact multiple at 720p, 1080p, 1440p, 4K and the Deck window. The Fill rule table is unit tested. | Unit test, block test at k=3 and k=2 |
| PL8 | **Perf.** `e2e/perf.spec.ts` passes at the gates below, on the GPU and with `PW_NOGPU=1`. The numbers go into `docs/quality/evidence/perf.txt` at WP7. | e2e |
| PL9 | **Checks.** `npm run check`, `npm run build` and `npm run budget` pass. CI is green on the pull request at every package, and every CI step runs. A test on the expected-failure list carries a marker (below). The list only shrinks. A grep for `PIVOT-640 expected-fail` finds nothing at WP7. The pull request is fully green at WP7. All 11 e2e specs pass on the GPU and with `PW_NOGPU=1`. | CI and local |
| PL10 | **Playthrough.** `playthrough`, `playtest`, `chaos`, `economy`, `gameover` and `prod` pass. The key counts in `e2e/prod.spec.ts` are unchanged, or each change has a reason. No save stores a screen value (a grep of `src/game` finds none). | e2e, grep |
| PL11 | **Visual updates.** Mark received the before and after pictures of each review point before the next package began. | Session log |
| PL12 | **Content list.** Every pop-in, cropped set and new composition has an entry with a picture and options. Each story or map data change cites Mark's written yes. | The list in the pull request, git diff |
| PL13 | **CI wall time.** Each CI run of the pull request takes under 25 minutes. The measured time of each package's run is recorded here. The shipped game took 18.5 to 19.9 minutes on 2026-10-05 with one job; since PR #19 (2026-10-06) a pull request takes about 7 minutes with three jobs. If a run is over 25 minutes, the first lever is the split of a slow job. Raising the timeout is a deliberate step in a visible commit. Mark sees it. | CI run times, recorded in the Record below |

## Numbers fixed before code

**PL8 ceilings.** These are the gates of `e2e/perf.spec.ts` for the shipped game. D15 is an agent call: optimize first, then re-set inside the ceiling. The measured baseline and probe numbers are in the Record below.

| Run | Gate today | Gate at 640x360 |
|---|---|---|
| GPU canvas, field and live battle | mean at most 4 ms, p95 at most 6 ms | The same. |
| Software canvas (`PW_NOGPU=1`, CI), field and live battle | mean at most 8 ms, p95 at most 11 ms | The same after the D15 optimization. If it falls short, the agent re-sets the gate inside the hard ceiling: mean at most **12.5 ms** and p95 at most **14.5 ms**. That is the prediction (1.78 times the CI plaza numbers of 5.6 and 6.5 ms, which is 10.0 and 11.6 ms) plus a 25% noise margin. Today's gates keep a margin of about 43% and 70% over the measured numbers, so 25% is the least that tolerates CI noise. The WP2 push gives CI runs on the draft pull request. If their median is more than 15% above the prediction, the model is re-set before WP3. If the optimization still leaves the numbers above the ceiling, the question goes to Mark (D15). |
| Simulation | mean at most 2 ms, p95 at most 4 ms | The same. It does not depend on pixels. |
| Slow-frame guard | 40 ms for 90 frames | The same. |
| Shipped bundle | gzip alarm 236 kB | Not a ceiling. WP7 measures the total. The alarm is raised by the measured delta, with Mark's confirmation (D20). The work does not stop. |
| CI wall time | 30-minute timeout, about 7 minutes with three jobs | Under 25 minutes (PL13). |

**Void-allowed list (PL3).** These shots may have a large empty outer area because of what they show:

- `maps/lantern_row`, `maps/bar`, `maps/world`, `maps/rustyard`, `maps/sinkline_1`, `maps/annex`, `maps/dock` (the map overview scales a map to fit).
- `progress-01-cast-sprites` and `32-crowd-sprites` (dev scenes, content in the top-left).
- `25-ending-next` (a text card) and `34-game-over` (dark by design).
- `16b-enemy-poses` and `16c-boss-poses` (sheets, not screens).

**Expectation list.** The visual verifier checks each of these by eye on the regenerated shot. A shot that fails its line is a finding, whatever PL3 says.

| Shot | What the outer area must show |
|---|---|
| `01-title` | Sky, skyline and roof fill the whole frame. The roof ledge sits at the bottom edge. |
| `02-intro-panels`, `23-ending-panels` | Every panel lies inside 8..632 by 8..352. The footer sits at the bottom. |
| `03-dialog-portrait`, `06-bar-dialog` | The box sits at the bottom, 464 px wide and centered (D8 default), or full width. In the bar, brick shell shows all round the room. |
| `04-lantern-row-street`, `05-lantern-row-plaza`, `18-sinkline`, `19-world`, `21-annex` | The map fills the frame. No void and no unpainted strip. |
| `20-rustyard` and the Dock | The surround that D7 chose. No black strip that looks like a bug. |
| `07-menu`, `08-menu-status`, `09-menu-equip`, `26-menu-bestiary`, `33-menu-places` | Panes lie inside the frame. Row counts follow the height. |
| `11-battle-command` to `49-battle-deck-cutin` | The world fills 640x360 at an exact 2x. The HUD is as D6 chose. Party and enemies sit in the same layer scale. |
| `35-options`, `36-controls` | The dim layer covers the whole frame. The modal is centered. |

## Rubric

Scores run from 1 to 10. **10** is exemplary. **8** is solid with small notes. **7** is acceptable with named fixes that the step makes. **6 or lower** must be fixed. "Not applicable" is allowed, and the average then skips it.

**Build rubric.**

| # | Criterion | What 8 looks like |
|---|---|---|
| R1 | Coverage | Every inventory row of the package is done, or it is a no-change row with a reason. The reconciliation table (WP7) maps each row to a commit or a test. The advisory derived-literal report shows no unexplained derived value. |
| R2 | Layout correctness | Nothing is clipped, overlapped, off-center or unpainted in any shot. Text wraps inside its box. Every line of the expectation list holds. |
| R3 | Pixel fidelity | Pixel-perfect mode shows an exact multiple. The battle world is an exact 2x. Art keeps its size. No new resampling except the Fill mode. |
| R4 | Content exposure | No pop-in, cropped set, exposed map edge or void that looks like a bug. Cutscenes frame their subject. Each fix is on the content list with Mark's pick. |
| R5 | Readability and balance | In the capped default the dialog wrap test lists no changed line. In each pane or window the content spans at least 60% of the inner width and 50% of the inner height. A pane on the short exemption list (modals, short lists) is the only exception, and each has a reason. The recorder measures this. Labels sit near their values. |
| R6 | Performance | Inside the gates. No new full-screen pass without a measure. |
| R7 | Test quality | New tests fail when the fault returns (a negative control is shown). Tests are deterministic. |
| R8 | Behavior kept | Battle math, saves, scripts and the playthrough are unchanged. Only approved data changes. |
| R9 | Code clarity and records | `W`, `H`, `BW`, `BHT` and `WORLD_SCALE` each live in one place. Comments help a newcomer. The CHANGELOG, CONCEPTS and GLOSSARY rules hold. |

**Visual rubric (the part that agents can check).** It follows V1 to V5 of `docs/engine/verification.md`.

| # | Criterion | What 8 looks like |
|---|---|---|
| V1 | Exactness | Pixel-perfect mode gives exact blocks at k=3 (1080p), k=2 (Deck window) and k=4 (1440p). The block test shows zero uneven blocks. |
| V2 | Parity | After WP1 every baseline shot has 0 differing pixels (PL2). Sprites, portraits and tiles are unchanged (PL5). |
| V3 | One pixel grid | The battle world and the title world are an exact 2x of 320x180. No layer is scaled by 2.667 or 1.5. The geometry test pins `BW * WORLD_SCALE = W`. |
| V4 | Stability | Static screens: 60 frames of a paused menu and of a standing field change 0 pixels outside the listed animated areas (water, weather, lights, cursor). Transitions: every frame of the battle shatter intro, a scene fade and a dialog open is captured. No frame is blank, half drawn or at the wrong scale. Water and rain shimmer at most 1.25 times 1.78 times the changed pixels per frame that they show at 480x270. |
| V5 | Legibility | Text at k=3 and k=2: a cap height of 7 game pixels is 21 and 14 device pixels (the B3 bar is at least 14). Every text line fits its box (the recorder and `layout.test.ts`). Colors are unchanged, so contrast numbers are unchanged. |

## Exit check per package

Each package's exit check is verified before the next package starts. The pull request gets the full set at WP7.

| WP | Pass lines that must hold | Extra check |
|---|---|---|
| WP0 | PL1 (the scan exists), PL2 (the baseline is stable) | Probe numbers and pictures recorded. Criteria file committed. CI baseline recorded. |
| WP1 | PL1 (the pending list shrinks), PL2, PL4 (the existing layout tests), PL9 | The `pan()` test. `src/engine` edits within the principle 4 list. |
| WP2 | PL7, PL8, PL13 | The expected-failure list is written. The viewport is 1280x720. The effects sheet exists. |
| WP2a | none (throwaway) | The mock pictures reach Mark at Review 1. D2 and D5 are answered. The scratch branch is deleted. |
| WP2b | PL4 (battle layers), PL5 | The four composition pictures. |
| WP3 | PL3, PL4, PL6 (maps), PL8 (plaza), PL12 | Maps pinned. Four-corner shots. Pop-in list. |
| WP4 | PL3, PL4, PL10 (key counts) | The recorder and its two negative controls. The dialog wrap test. The expectation list for menus and dialog. |
| WP5 | PL3, PL4, PL12 | The expectation list for the title and the panels. |
| WP6 | PL3, PL4, PL5, PL8 (battle), PL12 | The battle geometry test. |
| WP7 | PL1 (empty list), PL3, PL5, PL8, PL9 (no marker), PL10, PL13 | All shots regenerated. The reconciliation table. The D20 note. |
| WP8 | PL9 | The grep for 480x270 lists only dated history. |

## Visual updates

- Each time a test renders something, the main session sends the pictures at once with `SendUserFile`. Workflow agents cannot send files. They save the images, and the main session sends them after the step.
- Each image has a one-line caption: what it shows and what passed or failed.
- Pairs are the default: the 480x270 baseline on the left, the 640x360 result on the right. Two views: game pixels (the same zoom per game pixel) and the 1080p screen (4x against 3x), because Mark sees the screen view. The baseline and the result come from different viewports (960x540 and 1280x720). The contact sheet says so in its caption and compares in game pixels.
- Pictures go to the scratch folder and are deleted at the end of the task. Chosen comparison images go to the git-ignored `media/pivot-640/` folder. Screenshots are never written into the repo, except the regenerated `docs/screenshots` in WP7.

## Named gaps

This move cannot measure these. Each gap has a reason and the nearest evidence.

| Gap | Why | Nearest evidence |
|---|---|---|
| The Steam Deck GPU | The Deck is the headline target for the 2x window. Nothing in this move runs on it. | CPU-only numbers (the software canvas) and Mark's RTX 4070 desktop. A CPU software canvas is slower than the Deck's GPU, so it is an upper bound for GPU frame cost. It is not a measure of the Deck. The Deck window view (1280x800, k=2) at Review 7 shows the picture, not the speed. |
| Stage parity at 640x360 | The Phaser spike draws 480x270 (D3). | Argued, plus engine self-baselines (`docs/engine/decisions.md`, E12; `tooling-and-testing.md` section 5). |
| Firefox and WebKit at 640x360 | The shots and the probe run on Chromium (Edge locally). | The `e2e-engines` CI job runs `gameover` and `prod` on WebKit and Firefox at every push of the pull request. |
| Story page counts at the new width | The inventory did not enumerate them. | `tests/dialog-wrap.test.ts` (WP4) for the capped default. |

---

## Expected-failure list

**The rule.** A test that the flip turns red, and that a later package fixes, carries an expected-failure marker: `it.fails(...)` in vitest and `test.fail()` in Playwright. The test body is not edited, skipped or deleted. Both runners invert the result, so a test that passes by mistake turns red ("Expect test to fail" in vitest, "Expected to fail, but passed" in Playwright). Vitest has no `describe.fails`, so each test takes its own marker. A comment on the marker names the owner package and says `PIVOT-640 expected-fail: <owner package>`. When the owner package fixes the layout, the test passes, the marker turns CI red, and the owner removes the marker. This list only shrinks. A grep for `PIVOT-640 expected-fail` finds nothing at WP7 (PL9).

**Entries.** None. WP1 changes no pixel, so no test turns red in Step 1. WP2 writes the first entries, if the flip turns any test red.

---

## Record

Each step's verification table goes here: the median per criterion, the rounds used, and the pass lines with their evidence. Measured numbers go here too, so a later step can compare.

### Step 1: WP0 and WP1 (2026-10-07)

**Scan.** File set: every `.ts` file under `src/` (including `src/data`, so a price such as the nodachi's 480 sits on the allow list with its reason), plus `vite.config.ts` and `scripts/bundle-budget.mjs` (the kB limits of inventory rows 14 and 213). Comments and string literals are stripped before the match, so a color channel or a comment never hits. First run (WP0, before WP1): 129 hits in 132 files, 86 allowed (25 allow entries), 43 pending in 29 entries (25 entries for WP1, 3 for WP4 in `menu.ts`, 1 for WP5 in `panels.ts`), 0 unlisted. The negative control (a temp file with `export const w = 480;`) failed the test with the file named, and the test passed again after the file was deleted. The advisory derived scan listed 57 hits in 16 files.

**Baseline.** Two runs of `npm run shots` at 480x270 with the 960x540 viewport (36 tests, 4.7 minutes each, 72 shots written). 25 shots were identical between the runs: `03-dialog-portrait`, `06-bar-dialog`, `16b-enemy-poses`, `16c-boss-poses`, `18-sinkline`, `23-ending-panels`, `23b-ending-finale`, `24-ending-results`, `25-ending-next`, `29-annex-crawlspace`, `32-crowd-sprites`, `35-options`, `36-controls`, `40-deck-seat-align`, `43-shop-equip-now`, `44-shop-sell-all`, `45-menu-status-rook-wounded`, the seven `maps/*` overviews and `progress-01-cast-sprites`. **Mask list (47 shots):** `01-title`, `02-intro-panels`, `04-lantern-row-street`, `05-lantern-row-plaza`, `07-menu`, `08-menu-status`, `09-menu-equip`, `10-shop`, `10b-shop-sell`, `11-battle-command`, `12-battle-techs`, `13-battle-action`, `13b-swing-cut`, `13b-swing-gather`, `13b-swing-raise`, `13b-swing-settle`, `14-battle-combo-hint`, `15-battle-combo`, `15b-battle-triple-combo`, `16-battle-warden`, `17-battle-lurker`, `18b-sinkline-intakes`, `18c-sinkline-lure`, `19-world`, `20-rustyard`, `21-annex`, `22-battle-victory`, `26-menu-bestiary`, `26b-menu-bestiary-boss`, `27-annex-lattice`, `28-annex-panel`, `30-sinkline-intake`, `31-world-radio-lot`, `33-menu-places`, `33b-menu-place-map`, `34-game-over`, `37-annex-cryopod`, `37b-annex-cryopod-empty`, `38-battle-rat-pack`, `38b-battle-hound-pack`, `39-deck-dead`, `41-deck-seat-booted`, `42-deck-menu`, `46-battle-round-in-play`, `47-field-chest-and-marker`, `48-battle-target-box`, `49-battle-deck-cutin`. The differences are animation at the moment of capture: 0.01% (a blinking marker) to 18.5% (rain over a lit room) of a shot. Between the two runs 1,079,754 pixels differed in all. The committed `docs/screenshots` do not match run 1: 72 of 74 differ, most by more than 85% (a stale set; WP7 regenerates it).

**Perf baseline (480x270, 2026-10-07, Mark's desktop, headless Edge, `e2e/perf.spec.ts`).** Means and p95 in milliseconds per frame. "GPU" is the default run; "software" is `PW_NOGPU=1`. All gates passed. The field mean on the GPU canvas (3.60 ms) sits close to its 4 ms gate already.

| Run | Field mean / p95 | Battle mean / p95 | Sim (field, battle) mean / p95 | Title mean / p95 | Input median (move, menu) |
|---|---|---|---|---|---|
| GPU, 480x270 | 3.60 / 5.30 | 1.20 / 1.70 | 0.06 / 0.20, 0.08 / 0.20 | 0.57 / 0.80 | 14.5, 16.5 ms |
| Software, 480x270 | 3.09 / 3.50 | 1.36 / 1.70 | 0.06 / 0.20, 0.05 / 0.10 | 0.73 / 0.80 | 11.0, 16.9 ms |

The raw outputs are `media/pivot-640/perf/baseline-gpu.txt` and `baseline-nogpu.txt`. The probe numbers at 640x360 follow below.

**Verification table.** Written by the main session after the three verifiers score Step 1.

| Criterion | Median | Note |
|---|---|---|
| (pending) | | |

### Deviations from the plan in Step 1

- **Scan scope and reasons.** The plan's allow-list reasons name "color channel" and "price". The scan ignores strings and comments (as `docs/engine/frame-and-rendering.md` section 5 says), so no color channel ever hits. Prices do hit, because `src/data` is in the file set, and they sit on the allow list.
- **The allow list has two entry forms.** An entry with `match` covers one line. An entry without `match` covers every hit of that token in that file (degrees in the rig code, hertz in the audio code). Each entry has a reason. A stale entry (one that matches nothing) fails the test, so the lists stay honest.
- **`postfx.ts` center defaults.** The plan says "import `W` and `H` from `game.ts`". `game.ts` imports `postfx.ts`, so that import is a cycle. The center is read lazily, in `aberrate()`'s parameter defaults, never at module load. The two fields start at 0, which the shader ignores while the split amount is 0.
- **`battle/fx.ts` world size.** The plan says "import `BW` and `BHT`". `FxLayer` takes the world size in its constructor instead, so `src/battle` keeps importing nothing from `src/scenes` (the pure battle layer stays pure). The callers pass `BW` and `BHT`.
- **`pan()` centering.** The camera rule (clamp to the map, center a map smaller than the view) moved to one pure function, `cameraOrigin()` in `src/scenes/fieldkit/camera.ts`, so `targetCam()` and `pan()` share it and a unit test can import it without a canvas.
- **PL2 with a large mask.** The plan expected the "Autosaved" badge on the mask list. 47 of 72 shots animate between two captures (rain, water, idle motion, blinking), so a whole-shot mask would exempt most of the game. `pixel-diff.mjs --stable-from` adds the stable-pixel rule: a masked shot must still match on every pixel that both baseline runs agree on. The same-pixels claim of WP1 therefore covers all 72 shots, not 25. A deterministic capture (a fixed frame count and seeded randomness in `e2e/shots.spec.ts`) would shrink the mask; that is a spec change for WP7, or earlier if the main session wants it.
- **`display.ts` header comment.** It still says 480x270. It changes in WP2 with the exported snap function, so WP1 touches only the `src/engine` files of its own list (`postfx.ts`, `particles.ts`, `presenter.ts`).
