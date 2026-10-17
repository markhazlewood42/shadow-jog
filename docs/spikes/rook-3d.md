# Spike: Rook from a model (3D rendered to pixel sprites)

Branch `spike/rook-3d`, draft PR, never merged. Rules for spikes: `docs/spikes/README.md`. Brief: option B and "Spike" in `docs/spikes/rook-turnaround/research/R4-3d-pixel-pivot.md`. The branch starts from `spike/rook-turnaround` (commit 63aa88a). Mark approved this spike on 2026-10-17.

## Question
Can a script-built low-poly Rook model, rendered offline in Blender at 8 facings and 32x32, give sprites that pass the hard lines of the current checker and that Mark accepts as "the same character, pixel art" next to the PixelLab tiles?

## Why now
Weeks of hand-drawn facings (spike `rook-turnaround`) did not reach the Sprite Fusion bar. A model turned 45 degrees is still the same model, so facings, walk frames and battle poses come by construction. If the look passes, E1 can plan the character art on models. If it fails, the answer is "stay with pure 2D" and the cost was one spike, not a rewrite.

## Time box
Closes **2026-10-24**. Round cap: **3 build rounds** (a round is one change, one render, one checker run, one record).

## Terms
- **Given frame:** walk frame 4 of `spritefusion-tests/rook-overworld-walk.zip` (named in `docs/spikes/rook-turnaround/target.json`). Facing se, 32x32.
- **Walk palette:** the 22 opaque colors in `target.json`. **Near-black:** the 7 colors in `target.json` `nearBlack`.
- **Facings:** n, ne, e, se, s, sw, w, nw. Camera yaw steps by 45 degrees. se is the given facing.
- **Checker:** `scripts/art/v2/grade/hardlines.mjs` (`checkHardLines`, which runs the `pixlint.mjs` lines), with the part labels of the render's own part-ID pass.

## Exit criteria (written before any spike code, dated 2026-10-17)

**GO if all of these hold:**

1. **Hard lines, every frame (all 8 facings, 4 walk frames each, and the 2 battle poses at their own size).** The checker numbers go to `docs/spikes/rook-3d/records.md`.
   - Walk palette only (battle poses: the palette of the battle idle, `target.json` `battleIdle.palette`). No half-transparent pixel.
   - Outline near-black on at least 93 percent of edge pixels.
   - Body height 31 plus or minus 1. Bottom row 30. (32x32 frames.)
   - Head alone 13 to 15 px.
2. **Facing ID.** A blind grader that sees one frame at 1x and 4x without a label names the facing correctly for 9 of 10 trials.
3. **Katana side.** The katana sits on the same body side (Rook's left hip, as the given) in all 8 facings. A mirror error fails.
4. **No hand pixels.** No frame needs a hand pixel edit. All frames come from the scripts in `scripts/art/rook3d/`.
5. **Determinism.** A re-run gives byte-identical PNGs (hash compare, recorded).
6. **Cost of the next pose.** A new pose is a new motion (keyframes in code) plus a re-render. No drawing. Shown by the walk and attack poses made this way.
7. **Mark's gate (the real answer).** Mark sees the 8 facings and the walk at 1x and 4x on a Lantern Row screenshot, beside the Sprite Fusion given frame and rig v2. He answers two questions: "same character in all 8, yes or no" and "would you ship this look next to the PixelLab tiles, yes or no". Both must be yes.

**NO-GO if any of these holds:**

- Any hard line, facing ID, katana side or determinism line fails after the 3 build rounds.
- **Kill line.** After one texture round, Mark says "this reads as 3D, not pixel art" at 1x. The answer is then "stay with pure 2D" (Sprite Fusion and path C as the sources).
- A frame needs a hand pixel edit to pass.

**Anything else** (the box closes first) is NO-GO or ABANDONED. Mark makes that call. A pass on structure and a fail on look leads to H2 in R4 (structure from 3D, texture from code) as a new spike.

## Rules for this spike

- **Isolation.** The builder never reads `spritefusion-tests/rook-8d-ref/` or `scripts/art/v2/grade/refs/`. The checker code may. The model is made from the given frame, the battle idle and `target.json` only.
- **Assets.** Zero Sprite Fusion credits. No image generation. No third-party sprites. No downloaded character model. No Mixamo files (its license forbids sharing raw files and this repo is public). Motions are keyframes written in the scripts, or CC0 (Quaternius).
- **Blender.** Step 0 result: Blender 5.2.2 LTS runs headless on the machine of this session (Windows 11, `blender.exe --background`). That machine is Mark's, not a cloud sandbox, so "Blender in the cloud" is not answered here.
- **Lean loop.** One fresh verifier (Sonnet) grades the hard lines and the determinism claim before the last push. Critical and Important findings get one fix round.

## Steps
0. Get a headless Blender. Done (see above).
1. This file, committed and pushed before any code.
2. Build in `scripts/art/rook3d/`: the model, a rig and motions, the 8-facing renderer (orthographic, the given's camera, 3-step toon light from the top, 1 px near-black outline, palette quantize), the sheet writer, the checker run.
3. Records in `docs/spikes/rook-3d/records.md`, one short table per round.
4. Outputs: per-facing sheets (the existing `metadata.json` sheet format), 8x previews and a contact sheet with the given beside the 8 facings, in `docs/spikes/rook-3d/out/` (small PNGs, committed).

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes:
