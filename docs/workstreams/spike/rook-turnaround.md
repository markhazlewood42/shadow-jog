---
type: workstream
title: Spike, Rook turnaround in the Sprite Fusion style
branch: spike/rook-turnaround
roadmap: E1
state: active
updated: 2026-10-17
---

Mark approved the spike doc and the 80-agent cap on 2026-10-17. Steps 0 to 2 are done: medium A (pixel grid) beat B (height map) in all 6 grader picks. Step 3 tooling passed the lean loop. Step 3 stage 1 (silhouette thumbnails) is done at its cap of 3 rounds: up, right and up-right passed; down goes on with named fixes (head too wide). Stage 2 (blockout) passed on all 4 facings in 2 rounds. Stage 3 (flat colors) passed on all 4 facings in 1 round. Stage 4 (shading): both graders passed round 8, but Mark stopped step 3 on 2026-10-17: the set is not close to the Sprite Fusion target, and the stage-by-stage grading did not measure that gap. Next: step 3b, a head test (recreate the given head exactly from pictures), from a Fable consult (docs/spikes/rook-turnaround/head-test-plan.md). Head-test tools passed (3 rounds). Head test round 1 (Level 0, 3 Sonnet writers) PASSED: 99.6 percent exact, both graders pass, the blind pick is at chance. Step 3c: a Fable consult wrote the whole art pipeline plan (docs/spikes/rook-turnaround/art-pipeline-plan.md); verifier round 1 FAIL, fix round PASS. Mark approved the plan on 2026-10-17. Step 0 tools passed the lean loop in 2 rounds (the right-facing proxy fails 4 lines; it blocks only the right facing). The held-out invention test (6a) FAILED (best exact 59 percent on the coat, 49 on the hair, line 60; tolerant at most 61, line 80). Per the plan, 6b is not run and the invented facings drop. Waiting on Mark for the next step. Mark added 5 Sprite Fusion facings as a grading reference. Mark lifted the agent cap. Records: docs/spikes/rook-turnaround/records.md. Draft PR #142, never merged.
