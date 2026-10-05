---
type: design
title: "Shadow Jog Engine — Decisions"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-04
status: approved 2026-10-04 (all recommendations)
tags: [engine, design]
---

# Shadow Jog Engine — Decisions

This file lists every open decision for you. Each one has the question, 2 to 4 options with trade-offs, a recommendation, and what it affects. Three review agents compared design options (Phaser style, Godot style, Unity style) and scored them. Where they disagreed, the entry says so. The scores come from sessions that are not stored in the repo, so you cannot check them.

**IDs.** "E" is an open engine decision (E1 to E25). "M" is a build milestone. "T" is a test tier. "Decision 17" in `docs/PHASE-0.2.md` is your decision to build the engine. It is a different thing.

> **Read first:** [Three things that look like Phaser and are not](README.md#2-three-things-that-look-like-phaser-and-are-not). Tag meanings are in the "Tags" table at the top of [conventions.md](conventions.md).

**How to answer.** Reply with the decision number and the option letter. "E2 A" means "use option A for decision 2". If you agree with every recommendation, say "all recommendations". The design doc set changes if you pick a non-recommended option for E1, E2, or E3.

## Summary

**Answered 2026-10-04: Mark approved the design with all recommendations.** The "Your answer" column below now records his answer. The look decisions (E8, E20) and the resolution follow-up (E12) still get his review at the milestones they name.

"Mark" in the "Who decides" column means this is your call. "Agent (FYI)" means the agents can decide, and you can still change it. The "Your answer" column holds the recommendation. Edit it, then reply.

| # | Decision | Recommendation | Needed before | Who decides | Your answer |
|---|---|---|---|---|---|
| E1 | How behaviour is written | Phaser style: scene code and small subclasses | Phase 0 | Mark | A |
| E2 | Name of the 60 Hz hook | `fixedUpdate(tick)` | Phase 0 | Mark | A |
| E3 | How the 3D frame reaches Pixi | Shared context, canvas copy as fallback | Phase 0 | Mark | A |
| E4 | Home of the screen effects | One `CompositeFilter`, plus per-object effects | M2 | Mark | A |
| E5 | No-WebGL policy | Clear message from M6 | M6 | Mark | A |
| E6 | Where Pixi loads | Lazy, behind a small shell | M1 | Mark | A |
| E7 | Naming conventions | Phaser names first, tagged | Phase 0 | Mark | A |
| E8 | Filter resolution (a look decision) | Game resolution | M2 | Mark | A |
| E12 | Resolution follow-up (640x360) | Keep 480x270, test 640x360 in a mock | Phase 0 | Mark | A |
| E13 | Display scale rule | Setting, default integer | M1 | Mark | C |
| E17 | Bundle caps | Per class from the manifest | M1 | Mark | A |
| E19 | Story policy for 3D results | Per hack, authored | M7 | Mark | A |
| E20 | The lighting look | Global light map plus weak sprite boost | M5 | Mark | A |
| E22 | Accepted deviations from Phaser | Accept the list | Phase 0 | Mark | A |
| E24 | Is `moves.json` your data? | Your call. Safe default: yes | M3 | Mark | A |
| E25 | Name of the 3D mode | Neutral code names for now | M7 | Mark | A |
| E9 | Wrapper style | Composition plus an internal escape hatch | Phase 0 | Agent (FYI) | C |
| E10 | Time units | Milliseconds at the API, frames for `game.wait` | M1 | Agent (FYI) | A |
| E11 | What a pending await does at scene end | Scene-owned awaits reject with `Cancelled` | M1 | Agent (FYI) | A |
| E14 | Text object | `TextObject` with the game's font | M3 | Agent (FYI) | C |
| E15 | UI scenes | Hybrid by scene | M4 | Agent (FYI) | A |
| E16 | Engine location and default flip | `src/sje/`, flip at M6 | M0 | Agent (FYI) | A |
| E18 | Version pins, community filters, upstream report | Pin, vendor, ask first | M0 | Agent (FYI) | A |
| E21 | Events | `EventEmitter`, `Signal` on demand | M1 | Agent (FYI) | B |
| E23 | Sprite animation data | No animation manager yet | M3 | Agent (FYI) | A |

---

## E1. How is behaviour written?

**Question.** Scenes and objects need behaviour. Which model do we use?

**Options.**

- **A. Phaser style.** Scene code plus small `GameObject` subclasses (`Figure`, `Window`). A split between rules and drawing: pure logic in `src/battle`, the hack sim, and `state.ts` holds the rules. Scenes never hold rules. No ECS.
- **B. Unity style.** `GameObject` plus `Component` classes with `awake`, `start`, `fixedUpdate`, `update`, `lateUpdate`. Prefabs as JSON data.
- **C. Godot style.** One node tree. Node scripts, typed signals, `PackedScene`. `Scene` is renamed `Screen`. A small UI kit replaces `drawWindow` and `drawText`.

**Trade-offs.**

- **A.** It is the smallest concept set. You know Phaser's vocabulary, the approved spike ports with import changes, and agents have the strongest prior for it. It has costs too. Shared behaviour (hit flash, shake, bobbing) is reused by subclass or helper function, not by per-object composition. Subclasses such as `Figure` can grow large. It keeps two trees in sync (the `GameObject` tree and the Pixi tree), and `View3D` adds the Three side.
- **B.** It adds concepts that no current scene needs: Components, prefab registries.
- **C.** It adds a UI framework that no current scene needs. It breaks the spike's names, so every spike file is a rewrite.
- **ECS.** It adds nothing. `src/battle` already plays the "data plus systems" role. The display side has dozens to a few hundred objects.

**Review.** Three review agents scored A highest, then Godot style, then Unity style. They agreed on A. The scores are not stored in the repo.

**Recommendation.** A.

**Affects.** Every scene class, the spike port, the docs, agent accuracy. If you pick B or C, [scene-graph.md](scene-graph.md), [interfaces.md](interfaces.md), and [conventions.md](conventions.md) change a lot.

---

## E2. What is the 60 Hz hook called?

**Question.** The simulation runs at a fixed 60 Hz. Phaser's `update(time, delta)` runs once per frame with a variable delta. What do we call our hook?

**Options.**

- **A. `fixedUpdate(tick)`**, and `update?: never` in the types, so a Phaser habit is a compile error. Drawing-only work goes in `prerender` event handlers.
- **B. Keep `update(tick, delta)`** with an `@deviation` JSDoc tag and a lint test that forbids state writes in `prerender`.
- **C. Unity style.** `fixedUpdate` for state, plus a per-frame `update(dt, alpha)` and `lateUpdate` for drawing-only work.

**Trade-offs.** B keeps the Phaser name, but the meaning changes silently. A Phaser-trained reader or agent will write time-based code in `update`. A removes that trap at the cost of one non-Phaser name. C adds a per-frame hook that can change state by mistake, and only a lint rule guards it.

**Review.** One review agent said to rename the hook or tag it. Another warned about look-alike names. They did not agree on one answer. This design chose A.

**Also decide.** No interpolation in v1. Motion snaps to whole pixels and repeats frames on a 120 Hz or 144 Hz screen. Today's engine does the same. Say so if you see judder on a fast monitor.

**Recommendation.** A.

**Affects.** Every scene. The spike port (`StageScene.update` becomes `fixedUpdate`). Docs and the engine skill.

---

## E3. How does the 3D frame reach Pixi?

**Question.** Three.js draws the 3D mode. Pixi draws the 2D game. How do the two pictures meet?

**Options.**

- **A. Shared context.** One WebGL2 context. Three renders into a 480x270 nearest render target. Pixi shows it through `ExternalSource`. The canvas copy is coded behind the same `Frame3D` interface. It switches on if the texture handle is missing.
- **B. Canvas copy always.** Three on its own canvas, copied into Pixi through `CanvasSource`. No shared state. A second context. Needs `forceContextLoss()` on every exit.
- **C. Pixi guide approach.** Three draws into the default framebuffer under Pixi.

**Trade-offs.**

- **A.** Pixel-exact in the lab. Filters, masks, and blend modes work on the 3D frame. Risk: it depends on two non-stable APIs (Three's `__webglTexture` field and Pixi's `@advanced` `ExternalSource`). It needs three hand-off rules: reset the clear color, pass `canvas` on init, never call `destroy`.
- **B.** Pixel-exact. The same filter support. Cost: a second context.
- **C.** Rejected. A root filter left 717,792 of 717,792 3D pixels unchanged.
- **Speed.** A re-run showed no speed gap between A and B. Speed does not decide it.

**Recommendation.** A, with B as the coded fallback.

**Affects.** `GlContext`, `GlHandoff`, `Frame3D`, M1b, M7, the canary tests. Phase 0 re-tests A on Chromium 153, Firefox, and WebKit.

---

## E4. Where do the screen effects live?

**Question.** Today's GL presenter does bloom, 4 shockwaves, color split, 4 hazes, 2 glitches, dim, flash, and vignette. Where do these go on Pixi?

**Options.**

- **A. One `CompositeFilter`.** A port of the presenter shader, fed by a glow render texture. Per-object effects are separate `Effect` wrappers.
- **B. One vendored filter per effect.** Bloom, 4 shockwaves, 4 hazes, glitches, each stacked.
- **C. Community `pixi-filters` directly.**

**Trade-offs.** A keeps the look, `fx.json`, `playMoment`, and about the old single-pass cost. The shader exists, so the port is mostly mechanical. B costs more passes and the look can drift. C is the quickest start, but `pixi-filters` 6.1.5 is 10 months old, and its `AdvancedBloomFilter` is a global threshold bloom, not today's selective glow.

**Review.** The fit review asked for A. It flagged B as likely to drift and to cost more than the 5 to 7 days planned. Nothing is built yet. Pixi filters ran on a shared context only in agent labs on SwiftShader.

**Recommendation.** A.

**Affects.** M2, `fx.json`, the FX lab, effect specs. See [frame-and-rendering.md](frame-and-rendering.md) section 6.5.

---

## E5. What happens when WebGL2 is not available?

**Question.** Pixi's WebGL renderer needs WebGL2. Today's game works without it. What do those players get?

**Options.**

- **A. A clear message** ("WebGL 2 is required") from M6, when the default flips. The legacy Canvas 2D path runs only before M6. It is not shipped after M6.
- **B. Pixi's Canvas renderer** with fx level `none`. 3D returns `unsupported`.
- **C. Keep the old Canvas 2D engine** as a permanent fallback.

**Trade-offs.** B skips every filter, draws no meshes, and was never measured for the whole game. It needs its own tests and goldens. It also contradicts the bare `WebGLRenderer` design, which never falls back. C means two engines for good. A is a regression: players with WebGL 2 turned off, or with old GPUs, lose the game at M6, not at M8. You said desktop browsers come first and mobile is not a requirement.

**Review.** One review agent preferred B. Another advised against it for the reasons above. This design chose A.

**Recommendation.** A. The 3D mode returns `unsupported` if its chunk fails.

**Affects.** M6, M8, `Game.create`, the no-WebGL e2e spec, story scripts that call `s.hack`.

---

## E6. Where does Pixi load?

**Question.** Pixi adds about 131 to 205 kB gzip. When does the player download it?

**Options.**

- **A. Lazy, behind a small shell.** The boot entry never imports Pixi. `Game.create` imports it at once, in an async function. Page and game code load in parallel.
- **B. In the first download.** Pixi is a static import of the entry.
- **C. Lazy, loaded only on the first scene that needs it.** Practical only while the legacy path runs.

**Trade-offs.** The total download is the same for A and B after M6, because the game cannot run without Pixi. A gives a small boot chunk, an early paint, and a loading state. B is simpler, but one big chunk. In Vite 8.3.1, a named chunk group for Pixi pulled a 150.6 kB gzip chunk into the entry. The manifest gate guards this. During the migration the legacy path must not pay for Pixi, so Pixi is lazy under the flag anyway. The 3D chunk is always lazy.

**Recommendation.** A.

**Affects.** `src/boot.ts`, `vite.config.ts`, the bundle gate, `e2e/prod.spec.ts`. See E17.

---

## E7. Which naming conventions do we follow?

**Question.** Phaser, Unity, and Godot name the same things differently. Which names do we use?

**Options.**

- **A. Phaser names first.** Unity or Godot names only where Phaser has no concept. Every borrowed or invented name carries a tag. `Scene` keeps its name. Two classes get a suffix (`ImageObject`, `TextObject`) because `Image` and `Text` are DOM globals. Files are lowercase with no separators, as in the repo.
- **B. Godot names.** `Screen`, `Node2D`, `Sprite2D`, `_physicsProcess`.
- **C. Unity names.** `GameObject` with `Transform` and `Component`.

**Trade-offs.** A makes the spike port mechanical and matches your instruction ("Phaser first"). B and C teach you a second vocabulary and break the spike's names. Godot's `_physics_process` suggests a physics engine that does not exist.

**Review.** One review agent proposed renaming `Scene` to `Screen` (Godot style). Another counted that against it. This design kept `Scene`. A glossary of four collisions (Scene, run, Layer, Timeline) is in [conventions.md](conventions.md).

**Recommendation.** A. Full rules for files and classes are in [conventions.md](conventions.md) section 5.

**Affects.** Every file name and class. The agent skill.

---

## E8. At what resolution do filters run?

**Question.** Filters on a 480x270 game can run at game resolution or at device resolution. This is a look decision.

**Options.**

- **A. Game resolution.** The screen root renders into a 480x270 render texture. Filters run there. Then a nearest integer upscale. Every game pixel stays an exact block. Blur and glow look chunky.
- **B. Device resolution.** Smooth blur and glow. Filtered pixels no longer form exact blocks.
- **C. Game resolution by default, plus a per-effect `hiRes` flag for bloom only.**

**Trade-offs.** Lab: with A, 0 of 129,600 blocks mixed. With B, 125,959 mixed after a blur. A costs about 2 ms more per frame on SwiftShader (one machine, estimate). A matches your crisp-pixel constraint.

**Recommendation.** A by default. Review the look of bloom and blur in the M2 side-by-side. Add C only if it looks too chunky.

**Affects.** M2, the golden tests, 3D bloom, the display pipeline.

---

## E9. Do GameObjects wrap Pixi nodes or subclass them?

**Question.** How does a `GameObject` relate to its Pixi node?

**Options.**

- **A. Composition.** A private Pixi node. Phaser API outside. Pixi hidden.
- **B. Subclassing.** `class Sprite extends pixi.Sprite`. Pixi's API (anchor, scale flip, children on leaves) leaks to game code.
- **C. Composition plus a documented escape hatch** (`go.node`), allowed under `src/sje` only.

**Trade-offs.** The wrapper enforces the Phaser rules that Pixi only warns about: origin to anchor, flip, no children on leaves, whole-pixel rounding. It lets Vitest run scene logic in Node. The cost is two parallel trees, which `__SJ__.tree()` prints side by side. A two-tree design means a small overhead per object that is not measured yet. M1 benches 1,000 objects.

**Recommendation.** C.

**Affects.** [scene-graph.md](scene-graph.md), tests, debugging.

---

## E10. What unit do durations use?

**Question.** Phaser uses milliseconds. Today's `game.wait` counts frames.

**Options.**

- **A. Milliseconds at the API**, converted to whole ticks inside. `game.wait(frames)` stays for story code. Names carry the unit when it is not milliseconds.
- **B. Ticks everywhere**, and tweens too.
- **C. Both, with explicit names** (`delayedCall(ms)` and `delayTicks(n)`).

**Trade-offs.** A matches the Phaser code agents already write. It keeps story scripts unchanged. It leaves two units in one code base, which is a footgun. B is uniform but unfamiliar. C is clearest but adds names.

**Review.** One review agent flagged the two units. This design chose A with a naming rule.

**Recommendation.** A.

**Affects.** `Clock`, `TweenManager`, `Timeline`, story scripts (none change).

---

## E11. What does a pending await do when its scene ends?

**Question.** A scene can end while code awaits something it owns.

**Options.**

- **A. Scene-owned awaits reject with `Cancelled`.** (`scene.time.wait`, `tween.finished`.) `game.run` keeps today's behaviour: pending forever on `abandon`. `s.hack` always resolves.
- **B. Nothing ever settles.** A silent stop everywhere.
- **C. Everything rejects**, and `game.run` too.

**Trade-offs.** A keeps today's story behaviour (`abandon` stops the flow dead) and gives scene code a clean way to stop. It means two cancel rules. The existing `unhandledrejection` handler in `src/main.ts` ignores `Cancelled`. B leaves dangling promises. C changes story scripts.

**Recommendation.** A.

**Affects.** `Clock`, `Tween`, `Signal`, the 3D watchdog, story scripts (none change). See [frame-and-rendering.md](frame-and-rendering.md) section 4.

---

## E12. What is the resolution follow-up?

**Question.** The research said: keep 480x270, make `W` and `H` one module, and compare 640x360 in a mock.

**Options.**

- **A. Keep 480x270.** Build the shared module. Compare 640x360 in a Phase 0 mock.
- **B. Switch to 640x360 now.**
- **C. Switch to 320x180.**

**Trade-offs.** 640x360 keeps all the art, but sprites and text look 25% smaller. Estimated re-layout is 7 to 11 agent-days (estimate). It scales exactly to 720p, 1080p, 1440p, and 4K. In a maximized browser window it does not help: only about 7 to 12% of players get a snap, against about 11% at 480x270 (modelled, not measured). 320x180 is too small for the battle art. Two of three research reviewers kept 480x270.

**Recommendation.** A. The mock decides whether B is worth the cost.

**Affects.** `size.ts`, every hand-laid-out UI, battle-stage data.

---

## E13. Which display scale rule is the default?

**Question.** Today snaps to a whole multiple only if it fills at least 90% of the window. Otherwise it resamples smoothly. The spike always uses a whole multiple.

**Options.**

- **A. `integer`.** Always whole device pixels per game pixel. Black bars.
- **B. `fit`.** Today's 90% rule.
- **C. A setting with both. Default `integer`.**

**Trade-offs.** A is crisp and fits the hard constraint. B fills more of the window but can blur. B needs `image-rendering: auto`, and A needs `pixelated`. The two modes use different maths ([frame-and-rendering.md](frame-and-rendering.md) section 6.6). If you pick A only, the `fit` setting retires. Today's saved default `settings.scale: 'fit'` then migrates to `integer` in `backfill()`.

**Recommendation.** C.

**Affects.** `Display`, the options scene, the saved setting `settings.scale`.

---

## E14. Which text object is the default?

**Question.** About 270 text draws and a typewriter effect exist.

**Options.**

- **A. `TextObject`.** Canvas drawn with the game's own font. Keeps outline, shadow, and color codes. No extra bytes.
- **B. Pixi `BitmapText`.** About 50 to 66 kB gzip more. No per-glyph outline or shadow. A hand-built font needs `lineHeight` equal to `fontSize`, or text draws 1 px low.
- **C. A default, with B as an opt-in after a measurement.**

**Trade-offs.** A matches today's look and the spike's HUD. Per-frame upload cost for many strings is not benchmarked.

**Recommendation.** C.

**Affects.** M3 HUD, M4, the bundle.

---

## E15. Do UI scenes move to retained mode?

**Question.** About 270 `drawText` and 57 `drawWindow` call sites sit in the UI scenes.

**Options.**

- **A. Hybrid by scene.** A scene ports only when it needs a camera, filter, mask, or transition. The rest stay on `LegacyScene` for as long as they need.
- **B. Port every scene.**
- **C. Keep UI on canvas for good.**

**Trade-offs.** A cuts the biggest low-value rewrite. B gives one model but costs up to 10 days (low confidence). C is the same as A without a plan to port. With A and C, two draw models stay in the code base.

**Review.** Two review agents asked for A.

**Recommendation.** A.

**Affects.** M4 (optional), the effort total, the legacy adapter lifetime. M8 deletes `src/engine/game.ts` only when no scene needs `LegacyScene`.

---

## E16. Where does the engine live, and when does it become the default?

**Question.** New code needs a home. The flag needs a flip date.

**Options.**

- **A. `src/sje/` beside `src/engine/`.** Both run. Default flips at M6. M8 deletes the old directory.
- **B. `src/sje/`, and the default flips after M3** (battle only). Legacy scenes stay on the adapter longer.
- **C. Rewrite `src/engine/` in place.**
- **D. A separate package.**

**Trade-offs.** A keeps imports stable and lets you compare both engines with the flag. B ships earlier but runs the adapter in production for most of the game. C breaks 34 files at once. D adds build and release cost.

**Recommendation.** A. The name `sje` stands for Shadow Jog Engine. Say so if you want a different folder name.

**Affects.** M0, M6, M8, CI.

---

## E17. How is the bundle alarm set?

**Question.** Today: 233.9 kB gzip against a 236 kB alarm. Pixi adds about 131 to 205 kB. Three adds about 130 to 232 kB lazily.

**Options.**

- **A. Per class from the Vite manifest.** `boot`, `lazy-2d`, `lazy-3d`, `lazy-other`, plus a reported `first play`. A hard rule: the boot closure has no `pixi.js` or `three`.
- **B. One total, raised.**
- **C. No cap. Report only.**

**Trade-offs.** A watches what a player downloads first. First estimates, to reset at M1: `boot` at or below today's 144.8 kB, `first play` about 330 to 430 kB (low confidence), `lazy-3d` 240 kB. These are estimates, not measurements. The numbers are your call. A named chunk group would break the rule, so the gate checks it. The old largest-chunk cap (480 kB raw) goes away with the old total. Set a cap for each class, or drop the cap on purpose.

**Recommendation.** A.

**Affects.** `scripts/bundle-budget.mjs`, CI, E6.

---

## E18. How do we handle Pixi and Three upgrades, community filters, and the upstream bug?

**Question.** The fixes use internals (Three's `__webglTexture`, Pixi's `resetState`). Pixi releases a minor every 2 to 6 weeks. `pixi-filters` has not been released since 2025-11-29. We found a Pixi clear-color bug that no web search showed as reported.

**Options.**

- **A. Pin exact versions** (`pixi.js 8.22.0`, `three 0.186.x`). Keep the canary suite. Vendor the filter GLSL we need behind `Effect`. Ask you before filing an upstream issue.
- **B. Float versions.** Fix breaks when CI shows them.
- **C. Use `pixi-filters` directly.** File the issue now.

**Trade-offs.** B and C save effort now and cost more at the first break. A report is a public post under your name, so it needs your OK.

**Recommendation.** A.

**Affects.** `package.json`, M0, the canary suite, M2.

---

## E19. What does a story script do with a 3D result?

**Question.** `s.hack(def)` returns `success`, `fail`, `aborted`, or `unsupported`.

**Options.**

- **A. Per hack, authored.** `unsupported` goes to an authored 2D alternative. `aborted` (context loss) retries once, then auto-succeeds. The author sets this for each hack.
- **B. Always auto-succeed** with a notice.
- **C. Always skip to a 2D alternative.**

**Trade-offs.** A keeps the story coherent, and costs authoring work for each hack. B is cheap but may skip content the story needs.

**Recommendation.** A.

**Affects.** `ScriptApi.hack`, the `HackResult` contract, M7.

---

## E20. What does the field lighting look like?

**Question.** Today's lighting uses per-sprite scratch canvases. They have no one-to-one Pixi form.

**Options.**

- **A. A global light map** (additive radial sprites, multiplied over the world) plus a second, weaker multiply for sprites (today's 0.32 boost). An approximation.
- **B. Per-sprite lighting** with a custom filter. Closer to today. More cost.
- **C. Drop per-sprite lighting.**

**Trade-offs.** A is the cheapest. The look changes slightly. You must approve it.

**Recommendation.** A. You review it in M5.

**Affects.** M5, `Lights`, effect budget on SwiftShader.

---

## E21. What event API do we use?

**Question.** Phaser has `EventEmitter`. Godot has typed `Signal`.

**Options.**

- **A. `EventEmitter` only**, with the rule that a context that is a `GameObject` or `Scene` ends the link on destroy.
- **B. A, plus a small typed `Signal`** when a ported scene needs it.
- **C. `Signal` everywhere** (Godot style).

**Trade-offs.** A has Phaser names. B adds typed arguments for engine objects (for example `Frame3D` lost events). C breaks the Phaser names.

**Recommendation.** B. Rule for objects: call down with methods, signal up with events.

**Affects.** Everything that emits. The 3D `lost` event.

---

## E22. Which deviations from Phaser do we accept?

**Question.** The design deviates from Phaser in sixteen places ([conventions.md](conventions.md) section 3). Examples: a fixed-tick hook, an awaiting `game.run`, one world camera, scroll factors of 0 or 1, a flat `filters` list, `filters.internal` run as external.

**Options.**

- **A. Accept the list.** Build more of Phaser only when a real scene needs it.
- **B. Implement full parity.** Multi-viewport cameras, fractional scroll factors, internal filters. More work, no current use.
- **C. Drop the Phaser names where Pixi differs.** Expose Pixi names.

**Trade-offs.**

- **A.** The smallest build. Cost: sixteen look-alike traps for a reader or an agent who knows Phaser 3. The engine skill and the types (`update?: never`) guard the main ones.
- **B.** It removes some traps. It costs parity work that no current scene uses.
- **C.** It loses the "copy Phaser" rule that you asked for. Game code would depend on Pixi names.

**Recommendation.** A. Every deviation is in the glossary and in JSDoc.

**Affects.** Effort, agent accuracy, the docs.

---

## E23. Where does sprite animation data live?

**Question.** `Sprite.play(anim)` implies clips. The spike and today's code choose frames from the tick in code. No Phaser animation manager is used.

**Options.**

- **A. No animation manager.** Scenes pick frames by tick, as now. `play` is not built.
- **B. A Phaser-style `AnimationManager`.**
- **C. Clip tables in data** (a small `AnimSet` keyed by name) added when a scene needs one.

**Trade-offs.** A is the smallest and matches current code. B and C add a data format with no current user.

**Recommendation.** A. Revisit when a scene needs shared clips.

**Affects.** `Sprite`, M3, the art pipeline.

---

## E24. Is `src/data/moves.json` your design data?

**Question.** This is a question for you, not a design decision. `moves.json` (21 kB) exists only on the spike branch. `docs/DEVELOPING.md` lists five designer-edited files and omits it. Agents never change your data files.

**Options.**

- **A. Yes. Agents read it byte for byte and never edit it.**
- **B. No. Agents may change it with the stage code.**

**Trade-offs.** A protects your data. It costs a human edit for each change to the moves. B is faster. It puts design data under agent control, which breaks your standing rule.

**Recommendation.** Your call. Today the safe default is A.

**Affects.** M3, the fixtures rule in tests, `DEVELOPING.md`.

---

## E25. What is the 3D mode called?

**Question.** The research says the mode has no name yet. Naming it needs a glossary entry. The game's word for a hacker is "deck jockey". The docs avoid "decker".

**Options.**

- **A. Neutral code names for now** (`hack`, `HackScene`, `Scene3D`). You name the mode later and the glossary gets one entry.
- **B. Name it now** and use the name in the code.

**Trade-offs.** A leaves `hack` as a code name, and it may leak into saves and story data. A code rename is one pass. A name inside saved data would need a save migration. B forces a naming call before the mode is designed.

**Recommendation.** A. Code names can change in one rename. Keep the name out of saved data until you pick one.

**Affects.** `ScriptApi.hack`, `docs/GLOSSARY.md`, M7.
