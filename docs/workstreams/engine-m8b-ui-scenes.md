---
type: workstream
title: M8b UI scenes
branch: engine-m8b-ui-scenes
roadmap: M8b
state: review
updated: 2026-10-14
---

M8b is built in three phases on this branch. Phase 1: card, controls, gameover, ending, placemap and saveload, with `ActionMap.keyName` and the `UiScene` base. Phase 2: options, dialog, title and shop, with `snapshot`, `restore` and `step` on dialog and shop. Phase 3: deck, panels and menu, with a small `ViewBuilder` helper (`src/scenes/uiview.ts`) for pages that are built again when what they show changes. All 13 UI scenes are native `sje` scenes; only `battle.ts` and `field.ts` still extend the old `Scene` (M8c). Unit tests, the layout tests and the pass line 6 specs are green. Pictures of every scene are in `media/m8-ui/` (git-ignored) for Mark. Pending: the verifier gate (rubric in `docs/engine/m8b-rubric.md`), Mark's look at the pictures, and one `npm run perf` only if the main session finds a diff in `src/sje/render`, `display` or `three` (there is none from this phase). Next: M8c (battle and field) on a new branch after M8b merges.
