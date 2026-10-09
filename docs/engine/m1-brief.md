---
type: plan
title: "Shadow Jog Engine — M1 build brief"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m1, plan]
---

# M1 Shell: build brief

Source: [migration.md](migration.md) "M1 Shell", [frame-and-rendering.md](frame-and-rendering.md) sections 1 to 6 and 9 to 11, [interfaces.md](interfaces.md) sections 13 and 14, [scene-graph.md](scene-graph.md), [tooling-and-testing.md](tooling-and-testing.md) sections 7 and 8, and the lean loop in `CLAUDE.md`. Branch: `engine-m1-shell` (from `main` after PR #43). Spike source: `spike/engine-platform` (read with `git show spike/engine-platform:<path>`). Pass lines were written before any code.

## 1. Goal

- Put the new engine's runtime in `main`, behind `?engine=sje`: `Game.create`, the scene stack, the `LegacyScene` adapter, `GameApi`, the Phaser scene operations, `Loader`, input, `time`, `tweens`, fades and camera effects, the boot failure message, the hidden-tab clamp, fault isolation, the DEV hook, and the `fxLevel` setting.
- No effects (M2). No `Scene3D` (M1b). No scene is ported to retained mode: legacy scenes draw into `CanvasImage`s.
- The old engine and the default path do not change, except the flag in `src/main.ts` and the `fxLevel` mapping in `settings.ts`.
- Exit check (migration.md): title, field, battle and shop play under `?engine=sje`; the fault, abandon, curtain, exit-throw and two render-fault cases of `tests/game.test.ts` pass on the new `Game`; new tests for close order and microtask timing pass; a block test and a screenshot match the old 2D path; the 1,000-object bench is recorded and section 7 of tooling-and-testing.md gets real numbers.

## 2. Tasks, in build order

Facts from the survey. `src/sje/runtime/` has only `glrenderer.ts` (from M0). The spike has `runtime/{game,gameobjectfactory,scene,scenemanager}.ts` (201, 57, 182, 276 lines) and `three/scene3d.ts` (not M1). The spike ran at 480x270 and had no `LegacyScene`, `Loader`, input, `time`, `tweens` or `fit` mode: write those new. `src/main.ts` today builds `Display`, `Input` and the old `Game`, and runs its own rAF loop.

1. **Survey.** Read the five spike runtime files and `src/engine/game.ts`, `input.ts`, `display.ts`. List what the 22 `Scene` subclasses and `src/game/script.ts` call on the old `Game`. That list is the `GameApi` and `LegacyScene` surface. Put it in the builder report.
2. **`GameApi` and types.** In `src/sje/runtime/`, per interfaces.md section 13. The old `Game` gets `implements GameApi` (type-only change to `src/engine/game.ts`; no logic change).
3. **`Scene` and `SceneManager`.** From the spike, plus the Phaser operations `launch`, `pause`, `resume`, `stop`, `sleep`, `wake`, `switch`, `run` (see `verified-conventions.md`). Unbuilt operations stay absent from the types. Close order and microtask timing follow frame-and-rendering.md section 2 "Scene lifecycle".
4. **`Game.create(config)`.** Async factory. Creates `GlContext`, `PixiRenderer`, `BackBuffer`, `Presenter`, `Display`, then `FixedLoop`. No top-level `await renderer.init()`. Config carries `fxLevel` and `scaleMode`. Boot failure (no WebGL2) shows the existing `#boot` error text, not a blank page.
5. **Loop rules.** Fixed 60 Hz tick, up to 5 catch-up ticks, then the accumulator drops (as `main.ts` today). Hidden-tab clamp: delta capped at 250 ms. Fault isolation: the fault, abandon, curtain, exit-throw and render-fault behavior of `tests/game.test.ts`, line for line.
6. **`LegacyScene` adapter.** Wraps today's scene shape (`enter`, `exit`, `resume`, `update`, `render(ctx)`, `opaque`, `curtain`, `passUpdate`, `close`). Owns one 640x360 `CanvasImage`, calls `render(ctx)` into it, shows it as one image. The 22 scenes and all story scripts run unchanged.
7. **Time, tweens, fades, camera.** `time.delayedCall`, `tweens.add`, `cameras.main.fadeIn/fadeOut/shake/flash`, driven by the tick (not wall clock). Only the Phaser names the legacy scenes need.
8. **`Loader` and input.** `Loader` loads the existing code-drawn and `public/art/` textures into `TextureManager`. Input wraps `src/engine/input.ts` (`ActionMap`, `applyCustom`); do not copy it.
9. **Display scale (E13).** Build `integer` mode on the whole-window canvas. Mark's pick of `fit` is Question Q2.
10. **`fxLevel`.** In `src/game/settings.ts`: `fxLevel` (`none`, `auto`, `full`) replaces `gpuFx`; `backfill()` maps `true` to `auto`, `false` to `none`. A settings test covers it. `gpu(on)` of the DEV hook sets it.
11. **`Rng` move.** Move `src/engine/rng.ts` to `src/sje/core/rng.ts`. `src/engine/rng.ts` re-exports it. Update the imports of the Phase 0 hack simulation and the 3D chunk if they exist on `main`.
12. **Flag.** `src/main.ts`: `?engine=sje` dynamically imports `src/sje/boot.ts` (own chunk, holds Pixi and Three). Without the flag, no new code runs. A hidden production setting is out of scope (M6).
13. **DEV hook.** `window.__SJ__` on the new path per interfaces.md section 14: the existing members, plus `hooks`, `tree`, `step`, `frameHash`, `pixels`, `glCounts`, `renderer`, `forceContextLoss/Restore`. The shipped build must not expose it (`e2e/prod.spec.ts`).
14. **Tests.** `tests/sje-game.test.ts`: the 8 cases of `tests/game.test.ts` run against the new `Game` (shared case table, not copies); close order; microtask timing; hidden-tab clamp; `backfill()` mapping. `e2e/sje-shell.spec.ts` (flag on): title, field, battle, shop each reach their screen; `?engine=sje` pixel block test (a block in the old 2D path and the new one has equal pixels at integer ratios 1, 2, 3); screenshot match against the old path; context loss and restore returns to the same frame. Each check needs a negative control.
15. **Bench.** `e2e/sje-bench.spec.ts` (local, `npm run perf`-style, not CI): 1,000 objects, wrapper cost per frame, canvas upload per frame with two `CanvasImage`s, draw calls, binds. Write the real numbers into tooling-and-testing.md section 7.
16. **Docs.** `CHANGELOG.md` entry. `docs/GLOSSARY.md` and `docs/CONCEPTS.md` for new names (`LegacyScene`, `GameApi`, `fxLevel`, catch-up ticks, fault isolation). `DEVELOPING.md` gets the `?engine=sje` recipe. Update `.claude/skills/engine/SKILL.md` (runtime read order). Set `status.md` `milestone: M1` at the merge.
17. **CI.** Add `e2e/sje-shell.spec.ts` to the `e2e` job. Keep the three jobs and the docs-only skip. `e2e/sje-bench.spec.ts` stays out of CI.

## 3. Hard pass lines

Each line is a command or a count. A fresh agent runs them.

1. `npm run check` exits 0 (lint, types, unit). Judge by exit code.
2. `npx vitest run tests/sje-game.test.ts tests/game.test.ts` exits 0. The shared case table runs the same 8 cases on both `Game` classes. Control: a mutant of the new `Game` (no fault counter, wrong close order) fails the matching case.
3. `npx playwright test e2e/sje-shell.spec.ts --reporter=line` exits 0 under SwiftShader. Title, field, battle and shop play with `?engine=sje`. Every control fails as it must.
4. Block test: at ratios 1, 2 and 3, a 64x64 block of the title screen is pixel-equal between the old path and `?engine=sje`. The full screenshot differs from the old path in at most 0.1% of pixels, and Mark gets both pictures (section 4).
5. Without `?engine=sje`, the old game plays as before: `npx playwright test e2e/playthrough.spec.ts e2e/prod.spec.ts --reporter=line` exits 0. `__SJ__` is absent in the production build.
6. `git diff --stat main...HEAD -- src/engine src/battle src/game src/scenes src/field src/data src/story src/audio src/art` shows only: the `implements GameApi` line and the `Rng` re-export in `src/engine`, the `fxLevel` change in `src/game/settings.ts` and its callers, and import-path lines. `git diff --stat main...HEAD -- src/data` is empty (principle 8).
7. `npm run budget` exits 0. The `boot` class holds no `pixi.js` and no `three` module. The `?engine=sje` chunk is in `lazy-2d` and holds all of Pixi. Game total gzip stays under one raised total (Mark, 2026-10-09, Q1: "one bigger total"): start at 400 kB, and set it at the end of M1 to the measured size rounded up to the next 1 kB. The raise is a dated comment in the script, by measured delta only; the old-game growth is no longer separately gated (a known loss, see Q1).
8. `npx playwright test e2e/sje-canaries.spec.ts e2e/sje-draws.spec.ts --reporter=line` exits 0: the M0 canaries still pass, and the leak test is flat across 10 enter and exit cycles of `LegacyScene` scenes.
9. `grep -rn "pixi.js" src --include=*.ts` hits only `src/sje/render`, `src/sje/display` and `src/sje-lab`; `grep -rn "from 'three'" src` hits only `src/sje/three`, `src/hack3d` and `src/sje-lab`. `tests/sje-imports.test.ts` passes. `src/sje/runtime` imports no `src/engine` file except the `Input` and old `Scene` types named in task 6 and 8.
10. The 1,000-object bench ran on the local GPU. Frame interval p95 within 5% of a bare page, cost p95 at most 8 ms (principle 12: one run at the end of M1). The numbers are in tooling-and-testing.md section 7. No non-null `!` in `src/sje/runtime`.
11. `tests/screen-literals.test.ts` passes: no new 640, 360, 320 or 180 literal.
12. `src/sje/runtime/` has no `Scene3D`, `FxSystem`, `postfx` or effect class (scope guard): `grep -rniE "scene3d|fxsystem" src/sje/runtime` prints nothing.
13. `settings.test.ts` (or the file that holds the settings tests) proves `backfill()` maps `gpuFx: true` to `auto` and `false` to `none`, and an old save loads.
14. `CHANGELOG.md` has an M1 entry; `docs/GLOSSARY.md` has the new names; the record table of section 5 is filled.

## 4. Verifier plan (lean loop)

There is a visual part (the screenshot match), so Mark gets pictures at once after round 1. Criteria are section 3, written before the work.

| Agent | Model, effort | Job |
|---|---|---|
| Builder | sonnet, high | Tasks 1 to 17 in two builds: (A) tasks 1 to 8, 11, 12 (runtime); (B) tasks 9, 10, 13 to 17. Never grades its own work. |
| Runner | sonnet, medium | Runs pass lines 1 to 8, 11, 13. Re-runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 6, 9, 12; correctness of the fault, close-order and microtask code against the spike and `game.test.ts`; that no test is vacuous. |

- Pass: every line holds, no Critical or Important finding is open. Minor findings are named fixes for the next commit.
- A fix round: one fresh verifier checks only the named findings. Cap: 3 rounds, then bring Mark the evidence.
- No attacker agent: no write path, trust rule or save format changes, except the `fxLevel` setting, which the reader checks against `backfill()` and old saves.
- Line 10 is run by the main session on Mark's machine once, after the last fix round.

## 5. Risks and questions for Mark

Risks:

- **Bundle.** The game bundle has 7 bytes of room. The flag (task 12) and `fxLevel` (task 10) add shipped bytes.
- **Two canvases.** The legacy shell uploads two `CanvasImage`s (1.84 MB) and a third breaks the 2 MB proposal. The bench sets the real line.
- **Input and settings.** The new path must read the same `settings` and key bindings as the old one, or a player's setup differs between flags.
- **Scope creep.** Ports of scenes (M3 onward) and effects (M2) tempt the builder. Line 12 guards it.

Questions (Mark decides; this brief does not):

1. **Q1: Bundle alarm. ANSWERED 2026-10-09 (Mark): one bigger total, about 400 kB.** Was: The flag and `fxLevel` need about 0.3 to 1 kB gzip. Raise `GZIP_TOTAL_MAX` from 240.8 kB to 241.8 kB? Recommend yes, set to measured size plus 0.2 kB, as one deliberate edit with a dated comment.
2. **Q2: `fit` mode (E13). ANSWERED 2026-10-09 (Mark): drop `fit`, `integer` only; `settings.scale: 'fit'` migrates to `integer` in `backfill()` (build B, task 10).** Was: Retire it (option A: `integer` only, `settings.scale: 'fit'` migrates to `integer`) or build both (option C)? Recommend A: the integer presenter never resamples, and `fit` has no tested design on the whole-window canvas.
3. **Q3: Spike archive tag.** Tag `spike/engine-platform` now that its runtime is copied? Recommend wait until M1 merges.

## Decisions taken (main session, 2026-10-09)

1. Q1 is answered (one bigger total, start 400 kB). Q2 and Q3 wait for Mark. Build proceeds with `integer` mode only (works under both Q2 answers).
2. `Rng` move: `src/engine/rng.ts` stays as a re-export so no old import changes.
3. Bench and GPU line run once locally at the end (principle 12), not in CI.
