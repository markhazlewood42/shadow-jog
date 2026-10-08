---
type: design
title: "Shadow Jog — The move to 640x360: criteria, rubric and record"
project: shadow-jog
created: 2026-10-06
updated: 2026-10-07
status: criteria committed 2026-10-06, before any code of the move. Step 1 (WP0, WP1, 1b) recorded 2026-10-06 and verified 2026-10-07. WP2 built and recorded 2026-10-07 (verification pending). Mark approved the move on 2026-10-05 ("Let's pivot. Better now than later.")
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
| 1b | The deterministic capture: `e2e/shots.spec.ts` runs the game on Playwright's paused clock (one frame per 16 ms step, never a real-time wait), with `Date.now()` fixed (one seed for the gameplay streams), the two random encounter tables pinned to a named line-up, and a seeded `Math.random`. `SJ_BUILD_SHA` pins the build label the title draws, for a compare across commits. No game code changed. Three runs of one build are byte-identical, and PL2 is a plain 0. | None, by design. Three identical runs and the PL2 report are the evidence. |
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
- **Reviews do not block independent packages.** The agent starts the next package while Mark reviews the last one, except at a hard stop and except for a decision that needs his yes. **Hard stops** (from the plan, section 2.6; restored 2026-10-07 after the Step 1 design verifier found the list missing): D2 and D5 at Review 1, and Mark's play of the final build before the pull request leaves draft. A hard stop never takes a default. A review decision with a code-only default applies that default after 3 calendar days of silence; a decision that needs his yes never takes a default.

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

**Answered at Review 1 (Mark, 2026-10-08, after the WP2a mock pictures).** D2: **a**, re-lay the battle and the field. D5: **option 2**, more floor and a wider formation (the plan recommended 1; the mock showed each hero over its own card in option 2). Mark added that the battle will be redesigned to a side view later, so WP2b and WP6 are a **lean re-lay**: today's battle must be correct and playable at 640x360 (the constants, the rows of the other 7 backdrops, cut-ins, banners, the HUD), with new rows for the code-drawn backdrops, not new paintings, and no polish that the side view will throw away. D11: **scale**, applied to `src/data/fx.json` (`down.boss` 240 to 320, `phase` 260 to 347, `intro` 320 to 427; the ring widths stay). D10 and D14: kept as built in WP2. The details and the mock constants are in the Record ("Review 1").

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
| PL2 | **Same pixels.** After WP1 every baseline shot at 480x270 has 0 differing pixels. The baseline is stable first: three runs of one build are byte-identical, so no mask is needed. Baseline and result use the same viewport (960x540), so the compare is in game pixels. **How the capture is deterministic (Step 1b).** `e2e/shots.spec.ts` pauses the page's clock before the first navigation (Playwright's `page.clock`). The game loop's `requestAnimationFrame` and `performance.now()` come from that clock, so a frame happens only when the spec steps it (`advance(page, ms)`, 16 ms a frame), and rain, water, light flicker, cursors and idle motion land on the same frame in every run. `Date.now()` is fixed at 2026-10-06 12:00 UTC, so `src/engine/rng.ts` seeds the gameplay streams the same way every run. The `street` and `sinkline` encounter tables are pinned to one line-up each through the `sj.defineEncounter` hook, and `Math.random` is a seeded generator in the page. The game has no capture mode: nothing under `src/` changed for it. **How to run it.** `npm run shots` (about 2 minutes; start no dev server of your own, so Playwright serves the checkout under test). For a compare across two commits, set `SJ_BUILD_SHA=<label>` for both runs: the title and the title menu draw the build's commit, and that text is the one pixel difference two commits always have. **Mask list:** empty. A shot that differs is a finding, not an exemption. | `node scripts/pixel-diff.mjs <baseline> <result>`: the report and exit code 0; `--diff-out` draws any difference |
| PL3 | **Smoke check at 640x360.** In every full-screen shot not on the void-allowed list, the L-shaped area outside the old 480x270 frame (x at or beyond 480, or y at or beyond 270, in game pixels) holds at least 5% pixels that are not the clear color. This catches an empty void. It does **not** catch stretched layers, clipped text or misregistered layers. PL4, the geometry tests and the expectation list carry those checks. | `scripts/check-shots.mjs` over the regenerated set. The void-allowed list and the clear colors are in `scripts/pivot-640.json`, which mirrors this file. |
| PL4 | **No layout rect leaves the frame, and the battle layers register.** The layout recorder (built in WP4) runs over the menu panes, the shop, the modals, the dialog, the title, the ending pages, game over, the deck, the battle menus, the turn strip and the cut-ins. Every rect lies inside `W` by `H`. Every text box lies inside the window that draws it. List rows follow `H`. All 17 comic panels lie inside `8..W-8` by `8..H-18`. The exit labels and the battle strips keep their existing checks. The battle world, enemy and front layers use one scale. | `tests/recorder.ts`, `tests/ui-layout.test.ts`, `tests/layout.test.ts`, `tests/battle-geom.test.ts`. Two negative controls: a window drawn at `W-10` fails, and the old layout at 480x270 passes. |
| PL5 | **Art does not change.** `git diff --stat origin/main -- public/` is empty. Code-drawn art (battle backdrops, title world) changes only as the packages above list. | git diff |
| PL6 | **Mark's data is safe.** `git diff origin/main -- src/data src/story` is empty, with two exceptions. (a) The 3 `fx.json` values, if D11 says yes. (b) A map or story edit that cites Mark's written yes for that item in the pull request (D7 c, D17 c). A diff line outside both fails PL6. | git diff, reviewer |
| PL7 | **Scale table.** Pixel-perfect gives an exact multiple at 720p, 1080p, 1440p, 4K and the Deck window. The Fill rule table is unit tested. | Unit test, block test at k=3 and k=2 |
| PL8 | **Perf.** `e2e/perf.spec.ts` passes at the gates below, on the GPU and with `PW_NOGPU=1`. The numbers go into `docs/quality/evidence/perf.txt` at WP7. | e2e |
| PL9 | **Checks.** `npm run check`, `npm run build` and `npm run budget` pass. CI is green on the pull request at every package, and every CI step runs. A test on the expected-failure list carries a marker (below). The list only shrinks. A grep for `PIVOT-640 expected-fail` over `src/`, `tests/`, `e2e/` and `scripts/` finds nothing at WP7 (this file names the marker, so a repo-wide grep would match itself). The pull request is fully green at WP7. All 11 e2e specs pass on the GPU and with `PW_NOGPU=1`. | CI and local |
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

**The rule.** A test that the flip turns red, and that a later package fixes, carries an expected-failure marker: `it.fails(...)` in vitest and `test.fail()` in Playwright. The test body is not edited, skipped or deleted. Both runners invert the result, so a test that passes by mistake turns red ("Expect test to fail" in vitest, "Expected to fail, but passed" in Playwright). Vitest has no `describe.fails`, so each test takes its own marker. A comment on the marker names the owner package and says `PIVOT-640 expected-fail: <owner package>`. When the owner package fixes the layout, the test passes, the marker turns CI red, and the owner removes the marker. This list only shrinks. A grep for `PIVOT-640 expected-fail` over `src/`, `tests/`, `e2e/` and `scripts/` finds nothing at WP7 (PL9).

**Entries.** None. WP1 changed no pixel, so no test turned red in Step 1. WP2 (2026-10-07) ran the flip against every test and found none red: `npm run check` is green at 640x360 (28 files, 349 tests), and all 75 tests of the 11 e2e specs pass on the GPU (`npx playwright test`, 18.5 minutes). The unit tests and the e2e checks read `W` and `H`, so the flip alone breaks none of them. The tests that will turn red are ones that a later package writes (the layout recorder at WP4, the battle geometry test at WP6), and a package that needs a marker adds it to this list in the same commit. Count at WP2: **0 markers**.

---

## Record

Each step's verification table goes here: the median per criterion, the rounds used, and the pass lines with their evidence. Measured numbers go here too, so a later step can compare.

### Step 1: WP0, WP1 and 1b (2026-10-06)

**What the step did.** WP0: this file, the three screenshot tools, the literal scan with its two lists, the baseline shots and perf numbers at 480x270, and the bare-flip probe. WP1: one size source (`WORLD_SCALE`, `BW` and `BHT` derive from `W` and `H`), the shared size in `main.ts`, `fieldmap.ts`, `postfx.ts`, `battle/fx.ts` and the FX lab, `pan()` centering through `fieldkit/camera.ts`, and the comments that said 480x270; pixel-neutral by design. 1b: the deterministic capture in `e2e/shots.spec.ts` and the `SJ_BUILD_SHA` label pin in `vite.config.ts`, a new baseline taken with it on the pre-WP1 commit, and PL2 shown as a plain 0.

**Scan.** File set: every `.ts` file under `src/` (including `src/data`, so a price such as the nodachi's 480 sits on the allow list with its reason), plus `vite.config.ts` and `scripts/bundle-budget.mjs` (the kB limits of inventory rows 14 and 213). Comments and string literals are stripped before the match, so a color channel or a comment never hits. First run (WP0, before WP1): 129 hits in 132 files, 86 allowed (25 allow entries), 43 pending in 29 entries (25 entries for WP1, 3 for WP4 in `menu.ts`, 1 for WP5 in `panels.ts`), 0 unlisted. The negative control (a temp file with `export const w = 480;`) failed the test with the file named, and the test passed again after the file was deleted. The advisory derived scan listed 57 hits in 16 files. **After WP1:** 90 hits in 133 files, 86 allowed, 4 pending in 4 entries (3 in `menu.ts` for WP4, 1 in `panels.ts` for WP5), 0 unlisted. The 25 WP1 entries are gone.

**WP1 edits in `src/engine`.** `postfx.ts` (the aberration center defaults read `W / 2` and `H / 2` at call time; comments), `particles.ts` and `gl/presenter.ts` (comments). Nothing else under `src/engine` changed, and nothing under `src/sje` exists on this branch. `WORLD_SCALE`, `BW` and `BHT` live in `src/scenes/battlekit/geom.ts`; `W` and `H` in `src/engine/game.ts`; the camera rule in `src/scenes/fieldkit/camera.ts`.

**Baseline and PL2 before the deterministic capture.** The three paragraphs below are superseded by Step 1b (further down). They stay as the record of why the capture was built.

**Baseline.** Two runs of `npm run shots` at 480x270 with the 960x540 viewport (36 tests, 4.7 minutes each, 72 shots written). 25 shots were identical between the runs: `03-dialog-portrait`, `06-bar-dialog`, `16b-enemy-poses`, `16c-boss-poses`, `18-sinkline`, `23-ending-panels`, `23b-ending-finale`, `24-ending-results`, `25-ending-next`, `29-annex-crawlspace`, `32-crowd-sprites`, `35-options`, `36-controls`, `40-deck-seat-align`, `43-shop-equip-now`, `44-shop-sell-all`, `45-menu-status-rook-wounded`, the seven `maps/*` overviews and `progress-01-cast-sprites`. **Mask list (47 shots):** `01-title`, `02-intro-panels`, `04-lantern-row-street`, `05-lantern-row-plaza`, `07-menu`, `08-menu-status`, `09-menu-equip`, `10-shop`, `10b-shop-sell`, `11-battle-command`, `12-battle-techs`, `13-battle-action`, `13b-swing-cut`, `13b-swing-gather`, `13b-swing-raise`, `13b-swing-settle`, `14-battle-combo-hint`, `15-battle-combo`, `15b-battle-triple-combo`, `16-battle-warden`, `17-battle-lurker`, `18b-sinkline-intakes`, `18c-sinkline-lure`, `19-world`, `20-rustyard`, `21-annex`, `22-battle-victory`, `26-menu-bestiary`, `26b-menu-bestiary-boss`, `27-annex-lattice`, `28-annex-panel`, `30-sinkline-intake`, `31-world-radio-lot`, `33-menu-places`, `33b-menu-place-map`, `34-game-over`, `37-annex-cryopod`, `37b-annex-cryopod-empty`, `38-battle-rat-pack`, `38b-battle-hound-pack`, `39-deck-dead`, `41-deck-seat-booted`, `42-deck-menu`, `46-battle-round-in-play`, `47-field-chest-and-marker`, `48-battle-target-box`, `49-battle-deck-cutin`. The differences are animation at the moment of capture: 0.01% (a blinking marker) to 18.5% (rain over a lit room) of a shot. Between the two runs 1,079,754 pixels differed in all. The committed `docs/screenshots` do not match run 1: 72 of 74 differ, most by more than 85% (a stale set; WP7 regenerates it).

**Third baseline run (run 3, same build, taken with the WP1 edits stashed).** Run 1 vs run 3: 51 shots differ; run 2 vs run 3: 41. The mask is the union over the three pairs: **56 shots**. Run 3 added `03-dialog-portrait`, `18-sinkline`, `29-annex-crawlspace`, `35-options`, `36-controls`, `40-deck-seat-align`, `43-shop-equip-now`, `44-shop-sell-all` and `45-menu-status-rook-wounded`. Only 16 shots were identical in all three runs: `16b-enemy-poses`, `16c-boss-poses`, `23-ending-panels`, `24-ending-results`, `25-ending-next`, `32-crowd-sprites`, the seven `maps/*` overviews, `progress-01-cast-sprites`, `06-bar-dialog` and `23b-ending-finale` (the last two matched in all three baseline runs but not in the WP1 run; see below). The battle shots can never agree between runs under this spec: the encounter roll comes from `streams.battle`, seeded from the wall clock (`src/engine/rng.ts:67`); run 1 and run 3 differ by 42% on `13-battle-action` because they fought different groups.

**WP1 against run 1** (`media/pivot-640/wp1/pixel-diff.txt`, diff pictures in `media/pivot-640/wp1/diff/`): 24 shots identical, 48 differ. With the 56-shot mask, 2 unmasked shots differ: `06-bar-dialog` (5,571 px: the halos of the three neon signs, which flicker) and `23b-ending-finale` (56 px: the blinking advance arrow). 28 masked shots differ on 163,446 pixels that all three baseline runs agreed on. Ten of those pictures were read: the differences are rain streaks (`10-shop`, `10b-shop-sell`, `20-rustyard`, `40-deck-seat-align`), light flicker halos (`18-sinkline`, `29-annex-crawlspace`, `06-bar-dialog`), the pulsing lattice ring (`29-annex-crawlspace`), the Stingray mini-game's moving pins (`40-deck-seat-align`), the blinking arrow (`23b-ending-finale`), and other enemy groups in the fights (`13-battle-action`: hounds instead of punks; `48-battle-target-box` and `49-battle-deck-cutin`: a drowned shade instead of the second ghoul or the crab). No moved rectangle, clipped text or shifted layer appears in any picture. Every WP1 edit is an arithmetic identity at 480x270, and the one behavior change (`pan()` on a map smaller than the view) touches no shot and no map in the shipped chapter at this size.

**Step 1b: the deterministic capture (2026-10-06).** `e2e/shots.spec.ts` now runs on Playwright's paused clock (PL2 says how). Three runs of `npm run shots` at the branch tip (commit 103fda6; 36 tests, 2.1 minutes each, 72 shots): every pair is 72 of 72 byte-identical (`media/pivot-640/det/tip/run1..3` and the three `runX-vs-runY.txt` reports). **Mask list: empty.** One cause was found and fixed on the way: the title, Options and Controls shots carry the build label `v0.2.0-dev · <sha>`, so a run before a commit and a run after it differed in that text alone (512, 324 and 324 pixels; `media/pivot-640/det/first/`). `SJ_BUILD_SHA=<label>` in the environment of `npm run shots` pins the label (`vite.config.ts`); unset, every build keeps the real commit.

**Deterministic baseline (pre-WP1).** The two capture commits were cherry-picked onto a scratch branch at b60fded (the last commit before WP1), and `SJ_BUILD_SHA=pivot640 npm run shots` ran three times: 72 of 72 byte-identical in every pair (`media/pivot-640/baseline-det/run1..3`). The scratch branch was deleted and never pushed.

**PL2: WP1 against the deterministic baseline.** `SJ_BUILD_SHA=pivot640 npm run shots` at the tip, compared with `baseline-det/run1` (`media/pivot-640/wp1-det/pixel-diff.txt`): **72 shots, 72 same (same bytes), 0 differing pixels, no mask, exit code 0.** WP1 changes no pixel at 480x270. No WP1 edit needed a fix.

**Perf baseline (480x270, 2026-10-06, Mark's desktop, headless Edge, `e2e/perf.spec.ts`).** Means and p95 in milliseconds per frame. "GPU" is the default run; "software" is `PW_NOGPU=1`. All gates passed. The field mean on the GPU canvas (3.60 ms) sits close to its 4 ms gate already.

| Run | Field mean / p95 | Battle mean / p95 | Sim (field, battle) mean / p95 | Title mean / p95 | Input median (move, menu) |
|---|---|---|---|---|---|
| GPU, 480x270 | 3.60 / 5.30 | 1.20 / 1.70 | 0.06 / 0.20, 0.08 / 0.20 | 0.57 / 0.80 | 14.5, 16.5 ms |
| Software, 480x270 | 3.09 / 3.50 | 1.36 / 1.70 | 0.06 / 0.20, 0.05 / 0.10 | 0.73 / 0.80 | 11.0, 16.9 ms |

The raw outputs are `media/pivot-640/perf/baseline-gpu.txt` and `baseline-nogpu.txt`.

**Probe (the bare flip to 640x360 with a 1280x720 viewport, nothing else changed; same machine, same day).** All gates passed. The software field mean rose from 3.09 to 4.24 ms (1.37 times, against the 1.78 times the plan predicted from the pixel count); the software gate of 8 ms keeps a margin of 47%. The GPU numbers fell slightly, which says the "GPU" run measures CPU-side command issue, not raster time: the software canvas is the number to watch (D15).

| Run | Field mean / p95 | Battle mean / p95 | Sim (field, battle) mean / p95 | Title mean / p95 |
|---|---|---|---|---|
| GPU, 640x360 probe | 2.73 / 3.40 | 0.99 / 1.50 | 0.06 / 0.10, 0.06 / 0.10 | 0.55 / 0.80 |
| Software, 640x360 probe | 4.24 / 4.60 | 1.47 / 1.70 | 0.05 / 0.10, 0.05 / 0.10 | 0.79 / 0.90 |

The raw outputs are `media/pivot-640/perf/probe-gpu.txt` and `probe-nogpu.txt`. The probe shots are `media/pivot-640/probe/shots/` (72), the contact sheets `media/pivot-640/probe/sheet-gamepx-01..09.png` (game-pixel view, 8 pairs a page) and `sheet-1080p-01..72.png` (4x against 3x, one pair a page). The PL3 smoke check over the probe set (`check-shots.txt`): 59 shots checked, 3 failed (`02-intro-panels`, `23-ending-panels`, `23b-ending-finale`: the comic pages stay inside the old frame, 2.8 to 2.9% drawn outside it), 13 skipped as void-allowed; `35-options` (6.0%) and `36-controls` (5.1%) pass only because the dim layer covers the outer area.

**Probe pictures, by eye (61 screens; the 7 map overviews and 4 sprite sheets aside).** 32 screens show a clear defect: the 18 battle shots (the 240x135 world stretched 2.667x under a 2x enemy layer, so fighters misregister and the party is cut at the bottom edge; rows 48, 56), the title (the skyline stretched 2.667x; rows 34 to 36), the 3 comic pages (inside the old frame; row 40), the Rustyard (48 px dark bars; row 21), the two field shots with the "Autosaved" badge floating mid-frame (row 10), game over (the street line at y=244; row 39), the ending results and the next-chapter card (top-heavy; rows 37, 38), and the 4 deck scenes (the deck near the top, a gap above the dialog; row 43). 13 screens look sparse or stretched wide and wait for D8: the two dialogs (row 26), the menu cards (row 100), the two status pages (row 30), equip (row 29), the four shop shots (row 33), the two bestiary pages (row 31) and Places (row 107). 16 screens look right as they are: the 13 field shots without a badge, the two modals, and the place map. Every defect maps to an inventory row; the pictures add no new row.

**Verification table.** Written by the main session after the three verifiers score Step 1. Round 1 of 3, 2026-10-07, at commit 1e6d7e5. Three fresh verifiers: A correctness and tests, B design conformance and code quality, C visual and runtime. Full reports: `media/verification/step1/verifier-correctness.md`, `verifier-design.md`, `verifier-visual.md` (git-ignored). **Result: pass.** Every pass line holds, every median is 7 or more, and the average of the medians is 8.31.

| Criterion | A | B | C | Median | Note |
|---|---|---|---|---|---|
| R1 Coverage | 8 | 7 | n/a | 7.5 | Pending list 43 to 4, each with an owner. `render.ts:88` still sets a bare `2` (inventory row 52): named fix F1. |
| R3 Pixel fidelity | 9 | 8 | 9 | 9 | PL2 reproduced by A (saved runs) and C (a fresh capture): 72 of 72 same, 0 pixels. |
| R6 Performance | 7 | n/a | 8 | 7.5 | Inside every gate at 480x270 (C re-measured). GPU field mean about 10% under its gate. Bundle headroom 1.9 kB. |
| R7 Test quality | 8 | 7 | 8 | 8 | Negative controls fire (scan, pixel diff, smoke check). Gaps: the `pan()` wiring has no test, `stripNoise` has no test, pixel-diff on two empty folders exits 0. |
| R8 Behavior kept | 9 | 9 | 8 | 9 | No data, save or `src/game` change. The aberration start values are ignored by the shader. |
| R9 Code clarity and records | 8 | 7 | n/a | 7.5 | Each size name defined once. Named fixes F2, F3, F5 (records) and the `art` to `scenes` import (F4). |
| V2 Parity | 10 | n/a | 10 | 10 | PL2 plus three controls; art and data diffs empty. |
| V4 Stability | 8 | 8 | 9 | 8 | Byte-identical over six runs and two commits, on one machine and one Edge build. `SJ_BUILD_SHA` changes only the label box. |

n/a for Step 1 (the game still draws at 480x270): R2, R4, R5, V1, V3, V5.

| Pass line | Result | Evidence |
|---|---|---|
| PL1 | pass | Scan 5 of 5; 90 hits, 25 allow entries, 4 pending, 0 unlisted; the negative control fails the test with the file named (A). |
| PL2 | pass | A: saved runs, 72 same, 0 pixels, exit 0, and a 1-pixel control is seen. C: a fresh `SJ_BUILD_SHA=pivot640 npm run shots`, sha256 of all 72 files equal to `baseline-det/run1..3`. |
| PL5, PL6 | pass | `public/`, `src/data`, `src/story` diffs empty (A, B, C). |
| PL8 | pass | C at 480x270: GPU field 2.71 / 4.30 ms, software field 3.19 / 4.30 ms, sim at most 0.07 / 0.20 ms. |
| PL9 | pass | `npm run check` exit 0 (26 files, 320 tests), build 0, budget 0 (234.1 kB gzip of 236). CI run 37717221925: `check`, `e2e`, `e2e-engines` pass, no step skipped. The `claude-review` check (the Claude Code Review workflow from `main`, run 37717221926) failed in 24 s before any model ran (`is_error: true`, `modelUsage: {}`): a workflow problem on `main`, outside this branch. It must be green by WP7. |
| Principle 4 | pass | `src/engine` edits: `postfx.ts`, `particles.ts`, `gl/presenter.ts`, all on the list. No `src/sje`. No `!` added in `src/engine` or `src/battle`. |
| PL11 | as reported | The Review 0 sheets reached Mark on 2026-10-06. |

**Named fixes, made in the first WP2 commit** (the score 7 means "acceptable with named fixes that the step makes"):

- F1: `src/scenes/battlekit/render.ts:88` uses `WORLD_SCALE`, not a bare `2` (pixel-neutral).
- F2: `docs/DEVELOPING.md` documents the three screenshot tools, the scan test and its two lists (`SCREEN_LITERALS_WRITE_PENDING`), `scripts/derived-literals.mjs` and `tests/camera.test.ts`; the wrong "section 4" cross-reference is fixed.
- F3: the golden-image entry of `docs/CONCEPTS.md` says the mask list is empty since 1b.
- F4: `src/art/battlebg.ts` stops importing `scenes/`: the world-size names move to a leaf module below `art` and `scenes`, or `docs/ARCHITECTURE.md` gets a dated exception line until M0.
- F5: American spelling in the rewritten `postfx.ts` comments.
- A2: `e2e/shots.spec.ts` waits in real time until the battle (and the deck) scene is on top before the first clock step (a latent race that held in all runs).
- A3: a test pins the `pan()` wiring, so a revert to the old inline clamp fails.
- C3 and C4: `scripts/contact-sheet.mjs` captions come from the real sizes; `scripts/pixel-diff.mjs` names a diff folder only when it wrote one.
- The grep of PL9 for `PIVOT-640 expected-fail` covers `src/`, `tests/`, `e2e/` and `scripts/` (this file names the marker, so a repo-wide grep would match itself).

Not fixed here, with the owner: the scan does not cover `tests/`, `e2e/` and `scripts/` (inventory row 234; WP7 decides with the reconciliation table). C finding 5: shots that show off-screen content in the probe (for example the LABS room in `27`, `37`, `37b`) go on the PL12 content list at WP3. From Review 1 on, the left side of every pair is `baseline-det/run1`, so battle pairs show the same line-up.

### Deviations from the plan in Step 1

- **Scan scope and reasons.** The plan's allow-list reasons name "color channel" and "price". The scan ignores strings and comments (as `docs/engine/frame-and-rendering.md` section 5 says), so no color channel ever hits. Prices do hit, because `src/data` is in the file set, and they sit on the allow list.
- **The allow list has two entry forms.** An entry with `match` covers one line. An entry without `match` covers every hit of that token in that file (degrees in the rig code, hertz in the audio code). Each entry has a reason. A stale entry (one that matches nothing) fails the test, so the lists stay honest.
- **`postfx.ts` center defaults.** The plan says "import `W` and `H` from `game.ts`". `game.ts` imports `postfx.ts`, so that import is a cycle. The center is read lazily, in `aberrate()`'s parameter defaults, never at module load. The two fields start at 0, which the shader ignores while the split amount is 0.
- **`battle/fx.ts` world size.** The plan says "import `BW` and `BHT`". `FxLayer` takes the world size in its constructor instead, so `src/battle` keeps importing nothing from `src/scenes` (the pure battle layer stays pure). The callers pass `BW` and `BHT`.
- **`pan()` centering.** The camera rule (clamp to the map, center a map smaller than the view) moved to one pure function, `cameraOrigin()` in `src/scenes/fieldkit/camera.ts`, so `targetCam()` and `pan()` share it and a unit test can import it without a canvas.
- **PL2 with a large mask.** The plan expected the "Autosaved" badge on the mask list. 56 of 72 shots differ between runs of one build: the capture frame moves rain, water, light flicker, idle motion and cursors, and the fights roll other enemies each run because `src/engine/rng.ts` seeds the gameplay streams from the wall clock. A whole-shot mask would exempt most of the game, so `pixel-diff.mjs --stable-from` adds the stable-pixel rule (a masked shot must still match on every pixel that all baseline runs agree on) and `--diff-out` draws every difference. Three baseline runs were taken instead of two. Even so, PL2 for WP1 rests on the stable-pixel compare and on reading the diff pictures (all animation or encounter rolls, no layout change), not on a plain 0. **The fix is a deterministic capture in `e2e/shots.spec.ts`**: a fixed seed for the streams (a `?seed=` query the debug build honors), pinned encounter groups (`sj.defineEncounter`, as shots 38 and 38b already do), a fixed capture frame (stop `game.tick`, then step a fixed number of ticks, as shot 13b does), and a stubbed `Math.random` for the one visual use (`deck.ts` sparks). That is a spec change; the plan puts the spec in WP7. **Built in Step 1b, before WP2** (the main session's decision). The capture uses Playwright's paused clock instead of a `?seed=` query or a stopped `game.tick`, so no game code changed; the mask list is empty and PL2 is a plain 0 (the Step 1b record above).
- **`display.ts` header comment.** It still says 480x270. It changes in WP2 with the exported snap function, so WP1 touches only the `src/engine` files of its own list (`postfx.ts`, `particles.ts`, `presenter.ts`).
- **Dates.** The Step 1 builder wrote 2026-10-07 in this file as instructed, while the machine clock read 2026-10-06. Step 1b set every Step 1 date to 2026-10-06, the local date of the work.

### Answers recorded at Step 1b (the main session, 2026-10-06)

- **Perf gates (Step 1 question 2).** Both PL8 gates apply as written, GPU and software. No change.
- **`25-ending-next` and `34-game-over` (question 3).** They stay on the void-allowed list. WP5 re-centers them, and the visual verifier checks them by eye (the expectation list).
- **WP2b (question 4).** It stays its own package.

### WP2: the flip, the 2x viewport, the engine floor (2026-10-07)

**Commits (branch `resolution-640x360`).** `3fde408` the Step 1 named fixes (made first, at 480x270); `29a289d` the flip, the viewport, the snap rule, the shake gain and their tests; the next commit holds this record, the CHANGELOG and the new CONCEPTS entries.

**What changed.**

- The flip: `W = 640`, `H = 360` (`src/engine/game.ts`, still the one source). The battle world is 320x180 at 2x through `WORLD_SCALE`. Nothing else in `src/` changed for the flip: no layout is re-laid yet, so many screens look wrong (see the pictures below), as the plan says.
- The viewport is 1280x720, an exact 2x, in `playwright.config.ts`, `scripts/shot.mjs` and `scripts/pixellab/render-maps.mjs` (rows 75, 215, 216; the render script now shoots `#screen`, and `artreview.html` shows its pictures 1280 px wide). Row 79 (`scripts/trailer.mjs`): its 1920x1080 viewport stays, because it is exactly 3x of 640x360 (it was 4x); the header comment says so. `e2e/fxlab.spec.ts` keeps its own 1440x810 viewport and passes.
- The snap rule (D14): `cssScaleFor` in `src/engine/display.ts` is the Fill-mode rule as a pure function (`Display.resize` calls it). The 90% rule is unchanged. `tests/display.test.ts` pins the window table below.
- PL7 block test: `e2e/gpufx.spec.ts` (two tests) turns the GPU layer off, sets Pixel-perfect mode, and reads the `#screen` canvas: every game pixel is a k-by-k block of one color, the canvas size is the game size times k, and the browser shows the canvas at its own size. k=3 at 1920x1080 and k=2 at 1280x800: 0 uneven blocks each.
- The shake (D10): `Game.shake` multiplies the authored strength by `SHAKE_PIXEL_GAIN` (4/3). The strength stays unrounded, and `shakeOffset` already rounds each frame's offset to whole game pixels, so a scene still moves by whole pixels (an authored 1 to 5 becomes a frame-0 kick of 1, 3, 4, 5, 7). The player's Screen shake setting multiplies after the gain. Glow and haze are unchanged. `tests/shake.test.ts` pins the values.
- `tests/screen-literals.allow.json`: the two `game.ts` entries now list the tokens 640 and 360 only.

**Negative controls (R7).** (1) The snap table: changing the 90% line to 80% fails 4 tests of `tests/display.test.ts` (the 1536x864, 1600x900 and 1440x900 rows and the line test); restored, 22 of 22 pass. (2) The block test: drawing the back buffer 5 pixels too narrow in `Display.present` gives 107,870 uneven blocks at k=3 and 83,062 at k=2, and both tests fail; restored, both pass. (3) The `pan()` test: putting the old inline clamp back in `fieldkit/api.ts` fails "aims a map smaller than the view at its centered origin" (expected x -120, got 0). (4) The shake test: a gain of 1 fails 3 of 5 tests.

**Snap table** (the rule at 640x360, device pixel ratio 1; "fit" is the largest scale that shows the whole frame; the 90% test is the whole multiple divided by fit).

| Window | fit | Fill | Pixel-perfect |
|---|---|---|---|
| 1280x720 | 2.000 | 2x | 2x |
| 1280x800 (the Steam Deck window) | 2.000 | 2x | 2x |
| 1366x768 | 2.133 | 2x (94%) | 2x |
| 1440x900 | 2.250 | 2.25x (89%, resampled) | 2x |
| 1536x864 | 2.400 | 2.4x (83%, resampled) | 2x |
| 1600x900 | 2.500 | 2.5x (80%, resampled) | 2x |
| 1920x947 (a maximized browser) | 2.631 | 2.631x (76%, resampled) | 2x |
| 1920x1080 | 3.000 | 3x | 3x |
| 2560x1440 | 4.000 | 4x | 4x |
| 3840x2160 | 6.000 | 6x | 6x |

The common sizes are exact in both modes. Four awkward windows (1440x900 up to a maximized 1920x947) are resampled slightly in Fill mode, as inventory row 223 predicted. D14 is Mark's call (keep 90%, lower the line, or default to Pixel-perfect); this step changes no rule.

**Perf (PL8, D15).** `npx playwright test e2e/perf.spec.ts --reporter=line`, Mark's desktop, headless Edge, 2026-10-07. Means and p95 in ms per frame. The raw outputs are `media/pivot-640/perf/wp2-gpu.txt` and `wp2-nogpu.txt`. The first run at the bare flip, before the other WP2 commits, is `wp2-flip-gpu.txt` and `wp2-flip-nogpu.txt`, and agrees.

| Run | Field mean / p95 | Battle mean / p95 | Sim (field, battle) mean / p95 | Title mean / p95 | Gate (mean / p95) |
|---|---|---|---|---|---|
| GPU, 480x270 baseline | 3.60 / 5.30 | 1.20 / 1.70 | 0.06 / 0.20, 0.08 / 0.20 | 0.57 / 0.80 | 4 / 6 |
| GPU, 640x360 probe | 2.73 / 3.40 | 0.99 / 1.50 | 0.06 / 0.10, 0.06 / 0.10 | 0.55 / 0.80 | 4 / 6 |
| **GPU, 640x360, WP2** | **2.84 / 4.00** | **1.42 / 2.80** | 0.04 / 0.10, 0.07 / 0.10 | 0.81 / 1.70 | 4 / 6 |
| Software, 480x270 baseline | 3.09 / 3.50 | 1.36 / 1.70 | 0.06 / 0.20, 0.05 / 0.10 | 0.73 / 0.80 | 8 / 11 |
| Software, 640x360 probe | 4.24 / 4.60 | 1.47 / 1.70 | 0.05 / 0.10, 0.05 / 0.10 | 0.79 / 0.90 | 8 / 11 |
| **Software, 640x360, WP2** | **4.10 / 4.80** | **1.95 / 3.20** | 0.04 / 0.10, 0.05 / 0.10 | 0.94 / 1.20 | 8 / 11 |

Every gate passes as it is, with margin: GPU field 2.84 of 4 (29%) and p95 4.00 of 6; software field 4.10 of 8 (49%) and p95 4.80 of 11. The software field mean rose 1.33 times from 480x270 (the plan predicted 1.78 times); the PL8 ceilings (12.5 and 14.5 ms) are far away. **D15: no gate changed and no optimization was made**, because none was needed. The simulation gates are untouched (at most 0.07 ms mean). The slow-frame guard (row 333: 90 frames above 40 ms turn the GPU effects off) is far from tripping: the slowest frame in any run was 7.6 ms on the GPU and 5.9 ms on the software canvas. Caveats: the battle measured here still has its old 480x270 layout inside a 640x360 frame (WP2b and WP6 re-lay it), so its cost can change; the numbers come from one machine; the GPU run measures command issue, not raster time (the probe note says the same). The CI run on the draft pull request gives the software numbers on the CI runner. PL13 (CI wall time) is the main session's to record.

**Expected-failure list.** 0 markers (see the section above). `npm run check`: lint 0, types 0, 28 files and 349 tests pass. All 11 e2e specs on the GPU, 75 tests, pass. The software canvas (`PW_NOGPU=1`) ran `perf.spec` only; CI runs the rest on software.

**Scan (PL1).** `tests/screen-literals.test.ts` passes: 90 hits in 134 files, 86 allowed (25 allow entries), 4 pending in 4 entries (3 in `menu.ts` for WP4, 1 in `panels.ts` for WP5), 0 unlisted. The file count rose by one (`src/art/worldsize.ts`, which has no hit). WP2 adds no screen-size literal.

**Effects sheet (D10, rows 4 and 5).** `media/pivot-640/wp2/effects-sheet-01.png`: the same battle (two Rustfang punks on the street backdrop) at 480x270 (left) and 640x360 (right), the same zoom per game pixel, GPU effects on, two moments each: bloom with heat haze and embers, and glitch with a shockwave and a color split. The same calls in game pixels made both sides. Judged by eye: the GPU presenter draws bloom, haze, glitch, the shockwave ring and the color split correctly at 640x360; no tear, no wrong-scale layer, no black edge. The glow and the haze are 25% finer relative to the screen, because they are sized in game pixels (D10 default: unchanged). Mark may ask for the bloom radius to scale by 4/3.

**D11 proposal (not applied; `src/data/fx.json` is unchanged).** The three screen-wide shockwave reaches, each authored for a 480-wide screen:

| Moment | Field | Now | Proposed (x 4/3) |
|---|---|---|---|
| `intro` | `intro.layers[0].shock.reach` | 320 | **427** |
| `phase` | `phase.layers[0].shock.reach` | 260 | **347** |
| `down.boss` | `down.boss.layers[1].shock.reach` | 240 | **320** |

I propose all three at x 4/3. The ring has to cross the same share of the screen as before: 320 reached 116% of the center-to-corner distance at 480x270 (275 px), and 427 reaches the same 116% at 640x360 (367 px). A reach of exactly 367 (the row 141 note) would touch the corners only at the end of the ring's life, when it has faded, so the corners would barely show it. The ring's speed in screen pixels also stays the same, because `reach` over `life` scales with the pixel. `phase` and `down.boss` start at the Warden's position, not the center, and keep their share of the screen width (54% and 50%). No other `fx.json` value changes (`width` and `strength` are the ring's thickness and push in game pixels, tied to the look). Mark approves the three values in the FX lab; the edit is his data (PL6 exception a).

**Pictures** (git-ignored, `media/pivot-640/wp2/`): `effects-sheet-01.png`; `sheet-gamepx-01..09.png` (the 72 shots at 640x360 beside `baseline-det/run1`, game-pixel view; the caption says the baseline comes from 960x540 and the result from 1280x720); `small-maps/rooks-flat.png`, `loading-dock-7.png`, `rustyard.png` (the field view at 640x360: the flat is 224x160 px and the Dock 320x224, centered in a brick shell or a dark void; the Rustyard, 544x448, has 48 px bars at the sides). The 72 new shots are in `shots/`, the smoke check in `check-shots.txt`: **59 shots checked, 3 failed** (`02-intro-panels`, `23-ending-panels`, `23b-ending-finale`: the comic pages are drawn inside the old frame, 2.8 to 2.9% outside it, the same three as the probe), 13 skipped as void-allowed. PL3 is not an exit line of WP2; the count is recorded only.

**Step 1 named fixes (made in `3fde408`).** F1 `render.ts` uses `WORLD_SCALE` for the enemy layer. F2 `docs/DEVELOPING.md` documents the scan, its two lists, the three tools, `derived-literals.mjs` and `camera.test.ts`, and the cross-reference is fixed. F3 the golden-image entry of `docs/CONCEPTS.md`. F4 the leaf module, not an exception line: `WORLD_SCALE`, `BW` and `BHT` are defined once in `src/art/worldsize.ts`, which imports only `W` and `H`; `scenes/battlekit/geom.ts` re-exports them (the other files import from `geom` unchanged), and `art/battlebg.ts` imports the leaf, so `art` imports nothing from `scenes` any more; the unused `BW` and `BH` exports of `battlebg.ts` are gone. F5 American spelling in the two rewritten `postfx.ts` comments. A2 `e2e/shots.spec.ts` (see the deviation below). A3 `tests/camera.test.ts` pins `pan()` (the control above). C3 the contact-sheet captions come from the PNG sizes (the sheets above say 960x540 and 1280x720 by reading the files). C4 `pixel-diff.mjs` names a diff folder only when it wrote a picture, and it also exits 2 when the two folders share no shot (design verifier finding F6). The PL9 pass-line text and the expected-failure rule now say the grep covers `src/`, `tests/`, `e2e/` and `scripts/`.

**Deviations from the plan, with reasons.**

- **A2 moves three baseline shots, so PL2 holds for 69 of 72 shots against `baseline-det/run1`, and for all 72 against a re-captured baseline.** The brief asked for a real-time wait "until the battle and the deck scenes are on top". A fight cannot be on top before a clock step: the push waits 18 game frames after the flash, and frames need steps. What happens in real time is the download of the lazy chunk, so `warm()` fetches the chunk (a `modulepreload` link: it downloads the module and its imports but does not run them) before the first step. A probe (one page, `sj.run(deck)`, one frame step at a time) showed the race is real: with no warm-up the deck scene is pushed on frame 2 when the dev server has to compile the chunk and on frame 1 when it is cached; with `warm()` it is always frame 1. The three deck shots (`39-deck-dead`, `40-deck-seat-align`, `41-deck-seat-booted`) therefore show the deck one or two frames earlier than the old baseline did, and the rain and light flicker behind it land on other frames: 14,297 differing pixels in all (0.91 to 0.93% of each shot; the diff pictures are rain streaks and light halos). The 69 other shots, the battle shots included (the battle chunk is already loaded at boot), match `baseline-det/run1` byte for byte. To show that the Step 1 fixes themselves are pixel-neutral, the three deck shots were captured three times at the pre-fix source with the new spec (byte-identical runs, `media/pivot-640/wp2/deck-oldsrc/`), and `media/pivot-640/wp2/baseline-v2/` is `run1` with those three files replaced. `node scripts/pixel-diff.mjs media/pivot-640/wp2/baseline-v2 media/pivot-640/wp2/fixes-det`: **72 shots, 72 same, 0 differing pixels, exit 0** (`fixes-det-pixel-diff.txt`). Against the unchanged `run1`: 69 same, 3 differ, 14,297 pixels (`fixes-det-vs-run1.txt`). If Mark wants the old deck timing back, remove the `warm(page, 'deck')` line; the three shots then match `run1` again, but the capture depends on how fast the dev server answers.
- **Shake: the strength is scaled, not rounded.** The brief says "rounded to whole game pixels". Rounding the strength first would leave a strength of 1 at 1 (no gain) and push 2 to 3 (+50%). The strength stays exact (x 4/3), and the existing `Math.round` in `shakeOffset` makes each frame's offset whole, so scenes still move by whole game pixels.
- **The block test lives in `e2e/gpufx.spec.ts`**, not in a 12th spec file, so the count of 11 e2e specs holds. It runs with the GPU layer off, because with it on the visible picture is the WebGL canvas, not `#screen`.
- **No performance work and no gate change** (D15's own branch: every gate passes).
- **The expected-failure list is empty**, so there is no marker to demonstrate.
- **An observation, not a WP2 finding.** In a dev page, `sj.tp('dock', 10, 7, 'down')` called from the town (or from Rook's flat) crashes the browser tab, in real time and at 480x270 too (checked with a temporary 480x270 build). The dock's `onEnter` cutscene (`betrayal`, `src/data/maps/annex.ts`) is the probable cause; setting `sj.state.flags.chapter_end = true` first skips it. The dev route `?scene=field&map=dock` and the story path work. Not investigated further; the small-map picture was taken with that flag set.

**Verification table.** Round 1 of 3, 2026-10-08, at commit cf0a8a2. Three fresh verifiers: A correctness and tests (Haiku), B design conformance (Haiku), C visual and runtime (Sonnet; Mark asked on 2026-10-07 for the smallest model that does each job). Full reports: `media/verification/wp2/verifier-correctness.md`, `verifier-design.md`, `verifier-visual.md` (git-ignored). **Result: pass.** The WP2 exit lines PL7, PL8 and PL13 hold, every median is 7 or more, and the average of the medians is 8.27.

| Criterion | A | B | C | Median | Note |
|---|---|---|---|---|---|
| R1 Coverage | 7 | 8 | n/a | 7.5 | 14 rows spot-checked, each with a commit or a reason. Row 224 (flash) needs its note: named fix. |
| R3 Pixel fidelity | 8 | 9 | 9 | 9 | Exact blocks at 7 window sizes (C); one scale in every battle layer. |
| R6 Performance | 8 | n/a | 7 | 7.5 | Inside every gate locally. CI software field mean 6.89 and 7.28 ms against the gate of 8 (9 to 14% headroom): named fix. |
| R7 Test quality | 8 | 8 | 8 | 8 | Controls fire: the 90% rule at 80% fails 4 tests, a 1.5% too large canvas gives 190,535 uneven blocks, the old clamp fails the `pan()` test. |
| R8 Behavior kept | 9 | 9 | 9 | 9 | All 11 e2e specs pass on the GPU; balance and economy pass; no save stores a screen value. |
| R9 Code clarity and records | 8 | 7 | n/a | 7.5 | One place per name; `art/worldsize.ts` is a leaf (F4). Doc errors and a copied helper: named fixes. |
| V1 Exactness | n/a | n/a | 9 | 9 | 0 uneven blocks at k=2, 3, 4 and 6, on the backing store and the browser picture. |
| V2 Parity | 7 | n/a | 8 | 7.5 | The fix commit is pixel-neutral (see "PL2 reference" below). |
| V3 One pixel grid | 7 | 8 | 9 | 8 | Edge histograms peak at x mod 4 = 0 in the backdrop and the party (C). No test pins `BW * WORLD_SCALE = W`: named fix. |
| V4 Stability | n/a | n/a | 9 | 9 | Two fresh 640x360 runs: 72 of 72 byte-identical, equal to the builder's set. |
| V5 Legibility | n/a | n/a | 9 | 9 | Cap height 21 device px at k=3 and 14 at k=2 (the bar is 14). |

n/a at WP2: R2, R4, R5 (WP2 added no layout defect: every wrong-looking screen equals the bare-flip probe or is better).

| Pass line | Result | Evidence |
|---|---|---|
| PL7 | pass | C: 0 uneven blocks at 1280x720, 1280x800, 1366x768, 1440x900, 1920x1080, 2560x1440, 3840x2160. A: 22 unit tests of the snap table; the 80% control fails 4. |
| PL8 | pass | C, GPU: field 2.63 / 3.40 ms, battle 1.11 / 2.40. Software: field 4.19 / 5.10, battle 2.32 / 3.90. No gate moved. |
| PL13 | pass | CI 7m55s (29a289d) and 6m51s (cf0a8a2), three jobs green, no step skipped. |
| PL1, PL5, PL6, PL9 | pass | Scan 4 pending, 0 unlisted, the `640` control fails it; `public/`, `src/data`, `src/story` diffs empty; `npm run check` 0 (349 tests), build 0, budget 0 (234.1 kB gzip); no expected-fail marker. The `claude-review` check stays red (the workflow on `main`). |

**PL2 reference from WP2 on.** The A2 fix (`warm()` preloads the battle and deck chunks in `e2e/shots.spec.ts`) changed when the deck scene is pushed: frame 1 always, where the old spec gave frame 1 or 2 depending on the server cache. Shots `39`, `40` and `41` therefore differ from `baseline-det/run1` by 14,297 px (rain and light phase); the other 69 are byte-identical. Verifier C's 2x2 control on 08e8d29: the old source with the old spec reproduces `baseline-det/run1` byte for byte, and the old source with the new spec reproduces `baseline-v2` byte for byte. So the move comes from the spec alone, and the fix commit is pixel-neutral (0 px against `baseline-v2`). **`media/pivot-640/wp2/baseline-v2/` is the 480x270 reference from here on.** The race is closed, so the old timing is not kept.

**Named fixes, made in the first commit of the next package** (WP2b, or WP3 if D2 is not a):

- R6: record the CI software numbers in the WP2 perf table. D15: no gate fails, so no gate moves now. WP3 (PL8 plaza) re-checks the CI field mean first; if it reaches the gate of 8 ms, apply D15 (optimize, then re-set inside 12.5 / 14.5 ms with a note).
- V3: a unit test pins `BW * WORLD_SCALE === W` and `BHT * WORLD_SCALE === H`.
- R1: the row 224 note (the flash is an alpha wash, `src/engine/game.ts:381-386`, so it needs no scale).
- R9: `docs/CONCEPTS.md:311` says "one pixel narrow", the Record says 5 px: make them agree. `docs/engine/migration.md:26` says 7 `src/engine` files, the branch changes 5. `tests/camera.test.ts:25` comment names the wrong sizes. `shotNames` moves to `scripts/lib/` (copied in `check-shots.mjs`, `contact-sheet.mjs`, `pixel-diff.mjs`). `docs/GLOSSARY.md`: add `cssScaleFor`, `SHAKE_PIXEL_GAIN` and `art/worldsize.ts`, or record that the glossary holds no code names.
- `e2e/gpufx.spec.ts:49-50` takes its point from `W` and `H` (not 240, 120), and `e2e/fxlab.spec.ts:12` uses an exact-multiple viewport (not 1440x810).

**For Mark at Review 1, from the verifiers.** D10: the shake keeps its on-screen size only roughly, because offsets round to whole game pixels (strength 5 moves the picture 4 game pixels, was 3). Glow and haze are 25% finer relative to the screen; he may ask for the bloom radius times 4/3. D11: the proposal scales the shockwave reach, not the ring width, so the intro ring is 25% thinner on screen. WP7 owns a GPU-on presenter test (C finding 3).

### Review 1 (2026-10-08)

**What Mark saw.** The WP2 contact sheets (72 pairs, game pixels), the effects sheet, the three small maps (Rook's flat, Loading Dock 7, the Rustyard), the visual verifier's block, shake and shockwave pictures, and the WP2a mock: the street battle with one enemy and with four, each as A boxed (D2 b), B the bare flip, C D5 option 1 and D D5 option 2, at 1080p (k=3). PL11 holds for WP2.

**Answers.** D2 a, D5 option 2, D11 scale (applied), D10 and D14 kept; the battle re-lay is lean because a side-view battle replaces it later (see "Answered at Review 1" under the decisions).

**The WP2a mock (throwaway).** It ran on the local branch `resolution-640x360-battle-mock` (one commit on 40827bc, never pushed), deleted after this review. Constants in world rows unless noted. Bare flip: `PANEL_Y` 214 (screen), `PARTY_BOTTOM` 127, `HORIZON` 62, ground 94. Both options: `PANEL_Y = H - 56` = 304, `PARTY_BOTTOM = BHT - 8` = 172, railings at 149. **Option 2 (chosen):** `HORIZON` 84 (+22), ground 116, party step 58, enemy gap 20. Option 1: `HORIZON` 107, ground 139, skyline heights times 1.6. The pictures and the mock notes stay in `media/pivot-640/wp2a/` (git-ignored).

**Problems the mock found, for WP2b and WP6.** (1) The bare flip leaves about 90 screen px of dead floor under the cards. (2) With a party step of 44, heroes sit 15 to 47 screen px off their own cards; option 2's 58 nearly aligns them. (3) The cut-ins use `y = 132 - row * 62`: at 640x360 they float about 114 px above the cards, and the row-1 cut-in covers the turn strip. (4) The VICTORY banner sits at a literal `y = 58`. (5) The turn strip now fits all 8 entries; check the `+N` overflow rule and `layout.test`. (6) Option 1's extra sky is a plain gradient; the lit-signs rule (`y < 44`) was tuned for the old head band. (7) The skyline is drawn with a scaled `rng.int`, so it differs between options. (8) The rain count is fixed at 70, thinner per pixel at 320x180. (9) One enemy in option 2 stands far from the party on a deep floor. (10) The other six backdrops share `HORIZON` and are wrong in the mock; the enemy fallback position (`BW / 2`, 60), the damage-number floor and the FX lab positions were not exercised. D6 (the HUD) is asked at Review 2.
