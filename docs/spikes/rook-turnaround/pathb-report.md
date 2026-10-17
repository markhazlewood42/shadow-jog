---
type: spike-record
title: "Path B build report: 2D construction sheets for the Rook turnaround"
---

# Path B build report (branch `spike/rook-path-b`, 2026-10-17)

Path B is the fallback in `art-pipeline-plan-v2.md` section 8 Q1: no 3D proxy. Code draws a 2D construction sheet per facing from the R2 rules and gives the same outputs: part map, 3-level light map, outline map, guide rows and a structure card. S3 copies by part box.

## Files

| Path | What |
|---|---|
| `scripts/art/v2/pathb/rook-pathb.json` | All per-facing rule data: character rows, parts, light, seams, fold specs, check lines, shared blocks, and the part boxes of s, se, e, ne, n. A new character or pose swaps this file. |
| `scripts/art/v2/pathb/sheet.mjs` | Anchors (head center, face axis, body center, guide rows), box shapes (rect with taper, ell, dome, band), `buildSheet`, `mirrorSheet`. |
| `scripts/art/v2/pathb/maps.mjs` | Light map (lit, base, shadow), outline map (silhouette and seam cells), shared measures. |
| `scripts/art/v2/pathb/card.mjs` | Structure card (yaw, head center column, face axis column, eye cells or "no face", light vector, part layout per row, at most 2 fold strokes per panel with start point and direction, item cells) and its text form. |
| `scripts/art/v2/pathb/shares.mjs` | S3 by part box: copy, transform, invent. |
| `scripts/art/v2/pathb/check.mjs` | Template checks, set checks, se fit report. |
| `scripts/art/v2/pathb/render.mjs`, `cli.mjs`, `index.mjs`, `*.d.mts` | PNG previews at 8x, CLI, one import, types. |
| `tests/art-v2-pathb.test.ts` | 37 tests: a fail-path test per check, determinism, se fit, shares, isolation scan. |
| `docs/spikes/rook-turnaround/pathb-previews/` | Part map and light map PNG per facing at 8x (s, se, e, ne, n, and the mirrors sw, w, nw), `cards.json`, `cards.txt`. A red line in each picture marks a guide row. |

Run: `node scripts/art/v2/pathb/cli.mjs` (prints every number below and rewrites the previews).

## Exit codes

| Command | Exit |
|---|---|
| `npx vitest run tests/art-v2-pathb.test.ts` | 0 (37 of 37 passed) |
| `npx tsc --noEmit` | 0 |
| `npx biome lint tests/art-v2-pathb.test.ts scripts/art/v2` | 0 (one info: `findIndex` could be `indexOf`) |

## se sheet against the given (reported, not gated)

| Measure | Value |
|---|---|
| Part mIoU (13 parts) | 0.918 |
| Lowest part | sheath 0.667 (guard 0.750, sleeves 0.820, hair 0.867, skin 0.886, coat 0.946, the other 7 parts 1.000) |
| Silhouette IoU | 0.949 |
| Landmark distance, max | 0.83 px (item centroid). Head top row, head center column, eye centroid, zipper centroid, shoulder row, hip row, foot row, both hand centroids and the boots centroid: 0.00 |

How to read it: the se sheet was hand-fitted to the given part map. The numbers show what boxes can express of the given (two shapes the boxes miss: the ragged hair and sleeve edges, and the diagonal hilt). They are not a test of invention. The plan's proxy lines (mIoU 0.85, every landmark within 1 px) would hold here, but the plan gates a fit that was made without looking at the answer, and this was not. The landmark list is coarse (centroids and rows), so 0.00 is easy to reach. A test shows the measure can fail: a head moved 3 columns drops mIoU by more than 0.05.

## Template checks (plan v2 section 7)

| Check | s | n |
|---|---|---|
| Height 31 ±1 | 31 | 31 |
| Bottom row 30 | 30 | 30 |
| Head alone 13 to 15 | 14 | 14 |
| Shoulder row within 1 of the given (14) | 14 | 14 |
| Hip row within 1 of the given (25) | 25 | 25 |
| Each part area within 30 percent of the given | pass (13 parts; lowest guard 0.75, highest sheath 1.25) | pass (groups head 0.97, torso 1.09, item 1.29, sleeves 0.92, hands 1.08, legs 1.07, boots 1.18; lenses, beard, zipper 0; neck skin 4 of max 8) |
| s against the mirror of sw | silhouette IoU 0.938, guides and part areas within the lines | |
| Also: connected silhouette, eye rule, folds, light side, outline map | pass | pass |
| Distinct from every other facing and its flip (line 20 cells) | min 46 cells (ne against n) | |

Also run, though not asked: ne passes every template check (head union 0.97, torso 1.01, item 1.29, sleeves 0.72). e passes height, bottom row, head alone 13, shoulder, hip and the eye rule, and fails part areas on two parts: sleeves 0.67 and hands 0.69 (lines 0.70). e is not a round 1 facing and I stopped tuning it.

## Shares by part box (S3), against the given

| Facing | Copy | Transform | Invent | Cells |
|---|---|---|---|---|
| s | 21.7% | 63.3% | 15.0% | 460 |
| se | 94.1% | 0.0% | 5.9% | 441 |
| e | 33.4% | 46.2% | 20.4% | 377 |
| ne | 42.3% | 29.3% | 28.4% | 416 |
| n | 55.8% | 15.6% | 28.6% | 448 |
| sw (mirror of se) | 5.4% | 88.7% | 5.9% | 441 |
| w (mirror of e) | 3.2% | 76.4% | 20.4% | 377 |
| nw (mirror of ne) | 38.9% | 32.7% | 28.4% | 416 |

Method: each connected piece of a part looks for the same part in the given under one shift (up to 8 columns, 2 rows) or one mirror. Cells that land on that part are copy (no move) or transform (a shift or a mirror). The rest are invent. The unit is the part piece, not a reprojected surface point.

Read with care: a cell counts as copy when the given has the same part there. This says nothing about the letter or the light level, so copy is an upper bound for a pixel copy. The v1 estimate for the back view was 84.6 percent invent; these sheets say 28.6 percent because the back of the coat, hair and sleeves can take their shape from the given parts. Whether a writer can paint the back of the hair from the front hair is the open question, and these shares do not answer it.

## What I could not do or did not do

- No reference facing was used, so no number here says how close s or n is to Sprite Fusion. The template-against-reference check is grader-side and was not run.
- The e landmark check against the battle idle (plan section 7) is not built.
- The T1 test with a blanked fit is not built. It needs the kit-scan and blank-box tools from the plan.
- The mirrors (sw, w, nw) flip the part boxes only. The card says the item must be redrawn on the same shoulder, but no code moves the hilt. The light map of a mirror is recomputed with the light still at top left, so a mirror has its shadow on the other side of the body (R2 T4 allows this only if the design has no strong light).
- My reading of "s agrees with the mirror of sw": sw is the mirror of se, so the mirror of sw is se. The check compares s with se on the guide measures, part areas (30 percent) and silhouette IoU (line 0.70). If the plan meant a separately drawn sw, this check needs a second sheet.
- Three lines are mine, set without a calibration set: silhouette IoU 0.70 for the mirror agreement, 20 differing cells for distinct facings, and the eye offset range 1.5 to 3.5 on se. The given itself measures 1.76 (R2 T6 says 2 to 3), so I used the given.
- The shoulder row is one above the first sleeves row, and the hip row is the last coat or zipper row. Both give 14 and 25 on the given. Other rules might give other rows.
- The n item area is 1.29 of the given, 0.01 under the line. The back view has the hilt and a short sheath band, drawn by me; no source shows the real back.
- Part box shapes are my construction from R2 rules T2 to T8 and the given. Two facts I set by reasoning, not by a source: the hilt sits over the right shoulder (viewer's left in s, se, e; viewer's right in ne and n), and the e head is 13 wide.
- No palette, letters or textures: this is structure only. No writer has used a sheet, so nothing tests that the card carries enough information.

## Isolation

I did not open, list, read or search `spritefusion-tests/rook-8d-ref/`. I listed its parent folder once (a plain `ls`), which printed the folder's name and nothing inside it. No grep of mine reached it. `scripts/art/v2/grade/` does not exist and I did not read it. The inputs were the given frame (walk frame 4 from `rook-overworld-walk.zip` through `scripts/art/pipeline/given.mjs`), `target.json` (read for the schema only), the plan, R2 and the learnings file. A test scans every path B file for the reference folder name.
