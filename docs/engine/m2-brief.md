---
type: plan
title: "Shadow Jog Engine — M2 build brief"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m2, plan, effects]
---

# M2 Effects: build brief

Source: [migration.md](migration.md) "M2 Effects", [frame-and-rendering.md](frame-and-rendering.md) sections 6.3 to 6.5 and 8, [interfaces.md](interfaces.md) section 5, [scene-graph.md](scene-graph.md), [m1-brief.md](m1-brief.md) (the shell this builds on), and the lean loop in `CLAUDE.md`. Branch: `engine-m2-effects` (from `main` after PR #46). Old code to port: `src/engine/postfx.ts` (251 lines, the facade), `src/engine/gl/presenter.ts` (587 lines, the shaders and passes), `src/engine/particles.ts` (279 lines, the CPU simulation). Pass lines were written before any code.

## 1. Goal

- Under `?engine=sje`, the `postfx` facade routes to a new `FxSystem`. Bloom, 4 shockwaves, color split, 4 hazes, 2 glitches, dim, flash, vignette and the particles draw through Pixi, with the same method names and signatures.
- `src/data/fx.json`, `src/data/fxdata.ts` and `src/engine/moments.ts` do not change. `playMoment` hits look the same as the old presenter.
- The default path (no flag) does not change in behavior. The old `GlPresenter` stays until M6.
- Not in M2: porting the FX lab or any other editor (milestone ET in `migration.md`), `Scene3D` and 3D (M1b, M7), ports of scenes to retained mode (M3 on), a hit-flash or outline wrapper nobody calls yet, `pixi-filters`.
- Exit check (migration.md): a side-by-side of `playMoment` hits, old presenter against `FxSystem`, that Mark reviews. Effect specs run at `full` on SwiftShader.

## 2. Design decisions taken (the brief, not Mark: none changes an approved design)

1. **State is shared, drawing is new.** The pure state of `PostFx` (the lists of shocks, hazes and glitches, `envelope`, `update`, `clear`, `later`, the comfort settings) moves to `src/sje/fx/fxstate.ts` (no GL, no Pixi). The old `PostFx` extends it. `FxSystem` extends it too and adds the drawing. One copy of the logic, so the two paths cannot drift. The diff in `src/engine/postfx.ts` is a move, not a rewrite (`MAX_SHOCKS`, `Shock` and the other exports stay re-exported).
2. **Where the legacy layers go.** A legacy scene draws into a `CanvasImage`. Today's glow layer and UI layer are two more canvases (`postfx.glow`, `postfx.ui`). The new path keeps this shape: `postfx.glow` and `postfx.ui` are `CanvasImage`s owned by `FxSystem`, created only when the level is not `none`, and `glowLayer()` returns their `ctx`. The frame is: scenes into the world, glow blurred and added in the composite, `CompositeFilter` on the world root, the UI image over it unfiltered, particles over that (the old pass order). The bench (M1) says a third canvas upload costs; the glow canvas is cleared and uploaded only on frames where `glowUsed` is true.
3. **Levels.** `full` (real GPU, or forced with `?fx=full` or a setting), `lite` (software GL, not forced: per-object filters, flash, dim, particles; no bloom or whole-screen composite), `none`. `settings.fxLevel` keeps its M1 values (`none`, `auto`, `full`). `auto` picks `lite` when `SOFTWARE_GL` (from `src/engine/gl/presenter.ts`; move or import it, do not copy the regex) matches the renderer name. `lite` is never stored in settings.
4. **Particles.** The CPU `ParticleSim` stays the simulation. `FxSystem` draws it with a Pixi `ParticleContainer` (4,096 `Particle`s, one draw call). The glitch seed comes from the seeded visual `Rng`, not `Math.random()` (frame-and-rendering.md section 8).
5. **Shaders.** The GLSL of `blur` and `comp` is vendored in `src/sje/render/shaders/` and ported to GLSL ES 3.00 for Pixi (both shaders, `uInputSize` declared, no empty uniform group: section 6.4 traps). Game code never writes GLSL.
6. **Warm-up.** `FxSystem.warm()` draws each effect once off screen during the title or load. No first-use compile in a `playMoment` frame.
7. **Comfort settings.** `motion` and `intensity` already live in the facade fields that `src/boot.ts` sets. The new path sets them the same way, with no change to `boot.ts` logic.
8. **Centers.** Defaults stay `W / 2` and `H / 2` (read at call time, as now).
9. **Editor contract (principle 11, Mark 2026-10-09).** `FxSystem` is built so a future FX editor drives it without a rewrite. The existing FX lab is NOT ported or tested in M2 (that is milestone ET); M2 only builds the engine side. (a) Every look tunable that is a shader constant or a code constant today (bloom curve and blur weights, vignette shape, dim spare threshold, particle caps, the `MAX_*` slot counts that the shader allows) goes into one documented `FxParams` object with today's values as the defaults. Slot counts that the shader fixes are marked read-only. (b) `FxSystem.loadData(fx)` takes the parsed `fx.json` and swaps it in a running game (hot reload), using `checkFx` from `fxdata.ts`. (c) `snapshot()` returns the live effect state as plain JSON (no functions), `restore(s)` puts it back. (d) `step(n)` advances the effect clock by n ticks with no scene running, so a tool can scrub. (e) `playMoment` can run on an `FxSystem` that has no scene. The GPU layers stay engine-owned; none of this exposes a Pixi object. (f) What stays hard-coded on purpose, because it is the form of an effect and not its tuning: the haze falloff (`f = 1 - dot(d, d)`, then `f *= f`) in `render/shaders/composite.ts`, the shock ring profile (`exp(-x * x)` of the distance to the ring, in units of its width), the glitch hash constants (12.9898, 78.233, 43758.5453), the five particle shape alphas in `fx/fxparticles.ts` `shapeAlpha` (soft `(1 - r)^2`, spark, ring edges `smoothstep(0.6, 0.8)` and `smoothstep(0.88, 1)`), and the `0.001` epsilons that guard a divide or a clamp. A tool that needs one of these changes the shader or the code, not `FxParams`. (g) The look numbers of the state itself (the color split and pulse decay and floor, the dim fade in and out, the starting vignette) are in `FxParams` too, through `FxStateLook` in `fxstate.ts`. The old `PostFx` keeps `DEFAULT_FX_LOOK`; `FxSystem` points the state at its own `params`.

## 3. Tasks, in build order

1. **Survey.** List every caller of `postfx.*`, `glowLayer()`, `postfx.ui` and `postfx.glow` in `src/` (scenes, `battlekit/gpufx.ts`, `battlekit/render.ts`, `moments.ts`, `dev/fxlab.ts`, `dev/trailer.ts`, `boot.ts`). Read `GlPresenter` pass by pass and list every uniform slot and its source. Put both lists in the builder report. Find how the old presenter can be shown on the Playwright GPU run (it refuses software renderers by name); the answer decides how the side-by-side runs.
2. **`FxState` move.** Task 1 of section 2. `tests/postfx.test.ts` (or the existing test file of the facade) must pass unchanged against the old `postfx`.
3. **Shaders and `CompositeFilter`.** Port `comp` and `blur`. `CompositeFilter` is one `Effect` on the world root with the same data slots (4 shock rings, 4 hazes, 2 glitches, color split, bloom A and B inputs, light input, dim that spares lit pixels, flash, vignette, time).
4. **Glow chain.** Glow `CanvasImage` to a render texture, blurred at 1/2 and 1/4 size (game resolution, section 6.3), added in the composite. Only lit pixels bloom, as today.
5. **Particles.** `ParticleContainer` over the UI, clip rectangle honored (`postfx.clip`).
6. **`FxSystem`.** `src/sje/fx/fxsystem.ts`. Level selection, `active`, `glowLayer()`, `warm()`, `update()` called once per tick by `Game`, `clear()` on scene change (as `Game` does today). Wire in `Game.render`: the game-level flash and fade stay in the UI layer as in 2D (`postfx.flashColor` and `flashAlpha`, as `engine/game.ts` lines 381 to 385 do).
7. **Routing.** Under the flag, `src/sje/boot.ts` makes the `postfx` module singleton delegate to the `FxSystem` (one attach call; no scene or data file changes). The `#fx` overlay canvas is not created on the new path.
8. **DEV hook.** `window.__SJ__`: `fx` (level, active, counts of live shocks, hazes, glitches, particles), `setFxLevel(level)`. Also the existing `gpu(on)`. Add a way to fire any `playMoment` hit by name from the DEV tab (a button list), for playable checkpoint 1 (line 15).
9. **Tests.** Section 4. Each check needs a negative control.
10. **Docs.** `CHANGELOG.md` entry; `docs/GLOSSARY.md` and `docs/CONCEPTS.md` for `FxSystem`, `FxState`, `CompositeFilter`, fx levels, `ParticleContainer`; `DEVELOPING.md` recipe (`?engine=sje&fx=full`); `.claude/skills/engine/SKILL.md` (fx read order); `tooling-and-testing.md` section 7 gets the fx-level costs; update the shader inventory status in `frame-and-rendering.md` 6.5 from "Not built" to built.
11. **CI.** Add `e2e/sje-fx.spec.ts` to the `e2e` job. `e2e/sje-fx-compare.spec.ts` (old against new, GPU) stays local like `sje-bench.spec.ts`.

## 4. Hard pass lines

Each line is a command or a count. A fresh agent runs them.

1. `npm run check` exits 0. Judge by exit code.
2. `npx vitest run tests/postfx.test.ts tests/sje-fx.test.ts` exits 0. The state cases (spawn, cap at 4, 4 and 2, `envelope`, `update` aging, `dim` deeper-wins, `later`, `clear`) run as one shared table against BOTH the old `postfx` and `FxSystem`. Control: a mutant of `FxState` (cap off by one, `clear` forgets `pending`) fails the matching case on both.
3. `npx playwright test e2e/sje-fx.spec.ts --reporter=line` exits 0 under SwiftShader with `?engine=sje&fx=full`. For each of these effects the test turns it on at a fixed tick and reads the canvas: shockwave, color split, haze, glitch, dim, flash, vignette, bloom, particles. Each changes pixels inside its expected region and leaves pixels far outside it unchanged. Control: with `fx=none` the same call changes nothing. Frame hash at tick N is equal across two runs (determinism).
4. No mixed block: with every effect on, at device pixel ratio 1 and 1.5, the canvas has 0 uneven k-by-k blocks (the Phase 0 count, 230,400 blocks at 640x360).
5. 0 GL errors and 0 console warnings across the whole `sje-fx` run. `FxSystem.warm()` runs before the first moment: no shader compile in the frames of a `playMoment` (check by the compile count of the DEV hook or by the frame time of the first hit against the tenth, recorded).
6. The side-by-side exists: `npx playwright test e2e/sje-fx-compare.spec.ts` (local, GPU) writes, for each moment in `src/data/fx.json` that `playMoment` can fire, a PNG pair (old presenter, `FxSystem`) at fixed ticks to `media/m2-fx/`, and a table of changed pixels (count and the largest channel difference). Mark gets the pictures. **A pixel difference is evidence, not a gate** (the look is Mark's decision, E8); only a missing effect, a wrong place or a crash fails this line.
7. Default path unchanged: `npx playwright test e2e/playthrough.spec.ts e2e/prod.spec.ts e2e/gpufx.spec.ts e2e/fxlab.spec.ts --reporter=line` exits 0. `__SJ__` stays absent in the production build.
8. `git diff --stat main...HEAD -- src/data src/engine/moments.ts src/scenes src/field src/battle src/story` is empty (principle 8: `FxSystem` keeps the signatures). `src/engine/postfx.ts` shows only the move to `FxState` and re-exports. `src/engine/gl/presenter.ts` shows at most an exported `SOFTWARE_GL` and nothing else.
9. `npm run budget` exits 0. The `boot` class holds no `pixi.js` module. The new shaders and `FxSystem` are in the `?engine=sje` chunk. At the end of M2, set `GZIP_TOTAL_MAX` to the measured total rounded up to the next 1 kB (Mark, 2026-10-09: "one bigger total"; a dated comment, measured delta only).
10. `npx playwright test e2e/sje-canaries.spec.ts e2e/sje-draws.spec.ts e2e/sje-shell.spec.ts --reporter=line` exits 0. `sje-draws` gets a new case: the draw calls and texture binds of a frame with the full effect stack, written down as numbers and asserted as an upper bound. The leak test is flat across 10 enter and exit cycles with the stack on (no render texture, filter or particle leaks).
11. `grep -rn "pixi.js" src --include=*.ts` hits only `src/sje/render`, `src/sje/display`, `src/sje/fx` and `src/sje-lab`. `tests/sje-imports.test.ts` is updated for `src/sje/fx` and passes. No non-null `!` in `src/sje/fx`. `grep -rniE "scene3d" src/sje/fx` prints nothing.
12. `tests/screen-literals.test.ts` passes: no new 640, 360, 320 or 180 literal in `src/sje/fx` or the shaders (they read `W` and `H`, or take the size as a uniform).
13. The GPU run, once, at the end (principle 12), by the main session: `npm run perf` on the local GPU. The frame interval p95 at `full` with the stack on is within 5% of the bare page. Cost p95 at most 8 ms. The numbers go in `tooling-and-testing.md` section 7.
14. `CHANGELOG.md` has an M2 entry. `docs/GLOSSARY.md` has the new names. The record table of section 6 is filled.
15. **Playable checkpoints (Mark, 2026-10-09).** Mark plays the build at two points and the plan stops for him at each.
    - **Checkpoint 1, after Builder B (before verification round 1):** `npm run dev`, then `http://localhost:3007/?engine=sje&fx=full` plays title, field and battle with every effect live. A DEV hotkey or DEV tab button fires each `playMoment` hit on demand. The main session starts the server and gives Mark the URL. A look change Mark asks for here is a named fix and does not count against the 3-round cap.
    - **Checkpoint 2, after the last fix round:** the same build, with the side-by-side pictures (line 6) and the `npm run perf` numbers (line 13) ready. Mark plays it, then merges or sends work back.
16. **Editor contract.** `tests/sje-fx.test.ts` proves: `FxParams` has a default for every tunable and a changed value changes the output (a CPU-side check of the uniform value); `loadData` swaps presets and moments in a live `FxSystem` and rejects bad data with `checkFx`'s messages (control: bad data leaves the old data in place); `restore(snapshot())` after more ticks gives the same frame hash as the original at that tick; `step(n)` equals n real ticks. The reader checks that no constant that changes the look sits in a shader or in `FxSystem` outside `FxParams`. No FX lab test: it is milestone ET.

## 5. Verifier plan (lean loop)

There is a visual part, so Mark gets the pictures at once after round 1. Criteria are section 4, written before the work.

| Agent | Model, effort | Job |
|---|---|---|
| Builder A | sonnet, high | Tasks 1 to 6: survey, `FxState` move, shaders, glow chain, particles, `FxSystem`. |
| Builder B | sonnet, high | Tasks 7 to 11: routing, DEV hook, tests, docs, CI. Starts after A is committed. |
| Runner | sonnet, medium | Pass lines 1 to 7, 9, 10, 12. Re-runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 8, 11; correctness of the shader port against `GlPresenter` (every slot, same math); that the state move changed no behavior; that no test is vacuous. |

- Every builder prompt says: no `Co-Authored-By` line in any commit, set the repo rule over the harness reminder.
- Pass: every line holds, no Critical or Important finding is open. Minor findings are named fixes for the next commit.
- A fix round: one fresh verifier checks only the named findings. Cap: 3 rounds, then bring Mark the evidence.
- No attacker: no write path, trust rule or save format changes.
- Line 13 is run by the main session once, after the last fix round.

## 6. Risks, and the record

Risks:

- **Look drift.** A GLSL ES 3.00 port in a Pixi filter can differ in rounding or in the texture coordinate of the 1/2 and 1/4 blurs. The side-by-side is the check. Do not tune the look without Mark.
- **A third canvas upload** (the glow canvas) on top of the scene canvases. Upload only when `glowUsed`. The bench sets the line.
- **SwiftShader cost.** The full stack at 1280x720 is not measured. Measure each level (`full`, `lite`) and record it.
- **Scope creep.** Hit flash, outline and ripple wrappers have no caller yet: leave them for M3.

Questions for Mark (the build proceeds with the recommendation; none blocks):

1. **`lite` contents.** Recommend: per-object filters, flash, dim and particles, with no bloom or composite on software GL.
2. **`hiRes` bloom** (a finer glow, section 6.3): recommend no, decide after the side-by-side.

| Step | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| (to fill) | | | | |
