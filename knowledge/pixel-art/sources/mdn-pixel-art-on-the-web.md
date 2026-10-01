---
type: source
title: "MDN: image-rendering and Crisp Pixel Art Look"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, scaling, web, canvas]
url: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering
sources: ["https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering"]
---

# MDN: image-rendering and Crisp Pixel Art Look

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering

- **Author:** MDN Web Docs (Mozilla)
- **Kind:** Reference (web platform)
- **How I read it (2026-10-01):** Read both pages: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering and https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look.

## What it covers

The CSS image-rendering property and how to keep scaled canvases and images crisp.

## Key points, in my words

- "pixelated" uses nearest neighbour to the nearest whole multiple then smooths; "crisp-edges" avoids blur; baseline support since January 2020.
- For canvas games, draw at native size and scale with CSS; keep drawImage sizes at whole multiples; a non-integer device pixel ratio can make pixels uneven and has no complete fix.

## Best for

The rules for showing pixel art in a browser.

## Caveats

The Games page is a short technique note.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13: Scaling, display and rotation]]
