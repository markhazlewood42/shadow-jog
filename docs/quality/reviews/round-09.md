# Round 9 reviewer notes

Condensed at the time from the eleven reviewers' reports (score, top issues, and what would move each area +1). The full reports were delivered in the working session and aren't stored verbatim; from round 12 on they are. See docs/quality/GRADING.md for how these were produced.

```
=== 8 Level design: 7.4 (was 7.2)
1 world map fill 'B' w_block wallpaper; no landmark silhouettes/biome shapes
2 Warden chamber plainest room (bare rect, 4 pylons, 2 steam) - needs hazard geometry/lighting tied to fight
3 lattice still thin low-contrast dashed line in shots; needs loud pulsing beam
4 secrets mostly single-tile chests; want spatial/backtracking secrets
5 wayfinding leans on text sign_posts (18 in sinkline)
6 Rustyard maze token (5 rows)
7 drained junction mostly empty floor
8 mapgraph proves reachability only
+1: world landmarks, Warden arena set piece, loud lattice, spatial secrets
=== 6 Progression & economy: 7.5 (was 7.5)
1 minimal MC: CP4 Lurker 88% (p10 -32), CP5 Annex 86% (p10 -36); test only needs 75% -> retune so p10 >= 0 before bosses
2 ending evidence synthetic (stage preset / teleport auto-win run); want a real walked run capture
3 body/head/mod slots mostly who: ALL - no per-character branch
4 sell 50% + re-equip = no wrong purchase
5 km_lace only endgame mod, priced above median
6 10-shop: unaffordable item dimmed same as can't-equip; want red price
+1: p10>=0 before bosses, real-run ending capture, per-char branches in armor/mod slots
=== 3 Battle presentation: 7.2 (was 7.2)
1 CREATURE_INDIVIDUALS only rat/hound; shade/wisp/drone/crab/etc only hue+mirror (2 shades identical in 11/12/14)
2 enemies have no hurt/flinch frame (only flash + 2px shake)
3 trash creature bodies stacked primitives (shade balls, wisp, eel)
4 recolor still subtle
5 battle backdrops reskins; mid-ground same shapes
6 22-battle-victory crew near-black silhouettes, indistinguishable
7 WEAK amber = buff amber, same colour language
+1: per-copy anatomy for shade/glowrat etc (keyed off V); 2-frame hurt pose for creatures
=== 5 Combat design: 7.2 (was 8.1)
1 timed-press one global curve for all abilities (want per-ability/character windows/multipliers)
2 trash fights 2.0-2.6 rounds: one real decision; want longer trash / punish single-opener
3 one combo per pair, one canonical answer; no combo-vs-combo decision
4 no weakness reveal before Hex joins (Kit+Rook opening trial and error)
5 bestiary resists/immune mostly blank
6 no family weak to phys: Attack flavorless
7 combo_crows_wing desc implies cover, grants none
8 SKILL meter sums uses; doesn't predict castability
+1: per-ability timing, longer/pressuring trash, early weakness signal
=== 11 Stability: 8.3 (was 8.0)
1 E2E only happy path; no fuzz (mash during fade, menu mid-warp, reload mid-script)
2 MIGRATIONS empty; no real migration with fixture
3 stalled await script never faults (no watchdog)
4 remove() calls exit() unguarded
5 ci-engines evidence pinned to older commit, not regenerated
6 GameOverScene(true) hardcoded; canRetry false path untested
7 autosave cadence up to 3 min loss on crash
8 notices overwrite; first fault lost
+1: chaos E2E (mash/menu mid-warp/reload mid-script), real save migration with fixture
=== 9 Audio: 7.0 (was 7.2)
1 loop seam level jumps 1.5-3.4 dB audible (rustyard 3.4, tension 2.9, bar 2.2, town 1.9); gate too loose (6 dB); want <1 dB
2 no crossfade/tail at seam (music.ts loopStep)
3 bar 0.6% 6k+, victory_boss 2.7, boss 4.5, title 4.4; lead lowpass 2.5k, arp/pluck 600 Hz!, bass 260
4 loudness range <1 dB (double compression)
5 victory_boss dullest + seam jump
+1: seams <1 dB (tails/crossfade), raise lead/arp/pluck cutoffs
=== 2 Field art: 5.8 (was 7.6) AUTO CAP: Warden arena floor reads as debug test pattern
1 Warden arena 22x9 uniform contain grating; test pattern look -> compose (vignette, safe lane, hot tiles, clusters)
2 std body leads share template; faces invisible at play scale
3 world map two big noise fields, sparse props
4 Lantern Row top block same window rhythm
5 crowd one pose
6 labFloorContain tones read as static
7 cryopod 37/37b identical but sprite
+1: Warden arena composition, world landmarks, silhouette differentiators Kit/Rook/Sable
=== 1 Engine & code: 8.0 (was 7.7)
1 font.ts drawText/measure allocate walk closure per call
2 render.ts drawConduits tuple array per frame; drawEnemy flip closure; renderTargetInfo Object.entries chains
3 FieldScene 971 lines no render/state split
4 336 non-null assertions, rule off
5 Battle.unit linear scan
6 formatter off
+1: no closure in text pipeline, field render split, narrow throwing helpers
=== 10 Feel & polish: 8.3 (was 7.4)
1 no screen-flash setting (accessibility); Game.flash up to 0.8 alpha everywhere
2 settings.crt dead setting
3 orphaned doc comments in battle.ts after refactor (lines ~869-920)
4 hitstop not adjustable
5 no content warning for flashes
+1: Screen flash Off/Reduced/Full, reduce freeze-frames toggle, clean comments, remove crt
=== 7 Narrative: 7.8 (was 7.6)
1 panels.ts:62 "Three of them came up, three wards over" - no antecedent; fix "Three vans pulled up"
2 Rustyard: tribute cred "get it back where it belongs" never paid off; scav kid water filter dangling
3 quote style inconsistent (curly at ch1:336 vs straight elsewhere) - standardize
4 Rook captured-alive softens sacrifice (structural)
5 Pale's pitch and betrayal speeches long; trim ~15%
6 nine/eleven seconds echo risks coincidence
+1: fix caption, close Rustyard promises, quote pass, trim Pale
=== 4 UI/UX: 5.5 (was 7.8) AUTO CAP: clipped text
1 BUG turn-order strip paints over the list description topLine (12, 14: "Blu"/"A co" hidden)
2 BUG field sign text (PUMPS) bleeds through menu dim overlay (07, 09)
3 03-dialog-portrait bottom half black (panel composition)
4 36-controls shot shows Options root not the rebind screen
5 no z-order/occlusion test
6 keep margin between strip and top line
+1: fix collision + overlap test; fix bleed-through
```
