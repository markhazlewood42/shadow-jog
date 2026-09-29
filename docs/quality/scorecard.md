---
type: log
title: Shadow Jog — Quality Scorecard
project: shadow-jog
created: 2026-09-27
updated: 2026-09-29
tags: [quality, scorecard]
---

# Scorecard

Latest verifier score per area (see `rubric.md`). Target ≥ 8.5 everywhere.

| # | Area | Score | Round | Date | Δ | Blocking issues (short) |
|---|---|---|---|---|---|---|
| 1 | Engine & code | 8.2 | 12 | 2026-09-29 | −0.1 | Victory and Level-Up panels drawn inside BattleScene, not the renderer; two per-frame closures (lighting build, FX render); `!` still common outside engine/battle; bundle at 189.5 of 200 kB gzip |
| 2 | Field art | 7.8 | 12 | 2026-09-29 | +0.3 | Crowd is three rigs in many palettes; portraits have one expression (Dutch); Sprawl terrain blurs path and clutter under rain; dungeon corners drop to black; the bar is under-dressed |
| 3 | Battle presentation | 7.3 | 12 | 2026-09-29 | +0.8 | The swing moves the sprite and blade but the torso never leans (the reviewer's "doesn't move at all" was wrong; see round-12.md); beast packs marked by a faint scar vs the machines' numerals; HP bars against neon signage; FX are small rect particles; flat victory screen |
| 4 | UI / UX | 8.2 | 12 | 2026-09-29 | −0.5 | Full-screen menus snap open (only dialogue and game over ease in); item icons are glyphs; disabled text about 2.75:1 contrast; one window chrome for everything; confirms have no cursor |
| 5 | Combat design | 8.0 | 12 | 2026-09-29 | +0.2 | Trash clears in about 2 rounds; tells on 4 of 18 enemies; the sim leans on Thunder Rift; no balance target needs timed presses; crit bonuses spread 15 to 60 without a stated reason; guard with a perfect brace takes 87.5% off the cannon, untested |
| 6 | Progression & economy | 7.6 | 12 | 2026-09-29 | ±0 | Required gear is never a budget decision (unlucky tenth keeps 334 to 781¢); the Neural Lace (1,200¢) sits below the Warden median spare (1,222¢); loot only sells; no crafting; the equip screen lacks the shop's element line |
| 7 | Narrative & writing | 8.2 | 12 | 2026-09-29 | +0.4 | Dutch's and the cryopod scenes run long unbroken; the satsuma callback repeats its clause; tutorials sit bare against noir lines; two modern quips; Pale stacks tics; Knuckles has no speaker colour; the S-5/S-6 thread isn't paid off |
| 8 | Level design | 7.8 | 12 | 2026-09-29 | ±0 | Every room is a rectangle; the Warden arena is a blank box; one dungeon; catwalks read flat (no height cue); one maze; both floors share a palette; the Places map marks nothing undiscovered |
| 9 | Audio | 7.8 | 12 | 2026-09-29 | +0.6 | One bright bus EQ for every mood (6 kHz+ 10 to 22% everywhere); title and boss seams at +1.2 and +1.0 dB (gate 1.5); battle bass-heavy (33% under 120 Hz); victory flat and bright; the swing whoosh is quiet |
| 10 | Feel & polish | 8.3 | 12 | 2026-09-29 | −0.1 | The boss-crit face slides in from off-screen (caught clipped in shot 15); it's skipped while another cut-in is up; the smear sits on the raise, not the cut |
| 11 | Stability | 8.6 | 12 | 2026-09-29 | −0.4 | **Passed.** Settings crashed the boot where storage is blocked (fixed after the review, with a test); no gamepad or touch E2E; no long-session soak; the chaos test doesn't assert it reached the round; CI is one sample per run |

Round 12 note (the closing measurement): average 7.98 (round 11: 7.87), the highest of the twelve rounds. Stability
passes (8.6). The two areas that had been flat moved: Battle presentation 6.5 to 7.3, Audio 7.2 to 7.8. Against the
fallback proposed with the exit: average 7.98 (short of 8.0 by 0.02), no area below 7.0 (met; lowest 7.3), no open
bugs (met: the one bug found, a boot crash where browser storage is blocked, was fixed the same day with a test).
The automated loop ends here; Mark's playthrough is the gate. Verbatim reports: `reviews/round-12.md`.

Round 11 note: average 7.87 (round 10: 7.74). Stability (9.0) and UI/UX (8.7) pass; Engine slipped to 8.3 under a
reviewer counting non-null assertions and file sizes. Battle presentation fell to 6.5: the new swing only moved the
sprite, and the bosses had no drawn frames, both fixed first in round 12.

Round 10 note: average 7.74 (round 9: 7.27). The first two areas pass: Stability 8.8 and Engine 8.5. Both caps from
round 9 are lifted (UI 5.5 → 7.6, Field art 5.8 → 7.0). Feel dropped 0.5 under a reviewer weighing animation depth
(a held pose on a lunge curve, not a multi-frame swing).

Round 9 note: average 7.27 (round 8: 7.57). Six areas rose (Feel 8.3, Stability 8.3 and Engine 8.0 are the closest
to target), but two automatic caps pulled the average down: a real bug introduced this round (the turn-order strip paints
over the description line) and the Warden arena floor judged as a debug-looking test pattern. Combat fell 0.9 under a
reviewer who weighed the new timing layer as one global curve.

Round 8 note: average 7.57 (round 7: 7.35); eight areas rose. Stability reached 8.0 and combat held at 8.1. The
reviewers found three new bugs from the evidence: a render-only fault loop that never recovers, a hard cut into Game Over,
and a bar interior that leaves black bands.

Round 7 note: the evidence got richer (audio measurements, more screenshots, more tests) and reviewers used it to find
new, concrete defects — several real bugs (text collisions, the Warden's hidden head, the menu's hidden Close, a stale
save baseline, a continuity slip). Reviewer spread remains ±0.5–1.0 per area; the trend is judged on defects fixed.

## Round 12 (verified 2026-09-29, the closing measurement)

Worked the round-11 findings, the lowest area (battle presentation) first.

- [x] **Battle presentation**: the swing is an arc in four beats (gather, raise, cut with a lit trail on a new follow-through frame, settle); the Lurker and both Warden forms have drawn strike and flinch frames (shot 16c); the street backdrop has its far kerb of shops; window frames carry circuit trim.
- [x] **Audio**: a real top end (6 kHz+ from 2–9% to 10–21%, the bar 2% to 15%); rest bars are breakdowns (bass and sub out, chords pulled back), with in-song range for battle 1.2 to 3.8 dB; bells without the onset click; the quiet cues thinned.
- [x] **Combat**: Knuckles names his mark a turn before a wound-up haymaker (the first tell, taught at the first boss; retuned to 81% / 86%); the Arcanist's surge breaks under pressure (a different answer from the turret's jam and the Warden's guard); capstones inside the chapter's level range.
- [x] **Feel**: hit-pauses shorten with Battle Speed and fast-forward; comic panels keep an early press.
- [x] **Engine**: engine/ and battle/ hold no non-null assertions (must() names what's missing; biome enforces it there); the battle system is its own lazily loaded chunk (boot chunk 558 to 452 kB), budgets re-set with the reasoning in the script, bundle evidence archived; the software perf gate has headroom.
- [x] **Progression**: Hedda's cart carries Mags' stock (and discount) in town; the shop explains elements; the driven run's shot is named as such; a test shows the crew can't buy everything it wants.
- [x] **Narrative**: Pale peels a satsuma in one spiral, counts the segments (eleven, at the dock), never eats it; the Annex mail reads as accounting, so the dock still turns; Kit acts before the flashbang (a choice); Hex trimmed.
- [x] **Level**: the lattice's loom shows which relay feeds which emitter (the memo is wrong, the cables aren't); the Lurker's lure glows in the sump before the fight; a test walks every map at all 25 story stages for dead ends.
- [x] **Field art**: a third stance (a lit phone at the chest); the emptied cryopod is broken open (hatch, torn feed lines, coolant on the floor).
- [x] **UI**: fullscreen says when it's refused; the menu's objective is labelled; error notices lead in the game's voice.
- [x] **After the review**: the settings no longer crash the boot where browser storage is blocked (`tests/settings.test.ts`).
- [ ] Deferred: gamepad/touch E2E and a long-session soak (stability); expressive portraits for key beats; props.ts/tiles.ts splits.

## Round 11 (verified 2026-09-29)

Worked the round-10 findings, the UI compositing bug first.

- [x] **UI**: only the topmost full-screen menu draws over the world (Options no longer ghosts through Controls; tested); locked rows say why (Game Over, title, battle Repeat); menu windows carry a key reminder in the player's own bindings; the results page says "Press Z to continue" like the page after it.
- [x] **Combat**: a press off the beat costs (a softer strike, a harder blow taken), taught once; Guard pays TP only off a blow it takes, and Rook gets a spent charge back once a fight (he never runs dry in the attrition sims); a target just out of a stun shrugs off another for two rounds; Blackout (Rook + Hex) and Clean Job, a three-part combo (Kit + Rook + Hex).
- [x] **Narrative**: combo callers speak on their cut-ins and big techs have battle cries; the terminology is Saltreach's own (Woken, spark, deck jockey, ki brawler; glossary in the GDD); Kit and Hex answer Rook's confession; the ending carries the Dutch hook; one ellipsis glyph throughout.
- [x] **Feel**: melee swings in three beats (gather, snap with a smear, settle); screen shake kicks along the blow and springs back (rumbles are smooth); big hits on the crew push the camera in and a crushing one flashes red; presses during a hit-pause carry over.
- [x] **Battle presentation**: all 16 recurring enemies have drawn strike and flinch frames (shot 16b); creatures get a form-shading pass.
- [x] **Economy**: the inn charges only members who wake up better; a headpiece per crew member; Neural Buffer no longer offered to Rook; Mags' collection is a real fork (150 now, or a fifth off her lot for good; tested to roughly break even).
- [x] **Stability**: the oldest open tab autosaves, and closing it hands over (E2E); save format v2 with a real migration; any failure before the game runs is shown (was LOADING… forever; E2E with no 2D canvas); systems' handlers guarded.
- [x] **Engine**: field.ts split into fieldkit (api, draw, dust); single-pass rain; weather and lighting tests.
- [x] **Audio**: low end trimmed at source (pads/choir high-passed, the bass's sub-octave halved), presence up; lab and tension loops doubled with B sections; the boss breathes twice a loop.
- [x] **Level**: intakes show shut/open from across the map; a wrong valve costs one step, not three; a test fails any overlapping signs (it caught INTAKE 3 under PUMP STATION); the maze's KEEP OUT is a scav lie.
- [x] **Field art**: Dutch's hat, Mags' cane, Pale's umbrella at the dock; guards are different people.
- [ ] Deferred: Annex set-piece rooms, the Barrens middle, neon in puddles, distinct terminal/tank silhouettes.

## Round 10 (verified 2026-09-29)

Worked the round-9 findings, the two caps first.

- [x] **Caps**: the turn-order strip is a column on the edge opposite the acting member's menus, laid out by a pure function and tested against every other top-of-screen panel (descriptions tested to fit their band); the Warden chamber is a composed room (plated deck, a binding circle cabled to the pylons, a marked way in), and the containment grating is calmer.
- [x] **UI**: the menu dim is near-opaque; the controls and dialog shots reach the screens they're named for (asserted); unaffordable prices read red.
- [x] **Feel**: Screen flash (Off/Reduced/Full) and Hit pause options; the dead CRT setting gone; the renderer split's stray comments cleaned.
- [x] **Combat**: timed presses have profiles (quick: tight window, big payoff; heavy: wide window, smaller payoff; a telegraphed blow braced hardest), tested; street-wisdom weakness hints before anything is known; Crow's Wing says what it does. (Tried: a fifth more HP on ordinary enemies to make fights longer; it barely moved round counts and wrecked dungeon attrition, so it was reverted.)
- [x] **Battle presentation**: Drowned Shades and street drones are individuals; enemies squash and snap back on heavy hits.
- [x] **Economy**: the Glass Wolves' cred stick on the critical path, so p10 stays above zero before every boss (tested); a mod per crew member only they wear.
- [x] **Stability**: chaos E2E in CI (mashing through fades, menus mid-warp, reload mid-dialogue, keys through a battle); a real version-1 save fixture that must keep loading; remove() survives a throwing exit(); the first error stays on screen, later ones counted.
- [x] **Engine**: no closure per text draw; the Warden's conduits and duplicate flips allocate nothing; Battle.unit indexed; target notes computed on change.
- [x] **Level**: world landmarks (the fallen dome, Static Mary's mast, water towers, a wreck pile); two secrets found by looking (the Sinkline's cracked wall into a sealed closet, the Rustyard's loose heap behind a painted arrow); the lattice pulses as one curtain.
- [x] **Narrative**: the ending caption names who surfaced; the Rustyard's promises pay off; curly quotes throughout; Pale trimmed.
- [x] **Audio**: tonal parts keep a top end (plucks/arps close to 1.8 kHz, not 600 Hz); a gentler bus compressor; four themes' last bars lead back into the loop.
- [x] **Field art**: Rook folds his arms and Kit bounces on her toes when standing still; the cryo wing turns to the breach alarm's red after the rescue, and the before/after shots show three, then four.
- [ ] Deferred: FieldScene's render split; three-member combos; hand-authored signature melodies.

## Round 9 (verified 2026-09-29)

Worked the round-8 findings, bugs first.

- [x] **Bugs**: a scene whose render throws every frame trips recovery (unit + E2E); defeat fades to black and Game Over fades up; the kill frame breaks up pixel by pixel instead of a white smear; the bar (and every interior) sits in its building instead of a void; Firefox's reload errors traced to pending AudioContext.resume() promises (Mozilla bug 1528319) and fixed.
- [x] **Combat**: timed presses (strike on the beat for x1.2, brace for x0.7; On/Assist/Off); the engine declares then lands each action so the press shapes the hit; a turn-order strip that updates as orders go in; bosses retuned so the ceiling holds for a player landing a third of presses; the Annex runs squads, so the pressure climbs into the Warden (tested against the Sinkline).
- [x] **Battle presentation / feel**: impact frames and a camera push on criticals and combo finishers; duplicates recoloured per pixel (WebKit ignored ctx.filter); machine numbers at 2x; ghoul bandages; Rustfang punks with pads, fang and bat; one freeze per area attack; the intro keeps pace with battle speed; the fallen crew in Game Over's rain.
- [x] **UI**: the building shell round interiors; fill-window snaps to whole multiples; glyph-coverage and place-map label tests.
- [x] **Engine**: alive() cached; no Map iterator or sort closure per frame; playback unit-tested against a recording view; a bundle budget in CI; drawing split out of BattleScene into battlekit/render.ts.
- [x] **Narrative**: misdirection (the slate and Knuckles point at Dutch); "nine seconds" pays off instead of repeating; Pale in his own clerk's voice; Sable earns trust in a concrete beat; the opening sets the theme; bestiary and guard lines made specific; Chapter One thanks on the last card.
- [x] **Economy**: Requisition sells same-tier alternatives, never the armory finds; the GDD's sell rule matches the game; the bounty says when it's earned; the Warden's reward tested across its phase change.
- [x] **Levels / field art**: visible secrets (the lattice's beam curtain, the proud panel, Dmitri's lamp-lit camp); catwalks read as raised; three loops (the Sinkline's west tunnel, the Annex duct, the Barrens pipe crossing); plaza clutter; leads carry a silhouette (katana, staff, antenna); a readable crossed-arms stance; a higher ambient floor; ruins as building footprints; workshop frontages as businesses.
- [x] **Audio**: an air bed on the quiet cues (6 kHz+ from 0.1-2% to 4-12%); pads and lead opened up; the organ high-passed (boss mud); battle's peak under the limiter; loop seams measured (docs/quality/evidence/audio-loops.txt); GDD audio scope current.
- [ ] Deferred: three-member combos and combo ranks; a pre-fight intel source; distinct counterplay per tell beyond Guard; rat/hound anatomy; hand-authored signature melodies.

## Round 8 (verified 2026-09-28)

- [x] **Bugs**: combo name clears before its hits land; chips and WEAK tags step aside while numbers rise (opaque plates); enemies clear the prompt strip (the Warden's visor); main menu shows all ten entries; one shared overlay dim; target box measured (Maintenance Drone overflowed); New Game resets the unsaved baseline (tested); throwing tickers/overlays are dropped (tested); Pale's "all week" → "all night".
- [x] **Audio**: per-song loudness trims (spread now the intended ~3.6 dB); drum rests so boss themes breathe (range 0.4 → 1.3 dB); a high bell layer for the quiet cues; all 66 effects measured.
- [x] **Engine**: BattleDriver hook (no debug flags in the scene; registered in DEV only); dev routes and test scenes out of the shipped bundle (<500 kB); content-integrity test; the real-speed playtest in CI.
- [x] **Combat**: the tells have teeth (the Warden names its mark; bracing takes a quarter of a seen blow; telegraphed attacks hit hard) — reading them wins 84% vs 57%, tested.
- [x] **Economy**: Hex's same-tier choice (Flechette Pistol); a Sell E2E and screenshot; the results screen captured from a driven run (24c) with a note.
- [x] **Narrative**: one fewer hint at the core; Sable pushes back before joining; ending caption and Kit's echo of Rook; small fixes.
- [x] **Field / level art**: a second stance and more builds in the crowd; wing-coloured wainscots; the emptied pod's spill and glass; the Sprawl's rooftops as buildings with features; Dmitri's camp; the Sinkline's floor as the lit plane; re-aimed Annex shots.
- [x] **Feel / battle art**: Game Over uses the shared rain; the Drowned Shade screams; the lab conduit is a shaded pipe.
- [ ] Deferred: an execution-skill layer (timed inputs) — the engine resolves a round before playback, so this needs per-action resolution; a second party rig; more enemy motion types.

## Round 7 (verified 2026-09-28)

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
