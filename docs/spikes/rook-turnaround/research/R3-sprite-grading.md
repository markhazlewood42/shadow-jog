# R3: How to grade a 32 px sprite against a target sprite

Date: 2026-10-17. Scope: automatic measures and judge protocols for "does this small pixel-art sprite match a target in structure and look", robust to 1 to 2 px shifts and 31 to 33 px height differences. Every claim has a URL. **[Inference]** marks my own reasoning, not a source.

## 1. What the spike has now, and why it fails

- `scripts/art/score.mjs` `shiftScores`: best silhouette IoU and best exact "copy" match over shifts of plus or minus 6 px. `scripts/art/headtest/score.mjs` `matches()`: exact and ramp-tolerant match over **all** box cells (transparent-to-transparent counts as a match), best plus or minus 1 shift for exact only, and `evaluate()` bands on T, S, orphans, D, edge near-black (at least 0.93), colors, value histogram L1, ramp shares, silhouette IoU (at least 0.90).
- **[Inference]** Three defects follow from this code: (a) exact match per cell has zero tolerance in space, so a correct shape that is off by one column loses all its cells; (b) transparent cells inflate the share, so a small box with much background passes on emptiness; (c) T and S are global counts over about 70 cells, so a few cells move the ratio across a 0.8x to 1.2x band, and a count does not say *where* the texture is.
- Pixel and fidelity scores reward the wrong thing in pixel art: in SD-piXL, plain bilinear downscaling beat real pixelization methods on PSNR and SSIM, and the authors say none of these metrics directly assesses pixelization quality ([arXiv 2410.06236](https://arxiv.org/pdf/2410.06236)). Sprite GAN papers fall back to FID, L1 and visual inspection ([arXiv 2208.06413](https://arxiv.org/abs/2208.06413), [arXiv 2409.10721](https://arxiv.org/pdf/2409.10721)). No published pixel-art metric solves this problem. Build it from segmentation and shape measures.

## 2. Step 0: normalize and align before any score

1. Score only the **union of opaque cells** (candidate OR target), never transparent-to-transparent cells. **[Inference]**
2. Search a small transform set and keep the best by boundary F (section 3, rank 1): scale s in {31, 32, 33} / target height with nearest-neighbor resampling, then shift dx, dy in plus or minus 2. Report the chosen (s, dx, dy) with every score. Coarse-to-fine transform search on edge maps is the classic chamfer approach ([Borgefors hierarchical chamfer matching, via IVCNZ](https://www-ist.massey.ac.nz/dbailey/sprg/IVCNZ/Proceedings/IVCNZ_65.pdf)); at 32 px a brute-force search (3 x 25 = 75 poses) costs nothing in Node. **[Inference]**
3. Fix one transform per candidate and use it for **all** later measures, so that no measure gets its own favorable shift. **[Inference]** (The current code picks a separate best shift for IoU and for copy match.)
4. Alternative to resampling at pixel level: compute structure measures (ranks 3, 4, 6) in bbox-normalized coordinates, so a 31 px and a 33 px figure compare without new pixels. **[Inference]**

## 3. Ranked measures (all after Step 0)

| Rank | Measure | Formula | Catches | Threshold to calibrate | Cost |
|---|---|---|---|---|---|
| 1 | **Boundary F at tolerance 1 px (BF1)** | Outline cells O_c, O_t (opaque cells with a 4-neighbor transparent). P = share of O_c within 1 px (Chebyshev) of O_t; R = share of O_t within 1 px of O_c; F = 2PR/(P+R) | Silhouette shape, tolerant to 1 px drift | Start: F at least 0.85 | Node, trivial |
| 2 | **Part-mask IoU (mIoU)** | For each part k (hair, face, coat, arms, legs, boots, item): IoU_k = abs(C_k AND T_k) / abs(C_k OR T_k); mIoU = area-weighted mean; also report min_k | A plausible silhouette with parts in the wrong place | Start: mIoU at least 0.70, no part under 0.50 | Node; needs part labels on each target once |
| 3 | **Outline chamfer, symmetric** | DT_t = distance transform of O_t. d(C,T) = mean over O_c of DT_t; chamfer = (d(C,T) + d(T,C)) / 2; also 95th percentile (robust Hausdorff) | How far off the outline is, as a number of px | Start: mean at most 0.6 px, p95 at most 1.5 px | Node, trivial |
| 4 | **Value structure, downsampled** | Luminance Y on opaque cells; box-filter to 8x8 (4x4 px cells, mean over opaque only); score = Pearson r between the two 8x8 maps, plus 3-level (dark/mid/light) agreement share | Light and shadow placement, read at a glance | Start: r at least 0.80 | Node, trivial |
| 5 | **Neighborhood-tolerant color match** | For each opaque cell of C: min CIEDE2000 to any T cell in its 3x3 neighborhood; share with dE00 at most tau; symmetric (also T to C); report the mean of both | Replaces exact and ramp-tolerant match; a right color one cell off still counts | Start: tau = 5, share at least 0.85 | Node; dE00 is about 60 lines |
| 6 | **Palette EMD in Lab** | Signatures = (palette color in Lab, weight = cell share); EMD with dE00 (or Euclidean Lab) as ground distance | Overall look and palette weight, independent of position | Start: EMD at most 4 dE | Node; 8 to 16 colors, a small transport solve |
| 7 | **Landmark PCK** | Named points (eyes, chin, hand, belt, heel, item tip). PCK = share with distance at most alpha x bbox height | Pose and proportion errors that IoU hides | alpha = 0.1 (about 3 px); require all head points at alpha 0.05 | Node; landmarks on targets once, on candidates from part centroids |
| 8 | **Texture density map, per part** | Replace global T and S counts: per part (or per 8x8 cell of rank 4), color-change pairs / opaque cells; compare to the target with abs diff, not a ratio band | Too much or too little texture *where* it lives | Start: per-part abs diff at most 0.10 | Node, reuses `measure()` |
| 9 | SSIM, small window | Wang 2004 SSIM on luminance, window 3 or 5, alpha-composited on a fixed gray | Diagnostic only | Report, do not gate | Node (`@blazediff/ssim`, zero deps) |

Sources and notes for the table:

- Rank 1: boundary precision, recall and F with a distance tolerance is the BSDS protocol ([Berkeley BSDS](https://www2.eecs.berkeley.edu/Research/Projects/CS/vision/bsds)) and the DAVIS contour accuracy F = 2PR/(P+R) next to region IoU J ([DAVIS metrics, via arXiv 2009.08855](https://arxiv.org/pdf/2009.08855)). Boundary IoU sets its distance d to 2 percent of the image diagonal and does not over-penalize small objects ([Cheng et al. CVPR 2021](https://arxiv.org/abs/2103.16562)). **[Inference]** For a 32x32 frame the diagonal is 45 px, so d = 0.9, which rounds to the 1 px tolerance above.
- Rank 2: the spike already builds a part map for the given (`pipeline/decompose.mjs` `buildPartMap`). The 5 reference facings come from a separate tool and have no labels. **[Inference]** Label each reference once (by hand, or transfer from the given and fix), then keep the labels with the grader-only targets.
- Rank 3: a distance transform turns an edge map into distance-to-nearest-edge per pixel, the base of chamfer matching ([IVCNZ paper on Borgefors/Barrow](https://www-ist.massey.ac.nz/dbailey/sprg/IVCNZ/Proceedings/IVCNZ_65.pdf)).
- Rank 5 and 6: CIEDE2000 has published test data, and many implementations were wrong, so validate against it ([Sharma, Wu, Dalal](https://www.ece.rochester.edu/~gsharma/ciede2000/)). EMD is the minimal cost to turn one distribution into the other, avoids bin problems, and is a true metric when masses are equal ([Rubner, Tomasi, Guibas IJCV 2000](https://math.ucdavis.edu/~saito/data/emd/rubner-tomasi-guibas-emd.pdf)). Bin-by-bin L1 (the current value histogram L1) ignores neighboring bins ([Rubner ICCV 1998](https://people.eecs.berkeley.edu/%7Eefros/courses/AP06/Papers/rubner-iccv-98.pdf)).
- Rank 7: PCK normalizes keypoint distance by box size, with common thresholds 0.05, 0.1, 0.2 ([mmeval PCKAccuracy](https://mmeval.readthedocs.io/en/latest/api/generated/mmeval.metrics.PCKAccuracy.html)).
- Rank 9: SSIM defaults to an 11x11 Gaussian window, and inputs smaller than the window fail ([MathWorks answer](https://au.mathworks.com/matlabcentral/answers/75668)). MS-SSIM halves the image at each of 5 scales ([@blazediff/ssim README](https://cdn.jsdelivr.net/npm/@blazediff/ssim@1.7.1/README.md)). **[Inference]** At 32 px the fifth scale is 2 px, so MS-SSIM is not usable, and plain SSIM rewards blur as shown above.

## 4. Measures not to use as gates

- **LPIPS** compares deep features of an ImageNet network and was validated by 2AFC human judgments ([Zhang et al. CVPR 2018](https://openaccess.thecvf.com/content_cvpr_2018/papers/Zhang_The_Unreasonable_Effectiveness_CVPR_2018_paper.pdf)). On 32x32 CIFAR images, authors doubted it beats SSIM ([arXiv 2307.01827](https://arxiv.org/pdf/2307.01827)), others upsample to 224 px first to avoid boundary bias ([arXiv 2412.09726](https://arxiv.org/pdf/2412.09726)), and LPIPS scores move with input scale ([arXiv 2207.09856](https://arxiv.org/pdf/2207.09856)). Needs Python and PyTorch (`pip install lpips`, [PyPI](https://pypi.org/project/lpips/)).
- **DISTS** is relatively insensitive to translation and dilation and tolerant of texture resampling ([Ding et al. arXiv 2004.07728](https://arxiv.org/abs/2004.07728)). That is the right property, but it is a VGG model trained on natural photos. **[Inference]** Use LPIPS or DISTS only as an offline cross-check on 8x nearest-neighbor upscales, on CPU in Python. A GPU is not needed for 32 px images.
- **Shape context** (log-polar histograms, 5 radial x 12 angular bins, bipartite matching; [Belongie et al. ICCV 2001](https://www2.eecs.berkeley.edu/Research/Projects/CS/vision/shape/belongie-iccv01.pdf)) works in Node with a Hungarian solver, but at about 100 outline points ranks 1 and 3 give the same signal for less code. **[Inference]** Keep it for pose matching across animation frames later.
- **Edit distance on grids**: the 2D generalization of edit distance is NP-complete ([Makinen, point-pattern matching](https://cs.helsinki.fi/u/vmakinen/papers/ppm_spire_abstract.html)). The neighborhood tolerance in rank 5 gives the useful part. **FID** compares sets, not one sprite to one target.

## 5. Calibrate thresholds from known pairs

**[Inference]** for the method; the reason is that judges and metrics without a gold reference over-credit ([arXiv 2607.12885](https://www.alphaxiv.org/abs/2607.12885.md)).

1. **Should pass**: each target vs itself shifted 1 px, rescaled 31 to 33 px, and with 5 percent of cells recolored one ramp step.
2. **Should fail, near**: each target vs the adjacent facing of the same character (down vs up-right), and vs past rounds that experts rejected, including calibration miss PA-CM-01 from the pixel artist pack.
3. **Should fail, far**: a different character or a blob.
4. Set each gate between the worst "should pass" and the best "should fail, near". If the two overlap for a measure, drop that measure as a gate.
5. Store the set and the thresholds per asset class (character, tile). Re-run it whenever a measure changes.

## 6. Grading protocol for LLM or human judges

1. **Always grade against the target, never against the previous round.** Prior scores in context pull judgments toward them (Cohen's d up to 0.71, 7 of 8 models), and neither chain-of-thought nor a warning removed the effect ([arXiv 2608.25869](https://arxiv.org/abs/2608.25869)). Do not show the round number, earlier scores, or earlier verdicts.
2. **Use pairwise forced choice, blind, both orders.** Show target T, then A and B, and ask "which is closer to T in silhouette, parts, values, palette". Multimodal judges agree with humans in pair comparison but diverge in absolute scoring ([MLLM-as-a-Judge, ICML 2024](https://arxiv.org/abs/2402.04788)). LLM judges show position bias, so run both orders and keep only consistent verdicts ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685), [Judging the Judges, arXiv 2406.07791](https://arxiv.org/pdf/2406.07791v8.pdf)). This is the same 2AFC design that BAPPS used for LPIPS ([Zhang et al.](https://openaccess.thecvf.com/content_cvpr_2018/papers/Zhang_The_Unreasonable_Effectiveness_CVPR_2018_paper.pdf)).
3. **Pair the candidate with fixed anchors**, not only with rivals: a known "pass" anchor and a known "near fail" anchor from section 5. Verdict = candidate beats the near-fail anchor in both orders and ties or beats the pass anchor. **[Inference]**
4. **Anchored rubric for the reasons**, not for the verdict: per criterion 1 to 5, with a reference that defines the top score and written descriptions per level ([Prometheus, arXiv 2310.08491](https://arxiv.org/abs/2310.08491v2)). **[Inference]** Add picture anchors at 1, 3 and 5 for each criterion.
5. **Calibration gate per session**: before real items, the judge grades 8 to 10 calibration pairs with known answers. If it gets fewer than 9 of 10, discard its verdicts. **[Inference]**
6. **Many candidates**: rank with pairwise wins and Elo or Bradley-Terry, as Pixel Art Bench does with an LLM judge on 24x24 grids ([Pixel Art Bench](https://www.emergentmind.com/pixel-art-bench)).
7. **Presentation**: nearest-neighbor upscale (8x to 12x), same scale, same gray background, optional 1 px grid, target always on the left. **[Inference]**
8. **Automatic gates first, judges second**: judges see only candidates that pass ranks 1 to 3. Mark gives the final 2AFC on finalists. **[Inference]**

## 7. Cost summary

- **Plain Node, no new deps** (pngjs already present): Step 0 search, ranks 1 to 8, shape context, calibration runs. Each is a loop over at most 1,024 cells; a full report over 75 poses runs in milliseconds. **[Inference]**
- **Node, one small zero-dep package**: SSIM via `@blazediff/ssim` ([README](https://cdn.jsdelivr.net/npm/@blazediff/ssim@1.7.1/README.md)).
- **Python + PyTorch (CPU is enough at 32 px)**: LPIPS ([PyPI](https://pypi.org/project/lpips/)), DISTS ([code linked from arXiv 2004.07728](https://arxiv.org/abs/2004.07728)), FID. Offline cross-check only.
- **LLM judge calls**: protocol section 6. Each pair costs 2 calls (both orders), plus 8 to 10 calibration pairs per session.

## 8. Recommended change list for the spike

1. Drop "exact match, no shift" as a gate and stop counting transparent cells. Replace with rank 5.
2. Replace global T and S bands with rank 8 (per part, absolute difference).
3. Add Step 0 (one shared transform), then gate on BF1, mIoU, chamfer and value r. Keep edge near-black at least 0.93 as a style lint, not a match score.
4. Label parts and landmarks on the 5 reference facings once. Keep them grader-only.
5. Build the section 5 calibration set before the next round. Set thresholds from it, not from the start values above.
6. Change judge prompts to target-only, pairwise, both orders, with anchors and a calibration gate.
