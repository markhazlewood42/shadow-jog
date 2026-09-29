# Round 8 reviewer notes

Condensed at the time from the eleven reviewers' reports (score, top issues, and what would move each area +1). The full reports were delivered in the working session and aren't stored verbatim; from round 12 on they are. See docs/quality/GRADING.md for how these were produced.

```
=== 3 Battle presentation: 7.2 (was 7.0)
1 hit flash on 13-battle-action reads as opaque white blob (0.55 not reading as blink)
2 two guard drones identical (variant/mirror not perceptible for machine family)
3 early thugs (reskinned rig) weakest art; first impression roughest
4 no camera push/zoom on big hits / phase transitions
5 rat/hound blobs thin anatomy
6 no large filled impact frame for crits/combo finishers
7 skyline neon bars at enemy head/HP height in 38/38b (no keep-out)
8 combo frame stack tight (213, WEAK!, WEAK SHOCK, status) in 60px
+1: mooks bespoke, distinct dup machines, impact graphic, camera push
=== 8 Level design: 7.2 (was 7.0)
1 all rooms axis-aligned rects; no diagonal/curve/vertical tiering (catwalk over lower level)
2 dungeon floors small; Annex ~30% Warden arena; little exploration space
3 27/28/29 shots framed ~same as 21; no visible beam/ajar panel/crawlspace in shots
4 Lantern Row street/plaza sparse asphalt gaps
5 only one branching route (Rustyard maze); Sinkline/Annex single spine
6 lattice beam sprite not visible in shots; puzzle state only via text
7 chests in open side rooms, not concealed by geometry
8 world map: one road each way, no shortcut/secret path
+1: one set-piece room per floor (catwalk/ramp), secrets visually confirm on field
=== 5 Combat design: 8.1 (was 8.1)
1 no execution layer (timed hit/parry)
2 7 static two-member combos; no triple, no tiers/upgrades
3 trash AI flat weighted tables; fights reduce to spend-charge-then-attack
4 13-battle-action: "19" floater with no visible source
5 no turn-order preview
6 weakness discovery purely reactive; no pre-fight intel path
7 every tell answered by Guard (same tool)
8 18 bestiary entries, 5 AI scripts - thin breadth
+1: execution layer, turn-order preview, deeper combos, trash decision pressure
=== 7 Narrative: 7.6 (was 7.4)
1 betrayal telegraphed early (deadCrew slate "milk run" + mail log), no misdirection
2 "Thank you for playing the alpha" right after cliffhanger on ending.ts:108
3 "nine seconds" repeated 3x near-verbatim (ch1 :88, :419, :488) + finale
4 Sable recruitment thin (ch1 431-446) - needs concrete trust beat
5 opening repeats "easy job" joke (panels.ts:51-52 then ch1 29-34)
6 "Why would I lick—" joke opaque (ch1 98-99)
7 Pale lines trope-y ("part of the price", "line item")
8 generic bestiary lines (hound enemies.ts:95, drone :102); dock guards
+1: editing pass - trim repeats, Sable beat, specific flavor, move alpha thanks
=== 11 Stability: 8.0 (was 7.5)
1 BUG render faults never count toward FAULT_LIMIT (faultedThisTick reset in tick before render); untested
2 no evidence of webkit/firefox passing prod/gameover specs (evidence only chromium) -> attach CI evidence
3 MIGRATIONS never carried real entry (SAVE_VERSION 1)
4 minor: autosave cadence could lose minutes; note it
+1: fix render-fault gap + test; CI evidence on webkit/firefox
=== 1 Engine & code: 7.7 (was 7.6)
1 BattleScene 1396-line god class; extract renderer module
2 Battle.alive() allocates via filter (engine.ts:99-101)
3 battle.ts update() Map iterator (350), render() sort closure (791) per frame
4 bundle 499.92kB, no size gate in CI
5 129 non-null assertions
6 perf only via e2e (fine)
7 playback.ts has no unit tests (mock PlaybackView)
+1: extract renderer, alive lists, no per-frame allocs, bundle-size gate
=== 2 Field art: 7.6 (was 7.3)
1 ambient darkness crushes tile detail outside light pools (04, sinkline_1)
2 field sprites of leads read as same blob; need silhouette differentiators
3 32-crowd-sprites all arms-at-sides; crossed stance not visible in array
4 Sinkline B1 large uniform floors, sparse incident
5 world barrens noise reads as empty ground, not ruins
6 TIRE DEPOT / NIX AUTO facades read as icon swatch grid
+1: ambient floor/fill, per-lead silhouette differentiator, hero-prop clusters
=== 6 Progression & economy: 7.5 (was 7.8)
1 Annex attrition dip: 89% HP, 0.8 medkits vs Sinkline 84%/3.5 - lull before Warden
2 GDD says sell 50% but loot sells 100% (items.ts sellPrice 139-144)
3 km_requisition resells Annex chest uniques (dragon_fang, mono_katana, smartpistol, focus_rod)
4 build depth thin: 2-3 lateral choices per char; add mid-tier sidegrade per char
5 Warden phase1 0 reward, spirit carries all; no test phase transition always fires
6 side jobs under-claimed; no nudge (24-ending shows 2/3)
+1: Annex attrition climbs, reconcile sell doc, one more sidegrade per char
=== 9 Audio: 7.2 (was 6.5)
1 ambient cues dark: 6k+ 0.1-0.3% (dungeon, lab, gameover, sable, tension); pad/choir/organ lowpass 1100-2400, lead filter 1600
2 no memorable hook melodies; hand-author 2-3 signature themes
3 boss/lab/world 4-5 parts over bass-heavy bus -> mud (<500Hz 75%)
4 battle peak -1.4 dBFS over limiter -2 threshold (no lookahead)
5 loop seam not rendered/measured in test
6 GDD says ~9 tracks, 15 exist
+1: brighten non-combat to 10-15% 6k+, sparkle layer; signature themes
=== 10 Feel & polish: 7.4 (was 7.5)
1 loss -> GameOver hard cut (systems.ts:307 no fadeOut/fadeIn)
2 13-battle-action white blob (party glow 'lighter' + hit flash stacking?)
3 game over screen inert: no fallen party silhouettes
4 hitstop per target on AOE (playback 130-136) - cap per event
5 procedural sprites ceiling (structural)
6 shatter intro not scaled by Faster battle speed
+1: fade loss, fix white blob, game over beat, cap AOE hitstop
=== 4 UI/UX: 7.8 (was 7.2)
1 06-bar-dialog: bar interior doesn't fill frame (black margins ~15% sides, 46px top)
2 default scaling 'fit' not 'integer'
3 glyph coverage not tested (font.ts:203 '?' fallback)
4 placemap exit labels no collision/bounds check, not in layout test
5 audit other interiors for framing
+1: fill frame in interiors, integer default, glyph coverage test, placemap label test
```
