# Spike: side-on battle view

> Copied to main on 2026-10-04 as the record. The spike code stays on branch `spike/side-battle` (draft PR #3, never merged).

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

## New Sprite Fusion assets from Mark (live list; builders: check this every round)
Mark keeps adding sprites to `spritefusion-tests/` (git-excluded, never commit). Use new battle assets as soon as they appear; they replace placeholders.
- 2026-10-02: `hex-battle-reference.png` (64x64, Hex in a battle stance facing right: goggles, handheld deck, cables, backpack rig). **Replaces the traced Hex placeholder** in the side-view line-up and is the base for her cast pose (static + code motion until Mark makes cast frames).
- 2026-10-02: `hex-battle-idle.zip` (8 frames, 64x64, 8 fps; "idle bounce, smooth loop, hanging cables slightly swaying", with a blink on frame 4). **Hex's battle idle loop**, the same way Kit's and Rook's idles are used.
- 2026-10-02: `rook-battle-crouched.png` (105x53, low crouch facing right, chrome arm trailing the katana low behind him, coat spread). Mark's name matches Kit's `crouched`, so use it as **Rook's low-HP kneel**; it also reads as a low dash, so try it as an optional frame for his lunge in before the wind-up and say which works better. The hair touches the canvas top edge: check nothing is clipped.
- 2026-10-02: `sable-battle-reference.png` (64x64: Sable in a battle stance facing right, orc shaman with white hair and tusks, red and brown robes, a feathered staff held upright). **Replaces the traced Sable placeholder** in the side-view line-up With this, all four crew have Sprite Fusion battle art. Then `sable-battle-idle.zip` (8 frames, 64x64, 8 fps, "idle bounce, smooth loop, staff feathers slightly swaying"): **Sable's battle idle loop**, used like the others (no code bob needed). All four crew now have idle loops.
- 2026-10-02: `sable-overworld-reference.png` (32x32: grey-green skin, white hair, red and brown robes, a feathered staff; front 3/4). Field art; Sable still has no battle sprite, so she stays on the traced placeholder in battle for now. Also `sable-overworld-walk.zip` (8-frame walk, 32x32, front 3/4): consistent identity, but a few stray magenta pixels near the robe hem in some frames (background-removal leftovers), so any import needs a stray-pixel clean-up pass.
- 2026-10-02: `hex-overworld-reference.png` (32x32) and `hex-overworld-walk.zip` (8-frame walk, 32x32, a front 3/4 view): field art, not needed for the battle spike.
- Mark's finding: Sprite Fusion's 8-direction sets are unusable (scale and details drift between directions), so none are saved. A side-view battle needs one facing; field facings would be made one at a time.

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

## Mark's stage feedback and rubric v2 (2026-10-02, evening)
After seeing the Sprite Fusion line-up and Rook's strike, Mark: "the camera angle / perspective is pretty off. It needs to be angled such that the characters appear on different Z-axis values. Make sure your rubric measures the look and feel of the battle stage against some of the references I sent you. This might mean redesigning the battlegrounds, menu system, etc. In fact it SHOULD involve that if we're really going to test the side-on battle style pivot. Because the character portraits along the bottom of the screen came pretty squarely from the PS4 style with all the characters lined up there."

So the spike now also redesigns the battle stage (camera, floor and backdrops) and the battle HUD. The Sprite Fusion loop was stopped after Kit's punch (scores so far: line-up ~7.0, Rook's strike ~7.1-7.4, Kit's punch ~7.0-7.8, all under the old rubric).

**Rubric v2** keeps the eight criteria above and adds three, judged with Mark's four reference screenshots open side by side (ref 1: party in a diagonal column with enemies on lanes and a turn timeline on top; ref 2: Final Fantasy II side view; ref 3: a 3/4 view with the party in an arc facing a big enemy; ref 4: side-on action with a combo counter and a left command list):
9. **Stage, camera and depth:** the floor reads as a 3/4 view seen from above at an angle; party members and enemies stand at clearly different depths (rear figures higher on screen, correct overlap order, contact shadows on the floor); the backdrop's horizon and the floor agree.
10. **Reference match:** the stage's look and feel sits comfortably next to the references; it would not look out of place among them.
11. **HUD for a side view:** designed for this view, not the Phantasy Star IV row of four portrait panels; turn order, commands, HP and resources stay readable while the stage stays visible.

Pass bar v2: median overall 8 or more, every criterion 7 or more, **and stage (9) and reference match (10) at 8 or more**, because they are the point of the pivot. A round that gains less than 0.25 overall ends the item early (plateau rule), up to 4 rounds.

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
| Crew graded for the night: `grade()` on the palette (saturation x1.28, soft lightness floor, legs higher), crisp outline back, two-tone rim, light soles, hair midtone (Kit) | battle | about 6 min | judge round 3 | 2 passes (a hard floor turned dark navy to pure blue and flattened Rook's coat seams, now a soft pull with saturation eased in proportion; Kit's hair mix came out lilac, halved). Code only: a palette function, no per-pixel edits. |
| Sable profile head: `east` flip tried, graft of the 3/4 face tried, `west` tried, then a hand-built 11x14 head over her `south-west` body | battle | about 14 min | judge round 3 | HAND WORK, 3 failed attempts first (the `east` mirror shrinks to a 14 px sliver with the face 2 px wide; the grafted face landed on her hand; `west` is a staff with a sliver). The final head is about 90 hand-placed pixels (ASCII rows over her own palette, `SABLE_PROFILE_HEAD`) over the 3/4 body: a face with a nose and an eye in profile, white hair behind. Well inside the 2 h per key pose budget, but not "data through shared code". |
| Walk r3: Hex's legs 1 px wider, Rook body drop 2 px on the passing frames, hem sway 2 px, heel lift (trailing foot up 1 px, Rook 2) | battle | about 3 min | judge round 3 | 0 passes. Spec fields (`legFat`, `bob`, `heel`), shared code. |
| Wait loop r3: head rise 0, 2, 3 rows (was 0, 1, 2) | battle | about 1 min | judge round 3 | 0 passes. Judged from the GIF. |
| Enemy scale r3: humanoids native 1x, creatures exactly 2x (default `fit`); `wide` keeps round 2's 1.25x/1.5x | battle | about 2 min | judge round 3 | 0 passes. No fractional stretch in the default. |
| Layout r3: crew drawn on the screen-resolution layer, party x 130 + 23 a slot, enemy strip 46 to 120, closing-up groups, per-backdrop ground table, walk gated on the shatter's end, active-member outline, white target chevron, boss contact patch | battle | about 14 min | judge round 3 | 5 passes (the sewer's left ghoul ran under the 5-row command menu; four punks overlapped; the active outline looked dotted, which exposed that the crew were being sampled 2:1 on the 240x135 layer, so they moved to the 480x270 enemy layer). |
| Crew base r4: the `south-west` trace collapsed to native resolution (49 to 59 px), all four, graded (skin exempt), outline redone | battle | about 8 min (finding it included) | judge round 4 | 1 pass (Kit's gloves left white: the metal recolour's saturation limit was too tight). Replaces rounds 1 to 3's nearest shrink of `west` (0.41 of the trace, below native) and Sable's 90 hand-placed head pixels: a member is now a trace, a hip row, a knee row, two leg column ranges, a chest row and a lead arm. |
| Wait loop r4 and walk r4 (a step lifts one leg's shin and foot 2 rows and swings it a column, the rows taken out so the leg stays one solid shape; a crouch on the passing frames; a lean on the steps) | battle | about 4 min | judge round 4 | 0 passes. `bendLeg`, `crouch`, `rise`, `lean` in `sideops.ts`. No RotSprite, so no ghost legs; leg boxes picked from a gridded view. |
| Lead arm drawn again for the poses: strike, wind-up, cast, victory, hurt (Kit, Hex, Sable bare fist; Rook with the katana in two hands) | battle | about 12 min (coordinates for four arms included) | judge round 4 | 4 passes (Hex's and Sable's sleeve pixel was a dark seam, so the arm came out black; Rook's wind-up fist sat on his face and the blade was too long; the glove recolour; the hurt arm crossed the chest). A pose is a hand place in arm lengths, an elbow side, a lean and a crouch (`ARM_POSE`, `posed()`). |
| Brace (the crouch before); item, thrust and aim reuse the cast, strike and wind-up frames | battle | about 3 min | judge round 4 | 0 passes. |
| Strike beats and lunge: crouch, wind-up, dash with a smear, blow held on the target, return (`sideBeat`), carried to the target by `reachX/reachY` set in `playback.ts` | battle | about 10 min | judge round 4 | 2 passes (the dash stopped 25 screen px short of the first enemy: `SIDE_LUNGE_MAX` 60 to 84; stop distance 15 to 13). Data: `SIDE_LUNGE_MAX`, `SIDE_LUNGE_STOP`, the beat table. |
| Hurt: recoil frame (lean back, crouch), knockback 2.5 px springing back over 10 frames, the body's own pixels white for the first 2 frames then a faint red tint | battle | about 4 min | judge round 4 | 1 pass (the arm). Replaces the flat red wash. |
| Enemy scale r4: every enemy (humanoids, creatures, bosses) collapsed to native and drawn 1x: punk 46 px, ghoul 48, Glowrat 23 wide, Warden 69 | battle | about 3 min | judge round 4 | 0 passes. One pixel density for every sprite; `&enemyscale=big` is round 3's look (Glowrat 2x, Warden 138), `half` bosses full, `full` the traces. |
| Layout r4: party x 154 + 17 a slot, feet 79 + 5.5, enemies right-aligned to x 132, group gap 2 to 6, contact shadows 18 px wide, walk-in lanes (3 rows off, converging) | battle | about 6 min | judge round 4 | 2 passes (the `full` comparison ran an enemy into Kit: the minimum gap now lets a too-wide group overlap itself, not the party). |
| B-rook-strike: ready (chudan), sword forward, point at the throat | battle | about 2 min (shared with the builder) | judge round 1 | Code-drawn limbs with a dark rim, both arms (the chrome one and the coat sleeve with the bare hand, which is now cut out too) by IK onto a two-handed `katana()` grip. 2 passes: the second arm's coordinates were 4 px off (the hand left a skin block on the coat; a fatter capsule then split the coat), so the bare hand's leftover skin pixels are turned to coat. Data: `KATA_POSES.ready`. |
| B-rook-strike: lift, hands rising in front of the face, point up | battle | under 1 min | judge round 1 | 0 passes. Code-drawn limbs (rim). Data only. |
| B-rook-strike: furikaburi, sword raised overhead, blade tilted back | battle | about 3 min | judge round 1 | 2 passes: the hands sat on the visor and the blade crossed the face; hands raised and forward, 3 rows of rise, blade at -64 degrees. The hands still sit in front of the brow (chibi arms cannot reach above the head). Code-drawn limbs (the turned arm vanishes in the coat). |
| B-rook-strike: cut frames 1 and 2 with a smear arc, front foot lifted | battle | about 2 min | judge round 1 | 1 pass (the smear was a thick white scythe; thinner and paler). The arc is painted on the frame behind the blade from the angles it swept, so it is data (from, to), not pixels. Code-drawn limbs. |
| B-rook-strike: men-uchi contact, arms extended, blade level at head height, front foot down, back heel up | battle | about 1 min | judge round 1 | 1 pass (grip raised 2 px, blade shortened to 22 px). Held 12 frames through the hit; a dust puff at the front foot for 6 frames. Code-drawn limbs. |
| B-rook-strike: zanshin (point back up, guard held), then ready again while sliding back | battle | under 1 min | judge round 1 | 0 passes. Zanshin is the guard with the blade higher and the body upright. |
| B-rook-strike: timeline, lunge and engine wiring (`kataTimeline`, `kataBeat`, `KATA_WINDUP`, `KATA_STOP`, `dd.strikeAt`) | battle | about 5 min | judge round 1 | 3 passes: the timing ring starts the effect about 18 pose frames in, not 8 (so the old fixed beats had the blade arrive 10 frames before the hit), so beats are keyed to the effect start; `at` came in fractional (the contact landed 1.5 frames late), now rounded; the active arrow sat on the raised blade and stayed behind in the dash, so it rides the lunge and lifts 13 px. |
| B-rook-strike r2: draw (hand over the shoulder to the hilt, a hand of steel out; then the blade up behind the head), and the same two keys read backwards as the sheathe | battle | about 3 min | judge round 2 | 1 pass (draw2's blade crossed the face at -100 degrees; hand moved behind the head, -78). Two `one` rows (`draw1`, `draw2`) in `KATA_POSES`: one hand on the hilt from the far shoulder, the other hanging. The scabbard hilt is already cleared from his back. Replaces the pop from the wait loop. |
| B-rook-strike r2: ready (chudan) and lift, with a longer stride (front dx -2) | battle | about 1 min | judge round 2 | 0 passes. Data only. Lift grip [-8,-5], blade -100: the fists stay left of the face. |
| B-rook-strike r2: overhead (furikaburi), fists above the hair, blade laid back at -55 | battle | about 4 min | judge round 2 | 2 passes: arm bones 8 to 10 (`KATA_BONE`, every frame, so the fists can clear the head), then the far shoulder turned in (twist 9) because its reach was pulling the grip down to the brow. The far arm is now drawn under the body, so the pale wedge across the face is gone; glasses and hair read. Turned arm not used (code-drawn limbs, every pose). |
| B-rook-strike r2: cut in three frames (swing0 -95, swing1 -130, swing2 -162) with a wedge smear between the previous and current blade angle | battle | about 4 min | judge round 2 | 3 passes (the wedge read as a white pennant twice: cover 11 px to 7 to 5). The smear is data (from, to) painted as a wedge pivoting between the hands: full blade length at the leading edge, a sliver at the tip behind, three solid bands (white, pale, pale steel from `fx.ts`), no loose dots. Front foot lifts 1 to 3 rows. |
| B-rook-strike r2: men-uchi contact, a 3 px blade (white edge, steel, dark spine, glint at the point), stride -7 / +4, crouch 3 | battle | about 3 min | judge round 2 | 0 passes. Needed one small change in shared code: `katana()` got an optional `spine` flag (default off, so the v0.1.0 back view is unchanged). |
| B-rook-strike r2: zanshin, blade level at chest height (-172), upright | battle | about 1 min | judge round 2 | 1 pass (it first looked the same as ready; now taller, hands higher, blade nearly level). |
| B-rook-strike r2: timeline (draw, 3 cut frames, contact shown 3 frames BEFORE the effect, continuous lunge, sheathe) and lane (`KATA_MEASURED`, `KATA_BITE_FRAC`, `KATA_LANE_*`, `dd.target`) | battle | about 12 min | judge round 2 | 4 passes: the stop was measured from the target's weapon, not its body (the tip stopped short of the body), so the point now goes 0.4 of the way from the body's centre to its front edge; the lunge's reach is measured from the drawn frame (`KATA_MEASURED`), not a constant; the dim list (computed at the stop) missed the rat crossed on the dash, so dimming is now by Rook's x each frame; Kit was crossed too, so crewmates dim as well. |
| B-rook-strike r2: effects (ghosts one and two beats back, the plain body in the slash colour; a 3-stage dust puff at the front foot; blade flare on the first three contact frames; health bars fade under the lunge; the arrow hides while he runs) | battle | about 6 min | judge round 2 | 2 passes (ghosts too heavy, 0.4 to 0.3; the puff looked like a bowl, now pale blobs over dark ones). Code in `drawKataFx`, no per-pixel work. |
| B-rook-strike r2: arm craft: the chrome forearm on a cool steel-blue ramp (hue break from the olive sleeve), far arm under the body | battle | about 2 min | judge round 2 | 1 pass. Replaces the near-white forearm that read as a pale wedge. |
| F-sf-layout: Kit idle, her 8 frames from `kit-battle-idle.zip` at 8 fps (7.5 render frames each) | battle | about 3 min (loader and anchoring shared by every member) | judge round 1 | 0 passes. Data: a file name and a step. Frames are cut onto equal canvases centred on the mean feet midpoint, bottom on the soles, so the soles do not slide. Her loop never moves her feet, so none was needed. |
| F-sf-layout: Rook idle, sword drawn (`rook-battle-idle.zip`, 79x68, 8 fps) | battle | about 1 min | judge round 1 | 0 passes. The coat flare and blade make the canvas 2x his body's width; he is anchored by his feet, not the canvas, so his body stands where Kit's does. |
| F-sf-layout: Hex idle (`hex-battle-idle.zip`, 8 frames, with a blink on frame 4) | battle | about 1 min | judge round 1 | 0 passes. Arrived mid-round (15:33) and replaced the traced placeholder at once. |
| F-sf-layout: Sable, the first loop's traced `south-west` crew frames flipped to face right | battle | about 2 min | judge round 1 | PLACEHOLDER: no Sprite Fusion art yet. She is 53 px beside 64 to 68, in a different style (graded, 3/4 view, lighter outline), and her 3-frame wait loop runs at 0.5 s a step, slower than the others' 8 fps. Her staff swaps hands in the flip (nobody notices at 1x). |
| F-sf-layout: walk-in (Kit `kit-battle-running` with a 1 px bob every 5 frames; Rook his relaxed `rook-idle` frames sliding in, sword on his back; Hex her stance with a bob; Sable the traced walk flipped) | battle | about 4 min | judge round 1 | 1 pass (the walk distance: members start from the left edge, the front one just off it, so the formation steps in as a unit at 2 px a frame, about 75 frames). Only Kit has a real run pose, so it is a glide with a bob; Rook's relaxed idle reads as a saunter. No draw-the-sword frame, so his sword jumps from his back to his hands on arrival. |
| F-sf-layout: layout flipped (party left facing right, enemies right): slots x 124, step 24, feet 72 + 4 a slot; enemy strip 142 to 225; list, menu and target box unchanged under the party | battle | about 10 min | judge round 1 | 3 passes (the first slots at step 19 overlapped Hex over Rook over Kit, since Mark's sprites are 36 to 50 px wide; step 26 left the enemies no room; settled on 24 with the strip from 142). Data: `SF_PARTY_*`, `SF_ENEMY_*`. The turn strip and the menu column are cleared: Sable's left edge is x 52 against the menu's 44. |
| F-sf-layout: enemy scale 1.5 for humanoids, creatures and bosses (`scale3x` then a 2:1 vote) | battle | about 6 min | judge round 1 | 1 pass (the Warden at 2x was 138 px and 2.1x the crew; 1.5 gives 104 px, 1.6x). A punk is about 69 px (Kit 64, Rook 68), the ghoul about 72, the Glowrat about 35 wide. One whole-pixel grid, no half pixels; the source is native-resolution art, so enemies read softer than Mark's sprites (no new detail appears). |
| F-sf-layout: colour clean-up, one shared palette per character (distance 16) | battle | about 5 min (including the python trial at 8 to 32) | judge round 1 | 0 passes. Kit 5,830 shades across her frames became 143, Rook 3,277 became 94, Hex 1,577 became 111; side by side at 4x the cleaned and raw sprites cannot be told apart, so it is kept for palette discipline, not looks. At 24 the jeans and the steel arm lose shading. `&clean=0` shows the raw art. |
| F-sf-layout: action poses filled from Mark's static frames (Kit: punch1 wind-up, punch3 blow, punch2 thrust, crouched brace, injured hurt, victory; Rook: strike1 wind-up, strike2 blow and thrust) through the first loop's beats and lunge, which now runs to the right | battle | about 3 min | judge round 1 | PLACEHOLDER for the next items: cast, item, aim are the stance; Rook's hurt, brace and victory are his stance; Hex has no action frames. The lunge stops 13 world px short of the target's centre and Kit's fist overlaps a punk's body at the hit. |
| F-sf-layout r2: Sable from Mark's `sable-battle-reference.png` and `sable-battle-idle.zip` (8 frames, 8 fps), replacing the traced placeholder | battle | about 1 min | judge round 2 | 0 passes. Two names in `STILLS` / `SHEETS` and a spec; the traced, mirrored Sable is gone from the Sprite Fusion path. Round 1's "Mark needs to make her" was stale: the files had landed at 15:42. She is 61 px tall, same density as the others. |
| F-sf-layout r2: party slots as data, `SF_SLOTS` in `rig2/sfgeom.ts`: x 111, 77, 45, 15 and feet 78, 69, 60, 58, climbing to the top-left, the back two over the command-menu column | battle | about 10 min (the slot maths from the loop extents included) | judge round 2 | 2 passes (the first spacing gave Rook's blade 2 px from Kit; the loop extents the engine really draws are wider than the quick estimate). Each gap is the next member's widest idle reach plus 4 px. The old descending diagonal put Sable's feet on the menu's rows, so the order is reversed: Kit lowest and nearest, the others further back and up. Cost: Hex and Sable stand on the pavement edge at world row 58 to 60. |
| F-sf-layout r2: `tests/sflayout.test.ts` | battle | about 4 min | judge round 2 | 0 passes. Reads Mark's PNGs (skipped where they are absent): neighbours' idle frames 4 px apart, nobody off the left edge, 8 px to every menu rectangle (`SF_KEEP_OUT`), 24 px between Kit and the nearest enemy. |
| F-sf-layout r2: enemy finish, `finishTrace` in `rig2/enemy.ts` (flip the punk and the ghoul to face the party, despeckle, fold near shades at distance 20, a 1 px dark outline except where the trace's own edge is already dark) and the gold rim light off | battle | about 12 min | judge round 2 | 1 pass (the first despeckle left the face squinting; a three-of-four majority pass and the shade fold added). Data in, data out: `finishEnemies(sprites, flip)`. `&finish=0` shows round 1's look. The punks are still front-view, turned only by the club side. |
| F-sf-layout r2: enemy placement by opaque width (`SF_ENEMY_*`, `enemyPos`): one staggered row, or the small creatures in a front row (9 rows lower, drawn last) when that does not fit | battle | about 8 min | judge round 2 | 1 pass (the rat in the front row stands on the seam between the punks, so it is fully visible). No second copy is mirrored under `art=sf` (a mirrored punk turned its back to the party). |
| F-sf-layout r2: Warden at 1.75 (was 1.5; `&bossscale=1.5` to 2) | battle | about 2 min | judge round 2 | 0 passes. 1.5 gave 104 px, 1.6 times Rook; 1.75 is 121 px and holds the frame; 2 (a boss in 2x2 blocks) is chunkier than the crew's pixels. Nearest scaling at 1.75 puts a few single and double rows, hard to see at 2x. |
| F-sf-layout r2: walk-in: Kit the run pose bobbing 0-2-0-2 rows at 4 frames a step, then a skid into the stance over the last 8 px; Rook his sword-drawn idle at twice speed with a 1 row bob (no sword swap on arrival); Hex and Sable their idle loops at twice speed with the bob; the last 24 px ease to a quarter of the speed | battle | about 8 min | judge round 2 | 1 pass (the walk time had to account for the ease so the first orders wait for it: `walkFrames`). Still not a real run or walk cycle: only Kit has a run frame (one). The formation arrives together at one speed, so Kit leads Rook by their slot gap (34 world px) all the way; that is the formation, not a faster Kit. |
| F-sf-layout r2: pose map: Rook brace and hurt are `rook-battle-crouched` (never the sword-on-back art); everything he has no frame for (cast, item, aim, victory) is the sword-drawn idle frame 0 | battle | about 2 min | judge round 2 | 0 passes. GAPS for the action items: Kit has no KO, no cast, item or aim; Hex and Sable have no action frames at all (every pose is the stance, marked "(stance)" on the crew sheet); Rook's hurt and brace are the same frame; his strike frames are anchored by the lowest rows, which include the blade tip in `strike2`, so his body sits left of his slot at the blow. |
| F-sf-layout r3: enemies at WHOLE multiples only: regulars 1x native (a punk 48 px, the ghoul 50, the Glowrat 25 wide), bosses exactly 2x (the Warden 138); the 1.5 and 1.75 scales are only behind `&regscale=` / `&bossscale=` | battle | about 6 min | judge round 3 | 1 pass (native punks beside Kit's 64 px read small but crisp, on the crew's 1:1 grain; the Warden at 2x is the backdrop's grain and v0.1.0's size and the orb's ghost face is back). No new scaler: `stretchTo` already doubled exactly. Cost of the choice: regulars are about 0.75 of the crew's height, a gap only new enemy art fixes. |
| F-sf-layout r3: enemy face and palette: `FACE_FIX` data for the punk (cheek noise flattened to one skin tone inside a box; two open eyes, a white pixel beside a dark one, under dark brows, applied at native size before flip and scale) and the shade merge raised 20 to 30 | battle | about 8 min | judge round 3 | 1 pass (the box has to keep the mouth line). 12 single pixels of data for ONE sprite: the only per-pixel work in the round, and it is data, not a repaint. The punks now look at the party with open, angry eyes; the ghoul needed none. |
| F-sf-layout r3: party slots from PIXEL clearance, not boxes: x 122, 92, 61, 32 and feet 78, 73, 68, 60 (was x 111, 77, 45, 15 and feet 78, 69, 60, 58) | battle | about 12 min (a python solver on Mark's PNGs, and the test) | judge round 3 | 3 passes (the solver rounded the feet axis half-to-even and the engine rounds half-up, so Hex touched Rook by one pixel; Rook and Kit moved one pixel; the box test was replaced by a pixel-mask test). Rook's raised blade passes over Kit's head, so boxes needed 34 world px between members and pixels need 30. Hex stands low because her widest reach is 8 art px right of the command menu; only Sable is held up by the menu. |
| F-sf-layout r3: walk-in per member (`SF_WALK`): Kit runs, Rook dashes on his low-lunge frame (`rook-battle-crouched`) with speed ghosts and a skid into the stance; Hex and Sable step in 14 px while fading in on their idle loop, once the runners are past them | battle | about 25 min | judge round 3 | 3 passes (Kit and Rook ran through each other; Hex and Sable appeared before the runners and were run through; Rook's delay 4 to 14, the back two's 8 and 14 to 32 and 40). The runner's pose is one still with a bounce: a dash, not a cycle, and it only convinces because it is fast (3.8 world px a frame) and short (about 45 frames). Mark's `*-overworld-walk` sheets are front-facing 32 px field art, so they were not used. |
| F-sf-layout r3: Rook hurt is his sword-drawn stance under the engine's recoil and white flash (no longer the crouch) | battle | about 1 min | judge round 3 | 0 passes. The crouch read as a lunge, not a hit; still a placeholder until Mark makes a hurt frame. |
| F-sf-layout r3: front-row creature's HP bar drawn under its feet (below the contact shadow) | battle | about 4 min | judge round 3 | 0 passes. A `front` flag on the layout entry and one line in `renderEnemyStatus`. The Glowrat's bar no longer crosses a punk's legs; checked with the cursor on the Glowrat in the four-enemy shot. |
| F-sf-layout r4: regular enemies at 1.25x (was 1x) through a new area-vote scaler in `stretchTo` (scale3x, then each output pixel takes the colour with most area in its 3/m block; 1.5 is the old 2x2 vote); bosses stay 2x | battle | about 8 min | judge round 4 | 1 pass (the first try used nearest, which doubles every fifth row and column). A punk is 59 px (Kit 64, Rook 68), the ghoul about 62: party-sized and a group again. Honest cost: one native pixel is 1 or 2 screen pixels by turns, so the grain is a little uneven against the crew's 1:1. 1x, 1.5x and 2x stay behind `&regscale=`. |
| F-sf-layout r4: punk head turned toward the party: `FACE_FIX.punk.turn` (rows 0 to 17 slide 2 native px toward the club before the flip) | battle | about 4 min | judge round 4 | 0 passes. One number of data. The head now looks past the body toward the party; the torso emblem and feet are still front-view, so it is a lean, not a 3/4 turn. |
| F-sf-layout r4: ghoul lifted 20 percent toward light (`liftEnemies`) and the enemy outline darkened to #07060c | battle | about 5 min | judge round 4 | 0 passes. Palette only (accents and the outline are skipped). The legs no longer vanish into the navy street. |
| F-sf-layout r4: walk-in: Hex and Sable now RUN in like Kit and Rook (their idle loops at 4 frames a step with a 2 px bob and one ghost, no fade), delays 29 and 42 so they land about 6 and 13 frames after Rook; Rook's dash frame anchored by his boots (`bootsMid` in `sfgeom.ts`), not the lowest rows | battle | about 12 min | judge round 4 | 2 passes (the delays; a filmstrip to check Rook's body sits on his slot). Whole entrance about 64 frames. Still no true run cycle for Hex or Sable: a scurry on the idle loop. |
| F-sf-layout r4: health bar plate raised to 8 px over the art (`SF_BAR_RISE`), target chevron hangs 2 to 6 px over the plate (just over the head for a front-row creature) on a dark plate of its own | battle | about 8 min | judge round 4 | 1 pass (the front-row rat's chevron was floating 14 px up). The plate no longer covers the Warden's scanner. |
| F-sf-layout r4: enemy strip starts at world x 140 and the lane to Kit is 16 art px (was 144 and 24) | battle | about 2 min | judge round 4 | 0 passes. Tighter stand-off; `tests/sflayout.test.ts` still passes. |
| G-sf-rook-strike: anchors as data (`SF_ANCHORS` in `rig2/sfstrike.ts`): the four canvases (idle 79x68, strike1 69x110, strike2 101x66) laid on one 122x139 canvas by FRONT BOOT and SOLES, the axis at the centre column | battle | about 3 min (measuring on gridded 8x views and in python included) | judge round 1 | 0 passes. Front boot = the heavier of the two boot-sized column groups in the lowest 8 rows, ignoring the blade tip's long thin run (strike2's lowest rows hold the boots AND the blade point). Idle 53.5, wind-up 60, follow-through 62; soles 67, 109, 65. The stamping foot never slides; the rear foot reaches back 5 px and the head comes forward 11, which is the lunge. `tests/sfstrike.test.ts` re-measures Mark's PNGs and fails if a frame is regenerated. |
| G-sf-rook-strike: ready and wind-up (the idle loop, then `rook-battle-strike1` as it is) | battle | under 1 min | judge round 1 | 0 passes. Mark's frames, no repaint. Wind-up held 5 to 10 frames (longer when a timing ring is closing); ready 3 to 6. |
| G-sf-rook-strike: swing A (strike1 body with its sword cut out by geometry, a code blade at -50 degrees and a crescent from -158 degrees) | battle | about 2 min | judge round 1 | 0 passes. The smear is data (pivot, radius, start and end angle, leading width) rasterised in three solid bands in Mark's steel colours. Honest: with a 54 px radius the crescent reads a little like a scythe; the gold guard of the old sword is left at the hands. |
| G-sf-rook-strike: swing B (`rook-battle-strike2` with a crescent from -46 degrees to the blade point), fade (thin crescent), follow-through (strike2 clean) held 13 frames | battle | about 1 min | judge round 1 | 0 passes. The blade the arc ends on is Mark's own. |
| G-sf-rook-strike: timeline and lunge (`sfTimeline`, `sfBeat`; effect at the second frame of swing B, held through the cut line, damage and hitstop; the slide back in the ready stance) and the reach from the measured blade point (`SF_MEASURED.tipDx`, `SF_BITE`) | battle | about 4 min | judge round 1 | 1 pass: the point stopped at the club's edge (the enemy box includes the club), `SF_BITE` 0.45 to 0.15. Data: the step table, `SF_HOLD`, `SF_RETURN`, `SF_BITE`, `SF_ROOM_MAX`. |
| G-sf-rook-strike: engine: `men_r` cut (a steep diagonal ending on the blade point, the spark on Rook's side), Kit steps back to make room (30 world px), speed ghosts, a dust puff at the front boot, the target recoils away from Rook | battle | about 4 min | judge round 1 | 1 pass (the cut line was at chest height while the blade is at the ground, now it ends on the point). Reuses the first loop's lane, hitstop, shake, GPU hit and health-bar fade. |
| G-sf-rook-strike r2: anticipation and recovery, as data (`SF_POSES.dip`, `.recover`: the idle frame with leg rows 47/51/55 (51/55) dropped and the torso leaned back 3 px (forward 3 px); the overhead held 4 frames however long the ready stance runs) | battle | about 4 min | judge round 2 | Awaiting judges. Round 1's 5 to 10 frozen frames of overhead are now 2 frames of coil then 4 of overhead; extra time (a timing ring) is spent in the breathing ready stance. `bend()` moves whole rows, no resampling. |
| G-sf-rook-strike r2: swing A and swing M (the wind-up body bent forward and down: 3 and 7 rows dropped, lean 3 and 7; HIS sword cut out of the wind-up frame, guard included, turned 58 and 136 degrees about the hands; a two-band crescent of 38 and 64 degrees trailing the point) | battle | about 12 min | judge round 2 | Awaiting judges. Replaces round 1's code-drawn blade (gone), the floating gold guard (it now travels with the blade), the 54 px scythe crescent (now thin, tapering at both ends, steel sampled from his strike2 blade) and the 2-frame hold of the same body. Honest: still stand-ins; the bend stretches the arms a little. |
| G-sf-rook-strike r2: swing B and fade (strike2 with a streak from -52 degrees, head height, to the blade point, then a thin one) | battle | about 2 min | judge round 2 | Awaiting judges. |
| G-sf-rook-strike r2: staging (Kit steps out of Rook's row over his dip and wind-up and DUCKS into her own `crouched` frame; Rook's row is chosen so the blade point is at the target's hip height) | battle | about 8 min | judge round 2 | Awaiting judges. Nobody is crossed by his body any more at the punk, the Warden or a Glowrat; at the Glowrat her hair is within a few pixels of his rear boot for two frames. |
| G-sf-rook-strike r2: head tint (the backdrop's neon bloomed over his hair: party silhouettes are cut out of the backdrop's glow before the blur) and steel-blue ghosts (two at most, 35 and 20 percent, 2 world px apart) | battle | about 6 min | judge round 2 | Awaiting judges. The tint was the bloom pass, not a tint layer on the sprite: shown by it following whichever sign was behind his head. |
| G-sf-rook-strike r2: impact (the point ends 5 world px inside the target's BODY front, not its club; the cut line ends on the point at hip height; spark, ring and a two-stage star centred on that end; white blink on the target through a 4-frame hitstop; shake 11; the number above the health plate) | battle | about 6 min | judge round 2 | Awaiting judges. |
| G-sf-rook-strike r3: anticipation (`dip` 4 frames, five leg rows out of the idle frame; `rise` 2 frames, four thigh rows out of strike1 with no lean, so nothing above the knees shears; the overhead `windup` held 9 frames, `SF_DIP`, `SF_RISE`, `SF_UP`) | battle | about 4 min | judge round 3 | Awaiting judges. The two bent swing stand-ins of round 2 are gone. Pose frames run at `FX_PACE` 0.65 per tick, so a pose frame is about 26 ms: dip 103 ms, overhead 231 ms, 24 frames (615 ms) from the order to the effect. |
| G-sf-rook-strike r3: swipes (`SF_SWIPES`, `drawSwipe`: smear A = strike1 body with its sword cut out whole + a fan from -168 to -78 degrees; smear B = strike2 as drawn + a fan from -100 to -18; swing B = strike2 + -40 to 21; a thin tail; each smear frame held 2 frames) | battle | about 6 min | judge round 3 | Awaiting judges. A fan is an elliptical sector about the hands (reach 54 by 26 above the wind-up so no frame rises over 113 art px, 24 px under the name plate), a bright rim, dithered steel inside, a one-pixel leading blade line. Every body frame is Mark's pixels untouched; the join between strike1 and strike2 is hidden by the swipe, which is a stand-in for his missing in-between. |
| G-sf-rook-strike r3: staging (Kit does not duck: she steps BACK into Rook's empty place as he runs forward, her progress being his lunge, `SF_ROOM`; Rook is drawn last so they cross behind his body; Rook stands on the target's floor: soles at most 6 world px above its soles, `SF_SOLES_ABOVE`, `SF_LANE_UP/DOWN`) | battle | about 8 min | judge round 3 | Awaiting judges. They cross for about 4 frames (Rook in front), and a tip of his coat touches her ponytail on 1 or 2 of them; at rest and at impact nothing touches. |
| G-sf-rook-strike r3: impact and style (enemies cut out of the neon glow like the crew; flash on the target 0.4 white, was 0.55; a steel-blue afterimage of the cut line for 8 frames; one DITHERED steel ghost behind the dash instead of two flat blue ones) | battle | about 4 min | judge round 3 | Awaiting judges. No full-screen flash (still washes the picture). |
| G-sf-rook-strike r4: anticipation from Mark's own crouch (`SF_ANCHORS.crouch`: `rook-battle-crouched` 105x53 as the dip, front boot 97.5, soles 52; stand-up in two steps `riseA` 8 rows and `rise` 4 rows out of strike1's thighs; overhead held 3 frames, was 9) | battle | about 5 min | judge round 4 | Awaiting judges. The charge is the body rising, not a frozen pose. Lead from the order to the effect is 17 pose frames, about 435 ms at the real 25.6 ms pose frame (round 3: 24, 615 ms). `SF_DIP` 3, `SF_RISEA` 1, `SF_RISE` 2, `SF_UP` 3, tested under 450 ms. |
| G-sf-rook-strike r4: in-between body `mid` (strike1 body, sword cut out, 16 thigh rows out, head carried 6 px forward over the front foot) and smear A's body 6 rows lower, so the body no longer pops from upright to the lunge in one step; lunge at about 0.14 per frame (0.10, 0.24, 0.38, 0.52, 0.66, 0.82, 1.0) | battle | about 6 min | judge round 4 | Awaiting judges. Honest: `mid` is a stand-in made of Mark's rows, not a drawing; the arms stay overhead and the legs squat. `SF_POSES.mid`, `.lowA`, `sfTimeline`; tested (no frame skips more than 0.2 of the dash). |
| G-sf-rook-strike r4: blade and crescents (`drawBlade`: a drawn katana from the grip, dark outline, bright edge, light steel, gold guard sampled from Mark's own; `drawSwipe`: a thin crescent in three solid bands that tapers to a point, no fill, no dither; smear A and mid carry the blade, smear B, swing B and the fade carry a crescent that ends short of the target) | battle | about 6 min | judge round 4 | Awaiting judges. Smear A's hands are no longer empty; the pivot is the grip; the crescent ends 4 art px short of the blade point at swing B. Data: `SF_SWIPES`. |
| G-sf-rook-strike r4: Kit steps back into the second row (up the street 18 world px and 4 left, eased, by the beat: up before the dash, down in the last 3 frames of the way home) instead of walking through his empty place | battle | about 14 min (three measured runs) | judge round 4 | Awaiting judges. Measured with the renderer's own cut list (opaque pixels shared by Rook and Kit): round 3's position hid 80 to 83 percent of her for about 4 ticks at smear A and again on the return; now 0 before the dash, at most 61 percent for about 4 ticks at the dash (head covered on 3 of them), 33 percent through the hold (legs only, head clear) and 7 to 49 percent on the return. Not zero: a lunge down his own lane must cross her in a side view with no room beside him (Hex is 31 world px to his left). |
| G-sf-rook-strike r4: hit blink and impact point (the target is a hard swap to one light tint with its dark outline kept, opaque, on alternate frame pairs through the hitstop; cut and spark at 0.5 of its height, ring radius at most 0.35 of its body width; blade point 7 world px inside the body front; recoil 4 px through the hitstop, 13 ticks) | battle | about 6 min | judge round 4 | Awaiting judges. Round 3's 0.4 white overlay read as a pale ghost. The hit anchor is now at the waist on the punk, the body centre on the Glowrat and the Warden's trunk; the blade point stays at the legs. |
| G-sf-rook-strike r4: composition and doc fixes (the yellow active chevron is gone once the strike begins; the swipe ghost is one solid 30 percent tone 1.5 px behind; the strip uses the real 25.6 ms pose frame and wrapped captions) | battle | about 3 min | judge round 4 | Awaiting judges. The code-art path (`&art=code`) was run once and plays its own strike. |
| H-sf-kit-punch: anchors as data (`PUNCH_ANCHORS` in `rig2/sfpunch.ts`): idle, load, jab, cross, kick and run laid on one 72x64 canvas by the PLANTED FRONT BOOT and SOLES (the kick by its TOE) | battle | about 6 min (gridded 10x views and python measuring included) | judge round 1 | 0 passes. Worked out from the images: `punch1` is the LOAD (both fists up, body coiled), `punch2` the JAB (lead arm out, other fist on the chest), `punch3` the CROSS (arm fully out, hips turned, the far arm hidden), `kick` a side kick at head height. The jab's and the cross's fists are both 18.5 px past the front boot, so one reach serves both; the kick has no front boot, so its toe is laid on the fist column (its standing foot ends 17.5 px behind the front boot). `tests/sfpunch.test.ts` re-measures Mark's PNGs. |
| H-sf-kit-punch: smears as data (`PUNCH_SMEARS`): a tapered streak over the arm on the frame before the jab and the cross, a crescent about the hip behind the kicking leg; colours built from her own jacket (`jacketRamp`: gold trim, orange body, near-white core) | battle | about 5 min | judge round 1 | 2 passes (the first streak ran up over her neck and jaw, now starts at the shoulder; the kick crescent was first a scythe, then a hook, now 52 degrees of sweep). Three solid bands, no dither, through Rook's `drawSwipe` with a palette argument. Honest: the streak replaces the arm for one frame, and it is the only in-between there is. |
| H-sf-kit-punch: timeline (`punchTimeline`, `punchBeat`): guard, [run], load 3, jab smear 1, jab 3, cross smear 1, cross 3, kick smear 1, kick 13, guard 3, home 8; blows 4 frames apart | battle | about 8 min | judge round 1 | 0 passes. Lead from the order to the first blow is 4 pose frames (102 ms) for a near target and up to 12 (307 ms) for the farthest; a timing ring's extra time is spent in the breathing guard. Lunge: a step in over the load (a run of 3 to 8 frames at about 10 world px a frame for reach over 14), the jab at .94, the cross at .98, the kick at 1. The load frame is reused as the guard after the kick. |
| H-sf-kit-punch: engine (`punchCombo` in `playback.ts`): three blows on one damage roll, each `punch_r`, a GPU hit, a 2 px shove, a target blink and a 3-frame hitstop; the last blow only plays its effect and the engine's damage event lands the number, the 11-shake and the 4-frame hitstop | battle | about 10 min | judge round 1 | 2 passes (the pose clock and the script disagreed by 1.6x on the tick a round starts: see the next row; the stop distance was first the pose's tip minus the old constant). Reach: the tip ends `PUNCH_PIERCE` (2) world px inside the target's body front; she stands on its floor a hair in front; each blow's point is the tip's height above her soles clamped inside the body (`PUNCH_HIT_MAX`). |
| H-sf-kit-punch: fix in shared code: `anim` in `battle.ts` refreshes the effect rate before converting frames | battle | about 7 min (finding it) | judge round 1 | 1 pass. On the tick a round starts the timing prompt is armed after that tick's rate was set, so a held confirm made the rate 1.6x for the tick and `perReal` (pose frames per real frame) came out 1.6x: the pose clock lagged the effect by 13 real frames and the blows fired before the fist arrived. Shows in Rook's strike too if Rook acts first; not otherwise reproduced. |
| H-sf-kit-punch: `punch_r` effect (`fx.ts`): a four-point star at the contact, a flat flare driven on through the target, a small ring, chips; power .8 / 1 / 1.3 for the jab, cross and kick | battle | about 3 min | judge round 1 | 0 passes. Two frames to the flash. Rook's `men_r` untouched. |
| H-sf-kit-punch: the kick as the finisher | battle | decision | judge round 1 | KEPT. It reads at once as a different, bigger blow (a leg, not an arm, at head height with the body leaning back) and gives the combo a three-beat rhythm; the cost is the pop from the cross (square on, planted on both feet) to the kick (balanced on one foot) in one smear frame, because Mark has no chamber frame. `PUNCH_FINISHER` turns it off (a two-blow combo, the cross held 13 frames). |
| H-sf-kit-punch: stray magenta pixel dropped from the kick when the PNGs load (`dropStrays`), a far target gets a run in (`kit-battle-running` with the speed ghost), the active chevron hidden from the first frame, a dust puff at the planted boot | battle | about 3 min | judge round 1 | 0 passes. Data and a rule (fully saturated purple no part of the crew is). |
| H-sf-kit-punch round 2: retract between the blows | battle | about 4 min | judge round 2 | 0 passes. Mark's `punch1` (the load) is reused as the coil: jab, load 2 frames, cross, so the arm comes back before the next blow goes out. The planted front boot stays planted (load, jab and cross share it). |
| H-sf-kit-punch round 2: chamber and foot-drop for the kick, `bendLeg` in `rig2/sfpunch.ts` (the kick's shin turned 45 and 22 degrees about the knee, nearest-neighbour, no new colour); the kick now stands on the LOAD's back foot | battle | about 9 min | judge round 2 | 2 passes (a 55 degree bend thinned the shin at the cut, 45 kept; the first anchor was the toe, which put the standing foot 8 world px behind the cross's). Chamber: load 1 frame, `kickC` 2, then smear 2, trail 1, kick held 10; drop: `kickD`, `kickC`, load. Stand-in for the frames Mark's edit tool would draw. |
| H-sf-kit-punch round 2: smears behind the arm, 3 pose frames each (2 smear + 1 trail on the blow's first frame), from the elbow, 1-2 row core; kick crescent hugging the leg's underside | battle | about 6 min | judge round 2 | 3 passes (the first streak, behind the arm, was invisible: it needs 15 to 17 rows of fan to show beyond a 4 row arm; the crescent was a talon at the toe until its radius and thickness were set from the leg: hip (24, 31), toe 40 px along at -21 degrees). The fist and the wraps stay on top in every frame (tested: the plain frame's pixels are unchanged under the smear). |
| H-sf-kit-punch round 2: shove per blow (`PUNCH_PUSH` and the kick push, world px forward of the lunge: jab .5, cross 1.2, kick 3), spark and shake and hit pause per blow (`PUNCH_BLOW`: power .5, .8, 1.3; hitstop 2, 3, then the engine's) | battle | about 5 min | judge round 2 | 1 pass. Jab light, cross medium, kick heavy. The spark and the GPU hit are drawn 2 px past the fist (`PUNCH_SPARK_PAST`) so the fist stays visible at contact. |
| H-sf-kit-punch round 2: target reaction: first two blows a soft tint (flash 1, alpha .2) and a light recoil (6 then 9 frames of the knock table), the last the hard colour swap and the full recoil | battle | about 3 min | judge round 2 | 0 passes. The face and the red mark stay readable through the first two blows. The damage number was already above the target's head (`floatOn`); not changed. |
| H-sf-kit-punch round 2: lane (`PUNCH_LANE_AHEAD`): her soles go 3 world px below the feet of any enemy nearer than the target, so she runs in front of it on a lane of her own | battle | about 4 min | judge round 2 | 1 pass. Replaces round 1's lane on the target's own floor, where she was drawn over a nearer enemy at the same depth. The silhouettes still overlap in 2D for about 3 frames of the run and while she stands beside it; she is clearly in front of it (feet 4 px lower). |
| H-sf-kit-punch round 2: crouch variant for targets under `PUNCH_LOW_BELOW` (22 world px): `kit-battle-crouched` placed by its fist, two low blows, no kick | battle | about 6 min | judge round 2 | 1 pass (the fist column was first read from the front boot, which is further right and lower). The fist meets the Glowrat's body (12 px up) instead of passing over its back. The dive from the load into the crouch is about 6 world px, covered by the smear frame, the dash ghost and a negative push on the load. |
| H-sf-kit-punch round 2: hit or miss is known before the follow-up blows: the act plays the first blow and stops; the `damage` event plays the rest (`punchRest`, keyed to the pose clock); the `miss` event calls the combo off (`dd.punchStop`) | battle | about 9 min | judge round 2 | 1 pass. A miss now plays the jab, the target leans out of it (recoil table, no flash), MISS floats and she settles with no cross or kick. The jab's spark still plays before the engine says miss (the engine rolls at `land`, after the timing press). |
| H-sf-kit-punch round 2: colours | battle | about 2 min (measured only) | judge round 2 | 0 passes. `cleanColours` already folds Kit's 5,830 shades to 143 at distance 16 (hair and jacket highlights kept); a built frame carries 91 to 99 colours, the smears add none beyond her jacket's three. A coarser fold flattened the jeans and the steel in an earlier round. Not changed. |
| H-sf-kit-punch round 3: a real chamber and drop, `poseLeg` in `rig2/sfpunch.ts` (the kick's leg cut out by its band, the thigh turned about the hip and the shin about the knee, nine sub-samples per pixel, the knee cleaned: gap filled, edge outlined, warm flecks and spikes dropped); four frames `kickB` (thigh +34, shin +62), `kickC` (+14, +78), `kickD` (+22, +52), `kickE` (+46, +24) | battle | about 25 min (the first cut left ragged edges and two orange flecks, three clean-up passes) | judge round 3 | 3 passes. Replaces round 2's shin-only rotation, which was in fact a flexed ankle (the cut was at the boot). No new colour (tested), the body and the standing leg are Mark's pixels. Chamber: load 2 frames, `kickB` 1, `kickC` 2 (was load 1, `kickC` 2); drop: `kickD` 2, `kickE` 2, load 2 (was 1, 1, 1). Still a stand-in for his edit tool. |
| H-sf-kit-punch round 3: smears | battle | about 6 min | judge round 3 | 2 passes (the streak ended past the fist and read as a flame in front of it: it now ends under the fist). Cross streak 29 px long (was 20), 3-4 rows thick at its thin end, a white core that thickens toward the fist; jab short and thin. Kick crescent thinner (a tapering band, gold fading toward the jacket's dark trim). Low-blow streak longer. |
| H-sf-kit-punch round 3: fist squash on the first frame of each blow | battle | about 2 min | judge round 3 | 0 passes. `PUNCH_SQUASH`: the trail frame (and its streak) is drawn 1 art px past the resting column, so the hit is told by the pose too. |
| H-sf-kit-punch round 3: sparks per blow | battle | about 8 min | judge round 3 | 1 pass. `punch_r` takes `soft` (jab, cross: star radius 4.5 x power, flare capped at 10 world px and at 60 percent alpha) and a ring colour per blow (jab pale gold, cross a thick white ring, kick orange); the spark of the jab and cross sits 3 px below the fist row (chest and jaw), the kick's flare is a quarter shorter and its spark 4 px past the toe (`PUNCH_SOFT_DROP`, `past` in `PUNCH_BLOW`). The cross shoves the target 4 px (`PUNCH_KNOCK.cross` 9 to 11 frames of the recoil table), the jab 2. |
| H-sf-kit-punch round 3: enemies she overlaps fade (`punchFade` in `battlekit/render.ts`) and the lane is 7 px below the nearest enemy's feet (was 3) | battle | about 12 min | judge round 3 | 2 passes (the opaque-span helper returns an exclusive end). A non-target enemy goes to 40 percent opacity as her drawn frame overlaps it by 8 px or more, eased, and comes back as she goes home; nothing is stored. Measured per tick in the captures (a far target behind the near punk: 67 of 91 ticks at full fade and 23 more in transition; the Glowrat: 54 of 65 at full fade and 4 in transition; a near target fades nobody). |
| H-sf-kit-punch round 3: hit or miss before the first spark | battle | about 15 min | judge round 3 | 2 passes. `windupAndHit` can be silent; the first blow's spark, GPU hit and recoil are played from the `damage` event (every blow, each waiting for its pose frame), a `miss` event plays `punch_whiff` (a dull puff and an air-cut 8 px short, no star, no shake, no pause) and the target leans out. Known cost: with the timing ring on and NO press, the engine resolves a late-window (6 frames) after the ring, so the jab's spark comes about 8 ticks after the fist; a press near the beat resolves at the press and is on time (see the issues). |
| H-sf-kit-punch round 3: multi-hit as data on the actor | battle | about 10 min | judge round 3 | 0 passes. `BlowSpec` rows (`at`, power, ring, shake, hit pause, recoil frames, spark offset) in `PUNCH_BLOW`, one routine `multiHit` in `playback.ts`, the pending blows on `Disp.followUp` (no module-level `punchRest`). Rook's or Sable's multi-hit is another table, not another function. |
| H-sf-kit-punch round 3: Glowrat crouch | battle | about 8 min | judge round 3 | 1 pass. The low blow's spark and GPU hit sit at 0.7 of the target's height (`PUNCH_LOW_AT`, about 8 px on the rat, was its head); a longer arm streak; the low frame held 3 frames (was 2); the second low blow is pushed 2 px more and holds 2 px further. Still Mark's kneel as a punch: a proper low jab is on the shopping list. The damage number is kept inside the field (`FLOAT_MAX_X` 207, side view only), off the turn-order column. |
| H-sf-kit-punch round 4: the 40 percent fade is gone (`punchFade` and `PUNCH_FADE` deleted); she runs on a lane 10 px below the nearest enemy's feet (was 7, `PUNCH_LANE_AHEAD`; the lane may now go 14 below her place, `PUNCH_LANE_DOWN`, was the shared 9) and is drawn over whatever she passes at full opacity | battle | about 6 min | judge round 4 | 0 passes. All three judges read the ghost as a render bug. Nothing is stored or eased any more; the far-target and Glowrat captures show a solid punk beside her, not a see-through one. |
| H-sf-kit-punch round 4: chamber without the stepping frame: `kickB` dropped, `kickC` (knee up) held 3 pose frames (was 2 + 1) after the load, so load 2, knee up 3, smear 2 is about 180 ms of clear anticipation | battle | about 5 min | judge round 4 | 0 passes. The judges read `kickB` (thigh +34, shin +62) as a step forward and the load-to-kick torso change as a pop; one fewer rule frame also means one fewer place for flecks. The torso still changes from the 3/4 guard to the kick's front-on lean in one frame; that is Mark's art, see the shopping list. |
| H-sf-kit-punch round 4: stray pixels at the hip, `despeckle` in `rig2/sfpunch.ts` (any 8-connected island of 5 px or fewer that is not the biggest piece is dropped) on `kickC`, `kickD`, `kickE` | battle | about 6 min | judge round 4 | 1 pass (the first view showed the black pairs beside the hip were separate islands, so a flood-fill beat patching the cut). Unit-tested on a synthetic frame. The thigh is unchanged: at 9x it already tapers into the jacket hem, so no thickening was added. |
| H-sf-kit-punch round 4: foot continuity, `PUNCH_KICK_SHIFT` = 6 art px: the kick is laid 6 art px (3 world px) forward of the load's back boot, not exactly on it | battle | about 8 min | judge round 4 | 1 pass. Anchored exactly on the back boot, the kick's head sat about 20 art px behind the load's (the "body slides"). Now the boot steps 3 world px forward as the front leg lifts (a weight shift) and the head is 14 art px behind the load's instead of 20; the kick's toe lands 3 world px nearer the fists' column, so `toeShort` falls from 4 to 1 and the stand-off `PUNCH_KICK_SHORT` is 0. NOT solved: the torso still leans back by 7 world px between the load and the knee-up, because that is how Mark drew the kick. |
| H-sf-kit-punch round 4: sparks, `chunkStar` in `battle/fx.ts` replaces the 1 px lens-flare star on `punch_r` | battle | about 12 min | judge round 4 | 1 pass. A four-point star of 2 px strokes in her jacket's white, gold and orange, a 2x2 white core, short diagonals; radius 6 x power (jab 3, cross 5, kick 8: the cross is 1.7x the jab, the kick the biggest). The star sits 3 (jab), 4 (cross) and 5 (kick) world px AHEAD of the knuckles or toe (`past` in `PUNCH_BLOW`, was 2), so the wrap and the punk's chest stay visible. Cross hitstop 5 frames (was 3), shake 6, the extended cross held 3 pose frames (was 2). |
| H-sf-kit-punch round 4: sparks of the first two blows are gone before the next wind-up: star 4 frames, ring 4, flare 3, particles 5 to 6 frames (was 12 to 28) | battle | about 4 min | judge round 4 | 0 passes. In the captures the load frame after the cross shows only a faint trace and the knee-up frame is clear. The kick's own sparks keep the old length. |
| H-sf-kit-punch round 4: hold the jab at full reach until the engine answers (`Disp.poseHold`, set in `multiHit`, released by `followUp.hit/miss`) | battle | about 10 min | judge round 4 | 1 pass. With the timing ring on and no press the fist now stays on the target (measured: 11 ticks on `jabT`, then the spark, shove and flash land on one tick) instead of pulling back and sparking 8 ticks later. A press near the beat answers first and nothing is held. The wait itself is not shortened: that needs the engine to roll before the ring (outside this item). |
| H-sf-kit-punch round 4: miss, `punch_whiff` is now a 3 px dust puff at the fist (the three parallel dashes are gone); a repeated label over one target replaces the first (`floatOn`); the label is gold | battle | about 6 min | judge round 4 | 0 passes. The "double MISS" of rounds 2 and 3 was the previous actor's MISS (Rook and Hex missed the same punk in the forced-miss capture) still on screen under Kit's; a player can see it too when two crew miss one enemy. The "clipped" MISS in the round 3 sheet was my crop. |
| H-sf-kit-punch round 4: Glowrat, number over the rat (`FLOAT_MAX_X` 212, was 207), hurt flash 2 frames for Kit's blows (was 5), second low spark power .7 (was .95) | battle | about 5 min | judge round 4 | 0 passes. The rat is the last in the strip and stands at the turn column by design of the layout item; I did not move the strip. The crouch is still Mark's kneel with a level fist: a low-hook frame is on the shopping list. |
| H-sf-kit-punch round 4: party colour grade, `clean` per member in `rig2/sfcrew.ts` | battle | about 8 min | judge round 4 | 0 passes. Kit and Hex 24, Sable 20, Rook 16 (his steel arm loses shading above that). Kit falls from 146 colours to about 70 with no visible loss at 5x (32 makes her jeans black, the limit), Hex 111 to 65. Done in a Python mock-up first. The traced Hex and Sable placeholders the judges mention were already replaced by Mark's Sprite Fusion art before this round. |

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

## Item A-layout round 3 (2026-10-02, after the round-2 judges)
Round 2 scored 6.43 again (identity 6, readability 6, motion 5, craft 6, composition 7, style 6, cost 8; impact unscored). Images: `media/spike-side-battle/A-layout-r3-*.png` (git-ignored; 2x screens, 4x crew sheet, a 3x filmstrip, a GIF and an APNG of the walk-in and the wait loop). The numbers in the round-1 and round-2 sections above (strip, lift, step sizes, `fit` at 1.25x) are superseded by what follows.

**The root cause of "noisy crew" (found this round).** The party was drawn onto the battle's 240x135 world layer, shown 2x, while the enemies are drawn on a 480x270 screen layer. A 47 px battle-scale sprite drawn on the small layer is sampled 2:1 (nearest), so three pixels in four were thrown away: broken lines, a dark arm "seam", dots for hands. In side view the crew are now drawn on the enemy layer (`render.ts`, `drawPartyMember(el, ...)`), at one art pixel per screen pixel, the same density as the enemies, and positions snap to a native pixel. Most of the round-2 craft and readability complaints were this. The v0.1.0 back view still uses the small layer (unchanged).

**Crew.**
- Colour: each member's palette is graded once (`grade()`): saturation x1.28 and a soft floor on lightness (trousers and boots higher), so Kit's navy, Hex's dark trousers and Rook's coat lift with their hues kept; Kit's near-black hair takes a warm plum midtone; the outline is a crisp near-black again (round 2's lifted outline made dark members ghostly); a cool rim on the back and top edge and a warm one on the front edge (the enemies carry a warm rim), only where a part is at least two pixels thick; light soles.
- Sable: a hand-built profile head (face with a nose and a yellow eye, white hair behind) over her three-quarter `south-west` body (see the pose log: three data-only tries failed first). She is now a profile at the head and a three-quarter at the body, which at 47 px reads as a profile.
- Walk: Hex's legs a pixel wider, Rook's body drop 2 px on passing frames, hem sway 2 px, a heel lift on the trailing foot for everyone (Rook 2 px). Wait loop: the head rises 0, 2, 3 rows.
- Active member: a one-pixel outline in the turn yellow, beating, besides the arrow (raised 3 px so it clears the hair).

**Enemies.** The default is whole-number sizes: humanoids at the collapsed trace's native resolution (a punk 46 px), creatures at exactly 2x (a Glowrat about 47 px wide). `&enemyscale=wide` keeps round 2's 1.25x and 1.5x for comparison, `half` makes creatures native too, `full` is the 91 px trace. Health bars sit 3 px (was 6) above the art; the target chevron is white with its dark outline.

**Composition.** Party x 130, 153, 176, 199 (was 150 to 210), feet 76 to 97; enemy strip world x 46 to 120; a group too wide for it closes up (neighbouring art overlaps by up to 5 px of its transparent margin and every other enemy stands 6 px further back) and never starts left of 38, so a four-enemy group clears the command column. The sewer's enemies stand 5 px lower (`SIDE_ENEMY_LIFT_BY_BG`, data) so their feet are on the walkway; the other seven backdrops were checked and need no offset. The Warden gets a wider contact patch. The party now walks in only after the shatter has cleared (`walkStart` is set when the intro ends; the wait after it is the length of the walk), at 1.5 px a frame, about 85 frames, nearly four walk cycles on a clear screen.

**Honest issues.**
- There are still no strike, cast or hurt frames: every pose uses the idle frame. The strike and hurt stills (`strike-hit`, `strike-damage`, `hurt-flash`) show the real round (hit arc, damage number, red flash, shake) on that frame, and the crew do not lunge toward the enemy (that is the later strike item). Motion is judged on the walk and the wait loop only.
- Sable's head is hand work, and her body is still three-quarter; her staff is a thin brown line.
- Hex's legs are still the weakest part: his trousers are a grey-violet and the walk reads as a shuffle.
- The Glowrat at 2x is a clean integer size, but its blocks are 2 px against the crew's 1 px, a visible density mismatch (a creature, not a humanoid).
- A four-enemy group overlaps itself by a few px, and the 5-row command menu can still cover a few transparent pixels of the leftmost enemy in the widest groups.
- The enemy attack and its GPU hit on a distant target are unchanged: a Glowrat bite lands on Sable across the whole screen with nothing travelling between them.

## Time log, item A-layout round 3 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' list; look at the round-2 images; the dev server (an earlier one was already on 3007) | 12:06 to 12:10 | 4 | 0 |
| Crew grading, rim, heel lift, wider legs, wait loop; crew sheets | 12:10 to 12:15 | 5 | 2 (hair lilac; a hard floor made blue specks and flat seams) |
| Sable: `east` mirror, face graft, `west`, then the hand-built head | 12:14 to 12:19 | 5 | 3 (three failed tries) |
| Enemy scale, slots, walk gating, cursor, active outline, boss patch, per-backdrop lift, montage of eight backdrops | 12:16 to 12:22 | 6 | 2 (the sewer's ghoul under the menu; four punks overlapped) |
| Root cause: the crew moved to the screen-resolution layer | 12:25 to 12:27 | 2 | 1 |
| `npm run check` (exit 0) | 12:22 | 1 | 0 |
| Deliverable captures: ten screens, the crew sheet, a filmstrip, a GIF and an APNG, strike and hurt stills | 12:27 to 12:31 | 4 | 0 |
| Docs, concepts, check, commit, push | 12:31 to 12:40 | 9 | 0 |

About 34 minutes of wall clock (some rows overlap), 8 fix passes, one piece of hand work (Sable's head, about 90 pixels).

## Item A-layout round 4 (2026-10-02, after the round-3 judges)
Round 3 scored 5.75 (identity 6, readability 6, motion 5, craft 6, composition 6, impact 4, style 6, cost 7). Images: `media/spike-side-battle/A-layout-r4-*.png` (git-ignored; 2x screens, a crew sheet, filmstrips of the strikes, casts and the walk-in, a GIF and an APNG). Rounds 1 to 3's sizes, slots and the crew pipeline are superseded by what follows. The day-1 overstatements the day-1 checker flagged (the code-drawn limb nearly invisible at field scale, field poses covering the eye and mouth, field `left` against battle `west` being different traces, the walk-in not built on day 1) are corrected in "Corrections to day 1" above.

**The finding that changed the crew.** The traced views are drawn in 2x2 pixel blocks, so each collapses exactly to its native resolution with the same `collapseBlocks` the enemies use: Kit 57 px, Rook 49, Hex 59, Sable 53, one art pixel per screen pixel. Rounds 1 to 3 shrank `west` by nearest to 46 px, which is 0.41 of the trace and below native: detail thrown away and sampled unevenly (the noise, the missing faces). That is also the "hero scale" the judges asked for (55 to 60 px) with no fractional stretch, so no separate hero build was made. The second finding: the `south-west` view is the only trace where all four have a readable face (Kit's eyes, Rook's visor and beard and his chrome arm, Hex's goggles, Sable's face and white hair), so every member now uses it. That removes round 3's "Sable is a three-quarter among profiles" break and her hand-built head.

**Crew (`sidecrew.ts`, `sideops.ts`).** A member is data: the trace, a hip row, a knee row, two leg column ranges, a chest row and a lead arm (shoulder, hand, radius, a sleeve pixel and a fist pixel). Grading leaves skin untouched (round 3's boost turned faces orange) and uses lower floors (round 3 turned Hex's dark trousers grey). Kit's gloves take a cool grey-blue metal ramp by box. From the base the code makes: the wait loop (chest row drawn twice, 0, 1, 2 rows), the walk (a leg's shin and foot lifted 2 rows with the rows taken out, so it stays solid; a crouch on the passing frames; a lean on the steps), and brace, wind-up, strike, cast, hurt and victory (the lead arm cut out by a capsule, the torso filled, then drawn again as two bands and a fist reaching where the pose says; a lean and a crouch). Rook draws the katana in two hands (`heldKatana`), overhead for the wind-up, level for the blow, and his sheathed hilt is cleared from his back while it is out.

**Impact.** A melee strike now plays on beats (`sideBeat`): a crouch drawing back, the wind-up frame, a two-frame dash with speed ghosts, the blow held on the target through the hit, then the return. The actor is carried to the target (`reachX/reachY` from `playback.ts`, capped at 84 world px, stopping 13 px in front of the target's centre) and drawn last so it passes in front of the line. Hurt is a recoil frame with a 2.5 px knockback that springs back, the body's own pixels white for 2 frames, then a faint red tint. The hitstop, shake and GPU hit are the engine's, unchanged.

**Composition and scale.** Every enemy is native 1x (punk 46 px, ghoul 48, Glowrat 23 wide, Warden 69), so there is one pixel density across the sprites (the backdrop is still 2 px blocks: sprites finer than their backdrop, which is what Mark asked for). The crew (49 to 59 px) are a little taller than the punks, as in v0.1.0. The party is tighter (x 154, 17 a slot; feet 79, 5.5 a slot), the enemies are right-aligned to x 132 so the band between the two sides is only the lunge, and no group overlaps the party (a group too wide for the strip overlaps itself first). Contact shadows are 18 px wide. The walk-in members start on lanes up to 3 rows off their places and converge. `&enemyscale=big` keeps round 3's 2 px Glowrat and full-size boss for comparison.

**Honest issues.**
- The backdrop is 2 px blocks and the sprites 1 px: two densities in the frame (sprites against backdrop), not three.
- The crew are three-quarter (facing left and a little at the camera), not pure profile.
- The drawn lead arm is two or three pixels wide and reads thin beside the traced body; Rook's chrome arm is on the resting arm only (the strike arm is drawn in the same tone but plain).
- Cast is an arm raise and a stretch, with no distinct spell stance for Hex or Sable; the effects carry the cast.
- During a dash the actor crosses a neighbouring enemy when the target is not the nearest one; it is in front, but it overlaps for a few frames.
- The Warden at 69 px is only about 1.2x the crew's height; it is bulky (73 wide), but far less imposing than the 138 px version (`&enemyscale=big`).
- Kit's hair is the trace's dark plum, not near-black with a magenta sheen.
- The top third of the frame is backdrop sky; the battle line was not lowered (the panels and the foreground rail leave about 6 world px).
- A lifted boot in Hex's walk may read slightly detached; leg boxes were picked from a gridded view and not tuned per frame.
- Motion and impact are judged from filmstrips and a GIF, not at speed by a person; the KO frame is still the hurt silhouette.

## Time log, item A-layout round 4 (wall clock from the session clock, rounded; Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code and the judges' list; the dev server | 12:34 to 12:38 | 4 | 0 |
| The finding (native collapse, the `south-west` view): grids, views | 12:38 to 12:42 | 4 | 0 |
| Crew pipeline, leg and arm data, poses, crew sheets | 12:42 to 12:47 | 5 | 4 (sleeve colours, katana, glove ramp, hurt arm) |
| Engine: beats, lunge, hurt recoil, flash, native enemies, slots, lanes | 12:47 to 12:53 | 6 | 3 (lunge reach, stop, enemy gap) |
| `npm run check` (exit 0), first commit | 12:56 | 1 | 0 |
| Deliverable captures: screens, strike and cast filmstrips, hurt, walk-in, crew sheet | 12:56 to 13:00 | 4 | 0 |
| Docs, concepts, check, commit, push | 13:00 to 13:03 | 3 | 0 |

About 29 minutes of wall clock, 7 fix passes, no per-pixel repair (the `south-west` base replaced round 3's 90 hand-placed pixels).

## Item B-rook-strike round 1 (2026-10-02)
Rook's kendo men-uchi at battle scale, played through the real playback engine behind `?battle=side`. Images: `media/spike-side-battle/B-rook-strike-r1-*.png` (git-ignored): the frame strips (`frame-strip` for the default case with a timing ring closing, blow on pose frame 18; `frame-strip-no-ring`, blow on frame 12), six in-battle captures at 2x stepped one tick at a time, two 3x zooms and a GIF (`clip`, no mp4: there is no ffmpeg on this machine).

**What it is.** `rig2/sidekata.ts` holds the strike as data: seven key poses (`ready`, `lift`, `overhead`, `swing1`, `swing2`, `contact`, `zanshin`: lean, crouch, rise, torso twist, where the forward fist sits from the shoulder, the blade angle, the two feet, an optional smear arc) and a timeline (`kataTimeline(at)`, which frames are held how long and how far along the lunge the body is). `rig2/sidekatadraw.ts` turns a key into a frame: the body with both arms cut out and the coat filled in, the legs set, a crouch or rise, a lean, `katana()` laid on the grip, both arms by two-bone IK onto the two fists (bone length one constant, `KATA_BONE`), a dark rim round each arm, and the smear arc painted behind the blade. Limbs are code-drawn in every pose, never the turned traced arm (the sleeve is the coat's colour, so a turned arm disappears). The frames are wider than the others (padded 44 px each side of the body, so they stay centred on the same spot) and are the `kata` field of Rook's `Battler`.

**How it plays.** `playback.ts` gives Rook's melee attack a 12-frame wind-up (Kit's stays 8), and `windupAndHit` tells the body `at`, the pose frame the effect starts on, before it waits: 12 with no ring, about 18 while a timing ring is closing (the ring holds the wind-up, so the blade lands on the beat instead of 10 frames before it). The timeline is laid out backwards from `at`: ready, lift, overhead (the spare time goes into these two), two cut frames carrying the dash, contact held 12 frames through the effect, the hit and the hitstop, zanshin 7, then ready again while the body slides back (9). The lunge is `reachX/reachY`, and he stops `KATA_STOP` (22 world px) in front of the target, further than Kit, because the blade reaches about 23. The effect, damage, shake and GPU hit are the engine's, anchored on the target as before; the contact frame lands as the effect starts and the hit follows 4 frames later. The active arrow rides the body through the lunge and rises 13 px over the raised blade. Nothing runs without `?battle=side`.

**Honest issues.**
- The hands in furikaburi sit in front of the brow, not above the head: a chibi arm cannot reach, and the blade passes in front of the forehead. It reads as a raised sword, not as a perfect overhead.
- The first frame pops from the wait loop (hands down, sword sheathed on the back) to a drawn sword in chudan; there is no draw frame.
- The return is a slide back in the guard frame, then a pop to the wait loop (sword back in its scabbard on his back); there is no sheathing.
- The dash passes in front of the second enemy (it is in front: Rook's feet are lower), and at contact his body overlaps that enemy's left half.
- The blade at contact is thin (2 px) and the engine's slash and flash over the target hide its tip for the first frames of the hit.
- The wait loop's lift and the walk are unchanged; the other three members still use the round 4 strike and cast frames.
- The speed ghosts and the dust puff are quick sketches (a tinted silhouette and five pixels).
- Judged from stills and a GIF, not played at speed by a person.

## Time log, item B-rook-strike round 1 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the data; dev server on 3007 | 13:04 to 13:09 | 5 | 0 |
| Data module, drawing module, the sidelab strip | 13:09 to 13:12 | 3 | 0 |
| Strip fixes (second arm coordinates and cut, blade length, smear, overhead, zanshin) | 13:12 to 13:16 | 4 | 4 |
| Engine wiring (playback, render, battler), first captured round | 13:15 to 13:17 | 3 | 0 |
| Timeline rounding, `npm run check` (exit 0, after one lint pass), commit, push | 13:19 to 13:21 | 2 | 2 |
| Arrow fix, deterministic captures (one tick a frame), strips, GIF | 13:21 to 13:24 | 3 | 1 |
| Docs, concepts, check, commit, push | 13:24 to 13:26 | 2 | 0 |

About 22 minutes of wall clock, 7 fix passes, no per-pixel repair: the seven poses are 7 rows of numbers. Judge round 1 is next.

## Item B-rook-strike round 2 (2026-10-02, after the round-1 judges)
Round 1 scored 5.6 to 7.1 (composition 5, impact 6; readability, motion and craft 7; identity and style 8; cost 8). Images: `media/spike-side-battle/B-rook-strike-r2-*.png` (git-ignored): the frame strip at 4x (every frame, in order, with hold lengths and the lunge), in-battle captures at 2x stepped one tick at a time (draw, chudan, overhead, two cut frames, the blade meeting the target before the flash, the impact with the effect, zanshin, the return and the sheathe), 3x and 4x zooms, the same strike on the middle punk and on the nearest enemy (the Glowrat), and a GIF.

**What changed, against the judges' list.**
1. Composition. The lunge is no longer a constant: `playback.ts` reads the target's box (`enemyBox`: its opaque columns and its soles row), stops so the blade's point is inside the body, and puts Rook on a row just in front of the enemy line (`KATA_LANE_*`: his soles 8 px below the target's, never higher than Kit's). The dash and the return pass in front, and `dimOver` in `render.ts` halves the opacity of any enemy or crewmate his body is on that frame (Kit is crossed on the way out and back). Enemy health bars fade to 20 per cent where his lunge box crosses them, and the yellow arrow hides while he runs (it sat on the bars).
2. Furikaburi. The far arm is drawn under the body, the arm bones are 10, the far shoulder turns in, the grip is [-2,-19] and the blade lies back at -55: the fists clear the hair and the glasses show.
3. Contact. The blade is 3 px (white edge, steel, dark spine, glint at the point). The contact shows 3 pose frames before the effect starts (`KATA_LEAD`), with bright streaks along the blade for the first three, and the effect is anchored 4 px toward Rook, so the steel is seen meeting the target before the flash. The point now measurably lands in the target's body (the stop is computed from the drawn frame).
4. Smear: a wedge between the previous and current blade angle, three frames of cut (-95, -130, -162) instead of two, three solid bands.
5. Draw and sheathe: `draw1`, `draw2` at the start, read backwards at the end, so there is no pop from the wait loop; the hilt on his back is cleared while the sword is out.
6. Craft: the chrome forearm is a steel-blue ramp against the olive sleeve; ghosts are the plain body (no smear) in the slash colour, one and two beats back; the dust is a three-stage puff tied to the stamp.
7. Weight: stride -7 / +4 at contact, crouch 3, front foot lifted 3 rows in the cut; zanshin is tall with the blade level at chest height, so it differs from ready.

**Honest issues.**
- When the target is not the nearest, Rook's body still stands over the enemies between (dimmed to half, but present). With enemies a body-width apart there is no clear lane in a flat scene; the dimming is the answer, not a clearance.
- Kit is dimmed while Rook runs through her place; the crew stand in the dash lane.
- The 49 px sprite's arms are 10 px bones (it was 8): longer than the traced arm, fine overhead, a little long in the guard.
- The smear is thin (5 px at the leading edge): it reads as a streak at 1x, not as a big arc.
- The engine's own flash and slash are unchanged and still cover the target's body; Rook's blade is visible beside them, the contact is not tinted by them.
- The dust and ghosts are code-drawn blobs and silhouettes, not hand-tuned art.
- Judged from stills and a GIF, not played at speed by a person. No mp4 (no ffmpeg on this machine).

## Time log, item B-rook-strike round 2 (wall clock, Claude time; sub-step boundaries approximate, the clock was read at 13:25, 13:35, 14:56, 15:02)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' list; dev server on 3007 | 13:25 to 13:30 | 5 | 0 |
| Data (draw, three cuts, new poses), drawing (behind-the-body far arm, one-handed poses, wedge smear), first strip | 13:30 to 13:35 | 5 | 0 |
| Strip fixes (smear thickness, chrome ramp, twist, draw2, zanshin) | 13:35 to 13:45 | 10 | 4 |
| Engine: lane and stop from the target's box, lead frame, health bar fade, arrow, ghosts, dust, flare, test stubs | 13:45 to 14:20 | 35 | 4 |
| Captures and checks (tip reach, which target, the dim list, party dim, fixing the capture script) | 14:20 to 14:55 | 35 | 3 |
| `npm run check` (exit 0, after one lint pass), commit | 14:56 to 14:58 | 2 | 1 |
| Deliverables (strip, 17 captures, 4 zooms, GIF), docs, concepts, check, push | 14:58 to 15:15 | 15 | 0 |

About 105 minutes of wall clock, 12 fix passes, no per-pixel repair: ten poses are ten rows of numbers (`KATA_POSES`), the timeline is a table (`kataTimeline`), and the lane, the dim, the ghosts and the dust are code. The long middle is the engine work and chasing which target a capture hit (a Kit attack killed the first punk before Rook's turn, so early captures hit the Glowrat), not pose tuning. Judge round 2 is next.

## Item F-sf-layout round 1 (2026-10-02, Sprite Fusion art)
Mark made his own sprites in Sprite Fusion (`spritefusion-tests/`, git-excluded) and they are much stronger than the code-drawn crew, so this item rebuilds the layout around them: `?battle=side` now defaults to `art=sf`, and `&art=code` keeps the first loop's layout and crew for comparison. Images: `media/spike-side-battle/F-sf-layout-r1-*.png` (git-ignored; 2x screens, a 4x crew sheet, a walk-in filmstrip, a comparison with `art=code`).

**What changed.**
- Mirror layout: party on the LEFT facing right (every Sprite Fusion sprite faces right, so Kit and Rook are never mirrored), enemies on the right. Slot 0 (Kit) is top-right, nearest the enemies, each next slot a step lower and to the left, so Sable stands beside the command menu (her left edge x 52, the menu's right edge 44). The command menu, ability list and target box stay in the bottom-left, now under the party instead of under the enemies: the party's feet are at rows 72 to 84, the list and box start at 86. A hit knocks a body back to the left; the lunge runs to the right (`FACE` in `sideview.ts`).
- The art loads in the browser from the dev server's project root (`/spritefusion-tests/...`, sheets from `extracted/`), never copied into `public/` or committed (`rig2/sfcrew.ts`). It is DEV-only like the flag. A member is a spec: an idle sheet, a walk, a frame per pose, a rest frame.
- Enemies at 1.5x (see the pose log): `stretchTo` in `rig2/enemy.ts` gained `scale3x` (AdvMAME's diagonal-preserving 3x) followed by a 2x2 majority vote, so a native-resolution trace grows by 1.5 on one whole-pixel grid. A punk is about 69 px beside Kit's 64 and Rook's 68; the Warden is 104.
- Colour clean-up: kept, but it changes nothing you can see (the 4x comparison is indistinguishable); its value is that a character has one palette (94 to 143 colours) across every pose.
- Also fixed: a type error already at HEAD in `tests/sidekata.test.ts` (an unchecked array index) that made `npm run check` fail.

**Honest issues.**
- Sable is a placeholder from another style: smaller (53 vs 64 to 68 px), three-quarter, graded, a thinner outline, a slower and shorter idle. She is flipped from a view that faces left and a little toward the camera, so she looks away from the enemies; her staff changes hands. Mark needs to make her.
- Enemies are native-resolution art grown by 1.5: the same pixel size as the crew, but softer and with a gold rim where Mark's sprites have a dark outline. They sit slightly apart in style from the crew (a stylistic gap, not a scale one). The backdrop is still 2 px blocks.
- Rook's walk-in is his relaxed idle sliding along with the sword on his back, Kit's is one run pose with a bob, Hex's her stance with a bob: glides, not walk cycles. Rook's sword jumps from his back to his hands on arrival (no draw frame).
- Four enemies (three punks and a Glowrat) overlap each other by a few pixels; a Glowrat behind the right-most punk is half hidden by his club.
- Strike, hurt, cast, item and KO are placeholders for this item (the listed frames through the first loop's beats). Rook's `kata` path is off under `art=sf`. Kit's fist overlaps a punk at the hit, Rook's strike frames (69x110 and 101x66) are anchored by their feet midpoint, so strike2's long lunge leans well forward of his slot, and nobody has a KO frame.
- The Warden's left edge is about 25 px from Kit at slot 0: close, not touching.
- Judged from stills and a filmstrip, not played at speed by a person.

## Time log, item F-sf-layout round 1 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, Mark's files; dev server on 3007 | 15:27 to 15:31 | 4 | 0 |
| Look at the sprites (sheets), colour clean-up trial in python (distance 8 to 32), Hex's new files | 15:31 to 15:36 | 5 | 0 |
| Flags and layout constants, loader and anchoring (`sfcrew.ts`), `scale3x`, engine direction (walk-in sign, knock, lunge), first compile | 15:36 to 15:39 | 3 | 1 (the test's array index) |
| First captures, party and strip spacing, boss scale, walk-in, menus, a strike for sanity | 15:39 to 15:48 | 9 | 4 (slots overlapped, strip too tight, Warden too tall, capture paths) |
| `npm run check` (exit 0, after one lint pass), deliverables (screens, filmstrip, crew sheet at 4x, art=code comparison) | 15:48 to 15:52 | 4 | 1 |
| Docs, concepts, commit, push | 15:52 to 15:55 | 3 | 0 |

About 28 minutes of wall clock for the layout, the loader, the mirror of the engine's direction and nine deliverables; no per-pixel repair anywhere.

## Item F-sf-layout round 2 (2026-10-02, after the round-1 judges)
Round 1 scored 7.33 (identity 8, readability 7, motion 5.75, craft 7, composition 7, style 6, cost 8.5; impact null). Images: `media/spike-side-battle/F-sf-layout-r2-*.png` (git-ignored; 2x screens, a 4x crew sheet, a 4x crop of the crew against the enemies, a walk-in filmstrip).

**What changed.**
- Sable is Mark's Sprite Fusion art now (reference and 8-frame idle), so all four crew are his. The mirrored traced Sable is no longer used.
- Layout: the party's places are data (`SF_SLOTS`), spaced from the real idle extents with a test (`tests/sflayout.test.ts`): Rook's blade is 4 px clear of Kit, nobody touches the menu, the ability list or the target box (8 px), and the nearest enemy starts 24 px in front of Kit. To get there the line now climbs to the top-left (Kit lowest and nearest), so Hex and Sable stand above the command-menu column instead of beside it.
- Enemies: a dark 1 px outline replaces the gold rim light (the rim was the game's own light, drawn behind the sprite at 55%, switched off for these sprites); the scaler's speckle is cleaned; the punk and the ghoul face the party; copies are not mirrored. Placement uses the opaque width, with a front row for the small creatures, so the Glowrat is never hidden. The Warden is 1.75.
- Walk-in: Kit's run pose bobs and skids into her stance, Rook walks in with his sword already drawn (no pop), Hex and Sable walk on their idle loops, and the stop is eased.
- Colour clean-up kept (distance 16): at 4x the cleaned and raw Rook are the same, the chrome arm's highlights intact. `&clean=0` still shows the raw art; `&finish=0` shows round 1's enemies.

**Honest issues.**
- The enemies are still softer than the crew: a native trace grown 1.5x has pixels of a different size to Kit's, and the despeckle cannot add the detail the crew have. The punks are front-view with a club on the party's side (a flip, not a three-quarter turn); they would need new art.
- The walk-in is better but not a cycle: one run frame for Kit, idle loops at double speed for the rest. A bob and an ease hide that at game speed; I have not seen it played by a person.
- Hex and Sable stand on the pavement's edge (world rows 58 to 60) and Kit is 20 rows lower than Sable: a deep diagonal for sprites that do not shrink with distance.
- Hex's outline is heavier and darker than Kit's (Mark's art; not touched).
- The party is placed for idle frames. Strike frames lean out of their slot (Rook's `strike2` is 101 px wide and anchored by the lowest rows), which is the F-sf-action items' work.
- Hex and Sable have no action, hurt, KO or victory frames; Kit no KO; Rook's hurt and brace share a frame.

## Time log, item F-sf-layout round 2 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings, Mark's sprites and the enemy traces | 15:54 to 16:01 | 7 | 0 |
| Sable, pose map, slots as data, `finishTrace`, enemy placement, walk-in and easing, first compile | 16:01 to 16:04 | 3 | 1 (the boss scale experiment) |
| Test on Mark's PNGs and the slot maths | 16:04 to 16:05 | 1 | 2 (blade 2 px from Kit; strip start) |
| Captures, enemy clean-up trial, Warden at 1.5, 1.75 and 2, walk-in filmstrip, play-through sanity | 16:05 to 16:08 | 3 | 1 (despeckle) |
| `npm run check` (exit 0), deliverables, docs | 16:08 to 16:12 | 4 | 0 |

About 18 minutes of wall clock; no per-pixel repair.

## Item F-sf-layout round 3 (2026-10-02, after the round-2 judges)
Round 2 scored 7.29 (identity 8.5, readability 7, motion 6.5, craft 6.5, composition 7, style 6.5, cost 8.5; impact null). Images: `media/spike-side-battle/F-sf-layout-r3-*.png` (git-ignored; 2x screens, 4x sheets).

**What changed, in the judges' order.**
1. **Enemies on whole multiples.** The 1.5 and 1.75 scales are gone from the default: a regular enemy is the trace at its native resolution (1x), a boss exactly 2x. Every pixel of a regular is one screen pixel like the crew's; the Warden at 2x is the backdrop's own grain and v0.1.0's size, and the orb's face is back. The punks got a face fix (open eyes, flat cheeks) and the shade merge went to 30. `&regscale=` and `&bossscale=` bring the old non-integer looks back for comparison.
2. **Walk-in.** Per member now (`SF_WALK`): Kit runs on her run pose, Rook dashes on his low-lunge frame (blade trailing, speed ghosts) and both skid into the stance; Hex and Sable, who have no run frame, step in 14 px while fading in, after the runners have gone past, on the idle loop (no loop at double speed any more). The whole entrance is about 60 frames, shorter than round 2's 85.
3. **Layout.** The party line is shallower (feet 78, 73, 68, 60) and about 11 world px further right, with the gaps solved on real pixels (30 world px, not 34). Hex stands low; only Sable is held up by the command menu. The enemies' strip starts at world x 144, 24 art px past Kit's widest reach, and the native enemies fit it.
4. **Front-row HP bar.** Under the creature's feet, not across the legs behind it.
5. **Rook hurt** is the stance with recoil and flash, not the crouch. **Hex and Sable** keep the stance for strike, hurt, cast and KO: the missing frames are the list below.
6. **Crew sheet and filmstrip** re-made: cells wide enough for their labels, `*` marks a frame that is the stance standing in; the filmstrip frames share one crop and include the skid into the stance.
7. **Warden** is shot in its own arena (`core`), not the street.

**Honest issues.**
- **The enemies are still the weak link, now small instead of soft.** A punk is 48 px and the ghoul 50 beside Kit's 64 and Rook's 68 (about 0.75 of them); Hex and Sable are 61 px of chibi-proportioned art. The punks are front-view figures with the club flipped, not turned toward the party; a face fix cannot turn a head. The real fix is new enemy art at crew density facing left (see below).
- **The sewer backdrop does not suit a side line-up.** It looks down a corridor, so its walls meet the floor along diagonals, and Hex and Sable stand against a wall there (`F-sf-layout-r3-ghoul-glowrat-sewer.png`). The ghoul deliverable is on the street for that reason. A side-on sewer backdrop is needed. I did not add per-backdrop floor lines: on the street and in the Warden's arena the slots are already on the floor, and for the sewer no value works.
- Hex and Sable are only as low as the command menu allows: their feet are on the street's far pavement strip (world rows 60 to 68), the nearest the menu column lets them be.
- The runners' dash is one pose with a bounce and ghosts, so it is a slide with attitude; it holds because it is fast. Rook's dash frame is anchored by its lowest rows, which include the trailing blade tip, so his body sits a few pixels right of his slot until the skid.
- Hurt and cast are still the stance for three of the four, and strike exists only for Kit and Rook. Not played at speed by a person (stills and a filmstrip).
- A five-row ability list is 69 px tall and covers Rook's and Hex's boots while it is open (transient; the command menu and the list are the game's own windows).

**Sprite Fusion shopping list for Mark (what to generate, in the order it buys the most).**
1. Rustfang Punk, Sewer Ghoul and Glowrat in Sprite Fusion at about 64 px (the ghoul 64 to 72), facing LEFT, side view, one idle each; a Warden at about 100 to 110 px facing left. The biggest gap: it fixes the enemy size, grain and facing at once.
2. Hex and Sable: a hurt frame, a cast frame (and an attack for Hex), a KO frame; ideally in Kit's proportions, since they stand 61 px of chibi beside Kit and Rook.
3. Kit: KO, cast. Rook: hurt, KO, and a sheathe-to-ready frame or two for the walk-in (the dash lands in a drawn-sword stance).
4. A side-on sewer backdrop (a corridor seen from the side), so the ghoul fights have a floor to stand on.
5. Optional: a 4-frame side-view walk or run for each member, so the entrance can be a real cycle.

## Time log, item F-sf-layout round 3 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings, Mark's sprites and the idle extents | 16:13 to 16:19 | 6 | 0 |
| Enemy trial at native 1x, the punk's pixels, face fix and palette merge | 16:19 to 16:25 | 6 | 1 (the face box has to keep the mouth) |
| Backdrop floors (looked at, no change), pixel-mask slot solver, slots and the sflayout test | 16:25 to 16:32 | 7 | 3 |
| Walk-in per member: data, state, render alpha and ghosts, specs, three filmstrip passes | 16:25 to 16:37 | 12 | 3 (stagger, order, delays) |
| Front-row HP bar, Rook hurt, crew sheet | 16:36 to 16:38 | 2 | 0 |
| `npm run check` (exit 0), deliverables, filmstrip, docs, commit | 16:38 to 16:44 | 6 | 1 (the four-enemy cursor landed on a punk) |

No per-pixel repair beyond the punk's 12 face pixels.

## Item F-sf-layout round 4 (2026-10-02, after the round-3 judges; the last round)
Round 3 scored 7.06 (identity 8, readability 7, motion 6, craft 7, composition 7, impact null, style 6.5, cost 8). Images: `media/spike-side-battle/F-sf-layout-r4-*.png` (git-ignored; 2x screens, 4x sheets).

**What changed, in the judges' order.**
1. **Enemies (the weak link).** No new art was possible without Mark, so this is stopgap work, logged as one. Regular enemies are 1.25x native through an area-vote scaler (a punk 59 px, about 0.93 of Kit) instead of 1x (48 px, 0.75): they are party-sized and a group again. The punk's head is turned toward the party (data), the ghoul's dark tones are lifted, the outline is darker. The Warden stays 2x.
2. **Walk-in.** Hex and Sable run in like the others (idle loop, bob, one ghost, no fade), staggered after Rook; Rook is anchored by his boots.
3. **Warden and bars.** The health plate sits fully over the art, and the chevron sits just over the plate, on a dark plate of its own.
4. **Composition.** The enemy strip is 4 world px closer to the party.
5. Hex and Sable: unchanged stance stand-ins; the engine's lunge, smear, recoil and flash are what make their strike and hurt read.
6. Sewer: a known failure, still not in the ghoul deliverable (the street is).

**Honest issues.**
- The enemies are still front-view figures from a PixelLab trace, and at 1.25x their grain is a little uneven beside the crew's 1:1. A judge who needs genuine side-view enemy art will not get it from this round.
- Sable's feet are still on the far pavement (world row 60): the command menu's five-row keep-out holds her up.
- The Warden is still 2x, chunky beside the crew; the backdrop and v0.1.0 use that grain.
- Hex and Sable are chibi and have only a stance for every action; not played at speed by a person.

**Sprite Fusion shopping list for Mark (the same list, in the order it buys the most).**
1. Rustfang Punk, Sewer Ghoul and Glowrat at about 60 to 68 px, facing LEFT, side view, one idle each; a Warden at about 100 to 110 px facing left.
2. Hex and Sable: hurt, cast and KO frames (and an attack for Hex), ideally in Kit's proportions; a 4-frame run for each.
3. Kit: KO, cast. Rook: hurt, KO, victory.
4. A side-on sewer backdrop.

## Time log, item F-sf-layout round 4 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings; dev server | 16:45 to 16:52 | 7 | 0 |
| Enemy scale trials (1.25, 1.5), area-vote scaler, punk head turn | 16:52 to 17:00 | 8 | 1 (nearest scaling) |
| Walk-in for Hex and Sable, Rook's boots anchor, bar and chevron, ghoul lift, strip | 17:00 to 17:12 | 12 | 2 |
| `npm run check` (exit 0), deliverables, docs | 17:12 to 17:22 | 10 | 0 |

## Item G-sf-rook-strike round 1 (2026-10-02, Mark's Sprite Fusion frames)
Rook's two-handed strike built from Mark's own frames and played through the real playback engine behind `?battle=side` (Sprite Fusion art, the default; `&art=code` keeps the first loop's code-drawn strike). Images: `media/spike-side-battle/G-sf-rook-strike-r1-*.png` (git-ignored): `frame-strip` (every frame at 4x with its hold, lunge, anchors and source file), `source-frames` (Mark's raw frames at 4x), seven in-battle captures at 2x stepped one tick at a time (ready, wind-up, smear A, smear B with the blade on the target, the impact with the cut effect, the follow-through held, the return), `zoom-smear-impact` at 3x and a GIF of the whole strike (`clip`).

**What it is.** `rig2/sfstrike.ts` (no DOM, tested): the anchors as data, the timeline, the measured reach and the pixel work on plain arrays. Ready is Rook's battle idle loop; the wind-up is `rook-battle-strike1` (sword overhead); then two swing frames and the follow-through. Mark has no frame between the two poses, so the swing is: swing A is the wind-up body with its sword cut out by geometry, a code-drawn blade at -50 degrees and a crescent trailing it from where the sword was; swing B is `rook-battle-strike2` (coat flare, blade low) with a crescent trailing its blade up from -46 degrees; then a thinning crescent for two frames and the clean follow-through held 13 frames through the cut line, the damage and the hitstop; then the ready stance slides back. The arcs are data (pivot, radius, two angles, a width), three solid bands in Mark's steel colours, so a swing is a row of numbers, not a repaint.

**Anchors.** The frames come on four different canvases and the body is in a different place in each, so a frame is placed by its FRONT BOOT (the stamping foot of men-uchi) and its SOLES row, put on the same column and row as the idle's. The recorded data: front boot 53.5 (idle), 60 (wind-up), 62 (follow-through); soles 67, 109, 65; blade point at column 100, row 63. All frames end up on one 122x139 canvas whose centre column is the slot and whose bottom row is the street, so the engine's existing placement just works. Anchoring by the front foot means it never slides; the rear foot reaches back 5 px and the head moves forward 11 px between the wind-up and the follow-through (the lunge).

**Playback.** `playback.ts` runs the same Rook branch for both arts: the lunge stops where the measured blade point (`SF_MEASURED.tipDx`, 58 art px in front of the slot) is `SF_BITE` of the way into the target from its centre; the lane is the first loop's (his soles a little in front of the target's); the effect is the new `men_r` (a steep diagonal cut ending on the blade point, the spark on Rook's side) instead of the first loop's flat `men`, and it starts at the second frame of swing B. Kit, who stands in his path, steps back up to 30 world px into his empty place (`makeRoom`, mirrored for the right-facing line-up). The target recoils to the right, away from him (the first loop's recoil was hard-coded to the left). Hitstop, shake and the GPU hit are the engine's; two speed ghosts trail the swing frames and the front boot kicks up a dust puff.

**Honest issues.**
- There is no frame between the wind-up and the swing, and none between ready and the wind-up. The body goes from a crouch to arms overhead in one frame, and from upright to the deep lunge in two (swing A, swing B); speed ghosts and the arcs cover it at game speed, but a still-by-still judge will see the pops. These are the frames to make in Sprite Fusion (list below).
- Swing A's blade is code-drawn (three px with an outline), close to Mark's steel but not his art, and the old sword's gold guard is left at the hands. Its crescent is large (radius 54) and reads a little like a scythe.
- The blade sits at ground level in the follow-through, so the cut line (which ends on the point) runs through a punk's legs rather than its chest; against a Glowrat it is right.
- Rook's body, coat flare and ghosts overlap Kit's position during the dash (she steps back, and he is drawn in front); the coat's tail can touch her fist for a frame.
- The first target needed a tuned stop (`SF_BITE` 0.15): the enemy box includes the club, so a body-centred stop is a rough measure.
- Judged from stills and a GIF, not played at speed by a person.

## Time log, item G-sf-rook-strike round 1 (wall clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, Mark's frames; gridded views and measuring boots, soles and the blade | 17:09 to 17:17 | 8 | 0 |
| `sfstrike.ts` (anchors, timeline, crescents, builder), the frame dump and the first strip | 17:17 to 17:20 | 3 | 0 |
| Engine wiring (`sfcrew`, `playback`, `render`, `fx` `men_r`), first stepped captures | 17:20 to 17:24 | 4 | 1 (the point stopped at the club: bite 0.45 to 0.15) |
| Cut line onto the blade point, dust, `npm run check` (exit 0), test, commit, push | 17:24 to 17:26 | 2 | 1 |
| Deliverables (stepped captures, strip with anchors, GIF, zoom) and docs; about 6 of these minutes were three shell commands that hung on my own stdin slip | 17:26 to 17:40 | 14 | 0 |

About 31 minutes of wall clock, 2 fix passes, no per-pixel repair: Mark's frames are untouched except the sword cut out of the wind-up body for swing A (a geometry mask), and everything else is rows of data.

**Sprite Fusion shopping list for Rook's strike (what to generate to do it properly).**
1. A frame between ready and the wind-up: hands rising, sword lifting (the "lift").
2. Swing frames from his own edit tool: the sword vertical in front (blade pointing up) and the sword level (blade pointing at the target), body in the lunge, so the smear is a blur on real frames, not a code crescent on a code blade.
3. A contact frame at the target's torso height: blade level, arms extended, front foot stamped (the follow-through he has holds the blade at the ground).
4. A sheathe or recover frame (the follow-through to ready), so the return is not a slide.
5. Optional: his low `crouched` dash frame as the lunge-in before the wind-up.

## Item G-sf-rook-strike round 2 (2026-10-02, after the round-1 judges)
Images: `media/spike-side-battle/G-sf-rook-strike-r2-*.png` (git-ignored): `frame-strip` (every frame at 4x with its hold, lunge, source and anchors, on the common 142x138 canvas), nine in-battle captures at 2x stepped one tick at a time (ready, overhead, swing A, swing M, swing B with the blade on the target, the impact, the target white in the hitstop, the follow-through held, the return), `glowrat-impact` and `warden-impact` (the two other targets), `zoom-impact`, `zoom-swing-frames` (hair colour at 3x) and `clip.gif` (the whole strike, one capture per tick). The captures clear damage numbers left by Kit's earlier hit in the same round during the ready, dip and wind-up beats (a capture-script step, not game code), so the ready frame is clean.

**What changed, against the judges' findings (in the order they were fixed).**
- *Tint on his hair (all three judges).* Not a tint layer on the sprite: the WebGL presenter adds the blurred glow layer (the backdrop's neon) over the whole picture, so a sign behind his head lit his hair pink or yellow, and the colour followed whichever sign was behind him (capture 1 had none behind his head). The fix is in `render.ts` `renderGlow`: the crew's silhouettes are cut out of the backdrop's glow before the blur (`partyCuts`); effects in flight still glow over them. His grey hair, orange shades and olive coat read in every captured frame. The chromatic split on a critical (`CRITICAL` frames) is the engine's own, not a tint.
- *Motion (all three).* Anticipation: a 2-frame dip (the idle frame with the knees bent by deleting leg rows and the torso tipped back), then the overhead held 4 frames (round 1: 5 to 10), then swing A (blade past vertical, body tipping forward), swing M (blade half way down, body low), then swing B, the follow-through and a rising `recover` frame before the stance; the dash is carried by 0.2, 0.45, 0.75..0.95 of the lunge (round 1: 0.3..0.45, 0.7..0.95). Extra time while a timing ring closes is spent in the READY stance (it breathes), never in a frozen overhead. All of it is data: `SF_POSES`, `sfTimeline`.
- *The code blade, the gold guard and the scythe (pixel artist, art director, designer).* There is no code-drawn blade now. `splitSword` cuts HIS sword (blade, guard and grip root) out of `rook-battle-strike1`; the swing frames turn it about the hands (`turned`, nearest pixel, no new colours) and carry it with the bent body, so the guard stays on the blade. The crescent is thin (widths 3 and 4), covers 38 and 64 degrees, tapers to a point at both ends and has two bands sampled from his strike2 blade (`sampleSteel`). Swing B's streak starts at head height (-52 degrees) and ends on the point.
- *Composition (all three).* Kit leaves Rook's row over his dip and wind-up (6 world px back, 14 toward the camera, eased) and ducks into her own `kit-battle-crouched` frame, so his boots and coat pass over her head; she returns only as he is nearly home (the old 30 px step only began at lunge 0.5, and she stood in his lane). Rook's row is now chosen from the target: his point lands at 40 percent of its height (hip), within 10 world px up or none down (`SF_HIT_HEIGHT`, `SF_LANE_UP`, `SF_LANE_DOWN`). The ghosts are two flat steel-blue silhouettes at most (35 and 20 percent, 2 world px apart), never his own colours, drawn before his body.
- *Impact (designer, art director).* The blade point ends `SF_PIERCE` (5 world px) inside the target's BODY front, measured from the columns holding at least 40 percent of the busiest column (`bodySpan`: a club or tail is thin), where round 1 aimed at the box centre including the club. `men_r` is placed from the point: the line runs from the shoulder-ish down to the point, and the spark (a seven-pixel star, a white second star, a ring, five chips) is centred on the line's end, inside the body. The target blinks white through a 4-frame hitstop (round 1: 2, no blink), shake 11 (8), and the GPU hit is anchored on the point, not the target's centre. The damage number is raised above the health plate for Sprite Fusion's side view (`floatPos`). I tried a full-screen white flash at the damage tick and dropped it: the engine's flash is 80 percent white on its first frame, which washed the whole picture out.
- *Stale UI.* The '46' over punk A in round 1's ready and return captures was Kit's earlier hit in the same round; the ring does disappear on contact (captures 5 and 6).

**Checked against other targets.** The second punk (same body measure), a Glowrat pair and the Warden (`glowrat-impact`, `warden-impact`). The point lands inside the body at all three. At the Warden his row is the full 10 px up (the point reaches its thigh, not its hip); at the Glowrat his row is his own (the point is 35 percent up the rat) and Kit's hair comes within a few pixels of his rear boot for two frames.

**Honest issues.**
- The three bent frames are stand-ins, not drawings: deleting leg rows stretches the arms and gloves a little, and the sword is turned by nearest pixel, so its edge is a touch rougher than Mark's. One or two render frames each at game speed, but a still-by-still judge will see it.
- Swing A's vertical blade reaches within about 15 screen px of the top edge and ends just left of the 'Rook' name plate (a gap of about 15 px); swing M's tip passes about 40 screen px right of it. Neither touches it, but swing A is close.
- Kit's duck is a pop between her stance and her crouch frame (no in-between), and her crouch is a kneel, not a dodge.
- Judged from stepped captures and a GIF by me, not played at speed by a person; the hit and the dash at game speed are unconfirmed beyond the frame counts (the swing frames are 1 to 2 render frames each, 3 frames from vertical to the blade on the target).
- Full-screen flash: not done (see above). The code art path (`&art=code`) is untouched.
- Hex and Sable's Sprite Fusion art is Mark's; nothing about them changed.

## Time log, item G-sf-rook-strike round 2 (wall clock from the session clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings and round 1's captures; started the dev server; baseline capture; found the tint (bloom pass) | 17:37 to 17:49 | 12 | 0 |
| `sfstrike.ts` rewritten (bend, split sword, turned sword, crescents, timeline), frame dump and strip, checked the frames | 17:49 to 17:52 | 3 | 1 (arcs thinner) |
| Engine wiring: room vector, steel ghosts, glow cut-out, lane at hip height, body-front aim, cut line and spark, hitstop, flash, number position; first stepped capture | 17:52 to 17:57 | 5 | 0 |
| Kit's duck (her crouch frame), lane limits, checks against the Glowrat and the Warden, tests, `npm run check` (exit 0) | 17:57 to 18:02 | 5 | 2 (room 14 px, lane down 0; swing M angle) |
| Commit, the timeline's ready/dip/overhead split, swing M arc join, final captures (punk, Glowrat, Warden) | 18:02 to 18:10 | 8 | 2 |
| Deliverables (strip, nine captures, zooms, GIF), docs, concepts, push | 18:10 to 18:13 | 3 | 0 |

About 36 minutes of wall clock, 5 fix passes, no per-pixel repair. Three shell commands hung on my own stdin mistake (a heredoc together with a stdin redirect) and cost about 6 of those minutes.

**Sprite Fusion shopping list for Rook's strike, round 2 (what would replace the stand-ins).** Same list as round 1, now ranked by what the judges' eyes go to:
1. A crouch-anticipation frame between ready and the overhead (knees bent, sword rising): replaces `dip`.
2. Two swing frames from `rook-battle-strike1` through his edit tool: blade vertical with the arms at head height, and blade level with the arms at shoulder height and the torso leaning forward: replace swing A and swing M and let the crescents go back to a light smear.
3. A rise-from-lunge recovery frame: replaces `recover`.
4. A contact frame with the blade level at the target's torso height, front foot stamped (the follow-through he has holds the blade at the ground).
5. Optional: a `kit-battle-crouched`-to-stance dodge pair so her duck is not a pop, and a hurt frame for Rook.

## Item G-sf-rook-strike round 3 (2026-10-02, after the round-2 judges)
Images: `media/spike-side-battle/G-sf-rook-strike-r3-*.png` (git-ignored): `frame-strip` (every frame at 4x with its hold in frames and ms, lunge range, source and anchors; the yellow tick is the front boot), ten in-battle captures at 2x stepped one game tick at a time (ready, dip, overhead, smear A, smear B, swing B with the blade on the target, impact, the target white in the hitstop, the follow-through held, the return), `glowrat-impact` and `warden-impact`, `zoom-impact` (4x), `zoom-swipe-frames` (3x) and `clip.gif` (the whole strike, one capture per tick, 20 ms each, hitstop included).

**What changed, in the order the judges listed it.**
- *Swing A and M gone (all three judges).* No row-deleted frame is shown over its source any more, and there is no turned sword. The two frames before the follow-through are now Mark's pixels untouched plus a code-drawn swipe: smear A is strike1's body with its sword cut out whole (guard and all, `splitSword`) and a fan where the blade is going, smear B is strike2 as drawn with the fan carried on, swing B the last of it (`SF_SWIPES`, `drawSwipe`). A fan is data (hand, two angles, an elliptical reach, the rim's width, how hollow); its outer rim is a two-band crescent (bright edge, lighter body) thickest near the leading end, inside it dithered steel, and a one-pixel leading line, in the follow-through blade's own sampled steel. There is no detached crescent, no scythe, and no frame reaches more than 113 art px above the soles, so the name plate is 24 screen px clear (tested). The body still jumps from strike1 to strike2 between smear A and B; the fan covers it, as in the SNES chops, but it is a stand-in until Mark makes the in-betweens.
- *Timing (pixel artist).* Dip 4 frames (was 2), a rise frame pair, overhead 9 (was 4), smear A 2, smear B 2, swing B 2 (was 1, 1, 2). A pose frame is about 26 ms in the game (`FX_PACE` 0.65 per tick), not 16.7, so the dip is about 103 ms, the overhead about 231 ms, the two smears about 51 ms each, and the whole lead from the order to the effect 24 frames (about 615 ms; round 2: 13). It is long for a 'strike' on a first listen; the extra time is in the dip and the overhead, as asked.
- *Joins (pixel artist, art director).* ready to dip to rise to windup: the dip is the idle frame lowered 5 rows (3 to 4 px at the knees), the rise is strike1 lowered 4 thigh rows with no lean, so the torso rises in two steps, not one. The recover frame is unchanged (rising idle); the front boot of ready, dip, rise, windup, recover agrees with the follow-through within one pixel (tested).
- *Kit (all three).* No duck, no kneel, no pop. She stays in her stance frame and steps back about 38 world px, to 8 px behind Rook's slot (his empty place, a little past it so his coat tail clears her) as he runs forward, her progress being his lunge; she returns as he does. They cross for about 4 frames; he is drawn last, so he passes in front of her, and in a still on those frames a tip of his coat touches her ponytail. At rest and at impact nothing touches (zoom sheet, swing B). The 'her place' is where Rook was, so the same code works for any crewmate between him and his target.
- *Rook's row (art director, battle designer).* He stands on the target's floor now: his soles at most 6 world px above the target's soles (none for a short target), so the point lands on the leg, not on a ledge above it (round 2 put his soles up to 10 world px, 45 to 85 screen px, above it). At the punk his row is his own place; at the Glowrat he drops to its row; at the Warden he drops 8 world px (the Warden is two metres of sprite, so the point is at its shin, not its hip). The cut line still ends on the blade point, so the spark is where the steel is.
- *Style parity (art director).* The enemies' silhouettes are cut out of the backdrop's neon bloom like the crew's (a magenta sign no longer reads through a punk), and the white blink on the target is 0.4 (was 0.55) so its shirt logo and club stay readable.
- *Impact (designer).* A steel-blue afterimage of the cut line lingers 8 frames after the hot first 3. The ghosts are one dithered steel silhouette behind the dash (round 2: two flat blue ones). Unchanged and kept: the cut line through the body, the spark, the white blink with a 4-frame hitstop, shake 11, the damage number.
- *At speed (designer).* The GIF is one capture per game tick (20 ms in the file), hitstop frames repeated, so it plays at game speed; I looked at it as stills and as a contact sheet, not as a person watching it.

**Checked against other targets.** Punk (the numbers above), Glowrat pair and the Warden (`glowrat-impact`, `warden-impact`). The code art (`&art=code`) was run once and still plays its own strike, left-facing.

**Honest issues.**
- The strike1 to strike2 body change is still a pop covered by a swipe; Mark's in-betweens would remove it (list below). Smear A's body has empty hands (the sword is the fan).
- Kit and Rook overlap while they cross (about 4 frames), and a coat tip touches her ponytail on one or two of them.
- The hit flash on the target still reads as a pale cone in the 4 frames of the hitstop (the white silhouette plus the GPU bloom); the logo and club read, but it is not a clean outline.
- The Warden is hit at the shin, the punk at the thigh to shin, and the cut line carries the rest; a taller target would want a contact frame with the blade level.
- Not played at speed by a person; the FX_PACE of 0.65 means the pose frame counts are not 60 fps frames.

## Time log, item G-sf-rook-strike round 3 (wall clock from the session clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings, Mark's frames with row grids; planned the swipe, the step-back and the lane | 18:17 to 18:24 | 7 | 0 |
| `sfstrike.ts` rewritten (squash poses, swipes, timeline, build), tests, frame dump and strip | 18:24 to 18:30 | 6 | 1 (swipe reach 29 to 26 rows for the name plate) |
| Engine wiring: Kit's step-back, dithered ghost, Rook's lane, enemy glow cut-outs; stepped captures | 18:30 to 18:37 | 7 | 2 (Kit's ghosts dropped, step-back 8 px further; soles above 4 to 6) |
| Cut afterimage, flash 0.4, other targets, code-art check, `npm run check` (exit 0), commit and push | 18:37 to 18:42 | 5 | 0 |
| Deliverables (strip, ten captures, zooms, GIF) and docs | 18:42 to 18:46 | 4 | 0 |

About 29 minutes of wall clock, 3 fix passes, no per-pixel repair: Mark's frames are untouched except the sword cut out of strike1 for smear A (a geometry mask). Two shell commands hung on my own stdin mistake (a heredoc together with a stdin redirect), about 4 minutes between them.

**Sprite Fusion shopping list for Rook's strike, round 3 (what would replace the swipes and the squashes).**
1. From `rook-battle-strike1` through his edit tool: a mid-swing frame with the blade vertical above the head and the body tipping forward (replaces smear A's empty hands).
2. A second mid-swing frame with the blade level and pointing at the target, hands at chest height, torso leaning in (replaces smear B's body jump).
3. A contact frame with the blade level at the target's torso height and the front foot stamped, so the cut can be at hip height without lifting him.
4. A crouch frame (knees bent, sword lifting) between ready and the overhead, and a rise-from-lunge frame for the return (replaces the squashed dip and recover).
5. A step-back or lean-back frame for Kit (not a kneel) if the crossing is ever to be avoided; his own `rook-battle-crouched` as a low dash frame is still untested for the lunge in.

## Item G-sf-rook-strike round 4 (2026-10-02, after the round-3 judges; the last round)
Images: `media/spike-side-battle/G-sf-rook-strike-r4-*.png` (git-ignored): `frame-strip` (every frame at 4x with its hold in pose frames and ms, lunge, room, source and anchors; the yellow tick is the front boot), eleven in-battle captures at 2x stepped one game tick at a time (ready, dip, overhead, smear A, mid-swing, smear B, swing B with the blade on the target, the impact with the cut at waist height, the target's hard blink in the hitstop, the follow-through, the return), `glowrat-impact`, `warden-impact-native-1x` (`&bossscale=1`) and `warden-impact-default-2x`, `zoom-impact` (4x), `zoom-swing-frames` (3x), `zoom-kit-and-rook-crossing` (2x), and two clips (`clip-punk`, `clip-glowrat`) as APNG (full colour, 17 ms a tick, the real speed) and GIF (a palette per frame, 20 ms, the smallest delay browsers honour, so 20 percent slow), with the HP and menu band included.

**What changed, in the order the judges listed it.**
- *Smear A's empty hands (all three judges).* The sword of strike1 is still cut out, but a katana is now drawn from the grip (`drawBlade`: outline, bright edge, light steel, a gold guard, colours sampled from Mark's own sword), and the crescent trails the blade tip. The pivot is the hand, so nothing floats. Smear A is 2 frames, then the in-between.
- *The body pop (all three).* One in-between body, `mid`: strike1's body with the sword cut out, 16 thigh rows removed and the head 6 px forward, a drawn blade at -26 degrees. Smear A's body is lowered 6 rows so it has started down, and the dash runs at a steady 0.10, 0.24, 0.38, 0.52, 0.66, 0.82, 1.0 (round 3 skipped 0.32 to 0.50 in one tick). It is a stand-in; Sprite Fusion's edit tool would make the real frame (list below).
- *The dip (art director) and the frozen overhead (pixel artist, designer).* The dip is Mark's `rook-battle-crouched` as drawn, anchored by its front boot like the rest (97.5, soles 52; tested). He stands up in two steps (`riseA`, `rise`: strike1 with 8 and then 4 thigh rows out), so the 'charge' is the body rising, and the overhead is held 3 frames instead of 9. Lead from the order to the effect is 17 pose frames = 435 ms (round 3: 24 = 615 ms). Pose frames are 25.6 ms (`SF_FRAME_MS`), not the strip's old 16.7.
- *Kit and Rook (all three).* See the next paragraph.
- *The fans and the ghost (pixel artist, art director, designer).* No dither anywhere: a crescent in three solid bands, thin at its trailing end, with no filled fan; swing B's and the fade's crescents end 4 art px short of the blade point instead of sitting on the target's torso; the trailing body ghost is one solid steel-blue silhouette at 30 percent, 1.5 world px behind. The designer's 'tint the swipe like the spark' is in as far as the bands are the sampled steel; the spark keeps its own blue rim.
- *The hit blink (all three).* The target is no longer a 0.4 white overlay under bloom. For the hit it is one hard colour swap: every pixel but the dark outline becomes `#f4ecff`, opaque, and during the hitstop it alternates on and off every second frame so the sprite shows between blinks (`flatLight` in `battlekit/render.ts`). The recoil is 4 px held through the hitstop and eased out over 13 ticks (`SF_KNOCK`; round 3: 6 ticks), and the target's own hurt squash plays after it.
- *The impact point (all three).* The cut line and the spark are centred at 0.5 of the target's height (`SF_HIT_HEIGHT`), so the line crosses the torso, while the blade's point stays low at its legs (the lane share is its own constant, `SF_LANE_SHARE` 0.3). The point ends 7 world px inside the body front (`SF_PIERCE`, was 4). The spark's ring radius is at most 0.35 of the target's body width (`SF_SPARK_BODY`, `MEN_R.spark`), so a Glowrat is no longer buried.
- *The chevron (art director).* The yellow active chevron is hidden once the strike has begun; the raised katana no longer runs through it.
- *Colours (pixel artist).* Already applied and re-measured: `cleanColours` folds each character's palette at an RGB distance of 16 on load (Rook 3,147 shades to 84; Kit 5,830 to 143), so the strike frames carry about 86 colours including the swipe's, not 1,000. A distance under 6 would do nothing after a fold at 16, and a coarser fold (24) was tried in an earlier round and flattened the steel and the jeans. The faint mottling that is left is the 84-shade shading of Mark's pixels; I did not add a second pass.
- *Documentation (art director).* The strip header, hold labels and captions use the real pose frame (25.6 ms) and wrap inside their cells.

**Kit and Rook, measured.** The staircase of the line-up leaves no room beside Rook (Hex is 31 world px to his left, Kit 31 to his right, the target beyond), so a lunge down his lane must pass Kit in a side view, and 'zero overlap on every frame' is not reachable. I added a probe (in the capture script, not in game code) that reads the renderer's own cut list and counts the opaque pixels Rook and Kit share on every tick. Round 3's walk back through his empty place hid 80 to 83 percent of her for about 4 ticks at smear A and mid and again for about 5 ticks on the return. Round 4 has her step back into the second row (18 world px up the street, 4 left; `SF_ROOM`) as a function of the beat, before the dash begins, and come down in the last 3 frames of the way home. Result: no overlap before the dash (ready, dip, stand-up and wind-up all 0 percent); at most 61 percent for about 4 ticks around mid and smear B (her head covered on 3 of them, by Rook's raised arms and blade, not by his coat); 33 percent through the hold (her legs; head and torso clear); 7 to 49 percent on the way home and 0 at rest. Not zero, and 18 px up the street can read as standing on the shop front: 14 px hid her head more, 20 px looked like a ledge.

**Checked against other targets.** Punk, Glowrat (the cut and spark at its body, the spark small), the Warden at its default 2x (`warden-impact-default-2x`) and at native 1:1 (`warden-impact-native-1x`, `&bossscale=1`; I left the default as the F item set it). The code art (`&art=code`) ran once and plays its own strike.

**Honest issues.**
- `mid`, `riseA`, `rise` and smear A's body are rows removed from Mark's strike1 (no resampling), not drawings: the legs squat, the arms stay overhead, and the head moves 6 px. At game speed each is 1 to 3 pose frames; a still-by-still judge will see them.
- The drawn blade is code (steel sampled from Mark's, outline and gold from his), thinner and straighter than his curved katana, and foreshortened (36 and 44 px against his 52) so no frame rises over the name plate.
- Kit and Rook still overlap for about 4 ticks at the dash, and Rook's blade or arms cover her head on 3 of them.
- The target's hit blink is a hard swap now, but the GPU hit's own bloom is unchanged and still lights the target's centre on the first hitstop frames.
- The timing ring and the target chevron over the enemy (the designer asked to fade them once the order starts) are gameplay elements of the timed press and are unchanged.
- The punks' soft shading and the Warden's 2x pixel density still read as a different art set beside the Sprite Fusion crew; native enemy battle art in Mark's style is the real fix.
- Judged from stepped captures, a contact sheet and stills of the clips, not played at speed by a person.

## Time log, item G-sf-rook-strike round 4 (wall clock from the session clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code and Mark's frames (gridded views of strike1, strike2 and the crouch); measured the crouch's boot and soles | 18:47 to 18:51 | 4 | 0 |
| `sfstrike.ts` rewritten (crouch dip, riseA, mid, drawn blade, solid crescents, steady lunge, room data), strip script, first strip; about 3 minutes lost to a shell command hung on my own stdin mistake | 18:51 to 18:59 | 8 | 1 (crescent reach: the canvas rose to 116 rows, reduced to 112) |
| Engine wiring (hard blink, chevron, ghost, cut at waist height, spark scale, recoil), capture script with the Rook/Kit overlap probe, three Kit staging runs (second row at 14, 18, 20 px; the way-home split) | 18:59 to 19:06 | 7 | 3 |
| Tests (timeline, room, steady lunge, crouch anchors), `npm run check` (exit 0), commit | 19:06 to 19:07 | 1 | 0 |
| Other targets (Glowrat, Warden at 2x and at native), code-art run, deliverables (strip, eleven captures, zooms, clips as APNG and GIF) | 19:07 to 19:13 | 6 | 0 |
| Docs, concepts, pose log, push | 19:13 to 19:25 | 12 | 0 |

About 38 minutes of wall clock, 4 fix passes, no per-pixel repair: Mark's frames are untouched except the sword cut out of strike1 for smear A and mid and thigh rows removed for riseA, rise, smear A and mid (rows move whole, nothing resampled). Two more shell commands hung on the same stdin slip (a heredoc together with a stdin redirect), about 5 minutes in all.

**Sprite Fusion shopping list for Rook's strike, round 4 (what would replace the stand-ins).**
1. From `rook-battle-strike1` through his edit tool: a mid-swing frame, blade level and pointing forward at shoulder height, hands at chest height, torso half-turned (replaces `mid`, the biggest remaining stand-in).
2. A frame just after the wind-up with the blade vertical above the head and the arms coming down (replaces smear A's cut-sword body and the drawn blade).
3. A contact frame with the blade level at the target's torso height, front foot stamped (so the cut lands where the blade is).
4. Two stand-up frames between `rook-battle-crouched` and `strike1` (knees half-straight, sword lifting over the shoulder; replaces `riseA` and `rise`).
5. A rise-from-lunge or sheathe frame for the return (replaces the squashed idle `recover`).
6. A step-back or hop-back frame for Kit (she slides up the street on her stance now), and a hurt frame for Rook.
7. Battle art in Mark's style for the punks and the Warden (the remaining style blocker next to the crew).

## Item H-sf-kit-punch round 1 (2026-10-02, Mark's Sprite Fusion frames)
Kit's attack from Mark's own frames through the real playback engine, behind `?battle=side` (Sprite Fusion art, the default; `&art=code` keeps the first loop's code-drawn punch, run once). Images: `media/spike-side-battle/H-sf-kit-punch-r1-*.png` (git-ignored): `frame-strip` (every frame at 4x with its hold, lunge and anchors), `source-frames` (Mark's raw frames at 4x, named by what each is), 22 in-battle captures at 2x stepped one game tick at a time (guard, load, jab smear, jab blow and its hitstop blink, cross smear, blow and blink, kick smear, blow, the held kick with the damage number, the guard after, home; a far target's run-in and plant; the Glowrat; the Warden), `combo-key-frames`, `zoom-blows` (the three contacts at 3x), `far-target-run-in`, and a clip (`clip.apng` at the real 17 ms a tick, `clip.gif` at 20 ms, 20 percent slow).

**What it is.** `rig2/sfpunch.ts` (no DOM, tested; Rook's pixel helpers shared). Guard (the idle loop) -> load (`punch1`) -> JAB (`punch2`) -> CROSS (`punch3`) -> KICK -> the load frame again as the guard -> home, with a streak over the arm on the frame before the jab and the cross and a crescent behind the leg before the kick. Three blows, 4 frames (102 ms) apart, each its own `punch_r` spark, GPU hit, shove, target blink and 3-frame hitstop; the engine rolls one hit, so the kick (the last blow) is where the number, the big shake and the engine's hitstop land. A near target gets a step in over the load; a target more than 14 world px away gets a run in (3 to 8 frames, `kit-battle-running`, a speed ghost). All the frames are Mark's pixels untouched except one stray magenta pixel dropped from the kick and the two smears drawn over or behind them.

**The kick.** Kept as the finisher: it is the one blow that is a different shape (a leg at head height, the body leaning back), which gives the combo a three-beat rhythm and a last blow that reads as heavier. The honest cost is the pop from the cross to the kick: Mark has no chamber frame, so one smear frame stands in. `PUNCH_FINISHER = false` makes it a two-blow combo.

**Honest issues.**
- A MISS: the three blows still play and then MISS floats (the engine decides after the act event). Any v0.1.0 attack does the same with its effect; I did not add look-ahead.
- Kit's frames put every blow at head height (a fist 20 world px up, the toe 23). On a punk (30 px) that is the face; on the Glowrat (12 px) the fist passes over its back and the spark is clamped to its body. A low blow needs a low frame (a stoop or a low kick).
- Cross to kick and kick to guard are one-frame jumps in stance (planted on both feet to balanced on one, and back).
- On a far target she runs in front of the nearer enemy (drawn over it) for about 5 frames.
- The jab holds a frame like Mark's: the arm has no recoil between the blows, so jab, cross and kick read as three poses with a flash, not a flowing combo.
- The streak is a flat 7 to 8 row wedge over the arm; at game speed it is one frame (26 ms).
- Judged from stepped captures and stills of the clips, not played at speed by a person.
- One fix is in shared code: `anim` in `scenes/battle.ts` (see the pose log), which also touches the v0.1.0 back view (only the rate read, unit tests pass, a back-view round ran).

## Time log, item H-sf-kit-punch round 1 (wall clock from the session clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the Rook strike code and the engine path; Mark's frames (contact sheets, gridded views, measured feet and tips) | 19:17 to 19:24 | 7 | 0 |
| `sfpunch.ts` (anchors, smears, timeline, build), wiring in `sfcrew.ts`, `playback.ts`, `render.ts`, `fx.ts` | 19:24 to 19:34 | 10 | 1 (tips and a hit flag) |
| First captures; the pose clock ran 1.6x behind the effect (the stale rate); the `anim` fix; run-in speed retuned (about 3 minutes lost to a heredoc together with a stdin redirect, three times) | 19:34 to 19:44 | 10 | 3 |
| Smears reshaped, tests (`tests/sfpunch.test.ts`, `tests/png.ts`), `npm run check` (exit 0), commit, push | 19:44 to 19:46 | 2 | 2 |
| Deliverables: strip, source frames, 22 captures, zooms, clips; code-art and back-view checks | 19:46 to 19:49 | 3 | 0 |
| Docs, concepts, pose log | 19:49 to 19:56 | about 7 | 0 |

About 39 minutes of wall clock for the combo end to end (about 25 for the working version), 6 fix passes, no per-pixel repair of Mark's frames.

**Sprite Fusion shopping list for Kit's combo, round 1 (what would replace the stand-ins).**
1. A chamber frame for the kick (knee raised, body already leaning, standing on one foot) between the cross and the kick: replaces the smear-frame jump.
2. A recovery frame after the kick (foot back down, fists coming up) so the guard after it is not the load frame.
3. A jab in two frames (arm half out, then full) so the arm travels instead of appearing.
4. A low blow (a stoop, or a low sweep kick) for short targets like the Glowrat.
5. A step-in or hop frame for the short lunge to a near target (now she slides on the load frame).
6. A cross-to-guard recoil frame (the arm pulling back) for the end of each blow.

## Item H-sf-kit-punch round 2 (2026-10-02, after the round-1 judges)
Images: `media/spike-side-battle/H-sf-kit-punch-r2-*.png` (git-ignored): `frame-strip` (every built frame at 4x with its hold, push and anchors), `source-frames` (Mark's frames, and the two code-bent kick frames next to the kick), 33 in-battle captures at 2x stepped one game tick at a time, with the timing ring OFF and Rook and Hex acting first so Kit acts mid-round (guard, load, jab smear, blow and its trail, the coil, cross smear and blow, the chamber in two frames, kick smear, blow, hitstop, the held number, the foot dropping, the settle, home; the far target's run in, plant and blows; the Glowrat's crouch and two low blows; the Warden; a miss), `combo-key-frames`, `zoom-blows` (the three contacts at 3x), `zoom-chamber-and-drop`, `far-target-run-in-lane-in-front`, `glowrat-crouch`, `miss-only-the-jab`, and four clips (`clip-near-punk`, `clip-far-target`, `clip-glowrat`, `clip-miss`) as APNG at the real 17 ms a tick and GIF at 20 ms (20 percent slow).

**What changed, in the order the judges listed it.**
- *Chamber and recovery (all three).* The kick no longer lands from the cross. Cross, then `load` (the arm comes back), then `kickC` (the kick with its shin hanging: the knee comes up) for 2 frames, then the smear, the trail and the kick. After it: `kickD`, `kickC`, `load`, then home. `kickC` and `kickD` are `bendLeg`: Mark's kick with everything from the knee down turned 45 and 22 degrees (a rule, nearest-neighbour, no new colour). The kick now stands on the load's BACK foot (the back leg is the one that stays down), so there is no pop of the planted foot, where round 1 put the kick's toe on the fist column and the standing foot 8.75 world px behind the cross's. That leaves the toe 4 world px short of the fists' column, made up by the kick's push (3 px), so the toe ends at the body front: the stand-off the judges asked for (the body is 2 px further from the target than in round 1).
- *Jab to cross has no recoil (all three).* Jab, `load` 2 frames, cross; each blow also shoves the whole sprite forward (jab .5, cross 1.2, kick 3 world px), never backward except the 1 px of recoil in the coil.
- *The smear (all three).* The streak is drawn BEHIND the arm (the wraps stay on top), from the elbow, with a core at most 2 rows, and it lasts 2 smear frames plus a shorter trail on the blow's first frame: 3 pose frames, 77 ms, not 26. The kick crescent hugs the underside of the leg.
- *Glowrat.* Targets under 22 world px get the crouch (`kit-battle-crouched` as a low blow, twice): the fist meets the body.
- *Far target.* She runs on a lane 3 px below the nearest enemy she passes, in front of it.
- *Impact.* Spark, shake and hit pause grow with the blows; the spark sits 2 px past the fist; the first two blows tint the target softly (the face and the mark stay readable) and recoil it lightly (2 px, then 3 px), the kick uses the hard swap and the full recoil.
- *A miss.* Decided before the follow-up blows (see the pose log): only the jab is thrown.
- *Colours and the shared `anim` fix.* See the pose log. The `anim` change only refreshes the rate that is already refreshed every tick (`update`), so it differs from before only on the tick a round starts with the confirm held; Rook's and the back view's unit and e2e specs pass (`chaos`, `gpufx`: 7 passed).

**Honest issues.**
- `kickC` and `kickD` are a rotated shin, not a drawing: at 45 degrees the thigh is a straight line and the knee is a corner. Read at game speed (1 to 2 frames each) it reads as a knee coming up; a still-by-still judge will see the joint.
- The chamber's first frame is the load (both fists up, both feet planted), so one stance change (load to the leaning kick) is still a single frame, covered by the knee-up frame and the crescent.
- On a far target she is in front of the nearer enemy but the two sprites still overlap in 2D for about 3 run frames and while she stands beside it.
- The crouch is Mark's kneeling frame used as a punch: it reads as a low reach, not a punch; the fist is at 12 world px.
- The jab's spark plays before the engine rolls the hit (a miss still shows the spark, then the lean and MISS).
- A hit on a Warden-size target is unchanged from round 1 (the crouch is for short targets only).
- Judged from stepped captures and contact sheets of the clips, not played at speed by a person.
- The first two blows show no damage number (the engine rolls one): the soft tint, spark, shake and recoil carry them.

## Time log, item H-sf-kit-punch round 2 (wall clock from the session clock, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, Mark's frames and the judges' findings; measured the boots and the crouch | 19:54 to 20:01 | 7 | 0 |
| `sfpunch.ts` rewritten (timeline, pushes, anchors, crouch, smears), `playback.ts` (two-phase combo, miss, lane, low), `render.ts`, tests | 20:01 to 20:12 | 11 | 3 (heredoc quoting twice; the crouch's fist column) |
| Smears reshaped, the kick crescent, `bendLeg` chamber and drop frames | 20:12 to 20:16 | 4 | 4 |
| Captures (near, far, Glowrat, Warden, miss), `npm run check` (exit 0), e2e `chaos` and `gpufx` (7 passed), commit | 20:16 to 20:25 | 9 | 0 |
| Deliverables (strip, 33 stills, sheets, four clips) | 20:25 to 20:28 | 3 | 0 |
| Docs, concepts, pose log, push | 20:28 to 20:34 | 6 | 0 |

About 40 minutes of wall clock, 10 fix passes, no per-pixel repair of Mark's frames: the two bent-knee frames are a rule on his kick.

**Sprite Fusion shopping list for Kit's combo, round 2 (what would replace the stand-ins).**
1. From `kit-battle-kick` through your edit tool: a real chamber (knee up, shin hanging, standing on the back foot) and a foot-dropping frame (replaces `kickC` and `kickD`).
2. A jab in two frames (arm half out, then full) and a cross pulled back to the guard (replaces using the load as the coil).
3. A low blow that is a punch: a stoop with the fist at shin-to-knee height (replaces the crouch as a punch).
4. A step-in or hop frame for the short lunge, and a dodge or lean-back frame for the enemies' punks (their miss now only leans).
5. A kick-recovery frame with the fists coming up (replaces the settle's load).

## Item H-sf-kit-punch round 3 (2026-10-02, after the round-2 judges)
Images: `media/spike-side-battle/H-sf-kit-punch-r3-*.png` (git-ignored): `frame-strip` (every built frame at 4x), `source-frames` (Mark's frames next to the four re-posed kick frames), 36 in-battle captures at 2x stepped one game tick at a time (timing ring off, Rook and Hex acting first so Kit acts mid-round, no crits: guard, load, jab smear, blow, held, coil, cross smear, blow, held, chamber in three frames, kick smear, blow, hitstop, the held number, the foot dropping in two, the settle, home; the far target's run, plant and blows; the Glowrat's crouch and two low blows; the Warden; a miss), `combo-key-frames`, `zoom-blows`, `zoom-chamber-and-drop`, `far-target-lane-and-fade`, `glowrat-crouch`, `miss-whiff`, and four clips (`clip-near-punk`, `clip-far-target`, `clip-glowrat`, `clip-miss`) as APNG at the real 17 ms a tick and GIF at 20 ms.

**What changed, in the judges' order.**
- *Composition (all three).* Two same-size sprites in neighbouring lanes still overlap in 2D, so the lane (now 7 px below the nearest enemy's feet, was 3) is not the fix by itself: `punchFade` in `render.ts` takes every enemy except her target to 40 percent opacity while her drawn frame overlaps it by 8 px or more (eased, recomputed every frame, so it comes back as she goes home). Measured on the captures: the far target fades the near punk for 83 of 91 ticks (67 at full), the Glowrat fades punk B for 58 of 65. The damage number is clamped inside the field on the side view (`FLOAT_MAX_X`), off the turn column.
- *Kick chamber and drop (all three).* The round-2 frames were a rotated ankle. `poseLeg` now re-poses the whole leg (thigh about the hip, shin about the knee) with a cleaned joint: `kickB` (knee rising), `kickC` (knee up, shin folded), `kickD`, `kickE` (foot dropping in two steps). Holds: load 2, `kickB` 1, `kickC` 2 on the way up; `kickD` 2, `kickE` 2, load 2 on the way down (about 3 game ticks each, none under 2). No knee notch or seam at 4x (see `source-frames`).
- *Smears (battle designer).* The cross streak is 29 px long with a white core thickening toward the fist and 3-4 rows at its thin end; the jab's is short and thin, so they differ. The first frame of each blow has the fist 1 art px forward. The kick crescent is a thin tapering band, fading to the jacket's trim.
- *Impact (battle designer, art director).* Sparks cap their flare at 10 world px and fade it on the jab and cross and sit on the chest and jaw (3 px under the fist), so the fist and the face stay readable; the cross has a white ring and a 4 px shove (the jab 2 px), the kick keeps the full star and the colour swap but its flare is a quarter shorter and sits 4 px past the toe, so the boot shows. Hit pauses stay 2, 3 and the engine's 4-5 frames.
- *Miss (all three).* The first blow's spark is no longer played before the engine rolls: a hit plays every blow from the `damage` event, a miss plays a whiff (dull puff, air-cut, no star, no shake, no pause) and the target leans out.
- *Glowrat.* The spark and the GPU hit sit at 0.7 of the rat's height; a longer arm streak; the low frame held 3 frames; the second low blow pushed further. It is still Mark's kneel (see the shopping list).
- *Cost.* The multi-hit script is a table (`PUNCH_BLOW`, `BlowSpec`) read by one routine (`multiHit`), and the pending blows are on the actor (`Disp.followUp`), not in a module-level variable.

**Honest issues.**
- The timing ring with NO press: the engine only resolves after the late window (6 frames), so the jab's spark arrives about 8 ticks after the fist (measured in a capture with the ring on). A press near the beat resolves at the press and lands on time. A hit is never shown for a miss, but a player who never presses sees the first spark late. Fixing it needs the engine to roll before the ring (a change outside this item).
- `kickB` and `kickE` still have a few orphan pixels near the hip at 4x (the top edge of the thigh); `kickC` and `kickD` are clean. All four are rules on Mark's kick, not drawings.
- On a far target she is on a fading enemy, not clear of it: a faded punk stands behind her fist for the whole combo. The same for punk B during the Glowrat crouch.
- The Glowrat's number is clamped, so it floats left of the rat and over Kit's shoulder when the rat stands at the right edge (about 217 world px). The rat's placement is a layout matter.
- The crouch is still a kneel with the fist forward; I added a streak and a longer hold, not a new pose.
- No hit counter was added (the battle designer's optional idea); no party colour grade (style fit). Hex and Sable are still the old traced placeholders in this item.
- Judged from stepped captures and contact sheets of the clips, not played at speed by a person.

## Time log, item H-sf-kit-punch round 3 (wall clock from `date`, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings, Mark's kick (gridded views, leg measured) | 20:25 to 20:34 | 9 | 0 |
| `poseLeg` and the four leg frames; smears; `punch_r`/`punch_whiff`; `multiHit`, `followUp`, `punchFade`, number clamp; tests | 20:34 to 20:47 | 13 | 9 (ragged leg edge and fleck pixels three times; streaks that ended in front of the fist; a wrong key name and a stale miss force in the capture script) |
| `npm run check` (exit 0), e2e `chaos` and `gpufx` (7 passed), code-art run, timing-ring run, commit | 20:47 to 20:50 | 3 | 0 |
| Final captures (near, far, Glowrat, Warden, miss), deliverables (36 stills, sheets, strip, four clips) | 20:50 to 20:54 | 4 | 1 (a recapture after the knock and number changes) |
| Docs, concepts, pose log, push | 20:54 to 21:02 | 8 | 0 |

About 37 minutes of wall clock, 10 fix passes, no per-pixel repair of Mark's frames (the leg frames are a rule).

**Sprite Fusion shopping list for Kit's combo, round 3 (what would replace the stand-ins).**
1. From `kit-battle-kick` through your edit tool: a knee-up chamber (thigh horizontal, shin tucked, torso halfway into the lean) and a foot-down recovery (replaces `kickB`/`kickC` and `kickD`/`kickE`).
2. A low jab: Kit in a low lunge with the lead fist fully extended at rat height (replaces the kneel as a punch).
3. A jab in two frames (arm half out, then full) and a cross pulled back to the guard (replaces using the load as the coil).
4. A step-in or hop frame for the short lunge, and a dodge or lean-back frame for the punks (a miss now only leans).
5. A kick-recovery frame with the fists coming up (replaces the settle's load).

## Item H-sf-kit-punch round 4 (2026-10-02, after the round-3 judges; the last round)
Images: `media/spike-side-battle/H-sf-kit-punch-r4-*.png` (git-ignored): `frame-strip` (every built frame at 4x), `source-frames` (Mark's frames next to the three re-posed kick frames), 35 in-battle stills at 2x stepped one game tick at a time (timing ring off, Rook and Hex acting first so Kit acts mid-round, no crits), `combo-key-frames`, `zoom-blows`, `zoom-chamber-and-drop`, `far-target-lane-no-fade`, `glowrat-crouch`, `miss-whiff`, `timing-ring-hold` (ring on, no press), and four clips (`clip-near-punk`, `clip-far-target`, `clip-glowrat`, `clip-miss`) as APNG and GIF.

**What changed, in the judges' order** (the pose log has one row for each).
- *Composition (all three).* The fade is deleted. Kit runs on a lane 10 px below the nearest enemy's feet and is drawn over what she passes at full opacity. In the far-target stills she stands in front of the near punk; the two sprites overlap, as in any side-view brawler, and nothing is see-through.
- *Kick chamber (art director, pixel artist).* `kickB` is gone; load 2, knee up 3 pose frames. The three re-posed leg frames are despeckled (an island of 5 px or fewer goes), so the black flecks at the hip are gone at 9x. The kick is laid 6 art px forward of the load's back boot (see the pose log): the head moves 6 art px less, the boot steps forward 3 world px.
- *Sparks (all three).* Chunky 2 px strokes in her jacket colours, ahead of the knuckles; jab about fist size, cross 1.7x, kick the biggest; cross hitstop 5 and held 3 pose frames; the first two blows' sparks last 4 to 6 frames, so the chamber is clear.
- *No-press timing (art director).* The pose is held at full reach until the engine answers; see `timing-ring-hold`.
- *Miss (all three).* A dust puff instead of dashes; one label per target.
- *Glowrat.* The number sits over the rat now; the white flash is 2 frames; the second spark is smaller.
- *Style (all three).* The party shares one grain: Kit 146 to about 70 colours, Hex 111 to 65.
- *Process (battle designer).* Measured at 60 Hz ticks from the first move to the last non-guard frame: the near punk 71 ticks (1.18 s), the far punk 78 ticks (1.3 s, with the run in), the Glowrat 50 ticks (0.83 s, two low blows, no kick), a miss 10 ticks (0.17 s). With the ring on and no press the combo is 80 ticks (1.33 s) plus the ring's lead, about 0.4 s. All under 1.6 s; the kick's hold is 19 ticks (0.3 s) with its hitstop. I did not watch the clips at speed as a person would; I stepped them and measured the clock.

**Honest issues.**
- The torso still jumps between the load (3/4 guard, both fists up) and the knee-up frame (front-on, lean back): that is a different drawing, and a rule on Mark's kick cannot fix it. One Sprite Fusion "edit" of `kit-battle-kick` with the guard still up and the knee chambered would; so would a half-turned in-between.
- The kick leg frames are still rules (`poseLeg`, with hard-coded skin and band numbers for Mark's kick frame), not data. They are 3 frames now, not 4.
- The no-press hold is only half a fix: the fist now waits on the target instead of pulling back, but the spark still arrives about 9 ticks after the fist. Rolling hit or miss before the ring opens is an engine change outside this item.
- The Glowrat is the last enemy in the strip and stands at the turn column; I moved the number, not the strip. The crouch is still a kneel with a chest-high fist; the spark is lower than the fist. A low-hook frame would fix it.
- `kit-battle-punch3` (the cross) shows her jacket zipped up like a hoodie with no crop top visible; in motion the jacket seems to change between the jab and the cross. I did not repaint it.
- Enemy punks are softer than Kit's crisp outlines; I did not change the enemies (PixelLab art, another item).
- The cross frame's recoil trail on the target (a lighter ghost of the punk beside it for a few ticks) is the shared recoil, not the removed fade.
- Judged from stepped captures, contact sheets and measured timings; not played at speed by a person.

## Time log, item H-sf-kit-punch round 4 (wall clock from `date`, Claude time)
| Sub-step | From to | Minutes | Fix passes |
|---|---|---|---|
| Read the spike, the code, the judges' findings, Mark's kick (boots and head measured) | 21:00 to 21:06 | 6 | 0 |
| Fade removed, lane, chamber, despeckle, kick shift; sparks (`chunkStar`), hold, whiff, label; per-member palette (mock-ups in Python first); tests | 21:06 to 21:15 | 9 | 3 (the dump script read a stale module copy and showed old numbers; a key name in the capture script; the toe-reach test) |
| `npm run check` (exit 0), e2e `chaos` and `gpufx` (7 passed), code-art run, captures (near, far, Glowrat, miss, ring on) | 21:15 to 21:18 | 3 | 0 |
| Deliverables (35 stills, sheets, strip, four clips), docs, concepts, commit, push | 21:18 to 21:25 | 7 | 1 (the Glowrat recapture after the second-spark change) |

About 25 minutes of wall clock, 4 fix passes, no per-pixel repair of Mark's frames.

**Sprite Fusion shopping list for Kit's combo, round 4 (what would replace the stand-ins).**
1. From `kit-battle-kick` through your edit tool: one frame of the knee-up chamber with the guard still up and the torso half-turned (replaces `kickC`, `kickD`, `kickE` and `poseLeg`), and one foot-down recovery.
2. `kit-battle-punch3` (the cross) with the jacket open and the crop top showing, like every other frame.
3. A low jab: Kit in a low lunge with the lead fist at rat height (replaces the kneel as a punch).
4. A step-in or hop frame for the short lunge, and a dodge or lean-back frame for the enemies (a miss only leans them now).
5. A kick-recovery frame with the fists coming up.
6. A softer-outline pass or Sprite Fusion versions for the rustfang punks and the Glowrat, if you want them to match Kit's crispness.

## Result (filled in at the end)
- Outcome: **GO.** Mark called it on 2026-10-04: the side-on battle view is the game's battle view from now on.
- Date: 2026-10-04 (three days before the time box closed on 2026-10-07).
- Numbers: the code-drawn route plateaued at about 6.5 to 7 out of 10. With Mark's Sprite Fusion art (old rubric): line-up about 7.0, Rook's strike about 7.1 to 7.4, Kit's punch about 7.0 to 7.8. The stage design tournament then picked the 3/4 "arena" stage with a side-view HUD (`docs/spikes/side-battle-stage.md`). The Phaser spike rebuilt that stage and scored it 8.0.
- Draft PR: [PR #3](https://github.com/markhazlewood42/shadow-jog/pull/3). It stays open as a reference until the Phaser GO/NO-GO (decision 9 in `docs/PHASE-0.2.md`, due 2026-10-09).
- Archive tag: not yet. After decision 9, tag `archive/side-battle-<date>`, close PR #3 and delete the branch. If the Phaser spike is a NO-GO, this branch is instead the start of the side view in the current engine.
- Update 2026-10-04 (later the same day): decision 9 is GO (see `docs/spikes/phaser-stage.md`). The production side-view battle scene is rebuilt in Phaser from the `spike/phaser-stage` code, which already contains this spike's code. PR #3 stays an open draft as a reference. Once the rebuild lands on `main`, Mark approves the tag `archive/side-battle-<date>`, then PR #3 is closed and the branch is deleted.
- Notes: what was learned and what to rebuild.
  - Mark made the call from the work he saw, not from the formal clip comparison of step 8. His reasons: side-on makes everything easier, because the pixel-art community has far more side-view references and assets. Heroes stand on the left and enemies on the right. The PS4 portrait row is gone.
  - Size: Mark's Sprite Fusion crew at about 64 px tall. This is larger than both sizes the spike tested (field scale ~30 px, battle scale ~44 to 48 px). Battle sprites may carry more detail than field sprites, for personality and ambience.
  - Poses: they come from Mark's Sprite Fusion frames, not from the code-drawn rig. Simple idles and walks work from animate. Complex moves work better as a static pose plus frame-by-frame edits.
  - Enemies: today's enemies stay. In the Phaser spike, five sprites are mirrored so every enemy faces the heroes. New side-facing humanoid enemies are on the Sprite Fusion shopping list.
  - To rebuild for real: the production battle view (behind `?battle=side` in this spike), the poses for all four heroes, and the humanoid enemies. The engine for that work is decision 9.
