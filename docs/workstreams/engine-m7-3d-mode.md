---
type: workstream
title: M7 3D mode
branch: engine-m7-3d-mode
roadmap: M7
state: active
updated: 2026-10-12
---

M7 "3D mode": the brief (`docs/engine/m7-brief.md`) and survey are approved. Mark answered D1 A, D2 B, D3 A, D4 A (issues #77, #78, #79) and added a seamless, styled 2D/3D transition (D5: three styles, Mark picks from GIFs at the look checkpoint). Brief round 3 found a conflict in pass lines 19 and 20 (hold frames at `none`); fixed in 7e9ee05, Mark accepted the fix. Builder A done (tasks 1 to 4: door, data, seam, Scene3D grace, HackScene; 69fba4a, bb6bd1e). Builder B done (tasks 5 to 9: hidden skip, DEV entry points, the jack transition with three styles, budget, CI, docs; first play 394.9 kB). Mark picked the glitch style (D5) from the GIFs. Lean loop passed (runner: pass lines 1-16 and 18-24 hold; reader round 2 PASS; Minor fixes 6525669). GPU perf: pass lines 17 and 25 hold (HackScene cost p95 2.7 ms, jump 3.0 to 3.7 ms). Two old 2D cases failed run 1; an A/B against `main` (3 runs each) shows noise, not a regression (field cost p95 `main` 6.1 to 6.3 ms, M7 5.9 to 6.2 ms). Recorded in `tooling-and-testing.md` section 7. Next: the PR, its review, then Mark's checkpoint (line 26).
