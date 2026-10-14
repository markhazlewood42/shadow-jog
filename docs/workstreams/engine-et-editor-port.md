---
type: workstream
title: ET Editor port
branch: engine-et-editor-port
roadmap: ET
state: review
updated: 2026-10-13
---

ET is built and passed the lean loop on 2026-10-13. Builder A did tasks 1 to 3 (survey re-check, specs, small tools, trailer delete). Builder B did tasks 4 and 5 (the stage save path and the Battle Stage Editor at `/stageedit.html`). Builder C did tasks 6 and 7 (Battle Test on the game's own BattleScene, the docs). Each passed a runner, a reader and, for the write paths, an attacker; the Record in `docs/engine/et-brief.md` has every round. Mark chose a narrow Battle Test exemption for pass line 2 and ratified the glue scope. The roadmap marks ET done. PR #86 is open. Its Claude review (18 findings) is triaged: 13 fixed and verified (PASS), 5 answered in the PR. Main is merged into the branch (2026-10-13). Next: Mark's playable checkpoint (pass line 17). After Mark merges the PR, M8 "Remove legacy" is a new phase.
