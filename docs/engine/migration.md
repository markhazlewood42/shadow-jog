---
type: design
title: "Shadow Jog Engine — Migration"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-05
status: approved 2026-10-05 (final). First approval 2026-10-04 (all recommendations). Phase 0 update on 2026-10-05, accepted with all recommendations
tags: [engine, design]
---

# Shadow Jog Engine — Migration

This file gives the path from today's engine and from the Phaser spike to the new engine. The shipped game still works at every step. The new engine moves in scene by scene.

> **Read first:** [Three things that look like Phaser and are not](README.md#2-three-things-that-look-like-phaser-and-are-not). Tag meanings are in the "Tags" table at the top of [conventions.md](conventions.md).

**No effort estimates.** This file gives no agent-day, hour or price numbers (Mark, 2026-10-05). Effort here means architectural fit: which modules and files a step touches, and whether it fits the current architecture or needs a rewrite.

---

## 1. Principles

1. **No engine code before you approve the design.** This is your gate (decision 17). You approved the final design on 2026-10-05, so the gate is lifted. M0 may start after the 640x360 move merges.
2. **Spikes test the approved design.** The platform spike (Phase 0) follows `docs/DEVELOPING.md` section 9: a `spike/<topic>` draft PR that is never merged, with `docs/spikes/<topic>.md` and exit criteria committed before the spike code.
3. **The shipped game still works at every step.** The new engine starts behind a flag: `?engine=sje` in dev, a hidden setting in production. CI stays green on both engines until the default flips.
4. **The old engine is not touched** until M8, except for the `W` and `H` import move in M0 and the size fixes of the 640x360 move. The move changes 5 files in `src/engine` before M0 (`display.ts`, `game.ts`, `postfx.ts`, `particles.ts` and `gl/presenter.ts`). The edits are the size value in `game.ts`, the shake scale, the center defaults in `postfx.ts`, one exported function in `display.ts`, and comments in `presenter.ts` and `particles.ts`. You approved the move on 2026-10-05 ("Let's pivot. Better now than later."). This is the only bend of this principle.
5. **One branch and one PR per milestone** (repo rule). Each PR adds a `CHANGELOG.md` entry. Names are readable: `engine-m1-shell`.
6. **Build a class only when a ported scene needs it.** The Phaser spike called about 15 display methods. We do not rebuild all of Phaser.
7. **Hybrid by scene.** A scene moves to retained mode only when it needs a camera, a filter, a mask, or a transition. UI scenes may stay on a canvas shell for good (section 4).
8. **Your data is read byte for byte.** `src/data/*.json` never changes in a migration step.
9. **Every step goes through an independent verification loop** ([verification.md](verification.md)): three fresh verifier agents score a rubric written before the code. A step passes only with every pass line met, every criterion median at 7 or higher and an average of 8 or higher. The cap is 3 rounds, then the work comes to you. Since 2026-10-08 the lean loop of `CLAUDE.md` replaces this loop (Mark).
10. **Visual updates.** Each time a test renders something, you get the screenshots right away ([verification.md](verification.md) section 4).
11. **The editor rule** (Mark, 2026-10-05, `docs/IDEAS.md` entry 1). No decision may make a future visual editor harder. Game content is data that a tool can open and save. Content that is TypeScript today moves to data files ("Content moves to data files" after M8). Every new decision says how an editor would read and write what it changes. **The editor contract (Mark, 2026-10-09):** the goal is that Mark builds the game mostly in UI editors. So every engine system that a tool could drive (effects, stage, camera, lights, weather, UI, scripts) ships with: (a) its tunables in one plain, documented parameter object with data defaults, not constants in code or shaders; (b) content and parameters that load from and save to JSON; (c) a way to hot-reload that JSON into a running game; (d) `snapshot()` and `restore()` of its live state; (e) a deterministic `step(n)` so a tool can scrub and preview. Each milestone brief checks these. [decisions.md](decisions.md) records the check of every approved decision.
12. **GPU timing check: once per milestone, only when the milestone changed the draw path (Mark, 2026-10-09).** CI runs no timing gate, because a software renderer says nothing about GPU timing. Instead, at the end of a milestone that changed how frames are drawn, one session runs `npm run perf` on Mark's machine (a real GPU, never in CI), once, before the milestone PR is marked ready. It records the numbers in the milestone record and fails the milestone only if the speed line breaks (interval within 5% of a bare page, cost p95 at most 8 ms). It does not run on every PR or every phase. Milestones that run it: **M1, M2, M3, M5, M6, M7** (they change the loop, the renderer, effects, the stage, the field or the presenter). **M0 (done, measured), M1b, M4 and M8 skip it** unless their diff touches `src/sje/render/`, `src/sje/display/`, `src/sje/three/` or `src/engine/gl/`. A hot-path change outside a milestone can also ask for one run, as before.

---

## 2. The milestones

"M" means a build milestone. "E" means an open decision ([decisions.md](decisions.md)). "T" means a test tier ([tooling-and-testing.md](tooling-and-testing.md)).

![The order of the engine migration, read from top to bottom in three zones. Before code: the design gate where you approve, the Phase 0 platform spike, and Mark approving the final doc. Build: M0 Prepare, then M1 Shell. M1 splits into M2 Effects and M1b 3D proof, which run in parallel. M2 leads to M3 Battle stage. M3 splits into M5 Field and the optional M4 UI scenes, and both join at M6 Flip default, the moment the new engine becomes the default. Finish: M7 3D mode, which needs both M1b and M6, then M8 Remove legacy.](diagrams/engine-migration-milestones.png)

*Editable source: [diagrams/engine-migration-milestones.html](diagrams/engine-migration-milestones.html)*

| Milestone | One-line scope | Touches |
|---|---|---|
| **Phase 0** Platform spike | A spike branch that closed the unknowns (section 3). Done. You gave your final approval on 2026-10-05. | `src/sje/`, `src/sje-lab/`, `src/hack3d/`, `src/battlestage/`, `e2e/`, `tests/`, `docs/spikes/` |
| **Pre-M0** 640x360 move | Move the shipped game from 480x270 to 640x360 on its own branch. It merges before M0 and bends principle 4. Exit check: the shipped game plays at 640x360 and CI is green. | 5 files in `src/engine` (the principle 4 list), about 49 more source files outside it, `src/data/fx.json` (3 shockwave values, with your yes), tests and specs |
| **M0** Prepare | Size module, bundle gate, canary suite, agent docs | `src/sje/core/size.ts`, `scripts/bundle-budget.mjs`, `.claude/skills/engine/`. One re-export in `src/engine/game.ts` |
| **M1** Shell | Loop, renderer, scene stack, `LegacyScene` adapter | New code in `src/sje/` (core, render, display, runtime, the facade). The old code gets the flag in `src/main.ts` |
| **M1b** 3D proof (parallel with M2) | A spinning cube in a `Scene3D`, with the hand-off, leak, and loss tests | `src/sje/three/`, `src/sje/render/glhandoff.ts`, the lab page |
| **M2** Effects | `FxSystem` with the `postfx` facade, composite filter, particles | `src/sje/display/` and `src/sje/render/shaders/`. The old `src/engine/postfx.ts` routes to it under the flag. `fx.json`, `moments.ts` and `fxdata.ts` do not change |
| **M3** Battle stage | Port the spike's `src/stage` | `src/battlestage/`, `battle.ts`, `src/battle/fx.ts`, the stage data, and the enemy data (it moves to a data file) |
| **M4** UI scenes (optional) | `NineSlice` windows, `ListMenu`, bars, cursor, `TextObject` | The UI scenes that port. Each keeps its e2e spec |
| **M5** Field | The field map, actors, camera, lights, weather | `src/field/`, the `src/art/` painters, and the maps (they move to data files) |
| **M6** Flip default | `?engine=sje` becomes the default. Remove the old presenter | `src/main.ts`, `src/engine/gl/`, `src/dev/fxlab.ts`, `scripts/bundle-budget.mjs`, and the specs that used `#fx` |
| **M7** 3D mode | `ThreeHost`, `Frame3D`, `Scene3D`, the minimal test scene, `s.hack()` | `src/sje/three/`, `src/hack3d/`, `src/game/script.ts` (`ScriptApi.hack`) |
| **M8** Remove legacy | Delete the old engine files | `src/engine/{game,display,postfx,gl}`, `LegacyScene`, `ARCHITECTURE.md`, `DEVELOPING.md` |
| **ET** Editor port | Bring every existing editor and tool onto the new engine: FX lab (M6), Battle Stage Editor and Battle Test (M3), animation editor, art review, DEV menu. They need the editor contract (principle 11) from each system. No new tool features. | `src/dev/`, `src/battlestage/`, `src/sje-lab/`, `docs/TOOLING-UI.md` section 4.5 |
| **Editors** (after Chapter 1) | New editors, so that Mark builds the game mostly in UI: troops and encounters, database (enemies, skills, items), maps and level editor, conversation editor, animation composer, lights and weather, game-system config. Post-Chapter 1 work. Plan and order: `docs/TOOLING-UI.md` section 4. | New tools under `src/dev/`, data files from "Content moves to data files" |

The Pre-M0 move merges to `main` before M0 starts. M0 builds on the 640x360 game. The milestones diagram starts at M0 and does not show it.

**Fit.** Every milestone adds code beside the old engine and moves one part in. The old engine stays behind the flag until M8. The one earlier touch of the old engine is the 640x360 move (principle 4).

### M0 Prepare

- Create `src/sje/core/size.ts` with `W = 640` and `H = 360`. The 640x360 move of the shipped game may already have replaced the uses of 480, 270, 240, and 135 that mean screen width, height, or center. Replace what is left. Add the literal scan that keeps it done ([tooling-and-testing.md](tooling-and-testing.md) section 3).
- Move the `W` and `H` imports (46 files at M0). Phase 0 already made `src/engine/game.ts` re-export `W` and `H` from `size.ts`, so the old engine and the new engine cannot disagree. M0 measured the shipped bundle: the same code, plus 4 raw bytes (and 2 to 10 gzip, depending on the gzip method) of export-alias text in the shared `tables` chunk, because the new `size.ts` module changes how the bundler names that chunk's exports. `FPS` is defined once, in `size.ts`; `game.ts` re-exports it.
- Add a gate on the time between frames and a harness that counts GL objects. Both go into the perf spec.
- Rewrite `bundle-budget.mjs` to read the Vite manifest and sort chunks into classes.
- Pin Pixi and Three. Pin `@types/three` too (three 0.186 ships no types). Phase 0 did this: `@types/three` 0.186.0. Add the lab page and the canary suite. They test Pixi and Three directly.
- Add the engine skill and `verified-conventions.md`.
- Compile the sketches in [interfaces.md](interfaces.md).
- Copy the lab scripts that the canary suite needs from `media/research-2026-10-04/` into the repo. The lab record is already in `docs/research/2026-10-04-engine-labs.md`.
- Fix doc drift (`?debug` note, chunk count).
- **The game still works:** the old game is unchanged.
- **Exit check:** canaries green on SwiftShader. The bundle gate passes at the size of the shipped game after the 640x360 move (233.9 kB gzip before it).
- **Built 2026-10-09** (builder report in [m0-brief.md](m0-brief.md)). Three differences from this list: the canaries test Pixi and Three through a lab that composes `GlRenderer`, `Screen`, `TextureManager` and `FixedLoop` (the spike's lab ran on `Game`, which is M1), so `src/sje/runtime/glrenderer.ts` came in with M0 and `Scene3D` waits for M1b; the lab scripts of `media/research-2026-10-04/` were not needed, because no canary runs one; and the move touched 46 files, not 34.

### M1 Shell

- Build `Game.create`, `FixedLoop`, `GlContext`, `PixiRenderer`, `BackBuffer`, `Presenter`, `Display`, `EventEmitter`, `SceneManager`, `Scene`, and the `LegacyScene` adapter.
- Build the `GameApi` interface. The old `Game` implements it too.
- Add the boot failure message, the hidden-tab clamp, fault isolation, and the DEV hook.
- Add the `fxLevel` setting with the `gpuFx` mapping ([frame-and-rendering.md](frame-and-rendering.md) section 11).
- Move the old `Rng` into `src/sje/core/` (section 5). The Phase 0 hack simulation and 3D chunk import the old copy from `src/engine/rng.ts`.
- Build the Phaser scene operations (`launch`, `pause`, `stop` and the rest), `Loader`, input, `time`, `tweens`, and the fades and camera effects. Phase 0 did not build them. They are absent from the types, so a call to one is a compile error.
- Decide how `fit` mode works with the whole-window canvas (E13). Phase 0 built the integer presenter only.
- No effects yet. The old GL presenter is not in this path.
- **The game still works:** the flag gates the new path. Legacy scenes draw into `CanvasImage`s. The 22 `Scene` subclasses and all story scripts run unchanged.
- **Exit check:**
  - Title, field, battle, and shop play under `?engine=sje`.
  - The fault, abandon, curtain, exit-throw, and two render-fault cases of `tests/game.test.ts` pass on the new `Game`.
  - New tests for close order and microtask timing pass.
  - A block test and a screenshot match the old 2D path.
  - The 1,000-object bench is recorded, and the performance budget in [tooling-and-testing.md](tooling-and-testing.md) section 7 gets real numbers.

### M1b 3D proof

- M1b builds a first `Scene3D` for the proof. The real `Scene3D` on the real loop is M7.
- Build a spinning cube in that `Scene3D`, the `GlHandoff` canary, 10 enter and exit cycles, the context-loss watchdog, and the no-WebGL2 result.
- Put a filter and an iris mask on the `View3D`.
- The hidden-scene draw skip and the context grace are not part of M1b. They are in M7 (spike cleanup C12). The first draft put them in M1b, and the spike moved them.
- The real hack game waits for M7.
- **The game still works:** lab page and flag only.
- **Exit check:** the leak harness stays flat. The canary is green. A look screenshot goes to you. With no WebGL2, the lab shows a plain message within 2 seconds. (The `s.hack` result `unsupported / no-webgl2` moves to M7, which builds `ScriptApi.hack`; decided in [m1b-brief.md](m1b-brief.md), 2026-10-09.)

### M2 Effects

- Build `FxSystem` with the `postfx` facade: the composite filter port (bloom, 4 shockwaves, color split, 4 hazes, 2 glitches, dim, flash, vignette), `ParticleContainer`, the glow layer, the fx levels, `fxLevel`, and shader warm-up.
- `moments.ts`, `fxdata.ts`, and `fx.json` do not change, because `FxSystem` keeps today's method signatures. `FxSystem` keeps the center defaults of `postfx` at `W / 2` and `H / 2` (the 640x360 move sets them).
- **The game still works:** the legacy `postfx` facade routes to `FxSystem` under the flag.
- **Exit check:** `playMoment` hits look the same as the old presenter in a side-by-side that you review. Effect specs run at `full` on SwiftShader.

### M3 Battle stage

- Port the spike's `src/stage`. About 3,400 lines call Phaser APIs and about 8,000 do not.
- Build `Figure`, the texture manager (the spike's `textures.ts` is the base), the HUD, the Battle Stage Editor, and Battle Test.
- Wire `battle.ts` to `PlaybackView`. Port the `battle/fx.ts` painters to canvases.
- Measure Pixi parity with the stage. Use two sets of references, `gpu` and `soft` (section 6).
- Decide how the 320x180 world layer reaches the stage (it was 240x135 at 480x270). Phase 0 kept the bake at 2x on a canvas, as the spike does. `container.setGrain(2)` is the other way. Phase 0 did not build it. It tested what a 2x parent does to the pixels of its children ([scene-graph.md](scene-graph.md) section 7).
- Decide what the battle push camera (up to 1.09x) may do. Neither rounding setting puts the picture on one pixel grid at 1.09x ([scene-graph.md](scene-graph.md) section 7).
- Lay the stage out for 640x360: the stage config, the backdrop at 320x180, and the stage data. This changes numbers in your stage data. Principle 8 applies, so you decide how that change is made.
- Move the enemy and troop data from TypeScript (`src/data/enemies.ts`) to a data file. The stage already reads each enemy's picture, mirror and axis key from it. This is the editor rule (principle 11). You approve the file format first.
- Pick one `Raw` type. The Phase 0 stage uses `{ w, h, px }` and the engine uses `{ w, h, data }`. Move `addCanvasOnce` and `variantOf` into `TextureManager`, and add `readPixels(key)`. Phase 0 keeps them game-side in `src/battlestage/textures.ts`.
- Make the stage `config.ts` use the engine's `depthFor`. Phase 0 has two functions with one result, and a test pins that they agree.
- Move the game font (`src/engine/font.ts`) into `src/sje`. `TextObject` itself stays in M4 (E14). The Phase 0 3D HUD imports the old copy.
- M3 reuses the Phaser stage slice that Phase 0 builds (translation layer and parity harness).
- **The game still works:** the battle plays on the new stage under the flag.
- **Exit check:** the editor and Battle Test pass. A scripted Battle Test (seed 7) gives an identical status trace. Pixel parity is within a tolerance that you agree. At 640x360 the Phaser spike cannot be the reference ([tooling-and-testing.md](tooling-and-testing.md) section 5), so M3 sets how parity is measured.

### M4 UI scenes (optional)

- Build `NineSlice` windows, `ListMenu`, bars, cursor, and `TextObject`.
- Move the shop and dialogue content from TypeScript to data files when their scenes port (principle 11). Do it sooner if a conversation editor starts.
- The scenes: title, menu, options, dialog, shop, panels, deck, saveload, card, controls, ending, gameover. They hold about 270 `drawText` and 57 `drawWindow` call sites.
- **The game still works:** a scene ports only when it needs a camera, filter, mask, or transition. The rest stay on `CanvasImage`.
- **Exit check:** each ported scene's e2e spec passes.

### M5 Field

- Build the field map as 4 baked `ImageObject` layers (largest 960x672).
- Move the maps (`src/data/maps/*.ts`) from TypeScript to data files. The field reads them through the loader. A level editor can then open them (principle 11). You approve the file format first.
- Maps and rooms that are smaller than the 640x360 view: a camera rule centers and fills them. No map data changes without your yes for each map.
- Build actors with `ySort`, the camera with pan easing and bounds, `Lights`, per-frame prop animations and water shimmer as `CanvasImage` painters, and weather. The lights of a map are part of the map data file (E20 condition, [decisions.md](decisions.md) editor rule check).
- **The game still works:** the field stays on the legacy shell until this milestone lands.
- **Exit check:** walking, warps, scripts, emote, and followers play. The playthrough spec is green. **You approve the lighting.**

### M6 Flip default

- Make `?engine=sje` the default. Remove `GlPresenter` and the `#fx` path.
- Port the FX lab. Rewrite specs that used `#fx`.
- Re-baseline the perf gates on CI at 640x360. Set the bundle caps. Add goldens.
- **The game still works:** the old path stays one release in git history. It is not shipped. Players without WebGL 2 see the message from E5.
- **Exit check:** full CI is green on SwiftShader. Playthrough, chaos, perf, prod, and gameover pass.

### M7 3D mode

- Build `ThreeHost`, `Frame3D` (shared context and fallback), the real `Scene3D` on the real loop, `s.hack()`, `HackResult`, the story loop and its `via: 'dropped'` result, the lifecycle and leak tests, and the transition from 2D to 3D and back. The scene that runs is the minimal technical test scene of Phase 0 (`HackScene` and its sim).
- Skip the 3D draw of a scene that is hidden under an opaque scene. In Phase 0 a hidden scene still draws its 3D frame. A naive skip shows a stale frame for one frame when the scene becomes visible again, because the scene manager works out visibility after `prerender`.
- Decide the context grace of the watchdog. Phase 0 used 1 second, not 2, so a context that returns between 1 and 2 seconds is given up on ([frame-and-rendering.md](frame-and-rendering.md) section 7.4). Tune it against a real context loss in the real game.
- **Why these two are here and not in M1b:** M7 builds the real `Scene3D` on the real loop with the real hack game. The skip needs the visibility that the scene manager computes on that loop, and the grace needs a real context loss in that game to tune. You accepted this placement on 2026-10-05.
- The real hacking scene is not part of M7 and not part of this design. Its design, gameplay and look are a separate iteration (Mark, 2026-10-05, `docs/IDEAS.md` entry 2). The Phase 0 scene is a minimal technical test scene. Its look and gameplay were not reviewed.
- **The game still works:** only story scripts that call `s.hack` are new.
- **Exit check:** the 10-cycle leak test, the context-loss test, and the canary tests pass. After the flip, `unsupported` shows only when the 3D chunk fails to load.

### M8 Remove legacy

- Delete `src/engine/{game,display,postfx,gl}`, `LegacyScene`, and the shim events.
- Update `ARCHITECTURE.md` and `DEVELOPING.md`.
- Before the deletion, move every import of `src/engine` out of the new code. Phase 0 found two cases. The 3D chunk imports the old font and `Rng` (moved in M1 and M3). `src/battlestage` imports `src/art/*`, and `src/art/*` imports `surface`, `mix` and `Rng` from `src/engine`. The painters in `src/art` stop importing it as they port (M3 to M5).
- **Exit check:** `tsc`, Biome, and all specs are green. A scan shows that nothing in `src/sje`, `src/hack3d`, `src/battlestage` or `src/art` imports `src/engine`.

### Content moves to data files (the editor rule)

An editor can only open and save data. Much of the game's content is TypeScript today. This table says which milestone moves which content. You accepted the M3, M4 and M5 placements on 2026-10-05. Each move keeps the values the same, and you approve the file format first (principle 8 and principle 11). The editors themselves come later, step by step.

| Content today | Becomes | Milestone | Why there |
|---|---|---|---|
| Stage, HUD and effect values | Already data: `stages.json`, `hud.json`, `fx.json` | Done | The Battle Stage Editor and the FX lab use them |
| Enemies and troops (`src/data/enemies.ts`) | A data file | M3 | The stage port reads them. The troop and encounter editor is the next tool (`docs/TOOLING-UI.md` section 4.1) |
| Maps (`src/data/maps/*.ts`) | Data files | M5 | M5 builds the field from maps. A level editor needs them as data (`docs/TOOLING-UI.md` section 4.4) |
| Shops and dialogue | Data files | M4, when their scenes port | A conversation editor needs the text as data. Sooner if that editor starts |
| Hack definitions | Plain data from the start (a condition of E3) | M7 | A later tool must be able to save them |
| Abilities and items (`abilities.ts`, `items.ts`) | Not scheduled | A separate decision for you | A database editor needs them as JSON (`docs/TOOLING-UI.md` section 4.3) |

**Why this order.**

- M1 first shows, early and cheaply, that Pixi runs the whole game under SwiftShader CI, and that input, audio, saves, and the story bridge are untouched.
- M2 before scene ports, because effects are "the real differentiator" and carry the most Pixi-specific risk.
- M1b right after M1, because the shared context is the riskiest join. It should be retired before many scenes depend on it.
- M3 is the first real port because the spike's seam is narrow and its tests exist.
- M5 is the largest and least certain port. The spike never touched the field.

---

### Editors and tools (Mark, 2026-10-09)

Two tracks, both planned, neither optional for the long run:

1. **ET: bring the existing tools onto the new engine.** The tools were built for the old engine (the FX lab imports the old `Display`, `Game` and `postfx`). Each milestone ports the tool of its own system: the Battle Stage Editor and Battle Test with M3, the FX lab with M6 (it also needs the `#fx` removal), and the animation editor, art review and DEV menu after M6. The FX lab is NOT tested against `?engine=sje` before ET: M2 only builds the engine side so the port is easy (the editor contract). Exit check of ET: every existing tool opens, edits, saves and previews on the new engine, and the old-engine tool code is gone before M8.
2. **Editor suite: new tools (after Chapter 1).** Mark's goal is to build the game himself, mostly in UI editors. The list and layout rules are in `docs/TOOLING-UI.md` section 4. It starts after Chapter 1 ships. Data placement for it is already in "Content moves to data files" below (enemies at M3, shops and dialogue at M4, maps at M5). The abilities and items file is still an open decision for Mark.

The editor contract in principle 11 is what keeps both tracks from becoming a shoehorn job. A milestone that cannot meet it names the gap in its brief and the milestone that closes it.

## 3. Phase 0: the platform spike

Phase 0 is the spike from `docs/research/2026-10-04-engine-and-3d.md` ("Open items", item 2). It runs on a spike branch before any build. It has two parts.

**Part A: the verification lab.** It closes the unknowns that decide the design. It runs the agent-lab experiments again on the CI browser:

- Chromium 153 (the version CI will install, not 151).
- Firefox and WebKit WebGL 2 on the `ubuntu-latest` runner.
- A sprite (alpha) mask and a custom GLSL filter on the `View3D`.
- A mask or filter on a container with sorted children.
- Device pixel ratio 1.5 for filters and blocks.
- `RenderLayer` with filters.
- `roundPixels` with a negative scale (the mirror rule).
- The Pixi-first, Three-later attach order on a real GPU and in Firefox. (A SwiftShader lab already ran it.)

**Part B: the three spike builds.** These are the parts you named:

1. The battle stage on a thin Pixi layer (the spike code with the translation table in section 6). **The Phase 0 slice:** one stage, one hero, one enemy, the HUD off, and parity checked on 3 frames. M3 reuses its translation layer and parity harness, then adds all stages, the HUD, the editor, and Battle Test.
2. A 3D hacking scene that a story script starts.
3. The 480x270 against 640x360 mock.

**The pass lines.** These come from your feedback on 2026-10-04.

| # | Pass line | Where it is tested |
|---|---|---|
| 1 | Bundle growth is measured. The alarm is re-set on purpose. The 3D chunk size is recorded. Lazy chunks get their own class. | Phase 0 Part B. Caps are set in M1 and M6. |
| 2 | 60 fps with bloom on your desktop. Mobile is not a requirement. | Phase 0 Part B, T3. |
| 3 | CI passes on software WebGL. | Phase 0 CI run. |
| 4 | After a context loss, or with no WebGL2, the 3D mode gives a fallback result within 2 seconds. | Phase 0 3D scene. Re-run in M1b and M7. |
| 5 | Enter and leave the 3D mode ten times. Memory does not grow. | Phase 0 3D scene. Re-run in M1b and M7. |
| 6 | A per-object Pixi filter and a mask work on the shared context with Three. | Phase 0 Part A. Re-run in M1b. |
| 7 | The battle stage on Pixi matches the Phaser spike within the agreed tolerance. | Phase 0 Part B. Full parity in M3. |
| 8 | You approve the look. Plan at least two review rounds, with no maximum. | Phase 0 (the stage slice and the size), M2, M5. The look of the real hacking scene is its own iteration. |

Phase 0 ends with an update to this design doc and your approval of the final version. You approved the final version on 2026-10-05, with all recommendations. The evidence is in `docs/spikes/engine-platform.md`. This text is that update.

**Part A answers (2026-10-05).** Browser, renderer and script for each answer are in the spike doc.

| Item | Answer |
|---|---|
| Four effects on the `View3D` and on a container with sorted children: a built-in filter, a custom GLSL filter, a `Graphics` mask and a sprite (alpha) mask | Yes. 8 cases, 0 GL errors. At most 1/255 off a CPU reference on the 3D view, exact elsewhere. Real GPU and SwiftShader. Firefox 153 ran the Part A scripts by hand. |
| Device pixel ratio 1.5 for filters and pixel blocks | Yes. Zero uneven blocks with each of the 8 effects on, at 480x270 and at 640x360. |
| `RenderLayer` with filters | No. Do not use it with filters (the layer's own filter is ignored too). |
| `roundPixels` with a negative scale (the mirror rule) | Exact. 60 combinations give 0 differing pixels. |
| The attach order, Pixi first and Three later | Yes, on the real GPU and in Firefox 153. |
| Chromium on CI | Passes on software WebGL. CI run 37264317312 had 2 timing failures. Round 4 made the two timing checks independent of the renderer's speed. CI is green on `f22dc09` and `d61d7d9`. |
| WebKit on the Linux CI runner | Passes. |
| Firefox on the Linux CI runner | No WebGL2. The no-WebGL2 path (E5) runs there: the clear message, `unsupported / no-webgl2` in under 500 ms, and no 3D chunk request. |
| Firefox 153 on Windows | Passes the 2-test browser spec (`sje3d-browsers`) and the Part A scripts. It did not run the other specs, and it was not run at 640x360. |

Not tested: Safari on macOS, and a real GPU context reset.

**Part B results (2026-10-05).**

- The battle stage slice (one stage, one hero, one enemy, HUD off) matches the Phaser spike at 3 frames. 0 pixels differ. Each page is compared to the Phaser page of the same kind of renderer.
- The 3D hacking test scene starts from a story script. A lost context, no WebGL2, and a dropped story all give a value, and the story goes on or ends as E19 says.
- The 480x270 against 640x360 mock was made. Mark first kept 480x270. The same day he chose 640x360 from the comparison pictures (E12).

**CI results (2026-10-05).** CI is green on `f22dc09` (after one re-run, because the browser install took 22 minutes) and on `d61d7d9`, which ran the strict parity gate on the Linux runner. The spike CI takes about 29 minutes. The job limit on the spike is 45. The first CI run (`4208b60`, run 37264317312) had the 2 Chromium timing failures that round 4 fixed.

**Phase 0 at 640x360 (2026-10-05, spike doc step S1a).** Mark chose 640x360, so every size-dependent exit criterion was measured again with the same specs and scripts. The runs used Edge 154 on the RTX 4070 and on SwiftShader. Nothing under `src/` changed, so the shipped bundle is the same bytes (117 files, SHA-256).

| Pass line | At 480x270 | At 640x360 |
|---|---|---|
| 2 Speed (3D scene with bloom and HUD) | Interval ratio 0.995. Frame cost p95 2.9 to 3.3 ms | Interval ratio 0.995 to 1.000. Frame cost p95 3.2 to 3.5 ms. The full table is in [tooling-and-testing.md](tooling-and-testing.md) section 7 |
| 4 Fallback | Context lost: `aborted / context-lost` after 1,017 ms (software 1,023). WebGL2 off: `unsupported / no-webgl2` in 0 ms | 1,019 ms (software 1,020). 0 ms. The picture after a restore is the picture without a loss |
| 5 Leaks | 17 textures, 4 buffers, 4 framebuffers, 1 program, 2 VAOs, flat after 10 cycles. Heap +2.40% | The same |
| 6 Effects | 8 cases, 0 GL errors, within the tolerance | The same |
| 7 Stage parity | Passes the gate against the Phaser references | Cannot be measured: the Phaser spike draws 480x270. The top left 480x270 equals the 480x270 picture (0 of 129,600 differ). The rest is the void color (0 of 100,800 differ) |
| 8 Crispness | 0 uneven of 129,600 blocks for each check | 0 uneven of 230,400 for each check, at ratios 1 to 2.25, in every scene, on a GPU and on SwiftShader |
| 3D target against the back buffer | 0 of 129,600 differ | 0 of 230,400 differ |

**Not measured at 640x360.**

- CI hardware. The 7 new checks of step S1a (209 tests in the list) have not run on CI yet.
- Other browsers. Only Edge ran. Firefox 153 on Windows and WebKit did not run at 640x360.
- Other displays. The numbers are for one RTX 4070 and one display of about 56.6 Hz. A weaker GPU may show a size effect.
- Parity with your art at 640x360. It is local only, and it was measured at 480x270.
- The 640x360 layout of the stage, the 3D caption bar and the badges. This is the move of the shipped game.
- Effects on a scene that is laid out for 640x360. The effect cases use the lab content, laid out for 480x270.

**Amendments to the pass lines (2026-10-05).**

- **Pass line 2 (speed).** The test machine's display refreshes at about 56.6 Hz. No page can reach a 16.7 ms frame interval on it. Mark's own display is not measured separately. "60 fps" means no dropped frames. The frame interval p95 of the scene is within 5% of a bare `requestAnimationFrame` page on the same display. The frame cost p95 is at or under 8 ms. The cost includes the GPU wait. See [tooling-and-testing.md](tooling-and-testing.md) section 7.
- **Pass line 8 (look). The spike calls it exit criterion 11.** The 3D scene is a minimal technical test scene. Its look and gameplay are not reviewed in Phase 0. They come later, in their own iteration. Mark still reviews the stage slice and picks the resolution.

---

## 4. Moving scenes in: the LegacyScene adapter

A legacy scene is one that has `enter`, `exit`, `resume`, `update()`, and `render(ctx)`. It runs inside `LegacyScene`, a `Scene` subclass.

| Legacy | In `LegacyScene` |
|---|---|
| `enter()` | `create()` |
| `exit()` | `shutdown` event |
| `resume()` | `resume` event |
| `update()` | `fixedUpdate(tick)` |
| `render(ctx)` | Called in `prerender` into the scene's own `CanvasImage` |
| `opaque`, `curtain`, `passUpdate`, `close(result)` | Unchanged. The curtain rule is the same as today ([scene-graph.md](scene-graph.md) section 6). |

- The shell draws today's Canvas 2D frame into one `CanvasImage` (world) and a second (UI layer). `texture.source.update()` uploads it each frame. A 480x270 frame was pixel-exact in the lab (0 of 129,600 pixels differ). One 640x360 frame is 921,600 bytes, so the two canvases of the shell upload 1.84 MB each frame.
- The stack, the story scripts, and `ScriptApi` do not change. They type against `GameApi`.
- `create()` is synchronous. A lazy chunk loads before the scene is built (frame-and-rendering.md section 2).
- Two lifecycles exist side by side until M8. The adapter hides this. The docs say so.

**Hybrid rule.** A legacy scene stays on `LegacyScene` as long as it needs no camera, filter, mask, or transition. Title, menu, dialog, shop, options, deck, and saveload are in this group. Port a scene when it needs one of those. M4 is demand-driven. This removes the biggest low-value rewrite (about 270 `drawText` and 57 `drawWindow` call sites) from the critical path.

**What is the same when UI stays on canvas.** The new engine still owns the loop, the stack, the effects, and the 3D mode. The scene draws as one texture, so stage effects can act on it as on any sprite.

---

## 5. From today's engine

| Today | New home | Step |
|---|---|---|
| `src/engine/game.ts` (`W`, `H`, `FPS`) | `src/sje/core/size.ts` | M0 (done 2026-10-09: `W` and `H` live in `size.ts`, `game.ts` re-exports them, every importer of the old game moved to `size.ts`; `FPS` is defined in `size.ts` and re-exported too) |
| `src/engine/game.ts` (`Game`, `Scene`) | `src/sje/runtime/` | M1 |
| `src/main.ts` loop | `FixedLoop` | M1 |
| `src/engine/display.ts` | `Display` | M1 |
| `src/engine/input.ts` | `ActionMap`, `InputManager` | M1 |
| `src/engine/rng.ts`, `assert.ts` | `src/sje/core/`. The Phase 0 hack simulation still imports the old `Rng`. | M1 |
| `src/engine/postfx.ts`, `gl/presenter.ts`, `moments.ts` | `FxSystem`, `CompositeFilter` | M2 |
| `src/engine/font.ts` | Moves into `src/sje` before M8. `TextObject` itself stays in M4. The Phase 0 3D HUD imports it. | M3 |
| `src/engine/canvas.ts`, `ui/draw.ts` | Stay. `TextObject` and painters call them. | M4 |
| `src/art/*` painters | Stay. Output canvases become textures. | M3 to M5 |
| `src/audio/*` | Unchanged. `game.audio` wraps it. | M1 |
| `src/game/*` (state, save, settings, script) | Unchanged in shape. `gpuFx` becomes `fxLevel` with a `backfill()` mapping. `ScriptApi` gains `hack()`. | M1 and M7 |
| `src/battle/{engine,ai,setup,types}.ts` | Unchanged. | none |
| `src/battle/fx.ts` | Renderer code. Moves to the display code. | M3 |
| `src/dev/fxlab.ts` | Port. | M6 |
| `src/engine/*` after M6 | Deleted. | M8 |

**Roughly 60% of the raw canvas calls are bake-time painters** (props, backdrops, enemies, buildings). They output canvases and become textures unchanged. The code that must change is the per-frame scene, UI, lighting, and effect drawing: about 600 raw calls, plus the `drawText` and `drawWindow` sites that M4 handles on demand. Part of the field's animated look (about 10 prop animation closures, water shimmer, weather) draws every frame. It needs a `CanvasImage` path, not a bake.

---

## 6. From the Phaser spike

The spike is a thin layer over Phaser. Only 9 of its 57 files in `src/stage` import `phaser`. About 3,400 lines call renderer APIs. About 2,800 depend on the scene shape. About 8,000 use neither and port as they are. The Battle Stage Editor never touches a Phaser object.

### Translation table

| Spike | New engine |
|---|---|
| `import Phaser from 'phaser'` | `import { ... } from '../sje'`. The repo has no `@/` alias, so the path is relative to the facade. |
| `new Phaser.Game(config)`, `boot.ts` Scale NONE and CSS zoom | `await Game.create(config)`, `Display` |
| `add.image`, `add.sprite`, `add.container`, `add.graphics` | Same names. `ImageObject` is the class for `image`. |
| `setOrigin`, `setDepth`, `setFlipX`, `setScrollFactor(0)`, `setTexture(key, frame)` | Same names, same semantics. The wrapper handles anchor, flip, and routing. `ImageObject.setTexture` renames the object after the texture, so a part cannot be found by `name`. Keep the part role with `setData('part', ...)`. |
| `cameras.main.setScroll` | Same |
| `textures.exists`, `get`, `addCanvas`, `remove`, `getTextureKeys`, `getPixelAlpha` | Same on `TextureManager`. `customData` is `data`. `texture.add(name, 0, x, y, w, h)` is `textures.addFrames(key, { name: [x, y, w, h] })`. `getFrameNames()` is the `frames` map. There is no `getSourceImage()`: keep the canvas in the `data` bag to read pixels back. `getPixelAlpha` comes in M3. |
| `load.spritesheet`, `FILE_LOAD_ERROR` | `load.spritesheet`, `loaderror`, and stand-ins. The loader comes in M1. Phase 0 fetched the PNG, drew it on a canvas, added the canvas and its cells with `addFrames`, and loaded before `game.run`, because `create` is never async. A missing sheet gives one readable error, and the stand-ins take over. |
| `Phaser.Scale.Events.RESIZE` | `game.scale.on('resize')` |
| `PRE_STEP`, `POST_RENDER` | `prestep`, `postrender` |
| `StageScene.update(_t, delta)` with its own accumulator | `fixedUpdate(tick)`. Delete the duplicate accumulator. Keep a scene-own tick counter, because the game tick does not restart with the scene. |
| `scene.restart(init)` | A new scene object: `game.run(new BattleStageScene(init))`. A scene object runs once. |
| `setData`, `getData` (2 sites) | Same. The wrapper has them. |
| `setInteractive` with `hitAreaCallback` (the lab's edit mode) | `Zone` and `scene.pick` |
| `labhook.ts` | `window.__SJESTAGE__` on its own page. `__SJ__` is the hook of the shipped game, and the stage is not in the game yet. |

### Changes that are not mechanical

1. **Mirror.** Phaser flips about the texture middle. Pixi flips about the anchor. The wrapper uses `anchor.x = 1 - originX` and `scale.x = -abs(scaleX)`. The spike's `mirrorFigure` math stays. Phase 0 tested the rule: the mirror is exact (60 combinations, and the punk of the stage slice). `roundPixels` is off.
2. **Figures.** Today `perform.ts` and `battletest.ts` reach into `f.home`. The port adds a `Figure` class so only that class touches nodes.
3. **Parity.** The parity bench ran the unchanged stage on a Canvas 2D display list, not on Pixi. Pixi alpha handling in translucent HUD panels may differ. Phase 0 measured Pixi parity on the stage slice. The translucent parts of the slice (the contact shadows, the rings, the glow pixels of the enemy, the soft edges of the hero) are 0 pixels off. Translucent HUD windows are not in the slice and stay untested. Each page matches the Phaser page of its own kind of renderer, GPU or software. Across the two kinds, the pages differ by 1/255 on about 3.6% of the pixels. The cause is the neon glow layer of the street. The game paints it with Canvas 2D, and Chrome's GPU canvas and its software canvas paint it 1/255 apart. So M3 keeps two sets of references, `gpu` and `soft`, and the spec picks one by the renderer name. The committed `soft` set comes from Windows. The strict gate ran on the Linux runner, and CI is green on `d61d7d9`. Make the `soft` set again on the runner only if a later run fails.
4. **Texture identity.** The spike compares `${texture.key}|${frame}` strings and prunes by key prefix. The `TextureManager` keeps stable string keys and per-key frame tables, including copied frames in `variantOf`.
5. **e2e.** About 47 lines in the spike's specs read Phaser properties. They move to `Figure` accessors.

### Data

The design JSON on the spike branch (`stages`, `heroes`, `hud`, `axes`, `enemyfacing`, `moves`) is read byte for byte. `fx.json` on this branch and on the spike are identical. Tests follow the "fixtures versus shipped data" rule in `DEVELOPING.md` section 3. Whether `moves.json` is yours is E24.

### What happens to the spike

Its checkout stays as a visual reference until M3 parity is accepted. Then you decide about the `archive/*` tag (not before). PR #3 and PR #4 never merge.

---

## 7. Rollback

- Every milestone is a branch and a PR. A bad milestone is reverted by reverting its merge.
- The flag keeps the old path until M6.
- After M6 the old path stays one release in git history. M8 deletes it.
- If Phase 0 fails a pass line, the design doc changes before any build. The fallbacks are in the table: canvas-copy for 3D, a different effects home, or a hybrid with the legacy engine kept longer.

---

## 8. What can go wrong with the plan

- **The field (M5).** The lighting model has no one-to-one form on Pixi. About 10 prop animations, water, and weather draw per frame.
- **Effects parity (M2).** A single composite filter is not built. Its look and cost can drift from `fx.json`.
- **CI behavior.** Every spec now runs on software WebGL. Run time and flakiness can rise. Chromium 153 differs from the lab's 151.
- **Pixi and Three upgrades.** Pixi releases a minor every 2 to 6 weeks. The fixes use internals. Pin and bump on purpose, with the canary suite.
- **Retained-mode surprises.** The typewriter text, the per-frame canvas uploads, and nested scaled containers in the battle are not benchmarked.
- **Firefox and WebKit.** The shared-context path passes in WebKit on the Linux CI runner and in the 2-test browser spec in Firefox 153 on Windows. Headless Firefox on the Linux CI runner has no WebGL2. Safari on macOS is not tested.
- **The 640x360 move.** It changes 5 files in `src/engine` before M0. It also changes about 50 of the 131 source files of the shipped game (49 outside `src/engine` in the pivot inventory, `media/handoff-2026-10-05/pivot-640/INVENTORY.md`), mostly scene files with hand-placed layouts. The move can change the shipped bundle size and the layout of every legacy scene. Plan the milestone exit checks at 640x360.
