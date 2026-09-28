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
| 1 | Engine & code | 7.7 | 4 | 2026-09-28 | +0.2 | Timer filter allocs every tick; CI perf gate too loose to prove 60fps; 1780-line BattleScene; global RNG shared across systems; formatter off; exactOptionalPropertyTypes off |
| 2 | Field art | 7.0 | 4 | 2026-09-28 | −0.4 | World-map road/barrens (and dock) ground reads as flat fog; cloned Annex tanks; Rustyard has no Rustfang faction dressing; Annex sub-rooms lack landmark props |
| 3 | Battle presentation | 7.3 | 4 | 2026-09-28 | +0.3 | Enemies have no attack/cast body animation or stagger frame; creature packs clone (variants only for humans); thin enemy HP bar on neon backdrops; bare Warden arena |
| 4 | UI / UX | 8.3 | 4 | 2026-09-28 | +0.1 | Status ability list unclamped; Game Over screen not in evidence; no remap/gamepad glyphs; toast near-miss with menu column |
| 5 | Combat design | 7.8 | 4 | 2026-09-28 | +0.8 | Non-boss AI is flat weighted-random; trash fights solvable with Auto; Guard is flat; no on-screen reason for Auto/Run lock-out |
| 6 | Progression & economy | 6.5 | 4 | 2026-09-28 | 0 | 10¢ capsule hotel (and 20¢ bar round) full-heal/revive/cure trivialise the healing economy; Noodles out-value Medkits; pacing unproven vs 45–75 min; ending evidence from a debug jump; Wire/Mags overlap |
| 7 | Narrative & writing | 7.5 | 4 | 2026-09-28 | −0.5 | Rook's quip undercuts Kit's panic; "he's alive" unearned; Rook's rescue decision thin in the moment; no quiet beat before the title card; homogeneous NPC quip register |
| 8 | Level design | 7.6 | 4 | 2026-09-28 | +0.3 | Lattice answer handed over on a memo; one secret in the chapter; plaza has no anchor landmark; no point-of-no-return warning or location list |
| 9 | Audio | 7.0 | 4 | 2026-09-28 | −0.2 | Shared master compressor pumps the score under SFX; lead/pad voices double-panned; no SFX ducking; single melodic voice per song; generic combo cue; instant boss phase-2 swap |
| 10 | Feel & polish | 7.8 | 4 | 2026-09-28 | +0.3 | Linear field movement; shake moves the HUD; shake defaults to Full; defeat has no weight beat; no dust on dash stops; instant menu cursor |
| 11 | Stability | 8.0 | 4 | 2026-09-28 | +0.7 | No beforeunload guard; autosave only on map change; E2E covers dev build only; no cross-tab save guard; migrate() doesn't re-version |

## Round 5 (beyond the rubric's 4-round cap)

Round 4 left every area under 8.5 (range 6.5–8.3). The rubric caps iteration at 4 rounds and then asks for an explicit
decision: **continue**. The user's bar is 8.5+, the remaining issues are concrete and cheap relative to the budget, and
several round-4 verifiers found genuinely new defects (healing economy, audio bus design, double panning) rather than
moving goalposts. Round 5 works each area's highest-leverage asks, then re-verifies.

### Round 5 work plan (done)

- [x] **Economy**: inn rests only the standing crew (revive/cure are the clinic's), priced by level; bar round restores TP not HP; Noodles rebalanced; Wire/Mags overlap cut; Sinkline encounter rate eased; pacing model test (58 min vs 45–75 target); finale stage for the results evidence.
- [x] **Audio**: separate music/SFX compressors into a limiter; self-spreading voices skip the outer panner; music dips under heavy hits; counter-melody generator on town/battle/boss; per-combo stings; phase-two swell.
- [x] **Stability**: unsaved-progress baseline; timed + tab-hidden autosave; beforeunload guard; two-tab guard; migrate re-versions; prod-build smoke E2E (fresh `vite build` + preview every run).
- [x] **Feel**: ease-out stops; dash dust; shake is world-only and defaults to Gentle; defeat beat; sliding menu highlight.
- [x] **Combat**: **bug — Guard never worked** (tried to spend a skill use); now free, halves damage, restores some TP. Turret spin-up and arcanist surge wind-ups with interrupts; lock-out reasons on the round menu; multi-hit spread.
- [x] **Battle presentation**: enemy strike/aim/cast motions and stagger; creature duplicate markings; sturdier enemy HP bars; the Warden's reactor room.
- [x] **Field art**: textured world roads and barrens; four tank specimens; Rustfang tags and banners; K-M crest.
- [x] **Narrative**: Rook's guilt at the decision; the crow's far sight set up; critical-path door-log warning; grave ending beat, capture shown, a quiet page; plainer background voices.
- [x] **Level design**: lattice memo is a partial clue; two new secrets (drowned locker room, tribute stash); plaza memorial; point-of-no-return prompt; Places page.
- [x] **UI**: Controls page with rebinding and pad names; legend from live bindings; clamps; toast placement; font gains ← and – (a real fallback box on the pump console) with a coverage test; Game Over/Options/Controls evidence.
- [x] **Engine**: in-place timers; three-part perf gate (sim, ratio to title, ceiling); split RNG streams; exactOptionalPropertyTypes on; BattleScene helpers split into battlekit/; formatter deliberately off (see status.md).

## Round 4 work plan (done)

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
