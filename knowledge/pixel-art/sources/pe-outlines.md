---
type: source
title: "Pixel-Editor.com: Pixel Art Outlines & Anti-Aliasing"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, outlines, anti-aliasing, selout]
url: https://www.pixel-editor.com/articles/pixel-art-outlines
sources: ["https://www.pixel-editor.com/articles/pixel-art-outlines"]
---

# Pixel-Editor.com: Pixel Art Outlines & Anti-Aliasing

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.pixel-editor.com/articles/pixel-art-outlines

- **Author:** Pixel-Editor.com (no named author)
- **Kind:** Secondary
- **How I read it (2026-10-01):** Read in full from the site's script bundle.

## What it covers

Six outline treatments compared (none, hard black, shade-matched, selective, inner), a diagonal-slope table for when to anti-alias, and notes on outlines in four well-known games.

## Key points, in my words

- An outline guarantees separation from any background; a sprite with none relies on natural contrast.
- One-pixel outlines only; use the darkest palette colour instead of pure black; give interior lines lighter values than the silhouette.
- Its "selective" outline means pixels only on the shadow-facing edges, which differs from other sources.
- Anti-aliasing is for long shallow diagonals on larger art, and tends to look like stray specks on sprites under 16 pixels, so judge it at 1x.
- Corner rule: one diagonal pixel at a convex corner, never a 2 by 2 block.
- Using each character's own darkest colour as its outline helps tell characters apart by silhouette.

## Best for

A clear comparison table of outline styles and a list of mistakes.

## Caveats

The descriptions of how specific games outline their art were not verified. The advice to skip anti-aliasing on small sprites is stricter than Derek Yu's practice, as Module 6 notes.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2: Lines, curves and clusters]]
- [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Module 3: Shape and silhouette]]
- [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4: Colour and palettes]]
- [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6: Outlines, anti-aliasing and banding]]
- [[projects/shadow-jog/knowledge/pixel-art/16-common-mistakes|Module 16: Common mistakes]]
