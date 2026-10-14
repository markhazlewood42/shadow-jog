---
type: workstream
title: M8a UI kit and shop/dialogue data
branch: engine-m8a-ui-kit
roadmap: M8a
state: review
updated: 2026-10-14
---

The M8 brief is approved (`docs/engine/m8-brief.md`). M8 is four phases, each its own branch and PR: M8a (this branch: UI kit, shop and dialogue data), M8b (13 UI scenes), M8c (battle and field), M8d (delete the old engine, move `src/engine` into `src/sje`, docs, follow-ups). Quality gate: every verifier scores at least 8.5 of 10, smallest models. M8a is built (UI kit in `src/sje/ui`, shop and dialogue data, format approved by Mark: option C). Verified: round 1 found 1 Important and 4 Minor, fix round 1 passed at 8.7/10. Bundle caps raised with Mark yes. Data items (d) and (e) deferred to M8b with Mark yes. PR open for Mark to merge. Pending: one `npm run perf` (main session). Next: M8b on a new branch after M8a merges.
