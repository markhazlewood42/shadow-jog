# Round 10 reviewer notes

Condensed at the time from the eleven reviewers' reports (score, top issues, and what would move each area +1). The full reports were delivered in the working session and aren't stored verbatim; from round 12 on they are. See docs/quality/GRADING.md for how these were produced.

```
=== 3 Battle presentation: 7.0 (was 7.2)
1 only rat/hound/drone have attack frames; others tween only
2 no drawn enemy hurt pose (squash+flash only)
3 creature art flat: ball/rect fills, 1-3 tonal steps, little shading
4 common encounter backdrops (street skyline) thinner than boss sets
5 enemies small, blend (brown/tan blobs in 11)
6 duplicates still visibly a patch
7 juice uneven since few attack frames
+1: attack + hurt frames for every recurring enemy; shading pass on creatures
=== 9 Audio: 7.2 (was 7.0)
1 bass/low-mid 60-80% energy; leads/bells under low end; trim pad/choir/sub low end at source, push presence 3-5 dB
2 lab loop 15.5s, tension 17.2s too short: add B section/repeat
3 dungeon seam excess +1.3 near ceiling
4 world seam -1.7 soft spot
5 no memorability evidence
6 boss rests only 1 bar per 16
7 6k+ never >11%; air bed not lifting much
+1: brightness pass (source low-cut, presence), longer lab/tension loops, dungeon seam
=== 1 Engine & code: 8.5 PASS (was 8.0)
1 field.ts 971 lines no fieldkit split
2 no tests for lighting.ts / weather.ts pooling
3 non-null assertions rule off (~472)
4 bundle budget 94-95% used (178 kB gzip / 534 kB chunk)
5 Weather.render three passes over drops
+1: fieldkit split, weather/lighting tests, single-pass rain
=== 11 Stability: 8.8 PASS (was 8.3)
1 two-tab: survivor tab autosave stays off after the first tab closes (no goodbye); 6s toast only
2 fatal boot-failure overlay (main.ts fail) untested
3 FAULT_LIMIT consecutive only; intermittent sick scene never recovers (document)
4 MIGRATIONS never exercised by a real bump
5 handlers! in loadIntoGame ordering footgun
+1: tab goodbye/heartbeat, boot-failure e2e, real migration
=== 5 Combat design: 7.5 (was 7.2)
1 timing no risk: 'none' = 1 (a mistimed/early press costs nothing) -> make a whiff cost
2 7 fixed combos, no alternates/triples
3 Guard/Attack alternation TP farm loop
4 Rook dry-out tolerated 20% of runs
5 trash fights 2-2.6 rounds, little weight (22 of 28 battles)
6 shallow trash movesets
7 stun immunity ad hoc; Killing Intent AOE stun could chain-disable packs, untested
8 no passive weakness tell pre-hit (hint exists only in target box)
+1: timing stakes, close TP farm + Rook dry, thicker combo web, trash gimmicks
=== 10 Feel & polish: 7.8 (was 8.3)
1 party attack = single static pose + lunge offset; no multi-frame swing
2 camera push/impact only on party hits; nothing when party takes a big hit
3 shake random uncorrelated per frame (buzz) - want snap-then-settle directional
4 common hits share generic starburst recipe
5 perf max 7.3ms single frame spike (lazy cache build)
6 input during hitstop dropped (justDown consumed while frozen)
+1: multi-frame swings for signature moves; symmetric impact for party taking big hits
=== 2 Field art: 7.0 (was 5.8; cap lifted)
1 named cast (kit/dutch/pale/mags) same template; only Rook/Sable read (cast sheet shows static front frame)
2 field faces 1-2px; gap vs portraits
3 crowd sheet one pose (crossed stance not visible)
4 terminal/screen/vending/tank/cryopod same glowing slab silhouette
5 map overviews soft room boundaries (sinkline/annex)
6 guards pixel-identical clones (corpsec x2 annex, dock x2)
7 puddles don't pick up neon
+1: silhouette poses for leads/cast, crowd poses, distinct prop silhouettes
=== 8 Level design: 7.7 (was 7.4)
1 Annex wings repetitive (tanks repeated); signage does the work
2 puzzles are dialogue picks, no spatial consequence (drain/lattice should open visible new route)
3 Barrens middle empty
4 valve wrong order resets all three, full re-walk
5 37b pod just goes dark (no broken glass visible in shot)
6 mapgraph all-flags only; mid-progression softlock untested
7 KEEP OUT sign on decoy - on the nose
8 valve order is a stat lookup
+1: puzzles open a visible new route; Annex set-piece rooms
=== 7 Narrative: 8.0 (was 7.8)
1 leads silent in battle: no cry on party techs/combos (enemy has cry)
2 Shadowrun terms (physical adept, metatype, Awakened, essence, decker) contradict GDD originality -> terminology pass
3 side jobs thin (one-line resolutions)
4 ellipsis inconsistent ("..." vs "…")
5 cryopod turn (Rook's confession) no reaction beat from Kit/Hex
6 Dutch complicity never confronted (signal as hook)
+1: party battle cries, terminology pass, cryopod aftermath lines
=== 6 Progression & economy: 8.0 (was 7.5)
1 inn charges full price for KO'd members who get nothing (systems.ts:132-149)
2 head slot has no per-character items
3 all evidence bot-generated; no human log
4 no real scarcity on critical path (300+ spare at checkpoints)
5 shop/equip shots from debug presets
6 Rook maxTp 0: Neural Buffer TP wasted, no shop indication
7 24c shows 0:00 play time, 0 bestiary - reads broken without the note
+1: head-slot per-char items, a real fork, inn fix
=== 4 UI/UX: 7.6 (was 5.5; cap lifted)
1 BUG nested non-opaque scenes: OPTIONS title tab shows above Controls window (0.985 dim, repainting stack) -> make overlay fully opaque / stop at overlay scenes
2 Game Over disabled 'Load last save' gives no reason (ignores 'blocked')
3 ending results page bare ▼ vs next page "Press Z"
4 confirm/cancel legend only on title
5 skills list 4px above command window seam mark (low confidence)
+1: compositing fix, disabled rows explain everywhere, persistent cancel hint
```
