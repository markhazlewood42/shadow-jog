---
type: topic
title: "Module 7: Dithering and Texture"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, dithering, bayer, texture, noise, banding]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor dithering]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-ordered-dithering|Wikipedia: Ordered dithering]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd 2]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]"]
---

# Module 7: Dithering and Texture

Previous: [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Outlines and anti-aliasing]]. Next: [[projects/shadow-jog/knowledge/pixel-art/08-materials|Materials]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- What dithering is, the common patterns, and what each is for.
- How ordered (Bayer) dithering works, and why games use it.
- When dithering helps and when it only adds noise.
- The five rules for building a texture out of clusters.

## The core ideas

**Dithering fakes an in-between colour with a pattern.** Two colours sit side by side. Between them you place a pattern of one colour inside the other, and from a normal viewing distance the eye blends the pattern into something between the two. Richard Janes describes three stages: a 50:50 checker pattern, then 25:75 and 75:25 versions made of evenly spaced unconnected dots on either side ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]). Derek Yu shows the same thing with a gradient. A smooth gradient has hundreds of shades. Reduce to a few colours and you get bands, which are distracting stripes. Dither two of those colours and you get the gradient feel back with no new colour ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

```
50% (checker)    25% light      75% light
LDLD             LDDD           LLLD
DLDL             DDLD           LDLL
LDLD             LDDD           LLLD
DLDL             DDLD           LDLL
```

Pixel-Editor.com's density guide gives a handy way to think about it: count the light pixels and divide by the total. Four light pixels in a 16 pixel swatch is 25 percent coverage. Coverage is not the same as measured brightness, but it tells you which colour the patch leans toward ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor dithering]]).

**Patterns and their uses.** Cure lists the 50 percent checkerboard as the most common form, with other patterns for a gentler buffer between a flat colour and the checker. Stylised dithering adds small shapes to the pattern. Interlaced dithering weaves two dither regions together at their border, which lets you chain gradients. Random dithering mostly adds single-pixel noise and is rarely recommended ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]).

**Ordered dithering is a rule applied by position.** In computer graphics, ordered dithering lays a repeating "threshold map" over the image. For each pixel the map gives a number, and the pixel becomes the lighter or darker colour depending on whether the pixel's brightness is above that number. The best-known maps are Bayer matrices. The 2 by 2 matrix is 0, 2, 3, 1 and a 4 by 4 matrix holds the sixteen values 0 to 15 arranged so that thresholds are spread evenly. Wikipedia notes that it is fast, has no conditional logic, and because the pattern is fixed relative to the screen it flickers less than error-diffusion methods in animation ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-ordered-dithering|Wikipedia: Ordered dithering]]). That predictability is why retro games and many modern pixel games use it to blend areas.

**When to use it, and when not.** Sources agree on caution:

- Dithering is a buffer for the ends and edges of a flat area. If it covers half the sprite, add a colour instead (Cure).
- The lower the contrast between the two colours, the gentler the dither looks. A high-contrast dither is harsh (Cure).
- On CRT monitors the screen blurred dither patterns, hiding them. On crisp screens they show, so dithering is less versatile than it was (Cure).
- Derek Yu uses it sparingly and finds it most effective on large uniform areas or rough textures, citing the Bitmap Brothers' games and Japanese PC-98 games as examples of skilled use.
- Janes says it has little relevance today but still helps when you do not want another colour, and for roughness colour alone cannot provide.
- Pixel-Editor.com's guide treats dithering as a normal tool for shading and surfaces. It warns against dithering without solid shading underneath, and gives the example of a polished metal pipe where a narrow bright reflection should stay solid, because dithering over it reads as a rougher surface ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor dithering]], [[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]).

So the sources disagree a little on how much dithering is fashionable and agree about how to keep it from going wrong. A dither can also create noise: all those isolated pixels of a 25 percent pattern are orphans, and Cure ties a lot of dithering trouble to exactly that.

**Texture is a different job.** Dithering blends. Texture suggests a surface. Slynyrd's texture lesson gives five rules ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd 2]]):

1. Simplify. Reduce the detail to a few abstract shapes.
2. Repeat. Build a small unit (a leaf cluster, a brick shape) and repeat it, varying the spacing so it does not feel mechanical.
3. Balance. If detail is dense in one place, give another place some, too.
4. Contrast. Uniform texture over a big area looks fake. Alternate textured and quiet regions, and shift colour or detail.
5. Avoid orphan pixels, unless they sit inside a texture pattern and belong to it.

The rest of his lesson applies the rules to materials. Bricks should be grouped in patterns with blank areas rather than drawn one by one, grass and wheat come from layered, repeated strokes, and foliage starts from circles with roughened edges, then leaf-shaped clusters over blocked-in light and shadow. Texture serves form, so it should not fight the silhouette. Details are covered by material in [[projects/shadow-jog/knowledge/pixel-art/08-materials|Module 8]].

Pixel-Editor.com's stone example shows the dither-versus-texture overlap well. Keep a solid lit face and a solid shadow face, then make the border between them irregular, with a few dots moved into chip-like clusters, so the rock keeps its volume ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor dithering]]). Slynyrd's JRPG backgrounds reduce texture with distance: thick blade-like strokes in the nearest grass, one or two pixel marks beyond, then none ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]).

## Common mistakes

- Dithering over half the sprite, which turns the pattern into a texture of its own.
- Dithering colours with a large value gap, giving a harsh sparkle.
- Random dither (noise) when an ordered pattern would be calm.
- Using dither as a substitute for shading, with no solid zones underneath.
- Texture that is the same density everywhere (flat wallpaper).
- Drawing every brick, shingle or blade.
- Orphan pixels as "grain".

## Practice

1. Shade a 24 by 24 cylinder using only two colours in four stages (flat, hard split, checker bridge, then 75/50/25 coverage), as Pixel-Editor.com sets it out. Then repeat with two closer colours and compare.
2. Reproduce Derek Yu's triptych: a smooth gradient on paper, a banded version in five colours, and a two-colour dither.
3. Make a 32 by 32 stone wall twice: once with every brick, once with 40 percent of the bricks marked. Which is calmer?
4. Texture a sky, a stone and a metal pipe from one palette and decide where dither belongs on each.
5. Count the orphan pixels in a dithered area and say which are acceptable.

## How I'd teach it

Show the three-step gradient, band, dither on one slide and let learners pick the version that looks smooth. Immediately follow with a ruined example (dither over half the sprite) so they see the limit. Have them place the dither by hand on a small cylinder, because coverage percentages make the idea concrete. Novices get stuck thinking that dithering is the "pixel art look" and use it everywhere. Counter that by assigning a pixel budget ("dither at most one edge"). Teach texture by subtraction: draw the full texture, then remove half and compare. Reserve the Bayer matrix for an optional aside for programmers.

## In Shadow Jog

The game uses a 4 by 4 Bayer matrix in several places: the sphere shader in `src/art/pix.ts`, the terrain blending in `src/field/tiles.ts` (using world coordinates, so the pattern stays fixed as the map scrolls and cannot crawl), the battle backdrops in `src/art/battlebg.ts`, and the title screen. `docs/CONCEPTS.md` records the terrain blend. That is the same method Wikipedia describes, and the stable-pattern property is the reason it suits a scrolling game.

Two cautions follow from the module. First, a dither baked into a character sprite moves with the character, so it can shimmer during a walk. The rig's RotSprite step (`src/art/rig2/rig.ts`) works on clusters, and a fine checkerboard on a leg is its worst case, so rotated parts should be flat or ramp-banded and keep any dither for the torso or parts that do not rotate. This is reasoning from the algorithm's description and has not been tested in the game. Second, Cure's "no more than a buffer" rule applies to the terrain overlay. If a dither covers more than the transition band, the ground starts to read as texture of its own, and the audit notes about scrap heaps reading as noise (`status.md`, field art) may partly come from this.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor.com, Pixel Art Dithering]]: https://www.pixel-editor.com/articles/pixel-art-dithering
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor.com, Pixel Art Shading Techniques]]: https://www.pixel-editor.com/articles/pixel-art-shading-techniques
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-ordered-dithering|Wikipedia, Ordered dithering]]: https://en.wikipedia.org/wiki/Ordered_dithering
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes, Introduction to Pixel Art]]: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd, Pixelblog 2: Texture]]: https://www.slynyrd.com/blog/2018/2/15/pixelblog-2-texture
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd, Pixelblog 62: Landscape Backgrounds]]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
