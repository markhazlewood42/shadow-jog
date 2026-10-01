---
type: topic
title: "Module 12: UI and Fonts"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, ui, fonts, bitmap-font, nine-slice, hud, readability]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-26-ui|Slynyrd 26]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wayline-ui-bars-panels|Wayline: Bars, meters and panels]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/glyphs-pixel-font|Glyphs: Creating a pixel font]]"]
---

# Module 12: UI and Fonts

Previous: [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Tiles and environments]]. Next: [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Scaling, display and rotation]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- How interface art differs from character and scenery art (it has to be read, not admired).
- How to build panels, bars and menus on a base grid, including the nine-slice method.
- How a bitmap (pixel) font is designed and spaced.
- Where the pixel-art rules bend for UI, especially around transparency and gradients.

## The core ideas

**UI is the art the player looks at most and notices least.** The interface has to be legible before it is beautiful. Slynyrd's UI lesson separates UX (how the interface behaves: how quickly can you save, how smooth is navigation) from UI (the visible parts: icons, fonts, gauges, menus). Both share goals of a consistent visual language, a look that matches the game's mood, and readability that does not distract ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-26-ui|Slynyrd 26]]). Wayline's UI course says it more bluntly: a lovely inventory frame that makes the item inside hard to see is a failed frame ([[projects/shadow-jog/knowledge/pixel-art/sources/wayline-ui-bars-panels|Wayline: Bars, meters and panels]]).

**Pick a base unit and build everything from it.** UI looks designed when panels, buttons, icon cells and bar segments share one unit (8 or 16 pixels are the usual choices), so edges land on whole pixels and nothing is half a pixel off. Wayline describes the idea as establishing a single base unit that supports every variation. Slynyrd's resolution advice is the equivalent at the whole-screen level: pick a native resolution that scales cleanly, and size UI in multiples of it ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]).

**Nine-slice panels.** Menus and dialogue boxes come in every size, and drawing a new frame for each is wasteful. A nine-slice (or nine-patch) splits a panel into a 3 by 3 grid. The four corners are fixed, the four edges stretch in one direction, and the centre stretches both ways, so the border stays crisp at any size.

```
+--+--------+--+
|  |        |  |   corners stay as drawn
+--+--------+--+
|  |        |  |   edges stretch along one axis
|  |        |  |   the centre fills both ways
+--+--------+--+
```

([[projects/shadow-jog/knowledge/pixel-art/sources/wayline-ui-bars-panels|Wayline: Bars, meters and panels]]). The key discipline is that the stretchable bands must be plain: if an edge carries a pattern, stretching it produces visible distortion.

**Bars read by how full they are.** For health, mana and similar meters, Wayline's guidance is strong contrast in value and hue between fill and empty track, a dark frame so the bar separates from the game behind it, and segmenting the bar into chunks so the player can count them at a glance. Slynyrd compares ways to show health. Big shapes like hearts are charming and quick to recognise but imprecise and space-hungry. Numbers are exact but hard to read during action. Good designs vary colour, shape and orientation, and standard resources should share one visual language (do not mix vertical and horizontal gauges without a reason). Animation should serve function. Strong feedback is often best placed near the character, and UI motion should stay restrained.

**Hierarchy: the most important information gets the most prominence.** Slynyrd's reminder is that the interface has to communicate "at a glance" when the player cannot afford attention, so important information gets prominence and secondary details sit quieter ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-26-ui|Slynyrd 26]]).

**Storytelling UI in the reference game.** Phantasy Star IV added manga-style panels that fill the screen gradually during key scenes, a memory-cheap alternative to animated cutscenes, and the same artists drew them as drew the game ([[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]). The lesson for UI is that dialogue and story presentation count as interface art and deserve the same consistency.

**Bitmap fonts.** A pixel font is a typeface drawn on a fixed grid, with every curve approximated by squares. Designing one takes a few decisions:

- A uniform stroke, usually one pixel (Glyphs' tutorial keeps each pixel component one grid square).
- Vertical metrics: the baseline, the cap height, the x-height (height of lowercase), and the ascender and descender extents. Draw guides for them and keep every glyph to them.
- Spacing: the default advance width is usually too loose. In the Glyphs tutorial, the fix is to set the sidebearing to one pixel, which tightens the text.
- Rendering: pixel fonts only look right at whole-number multiples of their design size, so they must be drawn at integer positions and scales ([[projects/shadow-jog/knowledge/pixel-art/sources/glyphs-pixel-font|Glyphs: Creating a pixel font]]).

This is a gap in the library. The Glyphs tutorial is about tooling, and I did not find a source that teaches pixel-font legibility (x-height ratios, which letters need extra width) in depth. A future pass should add one.

**Where UI bends the pixel rules.** A UI often wants semi-transparent panels, soft drop shadows and gradients. These add blended colours the artist did not pick, which is the thing the strict definition of pixel art avoids ([[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|Module 1]]). Many games accept this for readability. If you want consistency, use ordered dither for transparency, flat colour bands in place of gradients, and a hard, offset shadow in one colour.

## Common mistakes

- Inconsistent panel borders and corner styles across screens.
- Text with different sizes and spacing in different places.
- Bars with weak contrast between fill and track.
- Decoration so heavy it hides the content.
- Panels stretched by non-integer scales, which blur borders.
- Mixed visual languages (round buttons beside square ones) with no reason.
- Fonts used at fractional sizes.

## Practice

1. Draw a 24 by 24 nine-slice panel with a 4 pixel border and stretch it to three sizes. Fix any distortion.
2. Make a health bar in two ways (smooth and segmented) and show both to someone for two seconds. Ask what percentage is left.
3. Design an A to Z pixel font with a 5 pixel cap height. Write a short sentence and fix the spacing.
4. Redo one screen of a game you know using only a base unit of 8.
5. Take a UI with a gradient and convert it to flat bands plus one dithered row.

## How I'd teach it

Treat UI as a reading problem. Start by asking learners to find one number on a cluttered screen and time them. Then redraw the screen with hierarchy and test again. Fonts are a good short project because they force counting pixels. Teach metrics as lines on grid paper before touching any software. Novices get stuck wanting decoration. A rule such as "no ornament inside the stretchable region" makes the nine-slice work and keeps designs calm.

## In Shadow Jog

The game has a custom proportional bitmap font in `src/engine/font.ts`: 7 pixel cap height, 2 pixel descenders, 1 pixel letter spacing, glyphs mostly 5 pixels wide, with inline colour codes and private-use glyphs for the damage-type symbols. That is a coherent, compact system and is already consistent with the Glyphs advice on tight spacing and uniform strokes. The font is drawn at whole-pixel positions on a 480 by 270 canvas, so the "integer sizes only" rule holds by construction.

The windows and bars in `src/ui/draw.ts` are drawn with Canvas calls. `drawWindow` fills a vertical gradient (`createLinearGradient`) with 95 percent opacity and a semi-transparent offset shadow. `drawBar` uses a one-pixel dark frame, a track, a fill and a 45 percent white highlight row on top. HP colour changes at 50 and 25 percent (green, amber, red). By the sources:

- The bar has the right ingredients (dark frame, track, fill) from Wayline's list, and the colour thresholds are a useful extra. Segmenting the bar into ticks (for example every 10 HP) would add the at-a-glance count the guide recommends.
- Smooth gradients and alpha are the places where the UI departs from the "no blended colours" definition, and they add many colours not in any palette. If the art style needs a stricter look, flat bands plus a dither row would match the sprites. If the window gradient is a deliberate neon-glass look, keeping it is a legitimate choice, but it should be a decision.
- The windows are drawn by code, not as nine-slice art, so style changes are cheap. The nine-slice lesson matters mostly if hand-drawn frames are introduced, in which case design the stretchable bands plain.

The battle UI has a fixed layout (command menu bottom-left, turn strip right, `docs/ARCHITECTURE.md` section 7), which is the predictable-perimeter-panel layout that RPG UI guides recommend. The story panels at the start and the end are in the Phantasy Star IV tradition.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-26-ui|Slynyrd, Pixelblog 26: UX/UI Design Basics]]: https://www.slynyrd.com/blog/2020/2/23/pixelblog-26-uxui-design-basics
- [[projects/shadow-jog/knowledge/pixel-art/sources/wayline-ui-bars-panels|Wayline, Bars, meters and panels]]: https://www.wayline.io/learn/game-ui-art/3
- [[projects/shadow-jog/knowledge/pixel-art/sources/glyphs-pixel-font|Glyphs, Creating a pixel font]]: https://glyphsapp.com/learn/pixelfont
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd, Pixelblog 22: Top Down Character Sprites]]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
- [[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|Hardcore Gaming 101, Phantasy Star IV]]: https://www.hardcoregaming101.net/phantasy-star-iv/
