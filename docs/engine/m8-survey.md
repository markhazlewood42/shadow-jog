---
type: plan
title: M8 survey re-check
project: shadow-jog
created: 2026-10-14
---

# M8 survey re-check

Read-only survey for M8 task 1 (`m8-brief.md` section 5). Branch `engine-m8a-ui-kit`. Grep and reads only. Counts are call sites unless a row says "import". Paths are under `src/` unless shown.

## 1. Value uses of the four old files

`engine/game.ts` exports: `FAULT_LIMIT` (:21), `FPS`, `H`, `W` (:25, re-exported from `sje/core/size`), `SHAKE_PIXEL_GAIN` (:32), `Scene` (:34), `AnyScene` (:70, type), `Game` (:86).

| Value used | Where | Note |
|---|---|---|
| `Scene` (base class) | `extends` in 15 files: `scenes/battle.ts:74`, `field.ts:71`, and the 13 UI scenes (one each) | The only real `src` value use. |
| `SHAKE_PIXEL_GAIN` | `sje/boot.ts:25, :94` | Value. |
| `Game` (class) | none in `src` | Type only in `boot.ts:4,10`, `battlestage/liveopen.ts:14`, `fieldstage/fieldopen.ts:12`, `game/systems.ts:14`, `story/newgame.ts:2`, `battlekit/playback.ts:13`, `battlekit/stageseam.ts:18`, `fieldkit/fieldseam.ts:17`, `sje/boot.ts:25`. |
| `FAULT_LIMIT`, `Game` | `tests/game.test.ts:4`, `tests/shake.test.ts:9` | Tests only. |
| `W`, `H` | none in `src`; dynamic import in `tests/atmosphere.test.ts:76`, `layout.test.ts:95,132,317`, `ui-layout.test.ts:87`, `e2e/economy.spec.ts:189` | Tests and e2e only. |

`engine/display.ts` exports `ScaleMode` (:14, type), `cssScaleFor` (:28, function), `Display` (:36, interface).

| Value used | Where |
|---|---|
| `cssScaleFor` | `tests/display.test.ts:13`, `tests/sje-display.test.ts:8`. No `src` value use. |
| `Display` (type) | `boot.ts:2`, `sje/boot.ts:23` |

`engine/postfx.ts` exports the re-exported fx types (:13), `PostFx` (:15) and the `postfx` singleton (:17).

| File | `postfx` calls (line) |
|---|---|
| `scenes/battle.ts` | `clear` (173, 221), `clip` (174), `rate` (445) |
| `scenes/field.ts` | `glowLayer` (767), `bloom` (769) |
| `scenes/options.ts` | `active` (81) |
| `scenes/battlekit/render.ts` | `glowLayer` (179, 202), `bloom` (181, 204), `active` (184, 207), `ui` (184, 207) |
| `scenes/battlekit/playback.ts` | `active` (32), `later` (34) |
| `fieldstage/stagescene.ts` | `glowLayer` (486), `bloom` (488) |
| `dev/stageedit/battleglue.ts` | `clear` (117) |
| `boot.ts` | passes `postfx` as a value to the dev facade (104), `update`, `motion`, `intensity` (193-195) |
| `sje/boot.ts` | `update` (123), `routePostfx` (126) |
| `tests/gpufx.test.ts`, `tests/sje-fx.test.ts` | `PostFx`, `postfx`, `MAX_SHOCKS` |

`engine/moments.ts` exports `MomentOpts` (:9, type) and `playMoment` (:30). Value uses: `scenes/battle.ts:281` (the intro, `playMoment(FX, 'intro', W / 2, H / 2)`), `scenes/battlekit/playback.ts:35`, and `tests/gpufx.test.ts:6`.

## 2. Do battle and field draw themselves?

**No, not fully.** The brief's premise is wrong for both scenes (see Contradictions).

| Scene | Draws itself? | Evidence |
|---|---|---|
| `scenes/battle.ts` | Yes, the menus, panels and victory and level-up windows | `render` (:158) calls `BattleRenderer.render` (`battlekit/render.ts:79`, 1035 lines, 36 `drawText`, 11 `drawWindow`, 17 `drawImage`). The scene itself has 19 `drawText` and 2 `drawWindow` (:884-905, :1018-1069). The comment at `battle.ts:137` says a stage draws the world, and the renderer draws the old UI. |
| `scenes/field.ts` | Yes, on the default path | `render` (:720) returns early with the dev overlay only when a stage is open (`this.stage`, set by `fieldkit/fieldseam.ts`). Otherwise `renderLegacy` (:730) draws the whole picture: 3 `drawText`, 3 `blit`, 13 `fillRect`, 4 `drawImage`. It uses `fieldkit/draw.ts`, which has the same helpers. |
| `scenes/battlekit/playback.ts`, `fieldkit/fieldseam.ts`, `battlekit/stageseam.ts` | No drawing | Only the calls in section 1. |

Old `postfx` and `playMoment` to the new `game.fx` (`FxSystem`, extends `FxState`):

| Old | New | Source |
|---|---|---|
| `postfx.clear()`, `.clip`, `.rate`, `.bloom`, `.active`, `.ui` | same names on `game.fx` | `sje/fx/fxstate.ts:300, :144, :111, :113, :106, :157` |
| `postfx.glowLayer()`, `.later()` | same | `fxstate.ts:165, :248` |
| `postfx.shock/aberrate/haze/glitch/dim/flare/emit/update` | same | `fxstate.ts:177-260` |
| `playMoment(FX, name, x, y, o)` | `game.fx.playMoment(name, x, y, o)` | `sje/fx/fxsystem.ts:220`. Data loaded once by `game.fx.loadData(FX)` (`sje/boot.ts:124`). Per-layer work: `sje/fx/moments.ts:15` (`fireLayer`). |

Until M8d, old call sites still work on the sje path. `sje/fx/route.ts:42` (`routePostfx`) forwards the old singleton to `game.fx` (`sje/boot.ts:126`). `battlekit/gpufx.ts:20` already types its input as a `MomentFx` shape with `playMoment`, which matches `FxSystem`.

## 3. UI scenes

Counts: `drawText(` and `drawWindow(` call sites. Helper counts are name occurrences minus the import line. Specs are `e2e/` files that name the class, and `tests/` files that import the scene file.

| Scene | Lines | drawText | drawWindow | Other ui helpers (uses) | `game.` members | Specs and tests |
|---|---|---|---|---|---|---|
| card | 47 | 0 | 1 | drawMore 1 | input | ui-layout |
| controls | 111 | 7 | 1 | drawCursor 1, drawSelect 1, keyLegend 1 | input 6 | shots; ui-layout |
| deck | 369 | 13 | 3 | keyLegend 2 | input, shake | ui-layout |
| dialog | 206 | 3 | 2 | drawCursor, drawMore, drawSelect, drawTab 1 each; dialogBoxW, dialogTextW | input | chaos, shots; dialog-wrap, ui-layout |
| ending | 131 | 13 | 2 | drawDivider 1; PAGE_DY, RESULTS_* consts | input 4 | playthrough; ui-layout |
| gameover | 110 | 2 | 1 | ListMenu 2 | input | gameover, shots, sje-battle; ui-layout |
| menu | 888 | 50 | 18 | drawDivider 6, keyLegend 7, drawBar 2, drawSelect 1, hpColor 1, ListMenu 5 | input 9, playFrames, run 3 | gameover; ui-layout |
| options | 180 | 8 | 2 | drawBar 1, drawCursor 1, drawSelect 1 | input 3, flash, run, shake | default-path; ui-layout |
| panels | 500 | 8 | 0 | none (`ui/*` not imported) | flash, input, shake, shakeX, shakeY | shots; devroutes-hack, layout, pacing, et-tools, ui-layout |
| placemap | 143 | 3 | 1 | none | input 2 | layout, ui-layout (no e2e) |
| saveload | 157 | 13 | 3 | drawSelect 1, keyLegend 1 | input 2, playFrames, wait | gameover; ui-layout |
| shop | 433 | 18 | 8 | drawDivider 2, keyLegend 1, ListMenu 4, rowsFor 1; SHOP_* consts | input 2 | economy, sje-shell; ui-layout |
| title | 395 | 4 | 0 | ListMenu 2 | countPlayTime, input 2, run 2 | 19 e2e files (most of the suite), ui-layout |

Kept `engine/*` imports by these scenes: `canvas`, `font`, `game` in all 13. Also `input` (controls, options), `postfx` and `errors` (options), `color` and `rng` (title), `rng` (panels).

Totals in `src/`: `drawText(` 255 call sites, `drawWindow(` 58. In `src/scenes`: 203 and 55. In `src/ui`: 11 `drawText`.

## 4. Shop and dialogue content

| Content | File (lines) | Exports | Importers |
|---|---|---|---|
| Shops | `data/shops.ts` (76) | `ShopDef` (:2, interface), `SHOPS` (:14, 9 shops) | `scenes/shop.ts` only |
| Speakers | `data/speakers.ts` (24) | `Speaker` (interface), `SPEAKERS` (8 entries), `speaker()` | `scenes/dialog.ts`, `scenes/panels.ts` |
| Dialogue scripts | `story/chapter1.ts` (615) | `OBJ` (:19), about 20 `ScriptFn` exports (:35 to :571), `RELAYS`, `RELAY_COLOR`, `latticeEmitters`, `PANEL_SCRIPTS` (:614) | `data/maps/{annex,interiors,lantern_row,rustyard,sinkline,world}.ts`, `game/save.ts` |
| Dialogue box | `scenes/dialog.ts` (206) | `DialogOpts`, `DialogScene` | no text in it (0 string literals of prose) |
| New game | `story/newgame.ts` (13) | `newGame` | `boot.ts` |

Dialogue text lives in `story/chapter1.ts` as code: 179 `s.say(`, 41 `s.narrate(`, 30 `s.set(`, 27 `s.flag(`, 22 `s.sfx(`, 14 `s.wait(`. It is not in a data file.

Data pattern to copy (existing):
- JSON is imported in a TypeScript wrapper: `import x from './x.json' with { type: 'json' }` (`data/enemies.ts:15-16`, `data/fieldlook.ts:9`, `data/maps/annex.ts:9`). `data/fx.ts:7` imports without the `with` clause.
- A checker returns plain-words problems: `checkEnemies` and `checkEncounters` (`data/enemies.ts:114, :192`), `checkFieldLook` (`data/fieldlook.ts:93`), `checkFx` (`sje/fx/fxdata.ts:63`), `checkHacks` (`hack3d/checkdata.ts:29`).
- The loader throws with the file name: `hack3d/data.ts:26-27` (`src/data/hacks.json is not valid`), and `sje/boot.ts:125` (`src/data/fx.json is not valid`).
- Tests: `tests/enemies-data.test.ts` checks the loaded data deep-equals a frozen copy of the old objects (:18), a control test that one changed field fails (:29), and checker messages (:64). `tests/hack3d-data.test.ts:22` checks `checkHacks` and the loader.
- JSON copy helper: `JSON.parse(JSON.stringify(x))` (`tests/enemies-data.test.ts:14`, `tests/fieldlook.test.ts:18`).
- No existing save-load-save round-trip test was found. The closest template is `enemies-data.test.ts`.

## 5. Kept `src/engine` files

| Old file (lines) | Importers (import lines) | `src/sje` today | Proposed target |
|---|---|---|---|
| `assert` (10) | 4 | `sje/core/assert.ts` (15): `must` (same body) and `assert` | Keep the sje file. Merge. |
| `canvas` (95) | 59 | none (`sje/core` has no canvas) | `sje/core/canvas.ts` |
| `color` (98) | 15 | none | `sje/core/color.ts` |
| `errors` (40) | 21 | none | `sje/core/errors.ts` |
| `font` (5, shim) | 42 | `sje/display/font.ts` is the real code | Delete shim |
| `fxdata` (2, shim) | 5 | `sje/fx/fxdata.ts` | Delete shim |
| `input` (243, `Input` class) | 20 | `sje/runtime/input.ts` (45) imports `Action, Input` as types (:15) | `sje/runtime/inputdevice.ts` |
| `particles` (5, shim) | 3 | `sje/fx/particles.ts` | Delete shim |
| `perf` (40) | 2 | none | `sje/core/perf.ts` |
| `rng` (5, shim) | 28 | `sje/core/rng.ts` (`Rng`, :4) | Delete shim |
| `shake` (41) | 6 | none. `sje/runtime/screenfx.ts` takes `shakeOffset` by injection (:29, :63) | `sje/fx/shake.ts`. A real move, not a merge. |

`engine/shake` importers: `sje/boot.ts:29`, `scenes/battlekit/playback.ts`, `sje/runtime/screenfx.ts`, `engine/game.ts`, `tests/motion.test.ts`, `tests/sje-game.test.ts`. `sje/display/cameraeffects.ts` has its own camera shake. Check the name before the move.

Union: 111 files import at least one kept file (`src`, `tests`, `e2e`, `scripts`).

## 6. What `src/sje` offers for UI

| Need | In `src/sje` | Notes |
|---|---|---|
| Text | `drawText`, `TextOpts` (`display/font.ts:299, :290`), `measure` (:268), `fitText` (:349), `wrap` (:371), `drawParagraph` (:398), `TEXT`, `TEXT_DIM`, `SHADOW` (:185-187) | Canvas drawing, no display object. |
| Text object | none (`TextObject` only in `interfaces.check.ts:187`) | `GameObjectFactory.text()` is declared (`interfaces.check.ts:226`) but not in `runtime/gameobjectfactory.ts`. |
| Frame | none (`NineSlice` only in `interfaces.check.ts:199`) | |
| List | none. `ListMenu` is not declared anywhere. | Only `src/ui/list.ts:23`. |
| Bar, cursor | none. Not declared anywhere. | `src/ui/draw.ts` has `drawBar` (:136) and `drawCursor` (:169). |
| Display objects | `GameObject`, `Container` (:27), `Graphics` (:15), `Sprite` (:14), `ImageObject` (:40), `CanvasImage` (:16) in `display/` | Pixi-backed. |
| Rect | `Rect` interface only in `interfaces.check.ts:32`, not exported from `src/sje` | |
| Input | `ActionMap` (`runtime/input.ts:19`): `justPressed`, `isDown`, `repeat`, `dir`, `consume`. `actionMapOf` (:32). | Shape matches `interfaces.check.ts:344`. |

`interfaces.check.ts` (generated from `docs/engine/interfaces.md`, types only) declares `Container`, `Graphics`, `ImageObject`, `Sprite`, `TextObject`, `Zone`, `CanvasImage`, `NineSlice`, `Group`, `GameObjectFactory.text`, `Pool`, `Rect` and `ActionMap`. It does not declare `ListMenu`, bar or cursor.

## 7. Contradictions with the brief

- Contradiction: task 1 says battle and field "draw nothing themselves". `battle.ts` draws its victory and level-up windows (:884-905, :1018-1069). `battlekit/render.ts` draws the menus and panels. `field.ts` draws the full picture when no stage is open (:730).
- Contradiction: the phases table says "The 15 UI scenes" for M8b. Section 5 puts only 13 in M8b (card to title). `battle` and `field` are M8c.
- Contradiction: section 2 says `LegacyScene` is used by `scenes/field.ts` and "four tests". `field.ts` has no `LegacyScene` reference, and three tests use it (`et-tools`, `sje-game`, `sje-runtime`).
- Contradiction: section 2 says about 102 files import kept `engine` files. The count is 111.
- Contradiction: section 2 says about 270 `drawText` and 57 `drawWindow` sites. The count is 255 and 58.
- Contradiction: task 3 says `ListMenu`, bar and cursor are "only declared in `interfaces.check.ts:187`". Line 187 is `TextObject`. `NineSlice` is at :199. `ListMenu`, bar and cursor are not declared at all.
- Contradiction: section 2 says the UI scenes "run through `LegacyScene`". They extend the old `engine/game` `Scene`. `LegacyScene` is the sje adapter that runs them.
- Confirmed: `sje-shell.spec.ts:192` and `sjefxkit.ts:15` import `engine/game` dynamically, and `economy.spec.ts:189` and `sje-bench.spec.ts:146` name it in a string. `src/sje/core/assert.ts` is 15 lines. `sje/runtime/input.ts` is 45 lines and type-imports `engine/input`. All pass-line 6 spec files exist.
