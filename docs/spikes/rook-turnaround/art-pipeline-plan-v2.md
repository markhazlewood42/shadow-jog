---
type: spike-plan
title: "Art pipeline plan v2: structure in code, paint by example, grade against the target"
---

# Art pipeline plan v2: structure in code, paint by example, grade against the target (Opus consult, 2026-10-17)

Inputs: `learnings.md` (main record), `art-pipeline-plan.md` (v1), `head-test-plan.md`, `records.md`, `../rook-turnaround.md`, `target.json`, the three research reports in `research/` (R1, R2, R3), the pixel-artist-characters pack. A design consult, no code. Spike rules hold: draft PR never merged, zero Sprite Fusion credits, no image generation, no third-party sprites, Sprite Fusion references grader-only. Web sources not in R1 to R3 have their URL inline. Revision 2: fix round on verifier report r1 (C1, I1 to I7, M1 to M8).

## 1. Diagnosis: why v1 failed

1. Information, not precision. Writers copy at 99.6 percent (step 3b). The 6a kits held texture statistics, not structure: no view angle, face axis, light side or part layout.
2. Kit fault in 6a. The kit told writers the axis was x17.5 (`boxkit.mjs` AXIS = 35) and the figure "close to symmetric". The part map puts the face axis near x19.5 (the skin gap between the lenses) and the zipper at x18..20. The mirror guide for the hair box (x18..24) shows lenses and skin. The guide for the coat box (x18..22) shows the zipper.
3. So 6a proved one narrow thing: rules plus a wrong guide cannot invent. Its 49 and 59 percent are a lower bound under a fault. It did not test invention with correct structure.
4. Measure and loop fault. Exact match over all box cells has zero spatial tolerance, and bands on 75 cells flip on one pixel (R3, section 1). Score-only feedback taught texture, not placement.
5. Step 3 fault. Graders judged stage deltas against the previous round, never distance to the target (PA-CM-01). A 4-region cap could not add about 100 details per facing.
6. No prior. Every tool that makes unseen views has a learned 3D prior or a 3D model (R1). A text LLM on a blank 32 px mask has neither.

## 2. Strategy v2

**Core idea: code builds the geometry, and the LLM paints inside it from examples. Every verdict measures distance to a target.** This follows R1 (Ludo, Dead Cells, PixelLab) and R2 (dummy first, shape skeleton, 3D trace reference).

- A small part-based 3D stand-in of the character (the "proxy") lives in data: one ellipsoid, box or capsule per part, plus a skeleton. A Node renderer turns it into a part map, light map, outline map and structure card for any facing and pose. It renders at native 32 px, with no resample (PA-05).
- The proxy is fit to the one given frame only. Its render at the given yaw (se) must reproduce the given part map.
- The writer paints a letter grid inside the rendered part map. Texture comes from material samples cut from the given, not from motif statistics. This turns invention into a task close to the copy task that scored 99.6.
- Code does less texture work than v1 (motif bands stop as gates) and more structure work. Each structure fact is a field on the card, not a rule to infer.
- Graders score every facing against its Sprite Fusion reference with tolerant measures (R3), and against fixed anchors, never against the last round.

**Rule check: the proxy is not image generation.** The spike rule names diffusion models and PixelLab. The approved spike doc already lists medium C: "simple volumes (SDF or voxels) rendered orthographic at 32 px, then cleaned up by pixel" (step 2). Rig v2 is also code-drawn. A deterministic renderer of hand-set primitives is the same class. Shipped games rendered 3D models to sprites: Donkey Kong Country ("rendered them frame by frame before compressing them", https://en.wikipedia.org/wiki/Donkey_Kong_Country) and Dead Cells (R2, section 5). Not allowed: the Blender MCP `generate_3d` tool and any image or 3D model from a generator. Blender `bpy` primitives would be allowed. The plan uses the Node renderer instead, because it needs no app and runs in CI. Mark can veto the proxy in Q1. Then path B runs (section 8).

**Technical risks.** The main risk is that the proxy cannot give usable part maps. (1) The sprite is chibi (head 14 of 31 rows) and the pitch is unknown. Primitives may not reach part mIoU 0.85 at 32 px. (2) The back and far side are not in the given. The spec author invents that geometry, so invention moves from pixels into the spec. (3) The fit checks only yaw se, so a wrong rotation shows only at other yaws.
Section 7 tests each risk before writers run (template checks, T1 with a blanked fit), with a change line.

**Rejected alternatives.**
- A. More v1 rules and motif statistics. 6a shows that statistics do not place structure, and each new band is one more band to flip.
- B. LLM free draw with better instructions only. No public source shows an LLM that invents an unseen facing at 32 px (R1 gap). SwordsBench: Sonnet lost body proportions over 4 frames. Asset Forge: complex 32 px subjects became blobs. The good half stays: the brief carries explicit structure.
- C. Auto render only, no LLM (Dead Cells style toon shade). It gives correct form but loses the Sprite Fusion hand texture (hair curls, selout, lens shape). It stays as a control: the "code painter" in section 4.
- D. Chain rotations from the given alone with no geometry (PixelLab chain). Errors accumulate (R1), and a text model has no rotation model. The plan keeps small steps: the nearest approved facing is an extra copy source.

## 3. Algorithm

Copy = a cell taken unchanged from the given or an approved facing. Transform = a cell that a script derives (mirror, part shift). Invent = all other cells. In v2 an invent cell has a known part, light level and outline. Only its texture letter is free.

| Stage | Who | Input | Output | Split |
|---|---|---|---|---|
| S0 Spec | Sonnet spec author | given at 32x, part map, R2 rules | `character.json`: parts, primitives, ramps, skeleton, pitch, light, item sides, landmarks | Structure only, no pixels |
| S1 Fit | script, spec author edits numbers | spec, given part map | Render at se. Part mIoU and landmark report against the given | Fit to the given only |
| S2 Templates | script | spec, target yaw or pose | Part map, 3-level light map, outline map, guide rows, structure card | Structure for each facing |
| S3 Classify | script (`classify.mjs` rewritten to read templates) | template, proxy, given, approved neighbor | Copy cells pre-filled and locked. Paint cells listed | Reprojection, below |
| S4 Paint | 3 Sonnet writers | kit (below) | Letter grid, 32x32 | Invent = texture letter per paint cell |
| S5 Clean | script | grid, template | Palette snap, ramp lock, selout outline, orphan list | Deterministic, like Pixel Snapper (R1) |
| S6 Select | script, then G2 without the reference | 3 grids | One grid per facing | Selection never sees the reference |
| S7 Grade | checker, G1, G2 | grid, reference, anchors | Verdict per section 4 | Grader-only data |
| S8 Mirror | script, proxy | approved facings | sw, w, nw | Mirror for symmetric cells. The proxy renders the sheath at the mirrored yaw, so the sheath patch is a template (v1 question 1) |

**S3 reprojection.** For each template cell, take its proxy surface point and project it into the se view. If the point is visible at se, and the part and light level match there, the cell is copy (same place) or transform (part shift). Otherwise the cell is invent. The same rule runs against the approved neighbor. T0 reports the measured shares per facing. The v1 shares (s 6.7 percent) rest on the symmetric-face rule and do not carry over.

**S5 clean.** Ramp lock checks each letter against the template part dilated by 1 px. Cells on a part seam give warnings, not faults. The outline follows the writer silhouette, inside the template silhouette dilated by 1 px. Outline letters come from the given's near-black set by light level (selout). One flat outline color fails PA-16 (Sticker outline).

**Order.** The given is se. Round 1 runs s (45 degrees) and n (135 degrees) in parallel. n is the deliberate hard case: the large jump that alternative D avoids, but with no face and with a reference. After round 1: e (45), then ne from se and e. n runs again from ne only if it failed in round 1.

**The writer kit per facing.**
- The template at 32x with a grid. Each cell shows its part letter and light level (lit, base, shadow). Locked copy cells show their color.
- The structure card as text fields: yaw, head center column, face axis column, eye cells, light vector and part layout per row. Also the outline rule, fold strokes and carried item cells.
- On n the eye field says "no face". The light vector is "top-left, toward the viewer". A fold stroke has a start (support point) and a direction.
- Material sample sheets cut from the given: each part at 32x, split by light level, with letters. The writer copies the texture pattern of the sample for that part and light level.
- The given at 32x and the approved neighbor facing, as copy sources.
- `render.mjs`, which returns the picture and a conflict list. A conflict is a letter outside the ramp of the dilated template part, or a light level more than one step from the template. This is feedback against the template, not a truth. Call it Level T.

**Writer steps.** 1) Read the card. 2) Paint the near-black interior lines from the outline map. 3) Fill each part from its sample sheet, by light level. 4) Paint the face and hands last, from the card cells. 5) Render, read the conflict list and the picture, fix. Repeat. 6) Stop at zero conflicts. 7) List disputed template cells (a cell the writer thinks is wrong) in a report to the orchestrator. The list does not block.

**How structure reaches the writer.** View angle: the template and the card yaw. Face axis: a card field and a marked column. For se it is x19.5 with head center x17.5, an offset of 2 toward the turn (R2 rule T6). Light: the light map. Part layout: the part map. Folds: card strokes from the proxy, from a support point toward the pull, on the shadow side, at most 2 per panel (R2, section 3).

## 4. Grading v2 (written before the work)

**Step 0, one shared transform.** Score only the union of opaque cells. Search scale {31, 32, 33} over the reference height and shift ±2 px. Keep the best by BF1, and use that one transform for every measure (R3, section 2).

**Hard lines (checker, every facing, against the given or the set).**
- Walk palette only, no half-transparent pixel.
- Outline: at least 93 percent near-black edge pixels (Mark's strong black outline style).
- Height 31 ±1, bottom row 30. Head alone 13 to 15 px (given 14, within 1 px, as the spike exit line). Shoulder row and hip row within 1 px of the given.
- Ramp lock to the template part dilated by 1 px: 100 percent.
- Flattening floor: per part, T and S at least 0.8x the same part in the given (pack, Flattening).
- Orphans and PA-09 small regions: at most 1.25x the given (spike exit line).
- Face skin: the skin cells of the face part (eye and nose rows, given rows 5 to 10). n: zero face skin, neck skin allowed. ne: face skin only on the near cheek edge (R2, section 2).
- Distinct facings (R2, T1): each new facing differs from every other facing and from its flip by at least N cells. N comes from the calibration set.
- Set lines from pixlint: PA-06 (box width within 4, down and up), PA-07, PA-08 (at least 90 percent shared colors) and PA-21 (sheath side).
- These lines also run on the calibration set. A line that fails a "should pass" item is re-set before round 1.

**Target measures against the reference (s, n, ne, nw, sw, grader-only).** Start values from R3, final values from the calibration set.

| Measure (R3 rank) | Start line |
|---|---|
| Boundary F at 1 px, BF1 (1) | at least 0.85 |
| Part mIoU, no part under 0.50 (2) | at least 0.70 |
| Outline chamfer mean / p95 (3) | at most 0.6 / 1.5 px |
| Value structure r, 8x8, interior cells only (4) | at least 0.80 |
| Neighborhood color match, dE00 at most 5, 3x3, outline ring excluded (5) | at least 0.85 |
| Palette EMD in Lab (6) | at most 4 |
| Landmark PCK at 0.1 x height, head points at 0.05 (7) | all points |
| Per-part texture density, absolute difference (8) | at most 0.10 |

- Rank 8 compares with the facing reference where one exists, and with the given elsewhere.
- Part labels and landmarks on the 5 references: one Sonnet labeler (transfer from the given, then fix), one Haiku check. They stay in a grader folder outside every writer kit.
- **Calibration set, before round 1.** Before any score, recolor the outline of each reference variant to the near-black rule. This removes the outline offset in both groups.
  - Should pass, near copy: each reference shifted 1 px, rescaled to 31 and 33, and 5 percent of cells moved one ramp step.
  - Should pass, realistic: walk frames against each other, part by part, and T1 outputs that G1 and G2 judged same-style.
  - Should fail, near: the adjacent reference facing, the round 8 facing, the rig v2 facing. Should fail, far: Hex walk frame 0 and a blob.
  - A gate sits midway between the worst realistic pass and the best near fail. If a measure cannot separate them, it is a report line (R3, section 5). If fewer than 4 measures gate, Mark gates the facing.
- **e and w have no reference.** Gates: hard lines, BF1 against the proxy template at least 0.90 and landmark PCK against s and ne. Also a G2 same-character pick against the given, and Mark.

**Graders (R3, section 6).**
- G1 (pixel-artist-characters pack): the numbers sheet plus a MUST feature list per facing, written from each reference before round 1 (grader-only). Every MUST present.
- G2 (game-designer pack, so the two graders do not share one brief): blind 2AFC, both orders, target on the left, at 4x and 1x.
- G2 anchors: the round 8 facing, the rig v2 facing and the code painter output (alternative C). The candidate must beat every anchor in both orders.
- Anchor score against the reference: at least 8 from each grader. A score of 8 with mIoU under the gate is a calibration miss and goes into the pack.
- Calibration gate per grader session: 10 known pairs first. Under 9 correct voids that grader's verdicts. PA-CM-01 fix: no grader sees a round number, an earlier score or an earlier verdict. Each verdict line is a distance to the target. "Better than last round" is a separate report line and never gates.

**Pass per facing.** Every hard line, every calibrated gate, both graders at least 8, all anchors beaten. Then Mark, blind, per the spike step 4.

## 5. Process

| Seat | Model, effort | Job |
|---|---|---|
| Tool builder, runner | Sonnet, high / medium | Lean loop on S1 to S8 tools and the grade kit |
| Reader (tools), isolation checks, label check | Haiku, low or medium | Diff read, transcript scans, reference label check |
| Spec author | Sonnet, medium (high from S1 round 3) | S0 and S1. Sees the given, never a reference |
| Writers | Sonnet, high | S4. 3 in round 1, 1 after. High keeps results comparable with step 3b and 6a |
| Reference labeler, MUST list author | Sonnet, medium | Grader-only data, once per reference |
| G1, G2 | Sonnet, medium | Section 4 |
| Consult | Opus (Mark approved it for consults) | Only when a section 7 change line fires |
| Orchestrator | main session | Decisions, records, Mark's sheets |

- No builder seat needs a model above Sonnet. Any writer round on Opus or Fable needs Mark's approval for that dispatch.
- **Agent budget.** At most 60 agent calls from T0 to the end of round 1 and its fix rounds. Mark lifted the spike cap of 80, so this is a new count for the record.
- **Round caps.** S1 fit: 5 rounds. S4 per facing: 3 rounds, then stop and bring Mark the evidence. Plateau: a round that moves no target measure by more than its calibration noise.
- **Fix rounds change structure, not paint.** A grader finding goes to the orchestrator, which edits the spec or the card. Then a fresh writer repaints the whole facing from the new template. This avoids the v1 patch drift (round 8 PNG patches).
- **Reference-informed edits.** Any spec edit after a reference score is logged as "reference-informed". That facing then no longer counts as a clean test. Q2 decides if such edits are allowed at all.
- **Render-and-look.** Writers render at least 3 times, and the last render must show zero conflicts. The transcript check counts renders. The 6a writers rendered 1 to 3 of 8 allowed times.
- **Isolation.** Writers and the spec author read only their own kit. Forbidden: `spritefusion-tests/rook-8d-ref/`, `C:/Users/markh/AppData/Local/Temp/rook-6a/`, every grader folder.
  - The spec author and the labeler run in separate sessions with separate files.
  - A Haiku reader scans each writer and spec author transcript (`subagents/agent-<id>.jsonl`).
  - A kit scan rejects a kit file with an 8x8 patch that matches a reference at 90 percent or more (any shift or mirror). It ignores a patch that equals the given at the same place or at a transform that S3 applied.
- **Rebuild rule.** Each facing rebuilds from `character.json`, its template and its grid with one command. No PNG patch is a source.

## 6. Reuse: more poses, characters, animations, then tiles

- **Data, not code.** Every character constant (axis, face offset, head width, ramps, light, item side) lives in `character.json`. The 6a fault came from a code constant (AXIS = 35). The checker reads its numbers from the spec and the given.
- **One renderer for facings and poses.** A pose is a set of joint angles on the spec skeleton. Walk key poses (contact, down, pass and swing, pack rule 22) become templates. Freeze and fill (R1, PixelLab): frame k copies every cell of frame k-1 that its template does not change. A walk frame paints only the moved limbs. Head cells copy with the bob offset (R2, T18).
- **New character recipe.** One given frame, then S0 to S8 with a new spec. Before real work, run the held-out test (section 7, T1) on that character's given.
- **Measure kit.** The section 4 measures in one module, with the reference, the part labels and the calibration set passed per asset. Thresholds are stored per asset class.
- **Carries to tiles:** the letter grid medium, palette and ramp lock, material sample sheets, Level T and render-and-look. Also isolation, the measure kit (ranks 4, 5, 6, 8), the calibration protocol and the grader protocol.
- **Changes for tiles:** no outline line (tiles pack), no yaw. The template becomes a material and height map per tile, drawn by code (Wang or autotile edges). New hard lines: seam match on wrap edges and a 2x2 repeat check. TA-08 relaxes to the measured reference density (v1, section 3).

## 7. Test plan

**T0, tools (lean loop, 3 rounds).** Build the proxy renderer, the spec format, the fit report, templates, cards and S3 reprojection. Also the sample sheet cutter, Level T render, grade kit, reference labels, calibration set and kit scan.
- Pass lines: a fail-path test for each hard line. At least 4 target measures separate the calibration groups.
- The se render of the fitted proxy gives part mIoU at least 0.85 against the given part map, with every landmark within 1 px.

**Template checks, before any writer runs (no reference used).**
- The s and n templates pass the structure hard lines (height, bottom row, head alone, shoulder and hip rows). Each part area is within ±30 percent of the given. The s template agrees with the mirror of the sw template.
- The e template passes a landmark check against the battle idle (the design reference for the side): head, shoulder, hem and feet rows only.

**T1, 6a regression (known truth, same hidden boxes).** Two arms, 3 Sonnet writers per box per arm, round 1 only.
- Arm 1 (control): the old 6a kit with only the axis fixed. The axis comes from the blanked part map. Arm 1 gets only the old kit files (already isolation-checked) plus the new axis. This isolates the kit fault.
- Arm 2 (v2): a proxy fit to the blanked given only. The box cells are removed from the part map, the landmark list, the light fit and the sample sheets.
- Arm 2 card fields (face axis, eye cells, light vector) come from cells outside the box. The face axis x19.5 lies outside both boxes. The fit report scores only cells outside the box.
- Every arm 2 input that comes from the given uses the blanked given (box cells removed): the spec author's view, the copy-source image in the kit, the S3 classify input and the locked copy cells, and the sample sheets. In T1 all box cells are paint cells. The unblanked given exists only in the grader folder.
- The truth part map inside the box is grader-only. A kit scan checks that no arm 2 file holds a box cell. Arm 2 also tests risk 2, because the spec author invents the geometry inside the box.
- Measures inside the box, on the opaque union: neighborhood color match, part mIoU, per-part density. Old exact is reported beside them for comparison with 49 and 59.
- Pass: arm 2 neighborhood match at least 0.80 and part mIoU at least 0.75. Arm 2 also beats arm 1 by at least 10 points of neighborhood match.

**Round 1, facings s and n in parallel.** n has a high invented share (84.6 percent in v1 classify), but no face. T0 gives the real shares. Both have a reference. Pass lines: section 4, per facing.

**Strategy change lines.**
- S1 ends at 5 rounds under mIoU 0.85, or a template check fails: path B or a consult. No writers run.
- T1 arm 2 beats arm 1 by under 10 points: the template does not carry the information. Stop and consult.
- The template-against-reference check runs once, grader-side, and nobody adjusts the spec to it. If the n template (as a part map) fails mIoU against the reference labels, stop. Bring Mark the numbers, with path B or a consult as options.
- The template passes mIoU but paint fails value or color gates: the paint step is the fault. Ask Mark for one Opus writer round on the same kit.
- The code painter ties or beats the LLM writer in G2: drop LLM paint for bulk parts. Keep code paint plus an LLM pass on the face, hands and hair only.
- Mark says "not close" on a facing that passed every gate: a calibration miss. Add it to the pack and re-set the gates. A second miss means graders cannot gate, and Mark gates each facing.

## 8. Questions for Mark (only questions that block work)

1. **Spike frame and the proxy.** The box closes 2026-10-24. This blocks T0, because exit criteria are committed before code.
   - Option A: amend the exit criteria of this spike and run v2 inside the box. The section 4 target measures join the hard lines, and the GO questions stay. The head line reads "head alone 13 to 15 (given 14, within 1 px)".
   - Option B: a new spike doc `spike/rook-turnaround-v2` with its own box.
   - Approval of v2 includes the proxy (medium C). A veto means path B. Its S0b is a 2D construction sheet per facing, drawn by code from R2 rules T2 to T8. The sheet holds guide rows, head box, face axis offset, part boxes and the light side. S3 to S8 stay, and S3 copies by part box, not by reprojection.
2. **Reference-informed fixes for Rook.** May a reference score change Rook's spec or card? This blocks round 1, because the round 1 change lines and fix rounds depend on it.
   - Yes: Rook's facings get better, but each edited facing is logged as reference-informed. Rook alone then no longer proves the method. T1 and the next character prove it.
   - No: every Rook round stays a clean test. Rook ships only what passes without reference-informed edits.

## Glossary (new terms only)

- **Proxy:** the code-built 3D stand-in of a character: one primitive per part plus a skeleton, in `character.json`.
- **Template:** the proxy render for one facing or pose: part map, light map, outline map and guide rows.
- **Structure card:** the text fields that state the yaw, axes, eye cells, light, folds and item cells for one template.
- **Level T:** cell feedback against the template (wrong ramp, wrong light level), never against a truth.
- **BF1, mIoU, chamfer, PCK, EMD, dE00:** see R3, section 3.
- **Code painter:** a control with no LLM: it fills the template from the given's material samples by nearest light level.
