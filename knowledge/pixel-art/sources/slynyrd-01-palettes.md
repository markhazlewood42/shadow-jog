---
type: source
title: "Slynyrd (Raymond Schlitter): Pixelblog 1, Color Palettes"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, palette, hue-shifting, ramps]
url: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
sources: ["https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes"]
---

# Slynyrd (Raymond Schlitter): Pixelblog 1, Color Palettes

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes

- **Author:** Raymond Schlitter (Slynyrd)
- **Kind:** Primary (a working game artist's tutorial series)
- **How I read it (2026-10-01):** Read in full.

## What it covers

How to build a large palette from hue-shifted ramps using HSB.

## Key points, in my words

- Think in hue, saturation and brightness; build a ramp with steadily rising brightness and saturation that peaks mid-ramp.
- Shift hue by a fixed step per swatch (his 128-colour "Mondo" palette uses nine swatches per ramp and a 20 degree shift) and make other ramps by shifting the whole ramp round the wheel in 45 degree steps.
- Add neutrals by flipping and desaturating the middle of the palette; avoid high saturation with high brightness.
- A 160-colour palette on the same principles served a full game.

## Best for

A numeric method for master palettes.

## Caveats

Aimed at palette design for whole projects; a single sprite uses a small slice of such a palette.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4: Colour and palettes]]
