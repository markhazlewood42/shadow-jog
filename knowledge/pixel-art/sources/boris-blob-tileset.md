---
type: source
title: "cr31: The Blob Tileset (hosted by Boris the Brave)"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, tiles, autotiling, blob, bitmask]
url: https://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html
sources: ["https://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html"]
---

# cr31: The Blob Tileset (hosted by Boris the Brave)

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html

- **Author:** cr31 (Stagecast Wang tile pages); mirrored by Boris the Brave
- **Kind:** Primary (the original write-up of the blob set)
- **How I read it (2026-10-01):** Read in full on the mirror; the original page was empty for my fetcher.

## What it covers

How the 47-tile blob set arises from 256 edge-and-corner combinations and how a bitmask picks a tile.

## Key points, in my words

- A corner only counts when both adjacent edges are filled, which cuts 256 to 47.
- Weights: north 1, north-east 2, east 4, south-east 8, south 16, south-west 32, west 64, north-west 128; the sum is the index.
- Rotating by 90 degrees is a simple multiplication of the index.

## Best for

The bitmask method in a few lines.

## Caveats

Programmer-oriented.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11: Tiles and environments]]
