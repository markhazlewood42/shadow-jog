---
type: plan
title: "Shadow Jog Engine — M6 survey of the flip"
project: shadow-jog
created: 2026-10-10
updated: 2026-10-10
tags: [engine, m6, survey, flip]
---

# M6 task 1: who uses the old canvas pair, and what the flip breaks

Written by Builder A before the flip, for Builder B (FX lab, E5, budget, goldens, docs) and the runner. Every fact was counted on branch `engine-m6-flip` on 2026-10-10 (grep only, nothing run in a browser). Part of [m6-brief.md](m6-brief.md).

## 1. Corrections to brief section 2

| Brief said | The code says | Effect |
|---|---|---|
| `postfx` is called by 9 `src` files | 14 files import it besides the presenter: `boot`, `dev/fxlab`, `dev/trailer`, `engine/display`, `engine/game`, `engine/moments`, `fieldstage/stagescene`, `main`, `scenes/battle`, `scenes/battlekit/gpufx`, `scenes/battlekit/render`, `scenes/field`, `scenes/options`, `sje/boot` (plus 4 tests) | The decision holds (`postfx` stays to M8); the list is longer. `main.ts` and `display.ts` lose their import in M6. |
| 10 files "hard-code `?engine=sje`" | Only `e2e/sjegamekit.ts:76` builds the URL (`openGame`). The other 9 files mention it in comments. Every spec reaches the new engine through `openGame({ engine: true })` | Removing the URL is one line. The real work is the `engine: false` callers (section 4). |
| "None of the specs passes `engine=`; they all run on Pixi with no edit" | True for the URL. **Not true for the `#screen` locator:** `startSje` removes `#screen` (`sje/boot.ts:81`), so `page.locator('#screen')` finds nothing on the new default | `playthrough`, `prod`, `economy` (shots only), `shots`, `fxlab` and the scripts need `canvas` instead (section 4). |
| (not in the brief) | 8 spec files compare the new engine with the OLD path through `engine: false` | They cannot run after the flip. See section 4: five are rewritten or cut, four are local-only and retire. |
| Flag-only class 49.1 kB | Not re-measured (Builder B owns the budget) | — |
| `GlPresenter` imported only by `display.ts`; `Display` used by `main`, `fxlab`, type in `boot` | Also typed in `devroutes.ts` and `sje/boot.ts` (`OldDisplay`); `tests/sje-imports.test.ts:288` pins `src/engine/gl/presenter.ts` as the one file that imports `src/sje/render/glcontext` | The imports test changes in M6 (section 2). |

## 2. Importers

### `src/engine/gl/` (deleted in M6)

| Who | How |
|---|---|
| `src/engine/display.ts` | `import { GlPresenter }`, the GL half |
| `tests/sje-imports.test.ts:288` | expects `presenter.ts` to be the one shipped file that imports `src/sje/render/glcontext`; after M6 nothing outside the engine imports `glcontext`, so `glcontext` leaves the list of "nine files" |
| comments | `src/engine/postfx.ts:4`, `src/sje/fx/compositefilter.ts:6`, `src/sje/render/glcontext.ts:34`, `src/sje/render/shaders/{blur,composite}.ts`, `e2e/gpufx.spec.ts`, `docs/ARCHITECTURE.md:93-105`, `docs/CONCEPTS.md:159` |

### `src/engine/display.ts`

| Who | Uses |
|---|---|
| `src/main.ts` | `new Display(screen)`, `beginFrame`, `present` (old loop; goes) |
| `src/boot.ts` | type `Display`: `mode`, `resize()`, `setGpu(on)` |
| `src/devroutes.ts`, `src/dev/fxlab.ts` | type `Display`: `toGame`, `resize` |
| `src/sje/boot.ts` | `OldDisplay`: the `DisplayAdapter` is cast to it |
| `tests/display.test.ts`, `tests/sje-display.test.ts` | `cssScaleFor` only |

After M6 `display.ts` keeps `cssScaleFor`, `ScaleMode` and a `Display` **interface** (what `boot.ts` and the dev routes call). The class, the GL layers and `postfx.active/glow/ui` writes go. M8 deletes the file.

### `src/engine/game.ts`

| Who | Uses |
|---|---|
| `src/main.ts` | `FPS`, `Game` (old loop; goes) |
| 22 files in `src/scenes` | `Scene` base class (stays to M8) |
| `src/boot.ts`, `battlekit/{playback,stageseam}`, `fieldkit/fieldseam`, `story/newgame`, `dev/{fieldshow,trailer,fxlab}`, `devroutes`, `battlestage/liveopen`, `fieldstage/fieldopen`, `sje/boot` | type `Game` (and `SHAKE_PIXEL_GAIN`) |
| 11 test files | `Game`, `Scene`, `W`/`H` |

No change in M6 except `main.ts`. `Game` stays as the type of `LegacyGameSurface` until M8.

### `src/engine/postfx.ts` (stays to M8)

Importers are listed in section 1. In the new default `routePostfx` (`sje/boot.ts`) points the singleton at `game.fx` before `bootGame`. Pass line 4 control: a unit test fails if that order is lost.

### `#fx` and `#screen`

| File | Line | What | M6 action |
|---|---|---|---|
| `e2e/gpufx.spec.ts` | 37, 73, 76, 79, 95 | `locator('#fx')` visible / count 0 | rewritten to `__SJ__.renderer.fxLevel` |
| `e2e/gpufx.spec.ts` | 105, 133 | `#screen` screenshot and 2D `getImageData` | rewritten: canvas screenshot, `unevenBlocks` |
| `e2e/sje-fx.spec.ts` | 135 | `getElementById('fx')` is null (the one allowed read) | stays |
| `e2e/sjefieldkit.ts` | 111 | comment about `#fx` | comment updated |
| `src/dev/trailer.ts` | 155 | `getElementById('fx') ?? getElementById('screen')` | `canvas` lookup |
| `src/engine/display.ts` | 78 | creates `#fx` | deleted |
| `src/sje/boot.ts` | 15, 81 | comment; `getElementById('screen')?.remove()` | stays (the page still ships `<canvas id="screen">` in `index.html`; removing it is a later clean-up) |
| `src/dev/devmenu.ts` | 105 | `getElementById('screen')?.focus()` | no-op on the new path (null). Builder B: focus the canvas |
| `e2e/playthrough.spec.ts:24`, `prod.spec.ts:20`, `economy.spec.ts:216`, `shots.spec.ts:168`, `fxlab.spec.ts:36`, `scripts/shot.mjs:21`, `scripts/pixellab/render-maps.mjs:84,98` | `locator('#screen')` | `canvas` (fxlab.spec: Builder B) |

## 3. Pass line 4 control

`routePostfx` is applied in `startSje` before `bootGame`. A new unit test (`tests/sje-boot-order.test.ts`) reads `src/sje/boot.ts` and asserts the call to `routePostfx` comes before the call to `bootGame`. Without that order `boot()` would register tickers and scenes against an unrouted singleton and every effect would be a no-op with no error.

## 4. Spec steps that depend on the old canvas pair

| Spec | Step | After the flip |
|---|---|---|
| `e2e/sjegamekit.ts` | `openGame({ engine })` adds `engine=sje&` | the `engine` option goes; the URL is `/?debug` |
| `e2e/sje-shell.spec.ts` | test 2 (old-path pictures), block test (old 2D vs new, ratios 1 to 3), control (old title vs old field) | the three old-path tests go. The block test keeps its no-uneven-block check and its wrong-ratio control. The old-vs-new equality was proved in M1 and is recorded in `m1-brief.md`; Builder B's goldens (pass line 12) replace it as a regression guard |
| `e2e/sje-battle.spec.ts:276` | "the old path has no stage" | removed (nothing to compare) |
| `e2e/sje-field.spec.ts:96` | the old field has no stage | removed |
| `e2e/sje-fx-compare.spec.ts` | old presenter vs `FxSystem` | local only; retired with a header note (old path gone) |
| `e2e/sje-pictures.spec.ts` | variant `old` | local only; the variant is dropped |
| `e2e/sje-field-pictures.spec.ts`, `e2e/sje-field-refs.spec.ts`, `e2e/sjefieldkit.ts shoot(engine)` | legacy field pictures | the committed references (`tests/fixtures/sjefield/`) stay; making them again needs a checkout from before M6. `refs` is retired; `pictures` loses its `old` side; `shoot` loses the `engine` argument |
| `e2e/gpufx.spec.ts` | all 5 tests | rewritten (section 5) |
| `e2e/gameover.spec.ts`, `e2e/prod.spec.ts` | WebKit and Firefox projects | Firefox on CI has no WebGL 2: it meets the E5 message. Game flow skipped by `browserName`; one E5 test per file |
| `e2e/gameover.spec.ts:243` | "a browser that cannot start the game" (no 2D canvas) | still holds: `getContext` returns null for every canvas, so `Game.create` rejects and `fail()` shows the text |
| `e2e/fxlab.spec.ts` | `?scene=fxlab` on the old `Display` | Builder B (task 5). Between task 4 and task 5 this spec is red |

## 5. What the new `gpufx.spec.ts` asserts

| Case | Assertion | Control |
|---|---|---|
| default level | `renderer.fxLevel` is `full` or `lite`, no `#fx`, a battle full of effects keeps the game running, `fxCounts().particles > 0` | `?fx=none` expects `none` and 0 particles |
| Options switch | `gpu(false)` gives `none`, a reload keeps `none`, `gpu(true)` gives `full` | — |
| `?fx=none` | effect calls are no-ops, the battle plays | the same case at `full` shows particles |
| pixel-perfect (k = 3 and 2) | a canvas screenshot has 0 uneven k-by-k blocks | a wrong k finds uneven blocks |
