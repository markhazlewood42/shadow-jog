---
type: source
title: "Wikipedia: Pixel-art scaling algorithms"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, scaling, epx, scale2x, rotsprite]
url: https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms
sources: ["https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms"]
---

# Wikipedia: Pixel-art scaling algorithms

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms

- **Author:** Wikipedia contributors
- **Kind:** Reference
- **How I read it (2026-10-01):** Read in full.

## What it covers

Nearest-neighbour and bilinear scaling, then Eagle, EPX/Scale2x, hqx, xBR and RotSprite.

## Key points, in my words

- EPX (Eric Johnston, LucasArts, around 1992) turns each pixel into a 2 by 2 block and changes a corner only when two adjacent neighbours match each other and differ from the rest.
- Eagle can erase one-pixel hollows; hqx uses lookup tables; xBR uses multi-pass rules and keeps textures sharper.
- RotSprite scales 8x with a Scale2x variant that treats similar colours as matches, then rotates and shrinks with nearest-neighbour sampling.

## Best for

Understanding which algorithm solves which problem.

## Caveats

Describes the algorithms and does not tell artists when to use them.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13: Scaling, display and rotation]]
