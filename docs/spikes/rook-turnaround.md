# Spike: Rook turnaround (code-made facings in the Sprite Fusion style)

Branch `spike/rook-turnaround`, draft PR, never merged. Rules for spikes: `docs/spikes/README.md`. Idea source: `docs/research/2026-10-17-pixel-art-quality-brainstorm.md` (a merge source, not a spec).

## Question
Can a code pipeline (a pixel-art authoring kit, a script checker and persona-pack graders) make Rook's missing 32x32 field facings from his one Sprite Fusion facing, so that Mark sees the same character in the same game?

## Why now
Three open questions meet here:

1. **E1 restyle (#102, WS4).** E1 needs field characters in the Sprite Fusion style, with 75 Sprite Fusion credits left (#107). Sprite Fusion gives one facing per walk. The game needs four (#110, rig v2). If code can make the other facings, the credits go further.
2. **Mark's 8-direction hope (#110).** Sprite Fusion's 8-direction tool was unusable (PHASE-0.2, Pivot 3). With mirrors, four new pictures plus the given one make all eight directions (see Steps). This spike tests that at zero credits.
3. **The quality loop itself.** E1 WS1 plans a style checker (`scripts/art/stylecheck.mjs`, PL-3). This spike tries the checker and the graders on a real asset before E1 builds them for real.

Cost of a wrong answer: E1 plans its restyle on a method that cannot hold a character together across facings, or spends credits that code could have saved.

This is a spike, not E1 work. Its code never merges. The E1 order (no epic before #101 closes) does not change. Mark chose option A on #110 (rig v2 makes the facings). A GO here does not change that choice. It gives Mark a third option for #110, as a new decision.

## Time box
The box closes **2026-10-24**, whatever state the spike is in. Round caps (below) stop each step earlier.

## Terms

- **Walk sheet:** `spritefusion-tests/rook-overworld-walk.zip`, 8 frames of 32x32, front 3/4.
- **Walk palette:** the 22 opaque colors of the whole walk sheet. One frame uses about 20 of them.
- **Given frame:** the walk frame with the feet closest together. Step 0 picks it and names it in `target.json`.
- **New facings:** the four pictures that step 3 makes.
- **Edge pixel:** an opaque pixel next to a transparent pixel (4 neighbors).
- **Near-black:** a color with luminance under 60 (of 255). Step 0 lists the walk palette colors that qualify in `target.json`.
- **Orphan pixel:** an opaque pixel whose color matches none of its 8 neighbors.

## Exit criteria (written before any code, dated 2026-10-17)

- **GO if all of these hold:**
  - **Hard lines (checker).** Every new facing uses only walk palette colors. It has no half-transparent pixel. Its outline is near-black on at least 93 percent of edge pixels (the walk frames measure 94.4 to 100). Its body height and head width are within 1 px of the given frame. Its orphan pixels and its 1-2 px regions are at most 1.25 times the count in the given frame (the walk frames have 22 to 35 orphans and 60 to 72 small regions).
  - **Same character, same game (Mark, blind).** Mark sees each new facing at 1x and 4x next to the given frame, in a random order with decoys from step 2. Each new facing gets "same character, same game" from him.
  - **Better than today.** Mark sees the full new set and the full rig v2 Rook set (`public/art/rig/field.json`) once, side by side at 1x on a Lantern Row screenshot. He prefers the new set.
  - **No pixel directing.** Every facing passes within the round caps. Mark does not direct pixel fixes on any facing.
- **NO-GO if any of these happens:**
  - Any new facing fails "same character" or a hard line after the caps, or after a plateau stop.
  - Mark directs pixel fixes on any facing.
  - Mark prefers the rig v2 set, or calls the two sets equal.
- **Anything else** (for example the box closes before step 4) is NO-GO or ABANDONED. Mark makes that call.
- **A second answer (it does not gate GO).** The agreement between the graders and Mark on at least 10 pairwise picks. At 70 percent or more, graders can gate later art loops, with Mark at the checkpoints only. Below 70 percent, Mark stays the gate, and each miss goes into the pack's calibration set. Ten picks is a small sample, so the record states the count with the rate.

## Steps

0. **Measure the target.** Unzip the walk sheet to the git-ignored `media/rook-turnaround/`. Pick the given frame. Write the target numbers to `docs/spikes/rook-turnaround/target.json`: the walk palette, the near-black colors, body height, head width, outline ratio and cluster-size spread. The battle idle (`public/art/crew/rook/idle/`, 79x68, facing right) is the design reference for the side facing. It has its own 22 colors and shares none with the walk palette, so the checker takes the palette for each asset. Height and head-width checks compare 32x32 frames only.
1. **Tools.** One builder, then the lean loop (runner and reader).
   - `scripts/art/pixkit/`: the authoring kit. A locked palette (an off-palette color throws), clean lines and ellipses, mirror, flood fill, an outline and selout pass, and region edits as a grid diff.
   - `scripts/art/pixlint.mjs`: the `[script]` items of the character pack, plus a facing-consistency check (height, head width, palette, carried-item side). Pass line: it passes all 8 walk frames against the walk palette and the battle idle against its own palette, and it fails `public/art/enemies/warden.png` (5,548 colors) and a half-transparent test image.
   - `scripts/art/contact-sheet.mjs`: 1x, 8x with a grid and coordinates, grayscale, silhouette, in context on a Lantern Row screenshot at 640x360, and next to the given frame.
2. **Medium shoot-out, with an answer key.** Each writer makes Rook's front 3/4 at 32x32. The given frame is the answer key.
   - **Inputs.** A clean input folder outside the repo: the battle idle, the walk palette and a short design note. The palette is given on purpose: in real use the palette is known. The key is the pixel layout.
   - **Isolation.** A writer reads only its input folder and writes only its output folder. The orchestrator checks each writer's tool calls for any read of `spritefusion-tests/` or `media/`. A read voids that result.
   - Medium A: a grid with the kit's primitives.
   - Medium B: a height or normal map plus the palette ramp, shaded from one light direction.
   - Medium C (only if A and B finish early): simple volumes (SDF or voxels) rendered orthographic at 32 px, then cleaned up by pixel.
   - **Score:** silhouette overlap (IoU) with the given frame after the best integer shift, color count, outline ratio, the checker, and pairwise grades.
   - **Copy tripwire (backup to the isolation check).** Match = exact RGBA match over the opaque pixels of the given frame, after the best integer shift. Before any writer runs, measure the baseline match of the rig v2 Rook down facing and of Hex's walk frame 0 against the given frame. The void line is the higher baseline plus 30 points, and at least 60 percent. Write it in `target.json`.
   - The best medium goes to step 3. The losers become decoys in Mark's blind review.
3. **The turnaround.** With the best medium, make four new facings from the given frame: **down** (front), **up** (back), **right** (side), and **up-right** (back 3/4). Mirrors give left, down-left and up-left. The given frame is down-right. That is all eight directions. A mirror moves the katana to the other shoulder. The checker reports it, and Mark judges if it matters.
   - Stages: 4 silhouette thumbnails per facing (pairwise pick), then blockout, flat colors, shading, and outline with selout and polish.
   - **One round** = one writer call that works on all open facings together (so it sees the whole set), the checker, then two character-pack graders. Each grader sees only the views for its job: one checks form, light and color; one checks consistency with the given frame and readability at 1x. They pick pairwise and give findings with a fault ID, a pixel coordinate and a fix. A writer fix touches only the named region.
   - One holdout grader, who sees no earlier verdicts, runs once at the end on the full set.
   - **Stopped after round 8 (Mark, 2026-10-17).** Both graders passed stage 4, but Mark judged the set far from the target: detail about an order of magnitude low (1-2 px regions 4 to 9 against 60 to 72). Records: `rook-turnaround/records.md`.
3b. **Head test (Mark, 2026-10-17; written before its code).** Recreate only the head of the given frame (box x10 to 25, y0 to 13), same facing. The writer sees the given frame only as pictures and never reads its pixel values. Plan, metrics, feature list rules and models: `rook-turnaround/head-test-plan.md` (a Fable consult). In short: the writer edits a text grid of palette letters; round 1 runs 3 writers and a per-cell vote grid; the checker has lower and upper detail bands; graders always see the target beside the work, with a fixed feature list, a blind pick and a rank against round 8.
   - **Pass:** exact match at least 85 percent, ramp-tolerant at least 93 percent, every must feature present (both graders), the candidate beats round 8 for every grader, and no unanimous blind pick at 4x. **Viable:** 65 to 84 percent with every must feature.
   - **Cap:** 4 rounds; plateau stop when a round gains under 3 points of exact match. At the cap or a plateau, Mark sees the evidence and decides whether to go on.
   - **Turnaround signal:** record the round 1 score with no cell-mask feedback (Level 0). New facings have no answer key, so a pass that needs Level 1 feedback does not prove the turnaround.
   - After the head test, one more consult plans the whole art pipeline (sprites, animations, tiles) with these numbers. Mark lifted the 80-call agent cap on 2026-10-17.
4. **Mark's blind review.** One sheet: the new facings, the given frame, the step 2 decoys and the rig v2 facings, at 1x and 4x, in a random order, and the set on a Lantern Row screenshot. Mark answers the three GO questions and at least 10 pairwise picks. Then compute the agreement.
5. **Stretch (only inside the box).** A 4-frame walk for the side facing with the rig v2 walk code, next to the walk sheet at 8 fps.

**Round caps.** Step 1: the lean loop, at most 3 rounds. Step 2: at most 3 rounds per medium. Step 3: at most 3 rounds per stage, 12 rounds in all. Plateau rule: a stage stops early when the new best wins fewer than 55 percent of pairs against the old best for 2 rounds in a row.

## Assets and cost
- **Sprite Fusion:** zero credits. Only Mark's committed sheets are used.
- **Image generation:** none. No diffusion model, no PixelLab.
- **References:** only Mark's Sprite Fusion sheets and today's game art. No third-party sprites are downloaded or committed.
- **Dependencies:** possibly `pngjs` as a dev dependency for the scripts (small, MIT). Nothing ships to the player.
- **Agents.** The worst case with all caps hit is about 80 agent calls: step 1 up to 9, step 2 up to 30 (3 media, 3 rounds, 1 writer and 2 graders), step 3 up to 37 (12 rounds of 3, plus the holdout), and at most 4 searches. A run that stops at plateaus uses fewer. This is above the usual workflow guideline of 10 agents, so Mark approves the cap of 80 when he approves this doc. Models: Haiku for searches, Sonnet for builders, writers and graders, effort set on every call.
- **Persona packs:** home-base `knowledge/verifier-personas/pixel-artist-characters.md` grades this spike. `pixel-artist-tiles.md` is for later tile work and is not used here.
- **Pictures:** contact sheets and clips go to the git-ignored `media/rook-turnaround/`. Sheets for Mark's review go to him at once.
- **status.md:** no line. The spike never merges, and only a PR to `main` changes `status.md`. The workstream file `docs/workstreams/spike/rook-turnaround.md` shows it on the Command Center.

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes: what was learned and what to rebuild.
