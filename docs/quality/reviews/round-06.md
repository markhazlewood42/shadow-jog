# Round 6 reviewer notes

Condensed at the time from the eleven reviewers' reports (score, top issues, and what would move each area +1). The full reports were delivered in the working session and aren't stored verbatim; from round 12 on they are. See docs/quality/GRADING.md for how these were produced.

```
7 Narrative 8.0 | shared trail-off/deflate joke rhythm (Dutch/Hex/Mags); cryopod reveal compressed (409-446) needs a breath; Pale's motive for Kit vague; corporate satire flat, no escalation; Pale intro ~10 lines monologue; Hex anxious self-narration twice in recruit arc (114,139); Dutch "carry it somewhere else" echoes cargo theme
5 Combat 7.5 | combos 0/battle in trash (sim policy only combos boss/3+); boss win rates 92-99% vs 70-75% floor (too easy); trash 2-3 rounds; human shock 1.25 mild; Rook uses unverified in attrition (ran-dry metric); Guardian doesn't cover AoE with no signal
11 Stability 8.7 PASS | no Firefox in CI; migrate() flat not step-chain; game.paused dead+softlock trap; local E2E evidence chromium-only (CI has webkit); save fuzzing curated; post-autosave-failure play untested; no two-tab E2E
1 Engine 7.7 | BattleScene 1574-line god object (split UI/EventPlayer/Renderer); economy.spec not in CI; FieldScene 923 lines; dense non-null assertions (engine.ts:181 combos); Input.dir() allocs array per tick (input.ts:203); props/tiles size; no unit tests on presentation state machines
8 Level 7.2 | Annex visually monotone (same capsule recolors per wing); Rustyard maze no sign_posts; junction pool undifferentiated shape; objective banner same in all shots (check live); boxy rect geometry, no set-piece geometry; maze secret shallow; landmarks text not silhouette
6 Economy 8.1 | no endgame cred sink (Requisition consumables only; 900-1150c idle); trash 100% win, low stakes; no-grind proven only with optional chests opened (need minimal-exploration MC); GDD says Lv1-20, MAX_LEVEL 30; combos rare in trash; top-tier gear chest-only, no buyable fallback
4 UI 8.0 | Rook battle card SKILL row has no bar (battle.ts:1437-1445) vs others; main.ts:70 notice slice(0,92) no ellipsis; shop compare line + equip reason unclamped, not in layout test; GDD control table disagrees with Controls screen
9 Audio 7.2 | no rendered audio evidence (render tracks); bare-oscillator timbres thin (chorus/saturation layers); fully quantized, no humanization, '!' accents unused, swing on 2 songs; gameover loop:false goes silent; music vs sfx gain asymmetry; boss fights share ambience; crit duck pumping; envelope shape uniform
3 Battle 7.6 | enemies have no attack keyframe (offset-only lunge); hit-flash white frame in 13 reads as glitch in a still; human dup sentinels only skin swap; no foreground framing layer in backdrops; no tests for fx timing; enemy cast/aim motions generic
```
