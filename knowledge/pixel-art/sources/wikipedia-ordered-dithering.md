---
type: source
title: "Wikipedia: Ordered dithering"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, dithering, bayer]
url: https://en.wikipedia.org/wiki/Ordered_dithering
sources: ["https://en.wikipedia.org/wiki/Ordered_dithering"]
---

# Wikipedia: Ordered dithering

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://en.wikipedia.org/wiki/Ordered_dithering

- **Author:** Wikipedia contributors
- **Kind:** Reference
- **How I read it (2026-10-01):** Read in full.

## What it covers

Threshold maps and Bayer matrices, how ordered dithering is applied, and how it compares with error diffusion.

## Key points, in my words

- A tiled threshold map decides each pixel's colour by position; the 2 by 2 Bayer matrix is 0, 2, 3, 1 and a 4 by 4 version holds sixteen values.
- It is fast, has no conditionals, is stable across animation frames and compresses well.

## Best for

A programmer's explanation of the Bayer pattern used in the game's code.

## Caveats

About image conversion in general; pixel artists place dithering by hand.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7: Dithering and texture]]
