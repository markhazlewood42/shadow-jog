---
type: topic
title: "Module 9: Sprites and Characters"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, sprites, characters, portraits, proportions, facings, palette-swap]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd 29]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia: Palette swap]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia: Phantasy Star IV]]"]
---

# Module 9: Sprites and Characters

Previous: [[projects/shadow-jog/knowledge/pixel-art/08-materials|Materials]]. Next: [[projects/shadow-jog/knowledge/pixel-art/10-animation|Animation]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- What a sprite and a sprite sheet are, and how to size one against a tile grid.
- How many facings to draw and what to mirror.
- How to build characters from a base body, so a cast shares proportions.
- How to draw faces, hair and portraits at small sizes.
- How palette swaps and modular parts multiply a cast cheaply.
- How a back-view battle changes the drawing job.

## The core ideas

**A sprite is a game picture that moves.** It is a small image (a character, an item, an enemy) drawn over a background. A sprite sheet puts every frame of a character on one image, in a grid, so the game draws one rectangle at a time. The grid cell is also the unit of layout: Slynyrd says a sprite's size is usually one tile or a whole multiple of one, with one tile wide and two tall as the most versatile character size, because it lines up with grid-based levels and keeps collision and spacing predictable ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]). He adds that a sprite should not fill its cell completely. Pixels that spill sideways create overlap trouble, though in a top-down view a sprite's top may overlap whoever stands higher on screen, because the vertical axis already implies depth.

**Facings.** A top-down character needs to face the directions it can move. Slynyrd's economy rule: draw three (up, down and one side) and mirror the side for the other. Four facings are enough for eight-way movement and worked in classic 16-bit games like Secret of Mana, and extra intermediate angles add polish when sprites are large ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]). The cost of mirroring is that any asymmetry flips with it: a sword on the left hip jumps to the right hip, and the light direction flips too ([[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]]).

**Proportion is a design choice made for the size.** The head carries the face, so small sprites make it big: a third to half of the sprite's height in Slynyrd's top-down guide, and "super-deformed" big heads and eyes at 32 by 32 in Derek Yu's ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Height can signal age and gender. A consistent scheme for how heights relate across the cast saves the player from confusion. Larger sprites can afford realistic anatomy, and then you need to study it, which is why Slynyrd's sci-fi RPG lesson stresses working from a base body.

**Build the cast from a base body.** Slynyrd's RPG and cyberpunk articles both start with a plain, unclothed template body at the target size, which gets clothing, hair and extras layered over it. He recommends stripping an existing sprite "to its birthday suit" to learn the structure before inventing new types ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]], [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]). His top-down guide separates structural animation from cosmetics in the same way. Animate a plain "dummy" figure with solid colours, then add detail once the motion works ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]). In his tiny-pixel lesson he breaks sprites into movable pieces, so a one-pixel shift of the head between frames can show a turn ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]).

**Faces at tiny sizes.** Slynyrd's anime-face tutorial gives numbers: eyes typically take 3 to 5 pixels in width, pupils 1 to 2, and the mouth 2 to 3 horizontally. The nose is a pixel or two in front view and more prominent in profile. Hair does most of the identification. Build it from a flow direction, a flat base mass, then shadow and highlight, and break it into clumps ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd 29]]). Derek Yu's Mario example shows how few pixels a face needs. The eye is two stacked pixels and the moustache helps define the nose ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

**Portraits are a separate drawing.** Larger faces for dialogue let you draw expression. Slynyrd's Phantasy Star-inspired study analysed the portraits of Phantasy Star IV, pulled out the head shapes and rebuilt them in his own style. He stresses that head geometry decides everything that follows and errors made early are carried through every later step, and that simple shading and highlights are enough for depth ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]). Hardcore Gaming 101 notes that Phantasy Star IV gives its main cast detailed portraits and tells story moments through manga-style panels that fill the screen piece by piece ([[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]).

**Palette swap: one drawing, many characters.** If a sprite is stored as numbers that index a palette, you can change the palette and get a recoloured sprite for free. The classic uses are Mario and Luigi, the ninjas of Mortal Kombat, and the stronger and weaker variants of RPG enemies ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia: Palette swap]]). Indexed colour mode in editors exists for this ([[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]). The craft point is that a swap works when each colour slot has one job (skin, cloak, trim) so that whole jobs get swapped and the individual shades follow.

**Modular (paper-doll) characters.** Layered parts on a shared body template can build large casts: body, head, hair, hat, top and legs are drawn once to line up on shared anchor points, then recombined. The engine is the easy part. The art is the hard part, because every part needs every facing and every walk frame aligned to the same anchor, and the layer order changes with the facing (hair behind the head from the back). This is described in the game's own `docs/CONCEPTS.md`, and it matches Slynyrd's advice to keep structure and decoration separate.

**The view from behind.** In Phantasy Star IV, the battle perspective returns to the behind-the-back view of Phantasy Star II: the party sits at the bottom of the screen looking toward the enemies ([[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]). Drawing this has its own demands. You see the back of the head and the shoulders, so hair and cape shapes carry the identity, and the party must be small and low enough not to hide targets. The game was released in Japan on 17 December 1993 for the Sega Genesis (Mega Drive), directed by Rieko Kodama, Toru Yoshida and Kiyoshi Takeuchi ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia: Phantasy Star IV]]).

## Common mistakes

- Different head sizes and proportions across a cast with no reason.
- A sprite that fills its cell edge to edge.
- Details in the face that cannot survive 100% (eyelashes on a 16 pixel head).
- A lopsided design mirrored for the other direction, producing a left-handed sword.
- Palette swaps built by shifting the hue of the whole image, which wrecks skin and outline.
- Detailed portraits that do not match the sprite's style, palette or light.

## Practice

1. Draw a plain template body at 16 by 32 with three facings. Reuse it for three different characters by changing only hair, clothes and colour.
2. Take a sprite from a game you like and strip it to a base body.
3. Draw a face at 24 by 24 with eyes 4 pixels wide, then at 32 by 32 with eyes 5. Compare readability.
4. Recolour one character four ways using only whole colour slots.
5. Design the back view of a character so you could name them from behind. Use only hair, a cape or a pack.

## How I'd teach it

Start with the template, since a learner who owns a good base body makes characters five times faster. Introduce proportions with a family of differently sized heads and let the class choose the one that looks "friendliest". Mirroring is best taught by example: mirror a character with an asymmetric prop and ask what went wrong. Faces get a separate session with the pixel counts for eyes and mouth and a gallery of expressions drawn with only moved eyebrows and mouth. Palette swaps are a good place to bring in indexed colour. They show learners that colour is data. Where novices stall is on the back view, because they have never studied the back of anyone's head. Photograph friends from behind.

## In Shadow Jog

The crew's field sprites are about 18 by 28, chibi, traced as standing frames per facing, with walks built in code (`docs/ARCHITECTURE.md` section 7). The game uses four facings, as in the Secret of Mana approach (`docs/CONCEPTS.md`, directions). Every traced character has an anchor so feet land on the ground line. The battle backs are drawn at about 128 pixels, at five heads tall. Portraits come from the traced picks plus code-drawn faces.

Four suggestions drawn from this module:

1. **Slot-based palette swaps.** Traced characters are palette-indexed, one palette per character (`public/art/rig/*.json`, `scripts/art/trace.mjs`), so every colour is already a slot. Labelling the slots (skin, hair, coat, trim, glow) once gives the second copy of an enemy a clean variant (`status.md` records the "green skin" failure of whole-image hue shifting) and also gives townsfolk variety. This is the Wikipedia palette-swap technique and the labelling step `docs/CONCEPTS.md` mentions for AI art.
2. **A shared base body for the paper-doll generator.** The random-NPC generator planned in `docs/PIXELLAB-LESSONS.md` needs the aligned-parts discipline above. Fix a template per facing (hip row, shoulder row, head box) before cutting parts from the traced townsfolk, since rig v2 already stores `feet` and `hip` rows per character.
3. **Check the face against Slynyrd's numbers.** For the portraits, measure the eye width and mouth width in pixels and compare with 3 to 5 and 2 to 3. If the portraits are large, the numbers scale up, and what matters is that eyes, brows and mouth are the only parts that move for an expression (`docs/CONCEPTS.md`, expression sheets).
4. **The back-view problem.** Party back-of-head sprites cover enemies (`status.md`). Apply the silhouette options in [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Module 3]] and keep the party at the bottom of the frame as Phantasy Star IV does, then check that no head overlaps the row of enemies.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd, Pixelblog 22: Top Down Character Sprites]]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd, Pixelblog 39: Sci-fi RPG]]: https://www.slynyrd.com/blog/2022/7/24/pixelblog-39-sci-fi-rpg
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd, Pixelblog 42: Cyberpunk Pixel Art]]: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd, Pixelblog 29: Anime Faces and Hair]]: https://www.slynyrd.com/blog/2020/7/28/pixelblog-29-anime-faces-and-hair
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd, Pixelblog 47: Tiny Pixels]]: https://www.slynyrd.com/blog/2023/11/26/pixelblog-47-tiny-pixels
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|Hardcore Gaming 101, Phantasy Star IV]]: https://www.hardcoregaming101.net/phantasy-star-iv/
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia, Phantasy Star IV]]: https://en.wikipedia.org/wiki/Phantasy_Star_IV
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia, Palette swap]]: https://en.wikipedia.org/wiki/Palette_swap
- [[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs, Color Mode and Rotate]]: https://www.aseprite.org/docs/color-mode/
