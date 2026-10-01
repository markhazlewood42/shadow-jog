---
type: source
title: "Aseprite Documentation: Color Mode and Rotate Sprite"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, tools, indexed-color, rotation]
url: https://www.aseprite.org/docs/color-mode/
sources: ["https://www.aseprite.org/docs/color-mode/"]
---

# Aseprite Documentation: Color Mode and Rotate Sprite

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.aseprite.org/docs/color-mode/

- **Author:** Aseprite (David Capello and contributors)
- **Kind:** Reference (tool documentation)
- **How I read it (2026-10-01):** Read https://www.aseprite.org/docs/color-mode/ and https://aseprite.org/docs/rotate/ in full.

## What it covers

Colour modes (RGB, grayscale, indexed) and the two rotation algorithms.

## Key points, in my words

- Indexed mode stores palette numbers (up to 256 colours); editing a palette entry recolours every pixel that uses it; one index is transparent.
- Fast Rotation is for previews; RotSprite is the higher-quality result.

## Best for

Why palette-indexed art is useful and what RotSprite is for.

## Caveats

Aseprite-specific; I did not read its pixel-perfect drawing documentation.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4: Colour and palettes]]
- [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9: Sprites and characters]]
- [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13: Scaling, display and rotation]]
- [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15: Tools and workflow]]
