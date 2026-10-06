---
type: design
title: "Shadow Jog Engine — Scene graph"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-05
status: approved 2026-10-05 (final). First approval 2026-10-04 (all recommendations). Phase 0 update on 2026-10-05, accepted with all recommendations
tags: [engine, design]
---

# Shadow Jog Engine — Scene graph

This file answers one question: what is the scene graph made of? It starts with a picture of a running scene. Then it lists every node type and the rules for transforms, depth, cameras, roots, and pixels. The last table maps each part to a Pixi v8 object.

> **Read first:** [Three things that look like Phaser and are not](README.md#2-three-things-that-look-like-phaser-and-are-not). Tag meanings are in the "Tags" table at the top of [conventions.md](conventions.md).

---

## 1. A running scene

The engine keeps a tree of `GameObject`s. Each `GameObject` owns one Pixi node. The two trees have the same shape. Game code only touches the first tree. The Pixi tree is for the renderer.

### The field scene

```
Game
 └─ SceneManager stack (bottom to top)
     ├─ FieldScene                       opaque
     │   ├─ cameras.main                 scroll, zoom, bounds, follow, shake
     │   ├─ world  (Container)           moved by cameras.main. The engine parents it under the screen worldRoot
     │   │   ├─ Container "backdrop"     made with scene.add.layer()
     │   │   ├─ Image   map ground       baked 960x672 texture
     │   │   ├─ Container actors         ySort = true
     │   │   │   ├─ Container hero       sorting group
     │   │   │   │   ├─ Image shadow
     │   │   │   │   └─ Sprite body
     │   │   │   └─ Sprite npc ...
     │   │   ├─ Image   map overhead
     │   │   ├─ Image   light map        blend multiply
     │   │   └─ View3D  hack view        only during a hack
     │   ├─ ui (Container)               not moved by the camera. Parented under the screen uiRoot
     │   │   └─ Container hud ...
     │   └─ scene.time, scene.tweens, scene.events, scene.input, scene.load
     └─ DialogScene                      curtain, passUpdate = false
         └─ ui ...
```

### The screen root (shared by all scenes)

![The screen root. The Pixi screen root holds three shared roots, drawn back to front. worldRoot is first and holds the world of each visible scene, such as FieldScene.world, which cameras.main moves. Screen filters run here only. Camera flash and fade draw above the world and below the ui. uiRoot is second and holds FieldScene.ui and DialogScene.ui, with no screen filters and no shake. overlayRoot is last and holds game fade, game flash, notice, and legacy overlays, with no filters. Each scene owns a world and a ui container, and the engine parents them under these roots in stack order.](diagrams/engine-screen-roots.png)

*Editable source: [diagrams/engine-screen-roots.html](diagrams/engine-screen-roots.html)*

Each scene owns a `world` and a `ui` container. The engine parents them under the shared roots in stack order. Section 6 has the rules.

### The battle scene

```
BattleStageScene
 ├─ cameras.main
 ├─ world
 │   ├─ Image    backdrop                 depth BACKDROP
 │   ├─ Container figure (hero or enemy)  sorting group, depth from depthFor()
 │   │   ├─ Image shadow   (PART -0.5)
 │   │   ├─ Image ring     (PART -0.4)
 │   │   ├─ Sprite body    (PART 0)
 │   │   ├─ Image smear    (PART 0.1)
 │   │   └─ Graphics bar   (PART 0.25)
 │   └─ Image    mark (active tag, target, damage numbers)   depth MARK
 └─ ui
     └─ Container hud                      depth HUD, windows are baked textures
```

### The same scene, seen from the Pixi side

| Engine object | Pixi node (private) |
|---|---|
| `Container figure` | `Container` |
| `Sprite body` | `Sprite` with `anchor` set from `origin` |
| `Graphics bar` | `Graphics` |
| `scene.world` | `Container` that holds the camera offset |
| `scene.add.layer()` | `Container` kept at identity |
| `View3D` | `Sprite` over an `ExternalSource` texture |

Game code can reach the Pixi node with `go.node`. Only code under `src/sje` may do this. The dev hook `__SJ__.tree()` prints both trees as JSON, so you can compare them.

---

## 2. Node types

Each class is a `GameObject`. A `GameObject` owns exactly one Pixi node (composition, not subclassing). See E9 in [decisions.md](decisions.md).

| Class | Follows | Pixi v8 backing | Notes |
|---|---|---|---|
| `GameObject` | Phaser (base class, components as mixins) | none | Abstract. Holds `node`, `scene`, `name`, `data`, `active`. |
| `ImageObject` | Phaser `Image` | `Sprite` | One texture or one frame. No animation. The name avoids the DOM global `Image`. `originX`, `originY`, `flipX` and their setters live here, not on `GameObject`. A container or a graphics object has no texture to flip. |
| `Sprite` | Phaser | `Sprite` | Adds `setFrame`. `play` is on demand (E23). Animation is driven by the fixed tick, never by Pixi `AnimatedSprite`. |
| `Container` | Phaser | `Container` | Nestable. May be masked or filtered. Children list is `list`. |
| `scene.add.layer()` | Phaser 4 `Layer` | `Container` kept at identity | Not a class. A factory name only. See the note below. |
| `Group` | Phaser | none | A pool and a set of references. Not displayed. Built on demand. |
| `Graphics` | Phaser | `Graphics` | Phaser `fillStyle(c,a).fillRect(...)` maps to Pixi `rect(...).fill({ color: c, alpha: a })`. The wrapper always uses the object form. 1 px lines are runs of 1 px rectangles (Bresenham). Pixi `pixelLine` is not exact: it leaves out the first pixel of a horizontal or vertical line and puts a diagonal one pixel off. `lineStyle` takes only width 1. |
| `TextObject` | Phaser `Text` | `Sprite` over a cached canvas texture | Draws with the game's own font (`src/engine/font.ts`). Same look as today. The name avoids the DOM global `Text`. |
| `BitmapText` | Phaser | Pixi `BitmapText` | Built on demand. Needs `pixi.js/text-bitmap` (plus 50 to 66 kB gzip). See E14. |
| `NineSlice` | Phaser | `NineSliceSprite` | Built on demand. For window frames. |
| `TileSprite` | Phaser | `TilingSprite` | Built on demand. For scrolling backdrops. |
| `Zone` | Phaser | invisible hit `Container` | Hit area for editors. Can use a CPU pixel-alpha mask. |
| `CanvasImage` | Phaser `CanvasTexture` + `Image` (ours as a class) | `Sprite` over a `CanvasSource` | Owns a canvas and `refresh()`. Used by the `LegacyScene` shell and by per-frame painters. |
| `RenderImage` | Phaser `RenderTexture` | `RenderTexture` + `Sprite` | GPU only. A registry re-bakes it after a context loss. |
| `View3D` | Three.js names inside, ours outside | `Sprite` over an `ExternalSource` | Shows the Three render target. See section 8. It is a `GameObject`, not an `ImageObject`, because it has no texture key. It lives at level 2. |

**About `Layer`.** Phaser 4 `Layer` is a display list with no transform. We have no `Layer` class. `scene.add.layer()` returns a plain `Container` kept at identity. We do not use Pixi `RenderLayer`. Pixi docs say that children attached to a `RenderLayer` skip the filters of their ancestors. Phase 0 tested this on Pixi 8.22 (real GPU and Firefox). A filter on an ancestor does not reach a child that is attached to a layer. A filter on the layer itself does not reach its attached child either. So do not use `RenderLayer` with filters. It stays an internal option only.

**Rule: leaves have no children.** `ImageObject`, `Sprite`, `Graphics`, `TextObject`, and `View3D` refuse `add`. Pixi only logs a warning today and plans a hard error. We obey the rule from day one.

**Build on demand.** The Phaser spike called about 15 display methods and 6 texture methods. We build these first. A class marked "built on demand" waits until a ported scene needs it.

---

## 3. Transforms and parenting

- Position, scale, and rotation are local to the parent, as in Phaser.
- `container.add(child)` and `container.remove(child)` change the parent. The child keeps its local values.
- A child of a `Container` that is destroyed is destroyed too, unless it was removed first.
- `x` and `y` keep the logical value you set. The wrapper writes the rounded value to the Pixi node. See section 7.
- Do not read `worldTransform` from Pixi. It is the identity matrix until the first render. The wrapper computes `getWorldPoint()` itself.

---

## 4. Depth and sorting

**Rule: `depth` is a number. A higher number draws later.** It maps to Pixi `zIndex`. Setting `zIndex` makes Pixi set `parent.sortableChildren`, and the sort runs only when a depth changes. This is the Phaser convention.

Three helpers add the ideas of other engines:

- **`container.ySort = true`** (Godot y-sort). The engine writes `depth = y` for the children at update time.
- **`container.setSortingGroup(true)`** (Unity Sorting Group). All parts of one figure sort together. The spike's PART fractions work inside it. Phase 0 did not build it and did not miss it. Every container already sorts its own children by `depth`, so a plain `Container` with parts of small local depths is a sorting group.
- **Named bands** (Unity Sorting Layers and Order in Layer). One file, `depth.ts`, names the ranges. The values come from the spike where they exist.

| Band | Starting depth | Content | Source of the value |
|---|---|---|---|
| `backdrop` | -1 | Sky, wall, floor art | Spike `BACKDROP` |
| `floor` | set at M3 | Floor decals under the actors | none yet |
| `actors` | 0 to 899,999 | Figures. `depthFor(y, closeness, side, order)` | Spike `config.ts`. The upper end is wider than the first design (299,999) |
| `guide` | 900,000 | Editor guides | Spike |
| `marks` | 1,000,000 | Active tag, target label, damage numbers | Spike `MARK` |
| `fx` | set at M2 | Effect sprites and particles | none yet |
| `hud` | 2,000,000 | HUD windows, in `uiRoot` | Spike `HUD` |
| `overlay` | not a depth | Fade, flash, notice, in `overlayRoot` | ours |

The spike formula stays: `depth = y*1000 + closeness*2 + side + order*1000`. At 360 rows a figure on the bottom row needs up to 361,641, which is over the first limit of 299,999. So the `actors` band runs to 899,999, just under `guide` at 900,000. The unit test of the band (`tests/sje-display.test.ts`) moves with it. The part offsets stay: shadow -0.5, ring -0.4, body 0, smear 0.1, bar 0.25.

**Deviation from Unity.** Unity sorts across the hierarchy. We sort siblings inside a container. Reason: a filter or mask on a `Container` must apply to its children.

---

## 5. Cameras

Pixi has no camera. The engine builds one (Phaser's `Camera` API on a transform).

- Each scene has `cameras.main`. It moves that scene's `world` container: `world.position = -round(scroll)`. It never moves another scene's `world`.
- `cameras.ui` `(ours)` is the camera of the scene's `ui` container. It exists so UI code can use the same `Camera` API (for example `fade`). It never scrolls, shakes, or zooms.
- **Scroll factor.** Phaser accepts any number. A value above 1 gives foreground parallax. We allow only 0 and 1 `(ours)`. The spike used only these two.
  - The route for a HUD is `scene.add.layer({ ui: true })` (primary). The container goes into `scene.ui`.
  - `setScrollFactor(0)` is allowed only on a top-level child of a scene. The engine then moves the object into `scene.ui` and keeps its `x` and `y`. `setScrollFactor(1)` moves it back.
  - On a nested child, `setScrollFactor(0)` throws in dev builds. Moving a nested child would break its parent's transform, mask, and sort order.
- Camera scroll is always rounded to whole pixels. Phaser's `safeAuto` vertex rounding has no Pixi equivalent, so the camera does the rounding.
- Camera effects: `fade`, `flash`, `shake`, `pan`, `zoomTo`. These are Phaser names. The arguments differ, see below. `fade` and `flash` draw a rectangle above the scene's `world` and below its `ui`. So they wash the world only, as today.
- One world camera per scene in v1. Multi-viewport cameras and `ignore()` lists are not built. The game does not need them.
- Cameras can carry `filters`, as in Phaser 4.

| Method | Phaser signature | Our signature | Tag |
|---|---|---|---|
| `fade` | `fade(duration, r, g, b, ...)` | `fade(ms, color?)` with a CSS color string | ours |
| `flash` | `flash(duration, r, g, b, ...)` | `flash(ms, color?)` | ours |
| `shake` | `shake(duration, intensity, ...)` with intensity as a fraction of the view | `shake(ms, magnitudePx)` in pixels | ours |

Today's `game.shake(frames, mag)` and `game.flash()` stay as aliases. They act on every running scene's main camera. They honour `shakeScale` and `flashScale`.

---

## 6. Roots: world, UI, overlay

The word "root" has two levels here.

- **Per scene.** Each scene owns `scene.world` and `scene.ui` (`sys.world`, `sys.ui`). `cameras.main` moves `world` only.
- **On the screen root.** The Pixi root is the "screen". It has three shared roots. The engine parents every visible scene's containers under them, bottom scene first.

| Shared root | Content | Screen filters | Moved by camera |
|---|---|---|---|
| `worldRoot` | The `world` container of each visible scene | yes | no (each scene's own camera moves its own `world`) |
| `uiRoot` | The `ui` container of each visible scene | no | no |
| `overlayRoot` | Game fade, game flash, notice, legacy overlays | no | no |

("Screen" here means the Pixi root. The word "stage" in these docs always means the battle stage.)

Scene flags keep their meaning from today's engine (`src/engine/game.ts`, `render`):

- `opaque`: scenes below are set invisible. They stay alive and are not drawn.
- `passUpdate`: scenes below keep running `fixedUpdate`. Without it they are paused. A paused scene is still drawn unless it is hidden. This is Phaser's `pause`.
- `curtain`: only the topmost curtain scene draws over the world base. Scenes between the opaque base and that curtain are hidden. The engine does not repaint them.
- Every scene above the opaque base puts both its `world` and its `ui` under `uiRoot`. So the screen filters do not touch it.

The M1 gate adds a Vitest case for the curtain rule. It ports "draws only the topmost curtain" from `tests/game.test.ts`.

---

## 7. Pixel snapping rules

Whole-pixel positions are a hard constraint. We call the rule **snap to pixel** (Godot `snap_2d_transforms_to_pixel`). It has one name in `GameObject` and in `Camera`.

1. **Round at the wrapper.** `x` and `y` keep the logical value. The wrapper writes `Math.round` to the Pixi node. Exact `.5` positions are unreliable on the GPU. An 8x8 sprite at 40.5 drew 72 pixels in the lab.
2. **The origin offset is a whole number of pixels.** The wrapper checks that `origin * texture size` is a whole number. If it is not, the wrapper rounds the origin and logs one warning in dev. The spike's feet data already gives whole numbers. For an odd-sized picture at origin 0.5, the engine rounds `origin * size` half up, and Phaser rounds the vertex instead. Such a picture would probably sit one pixel left of the spike's. This comes from the two rules and was not measured, because no picture in the Phase 0 slice has an odd size.
3. **Camera scroll is rounded.**
4. **Renderer `roundPixels` is off.** Snap to pixel puts every position on a whole pixel first. So Pixi's own rounding changes no pixel in these cases (proof: `tests/sje-display.test.ts` for the arithmetic, and `e2e/sje-parta.spec.ts`, which draws the real renderer twice, with the option off and on):
   - Scale 1, 2 and -1 (240 pictures of even and odd size, at any logical position).
   - A 1.5x scale of a picture with a whole scaled size (a 16 pixel picture).
   - The children of a 2x parent: whole children, children at a fractional logical position, odd-sized pictures, and a snap-off child at x.3.

   It does change pixels in these cases. Neither setting puts the picture on one pixel grid there:
   - A 1.5x scale of an odd-sized picture (an 11x9 picture changed 29 pixels).
   - A snap-off node at a half pixel (at x 40.5 the picture moves one pixel, 272 pixels).
   - A snap-off child of a 2x parent at a quarter pixel (544 pixels at x 24.25).
   - The 1.09x push of the whole world, which is the battle camera (99 pixels on a GPU, 128 on SwiftShader). The texel sizes are uneven at 1.09x with either setting.

   An edge exactly half way is a tie. A tie depends on the renderer, so it is never safe in either direction. A GPU computes the edge in floating point first, so the exact-arithmetic model and the real renderer can disagree. The renderer check is the authority. Do not rely on a tie.

   Pixi's own rounding changed nothing on a GPU in the sprite mask case. On SwiftShader it lost a strip of pixels where a sprite mask crosses overlapping objects. A bare Pixi app shows the same loss. M3 decides what the battle push may do.
5. **Opt out per object.** `setPixelSnap(false)` allows smooth motion. `View3D` does not use it. The 3D target sits on the same pixel grid as every 2D object, and a fractional position would smear it.
6. **Nearest filtering.** The engine sets `TextureStyle.defaultOptions.scaleMode = 'nearest'` before any texture exists. Pixi's default is `linear`. The built-in `Texture.WHITE` and `Texture.EMPTY` stay linear. The crispness test has an allow-list for them.
7. **Mixed grains.** The battle mixes layers shown at 2x with full-size layers. At 640x360 grain 2 is 320x180 and grain 4 is 160x90. At 480x270 grain 2 was 240x135. A mixed-grain layer is authored at 320x180 or 160x90. Nobody scales a 240x135 layer by 2.667 to fit. `container.setGrain(2)` `(ours)` makes a container with scale 2, positioned in the coarse grid. Nearest filtering and integer positions keep it crisp. Phase 0 did not build `setGrain` and did not use it. It baked the world layer at 2x into the stage picture on a canvas, as the Phaser spike does. M3 decides between the bake and `setGrain`. Phase 0 tested what a 2x parent does to the pixels of its children (point 4): whole children, children at a fractional logical position and odd-sized pictures stay whole. The battle push camera (up to 1.09x) is a nested scaled container too. It changes pixels with either rounding setting (point 4).

### Origin and flip

- **Origin is 0.5 by default (Phaser).** Pixi's default anchor is (0,0). A port without a fix moves every sprite by half its size. The wrapper always sets `anchor = origin` on every leaf.
- **Flip follows Phaser.** Phaser flips about the middle of the texture. The wrapper sets `scale.x = -abs(scaleX)` and `anchor.x = 1 - originX`. This reproduces Phaser's picture, so the spike's `mirrorFigure` maths (`foot.x = w - foot.x`) stays valid.
- **Tested in Phase 0:** this flip rule with a negative scale. 60 combinations give 0 pixels of difference from Canvas 2D. They cover widths 8, 9, 15 and 16, origins 0, 0.5 and 1, an own negative scale, `flipX`, a mirrored parent, and both axes. This holds when the origin lands on a whole pixel, which the engine forces. The punk of the stage slice, flipped with the anchor rule, also has 0 differing pixels. The results hold with `roundPixels` off.

---

## 8. The 3D view as a node

`View3D` is a `Sprite` whose texture wraps the Three render target. To the display list it is an ordinary object.

- It can sit in any scene's list, not only in a `Scene3D`. Example: a field overlay, or a dialog over a hack.
- A filter, mask, blend mode, or tween works on it. An iris wipe is a `Graphics` mask on the `View3D`.
- Allowed blend modes over 3D pixels: `normal`, `add`, `multiply`, `screen`, `min`, `max`. Advanced modes such as `overlay` cannot see Three's pixels. The type `SjBlend` blocks them.
- Phase 0 tested a built-in filter, a custom GLSL filter, a `Graphics` mask and a sprite (alpha) mask on the `View3D`. All four are exact within 1/255. See [frame-and-rendering.md](frame-and-rendering.md) section 6.4.

---

## 9. Hit areas for editors

Pixi events need `eventMode`, bounds, and an import that starts its own ticker. The shipped game needs none of this. So pointer input exists only in dev and editor builds.

- `Zone` is an invisible hit area. `go.setInteractive({ hitArea })` is dev only.
- `scene.pick(x, y)` returns the top object under a point. It walks by depth, as the spike's `pick` does. It reads pixel alpha from CPU data kept in the texture's `data` bag. This replaces Phaser's `getPixelAlpha`.
- Pointer coordinates come from `game.scale.toGame(clientX, clientY)`. Pixi gives fractional global coordinates, so the editor rounds them.
- The Battle Stage Editor never touches a Pixi object. It reads about 10 `Fighter` fields and calls about 13 scene methods. It attaches through a `StageView` interface. See [tooling-and-testing.md](tooling-and-testing.md).

---

## 10. Mapping to Pixi v8

| Concept | Phaser call | Pixi v8 | Wrapper rule |
|---|---|---|---|
| Add an image | `scene.add.image(x, y, key, frame)` | `new Sprite(texture)` | Set `anchor` from `origin`. Round the position. |
| Origin | `setOrigin(x, y)` | `sprite.anchor.set(x, y)` | Always set. Pixi default is (0,0). |
| Frame | `setTexture(key, frame)` | `sprite.texture = cellTexture` | One cached `Texture` per cell. One source. |
| Depth | `setDepth(n)` | `zIndex` | Pixi sets `sortableChildren` on the parent. |
| Flip | `setFlipX(b)` | `scale.x`, `anchor.x` | Phaser maths, see section 7. |
| Blend | `setBlendMode(ADD)` | `blendMode = 'add'` | Only fixed-function modes. |
| Container | `add.container()` | `new Container()` | `destroy({ children: true })` removes the tree. |
| Graphics fill | `fillStyle(c,a).fillRect()` | `g.rect(x,y,w,h).fill({ color: c, alpha: a })` | Rects and 1 px lines only in v1. The two-argument form `fill(color, alpha)` is deprecated in 8.22 and warns. |
| Nearest filter | `texture.setFilter(NEAREST)` | `source.scaleMode = 'nearest'` | Set as the global default. |
| Scroll factor | `setScrollFactor(0)` | the scene's `ui` container | Only 0 and 1. Top-level children only. |
| Camera | `cameras.main.setScroll` | position of `scene.world` | Rounded. |
| Mask | `go.filters.internal.addMask(obj)` (needs `enableFilters()`) | `container.mask` | Our flat `go.filters.addMask(obj)`. Graphics masks use the stencil buffer. One mask for each object. A sprite mask reads alpha. |
| Filters | `go.filters.internal.add(filter)` or `.external.add(filter)` (needs `enableFilters()`) | `container.filters` | Our flat `go.filters.add(effect)`. Custom filters pass a vertex and a fragment. |
| Texture bag | `texture.customData` | none | `TextureManager` keeps a `data` bag per key. |
| Pixel alpha | `getPixelAlpha(x, y, key)` | none | CPU pixels in the `data` bag. |
| Canvas texture | `textures.addCanvas(key, canvas)` | `CanvasSource` | `skipCache`. `source.update()` on change. `destroy(true)` once per source. |

Three Pixi facts that cause silent bugs:

1. `Texture.from(canvas)` caches by the canvas object unless you pass `skipCache`. The `TextureManager` always avoids the global cache.
2. `texture.destroy()` leaves the source alive. Frame textures share a source. Destroy the source once, after the frames.
3. A sprite changes its texture by assignment. A frame is a separate `Texture` with its own `Rectangle`.

---

## 11. Lights

`scene.lights` `(ours: the name is Phaser's, the behaviour is not)` holds an ambient color and point lights. It draws additive radial sprites into a camera-sized `RenderTexture`. It shows the result as one sprite with `blendMode = 'multiply'` above the world.

Today's field lighting uses per-sprite scratch canvases (`copy`, `multiply`, `destination-in`). These have no one-to-one Pixi form. The first version uses the global light map plus a second, weaker multiply for sprites (today's 0.32 boost). The look is an approximation. **You must approve it in the M5 review (E20).**

A future `Look` (Unity URP Volume Profile idea) is an optional name for the data presets in `src/data/fx.json`. Do not build it before you ask for it.

---

## 12. UI and HUD

The engine has no layout system. This is on purpose.

- UI objects use absolute positions in `size.ts` coordinates (640x360). UI layouts are authored for 640x360. They are not scaled from 480x270.
- Named anchors (`W/2`, margins, safe edges) live in one file, `ui/layout.ts`. It is required now, not proposed. The HUD and every new layout take their anchors from `W` and `H`. A later change of size then touches one place. The Phase 0 mock shows why. The 3D HUD anchors its NODE panel to the right edge (`W - 6 - 78`), so it followed the size with no change. The caption bar was placed by numbers for 270 rows, so at 640x360 it floats at row 253 of 360.
- Windows are baked textures (today's `drawWindow`). A `NineSlice` is built on demand.
- `ListMenu` and the cursor are helper classes made of `Container`s. They are not engine primitives. They arrive with M4, on demand.
- A HUD lives in `scene.ui`, or in `scene.add.layer({ ui: true })`. It does not move with the camera.

---

## 13. Why there is no ECS

You asked whether we should follow Unity. The short answer: not for the display side.

- The battle engine in `src/battle` already plays the "data plus systems" role. It is pure and DOM-free.
- The display side has dozens to a few hundred objects, not thousands.
- Phaser's class and mixin model already fits Pixi's `Container` and leaf split.
- An ECS or a Component model adds concepts that no current scene needs. See E1.
