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

| # | Area | Score | Round | Date | Δ | Blocking issues (short) |
|---|---|---|---|---|---|---|
| 1 | Engine & code | 7.2 | 2 | 2026-09-28 | +0.7 | Per-frame array allocs in BattleScene render/update; `noUncheckedIndexedAccess` off; no lint/CI; no frame-budget check; 1400-line BattleScene |
| 2 | Field art | 7.0 | 2 | 2026-09-28 | +1.5 | Neon hair on bulky styles reads as a ball; Sinkline too dark; empty flood arena; Rook's shades/beard illegible; arbitrary Annex terminal colours; sparse world stretches; floating light strings |
| 3 | Battle presentation | 7.0 | 2 | 2026-09-28 | +0.5 | Blank trash-mob faces; human mobs read as reskins; one pose per action kind; mirror flip invisible on symmetric sprites; thin gunfire FX; no party faces in battle UI |
| 4 | UI / UX | 6.0 | 2 | 2026-09-28 | 0 | **Cap:** compact party card numbers overflow (menu.ts renderCards); "Battles won 0" on ending evidence; unframed "Rook: missing"; silent autosave; shop detail vanishes on empty list; no long-word wrap |
| 5 | Combat design | 7.0 | 2 | 2026-09-28 | 0 | Enemy HP/weaknesses hidden unless Analyzed; Rook purely physical; trash fights resolve by attacking; no bestiary UI; Warden has no bespoke weakness; Auto allowed on bosses |
| 6 | Progression & economy | 7.3 | 2 | 2026-09-28 | +3.8 | No nudge to loot Annex gear before the Warden; bound_spirit+arcanist outlier; Nodachi price trap; tac visor = cyber eye; step counts hand-typed; Hex/Sable gear moments |
| 7 | Narrative & writing | 7.8 | 2 | 2026-09-28 | +0.2 | Shared hedge-joke cadence across the cast; ambiguous "her" in Pale's last line; betrayal confirmed 3× in advance; Rook's guilt has no setup; uniformly quippy NPCs; flat logs; thin Pale |
| 8 | Level design | 7.3 | 2 | 2026-09-28 | +0.1 | No Annex signage; objective only in menu; no connectivity test; dead lake/plaza space; no map screen; POIs don't feed the critical path |
| 9 | Audio | 6.5 | 2 | 2026-09-28 | −0.5 | Dry mix entirely mono (no panning); ~12 patches, no reedy/brassy timbre for the jazz bar; convolver buffer hot-swap can click; no audio checks in tests; held clashes (world bar 2, dungeon bar 2); no volume preview; no wall-bump SFX |
| 10 | Feel & polish | 7.4 | 2 | 2026-09-28 | +0.2 | Comic panels skip mid-sentence and ignore Text Speed; dialog eats the first tap for 100 ms; no perf log in evidence; per-frame sort in battle render |
| 11 | Stability | 8.0 | 2 | 2026-09-28 | +2.0 | Autosave failures silent; Game Over "Load" can drop to title wordlessly; "Saltreach" absent from GDD; migrations untested by a real bump; full-state clone per battle |

## Round 3 work plan (in progress)

- [x] **Engine**: pooled/cached enemy & party lists and floaters in BattleScene; ~~noUncheckedIndexedAccess~~ (on); ~~lint + CI~~ (Biome, GitHub Actions); ~~frame-budget E2E~~ (e2e/perf.spec.ts); perf log in evidence.
- [x] **UI/UX**: ~~compact card overflow~~; ~~frame "Rook: missing"~~; ~~realistic stage battle counts~~; ~~shop detail on empty list~~; ~~long-word wrap~~; autosave indicator + failure notice; wrap-safe battle top line.
- [x] **Field art**: ~~hair strands + neon rule~~; ~~Rook's shades/beard~~; brighter Sinkline fill light; debris in the flood arena; function-coded Annex terminals; world stretch landmarks; anchor light strings.
- [x] **Battle presentation**: ~~enemy faces~~; duplicate-enemy palette variants; per-ability attack/cast variants; stronger gunfire FX (muzzle flash, impact puff); party portrait in the battle panel.
- [x] **Combat**: enemy HP bars by default; remembered weaknesses surfaced on first hit; Rook utility/elemental option; bestiary page in the menu; Warden weakness; Auto disabled for bosses; more tactical trash groups.
- [x] **Economy**: loot nudge before the Warden; tune the outlier pair; Nodachi sidegrade; tac visor ≠ cyber eye; ~~map-derived step counts~~; Hex/Sable upgrade moments.
- [x] **Narrative**: per-character syntax pass; unambiguous final line; trim advance betrayal confirmations; seed Rook's guilt mid-chapter; vary NPC registers; escalate the Annex logs; give Pale texture.
- [x] **Level design**: Annex signage; persistent objective HUD line; ~~connectivity test~~ (found and fixed an unreachable NPC); use the lake/plaza dead space; POIs that feed the path.
- [x] **Feel**: panels share the dialog typing gate and Text Speed; no eaten first tap; perf log in evidence.
- [x] **Audio**: stereo panning of voices (unison spread, arps/plucks placed, bass/kick centre); crossfaded reverb space changes; a reed/brass patch for the bar; fix held clashes; volume-slider preview; bump SFX; a music-theory check in tests.
- [x] **Stability**: autosave failure notice; Game Over load failure message (+tests); GDD names Saltreach.

## Round 2 work plan (done)

Ordered by severity. Tick as done; re-verify each area after its batch lands.

- [ ] **Stability/Engine**: try/finally in warp/doWarp + `unhandledrejection` overlay; Game-over Load restores playFrames; gate Rustyard on `met_hex`; retry loop not recursion; wire `rngState`; save schema validation + unit tests; E2E forced-loss (Retry/Load/Title) + save→reload round trip; per-frame alloc cleanup (field render list, visibleActors, FxLayer, Input); memoize enemy layout + combos; combo integrity test; map cache cap; ESLint with no-floating-promises.
- [x] **Economy**: headless economy sim (critical path + expected encounters + chests + jobs + loot sales) asserting stage presets reachable without grinding; rebalance cred/prices; make smartpistol & formfit obtainable; remove shop/chest duplicates; add lateral gear choices; second tier-2 vendor near the Sinkline.
- [x] **UI/UX**: battle command window never over the actor; Techs list compact at bottom (battlefield visible); panel "X: skip" hint in its own padded slot; choice box via `measure()`; combo log scroll; ListMenu empty state; equip "(Remove)"-only message; stage presets get realistic play time.
- [x] **Field art**: dithered biome transitions on world map; Sinkline water edges/caustics/wet lips; new tent art; bald back-view NPC fix; separate forest tree vs street tree; varied ruins; floor wear.
- [x] **Battle presentation + feel**: party battle poses (attack/cast/hurt/victory), idle breathing; shake amplitude by hit tier + hitstop; floater easing fix; real shard shatter intro; sewer bg redo; ground from bg for all enemies; dupe variation; victory FX + cheer; status icons with letters; lab readout.
- [x] **Combat**: ~~sim policy exercises all abilities + all combos~~ (done, coverage test); Hijack uses the machine's own moves; wire `hp_below_half`/`every_3` on trash; party poison tool; Lurker second behaviour shift; remembered weaknesses shown on target cursor.
- [x] **Narrative**: ending pacing (thank-you on its own page; don't title Ch.2 "Rook, Taken"); cut double "run"; Rook personal line before the lift; Rook assent at the pod; fix Kit empty-stomach line; annex key acknowledgment; betrayal re-trigger guard; dock guard lines.
- [x] **Level design**: second puzzle (Annex relays) + Sinkline breaker; staged Lurker arena; 3–4 world POIs; reward redistribution; dock set dressing; Sinkline signposts; real Rustyard maze; reactive checkpoint guard.
- [x] **Audio**: sub levels; footsteps; boss2 drums; drum variety per context; per-location reverb space; battle melody bar 3; per-status SFX; equip SFX.

## Review log

<!-- newest first: date · area · score · verifier's top issues · what changed in response -->

### 2026-09-28 · Round 2 (all areas)
Scores in the table. Every area rose or held; none reached 8.5 yet. Stability (8.0) and narrative (7.8) are closest. Audio dropped 0.5: this reviewer judged mix and timbre (mono dry mix, patch variety) that round 1 didn't weigh. UI/UX is held at 6.0 by a real overflow in the compact party cards (fixed in round 3). Level-design's ask for a connectivity test immediately found a real bug: the canal fisher added in round 2 was on an unreachable street spur.

### 2026-09-28 · Round 1 (all areas)
Full verifier reports were delivered in-session; the blocking issues are summarized in the table and the work plan above. Verifier note: the economy reviewer missed the job board (it exists in `src/data/maps/interiors.ts`, bar `board` event); its cred-shortfall math still stands.
