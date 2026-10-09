---
type: plan
title: "Shadow Jog Engine — M0 build brief"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m0, plan]
---

# M0 Prepare: build brief

Source: [migration.md](migration.md) "M0 Prepare", [tooling-and-testing.md](tooling-and-testing.md) sections 3, 7, 8, 10, [verification.md](verification.md) 3.1, and the lean loop in `CLAUDE.md`. Branch: `engine-m0-prepare` (from `main` after PR #23). Spike source: `spike/engine-platform` (read with `git show spike/engine-platform:<path>`).

## 1. Goal

- Put the shared base of the new engine into `main`: one size file, pinned Pixi and Three, the lab page, the canary suite, the leak and frame gates, and the new bundle gate.
- Add no new engine behavior. The old game stays the same: no change to game logic, scenes, data, or the shipped bundle bytes except the 34 `W` and `H` import paths.
- Exit check (migration.md): canaries green on SwiftShader, and the bundle gate passes at the size of the shipped game after the 640x360 move.

## 2. Tasks, in build order

Facts from the survey. `tests/screen-literals.test.ts`, its two JSON lists, and `scripts/lib/source-scan.mjs` already exist on `main`. `game.ts` already has `W = 640` and `H = 360`. `package.json` has no `pixi.js`, `three`, or `@types/three`. The spike's `size.ts` has a DEV `?size=` switch and defaults of 480x270: do not copy its values. The spike has no `.claude/skills/engine` and no `verified-conventions.md`: write both new. The spike `ci.yml` and `package.json` are older than `main`: copy only the lines named below. `media/research-2026-10-04/` is git-ignored and lives in `../shadow-jog`, not in this worktree.

1. **Pins.** Edit `package.json` and the lock file. Add `pixi.js` `8.22.0` and `three` `0.186.1` (dependencies), `@types/three` `0.186.0` (dev). Exact versions, no `^`. Copy the three lines from `package.json@spike/engine-platform`. Run `npm install --legacy-peer-deps` only if `npm ci` needs it.
2. **`src/sje/core/size.ts`** (new). Write it: `W = 640`, `H = 360`, `FPS = 60`, `TICK_MS`, and the `grain` helper (copy the helper and the comment style from `src/sje/core/size.ts@spike`; drop the DEV switch and the 480/270 text, and fix the 240x135 comment). Mark as an ours-not-Phaser item per `conventions.md`.
3. **Re-export.** Edit `src/engine/game.ts` only: replace the `export const W/H` lines with `import { H, W } from '../sje/core/size'` and `export { H, W }` (copy from `src/engine/game.ts@spike`, lines 17 to 23). Keep `FPS` where it is.
4. **Move the imports.** Change the 34 `W` and `H` importers (count by `grep` before: about 42 files import `engine/game`, only some take `W` or `H`) to import from `src/sje/core/size`. A mechanical path edit, nothing else. Do not touch `src/engine/*` other than step 3.
5. **Literal scan.** Exists. Edit `tests/screen-literals.test.ts` only to: make `size.ts` the only definition site, drop any `pivot-640` wording that M0 makes stale, and require the pending list to be empty. Check `tests/screen-literals.pending.json` is empty (pass line 5). Do not rewrite the scan.
6. **Lint levels.** Edit `biome.json`: copy the `noRestrictedImports` blocks (pixi only under `src/sje/render` and `src/sje/display`, three only under `src/sje/three` and `src/hack3d`) and add `src/sje/**` to the strict-null block, from `biome.json@spike`. Write the import-level scan `tests/sje-imports.test.ts` from the spike copy.
7. **Engine sources the canaries need.** Copy from the spike, unchanged where they are not about size: `src/sje/render/*`, `src/sje/display/*`, `src/sje/core/{assert,eventemitter,fixedloop,runall}.ts`, `src/sje/three/*`, `src/sje/index.ts`. Copy only what the canaries import. M1 owns `src/sje/runtime/`: do not bring it in.
8. **Lab page.** Copy `sjelab.html`, `src/sje-lab/{main,lab,hook,glcounter,profile}.ts` and what they import, and the lab entry in `vite.config.ts` (read both configs; `main` is newer, so add only the lab entry). Set the lab size to `W` by `H` from `size.ts` (the spike lab used 480x270 and a mock switch).
9. **GL-object harness.** `src/sje-lab/glcounter.ts@spike` (60 lines): copy. Use it in the leak canary (10 enter and exit cycles, flat counts, deliberate leak grows).
10. **Canary suite.** Write `e2e/sje-canaries.spec.ts` from the 12 rows of tooling-and-testing.md section 8. Take the code from `e2e/sjelab.spec.ts@spike` (boot, one loop, extension list, no WebGL2, crisp pixels, lifetime, context loss) and `e2e/sje3d.spec.ts@spike` (stale clear color line 890, color exactness 220, rewrap, handle fallback 147). Each canary needs a negative control. Update the 480x270 numbers to 640x360 (the spike has a 640x360 crisp-pixel block at `sjelab.spec.ts` line 293). Copy `e2e/sjelabkit.ts`.
11. **Perf gates.** Edit `e2e/perf.spec.ts` (identical on `main` and the spike, so nothing to copy from there): keep the sim gate, add the frame interval p50/p95, the draw-call count (patch of `WebGL2RenderingContext.prototype`), and the speed line of tooling-and-testing.md section 7 (interval within 5% of a bare page, cost p95 at most 8 ms, with a negative control). On SwiftShader the gate only catches a stuck loop (p95 under 80 ms). Take the logic from `e2e/sje3d.spec.ts@spike` lines 943 to 1055.
12. **Bundle gate.** Rewrite `scripts/bundle-budget.mjs`: set `build.manifest: true` in `vite.config.ts`, read `dist/.vite/manifest.json`, sort chunks into `boot`, `lazy-2d`, `lazy-3d`, `lazy-other`, report `first play`. Write new (the spike script reads lab builds with `scripts/labchunks.mjs`, a different design). Keep the existing alarm numbers as the `boot` and total starting point and the history comment. Hard check: no `pixi.js` or `three` module in `boot`. No named `output.codeSplitting` groups, no top-level `await renderer.init()` (section 10 traps). Add `optimizeDeps.include: ['pixi.js','three']`.
13. **Skill and conventions.** Write `.claude/skills/engine/SKILL.md` (read order, how to add a `GameObject`, scene, effect, test, the hard rules; section 12) and `docs/engine/verified-conventions.md` (the list of Phaser conventions that the lab checked against `node_modules/phaser`, with the check each came from).
14. **Compile the sketches.** Make the code blocks of [interfaces.md](interfaces.md) type-check as `src/sje/interfaces.check.ts` (types only, no runtime, excluded from the bundle) so drift is a compile error.
15. **Lab scripts.** Copy the scripts the canaries need from `../shadow-jog/media/research-2026-10-04/` (read it first; copy only what an `e2e` file imports) into `tests/lab/` or `scripts/lab/`. The record `docs/research/2026-10-04-engine-labs.md` stays.
16. **Doc drift.** Fix the `?debug` note and the chunk count in `docs/ARCHITECTURE.md` and `docs/DEVELOPING.md`. Update section 5 of migration.md (M0 done) and the CI step name if the bundle step renames.
17. **CI.** Edit `.github/workflows/ci.yml` on `main` (do not copy the spike's): `e2e` job runs the canary spec. Keep the three jobs and the docs-only skip.

## 3. Hard pass lines

Each line is a command or a count. A fresh agent runs them.

1. `npm run check` exits 0 (lint, types, unit tests). Judge by exit code.
2. `src/sje/core/size.ts` is the only definition of the screen `W` and `H` (`tests/screen-literals.test.ts` passes and checks it; 10 unrelated local map and prop size constants also match a plain grep and stay). `grep -rn "from '.*engine/game'" src | grep -E "b[WH]b"` returns nothing for `W` or `H` (reworded by the main session, 2026-10-09: the first grep was too wide).
3. `git diff --stat main...HEAD -- src/engine src/battle src/game src/scenes src/field src/data src/story src/audio src/art` shows only `src/engine/game.ts` (the re-export) and import-path lines. No other logic line changes.
4. `SJ_BUILD_SHA=m0 npm run build` bundle under `dist/` equals the build of `main` with the same pin, byte for byte, or differs only by a few bytes of module path text (builder measured +4 raw, +2 gzip; the reader checks the statement-line comparison). State which. `node scripts/prod-bytes.mjs` is not on `main`: use a hash of `dist/assets/*.js` for both.
5. `npx vitest run tests/screen-literals.test.ts` passes and `tests/screen-literals.pending.json` has zero entries.
6. `npm run budget` exits 0. The `boot` class holds no `pixi.js` and no `three` module. The report prints all five classes.
7. `npx playwright test e2e/sje-canaries.spec.ts --reporter=line` exits 0 under SwiftShader. All 12 canaries ran, and each negative control failed as it must.
8. `npx playwright test e2e/perf.spec.ts --reporter=line` exits 0. The old sim gate still holds, the new gates ran, and the negative control fails the speed line.
9. The leak test: 10 enter and exit cycles leave texture, buffer, program, VAO, framebuffer, and renderbuffer counts flat. The deliberate leak grows.
10. `package.json` shows `"pixi.js": "8.22.0"`, `"three": "0.186.1"`, `"@types/three": "0.186.0"`, no `^` or `~`, and `npm ls pixi.js three @types/three` agrees.
11. `grep -rn "pixi.js" src --include=*.ts` hits only `src/sje/render`, `src/sje/display`, and the lab. `grep -rn "from 'three'" src` hits only `src/sje/three`, `src/hack3d`, and the lab. No file outside `src/sje*` and the lab imports either.
12. `npx playwright test e2e/playthrough.spec.ts e2e/prod.spec.ts --reporter=line` exits 0: the old game plays as before. (CI runs the full suite on push.)
13. `git diff --stat main...HEAD -- src/data` is empty (principle 8).
14. `CHANGELOG.md` has an M0 entry, and `status.md` has `milestone: M0` (section 6).

## 4. Verifier plan (lean loop)

No visual part in M0, so no screenshot round for Mark. Round 1 uses two fresh agents. Criteria are this section 3, written before the work.

| Agent | Model, effort | Job |
|---|---|---|
| Runner | sonnet, medium | Runs pass lines 1 to 13 with the commands above. Reports the exit code and the number for each. Re-runs the expensive suites (canaries, perf) once. |
| Reader | haiku, medium | Reads `git diff main...HEAD` for B2 correctness, B4 design conformance (levels in README.md, conventions.md tags), B7 clarity, B8 docs. Checks the canaries can fail (each has a negative control) and that no test is vacuous. |

- Rubric: [verification.md](verification.md) 3.1 as evidence (B5 is not applicable; B1 to B4, B6 to B8 apply). The rubric does not gate.
- Pass: every hard pass line holds, no Critical or Important finding is open. Minor findings are named fixes for the next commit.
- A fix round: one fresh verifier checks only the named findings and re-runs the affected tests. Cap: 3 rounds, then bring Mark the evidence.
- No attacker agent (no write path, trust rule, or save format changes). The builder is a sonnet agent, effort high. The builder never grades its own work.

## 5. Risks and questions for Mark

Risks:

- **Bundle bytes.** The re-export and the path edits may change chunk hashes. Pass line 4 accepts hash noise only if the code bytes match; the reader checks.
- **SwiftShader time.** The canaries and perf specs add CI minutes. The lab pages need Pixi and Three in the dev build, which adds dev startup time.
- **Spike drift.** The spike branched before the 640x360 move and the CI speed-up. Copied specs hold 480x270 numbers; each needs the new size and a re-run, not a trust.
- **Lab scripts** live in `../shadow-jog/media`, a git-ignored folder. If a script is missing there, the canary that needs it cannot be written.
- **Dependency size.** Pins add no bytes to the shipped game only if no `src/` file outside `sje*` imports them (pass line 11).

Questions (for Mark to decide; this brief does not):

1. Q1: The "34 imports" figure in migration.md is not what `grep` shows (about 42 files import `engine/game`). Move every `W` and `H` import, or only the 34 named?
2. Q2: Should the lab pages (`sjelab.html`) ship in the production `dist/`? The spike kept them out of the shipped bundle. Recommend dev only plus a CI build, but the manifest gate needs them built to count `lazy-2d`.
3. Q3: Starting caps for the new bundle classes (E17): keep `boot` at today's alarm, set `lazy-3d` to 160 kB (accepted C5), and leave `first play` as report only until M1?
4. Q4: Does M0 need a PR draft target of `main`, and does the Claude Code Review Action run on it, given it has no game change? (Rule: one PR per milestone.)
5. Q5: The lab scripts in `media/research-2026-10-04/` are git-ignored. Copy the needed few into the repo (public, so no secrets) or keep them out and write the canaries from the spike alone?

## 6. CHANGELOG and tracking

- **`CHANGELOG.md`** (Keep a Changelog): under `[Unreleased]`, add `### Added` (lab page, canary suite, GL-object harness, frame-interval and draw-call gates, manifest bundle gate, engine skill, `size.ts`) and `### Changed` (`W` and `H` import path, pinned `pixi.js`/`three`). One entry in the M0 PR.
- **Command Center reads `status.md` like this** (`tools/command-center/src/server/status/status.ts`):
  - Frontmatter `updated:` (a date). The Status row "status.md" shows it.
  - Frontmatter `milestone:` must equal a bold id in the migration.md milestone table. Set `milestone: M0` when M0 starts, `M1` when it merges. Case matters. A wrong value shows "Unknown milestone".
  - The current section is the first heading that starts with `Right now` and does not contain the word `history`. Write the new state in a fresh `### Right now (2026-10-09)` heading and rename the older one to `... (history)`. No such heading is an error panel.
  - Inside it, a paragraph or heading that starts `**Next up for Mark**` (case free) followed at once by a list. Each list item is one thing for Mark; the count shows as "N for you". Keep a blank line between the label and the list. An empty or missing list shows "Nothing for you".
  - The panel also reads the branch, CI, last commit (from `git` and `gh`), not from `status.md`.
- **Steps:** (1) at start, set `milestone: M0` and `updated:`; (2) after each verified round, one line in "Right now"; (3) at the PR, put Q1 to Q5 under `**Next up for Mark**`; (4) at merge, set `milestone: M1`, move M0 text to history, link the PR and the pass-line table; (5) a major decision becomes a GitHub issue from `.github/ISSUE_TEMPLATE/decision.md` (see `CLAUDE.md`), not a status line.
- Add to `docs/GLOSSARY.md` any new name (`GlCounter`, the canary names, the bundle classes) in the same change. Add concepts (SwiftShader, canary test, draw-call count) to `docs/CONCEPTS.md`.

## Decisions taken (main session, 2026-10-09)

1. Move every `W` and `H` import (about 42 files), not only 34.
2. Lab pages build in dev and in CI only. They stay out of production `dist/`.
3. Starting caps: `boot` at today's alarm, `lazy-3d` 160 kB (C5), `first play` report-only until M1. Mark may change these.
4. The M0 PR goes through the Claude Code Review Action. No Copilot.
5. Copy the lab scripts the canaries need from `../shadow-jog/media/research-2026-10-04/` (git-ignored there). Copy only what a canary runs.

## Builder report (2026-10-09, branch `engine-m0-prepare`)

Builder: sonnet, effort high. Run on the bundled Chromium with SwiftShader (`CI=1`), Windows. Not yet graded by the verifiers.

### Tasks

| # | Task | Result |
|---|---|---|
| 1 | Pins | Done. `pixi.js` 8.22.0, `three` 0.186.1, `@types/three` 0.186.0, exact. `npm install --legacy-peer-deps` was used once (the lock file changed by 171 lines). |
| 2 | `size.ts` | Done. `W`, `H`, `FPS`, `TICK_MS`, `grain`. No DEV switch. |
| 3 | Re-export | Done. `game.ts` imports from `size.ts` and re-exports `W` and `H`. `FPS` stays in `game.ts`. |
| 4 | Move imports | Done for all importers (decision 1): 46 files (not 34). Mechanical path edit by script. One test needed a matching edit: `tests/ui-layout.test.ts` mocks the screen size, and now mocks `src/sje/core/size` instead of `src/engine/game`. |
| 5 | Literal scan | Done. The scan sees `size.ts` as the definition site, a new test says `size.ts` is the only place that defines `W` and `H`, a new test requires an empty pending list. The pending list was already empty. No `pivot-640` wording was stale enough to change. |
| 6 | Lint levels | Done. `biome.json` has the `noRestrictedImports` blocks and `src/sje/**` in the strict-null block. One addition: `src/sje-lab/**`, `tests/**` and `e2e/**` may import the libraries. `tests/sje-imports.test.ts` is the spike copy, cut down to what M0 has and extended (lab rules, `size.ts` is the only engine file the old game imports). Probe files confirmed that Biome exits 1 for Pixi in `src/art` and in `src/sje/core`. |
| 7 | Engine sources | Done, with one deviation. Copied from the spike: `core/{assert,eventemitter,fixedloop,runall}`, all of `render/` and `display/`, `three/{dispose,frame3d,threehost,index}`, a trimmed `index.ts`. Also copied `runtime/glrenderer.ts`: `ThreeHost` and `Frame3D` take a `GlRenderer`, so Three cannot run without it (it is five level-1 parts and a `Screen` type, no scene logic). `three/scene3d.ts` is not copied: it extends the scene runtime (`Scene`), which is M1, so `Scene3D` is M1b. `three/index.ts` also exports `releaseGpuData` (the lab replays what `Scene3D` does on a context loss). |
| 8 | Lab page | Done, rewritten for M0. The spike's lab ran on `Game`, hack scenes and the Phaser stage. The new lab (`src/sje-lab/{main,lab,hook,content,pixilab,threelab,glcounter,profile,pixeltools}.ts`) composes `GlRenderer`, `Screen`, `TextureManager` and `FixedLoop`, at 640x360 from `size.ts`, with code-drawn textures. `vite.config.ts` has no lab entry in the game build (decision 2): `vite build --mode lab` builds it into `dist-lab/`. |
| 9 | GL-object harness | Done. `glcounter.ts` copied. 2D and 3D leak tests. |
| 10 | Canary suite | Done. `e2e/sje-canaries.spec.ts` (41 tests: 12 canaries with controls, boot, loop, no WebGL2, crisp pixels at 8 ratios and with the 3D frame, determinism, two leak tests, context loss). The spike's specs run on `Game`, so the checks were written again against the lab; the Pixi-direct ones use throwaway "probe" renderers for the controls. Mutation check: breaking `canvas`, `skipExtensionImports`, `gcActive`, `Ticker.system.stop()` and `ColorManagement` each turn the matching canary red. |
| 11 | Perf gates | Done. The sim gate and the other three old tests are unchanged. New in `e2e/perf.spec.ts`: frame interval p50 and p95, frame cost with a GPU wait, the speed line (pure check of its rules, the lab on a GPU, the stuck-loop line on software GL), a negative control, and the draw-call and framebuffer-bind gates (patch of `WebGL2RenderingContext.prototype`) with a control. |
| 12 | Bundle gate | Done. `scripts/bundle-budget.mjs` is rewritten around `dist/.vite/manifest.json` and source maps. The history comment and the alarm numbers are kept (`CHUNK_MAX`, `GZIP_TOTAL_MAX`). `npm run budget` builds the game and the lab. Also: no `codeSplitting` or `manualChunks`, no top-level `await ... .init(`, `optimizeDeps.include`. |
| 13 | Skill and conventions | Done. `.claude/skills/engine/SKILL.md`, `docs/engine/verified-conventions.md`. The Phaser rows cite the lab record: the Phaser 4.2.1 checkout is not in this repo, so those rows were not read again. |
| 14 | Compile the sketches | Done. `src/sje/interfaces.check.ts` is generated by `scripts/sync-interface-check.mjs` from the 16 blocks of `interfaces.md` (`declare` added to classes and consts, 3 value lines replaced by types, stubs for the names the doc does not define). `tests/sje-interfaces.test.ts` compares the file with the doc. All sketches compile under the strict settings with no change to the doc. |
| 15 | Lab scripts | Skipped on purpose. No e2e file imports a script of `media/research-2026-10-04/`: the canaries are written in the lab itself. Nothing was copied (decision 5 says copy only what a canary runs). |
| 16 | Doc drift | Done. `?debug` note and chunk count in `DEVELOPING.md` and `ARCHITECTURE.md` (`__SJ__` is on in every dev build; `?debug` only skips the close-tab prompt). `migration.md` section 5 and the M0 exit check. Not changed: the project `CLAUDE.md` Quick commands line still says `?debug` for test hooks (instruction file: the main session decides). |
| 17 | CI | Done. The `e2e` job runs `e2e/sje-canaries.spec.ts`. The bundle step is renamed "Bundle budget (manifest classes and total gzip)". Three jobs and the docs-only skip are kept. |
| - | CHANGELOG, glossary, concepts | Done (one Unreleased entry in Added and one in Changed; `GLOSSARY.md` section 14; five entries in `CONCEPTS.md`). `status.md` was not edited. |

### Hard pass lines

| # | Result |
|---|---|
| 1 | `npm run check` exit 0. 35 test files, 478 tests. |
| 2 | **Cannot hold as written.** The first grep finds `W` and `H` defined in `src/sje/core/size.ts` (lines 17 and 19), and `src/engine/game.ts` has none. It also finds 10 unrelated local constants: map sizes in `src/data/maps/{annex,lantern_row,rustyard,sinkline,world}.ts` (`const W = 44, H = 34`, ...) and prop sizes in `src/field/props.ts`. They are not the screen. Changing them is a change of `src/data` and of game logic, which lines 3 and 13 forbid, so they stay. The line's intent holds and is gated by `tests/screen-literals.test.ts` (`size.ts` is the only `export const W` or `H` in `src/`). The second grep (`from '.*engine/game'` with `W` or `H`) returns nothing. |
| 3 | Holds. `git diff --stat origin/main...HEAD -- src/engine src/battle src/game src/scenes src/field src/data src/story src/audio src/art`: 37 files, 60 insertions, 42 deletions. Every changed line is an import path, except `src/engine/game.ts` (the two definitions become `export { H, W }` and one import). Note: the local branch `main` is behind `origin/main` (PR #23); the comparison base is `origin/main`. |
| 4 | **Not byte for byte. The code is identical.** Pinned builds (`SJ_BUILD_SHA=m0`), `origin/main` against M0: raw 699,214 against 699,218 bytes, gzip 240,788 against 240,790. Chunk sizes are equal for `battle` (133,242), both `deck` chunks (4,523 and 7,489) and `index` (432,510); `tables` is 4 bytes larger (121,450 against 121,454), and file hashes differ. With `--minify false`, both builds have 45,082 statement lines, and the multisets of lines (without import and export lines, `$n` suffixes and chunk hashes) are equal except for one line: the export alias list of a shared chunk. The cause is the new module `size.ts` changing how the bundler names the shared chunk's exports. The reader should check this claim: the comparison script is in the builder's scratchpad, not in the repo. |
| 5 | `npx vitest run tests/screen-literals.test.ts`: 7 passed. `tests/screen-literals.pending.json` has 0 entries. |
| 6 | `npm run budget` exit 0. Game: boot 190.0 kB gzip (`index` and the shared `tables` chunk; neither holds Pixi or Three), lazy-other 50.8, lazy-2d 0, lazy-3d 0, first play 190.0. Lab: boot 1.2, lazy-2d 143.0 (one 11.2 kB chunk, `browserAll`, is never downloaded and is left out of first play), lazy-3d 135.3 (cap 160), lazy-other 0, first play 133.0. Game total gzip 240,793 bytes against the alarm of 240,800: 7 bytes of room (`origin/main` has 240,788). A control (a static `import 'pixi.js'` in `src/main.ts`) made the gate exit 1 with six messages, and was reverted. |
| 7 | `CI=1 npx playwright test --project=chromium e2e/sje-canaries.spec.ts --reporter=line`: 41 passed (33.6 s), on SwiftShader (`ANGLE ... SwiftShader`). The 12 canaries have 12 controls, and each control asserts the bug. |
| 8 | `CI=1 npx playwright test --project=chromium e2e/perf.spec.ts --reporter=line`: 8 passed. The four old tests are unchanged and pass. On software GL: 2D scene interval p50 16.7, p95 16.8 ms (bare page 16.7); 3D frame with bloom interval p95 33.4 ms, cost with GPU wait p95 23.0 ms; control (20 extra 3D frames a frame) interval p95 200 ms, broken rule "stuck loop". On a GPU the control asserts that both rules fail (600 extra frames): written, **not run** (no GPU run was done, see below). |
| 9 | `... e2e/sje-canaries.spec.ts -g leak`: 2 passed. 2D: texture 6, buffer 4, framebuffer 1, renderbuffer 1, program 1, vao 2 before and after 10 cycles; a leak of 6 textures: 12. 3D: texture 10, buffer 4, framebuffer 4, renderbuffer 1, program 2, vao 2 before and after 10 cycles; a leak of 4 targets: texture 14, framebuffer 8. One Three renderer for the whole page. |
| 10 | Holds. `"pixi.js": "8.22.0"`, `"three": "0.186.1"`, `"@types/three": "0.186.0"`. `npm ls` shows the same three versions. |
| 11 | Holds. `grep -rn "pixi.js" src --include=*.ts` outside `src/sje/render`, `src/sje/display` and `src/sje-lab`: no hit. `grep -rn "from 'three'" src` outside `src/sje/three`, `src/hack3d` and `src/sje-lab`: no hit. (`src/hack3d` does not exist yet.) |
| 12 | `CI=1 npx playwright test --project=chromium e2e/playthrough.spec.ts e2e/prod.spec.ts --reporter=line`: 3 passed (2.7 min). |
| 13 | Holds. `git diff --stat origin/main...HEAD -- src/data` is empty. |
| 14 | `CHANGELOG.md` has the M0 entries. `status.md` has `milestone: M0` (set before the build; the main session owns the file). |

### Open or not done

- **Pass line 2** cannot hold as written (see above). Needs a decision on the wording, not code.
- **GPU run**: every number above is from SwiftShader. The speed line on a GPU (interval within 5% of a bare page, cost p95 at most 8 ms, both rules failing in the 600-frame control) is written and not run here. Run `npx playwright test e2e/perf.spec.ts` locally (Edge, real GPU).
- **First CI run**: not seen. The e2e job now runs 41 more tests (about 35 s locally) and the check job builds twice. WebKit and Firefox do not run the canaries.
- **Verifiers**: not run. The builder wrote and ran everything; no fresh agent has graded it.
- **Game bundle room is 7 bytes** (alarm 240.8 kB; M0 adds 2 to 5 bytes of chunk export names). Any change to the shipped code in the next milestone needs a deliberate alarm change.
- For the main session: the local branch `main` is stale (8e82fe7, before PR #23): use `origin/main` for the PR. The project `CLAUDE.md` Quick commands line about `?debug` is stale (see task 16).
