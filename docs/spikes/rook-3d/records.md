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
