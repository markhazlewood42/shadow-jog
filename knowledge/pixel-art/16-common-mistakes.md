---
type: topic
title: "Module 16: Common Mistakes"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, mistakes, review, checklist, pillow-shading, banding, jaggies, mixels, noise]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd 8]]"]
---

# Module 16: Common Mistakes

Previous: [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Tools and workflow]]. Back to the [[projects/shadow-jog/knowledge/pixel-art/README|curriculum map]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- The twelve faults that account for most weak pixel art, with a plain test for each.
- A short review routine that finds them.
- The extra faults that appear when art comes from an AI tool or a code pipeline.

## The core ideas

Derek Yu's second tutorial is built around a before-and-after: take a deliberately naive picture and fix it step by step, because self-critique is hard when you cannot see what makes work look stiff ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). That is the right way to learn this module. For each fault below, look for it in your own work first and in a reference second.

| Fault | What you see | Why it fails | Quick test | Module |
|---|---|---|---|---|
| Too many similar colours | muddy, objects blend | each colour should have a job and an identity (Yu) | convert to a limited palette; can you still read it? | 4 |
| Naive colouring | flat "label" colours: green tree, grey rock | colour in real light is shifted and reflected | hue-shift a ramp; compare | 4 |
| Low contrast | everything mid-value | no highlights or shadows to build form | grayscale test | 4, 5 |
| Over-saturation | colours "burn" or punch through | pixel colours are light, and vivid ones tire the eye (Cure) | reduce saturation of big areas | 4 |
| Pillow shading | puffy rings of shade following the outline | pays no attention to light or form (Cure, Yu, Janes) | move the lamp; does the shading change? | 5 |
| Inconsistent light | highlights in different corners | the scene looks assembled from different worlds | draw an arrow for each object's light | 5 |
| Banding | stripes of lined-up pixels or visible colour steps | exposes the grid or flattens the form (Cure, Saint11) | look for parallel one-pixel rows at 100% | 6 |
| Jaggies and doubles | bumps in lines and curves | run lengths break the pattern (Yu, Cure, Sandro) | write out the run lengths | 2 |
| Noise (stray pixels) | speckle, "dust" | lone pixels carry no information (Cure, Saint11) | list orphans and justify each | 2, 7 |
| Bad anti-aliasing | blur, or a pale fringe on a dark background | too much, too little or on unknown backgrounds (Cure) | view on dark, light and busy backgrounds | 6 |
| Cardboard or stiff designs | rigid, thin-limbed, grid-bound | thin parts cannot be shaded into forms (Yu) | apply the chunky pixels rule | 3 |
| Mixels | one image with two pixel sizes | the eye sees two grids | zoom and compare block sizes | 1, 13 |

Cure's list of things to avoid adds a few specific faults that are worth naming: bad dithering (covering too much of the sprite so the pattern becomes a texture), "hugging" (an outline that exactly follows the fill so the grid shows) and "fat pixels" (2 by 2 blobs and thick lines) ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Pixel-Editor.com contributes a shorter beginner list: too many near-identical hues, jagged lines from inconsistent runs, shading that radiates outward with no light direction, too much detail at small scale, scaling by non-integer amounts, and black outlines everywhere ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). Its outline guide adds two-pixel borders, treating every internal line with silhouette weight, and anti-aliasing every edge ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]). Richard Janes's catalogue is blunt and still useful: bad lines, weak colour choices (including too little contrast between shades), pillow shading ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]). Slynyrd's animation lesson adds that a single orphan or misplaced pixel in a loop is obvious because it repeats ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd 8]]).

**Faults that are not faults.** Derek Yu's rules come with an escape clause. A naive piece can have charm, viewers may legitimately prefer the "before" picture, and he treats development as a personal journey with no contest in it. Pixel-Editor.com says outlines are optional, and Cure that an independent pixel is correct when it is a highlight or an essential tiny detail. A rule is a default to break on purpose. The skill the lesson trains is noticing.

**A ten-minute review routine.**

1. View at 100%. Does it read? Write down the first thing you notice.
2. Grayscale it. Is the value structure clear?
3. Fill it black. Is the silhouette recognisable?
4. Put it on three backgrounds (light, dark, busy).
5. Hunt for jaggies: run lengths on the three longest lines.
6. Count orphans.
7. Check one light direction across the picture.
8. Flip it horizontally for proportion errors.
9. Count colours and check each has a job.
10. Look again tomorrow.

**Extra faults in AI-generated and code-drawn art.** AI image tools and procedural pipelines produce faults that human artists rarely do. This list comes from this project's own notes (`docs/PIXELLAB-LESSONS.md`, `status.md`) and from the module rules, not from the web sources.

- *Pixels off the grid.* The picture looks like pixel art but has soft edges, anti-aliasing and near-duplicate colours, so it fails the control test from Module 1. The fix is to snap to a grid and quantise to a small palette, which the project's tracer does.
- *Mixed density.* An AI-made creature drawn at twice the pixel resolution of the party. Check the pixel size of every asset against the scene's grid (Modules 1 and 13).
- *Drift between frames.* Clothes change colour, hair changes shape. PixelLab's own animations did this, which is why rig v2 animates traced frames in code.
- *Stretching limbs.* Drawn forearms that grow when rotated, before the skeleton rig fixed it. Rigid parts on joints with fixed bone lengths prevent it.
- *Misread details.* A bun read as a hat, a sword as a red bar (silhouette fault, Module 3).
- *Light direction from the generator.* The picks carry whatever light the model drew (Module 5).
- *Whole-image hue shifts for variants.* A recolour that turns skin green. Use slot-based swaps (Modules 4 and 9).
- *Orphans after tracing or rotation.* A clean-up pass removes them (Modules 2 and 13).
- *Large party silhouettes that cover targets.* A composition fault in the battle view (Module 3).

## Common mistakes

This whole page is the list. The meta-mistakes are two: fixing symptoms in place (adding a pixel to cure a jaggy without seeing that the run lengths are wrong) and fixing faults one by one without a review routine, so new ones keep appearing.

## Practice

1. Take a sprite you made a month ago and run the ten-minute routine. Write down every fault.
2. Recreate Derek Yu's exercise: draw a naive scene (a tree, a rock, a character), then redo it in three passes (simplify and recolour; shade form; add life), saving each.
3. Swap sprites with a partner. Each marks only the faults from the table, and no suggestions for fixes. Then discuss.
4. Find a famous pixel-art sprite that breaks a rule and explain why it gets away with it.
5. Write your own table row for a fault not on the list.

## How I'd teach it

Never teach this module first. Mistakes mean more after the techniques exist, and the mistake names become shorthand for the lessons. Run it as a workshop with real work, and let learners find faults in their own pictures before anyone else comments. Keep the tone Derek Yu's: this is about developing an eye, and most "mistakes" are choices the artist has not yet made on purpose. Novices tend to over-correct and remove all life from the picture. When that happens, restore the rule's escape clause.

## In Shadow Jog

This module is a ready-made acceptance checklist for the art. Three uses:

- **Round review.** `status.md` lists the known art problems (mixed pixel density, party backs covering enemies, scrap heaps reading as noise, the canal reading as foliage). Mapped to the table, they are mixels (Module 1, 13), a silhouette and composition fault (Module 3), noise (Modules 2 and 7) and a material fault (Module 8).
- **A lint script.** The checks proposed in [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15]] automate most of rows 1, 3, 7, 9 and 12. A report per sprite (colours, orphans, grid uniformity, outline continuity) would make "is it pixel art?" a number.
- **Prompts to AI tools.** The prompts that worked in the art pass ("describe the look, not a game name", a style image) can carry this module's vocabulary: "no anti-aliasing, hard pixel edges, one light from the upper left, shadows shifted toward blue" are testable requests. Whether a generator obeys them is something the review step still has to check.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor.com, Pixel Art Outlines & Anti-Aliasing]]: https://www.pixel-editor.com/articles/pixel-art-outlines
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes, Introduction to Pixel Art]]: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd, Pixelblog 8: Intro to Animation]]: https://www.slynyrd.com/blog/2018/8/19/pixelblog-8-intro-to-animation
