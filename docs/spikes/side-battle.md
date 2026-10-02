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

## Pose log
| Pose | Size | Claude time | Mark's rounds | Notes |
|---|---|---|---|---|

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes: what was learned and what to rebuild.
