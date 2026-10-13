---
type: workstream
title: M7 3D mode
branch: engine-m7-3d-mode
roadmap: M7
state: active
updated: 2026-10-12
---

M7 "3D mode": the brief (`docs/engine/m7-brief.md`) and survey are approved. Mark answered D1 A, D2 B, D3 A, D4 A (issues #77, #78, #79) and added a seamless, styled 2D/3D transition (D5: three styles, Mark picks from GIFs at the look checkpoint). Brief round 3 found a conflict in pass lines 19 and 20 (hold frames at `none`); fixed in 7e9ee05, Mark accepted the fix. Builder A done (tasks 1 to 4: door, data, seam, Scene3D grace, HackScene; 69fba4a, bb6bd1e). Builder B done (tasks 5 to 9: hidden skip, DEV entry points, the jack transition with three styles, budget, CI, docs; first play 394.9 kB). Mark picked the glitch style (D5) from the GIFs. Lean loop passed (runner: pass lines 1-16 and 18-24 hold; reader round 2 PASS; Minor fixes 6525669). GPU perf run 1: M7 cases pass; 2 old 2D cases failed (field cost p95 9.6 ms, live battle coverage), being re-run to tell noise from a regression. Then the perf record and the PR.
