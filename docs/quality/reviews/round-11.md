# Round 11 reviewer notes

Condensed at the time from the eleven reviewers' reports (score, top issues, and what would move each area +1). The full reports were delivered in the working session and aren't stored verbatim; from round 12 on they are. See docs/quality/GRADING.md for how these were produced.

```
=== 7 Narrative: 7.8 (was 8.0)
1 betrayal foreshadowed three times (annex mail log 171-181 "resolved per standard protocol", Sable's dark pods, Pale) -> cut one / make mail log ambiguous
2 betrayal resolves in ~20 lines, no agency; give one more beat of struggle before the flashbang
3 glossary [review] terms read as unlocked vocabulary (deferred by Mark to alpha end: not actionable)
4 Pale is stock "polite corporate reptile": needs one specific non-genre tic
5 Hex's lines run 3+ clauses; trim doubled clauses
6 annex logs dense briefing blocks, no voice/rhythm variation
7 last beat is a "coming soon" card, not a narrative close
+1: centerpiece betrayal (trim foreshadow, struggle beat), Pale tic, Hex trim
=== 9 Audio: 7.2 (was 7.2)
1 still low-mid heavy: 6k+ 2-9.5% (target 12-18%), 120-500 up to 48% (dungeon), bar 2% top
2 no dynamic range: range 0.5-2.1 dB; rests don't produce surge/release (drop more than drums)
3 sable/gameover spectrograms as dense as battle: thin texture, fewer voices
4 broadband click on every onset (fast attacks) even in soft cues -> longer attacks on pads/bells in calm songs
5 gameover seam -1.8 (closest to -2.5 gate)
6 bar muffled (2% top)
7 SFX levels via big post-hoc LEVEL table (fragile)
8 dock forces 'hall' over tension's 'here' — check
+1: EQ top shelf until 6k+ 12-18%, cut 120-500; rests drop more parts; sparse calm cues with softer attacks
=== 8 Level design: 7.8 (was 7.7)
1 puzzles still confirm-dialogs (pumpValve, relay): make gauge reading/wiring spatial (read at the prop, trace a visible cable)
2 lattice truth table tiny (3 relays/3 lights; solvable blind in <=2)
3 Lurker trigger is a bare touch-rect, no arena/tell vs Warden's chamber
4 world landmarks don't read vs clutter (19-world, 31 radio lot); signs carry wayfinding
5 only one locked teaser (arcology road)
6 stale flag list comment chapter1.ts:4
+1: spatial puzzles, Lurker arena + tell, colour/silhouette landmarks
=== 1 Engine: 8.3 (was 8.5)
1 ~555 non-null assertions, noNonNullAssertion off (biome.json:11); typed assert helper, re-enable with allowlist
2 monolith files: props.ts 1671, tiles.ts 848, battle.ts 926, render.ts 790
3 no bundle-budget evidence file
4 software perf gate p95 16.7 = zero headroom
5 no formatter in CI
6 13-battle-action bare "5" digit above ring (dup index? actually damage float?) 
+1: split props/tiles/battle/render, assert helper, bundle evidence
=== 3 Battle presentation: 6.5 (was 7.0)
1 swing: blade angle identical across beats (just lift) -> weapon angle must change per beat
2 Lurker/Warden have no strike/flinch frames (excluded from POSED)
3 party from behind: no body reactions
4 same-species packs read as x3 (38/38b)
5 creature palettes low-sat, similar
6 windows flat, no cyberpunk trim (GDD §8)
7 street backdrop thinnest, most seen
8 no evidence for hit-feel/FX timing
+1: boss strike/flinch frames, weapon-angle swing, street backdrop midground, window trim
=== 5 Combat: 7.8 (was 7.5)
1 turret/arcanist/warden/spirit = same charge-cadence mechanic reskinned
2 Knuckles has no ai/tell (first boss teaches nothing)
3 Moonfall L10, Rekindle L9, Wildfire L11, Dragon Coil L12 unreachable (chapter ends L8-9)
4 trash 2-2.6 rounds: depth boss-gated
5 Guardian can't-cover-blasts only learned post-hoc
6 no near-miss combo feedback
+1: Knuckles tell, differentiate telegraph shapes, lower capstone levels
=== 4 UI/UX: 8.7 PASS (was 7.6)
1 fullscreen toggle fails silently (options.ts:165-172)
2 raw JS error text in notice (errors.ts:14-18, main.ts:76)
3 no colorblind/text-scale option
4 objective unlabeled in menu quick panel (menu.ts:450-457) vs Places
=== 2 Field art: 7.5 (was 7.0)
1 crowd one pose/silhouette (32-crowd)
2 rooftop clutter repeated boxes (buildings.ts roofItem ~201)
3 puddle reflections illegible smudge
4 empty cryopod just dark: no open hatch/coolant/cable
5 bar interior sparse/grid-regular
6 world biome edges soft (fbm)
+1: crowd poses/proportions, prop variation, cryopod redraw
=== 10 Feel: 8.4 (was 7.8)
1 portraits/panels thin expression (Pale's threat same smirk)
2 hitstop not scaled by battle speed/fast-forward (battle.ts:624-629, playback.ts:204)
3 timing ring same language for all targets
4 PanelScene drops confirm before lastT>12 (no buffer) vs Dialog buffers
5 no camera punch-in on marquee combos
6 swing curve same for all weapons
+1: expression states for key beats, hitstop scaled, per-weapon swing/camera punch
=== 6 Progression: 7.6 (was 8.0)
1 Mags discount fork has no reachable payoff (route never returns to Rustyard after Hex joins)
2 economy loose: p10 400-700 spare after mandatory buys
3 no crafting/material layer; loot is vendor trash
4 24c mislabeled (debug driver force-wins)
5 shop doesn't surface element weakness context
6 Focus Rod price 900 though never sold
=== 11 Stability: 9.0 PASS (was 8.8)
1 no gamepad E2E (mock Gamepad API chaos)
2 no touch E2E
3 battle chaos hands off to autopilot
4 no long soak (heap/frame over a long run)
5 no boot with storage blocked from tick zero
```
