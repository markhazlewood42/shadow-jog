---
type: workstream
title: M8d remove legacy
branch: engine-m8d-remove-legacy
roadmap: M8d
state: active
updated: 2026-10-15
---

M8d deletes the old engine (`src/engine/{game,display,postfx,moments}.ts`), `LegacyScene` and the ET exemptions, moves the 11 kept `src/engine` files into `src/sje`, and does the docs, the 5 PR #86 follow-ups and the changelog (`docs/engine/m8-brief.md` tasks 10 to 21). The rubric is `docs/engine/m8d-rubric.md`, written before any code. Order: types and helpers (10, 11), delete (12, 13), the move (14), docs (15), follow-ups (16 to 20), changelog (21). Then fresh verifiers at the 8.5/10 gate, one `npm run perf` run on Mark's machine (removing `LegacyScene` edits `display/canvasimage.ts`), the PR, and Mark merges. Exit check: `tsc`, Biome and all specs green, nothing imports a deleted file, no `src/engine`.
