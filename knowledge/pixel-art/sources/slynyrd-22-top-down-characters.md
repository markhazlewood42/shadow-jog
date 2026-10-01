---
type: source
title: "Slynyrd (Raymond Schlitter): Pixelblog 22, Top Down Character Sprites"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, sprites, proportions, resolution, facings]
url: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
sources: ["https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites"]
---

# Slynyrd (Raymond Schlitter): Pixelblog 22, Top Down Character Sprites

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites

- **Author:** Raymond Schlitter (Slynyrd)
- **Kind:** Primary (a working game artist's tutorial series)
- **How I read it (2026-10-01):** Read in full.

## What it covers

Character sprites for top-down games: facings, grid size, walk and run cycles, proportions and screen resolution.

## Key points, in my words

- Draw three facings (up, down, side) and mirror the side; four facings can serve eight-way movement, as in Secret of Mana.
- Size sprites in tile units (one wide, two tall is versatile) and do not fill the cell; a top-down sprite may overlap the one above it on screen.
- Use a plain dummy to build animation first; a 4-frame walk can be taken from an 8-frame run by dropping full-stride frames and slowing the speed.
- Head a third to a half of the sprite; use height to signal age and gender.
- Resolutions that scale to 1080p: 320 by 180 (6x), 480 by 270 (4x), 640 by 360 (3x). Measure buildings in tiles.

## Best for

The most directly relevant article for a 480 by 270 JRPG.

## Caveats

Top-down emphasis; does not discuss the back view used in battle.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|Module 1: The grid and resolution]]
- [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Module 3: Shape and silhouette]]
- [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9: Sprites and characters]]
- [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11: Tiles and environments]]
- [[projects/shadow-jog/knowledge/pixel-art/12-ui-and-fonts|Module 12: UI and fonts]]
- [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13: Scaling, display and rotation]]
