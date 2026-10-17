---
type: research
title: R4, 3D with pixel shaders versus pure 2D pixel art
---

# R4: 3D with pixel shaders versus pure 2D pixel art

Date: 2026-10-17. Method: read-only. I read the repo docs and the spike records, and I checked web sources (URLs inline). No code changed. Mark asked: does the "true 2D pixel" choice make Shadow Jog much harder to build with Claude, and would a 3D game with a fixed camera and a pixel shader be easier? Effort is stated as architectural fit, not time (Mark's rule).

## Short answer

- **The hard part is not "2D". It is "characters drawn by hand, by a model that cannot judge a look".** The engine, the maps, the battles and the effects work today. The thing that failed for weeks is one job: drawing the same character from new angles, and later in new poses. A 3D model solves exactly that job, because a model turned 45 degrees is still the same model.
- **A full move to real-time 3D (option C) solves characters, but it creates a new, bigger job: every map, prop and backdrop becomes a 3D scene.** Chapter 1 is built, and its tiles and props are 2D art you already like. So C trades one hard problem for several.
- **Recommendation: keep the 2D engine and test 3D for characters only** (option B, or its runtime form H1). Run one spike on Rook. If Mark accepts the look of a rendered Rook at 1x, the character problem is mostly solved. If he does not, you learn that in one spike, not after a rewrite.

## 1. The 3D-with-a-pixel-look method, in plain words

**How it works.** The game draws a normal 3D scene, but into a very small picture (a *low-res render target*: an off-screen image, for example 640x360). Then it scales that picture up by a whole number with *nearest-neighbor* scaling (each pixel becomes a clean square block, no blur). Extras make it read as pixel art:
- *Toon shading*: light falls in 2 or 3 hard steps, not a smooth gradient.
- *Palette lock*: each color snaps to a fixed list of colors.
- *Outline pass*: a 1 px dark line where depth or surface angle jumps.
- *Pixel snapping*: the camera moves only in whole-pixel steps, so the picture does not "crawl".

**Shipped examples (screenshots in the folder listed at the end).**
- *A Short Hike* (2019): 3D drawn into a low-res target with no smoothing, a small palette and toon shading. This account is secondhand: players who cite the developer's GDC talk ([itch.io](https://itch.io/post/1725399), [itch.io](https://itch.io/post/4486589)).
- *FEZ* (2012): a 3D world built from pixel-art blocks ("trixels"), seen flat, turned in 90-degree steps ([TIGSource](https://www.tigsource.com/?p=19171)).
- *t3ssel8r*: the best-known modern look (YouTube devlogs, Unity, orthographic camera with grid snapping). There is no shipped game yet. The snapping method is cited in [Ebert 2026](https://arxiv.org/html/2603.14587v1).
- *Octopath Traveler* and *Dragon Quest III HD-2D* (*HD-2D*: 2D pixel sprites standing in a lit 3D world, with depth of field and bloom). Square Enix teams made these. The developers say the first tries were "uninteresting" and then "lost the appeal of pixel art" before they found the balance ([Siliconera](https://siliconera.com/?p=683405)).
- *Cassette Beasts* (2023): 2D pixel characters in a 3D world, made by a two-person team on Godot ([Shacknews](https://www.shacknews.com/article/135221/cassette-beasts-review-score), [Godot showcase](https://godotengine.org/article/godot-showcase-cassette-beasts/)).

**Known problems.**
- *Pixel creep* (shimmer): when the camera moves, edges flicker as pixels jump. Grid snapping fixes this **only for an orthographic camera** (*orthographic*: no perspective, far things are not smaller). "Pixels at different depths drift at different rates, and no single snap corrects all depths" ([Ebert 2026](https://arxiv.org/html/2603.14587v1)). The repo's own test agrees: a perspective camera crawls at every size, and a snapped orthographic camera does not (`docs/research/2026-10-04-engine-and-3d.md`, round 3).
- *Rotation*: snapping does not fix a turning object or camera. A commercial plugin says it plainly: rotation still re-draws the pixels ([Fab listing](https://www.fab.com/listings/816f34f2-1a2e-4910-b3dd-009b5da0873b)).
- *Small characters*: at 32 px tall, a 3D model gives few readable details. Dead Cells' artist, at about 50 px: "The disappointing level of details is and always will be an issue" ([Game Developer](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)).
- *Flicker in animation*: Dead Cells: "we still haven't found any solution for flickering pixels" (same source).
- *Browser speed is not the risk.* Three.js r186 drew 300 meshes with fog and bloom at 480x270 in about 9 ms even on software WebGL (repo research, round 1). A low-res target is cheap. The risks are look, shimmer and CI determinism, not frame rate.

## 2. The middle path: model in 3D, render offline to sprites (the Dead Cells method)

- **Dead Cells.** One artist for the first year. He drew a simple pixel model sheet, built the model and skeleton in 3ds Max, and an in-house tool rendered each frame small, with no anti-aliasing, plus a normal map for a toon shader. Gains: "we can adjust the timing of the animations dozens of times in minutes", old models are reused for new monsters, and in-between frames come for free. Costs: low detail and pixel flicker ([Game Developer](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)).
- **Factorio** (not pixel art, same idea): Blender models, rendered in layers, put back together in the engine, then painted over by hand to fix contrast and edges ([FFF-146](https://factorio.com/blog/post/fff-146)).
- **Tools exist.** Several Blender add-ons render 4 or 8 directions to sprite sheets, with pixel size, color depth, a 1 px outline and a light rig fixed to the camera, so shading stays the same at every angle ([True Pixel Art Generator](https://superhivemarket.com/products/true-pixel-art-generator-v2/docs), [8 Directions plugin](https://auteddy.itch.io/8-directions-render-plugin-for-blender)). Claude does not need them: a short Blender Python script can do the same, and the Blender MCP server here lets Claude run Blender and look at the render.
- **AI sprite tools use this too.** Ludo states that it "makes a rigged 3D model of your character" to draw 8 directions (R1, [Ludo docs](https://ludo.ai/docs/sprite-generator)).
- **This spike already did a small version.** `scripts/art/v2/proxy/` is a code-built 3D figure of Rook, rendered orthographic at 32x32 (`render.mjs`). It gave good *layout* (se silhouette 0.933) but not the Sprite Fusion *texture* (consult C2). The lesson: a 3D render gives structure for free and texture never. You must either accept the rendered texture as the style, or add texture after the render.

## 3. The three options with Claude as the main builder

Claude is strong at code, shaders, math, procedural geometry and Blender Python. Claude is weak at freehand pixel placement and at judging a look (spike learnings: invention 49 to 59 percent exact, copy 99.6). Agents also do badly at organic modeling, topology, rigging and animation (repo research, round 1). Free rigs and motions reduce that gap: Quaternius' Universal Animation Library is CC0, 120+ motions on a standard humanoid rig ([quaternius.com](https://quaternius.com/packs/universalanimationlibrary.html)). Mixamo is free for games, but its raw files must not be redistributed ([Adobe FAQ repost](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400)). The repo is public, so Mixamo files cannot sit in it. Use CC0 sources.

| | A. Pure 2D pixel (today) | B. 3D models, pre-rendered to sprites | C. Real-time 3D, fixed camera, pixel shader |
|---|---|---|---|
| Where the hard part sits | Hand drawing of each facing and pose (Claude's weakest skill) | One model per character, then rendering (Claude's strong skills) | Every map, prop and character as 3D, plus the look |
| Same character from 8 angles | Hard: weeks of rounds, not solved | Free, by construction | Free |
| Walk cycles, battle poses | Each new pose is new drawing | A motion from a library, re-rendered | Same as B, live |
| Detail at 32 px | High, if drawn well (Sprite Fusion) | Lower, "rendered" look unless textured or painted over | Same as B, plus shimmer on rotation |
| Maps, tiles, props | Keep (PixelLab tiles stay) | Keep | Rebuild all in 3D |
| Engine fit | Fits (no change) | Fits: offline tool, same sheet format | Full rewrite of field and battle draw |
| New hard problems | Art quality and cost per pose | Modeling and rigging; palette lock; style match with 2D tiles | Shimmer, lighting, 3D content for all of Chapter 1, editors, CI |
| Look | Matches the genre bar (Eastward, Sea of Stars) | Dead Cells look | A Short Hike or HD-2D look, a different game |

**Option A (stay as now).** The engine is fine. Characters stay a hand-art problem. The workable art sources are Sprite Fusion (15 credits per facing, Mark's picks) and copy-and-transform code (path C), with Mark as the gate. Every new character, facing and pose costs a new drawing.

**Option B (pre-render).** Moves the hard part into Claude's strengths. New hard problems: a stylized low-poly model of each character (head, hair mass, coat, katana) must read at 32 px; palette lock so the render uses the character's ramps; a 1 px near-black outline (the style rule); and a style match with the PixelLab tiles. Detail comes from three levers: pixel-art textures on the model at one texel per screen pixel, the existing code painter (consult C2) on the render, and Sprite Fusion `edit_sprite` touch-ups on only the face.

**Option C (real-time 3D).** Solves characters and lighting, and fits Mark's wish for effects. But it makes the whole world 3D content: Lantern Row, the Sprawl, the Rustyard, the Sinkline, the Annex, the dock and every interior. Shimmer under camera follow and turning objects needs real care. HD-2D, the closest look to a JRPG, was hard even for Square Enix.

## 4. Fit with this codebase

- **A: fits.** No engine change.
- **B: fits the current architecture.** The renders are an offline tool (`scripts/art/blender/` or a growth of `scripts/art/v2/proxy/`). The output goes into the sheet formats that exist: `public/art/crew/<id>/`, the drawn-art manifest (`src/art/drawn.ts`, `CharSprite.walk`) and the battle backs (`src/art/rig2/battle.ts`, `battle.json`). Two real changes:
  - 8 directions need `Dir` in `src/art/chars.ts` (today `'down' | 'up' | 'left' | 'right'`) and movement in `src/field/actor.ts` to grow from 4 to 8. Without that, B still gives 4 facings for free.
  - Battle poses from motions replace the IK skeleton posing in `src/art/rig2/` (`skeleton.json`, `solveArm`) for the crew. The code-drawn art stays the fallback, as today.
- **H1 (3D characters drawn live, see section 5): partial rewrite.** The plumbing exists: `src/sje/three/frame3d.ts`, `src/sje/render/frametexture.ts` and `src/sje/display/view3d.ts` already put a Three.js picture into the Pixi scene on the pixel grid. New: a character renderer that draws each actor into a small target (or one shared atlas target), and actors that show a `View3D` instead of a sprite. Touches `src/field/actor.ts`, `src/scenes/fieldkit/draw.ts`, `src/battlestage/figure.ts` and `src/scenes/battlekit/`. GLB models and GLTFLoader add to the lazy 3D chunk (cap 160 kB, decision C5). The 3D path then stops being optional for the field, so the no-WebGL2 fallback must be the pre-rendered sheets of option B.
- **C: full rewrite of the draw side.** Rewrite: `src/field/*` (`tiles.ts`, `bake.ts`, `lighting.ts`, `props.ts`, `buildings.ts`), `src/scenes/field.ts` and `fieldkit/`, the map data in `src/data/maps/*` (terrain grids become 3D layout), `src/battlestage/*`, `src/art/battlebg*.ts`, `src/art/enemies.ts`, most of `src/art/`. It also changes E1 (tileset format, #102) and the E3 map editor (#104). Keeps: game state (`src/game/`), the battle engine (`src/battle/engine.ts`), story scripts, audio, UI windows and text, and the hack mode. The Playwright screenshot tests and capture determinism need new baselines.

## 5. Hybrid ideas beyond A, B and C

- **H1. 3D characters, drawn live into a small texture.** Each character is a low-poly rigged model. Each frame, Three.js draws it with an orthographic camera into a 32x32 (field) or 80x80 (battle) target, with toon steps, palette lock and an outline pass, and Pixi shows it as a sprite. Free: any facing, smooth turns, any pose and blends between poses. Risk: flicker on rotation and the "rendered" look. Mitigation: snap yaw to 8 directions and play motions at 8 to 12 fps, like a sprite.
- **H2. Pre-render as structure, paint as texture.** Blender renders per-pixel maps, not final pixels: part ID, light level and outline (the proxy already does this). Code then paints each part from the character's own ramps and texture patches (consult C2 code painter). An LLM or Sprite Fusion touches only the face. This keeps the dense hand style closer to Sprite Fusion, with structure from 3D.
- **H3. 3D only where 2D hurts most: battle backs.** The battle needs the most poses (idle, attack, strike, cast, item, hurt, victory, thrust, brace, aim) at the largest size (79x68). A rigged model plus CC0 motions gives all of them. Field sprites stay 2D at 4 facings.
- **H4 (later, not now). HD-2D-lite for one place.** Build one small map as a 3D diorama from its terrain grid, with 2D characters as *billboards* (flat sprites that always face the camera). This is the Cassette Beasts and Octopath idea. Try it only after the demo, if Mark wants depth and light as the differentiator.

## 6. Recommendation and the spike

**Recommendation.** Do not rewrite to real-time 3D. Keep the 2D engine, maps and tiles. Test 3D for characters only: option B first, which needs no engine change, and H1 later if B's look passes. The pivot that matters is "characters from models, not from drawings". It needs a spike, not a rewrite.

**Spike: "Rook from a model" (one branch, `spike/rook-3d`, exit lines committed before code).**
1. Build Rook as a stylized low-poly model in Blender with Claude driving Blender Python and `look`. Use a CC0 humanoid base and Quaternius CC0 motions (idle, walk, one sword swing), retargeted. No Mixamo files in the repo. No image generation.
2. Render offline with an orthographic camera at the game's 3/4 pitch: 8 facings, a 4-frame walk per facing, and 2 battle poses at the battle size. Toon light in 3 steps from the top-right (the light fit in consult C2). Palette lock to the walk palette. 1 px near-black outline.
3. Optional texture pass: the existing code painter on the coat and hair (H2).

**Pass lines.**
- **Hard (checker, existing `pixlint.mjs` lines).** Walk palette only, no half-transparent pixel, outline at least 93 percent near-black, height 31 plus or minus 1, head alone 13 to 15 px, all frames.
- **Structure.** A blind facing-ID grader names 9 of 10 facings (C2 line). The katana stays on the same body side in all 8 (no mirror error).
- **Zero hand pixels.** All frames come from scripts. A re-run gives byte-identical output.
- **Cost of the next pose.** One new battle pose is one new motion plus a re-render, with no drawing.
- **Mark's look gate (the real answer).** Mark sees the 8 facings and the walk at 1x and 4x on a Lantern Row screenshot, beside the Sprite Fusion given frame and rig v2. He answers two questions: "same character in all 8, yes or no", and "would you ship this look next to the PixelLab tiles, yes or no".
- **Kill line.** If Mark says "this reads as 3D, not pixel art" at 1x, after one texture round (step 3), stop. The answer is then "stay with A", with Sprite Fusion and path C as the sources.

**What each result means.** Pass: the character art problem is solved by construction, for every character and pose, and E1 plans on it. Pass on structure, fail on look: try H2 (structure from 3D, texture from code). Fail on structure (the model does not read at 32 px): a 3D pivot would not help either, and option C is off the table for the same reason.

## Screenshots for Mark (internal reference only, not in the repo)

Folder: `C:/Users/markh/AppData/Local/Temp/rook-v2/r4-screens/`, with `index.md` (file, game, method, source URL). 12 Steam store screenshots: A Short Hike and FEZ (real-time 3D pixel), Dead Cells and Factorio (pre-rendered), Octopath Traveler II, Dragon Quest III HD-2D and Triangle Strategy (HD-2D), Cassette Beasts (hybrid) and Eastward (pure 2D contrast).
