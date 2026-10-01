---
type: topic
title: "Module 8: Materials"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, materials, texture, water, foliage, stone, metal, glow, neon]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd 2]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor water]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/saint11-tutorial-library|Saint11 tutorial library]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd 43]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd 42]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd 29]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor lighting]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor dithering]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor shading]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]"]
---

# Module 8: Materials

Previous: [[projects/shadow-jog/knowledge/pixel-art/07-dithering-and-texture|Dithering and texture]]. Next: [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Sprites and characters]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- A way to draw any material: find the few cues that say what it is and leave the rest out.
- Specific cue sets for foliage, stone and brick, sand, water, metal, glow, and hair.
- Which materials the sources teach well, and where this library has gaps.

## The core ideas

**A material is a short list of cues.** At game scale you cannot draw wood grain or every blade of grass. What identifies a material is a handful of cues: how light behaves on it (soft or hard highlight), what colour family it lives in, how its texture is spaced, and how it breaks its own outline. Slynyrd's texture lesson says to simplify, repeat with varied spacing, balance dense areas against quiet ones, and never let texture compete with form ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd 2]]). Pixel-Editor.com's water lesson says the same for a surface: a rectangle of blue with white dots is still a blue rectangle, so give the viewer a few clues about where the shore is, which way the surface runs, what it reflects, and where light catches it ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor water]]).

Here is a cue table, assembled from the sources named in each row.

| Material | Cues that carry it | Source |
|---|---|---|
| Foliage | start from circles of different sizes; roughen the edges with single pixels; block in light and shadow first; then repeat small leaf-shaped clusters; a modular stamp can be layered and shifted slightly to suggest wind | Slynyrd 2; Derek Yu (canopy as clustered spheres) |
| Grass and wheat | short vertical strokes layered with varied colour; stroke size shrinks with distance until it vanishes | Slynyrd 2, 62 |
| Brick and stone wall | group bricks into patches, leave blank areas, shade only some bricks; for rock, keep big light and shadow faces and make the border between them jagged | Slynyrd 2; Pixel-Editor dithering |
| Sand | long angled S-shaped clusters with irregular spacing (too regular and they look like noodles); desert variant uses small s and c shapes | Slynyrd 43, 62 |
| Water (side or pond view) | flat mid blue first, a darker far edge, a lighter near edge, short horizontal strokes (wider nearer the viewer), a broken reflection of whatever stands on the bank, a few glints | Pixel-Editor water |
| Water (top-down) | banks first, then short stair-step strokes aligned with the flow; shallows lighter, foam as an uneven strip | Pixel-Editor water; Slynyrd 43 |
| Moving water tiles | two tiles of the same construction with different layouts; a half-opacity in-between frame; timing neither too fast nor too slow | Slynyrd 43 |
| Polished metal | keep the narrow bright reflection solid next to a dark band; covering it with dither makes it read rough | Pixel-Editor dithering |
| Gems, armour plates | hard cuts between values (faceted surfaces) | Pixel-Editor shading |
| Clouds and stars | curved overlapping arcs for clouds; several star shapes in a couple of palette colours spread unevenly | Slynyrd 2 |
| Hair | main flow lines first, a flat base colour, then shadow and highlight; break it into clumps | Slynyrd 29 |
| Glow (lamp, neon, magic) | small bright core, larger dimmer shells, plus a changed patch on nearby surfaces; the brightest pixels are few | Pixel-Editor lighting |
| Neon and night city | drab environment so lights supply the colour; warm bounce at street level; unlit neon shown as dead glass | Slynyrd 42 |
| Haze and distance | lighter, bluer, less detailed with each receding plane | Slynyrd 62 |

**Surfaces say what they are by how they break the rule you just learned.** Rough materials (stone, bark, sand) break up their own shadow edges and use irregular boundaries. Smooth ones (metal, glass, polished stone) keep their highlight crisp and their transitions clean. Soft materials (cloth, hair) form clumps and folds with curved cluster shapes. If you remember one idea from this module it is that a material choice is a choice about edges. The same lighting ([[projects/shadow-jog/knowledge/pixel-art/05-light-shading-and-form|Module 5]]) is applied, and the material decides how jagged, crisp or soft the transitions are.

**Reuse colours across materials.** Slynyrd's backgrounds recycle one shadow colour on mountains and again on clouds, and the sky gradient colours return in distant terrain, which keeps a scene to 15 colours and makes it hang together ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd 62]]).

**Direction and consistency matter more than detail.** For water, Pixel-Editor.com has you repeat one direction of mark so the surface reads as flat (horizontal strokes) or flowing (diagonal strokes along the channel). If you turn a few strokes the other way they interrupt the flow, so use them only as small variation. Remove half the ripples and see whether it still reads as water. If it does, keep the simpler version.

**Dedicated lessons exist for more materials than this library covers.** Saint11's free tutorial series has separate pieces on fire, water, ice, rock, metal, wood, sand, fabric, vegetation, shine, electric effects, glitch and more, delivered as animated image tutorials that a text reader cannot digest. The titles are in [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-tutorial-library|the Saint11 library page]], and a teacher using this curriculum should send learners to them for those materials. Skin is a gap too. None of the sources I read has a dedicated skin lesson. The general ramp advice (hue-shifted, desaturated shadow) in [[projects/shadow-jog/knowledge/pixel-art/04-colour-and-palettes|Module 4]] applies.

## Common mistakes

- Drawing the object's parts (every brick, leaf or rivet) when the viewer needs the pattern.
- Texture of equal density everywhere.
- Using the same highlight style for every material, so metal and cloth feel the same.
- Water with random white dots and no direction or reflection.
- Letting a texture's colour fight the colour of the form beneath it.
- Skipping the surrounding surfaces, so a lamp glows but lights nothing.

## Practice

1. Draw a pond using Pixel-Editor.com's passes: base blue, far-bank dark, near-shore light, tree reflection broken into strips, about ten ripples, three glints. Then remove half the ripples.
2. Draw one sphere in four materials (polished metal, rough stone, cloth, glass) from one palette of eight colours. The differences should come from edges and highlights, not new hues.
3. Build a wall of 40 by 40 pixels using the "group the bricks, leave gaps" method.
4. Make a two-frame water tile and add a half-way blend frame.
5. Light a room with one lamp: source, glow, illumination.

## How I'd teach it

Teach one material per session and always start with a photograph, then ask the class to name the three cues that make it that material. The answers become the checklist for the drawing. Water is the best opener because the ripples, reflection and shoreline cues are easy to isolate and the failures (blue rectangle) are obvious. Novices tend to over-draw. The remedy is the "remove half" exercise. When a learner's material looks wrong, ask which edge is wrong (too busy, too clean, too regular) before suggesting a colour change.

## In Shadow Jog

The field-art notes in `status.md` list three material problems: the Rustyard scrap heaps read as noise, the toxic canal reads as foliage, and six rooftop stamps repeat. Each lines up with a cue in the table.

- **Scrap heaps.** Noise means texture without a form to serve. Use the brick-wall method: pick two or three big clusters that give the heap a readable silhouette and a lit side, shade only some pieces, and leave quiet areas. Check that orphan pixels are not standing in for "junk".
- **Toxic canal.** Foliage and liquid get confused when colours and edges overlap. Water gets its identity from direction and reflection: horizontal or flow-aligned strokes, a bank to anchor it, and a broken reflection of the neon above. If the canal's colour sits close to the foliage greens, moving it to a hue the foliage does not use may help more than any texture. A glints-and-gaps pass, with brighter strokes clustered under light sources, would add the missing glint cue.
- **Rooftop stamps.** Slynyrd's modular approach builds objects from reusable parts that are layered and nudged to create variety. Six stamps can become a dozen variations by splitting each into base, vent and antenna layers and recombining them with `randomLook`-style seeding, as the town characters already do (`docs/ARCHITECTURE.md` section 7).

Neon and glow are where the game already follows the sources. Props run their painter for light, flicker and blocking, and the picture's bright pixels glow (`docs/ARCHITECTURE.md` section 7). The extra step Pixel-Editor.com's lighting lesson asks for is illumination: a warm or coloured patch on the nearby ground and wall, which turns a bright sign into a light. Slynyrd's cyberpunk note supports keeping the street itself drab so those patches show up.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-02-texture|Slynyrd, Pixelblog 2: Texture]]: https://www.slynyrd.com/blog/2018/2/15/pixelblog-2-texture
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-43-top-down-tiles|Slynyrd, Pixelblog 43: Top Down Tiles Part 2]]: https://www.slynyrd.com/blog/2023/3/26/pixelblog-43-top-down-tiles-part-2
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-62-jrpg-landscapes|Slynyrd, Pixelblog 62: Landscape Backgrounds]]: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-42-cyberpunk|Slynyrd, Pixelblog 42: Cyberpunk Pixel Art]]: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-29-anime-faces|Slynyrd, Pixelblog 29: Anime Faces and Hair]]: https://www.slynyrd.com/blog/2020/7/28/pixelblog-29-anime-faces-and-hair
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor.com, Rendering 8-Bit Pixel Water]]: https://www.pixel-editor.com/articles/rendering-8-bit-pixel-water
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-lighting|Pixel-Editor.com, Lighting & Glow Effects]]: https://www.pixel-editor.com/articles/pixel-art-lighting-effects
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-dithering|Pixel-Editor.com, Pixel Art Dithering]]: https://www.pixel-editor.com/articles/pixel-art-dithering
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-shading|Pixel-Editor.com, Pixel Art Shading Techniques]]: https://www.pixel-editor.com/articles/pixel-art-shading-techniques
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-tutorial-library|Saint11, Pixel Art Tutorials (index)]]: https://saint11.art/blog/pixel-art-tutorials/
