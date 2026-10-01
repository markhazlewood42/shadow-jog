---
type: source
title: "Derek Yu: Pixel Art Tutorial, Basics"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, beginner, palette, shading, selout, dithering, tools]
url: https://www.derekyu.com/makegames/pixelart.html
sources: ["https://www.derekyu.com/makegames/pixelart.html"]
---

# Derek Yu: Pixel Art Tutorial, Basics

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.derekyu.com/makegames/pixelart.html

- **Author:** Derek Yu (creator of Spelunky; works on UFO 50)
- **Kind:** Primary (a respected practitioner)
- **How I read it (2026-10-01):** Read in full. Last updated 28 January 2020.

## What it covers

Walks through two sprites (a 96 by 96 orc and a 32 by 32 character): palette, rough outline, clean lines, flat colour, shading, anti-aliasing, selective outlining, dithering, final checks, plus tools, file formats and sharing.

## Key points, in my words

- Choose any existing palette rather than agonising; 32 colours (or 16) is typical, and swapping later is easy.
- Jaggies are breaks in a line's flow, and curves need segment lengths that change consistently.
- Think of the sprite as a sculpted form; assume light from above and slightly forward; add anti-aliasing where line segments meet (longer segments want longer AA); avoid AA on edges if the background is unknown.
- Selective outlining replaces black with contextual colours, lighter toward the light and darker colours inside for segmentation.
- Dithering is shown as a smooth gradient, a banded version and a two-colour dither; use it sparingly.
- Small sprites often omit outlines and use big heads; Mario's eye is two pixels and his moustache helps define the nose.
- Final checks: flip horizontally, desaturate, and avoid perfectionism. Never save as JPG; use PNG or GIF; upscale in whole multiples with nearest neighbour.

## Best for

The best single starting article: it is complete, in order, and explains reasons.

## Caveats

Written in 2007 and edited since; software advice dates. The "selout" it teaches differs in detail from Cure's definition.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|Module 1: The grid and resolution]]
- [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2: Lines, curves and clusters]]
- [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Module 3: Shape and silhouette]]
- [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4: Colour and palettes]]
- [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5: Light, shading and form]]
- [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6: Outlines, anti-aliasing and banding]]
- [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7: Dithering and texture]]
- [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9: Sprites and characters]]
- [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13: Scaling, display and rotation]]
- [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|Module 14: History, hardware and styles]]
- [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15: Tools and workflow]]
