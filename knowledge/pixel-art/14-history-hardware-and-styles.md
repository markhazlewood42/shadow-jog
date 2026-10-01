---
type: topic
title: "Module 14: History, Hardware and Styles"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, history, hardware, nes, snes, mega-drive, genesis, phantasy-star-iv, styles]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/copetti-nes|Copetti on the NES]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/copetti-snes|Copetti on the SNES]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Copetti on the Mega Drive]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor water]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia: Phantasy Star IV]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]"]
---

# Module 14: History, Hardware and Styles

Previous: [[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Scaling, display and rotation]]. Next: [[projects/shadow-jog/knowledge/pixel-art/15-tools-and-workflow|Tools and workflow]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- How pixel art grew out of hardware limits, and when it became a deliberate style.
- The key numbers for the NES, SNES, Mega Drive and Game Boy: resolution, colours, sprite sizes and limits.
- What Phantasy Star IV's art was working with, and why its battle and cutscene choices make sense on that hardware.
- Self-imposed limits as a design tool, and how to pick a "virtual console" for a modern game.

## The core ideas

**Pixel art began as a technical necessity.** Wikipedia's history says the term was published in 1982 by researchers at Xerox PARC, although artists had been placing pixels deliberately since at least Richard Shoup's SuperPaint system in 1972. In the arcade and early home-computer years (Space Invaders in 1978, Pac-Man in 1980) memory and resolution forced designers to build characters out of single pixels. Through the 1980s professional artists entered the industry (Sierra, Lucasfilm Games), tools such as Deluxe Paint (1985) spread, and the European demoscene gave artists a place to make art for its own sake. In the 1990s games like The Secret of Monkey Island, Street Fighter III and A Link to the Past established the look as a choice. When mainstream games moved to 3D, pixel art settled into hobbyist communities (Pixelation, Pixel Joint) with strict ideas about method, then returned in the 2010s through indie hits such as Undertale, Stardew Valley and Celeste ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]). Derek Yu names Famicom, NES, 16-bit consoles and 1990s arcade games as his own inspirations, and points out that in Japan the form is also called "dot art" ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]).

**Hardware sets the numbers that older art obeys.** Here are the figures from Rodrigo Copetti's console architecture articles. For the Game Boy I use Wikipedia's pixel-art overview.

| | Screen | Colours | Sprites and tiles |
|---|---|---|---|
| Game Boy | 160 by 144 | 4 shades | |
| NES | 256 by 240 (about 224 visible) | master palette of 64; 8 palettes of 4 colours (4 for backgrounds, 4 for sprites) | 8 by 8 tiles; 64 sprites per frame, 8 per scanline before flicker; colour assigned per 16 by 16 block |
| SNES | 256 by 224 (NTSC) | up to 256 at once | 8 by 8 tiles (or 16 by 16); 128 sprites per frame, 32 per scanline; sprites made of up to 16 tiles |
| Mega Drive / Genesis | 320 by 224 (NTSC; 256 wide mode also exists) | 4 palettes of 16 colours: 64 on screen from 512 | 8 by 8 tiles; sprites up to 32 by 32 (4 by 4 tiles), 80 per frame, 20 per scanline |

([[projects/shadow-jog/knowledge/pixel-art/sources/copetti-nes|Copetti on the NES]], [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-snes|Copetti on the SNES]], [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Copetti on the Mega Drive]], [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]].)

Two details deserve a sentence each. First, the sources count NES colours differently. Pixel-Editor.com says the NES showed 25 colours at once ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]), while the Copetti page describes four palettes of four colours for backgrounds and four for sprites, with a transparent slot in each. The two agree once you count that each palette's first entry is shared or transparent (four background palettes of three colours, four sprite palettes of three, plus one shared backdrop colour gives 25). Second, the Mega Drive's 64 on-screen colours is a cap, but the 512-colour palette still allowed careful ramp design inside it.

**Limits shaped a style, and the style outlived the limits.** Because sprites were small and palettes tiny, artists leaned on every technique in this library: strong silhouettes, ramps with few steps, dithering to simulate more colours, and outlines to separate sprites from busy backgrounds. Derek Yu observes that the efficiency of every dot is what makes pixel art distinctive, and that this constraint-driven approach remains valid when the technical limits are gone ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu mistakes]]). Pixel-Editor.com calls the constraint the art form itself ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]). Slynyrd imposes a 6-bit RGB palette (64 colours in total) on his Phantasy Star-inspired study, as a way to work inside boundaries that feel true to the era. The Mega Drive's own palette was larger (512), and 64 is its on-screen cap. His 64-colour limit is closer to the palette of Sega's earlier Master System than to the Genesis (my own background knowledge, not from the sources), so treat it as a flavour more than a replica ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]).

**Hard limits and soft limits.** A hard limit is enforced by hardware (a sprite cannot exceed 32 by 32; a scanline flickers past 20). A soft limit is a rule the artist adopts (15 colours per scene, one outline colour). The sources say the soft kind has real value. Cure argues that small palettes give cohesion (the same colours recur) and control (fewer relationships to rebalance), whatever hardware existed ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). Pixel-Editor.com cautions that its own eight-colour exercises are artistic limits and not a claim about what every old console could do ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor water]]).

**Styles in the field.** A short field guide, with what each asks of the artist:

- 1-bit and 4-colour (Game Boy): value only, strong shapes, dithering for tone. Cure recommends the four-colour palette to beginners.
- 8-bit (NES-like): tiny sprites, three colours plus transparency per palette, bold outlines, flat colour.
- 16-bit (SNES and Mega Drive): 16-colour palettes, hue-shifted ramps of four to five steps, dithering, richer backgrounds. This is the zone of Phantasy Star IV.
- Modern "high-resolution" pixel art: larger canvases (128 pixels and up) with more tones, more like illustration. Slynyrd points out that as resolution rises, viewers fill in less, and the art drifts toward digital illustration ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]).
- Dot-art and anime-influenced pixel art (Japanese): large expressive faces and hair, manga panels for story. See [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Module 9]].

**Phantasy Star IV in context.** The game came out on the Sega Genesis in Japan on 17 December 1993 (North America February 1995), directed by Rieko Kodama, Toru Yoshida and Kiyoshi Takeuchi ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia: Phantasy Star IV]]). Its overworld and town art resemble Phantasy Star II but more detailed and colourful. Its battles use a behind-the-back view with party members at the bottom of the screen, elaborate animation on both sides, and a speed-up compared with earlier games. Manga-style panels, drawn by the game's own artists, fill the screen during key story scenes, and Hardcore Gaming 101 calls them a cheap-in-memory counterpart of the animated cutscenes of CD-based RPGs, noting that the game was originally planned for a CD add-on before it moved to cartridge ([[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]). Contemporary reviewers were split on the graphics (GameFan found them beautiful and Electronic Gaming Monthly called them mediocre), while retrospectives praise the anime-style cutscenes. This tells a student that reception is a matter of context ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia: Phantasy Star IV]]).

Because the hardware's sprite maximum is 32 by 32 pixels, bigger things on the Mega Drive had to be assembled from several sprites or drawn on a background plane (my inference from Copetti's limits, not a statement about how PSIV did it). Check an emulator's tile viewer before claiming how a specific enemy was built.

## Common mistakes

- Treating "retro" as a single style. An NES sprite and a Mega Drive sprite make different demands.
- Copying the look of old hardware without understanding why (for example, imitating flicker or crippled palettes for no reason).
- Quoting numbers without sources. Console specs are easy to misremember, so look them up.
- Assuming old art was only constrained. The best of it chooses its restraint.
- Using a modern, much larger canvas and expecting the 16-bit look.

## Practice

1. Make a 4-colour Game Boy sprite, then redo it with a 16-colour palette. Write down what the extra colours bought.
2. Pick one sprite from a game of each console above and count its colours and size.
3. Design a "virtual console" for a small game: resolution, colours per sprite, colours per scene, sprite sizes. Draw three assets that obey it.
4. Compare two screenshots of Phantasy Star IV (field and battle). What is the palette doing in each?
5. Find one claim in this module and verify it from a second source.

## How I'd teach it

Make the history short and visual: five screenshots across 40 years. The main lesson is that limits explain the techniques. A learner who understands why 8 sprites per scanline mattered will see why overlapping sprites got flattened into one. Use the Game Boy sprite as the first assignment, then add colours. For game designers, the "virtual console" exercise is the most useful thing here, because it turns nostalgia into a specification.

## In Shadow Jog

Mark's brief is Phantasy Star IV's loop and look, so the Mega Drive row of the table is the reference. Three observations:

- **Screen.** The Mega Drive's 320 by 224 is close to Shadow Jog's 480 by 270 in proportion (about 1.43 and 1.78 respectively, so the game is wider). Slynyrd's 480 by 270 recommendation puts the game in a modern-retro class that offers more room than 1993 had, which is why sprites of 18 by 28 sit comfortably.
- **Colours.** The Mega Drive gave each sprite or tile a 16-colour palette (15 colours plus transparency, by the usual convention) and 64 on screen. The art pass prompted PixelLab for "at most 15 colors" (`docs/CONCEPTS.md`), which happens to match that discipline, though the traced characters then use 28 or 40 colours each (`docs/PIXELLAB-LESSONS.md`). One option for stronger PSIV flavour is a stated soft limit: each sprite 16 colours, each scene 64 or so, enforced in the tracer and checked in the review page.
- **Battle composition.** PSIV's back view puts the party at the bottom with enemies ahead and animates both sides. This is where Shadow Jog's known problem sits (party backs covering enemies). The sources do not give PSIV's exact sprite sizes, so measuring screenshots or an emulator's sprite viewer is the next step before copying proportions.

The game's panels (a comic-panel intro and ending, `status.md`) echo PSIV's manga-style panels, which suits the memory-saving logic the sources give for them.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia, Pixel art]]: https://en.wikipedia.org/wiki/Pixel_art
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-nes|Rodrigo Copetti, NES Architecture]]: https://www.copetti.org/writings/consoles/nes/
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-snes|Rodrigo Copetti, Super Nintendo Architecture]]: https://www.copetti.org/writings/consoles/super-nintendo/
- [[projects/shadow-jog/knowledge/pixel-art/sources/copetti-mega-drive|Rodrigo Copetti, Mega Drive / Genesis Architecture]]: https://www.copetti.org/writings/consoles/mega-drive-genesis/
- [[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|Hardcore Gaming 101, Phantasy Star IV]]: https://www.hardcoregaming101.net/phantasy-star-iv/
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-phantasy-star-iv|Wikipedia, Phantasy Star IV]]: https://en.wikipedia.org/wiki/Phantasy_Star_IV
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd, Pixelblog 39: Sci-fi RPG]]: https://www.slynyrd.com/blog/2022/7/24/pixelblog-39-sci-fi-rpg
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd, Pixelblog 47: Tiny Pixels]]: https://www.slynyrd.com/blog/2023/11/26/pixelblog-47-tiny-pixels
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-mistakes|Derek Yu, Pixel Art: Common Mistakes]]: https://www.derekyu.com/makegames/pixelart2.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-water|Pixel-Editor.com, Rendering 8-Bit Pixel Water]]: https://www.pixel-editor.com/articles/rendering-8-bit-pixel-water
