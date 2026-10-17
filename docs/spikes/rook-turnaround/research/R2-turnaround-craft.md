# R2: Turnaround craft for 32 px top-down JRPG field sprites

Research date: 2026-10-17. Scope: how pixel artists build an 8-facing turnaround from one given view, and which rules a code agent can follow and a script can check. Every claim has a source URL. **[Inference]** marks my own reasoning, not a source statement.

Source quality: Slynyrd (Raymond Schlitter), the LPC style guide, the Dead Cells postmortem (Thomas Vasseur), Brandon James Greer (via a transcript), and forum how-tos gave concrete rules. I found no primary text from Saint11, Pixel Parmesan, AdamCYounis, or MortMort on turnarounds. Their tutorials are mostly GIFs or videos that the fetch tool cannot read. I found no published character-sprite process for Sea of Stars, Chained Echoes, or Eastward. The direct-from-source rules below therefore lean on Slynyrd, LPC, and forum how-tos.

## 1. How skilled artists build the turnaround

1. **Draw the order front, then up and side, then diagonals last.** Slynyrd draws the front first, then up and side, with "the angled views last". A symmetric figure needs "only five orientations", because side and angle views flip. https://slynyrd.com/blog/2025/3/24/pixelblog-55-top-down-character-animation
2. **Rough all facings together, then measure them against each other.** Slynyrd puts rough versions of every orientation in one scene, compares measurements, and plays them as a rotation to find errors. Keep limb thickness and length the same in every facing: "one pixel can make a huge difference". (same URL)
3. **Use a dummy first.** Build a solid-color dummy body, then add costume. Slynyrd: a dummy "guarantees motion quality and anatomy clarity". https://www.slynyrd.com/blog/2025/10/2/pixelblog-58-top-down-character-animation-part-3 and https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites
4. **Use a shape skeleton.** Greer places circles over the head, hands, and feet to make a blank skeleton, and the same skeleton repeats across the roster. Chrono Trigger humans are "all around 32 pixels tall", with most sprites at "exactly 12 colors". https://sozai.app/transcript/make-chrono-trigger-sprites-pixel-art/index.md
5. **Keep the head constant and change the body.** On NESDev, kasumi keeps the head the same across directions and changes only the body. tepples finds it hard to keep all directions "in proportion and in sync" and renders 8-way Blender references to trace over. https://forums.nesdev.org/viewtopic.php?t=6703
6. **Build a diagonal from front plus side.** One RPG Maker how-to splices about half of the front frame with about 3/5 of the side frame and merges the hair halves. Then it shifts "the ears and eyes 2, 3 pixels" toward the turn, reduces the forehead from 5 to 4 px, raises both arms 1 px for depth, darkens the inner far arm, and keeps both eyes on the same row. https://forums.rpgmakerweb.com/threads/rtp-editing-make-a-diagonally-facing-sprite.27431/
7. **Mirror only when the design allows it.** Mirror is fine unless the design has "dramatic directional lighting" or an "asymmetrical design" (Slynyrd 22, URL above). Asymmetric designs need "unique frames ... for all eight orientations" (Slynyrd 55). In Slynyrd 58, the sword and shield stay in the correct hands in every facing.
8. **Head construction.** On a front head, the center line splits the nose, lips, eyes, and brows: https://finearttutorials.com/guide/loomis-method/ . "When the face is turned, this line curves". In a three-quarter view the far eye's inner corner hides behind the nose bridge: https://rapidfireart.com/2024/05/ . **[Inference]** At 32 px a curve becomes a 1 to 3 px horizontal offset of the face center column from the head's center column, toward the facing side.
9. **Projection.** The LPC guide says "top-down, roughly 60 degrees", orthographic, with no perspective. Bases are "approximately two and a half heads tall" and fit "32x48". Character outlines are "black or near black, no selective outlining". https://lpc.opengameart.org/static/LPC-Style-Guide/build/styleguide.html . In 3/4 top view, the front face is shortened, "uniformity takes priority over realism": https://www.slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1 . At small sizes the head is "a third to half of the total sprite" (Slynyrd 22).

## 2. Per facing: what repeats, shifts, and is new

Repeats in all facings: total height, head height, shoulder row, hip row, foot row, limb thickness, palette, and outline color (Slynyrd 55, LPC). Rows in the table marked **[Inference]** extend those sources. No tutorial I found gives them in this form.

| Facing | Repeats from front | Shifts | New (cannot be copied) |
|---|---|---|---|
| Down (front) | Source view | n/a | n/a |
| Down-right (3/4 front) | Eye row, head size, height | Face features 2-3 px toward the facing side (RPG Maker how-to). Far arm and far shoulder narrower, inner far arm darker (same). **[Inference]** Near eye full width, far eye 1 px narrower or partly hidden (Loomis far-eye rule, rapidfireart) | **[Inference]** One cheek and jaw edge on the far side. Side part of hair. Torso narrower by 1-3 px. Near leg forward of the far leg |
| Right (side) | Height, eye row, foot row | Width shrinks to the profile. One eye at the front edge of the head. **[Inference]** The ear moves to about the head center column | Nose or face silhouette. Back-of-head hair mass. Only one arm and one leg fully visible |
| Up-right (3/4 back) | Height, shoulder and hip rows | **[Inference]** Eyes gone, cheek or ear edge visible on the near side only | **[Inference]** Back hair mass dominant. Back of coat. Far-side shoulder blade shadow |
| Up (back) | Height, silhouette width close to the front view | **[Inference]** The hair mass covers the whole face area | Back of clothes: seams, collar back, belt back. No face |
| Left facings | Flip of the right-side facings (Slynyrd 55) | Unless the design is asymmetric or the light comes from the side (Slynyrd 22) | Asymmetric items keep their hand (Slynyrd 58) |

## 3. Light, form shadow, folds, clusters

- **One light direction for the whole set.** LPC: "Lighting should primarily come from above", with any side light from the left, "keep it mostly center" (LPC URL). pixnote: "Keep the light direction consistent within a single work (or game scene)". https://pixnote.net/en/learn/shading . Slynyrd sets the light source "at the very start". https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow
- **Tone count at 32 px.** 3 stages (highlight, base, shadow) at 32x32. Fabric gets minimal or almost no highlight (pixnote shading URL). Greer keeps skin at two tones (Greer transcript).
- **Hue-shifted ramps.** "Your light to dark color ramps should never all have the same hue". Shadows shift toward purple, highlights toward yellow. Use "No pure colors!" (LPC).
- **Shade in blocks, not texture.** LPC: "Shade in blocks", "medium-low levels of texturing", dithering "sparingly if at all". Slynyrd 58: count flickering sub-pixels as noise, "reduce colors and simplify pixel clusters".
- **Pillow shading** = shading "applied uniformly from the outline toward the center without considering a light source": https://pixnote.net/en/learn/glossary . A TU Delft thesis describes it as concentric strips that follow the outline, and defines **banding** as adjacent segments of different colors with endpoints aligned on a shared axis: https://repository.tudelft.nl/file/File_65d43acd-9779-4eab-999b-9bcd4f0a96a9 (summary from a search snippet. The full text did not load.)
- **Orphans.** A **cluster** is "a group of same-colored pixels placed together". **Noise** is "unwanted scattered pixels" (pixnote glossary). The Adopt Pixels tool defines an orphan as a pixel with fewer than N adjacent same-color pixels ("Threshold is the number of adjacent pixels of the same color required to keep the subject pixel"): https://astropulse.itch.io/adopt-pixels
- **Readability gaps.** Greer leaves "at least a one pixel Channel" between limb lines so the pose reads (Greer transcript).
- **Folds.** Folds form between a tension point (where cloth is pulled or falls) and a support point (where it hangs): https://tips.clip-studio.com/ja-jp/articles/6861?org=1 . **[Inference]** At 32 px: a flat coat panel is one base-color cluster. A fold is a single 1 px shadow stroke that runs from a support point (shoulder, belt, elbow, knee) toward the pull. It always sits on the side away from the light. Use at most 1-2 fold strokes per garment panel.

## 4. Walk cycles reuse the turnaround

- Walk: 4 frames, borrowed from the 8-frame run, without the full-stride frames, played more slowly (Slynyrd 22). Slynyrd 55 uses a 6-frame cycle: front first, then side, then up, angles last. Flipping reduces the work to five animations.
- The head bob drives the motion, for example "down 1px, down 1px, and up 2px". "The up movement is faster than the down movement" (Slynyrd 55).
- The second half of a walk mirrors the first half "with minor adjustment to account for implied perspective". Key poses: contact (lowest), down, pass (tallest), swing: https://www.slynyrd.com/blog/2024/5/24/pixelblog-50-human-walk-cycle
- Check that shoulder pivots, head bob, and maximum limb swing are the same in every facing (Slynyrd 55).
- Build in layers: animate the base body first, then add weapon, shield, and cape (Slynyrd 58). **[Inference]** For an agent: the standing turnaround frame is the contact or pass frame of each facing's walk. Generate the walk by moving the leg and arm clusters only. Keep the head cluster pixel-identical except for the bob offset.

## 5. 3D-to-pixel and part-based systems

- **Dead Cells:** a "very basic" 3DS Max model and skeleton, rendered small (characters about 50 px tall) "without antialiasing". Each frame is exported as a PNG with its normal map, then shaded with a basic toon shader. Flickering pixels were not cleaned by hand, because "the point of this workflow is to go fast": https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-
- **3D as a trace reference** (tepples, NESDev URL above). This gives the agent correct proportions per facing without having to invent them. **[Inference]** This is the strongest fix for "invents unseen views badly".
- **Outlines from geometry, not color:** use depth jumps for silhouettes and normal changes for creases, downsample on one shared grid, keep outlines 1 px, and avoid mixels: https://sozai.app/transcript/drawing-the-line-on-3d-pixel-art-pixel-perfect-transcript/index.md (creator not named)
- **Voxels:** spotvox renders MagicaVoxel .vox files to pixel art at chosen rotations: https://github.com/tommyettinger/spotvox . A Simutrans user renders 8 directions orthographic at pitch -30 degrees: https://forum.simutrans.com/index.php?msg=210686
- **LPC paper doll:** layers merge in order: https://github.com/buxx/lpcg . "Head and hand positions are the same between all body types", so hats, hair, and weapons fit every base. Rows are ordered by direction per animation: https://opengameart.org/content/lpc-character-bases . The guide orders sheets "back, left, front, right". Z-position data lives in CSV files: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator
- **RPG Maker generator:** parts are PNG layers, with offsets and palettes for recolor: https://takyrilyich.itch.io/mv-mz-character-workshop , https://store.rpgmakerofficial.com/products/male-character-generator-mz

## 6. Checklist for a code agent

| # | Rule | Facing | Script check | Source |
|---|---|---|---|---|
| T1 | Draw order: front, up, side, then diagonals. Diagonals come from front plus side, never from a flip of the front | Diagonals | Diagonal must not equal the front frame or its horizontal flip (pixel diff above a threshold) | Slynyrd 55, RPG Maker how-to |
| T2 | Total height, head height, and shoulder, hip, and foot rows are the same in all facings (±0 px standing) | All | Bounding-box top and bottom rows equal. Row of first skin pixel equal. Leg-split row equal | Slynyrd 55, NESDev kasumi |
| T3 | Limb thickness is the same in all facings | All | Run-length width of arm and leg clusters is within ±1 px of the front view | Slynyrd 55 |
| T4 | Left facings = horizontal flip of right facings, unless the design is asymmetric | Left | Exact flip equality, or an allow-list for asymmetric parts | Slynyrd 22, 55, 58 |
| T5 | Both eyes on one row | Front, 3/4 front | Eye-color pixels share a y value | RPG Maker how-to |
| T6 | 3/4 front: face features shift 2-3 px toward the facing side | 3/4 front | Mean x of eye pixels minus head-cluster center x = 2-3 px, signed toward the facing | RPG Maker how-to, Loomis curve **[Inference on px value at 32]** |
| T7 | 3/4 front: far eye narrower or partly hidden. Far arm narrower and darker on its inner side | 3/4 front | Far-eye pixel count < near-eye pixel count. Shadow ratio on the far arm > near arm | rapidfireart, RPG Maker how-to |
| T8 | Side: one eye. Back and 3/4 back: no eye pixels | Side, back, 3/4 back | Count eye-color clusters: 1, 0, 0 | **[Inference]** from the facing geometry |
| T9 | Outline is 1 px, black or near black, unbroken around the silhouette | All | Every opaque pixel 4-adjacent to transparency is in the outline set (luminance < threshold). Outline width 1 | LPC, geometry-outline transcript |
| T10 | One light direction (top, slightly left) for every facing | All | Lit-side luminance > shadow-side luminance on each major cluster, with the same sign in all 8 facings | LPC, pixnote, Slynyrd 6 |
| T11 | No pillow shading | All | Correlation of shade level with distance-to-outline (high = pillow) vs with the light vector (should dominate) | pixnote glossary, TU Delft |
| T12 | No banding: two ramp colors do not run parallel with aligned ends | All | Find adjacent same-length runs of two colors with endpoints on the same axis | TU Delft, pixnote |
| T13 | No orphans inside the sprite | All | Count interior pixels with 0 same-color 4-neighbors (exclude deliberate highlights and eyes) | Adopt Pixels, pixnote |
| T14 | Flat panels stay flat: about 3 tones at 32 px, block shading, little or no dither | All | Per garment region: ≤3 distinct colors, no checkerboard 2x2 patterns, color-change count below a cap | pixnote shading, LPC, Slynyrd 58 |
| T15 | Folds: at most 1-2 one-pixel shadow strokes per panel, from a support point, on the shadow side | All | Stroke count per region. Strokes start next to a joint row. Stroke side matches T10 | Clip Studio **[Inference for px rules]** |
| T16 | Palette is fixed: one ramp set for all facings, about 12 colors, hue-shifted ramps | All | Union of colors in all facings ⊆ master palette. Count ≤ cap. Ramp hues not all equal | Greer, LPC |
| T17 | One-pixel gap between limbs and body where the pose allows | Side, diagonals | Check for a background or outline channel between arm and torso clusters | Greer |
| T18 | Head cluster constant across walk frames, except for the bob | All walk | Head pixels equal after a vertical offset. Offset pattern is about -1, -1, +2 | NESDev kasumi, Slynyrd 55 |
| T19 | Walk reuses the turnaround: standing frame = contact or pass pose. Second half mirrors the first | All walk | Frame k+n/2 ≈ leg-swapped frame k | Slynyrd 50 |
| T20 | Prefer a 3D or voxel reference render per facing, then hand-clean to the rules above | Unseen facings | Diff the agent frame silhouette against a reference render mask (IoU ≥ threshold) | Dead Cells, NESDev tepples, spotvox **[Inference: grading by IoU]** |

## 7. Suggested agent procedure for one new facing [Inference, built from sections 1-6]

1. Load the master palette, the row guide (head top, eye row, shoulder, hip, foot), and the light vector from the front frame. Do not change them.
2. Build the dummy first: head, torso, arms, and legs as solid blocks at the row guide. Use a 3D or voxel reference silhouette for this facing if one exists (T20).
3. Place the head cluster. Copy its size from the front frame. Shift the face features per section 2 (T5 to T8).
4. Fill the silhouette from known parts: the near half from the side view and the far half from the front view, for diagonals (RPG Maker how-to).
5. Put on the costume as flat base clusters, one color per panel.
6. Add shadow only on the side away from the light. Add at most 1-2 fold strokes per panel (T10, T14, T15).
7. Draw the 1 px near-black outline last (T9).
8. Run T2 to T17 as a script. Fix failures, and only then compare against the other facings in a rotation strip (Slynyrd 55).
9. Derive walk frames from this frame (T18, T19).

## 8. Gaps

- No source gives per-facing pixel offsets for hair, ear, and nose at 32 px, except the RPG Maker 2-3 px figure. Rows T6 to T8 extend it by inference. Test them against reference sprites.
- Saint11's "Fabric", "Outlines", and "Top Down Tricks" tutorials exist only as GIFs (https://saint11.art/blog/pixel-art-tutorials/). Read them by eye to check T14 and T15.
- PixelJoint's "Things to avoid" tutorial (bad AA, jaggies, banding, pillow-shading, noise, sel-out) returned 403 and an unreadable mirror. Its glossary terms came from pixnote instead.
