---
type: source
title: "Rodrigo Copetti: NES Architecture"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, hardware, nes]
url: https://www.copetti.org/writings/consoles/nes/
sources: ["https://www.copetti.org/writings/consoles/nes/"]
---

# Rodrigo Copetti: NES Architecture

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.copetti.org/writings/consoles/nes/

- **Author:** Rodrigo Copetti
- **Kind:** Reference (hardware)
- **How I read it (2026-10-01):** Read the graphics sections in full.

## What it covers

The PPU: resolution, palettes, tiles and sprites, colour assignment.

## Key points, in my words

- 256 by 240 (about 224 visible); a 64-colour master palette; eight palettes of four colours (four for backgrounds, four for sprites).
- 8 by 8 tiles; 64 sprites per frame, 8 per scanline before flicker; palette assigned per 16 by 16 block.

## Best for

Showing how tight the earliest limits were.

## Caveats

The commonly quoted figure of 25 simultaneous colours depends on how you count the transparent slots; see Module 14.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|Module 14: History, hardware and styles]]
