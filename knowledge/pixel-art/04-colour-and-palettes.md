---
type: topic
title: "Module 4: Colour and Palettes"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, colour, palette, ramps, hue-shifting, value, saturation]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-01-palettes|Slynyrd 1]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Copetti on the Mega Drive]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec palettes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia: Palette swap]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]"]
---

# Module 4: Colour and Palettes

Previous: [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Shape and silhouette]]. Next: [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Light, shading and form]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- The three properties of a colour (hue, saturation, value) and why value comes first.
- What a colour ramp is, how many steps one needs, and how hue shifting makes ramps richer.
- Why small palettes work, and how big one palette should be for a sprite, a scene and a whole game.
- How to pick or build a palette, and how to check it.

## The core ideas

**Describe colours with hue, saturation and value.** Hue is the colour family (red, green, blue). Saturation is how vivid it is; zero saturation is a grey. Value (also called brightness or luminosity) is how light or dark it is. Painters' tools and many pixel editors use the HSB or HSV model, which splits colour this way. It is more useful than RGB numbers because you can think about one property at a time ([[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]], [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-01-palettes|Slynyrd 1]], [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]).

**Solve value before hue.** Value does most of the reading work. Pixel-Editor.com calls it the single most important property and offers the test of squinting or going to grayscale ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]). Cure makes the same point from the other direction: if every colour in the palette has about the same lightness you cannot make highlights, mid-tones and shadows, and the picture goes flat. A line's apparent thickness also depends on its value, so a bright line looks thinner than a dark one at 1x ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). A good habit is to shade a sprite in greys first. Cure notes some artists work that way and then add hue later, because hue is easier to change once the value relationships are settled.

**A ramp is a row of colours from dark to light.** A ramp is the set of colours you use to shade one material, ordered by value. A palette is made of one or several ramps, and ramps can share their darkest and lightest colours. Cure explains that sharing saves palette slots and ties the picture together, and that mid-tones are harder to share because they have less room to flex, so shared mid-tones tend to be neutral browns or greys ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]).

How long should a ramp be? The sources give a spread. Pixel-Editor.com suggests 2 or 3 steps for tiny icons and 16 pixel sprites, 4 or 5 for a 32 pixel character, and 5 to 7 for 64 pixel work ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]). Richard Janes says you rarely need more than five shades of one colour, and each must be easy to tell apart from its neighbour; seven near-identical shades in his example are impossible to distinguish ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]). Slynyrd, working on a master palette meant for many scenes, uses nine swatches per ramp ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-01-palettes|Slynyrd 1]]). The disagreement is about purpose. A master palette must offer many options to choose from, and a single sprite uses only three to five of them.

**Hue shifting makes ramps look lit.** A "straight" ramp changes only lightness (and maybe saturation). A hue-shifted ramp also changes hue along the way, so shadows lean toward one colour and highlights toward another. Cure's version: bend highlights toward yellow and shadows toward blue, because straight ramps are boring and do not reflect how many hues we see in reality ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Saint11 describes the physical logic: real shaded surfaces are never just a darker version of the lit colour, and photographs of buildings show warmer lit areas and cooler shadows ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]). Janes recommends more cool colours in shadow and more warm colours in light, with saturation falling toward grey as you move from warm to cool ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]). Pixel-Editor.com explains the temperature reasoning (a warm light source casts shadows lit by the cooler sky) and adds that the rule bends for moonlight, fire, neon or underwater scenes. What matters is that light and shadow differ in temperature ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]).

Slynyrd gives a numeric method. His ramps raise brightness steadily and peak saturation in the middle, and he shifts hue by a fixed step per swatch (20 degrees at the upper end of what he likes), usually in the positive direction as brightness rises. He then copies the ramp and shifts the whole thing around the colour wheel to make the other ramps, at 45 degree steps for eight ramps. His warning is not to combine high saturation with high brightness ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-01-palettes|Slynyrd 1]]). This method differs from the "warm highlights, cool shadows" rule in one way. It applies the same directional shift to every ramp, which keeps ramps consistent with each other, whereas the warm/cool rule lets each ramp lean toward whichever side of the wheel is nearer the light or the shadow.

**Keep saturation under control.** Cure warns that pixel colours are made of light, not pigment, so very saturated colours burn the eyes more readily than paint does. He calls a stray over-bright colour "punching through" the picture, as it seems to float above everything else ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Saint11's suggestion is to pair large low-saturation areas with small high-saturation details. Pixel-Editor.com says one strongly saturated accent draws the eye while five equally vivid colours compete with each other ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]). The same site adds that shadows are often a little less saturated than lit areas.

**Beginners colour by label, and light does not.** Derek Yu's name for this is "naive colouring": the tree must be bright green, the sky bright blue, the rock grey. Looking at real objects, you find reflected light, desaturated shadows and shifted hues. His fixes are to borrow or adapt an existing palette, observe real objects, and run small experiments with brightness and saturation until a combination pleases ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). He also warns against too many similar colours. Each colour should have a job and an identity.

**Why small palettes work.** Cure gives two reasons that have nothing to do with old hardware. Cohesion: with fewer colours, the same ones reappear across the picture and bind it. Control: with 200 colours, changing one means rebalancing every neighbouring ramp, whereas a small palette has fewer relationships to worry about ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). He also advises beginners to try a four-colour Game Boy palette, because then only value matters. Derek Yu works with 16 or 32 colours and tells beginners to pick any existing palette and stop agonising, since swapping palettes later is easy ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

Typical sizes from the sources:

| Scope | Colours | Source |
|---|---|---|
| Beginner sprite | 4 to 8 | Pixel-Editor.com |
| Derek Yu's sprite tutorial | 32 (16 also common) | Derek Yu |
| One landscape scene | 15 to 16 | Slynyrd 62 |
| A sci-fi RPG study | 64 (a 6-bit RGB limit) | Slynyrd 39 |
| Master palette for a whole project | 128 to 160 | Slynyrd 1 |

The 64-colour figure in Slynyrd's RPG study is a self-imposed limit in the style of Master System era hardware; the Mega Drive could show 64 colours on screen out of a palette of 512 ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]], [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Copetti on the Mega Drive]]). See [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|Module 14]].

**Use a palette someone else already balanced.** Lospec hosts a searchable library of thousands of palettes, filterable by colour count and tag. Pixel-Editor.com names PICO-8 (16), Endesga 32, Zughy 32 and Game Boy as good starting points, and Lospec's entry for Resurrect 64 by Kerrie Lake describes ramps arranged side by side for easy picking ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec palettes]], [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). The advice is to use a proven palette until you understand why it works, and then make your own.

**Colour is relative.** The same grey looks lighter on a dark background and darker on a light one, and a neutral grey surrounded by purple looks greenish (Cure's example, and Pixel-Editor.com's simultaneous contrast section). So judge a colour in place, next to its real neighbours, at actual size ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor colour]]).

**Colour sells depth and mood.** Slynyrd's JRPG landscapes build depth from stacked colour bands. The nearest plane has the most saturation and contrast, and each farther plane loses saturation, gains lightness and shifts toward the sky colour. He gets a full scene from about 15 colours by reusing the same colour in several jobs ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]). His cyberpunk study keeps the environment in drab browns and greys so that lighting and neon bring the colour, with warm light bouncing at street level and cooler tones higher up ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]).

**Treat the palette as a project file.** Most editors can save a palette, and indexed colour mode stores each pixel as a number pointing into the palette. Change a palette entry and every pixel using it changes, which makes recolouring cheap ([[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs]], [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia: Palette swap]]). See [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15]].

An illustrative ramp, made up for this module to show the idea (no source dictates these values). A straight green ramp might go from H 120 S 60 B 25 to H 120 S 60 B 85. A hue-shifted version could run H 175 S 55 B 25 (a cool teal shadow), H 140 S 60 B 45, H 105 S 55 B 65, H 75 S 45 B 90 (a warm yellow-green highlight). Both have four steps and the same lightness, but the second reads as sunlit.

## Common mistakes

- Dozens of near-identical hues. Remove one of any two colours you cannot tell apart at 100%.
- A ramp that changes only lightness, producing flat, muddy shading.
- Saturating everything. Reserve full saturation for the accent.
- Palettes where all mid-values sit close together. Spread them from near-black to near-white.
- Judging swatches on their own and not in the picture.
- A single sprite that uses every hue in equal weight.

## Practice

1. Shade a sphere in the four-colour Game Boy palette. Then take the same sphere to a five-step grey ramp and compare which reads better.
2. Build a four-step ramp for one material twice (straight and hue-shifted). Put both on the same sprite and compare.
3. Make a six-colour palette by Pixel-Editor.com's value-first method: grays first, then pick a key hue, then hue-shift, then add one complementary accent.
4. Recolour one sprite with three Lospec palettes. Note which colours stop doing their job and why.
5. Convert any sprite you made to grayscale. Where do two areas merge?

## How I'd teach it

Teach value before colour, with a grayscale-first exercise. Learners are usually surprised how far a picture gets with only greys. Then add a single hue on top, then hue shifting as a "make it glow" step. Demonstrate with a side-by-side of a straight and a shifted ramp, because the difference is visible within a second. Novices get stuck on the vocabulary, so introduce HSB with a picker and let them drag one slider at a time. Warn them early that the warm-versus-cool rule is only a default, and show a neon scene as the counter-example. Finish by letting them borrow a Lospec palette, since choosing from scratch stalls many beginners.

## In Shadow Jog

The game already has hue shifting built in. `shade()` in `src/engine/color.ts` darkens by pulling hue toward 250 degrees (blue-violet) and nudging saturation up, and lightens by pulling hue toward 55 degrees (warm yellow) and easing saturation down. That is the "cool shadows, warm light" rule in code, and `Pix.ball` shades with it (`src/art/pix.ts`). Because it is a fixed rule, it will also push a magenta neon surface toward blue shadows and yellow highlights. If the cyberpunk look needs coloured shadows that follow the neon (a magenta light with violet shadows, per Pixel-Editor.com's neon caveat), `shade()` is the place to parameterise by light colour.

The outline colour is `#120e1d`, a very dark violet, not pure black (`src/art/rig2/rig.ts`). That suits a cool, night-leaning palette and avoids the "ink stamped on a warm sprite" look Pixel-Editor.com warns about ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]).

Traced characters keep one palette per character across all facings: 28 colours for field sprites, 40 for battle, enemy and portrait art (`docs/PIXELLAB-LESSONS.md`). That count is large against the sources' advice for a single sprite (Derek Yu's 32 is the nearest match), but it holds up because the colours are the AI pick's own ramps, merged. Two suggestions follow. First, consider a single master palette of roughly 64 to 128 colours organised in hue-shifted ramps (Slynyrd's Mondo method, or an existing one such as Resurrect 64). Quantising every traced character to that palette would give the party, enemies, tiles and UI shared ramps, which is where "same world" cohesion comes from. The trade-off is lost fidelity to the picks, so test it on one character first. Second, the known problem that a second copy of an enemy is recoloured badly ("green skin", `status.md`) comes from shifting the hue of the whole image. Because the traced art is palette-indexed, a swap can change only the named slots (cloak, glow) and leave skin and outline alone.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-01-palettes|Slynyrd, Pixelblog 1: Color Palettes]]: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-colour|Pixel-Editor.com, Color Theory for Pixel Art]]: https://www.pixel-editor.com/articles/color-theory-for-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11, Article 6: Basic Color Theory]]: https://saint11.art/pixel_art_articles/article6
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes, Introduction to Pixel Art]]: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione, Getting started with Pixel Art]]: https://www.sandromaglione.com/articles/getting-started-with-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-palette-list|Lospec palette list]]: https://lospec.com/palette-list
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd, Pixelblog 62: Landscape Backgrounds]]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd, Pixelblog 42: Cyberpunk Pixel Art]]: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd, Pixelblog 39: Sci-fi RPG]]: https://www.slynyrd.com/blog/2022/7/24/pixelblog-39-sci-fi-rpg
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Rodrigo Copetti, Mega Drive / Genesis Architecture]]: https://www.copetti.org/writings/consoles/mega-drive-genesis/
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor.com, Pixel Art Outlines & Anti-Aliasing]]: https://www.pixel-editor.com/articles/pixel-art-outlines
- [[projects/shadow-jog/knowledge/pixel-art/sources/aseprite-docs|Aseprite docs, Color Mode]]: https://www.aseprite.org/docs/color-mode/
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-palette-swap|Wikipedia, Palette swap]]: https://en.wikipedia.org/wiki/Palette_swap
