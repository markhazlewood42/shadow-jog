---
type: plan
title: "Shadow Jog Engine — M7 survey of the 3D mode"
project: shadow-jog
created: 2026-10-12
updated: 2026-10-12
tags: [engine, m7, survey, 3d]
---

# M7 task 1: what 3D code exists, and what the plan depends on

Written before the build, for the builders and the runner. Every fact was counted on branch `engine-m7-3d-mode` on 2026-10-12 (grep and reads; the only run was `npm run budget`). The Phase 0 code was read with `git show spike/engine-platform:<path>` (the branch is not checked out). Part of [m7-brief.md](m7-brief.md).

## 1. Where the sources and the code disagree

| Source says | The code says | Effect on the plan |
|---|---|---|
| migration.md M7 and C12 (`decisions.md:84`, the spike cleanup row): "a hidden scene still draws its 3D frame; the scene manager works out visibility after `prerender`" | `SceneManager.prerender()` (`src/sje/runtime/scenemanager.ts:424`, first call at line 425) calls `refreshLayout()` first, then skips every scene with `!s.sys.visible`. `Scene3D` draws from its `prerender` event, so a hidden `Scene3D` already draws nothing. `tests/sje-runtime.test.ts:143` pins the generic rule | The skip is built (M1). M7 proves it for `Scene3D` and closes one gap: `prerender()` calls `refreshLayout()` a second time after the loop (line 435). A scene that closes inside its own `prerender` reveals the scene under it, and that scene did not run its `prerender` in this frame. See section 5 |
| migration.md and frame-and-rendering.md 7.4: "the watchdog waits 1 second" (C4) | M1b built `Scene3D` with **no grace**. `scene3d.ts:129` ends the scene with `context-lost` in the first draw after a loss. The `lost` flag never clears, so a restore cannot save the scene. `contextGraceMs` and `CONTEXT_GRACE_MS` exist only on the spike branch | M7 re-adds the grace (section 6). The 1 s value of C4 is a design fact, not code |
| interfaces.md section 12: `ScriptApi.hack(def): Promise<HackResult>` | The same section builds `hackWithPolicy` that returns a `HackOutcome` with `via: 'dropped'`. A story that gets a raw `HackResult` must run the E19 policy itself | Open decision D4 in the brief |
| migration.md M1b: the `unsupported / no-webgl2` check is "on the legacy path" | After the M6 flip no legacy path exists. A browser without WebGL 2 never starts the game (E5), so a booted game cannot see `no-webgl2` by itself | The check runs on the door with its `DoorEnv` seam (section 4). Pass line 6 |
| M6 record: "`Date.now()` seeds in `sje-battle` and stage parity specs unchecked" | `sje-battle.spec.ts:79-82` uses `Date.now()` only as a polling bound. `sje-stage-parity.spec.ts` passes explicit seeds. The game seeds `streams` from `Date.now()` at load (`src/sje/core/rng.ts:67`; `src/engine/rng.ts` re-exports it; noted in `default-path.spec.ts:45`) | Not on the M7 path: a hack seeds from `def.seed` and does not use `streams`. Stays a carry item |
| The spike HUD and look are "480x270" | `src/hack3d/hud.ts` on the spike has `STRIP = { edgeY: 253, y: 254, h: 16, textY: 257 }` and a 124 px panel for a 270 px high picture. The game is 640x360 now (`W`, `H` in `src/sje/core/size.ts`) | The HUD layout must derive from `H`. `tests/screen-literals.test.ts` forbids a new 640, 360, 320 or 180 literal. The camera aspect is 16:9 in both, so `look.ts` does not change |

## 2. What the engine already has for 3D (M0, M1b)

| File | Lines | What it gives |
|---|---|---|
| `src/sje/three/frame3d.ts` | 384 | `createFrame3D`, both modes (`shared-context`, `canvas-copy`), `contextLost`, `releaseGpuData`, `rewrap`; the shared frame marks itself stale on `restored` and rewraps in the next `render()` (stale at line 242, rewrap at line 258). A restore needs no scene code |
| `src/sje/three/threehost.ts` | 87 | `ThreeHost.shared(gl)`, one renderer for the page, `hostsCreated` counter |
| `src/sje/three/scene3d.ts` | 146 | `Scene3D`: `create3D`, `update3D`, `sync3D`, `abortResult`, `endEarly`; fields `world3D`, `camera3D`, `bloom`; options `{ frame, makeFrame }`; draws in the `prerender` event; frees the frame before the Three objects |
| `src/sje/three/dispose.ts`, `index.ts` | 44, 12 | `disposeObject3D`, `releaseGpuData`; the facade of the lazy chunk |
| `src/sje/display/view3d.ts` | 61 | `View3D`, the sprite over the frame texture |
| `src/sje/index.ts` | | exports `probeWebGL2`, `Rng` (core), the font (`display/font`), `ImageObject`, `Graphics` |
| `src/sje/runtime/game.ts:252-258` | | `Game.contextLost`, `Game.dropCount`, `contextlost` and `contextrestored` events |
| `src/sje-lab/cubescene.ts`, `threelab.ts` | 169, 535 | The M1b cube scene and the lab's 3D test hooks. Lab page only |
| `tests/sje-scene3d.test.ts`, `e2e/sje-scene3d.spec.ts`, `e2e/sje-canaries.spec.ts` | 431, 368, 682 | Lifecycle, cube pixels, determinism, 10-cycle leak, context loss, no WebGL 2, filter and iris, crisp pixels, hand-off canaries. All run on the **lab page**, none on the game page |

Not built: `src/hack3d/` does not exist. `ScriptApi.hack`, `fieldHooks.hack`, `HackOutcome`, `HackDef`, `makeHackDef` and the door are not in the tree. `grep -rn "\.hack(" src e2e tests` finds nothing.

## 3. The Phase 0 code to port (`spike/engine-platform`)

| File on the spike | Lines | What changes in M7 |
|---|---|---|
| `src/hack3d/result.ts` | 101 | `HackResult`, `HackDef`, `HackPolicy`, `decideHack`. Pure, no Three. Moves almost as it is. `HackResult` is also defined in `src/sje/three/scene3d.ts:39`: one definition must win |
| `src/hack3d/door.ts` | 104 | `hackDoor`, `hackWithPolicy`, `loadChunk` (the one `import('./index')`), `DoorEnv`. Uses `probeWebGL2`, `game.contextLost`, `game.dropCount`: all exist today |
| `src/hack3d/index.ts` | 41 | `startHack(game, def, options)`; maps abandon to `aborted / user` and a `create` throw to `aborted / error` |
| `src/hack3d/hackscene.ts` | 118 | Written for the **Phase 0** `Scene3D`: it uses `threeScene`, `camera`, a `createHud()` hook, a `dispose3D()` hook and a `started` getter. Today's `Scene3D` has `world3D`, `camera3D` and none of the three hooks. The scene is rewritten against the built class |
| `src/hack3d/look.ts` | 217 | Builds the Three objects once. Flat colors, short grid segments. No literal for the picture size |
| `src/hack3d/hud.ts` | 179 | Imports `drawText`, `measure` from `../engine/font`. The font is in the facade now (`src/sje/display/font.ts`). Layout numbers are for 270 px (section 1) |
| `src/hack3d/sim/hacksim.ts` | 182 | Pure and seeded. Imports `Rng` from `../../engine/rng`. Today `src/sje/core/rng.ts` owns it. It has `step()` but **no** `snapshot()` or `restore()` (editor contract item d) |
| `src/hack3d/colorprobe.ts` | 41 | A color test scene. The lab canary `e2e/sje-canaries.spec.ts:620` already checks `#ff2080`. Not ported unless a pass line needs it |
| `tests/hack3d-{sim,result,hud,dispose}.test.ts` | 177, 254, 65, 114 | Port. The `hud` and `dispose` tests change with the scene |
| `e2e/sje3d.spec.ts`, `e2e/sje3d-browsers.spec.ts` | 1082, 180 | Source of the game-page cases: story bridge (line 383), fallback (520), lifetime (841), canary (889), speed (942). The lab already holds the picture, color and crisp cases |

## 4. Import and seam rules that block the door

- `tests/sje-imports.test.ts:159` says no file in `src/` outside `src/sje`, `src/sje-lab` and `src/hack3d` may import a path that matches `hack3d`. So `src/game/systems.ts` and `src/scenes/fieldkit/api.ts` cannot reach the door today. M7 adds one seam file (the M5 pattern, `fieldseam.ts`) that imports only `src/hack3d/door.ts` and `result.ts`, and the rule is widened for that file alone.
- `src/hack3d/door.ts` and `result.ts` must not import Three (they are in the start path). `src/hack3d/index.ts` is reached only by the dynamic import in the door.
- `src/hack3d/sim` must not import `src/engine` (M8 deletes it). `Rng` comes from `src/sje`.
- `ScriptApi` is implemented once, in `src/scenes/fieldkit/api.ts` (177 lines): `battle` at line 61 and `shop` at line 155 call `fieldHooks`. `hack` follows them. `src/game/systems.ts` installs the hooks and types `game` as the old `Game`; the runtime object is the new `Game` (`bootGame(game as unknown as OldGame, ...)` in `src/sje/boot.ts:123`), so the hook casts once, as `src/devroutes.ts:23` does for the FX lab.
- After M6 a booted game always has WebGL 2. `probeWebGL2()` keeps one probe context once it succeeds (`glcontext.ts:71`), so a test cannot make it return `false` in a booted page by patching `getContext`. The door takes the probe as a `DoorEnv` argument for that reason.

## 5. The hidden-scene draw skip

- Visibility: `computeVisibility` (line 51) finds the topmost opaque scene; scenes under it are hidden. `refreshLayout` writes `s.sys.visible` only when something changed.
- `prerender()` order: `refreshLayout()`, then for each scene bottom first `emit('prerender')` if visible, then `cameras.apply()`, then `refreshLayout()` again.
- Cases: (a) a cover opens or closes in `tick` or in a script: the first `refreshLayout()` sees it before any scene draws. No stale frame. (b) A scene closes inside its own `prerender` handler (today a `Scene3D` that lost its context does exactly this, `scene3d.ts:132`): the second `refreshLayout()` shows the scene under it, which was skipped as hidden in this loop. Its `View3D` shows the texture from before it was hidden, for one frame. This is the stale frame of migration.md.
- **Does the trigger survive M7?** Under D3 option A the context-loss close moves to a grace timer, so it runs outside `prerender` and the second `refreshLayout()` shows nothing new. `HackScene` closes from `update3D` (a tick), which the first `refreshLayout()` catches. So after M7 no shipped scene closes inside its own `prerender`. The gap stays real for D3 option C, for a future scene, and for a test scene built to do it. The pixel case of pass line 11 uses such a test scene.
- `update3D` still runs for a hidden `Scene3D` unless the cover sets the scene paused (`passUpdate` is false by default, `scene.ts:84`). Not a draw cost, and the test scene has no cover. Noted in the brief risks.
- No test covers a hidden `Scene3D` today (`grep -n "hidden\|opaque" tests/sje-scene3d.test.ts e2e/sje-scene3d.spec.ts` finds nothing).

## 6. The context grace

- Spike `Scene3D`: `CONTEXT_GRACE_MS = 1000`, option `contextGraceMs`, a timer started at loss and cleared at restore. After the timer, `endEarly('context-lost')`. Measured loss to result: 1,015 to 1,034 ms on the RTX 4070, SwiftShader and the canvas-copy path.
- Built `Scene3D`: no timer, no restore path. `lost` stays `true`; `gpuReleased` is set once and never reset, so a second loss would not release Three's GPU data again.
- The pass line from the research doc is "the hack resolves within 2 seconds of the loss". A grace of 2 s plus the draw delay breaks it. The brief keeps 1 s as the recommendation (decision D3).
- `e2e/sje-scene3d.spec.ts:204` ("on the real 60 Hz loop the scene ends by itself within 2 seconds of the loss") passes today with an end at the first draw. With a grace it measures about 1.0 s.

## 7. Budget numbers (`npm run budget`, 2026-10-12, this branch)

| Measure | Game build | Cap |
|---|---|---|
| Total JavaScript, gzip | 451.9 kB | 452 kB (0.1 kB of room) |
| First play (boot + lazy-2d), gzip | 391.6 kB | 392.4 kB (0.8 kB of room) |
| Largest game chunk, raw | 363.2 kB | 480 kB |
| Class `lazy-3d` in the game build | 0 kB (no Three in the game) | none today: the 160 kB check runs only `if (lab)` (`bundle-budget.mjs:27-35`, check 4) |
| Class `lazy-3d` in the lab build | 137.8 kB gzip, 554.2 kB raw (`threelab`) | 160 kB (C5; the only place it is checked) |

- `scripts/bundle-budget.mjs` check 2 fails the build if **any** game chunk holds Three ("the game does not load the 3D mode before M7"). M7 inverts it: Three may sit only in a `lazy-3d` chunk, and that chunk must exist.
- Check 3 applies the 480 kB raw cap to every game chunk. The lab's Three chunk is already 554.2 kB raw, and the spike measured the chunk with `hack3d` at 145.1 kB gzip. The game's Three chunk will fail check 3 unless the rule changes. `vite.config.ts:303` sets `chunkSizeWarningLimit: 480` too (a warning only).
- The door and the result file add code to the start path, so `first play` grows by an estimated 1 to 2 kB. Only the first build can measure it. The 0.8 kB of room will not hold.
- The `lazy-3d` chunk of the game will hold Three, `UnrealBloomPass`, `Frame3D`, `Scene3D`, `ThreeHost` and `src/hack3d` (look, HUD, scene, sim). Estimate: 143 to 146 kB gzip. Headroom under 160: about 15 kB.
- Largest-chunk check, `vite.config.ts` has no `manualChunks` or `codeSplitting` (check 5 forbids them): Three stays one chunk reached by the one dynamic import.

## 8. How a game reaches 3D, and how tests can reach it

- A story reaches 3D only through `s.hack(...)`. `src/story/chapter1.ts` (615 lines) has no hack beat. It calls `s.battle` six times and `s.endChapter` once.
- DEV scenes: `src/devroutes.ts` (`runDevScene`, loaded only in DEV) has 10 routes (`fxlab`, `stage`, `field`, `battle`, `mapview`, `portraits`, `bestiary`, `chars`, `font`, `panels`). A `?scene=hack` route fits there.
- `window.__SJ__` exists only in DEV builds (`src/boot.ts:46`). `e2e/prod.spec.ts:49` asserts it is absent in the preview build. So a prod test cannot call a hack. It can load the built 3D chunk by its hashed name, and it can watch requests.
- The perf spec has the 3D speed line on the **lab** page only (`e2e/perf.spec.ts:176-241`): cube plus bloom, with a negative control. The game page has no 3D perf case.

## 9. CI and test plumbing

- `docs/CI.md`: `check`, eight `e2e (n/8)` shards, the `e2e` gate, `e2e-engines`. `tests/ci-shards.test.ts` fails on a spec that is in no shard list and not in `NOT_IN_CI`.
- Shard totals (CI.md): 1/8 364 s, 2/8 362, 3/8 367, 4/8 355, 5/8 336 plus `sje-scene3d` (not measured), 6/8 349, 7/8 351, 8/8 354. The smallest measured total is 6/8 (349 s). 5/8 already holds `sje-scene3d`.
- `e2e/sje-canaries.spec.ts` and `e2e/sje-scene3d.spec.ts` are in shards 4/8 and 5/8 and use the lab page (`sjelabkit.ts`). They stay as they are.
- The spike's `e2e/sje3d.spec.ts` ran on the lab of that time. The M7 game-page cases need the game's DEV hook, not `openLab`.
- `scripts/sjestage-refs.mjs:57` still looks for `spritefusion-tests/extracted/kit-battle-idle/metadata.json` in the Phaser checkout. The crew moved to `public/art/crew/` (M6, decision 60). Stale, not on the M7 path.

## 10. What the next step must re-check

- Task 1 of the brief re-counts sections 1, 5, 6 and 7 with a run: the hidden-scene case (b) as a failing test, the budget with a stub door, and the spike `HackScene` against `tsc` on today's `Scene3D`.

## 11. Transitions: what exists, and what could stall one

- **The Phase 0 entry was a cut.** The spike's `startHack` (`src/hack3d/index.ts`) is `new HackScene(def, options)` and `game.run(scene)`. `e2e/sje3d.spec.ts:247` ("no flicker on entering or leaving") only requires that no frame is mostly one color (worst measured 41 to 43%, line 0.6). A comment in it says the shader hitch is hidden "behind a transition". None exists in the repo or on the spike branch.
- **The door stalls with the field unstyled.** `hackDoor` awaits `env.load()` (the dynamic import) with the field still on screen and running. The load has no time bound: a request that hangs never rejects, so the story waits for ever. Only a rejection gives `chunk-failed`.
- **Precedent, the battle intro** (`runBattle`, `src/game/systems.ts:354-360`): `snapshotScreen`, `game.flash('#ffffff', 12)`, then `Promise.all([loadBattle(), game.wait(18)])`. The load overlaps a flash. When the load is slower than 18 ticks, the screen is the plain field again. The `ShatterIntro` (`src/scenes/battlekit/intro.ts`, `INTRO_T` 52) draws the frozen snapshot.
- **Camera and game fades** (`src/sje/display/cameraeffects.ts`, `game.fadeTo/fadeOut/fadeIn(frames, color)`, `game.flash`, `game.shake`): tick-driven, deterministic, one full-screen `Graphics` wash above the world and below `ui` (depth 1,999,999). Not gated by `fxLevel`.
- **Display effects** (`src/sje/display/effects.ts`): `createEffect` (a custom GLSL filter on a `GameObject`), `FilterList`, `addMask` (the iris of M1b). Not gated by `fxLevel`.
- **`FxSystem`** (`src/sje/fx/`): `glitch`, `aberrate`, `shock`, `haze`, `dim`, `flare`, `emit`, with `step(n)`, `snapshot()`, `restore()` and a seeded visual stream. Levels: `full` (composite filter, glow chain, all calls), `lite` (what `auto` picks on software GL: the calls are recorded, but nothing is drawn by a composite filter, `fxsystem.ts:12`; particles and the dim sprite are drawn), `none` (every call is a no-op). The gate in code is `!this.active` (`fxstate.ts:178`, `:186`, `:196`, `:203`), not the level name. Moments are data in `src/data/fx.json` (layer kinds `emit`, `shock`, `aberrate`, `flare`, `haze`, `glitch`, `dim`), and the FX lab edits them.
- **State under the hack.** `SceneManager.tick` marks every scene under the top running scene `paused` unless `passUpdate` is set, and `refreshLayout` hides it under an opaque scene. The field is not destroyed, so its map, leader and flags stay. Effects in `FxSystem` are global, not per scene, so a transition must clear its own layers.
- **First 3D frame.** `Scene3D.create` builds the frame and adds `frame.sprite`. The first `frame.render()` is in the first `prerender` (the private method `draw3D`, `scene3d.ts:126`; the task text calls it `drawFrame`, which does not exist on this branch). The door (`src/hack3d/door.ts`), `startHack` and `HackScene` exist only on `spike/engine-platform`, not in this tree. Before it, the render target holds nothing drawn. First entry compiles shaders: 96 ms (RTX 4070) and 167 ms (SwiftShader). Later entries take 12 to 54 ms (frame-and-rendering.md 7.5).
- **Consequence for the plan:** the transition needs (a) the chunk load to start with it, (b) a bound on the hold, (c) a first render under the cover, (d) its layers cleared at the end, and (e) a defined look at each of the three `fxLevel` values. Brief section 3 D5 and pass lines 19 to 25.

## 12. Task 1 re-check by runs (Builder A, 2026-10-12)

Sections 1, 5, 6 and 7 were re-checked by running code, not by reading. Commit before the check: `4f8490a`. Everything below was reverted or turned into a test.

| Claim | Run | Result |
|---|---|---|
| 5 case (b): a cover that closes inside its own `prerender` leaves the scene under it stale for one frame | Two unit cases, both with the cover closing itself in its `prerender` handler: `tests/sje-runtime.test.ts` (a counting scene) and `tests/sje-scene3d.test.ts` (a `Scene3D` on a fake frame). Un-skipped for one run | **Both fail: `prerenders` and `renders` are 0 where 1 is wanted.** The gap is real. They are committed with `it.skip` and a comment, and task 5 turns them on. Case (a) (a cover that closes in a tick) and "a hidden `Scene3D` calls `frame.render` 0 times over 30 draws" pass today, so the skip itself is built |
| 6: `Scene3D` has no grace and no restore path | 9 new grace cases with fake timers in `tests/sje-scene3d.test.ts` | **8 fail** before task 4 (no timer, `lost` never clears, `gpuReleased` never resets, no `contextGraceMs`). The 9th (a loss never ends inside the event) passes |
| 7: budget with a stub door | Spike `src/hack3d/*` copied in, plus one line in `src/game/systems.ts` that keeps `hackDoor` reachable; `npm run budget`; both reverted | See the numbers below |
| The spike `HackScene` against today's `Scene3D` | `npx tsc --noEmit` with the spike `src/hack3d` copied in | 12 errors, listed below |

**Spike compile errors** (all in `colorprobe.ts` and `hackscene.ts`; `door.ts`, `index.ts`, `look.ts`, `hud.ts`, `result.ts` and `sim/hacksim.ts` compiled as they were):

- `create3D` is `protected` in the spike classes and `public` (abstract) in today's `Scene3D` (TS2415, 2 files). Fix: `create3D(): void` public.
- `this.threeScene` does not exist (TS2339, 3 uses). Fix: `this.world3D`.
- `this.camera` does not exist (TS2551, 3 uses). Fix: `create3D` makes a `PerspectiveCamera` (`look.ts` builds it, aspect `W / H`) and sets `this.camera3D`.
- `override createHud()` and `override dispose3D()` are not in the base class (TS4117, TS4113). Fix: task 4 adds both as optional hooks to `Scene3D`.
- `this.started` does not exist (TS2339). Fix: task 4 adds a `started` getter to `Scene3D` (true once `create` has finished).
- Not an error but wrong: `hud.ts` has `STRIP` at 253/254/270 (a 270 px picture), and `hud.ts` and `hacksim.ts` import `src/engine` (font, `Rng`). Fix: the layout derives from `H`; the font and `Rng` come from `src/sje`.

**Budget with a stub door** (spike `door.ts` + `index.ts` + `HackScene`, game build):

| Measure | Base | With the stub | Delta |
|---|---|---|---|
| `lazy-3d` (`hack3d-*.js`) | none | 140.5 kB gzip, 560.9 kB raw | new; the 160 kB cap holds with 19.5 kB of room (estimate was 143 to 146 kB) |
| Total JavaScript gzip | 451.9 kB | 597.8 kB | +145.9 kB (3D chunk 140.5 + 5.4 in the start path) |
| First play (boot + lazy-2d) gzip | 391.6 kB | 397.0 kB | **+5.4 kB, not the 1 to 2 kB estimated** |
| Largest chunk, raw | 363.2 kB | 560.9 kB (the 3D chunk) | check 3 fails, as the survey said |
| Check 2 (Three in a game chunk) | ok | fails | as the survey said |

- **Where the +5.4 kB comes from.** It is not the door and not the facade: with the door importing only `probeWebGL2` from `render/glcontext` and `type Game`, first play was 397.3 kB. A new shared chunk `sje-*.js` (20.6 kB raw, 6.8 kB gzip, was 3.0 / 1.5) now holds `display/view3d.ts`, `render/frametexture.ts`, `display/lights.ts` and eight Pixi WebGPU texture-upload modules (`GpuTextureSystem`, `ExternalSource`, ...). Rolldown moves modules that both the engine chunk and the 3D chunk use into a common chunk that the engine imports statically. Before the 3D chunk existed, `ExternalSource` was not reachable from the game, so tree shaking left it out. This is the real cost of the 3D chunk on the start path.
- **For task 8.** Set the first-play cap from a build with the real door, and look at this chunk. A way to cut it is to keep `view3d.ts` and `frametexture.ts` out of the engine chunk's reach (only `lights.ts` needs a check: it names `ExternalFrameTexture`), if that is possible without a named group (check 5 forbids one).
- The 3D chunk holds `src/sje/three/*`, `src/sje/core/runall.ts` and `src/hack3d/*` only. No game module is in it.
