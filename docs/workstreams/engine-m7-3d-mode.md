---
type: workstream
title: M7 3D mode
branch: engine-m7-3d-mode
roadmap: M7
state: active
updated: 2026-10-12
---

M7 "3D mode": the brief (`docs/engine/m7-brief.md`) and survey are approved. Mark answered D1 A, D2 B, D3 A, D4 A (issues #77, #78, #79) and added a seamless, styled 2D/3D transition (D5: three styles, Mark picks from GIFs at the look checkpoint). Brief round 3 found a conflict in pass lines 19 and 20 (hold frames at `none`); fixed in 7e9ee05, Mark accepted the fix. Builder A done (tasks 1 to 4: door, data, seam, Scene3D grace, HackScene; 69fba4a, bb6bd1e). Builder B done (tasks 5 to 9: hidden skip, DEV entry points, the jack transition with three styles, budget, CI, docs; first play 394.9 kB). Mark picked the glitch style (D5) from the GIFs. Reader round 1 found 3 Important (fixed in 6d2bba4); round 2 passed them except a possible flake in the line 21 picture compare, which the full runner pass is measuring now. Then the GPU perf run and the PR.
