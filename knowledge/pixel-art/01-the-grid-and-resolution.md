---
type: topic
title: "Module 1: The Grid and Resolution"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, fundamentals, resolution, canvas-size, pixel-density]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]"]
---

# Module 1: The Grid and Resolution

Back to the [[projects/shadow-jog/knowledge/pixel-art/README|curriculum map]]. Next: [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Lines, curves and clusters]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- What separates pixel art from a small or blurry picture, and why that line matters.
- What a pixel, the grid and a canvas size are, and how canvas size controls effort and detail.
- How to pick a canvas size for a sprite, a tile or a portrait.
- What "pixel density" means and why one image should have only one.
- The habit of judging your work at 100%, not zoomed in.

## The core ideas

**Pixel art is defined by control.** A photograph is made of pixels and nobody calls it pixel art. The difference is who decided where each pixel went. Cure, in the classic Pixel Joint tutorial, puts it this way: the artist has to stay in command of the image at the level of a single pixel, and every pixel should be placed on purpose ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Raymond Schlitter (Slynyrd) calls intention the number one defining factor and shows three trees to prove it: a deliberate pixel tree, a soft-brushed painting, and a lazy low-resolution scribble ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]). Pixel-Editor.com gives the same test in its FAQ: low-resolution art may be a big painting shrunk down with blurry edges and uncontrolled colour mixing, whereas pixel art has no blending the artist did not choose ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]).

This has two practical consequences. First, tools that decide pixel placement for you (blur, smudge, soft brushes, automatic anti-aliasing, non-integer resizing) are avoided, because they put in pixels you never chose. Cure notes that a very high colour count is often a symptom of those tools more than a rule of its own. Second, the definition describes how you work. The number of colours and the program you open do not decide it. A picture drawn in MS Paint with the line and fill tools, without looking at single pixels, is what the Pixel Joint crowd call oekaki, a different thing.

The edges of the definition were argued over for years. Wikipedia's history of the form records that the Pixelation forum and the Pixel Joint gallery debated, among other things, whether transparent layers or smudge tools were acceptable ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]).

The strict reading can be overdone. Cure is explicit that you do not have to click every pixel by hand. The bucket fill and the line tool are fine, as long as you keep control of the result at pixel level ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]).

**The grid is the medium.** Everything sits on a square grid, and the smallest change is one square. Moving a pixel is a big event. Derek Yu points out that Mario's eye is two pixels stacked and that his moustache partly exists to define the nose, because at that size every pixel has to pull its weight ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). A parrot example in Cure's tutorial makes the same point: change a handful of pixels and the whole face changes.

**Canvas size sets your workload and your vocabulary.** Sandro Maglione gives the arithmetic. A 16 by 16 sprite has 256 pixels, a 32 by 32 one has 1,024 (four times as many), and a 144 by 144 one has 20,736. He also notes that bigger sizes drag in the skills of conventional drawing (anatomy, perspective, composition), while small sizes lean on abstraction ([[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]). His typical sprite and tile sizes are 8, 16 or 24 pixels square, each taking roughly five to thirty minutes. Pixel-Editor.com recommends 16 by 16 or 32 by 32 for beginners and warns that a large canvas hides bad habits ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). Cure adds a second beginner rule: use a limited palette, since a sprite that fails in 4 colours will not be rescued by 40.

A rough size table, assembled from those sources and from Slynyrd's examples ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]], [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]):

| Size | Typical use |
|---|---|
| 8 by 8 | tiny tiles, icons; Slynyrd shows a whole tile set and hero at this scale |
| 16 by 16 | classic tile, item, small character |
| 16 by 32 | a standing character one tile wide and two tall |
| 32 by 32 | detailed character or enemy |
| 64 or more | portraits, large enemies, detailed set pieces |
| 128 or 256 square | whole illustrations; Slynyrd works here and scales 2x to 4x for presentation |

**Less information is the point.** Slynyrd's reflection on working at 8 by 8 is that pixel art draws its power from what it leaves out, because the viewer's mind completes the picture. As resolution rises, the viewer does less of that work and the piece drifts toward digital illustration ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]). Derek Yu's 32 by 32 example agrees: tiny sprites push you toward big heads and big eyes for expressiveness, and often drop the outline in favour of colour contrast.

**One image, one pixel size.** The size a pixel appears on screen should be the same everywhere in a single picture or scene. A sprite drawn at twice the density of its neighbours looks wrong, even if nobody can say why. The community word for the flaw is "mixel" (mixed pixel). It is covered properly in [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]] and [[projects/shadow-jog/knowledge/pixel-art/16-common-mistakes|Module 16]].

**Judge at 100%.** You will work zoomed to 400 or 800 percent, but the player sees the art at its native size. Pixel-Editor.com advises checking at actual size every few minutes, because details that look important zoomed in can vanish at native size ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). Cure's oekaki test is the same idea turned around: if you can make the image without zooming in, you are probably not paying attention to the pixels.

## Common mistakes

- Starting too large. A 128 by 128 first sprite takes hours and teaches little.
- Using soft brushes, blur or smudge, then wondering why the picture looks muddy. Spot it by zooming in: a clean piece has a small, countable set of flat colours.
- Treating "low resolution" as the definition. A shrunk painting is not pixel art; neither is a tiny image with accidental pixels.
- Saving as JPG. The compression adds hundreds of stray colours. Derek Yu shows a JPG-damaged sprite for this reason; use PNG for stills and GIF for animations ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).
- Mixing pixel sizes in one scene.

## Practice

1. Draw five everyday objects (key, mug, sword, apple, door) at 8 by 8 in two colours plus transparent. Show them to someone and see which ones survive.
2. Draw one apple at 16, 32 and 64 pixels square. Note how long each takes and what extra decisions each size demanded (shine, stem, shadow, leaf).
3. Take a screenshot of any pixel-art game. Measure one character in pixels, then work out how many of those characters would fit across the screen.
4. Find three images online and sort them into pixel art, low-resolution art and neither, using Cure's tests. Defend each call in one sentence.

## How I'd teach it

Open with the sorting game from practice 4, because learners meet the definition as a judgement they make themselves. Follow with the arithmetic table, which takes thirty seconds and explains why the first project is small. Novices often resist small canvases (they feel like a handicap) and treat zoomed-in as the "real" view. Have them flip between 100% and 800% on the same sprite until the 100% view feels like the true one. Introduce the rule "one pixel size per scene" early, in one sentence, and come back to it in Module 13 when scaling makes it concrete.

## In Shadow Jog

The game's screen is 480 by 270, and the field is drawn at one art pixel per game pixel (`src/engine/game.ts`; [[projects/shadow-jog/docs/CONCEPTS|CONCEPTS]], Pixel art section). Field characters are about 18 by 28 pixels in a 34 by 36 working frame (`src/art/rig2/rig.ts`, `status.md`). Slynyrd's top-down sprite article lists 480 by 270 as one of three resolutions that scale cleanly to 1080p (at 4x), and describes its sprites as one tile wide and two tall. Shadow Jog's field characters sit in that range.

> **Note (2026-10-09):** the game screen is now 640 by 360 (the 640x360 move, PR #23). The text above describes the 480 by 270 screen of 2026-10-01. Field characters are still about 18 by 28 pixels, so they now fill less of the screen. See `src/engine/game.ts` for `W` and `H`.

The known density problem is the battle scene. `docs/ARCHITECTURE.md` section 7 describes three layers: a backdrop drawn at 240 by 135 and scaled 2x, enemies on a screen-resolution layer drawn through a 2x transform so creatures' finer art lands 1:1, and the party at world scale. The result is exactly what the mixel warning describes. Human enemies and the party are chunky, creatures are fine, and the battle backs (128 pixels tall, "twice today's detail") add another density. The art-pass note says everything should be made at the field's density.

The practical suggestion is to pick the density first and size every asset as a multiple of it. For the battle, decide what one art pixel is (the field's) and state it in `ARCHITECTURE.md` as a rule, so that a new enemy drawn at the wrong size fails a check and not a human eye. The tracer already forces one grid onto AI output: palette-indexed pixels, one palette per character. That is the step that turns a "picture" into pixel art by the Cure test, so it deserves to be called out in `docs/PIXELLAB-LESSONS.md` as the place where pixel control is restored.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd, Pixelblog 5: Back to the Basics]]: https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics
- [[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione, Getting started with Pixel Art]]: https://www.sandromaglione.com/articles/getting-started-with-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd, Pixelblog 47: Tiny Pixels]]: https://www.slynyrd.com/blog/2023/11/26/pixelblog-47-tiny-pixels
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd, Pixelblog 22: Top Down Character Sprites]]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia, Pixel art]]: https://en.wikipedia.org/wiki/Pixel_art
