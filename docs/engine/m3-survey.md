---
type: plan
title: "Shadow Jog Engine — M3 survey of the battle callers"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m3, survey, battle-stage]
---

# M3 task 1: what the battle calls, and what a `Figure` needs

Written by Builder A before any code moved, for Builder B (HUD, `PlaybackView`, fx painters) and Builder C (routing). Source: `src/scenes/battle.ts` (1,163 lines), `src/scenes/battlekit/*` (2,200 lines), `src/battle/fx.ts` (1,208 lines). Part of [m3-brief.md](m3-brief.md).

## 1. `battle.ts` calls on the renderer

`BattleScene` does not draw. It holds state and flow and hands one `Ctx` (Canvas 2D) to `BattleRenderer.render(ctx)` (`battlekit/render.ts`, 987 lines). The only call from the scene is `this.renderer.render(ctx)` (battle.ts line 135).

`BattleRenderer` draws three layers, then the UI, in one pass:

| Layer | Size | Holds |
|---|---|---|
| `world` | `BW` x `BHT` (320 x 180) | the backdrop (`bg.canvas`, `bg.glow`, `bg.anim(ctx, frame)`) |
| `enemyLayer` | `W` x `H` (640 x 360) | the enemies, drawn through a 2x transform (`WORLD_SCALE`) |
| `front` | `BW` x `BHT` | the party, the `FxLayer` output and the floaters |

Then the screen shake offset, the push-in crop, and the UI on the screen canvas.

It reads about 50 members of the scene (`this.s.*`). The ones that decide the stage: `bg`, `world`, `enemyLayer`, `front`, `drawOrder`, `enemyPos(u)`, `partyPos(u)`, `pos(uid)`, `partyArt`, `d(uid)` (the `Disp` of a fighter), `push`, `impactT`, `impactOn`, `impactColor`, `fx`, `floaters`, `cutins`, `banner`, `message`, `tell`, `introT`, `deckT`, `defeatT`. The UI ones (HUD, task 5): `mode`, `cmds`, `roundMenu`, `cmdMenu`, `listMenu`, `listKind`, `targetList`, `targetIdx`, `endPanel`, `timing`, `comboHint`, `comboActors`, `menuX`, `boxX`.

Drawing calls the renderer makes: `drawText` (37), `measure` (21), `drawWindow` (12), `drawBar` (5), `fitText` (4), `drawParagraph` (2). The font is `src/engine/font.ts`, which now re-exports `src/sje/display/font.ts` (task 3).

## 2. `FxLayer` (the surface that must not change)

`new FxLayer(BW, BHT)` is owned by the scene (`battle.ts` line 83) and by the FX lab (`src/dev/fxlab.ts`). Calls from `battle.ts` and `battlekit/*`:

| Member | Callers | Meaning |
|---|---|---|
| `play(id, from, targets, color?)` | `playback.ts` (2), `battle.ts` (1) | start an effect, returns an `FxTiming` (hit frame, length) |
| `impactOf(id, from, targets, color?)` | `playback.ts` | the hit frame of an effect, without starting it |
| `update()` | `battle.ts` | one effect tick |
| `render(ctx, drawGlyph, glow?)` | `render.ts` (2) | draw the effects into a `Ctx` (once for the world, once for the glow layer) |
| `rate` | `battle.ts` (7 writes) | effect frames per real frame (battle speed, held confirm) |
| `realFrames(n)` | `playback.ts` | effect frames to real frames at the current rate |
| `flash`, `shake` | `battle.ts` (4, 3) | screen flash and shake requests the scene consumes |
| `busy` | `battle.ts` | any particle or shape alive |
| `clear()` | `battle.ts` | drop everything |
| `w`, `h` | `fx.ts` internal | the world size, from the constructor |

All effects are Canvas 2D painters (`Shape.draw(ctx, k)`) and particles (`Particle` with `kind`). No method of `FxLayer` changes in M3 (task 6).

## 3. `PlaybackView` (`battlekit/playback.ts`, the only seam of `playEvent`)

`playEvent(view, event)` is pure flow. The scene builds the view object at `battle.ts` line 690. Members:

- State: `battle`, `fx`, `game`, `lastActor`.
- Positions: `d(uid)`, `pos(uid)`.
- Time: `w(frames)` (battle-speed wait), `anim(frames)`, `hitstop(frames)`.
- Text and numbers: `label(u)`, `floatOn(uid, text, color, style)`, `say(text)`, `tell(text, actor)`, `showBanner(text, color, big?)`, `setBanner(b)`, `endBanner()`, `deckCutin()`, `cutin(c)`, `cutinCount()`, `comboId(name)`.
- Fighters: `setPose(u, pose, frames)`, `initDisp(u)`, `markDead(uid)`, `relayout()`.
- Timing press: `timingArmed()`, `openTiming(lead)`.
- Camera: `impact(uid, color)` (sets `push = { x, y, t: 0, life: 20 }` and, with Screen flash at Full, the impact cut-in).

Task 6 can keep this interface. Only the object behind it changes.

## 4. Every input of a `Figure` (`src/battlestage/figure.ts`)

`new Figure(scene, spec, stage, firstFrame)`:

| Input | Where it comes from |
|---|---|
| `spec.id`, `spec.side`, `spec.name`, `spec.boss` | crew id / `ENEMIES[key]` (`name`, `boss`), slot size |
| `spec.slot` (`PartySlot` / `EnemySlot`: `x`, `row`, `dy?`, `order?`, `size?`) | the stage JSON (`party[]`, `enemySets[setKey][]`) |
| `spec.baseTex` | the baked crew sheet (`crewb-<id>[...]`) or `enemy-<sprite>-<copy>` from `addEnemy` |
| `spec.fig`, `spec.art` (`FigureArt`: `raw`, `box`, `foot`, `face`, `head`, `grain`, `mirrorOf`) | measured from the pixels; `figureFor` mirrors it for a mirrored enemy |
| `spec.mirror` | `enemyfacing.json` through `isMirrored(facing, sprite)` |
| `spec.idle` | `art.idle` of the enemy (`still`, `bob`, `hover`, `sway`, `breathe`, `flicker`) |
| `spec.uid` | the slot index (keeps two of a kind out of step) |
| `spec.cellW`, `spec.cellH` | the cell of the baked sheet / the enemy art |
| `spec.axisKey` | crew id or `ENEMIES[key].sprite`, for the foot correction of `axes.json` |
| `spec.sheet` (`fps`, `count`, `phase`) | a hero's idle sheet metadata |
| `stage` (`StageConfig`) | rows, shadow style, depth haze (`depthTint`), `sort`, `activeRing` |
| `firstFrame` | `idleFrame(worldFrame, fps, count, phase)` |

Per frame, `restyle({ stage, textures, worldFrame })` reads the figure's own mutable state: `active`, `target` (rings), `alpha`, `x`, `y`, `bodyDx`, `offX`, `offY`, `sortY` (a lunge sorts by the target's row), `slot.order`. The scene calls `f.tick(worldFrame)` every tick.

What `PlaybackView` needs from a `Figure` that it does not yet offer: `Disp` has `flash`, `shake`, `hop`, `lunge`, `dying`, `afterimage`, `pose` and `lagHp`. `Figure` has `alpha`, `bodyDx`, `offX`, `offY` and `sortY`; flash, hop, dying and pose are builder B work (task 6, a `Figure` state setter per `Disp` field).

## 5. Coordinates (the trap for builder B)

The legacy battle works in "world" pixels (`BW` x `BHT` = 320 x 180) and shows them at 2x. `scene.pos(uid)`, `enemyPos`, `partyPos` and every `FxLayer` point are world pixels. The Phase 0 stage works in screen pixels of the 480 x 270 layout (`SCREEN_W` x `SCREEN_H` in `src/battlestage/config.ts`; the stage JSONs are in these numbers). The 640 x 360 layout is task 9. Until then a world point maps to a stage point by the stage's own slots, not by a multiplication: ask the `Figure` (`x`, `y`, `fig.box`).

## 6. Facts that changed the plan

- `src/battlestage` did not exist on `main`. Task 4 started from the `archive/engine-platform-2026-10-09` tag (22 files), plus `src/art/rig2/sfgeom.ts` (now `src/battlestage/sfgeom.ts`) and the five stage data files.
- The goldens are 480 x 270 pictures of the Phaser spike. They need the 240 x 135 backdrops, which `main` no longer has (it has 320 x 180). The old painters are kept as `src/art/battlebg480.ts` for the regression layout. Task 9 reads `src/art/battlebg.ts`.
