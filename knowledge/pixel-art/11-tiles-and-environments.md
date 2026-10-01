---
type: topic
title: "Module 11: Tiles and Environments"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, tiles, tilesets, autotiling, wang-tiles, environments, backgrounds, projection]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-classification|Boris the Brave, Classification of tilesets]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-roundup|Boris the Brave, Tileset roundup]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/boris-blob-tileset|cr31 on the blob set]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-wang-tile|Wikipedia: Wang tile]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd 3]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]"]
---

# Module 11: Tiles and Environments

Previous: [[projects/shadow-jog/knowledge/pixel-art/10-animation|Animation]]. Next: [[projects/shadow-jog/knowledge/pixel-art/12-ui-and-fonts|UI and fonts]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- What a tile and a tileset are, and how to make a texture that repeats without showing it.
- How edge and corner tiles join two terrains, and what autotiling, marching squares, Wang tiles and the "blob" set are.
- How a consistent projection (viewing angle) and one light make a scene hold together.
- How to build a layered background that reads as depth, and where parallax fits.

## The core ideas

**A tile is a repeating square of ground.** Levels are built by placing small squares from a tileset on a grid, and the arrangement is stored as a tilemap. Boris the Brave's classification of tilesets starts from the design problem every tileset has: the tiles must be flexible enough to reuse in many situations and simple enough to draw ([[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-classification|Boris the Brave, Classification of tilesets]]). Sandro Maglione says typical sprite and tile sizes are 8, 16 or 24 pixels square, which cannot show grass, dirt, rock or wood in detail, so the usual method is to study how existing games handle it (how many colours, what shapes, which way the clumps lean) ([[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]).

**The base texture has to hide that it is a tile.** Slynyrd's top-down tiles article starts from a texture that connects on all four sides and aims to hide the tile pattern as much as possible. The method is balance and consistent clusters across the tile, with no feature that jumps out and repeats every sixteen pixels. He recommends tools that display the tile repeating while you draw (Pyxel Edit and Aseprite's tile mode) because seam faults are invisible on one tile ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]). Sandro Maglione suggests several variants of a tile with different patterns, placed at random, and a manual touch-up of repeated details so the grid does not become the picture. He also notes the contrast trade-off: low contrast keeps a ground tile flat and calm, while high contrast adds volume but draws the eye to the pattern.

**Edges and corners come from the base.** Once the base exists, edge and corner pieces can be made by removing parts of it. Slynyrd's layering trick avoids baking every combination. If a texture tile has a transparent background and does not fill the cell, it can be stacked over another texture, so a grass-over-dirt tile needs only one grass-overlay piece. Rock walls are harder because they must connect to angled sections, tops and ground. He reuses a front wall at 45 degrees and reflects it for the other face, and gives walls one consistent drop-shadow length, which is unrealistic but reads cleanly ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]). His honest warning is about workload: the draft took a day, balancing every connection took more than a week.

**Autotiling, in plain terms.** An autotile set is a family of edge and corner tiles with a rule that picks the right one for each map cell from its neighbours, so the level designer paints "grass here" and the transitions appear. Several systems exist, and they differ in how many tiles the artist must draw:

| System | Tiles to draw | How it chooses | Notes |
|---|---|---|---|
| Marching squares | 16 | each of the four corners of a tile is "terrain" or not; index = TL + 2 TR + 4 BL + 8 BR | the standard in many editors; repetition shows in large areas |
| Wang tiles (corner type) | 16 for two terrains | match colours on the tile corners (or edges) with neighbours | named after Hao Wang's 1961 work on edge-matching tiles |
| Blob | 47 (plus an empty one) | looks at all 8 neighbours; a corner counts only when both adjacent edges are filled | more variety, and a larger drawing load |
| Sub-blob (the RPG Maker approach) | about 20 small pieces | each quarter of a tile is chosen separately, then assembled | many results from few pieces |
| Micro-blob | 13 small pieces | sub-blob with duplicates removed | rarely used |

The table follows Boris the Brave's roundup, his classification, the cr31 write-up of the blob set he hosts, and Wikipedia's Wang tile article ([[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-roundup|Boris the Brave, Tileset roundup]], [[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-classification|Boris the Brave, Classification of tilesets]], [[projects/shadow-jog/knowledge/pixel-art/sources/boris-blob-tileset|cr31 on the blob set]], [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-wang-tile|Wikipedia: Wang tile]]). Note how the sources use the word. In game art, "Wang tiles" usually means a corner-matched tileset, which Wikipedia says needs 16 tiles for two terrains. The blob set is a 47-tile reduction of the 256 possible edge-and-corner combinations, created by the rule that corners depend on edges. A neighbour bitmask gives each situation a number (north 1, north-east 2, east 4 and so on up to 128), and a lookup table turns the number into a tile. Boris is candid that the blob's variety "isn't really that good unless you really work for it", and that marching squares is popular because artists like drawing only 16 tiles.

**Hold the projection and the light.** A scene should obey one set of geometric rules. Slynyrd's projection article describes the 3/4 top-down view (roughly 45 degrees above, showing about three quarters of the roof and the front wall) and keeps roof angles the same even where true perspective would flatten them, because "uniformity takes priority over realism". Mixing views in one scene creates visual discord, and strong lighting on simple geometry does more for depth than careful perspective ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd 3]]).
**Scale buildings to the tile, and honestly to the people.** Slynyrd notes that top-down buildings are traditionally compressed relative to characters, and recommends measuring buildings in whole tiles so they line up with the world and with collision, and letting interiors grow beyond exteriors ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd 22]]).

**Vary the grid on purpose.** In his Phantasy Star-inspired dungeon, Slynyrd mixes 16 by 16 blocks with 32 by 32 panels so uniform tile sizes do not become monotonous, and finds a few extra tiles of baked-in shadow worth the cost ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]). His tiny 8 by 8 tilemap work keeps shadows as separate layered pieces so basic tiles combine freely.

**Backgrounds are made from colour bands.** His JRPG battle-scene study works at 192 by 144 (4:3, in line with console resolutions such as 256 by 224 and 256 by 240). He lays horizontal colour bands for the horizon, splits ground and sky into further bands, and claims that depth comes mainly from colour. Atmospheric perspective makes each farther plane less saturated, lighter and closer to the sky colour. Texture shrinks with distance, from thick blades to one or two pixel marks and then nothing. The forest case reverses the hue shift (nearest greens go from darker bluish tints toward warm yellow in the distance) because the viewer stands in shade looking toward light ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]). Parallax scrolling (layers moving at different speeds) is the animated version of the same depth cue. His note is that a 192 pixel width allows pixel-perfect parallax at integer scrolling steps.

**Night cities.** For a cyberpunk street, Slynyrd recommends keeping the environment in drab browns and greys so lighting and neon supply the colour, with warm light at street level and cooler tones higher up. Modular building stories, duplicated vertically, give believable buildings quickly ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]).

**Water tiles animate cheaply.** Two tiles built the same way with different layouts make a loop, and an in-between made by lowering the top layer's opacity to about half borrows from anime production. The timing should be neither so fast it flickers nor so slow it stutters ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]).

## Common mistakes

- A tile whose single bright detail repeats like wallpaper.
- Edge pieces drawn separately so the textures do not match.
- Testing the tile alone and finding seams only in the finished map.
- Mixed projections (a front-on wall beside a 3/4 roof).
- A scene lit from several directions.
- Objects measured in unrelated units, so doors do not fit tile counts.
- Background planes at equal saturation and contrast, which flattens depth.
- Shadows with a different length or direction on every wall.

## Practice

1. Draw a 16 by 16 grass tile that tiles seamlessly, view it in a 5 by 5 block, and edit until the repeat disappears. Add two variants.
2. Make all 16 corner tiles for grass and dirt, then place them on a small map. List which tiles you needed to redraw after seeing the map.
3. Work out the blob bitmask index of a tile with north, east and north-east filled.
4. Paint a 192 by 144 battle background in 15 colours using horizontal bands and three receding planes.
5. Draw the same wall in two projections and say which one looks consistent next to a house.

## How I'd teach it

Make the tile first, and make the learner view it repeated immediately. The repetition problem is felt, never explained. Introduce transitions with paper cut-outs in two colours so the sixteen corner cases become physical. Teach the index formula after they have drawn the tiles, as a way to let the computer choose. Tile work looks easy and takes long, and Slynyrd's day-versus-week comment is a useful expectation to set. For backgrounds, have learners paint the colour bands first and refuse texture until the bands read as depth.

## In Shadow Jog

Tiles are 16 by 16 (`docs/CONCEPTS.md`). The PixelLab Wang tilesets (two terrains, 16 corner tiles each, 5 in the game) are corner-matched sets in the sense of the table above, and `wangOverlay` in `src/art/drawn.ts` with `addTerrainOverlay` in `src/field/tiles.ts` lay them over the painted terrain as a map bakes. That is Slynyrd's layering idea in practice, since the new art goes over the old base instead of replacing it. Terrain edges blend with a 4 by 4 Bayer dither in world coordinates ([[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]]). Props are PNGs with their painters still running for light, flicker and blocking, and tall props are depth-sorted so characters walk behind them (`docs/ARCHITECTURE.md`, `docs/CONCEPTS.md`).

Where the sources point:

1. **Check seams in context.** `docs/PIXELLAB-LESSONS.md` calls the Wang sets generic raised blocks and the weakest category of the art pass. The remedies in Slynyrd's article are variants and hand adjustment: two or three alternate fills for flat interiors, so large grass areas stop showing the repeat, and a visible tile-map test page that lays every tile, edge and corner together.
2. **Consider a blob or sub-blob set for the terrain that appears in big areas.** The 16-tile sets repeat visibly in wide areas, per Boris's roundup, and the extra variety costs drawing time that code could take on. The game already plans procedural texture plus generated corner masks for terrains.
3. **Mix tile sizes for large structures.** The Rustyard and the Sprawl rooftops (`status.md`: heaps read as noise, six rooftop stamps) would benefit from Slynyrd's 32 by 32 panels over 16 by 16 blocks, plus modular stories for buildings.
4. **Battle backdrops.** The backdrops are drawn at 240 by 135 and scaled 2x. Slynyrd's JRPG study gives a template for them (bands, atmospheric steps, shrinking texture), at 192 by 144 and with 15 colours per scene. His note on reusing colours across functions suits a game that wants its ground, sky and enemies to share ramps.
5. **Neon streets.** The cyberpunk recommendation (drab ground, coloured light) matches the game's emissive layer. Where the field art feels flat, check that ground tiles are less saturated than the lights so neon can lead.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd, Pixelblog 43: Top Down Tiles Part 2]]: https://www.slynyrd.com/blog/2023/3/26/pixelblog-43-top-down-tiles-part-2
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-03-projections|Slynyrd, Pixelblog 3: Graphical Projections Part 1]]: https://www.slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-22-top-down-characters|Slynyrd, Pixelblog 22: Top Down Character Sprites]]: https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd, Pixelblog 39: Sci-fi RPG]]: https://www.slynyrd.com/blog/2022/7/24/pixelblog-39-sci-fi-rpg
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd, Pixelblog 42: Cyberpunk Pixel Art]]: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd, Pixelblog 62: Landscape Backgrounds]]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- [[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione, Getting started with Pixel Art]]: https://www.sandromaglione.com/articles/getting-started-with-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-classification|Boris the Brave, Classification of Tilesets]]: https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/
- [[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-roundup|Boris the Brave, Tileset Roundup]]: https://www.boristhebrave.com/2013/07/14/tileset-roundup/
- [[projects/shadow-jog/knowledge/pixel-art/sources/boris-blob-tileset|cr31, The Blob Tileset (hosted by Boris the Brave)]]: https://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-wang-tile|Wikipedia, Wang tile]]: https://en.wikipedia.org/wiki/Wang_tile
