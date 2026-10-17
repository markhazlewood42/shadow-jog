---
type: workstream
title: Spike, Rook from a model (3D rendered to pixel sprites)
branch: spike/rook-3d
roadmap: E1
state: active
updated: 2026-10-17
---

Mark approved the spike on 2026-10-17. Exit criteria: docs/spikes/rook-3d.md (committed before code). Step 0 in the cloud: the Blender download host is blocked, apt gave Blender 4.0.2, which renders headless (Cycles, CPU). Built in scripts/art/rook3d/ (model, rig, keyframed motions, 8-facing renderer, checker, sheets, run.sh). Three build rounds are in docs/spikes/rook-3d/records.md: after round 3 all 34 frames pass the hard lines and two runs are byte-identical. Outputs in docs/spikes/rook-3d/out/ (contact-sheet.png, per-facing sheets, 8x previews). Verifier: pass on lines 1 to 6 (facing ID 10 of 10), no Critical or Important finding. Next: Mark's look gate (line 7, not done). Draft PR, never merged.
