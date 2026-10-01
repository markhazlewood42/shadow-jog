---
type: topic
title: "Module 3: Shape and Silhouette"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, fundamentals, silhouette, form, readability, design]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd 29]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]"]
---

# Module 3: Shape and Silhouette

Previous: [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Lines, curves and clusters]]. Next: [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Colour and palettes]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- Why you design the outer shape first and the details last.
- How to test a silhouette (fill it black, shrink it, squint at it).
- How to think in volumes instead of flat outlines.
- How thick things should be, and what to exaggerate.

## The core ideas

**The silhouette is the first thing the player reads.** A silhouette is the solid outer shape with all interior detail removed. At game scale, and especially while things move, a viewer identifies "that is the hero" or "that is a slime" from the silhouette alone. Pixel-Editor.com states the rule bluntly: if the silhouette does not read, no amount of shading or detail will save it. Its beginner workflow starts with one flat colour and a check at 1x ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). Derek Yu makes the same point with a squint test: a well-defined figure keeps its basic form even when you squint at it, because squinting strips detail and leaves mass ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

Three ways to test a silhouette:

1. Fill the whole shape with one flat colour (black works) and ask someone what it is.
2. View it at game size, or smaller, and see whether the key features (hair, weapon, tail, horns) still show.
3. Put several designs side by side as flat shapes. Distinct characters should be tellable apart in that line-up.

**Simplify to what carries meaning.** Sandro Maglione describes pixel art as communicating complex ideas with few pixels through simplification and abstraction, and warns that overly complex designs become hard to decipher at small sizes ([[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]). Slynyrd's reflection on tiny sprites adds the positive side: leaving information out invites the viewer to supply it, and the sprite stays alive in the viewer's head ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]). His advice at small sizes is to "blob out" body proportions by eye and stop worrying about anatomical precision ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]).

**Think in volumes.** Derek Yu's "forms with volume" is a thinking tool more than a technique. Picture the object as something sculpted out of clay: a tree canopy is a cluster of spheres, a bird's nest is a bowl. Details wait until the big forms work ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). This is also what makes shading in [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]] possible. You cannot light a shape you have not decided is a sphere, a cylinder or a box.

**The chunky pixels rule.** Derek Yu's rule of thumb: avoid drawing any part with a single pixel of thickness. Beginners make arms, legs and branches one pixel thin, and thin parts cannot be shaded into forms, so they end up looking flat and flimsy. The usual remedy is to thicken the part to two or three pixels and shade it ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). Very small sprites are the exception, because there is no room. At 16 pixels tall a one-pixel arm may be all you have, and a good silhouette then carries the weight.

**Exaggerate what is characteristic.** The same article encourages imagining the design moving and acting, then pushing the most characteristic features further. A big hat, a long coat, a wide stance. "Cardboard" designs are those that follow the grid's straight lines too closely. Think in angles, curves and organic shapes, and let pixels approximate them ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]).

**Proportions are a design tool at small sizes.** Slynyrd's top-down sprite article suggests a head a third to a half of the sprite's height, because faces carry the expression and personality. Smaller sprites get more abstracted proportions still. Height can signal age and gender cheaply, and a systematic scheme prevents confusion ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]). Derek Yu points to big heads and big eyes as the usual response at 32 pixels, since the face is the part that must work ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

**Hair, hats, tails and weapons are silhouette tools.** In anime-style art, Slynyrd stresses hair as the main way to tell characters apart, partly because the mouth and features are so simplified ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd 29]]). The same logic applies to a held weapon or a distinctive coat hem.

**Silhouette needs contrast with its background.** A silhouette only works if it separates from what is behind it. Outlines are one tool for that ([[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]]). Another is palette contrast and value: Derek Yu notes that making background colours less distinct, on purpose, lets foreground characters stand out ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). Slynyrd's landscape study does the same with depth: the nearest plane carries the most saturation and contrast, and distant planes soften ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]). Pixel-Editor.com observes that a character outlined in its own darkest colour separates from other characters as well as from the background ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]).

**Values carry the silhouette in grayscale.** If your colours are close in lightness the picture goes flat. Pixel-Editor.com's colour guide suggests squinting or converting to grayscale to see mass and value alone ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]). This links to the value-first method in [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

## Common mistakes

- Jumping to details (buttons, eyelashes) before the silhouette works.
- Making all characters the same blocky shape with different colours. A grayscale line-up will show it.
- One-pixel limbs, branches and swords that cannot be shaded.
- Pasting realistic anatomy onto a 16 pixel body. The proportions need to be designed for the size.
- Details that turn to mush at game size. Cut them or replace them with one or two well-placed pixels.

## Practice

1. Draw ten fantasy characters as black silhouettes in a 16 by 24 box, one per box, with a different defining feature each. Shuffle them and ask a friend to describe each.
2. Make three versions of one enemy at 32 by 32, each exaggerating a different feature. Pick the one that reads best at 50% zoom.
3. Take a character you like from a game. Fill it black, then try to rebuild its identity using only three details.
4. Draw a tree twice: once as a trunk with leaves scattered on, once as a cluster of spheres. Compare the effect before any shading.

## How I'd teach it

Use black fills and hand the learner the guessing role, so they experience readability from the viewer's side. Show well-known game characters as black shapes and have the class name them, then show a murky one and ask why it fails. Novices get stuck because their instinct is to add, so the lesson is subtraction. A good exercise is "remove one thing and see if it still reads". Introduce "think in volumes" with clay or a few photographed objects, and let them find the sphere in a shrub. Keep the chunky pixels rule short: draw a one-pixel arm and a two-pixel arm, then try to shade both.

## In Shadow Jog

Characters are chibi in the field (two to three heads tall, so the head is a third to a half of the height) and about five heads tall in battle (`docs/CONCEPTS.md`). The field figure matches Slynyrd's suggested head size exactly. Rig v2 traces each character's standing frame from a PixelLab pick, so the silhouette is inherited from that pick. Hair, coat hems and staffs hang still while legs move (`docs/ARCHITECTURE.md` section 7), which keeps the silhouette stable.

The review history gives two concrete silhouette misreads: Hex's bun was read as a hat and Rook's katana as a red bar (`status.md`, round 1 battle sprites). Both are classic "detail turned into the wrong shape" failures. A cheap guard would be a silhouette toggle on the review page (`artreview.html`) that fills each character flat at game scale and shows the whole party and the enemies together, which also applies the line-up test above.

The battle problem logged in `status.md` is that back-of-head party sprites cover enemies. From behind, the head and hair are the largest single silhouette shape. Options to try, each testable in one afternoon: shrink or lower the party row so heads sit below the enemies' targetable area; keep the head the same size and tilt the camera so the hairline sits lower; or let hair go semi-transparent where it overlaps an enemy. Another is to draw the back view with a slightly smaller head ratio than the field sprite, which is a standard exaggeration choice and fits the "design the proportion for the size" rule. These are suggestions from the module's principles and not tested results.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione, Getting started with Pixel Art]]: https://www.sandromaglione.com/articles/getting-started-with-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd, Pixelblog 47: Tiny Pixels]]: https://www.slynyrd.com/blog/2023/11/26/pixelblog-47-tiny-pixels
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd, Pixelblog 42: Cyberpunk Pixel Art]]: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd, Pixelblog 22: Top Down Character Sprites]]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd, Pixelblog 29: Anime Faces and Hair]]: https://www.slynyrd.com/blog/2020/7/28/pixelblog-29-anime-faces-and-hair
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd, Pixelblog 62: Landscape Backgrounds]]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor.com, Color Theory for Pixel Art]]: https://www.pixel-editor.com/articles/color-theory-for-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor.com, Pixel Art Outlines & Anti-Aliasing]]: https://www.pixel-editor.com/articles/pixel-art-outlines
