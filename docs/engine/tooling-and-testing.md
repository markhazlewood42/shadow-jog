---
type: design
title: "Shadow Jog Engine — Tooling and testing"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-05
status: approved 2026-10-05 (final). First approval 2026-10-04 (all recommendations). Phase 0 update on 2026-10-05, accepted with all recommendations
tags: [engine, design]
---

# Shadow Jog Engine — Tooling and testing

> The verification loops and rubrics that sit on top of these tests are in [verification.md](verification.md).

Agents build this engine and you review it. So the engine must be easy to inspect, easy to test without a GPU, and easy to check in CI. This file covers dev tools, editors, tests, CI, the bundle alarm, and the docs that teach agents the engine.

> **Read first:** [Three things that look like Phaser and are not](README.md#2-three-things-that-look-like-phaser-and-are-not). Tag meanings are in the "Tags" table at the top of [conventions.md](conventions.md).

**Evidence labels.** "Lab" means an agent experiment on 2026-10-04: headless Chromium 151 on SwiftShader (software WebGL), one Windows machine, mostly at device pixel ratio 1. Playwright 1.63 installs **Chromium 153** in CI, so every lab number must be re-checked on the first CI run. Timings are estimates.

---

## 1. Dev tools and the inspector

| Tool | Under the new engine | Status |
|---|---|---|
| `__SJ__` hook | Dev only. Keeps every current member. Adds `tree()`, `step(n)`, `frameHash()`, `pixels()`, `glCounts()`, `forceContextLoss()`. The shipped build must not expose it (`e2e/prod.spec.ts` checks this). | New members |
| Engine lab page `lab.html` | Boots the engine with a sandbox scene. The target for effect, pixel, leak, context-loss, and 3D specs. Model: the spike's `labhook.ts` and `stagelab-*.spec.ts`. | New |
| Scene inspector (DEV menu tab "Scene") | The scene dump as a tree, draw calls, GL object counts, fx level. | New |
| Debug drawing (`scene.debug`) | Dev only. Draws into `overlayRoot`: bounds, hit areas, depth labels, camera deadzone and bounds, filter regions, the pixel-snap grid, and the draw-call count. Each one has a checkbox in the Scene tab. The shipped build strips it. | New |
| `window.__PIXI_DEVTOOLS__ = { stage, renderer }` | Set in dev builds so you can use the PixiJS DevTools extension. It needs no `Application`. Agents cannot use extensions, so they use `tree()`. | New, not run yet |
| FX lab (`src/dev/fxlab.ts`) | **Ported in M6** (smallest port, decision 6 of `m6-brief.md`): `FxLabScene` takes the new `Game`, uses `game.fx` and `game.scale`, plays a moment through `game.fx.playMoment`, and imports nothing from `engine/display`, `engine/game` or `engine/postfx`. It is still a legacy-shaped scene (`LegacyShape`), so it needs no change when M8 deletes the old base class. Same panels and same `fx.json` format, no new features. `e2e/fxlab.spec.ts` covers it, with an invalid-edit case. | Done (M6) |
| Animation editor (`rigedit.html`), art review (`artreview.html`) | No change. They import art modules only and do not use `Game`. | Unchanged |
| Battle Stage Editor, Battle Test, Stage lab | Port with the stage in M3. See section 2. | Port |
| Trailer recorder | Captures the single canvas with `captureStream`. The `#fx ?? #screen` choice is gone (M6). | Done (M6) |
| DEV menu (`tools.ts`), `devroutes.ts` | Unchanged. `?scene=` routes stay as plain scenes. | Unchanged |

**`__SJ__.tree()`** returns JSON built from `GameObject.name` and the Pixi `label`: class, position, depth, visible, texture key, filters, Pixi node type. It lets you and agents compare the two trees (see [scene-graph.md](scene-graph.md)).

**`__SJ__.step(n)`** runs `n` ticks with a fixed `dt`, draws one frame, and returns a frame hash. No fake clock is needed.

---

## 2. How the editors attach

The rule: an editor talks to a scene through a narrow, renderer-free interface. It never touches a Pixi object.

**Battle Stage Editor.** It is DOM plus an SVG overlay laid over the canvas, one SVG unit per game pixel. It reads about 10 `Fighter` fields (`side`, `x`, `y`, `axisKey`, `slot`, `name`, `id`, `baseX`, `baseY`) and calls about 13 scene methods. The engine exposes them as a `StageView` interface on `BattleStageScene`:

```ts
interface StageView {                       // ours
  pick(x: number, y: number): Fighter | null;
  boxOf(f: Fighter): Rect;
  applyStage(stage: StageData, floorFrom?: string): void;
  setEditMode(on: boolean): void;
  setEnemies(ids: string[]): void; setHeroes(ids: string[]): void;
  setPhase(p: Phase): void; setFacing(f: Facing): void; setAxes(a: Axes): void;
  figureBoxesFor(f: Fighter): Rect[]; heroSize(): number;
  readonly enemies: readonly Fighter[]; readonly fighters: readonly Fighter[];
}
```

- `pick` uses CPU pixel alpha from the texture `data` bag. This replaces Phaser's `getPixelAlpha`.
- The scene touchpoints with the engine are `game.canvas`, `game.scale.toGame`, and the `resize` event. These replace Phaser's `scale.parentSize`, `scale.refresh`, and `Phaser.Scale.Events.RESIZE`.
- Edits are batched to one scene update per animation frame. This stays.
- The editor's save endpoint and hot-reload handling (`boot.ts` `import.meta.hot`, the `stageEdit` vite plugin) are engine-independent. Do not forget them in the port.
- Behavior of the editor stays as in `docs/TOOLING-UI.md`.

**Pointer input for editors** uses Pixi federated events (`eventMode: 'static'`, `pixi.js/events`) in dev builds only. Two facts the editor must respect: global coordinates are fractional, so round them. Hit tests use bounds or `hitArea` and have no alpha test, so use `scene.pick` for figures.

**Data files.** `src/data/*.json` is your design data. Agents never edit it. The new code reads it byte for byte. `src/data/moves.json` exists only on the spike branch and is not in the list of designer files in `docs/DEVELOPING.md`. You must confirm whether it counts as your data (E24).

---

## 3. Unit tests in Node (T0)

T0 runs in Vitest's `node` environment on every commit. No browser, no GPU.

What runs in Node:

- Pure logic: the battle engine, the hack sim, state, saves, `Rng`, `ActionMap`, `FixedLoop`, the scene stack and `game.run` promise flow.
- **Scene-graph logic against real Pixi classes.** In plain Node 24, Pixi 8.22 `Container`, `Sprite`, `Graphics`, `getBounds`, `toGlobal`, `zIndex` sort, and mask assignment work with no DOM (lab). Tests check labels, integer positions, depth order, and filter and mask wiring.
- Three scene logic: `Scene`, `Mesh`, world matrices, `Box3`, `Raycaster`, projection, and `AnimationMixer` run in Node. Only `new WebGLRenderer()` needs a DOM.

What does **not** run in Node (lab):

- `Text` (needs `document`), custom `Filter` and `GlProgram` objects (need `document` for a precision check), `AnimatedSprite` (needs `requestAnimationFrame`), `Application.init`, `autoDetectRenderer`.
- A 4-line `DOMAdapter.set(...)` stub (a fake canvas with a fake GL that answers `getShaderPrecisionFormat`) lets custom filter objects be built in Node. `Text` still fails on `measureText`. So the engine never uses Pixi `Text`. `TextObject` draws with the game's font into a canvas. Tests that touch `TextObject` use `testing/domstub.ts`, which is part of the T0 harness from day one.

Standing T0 tests:

| Test | What it checks |
|---|---|
| Import scan | Imports follow the level rules (section 9). |
| Literal scan | No number that means the screen width, height, or center outside `size.ts`. The scan looks for the old numbers (480, 270, 240, 135) and the new numbers (640, 360, 320, 180). A per-file allow-list holds a reason for each exception ([frame-and-rendering.md](frame-and-rendering.md) section 5). |
| Game stack | Ports the fault, abandon, curtain, exit-throw, and two render-fault cases of `tests/game.test.ts` to the new `Game`. It also adds new tests for close order and microtask timing. The old tests use a Proxy `ctx` and a fake input. |
| Determinism | The same recorded inputs at 60, 144, and 30 Hz and with hitches give the same state hash. For the battle driver and the hack sim. |
| Scene lifetime | After shutdown, the scene's clock events, tweens, and event links are gone. Engine awaits reject with `Cancelled`. |
| Wrapper rules | Origin sets anchor. Flip uses Phaser math. Positions are rounded. Leaves refuse children. |
| 1,000-object bench | Wrapper overhead for 1,000 `GameObject`s. Run once at M1, not every commit. |

---

## 4. Playwright under SwiftShader (T1)

Playwright's Chromium launcher adds `--enable-unsafe-swiftshader` on every OS. Headless Chromium then gives WebGL 2 on SwiftShader with no extra flags (lab). So CI needs no special setup. Locally the project uses Edge with the real GPU (`playwright.config.ts`), so local and CI pixels differ unless you add a SwiftShader mode (`PW_SWIFTSHADER=1`).

**Before M6 the old GL presenter had zero CI coverage:** `GlPresenter.create` refused any renderer whose name matches `/swiftshader|llvmpipe|.../`, and both GL tests in `e2e/gpufx.spec.ts` skipped on CI. The presenter is deleted (M6). With Pixi, every spec runs on software GL, where the effects level `auto` gives `lite`; `?fx=full` forces `full` on SwiftShader (see [frame-and-rendering.md](frame-and-rendering.md) section 6.5).

T1 runs on Chromium, viewport **1280x720**. That is scale 2 at 640x360. A window of 960x540 is scale 1.5 at 640x360, so it rounds down to 1, and a block check at scale 1 cannot fail. Specs on the lab page:

| Spec | Gate |
|---|---|
| Boot | Zero console errors **and warnings**. Pixi logs real defects as warnings, and today's watchers collect only `error`. Two exceptions are allowed by name. Chrome logs "GPU stall due to ReadPixels" when a page reads pixels back, and only the test hook does that. Firefox 153 logs two WebGL notes at boot from Pixi's built-in textures (alpha-premult and y-flip for non-DOM uploads, and lazy initialization), in Firefox only. |
| Pixel blocks | k-by-k blocks are uniform at device pixel ratio 1, 1.25, and 1.5. Reuse the spike's `stagelab-dpr.spec.ts`. |
| Goldens | Section 5. |
| Frame interval | Section 7. |
| Draw calls | Section 7. |
| Leak cycles | Section 8. |
| Context loss | A redrawn frame returns identical. A baked texture re-bakes. The 3D promise resolves `aborted` within 2 seconds. |
| No WebGL2 | Stub `getContext` to return null. Expect the visible "failed to start" notice. |
| 3D enter and exit | Ten cycles. Counts return to baseline. |
| Canary suite | Section 8. |

**T2: Firefox and WebKit on the Linux runner.** Today they run only `prod.spec.ts` and `gameover.spec.ts`. Phase 0 recorded the answer on the `ubuntu-latest` runner. WebKit gives WebGL 2 and passes the Pixi-first, Three-later spec in both frame modes. Headless Firefox has no WebGL 2 there ("This browser cannot run WebGL 2"). So the spec asserts the E5 behavior in Firefox on the runner. The clear message shows, `hackDoor` gives `unsupported / no-webgl2` in under 500 ms, and no 3D chunk is requested. Firefox 153 on Windows ran only the 2-test browser spec (`sje3d-browsers`) and a hand run of the Part A scripts. It passed them. It did not run the other specs, and it was not run at 640x360. Order of work: a probe spec that logs `getContext('webgl2')` and the unmasked renderer string, then an informational (non-blocking) pixel-block spec, then a gate. The shared-context path is proven in WebKit on the runner, and the `unsupported` result is proven in Firefox on the runner.

**T3: local, on your desktop.** The 60 fps check with bloom on the RTX 4070, in Edge. Goldens are never regenerated from the local GPU.

---

## 5. Pixel-exact checks and goldens

**Pixel blocks.** With nearest sampling and an integer upscale, every game pixel is a uniform k-by-k block. The test counts non-uniform blocks. Lab result at 480x270: 0 of 129,600 at x3 and x4, with filters inside the render texture. At 640x360 each check counts 230,400 blocks. Phase 0 found 0 uneven blocks at ratios 1, 1.25, 1.5, 1.75, 2 and 2.25 in the lab scene, the 3D scene with the HUD, the stage slice and the effect cases, on a GPU and on SwiftShader. The test needs an allow-list for `Texture.WHITE` and `Texture.EMPTY`, which stay linear.

**Golden policy.**

| Frame type | Compare |
|---|---|
| No filters | Exact match. A real GPU and SwiftShader gave 0 differing pixels in the lab. |
| Filters (blur, color matrix, shockwave) | Per-channel tolerance of 3/255 (pixelmatch style). The lab saw 42 to 45% of pixels differ by at most 3/255 between a real GPU and SwiftShader. |

- One golden set per fx level (`full`, `lite`, `none`).
- Generate goldens only on CI or in `PW_SWIFTSHADER=1` mode. Playwright snapshot names carry a platform suffix, so Windows and Linux goldens differ anyway.
- Pixi's own visual tests use pixelmatch with threshold 0.2, at most 100 differing pixels, and one snapshot per renderer type.
- **The first CI run regenerates the goldens and re-checks the 3/255 tolerance** before it becomes a gate. The lab used Chromium 151. CI will run Chromium 153.
- Frame hashes were identical across 3 page loads on SwiftShader in the lab.

**Parity with the Phaser stage.** The earlier parity result (1/255 on 0.98 to 2.26% of pixels) was for a Canvas 2D display list, not for Pixi. Phase 0 measured Pixi parity on the stage slice: 0 pixels differ at 3 frames, against the Phaser page of the same kind of renderer. Across the two kinds, the pages differ by 1/255 on about 3.6% of the pixels. The street's neon glow layer is the cause: Canvas 2D paints it 1/255 apart on the GPU canvas and on the software canvas. So the references come in two sets, `gpu` and `soft`, and the spec picks one by the renderer name. The strict gate ran on the Linux runner, and CI is green on `d61d7d9`. Make the `soft` set again on the runner only if a later run fails. At 640x360 parity with the Phaser spike cannot be measured, because that spike draws 480x270 and has no 640x360 stage. Phase 0 shows that the top left 480x270 of the 640x360 slice equals the 480x270 picture (0 of 129,600 pixels differ) and that the rest is the void color (0 of 100,800 differ). That keeps the parity of the area laid out for 480x270. It does not show that a stage laid out for 640x360 looks right. M3 measures the full stage and lays it out for 640x360. How parity is measured after the new layout is an open point for M3. Pass line: a tolerance that you agree, and an identical Battle Test status trace (seed 7).

**M3 parity method (the battle stage, 2026-10-10).** Two checks, kept apart (decision 1 of `m3-brief.md`).

1. **Regression parity** (a gate, on CI). The stage lays out the 480x270 files in a 640x360 frame, as Phase 0 did, and `e2e/sje-stage-parity.spec.ts` compares seven frames (the street at ticks 0, 41 and 173, the street haze frame, the sewer at ticks 0 and 41, the sewer boss group) with the goldens in `tests/fixtures/sjestage/`, for the `gpu` and the `soft` renderer kind. The goldens were made from the Phaser tag by `scripts/sjestage-refs.mjs`. The compare is strict: 0 pixels outside the renderer mask, at most 1/255 inside it; the measured result is 0 differing pixels. Controls that must fail: a 2/255 step, a one-pixel shadow move, a ring, a body move, and the 640x360 frame's void. **Input pins:** the manifest holds the SHA-256 of every data file the slice reads (`inputs.json`), and the spec fails first when one changed. `scripts/sjestage-repin.mjs` re-pins when the change cannot change a pixel (the parity run is the proof); a design change needs new references.
2. **The new layout** (pictures, not a gate). The 640x360 set is made by `scripts/stage-640.mjs` and judged by Mark from `media/m3-stage/` (old, 480 in 640, new 640; intro, command, list, target, attack, spell, crit, victory, boss), `gpu` set first. Once he accepts the look, the frames are pinned as new goldens for both kinds.

The push camera (up to 1.09x) is outside the strict frames: its uneven texels are known (decision 3) and it has its own pixel test (the world layer scales to at most 1.09x, differs from the plain frame while it runs, and the frame after its last tick equals the frame that never pushed). The crisp-pixel check (0 uneven k-by-k blocks at device pixel ratios 1 and 1.5) runs on the shipped battle with the stage, the HUD, the effects and a number on screen (`e2e/sje-battle.spec.ts`), over the whole 640x360 frame.

**M5 parity method (the field, 2026-10-10).** The reference is the OLD FIELD itself, not a frozen copy of data (`m5-brief.md` decision 4a). Three pieces, kept apart.

1. **The states.** `tests/fixtures/sjefield/cases.json`: 31 fixed states. A state is a map, a tile, a story-flag preset (`src/game/stages.ts`) with a few flags changed, the ambient and weather overrides, the seed of the page's `Math.random`, the field tick (260 by default, after the area banner) and the effects level (`none`, or `full` on a GPU). All 15 maps are in it, plus day and night, rain on and off, a flag that changes a prop, a second seed, the banner, and the camera at the corners of the world map. `window.__SJ__.fieldShow(case)` (`src/dev/fieldshow.ts`) puts a page in a state, on either path, on a fake paused clock; `e2e/sjefieldkit.ts` runs the clock to the exact field tick (`settle` steps one rAF at a time at the end and throws if the tick jumps) and takes what the player sees (the window screenshot at zoom 2).
2. **The references** were made from the legacy path (no `?engine=sje`) by `e2e/sje-field-refs.spec.ts` (local, `M5_REFS=1`; run it with `CI=1` for the `soft` set and without for the `gpu` set). **M6 deleted that path and the spec**: the references stay committed and cannot be made again without a checkout from before M6 (`docs/DEVELOPING.md`). Two kinds, as in M3, because the old path draws differently on a GPU and on SwiftShader. The window screenshot, not one canvas: with GPU effects the old path shows its picture on a second canvas over the 2D one. The effects level is pinned (`none` for the field's own drawing; `full` only on the `gpu` kind, because the old path cannot make its GPU effects on software GL). `manifest.json` pins the SHA-256 of every map file the references depend on; the spec fails first when one changed.
3. **The gates** (`e2e/sjefieldparity.ts`, unit tests in `tests/sjefield-parity.test.ts`). The STRICT gate of the brief is 0 pixels outside the renderer mask and at most 1/255 inside it, the mask being where the `gpu` and `soft` references differ. It **does not hold** for lit frames, and it is not loosened: its numbers are printed for every state and it fails the run only with `SJEFIELD_STRICT=1`. Why: Pixi multiplies the light map in GL and the old path multiplies in Skia, and the two round differently (`frame-and-rendering.md` section 6.7). On SwiftShader the new frame is 1/255 lower than the old one in 25 to 90% of the pixels; outside the mask 3,544 to 94,972 px differ (the mask of two renderers does not cover a third rounding). On a GPU, with the effects off: 0.6 to 24% of pixels differ, always by 1/255 except the Annex (2/255 in 20 px); outside the mask 52 to 30,400 px. With the whole stack on a GPU: 9 to 24% of pixels, at most 15/255. The default tier is **measured bounds** (a regression guard, not a decision): per kind and level, the largest step and the share of pixels at 2/255 or more and 4/255 or more (`BOUNDS` in the parity module), with three controls that must fail: a 2/255 step over the picture, an actor one pixel off (`nudge`), and a light radius 1.1 times too big (`lightScale`). Brief decision 4 lets lighting out of the numeric gate when the first honest try cannot hold it, if Mark sees the diff: the pictures are `media/m5-field/` and `SJEFIELD_SHOTS=<folder>` makes diff pictures.

---

## 6. Deterministic frames

- `__SJ__.step(n)` and `?seed=` (see section 1 and [frame-and-rendering.md](frame-and-rendering.md) section 8).
- `page.clock` is not used. It produced 62 callbacks at 16 ms steps in one second, which does not match the 16.667 ms accumulator.
- Visual randomness uses `visualRng`. Gameplay randomness uses seeded `Rng`.

---

## 7. Performance gates

The JS timer cannot see GPU cost. In the lab, `renderer.render()` took 0.1 to 0.3 ms of JS while frame intervals doubled at zoom 4. Today's gates (`e2e/perf.spec.ts`) sum JS time per frame and would stay green while frames drop.

| Gate | What | Notes |
|---|---|---|
| Sim ms | Keep today's gate: mean under 2 ms, p95 under 4 ms. | Strict. |
| Frame interval | rAF interval p50 and p95. | New. Lab (480x270 game): 16.7 ms at 960x540, p95 33.4 ms at 1920x1080 with the full stack. |
| Draw calls | Count draws and framebuffer binds with a patch of `WebGL2RenderingContext.prototype`. | New. Hardware independent. Lab: 301 sprites cost 1 draw. Blur, color matrix, and shockwave cost 12 draws and 13 binds. |
| 3D hand-off | One frame of the shared-context path stays inside its budget. | New. |

SwiftShader cost follows canvas pixels. In the lab (a 480x270 game, one machine, medium confidence) the full effect stack cost about 12 to 13 ms at 960x540. The CI viewport is now 1280x720, which has 1.78 times more pixels. M2 measured the fx levels there (the table after the M1 measurements below). Budget each fx level per pass. The first real CI run is the actual measurement.

**The speed line (Phase 0 amendment, 2026-10-05).** The test machine's display refreshes at about 56.6 Hz, so a bare page already takes 17.7 ms per frame there. Phase 0 did not measure Mark's own display separately. No page can reach the 16.7 ms line on it. "60 fps" means no dropped frames against the display's own rate. The gate has two rules that both must hold on a real GPU.

1. The frame interval p95 of the scene is within 5% of a bare `requestAnimationFrame` page in the same browser on the same display.
2. The frame cost p95 is at or under 8 ms. The cost is the CPU work plus the GPU wait: tick, draw, and a one-pixel `readPixels`. The read-back cannot return before every earlier command has run. Where the browser offers `EXT_disjoint_timer_query_webgl2`, the GPU timer p95 is also at or under 8 ms.

The interval rule alone cannot catch a load whose GPU work still fits in one display frame. A negative control proves that each rule can fail. With 200 extra 3D draws, the interval p95 stays at 18.2 ms and only the cost rule fails. With 600 extra 3D draws, both rules fail (the interval p95 is 54.1 ms against a limit of 19.0 ms). On software GL the CI gate only catches a stuck loop (p95 under 250 ms; it was 80 ms until 2026-10-09, when CI measured 83 ms for 2D and 133 ms for 3D bloom). A shared software renderer cannot meet strict timing and says nothing about the engine. Timing thresholds belong on a real GPU.

**Performance budget.** Every number below is proposed. It is an estimate with low confidence. M1 measures each one and then sets the real gate.

| Quantity | Proposed budget | Basis |
|---|---|---|
| Whole frame | 16.7 ms at 60 Hz | The frame time at 60 Hz |
| Simulation (JS) | Mean 2 ms, p95 4 ms | Today's gate |
| Draw phase (JS) | 3 ms | Estimate. Lab: `renderer.render()` took 0.1 to 0.3 ms of JS |
| GPU, real GPU | 8 ms | Estimate. Leaves headroom for 3D and bloom |
| 3D hand-off | 2 ms per frame | Estimate. Lab: the gap between the two 3D paths was 0.1 to 0.35 ms |
| First 3D entry | 200 ms, hidden behind the transition | Lab: 96 ms on an RTX 4070, 167 ms on SwiftShader |
| Draw calls per frame | 60 | Estimate. Lab: 301 sprites cost 1 draw |
| Framebuffer binds per frame | 30 | Estimate. Lab: blur, color matrix, and shockwave cost 13 binds |
| Canvas upload per frame | 2 MB. Proposed: about 3 MB | One 640x360 `CanvasImage` is 921,600 bytes (518,400 bytes at 480x270). The legacy shell has two, which is 1.84 MB, or 92% of the 2 MB line. A third canvas breaks it. Measure at M1 with the 1,000-object bench, then set the line |
| Objects per scene | 1,000, with wrapper overhead under 1 ms per frame | The 1,000-object bench at M1 |
| Texture memory | Warn at 128 MB | Estimate. See [frame-and-rendering.md](frame-and-rendering.md) section 10 |

**Phase 0 measurements at 480x270, earlier run** (Edge 154, RTX 4070, one machine and one GPU). The 3D scene with bloom and the HUD has a frame cost with the GPU wait of mean 1.8 ms and p95 2.4 to 2.7 ms. The GPU timer reads mean 3.5 ms and p95 6.7 ms, about 16% under the 8 ms line. The stage slice has a frame cost of p50 0.8 to 1.4 ms and p95 1.1 to 2.1 ms. The JavaScript work is a CPU number (it only submits): about 1.1 ms for the 3D scene and 0.2 to 0.3 ms for the stage slice. The first 3D entry takes 79 ms to build the scene (it includes loading the chunk) and 68 ms to the first finished frame. Later entries take 5 ms and 14 to 17 ms.

**Phase 0 measurements at 640x360** (spike doc, step S1a). Same machine, same specs, three runs of each size. The display refreshes at about 56.6 Hz, so a bare page has a p95 of 18.2 to 18.3 ms.

| Measure | 480x270 | 640x360 |
|---|---|---|
| 3D scene with bloom and HUD: frame interval p95 against a bare page (line: at most 1.05) | 0.995 | 0.995 to 1.000 |
| 3D scene: frame cost with the GPU wait, p95 (line: at most 8 ms) | 2.9 to 3.3 ms | 3.2 to 3.5 ms |
| Stage slice: frame cost with the GPU wait, p95 (line: at most 8 ms) | 2.3 to 2.5 ms | 2.3 to 2.5 ms |
| Negative controls (extra draws): cost p95, must fail the line | 22 to 127 ms | 22 to 136 ms |
| SwiftShader, 3D scene: frame cost mean / p95 | 11.1 to 11.6 / 13.5 to 14.8 ms | 12.7 to 12.8 / 14.7 to 14.9 ms |
| SwiftShader, stage slice: frame cost p95 | 9.1 to 9.5 ms | 7.4 to 7.9 ms |

The cost did not grow with the picture. The 3D frame has 1.78 times more pixels, and its mean cost is 2.1 to 2.3 ms at both sizes. At this scene size the cost follows the work for each frame and not the pixel count. This is one GPU and one display. A weaker GPU may show a size effect. The GPU timer query is reported and is not a gate, because its top 5% sometimes sits at one display frame (16 ms) when a query spans an idle gap. Both negative controls fail the line at both sizes.

**M1 measurements (2026-10-09, the real game on `?engine=sje`, 640x360, `e2e/sje-bench.spec.ts`).** The bench stops the game's loop and drives tick, draw and the GPU wait frame by frame, with 1,000 `ImageObject`s moving every tick. These numbers are from SWIFTSHADER (software GL, the bundled Chromium on the build machine). They are NOT GPU numbers: the GPU line of pass line 10 (interval p95 within 5% of a bare page, cost p95 at most 8 ms) needs a run of `npm run perf` on Mark's machine.

**M1 GPU run (2026-10-09, `npm run perf`, Edge/Chromium on an RTX 4070, bare page p95 16.80 ms).** The speed line holds. 2D scene: interval p95 16.80 ms, frame cost p95 6.90 ms (JS work mean 0.22 ms). 3D frame with bloom: interval p95 16.80 ms, cost p95 7.10 ms. Bench on the real game: title alone cost p95 1.80 ms, two legacy canvases 1.90 ms (1.84 MB uploaded per frame), three canvases 2.80 ms (2.76 MB), 1,000 objects through the wrapper 2.90 ms against 2.10 ms raw Pixi; all cases 2 draws and 2 binds; interval p95 16.80 ms in every case. Wrapper overhead 0.015 ms a frame (line: 1 ms). The negative control (600 extra 3D frames) breaks both rules as it must (interval 66.8 ms, cost 66.4 ms). Canvas upload line: keep 2 MB for two canvases, which is 92%; a third canvas still holds the speed line on this GPU (2.8 ms), so the 3 MB proposal stands.

**M3 GPU run (2026-10-10, `npm run perf` and `e2e/sje-bench.spec.ts`, Chromium on an NVIDIA GeForce RTX 4070, bare page p95 18.10 ms).** The speed line holds with a live battle. Live battle on the stage (`?engine=sje&fx=full`, 640 set, HUD and effects, 3 rounds on Auto, 1,380 of 1,380 ticks in battle): interval p95 18.10 ms (bare page 18.10 ms), frame cost p50/p95 2.30/3.40 ms (line: 8 ms), JS work p95 1.20 ms, 19.9 draws, 17.0 binds and 4.23 canvas uploads (2.99 MB) per frame. Negative control (80 extra draws per frame): cost p95 21.80 ms, breaks the line as it must. Other results of the same run: 2D scene cost p95 1.70 ms, interval p95 18.10 ms against bare 18.20 ms; 3D scene with bloom cost p95 1.90 ms; legacy live battle (old renderer) mean 0.63 ms, p95 0.8 ms. Title with fx full: cost p95 1.90 ms, 4 draws, 2 uploads.

| Measure (SwiftShader) | Value |
|---|---|
| Draw calls per frame: title alone, two legacy canvases, 1,000 objects | 2.0, 2.0 and 2.0 (the sprites batch into one draw) |
| Framebuffer binds per frame | 2.0 in every case |
| Canvas uploads per frame: 1, 2 and 3 drawn legacy scenes | 1.00 (921,600 bytes), 2.00 (1,843,200 bytes), 3.00 (2,764,800 bytes). Two canvases are 92% of the 2 MB line, three are 138% of it and 92% of the proposed 3 MB |
| Wrapper cost of moving 1,000 objects (x and y setters with the pixel snap), JavaScript only, p50 / p95 | 0.020 / 0.035 ms, against 0.015 / 0.020 ms on the raw Pixi node: an overhead of about 0.015 ms per frame (line: under 1 ms) |
| Frame work (tick and draw submit), p50 / p95: title, with 1,000 objects | 2.2 / 2.5 ms, 2.7 / 3.1 ms |
| Frame cost with the GPU wait, p50 / p95: title, with 1,000 objects (software GL) | 10.1 / 14.4 ms, 13.5 / 14.7 ms |
| Frame interval p95 against a bare page (software GL) | 16.7 to 16.8 ms against 16.7 ms |

The upload counter is exact (a patch of `texImage2D` and `texSubImage2D`), so the same numbers hold on a GPU. A third drawn legacy scene (a field with a dialog and a menu over it) stays under the proposed 3 MB line. The draw and bind counts are far under the budgets of 60 and 30. The JavaScript numbers and the interval depend on the machine, and the cost on software GL follows the pixel count.


**M2 measurements (2026-10-09, the real game on `?engine=sje&fx=...`, 1280x720 viewport, the probe scene of `e2e/sjefxkit.ts`).** SWIFTSHADER (the bundled Chromium, software GL): NOT GPU numbers. Each cell is the cost of one frame with a one-pixel read-back (it waits for the GPU), 120 frames, p50 / p95 in ms. The stack is two shockwaves, a color split, a haze, a glitch, a dim, a lit rectangle in the glow layer and four ember bursts, all alive. The GPU line (interval p95 within 5% of a bare page, cost p95 at most 8 ms, pass line 13) is the main session's `npm run perf` run on a real GPU.

| Level | Bare frame (no effect alive) | Full stack alive |
|---|---|---|
| `none` | 8.6 / 9.5 | 8.6 / 10.4 |
| `lite` | 8.7 / 11.3 | 10.2 / 12.4 |
| `full` | 15.7 / 18.9 | 19.6 / 24.0 |

`full` costs about 7 ms more than `none` on SwiftShader even with nothing alive, because the composite and the blur chain run whenever the level is on and something glows (the stage draws the world through the filter every frame). `lite` costs 1.6 ms with the stack, and `auto` picks it on software GL.

Hardware independent counts (`e2e/sje-draws.spec.ts`, the real game, one frame): the bare frame is 4 draw calls, 4 framebuffer binds and 2 canvas uploads. The full effect stack is 16 draw calls, 17 binds and 3 uploads (the glow canvas and the UI canvas upload only on frames where a scene drew into them). The gates are 24, 24 and 4. Shader programs alive after the warm-up: 4, and none is made during a `playMoment` (the first hit takes 2.9 ms and the tenth 2.3 ms in the page, SwiftShader).

**M2 GPU run (2026-10-09, `npm run perf`, RTX 4070 via ANGLE/D3D11, 1280x720 viewport, bare page p95 16.80 ms).** The speed line holds with the effects on. The M1 bench scenarios (A, B, B3, C, D) now run at `?fx=none`, so their upload counts keep the M1 meaning (one canvas per drawn legacy scene). The default-on effects add the UI canvas to the title, which is why the unmodified M1 bench read 2 uploads. One new scenario runs the title at `?fx=full` (glow not used, UI canvas used).

| Title scene | Interval p95 | Cost p50 / p95 | Draws | Binds | Uploads (bytes) |
|---|---|---|---|---|---|
| fx none | 16.80 ms | 1.70 / 4.00 ms | 2.0 | 2.0 | 1.00 (921,600) |
| fx full | 16.80 ms | 2.40 / 4.60 ms | 4.0 | 4.0 | 2.00 (1,843,200) |

`e2e/perf.spec.ts` passes on the same run: 3D frame cost p95 4.3 ms, interval p95 16.8 ms against a bare page at 16.8 to 16.9 ms.

**M3 (battle stage), measurements left open.** Hardware independent counts from the builders (SwiftShader, `e2e/sje-draws.spec.ts`): the shipped battle with the stage, the HUD, the battle effects and the whole stack is 20 draw calls and 17 binds a frame (18 and 17 while it waits for orders) and 4 canvas uploads; ten battle enter and exit cycles leave the GL counts flat (textures 49, buffers 26, framebuffers 10, programs 4, VAOs 13). The frame interval p95 against a bare page and the frame cost p95 on a GPU (line 14 of the brief: within 5% of the bare page, cost p95 at most 8 ms) are NOT measured yet: the main session runs `npm run perf` once, after the last fix round, and puts the numbers here.

**M5 (field), counts.** Hardware independent counts from the builder (SwiftShader, `e2e/sje-draws.spec.ts`, the shipped field with the whole stack, one frame): the town (Lantern Row, rain) 21 draw calls, 17 framebuffer binds, 56.3 canvas uploads (6.8 MB); the world map 29, 17, 30.1 (5.6 MB); an interior (the bar) 17, 17, 15.0 (3.7 MB). The bounds in the spec are 40 draws, 24 binds, 75 uploads, 8 MB, and a control (80 extra images with alternating blend modes) exceeds the draw bound. The upload bytes are the number to watch: they are the 640x360 light map, the haze and the screen-fixed layer, plus a small canvas for each lit sprite that a flickering light reaches.

**M5 GPU run (2026-10-10, `npm run perf`, PW_PORT=3011, Chromium on an RTX 4070, bare page p95 16.8 ms).** The speed line holds (11 of 12 cases on the first full run, the twelfth is noise, below). Field stage on the world map with fx full (`e2e/sje-bench.spec.ts`): cost p95 6.9 to 7.4 ms in 3 runs, line 8 ms. The first measure was 11.5 ms; the cause was CPU 2D paint (the screen layer, 24 relights), so the relight now runs only when the overlapping light changes (0a0ae46). The screen layer has no dirty rect, because rain covers the whole screen. Other cases: 2D scene cost p95 4.6 ms, 3D with bloom 4.1 ms, title fx full 5.2 ms.

**Live battle, noise and not a regression.** The first full run gave cost p95 14.5 ms, then 9.9 ms and 5.0 ms on re-runs (M3: 3.4 ms). An A/B on the same machine, alternating, 4 runs on M5 and 3 on `origin/main` (case "a live battle on the stage", `e2e/sje-bench.spec.ts`): M5 2.7, 3.0, 2.8 and 4.7 ms (median 2.9); `main` 2.3, 4.0 and 4.6 ms (median 4.0). The spread inside one side is larger than the gap between the sides, and interval p95 was 16.8 ms in every run, equal to the bare page. In 3 of the 7 runs (2 on M5, 1 on `main`) the bench reported "the battle scene and its stage were up for the measured ticks" (the fight ended early); its numbers were still printed and are in the table. Not investigated.

**M1b GPU run (2026-10-09, `npm run perf`, RTX 4070 via ANGLE/D3D11, bare page p95 16.80 to 16.90 ms).** Pass line 14 holds with the cube running as a `Scene3D` on a `Game` (the lab's `three().start()` runs `CubeScene` with bloom). Frame interval p95 16.80 ms against a bare page at 16.90 ms. Frame cost with the GPU wait: mean 4.05 ms, p95 6.30 ms (line: 8 ms). JavaScript work mean 0.50 ms, p95 0.70 ms. The 2D scene on the same run: interval p95 16.80 ms, cost p95 3.70 ms. The negative control (600 extra 3D frames) breaks both rules as it must (interval 66.7 ms, cost 65.4 ms). The M2 bench cases still hold: title fx none/full cost p95 within 8 ms, wrapper overhead 0.020 ms a frame (line: 1 ms). All 10 tests pass.

---

## 8. Leak, context, and canary tests

**GL-object harness.** Patch `create` and `delete` for textures, buffers, programs, VAOs, framebuffers, and renderbuffers. Ten create-and-destroy cycles return to baseline. A negative control that leaks on purpose must grow. Turn off Pixi's GC during the test. Spike results (Phase 0 lab, not the M0 lab): baseline texture 8, buffer 6, program 5, VAO 3, framebuffer 5. The M0 lab measured texture 6, buffer 4, program 1, VAO 2, framebuffer 1 for the 2D scene, and texture 10, buffer 4, program 2, VAO 2, framebuffer 4 for the 3D frame. The same harness covers the 3D enter and exit x10 line.

**Canary tests.** Each trap from the research has a Playwright test that fails if the fix is missing. They run on every Pixi or Three bump. Versions are pinned exactly (`pixi.js 8.22.0`, `three 0.186.x`).

| Canary | Fails if |
|---|---|
| Stale clear color | A filtered container with a transparent gap, over a non-black Three background, through the back-buffer path, shows Three's color. |
| Canvas on init | Context restore does not recover (Pixi `init` without `canvas`). |
| `destroy` kills the context | Anything calls `renderer.destroy()` outside the dev teardown test. |
| `ExternalSource` scale | A Three render target with linear filtering produces blended 2x2 blocks. |
| Stencil mask | A `Graphics` mask inside the 640x360 back buffer draws outside the mask. |
| Three canvas and context | After `WEBGL_lose_context`, `three.render()` does something. Or Three does not recover on restore (Three created without `canvas`). |
| No second Pixi loop | A Pixi `requestAnimationFrame` callback runs after boot (`Ticker.system` not stopped). |
| Extension list | A boot with `skipExtensionImports` cannot render a sprite, a `Graphics`, a mask, or a filter. |
| Texture GC | Pixi unloads an idle texture while `gcActive` is false. |
| Texture handle | `renderer.properties.get(rt.texture).__webglTexture` is undefined. |
| Color exactness | `#ff2080` in Three does not come out as `#ff2080`. |
| Frame rewrap | A resize or restore leaves the 3D sprite stale. |

**The stale clear color canary needs a transparent clear.** In the shipped configuration the back buffer clears to the void color, which is not (0,0,0,0). Pixi then sets the GL clear color itself, and the bug does not show, even with the fix off. It shows only when the back buffer clears to transparent black. The canary clears to transparent black (test seams `GlHandoff.setClearColorFix` and `BackBuffer.setClearColor`). It has a negative control: with the fix off, all 2,800 gap pixels show Three's leftover black. With the fix on, 0 pixels are wrong. A second case leaves the switch at its shipped default, so flipping the default fails it. The two clean-up lines in `endThree` (the second `three.resetState()` and `gl.clearColor(0,0,0,0)`) each fix the bug alone, because Three 0.186's `state.reset()` also sets the GL clear color to (0,0,0,0). The canary fails only when both are gone.

**A context-loss test must wait one macrotask before it restores.** The browser calls every `webglcontextlost` listener in turn, and a promise continuation runs between them. A restore before the last listener ran is refused ("context restoration not allowed").

---

## 9. Lint and import-level rules

Code is grouped in levels 0 to 6 (see [README.md](README.md) section 4). Biome `noRestrictedImports` and the T0 import scan enforce these:

1. `pixi.js` may be imported only under `src/sje/render` and `src/sje/display` (the `display` folder includes the `textures` and `fx` parts). Game code never imports it.
2. `three` may be imported only under `src/sje/three` and `src/hack3d`. Both load through one `import()`. The files `src/hack3d/door.ts` and `src/hack3d/result.ts` load up front. `result.ts` imports nothing from the chunk. `door.ts` reaches the chunk only through the one `import()`.
3. `src/battle`, `src/hack3d/sim`, and `src/game/state.ts` import neither a renderer nor the DOM.
4. A lower level never imports a higher level. `src/sje/three` imports only levels 0 to 3 and `three`. Nothing at levels 0 to 4 imports it.
5. Raw GL state calls (`bindFramebuffer`, `readPixels`, `clearColor`, `pixelStorei` and similar) appear only in `src/sje/render/glhandoff.ts`.

Inherited rules: strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`). `noNonNullAssertion` stays an error in `src/sje/**`: use `must(value, what)` from `engine/assert.ts`. No per-frame allocation in hot paths: use pooled lists and preallocated uniforms. Gameplay randomness only from seeded `Rng`. Comments explain why.

---

## 10. The bundle alarm

`scripts/bundle-budget.mjs` (run by `npm run budget`, which builds the game and the lab page) is the M0 gate. It reads the Vite manifest and each chunk's source map. It has these checks:

- **Total gzip alarm: 452 kB** for the shipped game (`GZIP_TOTAL_MAX`). It was 240.8 kB at M0, 380 kB after M1, 394 kB after M2, 400 and then 401 kB at M3, 409 kB after M5. At M6 (2026-10-10, decision 4 of `m6-brief.md`, Mark's one-bigger-total rule) the old flag-only chunks joined it, because the flip made them part of every player's download: it measured 451.688 kB, so the cap is 452 kB (rounded up to the next 1 kB). That is 6.3 kB less than the 458 kB sum before the flip, because deleting the old presenter and the GL half of `display.ts` saved it. Each raise is by the measured delta only, and the cause is written in the script.
- **Largest chunk: 480 kB raw** (`CHUNK_MAX`), on the shipped game. After the flip the biggest is 363 kB (the game's boot chunk). It holds because `src/sje/boot.ts` loads `src/boot.ts` with a dynamic `import()`: with a static import Rolldown merged the engine and the game into one 770.8 kB chunk, over the cap (and a change to the game would have changed the hash of Pixi's code too).
- **Boot has no engine:** the `boot` class holds no `pixi.js` and no `three` module, in the game and in the lab.
- **First play: 392.4 kB gzip** (`FIRST_PLAY_MAX`), boot plus `lazy-2d`: what every player downloads before the first battle and field. It measured 391.363 kB at M6 (boot 1.5, the game's boot chunk and what it imports 184.7, the engine 156.1, the two stages 49.1), and the cap is the measured value plus 1 kB (decision 4c). Before the flip it measured 345.7 kB, with no cap and without the stages. The `flag-only` class (M3) is gone: `liveopen` and `fieldopen` are `lazy-2d` (`STAGE_SRC` in the script).
- **The game holds Pixi only in a lazy chunk:** no game chunk holds Three until M7.
- **Lab `lazy-3d`:** at most 160 kB gzip, and it must not be empty. The lab `lazy-2d` class must not be empty.
- **No blind chunk:** a chunk with no source map (or a boot chunk with an empty one) fails the gate. Without this, the checks above would pass on no data. `tests/bundle-budget.test.ts` holds the controls (a boot chunk with no map fails; a boot chunk with a Pixi module fails).
- **The two Vite traps** below.

The report prints the four classes (`flag-only` existed from M3 to M6). Measured at M0 (gzip, game): boot 190.0 kB (`index` plus the shared `tables` chunk), lazy-other 50.8, lazy-2d 0, lazy-3d 0, first play 190.0. Measured at M0 (gzip, lab): boot 1.2, lazy-2d 143.0, lazy-3d 135.3, first play 133.0. The old per-class caps of the plan ("boot at most 144.8 kB") did not survive the 640x360 move: the boot class grew with the shared `tables` chunk. `first play` got its cap at M6. The alarm is an alarm, not a hard limit.

**Sizes for scale (gzip, lab, depend on the bundler):**

| Part | Size |
|---|---|
| Pixi, `WebGLRenderer` only | about 131 kB (Vite) to 151 kB (esbuild) |
| Pixi, default build | about 155 to 180 kB |
| Pixi, useful subset (filters, graphics, events, mesh, particles, nine-slice, tiling) | about 195 to 205 kB |
| `pixi.js/text-bitmap` | plus 50 to 66 kB |
| Three, minimal renderer | about 130 to 172 kB |
| Three, with `GLTFLoader` | about 227 kB |
| Three, with composer and bloom passes | about 232 kB |

**The classes.** The gate reads `dist/.vite/manifest.json` (`build.manifest: true`) and sorts chunks into classes by reachability over `imports` and `dynamicImports`:

| Class | Content | Rule |
|---|---|---|
| `boot` | The entry's static closure | Must contain **no** `pixi.js` and **no** `three` module. A hard check. |
| `lazy-2d` | Pixi and the engine, and (M6) every chunk of the start path: the engine boot (`src/sje/boot.ts`), the game boot (`src/boot.ts`) and what they import statically, and the two stages (`liveopen`, `fieldopen`) | Counted. |
| `lazy-3d` | Three and the hack scene | Own cap. |
| `lazy-other` | Battle, deck, tables, dev | Counted. |
| `first play` | `boot` plus `lazy-2d` | Own cap, 392.4 kB. |

Caps in force: `lazy-3d` 160 kB (you accepted it on 2026-10-05, real choice C5; the spike measured 145.1 kB and M0 measured 135.3 kB in the lab), the game total 452 kB, `first play` 392.4 kB, the largest chunk 480 kB raw.

**Phase 0 spike numbers (gzip, not M0 numbers).** Pixi plus the engine kernel is 124.7 kB. The page of the stage lab boots with 170.7 kB, and the page of the 3D lab boots with 165.5 kB. The lazy 3D chunk (Three with named imports, a `UnrealBloomPass`, and the hack scene) is 145.1 kB (576.8 kB raw). The shipped game then measured 233.9 kB (before the 640x360 move). The spike's script had four classes: the shipped game, the lazy 3D chunk, the lab boot, and the stage lab page.

**Two Vite traps found in the lab:**

1. A named `output.codeSplitting` group for Pixi moved Vite's preload helper into the Pixi chunk. The boot entry then statically imported a 150.6 kB gzip chunk. Plain dynamic `import()` with no named groups kept the entry at 1.2 kB gzip in the test. Do not use named groups for Pixi or Three.
2. A top-level `await renderer.init()` hung a production build. Run `init` in an async function.

Also log bytes actually transferred in a Playwright run of `prod.spec.ts`. The all-chunks total overstates what a player loads. Add `optimizeDeps.include: ['pixi.js', 'three']` to the Vite dev config so a lazy dependency does not trigger a page reload in the middle of an e2e run. This is untested.

---

## 11. CI

Today's CI (`.github/workflows/ci.yml`) runs three jobs at the same time. `check` runs lint, typecheck, unit tests, and the bundle budget. `e2e` runs the Chromium specs (playthrough, gameover, prod, economy, chaos, gpufx, fxlab, the engine specs, the field and stage parity, and the default-path goldens; `perf` is local). `e2e-engines` runs `prod` and `gameover` on WebKit (the whole flow) and Firefox (no WebGL 2 on the runner: since M6 the game does not start there, so the game flow is skipped by `browserName` and one E5 test checks the message). The real-speed playtest runs in `playtest.yml`, on a push to `main` and from the Run workflow button on the Actions tab. The plan:

- Keep all of it during the migration, on the legacy path and on `?engine=sje`.
- Add the lab specs, the canary suite, and the manifest gate.
- Re-baseline the perf gates and the 120 s test timeout after the first CI run. Every spec now runs on software GL, so run time and flakiness can change.
- Add the T2 probe.
- Phase 0 CI results: CI is green on `f22dc09` (after one re-run, because the browser install took 22 minutes) and on `d61d7d9`, which ran the strict parity gate on the Linux runner. The spike CI takes about 29 minutes. The job limit on the spike is 45. The first CI run (`4208b60`, run 37264317312) had 2 Chromium timing failures. They were fixed in round 4. The 640x360 checks of step S1a (7 new tests, 209 in the list) have not run on CI yet. They add about 1 minute at most.
- Gate timing on a real GPU only. On software GL (SwiftShader, llvmpipe) the lab specs assert that the loop ticks and keeps a sane interval. The p50 is under 250 ms (the loop's own clamp), and no frame takes 2 seconds or more.

**What changes in the existing e2e suite.**

- `#boot` stays. **Done in M6:** the `#fx` canvas is gone, `startSje` removes `#screen`, so specs read `canvas`, and `gpufx.spec.ts` reads `__SJ__.renderer.fxLevel` (the request) and `fxCounts().level` (the level drawn).
- Specs that read scene internals by name (`game.top.main.current.value`, `.mode`, `.idx`) still work while scenes keep those fields.
- Specs that monkey-patch `game.tick`, `top.update`, and `top.render` get a `__SJ__.hooks` replacement.
- About 47 lines in the spike's specs read Phaser object properties (`depth`, `flipX`, `originX`, `texture`, `list`). They map to `zIndex`, a mirror flag, `anchor`, texture, and a `Figure` accessor. The count depends on the search pattern, so treat it as an estimate.
- Golden images of the default page exist since M6: `e2e/default-path.spec.ts` (title, `rustyard`, a battle, Options; `tests/fixtures/defaultpath/soft`).

---

## 12. Docs and skills that teach agents the engine

Agents write Pixi v7 and Phaser 3 from memory. Both are wrong here. The fix is a short list of tested rules and a clear order of authority.

**Authority order for agents:**

1. The installed `.d.ts` files and `node_modules` source.
2. `docs/engine/` (these files).
3. Context7. It lists Pixi only up to v8.16.0, and the repo runs 8.22.0.
4. `pixijs.com/llms.txt`.

The Pixi package ships 26 skill folders, but two examples are wrong in 8.22. Treat them as hints.

**What M0 adds:**

| Item | Purpose |
|---|---|
| `.claude/skills/engine/SKILL.md` in this repo | Read order, how to add a `GameObject`, a scene, an effect, and a test. The hard rules below. Names the spike's `node_modules/phaser` as the Phaser 4 reference. |
| `docs/engine/verified-conventions.md` | The traps below, kept current. |
| `docs/engine/llms.txt` | A generated index of the engine docs for agents. |
| Interface sync script | Copies the real `.d.ts` into `interfaces.md`. |

**Traps agents get wrong (verified against Pixi 8.22.0 and Three 0.186):**

- Pixi `Application` and `Ticker.shared`: we use neither. The renderer still starts `Ticker.system` through `SchedulerSystem`. Stop it after `init`.
- Pixi anchor defaults to (0,0). Phaser origin defaults to 0.5.
- `Filter.from({ gl: { fragment } })` throws in 8.22. Pass `vertex: defaultFilterVert` too.
- Array renderer preference is exclusive. A string preference falls back to the Canvas renderer. We use `new WebGLRenderer()`.
- `Texture.from(canvas)` caches by canvas object. `Texture.from(url)` no longer loads.
- `texture.destroy()` leaves the source alive. Use `destroy(true)` once per source.
- The ticker callback receives a `Ticker`, not a delta.
- v7 habits: `beginFill`, `drawRect`, `lineStyle`, `new Application({})` without `await init`, positional constructors, `interactive`, `DisplayObject`.
- `g.rect(...).fill(color, alpha)` is deprecated in 8.22 and logs a warning. Use `fill({ color, alpha })`. The boot gate fails on any warning.
- No top-level `await` on `init`.
- Never call `renderer.destroy()` on a shared context.
- Fragment shaders need `uniform highp vec4 uInputSize`.
- An empty uniform group in a custom filter crashes the first draw in 8.22 ("Cannot read properties of undefined"). Leave the group out when there are no uniforms.
- `setMask({ mask: null })` does nothing in 8.22. Set `node.mask = null`.
- A sprite mask reads red times alpha by default. Pass `channel: 'alpha'` for a mask that follows alpha.
- `stroke({ pixelLine: true })` is not exact. It leaves out the first pixel of a horizontal or vertical line and puts diagonals one pixel off. Draw 1 px lines as rectangles.
- `roundPixels: true` lost 16 to 35 pixels under a sprite mask on SwiftShader. Keep it off and snap in the wrapper. With snap to pixel on, the option changes no pixel at scale 1, 2 and -1. It does change pixels for a 1.5x odd-sized picture, a snap-off node at a half pixel, and the 1.09x push. See [scene-graph.md](scene-graph.md) section 7.
- `RenderLayer` ignores filters. A filter on an ancestor, or on the layer itself, does not reach a child that is attached to the layer.
- `three.resetState()` after Three renders, before Pixi draws.
- Create Three with both `canvas` and `context`: `new WebGLRenderer({ canvas, context: gl })`. Never call `setSize`, `setViewport`, or `setPixelRatio` on the shared renderer. Render only to render targets.
- `ColorManagement.enabled = false` and no `OutputPass` for exact colors in the 3D target.
- Leaves have no children. Leaf destroy needs care with `{ context: true }` for `Graphics`.
- `Clock` in Three is deprecated. Use a constant dt.
