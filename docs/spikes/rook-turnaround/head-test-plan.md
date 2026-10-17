# Rook head test: strategy (Fable, 2026-10-17)

Measured on `given.png` for calibration (letters = palette sorted by luminance; `a` = #030102):

| Box | Opaque | Colors | Color changes per opaque px (T) | 1-2 px same-color comps / opaque (S) | Orphans | Interior near-black share (D) | Edge near-black | 4-step value histogram |
|---|---|---|---|---|---|---|---|---|
| Head x10..25, y0..13 (224 cells) | 172 | 15 | 1.27 (219) | 0.37 (64 of 82 comps; largest comp 13 px) | 7 | 0.23 | 1.00 | .37 / .28 / .34 / 0 |
| Whole frame | 432 | 22 | 1.11 (480) | 0.28 (123 of 156) | 32 | 0.33 | 0.97 | .47 / .36 / .18 / 0 |

Rows 3 to 9 of the head have 12 to 17 color runs in 13 to 17 opaque pixels. The hair is not a shaded mass. It is a texture of four grays plus near-black, with no run longer than 3 px. The target IS the "noise" the checker capped.

## 1. The diagnosis

Points 1 to 5 are correct but secondary. The primary fault is **bandwidth**: the loop could change at most 4 named regions per facing per round, and the head alone has about 80 same-color clusters. Eight rounds, three of them on one-color thumbnails, could never add about 100 details per facing. Coarse-to-fine is a human workflow, where the human carries the fine intent through every stage. A fresh writer per round with "touch only named regions" carries nothing. The stages did not fail to compose. They were never going to.

Also missing:
- **The pack pulls away from the target.** Rules 4, 14, 15 and 16 ("large clusters", "no noise", "compromise on detail") and PA-04/09/14 told graders and writers to flatten. Sprite Fusion is a high-frequency style. Add an anti-pattern, **Flattening** (helmet hair, bar goggles, sack coat): detail density under 0.8x the reference is a Major. Make PA-09 and PA-14 relative to the reference's density, not absolute.
- **Two graders, one model, one brief** is one grader twice. Their errors were correlated.
- **No ratchet.** Nothing in the loop tracked distance to the target, so "slight win over last round" ran downhill for 8 rounds.
- **Vision cannot judge density from an 8x grid.** Graders need the numbers printed on the sheet next to the pictures, every time.
- Point 5 (no-paste) did not cause the flatness. The writer could have drawn curls pixel by pixel. The medium, the caps and the pack all said not to. Keep the no-paste rule for the turnaround, but allow a **motif library in words and letters** (hair texture rule, lens shape, outline rule), which is how a human carries a turnaround.

## 2. Writer medium and process

**Medium: a text grid of palette letters.** One 32-column text file (or 16x14 for the head box), one letter per pixel, `.` for transparent, row and column indices printed. A given `render.mjs` turns it into a PNG and rejects any letter outside the palette. No primitives, no scripts by the writer. The writer emits pixels, which is the unit of the target. A 224-cell grid is about 300 tokens, so iteration is cheap.

**How the writer looks (all images made by the orchestrator, the writer never gets `given.png` itself):**
1. A **legend image**: each letter next to a 32 px swatch, hex and luminance. The writer must map a seen color to a letter, and names in text are not enough.
2. The head box at **32x with a grid line on every pixel and a number on every row and column** (16x14 px becomes 512x448 px). If that proves too dense, four quadrant crops of 8x7 at 48x.
3. **Channel separations** of the same box, same zoom: near-black only; hair grays (`p m t`); skin (`v u o r`); orange and gold (`j s q`); coat greens (`h n k f`). Pixels outside the family dimmed to 20 percent on a magenta checker. This turns one 15-way choice per pixel into five easy ones.
4. The 4-step posterized gray at 32x, and the frame at 1x and 4x for context.

**Process per writer:** transcribe the near-black mask first (outline plus interior lines), then overlay each family in turn, then self-check without pixel values: count color runs per row in the picture and in the grid, and fix rows that disagree. Render, then read the returned sheet (reference and candidate side by side at 32x, same grid, same separations) and patch rows.

**Best-of-N plus vote.** Round 1 runs 3 writers in parallel. The scorer ranks them and also builds a **per-cell majority-vote grid** from the three, which costs nothing and usually beats each single transcription. The best of the four continues. Rounds 2+ run one writer (or two) on the best grid with findings.

**Feedback levels, declared in the record.** Level 0: the writer gets only the scalar scores and the graders' feature findings. Level 1: it also gets a cell mask of wrong positions (no color named). Start at Level 1 to learn whether the detail is reachable at all. The turnaround has no reference for new facings, so a GO for the turnaround needs the **round-1, Level-0 number** (pure perception) to be at least 60 percent exact match.

**Isolation.** The writer folder holds only the crops, the legend, the grid template and `render.mjs`. A 32x crop is trivially decodable by a script, so the rule is: the writer runs node only on `render.mjs` and writes no script. Any other node, python or image read in the transcript voids the result.

## 3. The checker (necessary, not sufficient: pair it with section 4)

All metrics on opaque pixels of the box. Reference values are in the table above. A 1-2 px component is a 4-connected same-color component of size 1 or 2.
- **T, color changes per opaque pixel** = count of 4-adjacent opaque pairs with different colors / opaque. Bounds: 0.8x to 1.2x reference (head 1.02 to 1.52; frame 0.89 to 1.33). This is the "too flat" alarm. Measure round 8 to anchor the fail side (expected about 0.4).
- **S, small-component share** = 1-2 px components / opaque. Bounds 0.7x to 1.3x (head 0.26 to 0.48; frame 0.20 to 0.36). Also keep PA-09 posterized small regions, same band (head 46, frame 66).
- **Orphans**: 0.5x to 1.5x (head 4 to 10; frame 16 to 48). Small counts, so loose.
- **D, interior near-black share** = near-black interior pixels / interior pixels. Bounds: reference ±0.08 (head 0.15 to 0.31; frame 0.25 to 0.41). Catches missing outline and missing interior lines.
- **Edge near-black share** at least 0.93 (unchanged). **Palette**: only palette colors, no half alpha. **Colors used**: reference −3 to +2 (head 12 to 17).
- **Value histogram**: 4 bins of luminance/64, L1 distance to the reference at most 0.15.
- **Ramp shares**: share of opaque pixels per family (near-black, hair, skin, orange and gold, coat) within ±0.06 of the reference for the head test. For a new facing use ±0.12 with a facing-specific expectation (a back view has no skin).
- **Silhouette IoU** of the box at least 0.90 for the head test.
- **Scorer (head test only)**: exact RGBA match over all 224 cells (transparent must match transparent), no shift, plus best-of ±1 shift reported; and a **ramp-tolerant match** (same family and within one luminance step).
- **Whole frame of a new facing**: the same metrics with the frame row of the table, band 0.75x to 1.25x on T and S, since the facing changes what shows. A frame can pass every band with random speckle, so the checker only gates. The graders and the exact match decide.

## 4. Grading protocol

- **Never a candidate alone, never the previous round as the comparator for a pass.** Every sheet is reference and candidate side by side at 1x, 4x, 16x, grayscale and posterized, with the section 3 numbers printed on the sheet. The previous round answers only "did it improve", which is a separate line.
- **Fixed feature list, written once before round 1** by the orchestrator (which may read pixel values), each feature with coordinates and a must / should tag. For the head: F1 crown highlight `t` 4 px at y0 x16..19; F2 curl texture rows 1..7, four grays interleaved, no run over 3 px; F3 two round orange lenses with near-black rims at x16..18 and x20..22, y8..9, with a bridge at x19; F4 skin and nose `o v` at y10..12 under the lenses; F5 gray beard `o` with near-black underline at y13; F6 cheek and ear cluster `v o u` x13..15 y9..10; F7 gold hilt `q` entering at x11 y9..11; F8 exterior outline closed, plus interior lines between hair and face. Graders mark each present / partial / absent with x,y. Every must feature present is required to pass.
- **Blind pick.** Each grader gets A and B at 4x and 16x in random order (one is the given) and must say which is the original and why. Three picks (two graders plus one shuffled repeat). Unanimous correct picks at 4x means the candidate is far off. A pick that cites only 16x evidence is the target state.
- **Triplet rank.** Given, candidate, round-8 head crop: rank by closeness. The candidate must beat round 8 for every grader. This is the floor.
- **Anchor score against the reference every round**, per PA-CM-01. Under 8 is a fail regardless of stage. The orchestrator cross-checks: a grader score of 8 with exact match under 60 percent is a calibration miss and goes into the pack.
- **Split the graders' jobs and inputs.** G1: feature list and numbers. G2: blind pick, triplet rank and anchor score, without the numbers. Neither sees a previous verdict or the writer's notes.

## 5. Pass line, cap, stop rule

- **Baselines before round 1**, in the record: all-transparent box (52 of 224 = 23 percent), the given head with every ramp flattened to its base color (the "round-8 style" baseline), and the round-8 `down` head against the box. Pass must beat the flattened baseline by 30 points.
- **Pass (medium proven):** exact match at least 85 percent, ramp-tolerant at least 93 percent, all must features present per both graders, candidate beats round 8 in every triplet, no unanimous blind pick at 4x. **Weak pass (viable, more rounds):** exact 65 to 84 percent with all must features present.
- **Cap:** 4 rounds. Round 1 is 3 writers in parallel plus the vote grid. Plateau stop: a round that gains under 3 points of exact match.
- **Stop the spike on the code medium** if after the cap the best exact match is under 65 percent, or T stays under 0.8x the reference (the writer cannot produce the frequency), or F2 or F3 is still absent. Also record the round-1 Level-0 number. If the only path to a pass was Level-1 cell feedback, the medium cannot do the turnaround, which has no reference: report that as NO-GO for step 3 even if the head test passes.

## 6. Models

- **Writer: the strong seat.** The bottleneck is perception of 1-2 px detail, not process. Sonnet at high effort for the 3 round-1 writers. If the best round-1 exact match is under 50 percent, ask Mark for one Opus writer round before changing the process again. A head test that fails on Sonnet and passes on Opus is a cheap, decisive result.
- **Renderer, scorer, separations, sheets: scripts, no model.** The majority-vote grid is a script.
- **Graders: Sonnet, medium effort.** The protocol carries them: fixed feature list, blind pick, numbers on the sheet. A stronger grader does not fix a brief that never showed the target.
- **Orchestrator: the main session.** Haiku for transcript isolation checks. The feature list is written once by a Sonnet-high agent that may see the letter grid, then frozen.
