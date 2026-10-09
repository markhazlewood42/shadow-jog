---
type: design
title: "Shadow Jog Engine — Verified conventions"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
status: M0 (built 2026-10-09)
tags: [engine, m0, conventions]
---

# Shadow Jog Engine — Verified conventions

This file lists what the labs checked against installed source, and the check each fact came from. It is the list that [conventions.md](conventions.md) and the engine skill (`.claude/skills/engine/SKILL.md`) lean on. Agents write Phaser 3 and Pixi v7 from memory: when memory and this file disagree, this file wins, and the installed source in `node_modules` wins over this file.

Three kinds of check, and a label for each:

- **Source** means a person or agent read the installed package at the file and line shown. The record is [the lab record](../research/2026-10-04-engine-labs.md) (2026-10-04). M0 did not read these files again.
- **Canary** means a Playwright test in `e2e/sje-canaries.spec.ts` fails if the fact stops being true. It runs on SwiftShader in CI and on every Pixi or Three bump.
- **Unit** means a Vitest test in `tests/` fails.

Versions: `pixi.js` 8.22.0, `three` 0.186.1, Phaser 4.2.1 (the spike checkout only; Phaser is not a dependency of this repo).

---

## 1. Phaser 4.2.1 conventions (Source)

Each row is a Phaser fact that a name or rule of the engine rests on. The Phaser source is not in this repo, so a check of a row needs the spike checkout (`shadow-jog-phaser/node_modules/phaser`, 4.2.1).

| Fact | Evidence (Source) | Engine rule that rests on it |
|---|---|---|
| A scene runs `init(data)`, `preload()`, `create(data)`, then `update(time, delta)` each step. `shutdown` and `destroy` are events, not methods. A scene owns its display list, cameras, input, loader, clock, tweens and events, injected by name. | `src/scene/SceneManager.js:473-530, 616-660`; `src/scene/Systems.js:772-800` | `Scene` hooks and the property names of `Scene` (`add`, `cameras`, `input`, `load`, `time`, `tweens`, `events`). One rename: `update` becomes `fixedUpdate(tick)`. |
| `ScenePlugin` operations (`start`, `launch`, `run`, `pause`, `resume`, `sleep`, `wake`, `switch`, `stop`) are queued and applied at the next `SceneManager` update. Scenes update top first and render bottom first. `pause` stops update and still renders; `sleep` stops both. | `src/scene/ScenePlugin.js:199-232, 481-512, 539-600` | Phaser names, queued to the next step (M1). |
| `Game.step` order: `PRE_STEP`, `STEP`, scene update, `POST_STEP`, `PRE_RENDER`, scene render, `POST_RENDER`. The main loop passes a smoothed variable delta (`smoothStep` is on). The only fixed step in Phaser is Arcade physics (60 fps). | `src/core/Game.js:350-420, 454-512`; `src/core/TimeStep.js:431-442` | `prestep`, `step`, `poststep` fire once per fixed tick (a deviation); `prerender`, `postrender` once per frame. A fixed 60 Hz `FixedLoop` is ours. |
| `Phaser.Game.run` does not wait. `ScenePlugin.run` starts, resumes or wakes a scene. | `src/scene/ScenePlugin.js:499-535` | `game.run(scene): Promise<R>` waits for `close(result)` (ours: story scripts `await` it). |
| `GameObject` has no rendering; capabilities are component mixins. `Container` holds children with relative positions. `Layer` is a transform-less display list that must be top level (a `GameObject` since 4.1.0). `Group` is a pool, not displayable. | `src/gameobjects/container/Container.js`; `src/gameobjects/layer/Layer.js:20-62` | `Container`, `scene.add.layer()` returns a `Container` at identity (deviation), `Group` on demand. |
| Default origin is 0.5 (center). Pixi's `Sprite` anchor defaults to (0,0). A straight port shifts every sprite by half its size. | `src/gameobjects/components/Origin.js:42`; `pixi.js` `lib/scene/sprite/Sprite.d.ts:224-228` | `setOrigin`, 0.5 default, written to the Pixi anchor. |
| `flipX` flips about the middle of the texture, so a foot pixel moves to `w - foot.x`. | lab record, Phaser spike finding 10 | `setFlipX` uses Phaser's math. |
| `roundPixels` defaults to false in Phaser 4 (it was true in v3). Vertex rounding is per camera and per object (`vertexRoundMode`). `pixelArt: true` sets nearest filtering and rounds. | `changelog/v4/4.0/MIGRATION-GUIDE.md:325-340` | "Snap to pixel" is the engine's own rule, in the `GameObject` wrapper. Pixi has only a renderer flag (kept off). |
| `depth` sorts the display list before each render. A `Layer` sorts its own children. | `src/gameobjects/components/Depth.js:17-100`; `src/scene/Systems.js:393-420` | `depth`, with named bands in `depth.ts`. |
| Phaser has no input-action map: `Key` objects, `keydown-A` events, a gamepad plugin. | `src/input/keyboard/KeyboardPlugin.js:396-500`; `src/input/InputPlugin.js` | `ActionMap` is ours (from Godot's `InputMap`), M1. |
| Scene-scoped `Clock` (`delayedCall`, `addEvent`, `timeScale`), `TweenManager` (`add`, `chain`, `addCounter`, `stagger`; tweens destroy themselves unless `persist`), `Timeline`. | `src/time/Clock.js:200-260, 368-395`; `src/tweens/TweenManager.js:333-575` | `scene.time`, `scene.tweens` (M1). |
| Phaser 4 merged v3's FX and masks into one `Filter` system with internal and external lists and a `Mask` filter. Each filtered object adds draw calls. | `changelog/v4/4.0/MIGRATION-GUIDE.md:66-113` | `object.filters` is flat (a deviation: no `enableFilters()`, no `internal` and `external`). |
| Pixel art: render at a fixed reference resolution, scale by whole numbers with nearest filtering. | `src/core/Config.js:395-403`; `src/scale/ScaleManager.js` | `Presenter`, integer scale. |
| "Scene", "run", "Layer" and "Timeline" mean different things in Phaser, Godot, Unity, Pixi and Three. | `src/scene/ScenePlugin.js:499-535`; `src/gameobjects/layer/Layer.js:20-62`; `src/time/Timeline.js` | The vocabulary rulings in conventions.md section 1. |

Not confirmed by the fact-check (do not quote these numbers): the Unity `FixedUpdate` default of 0.02 s was not found on Unity's own pages (only a search summary). Godot (60 ticks, 8 steps) and Gaffer (0.25 s clamp) were confirmed verbatim.

---

## 2. Pixi 8.22.0 and Three 0.186.1 traps (Canary)

These are the traps with a test. Each row has a canary and a negative control that must show the bug. Run: `CI=1 npx playwright test e2e/sje-canaries.spec.ts`.

| # | Fact | Canary | Negative control (must fail the check) |
|---|---|---|---|
| 1 | Pixi 8.22 `resetState()` resets its clear-color cache to (0,0,0,0) but does not call `gl.clearColor`. Three leaves its background as the real clear color, so a filtered container with a transparent gap shows Three's color. `GlHandoff.endThree` fixes it. | Canary 1: the gap shows the 3D picture (0 wrong of 2,800). | Fix off and a back buffer cleared to (0,0,0,0): 2,445 wrong. |
| 2 | Pixi `init` needs `canvas` as well as `context`. Without it Pixi listens for context loss on an unrelated canvas. | Canary 2: the same pixel after a lost and restored context. | Without `canvas`: pixel (0,0,0,0) and a GL error. |
| 3 | `renderer.destroy()` loses the context, and Pixi and Three share one. | Canary 3: a source scan (nothing calls it outside the dev teardown), and a throwaway renderer that does lose its context. | The scan flags a bad snippet. |
| 4 | Pixi's `scaleMode` does not reach an `ExternalSource`. The 3D picture is sampled with the filter Three set on its target. | Canary 4: a nearest 8x8 target at 4x is 2 colors, and the real frame is 640x360 nearest. | A linear target: 6 colors (blended edge). |
| 5 | A `Graphics` mask works through the stencil buffer. A context with no stencil lets the whole panel through when drawn to the canvas. A render texture (the back buffer) gets its own stencil. | Canary 5: the engine context has stencil, and the back buffer shows exactly the mask rectangle (1,280 pixels, 0 outside). | A stencil-less context: 1,200 pixels outside the mask. |
| 6 | Three needs `canvas` as well as `context`, or it never hears of a loss or a restore. `render()` returns silently while lost. | Canary 6: the same color after a loss and restore; nothing throws while lost. | Without `canvas`: black after the restore. |
| 7 | Pixi's scheduler starts a second `requestAnimationFrame` loop on `Ticker.system`. `Ticker.system.stop()` after `init`. Every throwaway renderer restarts it. | Canary 7: no callbacks run after boot, after Three and after a probe renderer. | Starting the ticker: callbacks run. |
| 8 | `skipExtensionImports: true` keeps Pixi's environment chunks (`browserAll`, `webworkerAll`) from downloading. A sprite, a `Graphics`, a mask and a filter still draw. | Canary 8: the four draws are exact, and no chunk or Three is requested. | Pixi's default init requests `browserAll`. |
| 9 | Pixi's texture collector (`gcActive`) unloads an idle `ImageSource` (not a `CanvasSource`: Pixi turns the collector off for canvas sources). The engine turns it off. | Canary 9: the engine's collector is off and the idle texture stays. | Collector on: the texture is unloaded. |
| 10 | `renderer.properties.get(rt.texture).__webglTexture` is an internal Three field. The shared-context frame needs it. | Canary 10: it is a `WebGLTexture`, and the frame is shared-context. | Hidden: `auto` falls back to the canvas copy with exactly one warning, and `shared-context` refuses. |
| 11 | With Three's default color management `#ff2080` comes out as `#ff0437`. The engine switches it off and uses no `OutputPass`. | Canary 11: exact colors through the 3D picture and the screen, in both frame modes. | Management on: `[255, 4, 55]`. |
| 12 | After a context restore Three makes a new GL texture for the render target. The Pixi wrapper must re-point (`rewrap`). | Canary 12: the same picture after a restore, one rewrap. | No rewrap: the picture is stale. |

---

## 3. Other facts (Source, from the lab record)

Verified by reading Pixi 8.22.0 and Three 0.186 source and running the lab in 2026-10. These have no canary of their own, but a lab check or a unit test covers many of them (the boot test fails on any console warning).

- `Filter.from({ gl: { fragment } })` throws in 8.22. Pass `vertex: defaultFilterVert` too. Fragment shaders need `uniform highp vec4 uInputSize`.
- An empty uniform group in a custom filter crashes the first draw ("Cannot read properties of undefined"). Leave the group out.
- Array renderer preference is exclusive; a string preference falls back to the Canvas renderer. The engine uses `new WebGLRenderer()`.
- `Texture.from(canvas)` caches by canvas object. `Texture.from(url)` no longer loads. `texture.destroy()` leaves the source alive: use `destroy(true)` once per source.
- The ticker callback receives a `Ticker`, not a delta.
- `g.rect(...).fill(color, alpha)` is deprecated in 8.22 and logs a warning. Use `fill({ color, alpha })`.
- `setMask({ mask: null })` does nothing in 8.22: set `node.mask = null`. A sprite mask reads red times alpha: pass `channel: 'alpha'`.
- `stroke({ pixelLine: true })` leaves out the first pixel of a horizontal or vertical line and puts diagonals one pixel off. Draw 1 px lines as rectangles.
- `roundPixels: true` lost 16 to 35 pixels under a sprite mask on SwiftShader. Keep it off and snap in the wrapper.
- `RenderLayer` ignores filters.
- Pixi `Text` needs `document` and fails in Node. The engine draws text with the game's font.
- A `Container` leaf with children is deprecated, not yet an error: forbid it from day one.
- `three.resetState()` after Three renders, before Pixi draws. Never `setSize`, `setViewport` or `setPixelRatio` on the shared renderer.
- Three `Clock` is deprecated since r183: use a constant dt.
- Pixi v8 textures default to linear scaling. The engine sets `TextureStyle.defaultOptions.scaleMode = 'nearest'` before any texture exists (`PixiRenderer.create`).
- A named `output.codeSplitting` group for Pixi moved Vite's preload helper into the Pixi chunk, so the entry statically imported 150.6 kB gzip; a top-level `await renderer.init()` hung a production build. `scripts/bundle-budget.mjs` checks both.

---

## 4. Checked by unit tests (Unit)

- One size source, `src/sje/core/size.ts`, and no other `W` or `H` definition: `tests/screen-literals.test.ts`.
- Import levels, who may import Pixi and Three, raw GL only in `GlHandoff`, pinned versions: `tests/sje-imports.test.ts`.
- The interface sketches compile and match the doc: `tests/sje-interfaces.test.ts`.

## 5. Drift to expect

A Pixi or Three bump can change any row of section 2 or 3. Bump, run the canary suite, and read each red test as a changed fact. Update this file in the same change.
