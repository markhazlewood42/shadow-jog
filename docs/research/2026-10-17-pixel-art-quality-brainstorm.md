# Shadow Jog: How to Raise the Quality of Code-Generated Sprites and Tiles

> **Merge source, not a spec (added 2026-10-17).** A cloud session wrote this brainstorm without the project context. Mark carried it here. Read it as ideas, not as decisions.
>
> - **What the repo has that this doc does not know.** Epic E1 (#102) already plans a style guide with numbers (`docs/art/STYLE.md`) and a checker (`scripts/art/stylecheck.mjs`, pass line PL-3). The `pixlint` idea below is that checker, not a second one. The measured style target is the Sprite Fusion crew sheets (22 colors, no half-transparent pixels, near-black outline on 98 to 99 percent of edge pixels). Field characters use 4 facings today (rig v2, decision #110). Town tiles are 16 px and field characters 32 px (decision #106).
> - **"Modules 1 to 16"** name the chapters of a pixel-art lesson set that the cloud session had. That set is not in this repo. The fault list of Module 16 is rebuilt as the must-check lists of two persona packs in home-base `knowledge/verifier-personas/`: `pixel-artist-characters.md` and `pixel-artist-tiles.md`. Mark split them on 2026-10-17: character sprites and map tiles are separate skill sets.
> - **Conflicts:** the repo docs and Mark's decision issues win over this doc.
> - **Merge history.** 2026-10-17: the first test is the spike `docs/spikes/rook-turnaround.md` (Mark picked a Rook turnaround over a Lantern Row tileset). Section 8 decisions: size is set by the spike (32x32), image diffusion is out of the spike, the reference ladder uses only Mark's Sprite Fusion sheets, and two pixel-artist packs (characters, tiles) are built now.

Brainstorm, 2026-10-17. Target: the pixel-art quality of a modern JRPG (Sea of Stars, Chained Echoes, Eastward), made by long loops that include verification.

## 1. The diagnosis

The generator does not set the quality ceiling. Three other things set it:

1. **The authoring medium.** `fillRect`, circles, and noise give "programmer art". A pixel artist places clusters, not shapes.
2. **The eye.** A vision model sees pixel art poorly at full size. It cannot see one bad pixel, and it scores in absolute terms badly.
3. **The anchor.** With no locked style and no reference ladder, each asset drifts, and "good" has no definition.

Also: about half of the "modern pixel JRPG" look comes from the renderer, not the sprite. It comes from 2D lights on normal maps, particles, bloom, color grading, and parallax. PixiJS can do all of this. Put it on the plan next to the sprite work.

## 2. Change the authoring medium (largest lever)

Give the writer agent a pixel-art API that copies the steps of a human artist, not a canvas API:

- **An indexed palette as a hard rule.** One master palette with hue-shifted ramps, and sub-ramps for each material. The code rejects a color that is not in the palette. (Module 4)
- **Pixel-perfect primitives.** Lines and curves with clean run lengths, ellipses without jaggies, mirror, flood fill, a selout outline pass, and a palette swap. (Modules 2, 6)
- **Shading from form, not from guesses.** The writer authors a height map or a normal map (or simple SDF volumes). Code puts the shading into the palette ramp from one light direction. This removes pillow shading by design. (Module 5)
- **Cluster stamps for materials.** Hand-tuned stamps for stone, foliage, metal, and water in place of noise. Noise gives pixel soup. Stamps give readable texture. (Modules 7, 8)
- **Kit-bash with vetted parts.** One base body for each facing, plus libraries of heads, hair, outfits, and weapons. Approve a part once, then use it many times. Quality compounds instead of resetting with each asset. (Module 9)
- **Region edits, not regeneration.** The writer edits a labeled crop ("rows 10–14, columns 6–12") as a grid diff. A fix does not change pixels that already passed.
- **Option: a 3D-to-pixel bake in Three.js** (the Dead Cells method). Model a low-poly character, render it orthographic at the target size with nearest-neighbor filter and a palette ramp, then clean up and polish by pixel. You get all facings and consistent animation frames for free. At 16–32 px, authoring by hand gives better results. At 48 px and more, the bake is a good base. Test both (see section 7).

## 3. Deterministic checks first (cheap, every iteration)

Make each of the twelve faults in Module 16 into a script (`pixlint`). Run it before any model grader. Most failed iterations stop here at almost no token cost.

- Palette compliance, color count for each sprite, ramp length
- Orphan pixels, the ratio of 1-px clusters (a noise detector), banding (parallel same-length steps)
- Jaggies: run lengths on a curve must change in one direction
- Outline continuity, selout present where the spec asks for it
- Light consistency: shading direction compared to the normal map
- Value: a grayscale histogram, and sprite-to-background contrast at 1x
- Silhouette: fill the sprite to black, then measure overlap (IoU) with the other characters. Two characters that look alike is a fault. (Module 3)
- Pixel density: no mixels, no non-integer scale (Modules 1, 13)
- Tiles: seam diff on a 3x3 repeat, an FFT for visible repetition, autotile completeness (blob 47 or Wang) (Module 11)
- Animation: pixel-count variance (volume), center-of-mass path, foot slide against the ground line (Module 10)

**Stat-match to references.** Run the same scripts on a reference set of real JRPG sprites. You get target ranges: colors per sprite, cluster-size distribution, outline-pixel ratio, ramp lengths. The distance to those ranges is an objective score that the writer cannot argue with.

## 4. Model graders: fix the eye problem

- **A contact sheet for each grade, not one image.** 1x native size, 8x with a grid and coordinates, grayscale, silhouette, in context on a real map at 640x360, and next to a reference. Each view lets the grader see a different fault.
- **Zoomed crops with coordinates.** A grader sees a 16x16 crop at 16x and can name a fault at pixel (12,7). The writer can act on that.
- **Pairwise, not absolute.** Ask "A or B, and why?", not "score 1–10". Keep an Elo ledger across candidates.
- **An anchored ladder.** Put real reference sprites on levels 1–5. Ask "is this better than the level-3 anchor?" The asset moves up the ladder. Use the references for grading only. Do not trace or copy them.
- **Structured findings.** Each finding has a fault ID (Module 16), coordinates, severity, and a proposed fix. No vague prose.
- **A specialist panel** (one persona pack each): form and light, color, readability in game, animation, tiles and environment. Each specialist gets only the views for its job.
- **Anti-Goodhart rules.** Graders do not see the rationale of the writer. One holdout grader runs only at gates. A regression check makes sure that a fix for A did not break B.
- **Calibration by Mark.** Mark rates a small sample at each gate. Measure the agreement between the graders and Mark. When a grader passes something that Mark fails, add it to the calibration set of the pack.

A new persona pack is necessary: **pixel artist**, built from Modules 1–16. The current game-designer pack grades feel and readability, not craft.

## 5. Loop structure

**Lock the style before volume.** Gates in sequence:

1. Style bible: sprite sizes, head-to-body ratio, light direction, outline style, ramp rules, do/don't pairs
2. Master palette and material swatches
3. Base body for each facing (a mannequin)
4. One golden hero character and one golden 3x3 tile set, polished to the top of the ladder
5. Only then, the asset inventory. The golden set is the consistency reference for every later asset.

**Each asset goes through stages, with breadth early and depth late:**

concept text → 8–16 silhouette thumbnails (pairwise selection) → blockout → color flats → shading → AA and selout → polish → in-context check

The early stages are cheap, so make many variants. The late stages are expensive, so make few. Each stage has a gate: `pixlint` first, then the specialist panel.

**Search, not one pass.** Keep a beam of k candidates. Mutate, judge in pairs, keep the best. For tile variants, use quality-diversity (MAP-Elites): keep the best tile in each "look" cell, so the set has variety without repeats.

**Stop rules.** A cap on iterations for each stage. A plateau rule: stop when the new best wins less than about 55% of pairs against the old best for 3 rounds.

**Set passes, not only asset passes.** A lineup sheet of all characters at 1x, a palette-use audit, and a density audit. Grade tiles on generated sample maps, not alone: repetition, and walkable areas that the player can read against blocked areas.

**Animation.** Key poses first, then inbetweens. The graders see a filmstrip, onion skin, and a GIF. The motion checks in section 3 run on each frame.

## 6. Prompt strategies

- Give rule cards for each stage, not full modules. The shading stage gets Module 5 rules only.
- Give exact numbers: size, light direction, maximum colors, outline type.
- Make the writer state its intent before pixels: the planes, where the light hits, the main clusters.
- Give each fix one fault ID and one region. Small fixes keep the parts that already passed.

## 7. First experiment (proposed)

A spike before any loop at scale: one hero character (one facing, idle plus walk) and one 3x3 grass-to-path tile set.

- A/B three authoring media: grid DSL by hand, height map plus palette ramp, and a Three.js bake.
- Run `pixlint`, the stat-match, and pairwise grades. Mark rates the results blind.
- Output: which medium wins, and the agreement rate between the graders and Mark.

## 8. Decisions for Mark

1. Target sprite size: for example 32x48 characters and 16x16 or 32x32 tiles at 640x360.
2. Is an image-diffusion model allowed for concept thumbnails only, with code for the final pixels? This is a quality gain against the "code-generated" goal and licensing questions.
3. Which reference games go on the grading ladder.
4. Do we build the pixel-artist persona pack now?
