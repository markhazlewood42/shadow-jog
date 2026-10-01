---
type: topic
title: "Module 13: Scaling, Display and Rotation"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, scaling, integer-scaling, nearest-neighbour, scale2x, rotsprite, mixels, display]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia: Pixel-art scaling algorithms]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/mdn-pixel-art-on-the-web|MDN: image-rendering and crisp pixel art]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd 3]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]"]
---

# Module 13: Scaling, Display and Rotation

Previous: [[projects/shadow-jog/knowledge/pixel-art/12-ui-and-fonts|UI and fonts]]. Next: [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|History, hardware and styles]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- Why pixel art is scaled only by whole numbers with no smoothing, and what goes wrong otherwise.
- How to choose a native resolution that fits modern screens.
- What a mixel is.
- What Scale2x/EPX and RotSprite do, and when to use them.
- How to show crisp pixels on a web page or canvas.

## The core ideas

**Art is made small and shown large.** A pixel-art game renders at a small native resolution (480 by 270 for Shadow Jog) and the screen enlarges it. The enlargement must not change the art. Two rules cover almost everything. Scale by whole-number multiples, and use nearest-neighbour sampling, which copies each source pixel into a square block of screen pixels with no blending.

Slynyrd states the first rule plainly: increase image size only by whole-number multiples to keep the pixel units uniform. An arbitrary factor like 193.5 percent distorts them. He also says to keep anti-aliasing off while scaling ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]). Derek Yu's sharing advice repeats it: upscale in clean multiples (200 percent, not 250) with nearest neighbour, and be aware that social sites may turn a PNG into a JPG and wreck it ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Pixel-Editor.com's fundamentals page agrees that non-integer rotation or scaling destroys the grid and produces blurry artefacts ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]).

Why does non-integer scaling hurt? If one source pixel has to cover 2.5 screen pixels, some columns get 2 and some get 3, so the picture looks uneven, with some pixels visibly wider than others. If the program blends instead, edges blur. Wikipedia's overview of scaling algorithms makes the same point: nearest neighbour keeps edges sharp but blocky, and bilinear averaging blurs the careful pixel colouring that carries the art ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia: Pixel-art scaling algorithms]]).

**Pick a native resolution that divides screens.** Slynyrd's top-down guide lists three resolutions that scale exactly to 1920 by 1080: 320 by 180 (6x), 480 by 270 (4x) and 640 by 360 (3x). Lower resolutions show off pixel craft and suit slow, atmospheric games, and higher ones show more of the world and suit fast action ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]). Other screens divide less nicely. For 480 by 270, 4K (3840 by 2160) is exactly 8x, but a 2560 by 1440 monitor gives 5.33x, a 1280 by 720 window gives 2.67x and a 1366 by 768 laptop gives 2.84x. Those are my own divisions, and they show why a game needs a plan for screens that are not exact multiples. The usual plan is to use the largest whole multiple that fits and leave a border.

**On the web.** MDN's guidance is to tell the browser to use nearest-neighbour. For an image, set the CSS `image-rendering` property to `pixelated` (supported widely since January 2020). For a canvas game, draw into a canvas at the native resolution and scale it up with CSS, with the same property. When code draws scaled images into the canvas, MDN adds that the destination sizes must be whole multiples of the source, or the result blurs. One real caveat: when the device pixel ratio is not a whole number (browser zoom, some high-density screens), pixels may come out different sizes, and there is no perfect browser-level fix ([[projects/shadow-jog/knowledge/pixel-art/sources/mdn-pixel-art-on-the-web|MDN: image-rendering and crisp pixel art]]). The `pixelated` value itself works by scaling to the nearest whole multiple with nearest neighbour and then smoothing to the final size, which keeps the look crisp at arbitrary zoom levels at the price of slight softness.

**Mixels: mixed pixel sizes in one picture.** When part of an image is drawn at one resolution and part at another, or when you scale a sprite 2x and set it beside native art, the two areas have different pixel sizes on screen. The community calls this "mixels" (mixed pixels), and it is widely regarded as a flaw because the eye sees two grids in one picture. I could not open a primary write-up (the one I found refused automated requests), so this definition rests on how artists use the word and on Slynyrd's uniformity rule that everything in a scene should obey the same geometry ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd 3]]). Whole-number scaling keeps proportions right inside one sprite, but a 2x sprite next to a 1x sprite has a visibly coarser grid and a doubled outline. The fix is to draw everything at the same density and scale only the finished frame.

**Pixel-art scaling algorithms are for emulators, rarely for art.** Several algorithms try to enlarge pixel art while smoothing diagonals. EPX or Scale2x, developed by Eric Johnston at LucasArts around 1992, turns each pixel into a 2 by 2 block, and sets a corner of the block to a neighbouring colour only when two adjacent neighbours match each other and differ from the others. It changes few pixels, so it keeps edges clean. Eagle was an earlier idea with a weakness (it erases single-pixel hollows). The hqx family (Maxim Stepin) and xBR (Hyllian) compare each pixel with its eight neighbours and use lookup tables or multi-pass rules to smooth more aggressively ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia: Pixel-art scaling algorithms]]). They exist because emulators want old games to look good on big screens. They change the look of the art, and for a game built to look like pixel art, the artist usually prefers plain nearest-neighbour.

**Rotation is the dangerous one.** Rotating a pixel image by an arbitrary angle makes the new grid disagree with the old one, so a naive method produces gaps, doubled pixels and ragged edges. RotSprite, by Xenowhirl, rotates in three steps: enlarge the image 8x with a modified Scale2x that treats similar (not only identical) colours as matches, choose sampling points that avoid boundary pixels, then rotate and shrink back with nearest-neighbour sampling, optionally restoring single-pixel details that were lost ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia: Pixel-art scaling algorithms]]). Aseprite offers both a "Fast Rotation" and RotSprite, and its documentation recommends RotSprite for finished results and the fast one for quick previews ([[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]). Even RotSprite output deserves a cleanup pass. A good rule is to rotate as little as possible, to prefer redrawing key frames by hand, and to treat rotation as a tool for small angles on parts with plain shapes.

**Scaling and screen effects interact.** Slynyrd tried CRT filters on his landscapes and found that the image size changes how scanlines and masks look, so he scaled to 4x before applying the effect ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]). Effects like bloom or scanlines belong to the last stage, after integer scaling, and are judged at the real output size.

## Common mistakes

- Resizing with a smooth (bilinear, bicubic) filter. The sprite blurs.
- A window that scales by 2.84 and shows uneven pixels.
- A 2x-drawn creature beside 1x characters (mixels).
- Rotating a finished sprite by 15 degrees and leaving the result.
- Applying a smoothing "pixel art upscaler" to the art and then calling the output pixel art.
- Exporting or posting JPG.
- Judging the look in the editor at an unusual zoom.

## Practice

1. Enlarge a 32 by 32 sprite to 96 by 96 with nearest neighbour and bilinear, and compare at actual size.
2. Make a 3 by 3 enlargement of a diagonal line by hand. Explain what EPX would change at the corners.
3. Rotate a sword sprite by 10, 25 and 45 degrees with Fast Rotation and RotSprite. Count the stray pixels.
4. Work out which integer scale applies to your game at five common screen sizes, and what margin remains.
5. Put a 2x-scaled copy of a sprite beside the original and write down what looks wrong.

## How I'd teach it

Show it before explaining it. Put a nearest-neighbour and a bilinear enlargement side by side on a projector and ask which looks "like a game". Then show an uneven non-integer enlargement and let the class find the pixels of different widths. The algorithm names (EPX, hqx, xBR, RotSprite) are for those who ask, and only the principle ("copy, don't blend") is mandatory. For mixels, give a deliberately wrong scene (a 2x monster beside a 1x hero) and ask where the eye catches. Novices often assume that "scaling with a smart tool" is an improvement, so the demonstration that it destroys intent is the lesson.

## In Shadow Jog

The back buffer is 480 by 270 and `src/engine/display.ts` shows it with a clear rule: enlarge with nearest-neighbour to the next whole multiple, and then let the browser smoothly shrink that to the exact fit size, so every source pixel stays the same size and fractional nearest neighbour never produces uneven columns. In fill mode the code snaps to a whole multiple whenever one fills at least 90 percent of the window, so 1080p, 1440p (5x, with borders) and 4K (8x) come out pixel-exact. Only a window that falls between multiples gets a slight resample, and the pixel-perfect mode always snaps. `src/engine/canvas.ts` turns off image smoothing on the canvases, and the WebGL presenter keeps the same layout when GPU effects are on. This is the approach MDN and Slynyrd describe, with a considered fallback. A 1366 by 768 laptop falls in the in-between case (2.84x), so it is the screen to look at for softness.

The density problem is the mixel problem. The battle draws the backdrop at 240 by 135 scaled 2x, creatures at twice the party's resolution, and the party and human enemies at the field density (`docs/ARCHITECTURE.md` section 7, `docs/CONCEPTS.md`). The old battle sprites were drawn small and enlarged with Scale2x (`src/art/pix.ts`), which is the "2x sprite beside a 1x sprite" case. The art pass already aims at the field's density. A check worth adding is an automated test that every sprite's pixel grid is uniform (no 2 by 2 blocks of identical colour across an entire large image, which is the footprint of a 2x enlargement).

RotSprite swings legs about the hip in rig v2 (`src/art/rig2/rig.ts`), and enemies use RotSprite for the strike lean and the flinch tip (`rig2/enemy.ts`). Small angles on mostly plain shapes are RotSprite's strength. The risk is detail, as in dithered or one-pixel features ([[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]]), so a rotation cleanup step (drop orphans, restore a missing single-pixel highlight) belongs after each swing.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd, Pixelblog 5: Back to the Basics]]: https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd, Pixelblog 22: Top Down Character Sprites]]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd, Pixelblog 62: Landscape Backgrounds]]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd, Pixelblog 3: Graphical Projections Part 1]]: https://www.slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia, Pixel-art scaling algorithms]]: https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms
- [[projects/shadow-jog/knowledge/pixel-art/sources/mdn-pixel-art-on-the-web|MDN, image-rendering and Crisp pixel art look]]: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering
- [[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs, Rotate Sprite or Selection]]: https://aseprite.org/docs/rotate/
