# Spike: side-on battle view

Branch `spike/side-battle`, draft PR, never merged. Plan and background: `docs/PHASE-0.2.md` (Pivot 1), on the release-prep branch until it merges. Rules for spikes: `docs/spikes/README.md` (same).

## Question
Can a side-on or 3/4 battle with small sprites give the crew battle poses that are cheaper to make than the v0.1.0 back view and look at least as good, and if so, at which size: field scale (~30 px tall) or battle scale (~44–48 px tall in a 64 px cell)?

## Why now
Since 2026-09-30, 37 of 60 commits went into posing ~100 px back-view sprites pixel by pixel (`rig2/battle.ts` 19 commits, `skeleton.json` 12), while the battle engine, AI and abilities took none. Mark decided on 2026-10-02 that the Phantasy Star IV feel is the loop (combos, panels, cut-ins, pacing), not the over-the-shoulder camera (decision 2), and to run this spike now with Hex and Sable's back-view tuning paused (decision 3). He expects side-on to make everything easier, since the pixel-art community has far more side-view references and assets, and he wants battle sprites a little more detailed than field sprites for personality and ambience. Getting it wrong costs either 2–3 weeks building a view that looks like a downgrade, or more weeks of back-view churn.

## Time box
About 3 working days of Claude time. The box closes **2026-10-07** whatever state the spike is in. Step 1 is built to fail fast on day 1.

## Exit criteria (written before any code, dated 2026-10-02)
- GO if all of these hold, judged by Mark from the comparison clips:
  - **Readability:** at normal game speed he can tell who is acting and whether it is a strike or a cast.
  - **Identity:** battle Rook and battle Kit are clearly field Rook and field Kit.
  - **Impact:** Rook's strike is at least as good as the v0.1.0 back-view strike, side by side.
  - **Cost:** each key pose for Rook and Kit takes about 2 hours of Claude time or less and at most one round of Mark's corrections (logged per pose below, by elapsed time and rounds, not commit titles).
  - **Composition:** nothing overlaps; the target cursor and enemy HP read clearly.
- NO-GO if any of these happens:
  - Mark calls both sizes a downgrade from v0.1.0.
  - Any pose needs 3 or more correction rounds.
  - The near arm can only be posed through a pixel repaint loop like the back view's (step 1).
  - Hex's spell effects don't read on small targets.

The size choice (field or battle scale) is Mark's, made from the clips. Hero scale (~55 px) stays a fallback if battle scale still feels too small.

## Steps
0. **References.** Mark supplies or approves profile references for Rook's kendo strike and Kit's punch. Nothing is posed without his direction. The pose list follows the RPG Maker MV/MZ side-view battler motions (walk, wait, chant, guard, damage, evade, thrust, swing, missile, skill, spell, item, escape, victory, dying, abnormal, sleep, dead; 3 frames each in 64 px cells), trimmed to what Shadow Jog uses.
1. **Arm test (day 1).** On Rook's traced field `right` frame, and on a battle-scale Rook made by downscaling his traced `east` view (`public/art/rig/views.json`), separate the near arm and fill the torso behind it. Also try a code-drawn limb in the style of `katana()`. Hand-drawn frames are an allowed fallback, with their time logged as cost.
2. **Static layout** behind `?battle=side` on one existing backdrop: two Rustfang Punks and a Glowrat, then the Warden. Party in a shallow 3/4 diagonal on the right, enemies on the left. Field frames at 1:1 with the idle bob and a walk-in.
3. **Rook's kendo strike** end to end through the real playback engine: wind-up and strike keys, the code katana and arc, a horizontal lunge, hitstop, and the GPU hit at the new anchor.
4. **Kit's punch** the same way: the non-weapon case, with no `katana()` shortcut.
5. **The other size** with the same Rook strike and equal effort. If time runs short, compare the two sizes as still key poses only, never an animated one against a static one.
6. **Hurt and KO** for one member, and Hex's Overload re-anchored.
7. **Scale check:** the 91 px punk and the 96 px ghoul next to the party at each size, with no re-art.
8. **Comparison sheet** of short clips: the v0.1.0 back view, field scale, battle scale, plus a Sprite Fusion strike if Mark's own Sprite Fusion test made one.

## Assets and cost
Existing art only: `public/art/rig/field.json` (traced field frames, separate left and right profiles), `public/art/rig/views.json` (traced 8-direction views, 97–123 px tall), the battle backdrops and `public/art/rig/enemies.json`. No paid generation and no new dependencies. Clips and screenshots go to the git-ignored `media/` folder, not the repo. Sprite Fusion clips are optional and come from Mark's own account if he runs that test.

## How this spike runs (Mark, 2026-10-02)
Mark asked for Kit's and Rook's references to be done together, and for the rest to run without his input: "Do as much of this as you can on your own without needing my input. Iterate on your work with verification agents and a minimum 8/10 scoring rubric." So the references below were picked by the agent, not by Mark (he can override any pick), and the "Mark's rounds" column in the pose log becomes judge rounds until he reviews. The final GO / NO-GO and the size choice stay his.

## References (picked 2026-10-02; Mark may override)
Candidates were gathered and link-checked; the full list is in the session record. Picked, Kit and Rook together:
- **Rook, two-handed kendo strike:** [Kendo-Guide men strike](https://www.kendo-guide.com/men_strike.html) for the form (chudan guard, furikaburi lift overhead, men-uchi at head height with the arms extended and a stamping front foot, return to chudan); [Slynyrd Pixelblog 9, melee attacks](https://slynyrd.com/blog/2018/9/8/pixelblog-9-melee-attacks) for turning it into 3-4 pixel key frames (anticipation, smear, held impact, overshoot, recovery); [Final Fantasy VI Cyan](https://www.spriters-resource.com/snes/ff6/asset/5836/) for how a two-handed katana silhouette reads at small size.
- **Kit, punch (jab then cross):** [Slynyrd Pixelblog 53, punches and kicks](https://www.slynyrd.com/blog/2024/11/25/pixelblog-53-punches-and-kicks) for key frames and timing (guard, jab with smear and overshoot, load-and-pull cross, recover); [Final Fantasy VI Sabin](https://www.spriters-resource.com/snes/ff6/asset/6699/) for a brawler's stance and punch silhouette at battle size; [Chrono Trigger Ayla](https://www.spriters-resource.com/snes/chronotrigger/asset/2511/) for a heavier, wider swing if the cross needs more weight.
- **Pose list:** the RPG Maker side-view battler motions (3 frames each, loops played 1-2-3-2, one-shots 1-2-3), trimmed to ready, walk-in, wind-up, strike, item, guard, hurt, low-HP kneel, KO, victory and escape for these two.

References are for pose study only; nothing is copied into the game.

## Rubric (written 2026-10-02, before steps 3-8)
Three fresh judges score every pass, each with a different lens (pixel artist; JRPG battle designer; art director comparing against v0.1.0 and the references). Each criterion is scored 1-10, or left blank when it doesn't apply (a static layout has no motion):
1. **Identity:** the same character as the field sprite and portrait (palette, hair, outfit, weapon).
2. **Readability:** the action reads as a silhouette at 1x and at game speed; strike, cast and hurt are distinct.
3. **Motion and anatomy:** fixed limb lengths, a believable grip and weight, anticipation then impact then follow-through, no popping between frames.
4. **Pixel craft:** clean outlines, no stray or orphan pixels, no muddy colours, one pixel density within a sprite.
5. **Composition:** nothing overlaps (UI, enemies, party); cursor and HP read; sizes relate sensibly.
6. **Impact and feel:** lunge, hitstop, smear or arc, and the GPU hit land together; at least as strong as the v0.1.0 strike.
7. **Style fit:** looks like the same game as the backdrops, field sprites, portraits and effects.
8. **Cost and reuse:** the pose is data (angles, reach, keys) through shared code, not per-pixel repair; time is logged.

A pass needs a median score of **8 or more overall** (the mean of the criteria that apply) **and a median of 7 or more on every criterion**. Failing items go back to the builder with the judges' fixes, at most 4 rounds per item. Scores go in the pose log.

## Pose log
| Pose | Size | Claude time | Mark's rounds | Notes |
|---|---|---|---|---|
| Rook near arm: cut out, torso filled | field and battle (same code) | about 3 min to write, then 1 look per size | 0 | Cut by shape (a capsule round the bone), not colour: his sleeve is the torso's colour. 3 fix passes at field scale (a neck pixel taken as arm, dark seam bits left in the torso, a dark bar at the turned arm's shoulder end); none at battle scale. |
| Rook 3 poses (raised overhead, forward, low follow-through), arm turned with RotSprite | field | about 1.5 min | 0 | 2 passes: raised overhead hid the face and couldn't reach past the big head, so the arm is drawn 1.3x longer and angled back; fist size. Corrected: at field scale the raised overhead still covers the eye, forward crosses the mouth and beard, and low follow-through leaves a dark seam stroke. |
| Same 3 poses, code-drawn limb (two bands, IK elbow, fist) | field | under 1 min | 0 | 1 pass (fist too big). Plainer than the turned arm, no cuff. Corrected: coat-green on coat-green, nearly invisible at field scale; needs a darker rim. |
| Rook base: traced `west` view shrunk to 47 px | battle | about 1 min | 0 | Tried average then snap to palette, nearest, commonest colour. Nearest kept: clean edges, no muddy mixed shades. Outline stripped then redone. |
| Rook 3 poses, arm turned | battle | about 1 min | 0 | 1 pass (shorter reach). Forward and low read well; raised overhead is poor (olive arm on olive torso, a skin block over the head). |
| Rook 3 poses, code-drawn limb | battle | under 1 min | 0 | 0 passes. Reads best of the four: a bent arm with an elbow, a clear fist. |
| Katana held in two hands, 3 poses, both limb kinds | field and battle | about 1 min | 0 | `katana()` got a size and a thin option; far hand is a darker fist 3-4 px behind the near one. 0 passes. |
| Crew base: traced `west` view shrunk to ~47 px, outline redone (Kit, Rook, Hex) | battle | about 4 min for the pipeline, all three | judge round 1 | 0 passes. Same code as day 1's Rook base (nearest shrink, strip then redo the outline); a member is a source view, a hip row and a chest row. |
| Sable base: `south-west` view shrunk to ~47 px | battle | about 1 min | judge round 1 | 1 pass: her traced `west` view is a narrow turned-away sliver with no face, so the three-quarter `south-west` is used. Face, white hair, red skirt and staff read; she faces left and a little toward us, the others are pure profile. |
| Wait loop, 3 frames played 1-2-3-2 (all four) | battle | about 2 min | judge round 1 | 0 passes. Chest row drawn twice (head rises 1 to 2 px, feet fixed), a different phase per member. Subtle by design. |
| Walk, 4 frames: step, pass, other step, pass (all four) | battle | about 2 min | judge round 1 | 1 pass: Hex's trousers are near-black, and a darker far leg made a muddy blob where the legs cross, so colours already dark are left alone. Rook's coat hides most of his legs and Sable's are thin: the swing reads on Kit, partly on the rest. |
| Walk-in: the party steps in from the right during the shatter | battle | about 3 min | judge round 1 | 1 pass: members walking at the same speed from the same edge bunched and overlapped, so everyone now moves the same distance and the formation keeps its spacing. About 1.1 s. |
| Layout: enemy strip, higher enemy row, list beside the command menu, target box on the open ground | battle | about 10 min | judge round 1 | 5 passes (strip and lift, list placement, target box placement, boss lift, list rows). No sprite changed. |
| `enemyscale=half`: nearest 0.5 shrink of humanoid regular enemies | battle | about 2 min | judge round 1 | 1 pass (the ground shadow was left at full width). Creatures and bosses are untouched. |
| Crew finish: lifted legs, lifted outline, cool rim, specks dropped (all four) | battle | about 4 min | judge round 2 | 1 pass (the first outline lift was too light: dark members showed ghostly pale lines round near-black legs; halved it). Code only (`finish()` in `sidecrew.ts`), no per-pixel edits. |
| Walk r2: near arm counter-swing (Kit, Rook, Hex), 1 px body drop, Rook's coat hem sway, stride 40 for Rook, Hex, Sable | battle | about 5 min | judge round 2 | 2 passes (the arm's gap was filled with a dark seam colour on Rook's coat, now the sleeve colour; then a 16 degree swing made seam scribbles, now 9 for Rook). Arm data is a shoulder, a hand and a radius per member, picked from a gridded 10x view. Rook's hem sway is 1 px and hard to see. Sable has no arm swing (she holds the staff). |
| Wait loop r2: about 0.5 s a step (was 0.2 to 0.3), last frame leans the upper body back 1 px | battle | about 2 min | judge round 2 | 0 passes. Looks the same in stills; judged from the clip. |
| Sable as a true profile: tried the traced `east` view, mirrored | battle | about 2 min | judge round 2 | FAILED, reverted. The `east` trace is a back view (hair over everything, no face), the `west` trace is a sliver with no face, and `north-west` is a back view; only the three-quarter `south-west` has her face, white hair and staff. A KNOWN BREAK: Sable is still a three-quarter view among three profiles. A true profile needs a re-trace or a hand build (not spent: over the item's time box). |
| Enemy scale r2: `collapseBlocks` (best 2x2 phase, commonest colour, orphans dropped) then `stretchTo` 1.25 (humanoids) or 1.5 (creatures) | battle | about 3 min | judge round 2 | 0 passes after the first look. Default `fit`: punk about 57 px, ghoul about 60, Glowrat about 35 x 25; `half` is native (a punk 46 px); `full` is the old 91 px. Bosses unreduced. Replaces round 1's nearest shrink. |
| Layout r2: RPG Maker diagonal, shared ground line, contact shadows, cursor over the HP bar, panel gaps, wide-group overflow | battle | about 4 min | judge round 2 | 4 passes (cursor first hung 15 px high: bounce too big; panel gap; the four-enemy strip ran into the party; strip right edge). No sprite changed. |

## Day 1 notes (2026-10-02)

Built: the arm lab (`?scene=sidelab&scale=field|battle`, also in the DEV tab) and a static side-on layout behind `?battle=side`. Times above are wall-clock from my tool calls; Mark hasn't reviewed anything, so every round count is 0.

The arm test did not hit the NO-GO. The near arm is cut by geometry (every pixel within a radius of the shoulder-to-hand bone), the torso behind it is filled once with its commonest colour, and the arm is then turned about the shoulder or replaced by a code-drawn limb. A pose is two numbers (an angle and a reach), not a repaint. No pose needed per-pixel edits.

What worked: the cut and fill at both sizes; the katana in two hands (the near fist over the grip, a darker far fist behind it); re-outlining the finished pose.

What didn't: the raised-overhead pose with the turned arm, at both sizes. The sleeve is torso green on torso green, so a raised arm vanishes into the coat, and a chibi arm is shorter than the head is tall. The code-drawn limb handles it better at battle scale; at field scale it is coat-green on coat-green and nearly invisible, and needs a darker rim (corrected 2026-10-02, see "Corrections to day 1").

Surprise: battle scale is the traced art's own resolution (the PixelLab views are roughly 2x2 blocks, so 99 px is about 47 px native). Shrinking by nearest is nearly lossless, and the faces and hands read clearly. Field scale at 30 px is noticeably thinner.

Caveats on the verdict: only Rook, only three static poses, shoulder and hand coordinates picked by hand per size (data, not painting). Kit's punch and Hex and Sable are untested; Kit's sleeve colour may behave differently.

Layout: at field scale the party is about 30 px beside a 91 px Rustfang Punk, so the crew look like extras and the enemies dominate. The v0.1.0 back view has far more presence. Battle scale (46 px) still has not been put next to the enemies. The command menu opens at the left edge and covers the first enemy, because the party is now on the right. The foreground rail hides the front party slot below world row 100.

Images: `media/spike-side-battle/` (git-ignored): 1 and 2 are the lab sheets, 3 and 4 the side layout, 5 and 6 the v0.1.0 back view of the same fights, 7 the target cursor in the side layout.

## Corrections to day 1 (2026-10-02, from the day-1 checker)
Day 1's notes overstated four things. Corrected here; the lines above carry the same fixes inline.
- **The code-drawn limb at field scale** is coat-green on coat-green and nearly invisible; it needs a darker rim. It only "handled it better" at battle scale.
- **Field-scale poses are not clean.** "Raised overhead" still covers the eye, "forward" crosses the mouth and beard, and the low follow-through leaves a dark seam stroke where the old sleeve was.
- **The two sizes weren't the same trace.** Field scale used the traced `left` frame (`field.json`); battle scale used the `west` view (`views.json`). Different traces of the same character, so the size comparison also compared two drawings.
- **The walk-in was not built on day 1.** Step 2 listed "the idle bob and a walk-in"; day 1 shipped a static layout (one frame per pose, no idle, no walk-in). Both are built in round 1 of item A-layout (below).

## Item A-layout: battle-scale side layout (2026-10-02, judge round 1)
Built: `?battle=side` now draws the crew at BATTLE scale by default (`&scale=field` keeps the day-1 comparison); `&enemyscale=half` shrinks humanoid regular enemies; the flag is DEV-only (`import.meta.env.DEV &&`), so a shipped build ignores it. Images: `media/spike-side-battle/A-layout-r1-*.png` (git-ignored; 2x screens, 4x crew sheet).

**Crew at battle scale** (`src/art/rig2/sidecrew.ts`): each member's traced `west` view, nearest-shrunk so the soles are on row 46 (all four ~47 px with hair), the baked outline stripped and redone round the finished frame. A member is data: a source view, a hip row, a chest row. Sable's traced `west` is a narrow turned-away sliver with no face (identity fails), so she uses her `south-west` view, a three-quarter view facing left. Idle is a three-frame wait loop played 1-2-3-2 (the chest row drawn twice, so the head rises 1 to 2 px and the feet stay), each member at a different phase. Walk-in is the field rig's own leg swing (RotSprite about the hip, far leg a shade darker) on the battle-scale frame, four frames, not the slide-in fallback. The party steps in from the right edge during the shatter intro as one unit (same distance for everyone, so the spacing holds), about 1.1 s.

**Composition decisions** (the day-1 overlaps, and why):
- The command and round menus stay in the bottom-left corner, where players expect them, and the **enemies move off that column**: they fill the strip between it and the party (world x 46 to 140), closing up by up to 4 px if they would not fit, centred in it. Moving the menu to the right would have covered the party, since the party now owns that side.
- Enemies stand **10 world px (20 screen px) higher up the street** (bosses 6), behind every crew row, so the band under their feet is open ground. That band holds the ability/item list (now **beside** the command menu instead of stacked above it, four rows instead of five) and the **target-info box** (the bottom-left, whoever is aimed at, instead of the top corner opposite the target, which now covered the second enemy). Target cursor and enemy health bars were already above the art and stay clear.
- The foreground rail no longer hides the front slot: at 47 px the front member's soles are on world row 98 and the rail starts below that.
- The party diagonal is tighter (17 px steps instead of 19) so the enemy strip has room.

**Scale check** (step 7): the enemy traces (`enemies.json`) are only loosely 2x2 blocks (56 to 69 per cent of 2x2 cells are one colour for the humanoids), so a nearest half-shrink is not lossless the way the crew's is, but it keeps the palette and reads clean at 1x. At full size the 91 px punk and 96 px ghoul are roughly twice the crew's height; at `&enemyscale=half` they are 45 to 48 px, the crew's height. The Glowrat (creature) and the Warden (boss) stay large (Final Fantasy VI style), so the Glowrat is then bigger than the punks. Both are in the images.

## Time log, item A-layout round 1 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the day-1 code and the data | 11:22 to 11:25 | 3 | 0 |
| Crew pipeline, flag, engine hooks, first compile | 11:25 to 11:28 | 3 | 0 |
| First battle-scale layout look, Sable's source view, crew sheet | 11:28 to 11:31 | 3 | 1 (Sable's `west` view unusable) |
| Layout: enemy strip, lift, list and target box moved, boss lift, `enemyscale=half` shadow | 11:31 to 11:35 | 4 | 5 |
| `npm run check` (exit 0), commit, push | 11:35 | 1 | 0 |
| Walk-in as a unit, Hex's muddy far leg, list rows, final captures | 11:35 to 11:41 | 6 | 3 |

The whole item took about 20 minutes of wall clock for four members, the layout and the half-scale test; nine fix passes in all, none of them per-pixel repair.

## Item A-layout round 2 (2026-10-02, after the round-1 judges)
Round 1 scored 6.43 overall (identity 7, readability 6, motion 6, craft 6, composition 6, style 6, cost 8). The full-size 91 px enemies, the dark-on-dark crew, the fuzzy half-scale enemies and the backwards formation were the shared complaints. Images: `media/spike-side-battle/A-layout-r2-*.png` (git-ignored; 2x screens, 4x crew sheet, a filmstrip and a GIF of the walk-in and the wait loop). The numbers in the round-1 section above (strip, lift, step sizes) are superseded by what follows.

**Enemy scale (the default changed).** `?battle=side` now draws regular enemies at `fit`: each trace is collapsed to its native resolution (the best of four 2x2 phases, the commonest colour per block, orphan pixels dropped), then drawn 1.25x (humanoids) or 1.5x (creatures) by nearest. A punk is about 57 px beside the 47 px crew, the ghoul about 60, the Glowrat about 35 x 25. `&enemyscale=half` is the native size (a punk 46 px, the crew's height) and `&enemyscale=full` the old 91 px (kept for comparison). Bosses (Knuckles, the Lurker, the Warden) are never reduced. The traces are only 56 to 67 per cent uniform 2x2 cells (punk 61 per cent at phase 0, 67 at the best phase; ghoul 62 and 64; Glowrat 44 and 44), so the collapse takes a majority vote and loses a little detail; it keeps the one-block-wide gold rim as a one-pixel rim, which the round-1 nearest shrink broke into stairs. The 1.25x and 1.5x stretches repeat every fifth or third row and column, so line widths are slightly uneven in a zoom; the crew's own shrink (0.47, not 0.5) has the same kind of unevenness, so the two match at 1x. If that irregularity matters, `half` is the clean choice.

**Composition.** Slot 0 (Kit, first panel) is top-left and nearest the enemies; each next slot is 20 world px right and 7 lower (x 150 to 210, feet 76 to 97), the RPG Maker diagonal, so the sprites read in the same order as the panels. Enemies' feet are at about row 72 (lift 8), a few px above slot 0's feet, so the two sides share a ground plane; the strip is world x 46 to 134, and a group too wide for it (four punks) stands out over the menu column (to x 6), which is safe because the menus start under the enemies' feet. Minimum enemy gap is 2 px (it was -4). Every crew member has a contact shadow, like the enemies. The command menus, the ability list and the target box now sit 5 screen px higher so they no longer touch the active member's raised panel. The target cursor hangs just over the enemy's health bar (it was up to 30 px above it) and bounces 1 px, not 3.

**Crew.** All four got a finishing pass (`finish()`): the darkest trouser and boot colours lifted toward the midtone, the outline lifted from near-black (more on dark members), a thin cool rim on the back and top edge, and loose specks removed. The walk got a near-arm counter-swing about the shoulder (the day-1 arm cut) for Kit, Rook and Hex, a 1 px body drop on the passing steps, a longer stride for Rook, Hex and Sable, and a coat-hem sway for Rook. The wait loop is about 0.5 s a step and the last frame leans the upper body back 1 px.

**Honest issues.**
- Sable is still a three-quarter view (see the pose log): the traced `east` view is a back view, so a true profile needs a re-trace or a hand build.
- Rook's arm swing is only 9 degrees (at 16 the coat sleeve's dark seams turned to scribbles and left dark patches inside the coat), so his fist moves about 2 px, and his 1 px hem sway is hard to see at 1x: his walk still reads mostly as the bob and the boots.
- The Hex walk is still the weakest: thin grey-blue legs; the swing reads, the shape is a bit stick-like.
- The 1.25x enemy stretch is not pixel-perfect (see above), and the Glowrat is small (25 px tall) beside the crew.
- Nothing here exercises a strike, a cast or a hurt: motion and impact are unscored on this item; the walk-in and the wait loop are judged from the GIF and the filmstrip. The walk-in plays against the shatter intro, so the sprites are under translucent shards for the first second.
- Backdrop floor polygons are not checked per backdrop: in the sewer corridor the left ghoul stands against the wall base rather than on the lit floor.

## Time log, item A-layout round 2 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the data; start the dev server | 11:44 to 11:47 | 3 | 0 |
| Enemy collapse and stretch, `fit` default, diagonal, shadows, cursor, first look | 11:47 to 11:50 | 3 | 0 |
| Crew finish, arms, hem, wait lean, Sable `east` attempt, crew sheets | 11:50 to 12:02 | 12 | 4 (outline too light, arm gap colour, Sable `east` failed, Rook's arm angle) |
| Layout: panel gaps, cursor anchor, wide-group overflow, spacing (interleaved with the crew work) | 11:56 to 12:00 | 4 | 4 |
| Deliverable captures (screens, crew sheet, filmstrip, GIF); crew sheet, filmstrip and GIF twice, because Rook's arm changed after the first set | 12:00 to 12:04 | 4 | 0 |
| Docs, `npm run check` (exit 0), commit, push | 12:04 to 12:07 | 3 | 0 |

About 23 minutes of wall clock (the layout and crew rows overlap), 8 fix passes, none of them per-pixel repair. The judges' list had 25 distinct fixes; all but Sable's profile and a hem sway that is hard to see are in.

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes: what was learned and what to rebuild.
