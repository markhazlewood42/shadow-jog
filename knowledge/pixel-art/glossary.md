---
type: topic
title: "Pixel Art Glossary"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, glossary, terminology]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-scaling-algorithms|Wikipedia: Pixel-art scaling algorithms]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/boris-tileset-roundup|Boris the Brave, Tileset roundup]]"]
---

# Pixel Art Glossary

One or two sentences per term, with the module that teaches it. Back to the [[projects/shadow-jog/knowledge/pixel-art/README|curriculum map]]. Where sources use a word differently, the entry says so.

## A

**Anchor point (ground point).** The pixel of a sprite that sits on the ground, so characters of different sizes stand on the same line. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Anti-aliasing (AA).** Placing pixels of an in-between colour at the step corners of a jagged edge so the eye reads a smoother line. In pixel art it is done by hand, because automatic smoothing adds colours the artist did not choose. See [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]].

**AA banding.** A fault where the anti-aliasing segments line up with the line they are meant to soften, so they form stripes. See [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]].

**Anticipation.** A small move opposite to the main action (a crouch before a jump) that prepares the viewer. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Atmospheric perspective.** Distant things look lighter, less saturated, less detailed and closer to the sky colour. Used to build depth in backgrounds. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]] and [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Autotiling.** Choosing the right edge or corner tile for each map cell automatically from its neighbours. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].

## B

**Banding.** Two meanings. In Cure's sense it is neighbouring pixels ending on the same row or column, which exposes the grid and makes the image look coarser; his named kinds are hugging, fat pixels, skip-one and 45 degree banding. In a gradient sense it is a visible stack of distinct colour bands that flattens a surface. See [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]].

**Base body (template).** A plain, unclothed figure at the target size that clothes, hair and equipment are drawn over, so a cast shares proportions. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Bayer matrix.** A square grid of threshold numbers (2 by 2, 4 by 4, 8 by 8) used for ordered dithering. See [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]].

**Bilinear interpolation.** A scaling method that blends neighbouring pixels. It blurs pixel art and is avoided. See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]].

**Blob tileset.** An autotile set of 47 tiles (plus an empty one) that handles every sensible arrangement of eight neighbours, using the rule that a corner counts only when both adjacent edges are filled. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].

## C

**Cast shadow.** The shape an object throws on the surface beside it, separate from the dark side of the object itself. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

**Chibi.** Characters with big heads and short bodies, usually two or three heads tall. Standard for small sprites. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Cluster.** A group of touching pixels of the same colour. The working unit of pixel art, like a brushstroke. See [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]].

**Colour quantization.** Reducing an image to a small palette by merging similar colours. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]] and [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15]].

**Contact pose.** The walk-cycle frame where the leading heel touches the ground, limbs at full extension and the body at its lowest. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Core shadow.** The darkest zone on a lit form, a little inside the silhouette and not on the very edge. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

**Cutout (skeletal) animation.** Posing a character built from rigid pieces hung on joints, so a pose is a set of angles and limbs cannot stretch. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

## D

**Dithering.** Placing two colours in a pattern so the eye blends them into a third. Common forms are the 50 percent checkerboard, 25 and 75 percent dots, stylised and interlaced patterns; random dither is usually avoided. See [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]].

**Dot art.** The Japanese name for pixel art. See [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|Module 14]].

**Double.** An unnecessary pixel that thickens a line at one spot, making an L-shaped corner in what should be a clean diagonal. See [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]].

## E

**Emissive.** A surface or layer that glows (neon, lamps, eyes) and is drawn as light, not lit by the scene. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]] and [[projects/shadow-jog/knowledge/pixel-art/08-materials|Module 8]].

**EPX / Scale2x.** A 2x enlargement rule that sets a corner of each 2 by 2 block to a neighbour's colour only when two adjacent neighbours match each other and differ from the rest, keeping diagonals smoother than plain doubling. See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]].

**Eyeburn.** Cure's word for a colour (usually too saturated, or clashing with its neighbours) that hurts to look at. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

## F

**Facings (directions).** The sides a character is drawn from. Often three are drawn (up, down, side) and the side is mirrored. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Follow-through.** Loose parts (hair, cloak) keep moving after the body stops. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Frame.** One picture in an animation. Each frame also has a duration. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

## H

**Hold frame.** A frame shown longer (or repeated) to add weight or to ease in and out. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**HSB / HSV.** A colour model of hue, saturation and brightness (value), easier to reason about than RGB. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Hue.** The colour family (red, green, blue). See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Hue shifting.** Changing hue along a ramp, usually toward cooler hues in shadow and warmer in light, so shading looks lit and not merely darkened. A ramp without it is a straight ramp. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

## I

**Indexed colour.** Storing each pixel as a number that points into a palette, so changing a palette entry recolours every pixel that uses it. See [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15]] and [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Integer scaling.** Enlarging by whole-number multiples only (2x, 3x, 4x), so every source pixel becomes the same size block. See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]].

**Isometric.** A projection that shows an object from a corner with equal emphasis on three faces. In pixels it uses 2:1 lines. See [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]].

## J

**Jaggies.** Pixels or short segments that break the flow of a line, or the stair-stepping of an edge that lacks anti-aliasing. See [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]].

## K

**Key pose.** An extreme or defining pose in an action (stride, wind-up, strike) that the other frames connect. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

## L

**Light direction.** Where the light comes from. Chosen first and kept the same across a scene; top-left is a common default. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

## M

**Marching squares.** An autotile method that looks at four corners of a tile (terrain or not) to choose from 16 tiles. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].

**Master palette.** A large shared palette (for example 64 to 160 colours in ramps) from which every asset in a project draws. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Mixel.** Short for "mixed pixel": parts of one picture at different pixel sizes, for instance a 2x-scaled sprite next to native art. See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]] and [[projects/shadow-jog/knowledge/pixel-art/16-common-mistakes|Module 16]].

## N

**Native resolution.** The size the game actually draws at before the screen enlarges it (480 by 270 for Shadow Jog). See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]].

**Nearest-neighbour.** A scaling method that copies each source pixel without blending. See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]].

**Nine-slice.** A panel split into a 3 by 3 grid: fixed corners, edges that stretch one way and a centre that stretches both, so one drawing fits any size. See [[projects/shadow-jog/knowledge/pixel-art/12-ui-and-fonts|Module 12]].

**Noise.** Pixels that carry no information and distract, most often independent single pixels. See [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]].

## O

**Oekaki.** Cure's word for drawing made with line and fill tools without attention to individual pixels, which he does not count as pixel art. See [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|Module 1]].

**Onion skinning.** Showing the previous (and next) frame faintly under the current one to judge spacing. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Orphan pixel.** A pixel that touches no other pixel of its own colour. Allowed for a few uses (specular highlight, tiny essential detail, a buffer pixel in anti-aliasing). See [[projects/shadow-jog/knowledge/pixel-art/02-lines-curves-and-clusters|Module 2]].

**Outline.** A line, usually one pixel, around a shape to separate it from the background. See [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]].

## P

**Palette.** The set of colours an image or game uses. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Palette swap.** Recolouring a sprite by changing which colours the palette slots hold, to make variants. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Parallax.** Background layers moving at different speeds to suggest depth. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].

**Pillow shading.** Shading in rings that follow the outline regardless of light, giving a puffy look. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

**Pixel density.** How many screen pixels one art pixel covers. A scene should have one. See [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|Module 1]].

**Pixel-perfect.** Two uses. In scaling it means integer multiples with no blur ([[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]]). In drawing, some editors offer a mode that removes the extra corner pixels of freehand strokes ([[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15]]).

**Projection.** The way a 3D thing is flattened onto the picture (side, top-down, 3/4 top-down, isometric). Keep one per scene. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].

**Punching through.** A colour that seems to float in front of the picture, usually from too much saturation or a clashing hue. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

## R

**Ramp.** A row of colours ordered from dark to light, used to shade one material. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Reflected light.** Light bouncing from nearby surfaces into a shadowed side, showing as a thin lighter band along the shadow edge. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

**Rim light.** A bright edge from a second light behind the subject. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

**RotSprite.** A way to rotate pixel art cleanly: enlarge 8x with a Scale2x variant, rotate and shrink with nearest-neighbour sampling. See [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]].

## S

**Saturation.** How vivid a colour is; zero is grey. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Scanline limit.** A hardware cap on sprites per horizontal line (8 on the NES, 20 on the Mega Drive, 32 on the SNES), beyond which sprites flicker or vanish. See [[projects/shadow-jog/knowledge/pixel-art/14-history-hardware-and-styles|Module 14]].

**Selout (selective outlining).** An outline whose colour varies. Three meanings are in use: lighter where the sprite is lit and darker where it is shaded (Derek Yu, Lospec); outline only on shadow-facing edges (Pixel-Editor.com); and Cure's "sel-out", an outline anti-aliased into a known background. See [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]].

**Silhouette.** The solid outer shape of a sprite with interior detail removed. See [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Module 3]].

**Simultaneous contrast.** A colour looks different depending on its surroundings. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

**Smear frame.** A frame that draws the motion itself (a stretched limb, a streak) to stand in for in-betweens. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Specular highlight.** A small bright spot on a glossy surface near the point facing the light. See [[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]].

**Sprite.** A small image that moves in a game. **Sprite sheet:** every frame of it arranged in one image. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Squash and stretch.** Deforming a moving object (flatter on impact, longer at speed) while keeping its volume. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Straight-ahead and pose-to-pose.** Two ways to animate: drawing frames in order, or drawing key poses first and filling between them. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Sub-pixel animation.** Faking half-pixel movement by adding and removing pixels at the moving edges across frames. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

## T

**Texture.** The suggestion of a surface through repeated, varied clusters. See [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Module 7]].

**Tile / tileset.** A small repeating square of ground or wall art, and the collection of them used to build a map. See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].

**Tracing.** Rebuilding finished art onto your own grid and palette. In this project it turns AI-generated pictures into palette-indexed sprite data. See [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Module 15]].

## V

**Value.** How light or dark a colour is. The most important colour property for reading a picture. See [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]].

## W

**Walk cycle.** The looping frames of walking, built from contact, down, passing and swing poses. See [[projects/shadow-jog/knowledge/pixel-art/10-animation|Module 10]].

**Wang tile.** A tile with a colour on each side that must match its neighbours, after Hao Wang (1961). In game art the name usually means a corner- or edge-matched set (16 tiles for two terrains). See [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Module 11]].
