# Records: spike rook-3d (Rook from a model)

One short table per build round. Exit criteria: `docs/spikes/rook-3d.md`. Gate lines = exit line 1 (palette, no half-alpha, outline >= 93%, height 31 +/- 1, bottom row 30, head alone 13 to 15). Numbers come from `node scripts/art/rook3d/check.mjs <out dir>`.

Step 0 (cloud Blender): `download.blender.org` is blocked by the session proxy (403 on CONNECT). `apt-get install blender` gave **Blender 4.0.2**, which runs headless (`blender --background --version`). Cycles on CPU renders the 32x32 passes. The spike doc's Blender 5.2.2 was Mark's Windows machine; this box is 4.0.2.

## Round 1 (first render of the script-built model)

Change: model (boxes and spheres, 14 parts), rig (13 bones, keyframed walk of 4 frames, 2 battle poses), 8 facings, toon 3 steps, outline, palette ramps. Camera pitch 20 degrees, 8.7 px per unit fitted once on the s facing.

| facing | height | bottom | head alone | outline min % | orphans max | gate frames |
|---|---|---|---|---|---|---|
| s | 30-31 | 30 | 18 | 100.0 | 11 | 0/4 |
| se | 31 | 30 | 17-18 | 97.9 | 18 | 0/4 |
| e | 30-31 | 30 | 15 | 100.0 | 6 | 4/4 |
| ne | 28-30 | 30 | 17-18 | 100.0 | 12 | 0/4 |
| n | 28-29 | 30 | 18 | 100.0 | 13 | 0/4 |
| nw | 28-30 | 30 | 17-18 | 100.0 | 13 | 0/4 |
| w | 30-31 | 30 | 15 | 100.0 | 7 | 4/4 |
| sw | 31 | 30 | 17-18 | 97.8 | 7 | 0/4 |

Palette: 0 off-palette colors and 0 half-alpha pixels on all 34 frames (both by construction: colors come only from ramps of `target.json`). Battle poses (79x68): palette, alpha, outline pass (100.0 and 97.5% outline). Gate: walk 8 of 32 frames, all 34 frames 10.
Other checker lines (reported): HL-SHOULDER (13 to 14, given 11), PA-07 head width (21, given 19) and HL-FLAT texture density (0.4 to 0.7 of the given, hair lowest) fail.
Verdict: fail. Named fixes: head 18 px wide (needs 13 to 15) so shrink the head; height 28 to 29 on n, ne, nw (depth of the model changes the projected height with the facing) so fit the scale per facing; torso top 2 rows too low.

## Round 2 (proportions, per-facing fit, outline at the cell edge)

Change: head narrower (hair rx 0.74, glasses 0.86 wide), torso top raised 0.1, boots centered, scale fitted per facing on its passing pose (31 px tall, the same for its 4 frames), the outline now sees the cell edge as transparent (round 1 left row 0 light). Note: the checker was also run 3 times on tuning renders between rounds 1 and 2 (head width 18 to 14, outline row 0); those runs are not rounds and are listed here for honesty.

| facing | height | bottom | head alone | outline min % | orphans max | gate frames |
|---|---|---|---|---|---|---|
| s | 31 | 30 | 14 | 100.0 | 10 | 4/4 |
| se | 30-31 | 30 | 13-14 | 100.0 | 20 | 4/4 |
| e | 31 | 30 | 14-15 | 100.0 | 12 | 4/4 |
| ne | 30-31 | 30 | 15-16 | 100.0 | 17 | 2/4 |
| n | 31 | 30 | 14 | 100.0 | 8 | 4/4 |
| nw | 30-31 | 30 | 15 | 100.0 | 16 | 4/4 |
| w | 31 | 30 | 14-15 | 100.0 | 10 | 4/4 |
| sw | 31 | 30 | 14-15 | 100.0 | 13 | 4/4 |

Palette 0 off-palette and 0 half-alpha on all 34 frames. Battle poses: outline 100.0% on both. Gate: 32 of 34 frames (walk 30 of 32). Fails: ne_walk0 and ne_walk2 head alone 16 (limit 15).
Other checker lines (reported): HL-FLAT texture density fails on 32 of 32 walk frames (hair 0.4 to 0.5 of the given), HL-SHOULDER on 9, HL-HIP on 8, PA-07 head width on 4.
Verdict: fail on 2 frames. Named fixes for round 3: ne head width; a texture pass (ordered dither on the toon steps, hair strands) for HL-FLAT; the downSwing blade leaves the 79 px frame on the right.

## Round 3 (texture pass, ne head, downSwing)

Change: texture pass = 2x2 ordered dither added to the light value before the toon thresholds (hair and beard 0.20, coat and sleeves 0.16, legs 0.12); hair radius 0.74 to 0.72; downSwing blade aimed down so it stays in the 79x68 frame. Check refinement (made after seeing the sw result): the katana-side check compares the hilt (guard and wrap pixels) with the 3D position of the hilt, not the whole katana, because the sheath is hidden behind the body at sw (7 visible px).

| facing | height | bottom | head alone | outline min % | orphans max | gate frames |
|---|---|---|---|---|---|---|
| s | 31 | 30 | 14 | 100.0 | 11 | 4/4 |
| se | 30-31 | 30 | 13-14 | 100.0 | 20 | 4/4 |
| e | 31 | 30 | 14 | 100.0 | 12 | 4/4 |
| ne | 30-31 | 30 | 15 | 100.0 | 16 | 4/4 |
| n | 31 | 30 | 14 | 100.0 | 14 | 4/4 |
| nw | 30-31 | 30 | 15 | 100.0 | 18 | 4/4 |
| w | 31 | 30 | 14 | 100.0 | 13 | 4/4 |
| sw | 30-31 | 30 | 14-15 | 100.0 | 14 | 4/4 |

| battle pose (79x68) | off-palette (battleIdle palette) | half-alpha | outline % | orphans | body box |
|---|---|---|---|---|---|
| ready | 0 | 0 | 100.0 of 220 edge px | 11 | 56 tall |
| downSwing | 0 | 0 | 100.0 of 235 edge px | 20 | 60 tall |

- Gate (exit line 1): 34 of 34 frames (32 walk, 2 battle). Orphans 6 to 20 on walk frames (checker limit 40, 1.25 x the given's 32).
- Katana side: the hilt pixel centroid and the 3D prediction agree in sign on 32 of 32 walk frames (hilt on screen-left at s, se, e, ne; screen-right at n, nw, w; sw hilt at screen-left from the back-left view). The numbers are in `docs/spikes/rook-3d/out/check.txt`.
- Determinism: two full runs (`scripts/art/rook3d/run.sh`) give 69 identical files (34 PNGs, 34 label grids, manifest) by sha256, list hash afc07a9c2877d17c, in 7 s per run. Hashes of every frame: `out/sha256.txt`.
- Not in the exit lines, reported: HL-FLAT texture density fails on 32 of 32 walk frames (hair about 0.5 of the given, even after the dither), HL-SHOULDER on 10, HL-HIP on 8, PA-07 head width on 4. The look gap to the Sprite Fusion given is mostly this: flat toon blocks, no hand-placed texture.
- Pose cost (exit line 6): `ready` and `downSwing` are one tuple each in `battle_specs` (body angles, grip point, blade direction) in `rook_model.py`; changing downSwing was 1 line plus a 7 s re-render, no drawing.
- Verdict: all hard lines hold on all frames. Whether it looks like Rook or like pixel art is Mark's gate (lines 2, 3 by a blind grader, and 7). Read of the pictures: the field facings read as a 3D toon model, and the battle poses (silver sleeves, no coat shape) are weaker than the PixelLab idle.

## Verification (one fresh Sonnet verifier, lean loop round 1)

| line | verdict | evidence |
|---|---|---|
| 1 hard lines | pass | rebuilt with run.sh; own PIL script: 0 off-palette, 0 half-alpha on 34 frames; walk height 30-31, bottom 30; check.mjs gate 34 of 34 |
| 2 facing ID | pass, 10 of 10 | blind grader (1x and 4x, 10 shuffled trials, answered before reading any doc); scored against a key kept outside the grader's folder. Two ne/nw guesses were right |
| 3 katana side | pass | hilt side agrees with the 3D model on 32 of 32 frames (thin at w and sw, 5 to 7 hilt px) |
| 4 no hand pixels | pass | no pixel edit, download or generated image in the scripts |
| 5 determinism | pass | runs a and b identical; a third run from another cwd and out path matches the committed sha256.txt |
| 6 pose cost | pass | one keyframe spec plus a re-render |

Findings: no Critical, no Important. Minor, left for a next commit: the two battle pose names are hard-coded in `render.py` and `sheets.mjs` as well as in `battle_specs`; the "all checker lines" column is NO on all walk frames (HL-FLAT, HL-SHOULDER, HL-HIP, PA-07, not exit lines); the Step 0 line of `rook-3d.md` says Blender 5.2.2 (Mark's machine), this box ran 4.0.2.
Exit line 7 (Mark's look gate) is not done.
