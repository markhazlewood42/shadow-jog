---
type: plan
title: "Shadow Jog Engine — ET survey of the editors and tools"
project: shadow-jog
created: 2026-10-13
updated: 2026-10-13
tags: [engine, et, survey, editors, tools]
---

# ET task 1: which tools exist, what they still need from the old engine, and where ET ends and M8 begins

Written before any ET code, for Mark's approval of [et-brief.md](et-brief.md). Every fact was counted on branch `engine-et-editor-port` (from `main` after M7) on 2026-10-13. Method: grep, a small import-closure script (value imports and `import type` counted apart, dynamic `import()` followed), `git ls-tree` on the archive tags, and one `npm run budget`. No browser ran and no spec ran. "Old engine" below means `src/engine/game`, `display`, `postfx` (and `moments`, which calls `postfx`), `LegacyScene`, `LegacyShape`. `src/engine/gl/` is already gone (M6).

## 1. Corrections to the plan documents

| The documents say | The code says | Effect |
|---|---|---|
| `migration.md` "Editors and tools" and the ET table row: the Battle Stage Editor and Battle Test are ported "with M3". `roadmap.json` ET notes say the same. | M3 did not port them. `m3-brief.md:21` puts the port in ET and builds only the data and the contract. The editor and Battle Test exist only on the tag `archive/phaser-stage-2026-10-09` (Phaser). `src/stage/` is not on this branch. | ET does not port a finished tool here. It builds two tools on the new engine from an archive. This is the largest part of ET. |
| `migration.md` "Editors and tools": "the old-engine tool code is gone before M8". | `FxLabScene` is a hand-written `LegacyShape` (`src/dev/fxlab.ts:132`). `LegacyScene` is deleted in M8. The FX lab also reaches `postfx` through `scenes/battlekit/gpufx.ts` (section 4). | M6 ended the FX lab's direct imports only. The ET exit check is not met for the FX lab yet. |
| `migration.md` M8: delete `src/engine/{game,display,postfx,gl}`. The file table (line 339): "`src/engine/*` after M6: Deleted, M8". | `gl/` is gone. `src/engine` still holds 15 files. 12 of them (not `game`, `display`, `postfx`) are shims or small helpers that 1 to 53 files import (section 5). | M8's list and its table disagree. This does not change ET. The M8 brief must pick one. |
| `TOOLING-UI.md` 4.5: bring the existing tools into line "later, not now" (undo, Ctrl+S, own pages). | `migration.md` ET row: "No new tool features". | ET leaves the 4.5 changes out. A port keeps each tool's panels and features. |
| `scripts/pixellab/plan.mjs:2` names a `?scene=artreview` route. | There is no such route. The review page is `/artreview.html`. | A stale comment. Minor. |

## 2. Every tool, what it imports, and what runs today

Method for the import columns: the closure of the tool's entry file. "Direct" means the file itself imports `engine/game`, `display` or `postfx`. "Reaches" means a file it imports does. `src/engine/canvas`, `color`, `font`, `rng`, `fxdata`, `particles`, `errors`, `assert` are not counted here: M8 clears them everywhere (section 5).

| # | Tool | Files and lines | Old engine: direct | Old engine: reaches | On the new engine today |
|---|---|---|---|---|---|
| T1 | DEV menu and its effects section | `src/dev/devmenu.ts` 131, `src/dev/tools.ts` 55, `src/sje-lab/fxpanel.ts` 89. Mounted at `src/boot.ts:45` | none | none | Yes. It is a DOM panel in the game page. |
| T2 | FX lab (`/?scene=fxlab`) | `src/dev/fxlab.ts` 929. Route: `src/devroutes.ts:20` | none (the comment at `fxlab.ts:129` says so; `Game` and `LegacyShape` are type imports) | `postfx` and `engine/moments`, through `scenes/battlekit/gpufx` (`fxlab.ts:18`, call at `:257`). `LegacyShape` run by `LegacyScene`. | Yes since M6. It plays through `game.fx` (`fxlab.ts:292`, `:346`). |
| T3 | Animation editor (`/rigedit.html`) | `src/dev/rigedit.ts` 882, `rigedit.html` | none | none (type imports of `canvas`, `color`, `assert` through `src/art/rig2`) | Uses no engine. It is a DOM page with its own 2D canvases. It never ran on the old `Game`. |
| T4 | Art review (`/artreview.html`) | `src/dev/artreview.ts` 723, `artreview.html` | none | none (the file has no import) | Uses no engine. Same as T3. |
| T5 | Art swap (`?art=review`, the in-game try of the review picks) | `src/dev/artswap.ts` 305. Loaded at `src/boot.ts:241` | none | none | Yes. It runs inside the game boot. |
| T6 | Art viewers: `?scene=mapview`, `chars` (3 links), `portraits`, `bestiary`, `font` | `src/scenes/{mapview,chartest,portraittest,bestiarytest,fonttest}.ts` 31, 85, 26, 37, 36. Routes: `src/devroutes.ts:76-90` | 5 files, each `import { Scene } from '../engine/game'` (a value) and `extends Scene` (`mapview.ts:9`, `chartest.ts:10`, `portraittest.ts:8`, `bestiarytest.ts:8`, `fonttest.ts:8`) | `input` (type) | Yes, through `LegacyScene`. |
| T7 | Trailer tooling (`window.__SJ__.trailer()`, `scripts/trailer.mjs`) | `src/dev/trailer.ts` 202. Loaded at `src/boot.ts:99` | `Scene` and `Game` (`trailer.ts:16`), `postfx` (`:18`, used at `:61`). `CardScene extends Scene` (`:41`). Also `autosavePolicy` from `../game/systems` (`:21`, a value import, used at `:114-115`). | `input`, `shake`, `moments`, and through `game/systems` the whole game: `scenes/battle.ts` and `engine/moments` | It records `#stage canvas` since M6. The card scene runs through `LegacyScene`. No spec. **Decision 2026-10-13: Mark chose to delete T7 in ET, tracked by [#84](https://github.com/markhazlewood42/shadow-jog/issues/84).** |
| T8 | Field show hooks (`__SJ__.fieldShow`, `fieldInfo`): the parity harness's way to fix a field state | `src/dev/fieldshow.ts` 87. Loaded at `src/boot.ts:65-66` | `import type { Game }` (`fieldshow.ts:12`) | `FieldScene` (a game scene; value `Scene`) | Yes. |
| T9 | Dev routes file: 11 `?scene=` cases (`fxlab`, `hack`, `stage`, `field`, `battle`, `mapview`, `portraits`, `bestiary`, `chars`, `font`, `panels`) | `src/devroutes.ts` 99. Loaded at `src/boot.ts:204` | `import type { Game }` (`devroutes.ts:6`); it casts to the new `Game` for the FX lab (`:24`) | the game scenes it starts (`FieldScene`, `BattleScene`, `PanelScene`) | Yes. |
| T10 | Stage lab (`/sjestage.html`): the battle stage slice, the parity harness's page | `src/sje-lab/stagelab.ts` 133, `stagemain.ts` 27, `stagehook.ts` 353, `sjestage.html` | none | none by value. Types only: `font`, `fxdata`, `game`, `moments`, `postfx`, `shake`. | New engine only. |
| T11 | Engine lab (`/sjelab.html`): the canary page | `src/sje-lab/{lab,main,hook,content,pixilab,threelab,cubescene,glcounter,pixeltools,profile}.ts`, `sjelab.html` | none | `input` (type) | New engine only. |
| T12 | 3D hack dev entry (`?scene=hack`, `__SJ__.hack`) | `src/sje-lab/hackhook.ts` 271, the `hack` case at `src/devroutes.ts:28` | none | none | New engine only. |
| T13 | **Battle Stage Editor** (`/stageedit.html`) | **Not on this branch.** Archive tag: `src/stage/edit/` 16 files, 5,541 lines; `stageedit.html` 378 lines | — | — | Absent. |
| T14 | **Battle Test** | **Not on this branch.** Archive tag: `src/stage/battletest.ts` 197, `battleflow.ts` 720, `perform.ts` 682, `moves.ts` 477, `strike.ts` 176, `controls.ts` 71, and `src/data/moves.json` (21 kB, only on the archive) | — | — | Absent. Only the pure half exists: `src/battlestage/battledrive.ts` 518. |

Not tools: `src/sje-lab/devhook.ts`, `battlehook.ts` and `fieldhook.ts` are the game's DEV test hook on `window.__SJ__`. `devhook.ts` reaches `postfx` because the game does (`src/sje/boot.ts`). That is M8's.

**Counts.** 14 tools or tool parts. 12 exist on this branch. 2 are absent (T13, T14).

- **Depend on the old engine (5):** T6 and T7 (direct, value imports and `extends Scene`), T8 and T9 (direct, type imports, plus the game scenes they start), T2 (indirect, plus `LegacyShape`).
- **Do not (7):** T1, T3, T4, T5, T10, T11, T12.
- **Count of files in the tools:** 8 in `src/dev`, 18 in `src/sje-lab`, 5 viewer scenes in `src/scenes`, `src/devroutes.ts`, two HTML pages for the editors (`rigedit.html`, `artreview.html`) and two lab pages.

## 3. What opens, edits, saves and previews today, and what proves it

| Tool | Opens | Edits | Saves | Previews | Proof |
|---|---|---|---|---|---|
| T1 DEV menu | by hand | n/a | n/a | n/a | **No test.** `mountDevMenu` returns at once under Playwright (`devmenu.ts:39`, `navigator.webdriver`), so no spec can see it. The effects section is skipped under Playwright too (`sje-lab/devhook.ts:189`). |
| T2 FX lab | yes | yes | the dry run and the refusal of bad data. A real Save writes `src/data/fx.json`, so no spec presses it. | yes: a click fires `game.fx` | `e2e/fxlab.spec.ts` 3 tests (edit and Revert; invalid edit; endpoint dry run). CI shard 8/8 (`ci.yml:183`). Spells (`gpuSpell`) are not exercised. |
| T3 Animation editor | by hand | by hand | by hand. Endpoint `/__rig/skeleton` (`vite.config.ts:178`) has no dry run. | by hand | `tests/rigcheck.test.ts` checks the validator only. **No e2e.** |
| T4 Art review | by hand | by hand | by hand. Endpoint `/__artpass/review` (`vite.config.ts:103`) has no dry run. | n/a | **No test.** The data folder `media/art-pass/` is git-ignored, so CI would see an empty page. |
| T5 Art swap | by hand | n/a | n/a | by hand | **No test.** |
| T6 Art viewers | by hand | n/a | n/a | n/a | `e2e/shots.spec.ts:561-570` makes pictures of `mapview` and `chars`. It is local only (`tests/ci-shards.test.ts:21`). `portraits`, `bestiary`, `font`: none. |
| T7 Trailer | by script | n/a | records an MP4 | by script | **No test.** `scripts/trailer.mjs` is the only caller. |
| T8 Field show | yes | n/a | n/a | n/a | `e2e/sje-field.spec.ts` and the parity specs (CI). |
| T9 Dev routes | yes | n/a | n/a | n/a | `tests/devroutes-hack.test.ts`, `tests/devroutes-ticks.test.ts`, `e2e/sje-hack-*`. The other 9 cases: only through the specs above. |
| T10 Stage lab | yes | n/a | n/a | yes | `e2e/sje-stage-parity.spec.ts` (CI). |
| T11 Engine lab | yes | n/a | n/a | yes | `e2e/sje-canaries.spec.ts`, `sje-draws`, `sje-scene3d`, `perf`, `sje-bench` (CI except the last two). |
| T12 3D entry | yes | n/a | n/a | yes | `e2e/sje-hack-a` to `-d` (CI). |
| T13 Editor | no | no | no | no | The archive has about 81 e2e cases and about 112 unit cases. Static count of `test(` and `it(` calls on the tag: e2e 28, 22, 13, 7, 10 (`stageedit`, `polish2`, `polish3`, `round4`, `stagelab-edit`) = 80, plus 1 for the `for (const dpr of [1.25, 1.5])` loop in `polish3`; unit 35, 19, 20, 26 = 100, plus 12 for the `it.each` rows (6 in `stageeditpolish3`, 8 in `stageeditround4`, each less the one call counted). An earlier count of 89 and 102 could not be reproduced. Task 2 recounts with `npx playwright test --list` and `npx vitest list` on the ported files. None run here. |
| T14 Battle Test | no | no | no | no | The headless driver has `tests/battlestage-drive.test.ts`. The tool has nothing. |

Of the 12 tools that exist, 6 have a spec or a unit test that opens them and judges something (T2, T8, T9, T10, T11, T12). T6 has only a local picture script, which judges nothing. 5 have no browser test: T1, T3, T4, T5, T7 (T3 has a validator unit test). The ET exit check ("opens, edits, saves and previews") has no proof today for those 5 or for T6.

## 4. The ET exit check and what blocks it, tool by tool

The exit check (`migration.md` line 203): every existing tool opens, edits, saves and previews on the new engine, and the old-engine tool code is gone before M8.

| Tool | Blocks the exit check |
|---|---|
| T1 DEV menu | No old-engine code. Needs a proof (no spec can mount it). The Battle Stage Editor must get an entry in `tools.ts`. |
| T2 FX lab | (1) `LegacyShape` and `LegacyScene` (M8 deletes `LegacyScene`). (2) `gpuSpell` in `scenes/battlekit/gpufx.ts:43` calls the `postfx` singleton and `playMoment` of `engine/moments`. That file is the battle's own code, so the lab's closure holds `postfx` until the call takes the effects object as an argument. (3) The lab does not call `game.fx.loadData` (section 7). |
| T3 Animation editor | Nothing. A test is missing, and the endpoint has no dry run. |
| T4 Art review | Same as T3. |
| T5 Art swap | Nothing. A test is missing. |
| T6 Art viewers | All 5 `extends Scene` from `engine/game`. Each needs a new-engine base (their `render(ctx)` code is small: 215 lines in all). |
| T7 Trailer | `CardScene extends Scene`; `postfx.glowLayer()` at `trailer.ts:61` (the new route is `game.fx.glowLayer`). Also the value import of `autosavePolicy` from `../game/systems` (`trailer.ts:21`): that file imports the game scenes, so the trailer's closure holds `scenes/battle.ts` and `engine/moments`. The fix: move `autosavePolicy` into a small module with no engine import, or pass it in. **Decision 2026-10-13: Mark chose to delete T7 in ET, not to port it (#84). The fix above is no longer needed.** |
| T8 Field show | The `Game` type import. The reach into `FieldScene` stays: it is a game scene (M8). |
| T9 Dev routes | The `Game` type import, and the cast at `:24`. The starts of `FieldScene`, `BattleScene` and `PanelScene` stay (game scenes). |
| T10 to T12 | Nothing. |
| T13 Battle Stage Editor | Does not exist here. The port is the work. Notes in sections 6 and 7. |
| T14 Battle Test | Does not exist here. The shipped stage does not play the spike's move animations (`src/battlestage/live.ts:19`: "What is NOT here: the move animations of the spike"). The spike's Battle Test drives them from `moves.json` through `perform.ts`. That is a fork (brief decision 2). |

Two build files also name the old engine and are not in `src/`: `vite.config.ts:10` and `:69` load `/src/engine/fxdata.ts` (a shim, M8 deletes the path), and `scripts/pixellab/render-current.mjs:171` imports `/src/engine/game.ts` to read `W` and `H`.

## 5. ET and M8: where the line is

35 files outside `src/engine` import `engine/game`, `display` or `postfx`. 32 import `game`, 3 more import only `postfx` (`fieldstage/stagescene.ts`, `battlekit/gpufx.ts`, `battlekit/render.ts`), and 2 of the 35 also import `display` (`src/boot.ts`, `src/sje/boot.ts`).

| Area | Files | Whose |
|---|---|---|
| `src/scenes`: 15 game scenes that `extends Scene` (`title`, `menu`, `dialog`, `shop`, `options`, `deck`, `saveload`, `card`, `controls`, `ending`, `gameover`, `panels`, `placemap`, `battle`, `field`) | 15 | M8, with M4 if Mark wants a scene on the retained engine |
| `src/scenes/battlekit/{playback,stageseam,gpufx,render}.ts` and `fieldkit/fieldseam.ts` | 5 | M8 (`gpufx.ts` is also on the FX lab's path, section 4) |
| `src/fieldstage/{fieldopen,stagescene}.ts`, `src/battlestage/liveopen.ts`, `src/sje/boot.ts`, `src/boot.ts`, `src/game/systems.ts`, `src/story/newgame.ts` | 7 | M8 |
| **Tools:** the 5 viewer scenes, `dev/trailer.ts`, `dev/fieldshow.ts`, `devroutes.ts` | **8** (7 ported, `dev/trailer.ts` deleted, #84) | **ET** |

So 8 of the 35 are ET's and 27 are M8's. The FX lab (T2) is in neither list as a direct importer, and is ET's through `gpufx.ts`.

Other `src/engine` files, for M8: `canvas` (53 files outside the engine import it), `font` (32), `rng` (19), `color` (14), `errors` (12), `input` (9), `assert` (4), `fxdata`, `moments`, `shake` (2 each), `particles` (1), `perf`. `font`, `fxdata`, `rng` and `particles` are already one-line `export *` shims to `src/sje`. M8's exit scan ("nothing in `src/sje`, `src/hack3d`, `src/battlestage` or `src/art` imports `src/engine`") fails today on 8 files in `src/art`, 2 in `src/battlestage` (`demo.ts` for `rng`, `liveopen.ts` for `game` and `errors`) and 4 in `src/sje`. None of that is ET.

## 6. Bundle budget, and whether tools ship

`npm run budget` today (exit 0):

| Class | Measured | Cap |
|---|---|---|
| Game total, gzip, without `lazy-3d` | 455.7 kB | 456 kB |
| First play (boot + `lazy-2d`) | 395.4 kB | 395.9 kB |
| `lazy-3d` | 146.7 kB, 580.9 kB raw | 160 kB, 609 kB raw |
| Largest chunk | `boot` 344.9 kB raw | 480 kB |
| Lab `lazy-3d` | 143.7 kB | 160 kB |

- **The shipped bundle holds no tool code.** `dist/` has only `index.html` (the editors and labs are separate pages that `vite build` does not build; `vite.config.ts` has no multi-page input outside `--mode lab`). A scan of every `dist/assets/*.js` for `devmenu`, `__fxlab`, `FxLabScene`, `rigedit`, `artreview`, `__artpass`, `mountDevMenu` found none. The tool imports sit behind `import.meta.env.DEV` (`src/boot.ts:45`, `:204`, `:238`).
- **ET can only move the shipped total through game files it edits.** The only candidate is `scenes/battlekit/gpufx.ts` (section 4), a shipped game file. Which chunk holds it was not checked. The total has 0.3 kB of room and first play has 0.5 kB. A signature change should move bytes by tens, not kilobytes, and the budget run after the change decides.
- `dist/` and `dist-lab/` are git-ignored. The run changed no tracked file.

## 7. Editor contract (principle 11): the gaps per tool

(a) tunables in one documented object with data defaults; (b) content in JSON that loads and saves; (c) hot reload into a running game; (d) `snapshot()` and `restore()`; (e) a deterministic `step(n)`.

| Tool | (a) | (b) | (c) | (d) | (e) | Gap, and where it closes |
|---|---|---|---|---|---|---|
| T2 FX lab | `FxParams` exists (`src/sje/fx/fxsystem.ts`); the lab edits `fx.json` only | yes: `checkFx` before every write | **works by accident.** A save or an import calls `replaceFx` (`src/data/fx.ts:62`), which changes the shared `FX` object in place. `game.fx` holds that same object (`fxsystem.ts:213-216`, `this.data = d`; `src/sje/boot.ts:124`). The lab never calls `game.fx.loadData`. | exists on `FxSystem`, unused by the lab | exists, unused | Brief task: the lab calls `loadData` after each edit and shows its problems. Scrubbing and `FxParams` editing are new features: the Editor suite. |
| T3 Animation editor | `skeleton.json` | yes, checked by `src/art/rig2/check.ts` | no: the game reads `skeleton.json` at startup (`loadRigData`) | n/a | n/a | A pose is a pure function of the data. Hot reload closes with the Animation Composer (Editor suite). |
| T4 Art review, T5 Art swap | `review.json` | yes, no checker (`vite.config.ts` accepts any `{ assets }`) | `?art=review` reads it at game start | n/a | n/a | Same. |
| T13 Battle Stage Editor | stage, axes, facing, heroes and HUD JSON | yes: `loadStages`, `loadEntries`, `loadHud`, `loadAxes`, `loadFacing`, `loadHeroes` are in `src/battlestage` (`config.ts:578-943`, `facing.ts:76`, `proportions.ts:81`) | `BattleStageScene.loadStage` (`stagescene.ts:407`) | `snapshot` and `restore` (`:417`, `:436`) | `BattleDrive.step` (`battledrive.ts:364`) | The archive's save module (`edit/save.ts`) and its dev endpoint `/__stage/stages` are not here. The engine has no `Zone` or `pick` (only a type sketch, `src/sje/interfaces.check.ts:190`). Whether the editor needs them depends on `edit/overlay.ts` and `hit.ts`; task 1 reads them. |
| T14 Battle Test | the party and seed | n/a | n/a | n/a | the headless `step(n)` and `battleTrace(seed)` exist | Depends on decision 2. |
| T1, T6 to T12 | n/a | n/a | n/a | n/a | n/a | Read-only or harness pages. |

Two facts about the stage data. First, two sets exist: `src/data/stages.json` and `hud.json` (480x270) and `stages-640.json` and `hud-640.json` (640x360). The live game reads the 640 set (`src/battlestage/liveopen.ts:39-43`; `?stageset=480` is the dev switch). `axes.json`, `enemyfacing.json` and `heroes.json` are shared. The archive editor writes `stages.json` and `hud.json`. Second, the stage data is Mark's design data (principle 8): the editor writes it only when Mark presses Save, and tests run on the frozen copy in `tests/fixtures/stagedata/` (TOOLING-UI.md checklist 19).

## 8. Smaller facts

- **Dry runs.** Only the FX lab's endpoint has `?dry=1` (`vite.config.ts:38-100`). The animation editor's and the art review's endpoints write at once (`TOOLING-UI.md` checklist 13 asks for one each).
- **Write endpoints.** Three exist (`fxLab`, `artPass`, `rigEdit`), each guarded by `sameOrigin` (`vite.config.ts:20`). The editor adds a fourth, in the archive (`vite.config.ts` of the tag, lines 105 to 202). Only `/__stage/stages` writes: GET reads, POST saves up to five files in one Save (the HUD among them). `/__stage/hud` is GET only; a POST gets 405 and points to `/__stage/stages`.
- **The archive cases (about 81 e2e and about 112 unit)** are about 4,200 lines (specs 2,480; kit 169; unit 1,552). They test a Phaser page at 480x270.
- **M6 recorded two Pixi warnings** for any canvas smaller than 640x360 (`m6-brief.md` Record, fix round 1, "console"). An editor with side panels can show a canvas that small.
- **Tool code is in four places:** `src/dev`, `src/sje-lab`, `src/scenes` (the five viewers), and the root pages. ET moves the viewers into `src/dev` so one folder holds tools.
- **Not measured:** whether the shipped `boot` chunk size moves if `gpufx.ts` changes (section 6); the real behavior of T3 to T5 and T7 (no test runs them). The editor's need for engine hit testing and whether its page can run `BattleScene` are answered in section 9.


## 9. ET task 1 re-check (Builder A, 2026-10-13)

Method: the counts of sections 2, 4 and 5 re-run with a small import script (on the branch at `edcffb2`); the archive's `edit/overlay.ts` (200 lines), `edit/hit.ts` (77) and `edit/stageedit.ts` (1,065) read; one throwaway headless probe (a page, an entry and a Playwright spec, deleted after the run, not committed).

**Recount: every number in sections 2, 4 and 5 holds.** 35 files outside `src/engine` import `engine/game`, `display` or `postfx` (32 `game`, 3 `postfx` only, 2 also `display`); 8 are tool files (5 viewers, `trailer`, `fieldshow`, `devroutes`) and 27 are game files (15 scenes, 5 kit files, 7 boot and glue files). The 15 files of `src/engine`, the importer counts (`canvas` 53, `font` 32, `rng` 19, `color` 14, `errors` 12, `input` 9, `assert` 4, `fxdata` 2, `moments` 2, `shake` 2, `particles` 1), the M8 scan figures (8 files in `src/art`, 2 in `src/battlestage`, 4 in `src/sje`) and the line counts of the tool files match. The two build-file references are at `vite.config.ts:10` and `:69`; the import in `render-current.mjs` is at `:171` (its comment at `:169`).

| Survey or brief says | Check says | Effect |
|---|---|---|
| Section 4, T2: the FX lab reaches `postfx` through `gpufx.ts`, and an effects argument fixes it | `gpufx.ts` reaches the old engine twice: `postfx` (direct) and `playMoment` of `engine/moments.ts`, which calls the `postfx` singleton. An effects argument alone does not cut the second edge, and `postfx` has no `playMoment` method. | Task 3 moves the moment-playing loop of `moments.ts` into a new plain file, `src/engine/momentplay.ts`. It takes the effects object as an argument and imports `postfx` as a type only. `moments.ts` keeps its API and passes `postfx`. Every function of `gpufx.ts` takes the object as its first argument, and the 6 calls in `playback.ts` pass `postfx`. |
| Section 7, T13: whether the editor needs engine hit testing depends on `overlay.ts` and `hit.ts` | `hit.ts` and `overlay.ts` have **no** engine call (0 matches of `Phaser.` or `scene.`). `hit.ts` is pure geometry on game pixels. `overlay.ts` draws SVG over the canvas. The one engine hit test is `StageScene.pick(x, y)` (archive `stagescene.ts:599`): the fighter whose drawn pixels (alpha above 8, mirror aware) are under the point, the nearest first. `interact.ts:124` calls it. | **The editor needs a pixel pick and needs no engine change.** The new engine has no `pick`. But `BattleStageScene.figures`, `Figure.describe()` (group and body position, origin, `flipX`, frame, texture key, draw depth) and `TextureManager.readPixels(key, frame)` give all the inputs. The pick goes in the editor (`src/dev/stageedit/`), with an alpha cache per frame. Nothing in `src/sje/display/` changes, so pass line 11 is not triggered. Do not add `getPixelAlpha` to `TextureManager` (its header names it as "built later"): that would trigger line 11. |
| Section 7, T13 contract: the editor calls `loadStage`, `snapshot`, `restore` | The 24 `Phaser.` or `scene.` matches of `stageedit.ts` (on 21 lines) are `scene.applyStage` x2, `boxOf` x2, `fighters` x4, `setEditMode` x3, `setEnemies` x2, `setAxes`, `setFacing`, `setHeroes`, `setPhase`, `figureBoxesFor`, `enemySet`, `enemies`, `currentPhase` and `Phaser.Scale.Events.RESIZE`. | Maps to the new scene: `applyStage` becomes `loadStage` (it rebuilds the whole stage and has no `floorFrom`, so the floor's puddles may jump while a fighter is dragged); `fighters` becomes `figures`; `boxOf` becomes `geoOf`; `setEnemies(keys)` exists (the scene works out the set key). They go: `setEditMode` (the pick is the editor's) and `RESIZE` (the engine's `game.scale`). **No counterpart:** `setAxes`, `setFacing`, `setHeroes` (they are `BattleStageInit` fields: the editor makes a new scene when they change), `setPhase` and `currentPhase` (the HUD is a `Hud` built from `buildHudView(demo, setKey, phase)`), `figureBoxesFor` (the editor computes the boxes from `FigureArt`), `enemySet`. These are notes for task 5. No new engine API is needed. |

### 9.1 Can the editor page run the game's `BattleScene` over its own stage? (decision 2, option B)

**Yes. Evidence: a real probe, run twice, both green.** The probe was an HTML page with its own entry and **no** `src/boot.ts` game boot, as the editor page will be. The entry did what the stage editor's page must do:

1. `Game.create({ parent, input: new Input(window), dev: true, fxLevel: 'none', compat })`, then `game.fx.loadData(fx.json)` and `routePostfx(postfx, () => game.fx)` (the same lines as `src/sje/boot.ts:122-129`).
2. The party set as `devroutes.ts` does for `?scene=battle` (`state.party`, `createMember`).
3. `new BattleScene({ encounter: 'street', bg: 'street' })` (a dynamic `import()`), then `liveProvider.open(game, scene)` (the game's own stage provider, `battlestage/liveopen.ts`), then `scene.attachStage(stage)` and `game.run(scene)`, then 200 ticks.
4. The unsaved stage: a deep copy of `stage.config` with `party[0].x` moved by 40, then `stage.loadStage(edited)`, then 3 ticks.
5. A bad stage (`rows: []`) through `loadStage`.
6. The end: `scene.close('flee')`, `stage.close()`, 3 ticks.

Result: the top scene was `BattleScene` on the stage `street`. The hero figure's `x` went from 126 to 166 (the edited slot) after `loadStage`, and the HUD was built once. The bad stage threw and the figure stayed at 166. After the end the scene stack was empty and `liveStage()` was `null`. The page logged one "404" (the probe page had no favicon) and no warning, error or page error.

**How sure: high for the stop rule.** A running page, the real `BattleScene`, the real `liveProvider` and the real swap. The probe did not press keys, play to a win, or run seed 7 against `battleTrace(7)` (pass line 9, task 6).

**What the page needs (notes for tasks 5 and 6):**

- `BattleScene` extends the old `Scene` and imports `engine/postfx` and `engine/moments`. A tool file that imports `scenes/battle.ts` **by value** puts `engine/game`, `postfx` and `moments` in its closure, so **pass line 2 as written fails for Battle Test**. The line already excepts `fieldshow.ts` and `devroutes.ts` ("direct imports only: they start game scenes"). The same must hold for Battle Test. `tests/et-tools.test.ts` (task 2) treats `scenes/battle.ts` as a **game boundary** (M8's): a tool may reach it only through a dynamic `import()`, and fails if it imports it statically.
- The page must call `routePostfx(postfx, () => game.fx)`. That is a value import of `engine/postfx`, which a tool file may not hold. It goes in one small glue module that Battle Test loads with a dynamic `import()`, as `src/sje/boot.ts` does for the game. Task 6 writes it, and the test names the dynamic targets it allows.
- The swap leaves the save files alone: `liveProvider.open` loads the saved 640 set and the unsaved stage goes in through `loadStage` after it.
- To go back to the editor, `scene.close(...)` then `stage.close()` leaves an empty stack, so the editor can run its own `BattleStageScene` again.

**Corrections to the brief:** pass line 2 must name the game boundary for Battle Test (above). Pass line 11 stays clean: the pick and Battle Test need no engine change.
