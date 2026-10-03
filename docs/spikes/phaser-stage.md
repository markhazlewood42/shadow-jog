# Spike: Phaser tooling spike (the side-view battle stage and its editor)

Branch `spike/phaser-stage` (draft PR, never merged), checked out next to the main project at `projects/shadow-jog-phaser`. Plan and background: `docs/PHASE-0.2.md` (decision 6 and the "How the three fit together" update), on the release-prep branch until it merges. Builds on `spike/side-battle` (the side-view spike) and its stage design (`docs/spikes/side-battle-stage.md` and `docs/spikes/stage-configs/`, coming from that branch).

## Question
If the new side-view battle stage is built natively in Phaser 4 with an in-game edit mode, can Mark design battle stages himself (horizon and floor, hero and enemy positions on depth rows, HUD layout, then a battle test), and is Phaser a better base for a "Shadow Jog Engine" toolset than the current engine?

## Why now
Mark asked (2026-10-02) for tools to make battle-design calls himself, like RPG Maker's troop placement view and battle test, instead of agents iterating on layouts by hand, and whether Phaser makes a bespoke toolset easier. Agent judging plateaued at about 7/10 on exactly these taste calls. Phaser keeps a list of on-screen objects with positions and depth and makes them draggable with a setting, so an edit mode can live inside the real battle scene; on the current immediate-mode engine every tool has to build its own hit-testing and preview. Building the editor on the current engine first would mean building its object layer twice if we port. Getting it wrong costs either a port that doesn't pay off, or tools built on a base we later leave.

## Time box
About 4-6 working sessions of Claude time. The box closes **2026-10-09** whatever state the spike is in. Step 1 is built to fail fast.

## Exit criteria (written before any code, dated 2026-10-02)
- GO if all of these hold:
  - **Mark can design a stage himself:** open the editor, move the horizon and floor, drag the four heroes and the enemies onto depth rows (overlap order and floor shadows follow automatically), move or switch the HUD layout, save, and press battle test to play a real fight on that stage, without agent help. Save-to-battle-test takes under a minute.
  - **What you drag is what the game draws:** the edit mode runs inside the same scene the battle uses, not a separate preview.
  - **The battle is real:** the fight is driven by the existing battle engine (`src/battle`, unchanged), and Rook's strike plays from Mark's Sprite Fusion frames with the lunge, hitstop and hit effect.
  - **It runs well:** 60 fps with the crew, four enemies and effects; frame time p95 under 6 ms on this machine; the spike's tests run in CI (including whatever GPU-less runners do).
  - **It is a base worth building on:** the judges (engineering and design lenses) and Mark would rather build the next tools (animation composer, troop editor, maps via Tiled) on this than on the current engine, with the reasons written down.
- NO-GO if any of these happens:
  - Getting Phaser to show the crew on a stage from a stage config takes more than 2 sessions (step 1).
  - Edit mode can't be what-you-see-is-what-you-get without a separate preview path.
  - Phaser 4 gaps (bugs, missing docs, v3-only answers) cost more than a session in total.
  - It can't run in CI.
- Informational, not gates: bundle size (Phaser is about 350 kB gzipped; Mark's dependency policy allows it), how Phaser's filters compare with our bloom, how much of the current renderer could be reused.

## Steps
1. **Shell and stage (fail-fast):** a separate DEV-only entry (for example `/stagelab.html`) running Phaser 4 at 480x270 with integer scaling and pixel-art settings; load a stage config (the side-view spike's StageConfig format) and draw the backdrop with its 3/4 floor, depth rows, contact shadows and depth sorting; Mark's four heroes (Sprite Fusion idle loops) on the left facing right, enemies on the right.
2. **Edit mode:** toggle edit; drag heroes and enemies (snap to depth rows, live overlap order and shadows), drag horizon and floor handles, move HUD regions or pick a HUD preset, a small settings panel (Tweakpane, MIT) for numbers; save to `src/data/stages.json` through a Vite dev plugin, the same way the FX lab saves `fx.json`; load the saved stage back.
3. **HUD:** the side-view HUD from the stage design (turn order, commands, party status) as Phaser objects whose regions come from the config.
4. **Battle test:** run a real fight on the stage through `src/battle`, with Rook's strike from Mark's frames (lunge, smear, hitstop, hit effect) and a basic hurt reaction.
5. **Measure and compare:** frame time, bundle size, CI; lines of code for shell, stage, editor; a written comparison with what the same editor would take on the current engine.
6. **Result:** fill in below; Mark decides GO / NO-GO.

## Assets and cost
- Phaser 4.2.1 (MIT, free) added as a dependency on this branch only; Tweakpane (MIT, free) if used.
- Mark's Sprite Fusion sprites are loaded from his local `spritefusion-tests/` folder through the DEV server only (a link in this checkout points at the main checkout's folder); they are never copied into a tracked path or committed.
- No paid services.

## Step 1 notes (2026-10-02, round 1)
What was built: the stage lab at `/stagelab.html` (DEV only; listed in the DEV tab as "Stage lab (Phaser spike)"), Phaser 4.2.1, 480x270, pixel-art settings, Scale Manager in NONE mode with a whole-number zoom that re-fits on resize (2x at 960x540, 3x at 1500x900, 4x at 1920x1080).
Files: `src/stage/config.ts` (types, validator, helpers, no Phaser), `src/data/stages.json` (stage "street": horizon 124, floor 150-266, four depth rows with optional per-row tint, four party slots, enemy slot sets for 1-4, shadow), `src/stage/textures.ts` (asset pipeline), `src/stage/feet.ts` (foot anchors from pixels), `src/stage/idle.ts` (the game's enemy idle sway as a pure function), `src/stage/stagescene.ts` (the scene), `src/stage/lab.ts` (entry and the `window.__stagelab` test hook), `src/stage/metrics.ts` (frame timing), `stagelab.html`.
How it draws: the street backdrop and its neon glow from `battleBg('street')` are composed at 2x with nearest-neighbour onto one 480x270 canvas texture, the foreground rails are a second texture drawn over everything; the enemies come from `enemyArt` (the punk twice as two different individuals, and a glowrat) washed with the backdrop's ambient tint and given the glow layer; Mark's four idle sheets load through Phaser's loader using each sheet's `metadata.json` and loop at their own fps (8).
Pixels: the crew draw 1:1; the human enemies draw at 2 screen pixels per art pixel (that is how the game itself draws them: painted at its 240x135 world scale and shown at 2x) and the creatures at 1:1. So the brief's "canvas pixels are screen pixels" holds for the glowrat but not the punks, and the punks look chunkier than the crew. This is the game's own mixed grain (see CONCEPTS, "Shrinking pixel art"), not something the pipeline adds; deciding what to do about it is a design call for a later step.
Feet: Rook's cell is 79x68 and the others 64x64, and every figure fills its cell differently, so each sprite gets its origin from the pixels (`footAnchor`: the heavy group among the lowest rows' columns, averaged over the loop, and the lowest sole row). A slot's x,y is then where each one stands, for all four.
Depth: `depthFor(y, x)` (nearer draws on top, ties to the right) is the sprite's depth; its contact shadow (a pixel-art ellipse with a stippled rim) is `depth - 0.5`. Row tints are Phaser multiply tints.
The fixed step: `update` feeds an accumulator and runs `tick()` once per 1/60 s (at most 5 catch-up ticks, then the backlog is dropped). Today `tick` only moves the enemies' idle sway; the battle replay will run there.
Ready for edit mode: each fighter is a `Fighter` record (sprite, shadow, slot); `place(fighter, slot)` re-places one and `applyStage(config)` re-lays everything out from a changed config; sprites carry a `fighterId` data tag for pointer picking.
Stand-ins: Mark's sheets are git-ignored, so on a machine without them (CI) the lab draws code-made block figures through the same pipeline and says so on the page and in `__stagelab.standIns`; `?standins` forces that for testing.
Tests: `tests/stageconfig.test.ts` (loader and validator, the shipped file, draw order, tints) and `tests/stagefeet.test.ts` (foot anchors on made-up frames and on Mark's real sheets where present, idle sway, percentile and frame stats); `e2e/stagelab.spec.ts` (real assets, no console errors, non-blank, whole-number zoom and resize, every texture NEAREST, every 4x4 block of a zoom-4 screenshot one flat colour, whole-pixel positions, two scene restarts without stale fighters or extra textures, the stand-ins, the forced canvas renderer, timing) and `e2e/stagelab-nogl.spec.ts` (a browser with WebGL switched off falls back to Phaser's canvas renderer and still draws). Screenshots go to the OS temp folder (`STAGELAB_SHOTS`), never the repo; `STAGELAB_MEDIA=<folder>` writes the judges' pictures.
CI: the bundled Chromium revision this Playwright wants (1243) is not installed on this machine and installing it is a download, so `CI=1` runs were not done here. Checked instead on Edge: normal GPU, `--disable-gpu` (software WebGL, which is what a GPU-less runner gives: Phaser AUTO picks WEBGL and everything passes) and `--disable-3d-apis` (no WebGL at all: AUTO falls back to CANVAS and the stage still draws and passes). The e2e does not skip without Mark's folder, it uses the stand-ins.
Numbers (this machine, Edge, dev server, warm unless noted): first frame 360-440 ms after navigation (593 ms right after clearing Vite's dependency cache); 286-301 frames in 5 s; frame interval p50 16.7-17.5 ms and p95 16.7-18.2 ms; CPU work per frame (update plus draw calls) p50 0.1 ms and p95 0.2-0.3 ms, with or without the GPU flag (software GL work runs on another thread, so this number does not show it). Against the 6 ms p95 criterion that passes by a wide margin, but it is a quiet scene with no effects or HUD yet.
Size: a separate test build of the lab (`node scripts/stagelab-size.mjs`, scratch folder) is 1,474 kB raw and 390 kB gzip in all: Phaser 1,374 kB raw and 356 kB gzip (about the 350 kB expected), the lab's own code plus the art generators it reuses 99 kB raw and 34 kB gzip. The shipped build is unchanged: building the base commit and this one gives the same five chunk file names (content hashes) and sizes, and none contains Phaser. The bundle budget already reads "exceeded" (239.8 kB of 236 kB gzip) on the base commit, so that is the side-battle spike's growth and not this step's.
Phaser 4 surprises: (1) with `pixelArt: true` every texture's `scaleMode` still reads the default (0, "LINEAR") because the renderer decides on `antialias: false` instead, so reading the property proves nothing; every texture here is set to NEAREST explicitly and the screenshot test is the real proof. (2) The migration guide says `roundPixels` defaults to false and only rounds unscaled, axis-aligned objects, while the config docs say `pixelArt` turns it on; the 2x-scaled punks still land on whole pixels because their positions are whole numbers. (3) `MAX_ZOOM` is worked out once at start, so the zoom has to be re-fitted on the Scale Manager's `resize` event (only when it changes, or `setZoom` fires the event again forever). (4) A restarted scene is the same object, so anything it remembers (our fighters list) must be reset in `init`; the loader's listeners are cleared on shutdown but the texture list and the animation list are game-wide, so each texture, sheet and animation is guarded by an exists check. (5) `Create.GenerateTexture` and `textures.generate` are gone in v4, so the stand-in sheets are drawn on a canvas and added with `addSpriteSheet`. (6) `import Phaser from 'phaser'` type-checks under TypeScript 7 as a default import of the `export =` module. Nothing needed more than a read of the shipped `skills/` guides; no v3-only answer cost any time.
Time (wall clock from `date`, Claude time): reading the spike, architecture, Phaser skills and the art generators about 5 min (21:33-21:38); config, feet, textures, scene, lab and page about 5 min (21:38-21:43); first screenshot, layout and judge pictures about 2 min; unit tests, dev-tool entry and the e2e spec about 4 min; production-build comparison, size build and timing about 4 min; stand-ins, the no-WebGL spec, restart and crispness tests, docs and concepts about 6 min. About 26 min in all for step 1 (the NO-GO line is 2 sessions).
Open: the punks' coarser grain against the crew (above); the backdrop's animated layer (`bg.anim`, e.g. rain) is not drawn yet; no per-hero colour grade like the old spike's; the HUD, edit mode and battle test are steps 2-4.

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes: what was learned and what to rebuild.
