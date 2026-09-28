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
| 1 | Engine & code | 7.5 | 3 | 2026-09-28 | +0.3 | Debug API shipped in production; thin unit coverage outside battle/save (input, list, actor); per-frame allocations left in weather and banners |
| 2 | Field art | 7.4 | 3 | 2026-09-28 | +0.4 | Field sprites have no mouth/brow; bar interior bare; lamp-floor and car painters flat; Rustyard dirt too uniform; lab floor noisy; rain has one depth layer |
| 3 | Battle presentation | 7.0 | 3 | 2026-09-28 | 0 | Duplicate variants are hue-only; small FX vocabulary; bosses not scaled up; little character acting (no cut-ins); weak enemy tells |
| 4 | UI / UX | 8.2 | 3 | 2026-09-28 | +2.2 | Minor overflow in save/options labels; menu backdrop clips world signs; parent list not dimmed under battle submenus; shop doesn't say why an item is locked |
| 5 | Combat design | 7.0 | 3 | 2026-09-28 | 0 | No Rook+Sable combo; resistances and immunities not remembered; Lurker weak to three elements; few support enemies in random fights; Repeat works through boss telegraphs |
| 6 | Progression & economy | 6.5 | 3 | 2026-09-28 | −0.8 | Mods not validated by the sim; early stretch with nothing worth buying; Warden payout mistimed; Sable's gear moment missing |
| 7 | Narrative & writing | 8.0 | 3 | 2026-09-28 | +0.2 | Pale's distinctive beat comes late; final panel lacks a crescendo; log cluster too dense; Hex's anxious voice inconsistent; apostrophe styles mixed |
| 8 | Level design | 7.3 | 3 | 2026-09-28 | 0 | Puzzles are fetch-the-switch, not spatial; no hidden secret; overworld texture thin between POIs |
| 9 | Audio | 7.2 | 3 | 2026-09-28 | +0.7 | Short boss loops; battle music drops the field's reverb space; hard music cuts; no ducking under dialogue; Rustyard lacks a twangy timbre; no SFX rate limit |
| 10 | Feel & polish | 7.5 | 3 | 2026-09-28 | +0.1 | HP/TP bars jump instead of tweening; enemy damage numbers not above heads; no fast-forward hint in dialogue; no shake-intensity setting; short lunges |
| 11 | Stability | 7.3 | 3 | 2026-09-28 | −0.7 | Game loop has no error boundary (one throw freezes the game); saves not checked for unknown ids; title Continue/Load swallows a damaged save; header not validated |

## Round 4 work plan (in progress, last round before parking)

Per the rubric, an area still under 8.5 after this round is parked with its reasons.

- [x] **Stability**: per-scene fault isolation + rAF always rescheduled; a flow that keeps throwing recovers to the title (tested); unknown ids dropped at load (inventory, equip, uses, bestiary, combos, orders); header validation; `slotStatus` marks damaged slots in Load; Continue and Game Over use the newest *loadable* save (E2E); the party can never be emptied by a script.
- [x] **Combat**: Rook+Sable combo *Crow's Wing* (Guardian + Spirit Ward; a priority party guard that answers telegraphs); resistances and immunities remembered and shown (target info, bestiary); Lurker shock-only weakness (fire resisted); Rust Crab *Shell Wall* protector role + more support groups; Repeat disabled while a boss telegraphs.
- [x] **Engine**: debug API is DEV-only; unit tests for input, ListMenu, actor, game-loop faults; ListMenu scroll clamp fixed (found by a test).
- [x] **Economy**: alternative-build tests (every stage's gear must be obtainable; sidegrades must win within 5 points); mods in stage loadouts; `focus_rod` for Sable.
- [~] **Battle presentation**: combo cut-ins and crit-on-boss cut-in; enemy art tells (wisp core, turret sensors); skyline landmarks. Open: variants beyond hue, FX vocabulary.
- [ ] **Feel**: tween HP/TP bars; enemy floaters above heads; dialogue fast-forward hint; shake slider; longer lunge.
- [ ] **Audio**: longer boss loops; keep the field's space in battle; music crossfade-in; duck under dialogue; Rustyard twang; SFX rate limit.
- [ ] **Field art / Level / Narrative / UI**: remaining round-3 asks (see table).

## Round 3 work plan (done)

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
