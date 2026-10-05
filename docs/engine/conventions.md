---
type: design
title: "Shadow Jog Engine — Conventions"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-04
status: draft for Mark's approval
tags: [engine, design]
---

# Shadow Jog Engine — Conventions

You asked: "Are we following established conventions?" This file answers it. It lists each concept with the name in Phaser, Unity, Godot, and Three.js, and the name we use. The last column says why.

> **Three things that look like Phaser and are not.** (1) `fixedUpdate(tick)` runs at a fixed 60 Hz. There is no variable-delta `update`. (2) `game.run(scene)` waits for `close(result)`. (3) Pixi has no camera. The engine builds one.

**The rule.** Copy Phaser first. Use Unity or Godot only where Phaser has no concept. Use Three.js names inside the 3D mode. Tag every borrowed or invented name in the docs and in JSDoc.

**Tags.** All the other docs use these tags.

| Tag | Meaning |
|---|---|
| No tag | The name and the behaviour come from Phaser 4. |
| `(ours)` | No engine has this name or behaviour, or we changed it on purpose. |
| `(deviation)` | The name is Phaser's. The behaviour is not. |
| `on demand` | We build it only when a ported scene needs it. |

In code comments the tags are `// ours`, `// deviation`, and `// on demand`.

**Source quality.** Phaser, Pixi, and Three.js facts were checked against installed source (Phaser 4.2.1, Pixi 8.22.0, Three 0.186). Godot and Unity facts come mostly from their official docs read through a page summarizer. Quote the Unity numbers (for example the `FixedUpdate` default step) from the manual before you rely on them.

---

## 1. The convention table

"—" means the engine has no such concept. The bold text in the "Shadow Jog" column is the name we use.

### Boot, loop, and scenes

| Concept | Phaser | Unity | Godot | Three.js | Shadow Jog | Why |
|---|---|---|---|---|---|---|
| Top object | `Game` | player loop | `SceneTree` | — | **`Game`** | Phaser. Created async because Pixi init is async. |
| Fixed-rate simulation | Arcade physics only | `FixedUpdate` | `_physics_process` | — | **`FixedLoop`**, hook `fixedUpdate(tick)` | Phaser's main loop is variable. The game needs a fixed step (Gaffer accumulator). |
| Step events | `PRE_STEP`, `STEP`, `POST_STEP` once per frame | — | — | — | **`prestep`, `step`, `poststep` once per tick** | Phaser names. Per-tick timing is a deviation. |
| Render events | `PRE_RENDER`, `POST_RENDER` | — | — | — | **`prerender`, `postrender`** | Phaser names, per frame. |
| Screen state | `Scene` | Scene (level file) | Scene (node tree) | `Scene` (root `Object3D`) | **`Scene`** | Phaser. Today's code uses it. See the glossary below. |
| Scene lifecycle | `init`, `preload`, `create`, `update` | `Awake`, `Start`, `Update` | `_ready`, `_process` | — | **`init`, `preload`, `create`, `fixedUpdate`** | Phaser, with one rename (E2). |
| Scene operations | `ScenePlugin`: `start`, `launch`, `run`, `pause`, `resume`, `sleep`, `wake`, `stop`, `switch` | `LoadSceneMode` Single or Additive | `change_scene_to_*` | — | **Phaser names, queued to the next step** | Phaser. |
| Awaitable scene | — (`run` does not wait) | `Awaitable` | `await` on a signal | — | **`game.run(scene): Promise<R>`** `(ours)` | Story scripts depend on it. |
| Scene-owned systems | `InjectionMap`: `add`, `cameras`, `input`, `load`, `time`, `tweens`, `events` | components | child nodes | — | **Same property names on `Scene`** | Phaser. Everything dies with the scene. |
| Modal scenes | pause the scene below, `run` the modal | `Additive` load | child scene | — | **`opaque`, `curtain`, `passUpdate`** `(ours)` | These are today's flags. Phaser has no one-to-one form. |

### Display tree

| Concept | Phaser | Unity | Godot | Three.js | Shadow Jog | Why |
|---|---|---|---|---|---|---|
| Base object | `GameObject` with mixin components | `GameObject` + `Transform` | `Node`, `CanvasItem` | `Object3D` | **`GameObject`** | Phaser. Pixi's `Container` and leaf split matches it. |
| Group of children | `Container` | child `Transform`s | `Node2D` | `Group` | **`Container`** | Phaser. |
| Display list with no transform | `Layer` (a GameObject since 4.1.0) | Sorting Layer | `CanvasLayer` (has a transform) | `Layers` (bit mask) | **`scene.add.layer()`** returns a `Container` at identity `(deviation)` | Phaser's factory name. We have no `Layer` class. The other four engines mean different things. |
| Pool | `Group` | `ObjectPool` | — | — | **`Group`**, plus `Pool<T>` `(ours)` | `Group` is Phaser's. `Pool` is Unity's idea for hot objects. Both on demand. |
| Image, sprite | `Image`, `Sprite` | `SpriteRenderer` | `Sprite2D` | `Sprite` | **`ImageObject`, `Sprite`** | Phaser. `Image` and `Text` shadow DOM globals, so they get a suffix (E7). |
| Origin | `setOrigin` (0.5 default) | `pivot` | `centered`, `offset` | — | **`setOrigin`, 0.5 default** | Phaser. The spike's data uses it. Pixi's anchor is (0,0). |
| Flip | `setFlipX` (about the texture middle) | `flipX` | `flip_h` | `scale.x = -1` | **`setFlipX`, Phaser maths** | The spike's `mirrorFigure` depends on it. |
| Text | `Text`, `BitmapText` | `TextMeshPro` | `Label` | — | **`TextObject`** over the game's own font | Same look as today. No extra bytes. |
| Hit area | `Zone`, `setInteractive` | `Collider2D` as a trigger | `Area2D`, `Control` | `Raycaster` | **`Zone`** | Phaser. Dev and editor builds only. |
| Canvas texture | `CanvasTexture`, `textures.addCanvas` | `RenderTexture` | `ImageTexture` | `CanvasTexture` | **`CanvasImage`, `textures.addCanvas`** | Phaser. All generated art is canvas-based. |

### Sorting, camera, snap

| Concept | Phaser | Unity | Godot | Three.js | Shadow Jog | Why |
|---|---|---|---|---|---|---|
| Draw order | `depth` | Sorting Layer, Order in Layer | `z_index` | `renderOrder` | **`depth`** | Phaser. The spike uses one number per object. |
| Named order ranges | — | Sorting Layers | `CanvasLayer` index | — | **Bands in `depth.ts`** `(ours)` | Replaces magic numbers. |
| Sort a figure as one | — | Sorting Group | `y_sort_enabled` + children | — | **`setSortingGroup`, `ySort`** | Unity and Godot ideas, as Container helpers. |
| Camera | `Camera` | Camera, Cinemachine | `Camera2D` | `Camera` (an `Object3D`) | **`Camera`** | Phaser API. Pixi has none. |
| Camera effects | `fade`, `flash`, `shake`, `pan`, `zoomTo` | Cinemachine impulse | — (no built-in shake) | — | **Same names, our arguments** `(deviation)` | See scene-graph.md section 5. |
| HUD not moved by the camera | `setScrollFactor(0)` | Screen Space overlay | `CanvasLayer` | — | **`scene.add.layer({ ui: true })`** (primary), `setScrollFactor(0)` on top-level objects, and `scene.ui` | Phaser name. Only 0 and 1 are allowed. |
| Whole-pixel positions | `roundPixels`, `pixelArt` | Pixel Perfect Camera snapping | `snap_2d_transforms_to_pixel` | — | **"snap to pixel", `setPixelSnap`** | One name, one rule. Godot's name. |
| Integer scale | `ScaleManager`, `pixelArt` | Pixel Perfect Camera | integer stretch mode | — | **`Display`** | Phaser class name, Unity behaviour. |

### Effects and rendering

| Concept | Phaser | Unity | Godot | Three.js | Shadow Jog | Why |
|---|---|---|---|---|---|---|
| Per-object effect | `filters.internal` and `filters.external`, after `enableFilters()` (4.0) | material, shader | `material` | `ShaderMaterial` | **`filters`**, a flat list `(deviation)` | Phaser 4 and Pixi use the same word. Our list is flat and needs no `enableFilters()`. |
| Mask | `Mask` filter: `filters.internal.addMask(...)` (4.0) | `SpriteMask` | `clip_children` | stencil | **`filters.addMask`**, flat `(deviation)` | Phaser 4 idea. |
| Whole-scene effect | camera `filters` | URP Volume | `WorldEnvironment` | `EffectComposer` | **`FxSystem`** `(ours)` | Keeps today's `postfx` names and `fx.json`. |
| Effect presets as data | — | Volume Profile | `Environment` resource | — | **`fx.json`**. Optional future name: `Look` | Unity idea, only if you ask. |
| Lights | `Lights` plugin | 2D Lights | `Light2D` | `Light` | **`scene.lights`** `(deviation)` | Phaser name. Behaviour is a multiply light map. |
| Render to texture | `RenderTexture` | `RenderTexture` | `SubViewport` | `WebGLRenderTarget` | **`RenderImage`**. The Three side keeps its name. | Phaser name on the 2D side. |

### Services

| Concept | Phaser | Unity | Godot | Three.js | Shadow Jog | Why |
|---|---|---|---|---|---|---|
| Clock, timers | `Clock`, `delayedCall`, `addEvent` | coroutines, `Invoke` | `Timer` | `Timer` (`Clock` is deprecated) | **`scene.time`** | Phaser. Milliseconds at the API. |
| Tweens | `TweenManager` | DOTween (third party) | `Tween` | — | **`scene.tweens`** | Phaser. |
| Timeline | `scene.add.timeline` | Timeline asset | `AnimationPlayer` | `AnimationMixer` | **`scene.add.timeline`** | Phaser. Not the Unity data asset. |
| Events | `EventEmitter`: `on`, `once`, `off`, `emit` | `UnityEvent` | `Signal` | `EventDispatcher` | **`EventEmitter`**, plus `Signal` on demand | Phaser names. Godot "call down, signal up" as a rule. |
| Global data | `registry`, `DataManager` | `PlayerPrefs`, static | autoload | `userData` | **`registry`**, engine values only | `GameState` stays in `state.ts`. |
| Input | keys, pointers, gamepad plugin | Input System Action Maps | `InputMap` | — | **`ActionMap`** `(ours)` | Phaser has no action map. The nine actions exist today. |
| Input context | — | Action Map enable and disable | input propagation | — | **`input.context`** `(ours)` | Stops parallel scenes taking keys. |
| Loader | `Loader`, `CacheManager`, `TextureManager` | Addressables | `ResourceLoader` | `LoadingManager` | **`scene.load`, `cache`, `textures`**, and `bundle()` `(ours)` | Phaser, with Unity's named bundles for the lazy 3D chunk. |
| Audio | `SoundManager` | `AudioMixer` | `AudioServer` buses | `Audio`, `AudioListener` | **`game.audio`** over the existing synth | The synth stays. Named buses later, from Godot. |
| Reusable object tree | — | Prefab | `PackedScene` | — | **Not provided** | No current scene needs it. If we add it, call it "prefab". |
| Behaviour | scene code, subclasses | `MonoBehaviour` components | node scripts | `Object3D` subclasses | **Scene code and small subclasses** | E1. |

### 3D mode

| Concept | Phaser | Unity | Godot | Three.js | Shadow Jog | Why |
|---|---|---|---|---|---|---|
| 3D scene | — | Scene | `Node3D` tree | `Scene` + `Object3D` | **`Scene3D`** owns a Three `Scene` | Three names stay unchanged inside. |
| 3D camera | — | Camera | `Camera3D` | `PerspectiveCamera` (looks down -Z, Y up) | Three's | Three docs apply. |
| Free GPU data | — | `Release` | `free` | `dispose()` | `dispose()` | Removing an object does not free GPU memory. |
| 3D view in 2D | — | `RenderTexture` on a camera | `SubViewportContainer` | `WebGLRenderTarget` | **`View3D`**, `Frame3D` `(ours)` | Pixi shows the target as a sprite. |

---

## 2. Glossary of name collisions

| Word | Ruling |
|---|---|
| Scene | Ours means a whole screen state on the stack (Phaser, and today's code). Not Unity's level file. Not Godot's reusable subtree. Write "Three Scene" for the Three.js root. |
| run | `game.run(scene)` waits. Phaser's non-waiting forms are `game.scene.launch`, `pause`, `resume`, `sleep`, `wake`, `stop`. |
| Layer | We have no `Layer` class. `scene.add.layer()` returns a `Container` kept at identity (Phaser 4 `Layer` is a display list with no transform). Pixi `RenderLayer`, Godot `CanvasLayer`, Unity Sorting Layer, and Three `Layers` are different things. We do not export them under this word. In these docs, code groups are "levels" and the three screen containers are "roots". |
| stage, screen | "Stage" always means the battle stage (`BattleStageScene`, the Battle Stage Editor). The Pixi root container is the "screen root". "Screen filters" run on it. |
| step, tick, frame | A "tick" is one 60 Hz simulation step. A "frame" is one drawn picture. A "milestone" (M0 to M8) is a build step. The `step` event fires once per tick. Today's `frame` counter is the `tick`. |
| tier, fx level | "Tier" means a test tier (T0 to T3). The effect setting is the "fx level" (`full`, `lite`, `none`). |
| view | Only `View3D` and `StageView` use "view". Code that copies state into nodes is "state copy" in the `prerender` event. |
| 3D mode | The feature in prose. `HackScene` is its first scene. A "3D session" is one run. |
| Timeline | Ours is Phaser's `scene.add.timeline`. Not a Unity data asset. |
| pivot, origin | `setOrigin` (0 to 1, default 0.5) sets Pixi `anchor`. It is not Pixi's `container.pivot` (pixels). |
| prefab | Unity's word. We do not use "scene" for a reusable tree. |
| update | There is no `update`. The hook is `fixedUpdate`. Events named `update` fire per tick. |
| Image, Text | The classes are `ImageObject` and `TextObject`. The factory is `scene.add.image(...)` and `scene.add.text(...)`. |

---

## 3. Deviations from Phaser

Every behavioural deviation in one list. E22 asks you to accept it. There are sixteen.

1. `fixedUpdate(tick)` at a fixed 60 Hz replaces `update(time, delta)`. `update` is a compile error.
2. `game.run` waits. Phaser's `ScenePlugin.run` does not.
3. One world camera plus a ui camera per scene. No viewports. No `ignore()`.
4. Scroll factor is 0 or 1 only, and 0 works on top-level objects only. Phaser accepts any number.
5. `filters` is a flat list and needs no `enableFilters()`. Phaser 4 has `filters.internal` and `filters.external`. We accept `filters.internal`, but it runs as external.
6. Camera `fade`, `flash`, and `shake` take our arguments.
7. Step events fire per tick, not per frame.
8. `scene.lights` draws a multiply light map. It is not Phaser's normal-map lighting.
9. Durations are milliseconds at the API and whole ticks inside. `game.wait(frames)` stays in frames.
10. `create` runs at once when nothing needs loading. See frame-and-rendering.md section 2.
11. `scene.add.layer()` returns a `Container` kept at identity. Phaser 4 `Layer` is a class. The `{ ui }` option is ours.
12. Animation uses the fixed tick, never Pixi `AnimatedSprite`.
13. Phaser `customData` is called `data`.
14. Pointer input and `setInteractive` exist only in dev and editor builds.
15. `Graphics` is a subset: rects and lines only in v1.
16. `Sprite extends ImageObject`. In Phaser, `Sprite` and `Image` are siblings.

**Additions from other engines or from us.** These are new names, not deviations. They are tagged `(ours)` or with their source.

- `container.ySort` (Godot y-sort) and `container.setSortingGroup` (Unity Sorting Group).
- `container.setGrain` for mixed-grain layers `(ours)`.
- Depth bands in `depth.ts` (Unity Sorting Layers).
- `setPixelSnap` and "snap to pixel" (Godot `snap_2d_transforms_to_pixel`).
- `Pool<T>` (Unity `ObjectPool`).
- `ActionMap` and `input.context` (Godot `InputMap`, Unity action maps).
- `Cancelled`, `scene.signal`, `scene.time.wait`, `game.waitMs`, and `Signal` `(ours)`.
- `Loader.bundle()` (Unity Addressables idea).

## 4. Phaser APIs we do not implement

These are absent from the types. Using one is a compile error. Add one only when a ported scene needs it, and update this list.

- `anims` (the `AnimationManager`), `physics` (Arcade, Matter), `sound` (Phaser's sound manager), `Phaser.Math`, `Phaser.Geom`.
- Fractional scroll factors, multi-camera `ignore()`, camera viewports.
- Particle emitters (`FxSystem` replaces them), `postFX`, and the Phaser 3 FX and `BitmapMask`.
- Phaser `Text` built on the browser's text engine (we draw with the game's font).
- `scene.make` (the creator), `DataManager` on every object, `InjectionMap` plugins. These are on demand.
- Variable-delta `update`.

Agents write Phaser from memory, and most of that memory is Phaser 3. The reference for Phaser 4 is the installed package in the spike checkout (`shadow-jog-phaser/node_modules/phaser`, 4.2.1). The engine skill says so.

---

## 5. Naming rules for files and classes

These follow the repo's existing style (`fieldmap.ts`, `battlebg.ts`, `postfx.ts`, `stagescene.ts`).

**Files and folders**

- File names are lowercase with no separators: `gameobject.ts`, `scenemanager.ts`, `texturemanager.ts`. A folder groups a layer part: `src/sje/render/`, `src/sje/display/`.
- One main class per file. The file name is the class name in lowercase.
- Tests live in `tests/` and match the file: `tests/texturemanager.test.ts`. E2E specs live in `e2e/`.
- Folders map to code levels: `core/`, `render/`, `display/`, `runtime/`, `three/`. The facade is `src/sje/index.ts`.

**Classes and members**

- Classes use PascalCase. Members use camelCase.
- No `Sj` prefix on classes. The only prefix is the dev hook `__SJ__`. Two classes carry a suffix because of DOM globals: `ImageObject` and `TextObject`.
- Phaser factory names stay lowercase: `scene.add.image(...)`.
- Setters start with `set` and return `this`: `setDepth(5)`.
- Constants use UPPER_SNAKE: `TICK_MS`, `FAULT_LIMIT`.
- Events are lowercase strings in a typed map: `'prerender'`, `'shutdown'`.
- Time arguments carry the unit in the name when it is not milliseconds: `waitFrames`, `delayTicks`. The method `game.wait(frames)` is the one old exception.
- Engine-only escape hatches carry an `@internal` JSDoc tag. They live under `src/sje`.

**Docs and comments**

- Every borrowed name carries its source in JSDoc: `/** Phaser: Camera.fade. */`.
- Every name we invented or changed carries `(ours)` or `(deviation)` in the docs and `@ours` or `@deviation` in JSDoc.
- Comments follow the repo rule: explain why, for a reader who is new to the platform.
