---
type: topic
title: "Module 15: Tools and Workflow"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, tools, workflow, aseprite, indexed-color, practice, critique]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/lospec-where-to-start|Lospec: where to start]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec palettes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/lospec-tutorial-library|Lospec tutorial library]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/video-creators|Video creators (not read)]]"]
---

# Module 15: Tools and Workflow

Previous: [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|History, hardware and styles]]. Next: [[projects/shadow-jog/knowledge/pixel-art/16-common-mistakes|Common mistakes]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- Which tools are enough to start, and which features matter.
- The order of work for one sprite, and the checks to run before calling it done.
- How to practise and get better, and how to protect your hands and eyes.
- How a code-and-AI pipeline (like Shadow Jog's) fits this workflow, and which checks it can automate.

## The core ideas

**Almost any editor works if it has the essentials.** Derek Yu lists them: zoom, a pencil that places single pixels, line and shape tools, selection and move, and a bucket fill. He surveys the field. Windows Paint is workable. Piskel runs in a browser and exports PNG and animated GIF. GraphicsGale (Japanese, Windows only) has animation tools and became freeware in 2017. Aseprite is the most popular paid editor, cross-platform, with its source available to compile yourself. GameMaker Studio 2 includes a sprite editor. Photoshop can do it but was not designed for it ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Pixel-Editor.com adds LibreSprite (free and open source, described in its animation guide as a free fork with the same core features) and its own browser editor, and warns against general-purpose editors for learning because their smoothing and brushes work against the medium ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). Cure used Grafx2 for its keyboard shortcuts and palette handling ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Slynyrd moved from Photoshop to Aseprite after 2024, citing its layered animation timeline, and uses Pyxel Edit for tile work ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]], [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]). Lospec's beginner guide points to its own online pixel editor as a no-install way to find out whether you like the medium, and to its software list ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-where-to-start|Lospec: where to start]]).

His summary, and the one most teachers share, is that the choice matters less than comfort and intent (Slynyrd).

**Features worth looking for.**

- **Indexed colour mode.** Each pixel stores a number pointing into the palette, up to 256 colours in Aseprite. Edit a palette entry and every pixel using it changes, which makes recolouring and palette swaps cheap ([[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]). Aseprite reserves an index for transparency, usually 0.
- **Palette files.** Load a Lospec palette in one click and keep it with the project ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec palettes]]).
- **Layers and timeline.** Layers for outline and shading, a timeline for animation, and onion skinning to see previous frames.
- **Tile mode.** Draw a texture and see it repeat live. Slynyrd names Pyxel Edit and Aseprite's tile mode for this ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]).
- **Good rotation.** RotSprite, not a smooth rotate ([[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]]).
- **Pixel-perfect drawing.** Some editors can remove the extra corner pixels of an L-shaped stroke while you draw freehand. I saw Aseprite described as having such a mode in a search summary but did not read its documentation, so verify in the tool.

**Hardware and health.** Derek Yu recommends a drawing tablet over a mouse to avoid repetitive strain injury, and says mouse work damaged his wrists. A wrist brace is the fallback. Slynyrd adds that pen tablets spread the load across larger muscles, and advises lowering monitor brightness, using grey instead of white backgrounds, resting the eyes on distant things, and moving regularly ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]], [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]).

**File formats.** PNG for stills, GIF for short animations. Never JPG, whose compression adds stray colours. Cure and Derek Yu both say it. For games, an animation usually leaves the editor as a PNG sequence or a sprite sheet ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]).

**One sprite, in order.** The sources give slightly different recipes, and they overlap enough to write a common one.

1. **Set up.** Small canvas (16 or 32 pixels square for a beginner), a limited palette, a background colour. Pixel-Editor.com's beginner workflow, and Derek Yu's first step (choose any existing palette and move on).
2. **Block the silhouette in one flat colour,** and check it at 1x. Or sketch crude outlines first, as Derek Yu does. Cure says either method is fine, and block-in tends to suit larger images.
3. **Clean the lines** ([[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]]).
4. **Fill the main colour regions flat.**
5. **Shade with one light direction.** Add one shadow and one highlight value per base colour, and add more only where the form needs them ([[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]]).
6. **Outline and anti-alias** where needed ([[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]]).
7. **Details and highlights, last.**
8. **Check, then subtract.** View at actual size and remove any pixel that does not help readability. Pixel-Editor.com notes that subtraction is usually the final step.

**Checks before you stop.** Flip the sprite horizontally, which exposes proportion errors Derek Yu says your eyes get used to. Desaturate it, to judge shading apart from colour. Squint, or shrink it. Put it on the real background, next to the real neighbours. Look at it again tomorrow, since a break improves your eye (Derek Yu). Derek also warns against perfectionism. A single sprite is a small piece of a project, and pixel art's puzzle quality is addictive.

**How to improve.** Lospec's beginner guide describes a loop of four activities: practise regularly (daily prompts or personal projects), learn from tutorials aimed at your weak spots, ask experienced artists for critique, and study good pixel art by analysing colour choices, deconstructing sprites and recreating them in others' styles. It also advises starting soon and not just consuming tutorials. Slynyrd agrees that even tracing established work builds hand-eye understanding, and mentions community prompts such as Pixel Dailies as ways to be pushed into unfamiliar subjects. Derek Yu points to a gallery of master-level pixel art from the 1990s and early 2000s as study material ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-where-to-start|Lospec: where to start]], [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]], [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). Gaps in general art knowledge eventually limit pixel work, so Lospec recommends supplementary study of form and anatomy (Draw a Box), painting, colour and composition (CTRL+Paint), and animation principles. Saint11 recommends the Animator's Survival Kit.

**Where to find more.** Lospec indexes hundreds of tutorials by topic, author and medium, among them Michafrar's paid guide Pixel Logic, Pedro Medeiros's short animated lessons and Cure's tutorial ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-tutorial-library|Lospec tutorial library]]). Video teachers such as AdamCYounis and Brandon James Greer are widely recommended, but video does not read well in text, so they are listed only in [[projects/shadow-jog/knowledge/pixel-art/sources/video-creators|Video creators (not read)]].

## Common mistakes

- Starting in a general-purpose paint program with brushes on.
- Saving a working file only as a flat PNG, losing layers and palette.
- Choosing the palette by hand at the start and never revisiting it.
- Working only zoomed in.
- Collecting tutorials and drawing nothing.
- Polishing one sprite for days.

## Practice

1. Set up your editor: a 32 by 32 canvas, a Lospec palette in indexed mode, a grey background, onion skin on.
2. Make a sprite following the eight steps, saving a copy after each step. Compare step 4 with step 8.
3. Run the four checks (flip, desaturate, squint, in-context) and write down what each caught.
4. Write your own review checklist from [[projects/shadow-jog/knowledge/pixel-art/16-common-mistakes|Module 16]] and use it on a friend's sprite.
5. Set a 15-minute daily prompt for a week.

## How I'd teach it

Give a fixed toolchain (one editor, one palette, one canvas size) for the first sessions, because comparing results is easier when everyone has the same constraints. Teach the order of work as a checklist on the wall. Run the four checks as a ritual before every critique. Have learners keep a "before and after" folder, since seeing your own improvement is more motivating than any lesson. For critique, ask for specifics such as "the light direction on the left arm", since verdicts teach little.

## In Shadow Jog

Shadow Jog's production pipeline replaces some of these steps with code, so this module's workflow maps onto it as follows.

| Step in this module | Where it happens in Shadow Jog |
|---|---|
| Palette and canvas | PixelLab prompts ("at most 15 colours", style image from the game's own art); the tracer's palette per character (`scripts/art/trace.mjs`) |
| Silhouette, flat colour, shading | AI-generated standing frames, picked by Mark in the review page (`artreview.html`) |
| Cleaning lines and pixel faults | The tracer (palette quantisation, outline removed); a clean-up for orphans is listed as "easy to add" (`docs/PIXELLAB-LESSONS.md`) |
| Outline | Drawn by code around each finished pose (`src/art/rig2/rig.ts`) |
| Animation | Code on the rig: walks, key poses on a skeleton, expressions (`src/art/rig2/*`), edited in `rigedit.html` |
| Checks | Mark's review of options side by side at game scale; Playwright screenshots |

Indexed colour is already the storage format. Traced characters are palette-indexed (`public/art/rig/*.json`), which is the thing that makes palette swaps and a master-palette remap cheap.

What the checks in this module suggest for the pipeline: a **pixel-art lint** that runs on every sprite and PNG the game ships, reporting the faults in Module 16 as numbers. This is my suggestion and has not been built. Candidate checks, each a few lines of code:

- Colour count per sprite, and whether every colour appears in the character's declared palette.
- Orphan pixels (a pixel with no neighbour of its own colour among its 8 neighbours), listed with coordinates and excluding the specular and eye exceptions by colour.
- Pixel-grid uniformity (no 2 by 2 blocks that repeat across a whole image, which is the footprint of a 2x enlargement).
- Outline continuity (every silhouette edge pixel is the outline colour, apart from allowed gaps).
- One-pixel-thick limbs (runs of width one longer than a threshold).
- Value spread (grayscale histogram wide enough, per Module 4's check).

The review page already shows versions side by side at game scale, which is the "in-context" check. Adding a silhouette toggle and a grayscale toggle would put two more of this module's checks one click away.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd, Pixelblog 5: Back to the Basics]]: https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd, Pixelblog 39: Sci-fi RPG]]: https://www.slynyrd.com/blog/2022/7/24/pixelblog-39-sci-fi-rpg
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd, Pixelblog 43: Top Down Tiles Part 2]]: https://www.slynyrd.com/blog/2023/3/26/pixelblog-43-top-down-tiles-part-2
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11, beginner articles]]: https://saint11.art/pixel_articles/
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-where-to-start|Lospec, Pixel Art: Where to Start]]: https://lospec.com/articles/pixel-art-where-to-start/
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-tutorial-library|Lospec, Pixel Art Tutorials]]: https://lospec.com/pixel-art-tutorials
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec, Palette List]]: https://lospec.com/palette-list
- [[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs, Color Mode and Rotate]]: https://www.aseprite.org/docs/color-mode/
- [[projects/shadow-jog/knowledge/pixel-art/sources/video-creators|Video creators (not read)]]: https://beatcopgame.com/best-pixel-art-youtube-channels/
