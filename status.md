---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-10-09
milestone: none
tags: [status]
---

# Shadow Jog

Browser JRPG: a cyberpunk-fantasy setting with the Phantasy Star IV game loop. Chapter 1, "Milk Run", covers the town
(Lantern Row), the world map (the Sprawl), an outpost (the Rustyard) and a two-floor dungeon (the Sinkline B1 and
K-M Annex 7). About 45–75 minutes. Design lives in `docs/GDD.md`.

**GitHub:** [markhazlewood42/shadow-jog](https://github.com/markhazlewood42/shadow-jog) (public).
- **CI:** GitHub Actions, on pushes to `main` and on pull requests: three jobs at the same time (`check`, `e2e`, `e2e-engines`), all three required on `main` by the ruleset "Main branch protection" (2026-10-06). A docs-only change skips their steps. The real-speed playtest runs in `playtest.yml` after a merge and from the Actions button.
- **Since 2026-10-01** work goes on a branch per major feature, with a PR for the Claude Code Review Action, and Mark merges.

## Where we left off (2026-10-05)

> **In review (2026-10-07): the Command Center build** on branch `command-center`, [PR #21](https://github.com/markhazlewood42/shadow-jog/pull/21). All 12 tasks are done and verified, the whole-branch review and its fix wave are done, and the live decision round trip passed: a fresh agent raised [issue #20](https://github.com/markhazlewood42/shadow-jog/issues/20) with the rule, Mark answered it on the Decisions page (Decision: A), and a second fresh agent read the answer with the rule's commands and named it. Decision A is recorded: the home-base `CLAUDE.md` points at the "Decisions for Mark" rule. Copilot's two review findings are fixed. Task 13 (Mark's three small live-feedback items) is in. PR #21 merged on 2026-10-07 (00:40 UTC) at 0928ac3, before the last four commits landed: those (the Copilot fixes, Task 13 and this status) are [PR #22](https://github.com/markhazlewood42/shadow-jog/pull/22) on branch `command-center-fixes`, merged on 2026-10-07 (02:58 UTC). Mark's larger Command Center feedback (see "Next for agents" 1) is a follow-up PR. The build ledger is the git-ignored `.superpowers/sdd/plan/progress.md`. Side work on 2026-10-06: PR #18 (American spelling in `docs/engine/`) and PR #19 (`ci-faster`: three CI jobs at once, docs-only changes skip their steps, the playtest runs after a merge) are merged. A PR's CI now takes about 7 minutes instead of about 19.

### The whole process so far
1. **Build (2026-09-27 → 28).** From the original prompt (`docs/original-prompt.md`) to a content-complete chapter:
   town, world map, outpost, two-floor dungeon, four party members, 21 enemies and three bosses, nine combos, an
   economy, a story with a comic-panel intro and ending, 15 songs and 69 sound effects, all generated in code (16 and
   72 since playthrough 2).
2. **Quality loop (rounds 1–12, 2026-09-28 → 29).** Eleven areas scored by fresh independent reviewers each round.
   The average went 6.36 → 7.98. All of it is in `docs/quality/GRADING.md`; scores in `docs/quality/scorecard.md`.
3. **Exit (2026-09-29).** Round 12 was the last automated round; Mark's own playthrough became the gate.
4. **Playthrough 1 (2026-09-29).** Mark played part of the chapter and left 25 notes
   (`docs/mark-playthrough-notes.md`). All 25 were worked through; `docs/quality/playthrough-1.md` answers each (what
   changed, where to see it, the commit) and lists the judgment calls. Big pieces: slower, readable battles (one
   animation clock, a beat between turns, longer transition, slower timed presses, a Battle speed setting still there);
   damage-type symbols; a louder "who's acting"; fixed menu and turn strip; the shop's slot tag, equip-now and sell-all;
   Chapter 1 now ends around **level 6** (new XP curve), new abilities are rare (three by level) and a level-up fully
   restores; **Rook is a level-10 veteran who starts wounded** and heals in two story beats; **Hex's deck** (seen dead,
   the Stingray seated by hand, a Deck page with slots for later parts, a mini deck in battle); Sinkline encounters
   1 in 40; field depth cues (relief shadows, Sprawl facades and curbs, Sinkline caps and edges); glowing chests and
   an interact marker; finer, smaller creature art; Last Rites Arms (was Iron Saint Arms).
5. **Round 13 (at Mark's request).** One verification round: ten areas re-scored plus a reviewer checking each note
   (21 addressed, 4 partial). Average **7.22** (round 12: 7.98): regressions this work introduced (New Game started
   Rook at 3, old saves didn't migrate, broken screenshot navigation hid a Bestiary overflow, clipped labels, …) were
   all fixed after the reports (de5fff5, c7c055b), with tests; the rest is trade-offs the notes asked for and older
   findings scored more strictly. The fixed state isn't re-scored. Reports: `docs/quality/reviews/round-13.md`.
6. **Playthrough 2 (2026-09-29, same save, to just past the Lurker).** 14 more notes, all worked through;
   `docs/quality/playthrough-2.md` answers each. Big pieces: enemies no longer gang up on Hex (they lean, 1.5×, on
   whoever is lowest by percent, per Mark's follow-up); boss tells pinned on screen until acted on; healing skills get a
   green timed ring (+30% on the beat); a real level-up moment (fanfare jingle, stats counting up, restore, new
   abilities); valve, pipe and pump sounds; the equip screen shows the highlighted slot's gear with stat diffs; damage
   types written by name carry their symbol everywhere; Kit's own bed is a free rest; the inn's price line fixed; the
   stray examine twinkles removed; Dutch's hat centred; clothes rails in Kowloon Threads; a taller APTS block; shop tags
   name only crew you've met. Verified with unit tests, the affected E2E specs and hand checks of each screen (no
   scored round: Mark didn't ask for one).
7. **Phase 0.2, the pivot phase (2026-10-02 → 04).** Release `v0.1.0` and the bump to `0.2.0-dev` are done. The pronoun canon is set. A side-view battle spike is PR #3 (GO, Mark, 2026-10-04: the side-on view is the game's battle view). A Phaser tooling spike with a Battle Stage Editor and Battle Test is PR #4 (GO, Mark, 2026-10-04, for the tooling scope, not a port of the game). Neither PR merges. Details are in "Right now" and `docs/PHASE-0.2.md`.
8. **Engine decision (2026-10-04, evening).** Mark wants a low-poly, real-time 3D hacking mode inside the 2D game (inspired by the Shadowrun Genesis Matrix). After three research rounds (3D feasibility, engine choice, resolution), he chose **our own engine on PixiJS v8 plus Three.js for 3D**. This supersedes the Phaser rebuild. No Unity or Godot replatform. No engine code before he approves an architecture design doc. Record: `docs/research/2026-10-04-engine-and-3d.md` and decision 17 in `docs/PHASE-0.2.md`.

9. **Phase 0 spike and the size decision (2026-10-05).** The platform spike (draft PR #11, never merged) built the engine kernel on Pixi v8, the 3D path with Three.js on one shared WebGL2 context, the battle stage slice (exact pixel parity with the Phaser spike) and the 480x270 against 640x360 mock. Every step passed the independent verification loop. Mark chose **640x360**: the art keeps its size, and more of the world shows. The spike re-measured every size-dependent exit criterion at 640x360, and all of them hold. The Result section of the spike doc is a draft: recommended GO, Mark decides.

### Right now (2026-10-10, M3 merged)

M3 "Battle stage" is merged ([PR #51](https://github.com/markhazlewood42/shadow-jog/pull/51), Mark looked at the pictures and approved). It was built on branch `engine-m3-battle-stage`: the battle plays on the Pixi stage under `?engine=sje` (HUD, fx painters, 640x360 stage set, enemy and encounter JSON, parity harness, seeded status trace). Lean loop: round 1 (runner all green; reader 3 Important, fixed in e8219cf), round 2 passed. GPU run (RTX 4070): live battle interval p95 18.10 ms (bare 18.10), cost p95 3.40 ms. Main merged in (M1b). Bundle: shipped total cap 401 kB, new flag-only class 42 kB. Record: `docs/engine/m3-brief.md` section 9. Pictures: `media/m3-stage/gpu/index.html`.

**Next for agents:** M4 (optional UI scenes) and M5 (field) can start now, in parallel. Write the brief with pass lines first.
**Next for agents:** M4 (optional UI scenes) and M5 (field) can start after the merge.

### Right now (2026-10-09, M2 merged)

**M2 "Effects" passed the lean loop and merged (PR #47).** Round 1 found 4 Important (fixed in edf49a0, 5c0c45e), round 2 found none. GPU run on the RTX 4070 held the speed line (numbers in `docs/engine/tooling-and-testing.md` section 7). Bundle total set to 394 kB (measured 393.0). The record is in `docs/engine/m2-brief.md` section 6. Look note for Mark: the composite uses nearest sampling, so sub-pixel tails vanish in some effects (evidence only). Pictures: `media/m2-fx/`.

**M1b "3D proof" merged ([PR #49](https://github.com/markhazlewood42/shadow-jog/pull/49), 2026-10-09).** Cube as a `Scene3D`: GPU interval p95 16.80 ms, cost p95 6.30 ms. Record: `docs/engine/m1b-brief.md` section 6.

**Next for agents:** see `docs/roadmap/roadmap.json` for the next open milestone (M3 runs in its own worktree).

**Next up for Mark**

1. After the PR is open: play checkpoint 2 and merge, or send work back.

### Right now (2026-10-09, M1 merged, history)

**M1 "Shell" is merged** ([PR #46](https://github.com/markhazlewood42/shadow-jog/pull/46)). The three spike branches are tagged `archive/engine-platform-2026-10-09`, `archive/phaser-stage-2026-10-09` and `archive/side-battle-2026-10-09` (Mark's go-ahead; the branches stay). Six M1 commits carry a `Co-Authored-By` line in `main`; Mark chose to leave them. **Next is M2 "Effects"** (`docs/engine/migration.md` M2) on branch `engine-m2-effects`, with M1b (3D proof) in parallel. Write the M2 brief with pass lines first. GPU timing check once at the end of M2.

**Next up for Mark**

1. Start the M2 session (the agent offers the starting prompt).

### Right now (2026-10-09, M1 built, history)

**Milestone M1 "Shell" is built and verified on branch `engine-m1-shell`; the PR is open for your merge.** The new engine plays title, field, battle and shop under `?engine=sje` (runtime, `LegacyScene`, integer `Display`, `fxLevel`, DEV hook). Round 1: the runner passed every hard line; the reader found 4 Important and 2 Minor findings, all fixed and re-checked in fix round 1 (b185224). GPU run (`npm run perf`, RTX 4070): the speed line holds (2D cost p95 6.9 ms, 3D 7.1 ms, interval at the bare-page value); wrapper overhead 0.015 ms for 1,000 objects. Record: `docs/engine/m1-brief.md`. Your decisions: one bigger bundle total (now 380 kB), `fit` dropped (`integer` only). Visible on the default path: the Options "Scaling" row is gone.

**Next up for Mark**

1. Look at the M1 pictures (old and `?engine=sje` of title, field, battle, shop), then merge the M1 PR.
2. Decide whether to strip the `Co-Authored-By` lines from six pushed commits (needs a force-push), or leave them.
3. The spike archive tag (Q3), after the merge.

**Next for agents:** milestone M1b (3D proof) and M2 (Effects) run in parallel after the merge. Write the brief with pass lines first.

### Right now (2026-10-09, M1 start, history)

**Milestone M0 "Prepare" is merged** ([PR #43](https://github.com/markhazlewood42/shadow-jog/pull/43), 2026-10-09, merge e7ee706, no game change), after the 640x360 move (PR #23). CI is green. **Next is M1 "Shell"** on branch `engine-m1-shell` (made from `main`, nothing built yet) in the worktree `projects/shadow-jog-engine`. Milestone text: `docs/engine/migration.md` section M1. The M0 plan and record: `docs/engine/m0-brief.md`.

CI changes made in the M0 PR (Mark, 2026-10-09): **CI runs no timing gate.** `e2e/perf.spec.ts` (frame budget, input latency, engine speed line) is local only: `npm run perf` on a real GPU, once at the end of M1, M2, M3, M5, M6 and M7, never per PR (`docs/engine/migration.md` principle 12). The draw-call counts run in CI in `e2e/sje-draws.spec.ts`.

**Next for agents** (in this order):
1. Milestone M1 "Shell" (`docs/engine/migration.md`): write the M1 brief with pass lines first (as for M0), then build and verify with the lean loop. The game bundle has only 7 bytes of room under the 240.8 kB alarm, so the next change to shipped code needs a deliberate alarm change that Mark confirms.
2. At the end of M1: the GPU timing check (`npm run perf`), once.
3. The spike archive tag (`spike/engine-platform` and the other spike branches): only with Mark's go-ahead.

**Next up for Mark** (updated 2026-10-09):
1. Start the M1 session (the agent offers the starting prompt).
2. The older items still stand: Sprite Fusion credits, your uncommitted playthrough-notes edit, the PixelLab end date, the archive tags for PR #3 and #4.

### Right now (2026-10-09, M0 build, history)

**The 640x360 move is merged** (PR #23, merge 6bcd8dc, 2026-10-09). The game runs at 640x360. **Milestone M0 "Prepare" is built and verified** on branch `engine-m0-prepare`, [PR #43](https://github.com/markhazlewood42/shadow-jog/pull/43), ready for review (no game change). Plan, pass lines, builder report and fix round: `docs/engine/m0-brief.md`. Milestone text: `docs/engine/migration.md` section M0. Verification (lean loop): round 1 (runner and reader) found 7 Important, all fixed in ac4616b; round 2 passed with one fresh verifier. Records in `media/verification/m0/` (git-ignored).

M0 state: done, PR #43 waits for review and merge. Decisions taken by the main session on 2026-10-09 (small, reversible; change them if you disagree): move every `W` and `H` import (about 42 files, not 34); the lab pages build in dev and CI only, not in production `dist/`; starting bundle caps are `boot` at today's alarm and `lazy-3d` at 160 kB (C5), with `first play` report-only until M1; the M0 PR goes through the Claude Code Review Action; the lab scripts the canaries need are copied from `media/research-2026-10-04/`.

### Right now (2026-10-05, history)

**Phase 0 is done. Mark approved the final engine design on 2026-10-05, with all 9 recommendations.** PRs #15 and #16 are merged (#16 is the design update, merge 959ddf4). The design gate is lifted: M0 may start after the 640x360 move of the shipped game. The 9 recommendations:
- C1: `roundPixels` is off.
- C2: The E3 fallback keeps one private Three renderer, with a fourth hand-off rule.
- C3: The E19 policy is strict.
- C4: The watchdog waits 1 second.
- C5: The E17 `lazy-3d` cap is 160 kB. M1 and M6 confirm it.
- C6: M1 decides the E13 `fit` mode. The mode may retire.
- C7: E22 grows to 19 deviations.
- The content-to-data placement: enemies at M3, shops and dialogue at M4, maps at M5.
- The hidden-scene 3D draw skip and the context grace go in M7.

Branch `spike/engine-platform` (draft PR #11). Record: `docs/spikes/engine-platform.md` (the S1a section has the 640x360 numbers, and the Result is drafted). CI is green through d61d7d9. The last push, 913aead (S1a), went up at the end of the session.

**The command center (Mark, 2026-10-05).** Mark approved the command center design and the implementation plan. Both are on branch `command-center`: `docs/command-center/design.md` and `docs/command-center/plan.md`. **The Command Center exists (2026-10-06).** It is a local website in `tools/command-center/`: the Now page, the docs site, the engine decision table, the Agents page and the decision pages. Start it with `npm run cc` from the repo root (http://localhost:3009; the guide is `tools/command-center/README.md`). The live decision round trip passed on 2026-10-07 (issue #20, Decision: A). PR #21 merged on 2026-10-07; PR #22 carried the review fixes and Mark's three small items; it merged on 2026-10-07. The follow-up for Mark's larger feedback started the same day on branch `command-center-feedback` (see "Next for agents" 1).

**The size is 640x360 (Mark, 2026-10-05).** He first kept 480x270 after the mock, then chose 640x360 the same day from the screenshots. Impact on the code:
- No architecture change. Both engines read the size from one constant.
- About 43 of 131 source files in the shipped game change: 20 scene files with hand-placed layouts, 7 files in `src/engine`, and a few others. Tests, scripts and docs change too.
- The larger content items: 8 battle backdrops (drawn in code at 240x135, they become 320x180), 16 maps and rooms smaller than the new view (a camera rule centres and fills them, with no map data change), the dialog width (a cap keeps today's line breaks), and the old battle (re-lay it now, or box it in a 480x270 frame until M3 replaces it).
- Migration principle 4 bends: the move changes 7 files in `src/engine` before M0. Mark approved the move "now".

**Working files for the next session** are git-ignored, on Mark's machine only: `media/handoff-2026-10-05/README.md` explains the design-update draft, the inventory of all 398 size-dependent sites, the scoping plan (use its order, not its estimates) and the comparison pictures.

**Mark's rules from 2026-10-05** (also in home-base `CLAUDE.md` and memory): effort means architectural fit and files touched, never agent-days; all work goes through independent verification agents, sized to risk; at a phase break, the work continues in a fresh session. His idea backlog is `docs/IDEAS.md`. Entry 1 is a standing rule: no decision may make future visual editors harder.

**Mark's rule from 2026-10-08:** every build in this repo, the Command Center and the 640x360 move included, uses the lean verification loop in `CLAUDE.md`.

**The 640x360 move (2026-10-06 to 09): Step 1 and WP2 to WP7 done, Reviews 1 to 6 answered; Review 7 (Mark plays the build) next.** Branch `resolution-640x360` in the worktree `projects/shadow-jog-engine` (an approved exception to the no-worktree rule while another session owns the main checkout). Draft [PR #23](https://github.com/markhazlewood42/shadow-jog/pull/23), CI monitor on. Done: Step 1 (WP0 criteria, tools, scan and baselines; WP1 one size source at 0 differing pixels; 1b the deterministic capture), verified in round 1 (average 8.31); WP2 (the flip to 640x360, the 1280x720 viewport, the snap-rule test, the shake times 4/3, the PL7 block test, perf inside every gate, 0 expected-failure markers, the Step 1 named fixes), verified in round 1 (average 8.27); the WP2a mock and Review 1 (2026-10-08): D2 a (re-lay), D5 option 2 (more floor, wider formation), D11 applied to `fx.json`, D10 and D14 kept. Mark said the battle becomes a side view later, so WP2b and WP6 are a lean re-lay (correct and playable, new rows for code-drawn backdrops, no paintings, no polish). WP2b (2026-10-08): the battle re-laid for 320x180 (panel at `H - 56`, each hero over their own card, `HORIZON` 84, ground rows from `HORIZON`, the street backdrop and four framings, cut-ins and banners), one `HUD_FRAME` rect for every HUD anchor, `tests/battle-geom.test.ts`; verified in round 2 (round 1 failed on R9 only; average 8.23). Review 2 (2026-10-08): D6 option 1, the HUD hugs the screen edges. WP3 (2026-10-08): field weather by area, the small-map surrounds and the pop-in fixes, the overhead-layer clip, best-of-3 perf sampling; three verifier rounds, failed at the cap on R6 and R9 (a perf gate raised without need, stale comments), and Mark accepted it with named fixes for WP4's first commit. Review 3 (2026-10-08): D7 indoor maps edge-fill (b1), outdoor maps themed surround (b2); D17 P1 b, P2 b, P3 b, P4 a; the Rustyard strip's contrast lifted. The drift merge of `origin/main` (2026-10-08, ba53d51, 100 commits, no game code). WP4 and WP5 (2026-10-08, one build in two parts, one round): the WP3 named fixes (the software perf gate back at 8 / 11 ms), the dialog capped at 464 px, the menu panes capped at 364 px, row counts from `H`, the shop list 240 px, the Status page, the layout recorder (`tests/recorder.ts`, `tests/ui-layout.test.ts`) with its two negative controls, `tests/dialog-wrap.test.ts` (0 changed lines), the title world at 320x180, the 17 panel rects, the ending, Game over and the deck re-centered; verified in round 1 (pass: the runner and the reader of the lean loop; 8 named fixes for the next commit). Reviews 4 and 5 (2026-10-08): D8 dialog 464, panes 364, party cards kept, shop 240 with the sprite overlap fixed; D9 logo 4x, portraits 2x everywhere, the compositions confirmed; D20 alarm 240.7 kB confirmed. Bundle 240.5 kB gzip. WP6 (2026-10-09, minimal): the Review 4 and 5 answers applied (the review switches deleted), the 8 named fixes (the shop sprites clear of the names), the impact lines `hypot(W, H) / 2`, the FX lab, the recorder on 7 battle screens; round 1 failed (five backdrops still spaced for 240 px; stale switch docs), round 2 passed. Review 6 (2026-10-09): Mark confirms the round 2 backdrops. WP7 (2026-10-09): `docs/screenshots` regenerated at 640x360 in one commit (label `pivot640`; the two stale 960x540 files gone), `render-current.mjs` derives its crop from `W` and `H`, the gpufx spec spreads over the full width, the evidence run and `perf.txt` (GPU field 2.89 / 3.9 ms, software 3.99 / 5.2 ms; every gate holds), the bundle 240,788 bytes gzip so the alarm went up 88 bytes to 240.8 kB (D20, for Mark to confirm), the reconciliation table of R1 (398 rows) in `docs/PIVOT-640.md`; round 1 failed on PL3 (`24c` not on the void-allowed list), round 2 passed. All 11 e2e specs pass on the GPU and with `PW_NOGPU=1`; CI 7m25s. The tables and the named fixes are in the Record of `docs/PIVOT-640.md`. Handoff: the git-ignored `projects/shadow-jog-engine/media/handoff-2026-10-08/README.md` (updated after WP4 and WP5).

**Next for agents** (in this order). **Roadmap rule:** every status update also touches `docs/roadmap/roadmap.json` and runs `npm run roadmap`. The chart is `docs/roadmap/roadmap.svg`, one click from the Command Center docs ("Roadmap"). `tests/roadmap.test.ts` fails when the chart, the data, `status.md` `milestone:` and the `migration.md` table disagree.
1. Command Center: done (2026-10-08). Revision 2 (Mark's live feedback of 2026-10-07: short pages, the Status summary, the doc copy and download buttons, the live Agents diagram) is merged as [PR #26](https://github.com/markhazlewood42/shadow-jog/pull/26) (merge 4a6dff7), with the fixes from two Claude reviews of it (20 comments: 11 fixed, 2 deferred, 2 known, 5 false positive or unproven) and Mark's three decisions (an unknown line in a session file is ignored, `+N more` counts children only, "CI on main" reads the `ci.yml` run only). The follow-ups are merged too: [PR #36](https://github.com/markhazlewood42/shadow-jog/pull/36) (the `Command Center` workflow, `.github/workflows/command-center.yml`: typecheck, Vitest and Playwright for a change to `tools/command-center/`, `docs/`, the root `*.md` files or the decision issue template; not a required check; the runner has no GPU, so the glass is off there, 5 tests are skipped and 4 more check only the plain mode, so a green job does not test the glass) and [PR #37](https://github.com/markhazlewood42/shadow-jog/pull/37) (a torn process file is read again after one shared 50 ms pause, the README names `Session not active`, test gaps closed). The build record (the git-ignored `.superpowers/sdd/plan/`) was deleted on 2026-10-08, after an audit: the rulings and the process are in `docs/command-center/design.md`, `docs/command-center/process.md`, the tool README and the description of PR #26.
1a. Live checks for the faster CI (PR #19, merged 2026-10-06): (1) Done 2026-10-06: the first `playtest.yml` run on `main` (run 37518417311) passed in 7 min 40 s. (2) On the next docs-only PR, `check`, `e2e` and `e2e-engines` report success in seconds with their steps skipped, and its merge to `main` starts no CI run (`gh run list --repo markhazlewood42/shadow-jog --branch main -L 3`).
1b. Command Center, what is left (all optional): not fixed and listed in the body of PR #26: the `scanFile` re-read of up to 1 MiB for each live session every 3 seconds (an incremental scan by byte offset), the flash token in the key of a message line (a line jumps instead of sliding), pid reuse after a crash (a ghost session), the diagram line motion in Chromium and Edge only, and smaller test gaps (Task 19b: seven call sites with no pinned message; Task 15 and 16 leftovers). The review workflow keeps `synchronize` (Mark's call) and runs the built-in `/code-review` at `medium`: it stops at about 10 findings for each run, repeats earlier points on every push, and once reviewed files that were not in the PR (bug report filed: [claude-code-action#1890](https://github.com/anthropics/claude-code-action/issues/1890)). The unused `ANTHROPIC_API_KEY` secret is deleted (2026-10-08): if a workflow or tool fails for a missing `ANTHROPIC_API_KEY`, something used it after all. Mark's own item: an upstream bug report for the plasma-ui canvas width (R28), if he wants one.
2. The 640x360 move: done. [PR #23](https://github.com/markhazlewood42/shadow-jog/pull/23) merged on 2026-10-09 (6bcd8dc), after Review 7 (Mark played the build and confirmed the 240.8 kB alarm), the WP8 verifier and the review triage. The worktree `projects/shadow-jog-engine` now holds milestone M0 (branch `engine-m0-prepare`). Still to do after the merge: remove the `CLAUDE.md` "until it merges" clause. See `media/handoff-2026-10-08/README.md` for the process rules.
2a. The roadmap chart (2026-10-09, branch `roadmap-gantt`): `docs/roadmap/roadmap.json` is the one source, `npm run roadmap` writes `roadmap.svg` and the README, and the Command Center docs have a "Roadmap" section. Order and dependency only: no dates.
3. Milestone M0 (active, branch `engine-m0-prepare`). The spike archive tags need Mark's go-ahead and wait until the battle stage lands (M3).

**Next up for Mark** (updated 2026-10-09, after the PR #23 merge):
1. Nothing waits for you on the Command Center: PR #26, #36 and #37 are merged. Optional: the upstream bug report for the plasma-ui canvas width (R28).
2. The 640x360 move: done. You merged PR #23 on 2026-10-09. Nothing waits for you on it.
3. The older items below (Sprite Fusion credits, your uncommitted playthrough-notes edit, the PixelLab end date, the archive tags for PR #3 and #4) still stand.

### Right now (2026-10-04, history)

**Engine decision (Mark, 2026-10-04, evening. This supersedes the Phaser rebuild below.)** Shadow Jog gets its own engine, with PixiJS v8 as the 2D renderer and Three.js for a low-poly 3D hacking mode that fits seamlessly into the 2D game. Unity and Godot were researched and not chosen. No judge picked Pixi. It is Mark's call for per-object GPU effects, and the platform spike must test Pixi filters, masks and parity with the Phaser stage. **Design gate:** Mark must approve an architecture design doc before any engine code. The doc covers the architecture, the key interfaces, the core primitives and the tooling. It copies conventions from Phaser first, then Unity or Godot, and from Three.js for 3D. The resolution stays 480x270 for now. W and H become one shared module, and a 640x360 mock comes in the platform spike. The side-view battle view, the stage design, the editor's behaviour (`docs/TOOLING-UI.md`) and Mark's design data all stay. The Phaser spike code is the reference for the port. Full record: `docs/research/2026-10-04-engine-and-3d.md` (the raw results and bench code are in the git-ignored `media/research-2026-10-04/` on Mark's machine).

**The plan now.** (1) The architecture design doc, on its own branch, for Mark's approval. It includes the shared W/H module, which must exist before any engine code. (2) A platform spike that tests the approved design: the battle stage on the new engine, a 3D hacking scene entered from a story script, and the 480x270 against 640x360 mock. (3) Mark approves the final design. (4) The build on feature branches with Copilot review: the battle stage, the Battle Stage Editor and the Battle Test first, then the troop editor, the Animation Composer, hero poses and humanoid enemies. The rest of the 2D game moves to Pixi later, on a path the design doc costs.

**The design (approved by Mark on 2026-10-04, all recommendations)** is [PR #10](https://github.com/markhazlewood42/shadow-jog/pull/10). Every build step goes through the lean verification loop in `CLAUDE.md` (Mark, 2026-10-08); the three-verifier loop of `docs/engine/verification.md` section 1 is the older record. `docs/engine/` holds 8 files: README, scene graph, frame and rendering, interfaces, conventions, tooling and testing, migration, decisions. It follows Phaser 4's architecture and names over Pixi v8, with ideas grafted from the Godot-style and Unity-style proposals (all three judges picked the Phaser-faithful design). The lab evidence is in `docs/research/2026-10-04-engine-labs.md`. Effort estimates in `docs/engine/migration.md` (agent working days, low confidence, your review time extra): Phase 0 platform spike 7 to 11 days, then M0 to M8 47 to 65 days without the optional M4. The 3D mode (M7) comes after the default flip (M6) in that plan.

**Both pivots are a GO (Mark, 2026-10-04).** (The Phaser parts are superseded by the engine decision above. The side-view GO still stands.) The side-on battle view is the game's battle view. Phaser was the base for the battle stage, its editor (the Battle Stage Editor), the Battle Test and the next "Shadow Jog Engine" tools. A port of the rest of the game (field, town, menus) is not part of the GO. Mark did not run the timed "Try it" test in a formal way. He called GO from the work he saw. Mark also confirmed that no spike PR merges: "we don't need more GO/NO GO branches. I was mistaken about merging." Each GO is rebuilt on a real feature branch from the spike code, with a Copilot review, and Mark merges that branch. [PR #3](https://github.com/markhazlewood42/shadow-jog/pull/3) and [PR #4](https://github.com/markhazlewood42/shadow-jog/pull/4) stay open drafts as references. The spike records and the tooling UI guide are on `main` now (`docs/spikes/`, `docs/TOOLING-UI.md`). The plan is decision 10 in `docs/PHASE-0.2.md`.

**The earlier plan (superseded by the engine decision above).** (1) The rebuild: a feature branch from the spike code on `spike/phaser-stage`. (2) Archive tags for both spikes, then close PR #3 and PR #4. (3) The troop editor. (4) The Animation Composer. (5) Poses for all four heroes. (6) Humanoid enemies. The bundle budget (233.4 kB against a 236 kB alarm) is re-set on purpose in the rebuild, because Phaser adds about 350 kB gzipped. The dependency policy allows this.

**Next up for Mark** (in this order, updated 2026-10-04, evening):
1. **Done 2026-10-04: you approved the design with all recommendations.** Merge [PR #10](https://github.com/markhazlewood42/shadow-jog/pull/10) when its `check` job passes (docs only). The Phase 0 platform spike is under way on its own `spike/` branch. You get screenshots whenever a test renders something.
2. **Then the platform spike.** It tests the approved design: the battle stage on the new engine, a 3D hacking scene, Pixi filters and masks, and 480x270 against 640x360. You judge the look, with two review rounds at minimum and no upper limit.
3. **Approve the final design,** with the spike results in the doc. The build starts only then.
4. **Spend the next Sprite Fusion credits on the shopping list** when you are ready (see "Sprite Fusion" below). Also explore the Sprite Fusion API (new model, nine style-reference sizes, a build-time script, the key in the git-ignored `.env.local`). Details are in `docs/PHASE-0.2.md`, Pivot 3.
5. Your edit to `docs/mark-playthrough-notes.md` is still uncommitted in the main checkout. It holds one open request: improve the scrap hounds, which look janky. Commit the file or keep it local, as you wish. Your reference images in `docs/references/` (Shadowrun Genesis and low-poly) stay local. They are third-party screenshots and the repo is public, so agents never commit them.
6. PixelLab ends around 2026-10-30. Decision 5 in `docs/PHASE-0.2.md` is still open.
7. The archive tags for PR #3 and PR #4 wait until the battle stage lands on the new engine. Agents ask you then.
8. Older backlog is in What happens next > Still open from before the pivots. It waits until the items above are done.
9. Optional: delete the remote branches `release-prep-0.1.0` (merged) and `copilot/main` (made by Copilot) on GitHub.

**State on 2026-10-04**
- **Versions and releases.**
  - `v0.1.0` is an annotated tag and a GitHub pre-release, made on 2026-10-03 on merge commit `81bc0f8` ([release page](https://github.com/markhazlewood42/shadow-jog/releases/tag/v0.1.0)). The release-prep PR was [PR #2](https://github.com/markhazlewood42/shadow-jog/pull/2).
  - `main` is `0.2.0-dev`. [PR #5](https://github.com/markhazlewood42/shadow-jog/pull/5) merged on 2026-10-03. Saves now record `meta.appVersion`. A slot saved by a newer version shows "Saved by a newer version", not "damaged".
  - A GitHub ruleset, "Main branch protection", is active on `main`. It requires a pull request and a passing `check` job. It blocks deletion and force-push. It requires no approving review.
  - Mark is new to GitHub release management and asked to be taught as we go. `docs/DEVELOPING.md` section 9 holds the how-to.
- **Pronoun canon.** [PR #6](https://github.com/markhazlewood42/shadow-jog/pull/6) merged on 2026-10-04 (UTC), and Mark deleted its remote branch. Kit is she/her, Rook is he/him, Hex is they/them, Sable is he/him. Kit and Rook are human, Hex is a dwarf, Sable is an orc (Mark said "ogre". The canon word in `docs/GLOSSARY.md` is orc.) An old save gets Hex's new objective wording when it loads (commit `0fb06a7`, from the Copilot review). `docs/GLOSSARY.md` records the canon.
- **Side-view spike** ([PR #3](https://github.com/markhazlewood42/shadow-jog/pull/3), draft, never merge, branch `spike/side-battle`). **Result: GO (Mark, 2026-10-04).** The side-on view is the game's battle view from now on. The spike doc and the stage design are copied to `main` as the record (`docs/spikes/side-battle.md`, `side-battle-stage.md`). The code stays on the branch. PR #3 stays an open draft until the rebuild lands, then it is archived and closed. A design tournament picked a 3/4 "arena" stage with a side-view HUD (`docs/spikes/side-battle-stage.md`). The PS4 portrait row is gone. Heroes stand on the left and face right. Enemies stand on the right. Battle sprites are Mark's Sprite Fusion crew (about 64 px). The spike doc's "Result" section records the call, the size (Mark's ~64 px crew) and what to rebuild.
- **Phaser tooling spike** ([PR #4](https://github.com/markhazlewood42/shadow-jog/pull/4), draft, never merge, branch `spike/phaser-stage`, CI fix `8ad78bf`, doc `docs/spikes/phaser-stage.md`, now also on `main`). **Result: GO (Mark, 2026-10-04)** for the tooling scope: the battle stage, its editor and the Battle Test built natively in Phaser, and Phaser as the base for the next tools. Not a port of the rest of the game. Mark did not run the timed "Try it" test in a formal way. He called GO from the work he saw. PR #4 stays an open draft until the rebuild lands, then it is archived and closed.
  - **What exists.** Phaser 4.2.1 and the DEV-only pages `/stagelab.html` and `/stageedit.html`. The shipped game has no Phaser in it. Scores: arena stage 8.0, Battle Stage Editor 8.3, Battle Test with Rook's strike 8.25, HUD 8.0. CPU p95 is about 1 ms per frame.
  - **Mark's hands-on pass.** He tested the editor and left 9 notes (`mark-tooling-notes.md`, git-excluded). All 9 are done, plus polish and bug-fix rounds.
  - **Mark's decisions.** The battle HUD is global (`src/data/hud.json`), and a stage can override single boxes. A stage-rule break is a live warning in the editor (a "Warnings (n)" chip and red outlines). It never blocks a save. The laptop zoom stays as it is.
  - **Scope rule (Mark).** A stage holds only its own layout: backdrop, floor, rows, and hero and enemy positions. A setting that belongs to a character or to the whole game is a global file, edited under an "all battles" label. The global files are `hud.json` (a stage can override it), `enemyfacing.json` and `heroes.json` (no stage override).
  - **Enemy facing.** `enemyfacing.json` mirrors the punk, ghoul, maint, shade and sentinel, so every enemy faces the heroes. The spacing rules measure the full drawn outline, weapons included. Enemy slots were nudged to obey them. Warnings went from 20 to 2. The 2 left are on the Warden boss groups and are informational.
  - **Hero proportions.** `heroes.json` holds a height and a build for each hero ("method B"). The bake adds or removes whole rows and columns inside the body. The head (top 28%) and the feet (bottom 6%) stay. Columns change only in the middle 20% to 80% of the width. The editor inspector has "Proportions · this hero, all battles".
  - **Mark's own editor pass** (commit `a5a3f73`). Height and build: Kit 1.11 and 1.00, Rook 1.07 and 1.08, Hex 0.85 and 1.00, Sable 1.34 and 1.18. He moved enemy slots for the wider heroes. Rook's sprite is drawn taller (68 px against 63 px for Kit), so Rook still comes out taller than Kit.
  - **Tests versus design data** (commits `3d06e7c` and `37a4273`). Tool tests use frozen fixtures in `tests/fixtures/stagedata/`. Tests of the shipped files check only these invariants. The files load. There are four heroes. Ancestry order holds on the baked heights. The editor warnings equal `rules.ts`. The fixed list `MARKS_FIGURE_BREAKS` is gone. Each of the 11 stage rules has a deliberate-break fixture test. The rule is in `docs/DEVELOPING.md` ("Tests vs design data", now on `main`) and `docs/TOOLING-UI.md` section 5 item 19 (also on `main`). `npm run check` passes with 779 tests. The stage and Battle Test e2e specs pass 135 and skip 5 (they need an env var).
  - **CI on PR #4.** One e2e failed on GitHub: `e2e/stageedit.spec.ts:500` "Align: select Rook ...". It expected that the four heroes do not fit on the back row. On CI, Mark's sprite folder is absent, so stand-in sprites are used, and all four fit. It was a test bug, not a game bug. Commit `8ad78bf` fixes it. The test now measures the room and the hero widths and accepts both outcomes. It passed locally with Mark's art and with stand-ins (`STAGELAB_NO_SPRITES=1`). The CI run on `8ad78bf` was still running when this was written. The CI state is in PR #4. Another CI-only e2e failure (a label that wraps in Linux fonts) is being fixed on the spike branch (fix pushed as `9179d98`, CI result not checked). Do not read this status as "CI is green".
  - **Research done.** The OpenBOR and MUGEN gap research (depth and frame-by-frame ideas) is recorded in `docs/TOOLING-UI.md`.
  - **Open spike items.** Minor align issues. The 2 top-HUD warnings on the Warden boss groups. The "Result" section of the spike doc records the GO.
- **Sprite Fusion.** Mark uses it. His sprites live in the git-excluded `spritefusion-tests/` and are never committed. He paused because his lowest credit tier ran low. Simple idles and walks work well from animate. Complex moves work better as a static pose plus frame-by-frame edits. 8-direction sets are unusable. The next credits go to the shopping list: missing reactions, Hex and Sable moves, and side-facing enemies.
- **Working environment for the next session.**
  - The main checkout is on `main` (PR #8 is merged and `side-view-go` is deleted). Your uncommitted notes edit stays in the working tree through any branch switch.
  - `spritefusion-tests` in the Phaser checkout is a link to the folder in the main checkout. Do not delete it.
  - There are two checkouts only. `projects/shadow-jog` is the main checkout. It holds Mark's uncommitted edit to `docs/mark-playthrough-notes.md`. `projects/shadow-jog-phaser` is on `spike/phaser-stage`. It is the one accepted extra checkout (Mark's rule). Do not make worktrees or other folders.
  - Never stage these Mark files: `docs/mark-playthrough-notes.md`, `mark-tooling-notes.md`, `spritefusion-tests/`, `pixellab-tests/`, `rook-battle-idle.webp`. Stage by explicit path. Do not use `git add -A` or `git add .`.
  - Never change the values in `src/data/*.json` on the spike branch. That is Mark's design data.
  - Mark starts his own dev servers when he tests (port 3007, from the Phaser checkout). Ask before a job that reloads his editor page. Never kill his server. Never touch ports 3002 to 3006.
  - Both checkouts use port 3007 for `npm run dev`. Only one server can run there. Ask Mark before you start another.
  - The process rules are in memory. Work done "on your own" iterates with fresh judge agents to a minimum rubric score of 8 out of 10. Dependencies are fine if they are high quality and free. Tooling UI follows RPG Maker where it overlaps, plus the scope rule above.

### Earlier "Right now" notes (history, as of 2026-10-03 and before)
- **Superseded "Next up" list of 2026-10-04 (before the GO calls).** (1) Merge two status PRs: shadow-jog PR #7 and home-base PR #13. Both are merged. (2) Do the hands-on test of the Phaser tooling spike and call GO or NO-GO by 2026-10-09. Mark called GO on 2026-10-04 without the formal timed test. (3) After the Phaser call, archive the side-view spike and pick the next build steps. The archive now waits for the rebuild, and the build steps are in decision 10. (4) Sprite Fusion credits, (5) the scrap-hounds request, (6) optional branch cleanup, (7) PixelLab decision 5, (8) the older backlog. All of these carried over, except (1) to (3).
- **Phase 0.2 (the pivot phase) opened 2026-10-02.** Mark is exploring three pivots: a side-on or 3/4 battle view at smaller scale, a Phaser port, and Sprite Fusion as the AI art generator. The plan, verdicts and open decisions are in `docs/PHASE-0.2.md`.
  - **Decided so far:** freeze today's game as v0.1.0 and number the new phase 0.2 (new work is features, so it's a minor bump, not 0.1.1); dependencies are fine if they're high quality and free (Mark: "dependency free" was never his requirement); the Phantasy Star IV feel is the loop (combos, panels, cut-ins, pacing), not the over-the-shoulder camera, which can go if the side-view spike passes. Mark also expects side-on to make everything easier overall, since the pixel-art community has far more side-view references and assets, and he wants battle sprites a little more detailed than field sprites for personality and ambience.
  - **Release path:** the release-prep PR (#2) was merged; `v0.1.0` was tagged and released on 2026-10-03 as a GitHub pre-release ([release page](https://github.com/markhazlewood42/shadow-jog/releases/tag/v0.1.0)) on merge commit `81bc0f8`. The branch `bump-0.2.0-dev` bumps `main` to `0.2.0-dev`, makes saves record the game version (`meta.appVersion`) and shows a slot saved by a newer version as "Saved by a newer version" instead of "damaged"; it is [PR #5](https://github.com/markhazlewood42/shadow-jog/pull/5), merged 2026-10-03. Tags and releases are listed in `CHANGELOG.md`.
  - **Dependency policy:** the old "zero runtime dependencies" wording was an AI choice, not Mark's rule.
- **Where the spikes stood (2026-10-03; superseded by "State on 2026-10-04" above).** Two draft PRs, never merged; details in each spike doc.
  - **Side-view spike** ([PR #3](https://github.com/markhazlewood42/shadow-jog/pull/3), `docs/spikes/side-battle.md`): the code-drawn route plateaued at about 6.5-7/10, so the battle moved to Mark's own Sprite Fusion crew (~64 px, facing right; idle loops for all four, Kit's punch frames, Rook's strike frames). After Mark's stage feedback (characters must sit at different depths; the PS4 portrait row had to go), a design tournament picked a 3/4 "arena" stage with a side-view HUD (`docs/spikes/side-battle-stage.md`, stage data in `docs/spikes/stage-configs/`). Heroes left facing right, enemies right; today's enemies stay until they are re-drawn (Sprite Fusion shopping list).
  - **Phaser tooling spike** ([PR #4](https://github.com/markhazlewood42/shadow-jog/pull/4), `docs/spikes/phaser-stage.md`, checked out at `projects/shadow-jog-phaser`): Mark chose to run it now and make it a tooling spike after asking whether a bespoke "Shadow Jog Engine" toolset would be easier on Phaser. Built in Phaser 4.2.1, DEV-only: the arena stage (8.0/10), a **Battle Stage Editor** following `docs/TOOLING-UI.md` (RPG Maker patterns; depth and frame-by-frame ideas from OpenBOR and MUGEN) at 8.3/10, and **Battle Test** with Rook's strike from Mark's frames (8.25/10); HUD polished to 8.0. CPU per frame p95 about 1 ms; the shipped game is unchanged and has no Phaser in it. Agents recommend GO for the toolset (not a port of the shipped game); the deciding test is Mark's: open `/stageedit.html`, change a stage, save and run a Battle Test in under a minute (steps in the spike doc's "Try it").
  - **Sprite Fusion:** in use by Mark (decision 4 effectively answered); his sprites live in the git-excluded `spritefusion-tests/` and are never committed. Simple idles and walks work well from animate; complex moves work better as a static pose plus edit, frame by frame; 8-direction sets are unusable. Next credits go to the shopping list (missing reactions, Hex and Sable moves, side-facing enemies).

- **Copilot review of `main` addressed (2026-10-02, Mark's review), merged with Rook in PR #1:**
  - the dev server's write endpoints refuse requests from other sites
  - the animation editor's save checks the whole skeleton (`src/art/rig2/check.ts`) and refuses an empty or partial
    save
  - the PixelLab budget guard runs one call at a time
  - the editor's cache keeps one unsaved skeleton per character
  - a save whose member maps aren't objects fails validation
  - the dungeon simulator weights encounter groups as the game does

  **Copilot's review of PR #1:** two findings, both fixed and their threads resolved:
  - save validation now covers members out of the party
  - a skeleton save whose JSON isn't an object gets a clean 400 instead of a crash

  **PR #1 merged 2026-10-02.**

  **Bundle:** 233.4 of 236 kB. The 236 kB budget (`scripts/bundle-budget.mjs`) is a size alarm to re-set on purpose with the player download in mind, not a hard cap; the next big feature (Phaser would take it to roughly 420–500 kB) will likely need it raised.
- **GPU effects layer: first slice in (2026-09-30).** A WebGL 2 presenter over the Canvas 2D game (not the PixiJS
  rewrite): real bloom on neon, lamps and spells, shockwaves, a colour split on big impacts, and GPU particles from
  data presets (`src/data/emitters.ts`), wired to battle moments (`battlekit/gpufx.ts`). Options → GPU effects
  (on by default); without WebGL 2 the game is unchanged. How it works: `docs/ARCHITECTURE.md` §2 "GPU effects".
  **FX lab built (2026-09-30):** `npm run dev`, then http://localhost:3007/?scene=fxlab. Mark tunes every preset
  and every battle moment (what plays on a FIRE hit, a crit, a combo…) with sliders, fires them on a battle
  backdrop, and **Save** writes `src/data/fx.json` (commit it to ship). Guide: `docs/DEVELOPING.md` §8.
  **Next slices, for Mark to pick:** per-spell looks (heat haze for FIRE, a lightning flash for SHOCK, a Warden cannon charge); field weather (rain
  splashes, lamp flicker into the bloom); per-place colour grading.
- **Trailer, "before" record (2026-09-30):** `media/shadow-jog-trailer-2026-09-30.mp4` (94.7 s, 1080p60, game audio;
  not in git) records the game as it stands with everything made in code, before any AI-generated art. Shot by
  `node scripts/trailer.mjs`; re-shoot after the art changes for the "after".
- **Mark's review of the code-drawn art (2026-10-01): every asset marked Best.** His three notes are done (new
  versions on the review page): Sable's staff was half gone in his down view (the tracer took a thin dark staff for
  outline; it now keeps thin dark lines with nothing behind them, which also restored Hex's antenna and a few
  enemy details); the hooded scav townsperson (pool 6) has a human face instead of the gas mask he read as an ewok
  (`FACE_FIXES` in `scripts/art/trace.mjs`); Rook's portrait is traced from round 2's first redo, made from the
  same note (broad shoulders, the chrome arm prominent). He hasn't looked at the animations yet.
- **Pixel-art library (2026-10-01, Mark's ask):** `knowledge/pixel-art/` is the craft in depth, written to be
  taught: 16 modules in teaching order (README has the curriculum map and a learning path), a glossary, and a page
  per source (55). Each module ends with "In Shadow Jog". Its five suggestions for the game's art (one pixel
  density in battle, labelled palette slots, silhouette/greyscale toggles on the review page, light direction,
  a pixel-art lint) are in the README; none is acted on yet.
- **Spells that look like spells (2026-10-01, Mark's pick for the first effects slice).** Each element has its
  own signature, with a cast, a travel and an impact: Firebrand (embers gather, a fireball arcs over, the target
  stands in flames under a heat haze), Wildfire (the stage dims, the ground catches under every enemy in turn),
  Overload (the stage darkens, forked lightning out of the sky, arcs crawling after), Spike (code streams at the
  target and the screen tears there), Iron Palm (ki in the fist, a palm print, a hard push), Dragon Coil (one ki
  serpent winding through every enemy), heals (a turning ring of runes; Mending Rain falls as light). New GPU
  effects: heat haze, glitch, stage dim, inward-gathering particles. All tunable in the FX lab (new Spells tab;
  `cast.*`/`spell.*` moments). **Next for Mark:** cast them in the lab (DEV menu → FX lab → Spells) and in a
  battle, and say what to push further; then the combos, the enemy casters and the rest of the moves.
- **Skeleton and animation editor (since 2026-09-30).**
  - **How it works:** the crew's battle arms are bones (`skeleton.json`; limbs can't stretch), and
    `/rigedit.html` poses them. Drag the hand, leave notes per pose for Claude, and Save writes the file.
  - **Added since:**
    - a turntable of each crew member's 8 drawn views
    - a Hand choice per pose
    - draggable arc handles
    - a 2.5D "Reach forward" with a side view
    - free-arm handles and stance sliders
    - two-hand and arm-length controls
    - a Raised pose
  - **Removed:** "Ask Claude to fix it" (2026-10-01), because Mark didn't use it.
  - **Kit: done for now** (2026-10-01; Mark happy with her):
    - her jacket sleeve moves with her arm, drawn clean past 30° and traced below
    - her torso is filled where the arm leaves it
    - a round wrapped fist and an open hand (her Cast) are drawn in code
    - a hand-placed swept arc on her strike
  - **Rook: a first cut of a two-handed kendo strike, in [PR #1](https://github.com/markhazlewood42/shadow-jog/pull/1)** (branch `rook-battle-rig`, merged 2026-10-02). From Mark's kendo and Phantasy Star IV (Chaz) references:
    - **Ready:** the sword up by his right shoulder.
    - **Raised (new):** overhead, the blade dropped down his back.
    - **Strike:** both hands low on his left, a big arc from his upper right.
    - **The katana** is drawn pixel by pixel, so it's the same thickness and length in every frame.
    - **The body** leans from the hips (right on the way up, left into the cut), the head half as far. His feet
      turn with it, and his coat flares into an A-line with a vent.
    - **His left arm** is out for balance in one-handed poses and on the grip in two-handed ones.
    - **Overhead,** his arms are drawn about 1.5x longer, because his traced arms are short for his big head.
    - **Not done:** Cast and Victory aren't tuned yet (Mark: strike first).
    - **Open for Mark:** the amount of lean, the longer arm overhead, and the coat flare.
    - (A stray move of Kit's strike hand in the working copy was reverted: Mark said it was an accident.)
  - **Next:**
    - Mark's notes on Rook's strike, then Rook's Cast and Victory
    - Hex and Sable
    - in-betweens (tweening between key poses), and the field sprites on the same bones
- **Next (Mark, 2026-09-30, night): a skeleton rig, then a novice-friendly animation editor.** Battle limbs stretch
  today (the forearm is a band from a fixed elbow to wherever the hand goes); fixed-length bones fix that by
  construction. Then an editor page (dev only): pick a character and pose, drag a hand and the elbow bends (IK),
  onion skin, play at game speed, save to pose data the game reads; notes per frame for Claude, and later a live
  "tell Claude" box (Claude Code run headless by the dev server, on his Max plan) that proposes a pose he accepts or
  rejects. Everything feeds back into the code-drawn sprites. Special effects after that.
  **PixelLab ends ~2026-10-30** (Mark cancels after a month): `docs/PIXELLAB-LESSONS.md` maps every capability to our
  replacement and lists what's worth generating before then (needs his OK; 827 generations left): mainly standing
  frames for future characters, the one thing code can't make.
- **Direction change (2026-09-30, late): back to code-drawn art, made better.** Mark: the game's UX was better with
  the code-drawn assets; PixelLab's glitches and inconsistency aren't worth it. Goal: code-drawn pixel art that looks
  better than before but keeps the flexibility to animate and improve incrementally, using the PixelLab picks he
  liked as reference. **Kept from PixelLab by default: the tilesets and props** (Mark: he likes them); characters,
enemies and portraits are code-drawn again (`?art=drawn` loads all the PixelLab picks, `?art=classic` none). Snapshots to roll
  back to: tag `snapshot/2026-09-30-procedural` (all code-drawn), tag `snapshot/2026-09-30-pixellab-picks` (picks
  shipped), and `media/snapshots/art-pass-2026-09-30.tar.gz` (every generated option and his full review; local).
  **Next focus after this (Mark): special effects, "the real differentiator"**, once the art is in a good middle
  ground (scalable, decent animation). **The review tool stays in use for the code-drawn art** (Mark): each rig
  iteration is rendered onto /artreview.html (`scripts/art/review-rig.mjs`) as a new version beside the old sprite
  and the PixelLab pick.
  **Rig v2 progress (2026-09-30, while Mark was away):** the crew's battle backs (Kit from her stance; Rook draws
  and swings a code-drawn katana, the hilt leaving his back; Hex aims a code-drawn pistol; Sable lifts and swings his
  staff), with drawn light per pose; every NPC and townsperson on the rig (traced from their PixelLab standing
  frames, including the four he turned down for walk glitches, since the rig's walk replaces PixelLab's); passers-by
  take the 8 townsfolk looks in turn. The traced data loads from `public/art/rig/*.json` at startup (it pushed the
  script bundle over its budget as code). All 21 enemies on the rig too (traced from his redraw picks; strike and
  flinch by code; glow from their bright pixels). All of it on the review page (Rig v2 · crew / battle / enemies /
  NPCs / townsfolk), code-drawn art only (Mark: no PixelLab sprites there; an "Art" chip brings back the archive).
  **Portraits on the rig too:** the 8 picks traced with the faces the art pass redrew (Kit, Hex, Sable, Dutch); the
  rest drawn in code (all of Rook, Pale, Mags and Yun's expressions; Dutch's unused ones); every portrait now talks
  while a line types and blinks (Rig v2 · portraits on the review page, the blink and talk last in the strip).
  The script bundle budget is 236 kB since the skeleton (Mark's call; measured 224.9 kB).
  **First build done (rig v2, the crew in the field):** Kit (from the round-2 redo, with a face in profile), Rook,
  Hex and Sable traced and walking in code (`src/art/rig2/`); review versions v1 and v2 on the page. Next in the
  slice: Kit's battle back from her fighting-stance frame, with stance → strike and a cast raise by code (Mark's
  direction: the strike starts in her stance and ends fist out in it).
  **Plan:** a rig v2 for characters: chibi proportions from the picks (~18x28 field sprites, faces in every
  facing), 3-4 tone hue-shifted ramps per material with one light direction, selective outlines, parts drawn in code
  and layered per facing, animation in code (walks; battle key poses as part swaps, directable by Mark). First build:
  the four crew in the field + Kit's battle back with stance, strike and cast.
- **Art pass, phase 1 in the game (2026-09-30, evening).** Mark reviewed round 1 (98 assets) and his picks now ship:
  `public/art/` + `src/art/drawn.ts`, loaded at startup over the code-drawn art (which stays as the fallback;
  `?art=classic` compares). In: 33 characters (Hex, Rook, Sable in the field; 25 named and one-off NPCs; the
  townsfolk pool), the 4 crew battle backs (standing frame; code motion), all 21 enemies (redraws), 5 tilesets laid
  into their maps, 17 props. Held: portraits (need expressions), Noodle (critters aren't sprite-based), the harbour
  tileset (no map). Kit's field sprite stays code-drawn until he picks a round-2 redo. E2E (prod, perf, gpufx,
  gameover) pass with it; 60 fps held.
  **Round 2 (70 generations, balance 923) is waiting on his review:** Kit field redo ×2 (faces in the side views
  now), Pale and Rook portraits with his notes, bed/car/shrine/dumpster each with its own camera (bed and car
  fixed; shrine half; dumpster still angled), and new walking-away frames for Mags, Pale, Hex, Rook and three
  townsfolk (salaryman, scav, Hex fixed; Mags and Pale still show a front-facing or tie frame, repaired at export
  where it's detected, or by his flags; Rook's sword is now missing from the whole cycle).
  **Portrait expressions (Mark chose "main speakers, inpainted"):** `scripts/pixellab/expressions.mjs` redraws only
  the face box of the picked portrait per expression the game uses (counted per speaker: Kit, Rook, Hex all six;
  Sable five; Dutch and Pale two; Mags three; Yun one). Done and in the game: **Kit, Hex, Sable, Dutch** (19 faces,
  95 generations; balance ~828). Waiting: **Rook and Pale** (8 faces, ~40) until Mark picks their round-2 portraits;
  Mags and Yun (4, ~20) not yet approved.
  **Scale (measured 2026-09-30):** new characters are ~15% taller (median; 0.91–1.29x) and much wider (chibi heads:
  ~13x25 → ~19x29 px); props median 1.07x, outliers the barrels (15 → 26 px) and the terminal (22 → 28). Proposal to
  Mark: don't shrink pixel art; most of the mismatch is the code-drawn Kit among new characters (goes away when he
  picks a round-2 Kit); then only fix the outliers (barrels at today's size) and check 16 px doorways.
- **PixelLab art pass, round 1: generated, waiting on Mark's review (2026-09-30).** Mark subscribed to PixelLab (Tier 1,
  2,000 generations a month) and asked for a full pass over the game's art, with options to choose between, reviewed in
  a tool of its own rather than swapped in place. Budget: at most half the month (the client stops at a balance of
  1,000). **Review it:** `npm run dev`, then http://localhost:3007/artreview.html (★ Best / ✓ Good / ✗ No and notes per
  option; saves to `media/art-pass/review.json`; **Try ↗** opens the game with an option swapped in). Read his verdicts
  next session with `node scripts/pixellab/status.mjs --review`. What was made, and the recipes: `scripts/pixellab/plan.mjs`;
  how it all works: `docs/DEVELOPING.md` §8 "The PixelLab art pass". The art is in `media/art-pass/` (not in git) until
  he picks; **integration (putting picks into the game for real) is the next step after his review.**
  **What round 1 made** (963 of the 1,000 generations allowed; 165 options across 98 assets, side by side):
  - *Crew, field:* Kit and Rook (Mark's picks from the tests) with walk cycles; Hex and Sable two ways each (styled on
    their own sprite / on the new Kit), with walks.
  - *Crew, battle (from behind, 128 px, twice today's detail):* two recipes each (styled on the new Kit: saturated
    but it misreads details, e.g. Hex's bun as a hat and Rook's katana as a red bar; prompt only: taller, more faithful),
    each with a fight-stance idle, attack, special or cast, hurt, item and (some) victory animations.
  - *Enemies and bosses (21):* "redraw of today's design" (today's sprite as the style image) and "new look, crew
    style". The redraws are the stronger set; the crew-style ones often come out small in their frame. The bosses
    are the best of the lot.
  - *Portraits (8):* styled on today's portrait (consistently strong) and prompt only (mostly came out as tiny
    full figures, not busts).
  - *NPCs:* the 8 named looks (with walks), 18 one-off NPCs, Noodle, and 8 townsfolk looks for the passers-by
    (with walks), one option each, styled on the new Kit.
  - *Props (20):* redrawn at today's size, and PixelLab's map-object tool (32 px minimum, so often bigger).
  - *Terrain (6 two-terrain tilesets × 3 recipes):* shown laid into the real levels (Mark asked to judge them in
    context: `scripts/pixellab/render-maps.mjs`). **The weakest category:** the tileset tool makes generic
    raised-block tiles; "today's colours, more texture" is closest. The harbour set has no map to go in.
  **Integration questions for after the review:** the game has been all-code so far, and picks become PNG files it
  loads (the one exception to "every asset generated in code"); a scale pass (Mark: the new sprites run large);
  portraits need the other expressions (only neutral was made); enemies have no strike or flinch frames yet; the
  game's palette shift for a second copy of an enemy recolours drawn art badly (green skin).
  **Decided from Mark's review so far (2026-09-30):** PixelLab's battle animations are unusable (bodies drift,
  clothes and hair change, the moves don't read), so battle sprites use **only the standing back view** and the
  game's code-driven motion (lunge, strike smear, hurt drop, hop); `?art=review` already does this (`&frames=anim`
  shows the drawn frames). Don't spend more on battle animations.
  **But no animation at all feels stiff, a UX regression** (Mark): PSIV-style battles need 2–3 key poses per action
  (stance → strike, arm raised to cast) plus effects. Tried: inpainting just the arm on Kit's standing back view
  (`scripts/pixellab/poses.mjs`, 24 generations): identity held, but the poses were wrong for the character (her
  strike should start from her **fighting stance**, the unflagged frames of her PixelLab idle, and end with the fist
  extended in that stance). **Pinned (2026-09-30): Mark will make the key poses himself in PixelLab's editor**,
  character by character. Don't generate battle poses without his pose direction. The game side is ready:
  `?art=review` shows `poses` (per option in meta.json) with code-drawn sparks and arcs; hand-made frames can be
  wired in the same way when he has them (ask him how he'd like to hand them over). He prefers the **faithful redraws** of today's
  designs (enemies especially); the crew's field sprites styled on the new Kit. Walk cycles: small glitches he
  flags per frame, fixable at integration (e.g. snapping each frame to the standing sprite's colours).
- **CI was red from the GPU effects commit (965795d) until 8ea2335:** headless Chromium on the runners gives a
  software (SwiftShader) WebGL 2 context without a "performance caveat", so the effects ran on the CPU at ~25 fps and
  `e2e/perf.spec.ts` failed. The presenter now also refuses software renderers by name.
- **Waiting on Mark's next playthrough.** His existing save loads: saves migrate to format v3 (levels re-worked on
  the new curve from the XP earned, Rook at 10, story unlocks already passed are set). A new game shows the new
  opening (Rook's wound). Rebuild first: `npm run build && npm run preview` (http://localhost:3008).
- **Decisions waiting on Mark** (in `playthrough-1.md`, "Judgment calls"): is the new battle pace right (one constant,
  `FX_PACE`); Rook sits at 10–11 beside a level-6 chapter (his choice for note 7, flagged by the reviewer); human
  enemies kept the party's pixel scale while creatures got finer art (the battle reviewer calls the mix of densities
  a flaw); whether to act on round 13's design notes.
- **Parked ideas Mark liked** (Future Plans): a GPU effects layer (WebGL post-process and particles on top of the
  current renderer, no port); a one-battle Unity spike before any port.
- **State at this handoff:** see the end of this section's commit (`git log -1`); CI runs on every push.

### What happens next
**Next, as of 2026-10-04 (evening):** the engine decision (decision 17) replaces the Phaser rebuild. The order is now the architecture design doc for Mark's approval, then the platform spike, then the build. The ordered "Next up for Mark" list is at the top of "Right now". The paragraph below is the earlier plan, kept for reference.

**Earlier, as of 2026-10-04:** in short: (1) merge PR #8, which records both GOs. (2) Next session, start the rebuild: a feature branch from the spike code that brings the side-view battle stage, the Battle Stage Editor and the Battle Test in Phaser to `main`, with a Copilot review. (3) After the rebuild lands, archive both spikes and close PR #3 and PR #4. (4) Then build the next tools on the same base: the troop editor, then the Animation Composer. Poses for all four heroes and humanoid enemies follow. (5) Sprite Fusion shopping list when credits refresh. (6) PixelLab before about 10-30 (decision 5). Both spikes are a GO (side view and Phaser tooling, Mark, 2026-10-04). The release step and the 0.2.0-dev bump are done (v0.1.0 on 2026-10-03, [PR #5](https://github.com/markhazlewood42/shadow-jog/pull/5) merged 2026-10-03). The original sequence below is kept for reference.

**The proposed pivot sequence** (from `docs/PHASE-0.2.md`, "How the three fit together"; everything after the v0.1.0 release work depends on open decisions 4–6):
1. **Now:** the release-prep PR, then tag v0.1.0 (go-ahead), then the bump to 0.2.0-dev. Hex/Sable back-view tuning is paused (decision 3, 2026-10-02). Mark turns off PixelLab auto-renew himself if he picks 5(a) or 5(b).
2. **Week 1:** the side-view battle spike (3 days; decided 2026-10-02, comparing field scale ~30 px with battle scale ~44–48 px) in parallel with Sprite Fusion Phase A (if decision 4 is (a) or (b)). Mark picks view and size from the comparison sheet.
3. **Week 2:** the Phaser spike (4 sessions at most, if decision 6 is (a)) with the native slice built on the chosen look; Sprite Fusion Phase B alongside. Mark picks the engine for the production battle scene.
4. **Weeks 3–5 (inferred):** the production battle view behind `?battle=side`, then it becomes the default.
5. **Before 10-30:** use any PixelLab generations Mark wants to keep.
6. **End:** Mark's playthrough, then the v0.2.0 tag (go-ahead).

**Still open from before the pivots; where they fit around the spikes is Mark's call:**
- **Art pass review and integration.** Mark reviews `/artreview.html`; then read his picks and notes (`node scripts/pixellab/status.mjs --review`), regenerate what he asks for (the month's other ~1,000 generations, his call), and put the picks into the game (the integration questions are above).
- **Random-NPC generator prototype** (Mark, 2026-09-30: "try the small prototype after this pass of art review is done"). Townsfolk made from one clean PixelLab base body plus outfit variants, recoloured at runtime, instead of a fixed set of sprites. Scope: one base townsperson with a clean walk; about 4 outfit variants through PixelLab's `/create-character-state` and `/transfer-outfit-v2` or `/edit-animation-v2` (neither tested yet); a recolouring step hooked into the existing `randomLook(seed)` crowd code (`src/art/chars.ts`, `src/data/looks.ts`); tried in game on Lantern Row. **Price it first** (guess: 40–60 generations). Story and named characters stay hand-picked. Background: `docs/CONCEPTS.md` ("Paper-doll characters", "Palette swap").
- **Mark's next playthrough:** new notes are the work queue (including the scrap-hounds note), same process: triage, fix, one verification round if he asks.
- **Triage round 13's design notes** with Mark (`reviews/round-13.md`): the lift scene's motivation (Narrative's cap), trash-fight depth and a Lurker tell, the Rustyard scrap heaps and Sprawl rooftops, party back-sprites that cover enemies, menu transitions, a real (unforced) E2E playthrough.
- **Mark's doc reviews:** `docs/quality/GRADING.md`, `docs/GLOSSARY.md` ([review] marks), `docs/SETTING.md` ([new]).
- **Ship the alpha** to shadowjog.com with the secure email sign-up, only with Mark's go-ahead.
- **Chapter 2, "Deniable Assets":** getting Rook back (seeds in `docs/SETTING.md` §10).

**Mark's open decisions in the plan** (`docs/PHASE-0.2.md`, "Decisions for Mark"), as of 2026-10-04: only 5 (PixelLab end-of-plan use, before about 2026-10-30) is open. Decision 9 (the Phaser tooling spike) is GO, decided 2026-10-04, for the tooling scope and not a port of the game. Decision 10 is decided 2026-10-04: the side-on view is the game's battle view, neither spike PR merges, and the next build steps are the rebuild, the archive tags, the troop editor, the Animation Composer, the hero poses and the humanoid enemies. Settled: 1, 2, 3, 6 (the Phaser tooling spike ran) and 7. Decision 4 is answered in practice (Mark uses Sprite Fusion and the spikes use his frames as the battle sprites). Decision 8 is answered (today's enemies stay until they are re-drawn). Decisions 11 to 16 record Mark's calls made during the spike. Decision 17 (2026-10-04, evening) is the engine decision: our own engine on PixiJS v8 plus Three.js, behind a design gate. It supersedes the Phaser rebuild in decisions 9 and 10.

### Known gaps (from round 13; none are bugs)
- Battle presentation (7.5): the party are back-of-head sprites that cover enemies; creatures are finer than the party
  and human enemies (mixed pixel density); spell FX are small primitives. A GPU effects layer is the parked idea.
- Combat (7.7): most trash fights end in two rounds; few tells reach normal fights; the Lurker has no tell.
- Narrative (6.0, capped): nobody says why the crew rides Pale's lift; Pale's intake arithmetic; ending repetition.
- Field art (7.0): Rustyard scrap heaps read as noise; six rooftop stamps; the toxic canal reads as foliage.
- Level design (7.0): small, linear dungeon; one-note puzzles.
- Feel (7.6): the field drops presses mid-step; menus snap open; retry is unskippable. (Results panels now finish
  their count on the first press instead of closing: fixed in playthrough 2.)
- Stability (7.9): the E2E run teleports and auto-resolves; no save/reload mid-chapter test.
- UI: no colour-blind palette or text-size option. Touch controls: no on-screen pad yet.

## Documentation map

| Doc | For |
|---|---|
| `CLAUDE.md` | AI sessions: read order and rules (loaded automatically in this folder) |
| `docs/ARCHITECTURE.md` | How the code is organised and how the pieces talk |
| `docs/DEVELOPING.md` | Commands, tests, debug tools, conventions, traps, recipes |
| `docs/GDD.md` | The game's design |
| `docs/GLOSSARY.md` | Every name, place, faction, term and mechanic (with [review] marks) |
| `docs/CONCEPTS.md` | Game-dev and JRPG concepts behind the game, in plain words, kept current (Mark's learning record) |
| `docs/SETTING.md` | The world bible: history, politics, society, figures ([canon] vs [new]) |
| `docs/quality/GRADING.md` | How quality was graded, the full score history, what it got wrong, the exit |
| `docs/quality/rubric.md`, `scorecard.md`, `reviews/` | The rubric, the scores and work logs, each round's reviewer notes |
| `docs/mark-playthrough-notes.md` | Mark's latest playthrough notes (now playthrough 2's 14; the first 25 are in git history) |
| `docs/quality/playthrough-1.md` | Playthrough 1: what changed for each note, the judgment calls, what round 13 found and fixed |
| `docs/quality/playthrough-2.md` | Playthrough 2: what changed for each note and the judgment calls |
| `docs/PHASE-0.2.md` | The phase 0.2 plan: versioning, the three pivots, the decisions for Mark and their answers |
| `docs/spikes/` | Spike template, README with the outcomes, and the spike records: `side-battle.md`, `side-battle-stage.md` (with `stage-configs/`) and `phaser-stage.md`, copied from their `spike/*` branches (the code stays there) |
| `docs/TOOLING-UI.md` | How every Shadow Jog design tool should look and behave. It includes the Battle Stage Editor spec. The rebuild follows it. |
| `docs/research/` | Research records. `2026-10-04-engine-and-3d.md`: the 3D mode, engine and resolution research behind decision 17. `2026-10-04-engine-labs.md`: the lab evidence behind the engine design |
| `docs/engine/` | The Shadow Jog Engine design (draft for Mark's approval): start at `README.md`, decisions in `decisions.md` |
| `docs/original-prompt.md` | The prompt that started it |

## Architecture (summary; full version in docs/ARCHITECTURE.md)

- Vite + TypeScript (strict), no runtime dependencies so far (high-quality free ones are fine), Canvas 2D at 640x360 (Mark chose it on 2026-10-05, up from 480x270). Audio is generated in code; art is generated in code with Mark's picks from the PixelLab pass loaded over it (`public/art/`, `src/art/drawn.ts`).
- `src/engine/`: loop, scene stack, input, bitmap font, display scaling; the optional GPU effects layer
  (`postfx.ts`, `gl/presenter.ts`, `particles.ts`).
- `src/field/`: map baking (tiles, buildings, props), light map, weather, actors, chests.
- `src/battle/`: pure deterministic engine, AI, FX. `src/scenes/battle.ts` + `battlekit/` are the presentation
  (loaded as a separate chunk).
- `src/audio/`: WebAudio synth, sequencer and composition DSL; 16 songs (`songs.ts`) and 72 SFX.
- `src/story/chapter1.ts`: every story beat. `src/data/maps/*.ts`: all maps, NPCs and events.
- `src/game/`: state, party, save (3 slots + autosave, format v3 with migrations), systems hooks, debug and stage
  presets.
- Tests: Vitest (battle rules, balance simulator, economy Monte Carlo, save, maps, layout, music…) and Playwright
  E2E (full chapter, playtest capture, game over and saves, chaos input, shipped build, perf, audio, screenshots).
- Dev: `npm run dev` (port 3007). Debug routes and the `window.__SJ__` hook are in `docs/DEVELOPING.md` §4.

## Future Plans

- **Idea backlog.** `docs/IDEAS.md` (from 2026-10-05) holds Mark's ideas for later, in his own words, with what exists today: visual editors for everything (a standing rule for the engine now), hacking gameplay, a cyberware system, three crafting systems, and where magic comes from. Nothing there is decided or canon.

- **GPU effects layer** (Mark interested, 2026-09-29): keep the Canvas 2D game and renderer; send the finished frame
  through a small hand-written WebGL pass (bloom, shockwave, heat haze, colour grading) and draw big effects with GPU
  particles, with a Canvas 2D fallback. Mark has particle-system experience and could design emitters. **First
  slice built 2026-09-30** (see "Right now"); targeted improvements, not the full PixiJS port.
- **Unity port** (pinned 2026-09-29): feasible (the procedural art exports to PNG sheets, audio to WAV, the battle
  engine ports mechanically to C#; Unity's own MCP needs its AI plan, community MCPs are free). Proposed first step
  if revisited: a one-battle spike.
- Touch controls.
- **Setting bible.** `docs/SETTING.md` (2026-09-29): history, politics, society, key events and figures, each line tagged [canon] (in the game) or [new] (invented to fill a gap). Mark will use it to shape future narrative and setting changes to his own vision.
- **Glossary review.** `docs/GLOSSARY.md` holds every term and concept in the setting; Mark reviews it as a whole once the alpha phase completes (asked 2026-09-29). Its **[review]** marks and closing questions are the agenda. Keep it current in the same change as any new name or term.
- **Deploy to shadowjog.com** (domain bought 2026-09-28). The demo is live on Vercel since 2026-10-09 at https://shadow-jog.vercel.app, built from the `release` branch (the `v0.1.0` commit), never from `main`; how to ship is in `docs/DEVELOPING.md` section 9, "Deploying a release". Still open: attach shadowjog.com, and the email sign-up. Confirm with Mark before any release push.
- **Last step, after the alpha is fully working: interest sign-up.** The final screen (the "Chapter 2 coming soon"
  card, `src/scenes/ending.ts`) gets an email field so players can ask to hear about updates. It must be secure. The
  details are to be designed with Mark later; points to cover then:
  - the address goes to a server endpoint (a Vercel function), never straight from the browser to a mailing service,
    and no secret or API key ships in the client bundle;
  - validate and rate-limit on the server; bot protection (honeypot or similar); double opt-in confirmation;
  - HTTPS only; a short privacy note at the field; an unsubscribe path; store no more than the address and consent;
  - the game keeps working (and the field fails gracefully, with a visible error state) if the endpoint is down.
- Chapter 2 ("Deniable Assets"): getting Rook back.

## Notes

- Line endings: a CRLF-to-LF fix must skip binary files (a byte replace corrupts PNGs; E2E runs rewrite some
  screenshots under `docs/screenshots/`, so `git diff --name-only` can list them).
- Python edits on Windows: write with `newline='\n'`. Avoid `'` inside Python heredocs; use ’ in dialogue. Scripts
  with backslashes: write them to a file rather than a heredoc.
- No Co-Authored-By lines in commits (per CLAUDE.md).
- Biome's formatter is deliberately off: palettes, glyph tables, maps and ability data are hand-grouped, and the formatter explodes them one entry per line (tried in round 5: +6.8k lines, much harder to read). Lint is enforced in CI; `.editorconfig` covers whitespace.
