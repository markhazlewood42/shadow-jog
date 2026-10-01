---
type: topic
title: "Pixel Art: Curriculum Map and Overview"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, curriculum, overview, learning-path]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]"]
---

# Pixel Art: Curriculum Map and Overview

This folder is a library about the craft of pixel art, written for two readers. The first is the agent that builds Shadow Jog's art: it needs the reasons behind the rules so it can judge and make art, not just follow a checklist. The second is a future course for a complete novice (Mark Hazlewood is a designer with no pixel-art background), so every page is written in teaching order, defines a term where it first appears, and ends with exercises and teaching notes. It is a set of research notes. The course itself is not built.

Everything here is in my own words and cites its sources. About 55 sources were read, listed at the bottom, and each has a short page in the `sources/` folder saying what it is best for. Terms are in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]]. The game's own pixel-art ideas, in plain words, live in `docs/CONCEPTS.md`, which now points here.

## What pixel art is, in five sentences

Pixel art is made by deciding where each pixel goes, so the artist stays in control of the picture down to the single dot. Small canvases and small palettes are the point, because every pixel and every colour has to do real work. Almost everything else follows from the grid: lines are staircases whose steps must be regular, shading is a handful of colour steps arranged by a light, and anything that blends pixels you did not choose (blurring, smooth scaling, non-whole-number rotation) damages the work. Pixel art grew out of hardware limits on arcade machines and consoles, and the style outlived the limits because the constraints produce clarity. The skill is mostly seeing: which three details make a material, which pixels to leave out, and where the eye will average two colours into a third.

## The curriculum, in teaching order

| # | Module | What it teaches | Needs first |
|---|---|---|---|
| 1 | [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution\|The grid and resolution]] | What pixel art is, canvas sizes, pixel density, judging at 100% | nothing |
| 2 | [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters\|Lines, curves and clusters]] | Clean lines as run lengths, jaggies, doubles, curves, clusters, orphan pixels | 1 |
| 3 | [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette\|Shape and silhouette]] | Silhouette first, volumes, chunky pixels, proportions, readability | 1, 2 |
| 4 | [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes\|Colour and palettes]] | Hue, saturation, value, ramps, hue shifting, palette size and choice | 1 |
| 5 | [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form\|Light, shading and form]] | One light, form shading, pillow shading, tone counts, glow and cast shadows | 3, 4 |
| 6 | [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing\|Outlines and anti-aliasing]] | Outline styles, selout, manual AA, banding | 2, 5 |
| 7 | [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture\|Dithering and texture]] | Dither patterns, Bayer matrices, five texture rules | 4, 5 |
| 8 | [[projects/shadow-jog/knowledge/pixel-art/08-materials\|Materials]] | Cue sets for foliage, stone, sand, water, metal, glow, hair | 5, 7 |
| 9 | [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters\|Sprites and characters]] | Sprite sizes, facings, proportions, faces, portraits, palette swaps, the back view | 3, 5, 6 |
| 10 | [[projects/shadow-jog/knowledge/pixel-art/10-animation\|Animation]] | Frames and timing, key poses, walk cycles, smears, sub-pixel movement | 9 |
| 11 | [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments\|Tiles and environments]] | Seamless tiles, autotiling, Wang and blob sets, projection, backgrounds | 5, 7 |
| 12 | [[projects/shadow-jog/knowledge/pixel-art/12-ui-and-fonts\|UI and fonts]] | Panels, bars, nine-slice, bitmap fonts | 1, 4 |
| 13 | [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation\|Scaling, display and rotation]] | Integer scaling, mixels, Scale2x, RotSprite, crisp pixels on the web | 1 |
| 14 | [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles\|History, hardware and styles]] | NES, SNES and Mega Drive limits, Phantasy Star IV, self-imposed limits | 4 |
| 15 | [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow\|Tools and workflow]] | Editors, indexed colour, order of work, checks, practice, a pipeline lint | all |
| 16 | [[projects/shadow-jog/knowledge/pixel-art/16-common-mistakes\|Common mistakes]] | Twelve faults with quick tests, a ten-minute review, AI-art faults | all |

The first five modules are the core. A learner who has done Modules 1 to 6 can make a clean, shaded, outlined static sprite. Modules 7 to 12 widen the range (surfaces, characters, motion, worlds, interface). Modules 13 to 16 are for people who ship art: display, history, tools and review.

## A suggested learning path for a novice

Eight weeks at a few hours a week. Each step ends with something drawn.

1. **Week 1: Modules 1 and 2.** Draw five 8 by 8 icons, then the perfect lines and three circles. Goal: stop fearing the grid.
2. **Week 2: Modules 3 and 4.** Silhouette line-up, then a Game Boy palette sprite, then a hue-shifted ramp. Goal: read value and shape before colour.
3. **Week 3: Modules 5 and 6.** The ball test, the pot, one character outlined four ways. Goal: light and a clean edge.
4. **Week 4: Modules 7 and 8.** The two-colour cylinder, a pond, a wall. Goal: surfaces by restraint.
5. **Week 5: Module 9.** A template body and three characters from it, plus one face. Goal: a small cast with shared proportions.
6. **Week 6: Module 10.** The bouncing ball, then a four-frame walk. Goal: weight and timing.
7. **Week 7: Modules 11 and 12.** One seamless tile with variants, one nine-slice panel. Goal: art that repeats and stretches.
8. **Week 8: Modules 13 to 16.** Scaling demonstration, a virtual console spec, then the ten-minute review on all your work. Goal: ship a small asset set that passes the review.

A shorter path for a builder who mostly judges art made by tools (Mark's case, and the agent's): Modules 1, 4, 5, 6 and 13 for vocabulary, Module 16 as the review checklist, and the rest when a problem points to them. The "In Shadow Jog" section of each module says where the topic touches the game.

## Rules the art agent can apply

These are condensed from the modules. Each has its reasons on the linked page.

1. One pixel size per scene. Compare every asset's grid against the field's ([[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|1]], [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|13]]).
2. Check the silhouette at game size before judging detail ([[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|3]]).
3. Solve value in grayscale before hue; hue-shift ramps toward cool shadows and warm lights unless the scene's light says otherwise ([[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|4]]).
4. One light direction per scene, including after mirroring ([[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|5]]).
5. Two to three tones under 24 pixels, three to five at 32 to 64 ([[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|5]]).
6. A full one-pixel outline is the safe default on varied backgrounds; broken or selective outlines only on backgrounds you control ([[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|6]]).
7. Manual AA only on long shallow edges, judged at 1x; never on the outside edge of a sprite drawn over unknown backgrounds ([[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|6]]).
8. Dither as a buffer at the ends of a flat area, never over half a sprite; keep it off parts that rotate ([[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|7]]).
9. Texture by restraint: simplify, repeat with varied spacing, leave quiet areas ([[projects/shadow-jog/knowledge/pixel-art/08-materials|8]]).
10. Delete orphan pixels unless they are a highlight, an eye or a deliberate detail ([[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|2]]).
11. Scale only by whole numbers with nearest-neighbour; rotate as little as possible, with RotSprite, and clean up after ([[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|13]]).
12. Animate with held key poses, short smears and timing changes before adding frames ([[projects/shadow-jog/knowledge/pixel-art/10-animation|10]]).

## Where the sources disagree

Short list. Each is argued on the page named.

- **Anti-aliasing on small sprites.** Pixel-Editor.com says skip it below 16 pixels; Derek Yu uses it at 32; Slynyrd rejects automatic AA outright; Saint11 treats it as a judgement call ([[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]]).
- **What "selout" means.** Lighter outline in lit areas (Derek Yu, Lospec), outline only on shadow sides (Pixel-Editor.com), or an outline anti-aliased into a known background, called a form of bad AA (Cure) ([[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]]).
- **How long a ramp is.** Three to five steps for a sprite (Pixel-Editor.com, Janes) against nine in Slynyrd's master palette; the difference is purpose ([[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]]).
- **How fashionable dithering is.** Janes calls it largely irrelevant today, Cure says it is less versatile on crisp screens, and Pixel-Editor.com treats it as ordinary ([[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]]).
- **Hue-shift direction.** A fixed positive step per swatch (Slynyrd) versus warm highlights and cool shadows (Cure, Saint11, Janes), qualified by Pixel-Editor.com for neon, fire and moonlight ([[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]]).
- **Walk-cycle frame count and rate.** Four (minimum), six, or eight (Slynyrd's "optimum"), and Pixel-Editor.com's 8 fps "standard" that no other source supports ([[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]]).
- **NES colours on screen.** 25 (Pixel-Editor.com) against 16 in my reading of Copetti; the figures agree when you count the shared transparent slots ([[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|Module 14]]).
- **Pillow shading's real fault.** Not facing the viewer, says Cure, who allows a frontal light as long as form is respected; the other sources describe it as shading with no light ([[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]]).

## Gaps, and what to do about them

- **Video teachers (AdamCYounis, Brandon James Greer) were not read.** Their teaching is video. A future pass could watch Pixel Art Class and add notes ([[projects/shadow-jog/knowledge/pixel-art/sources/video-creators|video-creators]]).
- **Pedro Medeiros's 512 by 512 tutorials are images.** Only titles were readable, so materials such as metal, fabric and fire rely on other sources ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-tutorial-library|Saint11 library]]).
- **Mixels and pixel-font legibility** each rest on thin sources (Modules 12 and 13 say so).
- **No primary source for Phantasy Star IV's exact sprite sizes or palettes.** Measure screenshots or an emulator's sprite viewer before copying proportions.
- **Cure's tutorial was read through a mirror** because the original refused my request; Pixel-Editor.com's articles were read from its script bundle because the pages are drawn client-side.

## Sources

Grouped by kind. Each page says how I read it and what it is best for.

**Starting sources and classic tutorials**

- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu: Pixel Art Tutorial, Basics]]: The best single starting article: it is complete, in order, and explains reasons.
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu: Pixel Art, Common Mistakes]]: Teaching the "why" behind four faults with matched images.
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure: The Pixel Art Tutorial (Pixel Joint forum)]]: The clearest account of what makes pixel art pixel art, plus the best treatment of clusters, noise and banding.
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes: Introduction to Pixel Art]]: A compact old-school view and a good first exercise (the pot).
- [[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione: Getting Started with Pixel Art, a Beginner Perspective]]: The "perfect lines" list and the pixel-count arithmetic.
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 (Pedro Medeiros): Pixel Art Beginner Articles]]: Short, practical explanations from a leading practitioner.
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-tutorial-library|Saint11 (Pedro Medeiros): Pixel Art Tutorials (index)]]: Where to send a learner for materials and effects this library does not cover.

**Lospec**

- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-where-to-start|Lospec: Pixel Art, Where to Start]]: A roadmap for a novice.
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-outlines-colour|Lospec: Pixel Art Outlines, Part 2, Using Color]]: The contrast rule and the internal-line guidance.
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-tutorial-library|Lospec: Pixel Art Tutorials (index and tag pages)]]: Finding further reading.
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec: Palette List (and the Resurrect 64 entry)]]: Picking a ready-made palette and loading it into an editor.

**Slynyrd (Raymond Schlitter), the Pixelblog**

- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-01-palettes|Slynyrd (Raymond Schlitter): Pixelblog 1, Color Palettes]]: A numeric method for master palettes.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd (Raymond Schlitter): Pixelblog 2, Texture]]: Teaching texture as restraint.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd (Raymond Schlitter): Pixelblog 3, Graphical Projections, Part 1]]: Understanding why games bend perspective.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd (Raymond Schlitter): Pixelblog 5, Back to the Basics]]: The author's statement of principles.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-06-light|Slynyrd (Raymond Schlitter): Pixelblog 6, Light and Shadow]]: The mood side of lighting.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd (Raymond Schlitter): Pixelblog 8, Intro to Animation]]: Frame economy and timing.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-09-melee|Slynyrd (Raymond Schlitter): Pixelblog 9, Melee Attacks]]: Smear frames, holds and the responsiveness trade-off.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd (Raymond Schlitter): Pixelblog 22, Top Down Character Sprites]]: The most directly relevant article for a 480 by 270 JRPG.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-26-ui|Slynyrd (Raymond Schlitter): Pixelblog 26, UX/UI Design Basics]]: Principles for resource displays.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd (Raymond Schlitter): Pixelblog 29, Anime Faces and Hair]]: Concrete numbers for small faces and a hair method.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd (Raymond Schlitter): Pixelblog 39, Sci-fi RPG]]: The most on-topic style study for a Phantasy Star IV look.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd (Raymond Schlitter): Pixelblog 42, Cyberpunk Pixel Art]]: Setting-specific advice for Shadow Jog's cyberpunk-fantasy world.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd (Raymond Schlitter): Pixelblog 43, Top Down Tiles, Part 2]]: Honest, practical tile workflow.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd (Raymond Schlitter): Pixelblog 47, Tiny Pixels]]: The philosophy of very small art.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-50-walk-cycle|Slynyrd (Raymond Schlitter): Pixelblog 50, Human Walk Cycle]]: The structure of a walk and frame trade-offs.
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd (Raymond Schlitter): Pixelblog 62, Landscape Backgrounds]]: The best match for JRPG battle backdrops.

**Pixel-Editor.com articles**

- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com: Fundamentals of Pixel Art]]: A tidy beginner checklist, the canvas-size table and the six-step workflow.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor.com: Color Theory for Pixel Art]]: A compact explanation of ramps and the value-first method.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor.com: Pixel Art Shading Techniques]]: Concrete numbers for how many tones to use, and a clear statement of the specular-placement rule.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor.com: Pixel Art Outlines & Anti-Aliasing]]: A clear comparison table of outline styles and a list of mistakes.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor.com: Pixel Art Dithering]]: A short hands-on exercise that can be assigned as is.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-animation|Pixel-Editor.com: Sprite Animation Fundamentals]]: A clean summary of the principles for a beginner.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor.com: Lighting & Glow Effects]]: Teaching how to light a small scene step by step.
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor.com: Rendering 8-Bit Pixel Water]]: A clean way to teach one material from first principles.

**Animation, tiles, scaling, tools and UI**

- [[projects/shadow-jog/knowledge/pixel-art/sources/tinywarrior-subpixel|Tiny Warrior Games: Pixel Art Sub-Pixel Animation]]: A plain-language introduction to sub-pixel animation.
- [[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-classification|Boris the Brave: Classification of Tilesets]]: Precise vocabulary for tilesets.
- [[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-roundup|Boris the Brave: Tileset Roundup]]: Choosing an autotile system by artist workload.
- [[projects/shadow-jog/knowledge/pixel-art/sources/boris-blob-tileset|cr31: The Blob Tileset (hosted by Boris the Brave)]]: The bitmask method in a few lines.
- [[projects/shadow-jog/knowledge/pixel-art/sources/mdn-pixel-art-on-the-web|MDN: image-rendering and Crisp Pixel Art Look]]: The rules for showing pixel art in a browser.
- [[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite Documentation: Color Mode and Rotate Sprite]]: Why palette-indexed art is useful and what RotSprite is for.
- [[projects/shadow-jog/knowledge/pixel-art/sources/glyphs-pixel-font|Glyphs: Creating a Pixel Font]]: Metrics and spacing basics for a bitmap font.
- [[projects/shadow-jog/knowledge/pixel-art/sources/wayline-ui-bars-panels|Wayline: Game UI Art, Bars, Meters and Panels]]: Concrete UI construction rules.

**History, hardware and Phantasy Star IV**

- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]: A neutral timeline and a map of vocabulary.
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-nes|Rodrigo Copetti: NES Architecture]]: Showing how tight the earliest limits were.
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-snes|Rodrigo Copetti: Super Nintendo Architecture]]: Numbers for comparison with the Mega Drive.
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Rodrigo Copetti: Mega Drive / Genesis Architecture]]: Hard numbers for the reference console.
- [[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|Hardcore Gaming 101: Phantasy Star IV]]: Understanding what the reference game is doing, not how.
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia: Phantasy Star IV]]: Dates and credits.

**Other reference pages**

- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia: Pixel-art scaling algorithms]]: Understanding which algorithm solves which problem.
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-ordered-dithering|Wikipedia: Ordered dithering]]: A programmer's explanation of the Bayer pattern used in the game's code.
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-wang-tile|Wikipedia: Wang tile]]: The origin of the name and the one-line rule.
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-animation-principles|Wikipedia: Twelve basic principles of animation]]: A complete list to map to pixel work.
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia: Palette swap]]: A short historical justification.

**Not read**

- [[projects/shadow-jog/knowledge/pixel-art/sources/video-creators|Video creators not read: AdamCYounis and Brandon James Greer]]: A reminder of where a video-first course would start.

## How to extend this library

Add a source page under `sources/` first, then cite it from the modules it informs. Keep prose in my own words, one paragraph per line, and add anything the game learns to the module's "In Shadow Jog" section. When a new source disagrees with a page, record both claims with dates and leave a note, and do not overwrite quietly.
