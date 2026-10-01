---
type: source
title: "Boris the Brave: Classification of Tilesets"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, source, tiles, autotiling, wang]
url: https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/
sources: ["https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/"]
---

# Boris the Brave: Classification of Tilesets

Part of the [[projects/shadow-jog/knowledge/pixel-art/README|pixel-art library]]. Link: https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/

- **Author:** Boris the Brave
- **Kind:** Primary (a developer's taxonomy)
- **How I read it (2026-10-01):** Read in full.

## What it covers

A system for naming tilesets by cell shape, what information identifies a tile (vertex, edge, face), symmetry and restrictions.

## Key points, in my words

- Marching squares (information on vertices) needs 16 tiles; Wang-style edge systems use edges; the blob mixes both and uses 47 of 256 combinations because of a restriction.
- Symmetry cuts the count (6 tiles for marching squares with rotation); triangles need fewer.
- Classification does not fully specify autotiling behaviour; choices trade artist workload against variety.

## Best for

Precise vocabulary for tilesets.

## Caveats

Formal; useful once the basics are known.

## Used in

- [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11: Tiles and environments]]
