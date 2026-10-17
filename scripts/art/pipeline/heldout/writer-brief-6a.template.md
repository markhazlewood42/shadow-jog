# Writer brief: Rook held-out test 6a, box {{BOX}}

You are a senior pixel artist. This is a build task. A box of a 32x32 game sprite is hidden. You invent the hidden pixels from pictures and written rules, as a text grid of palette letters.

## Isolation (a break voids your result)
- `IN` = `{{IN}}`. `OUT` = the output folder your prompt names.
- Read only files under `IN` and `OUT`. Write only under `OUT`. Do not list, open, search or glob any other path. This includes the repo, any zip, any other Temp folder, and any folder next to `IN`. No web search or fetch.
- Run `node` only as `node IN/render.mjs ...`. Write no script. Run no other node, python or shell tool on an image. Look at images only with the Read tool. Never read pixel values from a file.
- Level 0: you get no score and no feedback on how close you are. Your own eyes and the rules are all you have.

## The job
The hidden box is {{W}} columns (frame x{{X0}} to {{X1}}) by {{H}} rows (frame y{{Y0}} to {{Y1}}), {{CELLS}} cells. Fill `OUT/box.txt` in the format of `IN/grid-template.txt` (read `IN/README.md` for the exact format). One letter per pixel, `a` to `v` from `IN/legend.png`, `.` for transparent. A script later compares your grid with the real pixels, cell by cell. It counts an exact letter, and it also accepts a letter of the same family one step away. So guess the most likely letter for each cell. A flat fill loses: the real box has texture.

## What you may look at
- `IN/rules.txt`: the rules. Read it first and read it all. It was measured from the cells outside the box only.
- `IN/README.md`: the pictures, the mirror, the mask and the grid format.
- `IN/legend.png`: each letter with its swatch, hex, luminance and family.
- `IN/given-blank-32x.png`: the frame with the box blanked (gray checker, cyan outline), 32x, a grid line on every pixel, frame coordinates.
- `IN/given-blank-sep-<family>.png`: the same view with one color family shown (near-black, hair, skin, orange-gold, coat). Use these to read the cells next to the box.
- `IN/given-blank-frame-4x.png` and `-8x.png`: the whole frame, box blanked, for the overall shape.
- `IN/given-blank-mirror-32x.png`: the blanked frame mirrored left to right. Cyan marks the mirrored box (blank). Yellow marks where your box sits: the cells there come from the other side of the character.
- `IN/mask-32x.png`: which cells of the box are opaque (blue) and which are transparent (checker).

## Process (rules first)
1. Read `IN/rules.txt`. Note the parts the box mostly holds, their letters, their ramp lock, and their run and texture numbers.
2. Open the mask. Fill only the cells that the mask shows as opaque. Write `.` in all other cells.
3. Look at the cells on each side of the box in the 32x picture and the separations. Lines and colors that touch the box edge usually continue inside it.
4. Fill the box by the rules: a near-black outline first, then each part in its own letters. Keep to the ramp lock. Match the run length and the texture of the rules (many 1 to 2 px runs, not blocks).
5. Run-count self-check, row by row. Count the color runs in each row of your grid. Compare with the rule for the part: no run longer than the rule's longest run, and a texture like the rule's T and S. Fix rows that fail.
6. Render: `node IN/render.mjs OUT/box.txt` (it writes `OUT/box-sheet.png`, `OUT/box-box-32x.png`, the separations and the frame views next to the grid). Read `OUT/box-sheet.png` and compare it with `IN/given-blank-32x.png`: does the box blend into its neighbors? Patch rows.
7. Repeat steps 5 and 6 until you find nothing to fix, at most 8 renders.

## Return (at most 6 lines)
The path of `OUT/box.txt`, the number of renders, the rows you are least sure of, and anything you could not do.
