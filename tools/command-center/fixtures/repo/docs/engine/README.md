---
type: design
title: "Shadow Jog Engine — Overview"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-05
status: approved 2026-10-04 (all recommendations). Phase 0 update on 2026-10-05, waiting for Mark's final approval
tags: [engine, design]
---

# Shadow Jog Engine — Overview

This is the 10-minute version. It tells you what the engine is, what its parts are, and where each part comes from.

**You approved the design on 2026-10-04, with all recommendations.** The look decisions (E8, E20) still come to you at their milestones. You settled the resolution follow-up (E12) on 2026-10-05. You first kept 480x270 after the mock. The same day you chose 640x360 from the comparison pictures. The Phase 0 platform spike ([migration.md](migration.md) section 3) tested the design. The next step is your final approval of this update, then M0. Every build step goes through the verification loop in [verification.md](verification.md).

## What the Phase 0 spike changed (2026-10-05)

The evidence is in `docs/spikes/engine-platform.md` on the branch `spike/engine-platform`. Each change is also in the section that it names. "Spike drift N" in the docs means item N in the drift list of that spike doc.

- The canvas is the whole window in device pixels. The 640x360 picture sits inside it at a whole scale `k`, on a whole device pixel. This fixed uneven pixels at some device pixel ratios. See [frame-and-rendering.md](frame-and-rendering.md) section 6.6.
- Pixi `roundPixels` is off. Snap to pixel does the rounding. It is the only rounding at scale 1, 2 and -1, and for snapped children of a 2x parent. It is not enough for a fractional scale of an odd-sized picture, for a snap-off node at a half pixel, for a snap-off child at a quarter pixel, or for the 1.09x battle push. See [scene-graph.md](scene-graph.md) section 7.
- Bloom for the 3D mode runs inside the 640x360 target, with Three's `UnrealBloomPass`. It is not a Pixi filter on `View3D`. See [frame-and-rendering.md](frame-and-rendering.md) section 7.5.
- The 3D watchdog waits 1 second, not 2. The canvas-copy fallback keeps one private Three renderer. See [frame-and-rendering.md](frame-and-rendering.md) sections 7.1 and 7.4.
- The story policy for 3D results (E19) is stricter. Only a lost context retries. A dropped story ends. See [decisions.md](decisions.md) E19.
- Level 5 imports levels 0 to 3. `View3D` lives at level 2. See section 4 below.
- Effects: one mask for each object. A sprite mask reads alpha. `destroy` does not destroy effects. 1 px lines are rectangles. See [frame-and-rendering.md](frame-and-rendering.md) sections 6.4 and 10, and [scene-graph.md](scene-graph.md) section 2.
- The speed line is a frame interval within 5% of a bare page and a frame cost of at most 8 ms. See [tooling-and-testing.md](tooling-and-testing.md) section 7.
- The browser questions have answers. WebKit passes on the Linux CI runner. Firefox on that runner has no WebGL2. See [migration.md](migration.md) section 3.
- The game size is 640x360 (E12). You chose it on 2026-10-05. The scale `k` is 3 on a 1080p screen and 2 on the Steam Deck window. Phase 0 measured every size-dependent exit criterion again at 640x360, and all hold. See [migration.md](migration.md) section 3.
- At 480x270 the stage slice matches the Phaser spike with 0 differing pixels. At 640x360 the Phaser spike cannot be the reference, because it draws 480x270. The top left 480x270 of the 640x360 slice equals the 480x270 picture pixel for pixel. See [migration.md](migration.md) section 3.
- The editor rule is now a design rule: no decision may make a future visual editor harder. See section 1 below and the editor rule check in [decisions.md](decisions.md).
- The 640x360 move changes 7 files in `src/engine` before M0. Migration principle 4 bends for it. See [migration.md](migration.md) section 1.
- CI is green on `f22dc09` and `d61d7d9`. See [migration.md](migration.md) section 3.
- Some work moved between milestones. See [migration.md](migration.md) sections 2, 5 and 6.

> **What you approve now.** E1 to E25 were approved on 2026-10-04 with all recommendations (see [decisions.md](decisions.md)). The Phase 0 update asks for seven real choices, C1 to C7. Each has a recommendation. Reply with the number, for example "C1 accept", or "all recommendations". The record-only rows are in [decisions.md](decisions.md), section "Phase 0 update: record-only rows". The editor rule check is in the section after it. The record-only rows are in [decisions.md](decisions.md), section "Phase 0 update: record-only rows". The editor rule check is in the section after it.
>
> | # | Real choice | Recommendation |
> |---|---|---|
> | C1 | `roundPixels` off. Snap to pixel does the rounding. It is not exact for a fractional scale of an odd-sized picture, for a snap-off node at a half pixel, or for the 1.09x battle push. | Accept. M3 decides what the battle push may do. |
> | C2 | E3: the fallback keeps one private Three renderer for the page, with no `forceContextLoss()` on exit. A restore needs a fourth hand-off rule: `prepareForThree` runs between the restore handlers of Pixi and Three. | Accept. A new renderer for each entry leaked 5 textures and 3 framebuffers. |
> | C3 | E19: only `context-lost` retries. A dropped story ends. It starts no scene and never retries. | Accept. A retry after a drop would start a scene on top of whatever the player moved to. |
> | C4 | The watchdog waits 1 second, not 2. The pass line (the hack resolves within 2 seconds of the loss) holds: 1,015 to 1,034 ms. | Keep 1 second. |
> | C5 | E17: the `lazy-3d` cap. Phase 0 measured 145.1 kB gzip. The spike budget is 160 kB. | Set the cap at 160 kB. Confirm at M1 and M6. |
> | C6 | E13: `fit` mode is not built and has no tested design with the whole-window canvas. | Decide at M1. Consider retiring `fit`, because the integer presenter never resamples. |
> | C7 | E22: three new Phaser deviations (the list grows from 16 to 19): `setTexture` renames the object, a scene never restarts, and an object has one mask. | Accept. See [conventions.md](conventions.md) section 3. |
>
> **IDs.** E = open engine decision. M = build milestone. T = test tier. Level 0 to 6 = code level.

---

## 1. What the engine is and is not

PixiJS v8 draws all the 2D. Three.js draws the 3D mode only. The engine is the code between your game and those two libraries.

**The engine is** a thin layer over a bare Pixi v8 `WebGLRenderer`. It gives the game a scene stack, a scene graph, a camera, a texture store, input actions, timers, and a render pipeline. It follows Phaser 4 names and rules.

**The engine is not:**

- An editor. It has no scene files and no inspector UI beyond the dev tools in [tooling-and-testing.md](tooling-and-testing.md).
- A physics engine. The game has none.
- A copy of all of Phaser. We build a class only when a ported scene needs it.
- A replacement for the battle rules, the saves, the story scripts, the WebAudio synth, or your data in `src/data/*.json`. These stay.

**Pixi is only the renderer.** Game code never imports `pixi.js`. A `GameObject` owns one Pixi node. The wrapper hides the differences between Phaser and Pixi.

**The editor rule (your rule, 2026-10-05).** You want visual editors for the game and the engine in time: a level editor, an encounter editor, a game system config UI, a conversation editor, and more. They will come step by step. No decision in this design may make them harder. The rule has three parts:

- Game content is data that a tool can open and save. Code only reads it.
- Content that is TypeScript today (maps, enemies, items, abilities, shops, dialogue) moves to data files. The milestones in [migration.md](migration.md) say when.
- A new decision must say how an editor would read and write the thing that it changes. [decisions.md](decisions.md) records the check of every approved decision.

The Battle Stage Editor already follows the rule. It reads and writes `stages.json` and `hud.json`. The engine is not an editor, so the engine itself holds no editor UI (see above).

## 2. Three things that look like Phaser and are not

> **Three things that look like Phaser and are not.** (1) `fixedUpdate(tick)` runs at a fixed 60 Hz. There is no variable-delta `update`. (2) `game.run(scene)` waits for `close(result)`. (3) Pixi has no camera. The engine builds one.

Four more words mean different things in different engines. This table says which meaning wins here. Other collisions (stage, tick and frame, tier, view) are in [conventions.md](conventions.md) section 2.

| Word | Other meanings | Meaning in Shadow Jog |
|---|---|---|
| Scene | Godot: a reusable node tree. Unity: a level file. Three.js: the root `Object3D`. | A whole screen state on the stack, as in Phaser. Write "Three Scene" for the Three.js one. |
| run | Phaser `ScenePlugin.run`: queue a scene, no wait. | `game.run(scene)` pushes a scene and returns a promise. |
| Layer | Phaser `Layer`: a display list. Godot `CanvasLayer`. Pixi `RenderLayer`. Unity Sorting Layer. | We have no `Layer` class. `scene.add.layer()` returns a `Container` kept at identity. Pixi `RenderLayer` is internal only. |
| Timeline | Unity Timeline: a data asset. | Phaser's `scene.add.timeline([...])`: a list of timed steps. |

## 3. Reading order

1. This file.
2. [scene-graph.md](scene-graph.md): what the tree is made of.
3. [frame-and-rendering.md](frame-and-rendering.md): the loop, the render pipeline, the 3D mode.
4. [interfaces.md](interfaces.md): the key TypeScript interfaces.
5. [conventions.md](conventions.md): which engine each name comes from.
6. [tooling-and-testing.md](tooling-and-testing.md): dev tools, tests, CI, agent docs.
7. [migration.md](migration.md): the path from today's engine and from the Phaser spike.
8. [decisions.md](decisions.md): every decision and its answer.
9. [verification.md](verification.md): the independent verification loops, the rubrics and the visual updates.

Source material: `docs/research/2026-10-04-engine-and-3d.md`, decision 17 in `docs/PHASE-0.2.md`, today's engine in `src/engine/` (about 2,900 lines), the Phaser reference on branch `spike/phaser-stage` (folder `src/stage`), and editor behavior in `docs/TOOLING-UI.md`.

## 4. Code levels

Dependencies point down only. A Biome rule and a Vitest import scan enforce this. `sje` means Shadow Jog Engine. The new code lives in `src/sje/`. The old `src/engine/` stays until M8, so the shipped game still works.

![Engine code levels. Seven stacked levels, L6 game content at the top down to L0 core at the bottom. Dependencies point down only. Each level lists the levels it may import. L4, the facade, is the only import for game code. L6 imports the door and result types at L5 by a static arrow, and reaches the lazy 3D chunk at L5 by a dynamic import. The L5 box lists what it may import: src/sje/three imports levels 0 to 3, shown by a bracket on the left, and src/hack3d imports L4 and src/sje/three. It notes that the door and result types in src/hack3d load up front. Outside the levels, pure logic (src/battle and game state) is imported by L6 and imports only L0. A footnote says the hack sim in src/hack3d/sim is pure logic too, inside the level 5 folder. The legacy engine is reached from L3 through the LegacyScene adapter during migration and is deleted at M8.](diagrams/engine-layers.png)

*Editable source: [diagrams/engine-layers.html](diagrams/engine-layers.html)*

| Level | Folder | Holds | May import |
|---|---|---|---|
| 0 | `src/sje/core/` | `size.ts`, `FixedLoop`, `EventEmitter`, `Rng`, `assert`. No Pixi, no DOM. | nothing |
| 1 | `src/sje/render/` | `GlContext`, `PixiRenderer`, `BackBuffer`, `Presenter`, `GlHandoff`, and the frame textures of the 3D frame. The only code that touches the renderer and raw GL. | level 0 |
| 2 | `src/sje/display/` | `GameObject`s (`View3D` is one), `Camera`, `TextureManager`, Effects. The only code with Pixi scene classes. | levels 0 and 1 |
| 3 | `src/sje/runtime/` | `Game`, `SceneManager`, `Scene`, `Loader`, `Input`, the audio bridge. | levels 0 to 2 |
| 4 | `src/sje/index.ts` | The facade. The only import for game code. | level 3 |
| 5 | `src/sje/three/`, `src/hack3d/` | The lazy 3D chunk: `ThreeHost`, `Frame3D`, `Scene3D`, `HackScene`. The only code that imports `three`. The folder `src/hack3d/` also holds the door (`door.ts`) and the result types (`result.ts`). The shipped game loads these two up front. They reach the chunk only through one `import()`. | `src/sje/three/`: levels 0 to 3. `src/hack3d/`: level 4 and `src/sje/three/` |
| 6 | `src/scenes/`, `src/game/`, `src/field/`, and similar | Game content: scenes, story scripts, field kit, painters, Mark's JSON. | level 4, level 5 by `import()`, and the level 5 files `door.ts` and `result.ts` directly |

## 5. Core primitives

The "Follows" column says which engine the concept comes from. `(ours)` means no engine has the concept, or we changed it on purpose. The "Built" column says when: M1 is the first milestone that needs it, "on demand" means we build it when a ported scene needs it.

| Primitive | What it is | Follows | Built |
|---|---|---|---|
| `Game` | Owns the context, renderer, loop, managers, global events. Created with `await Game.create()`. | Phaser `Game` | M1 |
| `FixedLoop` | Fixed 60 Hz step with a 250 ms clamp and at most 5 catch-up ticks. | Gaffer accumulator, Unity `FixedUpdate`, Godot `_physics_process` | M1 |
| `SceneManager`, `Scene` | A stack of screen states. Each owns its display list, cameras, input, loader, clock, tweens, events. | Phaser | M1 |
| `game.run` | Push a scene. Resolve a promise on `close(result)`. | Godot `await`, Unity `Awaitable` (ours as a whole) | M1 |
| `GameObject` | The unit of the display list. Wraps one Pixi node. | Phaser | M1 |
| `Container`, `Group`, `scene.add.layer()` | Nest and mask children. A pool. A factory for a transform-less list (not a class). | Phaser | `Container` M1, `Group` on demand |
| `ImageObject`, `Sprite`, `Graphics`, `TextObject`, `Zone` | The leaf types. | Phaser | M1 (`Zone` M3) |
| `Camera` | Scroll, zoom, bounds, follow, fade, flash, shake. A transform on the scene's `world` container. | Phaser | M1 |
| `depth` and bands | A number per object. Named bands for the ranges. | Phaser `depth`, Unity Sorting Layer | M1 |
| `filters`, `mask` | Per-object and per-camera GPU effects. | Phaser 4 and Pixi (flat list, a deviation) | M2 |
| `Effect`, `createEffect` | A per-object effect that you build from your own GLSL. | ours | M2 |
| `FxSystem` | Screen effects and particles. Keeps today's `postfx` names and signatures. | ours (keeps today's API) | M2 |
| Scene services: `time`, `tweens`, `events`, `lights` | Clock and timers, tweens, event emitter, light map. All scene-owned. | Phaser | `events` M1, others on demand |
| `TextureManager` | Name-keyed texture store. Accepts generated canvases. | Phaser | M1 |
| `Loader` | Loads PNG and JSON by key. Falls back to code-drawn art. | Phaser, Unity Addressables (bundles) | M1 |
| `ActionMap` | The nine named input actions. | Godot `InputMap`, Unity action maps | M1 |
| `Rng`, `visualRng` | Seeded random streams. Gameplay and visual randomness stay apart. | ours (today's code) | M1 |
| `Display` | Integer scale in device pixels. Pointer mapping. | Unity Pixel Perfect Camera, Godot integer stretch | M1 |
| `size.ts` | The one source of `W` and `H`. | Godot base resolution | M0 |
| `GlHandoff` | The one module that switches between Three, Pixi, and raw GL. | ours | M1b |
| `View3D`, `Frame3D`, `Scene3D` | The 3D mode seen from the 2D side. | Three.js names inside, ours outside | M1b and M7 |

Full tables with Unity, Godot, and Three.js names are in [conventions.md](conventions.md).

## 6. The frame in one diagram


![Engine frame loop. One requestAnimationFrame callback adds elapsed time to an accumulator, clamped to 250 ms. A decision then checks whether the accumulator holds at least 16.67 ms and fewer than 5 ticks have run. If yes, one tick runs (input, game events, game clock, fixedUpdate on scenes top first, camera effects, destroy queue) and the loop returns to the check. The tick writes game state. If no, the draw phase runs: prerender events, state copy into nodes, FxSystem and camera transforms, then the 3D pass if active, Pixi into the back buffer, and present at integer scale. The draw phase only reads state. After the callback, story promises continue as microtasks. The 5th tick drops the backlog.](diagrams/engine-frame.png)

*Editable source: [diagrams/engine-frame.html](diagrams/engine-frame.html)*

The tick changes game state. The draw phase only reads it. Details are in [frame-and-rendering.md](frame-and-rendering.md).

## 7. The render pipeline in one diagram

![The engine render pipeline for one frame, in eight numbered steps. Step 1, prerender copies state into Pixi nodes. Step 2 runs FxSystem.update, camera transforms and CanvasImage.refresh. Step 3 asks whether a 3D session is active. If yes, step 4 lets Three render into a 640x360 nearest render target, with a bloom pass in place, through GlHandoff.beginThree and endThree. If no, the flow skips step 4. Step 5 resets GL state with GlHandoff.beginPixi and pixi.resetState. Step 6 has Pixi draw the screen root into the 640x360 back buffer at resolution 1 with nearest scaling, so all filters run inside it. Step 7, the present, draws one nearest sprite at integer scale k, on a whole device pixel, into a whole-window canvas with void-color bars. Step 8 is postrender and the perf record.](diagrams/engine-render-pipeline.png)

*Editable source: [diagrams/engine-render-pipeline.html](diagrams/engine-render-pipeline.html)*

All filters run at game resolution (640x360). This keeps every game pixel an exact block after the integer upscale. The price is a chunkier blur and glow. At 640x360 a game pixel is 25% smaller on a 1080p screen than at 480x270, so the blur and glow are finer than they were in the first design. This is a look decision for you (E8).

## 8. The 3D mode in short

The 3D mode is a `Scene3D` subclass in a lazy chunk. A story script starts it with `await s.hack(def)`.

1. The engine shares one WebGL2 context between Pixi and Three.
2. Three loads on the first entry.
3. Three draws into a 640x360 render target with nearest filtering.
4. Pixi shows that target as a normal sprite called `View3D`. Filters, masks, blend modes, and tweens work on it.

`s.hack` always returns a value: `success`, `fail`, `aborted`, or `unsupported`. A watchdog ends the scene if the GL context is lost. A canvas-copy path with a second context is the fallback, behind the same `Frame3D` interface. Details are in [frame-and-rendering.md](frame-and-rendering.md) section 7.

This design covers the engine path of the 3D mode only: the split between Pixi and Three, the move from 2D to 3D and back, the fallback, and the freeing of GPU data. A minimal test scene proves the path. The real hacking scene (its design, gameplay and look) is a separate iteration later (`docs/IDEAS.md` entry 2). It is not designed here.

## 9. What is proven and what is not

The key claims passed agent labs on 2026-10-04 (headless Chromium on software WebGL). The lab evidence is in `docs/research/2026-10-04-engine-labs.md`.

The Phase 0 spike then tested them in a real engine kernel, with a battle stage slice, a 3D test scene, and the 480x270 against 640x360 mock. You chose 640x360. Phase 0 then measured every size-dependent exit criterion again at 640x360. The evidence is in `docs/spikes/engine-platform.md`. Phase 0 tested these: the shared context with filters and masks, ten enter and leave cycles, context loss, no WebGL2, and pixel exactness at six device pixel ratios. It also tested stage parity with the Phaser spike at 480x270: 0 pixels differ at 3 frames. The browser answers are in [migration.md](migration.md) section 3.

Still not tested: Safari on macOS, a real GPU context reset, real Blender glTF files, and the look of the field and the lighting.
