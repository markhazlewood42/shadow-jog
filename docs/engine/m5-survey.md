---
type: plan
title: "Shadow Jog Engine — M5 survey of the field"
project: shadow-jog
created: 2026-10-10
updated: 2026-10-10
tags: [engine, m5, survey, field]
---

# M5 task 1: what the field calls, what animates, what a map holds

Written by Builder A before any engine code, for Builder B (field stage, lights, weather, seam) and Builder C (parity, docs). Every number below was counted on branch `engine-m5-field` on 2026-10-10. Part of [m5-brief.md](m5-brief.md).

## 1. Corrections to brief section 2

| Brief said | The code says | Effect |
|---|---|---|
| The field is "about 8,500 lines" | 6,650: `field.ts` 833, `fieldkit/` 1,022, `src/field/` 4,795 | Smaller port than the risk section assumes. The painters in `src/field` (props 1,841, tiles 952, buildings 608) stay as they are. |
| `fieldkit/` is "about 1,850" | 1,022 (the listed files add to 1,010, plus `void.ts` 12) | Same. |
| "15 maps (6 files plus 9 interiors, 1,776 lines)" | 15 maps is right. 6 map modules define them (`annex.ts` holds `annex` and `dock`; `interiors.ts` holds 9). The directory is 1,776 lines because it also holds `grid.ts` (35) and `index.ts` (32); the 6 map modules are 1,709 | Wording only. |
| "Fifteen maps import from `src/data/maps`, plus `save.ts`, ... and 14 tests" | The maps do not import `src/data/maps`. They import `field/types`, `./grid`, `../looks`, `story/chapter1`, and (interiors only) `game/script`. **Eight source files import the registry**: `field.ts`, `game/save.ts`, `scenes/mapview.ts`, `scenes/placemap.ts`, `art/drawn.ts`, `art/rig2/npcs.ts`, `dev/devmenu.ts`, `dev/artswap.ts`. **Ten test files** (`balance`, `battle`, `content`, `dialog-wrap`, `economy`, `layout`, `maps`, `music`, `pacing`, `popins`) plus the helper `tests/mapgraph.ts`. Two scripts (`scripts/pixellab/render-current.mjs`, `render-maps.mjs`) | Task 4 has 8 + 10 callers to keep green, not 5 + 14. All of them go through `getMap` and `mapIds`, so the registry (`index.ts`) can stay as the one door. |
| "It caches by a signature of patches, props and lights" | The key is the map id plus one bit per `patches`, `props` and `lights` entry that has a `when` (`field.ts` `loadMap`, line 46). It is the flag state that bakes differently, not a hash of the content | The loader must give `when` predicates that are pure functions of `state.flags`, as they are today. Joined predicates are called through the same property, so the key does not change. |
| Water shimmer "has no named module" | It is `FieldMap.waterShimmer()` (`fieldmap.ts` line 322): an `AnimFx` for the whole map, added when the map has water tiles. See section 3 | Answered. It is a painter (Canvas 2D, per frame), not a bake. |
| Task 2: camera pan "from `fieldkit/api.ts` and `camera.ts`" | The target comes from `api.ts` `pan` (calls `cameraOrigin` in `camera.ts`). The easing and the per-tick step are in `FieldScene.updateCamera` (`field.ts` lines 605 to 624): ease-in-out quad, `Math.round` of the interpolated origin, done when `t >= frames` | The engine `Camera.pan` copies `updateCamera`. A test pins it to that formula. |
| Decision 6: "same tie-break as `byBaseY`" | `byBaseY` is `a.baseY - b.baseY` with **no** tie rule. It works because `Array.prototype.sort` is stable and `render()` fills the list in a fixed order: sprites, then chests, then actors (`field.ts` lines 671 to 682). So a tie goes to insertion order | `Container.ySort` must break ties by the order children were added. Pixi's own sort does **not** do that over time (it is stable over the array it has, and that array was reordered by earlier sorts). The engine writes the add order into the key. See the engine notes in `interfaces.md`. |
| Pass line 2 names `tests/mapdata*.test.ts` | The new test is `tests/mapdata.test.ts` | Matches the glob. |
| Everything else in section 2 | Checked: `lighting.ts` 185 lines, 64 px light sprite, boost 0.32, bloom 0.14 and 0.08, `overrects`; `world` 60x42 tiles = 960x672 (the largest; `lantern_row` is 56x40); `bake()` makes `ground`, `emit`, `over`, `overEmit`; no field seam; `stageseam.ts` and the lazy provider in `sje/boot.ts` exist for the battle; `Container` had no `ySort`; `Camera` had `setScroll`, `setBounds` and the fades | Correct. |

## 2. What `field.ts` and `fieldkit/` call on `Ctx` and `Surface`

`Ctx` is `CanvasRenderingContext2D` (`engine/canvas.ts`). `Surface` is `{ canvas, ctx, w, h }` made by `surface(w, h)`. The field never reads pixels (`getImageData`) outside the bake.

**Direct calls in `field.ts` `render()` and its helpers:** `fillRect` (13 sites: contact shadows, banner, objective, cue arrow), `drawImage` (4: the chest halo, the chest's trim glow, and a sprite's `emit` into the screen and into the glow layer), `save` and `restore` (the banner), `fillStyle`, `globalAlpha`, and `globalCompositeOperation` set to `'lighter'` then back to `'source-over'` (the chest halo, lines 692 to 696). Text goes through `drawText`, `measure`, `wrap` (`engine/font.ts`, now `sje/display/font.ts`).

**Through helpers that take the same `Ctx`:**

| Helper | Where | What it does to the `Ctx` |
|---|---|---|
| `drawSurround(ctx, sv)` | `fieldkit/surround.ts`, `surround-art.ts` (401) | `fillRect` (30 sites), `drawImage` (9), `createLinearGradient` (3), `createPattern`, `translate`, `setTransform`, `save`/`restore`; builds `Surface`s with `surface()` (a cached picture, copied each frame; the Dock water is the one moving part) |
| `blit(ctx, layer, cx, cy)`, `blitParts(...)` | `fieldkit/draw.ts` | `drawImage` of a window of a map-sized layer |
| `inView`, `byBaseY`, `DrawEntry` | `fieldkit/draw.ts` | none (the draw list) |
| `drawEmote` | `fieldkit/draw.ts` | `fillRect` x4, text |
| `drawCurtains` | `fieldkit/popins.ts` | `createLinearGradient`, `fillRect` |
| `Dust.render` | `fieldkit/dust.ts` | `fillRect`, `globalAlpha` |
| `Weather.render` | `field/weather.ts` | `fillRect` (5), `globalAlpha`, `fillStyle` |
| `Lighting.build/apply/drawLit/drawLitLayer/bloom` | `field/lighting.ts` | `fillRect`, `drawImage` (scaled and clipped), `createRadialGradient` (once, for the 64 px light sprites), `globalCompositeOperation` `'lighter'`, `'multiply'`, `'copy'`, `'destination-in'`, `globalAlpha`, `clip`/`rect`/`save`/`restore`. Own `Surface`s: the 640x360 `map`, a 640x360 `scratch`, and one scratch per sprite size |
| `AnimFx.draw(ctx, frame, ox, oy)` and `SortedSprite.anim(ctx, frame, sx, sy)` | `field/props.ts`, `buildings.ts`, `fieldmap.ts` | `fillRect`, `globalAlpha`, `fillStyle`; see section 3 |
| `bandGradient`, `renderObjective`, `renderBanner` | `ui/draw.ts`, `field.ts` | `createLinearGradient`, `fillRect`, `globalAlpha`, text |
| `postfx.glowLayer()` | `sje/fx/fxstate.ts` | Returns a `Ctx` or null. The field `blit`s `emit` into it and each sorted sprite adds its `emit`; it sets `postfx.bloom` to 0.5 in an interior and 0.9 elsewhere. **The stage must give the same glow input to `FxSystem`.** |
| `fieldHooks.renderOverlay?.(this, ctx)` | `game/hooks.ts` | Whatever a hook draws last (dev tools) |

**Not on `Ctx`:** `game.fadeOut`, `fadeIn`, `shake`, `flash`, `wait` and the shake offsets `game.shakeX`, `game.shakeY` (the old `Game`; under the flag the `LegacyScreenFx` seam answers them). `field.ts` reads `game.input` and `game.countPlayTime` only.

## 3. Every per-frame animation and what draws it

`frame` is `FieldScene.frame`, one per update tick. All of these are drawn by `render(ctx)` today.

| Animation | Drawn by | Notes for the stage |
|---|---|---|
| **Water shimmer** and drip rings | `FieldMap.waterShimmer()` (`fieldmap.ts` 322 to 358), an `AnimFx`, `lit` false | Covers the whole map (`x:0,y:0,w,h`); drip rings: 5 slots with periods 110 + 17 slot; twinkle pixels from `hash2(tx, ty, i)` and `frame * 0.05`. Colors differ in a dungeon. Culls by screen rect. Needs `frame`, camera origin. |
| Prop `firebarrel` flame | `SortedSprite.anim` (`props.ts` 121) | Six moving embers; called by `drawSprite` after the lit sprite, so it is drawn in depth order |
| Prop `stall` steam | `SortedSprite.anim` (`props.ts` 279) | Same path |
| Prop `mast` blink | `SortedSprite.anim` (`props.ts` 553) | Blinks every 40 frames |
| Prop `holo` flicker | `SortedSprite.anim` (`props.ts` 777) | `sin(f * 0.9)` dropout |
| Prop `laser` | `AnimFx` (`props.ts` 357), unlit | |
| Prop `binding_circle` | `AnimFx` (`props.ts` 470), unlit | `t = f * 0.03` |
| Prop `lure` | `AnimFx` (`props.ts` 826), **lit** | Lit animations draw before the light multiply |
| Prop `steam` | `AnimFx` (`props.ts` 856), **lit** | |
| Prop `window` | `AnimFx` (`props.ts` 976), unlit | |
| Prop `cryopod` | `AnimFx` (`props.ts` 1080), **lit** | |
| Building `antenna` blink | `AnimFx` (`buildings.ts` 283), unlit | |
| Light flicker | `flickerAmount()` in `lighting.ts`, called by `Lighting.build` and `Lighting.bloom` | `sin` mix plus a hard dropout from a multiply hash. Pure in `(seed, x, y, frame)`. |
| Light map | `Lighting.build` each frame | 640x360 canvas; ambient fill, then `'lighter'` sprites |
| Bloom haze | `Lighting.bloom` | Additive, strength 0.14 outdoors and 0.08 in an interior |
| Chest halo and glint | `field.ts` `render()` (lines 685 to 715) | `0.5 + 0.3 * sin(f * 0.06 + x * 1.7)`; a glint every 160 frames |
| Contact shadows | `field.ts` `render()` | Three `fillRect`s under each visible actor, before the light multiply |
| Rain, drips, dust motes | `Weather.update` (tick) and `Weather.render` (screen space) | Parallax uses the camera delta (`update(camDx, camDy)`) |
| Dash dust | `Dust.render` (steps its own motes) | Uses `Math.random` (not seeded): the one non-deterministic painter; the parity harness must not kick dust |
| Walking, idle, hop, bounce | `Actor.update` (tick) and `Actor.frame()`, `drawX()`, `drawY()` | `stride`, `stillT`; `drawY` includes `hop` and a 1 px idle bounce |
| Emote pop | `drawEmote` | Rises over 6 frames; `Actor.update` counts `emote.t` |
| Interact cue | `drawCue` | `sin(f * 0.15)` bob |
| Area banner | `renderBanner` | `banner.t` 0 to 200 |
| Objective flash | `renderObjective` | `objFlash` counts down, toggles every 10 frames |
| Event curtains | `drawCurtains` and `curtainEase` | Eased per tick |
| Camera pan | `updateCamera` | Ease-in-out quad over `frames`; shake is `game.shakeX/Y` |
| Dock surround water | `drawSurroundArt` with `SurroundView.frame` | The one animated surround |

Frame-count timing: every one of these counts **update ticks** (60 per second), so the painters can keep their numbers.

## 4. Every use of `MapDef` fields

Grouped by who reads the field. Line numbers are in the files named.

| Field | Read by |
|---|---|
| `id` | `field.ts` (`ev:<map>:<id>` flags, surround id), `state.map` |
| `name` | `game/save.ts` 83 (the save-slot label), `placemap.ts` 47 (exit labels) and 100, `mapview.ts` 29 |
| `kind` | `fieldmap.ts` 149, 150, 325 (dungeon bakes, shimmer color); `field.ts` 130, 666, 722, 739 (interior: no visit flag, bloom, no objective); `game/systems.ts` 277, 319, 330 |
| `terrain`, `legend` | `fieldmap.ts` 61 to 64 (grid size, legend merge); `placemap.ts` 39; `game/save.ts` 285 (a saved position must be inside the grid); `tests/mapgraph.ts` |
| `structures` | `fieldmap.ts` 132 (`paintBuilding`) |
| `props` | `fieldmap.ts` 133 (painters); `field.ts` 46 (cache key), 454 and 476 (talking across a counter); `art/drawn.ts` 260 |
| `npcs` | `field.ts` 166 (`buildNpcs`; `a.npc = n`, then `talk` at 501 to 506); `art/drawn.ts` 109, 228; `art/rig2/npcs.ts` 23; `dev/artswap.ts` 225 |
| `warps` | `field.ts` 334 (`warpAt`, `when`, `blocked`, `confirm`, `door`); `placemap.ts` 43, 123 |
| `events` | `field.ts` 341 to 351 (`on`, `once`, `when`, `run`) |
| `chests` | `field.ts` 143 |
| `lights` | `fieldmap.ts` 137 (baked into `BakedLight`); `field.ts` 46 (cache key) |
| `ambient` | `field.ts` 136 (the light map fill) |
| `weather` | `field.ts` 140; `fieldmap.ts` 147 (wet streets bake when `rain`) |
| `music`, `space` | `field.ts` 178, 410, 412 |
| `encounters` | `game/systems.ts` 153 |
| `battleBg` | `game/systems.ts` 167, 172 |
| `onEnter` | `field.ts` 184 |
| `strings` | `fieldmap.ts` 143, 145 |
| `banner`, `bannerSub` | `field.ts` 183 |
| `voidColor` | `field.ts` 638 (the surround view) |
| `town` | `field.ts` 134 |
| `entrance` | `field.ts` 135 |
| `patches` | `fieldmap.ts` 65; `field.ts` 46 (cache key) |

**Code fields** (these cannot be JSON values; they become string ids into a behavior module): `when` on props, lights, npcs, warps, events, chests and patches; `talk` (a script, or a list of lines which is plain data); `run` on events; `blocked` on warps; `onEnter`. Counts per file: `annex.ts` 32 `when`, 17 `run`; `interiors.ts` 3 and 8; `lantern_row.ts` 2 and 5; `rustyard.ts` 10 and 4; `sinkline.ts` 20 and 9; `world.ts` 2 and 1. The maps import their scripts from `story/chapter1` (and `game/script` for a type). `look` on an npc is a `LOOKS` entry (shared by identity, which `art/drawn.ts` 109 relies on: `named.has(n.look)`) or an inline object.

**Values that live in code beside the maps** (the reader's "no look constant hides in code" check, pass line 11): `fieldkit/surround.ts` `SURROUND` (which maps have a surround and which kind), `fieldkit/popins.ts` (camera boxes, curtains, holds, per map id), `fieldkit/camera.ts` `LEADER_FOCUS_LIFT`, `field.ts` `WALK`, `DASH`, `SOFT_GROUND`, `lighting.ts` `spriteBoost` and `LIGHT_RES`, `weather.ts` `LAYERS`. The surround and pop-in tables say in their headers that they move into the map data once Mark gives his written yes (PL6). **M5 does not move them**: the brief says no map data changes without Mark's yes for each map.
