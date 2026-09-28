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
| 1 | Engine & code | 7.7 | 6 | 2026-09-28 | −0.5 | BattleScene still one class for flow, playback, layout and rendering (split EventPlayer/Renderer); economy.spec not in CI; FieldScene 923 lines; dense non-null assertions in combo/target resolution; `Input.dir()` allocates per tick |
| 2 | Field art | 7.2 | 6 | 2026-09-28 | +0.7 | Annex rooms read as one room (no per-wing accent/props); Rustfang tag illegible; faces don't survive play-camera distance; tank specimens all read alike; crowd shares one silhouette per body; world ground lacks macro detail |
| 3 | Battle presentation | 7.6 | 6 | 2026-09-28 | +0.4 | Enemies have no attack keyframe (lunge is an offset); hit-flash frame reads as a glitch in a still; human duplicates only a skin swap; no foreground framing layer in backdrops; generic enemy cast/aim motion |
| 4 | UI / UX | 8.0 | 6 | 2026-09-28 | +2.0 | Rook's battle card has no bar under SKILL; notice banner hard-slices text; shop compare / equip-reason lines unclamped and untested; GDD control table disagrees with Controls screen |
| 5 | Combat design | 7.5 | 6 | 2026-09-28 | +0.7 | Combos almost never fire in trash; bosses won 92–99% by a competent (not optimal) player vs a 70–75% design floor; trash over in 2–3 rounds; human shock weakness mild; Rook's uses in no-rest runs unverified; Guardian silently doesn't cover AoE |
| 6 | Progression & economy | 8.1 | 6 | 2026-09-28 | +0.9 | No endgame cred sink (900–1,150¢ idle); trash nearly risk-free; no-grind proven only with optional chests opened; GDD level cap (20) vs MAX_LEVEL 30; top-tier gear chest-only with no buyable fallback |
| 7 | Narrative & writing | 8.0 | 6 | 2026-09-28 | 0.0 | Shared trail-off/deflate joke rhythm (Dutch, Hex, Mags); the cryopod reveal is compressed; Pale's motive for Kit vague; corporate satire never escalates; Pale's intro monologue long; Hex's anxious self-narration twice in her arc |
| 8 | Level design | 7.2 | 6 | 2026-09-28 | +0.2 | Annex wings indistinguishable; Rustyard maze has no signposts; flooded junction an undifferentiated lake; boxy rect geometry, no set-piece shapes; maze secret shallow |
| 9 | Audio | 7.2 | 6 | 2026-09-28 | −0.6 | No rendered audio evidence; bare-oscillator timbres thin; fully quantized, accents unused, little swing; Game Over cue ends and leaves silence; music/SFX gain asymmetry; crit ducking may pump |
| 10 | Feel & polish | 7.0 | 6 | 2026-09-28 | −0.2 | **Bug:** Pale's speech bubble covers his own portrait on the finale panel (`dx` portraits); **bug:** WEAK!/CRITICAL label and the damage number still overlap during the first frames; victory bars start slow |
| 11 | Stability | **8.7** | 6 | 2026-09-28 | +0.5 | **PASS.** Nice-to-haves: Firefox in CI; step-chain migrations; unused `game.paused` is a softlock trap; no two-tab E2E |

## Round 7 (in progress)

Worked the round-6 findings, bugs first.

- [x] **Feel**: speech bubbles placed from the portrait's drawn rect (Pale's face was covered on the finale panel), tested over every panel; floater labels and numbers ride the same motion 12px apart and stack downward at the top edge.
- [x] **UI**: Rook's battle card has a uses bar; the notice banner wraps and ellipsizes; shop compare and equip text clamped and measured in the layout test; GDD controls and level cap match the game.
- [x] **Level / field art**: the Annex wings read as different places (floors, wall trim by wing, lights, props; drained pods beside Sable's); Rustyard maze signs; a legible Rustfang tag; new pylon and pipe painters (the coverage test caught two declared kinds with none).
- [x] **Combat**: combos in ordinary fights (Thunder Rift arcs through the pack; the sim fuses whenever it pays, dungeon runs too); a test that fusing pays on every trash table; Sinkline trash tougher; bosses capped at 93% for a competent player (Knuckles 99% → 91%); Rook's charges tracked per dungeon (never dry); Guardian announces blasts it can't cover.
- [x] **Audio**: offline renders of every song and effect through the real mix, with measurements and spectrograms (docs/quality/evidence/audio*); from them: a shaped music bus (sub trimmed, presence lifted, saturation, chorus), calibrated per-effect levels (a hit sat 15 dB under the music), humanised timing and velocity, accents, drum-free intros, rate-limited hit ducking; the Game Over cue loops.
- [x] **Narrative**: voices stop sharing one joke shape; a breath after the cryopod reveal; Pale's motive for Kit stated; the checkpoint's satire darkens as the crew closes in; Dutch no longer echoes the cargo framing.
- [x] **Battle presentation**: strike frames for rats, hounds and drones; a hit flash that doesn't blank the sprite; squad armbands on human duplicates; foreground framing on four backdrops.
- [x] **Economy**: a minimal-exploration Monte Carlo (off-path chests measured from the real route) — Pale's expenses make every checkpoint ≥87% affordable without them; Requisition sells the lab's top gear and a Neural Lace (the endgame sink).
- [x] **Stability**: Firefox in CI; a two-tab E2E; migrations as a versioned chain.
- [x] **Engine**: battle playback moved to battlekit/playback.ts behind a narrow PlaybackView; display types to battlekit/types.ts (BattleScene 1,574 → ~1,380 lines).

## Round 6 (verified 2026-09-28)

Verifier spread is now visible: the same build scores ±0.5–1.0 between independent reviewers. Round 6 prioritised the
defects that are real regardless of reviewer (the objective overflow, the floater collision, the reverb reset, the
human-weakness gap, the barrens regression), then the recurring asks.

### Round 6 work plan (done)

- [x] **UI**: the menu objective wraps and grows its box; combo and level-up text clamp; `measure()` needs no canvas; a layout test measures every data string against its box. Places: every place has a map (exits labelled, you-are-here).
- [x] **Battle presentation**: one per-target floater anchor with stacking (no more number/status collisions); DoT ticks sink; victory banner, tallies and per-member XP bars that roll over on a level-up; dimmer lab windows; rats and hounds with anatomy per individual; basic attacks land with a contact star, afterimage, speed lines and debris.
- [x] **Combat**: humans weak to shock; Guard's TP only every other round; an Auto baseline test (past the street, Auto loses fights and bleeds ≥1.8× the HP; bosses ≤30% wins).
- [x] **Stability**: saves reject non-finite and off-map numbers and clamp out-of-range ones; storage that throws on read is treated as empty; unload-prompt E2E on the shipped build; WebKit on CI.
- [x] **Audio**: reverb/echo returns through the music bus (volume, compressor, ducks); every song declares its space, fights/jingles/cues keep the room (`here`), town is a `room`, maps can name a space; music-volume chime.
- [x] **Narrative**: Pale's brass watch; Kit's own reason before the pod; Hex's meme lines rewritten; GDD ending synced.
- [x] **Perf / engine**: sprites lit on per-size scratch canvases (the field on a software canvas: 24 → 4.4 ms on CI); honest CI gate (strict sim; 60 fps p95 on software); CI green again; input-latency E2E (≤1 frame median); audio unlock no longer hitches the first keypress; typed option steps; no casts in the debug API; BattleScene split (intro, banner, orders + tests).
- [x] **Field art**: distinct faces for every lead; clean cast lineup; calm barrens; prop fallback is crates + an error (tested); a legible sleeper in the pod and an empty, shattered pod after the rescue; bar dressing; the plaza crowd in knots; Sinkline pools with waterlines and ripples.
- [x] **Level design**: the drained junction and the dying lattice are shown on camera; both secrets need a clue first.
- [x] **Economy**: Monte Carlo route model with clinic costs from simulated down rates (it found CP3 affordable in only 37% of runs); three story-grounded cred sources; every checkpoint ≥97% affordable (gated at 90%); E2E walks the Barrens into a paying fight and buys from a shop.
- [ ] Deliberately deferred: a second mechanic per dungeon; Warden arena terrain; optional alternate combo recipes.

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
