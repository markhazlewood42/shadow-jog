---
type: topic
title: "Module 5: Light, Shading and Form"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, shading, light, form, pillow-shading, highlights, cast-shadow]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-06-light|Slynyrd 6]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor lighting]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd 3]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]"]
---

# Module 5: Light, Shading and Form

Previous: [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Colour and palettes]]. Next: [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Outlines and anti-aliasing]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- How to pick one light direction and keep to it.
- How to shade a ball, and why the "ball test" shows up so often in pixel art teaching.
- What pillow shading is and why it fails.
- How many shades to use at which size, and where highlights, core shadows and cast shadows go.
- How to light a scene with a glowing source.

## The core ideas

**Shading describes form, and form comes from light.** A flat disc becomes a sphere when one side is lighter and the other darker. Pixel-Editor.com's shading guide puts it as structural information: the viewer's eye uses shading to rebuild depth, so it is more than decoration ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]). Derek Yu's version is to imagine the character sculpted out of clay and to shade so that the form comes out of the picture. He assumes a single light above and slightly forward of the subject, which puts the darkest shades on the bottom and back surfaces and the brightest on top and front ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

**Pick the light before you place a shadow pixel.** Choose where the light is, then keep every highlight and shadow consistent with it. Top-left is the most common default, as Pixel-Editor.com says, but Slynyrd frames it as a choice: overhead light feels natural, and he likes top-left or top-right for liveliness, and the key is that the light is deliberate and guides shadows, highlights and colour choices ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-06-light|Slynyrd 6]]). Inconsistent light across a scene is flagged by Pixel-Editor.com as one of the fastest ways to look amateur, since the objects look assembled from different worlds ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]).

**The ball test.** Here are two versions of the same 8 by 8 sphere. S is shadow, B is the base colour and H is highlight.

```
pillow shaded              lit from the upper left
..SSSS..                   ..BBBB..
.SBBBBS.                   .BHHBBB.
SBBHHBBS                   BHHBBBBS
SBHHHHBS                   BHBBBBSS
SBHHHHBS                   BBBBBSSS
SBBHHBBS                   BBBBSSSS
.SBBBBS.                   .BSSSSS.
..SSSS..                   ..SSSS..
```

The left ball is pillow shaded: the shade bands follow the outline and ignore any light, so it looks like a puffy cushion or a bowl. The right ball has a light source. Pixel-Editor.com describes the common failure as placing the highlight in the middle and darkening the edges regardless of the light, which makes the form read as concave (a bowl) when it should bulge outward ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]).

Cure adds a subtle correction that is worth teaching. Pillow shading is wrong because it follows the flat shape on the screen and ignores the three-dimensional form. A frontal light is allowed, provided you still shade according to how that light hits the form ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Richard Janes, from the older generation of tutorials, treats pillow shading as a poor stand-in for anti-aliasing and says to avoid it every time ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]). Derek Yu names it as one of the common beginner mistakes and notes that it often arrives together with too-similar colours, which compounds the flat look ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]).

**How many tones?** Fewer than you expect. Pixel-Editor.com offers this scale: sprites under 24 pixels do well with 2 or 3 values, 32 to 64 pixel sprites with 3 to 5, and large illustrations with 5 to 8 or more. Too many values at small sizes turns into noise ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]). Three values (highlight, base, shadow) is the minimum for believable form. One shadow zone plus one base already reads as 3D, which helps at very small sizes. Janes walks through a ceramic pot as the first full exercise: a flat fill in the second-brightest colour, then the first shade, then the highlight and the next shade down, and last the darkest shade with the black outline swapped for a dark tone ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]).

**Where the pieces go.** Think of four zones on a lit object, then a fifth on the ground.

- Highlight: the region facing the light. A specular highlight (the tiny glossy spot) sits near the peak of the curved surface closest to the light, inset from the edge. On the outline it flattens the form ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]).
- Base: the surface colour under neutral light.
- Core shadow: the darkest zone is a little inside the silhouette, not on its very edge. A thin lighter band at the edge on the shadow side is reflected light bouncing back from the ground or nearby surfaces. A rim light is the same idea from a second light source behind the object.
- Cast shadow: the shape the object throws onto the surface beside it. It should connect to the object and run away from the light. Pixel-Editor.com's lighting lesson separates the cast shadow from the dark side of the object and shows them as different shapes ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor lighting]]).

**Hard or soft transitions.** A curved surface wants gradual steps, perhaps with dithering ([[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]]). A faceted surface (a gem, a plate of armour) wants hard cuts between values. Pixel-Editor.com notes both are valid when chosen on purpose.

**Break complex things into primitives.** Pixel-Editor.com suggests decomposing an object into spheres, cylinders, cubes and cones, since each has a known shading pattern for a given light. A cylinder is a gradient across its width, and a cube has flat faces whose brightness depends on their angle to the light. Slynyrd's treatment of 3/4 view buildings supports this. Depth comes mainly from strong light on simple geometry, and small ledges that catch the light matter more than precise perspective ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd 3]]).

**Light has mood and weather.** Slynyrd treats light as an emotional tool. Soft diffused shadows suggest haze or overcast, crisp dark shadows suggest clear air, and shadows in space are long and razor-edged ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-06-light|Slynyrd 6]]). His cyberpunk study moves the primary light source down to street level, from lamps and shop signs, so surfaces are lit from below and warm light bounces up ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]).

**A glowing source has three separate jobs.** Pixel-Editor.com's lighting lesson separates the source (a small bright core with a mid-tone shell), the glow (larger dimmer shapes around it, optional and stylistic) and the illumination (changes to nearby surfaces: a warm patch on the wall, a brightened edge of a block, a flattened pool on the floor). The brightest pixels should be few. If the floor patch looks like a second lamp, lower its brightest colour first ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor lighting]]).

**Check it in grayscale.** Rough your shading out in greys first. If the grey version reads as solid form, hue and saturation can be layered on top ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]], [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Derek Yu's suggestion to desaturate the sprite to judge the shading apart from colour is the same check.

## Common mistakes

- Highlight in the centre and dark edges (pillow or concave look).
- A different light direction on every object.
- Six or eight shades on a 16 pixel sprite.
- The specular dot on the outline.
- No cast shadow, so objects float.
- Shadows that are just darker copies of the base colour.
- A hard cut where you wanted a curve, or a soft gradient where you wanted a plate edge.

## Practice

1. Shade a ball with two tones, then three, then five. Look at them at 100% and say where the extra tones stop helping.
2. Shade the same ball with the light at four corners and at the top. Label the four zones on each.
3. Draw a cube and a cylinder lit from the upper left.
4. Redo Janes's ceramic pot: flat fill, first shade, highlight, final shade, outline replaced by a dark tone.
5. Pixel-Editor.com's room exercise in your own build: a 48 by 32 room, a lamp, a block and a floor, adding source, glow, illumination and cast shadow one pass at a time.

## How I'd teach it

Start with a photograph of an egg or a ball under one lamp and have learners point at the lit side, the dark side and the shadow on the table. Then draw the ball test on the board and ask which version looks like a cushion. Pillow shading is the most common novice error, so name it in the first five minutes and show the left ball above. Learners get stuck on "why can't I just darken the edges?" Answer by turning the lamp: the pillow ball looks the same from any lamp position, so it carries no lighting information. Use grayscale first so hue does not distract. Give a rule for tone count by size and let them argue for exceptions.

## In Shadow Jog

The light is fixed to the upper left. `Pix.ball` in `src/art/pix.ts` shades a sphere from a light vector pointing from the upper left, quantises to four steps, and uses a 4 by 4 Bayer pattern to break the steps up. A rim option adds a second light. `Pix.form` lights a whole silhouette. These match the lit-ball diagram above, and the "no pillow shading" rule is built in. `shade()` in `src/engine/color.ts` supplies hue-shifted steps ([[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]]).

Three places where the module's principles apply:

1. **Mirrored sprites flip the light.** The game mirrors side-facing sprites, and a second copy of an enemy in a fight is mirrored (`docs/ARCHITECTURE.md`, `drawn.ts`). A mirrored sprite lit from the upper left is now lit from the upper right, which breaks the "one light per scene" rule. Slynyrd's top-down sprite advice is to mirror the side view for the other direction, because it saves work, and at 18 by 28 the lighting flip will hardly show. In a battle scene with large enemies, it may. A quick test: put a mirrored enemy next to an unmirrored one and see whether the highlights disagree. If they do, repaint the lit side, or accept it for small sprites.
2. **Traced AI art has its own light.** Each PixelLab pick carries whatever light the model drew. Rig v2 traces it into a palette-indexed standing frame, so a character can arrive lit from a different corner than the code-drawn world. An audit that places the whole party and a few enemies on one backdrop and checks the highlight corner would catch it.
3. **Glow follows the three-job model.** The enemy "glow" is made from bright, saturated pixels, and props glow through their emissive layer (`docs/CONCEPTS.md`, emissive layer). That is source and glow. The illumination job (a warm patch on the nearby wall or floor) is the one most likely to be missing, and it is what makes a neon sign belong to its street.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor.com, Pixel Art Shading Techniques]]: https://www.pixel-editor.com/articles/pixel-art-shading-techniques
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor.com, Lighting & Glow Effects]]: https://www.pixel-editor.com/articles/pixel-art-lighting-effects
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes, Introduction to Pixel Art]]: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-06-light|Slynyrd, Pixelblog 6: Light and Shadow]]: https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd, Pixelblog 3: Graphical Projections Part 1]]: https://www.slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd, Pixelblog 42: Cyberpunk Pixel Art]]: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
