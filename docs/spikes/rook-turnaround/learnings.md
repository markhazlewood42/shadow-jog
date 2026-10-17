---
type: spike-record
title: "Rook turnaround: learnings, steps 2 to 6a"
---

# Rook turnaround: learnings, steps 2 to 6a

Spike doc: `../rook-turnaround.md`. Numbers: `records.md` (cited by step). Plans: `head-test-plan.md`, `art-pipeline-plan.md`. Target data: `target.json`. Written 2026-10-17 for an independent consultant who designs a v2 algorithm and strategy from this file alone.

## Summary
- Copying one head from pictures worked: 99.6 percent exact in one round with no cell feedback. It is one head of one character (step 3b).
- Invention from rules fails. The best held-out result is 58.7 percent exact on the coat and 49.4 on the hair wing (step 6a).
- The stage-by-stage build (step 3) also failed against the target. Mark stopped it at round 8 as "not close".
- Hypothesis: the gap is information about structure, not drawing precision. The consult should test this.
- The pipeline will grow, so this file tags each learning as [general] or [Rook-specific].

## Scope (Mark, 2026-10-17)
- The art pipeline will grow to more poses, more characters and more animations. Map tiles come after that, as a new phase.
- Mark, in chat, 2026-10-17: "We're building a very advanced skillset here."
- Mark, in chat, 2026-10-17, second note:
  - A better overall approach is welcome. It may use less procedural code and better LLM instructions.
  - Research how Sprite Fusion does it: a trained model, or prompting of an off-the-shelf model.
  - Treat this as a big research project. Research with higher models, build with lower models (Sonnet, Haiku), and verify with expert persona packs.
  - Opus is standing-approved for research and consult agents on this art project. Fable needs approval for each dispatch. Builders stay on Sonnet or Haiku.
- A learning tagged [general] should hold for any character, pose, animation or tile. A learning tagged [Rook-specific] holds only for this character, his one given frame or his palette.
- A tag is a judgment, not a measurement. The consult should challenge each tag.

## What worked
- [general] A pixel grid with the kit's primitives beat a height-map medium. Medium A won 6 of 6 grader picks over medium B across 3 rounds (step 2). Medium B produced an egg-shaped blob with no neck, legs or hands.
- [general] The step 3b head test used a different medium: a text grid of palette letters, with no primitives. Do not read the step 2 win as a win for the letter grid.
- [general] Copying one head from pictures worked. Level 0 (scores only, no cell feedback), 3 Sonnet writers, one round: 99.6 percent exact (223 of 224 cells) and 99.6 ramp-tolerant. Baselines: flattened head 31.3 exact, round 8 head 23.2, all-transparent 23.2 (step 3b).
- [general] The evidence is one head, one character, one round, with 3 byte-identical grids. It does not show that copy works for a full facing or a new character. The step 3b record says the step 3 gap is not medium precision: it comes from facings that have no reference picture.
- [general] The writer used 1 or 2 renders and still passed. All head-mode bands passed. Colors were 15, the same as the reference (step 3b).
- [general] A per-cell vote across 3 or more writers is cheap. The 3 grids were byte-identical in the head test, so the vote added nothing there (step 3b).
- [general] A copy tripwire exists (void line 60 percent). Rig v2 down and Hex walk frame 0 matched 0 percent of the given frame by construction (no shared color), so it is untested against a real copy (step 2).
- [general] The checker finds real faults early. It gates palette, half-transparent pixels, outline, head width and detail bands. In step 3, PA-08 (shared colors across facings) stayed at 100 percent in rounds 5 to 8.
- [general] The independent isolation check works. A reader agent (Haiku in step 3b) scans writer transcripts (`subagents/agent-<id>.jsonl`) for reads of hidden files. All writers were clean in step 2, step 3 and step 3b. The 6a kit also scans every kit file for hidden cells at the true and the mirrored place (step 6a kit).
- [general] Mutation and paste attacks find kit leaks. The 6a kit had a Critical leak: `rules.txt` gave part shares from inside the hidden box (K1). A fresh verifier found it (step 6a kit, round 1).
- [general method, Rook numbers] Copy and transform cells exist for some facings. The method (split each picture into copy, transform and invent cells) is general. The measured split of the given (432 opaque cells, 13 parts) is Rook's and is below under Measurement facts (step 4-0).
- Step 3b, grader limit: G2 got the blind pair 1 of 2 correct, and its strap fault is not on the sheets, because the heads differ in one cell (step 3b).

## What failed and why

### Step 3 (stage-by-stage turnaround, 8 rounds)
- [general] Result: the set was "not close" to the Sprite Fusion target. Detail was about an order of magnitude low: 1-2 px regions 4 to 9 against 60 to 72 in the walk frames (spike doc, step 3; round 8).
- [general] Graders judged stage deltas and picks against the previous round. No verdict measured the distance to the given frame. Both graders passed stage 4 on three facings (step 3, round 8; pack item PA-CM-01).
- [general] The earlier packs pushed toward flat shapes ("large clusters", "no noise"). The Sprite Fusion style is high frequency, so that noise is the target. The pack now has a Flattening anti-pattern: a Major under 0.8 times the reference density (pack, Flattening; `head-test-plan.md`, section 1).
- [general] The head-test diagnosis names bandwidth as the primary fault. The head alone has about 80 same-color clusters. A loop that changes at most 4 named regions per round cannot add about 100 details per facing (`head-test-plan.md`, section 1).
- [general] Two graders on one model with one brief are one grader twice. Their errors correlate (`head-test-plan.md`, section 1).
- [Rook-specific] Stage 1 to 3 faults recurred in the same places: the katana read as a bow, a horn or a floating block; the hands stayed plain blocks; the up-right facing was a near copy of up (step 3, rounds 1 to 5).
- [Rook-specific] A mis-measure caused a wrong fix. The head width counted the hilt, so a writer widened a correct head (step 3, round 3).

### Step 6a (held-out invention test)
Setup: 3 Sonnet writers per box, Level 0, one round plus one fix round with scores only. Pass lines: exact 60 or more, tolerant 80 or more, bands pass (step 6a).
- [general] Hair wing exact: 42.9, 49.4, 49.4 in round 1 and 45.5, 49.4, 49.4 in round 2. The fix round did not move exact (step 6a).
- [general] Coat exact: 46.7, 41.3, 40.0 in round 1 and 58.7, 56.0, 41.3 in round 2. No writer reached tolerant 80 (step 6a).
- [general] The bands flipped between too much and too little texture. Hair round 1: w1 and w3 failed S. Hair round 2: all failed S and orphans (texture overcorrected). Coat round 1: T and S too high. Coat round 2: S and orphans too low (step 6a).
- [Rook-specific] Hair writers drew a front-facing symmetric face from the mirror. The real frame is a three-quarter view (step 6a).
- [Rook-specific] Kit fact (6a kit files, not in records.md): `boxkit.mjs` sets `AXIS = 35` (mirror axis x17.5), and `target.json` line 914 holds the same axis. `heldout.mjs` line 151 tells writers the character is "close to left-right symmetric about the line between columns 17 and 18". The part map in `target.json` puts skin at x19 and x20 between the two lens groups, so the face axis is near x19.5 (inference; not yet in `target.json`). The hair box x11..17 mirrors onto x18..24, the face side. This is a likely kit cause of the symmetric faces.
- Orchestrator observation (6a transcripts, not in records.md): one writer found the face axis only in the fix round.
- [Rook-specific] The real coat is flat panels. Writers speckled it (step 6a, coat round 1).
- [general] Graders never ran in 6a, because the checker gates first (step 6a). The consult has no grader evidence on invented regions.

### Causes
Each cause below is a reading of the records, not a proven fact. See Hypotheses.
- Information. Rules describe texture statistics. They do not say where structure sits (view angle, face axis, light side, fold and shadow placement).
- Grading. Stage-relative verdicts hid the distance to the target (step 3). The exact line may be too strict for invention (see Hypotheses).
- Process. Level 0 score feedback teaches texture, not placement. The fix round traded one band for the other.
- Tools. The bands are over-sensitive on boxes of 75 to 77 cells (hairWing 77 cells, 67 opaque; coat 75 cells, all opaque). One stray pixel can flip a band (hypothesis from the band flips).

## Measurement facts
Source: step 4-0 and step 6a unless noted.

| Mask | Height, bottom | Head alone | Copy / transform / invent | Invented share (plan estimate) |
|---|---|---|---|---|
| down | 31, 30 | 14 | 194 / 194 / 28 | 6.7 (15) |
| up | 31, 30 | 14 | 21 / 43 / 352 | 84.6 (55) |
| up-right | 31, 30 | 13 | 44 / 87 / 253 | 65.9 (45) |
| right (proxy) | 31, 30 | 19 | 0 / 0 / 501 | 100 (70) |

- [Rook-specific] Down came out lower than the plan estimate (6.7 against 15). Up, up-right and right came out much higher (84.6 against 55, 65.9 against 45, 100 against 70).
- [Rook-specific] Hair runs reach 4. The plan says 3. The rule data uses 4 (step 4-0).
- [Rook-specific] The right proxy from the battle idle FAILS 4 lines: head alone 19, and the landmarks shoulder, hem and feet. It is not a usable target. No side reference exists (step 4-0).
- [Rook-specific] The given frame (steps 0 and 1; step 4-0):
  - 432 opaque cells and 22 colors.
  - 32 orphans and 66 small regions (PA-09 definition; same-color components give 108 to 132).
  - Outline 96.81 percent.
  - Head alone 14 px (x11 to 24). Head width 19 with the hilt.
  - Walk frames: outline 94.44 to 100 percent, 22 to 35 orphans, 60 to 72 small regions.
- [Rook-specific] The head of the given (`head-test-plan.md`, calibration table):
  - 172 opaque cells in 224, and 15 colors.
  - T 1.27, S 0.37, and 7 orphans.
  - Hair has 12 to 17 color runs in 13 to 17 pixels on rows 3 to 9.
- [Rook-specific] Walk: bottom row 30 on all 8 frames, bob 8 9 8 7 8 9 8 7, planted foot shift at most 1 px (step 4-0).
- [general] Exact and tolerant in 6a count all cells in the box, including transparent cells. The hair box has 77 cells and 67 opaque. The coat box has 75 cells and all are opaque (step 6a). A mostly transparent box would inflate exact (inference).
- [Rook-specific] The 6a boxes: hairWing x11..17, y0..10 (67 opaque, 45 hair) and coat x13..17, y11..25 (75 opaque, 67 coat). A band with a reference of 0 allows 0 to one unit (step 4-0).
- [Rook-specific] The rig v2 IoU against the given frame: down 0.710, right 0.636, up 0.713, left 0.638. Step 2 writer A reached IoU 0.759 to 0.762. Writer B reached 0.664 to 0.706 (step 2).

## Grading learnings
- [general] A stage pass is not a distance to the target. Every verdict must also score the work against the reference. A score under 8 against the reference fails, even when the stage passes (PA-CM-01).
- [general] Do not defer a gap to a later stage unless that stage can close it. An outline cannot fix missing limbs or a missing face (PA-CM-01).
- [general] Graders judged the wrong thing for a long time. In step 2 both graders picked medium A every time, with clear scores. The picks stayed relative (A against B, round against round) and never absolute.
- [general] Give a verifier the checker numbers and the reference side by side. In the head test, G2 found a fault (strap) that is not on the sheets, because the heads differ in one cell (step 3b).
- [Rook-specific] Mark added 5 Sprite Fusion facings (s, n, ne, nw, sw) as grader-only references. There is no right or left (step "Grading reference"). Their scale differs: n is 33 px tall, ne, nw and sw are 32, s is 31. Their outline is weaker than the given. Graders do not judge the outline against them, and the outline line (at least 93 percent) stays.
- [general] Reference files must stay out of writer briefs. Writers would copy them, and the test would prove nothing (step "Grading reference").
- [general] A grader needs a MUST feature list made from the truth. Writer kits get no list for a hidden box, because the list would leak the truth (step 6a kit).

## Process and agent learnings
- [general] Writers under-use renders. The head-test writers rendered 1 or 2 times (step 3b).
- Orchestrator observation (6a transcripts, not in records.md): 6a writers rendered 1 to 3 of 8 allowed times, and skipped the run-count self-check. No record verifies this.
- [general] A small fix round that edits only named regions works for shape faults (step 2, step 3). It does not work for texture faults, which flip between bands (step 6a).
- [general] Patching a previous PNG breaks rebuilds. In round 8 the writer patched the round 7 PNGs, so `out/turnaround.mjs` alone no longer rebuilds the art (step 3, round 8).
- [general] A verifier finds faults that a runner misses. Step 1, 3 and 4-0 reader rounds each found Important faults that a passing runner did not (steps 1, 3 tooling, 4-0, 6a kit).
- [general] Shell path traps hide failures. `round.sh` passed `/c/` paths in a comma list, so pixlint exited 2 and PA-08 never ran (step 3 tooling). The fix is `cygpath -m`.
- [general] Brief faults cost a round. The head-test brief had a stray `--out` flag in the render command, found before round 1 (step 3b).
- [general] Agent calls: 25 of 80 after step 2. Mark lifted the cap on 2026-10-17 (spike doc, step 3b).
- [general] One Fable consult wrote the art-pipeline plan. A Sonnet verifier gave 7.5 and 4 Important findings, and a fix round passed (step 3c).

## Hypotheses for the consult
These are hypotheses, not facts. Each one needs a test.

1. Core finding. Copy worked on one head (99.6 percent exact, Level 0). Invention from rules fails (best 59 coat, 49 hair). The gap is information about structure, not drawing precision. Step 3 failed against the target because graders judged stage deltas and rounds, not distance to the target (PA-CM-01).
2. Writers got rules and pictures but no explicit structure: view angle, face axis, light direction, part layout, and fold and shadow placement. Evidence: the hair writers drew a symmetric front face (step 6a). The kit gave a mirror axis at x17.5 and called the character near-symmetric, while the face axis is near x19.5 (see the kit fact above). Hypothesis: the kit text caused the symmetric face.
2b. Copy generalizes beyond this head. This is untested. The evidence is one head of one character.
3. Motif rules describe texture statistics (T, S, orphans, run length), not structure. They taught texture, which the bands then punished in both directions. Level 0 score feedback teaches texture, not placement.
4. Cell-exact match may be an unfair line for invention. A plausible, well-drawn region that differs by one pixel of placement scores low. Candidate better measures: part-mask IoU, value structure after a 2x downsample, edge or outline alignment, and landmark positions (eyes, shoulder, hem, feet). The consult should check that each measure still fails a bad drawing.
5. The new grader-only references (s, n, ne, nw, sw) give a target for the invented facings. A v2 can measure each facing directly against a reference, not only through a held-out proxy. Writers never see them. Open points: scale differs by 1 to 2 px, the outline is weaker, and right and left have no reference.
6. Structure-first methods are untested. Examples: construction lines, part-by-part masks, 3D proxies. Only medium B (height map) was tried, and it lost in step 2.
7. Process: Level 0 single-shot writers with score-only feedback, plus small fix rounds, may be the wrong loop for invention. Writers under-used renders. The consult should state a loop in which structure is fixed first and texture last.
8. Reuse. Design tools, rules and learnings for reuse across characters, poses, animations and later map tiles, not only Rook's 8 facings. Ask for:
   - A rule format that separates structure (view, axis, light, part layout, shadow side) from texture statistics, with the structure fields filled per character and per pose.
   - A measure set that does not depend on one given frame or one palette. Rook-specific constants (22 colors, head alone 14 px, the face axis near x19.5, which is not in `target.json` yet) must live in data, not in code.
   - A decomposition (copy, transform, invent) that works for any pose pair and for animation frames, where most cells copy from the previous frame.
   - A grader design that always scores against a reference, with the reference supplied per asset.
   - A held-out invention test that any new character or tile set can run, so each new asset class gets a known-truth check before real work.
   - A list of what changes for tiles: no outline rule, repeat and seam rules, no view angle. The consult should say which parts of the Rook tool chain it reuses.

9. Approach and method (Mark, in chat, 2026-10-17). Propose a better overall approach, with less procedural code and better LLM instructions if that fits. Research how Sprite Fusion makes its sprites: a trained model, or prompting of an off-the-shelf model. State what each finding would change in this pipeline.
10. Model plan. Treat this as a big research project. Research and consult with higher models (Opus is standing-approved on this art project; Fable needs approval for each dispatch). Build with Sonnet or Haiku. Verify with expert persona packs. The consult should design the work so that builders need no higher model.

## State after 6a
Facts from records.md (step 6a result) and `art-pipeline-plan.md` section 6:
- 6a FAILED. The rules do not carry enough information to invent.
- 6b (back of the head) is not run. Its design: the up facing head box x10..25, y0..13, zero copy cells, hair letters `p m t` only, 3 Sonnet writers at Level 0.
- The invent stages for up, up-right and right drop.
- The plan keeps the copy and transform constructions: down by fuse, the down and down-left walks, and the mirrors.
- Those facings go back to Mark's #110 options: rig v2, or Sprite Fusion walks at 15 credits per facing.
- Mark decides the next step.

## Glossary
Copied from `art-pipeline-plan.md`, with step 3b terms.
- IoU: shared opaque cells divided by all cells that either image has. 1.0 is identical.
- Ramp, ramp lock: a ramp is the set of colors for one material, dark to light. A ramp lock means a part may use only its own ramp plus near-black.
- T: color changes per opaque pixel. Low T means flat.
- S: the share of opaque pixels in 1-2 px regions (luminance-step definition, PA-09, not same-color components).
- D: the share of interior pixels that are near-black.
- Orphan: an opaque pixel with no same-color neighbor (the spike doc defines it as a color that matches none of its 8 neighbors).
- Band: a lower and upper limit on a metric such as T, S, orphans or run length, taken from the reference.
- Exact: the share of cells that match the truth cell for cell. Ramp-tolerant: a cell also counts when the color is in the same ramp.
- Level 0 / Level 1: Level 0 gives the writer only scores. Level 1 also shows which cells are wrong.
- Fix round with scores only: the writer sees the scores of the last round and no cell mask.
- Flattening: detail well under the reference. Under 0.8x is a Major.
- Selout: selective outline. The outline color changes with the light.
- Motif rule: a short written rule for a texture, for example "hair uses three grays, runs of at most 3".
- Part map, mask: the part map labels each given pixel with a part. A mask is the target silhouette of a new facing.
- Anchor score: a grader score of the work against the reference, 0 to 10. Under 8 fails.

## What writers saw in 6a
Each writer kit (from `scripts/art/pipeline/heldout/`) held: the given with the box blanked at 32x, 4x and 8x, separations, the mirror, the mask, rules measured from the cells outside the box, a grid template, and a Level 0 brief. There was no feature list. The score covered the box cells only (step 6a kit).

## Tools that exist
All under `scripts/art/` in the spike branch.
- `pixkit/`: authoring kit (locked palette, lines, mirror, fill, outline).
- `pixlint.mjs`: checker for the pack's script items and PA-08 across facings.
- `metrics.mjs`, `measure-target.mjs`, `score.mjs`: metrics and target data.
- `contact-sheet.mjs`, `turnaround.mjs`: pictures and the 8-direction strip.
- `headtest/`: the head test (lib, kit, render, score, vote, mask, gradesheet, run-round.sh).
- `pipeline/`: decompose, masks, classify, walk, region.
- `pipeline/heldout/`: the 6a kit, scorer and isolation check.

## Plan baseline
`art-pipeline-plan.md` (Mark approved 2026-10-17): split each new picture into copy, transform and invent cells. Gate invention with rules and a held-out test (6a, then 6b) before any real invent stage.

## Open constraints
Spike rules hold for any v2 work:
- The draft PR is never merged.
- Zero Sprite Fusion credits.
- No image generation (no diffusion model, no PixelLab).
- No third-party sprites.
- The Sprite Fusion references are grader-only. Writers never see them.
- Style: a strong black (near-black) outline on every asset, for consistency (Mark, 2026-10-17).
- The outline line is at least 93 percent near-black edge pixels.
- Subagent rules: smallest model and effort that fit. Mark approves any model above Sonnet or effort above high for each dispatch.
- Time box: 2026-10-24.
