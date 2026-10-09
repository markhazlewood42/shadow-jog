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
2. `grep -rnE "\b(W|H)\s*=\s*[0-9]" src` finds the W/H definition only in `src/sje/core/size.ts` (and `src/engine/game.ts` has none). `grep -rn "from '.*engine/game'" src | grep -E "\b[WH]\b"` returns nothing for `W` or `H`.
3. `git diff --stat main...HEAD -- src/engine src/battle src/game src/scenes src/field src/data src/story src/audio src/art` shows only `src/engine/game.ts` (the re-export) and import-path lines. No other logic line changes.
4. `SJ_BUILD_SHA=m0 npm run build` bundle under `dist/` equals the build of `main` with the same pin, byte for byte, or differs only by the module path text the bundler drops. State which. `node scripts/prod-bytes.mjs` is not on `main`: use a hash of `dist/assets/*.js` for both.
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
