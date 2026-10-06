---
type: design
title: "Shadow Jog Engine — Verification loops and rubrics"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-05
status: approved 2026-10-05 (final). First approval 2026-10-04. Phase 0 update on 2026-10-05 (the 640x360 numbers in B5 and V3), accepted with all recommendations
tags: [engine, design, verification]
---

# Shadow Jog Engine — Verification loops and rubrics

Every build step of the engine goes through an independent verification loop before it reaches you. This applies to the Phase 0 platform spike and to every milestone, M0 to M8 ([migration.md](migration.md)). Mark asked for this on 2026-10-04: "Make sure independent self-verification loops with reasonable rubrics are part of your implementation plan."

The rule is simple. The agent that writes the code never grades it. Fresh agents with different instructions grade it against a rubric that exists before the code.

---

## 1. The loop

![The engine verification loop. The exit criteria and rubric are written first. The builder agent builds and runs lint, types, unit tests and e2e. If its own checks fail, it fixes and runs them again. If they pass, three fresh verifier agents score the rubric. If all pass lines pass, every criterion median is at least 7 and the average is at least 8, the work goes to a visual update with screenshots for Mark, then a pull request with green CI and a Copilot review, and Mark merges milestones only. If the score fails in round 1 or 2, the findings go back to the builder. If it fails in round 3, the loop stops and reports to Mark with the evidence. That stop is the only exit that is not a pass. The builder never grades its own work, three rounds is the cap, and nobody lowers a pass line.](diagrams/engine-verification-loop.png)

*Editable source: [diagrams/engine-verification-loop.html](diagrams/engine-verification-loop.html)*

1. **Before the code.** The spike doc or the milestone section names the exit criteria (hard pass lines) and the rubric. Criteria written after the result do not count.
2. **The builder checks its own work** (lint, types, unit tests, e2e) and fixes it until those pass. This is necessary, but it is not verification.
3. **Three independent verifiers** score the rubric. Each is a fresh agent that did not write the code, with its own lens (section 2). Each score needs evidence: test output, a screenshot, or a `path:line`. A score with no evidence counts as 5 at most.
4. **Pass** needs all three of these:
   - every hard pass line passes,
   - the median score of every criterion is 7 or higher,
   - the average of the criterion medians is 8 or higher.
5. **Fail** sends the findings back to the builder. The loop has a cap of 3 rounds. After 3 failed rounds, the work stops and comes to you with the evidence. Nobody lowers a pass line to make a step pass.
6. **Your review** decides the look. Agents can check exactness, parity and stability. Only you decide "this is the vibe". Plan at least two review rounds where the look is new, with no maximum.
7. **The PR** gets the usual repo checks: CI green on software WebGL and a Copilot review. You merge milestone PRs. Spike PRs never merge.

---

## 2. The three verifier lenses

| Lens | What the verifier does | Main evidence |
|---|---|---|
| **Correctness and tests** | Runs the tests itself. Reads the diff. Checks each pass line. Tries to break the code: context loss, dispose and re-enter, odd window sizes, empty data. | Test output it ran, failing cases it found |
| **Design conformance and code quality** | Checks the code against this design: levels and imports (no `pixi.js` outside `src/sje/render` and `src/sje/display`, no `three` outside the 3D chunk), Phaser names, tagged deviations, comments a newcomer can follow, no dead code. | `path:line` references |
| **Visual and runtime** | Renders the result in Playwright on SwiftShader, and on the real GPU when local. Checks pixel exactness, parity with the reference, frame time, memory over repeated cycles. Produces the screenshots for your visual update. | Screenshots, pixel counts, timings |

A step with no visual part (for example M0's size module) uses a second correctness verifier in place of the visual one.

---

## 3. Rubrics

Scores run from 1 to 10. Anchors: **10** exemplary; **8** solid, with minor notes only; **7** acceptable, with named fixes that the step makes; **6 or lower** must be fixed before the step passes. "Not applicable" is allowed when a criterion does not fit the step, and the average then skips it.

### 3.1 Build rubric (code in the spike and in every milestone)

| # | Criterion | What 8 looks like |
|---|---|---|
| B1 | Pass lines met | Every exit criterion has evidence that a verifier reproduced. |
| B2 | Correctness | Logic, edge cases and error paths are right. Context loss, dispose and re-entry are handled where they apply. |
| B3 | Tests | The new risks have tests. The tests are deterministic and run in CI on software WebGL. |
| B4 | Design conformance | Follows [scene-graph.md](scene-graph.md), [frame-and-rendering.md](frame-and-rendering.md), [conventions.md](conventions.md) and the levels in [README.md](README.md). Every deviation is tagged. |
| B5 | Pixel fidelity | Snap to pixel, nearest filtering, integer scale. Zero non-uniform k-by-k blocks at every tested zoom (k is 3 on a 1080p screen at 640x360), or within the agreed tolerance. |
| B6 | Performance | Inside the frame budget. Bundle classes measured. No GPU object or memory growth over 10 enter-and-exit cycles. |
| B7 | Code clarity | Small units. Comments a newcomer to the engine can follow. Game code does not touch Pixi. |
| B8 | Docs and records | `CHANGELOG.md` entry (milestones). `docs/CONCEPTS.md` and `docs/GLOSSARY.md` rules followed. The design docs updated where the code differs. |

### 3.2 Visual rubric (the parts an agent can check)

| # | Criterion | What 8 looks like |
|---|---|---|
| V1 | Exactness | Every game pixel is an exact block at every tested integer zoom and device pixel ratio. |
| V2 | Parity | The frame matches its reference (today's game, or the Phaser spike) within the agreed tolerance, with the differences listed. |
| V3 | One pixel grid | 2D, HUD and 3D share one grain. No mixed pixel sizes that the design does not name. The named grains are 320x180 (grain 2) and 160x90 (grain 4). |
| V4 | Stability | No flicker on transitions. Shimmer in motion stays inside the agreed metric. |
| V5 | Legibility | Text and HUD read clearly at 1x and at the common zooms. |

The look itself (color, mood, "this is the vibe") is not in the rubric. It is your call in your review.

### 3.3 Spike report rubric (Phase 0)

| # | Criterion | What 8 looks like |
|---|---|---|
| S1 | Answers the questions | Each exit question has a clear yes, no or "not tested", with the reason. |
| S2 | Reproducible evidence | The scripts are on the spike branch. A verifier re-ran the key ones and got the same result. |
| S3 | Honest limits | What was not tested is listed (browsers, GPUs, sizes). |
| S4 | Sound recommendations | Each design update follows from the evidence. |

---

## 4. Visual updates to Mark

Mark (2026-10-04): "I want to see VISUAL updates on your progress. Whenever you're testing something with a visual component, give me an update."

- Each time a test renders something, the main session sends the screenshots to Mark right away. Each image gets a one-line caption: what it shows, and what passed or failed.
- Side-by-side images are the default: new engine against the reference, or before against after.
- Workflow agents cannot send files. They save the images, and the main session sends them after each workflow step.
- Screenshots go to the session scratch folder and are deleted at the end of the task. Chosen comparison images are kept in the git-ignored `media/` folder.

---

## 5. Records

- **Spike:** the rubric table (median per criterion, rounds used, pass lines) goes into the Result section of the spike doc.
- **Milestones:** the same table goes into the PR description.
- **Raw verifier reports:** `media/verification/<step>/` (git-ignored, Mark's machine only).
