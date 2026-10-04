---
type: project-doc
title: Shadow Jog — Engine and 3D mode research (2026-10-04)
project: shadow-jog
created: 2026-10-04
updated: 2026-10-04
tags: [research, engine, 3d, resolution, decision]
---

# Engine and 3D mode research (2026-10-04)

**Decision (Mark, 2026-10-04):** Shadow Jog gets **its own engine, with PixiJS v8 as the 2D renderer and Three.js for a low-poly 3D hacking mode.** There is no Unity or Godot replatform. The planned Phaser rebuild is superseded. **No engine code is written before Mark approves an architecture design doc** (see "The design gate" below).

This page records the research behind the decision. Agents ran three research rounds on 2026-10-04, about 56 agents in all. In each round, every research leg had an independent fact-checker, then a three-judge panel scored the options, a completeness critic looked for gaps, and gap-fill agents researched the biggest gaps. **The gap-fill results were single-agent work and had no independent fact-check.** Several results that shaped the decision came from them: the shared-context test, the display-list parity test, the shimmer measurement and the desktop/Steam survey.

The full results and the bench code are in the git-ignored folder `media/research-2026-10-04/`, on Mark's machine only (results as JSON, digests as text, bench sources without `node_modules`).

Sizes are gzip in kB (1000 bytes) unless a line says otherwise. All timings come from one Windows desktop (RTX 4070) and from headless Chromium on SwiftShader, which is the software WebGL that GPU-less CI uses. Nothing was measured on a phone or on the Linux CI runner. Treat the timings as indicative: fact-check re-runs came out 3-9% lower.

---

## The idea

Mark wants a hacking sub-game, inspired by the Matrix mode of Shadowrun on the Sega Genesis (BlueSky Software, 1994). In that game, the 2D top-down game switched to a third-person cyberspace view with a silver persona, a blue grid, node mazes and ICE programs. No source says how BlueSky built it. The details of the persona, the green terminal HUD and the program-icon bar come from Mark's screenshots. Mark wants Shadow Jog's version in **true real-time 3D, low-poly and fast**, with a different vibe from the 2D JRPG, and it must fit seamlessly into the 2D game. His low-poly references are flat-shaded faceted scenes, Superhot, Morphite, blocky figures and Beat Saber. His reference images are in `docs/references/` on his machine (not committed).

The game's own word for a hacker is **deck jockey**. `docs/GLOSSARY.md` deliberately does not use "decker". This page uses Shadowrun words (Matrix, ICE, persona) only to describe the inspiration. The mode has no name yet, and naming it needs a glossary entry.

---

## Round 1: is a 3D mode feasible, and on which platform?

**Answer: yes, on the current web stack. A Unity or Godot replatform is not needed, and it would make the web game worse.**

| Option | Verdict | Main evidence |
|---|---|---|
| Web + Three.js 3D module | Best fit | Three.js r186 (npm 0.186.0 on 2026-09-08, 0.186.1 on 2026-09-24). A lazy chunk with flat shading, fog and bloom is about 145 kB. With GLTFLoader it is about 160-177 kB. A 300-mesh scene at 480x270 costs about 3 ms per frame, or 9 ms with bloom, even on SwiftShader. Frames were byte-identical across runs on one machine. |
| Phaser + enable3d | Not viable | enable3d is Phaser 3 only. Its last npm release was 2025-03-08, and it pins three r171. |
| Unity 6 | Poor fit | A near-total rewrite of about 37k lines of TypeScript. A current Unity 6.6 empty web build is about 4-8 MB (about 2 MB only after heavy stripping). Web audio gives mixer volume only, and our music is a WebAudio synth. URP cannot mix 2D and 3D renderers in one camera stack. The official in-Editor MCP server is already deprecated for a beta CLI. A first-party Claude Code plugin shipped on 2026-09-09. No GPU-less screenshot path was found, so visual checks need an open Editor on a GPU machine. iOS Safari memory crashes are reported in anecdotal 2024 forum threads. |
| Godot 4.7 | Poor fit | Friendlier to agents than Unity (text scene files, MIT), but also a full rewrite. One third-party measurement puts a 3D web export at about 9.7 MB. An open report (#119317, seen on 4.7.beta1, not reproduced here) says web 3D is about 6x slower at a low render scale, which is the look we want. |

- **Desktop or Steam later** (a single-agent gap fill, not fact-checked). Electron ships the same Chromium as the web build, so a wrapper can work. Vampire Survivors launched on Steam as Phaser 3 + Electron, and it later moved to Unity (v1.6) for performance. The risks are in the Steam integration. `steamworks.js` is nearly unmaintained (`steamworks-ffi-node` and `greenworks` are live). Electron 35 broke the Steam overlay on SteamOS, and the overlay does not work on Linux through `steamworks.js`. The Electron Windows download is about 150 MB.
- **Agent track record.** In one self-selected list of 66 AI-built games, 34 use Three.js, 4 Godot and 0 Unity. The Vibe Jam 2026 winner was a Claude Code + Three.js game. Agents still fail at visual judgment and at "is it fun", so Mark's review stays the bottleneck.

### 3D assets
- The Matrix-style objects (cube, geodesic sphere, chip, grid, shards) are simple shapes. Code can build them directly in Three.js with no asset pipeline.
- For the persona and complex props, the best fit is **headless Blender driven by Python scripts that agents write** (`blender --background --python make_asset.py`, then export GLB). The result is the same each run, and the script lives in git. Blender 5.2 is installed on Mark's machine (2026-10-04).
- The **official Blender Lab MCP server** ([blender.org/lab/mcp-server](https://www.blender.org/lab/mcp-server/)) is real (GPL, Blender 5.1+). It is made for scene inspection and scripting, not for art. It has open Windows install and hang bugs, and workarounds exist. The community server [`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp) (now `mcp-for-blender`, about 30k stars) is better for modelling.
- Agents do well on primitives, hard-surface props, materials, lighting and layout. They do badly on topology, organic shapes, rigging and animation. CC0 rigged humanoid packs (Quaternius, Kenney) avoid rigging work.
- GLB works in Three.js, Unity and Godot, so the asset pipeline does not tie the game to an engine.
- The three Reddit quotes from Mark's screenshot could not be traced, because Reddit is closed to the research tools.

### Risks found in round 1
- The 3D mode is the game's first hard WebGL2 requirement. It needs a skip or auto-result path for players without WebGL2.
- In Three.js, a lost WebGL context does not throw an error. Without a watchdog, a story script that awaits the 3D mode hangs.
- Chrome needs `--enable-unsafe-swiftshader` for software WebGL in CI. Playwright adds it.

---

## Round 2: which engine runs both the 2D game and the 3D mode?

**Answer: no mature, free web engine among those tested gives the full "real game" layer (scene stack, tweens, input mapping, fixed step) for both crisp 2D pixel art and 3D.** Nobody measured that layer directly in any candidate, so this answer comes mostly from what the engines lack. LittleJS has parts of it but is very young. Cocos Creator has most of it but is tied to its editor and was not benchmarked.

Every benchmarked engine drew pixel-exact 480x270 output and held 60 fps, after one non-default fix in three of them (PlayCanvas colour pipeline, Galacean MSAA, Babylon sprite epsilon). All tests ran at devicePixelRatio 1. Structure, cost and risk therefore decide, not fidelity or speed.

### Hands-on bench (the same tests in every engine)
Test A is 2D pixel art. Test B is 300 meshes with fog, a neon grid and bloom. Test C is test B plus a pixel HUD. At zoom x4, every engine gave 0 non-uniform 4x4 blocks and 0 pixels different from a CPU reference. PixiJS was not in this bench.

| Engine | kB, A / B+C | SwiftShader ms, A / B / C | First frame ms, A / C |
|---|---|---|---|
| three | 129.7 / 137.5 | 0.61 / 9.17 / 9.31 | 112 / 246 |
| Phaser (+ three for 3D) | 350.3 / 484.1 | 0.53 / 9.37 / 9.76 | 222 / 384 |
| Babylon.js | 350.5 / 434.2 | 0.74 / 6.06 / 6.34 | 287 / 386 |
| PlayCanvas | 292.9 / 333.7 | 0.67 / 4.56 / 4.68 | 149 / 227 |
| Galacean | 285.4 / 286.9 | 1.18 / 5.78 / 6.98 | 183 / 301 |

### Candidates
| Engine | Verdict |
|---|---|
| Phaser 4.2.1 | 2D only. The most complete 2D game framework of the set. It has had no release since 2026-07-09, and the last repo push was 2026-08-21 (the roadmap was not checked). The company's own post says its effort is now the proprietary Phaser AE ([2026-07 news post](https://phaser.io/news/2026/07/no-you-didn-t-miss-a-3d-update)). Phaser 4 stays MIT and 2D only. |
| PixiJS 8.22.0 | A 2D renderer, not an engine. It has no scenes, input map or tweens, and the official sound package was last published in 2024-07. MIT, a release every 3-6 weeks, 48k stars. WebGL, WebGPU and Canvas renderers. An official [Three.js shared-context guide](https://pixijs.com/8.x/guides/third-party/mixing-three-and-pixi). About 153-163 kB. The shipped Pixi + Three.js example (GDevelop) runs on Pixi 7 with a private-internals hack, so the Pixi 8 shared-context path rests on Pixi's guide and our own test. |
| Babylon.js 9 | Viable as one engine, but it is 3D-first and heavy. It has no scene stack, fixed step, input map or pixel-font renderer. It has sprite edge pitfalls. |
| PlayCanvas 2.23 | The only npm engine with an Entity-Component-Script structure. It has a thin 2D layer, a default colour shift of up to 9/255, and a 5.9 s start stall in Chrome unless `xrCompatible:false` is set. 5 of its 12 minor releases had breaking changes. Snap owns it. |
| Galacean | Real structure, but the stable line has been frozen since 2025-12-29. Work is on a 2.0 alpha with API breaks, and it has about 3.9k weekly downloads. |
| Cocos Creator | Closest to a full game engine in TypeScript, but tied to its editor (not an npm library), so it means a replatform. Cocos 4 (MIT) is still alpha. |
| LittleJS, melonJS | Both added 3D tiers in the last weeks. They are young, change fast, are mostly AI-written, and do not integer-scale by default. |
| Defold, Needle | Lua and source-available / proprietary. |

### Gap-fill tests (single-agent, not fact-checked)
- **Shared WebGL2 context.** Phaser 4.2.1 + three and PixiJS 8.22.0 + three each drew a pixel-exact overlay over 600 frames. This works only with a GL state reset every frame. Pixi has a public `resetState()`, and its glue is about 15 lines. Phaser has no public reset, and its glue is about 21 lines on private internals.
  - **Teardown traps.** Pixi `renderer.destroy()` on a shared context kills the Three.js context unless an internal field is patched. With that patch, it leaks one GL program per cycle. Phaser `game.destroy()` leaks one texture and two VAOs per cycle. Scene or stage teardown is clean in both. The rule: create each renderer once, and tear down only scenes or stages.
  - **What the overlay covered.** Only alpha 0/255 art, ADD blend and integer positions, on Chromium with SwiftShader. **Not tested: Pixi filters, masks, Graphics, fractional or alpha-blended sprites over Three.js, a real GPU, Firefox and Safari.** Pixi's per-object filters and masks are documented by Pixi, but our bench did not run them.
- **Our own display list against the Phaser spike.** This display list is **Canvas 2D, not Pixi.** A 254-line Canvas 2D retained display list plus a 241-line Phaser-shaped facade ran the UNCHANGED spike stage: the stage scene, the HUD, the live effects, the Battle Stage Editor page and a Battle Test turn. Against Phaser, 0.98-2.26% of pixels differed, all by exactly 1/255 (translucent panels). The strict pass line (under 0.1% of pixels) failed. A tolerance of 1/255 passes. For scale, Phaser itself differs on 0.86% of pixels between a GPU and SwiftShader. It costs about 3 ms per frame on SwiftShader. Not tested: real-art loading, editor pointer-drag, and the lighting, weather and post effects. **Pixi parity with the Phaser stage is unmeasured.**
- **3D inside the 2D game.** A 480x270 Three.js frame copies byte-exact into the 2D back buffer. With the presenter's own effects switched off, the real presenter upscales it exactly at x3 and x4, at devicePixelRatio 1, 1.25 and 1.5 (a control at 1.75 fails). `GlPresenter.create` refuses SwiftShader, so CI tests only the 2D fallback presenter. With that guard bypassed on SwiftShader, the GL presenter costs about 23 ms per frame. MSAA 4x halves thin-line shimmer, but it is too slow on SwiftShader.

### Judges (round 2)
| Lens | Pick | Grow our Canvas 2D engine + Three.js (E6) | Phaser + Three.js (E1) |
|---|---|---|---|
| Architecture and agent fit | E6 | 8 | 7 |
| Migration cost and risk | E1 | 7 | 8 |
| Visual quality and seamlessness | E6 | 9 | 7 |

**No judge picked Pixi.** Only the cost judge scored Pixi + Three.js (5). It said Pixi replaces an approved Phaser spike for no player-visible gain (port 8-9 files, 2-3 sessions, plus Mark's re-review). It added that the score would rise to 8 if Pixi 8 and Three.js share a context cleanly. The later gap-fill test showed a clean shared context for simple art. The visual judge called a Pixi + Three.js variant unmeasured for pixel exactness. The judges also scored before the display-list parity test ran.

### Why Pixi under our own engine (Mark's call)
Mark chose Pixi over the judges' picks. His reasons:
- He wants the game built like a "real game" with established engine concepts, and he prefers proven parts to home-made ones.
- Special effects are "the real differentiator" (Mark, 2026-09-30). Pixi documents per-object GPU filters and masks. A Canvas 2D renderer cannot run a shader on one sprite.
- Pixi is a renderer, so it fits under our own engine with no overlap. Phaser would bring a second scene system.

What he accepts, and what is still unproven:
- **First download.** Pixi adds about 155 kB to the first download, unless the engine loads it lazily behind a shell. The budget alarm is 236 kB in total, the shipped game measures 233.9 kB (about 2 kB of headroom), and the spike's base commit already read 239.8 kB. The alarm must be re-set on purpose. It is an alarm, not a hard limit.
- **Pixi traps.** The teardown trap on a shared context, and a bitmap-text quirk: text draws 1 px low unless `fontSize` equals `lineHeight`.
- **Untested.** Pixi filters and masks on the shared context, and Pixi parity with the Phaser stage. The platform spike must test both.

---

## Round 3: what internal resolution?

**Answer: no strict consensus, but a common cluster. Keep 480x270 for now. Make W and H one shared module. Compare 640x360 in a side-by-side mock before layouts harden.**

- **Where 480x270 came from.** The first build session picked it on 2026-09-27 with no recorded reason. It is a quarter of 1920x1080 (4x to 1080p, 8x to 4K). It has 270 lines, against 224 on the Genesis. It was not matched to the Genesis (320x224).
- **Community advice.** The [Godot docs](https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html) and [D-Pad Studio](https://dpadstudio.com/Blog/postHibit.html) favour 640x360. A Unity blog favours 320x180. GDQuest lists four sizes (320x180, 426x240, 568x320, 640x360). 320x180 and 640x360 are the only practical 16:9 sizes that scale by a whole number to 720p, 1080p, 1440p and 4K.
- **Shipped games.** Most values are single PCGamingWiki measurements. The weak ones are marked.
  - 320x180: Celeste, Animal Well.
  - 384x216: UFO 50, Coromon.
  - 400x240 and 424x240: Shovel Knight, Sonic Mania.
  - 480x270: Enter the Gungeon and Axiom Verge (PCGamingWiki notes without a reference). Hyper Light Drifter is unverified: one developer quote says 480x270, and other sources say only "480p".
  - 568x320: CrossCode (confirmed by a developer).
  - 640x360: Sea of Stars, Chained Echoes, Owlboy, Blasphemous, Signalis.
  - RPG Maker MV/MZ defaults to 816x624.
- **Fullscreen fit** (Steam survey, September 2026: 1080p 47.9%, 1440p 27.0%, possibly inflated by a sample shift). Under the 90% snap rule in `display.ts`, fullscreen snaps to a whole multiple for about 96% of players at 480x270 and 97% at 640x360. The Steam Deck gets 2.667x at 480x270 and an exact 2x at 640x360. The Deck is about 0.5% of Steam players.
- **Maximised browser window** (modelled, not measured on players). The model assumes 133 CSS px of browser and taskbar height, so a 1080p window is about 1920x947. No 16:9 size fills it exactly. 480x270 snaps for about 11% of players there, and 640x360 for about 7-12%, so **640x360 does not improve the window case.** Only 320x180 is stable in windows (about 94%), and it is too small for the battle art.
- **3D and resolution.** Every precedent we could read draws its 3D into the same low-resolution buffer as its 2D (Sonic Mania 424x240, [Celeste 64](https://github.com/ExOK/Celeste64/blob/main/Source/Game.cs) 640x360, t3ssel8r 640x360). Octopath's HD-2D is a counterexample. Celeste 64 uses a perspective camera with no pixel snap and a fractional final scale. A Three.js neon grid measured about the same line shimmer at 320x180, 480x270 and 640x360, on a flicker metric an agent made, on a static scene that no human has viewed yet. The camera type matters more: a perspective camera crawls at every size, and a pixel-snapped orthographic camera does not. For a matched pixel grain, the 3D should use the same internal size as the 2D. A CI trap: on SwiftShader, long grid lines that cross the camera's near plane vanish until the grid is split into short segments.
- **Cost of a change.** W and H live in `src/engine/game.ts:21-22`, and about 28 runtime files use them. The field already adapts (it shows more world). The cost is the hand-laid-out UI (58 windows, about 250 text draws) and the battle-stage data in screen pixels. The enemy art is native 1:1, so it cannot be halved for free. The game already mixes pixel grains: the battle world layer is 240x135, shown at 2x. Estimates, for order only: 640x360 keeps all art (sprites and text look 25% smaller) and needs about 7-11 agent-days of re-layout. 384x216 needs the battle art redrawn (2-4 weeks), and 320x180 too (3-5 weeks).
- **Judges.** Two of three keep 480x270, with 640x360 as the only switch worth a look. One prefers a view that grows to fill the window, on a 480x270 base. All three: make W and H one shared module for every renderer before the engine work.

---

## The design gate (Mark, 2026-10-04)

Before any engine code, Mark approves an **architecture design doc**. It must be comprehensive and easy to read. It covers the architecture, the key interfaces, the core primitives (what the scene graph is made of, the render pipeline) and the tooling. It copies established conventions: Phaser first for the 2D vocabulary, Unity or Godot where Phaser has no concept, and Three.js conventions for 3D. It says which convention each concept follows. Then spikes test the approved design, the doc gets the results, Mark approves the final version, and the build starts on feature branches.

## Open items
1. **The architecture design doc** (next step, on its own branch). It includes the shared W/H module, one source for every renderer, which must exist before any engine code.
2. **A platform spike** after the design. It has these parts: the battle stage on the new engine, a 3D hacking scene that a story script starts, and the 480x270 against 640x360 mock. Its pass lines, from Mark's feedback on 2026-10-04:
   - The bundle growth is measured and the alarm is re-set on purpose (Pixi adds about 155 kB unless it loads lazily). The 3D chunk size is recorded, and lazy chunks get their own budget class.
   - The game runs at 60 fps with bloom on Mark's desktop. Mobile is not a requirement.
   - CI passes on software WebGL.
   - After a context loss, or with no WebGL2, the 3D mode gives a fallback result within 2 seconds.
   - Enter and leave the 3D mode ten times. Memory must not grow.
   - A per-object Pixi filter and a mask work on the shared context with Three.js.
   - The battle stage on Pixi matches the Phaser spike within the agreed tolerance.
   - Mark approves the look. Plan for at least two review rounds, with no maximum.
3. **The migration path** for the rest of the 2D game onto Pixi (one shell texture first, then scene by scene), costed in the design doc.
4. **The 3D mode's name and design.** Not started. So far there is only feasibility.
