---
type: topic
title: "Module 2: Lines, Curves and Clusters"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, fundamentals, lines, curves, jaggies, clusters, orphan-pixels]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor fundamentals]]"]
---

# Module 2: Lines, Curves and Clusters

Previous: [[projects/shadow-jog/knowledge/pixel-art/01-the-grid-and-resolution|The grid and resolution]]. Next: [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Shape and silhouette]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- How to draw a clean straight line on a grid, and why only a few slopes look clean.
- What a jaggy and a double are, and how to find and fix them.
- How to build a curve from steadily changing run lengths.
- What a cluster is, why it replaces "pixel" as your working unit, and when a lone pixel is allowed.

## The core ideas

**A line is a list of run lengths.** On a grid, any line that is not perfectly horizontal or vertical is a staircase. What your eye reads as "straight" is a staircase whose steps are all the same. If every step is two pixels across and one down, the eye sees a calm slope. If the steps go two, one, three, two, the eye sees a wobble, even though the line starts and ends in the same place. That is the whole theory of pixel lines.

Sandro Maglione lists the "perfect lines" as the ones with simple ratios: flat (0:1), 1:2, 1:1 (the 45 degree diagonal), 2:1, and straight up (1:0). Most of your shapes should be built from these ([[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione]]). Richard Janes says the same thing in older language: five straight lines, mirrored or rotated, are consistent because the pixels always come in ones, twos or a single row, and the same idea extends to longer runs as long as they stay regular ([[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes]]).

```
a 2:1 line (steady)     a wobbly line (runs 2, 1, 3, 2)
##......                ##......
..##....                ..#.....
....##..                ...###..
......##                ......##
```

Isometric art is the classic place where this matters. A true 30 degree line cannot be drawn on a grid, so the convention is the 2:1 line, which is about 26.6 degrees. Sandro Maglione says exactly this, and Wikipedia's overview of the form notes that isometric pixel art uses a dimetric projection with specific pixel ratios for the same reason ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia: Pixel art]]).

**Jaggies and doubles are the two classic line faults.** Derek Yu defines jaggies as the little breaks in a line's flow, the "uncontrolled squiggle" you would get drawing a straight line while someone bumps the table. On a curve they appear whenever segment lengths stop growing or shrinking in a consistent way ([[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu basics]]). Cure adds that jaggies also show up on any line that lacks anti-aliasing, and that the fix is usually one of two things: make the run lengths more uniform, or smooth the step with anti-aliasing ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]).

A double is a related fault. Sandro Maglione describes it as extra thickness on a line at one spot, which draws too much attention to that spot. In a clean 1:1 diagonal the pixels touch only at their corners. A double is the place where two pixels touch edge to edge and make a small L-shape.

```
clean 1:1 diagonal      with a double (the L at the left)
#.....                  #.....
.#....                  ##....
..#...                  .#....
...#..                  ..#...
```

Both Derek Yu and Sandro Maglione say these faults can be broken on purpose. The point is to know you are breaking them.

**A curve is a line whose run lengths change steadily.** Think of the top of a circle. At the very top it runs flat for a long stretch, then the runs get shorter as the curve turns downward, then it runs vertically for a while. A smooth sequence of runs might read 5, 2, 1. A sequence such as 5, 1, 3 has a kink. Saint11 phrases it as step sizes growing predictably as the curve flattens toward horizontal and shrinking as it nears vertical, with jaggies being the breaks in that sequence ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]). Sandro Maglione gives the same example (three pixels, then two, then one).

```
smooth 8 by 8 circle      a kink on the left side
..####..                  ..####..
.#....#.                  .#....#.
#......#                  #......#
#......#                  #......#
#......#                  .#.....#
#......#                  #......#
.#....#.                  .#....#.
..####..                  ..####..
```

If the shapes are too small to have a clean curve (it is common at 8 or 12 pixels across), choose the one that looks best at 100% and move on. Perfect geometry is a guide, and the player never sees the grid.

**The cluster is your real unit.** A cluster is a group of touching pixels of the same colour. Cure quotes the old Pixelation "Ramblethread" idea that nearly everything good or bad in pixel art happens at the moment you make a cluster ([[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure]]). A lone pixel is usually noise. Clusters work like brushstrokes in painting, and their shapes decide the style: Slynyrd observes that simple angular clusters read as clean and sharp, and lots of unique organic clusters read as natural ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd 5]]). Clusters are also interlocking puzzle pieces. Changing the border of one cluster changes the shape of its neighbours, so you adjust them together.

**Orphan pixels have a short list of allowed uses.** An orphan (a pixel not touching any pixel of its own colour) is allowed in a few places, according to Cure: a bright specular highlight, a very small essential detail such as the eye of a tiny sprite, stars and bubbles, and an anti-aliasing pixel that is clearly acting as a buffer on an edge. Saint11 adds texture work to the list. Everywhere else, an orphan reads as a mistake or as noise ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]).

**A working method: sketch with clusters, clean at the end.** Saint11 teaches a three-step approach. Start with big blobs of colour using a two or three pixel brush, to settle the composition and mood. Refine from background to foreground. Resolve jaggies last, by restoring a consistent progression and nudging pixels. You can also start from line art if you are tracing something. Cure says either is fine and that blocking in suits larger images.

**Banding is a line problem too.** Cure's other meaning of banding is that adjacent rows or columns of pixels end at the same coordinate, which exposes the grid and makes the picture look lower resolution than it is. The cure is to avoid lining pixels up, and it comes up again in [[projects/shadow-jog/knowledge/pixel-art/06-outlines-and-anti-aliasing|Module 6]].

## Common mistakes

- Leaving a hand-drawn line uncleaned. Zoom to 800% and read the run lengths aloud. Any number that breaks the pattern is a candidate.
- Making every curve a perfect mathematical circle at tiny sizes. At 8 pixels across, it is better to pick the version that reads.
- Using single-pixel lines for things that need volume (see [[projects/shadow-jog/knowledge/pixel-art/03-shape-and-silhouette|Module 3]]).
- Scattering stray pixels "for texture". They look like dust on the screen.
- Scaling or rotating the art with a tool that does not respect the grid ([[projects/shadow-jog/knowledge/pixel-art/13-scaling-display-and-rotation|Module 13]]), which turns neat runs into mush.

## Practice

1. Draw the five perfect lines at 16 pixels long on grid paper or in a 16 by 16 canvas. Write the run lengths under each.
2. Draw circles of diameter 8, 12 and 16 and write the run lengths of one quarter. Compare yours with someone else's.
3. Take a deliberately messy hand-drawn heart or leaf and clean it. Mark each change with a coloured pixel so it can be reviewed.
4. Count the orphans in a sprite you like and label each as justified or not.
5. Do Saint11's cluster exercise: paint a tree or a rock using only big brush blobs, then refine.

## How I'd teach it

Start on paper. Grid paper makes "run length" physical, and learners can count aloud ("two, two, two"). Show a wobbly line next to a regular one and ask which is straight, then let them find the odd run. After that, show a circle as run lengths and have them predict the next number. Novices get stuck wanting the line to follow their hand, and they feel the rules limit expression. It helps to show that the steady staircase is how every game line you admire was made. The jaggy hunt is also a good game: give a sprite with five planted faults and a ten-minute timer. A short note on notation ("2-2-2", "3-2-1") gives students a way to check their own work, and that independence matters more than any single rule.

## In Shadow Jog

The code-drawn art has hard-edged shapes only. `src/art/pix.ts` says in its header that nothing is anti-aliased, and its `ellipse`, `line` and `limb` primitives place whole pixels, so run lengths come out of the geometry. Check them by eye for the faults above: an ellipse of odd radius can still produce a kink.

Rig v2 adds two sources of faults. Swinging a leg by RotSprite (`src/art/rig2/rig.ts`) re-draws edges at new angles. After each rotation, look for orphans and doubles around the knee and the foot, and consider a small clean-up pass that deletes pixels with no same-colour neighbour. The tracer has a parallel need: `docs/PIXELLAB-LESSONS.md` lists "correct pixel art" (stray and anti-aliased pixels) as an easy addition. A rule of thumb from this module is to delete an orphan unless it is a highlight, a tiny eye or an intended detail.

The outline function in `rig.ts` adds a pixel wherever a filled pixel sits directly above, below, left or right. On a 1:1 diagonal edge that produces a clean 1:1 outline. At the outer corner of a convex shape, it leaves the corner empty, so silhouettes come out very slightly rounded. That is a style decision, with no fault to fix. Pixel-Editor's outline guide describes the opposite default for convex corners (a single diagonal pixel fills the corner), so it is worth comparing the two on one character before deciding ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor outlines]]).

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/sandro-maglione|Sandro Maglione, Getting started with Pixel Art]]: https://www.sandromaglione.com/articles/getting-started-with-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/richard-janes|Richard Janes, Introduction to Pixel Art]]: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- [[projects/shadow-jog/knowledge/pixel-art/sources/derek-yu-basics|Derek Yu, Pixel Art Tutorial: Basics]]: https://www.derekyu.com/makegames/pixelart.html
- [[projects/shadow-jog/knowledge/pixel-art/sources/cure-pixel-art-tutorial|Cure, The Pixel Art Tutorial]]: https://pixeljoint.com/forum/forum_posts.asp?TID=11299
- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11, beginner articles 2 and 5]]: https://saint11.art/pixel_art_articles/article2
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-05-basics|Slynyrd, Pixelblog 5]]: https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-fundamentals|Pixel-Editor.com, Fundamentals of Pixel Art]]: https://www.pixel-editor.com/articles/fundamentals-of-pixel-art
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-outlines|Pixel-Editor.com, Pixel Art Outlines & Anti-Aliasing]]: https://www.pixel-editor.com/articles/pixel-art-outlines
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-pixel-art|Wikipedia, Pixel art]]: https://en.wikipedia.org/wiki/Pixel_art
