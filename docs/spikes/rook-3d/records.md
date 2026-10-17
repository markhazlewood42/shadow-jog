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
