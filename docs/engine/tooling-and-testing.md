---
type: design
title: "Shadow Jog Engine — Tooling and testing"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-04
status: draft for Mark's approval
tags: [engine, design]
---

# Shadow Jog Engine — Tooling and testing

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
| FX lab (`src/dev/fxlab.ts`, 885 lines) | Ported in M6 to a `Scene` that uses `scene.add` and `FxSystem`. It edits `fx.json` through the existing vite plugin and `import.meta.hot`. It becomes the filter and effect lab. | Port |
| Animation editor (`rigedit.html`), art review (`artreview.html`) | No change. They import art modules only and do not use `Game`. | Unchanged |
| Battle Stage Editor, Battle Test, Stage lab | Port with the stage in M3. See section 2. | Port |
| Trailer recorder | Captures the single canvas with `captureStream`. Drops the `#fx ?? #screen` choice. | Small change |
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
- Behaviour of the editor stays as in `docs/TOOLING-UI.md`.

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
| Literal scan | No number that means the screen width, height, or centre (480, 270, 240, 135) outside `size.ts`. A per-file allow-list holds a reason for each exception ([frame-and-rendering.md](frame-and-rendering.md) section 5). |
| Game stack | Ports the fault, abandon, curtain, exit-throw, and two render-fault cases of `tests/game.test.ts` to the new `Game`. It also adds new tests for close order and microtask timing. The old tests use a Proxy `ctx` and a fake input. |
| Determinism | The same recorded inputs at 60, 144, and 30 Hz and with hitches give the same state hash. For the battle driver and the hack sim. |
| Scene lifetime | After shutdown, the scene's clock events, tweens, and event links are gone. Engine awaits reject with `Cancelled`. |
| Wrapper rules | Origin sets anchor. Flip uses Phaser maths. Positions are rounded. Leaves refuse children. |
| 1,000-object bench | Wrapper overhead for 1,000 `GameObject`s. Run once at M1, not every commit. |

---

## 4. Playwright under SwiftShader (T1)

Playwright's Chromium launcher adds `--enable-unsafe-swiftshader` on every OS. Headless Chromium then gives WebGL 2 on SwiftShader with no extra flags (lab). So CI needs no special setup. Locally the project uses Edge with the real GPU (`playwright.config.ts`), so local and CI pixels differ unless you add a SwiftShader mode (`PW_SWIFTSHADER=1`).

**Today the GL presenter has zero CI coverage.** `GlPresenter.create` refuses any renderer whose name matches `/swiftshader|llvmpipe|.../`. Both GL tests in `e2e/gpufx.spec.ts` skip on CI. With Pixi, every spec runs on software GL, so effects need the fx levels (see [frame-and-rendering.md](frame-and-rendering.md) section 6.5). `?fx=full` forces them on SwiftShader.

T1 runs on Chromium, viewport **960x540**. Specs on the lab page:

| Spec | Gate |
|---|---|
| Boot | Zero console errors **and warnings**. Pixi logs real defects as warnings, and today's watchers collect only `error`. |
| Pixel blocks | k-by-k blocks are uniform at device pixel ratio 1, 1.25, and 1.5. Reuse the spike's `stagelab-dpr.spec.ts`. |
| Goldens | Section 5. |
| Frame interval | Section 7. |
| Draw calls | Section 7. |
| Leak cycles | Section 8. |
| Context loss | A redrawn frame returns identical. A baked texture re-bakes. The 3D promise resolves `aborted` within 2 seconds. |
| No WebGL2 | Stub `getContext` to return null. Expect the visible "failed to start" notice. |
| 3D enter and exit | Ten cycles. Counts return to baseline. |
| Canary suite | Section 8. |

**T2: Firefox and WebKit on the Linux runner.** Today they run only `prod.spec.ts` and `gameover.spec.ts`. Nothing records whether they give WebGL 2 on the GitHub runner, or what Pixi renders there. Order of work: a probe spec that logs `getContext('webgl2')` and the unmasked renderer string, then an informational (non-blocking) pixel-block spec, then a gate. The shared-context path is unproven there. If it fails there, the canvas-copy path or the `unsupported` result must be proven there before the design is locked.

**T3: local, on your desktop.** The 60 fps check with bloom on the RTX 4070, in Edge. Goldens are never regenerated from the local GPU.

---

## 5. Pixel-exact checks and goldens

**Pixel blocks.** With nearest sampling and an integer upscale, every game pixel is a uniform k-by-k block. The test counts non-uniform blocks. Lab result: 0 of 129,600 at x3 and x4, with filters inside the 480x270 render texture. The test needs an allow-list for `Texture.WHITE` and `Texture.EMPTY`, which stay linear.

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

**Parity with the Phaser stage.** The earlier parity result (1/255 on 0.98 to 2.26% of pixels) was for a Canvas 2D display list, not for Pixi. Pixi parity is not measured. M3 measures it. Pass line: a tolerance that you agree, and an identical Battle Test status trace (seed 7).

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
| Frame interval | rAF interval p50 and p95. | New. Lab: 16.7 ms at 960x540, p95 33.4 ms at 1920x1080 with the full stack. |
| Draw calls | Count draws and framebuffer binds with a patch of `WebGL2RenderingContext.prototype`. | New. Hardware independent. Lab: 301 sprites cost 1 draw. Blur, color matrix, and shockwave cost 12 draws and 13 binds. |
| 3D hand-off | One frame of the shared-context path stays inside its budget. | New. |

SwiftShader cost follows canvas pixels. The full effect stack costs about 12 to 13 ms at 960x540 (one machine, medium confidence). Keep the CI viewport at 960x540 or less. Budget each fx level per pass. The first real CI run is the actual measurement.

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
| Canvas upload per frame | 2 MB | One 480x270 `CanvasImage` is 518 KB. The legacy shell has two |
| Objects per scene | 1,000, with wrapper overhead under 1 ms per frame | The 1,000-object bench at M1 |
| Texture memory | Warn at 128 MB | Estimate. See [frame-and-rendering.md](frame-and-rendering.md) section 10 |

---

## 8. Leak, context, and canary tests

**GL-object harness.** Patch `create` and `delete` for textures, buffers, programs, VAOs, framebuffers, and renderbuffers. Ten create-and-destroy cycles return to baseline. A negative control that leaks on purpose must grow. Turn off Pixi's GC during the test. Lab results: baseline texture 8, buffer 6, program 5, VAO 3, framebuffer 5. The same harness covers the 3D enter and exit x10 line.

**Canary tests.** Each trap from the research has a Playwright test that fails if the fix is missing. They run on every Pixi or Three bump. Versions are pinned exactly (`pixi.js 8.22.0`, `three 0.186.x`).

| Canary | Fails if |
|---|---|
| Stale clear color | A filtered container with a transparent gap, over a non-black Three background, through the back-buffer path, shows Three's color. |
| Canvas on init | Context restore does not recover (Pixi `init` without `canvas`). |
| `destroy` kills the context | Anything calls `renderer.destroy()` outside the dev teardown test. |
| `ExternalSource` scale | A Three render target with linear filtering produces blended 2x2 blocks. |
| Stencil mask | A `Graphics` mask inside the 480x270 back buffer draws outside the mask. |
| Three canvas and context | After `WEBGL_lose_context`, `three.render()` does something. Or Three does not recover on restore (Three created without `canvas`). |
| No second Pixi loop | A Pixi `requestAnimationFrame` callback runs after boot (`Ticker.system` not stopped). |
| Extension list | A boot with `skipExtensionImports` cannot render a sprite, a `Graphics`, a mask, or a filter. |
| Texture GC | Pixi unloads an idle texture while `gcActive` is false. |
| Texture handle | `renderer.properties.get(rt.texture).__webglTexture` is undefined. |
| Color exactness | `#ff2080` in Three does not come out as `#ff2080`. |
| Frame rewrap | A resize or restore leaves the 3D sprite stale. |

---

## 9. Lint and import-level rules

Code is grouped in levels 0 to 6 (see [README.md](README.md) section 4). Biome `noRestrictedImports` and the T0 import scan enforce these:

1. `pixi.js` may be imported only under `src/sje/render` and `src/sje/display` (the `display` folder includes the `textures` and `fx` parts). Game code never imports it.
2. `three` may be imported only under `src/sje/three` and `src/hack3d`. Both load through one `import()`.
3. `src/battle`, `src/hack3d/sim`, and `src/game/state.ts` import neither a renderer nor the DOM.
4. A lower level never imports a higher level.

Inherited rules: strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`). `noNonNullAssertion` stays an error in `src/sje/**`: use `must(value, what)` from `engine/assert.ts`. No per-frame allocation in hot paths: use pooled lists and preallocated uniforms. Gameplay randomness only from seeded `Rng`. Comments explain why.

---

## 10. The bundle alarm

Today `scripts/bundle-budget.mjs` has two gates. The first sums every `dist/assets/*.js` against 236 kB gzip. The game measures 233.9 kB (boot chunk 144.8, battle 44.6, tables 39.3, deck 3.2 and 2.0). That leaves about 2 kB. The second gate caps the largest single chunk at 480 kB raw (`CHUNK_MAX`). The CI step is named "largest chunk and total gzip". Pixi and Three change this. The alarm is an alarm, not a hard limit.

**The largest-chunk rule.** A lazy Pixi chunk is 131 to 205 kB gzip, so it is probably over 480 kB raw. The boot chunk is about 418 kB raw today (estimate: measure again at M0). The manifest gate below replaces **both** old rules. Set a largest-chunk cap for each class, or drop the rule on purpose (E17).

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

**The new gate** reads `dist/.vite/manifest.json` (`build.manifest: true`) and sorts chunks into classes by reachability over `imports` and `dynamicImports`:

| Class | Content | Rule |
|---|---|---|
| `boot` | The entry's static closure | Must contain **no** `pixi.js` and **no** `three` module. A hard check. |
| `lazy-2d` | Pixi and the engine | Counted. |
| `lazy-3d` | Three and the hack scene | Own cap. |
| `lazy-other` | Battle, deck, tables, dev | Counted. |
| `first play` | `boot` plus `lazy-2d` | Reported. |

The caps are your call (E17). The old 236 kB total cannot hold. Starting caps (estimates, to reset after M1 and M2 measurements):

- `boot`: at most 144.8 kB (today's value).
- `first play`: set after M1. The estimate is 330 to 430 kB (low confidence).
- `lazy-3d`: 240 kB.

**Two Vite traps found in the lab:**

1. A named `output.codeSplitting` group for Pixi moved Vite's preload helper into the Pixi chunk. The boot entry then statically imported a 150.6 kB gzip chunk. Plain dynamic `import()` with no named groups kept the entry at 1.2 kB gzip in the test. Do not use named groups for Pixi or Three.
2. A top-level `await renderer.init()` hung a production build. Run `init` in an async function.

Also log bytes actually transferred in a Playwright run of `prod.spec.ts`. The all-chunks total overstates what a player loads. Add `optimizeDeps.include: ['pixi.js', 'three']` to the Vite dev config so a lazy dependency does not trigger a page reload in the middle of an e2e run. This is untested.

---

## 11. CI

Today's CI runs lint, typecheck, unit tests, the bundle budget, and 9 e2e specs on Chromium (playthrough, playtest, gameover, perf, prod, economy, chaos, gpufx, fxlab). It runs Firefox and WebKit on `prod` and `gameover` only. The plan:

- Keep all of it during the migration, on the legacy path and on `?engine=sje`.
- Add the lab specs, the canary suite, and the manifest gate.
- Re-baseline the perf gates and the 120 s test timeout after the first CI run. Every spec now runs on software GL, so run time and flakiness can change.
- Add the T2 probe.

**What changes in the existing e2e suite.**

- `#screen`, `#boot` stay. `#fx` goes away. `gpufx.spec.ts` reads `__SJ__.renderer.fxLevel` instead.
- Specs that read scene internals by name (`game.top.main.current.value`, `.mode`, `.idx`) still work while scenes keep those fields.
- Specs that monkey-patch `game.tick`, `top.update`, and `top.render` get a `__SJ__.hooks` replacement.
- About 47 lines in the spike's specs read Phaser object properties (`depth`, `flipX`, `originX`, `texture`, `list`). They map to `zIndex`, a mirror flag, `anchor`, texture, and a `Figure` accessor. The count depends on the search pattern, so treat it as an estimate.
- There are no golden images today. Adding them is new work.

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
- `three.resetState()` after Three renders, before Pixi draws.
- Create Three with both `canvas` and `context`: `new WebGLRenderer({ canvas, context: gl })`. Never call `setSize`, `setViewport`, or `setPixelRatio` on the shared renderer. Render only to render targets.
- `ColorManagement.enabled = false` and no `OutputPass` for exact colors in the 3D target.
- Leaves have no children. Leaf destroy needs care with `{ context: true }` for `Graphics`.
- `Clock` in Three is deprecated. Use a constant dt.
