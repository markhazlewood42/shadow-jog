# Rook turnaround: step records

One table per step (the lean loop). Spike doc: `../rook-turnaround.md`.

## Steps 0 and 1: target, kit, checker, contact sheet (2026-10-17)

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Build | `target.json`; `scripts/art/pixkit/`, `metrics.mjs`, `measure-target.mjs`, `pixlint.mjs`, `contact-sheet.mjs`; tests; `pngjs` dev dependency (2d859f5) | Given frame 4: height 31, head width 19, outline 96.81 percent, 32 orphans, 66 small regions. Walk: 22 colors, 7 near-black; frames 94.44 to 100 percent outline, 22 to 35 orphans, 60 to 72 small regions. Idle: 22 colors, none shared | | |
| 1 | Runner (pixel artist, characters) and reader (engineer) | pixlint: 8 walk frames pass, idle passes, warden and a half-transparent image fail (exit 1) | Runner PASS, reader FAIL (2 Important: a test passed by construction, hard lines had no fail-path tests) | Revert the package.json description change; one-line errors for bad args; PA-04 lists every orphan; PA-08 reports its skipped half |
| 2 | Fix commits fd105eb, 984f756: target.json palette for the idle test, pinned numbers, a fail-path test per hard line, diffGrids test | Mutations of 93 percent, head width, 1.25x and palette subset each fail a test | FAIL (1 Important: `--frame` past the last frame printed a FAIL report, exit 1) | |
| 3 | f52ecba: `--frame` past the last frame gives one line, exit 2 | Frames 8 and 99 exit 2; frame 7 lints and exits 0; 39 art tests pass | PASS | |

Notes:
- "1-2 px regions" uses pack item PA-09 (4 luminance steps, then 4-connected components of 1 or 2 px). That definition gives the doc's 60 to 72. Same-color components give 108 to 132 and stay in `target.json` as `smallRegionsSameColor`.
- PA-10 planted foot stays a manual check: the pack names no way to find the planted-foot pixel on one frame.
- Named for step 3: PA-08 across facings against a reference facing.

## Step 2: medium shoot-out (2026-10-17)

Copy tripwire (278f881): rig v2 down and Hex walk frame 0 both match 0 percent (no shared RGBA with the walk palette), so the void line is the 60 percent floor. Rig v2 Rook IoU against the given frame: down 0.710, right 0.636, up 0.713, left 0.638. Prep verifier: PASS (Minor: the shift test accepts either sign).

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| 1 | Writer A (pixel grid with the kit) and writer B (height map, top-left light, ramps), each from the clean input folder. Isolation check: no read of `spritefusion-tests/`, `media/` or the worktree in either transcript | A: pixlint PASS, 20 colors, outline 100 percent, 12 orphans, 39 small regions, IoU 0.762, copy 0.171. B: pixlint PASS, 20 colors, outline 100 percent, 4 orphans, 8 small regions, IoU 0.706, copy 0.174 | G1 (form, light, color): A, clear. G2 (same character, 1x): A, clear. B reads as an egg-shaped blob: no neck, legs or hands, skin-block face, katana lost. G1 scores A / B: palette 7.5/7, value at 1x 7.5/5.5, form 7/5.5, outline 6.5/6, clusters 6.5/6, face and hands 6.5/5 | A: PA-20 glove on the chrome arm, PA-04/14 orphans (beard, visor, hem), PA-14 hair in 2 clusters, PA-13 cool shadows, PA-16 1 px coat edge and hair selout, PA-15 grip steps. B: PA-11/07 torso, neck, legs; PA-19 beard; PA-25 hair to y9; PA-20 chrome arm and glove; katana diagonal; PA-13/12 coat strip and ramps |
| 2 | Fresh writers change only the named regions. A: glove on the chrome arm, orphans merged, hair in 2 masses, selout on the lit hair edge, grip pixel fixed (no cooler coat color in the palette, so the coat ramp stayed). B: torso narrowed, neck steps, 2 legs, beard, hair to y9, chrome arm on the right, outlined katana diagonal, coat strip and ramps; arm and katana tip held in by the 27 px box-width line. Isolation check: clean for both | A: pixlint PASS, 20 colors, outline 100 percent, 1 orphan, 33 small regions, IoU 0.762, copy 0.176. B: pixlint PASS, 20 colors, outline 100 percent, 7 orphans, 4 small regions, height 32, head width 20, IoU 0.664, copy 0.169 | G1: A, clear. G2: A, clear. Round 2 vs round 1, per medium: A slight win (G1 and G2), B slight win (G1 and G2). No plateau | A: PA-20 hand gap, PA-22 trim left coat 1 px, PA-19 two orange beard pixels, PA-16 olive selout on the vest edge and hem, PA-13 sleeve shadow, PA-12 lighter legs. B: PA-11/22 narrow the coat 2 px per side and a leg gap, PA-19 3-row visor and beard from y11, katana behind (hilt over the shoulder, tail under the hem), PA-13 coat ramp, PA-12/15 hair dome, PA-04 7 orphans |
| 3 (last) | Fresh writers, effort high, change only the named regions. A: ink gap and a gray glove under the chrome arm, left sleeve trimmed (box width 25 to 23), mouth pixels to beard gray, head orphan to hair, dark olive selout on the lit coat edge and hem, sleeve shadow column, legs one step lighter. B: coat narrowed 2 px per side, leg gap, neck row, 3-row visor and beard, katana moved behind (hilt over the shoulder, short tail under the hem), olive ramp, hair dome 2-2-1 steps, orphans merged. Isolation check: clean for both | A: pixlint PASS, 20 colors, outline 100 percent, 4 orphans, 30 small regions, height 31, head width 19, box width 23, IoU 0.759, copy 0.157. B: pixlint PASS, 19 colors, outline 100 percent, 0 orphans, 4 small regions, height 32, head width 19, box 26 wide, IoU 0.666, copy 0.211 | G1: A, clear. G2: A, clear. Round 3 vs round 2, per medium: A slight win (G1 and G2), B slight win (G1 and G2). Caps reached. G1 scores A / B: palette 8/7.5, 1x 8/7, form 7.5/6.5, outline 7.5/7, clusters 8/8, face and hands 7.5/5.5 | For step 3 (A): PA-20 right hand still reads as a plain gray block (G1 and G2), left hand merges with the katana hilt, coat banding and flat coat ramp, beard as gray as the hair, legs and boots merge |

**Step 2 result.** Medium A (pixel grid with the kit) wins 6 of 6 grader picks over B (height map) across 3 rounds. Each medium gained in every round (no plateau), and both reached the cap of 3. Medium C did not run: A and B did not finish early. Medium A goes to step 3. The B round 3 sprite (and the earlier rounds of both media) become decoys for step 4. Grader reports: `rook-step2/round-<n>/G1-report.md` and `G2-report.md` outside the repo. Agent calls after step 2: 25 of 80.

## Step 3 tooling: PA-08 across facings, turnaround strip (2026-10-17)

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Build | `pixlint --facings` (PA-08: share of opaque pixels whose colors appear in another image of the set), `scripts/art/turnaround.mjs` (8-direction strip, mirrors, katana note per mirror), contact sheet marks a whole-PNG given row; tests (764be97). Outside the repo: `rook-step3/input/` with `given.png` (walk frame 4) and the new tools, `rook-step3/round.sh` | 48 art tests pass, tsc exit 0. biome does not lint `scripts/art/*.mjs` (its config includes only src, tests, e2e and *.ts) | | |
| 1 | Runner (pixel artist, characters) and reader (engineer) | Runner: hand count 372 of 432 = 86.1 percent matches pixlint; no-`--facings` output byte-identical to the parent; mirrors pixel-exact; given.png = walk frame 4 | Runner PASS. Reader FAIL (Important: round.sh passed `/c/` paths in a comma list, so pixlint exited 2 and PA-08 never ran; round.sh could exit 1 on success; an empty `--facings` and a value flag with no value were silent) | Commit body; header comment on the mirror notes; zero-opaque test |
| 2 | 1f1b9f2: empty `--facings`, a missing flag value, a missing target file and a wrong-size frame each exit 2; zero-opaque facing is a PA-08 fail line; round.sh uses `cygpath -m` and exits by its own rc | 50 art tests pass, tsc exit 0; round.sh on 4 copies of the given frame: exit 0, 4 PA-08 set lines | PASS | |

## Step 3: the turnaround (2026-10-17)

Medium A, one writer per round, 2 graders (G1 form, light and color; G2 same character and 1x). Round numbers run across step 3. Sheets and grader reports: `rook-step3/round-<n>/` outside the repo.

| Round | Stage | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|---|
| 1 | 1 (thumbnails) | Writer: 4 one-color silhouettes per facing (down, up, right, up-right), varying head turn, stance, arm, hem flare and katana placement. Isolation check: clean | 16 thumbnails; no lint at this stage | Picks (G1 / G2): down 2 / 2, up 2 / 2, right 1 / 1, up-right 3 / 2. Stage pass (both): right pass, down pass with fixes, up and up-right fail (no katana shows; up-right is a near copy of up) | down-2: PA-11/20 arm to 3 px with a hand, PA-21/07 hilt as a 2 px diagonal and trim the hair wing. up-2: PA-21 hilt over the right shoulder and sheath tip past the hem, PA-11 one sleeve. right-1: PA-07 hair wing to 2 rows, PA-20 forearm and hand. up-right-2 and -3: PA-21 hilt and sheath tip, PA-11 shift the body 1 px for the turn; -3 hem flare to 2 px |
| 2 | 1 (thumbnails) | Writer patched only the 5 named thumbnails (down-2, up-2, right-1, up-right-2, up-right-3); the other 11 are byte-identical (cmp). Isolation check: clean | Heights within 1 px of given for all; down-2 head about 16 to 18 px against about 19 | Round 2 vs round 1 (G1 / G2): down r1 slight / r2 slight (split), up r2 slight / r2 clear, right r2 slight / r2 slight, up-right-2 r2 clear / r2 clear; both pick r2 up-right-2 over r2 up-right-3. Stage pass: up, right, up-right pass (both); down passes G1 with a fix, fails G2 (katana hilt detached) | down: PA-20/21 join the hilt to the shoulder, PA-20 end the arm at x27 or 28, PA-07 head width to within 1 px (round 3). For stage 2: up, coat bell 1 to 2 px narrower per side with arm notches, hilt reads as an ear or horn; right, forward lump to a 4 px arm and a hand block, hilt along the blade, katana tip 1 px shorter; up-right-2, split the left stub (foot and arm) and remove the hem bump, hilt tilted into the shoulder |
| 3 (stage 1 last) | 1 (thumbnails) | Writer, effort high, patched only down-2: hilt joined to the head, arm ends at x27 with a 3x3 hand, hair widened. Isolation check: clean | Measured from the alpha: given head alone 13 to 14 px (x11 to 24), `headWidth` 19 with the hilt; r3 down-2 head alone about 18 px, `headWidth` 20; neck pinches to 4 px at y13 (given: no neck, shoulders 13 to 16 px from y11) | G1 and G2: r3 clear over r2, slight over r1. Stage pass for down: G1 pass with fixes, G2 fail (head about 4 px too wide). Cap of 3 rounds reached, so down goes to stage 2 with the faults as named blockout fixes. Round 2 finding "head 1 px narrow" was a mis-measure (it counted the hilt) and caused the widening | For stage 2 (down): PA-07/32 head alone to 13 to 14 px with the given crown, PA-22 no thin neck, PA-20/21 hilt as a 1 to 2 px diagonal grip, PA-20 smooth sleeve |
| 4 | 2 (blockout) | Writer built the 4 blockouts from the stage 1 picks (down-2 r3, up-2, right-1, up-right-2) with the named fixes: head alone 14 px, no thin neck, hilt grips, one sleeve. 6 grays, against the brief's 3 or 4 (graders: not a fault). Isolation check: clean | Height 31, bottom row 30 on all; `headWidth` down 19, up 19, right 19, up-right 18; head alone 14 on all. pixlint: only PA-03 outline fails (26.8 to 49.3 percent), expected before stage 5 | Stage pass (G1 / G2): down pass / pass, up pass / pass, right fail / fail (katana reads as a bow off the back, two hand shapes), up-right fail / fail (floating sheath block, near copy of up) | right: PA-11 straight katana on the back, PA-20 one arm with one hand, face block 4 px, hem in 2 px and a toe. up-right: PA-11 floating block, turn (head 2 px right of the torso), hilt clear of the head, hands on rows 20 to 22. Later stages: down katana stub longer and darker, collar row, chrome arm its own value (stage 3); hand rows across facings (G1: PA-22) |
| 5 | 2 (blockout) | Writer changed only right and up-right (down and up byte-identical). right: straight katana touching the coat back (the coat back edge follows it, so the back hem cut was not made), one arm with one hand, 4 px face block, 2 px toe. up-right: floating block deleted, head 2 px right of the torso, left shoulder 1 px narrower, 3 px face sliver, hilt clear of the head. Isolation check: clean | Height 31, bottom row 30 on all. `headWidth`: right 17 (FAIL against 19: the hilt moved off the head rows; head alone 14), up-right 19. PA-08 100 percent | r5 against r4 (G1 / G2): right clear / clear, up-right clear / clear. Stage pass: right and up-right pass (both). Stage 2 done in 2 rounds | For stage 3: right, fill the notch at (8 to 12, 7 to 10), join the hand to the arm, skull 1 px wider at the back; up-right, left hand to 3x3 and the katana tip clear of it, near foot 1 px longer; down, katana stub to an 8 px diagonal |
| 6 | 3 (flat colors) | Writer colored the 4 blockouts part by part from the given frame (hair, skin, goggles, beard, coat, sleeves, vest strip, pants, boots, katana grip, sheath, pommel) and made the named shape fixes (right notch, hand, skull; up-right hand, katana tip, near foot; down katana diagonal). Isolation check: clean | pixlint: palette only, no half-transparent pixel, PA-08 100 percent, 9 to 12 colors, orphans and small regions pass; `headWidth` down 20, up 19, right 18, up-right 19. Only PA-03 outline fails (expected) | Stage pass (G1 / G2): all four pass / pass. No stage 2 shape broke. Stage 3 done in 1 round | All Minor, for stage 4: skin base to v (#e4b086) with s for the shadow hand, hair base to n, down viewer-left sleeve to l, down gold guard, right beard band only at x19 to 24, up-right glasses 1 px clear of the sheath |
| 7 | 4 (shading) | Writer added a recolor-only shading pass (light from the top left, the given frame's ramps per part) and the stage 3 color fixes (skin base v, hair base n, down sleeve, gold on the down katana, right beard band, up-right glasses clear of the sheath). Isolation check: clean | pixlint: palette only, no half-transparent pixel, PA-08 100 percent; orphans 10 / 3 / 6 / 9 and 1-2 px regions 12 / 4 / 5 / 7 (down / up / right / up-right; limits 40 and 82). Only PA-03 fails (expected) | Stage pass (G1 / G2): down fail / pass, up pass / pass, right fail / pass, up-right fail / pass (marginal). G1: PA-14 checkers, 1 px stripes and specks | down: PA-14 coat right checker, stripes at x10 and by the zipper, PA-19 brown lens corners, hair clusters. right: PA-14 coat and arm, scabbard stripes, PA-19 face notch, hair against the sheath. up-right: PA-14/20 face, glasses and hilt confetti, strap checker, hair highlight line, PA-23 right coat and hem, left cuff |
| 8 | 4 (shading) | Writer recolored only the named regions of down, right and up-right (up byte-identical; no silhouette pixel moved): solid clusters for the checkers, stripes and specks, lens corners orange, hair clusters, one arm block on right, 2-tone scabbard, up-right face, glasses and hilt merged, darker right coat and hem. The writer patched the round 7 PNGs (`out/patch-r8.mjs`), so `out/turnaround.mjs` alone no longer rebuilds the art. Isolation check: clean | pixlint: palette only, no half-transparent pixel, PA-08 100 percent; colors 18 / 15 / 17 / 17, orphans 6 / 3 / 5 / 8, 1-2 px regions 9 / 4 / 7 / 4 (down / up / right / up-right). Only PA-03 fails (expected) | Graders: stage 4 passes on down, right, up-right (G1 / G2), r8 over r7 slight or clear on all three. **Mark stopped step 3 here:** the set is "not close" to the Sprite Fusion target. The graders judged only what each stage adds and picked against the round before, so no verdict measured the distance to the given frame (calibration miss PA-CM-01 in the pack) | Re-evaluate before any stage 5 round: Mark decides the next step |


## Step 3b: head test (2026-10-17)

Recreate only the head of the given frame (box x10 to 25, y0 to 13) from pictures. Plan: `head-test-plan.md`. Sheets, grids and grader reports: `rook-head/` outside the repo.

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Tools 1 | `scripts/art/headtest/` (lib, kit, render, score, vote, mask, gradesheet, run-round.sh); runner and reader | Baselines: all-transparent 23.2 percent exact; flattened head 31.3 exact, 61.6 ramp-tolerant; round 8 down head 23.2 exact | Runner PASS. Reader FAIL (Important: frame bands) | 6 Minor plus runner Minors |
| Tools 2 | f951774: all 9 named items | 7 of 9 fixed; `rook-step3` stays the source of the given frame and round 8 (input, not a fallback) | FAIL (Important: vote.mjs accepted 2 grids) | vote needs 3 or more |
| Tools 3 | vote.mjs refuses fewer than 3 grids | 1 and 2 grids exit 2, no file; 3 grids exit 0 | PASS | |
| 1 (Level 0) | 3 writers (Sonnet, effort high) in parallel, no cell feedback. Writer brief fix before the round: the render command had a stray `--out` flag. Isolation check (Haiku, on the `subagents/agent-<id>.jsonl` transcripts; the task `.output` files are empty): all 3 clean. The 3 grids are byte-identical, so the vote grid is the same | **Level 0: 99.6 percent exact (223 of 224), ramp-tolerant 99.6**, against flattened 31.3 and round 8 23.2. 1 or 2 renders per writer. All head-mode bands pass; colors 15 (ref 15) | **PASS.** G1: 12 of 12 features, 0 band fails, score 9.0. G2: blind pair 1 of 2 correct (pair-b picked the candidate), triplet picked the candidate as the original, round 8 last; score 8.5 (its strap fault is not on the sheets: the heads differ in one cell) | Minor: the one missing edge cell (171 of 172 opaque) |

**Step 3b result.** The pixel-grid medium copies the given head almost exactly from pictures in one round, with no feedback (Level 0). The step 3 gap is not the precision of the medium. It comes from drawing facings that have no reference picture. Per plan section 5, this result alone does not make step 3 a GO.

## Step 3c: art-pipeline plan (2026-10-17)

One Fable consult (Mark approved the one dispatch) wrote `art-pipeline-plan.md`: split each new picture into copy, transform and invent cells, gate invention with rules and a held-out test. Plan only, no spike code.

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| 1 | Plan written (Fable, effort high); 1 verifier (Sonnet, pixel-artist-characters pack) | 36 checklist rows, overall 7.5 | FAIL (4 Important) | F1 T/S floor 0.8x; F2 held-out invention test; F3 head-alone width 13-14 and one IoU table; F4 tiles out to E1; F5-F9 Minor |
| 2 | Fix round (Sonnet) on F1 to F9 | 111 lines | PASS (fix verifier, no Critical or Important) | Minor: glossary S definition (PA-09), unused FFT entry: both fixed before commit |

Open for Mark (plan section "Questions"): approve the plan or not; two spike amendments (per-facing order, head-alone gate); mirror sheath patch; side-proxy fallback; one-frame idle; tiles in E1.

**Mark approved the art-pipeline plan on 2026-10-17.** Next: step 0 tools (lean loop), then the held-out invention test (6a) and the back-of-head early test (6b). The plan's other questions come up when each one blocks work.

## Step 4-0: art-pipeline step 0 tools (2026-10-17)

Plan section 1 "Step 0". New `scripts/art/pipeline/` (decompose, masks, classify, walk, region), tests in `tests/art-pipeline.test.ts`, data under `target.json` key `pipeline` (additions only). Lean loop: Sonnet builder, Sonnet runner, Haiku reader.

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| 1 | Stage A-C scripts, overlay, head-alone metric, walk metrics, planted-foot finder, region-blank scorer, 6a boxes | 91/91 tests; tsc, biome exit 0 | FAIL (runner 1 Important, reader 4 Important) | F1 S floor untested; F2 no isolated D test; F3 right-mask checks pass by clamp; F4 back views copy front cells; F5 5 percent edge; F6 6a boxes too small; F7 hair run 4 |
| 2 | Fix round on F1 to F7 (one fresh Sonnet verifier, source mutations) | 112/112 tests; tsc, biome exit 0 | PASS | Minor: the up-right arm patch counts as transform (plan line 31 can also read it as invent) |

Measured on the given (432 opaque cells, 13 parts): head alone 14 px (x11 to 24). Walk: bottom row 30 on all 8 frames, bob 8 9 8 7 8 9 8 7, planted foot shift at most 1 px. Hair runs reach 4, and the plan says 3: the rule data uses the measured 4.

| Mask | Height, bottom | Head alone | Copy / transform / invent | Invented share (plan estimate) |
|---|---|---|---|---|
| down | 31, 30 | 14 | 194 / 194 / 28 | 6.7 (15) |
| up | 31, 30 | 14 | 21 / 43 / 352 | 84.6 (55) |
| up-right | 31, 30 | 13 | 44 / 87 / 253 | 65.9 (45) |
| right (proxy) | 31, 30 | 19 | 0 / 0 / 501 | 100 (70) |

The right proxy from the battle idle FAILS 4 lines (head alone 19, landmark shoulder, hem, feet). It is not a usable target. It blocks only the right facing, which is last (plan question 2).

6a boxes: hairWing x11..17, y0..10 (67 opaque, 45 hair); coat x13..17, y11..25 (75 opaque, 67 coat). For a band with a reference of 0, the band is 0 to one unit (one stray pixel passes, two fail).

## Grading reference: Sprite Fusion 8-direction facings (Mark, 2026-10-17)

Mark made an 8-direction run in Sprite Fusion outside this spike, and kept the 5 facings that were acceptable: `spritefusion-tests/rook-8d-ref/` s (down), n (up), ne (up-right), nw (up-left), sw (down-left). No right or left. Mark said to use them as a grading reference. This changes the plan's rule "no Sprite Fusion output" for graders only:

- Graders see the matching reference beside the given and the candidate. It informs form and features, not the hard lines.
- Writers never get these files (they would copy them, and the test would prove nothing). Add them to every writer brief's forbidden list.
- Scale differs: n is 33 px tall, ne, nw and sw are 32, and s is 31. Masks and IoU stay on the derived 31 px masks.
- Outline: the references have a weaker outline than the given. The given's strong near-black outline is the style for every asset (Mark: no strong preference, but all assets must be consistent). Graders do not judge the outline against these references. The outline line (at least 93 percent) stays.

## Step 6a kit: held-out invention test tools (2026-10-17)

`scripts/art/pipeline/heldout/` builds one writer kit per box (the given with the box blanked at 32x, 4x and 8x, separations, mirror, mask, rules from the cells outside the box, grid template, Level 0 brief) and scores a writer grid inside the box only. An isolation check scans every kit file for hidden cells at the true and mirrored place.

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| 1 | Kit, score, isolation check, sanity grids | Runner: isolation 0 hits, truth grid exact 100, empty FAIL, shifted grid FAIL (exact 35) | FAIL (reader 1 Critical, 2 Important) | K1 rules.txt gave part shares from inside the box; K2 test could not catch K1; K3 mirror check keyed on file name; K4, K5 Minor |
| 2 | Fix round on K1 to K5 (one fresh Sonnet verifier, mutation and paste attacks) | 114 tests; check all, sanity all exit 0 | PASS | Minor: the sweep at unused layouts needs 80 percent of cells to flag a leak |

Writer kits have no feature list: a list for the hidden box would come from the truth. Graders get a MUST list made from the truth. This is a deviation from plan 6a line 72.

## Step 6a: held-out invention test (2026-10-17)

3 Sonnet writers (effort high) per box, Level 0, one round plus one fix round with scores only. Exact and tolerant count all box cells; the opaque-cell share is in brackets.

| Box | Round | Exact (opaque) | Tolerant | Bands | Verdict |
|---|---|---|---|---|---|
| hairWing (77 cells, 67 opaque) | 1 | 42.9, 49.4, 49.4 (34 to 42) | 55.8, 53.2, 57.1 | w2 passes all four; w1, w3 fail S | FAIL |
| hairWing | 2 | 45.5, 49.4, 49.4 | 55.8, 58.4, 57.1 | all fail S and orphans (texture overcorrected) | FAIL |
| coat (75 cells, all opaque) | 1 | 46.7, 41.3, 40.0 | 48.0, 49.3, 42.7 | T, S too high (speckle; the real coat is flat panels) | FAIL |
| coat | 2 | 58.7, 56.0, 41.3 | 60.0, 61.3, 44.0 | S and orphans too low | FAIL |

Lines: exact at least 60, tolerant at least 80, bands. No writer reached tolerant 80. The fix round traded one band for the other and did not move exact on the hair. Writers on the hair box drew a front-facing symmetric face from the mirror; the real frame is a three-quarter view. Graders did not run: the checker gates first.

**Result: 6a FAIL.** Per plan section 6, the rules do not carry enough information to invent, so 6b is not run, and the invent stages for up, up-right and right drop. The plan keeps the copy and transform constructions (down by fuse, the down and down-left walks, the mirrors). Mark decides the next step.

## Step 7-0: learnings record (2026-10-17)

`learnings.md`: everything learned from step 2 through 6a, for the v2 consult. Lean loop, 1 verifier (pixel-artist-characters pack).

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| 1 | Sonnet writer, 128 lines | Score 5.5 | FAIL (1 Critical, 7 Important) | C1 hair box is 77 cells, not about 70; I1 medium label; I2, I3 inferences as facts; I4 kit axis is 17.5 (boxkit.mjs AXIS = 35), face axis near 19.5 by the part map; I5 state after 6a; I6 glossary, tools, writer inputs; I7 estimate sentence |
| 2 | Fix round, 194 lines; Mark's scope and method notes added | All named numbers match records.md | PASS (Haiku fix verifier) | Minor: M2 long number line |

Opus dispatches (Mark, 2026-10-17: Opus standing-approved for research and consult agents on this art project): R1 Sprite Fusion and LLM pixel methods, R2 turnaround craft, R3 sprite grading measures.

## Step 7-1: art-pipeline plan v2 (2026-10-17)

Opus consult (dispatch named per Mark's standing approval) wrote `art-pipeline-plan-v2.md` from `learnings.md` and research R1 to R3: a code-built 3D proxy gives part, light and outline templates plus a structure card per facing; LLM writers paint inside the template from per-part samples of the given; every verdict measures distance to the matching Sprite Fusion reference with tolerant measures. Lean loop, pixel-artist-characters pack.

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| 1 | Plan, 166 lines (Opus, effort high); Sonnet verifier | Score 6.0 | FAIL (1 Critical, 7 Important) | C1 T1 proxy fit and samples leak the hidden boxes; I1 reference check could tune the spec; I2 kit scan rejects copy cells; I3 S3 reused the symmetric-mirror classify; I4 template treated as exact; I5 calibration cannot place a fair gate; I6 head line 13 to 15; I7 no technical risk named |
| 2 | Fix round by the same Opus author, 200 lines; Sonnet fix verifier | I1 to I7 fixed | FAIL (new Critical N1: copy source, S3 and spec author still read the unblanked given in T1) | |
| 3 | One sentence: every arm 2 input from the given uses the blanked given; Haiku fix verifier | | PASS | Minor: arm 1 inputs stated (done) |

Open for Mark (plan section 8): Q1 spike frame (amend this spike or a new spike doc) and the proxy (approve, or path B); Q2 reference-informed fixes for Rook (yes or no). Both block work.

**Mark's answers (2026-10-17).** Q1: amend this spike (Option A), keep draft PR #142, and use the proxy (path A). Q2: no. Keep Rook clean: a reference score never changes Rook's proxy spec or structure card. Next: amend the spike exit criteria (committed before any T0 code), then T0 tools under the lean loop.

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Amendment 1, r1 | Spike doc "Amendment 1" (Q1 option A with the proxy, Q2 clean Rook); Haiku verifier | | FAIL (3 Important) | Battle-idle check is in section 7, not 4; NO-GO wording; round caps |
| Amendment 1, r2 | Fixes on 3 lines | | FAIL (1 Important) | State that the cap case amends the NO-GO list |
| Amendment 1, r3 | The verifier's exact sentence applied | | PASS (exact fix text) | |

## Step 7-2: T0 builds (2026-10-17, unverified)

| Build | What | Numbers | Verdict | Notes |
|---|---|---|---|---|
| T0b grade kit (Sonnet, fb8d926) | `scripts/art/v2/grade/`: alignment, 11 measures, hard lines, reference labels, calibration, kit scan, grade command | 69 tests and tsc exit 0. 4 measures gate (part mIoU 0.675, smallest part 0.214, value r 0.837, color match 0.756); thin margins. BF1, chamfer, EMD, PCK, density do not separate | Lean loop pending | Hard lines with plan values fail 25 of 27 should-pass items; orphans (exit line 1.25x) would need 2.35: Mark's call after the lean loop confirms it |
| Path B (cloud session, Sonnet, branch `spike/rook-path-b` b0c5d67) | `scripts/art/v2/pathb/`: 2D construction sheets per facing, cards, part-box shares, checks | 37 tests and tsc exit 0 (its report). se fit, hand-fitted: part mIoU 0.918, silhouette 0.949, max landmark 0.83 px. s and n pass the template checks; e fails part areas (sleeves 0.67, hands 0.69 against 0.70) | Lean loop pending; reference isolation by its own statement only (the cloud transcript is not on this machine) | Hand fit shows boxes can express the given; it does not test invention |
| T0a proxy (Sonnet, this commit) | `scripts/art/v2/proxy/`: spec format, renderer, fit report, light fit, cards, S3 reprojection, sample sheets, Level T render, kit builder, rebuild, checks; `rook.character.json` | 137 tests, tsc and biome exit 0. **se fit part mIoU 0.834, under the 0.85 line**; silhouette 0.933; landmarks within 0.40 px (anchors chosen after the fit, so not independent); weakest: skin 0.476, beard 0.714. s and n pass every template check. Light fit says top-right toward the viewer, not top-left. S3 invented share: s 77.1, se 10.3, e 86.2, ne 97.6, n 98.2 percent | Lean loop pending. **Change line fires (plan section 7: S1 under 0.85): path B or a consult, no writers run** | The builder ran the optimizer about 19 times while choosing the model structure (5 allowed); a 0.8502 free-rotation spec broke the s and n checks and was discarded. Folds are first-pass guesses. e template looks poor. Untracked `scripts/_*.mjs` scratch files left uncommitted |
