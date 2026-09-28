---
type: log
title: Shadow Jog — Quality Scorecard
project: shadow-jog
created: 2026-09-27
updated: 2026-09-28
tags: [quality, scorecard]
---

# Scorecard

Latest verifier score per area (see `rubric.md`). Target ≥ 8.5 everywhere.

| # | Area | Score | Round | Date | Commit | Blocking issues (short) |
|---|---|---|---|---|---|---|
| 1 | Engine & code | 6.5 | 1 | 2026-09-28 | 1b6d… (status) | Warp path has no try/finally (can softlock silently), per-frame allocs, save untested/unvalidated |
| 2 | Field art | 5.5 | 1 | 2026-09-28 | ″ | World biomes hard rectangles, Sinkline water flat, placeholder-looking tents (cap), bald back-view NPCs |
| 3 | Battle presentation | 6.5 | 1 | 2026-09-28 | ″ | Sewer bg illegible, non-boss ground hardcoded 92, identical dupes, flat victory, status pips unlabeled |
| 4 | UI / UX | 6.0 | 1 | 2026-09-28 | ″ | Command window covers actor, Techs stacks 3 windows, "X: skip" clipped (cap), choice width guess |
| 5 | Combat design | 7.0 | 1 | 2026-09-28 | ″ | Sim covers ~40% of kit / 1 combo, Hijack shallow, flat trash AI, unused AI hooks, Lurker thin |
| 6 | Progression & economy | 3.5 | 1 | 2026-09-28 | ″ | Cred path ≈2.4k¢ vs assumed gear ≈5–6k¢ (grind cap), smartpistol/formfit unobtainable, no economy sim |
| 7 | Narrative & writing | 7.6 | 1 | 2026-09-28 | ″ | Ending thank-you undercuts cliffhanger, double "run" beat, Rook has no personal line |
| 8 | Level design | 7.2 | 1 | 2026-09-28 | ″ | One puzzle only, no Lurker arena, sparse world map, bare dock, Sinkline signage |
| 9 | Audio | 7.0 | 1 | 2026-09-28 | ″ | Sub-bass buries melodies, no footstep SFX, boss2 reuses battle drums, one reverb space |
| 10 | Feel & polish | 7.2 | 1 | 2026-09-28 | ″ | No party battle poses, shake amplitude flat, floater `*0` bug, no hitstop, static idle party |
| 11 | Stability | 6.0 | 1 | 2026-09-28 | ″ | Game-over Load doesn't restore playFrames, Dutch/Pale beat skippable, no lose/save E2E |

## Round 2 work plan (in progress)

Ordered by severity. Tick as done; re-verify each area after its batch lands.

- [ ] **Stability/Engine**: try/finally in warp/doWarp + `unhandledrejection` overlay; Game-over Load restores playFrames; gate Rustyard on `met_hex`; retry loop not recursion; wire `rngState`; save schema validation + unit tests; E2E forced-loss (Retry/Load/Title) + save→reload round trip; per-frame alloc cleanup (field render list, visibleActors, FxLayer, Input); memoize enemy layout + combos; combo integrity test; map cache cap; ESLint with no-floating-promises.
- [x] **Economy**: headless economy sim (critical path + expected encounters + chests + jobs + loot sales) asserting stage presets reachable without grinding; rebalance cred/prices; make smartpistol & formfit obtainable; remove shop/chest duplicates; add lateral gear choices; second tier-2 vendor near the Sinkline.
- [x] **UI/UX**: battle command window never over the actor; Techs list compact at bottom (battlefield visible); panel "X: skip" hint in its own padded slot; choice box via `measure()`; combo log scroll; ListMenu empty state; equip "(Remove)"-only message; stage presets get realistic play time.
- [ ] **Field art**: dithered biome transitions on world map; Sinkline water edges/caustics/wet lips; new tent art; bald back-view NPC fix; separate forest tree vs street tree; varied ruins; floor wear.
- [ ] **Battle presentation + feel**: party battle poses (attack/cast/hurt/victory), idle breathing; shake amplitude by hit tier + hitstop; floater easing fix; real shard shatter intro; sewer bg redo; ground from bg for all enemies; dupe variation; victory FX + cheer; status icons with letters; lab readout.
- [ ] **Combat**: ~~sim policy exercises all abilities + all combos~~ (done, coverage test); Hijack uses the machine's own moves; wire `hp_below_half`/`every_3` on trash; party poison tool; Lurker second behaviour shift; remembered weaknesses shown on target cursor.
- [ ] **Narrative**: ending pacing (thank-you on its own page; don't title Ch.2 "Rook, Taken"); cut double "run"; Rook personal line before the lift; Rook assent at the pod; fix Kit empty-stomach line; annex key acknowledgment; betrayal re-trigger guard; dock guard lines.
- [ ] **Level design**: second puzzle (Annex relays) + Sinkline breaker; staged Lurker arena; 3–4 world POIs; reward redistribution; dock set dressing; Sinkline signposts; real Rustyard maze; reactive checkpoint guard.
- [ ] **Audio**: sub levels; footsteps; boss2 drums; drum variety per context; per-location reverb space; battle melody bar 3; per-status SFX; equip SFX.

## Review log

<!-- newest first: date · area · score · verifier's top issues · what changed in response -->

### 2026-09-28 · Round 1 (all areas)
Full verifier reports were delivered in-session; the blocking issues are summarized in the table and the work plan above. Verifier note: the economy reviewer missed the job board (it exists in `src/data/maps/interiors.ts`, bar `board` event); its cred-shortfall math still stands.
