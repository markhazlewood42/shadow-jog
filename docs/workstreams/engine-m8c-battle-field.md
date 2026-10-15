---
type: workstream
title: M8c battle and field
branch: engine-m8c-battle-field
roadmap: M8c
state: active
updated: 2026-10-15
---

M8c ports the battle and field scenes (and their kits) to native `sje` scenes over `BattleStageScene` and `FieldStageScene` (`docs/engine/m8-brief.md` tasks 8 and 9). Order: rubric first, then a builder for battle (group E), then one for field (group F), then a builder for the kit port of the battle and field windows (group G, Mark's decision of 2026-10-15), then fresh verifiers at the 8.5/10 gate. Exit check: the seed 7 battle trace holds and the playthrough and parity specs are green. Done: groups E, F and G. Next: verification of the kit port (the M8c rubric, `docs/engine/m8c-rubric.md`).
