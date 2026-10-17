# Art pipeline plan: from "copies exactly" to "draws a facing with no picture" (Fable consult, 2026-10-17)

Inputs: `../rook-turnaround.md`, `records.md`, `head-test-plan.md`, `target.json`, the character pack. A design consult, no code. Spike rules hold: zero Sprite Fusion credits, no image generation, no third-party sprites, draft PR never merged. Terms a designer may not know are in the glossary at the end.

**What the numbers say.** Copy from a 32x grid: 99.6 percent exact in one round at Level 0 (`records.md`, step 3b). Invent four facings from the given frame and thumbnails: round 8 had detail about an order of magnitude low (1-2 px regions 4 to 9 against 60 to 72), and Mark said "not close". The medium (letter grid), the renderer and the checker work. The gap is invention. So the pipeline turns invention into three smaller jobs: **copy** cells that exist in the given frame, **transform** cells that a rule derives from it (mirror, fuse, shift), and **invent** only the cells that are left, inside a part map, a ramp lock, a motif rule and a frozen feature list. Every picture is split into these three classes before a writer runs. The split is printed on the writer's sheet and the grader's sheet, and the invented share is recorded per facing.

**Amendments to the spike doc (Mark must approve, see question 5).** (a) Work runs per facing in a set order, not all facings per round (step 3 says one round works on all open facings). The cap stays 3 rounds per facing, so 12 rounds in all, the same total. (b) The hard line "head width within 1 px" uses `headWidth` 19, which includes the katana hilt. On up and right the hilt leaves the head rows, so a correct facing would fail it (`records.md`, step 3 round 5: right 17). This plan gates on the head alone (section 1, stage B).

## 1. Pipeline for sprites (8 facings)

**Step 0, tool build (lean loop).** One builder writes the scripts for stages A to C (part map, masks, classify, overlay), the head-alone width metric, the walk metrics (bottom-row sequence, bob sequence), a planted-foot finder (`records.md` notes that PA-10 has none), and the region-blank scorer for section 6. Then the lean loop: a runner and a reader, at most 3 rounds. Every hard line gets a fail-path test: a mutation of the input (a wrong part, a flat texture, a shifted foot, a mask hole) must fail a named test. The reader checks that no test passes by construction.

| Stage | Who | What happens | Reference or target (no Sprite Fusion output) |
|---|---|---|---|
| A. Decompose the given frame | script, then one Sonnet author | A part map of the given frame (hair, face skin, lenses, beard, coat, sleeves, zipper strip, hands, legs, boots, sheath, guard, wrap). A ramp lock per part (`families.json` already does this). Motif rules per part measured from the given: hair = letters `p m t`, runs at most 3, T about 1.3; coat = ramp order and the band shape; outline = which near-black letter sits where (selout). A frozen feature list per facing, as `features.md` was for the head. | The given frame itself. Every number is measured, not written from memory. |
| B. Derive the silhouette target per facing | script | **down:** the given silhouette made symmetric about the body axis, row by row, with the hair wing and the sheath taken out. **up:** the same mask (JRPG convention: back and front share the silhouette) plus a sheath band rule: a straight 2 px diagonal from the shoulder cell to the hem cell. **up-right:** the given silhouette minus the sheath and the hair wing (an object seen from the opposite side has the mirrored silhouette, so up-left = mirror of the given, up-right = the given). **right:** no mirror rule exists. Proxy: the battle idle (79x68, facing right) reduced to body height 31 by area average and a 50 percent alpha threshold, used only for the head profile, the hair line and the coat length. Row widths at the landmarks (head, shoulder, hem, feet) come from the given with a ±2 px band. | The given frame, its mirror, and Mark's own battle idle. Height 31, bottom row 30. **Head width is the head alone: 13 to 14 px in the given (x11 to 24, `records.md` step 3 round 3), pass 12 to 15 on every facing.** `headWidth` 19 in `target.json` includes the hilt and is not the target for up and right. Masks are written to `target.json` before any writer runs. |
| C. Classify cells | script | Each cell of a mask is **copy** (the same cell in the given or its mirror has the same part), **transform** (a fuse seam, a shifted part, a sheath band) or **invent** (back of the hair, back of the coat, the side face). Expected invented share (estimates, not measured): down about 15 percent, up about 55 percent, up-right about 45 percent, right about 70 percent. The script measures the real share. | Printed as a colored overlay on the mask. Recorded per facing. |
| D. Write | 3 Sonnet writers in round 1, then 1 | The letter-grid medium from the head test. The writer sees: the legend, the given at 32x with grid plus the five separations, the mirror of the given at 32x, the mask at 32x with the copy / transform / invent overlay, the part map with each part's family and motif rule, the frozen feature list, and (right only) the battle idle at 4x and the proxy outline. It never reads pixel values. Order: copy cells first (the render script reports their exact match live, because a key exists for them), transform cells next, invent cells last by motif rule, then the run-count self-check. Round 1 votes per cell on copy and transform cells only. Invent cells come whole from the best writer. | Copy and transform cells have an exact key. Invent cells have the rules and the feature list. |
| E. Check | script | The head-test bands per facing (T, S, D, orphans, outline at least 93 percent, palette, colors, value histogram) measured against the given's **same part regions**. Ramp lock: a part's cells use only its family plus near-black. Family shares with a facing-specific expectation (up has zero skin). Silhouette IoU against the stage B mask. Exact match on copy and transform cells. PA-06, PA-07, PA-08 across the set. Sheath side. | `target.json` and the stage A part map. The checker gates. It never passes a facing alone. |
| F. Grade | 2 Sonnet graders plus 1 holdout | G1: feature list and the numbers. G2: blind same-character pair at 4x and 16x, triplet rank (given, candidate, round 8 facing), anchor score against the given. Both see the given beside the candidate on every sheet. Neither sees the previous round or the writer's notes. The previous round answers only "did it improve" as a separate line. Both walk the pack's eye checks in full, including PA-15 (jaggies at 8x, list each bump with x,y) and PA-22 (guide rows at head top, shoulder, belt, knee and feet, each within 1 px of the same row in every facing). **Rule: a view change never excuses a missing feature or a lower score.** A feature that the given shows and the new view still shows must be present. A hidden feature is replaced by the back or side feature on the list. A score under 8 against the given fails, whatever the view. | PA-CM-01: a pass is a score against the target, never against the last round. |
| G. Mirror and patch | script, then 1 writer | left, down-left, up-left by `turnaround.mjs`. The sheath moves to the wrong shoulder on each mirror. Option 1: a named region patch, the sheath band transformed back to Rook's left shoulder (an estimate of 12 to 20 cells). Option 2: accept the mirror lie. Mark decides. | The given's sheath cells. |
| H. Mark's blind review | Mark | Step 4 of the spike as written: 1x and 4x, random order, decoys, Lantern Row. | The three GO questions. |

Order: down, then up, then up-right, then right. A facing starts when the one before passes. **A cap hit on any new facing is a NO-GO under the spike exit criteria** ("any new facing fails ... after the caps"). The plan stops at the first cap hit, records the evidence, and Mark decides whether more work continues outside the GO test. A cap hit on **down** also means the scaffold does not work: down is the most-copied facing.

## 2. Animations

- **Field idle.** One frame per facing: the standing frame. No new work. The battle idle is already Sprite Fusion art.
- **Walk, down-right and down-left.** The given walk sheet as is, and its mirror.
- **Walk, down (front).** Frame k = fuse of walk frame k and the mirror of walk frame (k+4) mod 8. The mirror of the opposite-phase frame has the same limb phase in picture space, so each half is a copy and only the seam column is invented. Target: the given walk's bottom-row sequence, planted-foot shift at most 1 px per frame, and the head-bob row sequence (a triangle wave, PA-24), all measured on the given sheet first.
- **Walk, up and up-right.** Frame k = the facing's standing frame above the belt, plus the given walk's frame k delta below the belt (legs, hem, boots look the same from the back; up uses the mirror-fused delta), plus the arm swing cells recolored to the back recipe. Copy and transform only, no invent cells beyond the arm patch.
- **Walk, right (side).** Invention. Four key poses (contact, down, pass, swing) over 8 frames, with the given walk's bob and bottom-row sequences as the numeric target, limb length constant ±1 px, and a 3-loop strip at 8 fps for the graders. This is the first cut (section 7).

## 3. Tiles: proposed for E1, not in this spike

The spike doc says the tiles pack is not used here, and no tile style target exists yet. So tiles leave this spike. They are proposed for E1. The first E1 step is to measure the crew sheets' texture: T, S and orphan counts per ramp, and the ramp hue shift per step. The tile bands come from those measures, not from the pack's absolute numbers. TA-08 (at most 6 single pixels per 16x16 tile) must be relaxed to the measured reference density. Left as written it pushes toward Flattening (PA-CM-01). TA-05 and TA-11 stay as written. The rest of the tile plan (palette, 16x16 writer medium, early test, order) is written in E1, from those measures.

## 4. Pass lines (written before the work)

| Step | Script line | Grader line |
|---|---|---|
| Tools | Every hard line has a fail-path test. Runner passes, reader passes, at most 3 rounds. | Reader: no test passes by construction. |
| A, B, C | Every opaque pixel of the given is in exactly one part. Motif numbers re-measure the given's T, S, D per part within 5 percent. Masks: height 31, bottom row 30, head alone in 12 to 15. | One Haiku reader checks the feature lists against the given sheet: every cell reference is real. |
| D, E, F per facing | Copy and transform cells exact at least 95 percent. IoU against the mask at least the number in the IoU table below. Ramp lock 100 percent. **T 0.8x to 1.2x, S 0.8x to 1.3x, D ±0.08, orphans 0.7x to 1.5x** of the same part regions in the given. The pack calls detail density under 0.8x a Major (Flattening), so no band passes below it. Outline at least 93 percent. PA-07 and PA-08 pass across the set. | Every MUST feature present per both graders. Anchor at least 8 from G2 and from the holdout. Candidate beats the round 8 facing in every triplet. No unanimous "different character" at 4x. PA-15 and PA-22 walked. Cap 3 rounds per facing. Plateau: a round that gains under 3 points of exact match on copy cells or that loses a MUST feature. |
| G mirrors | Pixel-exact mirror. Sheath centroid on Rook's left in every facing after the patch. | Mark decides option 1 or 2. |
| Walks | PA-10 bottom row within 2 px, planted foot at most 1 px per frame, bob sequence equal to the given walk's, limb lengths ±1 px, copy cells at least 95 percent where a key exists. | PA-24 on a 3-loop strip at 8 fps, beside the given walk strip. Anchor at least 8. |
| Whole spike | The exit criteria in `../rook-turnaround.md`, with the two amendments above if Mark approves. | Mark, blind, with the agreement count. |

**IoU pass numbers (one table, all estimates except the baselines).** Baselines: rig v2 Rook against the given frame 0.64 to 0.71, and the best step 2 grid 0.76 (`records.md`, step 2). The lines below are set above those baselines and are not measured on a hand-made facing.

| Facing | Down | Up | Up-right | Right | Head box (section 6) |
|---|---|---|---|---|---|
| IoU at least | 0.90 | 0.85 | 0.85 | 0.80 | 0.85 |

## 5. Seats and models

| Seat | Model, effort | Why |
|---|---|---|
| Tool builder, runner, reader | Sonnet, high | Lean loop, step 0. |
| Decompose, masks, classify, render, check, vote, sheets | scripts, no model | Deterministic. The head-test tools already do most of it. |
| Feature list and motif rule author (once per facing, may read the letter grid) | Sonnet, high | Writes cell references. Frozen before round 1. |
| Feature list reader | Haiku, low | Checks that every referenced cell exists in the given. |
| Writers (3 in round 1, 1 after) | Sonnet, high | The head test proved the perception at this seat. |
| G1 (features and numbers), G2 (blind pick, triplet, anchor), holdout | Sonnet, medium | The protocol carries them: target beside the candidate, numbers printed, fixed list. |
| Isolation checks on transcripts | Haiku, low | Mechanical. |
| Orchestrator | the main session | Decisions, commits, Mark's sheets. |

No seat needs a model above Sonnet by design. One conditional seat: if the early tests (section 6) fail on Sonnet with the IoU and ramp lock passing but the graders failing, the fault is perception of form, not process. Then ask Mark for **one Opus writer round** on the same scaffold. A Sonnet fail and an Opus pass is a cheap, decisive result. A fail on both means the scaffold is wrong, and the model does not matter.

## 6. The early cheap tests

**6a. Held-out invention test (the only test with known truth).** Take the given frame and blank one region of it: the hair wing, then one coat region (a second run), each about the size of a real invent region (an estimate; name the boxes in `target.json` first). Stage A measures its rules from the cells that remain, and never from the blanked region. Writers get the given with the region masked, the mask of the region, the rules, and the feature list for it. They invent the region from the plan's rules alone, at Level 0, 3 writers, one round plus one fix round. The scorer compares with the real pixels, inside the region only.

**Pass:** exact match at least 60 percent in round 1 at Level 0 (the head-test line for the turnaround), ramp-tolerant at least 80 percent (an estimate), the section 4 bands pass on the region (T and S at least 0.8x), every MUST present per both graders, G2 anchor at least 8 against the given. **FAIL means:** the rules do not carry enough information to invent, so the invent cells of up, up-right and right will fail, and nothing else in this section is worth running. Run 6a before 6b, or together with it.

**6b. The back of the head.** The smallest picture with zero copy cells and full rules: the **up** facing's head box (x10 to 25, y0 to 13), about 170 opaque cells, the same box and the same tools as the head test. The mask is the given head silhouette made symmetric, without the hair wing and the hilt. Rules: hair letters `p m t` only, runs at most 3, no skin and no orange, the crown highlight on the same lit side as the given (PA-23), one interior line between the hair and the collar, a closed outline, the sheath top as a rule-placed 2 px cluster over the shoulder. The writer sees the given head at 32x with its separations, the mirror, the mask, the motif rules and the feature list. Three Sonnet writers at high, Level 0 (no cell mask exists, by definition), one round plus one fix round.

**Pass:** IoU at least 0.85 against the mask, ramp lock 100 percent, T 0.8x to 1.2x and S 0.8x to 1.3x of the given hair region, orphans 0.7x to 1.5x, D ±0.08, outline at least 93 percent, head alone 12 to 15 px, every MUST present per both graders, G2 anchor at least 8 with the given beside it, the candidate beats the round 8 up head in the triplet, no unanimous "different character" at 4x. Then one question to Mark at 4x: "same character?" 6b has no ground truth, so 6a decides whether its pass means anything.

**FAIL (either test) means:** writers cannot invent inside rules even for the easiest invented region, where the texture rule is one line. The plan keeps only the copy and transform constructions (down by fuse, the down and down-left walks, the mirrors) and drops stages for up, up-right and right. The three facings go back to Mark's #110 options (rig v2, or Sprite Fusion walks outside this spike, 15 credits per facing). A PASS proves the mechanism, not the right facing: right has its own proxy and its own lower IoU line.

## 7. Risks, and what to cut first

Risks: the symmetric-silhouette rule ignores the camera tilt (a back view shows more crown and less face and feet), so the mask carries a lower IoU line for up and the feature list decides. The side proxy comes from a battle stance with the legs apart, so it informs the head and the coat only. Random speckle can pass every band, so the checker never passes a facing alone. Grader agreement with Mark is unknown, so Mark stays the gate until the 10-pick count says otherwise. The per-cell vote on invented cells could stitch broken clusters, so invented cells come whole from one writer. The sheath in the back views is longer than any sheath cells in the given, so it is a rule, not a copy.

Cut in this order: (1) the side walk; (2) the side facing (ship 6 directions, or one Sprite Fusion side walk by Mark's decision, outside the spike); (3) the sheath patch on mirrors (accept the mirror lie); (4) up-right and up-left (ship 4 directions plus the two given diagonals). Any cut of a new facing is a NO-GO under the spike exit criteria, so a cut is Mark's call. Tiles are already out (section 3).

## 8. Open questions for Mark

1. Sheath on the mirrored facings: patch it back to the left shoulder, or accept the mirror lie?
2. If the side proxy fails, is one Sprite Fusion side walk (15 credits, outside the spike) acceptable, or does the game ship 6 directions?
3. Is a one-frame field idle (the standing frame) acceptable for the alpha?
4. Tiles: are they proposed for E1 only, with the first step to measure the crew sheets' texture and relax TA-08 to that density?
5. Do you approve the two amendments to the spike doc: per-facing work in a set order (same 12-round total), and a head-alone width gate in place of `headWidth` 19 for up and right?

## Glossary

- **IoU (intersection over union):** the overlap of two silhouettes. Shared opaque cells divided by all cells that either has. 1.0 is identical.
- **Ramp, ramp lock:** a ramp is the set of colors for one material, dark to light. A ramp lock means a part may use only its own ramp plus near-black.
- **T:** color changes per opaque pixel. How often neighbor colors differ. Low T means flat.
- **S:** the share of opaque pixels that sit in 1-2 px regions (luminance-step definition, PA-09). High S means fine texture.
- **D:** the share of interior pixels that are near-black. Shows interior lines and outline weight.
- **Orphan:** an opaque pixel with no same-color neighbor.
- **Level 0 / Level 1:** Level 0 gives the writer only scores. Level 1 also shows which cells are wrong.
- **Flattening:** the pack's anti-pattern: detail well under the reference. Under 0.8x is a Major.
- **Selout:** selective outline. The outline color changes with the light instead of being one flat dark.
- **Motif rule:** a short written rule for a texture, for example "hair uses three grays, runs of at most 3".
- **Part map, mask:** the part map labels each given pixel with a part. A mask is the target silhouette of a new facing.
- **Mirror lie:** a mirrored facing puts the sheath on the wrong shoulder.
- **Anchor score:** a grader score of the work against the reference, on a 0 to 10 scale. Under 8 fails.
