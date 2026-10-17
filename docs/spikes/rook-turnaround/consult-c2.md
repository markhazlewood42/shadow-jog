---
type: spike-plan
title: "Consult C2: redesign after the T0 stop line"
---

# Consult C2: redesign after the T0 stop line (Opus consult, 2026-10-17)

Inputs: `learnings.md`, `art-pipeline-plan-v2.md`, Amendment 1, R1 to R3, `records.md` steps 7-2 and 7-3, runner and reader r1, `compare-s-n.png`, t0a cards, t0b calibration, fix round 2 (`t0-fix/fix-r2.md`, `calibration-new.md`), path B report and code. Grader-side diagnostics of my own: a ±2 px shift re-run of the BR-03 check (scratch script, grader-only, read-only). Clean Rook holds: nothing below changes a number in `rook.character.json` or a card from a reference score. Each craft rule cites R2.

## A. Diagnosis

**A1. The template-against-reference check is not a fair gate.**
1. It skipped plan step 0. The BR-03 script scores at shift 0 (only n gets a crop search). With a ±2 px shift search (best mIoU, an upper bound, the same for all three rows), every score rises 0.028 to 0.160, and 13 of 15 best shifts sit at dx -2:

| ±2 px shift | s | n | ne | nw | sw |
|---|---|---|---|---|---|
| Path B | 0.641 | 0.617 | 0.542 | 0.517 | 0.521 |
| Proxy | 0.580 | 0.502 | 0.493 | 0.489 | 0.520 |
| Given se, unchanged | 0.644 | 0.424 | 0.455 | 0.408 | 0.522 |

2. The correct answer fails. The game ships sw as the mirror of se (R2 T4). The kit's own item `sw<-flip(given)` scores mIoU 0.640, color match 0.648 and value r 0.799. After fix round 2, only color match gates (0.756), and 0.648 fails it. The two pre-fix gates (mIoU 0.675, value r 0.837) are report lines now, and it was under both. Sprite Fusion's own ne, mirrored, against its nw (`nw<-flip(ne)`) scores mIoU 0.598 and color 0.732. It fails the color gate too.
3. The noise floor is as high as the signal. Adjacent reference facings score 0.60 to 0.65 against each other (`n<-nw` 0.649, `n<-ne` 0.602). A candidate in the 0.45 to 0.65 band can be right or wrong. For the mirrored given against sw, the small groups collapse: hands 0.12, boots 0.28, item 0.23 (my shift search, best mIoU; the verifier's integer-shift run gives 0.07, 0.52, 0.17). At 32 px a 1 px offset halves the IoU of a 3 px group.
4. Labels are a second noise source: automatic labels plus 1 or 2 hand edits, skin in 1 to 2 cell fragments (s, sw), sleeves merged, no Sonnet transfer and no Haiku check (reader I11). The n reference at 33 px is not a fault: the crop and scale search handle it.

**A2. What "neither path beats the unchanged given" means.** It does not show that the templates are wrong. It shows that this measure cannot tell. Real signal still shows where the facing change is large: on n, ne and nw both templates beat the naive given by 0.04 to 0.19. On s and sw the naive given is a strong baseline, because s and sw are 45 degrees from se and share its silhouette. The proxy s is under the baseline (0.580 against 0.644). That is a weak but real hint that the proxy s is less like the target than the given is.

**A3. The calibration set cannot place a gate (with the fix round 2 fact).** The set mixes two populations. Near copies and adjacent facings are Sprite Fusion 8-direction drawings. Walk frames, `flip(given)` and every real candidate come from the given's hand. A gate between two Sprite Fusion groups asks "is this closer to Sprite Fusion's drawing than its own neighbor facing is". Only a copy of that drawing passes. With the walk frames scored on the 7 gate groups, 1 of 11 measures separates (color match), and `flip(given)` fails that one. So zero measures can gate a candidate that comes from the given. The missing class is "a correct facing in another hand". The set has one such item (`flip(given)` against sw), and it is in the info group.

The hard lines fail for the same reason. The given-relative lines (orphans, PA-09, flattening, widths) were tested on the references, which are a noisier drawing. The walk frames, which share the given's style, pass orphans and PA-09 at 1.25x (worst PA-09 1.091). Only the references need 2.35x. HL-FLAT fails 5 walk frames because the per-part ratio on small parts is unstable. PA-06 and PA-07 fail only on the s and n references: head and box width change with the facing.

**A4. The 0.85 se-fit line measured the wrong thing.** It ran as an unweighted 13-part mean. Skin follows the artist's letters, so it is 1 to 2 px islands between hair, lenses and beard, and it weighs as much as the coat. A layout model must not reproduce those islands. At se they are copy cells, and elsewhere they are paint cells. On the grader's own measure (7 groups, area-weighted) the proxy se scores 0.878 and path B 0.931. A second lesson: the builder ran about 19 optimizer runs, and the 0.8502 free-rotation spec broke s and n. A pixel fit at se fights plausibility at other yaws. Path B's 0.918 is circular: its se sheet is 94.1 percent copy.

**A5. Summary.** The structure step was stopped by a measure with no resolution. The real open risk is the same as in v1: paint. The proxy's strict reprojection marks s 77.1, n 98.2 and ne 97.6 percent as invented. LLM invention scored 49 to 59 percent in 6a, and copy scored 99.6.

## B. Pick: path C, a hybrid (proxy layout, transplant of the given's own pixels, code painter, small LLM pass)

- **Keep the proxy for layout, not for pixels.** It is the only source that gives every yaw, and later (untested) other poses (walk animations, more characters). Its se layout is good on the grader measure (0.878, silhouette 0.933). Its n, ne and nw templates beat the naive given (A2). Its pixel template is not fit to paint by, because of the skin islands and the overfit risk (A4).
- **Take path B's real lesson, not its numbers.** Most cells of a near facing can come from the given by part shift and mirror (path B: s invented 15 percent, against the proxy's 77.1). Copy is the step that works (99.6 percent). Its ~340 hand-set box numbers per facing are not a method: they do not generalize, and its isolation rests on its own statement. Retire them as a source and keep path B as a report row.
- **Move texture invention from the LLM to code.** Hidden cells (back of hair, back of coat) get a code painter that copies texture patches from the same part and light level of the given. Density then matches by construction (the step 3 fault). The LLM paints only the face, hands, item and seams, which is where meaning sits.

## C. The redesign (for a Sonnet builder)

**C1. Structure source.** `rook.character.json` unchanged. New module `scripts/art/v2/proxy/layout.mjs`: per part and yaw, return the center, row span, column span, depth order and visible share from the 3D proxy. Pixels are not used. A per-facing-class rule table in data (`structure.facingRules`), written from R2: T2 (rows constant), T3 (limb width ±1), T4 (mirrors), T5 and T6 (eye row, face offset 0 at s and 2 to 3 toward the turn at 3/4), T8 (no eyes at n and 3/4 back), T10 (one light: use the light fit from the given, top-right, not the plan's top-left), T15 (folds).
- *Light evidence.* The given is clearly lit from the top (mean luma top 137, bottom 103). "Right" rests on the T0a fit only (right 125, left 116). Record both numbers on the card.
- *Relight on flip (R2 T10).* A mirror moves the lit side to the left. After every flip, take each cell's light level from the layout light map of the target facing, and recolor by ramp steps to that level. This applies to the S8 mirrors (sw, w, nw) and to flipped layers in the transplant.
- *Allow-list (R2 T4, PA-21).* The sheath, guard and wrap are never mirrored. They come from the layout at the target yaw, so the katana stays on the same body side. Hands are relit, and their shape is kept.
- *Freeze (Q2, clean Rook).* Split the data. `structure.facingRules` (spec side, feeds the layout and cards) is frozen before the first reference result. `grade/facing-checks.json` (grader side, check tolerances) may be calibrated on references. No edit to the spec or `facingRules` after any reference result. If an edit is needed, it goes to Mark and is logged as reference-informed, and that facing stops counting as a clean test.

**C2. Templates and paint.** Order per facing:
1. *Transplant* (`transplant.mjs`): cut each part of the given as a layer. Move it to the layout center by an integer shift. Flip it when the rule says the part turns to show its other side, then relight it (C1). Never flip an allow-list part. Narrow or widen it only by deletion or duplication of one column inside a flat run (no resample, PA-05). Hide it when the visible share is under 0.3. Draw by depth order. A light-level change of one step recolors by one ramp step (a transform, not an invention).
2. *Code painter* (`codepaint.mjs`): each empty cell inside the layout silhouette gets the best 3x3 patch match from the same part and light level of the given (non-parametric sampling, deterministic seed). Outline last, by the existing selout rule.
3. *LLM detail pass*: 3 Sonnet writers repaint only the face, hands, item and listed seam cells (at most 25 percent of the cells), with the given and the material sheets. The per-cell vote picks the grid. The output must beat the code-only output in G2 2AFC, else ship code-only.

**C3. Labels.** Candidate labels come from the layout (known by construction). Reference labels are report-only now, so no new labeling round. If a reference gate ever returns, the plan's Sonnet transfer plus a Haiku check runs first.

**C4. Grading, three tiers.**
- *Style, against the given* (gate). Walk palette, ramp lock, outline at least 93 percent, orphans and PA-09 at most 1.25x, a flattening floor per group with at least 20 cells (and on the whole figure), per-group texture density as a two-sided band. Calibrate on the right population: should pass = all 8 walk frames. Should fail = round 8, rig v2, blob, the given with each part flattened to its mean color, and the given with 10 percent random speckle. Add two lines for painted cells: the PA-14 squint check (3 value bands, cluster count inside the walk band) and a PA-15 run-order check (R2 T12). A line gates only if it separates. If fewer than 3 lines gate, Mark gates style by eye (plan section 4 fallback).
- *Structure, reference-free* (gate). The C1 rule table as checks, the Amendment 1 rows (height, bottom, head alone 13 to 15, shoulder and hip within 1), HL-DISTINCT, HL-FACE, PA-22 guide rows (head top, eye, shoulder, hip, foot) within 1 px of the given on all facings. PA-19: eyes 1 to 2 px on one row at s, no eyes at n and ne. PA-20: each hand is a 2 to 3 px cluster, and the item has its own outline. Lit side, sw and nw: lit-minus-shadow luma on hair, torso and legs has the same sign as at se. Facing ID: a blind grader sees the given and one candidate at 8x and names its facing from 8. Calibrate it first on the 5 references, the given and 2 flips. It needs 9 of 10. Then Mark's template look (Q3).
- *References* (report and grader pictures only). Aligned part mIoU and its gain over the naive given, color match, value r. G1 and G2 still see the reference beside the candidate, with a MUST list that has only facing-level features (eyes or none, item side, hair mass), never cell positions.
- e and w: compare the guide rows with the battle idle (head top, first skin row, leg split, foot row, per T2), not row widths. The idle's blade stance makes the widths useless (shoulder 8 against 17).

**C5. Line re-sets.**

| Line | Now | New | Basis | Who |
|---|---|---|---|---|
| Orphans, PA-09 | 1.25x, tested on references | 1.25x unchanged, calibrated on walk frames | A3 | none (exit line kept) |
| Flattening | 0.8x per part | 0.8x per group of 20 or more cells (re-set to 25 by calibration, walk0 0.780 at 20), plus the whole figure | A3 | orchestrator, recorded |
| PA-07 head width | ±1 of se | removed; head alone 13 to 15 stays | width depends on facing | orchestrator |
| PA-06 box width | ±4 of se | report only | same | orchestrator |
| Reference gates (mIoU, value r, color) | gate | report only | A1, A3 | **Mark (Q1)** |
| se fit | 13-part mean at least 0.85 | layout line, C6 | A4 | **Mark (Q2)** |

**C6. Pass lines, written now.**
- *T0-C tools.* Layout at se: each of the 7 groups has its center within 1.0 px and its row span within 1 px of the given. Grouped mIoU at least 0.85 (the current spec meets this at 0.878; the center line is untested). Transplant at se reproduces the given at 100 percent. sw equals the mirror of se outside the allow-list, after the relight, and passes the lit-side line. s template: at most 40 percent invented cells. Rule checks pass on the 5 references and fail on swapped facings in at least 90 percent of items. The facing-ID grader gets 9 of 10. Tests, tsc and biome green, with a mutation test for each new line.
- *T1-C (6a boxes, known truth).* Code painter in both 6a boxes (hair wing, and the coat box as a flat panel), from cells outside them: neighborhood color match at least 0.80, density inside the walk band, part mIoU at least 0.75. Report old exact beside it (6a best 49 and 59).
- *Round 1, s and n.* Every Amendment 1 hard line, every style gate, every structure line, facing ID right for 2 of 2 graders in both orders, G1 and G2 at least 8, beats the anchors (round 8, rig v2, naive given) in both orders, Mark's template look passed. Reference measures are report lines. Each verdict still states its distance to the reference (PA-CM-01). Then Mark, blind.
- *Basis of each number.* 0.80 and 0.75: the plan v2 section 7 T1 arm 2 lines, written before any v2 result. 9 of 10: R3 section 6 item 5. 40 percent: a start value inside the bracket of path B (15) and the strict proxy (77.1). Over 40 means path C copies too little to differ from path A. 90 percent and 20 cells: start values. Calibration sets the final values, and no line moves after a candidate result.

## D. Steps in order

1. Orchestrator: record C2. Ask Q1 to Q3. Change Amendment 1 only after Mark answers. 0 agents.
2. Grade kit round 3: C4 tiers, C5 re-sets, rule checks, facing-ID harness, aligned BR-03 re-run as a report. 1 Sonnet builder, 1 Haiku reader. Cap 2 rounds. **At the cap:** the tools give report lines only, and Mark gates style and structure by eye.
3. Path C tools: `layout.mjs`, `transplant.mjs`, `codepaint.mjs`, kit changes. 1 Sonnet builder, a Sonnet runner and a Haiku reader. Cap 3 rounds. **At the cap:** stop. Bring Mark the evidence, with the #110 options or a consult.
4. Early check (E), then Mark's 2-minute template look at s and n. 2 Sonnet facing-ID graders. **Fail:** see E.
5. T1-C: code painter in the 6a boxes, plus 3 Sonnet writers for the LLM detail pass in the hair box. 1 Haiku isolation reader. Cap 1 round plus 1 fix round. **At the cap:** if the code painter misses, LLM writers paint the hidden cells (plan v2 S4), and the code painter becomes an anchor. If that also misses, the paint step is the fault: Mark decides on one Opus writer round (plan v2 section 7).
6. Round 1, s and n: 3 Sonnet writers per facing in round 1 and 1 after (plan section 5), fresh G1 and G2 per facing per round, 1 Haiku isolation reader per round. Cap 3 rounds per facing. **At the cap:** the best candidate and its numbers go to Mark: accept, NO-GO, or #110 (the Amendment 1 cap case).
7. e, then ne from se and e. Run ne only after n passes. Same seats, caps and cap path. Needs a new budget (below).

**Budget against the 60 cap.** (Mark raised the cap to 80 on 2026-10-17: records.md step 7-5.)

| Item | Calls |
|---|---|
| Spent: T0a builder, T0b builder, path B cloud, runner, reader, fix builder, fix verifier, C2 consult, C2 verifier, this C2 fix, its verifier | 11 |
| Step 2 (2 rounds x 2) | 4 |
| Step 3 (3 rounds x 3) | 9 |
| Step 4 | 2 |
| Step 5 (2 rounds x 4) | 8 |
| Step 6: writers 10, G1 and G2 12, readers 3, MUST-list author 1 | 26 |
| **Total at every cap** | **60** |

Step 7 is outside the 60: Mark sets a new count for e and ne. If an earlier step runs over, cut in this order: (1) the T1-C fix round (4 calls); (2) G2 only in the last round of each facing, with G1 alone before (4 calls). Opus is used only for a consult when a change line fires.

## E. Risks and the early check

- Transplant seams: layer edges leave broken outlines and orphans. The outline pass and the orphan line catch them.
- The face at s needs real invention (about 30 cells). The 3-writer vote and the head-test result (99.6 percent copy) make it the smallest risk.
- n stays mostly hidden cells. The code painter may make the back of the coat busier than the flat panels (R2 T14). The density band catches it.
- Pixel soup and Banding: 3x3 patch sampling makes local noise with no large clusters. The PA-14 squint line and the PA-15 run-order line (C4) catch it.
- Jaggies: a deleted or doubled column breaks diagonals and fold strokes (R2 T15). Edit only columns that no diagonal run crosses. PA-15 checks the result.
- Facing drift: PA-07 is gone. The head-alone line and the PA-22 guide rows (C4) hold the head and rows in all facings.
- Mitten hand and Blob face: the LLM paints the hands and face. PA-19 and PA-20 are now structure lines (C4).
- Style gates that pass by construction (PA-CM-01): copied pixels pass given-relative lines almost always. The style tier is a floor, not a verdict. G1, G2 and Mark judge the distance to the reference.
- n and ne: the transplant barely applies (strict reprojection: 98.2 and 97.6 percent invented, most parts hidden). There the layout gives the hair mass, back panel, strap and item cells. The code painter copies hair and coat texture from the given, and the LLM paints only the item and hands. T1-C tests the painter on the coat panel, and the early check tests n before ne runs.
- The time box ends 2026-10-24. Steps 2 to 4 must end by 2026-10-20 to leave 2 rounds for s and n.

**The one early check.** At step 4, before any writer runs, render s and n from transplant plus code painter only. Two Sonnet graders name the facing blind, in both orders, and Mark looks at the 2 sheets. If either facing is misnamed, or Mark says the structure does not read, path C fails at structure. Then stop and go to Mark's #110 options (rig v2, or Sprite Fusion walks), not to another tool round.

## F. Questions for Mark (Q1 and Q2 block steps 2 and 3; Q3 blocks step 4)

1. **Reference gates.** The correct mirror of the given fails the one reference gate left (color match) and both pre-fix gates (A1, A3).
   - A: references become report lines and grader pictures. Style gates run against the given. Structure gates are the rule checks, facing ID and your template look. **Recommended.**
   - B: keep reference gates at re-set values under the `flip(given)` scores (about 0.60 mIoU). They would pass almost anything.
   - C: you gate every facing by eye and use no tool gates.
2. **The se fit line.** It failed on a 13-part mean. The grader measure gives 0.878.
   - A: record the old line as failed, and use the C6 layout line from now on. **Recommended.**
   - B: keep 0.85 on the 13-part mean, and let the builder fit again within a 5-run cap.
3. **Your template look.** No tool can gate structure against the references.
   - A: you look at 2 part-color sheets (s, n) for 2 minutes before paint, and answer "reads as s/n: yes or no". **Recommended.**
   - B: graders and facing ID only. You see only the final blind review.
