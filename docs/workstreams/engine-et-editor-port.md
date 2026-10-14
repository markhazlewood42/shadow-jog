---
type: workstream
title: ET Editor port
branch: engine-et-editor-port
roadmap: ET
state: review
next_for_mark:
  - Do the ET playable checkpoint (stageedit.html, Battle Test, FX lab) and look at the 10 pictures in media/et-editors
  - Merge the ET PR #86, or name fixes
updated: 2026-10-13
---

ET is built and passed the lean loop on 2026-10-13. Builder A did tasks 1 to 3 (survey re-check, specs, small tools, trailer delete). Builder B did tasks 4 and 5 (the stage save path and the Battle Stage Editor at `/stageedit.html`). Builder C did tasks 6 and 7 (Battle Test on the game's own BattleScene, the docs). Each passed a runner, a reader and, for the write paths, an attacker; the Record in `docs/engine/et-brief.md` has every round. Mark chose a narrow Battle Test exemption for pass line 2 and ratified the glue scope. The roadmap marks ET done. PR #86 is open for the Claude Code Review and Mark's playable checkpoint (pass line 17). After the merge, M8 "Remove legacy" is a new phase.
