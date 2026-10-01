---
type: topic
title: "Module 6: Outlines, Anti-Aliasing and Banding"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, outlines, selout, anti-aliasing, banding, jaggies]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/lospec-outlines-colour|Lospec outlines]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]"]
---

# Module 6: Outlines, Anti-Aliasing and Banding

Previous: [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Light, shading and form]]. Next: [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Dithering and texture]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- What an outline is for, and the main ways to draw one.
- What "selective outlining" (selout) means, and why the term has three slightly different definitions.
- What anti-aliasing (AA) is in pixel art, when to use it and when to leave it out.
- What banding is and how to avoid it.

## The core ideas

**An outline is there for separation.** A sprite without an outline relies on its colours contrasting with whatever is behind it. In a scrolling game the background changes constantly, so an outline guarantees the sprite stays legible. Pixel-Editor.com puts the trade-off plainly: a dark outline makes a sprite read against anything, while skipping it works only when every edge has natural contrast with its surroundings ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]).

The Lospec colour-outlines article states the governing rule: an outline should always increase contrast and never decrease it. If a coloured outline blends into the background, it fails at its one job, and you go back to black ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-outlines-colour|Lospec outlines]]).

**The usual outline styles.**

| Style | What it does | Good for |
|---|---|---|
| Pure black, outside | one pixel ring of near-black round the silhouette | sprites over any background; arcade clarity |
| Darkest ramp colour | same ring, but in the sprite's own darkest tone | softer, more cohesive look |
| Coloured (per area) | a darker shade of whatever it touches (dark red by a red shirt) | polish on light or controlled backgrounds |
| Selective (selout) | the outline varies, darker where the sprite is dark and lighter where it is bright | shaded sprites on known backgrounds |
| Inner | a shadow ring inside the fill; no extra pixels outside | keeping the sprite's footprint exact |
| None | colour contrast alone | very small sprites, or backgrounds you control |

The table follows Pixel-Editor.com's guide and the Lospec article ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]], [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-outlines-colour|Lospec outlines]]). Derek Yu's tutorial teaches the sequence from black to selout: replace pure black with contextual colours, using lighter or no outline toward the light and a darker shadow colour inside for the dividing lines, which softens the segmentation of the form ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Richard Janes says to remove complete black outlines unless there is a reason, though absolute black still has a use in dark areas ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]). He also notes that where a light shade sits next to an edge you can replace that edge with another dark shade from the palette.

**Details of good outlines.** Pixel-Editor.com's rules, in short: one pixel is enough (two pixels bloat the sprite and look like a toy); sample the outline from your darkest palette colour (pure black reads as foreign material on warm palettes); give interior lines lighter values than the silhouette so the outer shape wins; and evaluate at 1x ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]). Lospec adds that internal lines may fade toward their connection points, can be broken to suggest detail smaller than a pixel, and when two coloured areas meet, the line usually takes the colour of the part nearer the viewer ([[projects/shadow-jog/knowledge/pixel-art/sources/lospec-outlines-colour|Lospec outlines]]).

**Selout: three definitions, one warning.** The word is used inconsistently across sources, and a teacher should say which one they mean.

- Derek Yu and Lospec: the outline gets lighter where the sprite is lit and darker where it is in shadow, so contrast around the shape stays steady and the form reads as one piece.
- Pixel-Editor.com: outline pixels appear only on the shadow-facing edges and the lit edges are left bare, which hints at the light direction ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]).
- Cure (the classic Pixel Joint tutorial): "sel-out" is the broken-outline habit of anti-aliasing the outline into the background colour. He counts it as a type of bad AA, says it is not the same as shading an outline by a light source, and says it works only where you know the background, for example a game with a consistently dark backdrop ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]).

The practical lesson is common to all three. Any outline that fades or breaks stops guaranteeing separation. It is a bargain you make with a known background, and a game with many backgrounds should treat it with caution. The Lospec article says the same: dark backgrounds can make lighter outline shades vanish and push you back to black. A full outline that only varies in lightness is safer, and Cure notes it makes fewer jaggies than a broken one.

**Anti-aliasing (AA) in pixel art means doing it by hand.** Automatic AA is a blurring tool and, by the definition in [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|Module 1]], is out. Manual AA places pixels of an in-between colour at the step corners of a jagged edge so that, at normal size, the eye averages them into a smoother line ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]], [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Saint11 says a half-tone pixel counts as half a pixel when you zoom out.

```
a 3:1 line, no AA        with AA (a = a tone between line and background)
###.......               ###a......
...###....               ..a###a...
......###.               .....a###.
```

Rules that the sources agree on:

- The AA strip should be about as long as the step it softens. Long steps want long AA runs (Derek Yu, Cure, Saint11).
- Use only as much as needed. Too much blurs the edge, and AA that lines up with the line it buffers causes "AA banding" (Cure).
- The in-between pixel should really be between the two colours in value. Saint11 stresses that value matters more than hue here, and a halftone that is too dark or too bright breaks the illusion.
- Skip AA on perfect horizontals, verticals and 45 degree diagonals, which are already as clean as they get (Saint11).
- Do not AA the outer edge of a sprite if you do not know the background. A pixel blended toward a light background shows as a pale fringe on a dark one (Derek Yu, Cure). Internal AA is safe.
- Judge at 1x. At editing zoom every AA pixel looks like a smudge (Pixel-Editor.com).

**Where the sources disagree on AA.** Pixel-Editor.com advises no AA at all on sprites below 16 pixels and using it mostly for long shallow diagonals on art of 64 pixels or more, because on small sprites each AA pixel reads as a stray speck ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]). Derek Yu uses AA on a 32 by 32 character to make the canvas feel bigger than it is ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Saint11 treats AA as a judgement call that varies inside the community and suggests dropping it whenever it makes the picture worse. Slynyrd goes furthest the other way and says automatic AA contradicts the medium ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]). The workable reading is that manual AA is a tool for long, shallow edges that you evaluate at actual size, and the smaller the sprite, the less often it earns its place.

**Banding has two meanings.** Cure's banding is pixels lining up. When neighbouring pixels end at the same x or y coordinate, the grid shows and the picture seems lower in resolution than it is. His named cases are "hugging" (an outline that exactly follows the fill), "fat pixels" (2 by 2 blobs and thick lines), "skip-one" banding (the mind fills the gap between two bands) and 45 degree banding ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Saint11 uses banding for gradients where several colour bands are distinctly visible and the surface flattens. The fixes are band compression (squeeze the gradient into fewer pixels, useful on spheres and curves) or rotating the gradient direction, with AA that runs the same way as the slope ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]). Both meanings share a cause. Regular, parallel stripes of pixels are what the eye picks out as a pattern.

## Common mistakes

- A hard black outline everywhere, which flattens depth (Pixel-Editor.com).
- Two-pixel outlines.
- Giving interior details the same line weight as the silhouette.
- AA on the outside of a sprite that will be drawn over unknown backgrounds.
- AA on every curve, leaving a grey fringe.
- Selout on a sprite that moves across light and dark scenery, so parts of its edge disappear.
- Outlines that hug the fill pixel for pixel so the grid shows.

## Practice

1. Draw one small character and outline it five ways: black, darkest ramp colour, coloured, selout, none. Put each over a light, dark and busy background. Which survive?
2. Draw a 48 by 48 circle (Saint11's size) with a flat colour, then add AA and compare at 100%.
3. Anti-alias a 2:1, a 3:1 and a 5:1 black slope on white. Measure each AA run against its step.
4. Take a sphere with visible bands and fix it two ways: compress the bands, then rotate the gradient.
5. Find "hugging" in a sprite and break it.

## How I'd teach it

Show the background test first, because it answers "why outline at all?" without a lecture. Teach the single full outline as the default and selout as a later refinement. Warn that the term has three meanings and name the one you are using. For AA, resist the temptation to demonstrate on a large smooth shape. Use a 3:1 slope and have learners count the pixels, since the numeric relationship (long step, long AA) is the entire idea. Many novices want to AA everything; give them a budget ("you may place at most ten AA pixels on this sprite"). Look at results at 1x in a fixed viewer, never zoomed.

## In Shadow Jog

Rig v2 draws one outline pixel in `#120e1d` around each finished pose (`src/art/rig2/rig.ts`, `OUTLINE`), and does it after the legs swing so moving parts never tear it. In the vocabulary above this is a full outline in a single near-black colour: robust on every background in the game (field tiles, interiors, battle backs), and the safest answer given Cure's and Lospec's cautions about broken outlines on varying backgrounds. `docs/ARCHITECTURE.md` section 7 mentions "selective outlines" in the rig v2 plan, but the shipped code uses the uniform one. The two are worth deciding between on purpose. If Mark wants the painterly look, the smallest step is to tint the outline per character with that character's darkest palette colour (Pixel-Editor.com's per-character suggestion), which keeps the guaranteed separation and gives each silhouette a signature.

The outline is drawn only where a filled pixel sits directly above, below, left or right of an empty one. That leaves convex outer corners without a corner pixel, so shapes look slightly rounded. Pixel-Editor.com describes a single diagonal pixel at convex corners as the default. The two should be compared on one sprite.

The code-drawn art uses no AA (`src/art/pix.ts` header), which fits Slynyrd's strict view, and it is consistent with RotSprite's output, which is also hard-edged. For the large art, AA on long shallow edges (rooftops, canal edges, the battle backs) is the case where the sources say manual AA pays off. The glow on enemies and the neon in the post-processing layer are separate from this. They are effects drawn over the art and do not count as AA of the sprite.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor.com, Pixel Art Outlines & Anti-Aliasing]]: https://www.pixel-editor.com/articles/pixel-art-outlines
- [[projects/shadow-jog/knowledge/pixel-art/sources/lospec-outlines-colour|Lospec, Pixel Art Outlines Part 2: Using Color]]: https://lospec.com/articles/pixel-art-outlines-part-2-using-color
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes, Introduction to Pixel Art]]: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11, Article 5: Anti-Alias and Banding]]: https://saint11.art/pixel_art_articles/article5
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd, Pixelblog 5: Back to the Basics]]: https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics
