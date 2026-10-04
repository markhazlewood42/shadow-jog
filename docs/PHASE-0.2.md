# Shadow Jog 0.2: the pivot phase

> Status 2026-10-04: "The short version" below is the original 2026-10-02 plan. See "Decisions for Mark" for the current state.

*Plan written 2026-10-02, after PR #1 (Rook's back-view battle rig) merged. Anything marked (inferred) has not been checked against a source or the code.*

## The short version

- **Versioning.** Freeze today's `main` as **v0.1.0**. Call the new phase **0.2.0**, not 0.1.1. A patch number (0.1.1) means "bug fix", and changing the battle view is not a bug fix. Pushing the tag and creating the GitHub Release both wait for your go-ahead.
- **Side-on or 3/4 battle view: spike first.** It goes after the real cause of the churn: posing ~100 px back views pixel by pixel while faking depth. Smaller sprites do not mean fewer poses, though, and it is not yet proven that posing an arm on a 30 px profile is cheaper. Before committing, run a 3-day spike that tests field scale (~30 px) and "hero" scale (~55 px) with equal effort.
- **Phaser port: don't port now, but run a spike soon.** Phaser can use our procedural canvases as textures with no trouble. It does nothing for the sprite-posing problem, though. Run a 4-session spike right after you pick the battle look and before the new battle scene is written for real, so battle presentation isn't written twice.
- **Sprite Fusion: one cheap spike.** Buy one month, run the tests in the same week as the battle spike, and judge it against our code-drawn art only (no PixelLab comparison). Its 16/32/64 px sizes make it a real candidate only if battles go to small sprites. Under today's ~100 px back view it can only supply references. (Update 2026-10-02: a new model version adds style-reference sizes up to 128 px through the API, including 48 px, which is exactly the side-view battle scale; see Pivot 3.)
- **Order.** First tag v0.1.0. Then, in the same week, the battle spike and the Sprite Fusion spike. You pick the look. Then the Phaser spike. Then the production battle view, built in whichever engine won. Finally your playthrough, and the v0.2.0 tag.
- **Pause now.** Stop tuning Hex's and Sable's back-view poses until the battle spike reports. Kit's finished poses and Rook's merged ones stay safe in v0.1.0 and behind a flag.
- **Kept whichever way each pivot goes:** the story, setting, effects, audio, tiles and props, saves, and your tools. Nothing in this plan needs a save migration.

## Versioning and releases

**Why 0.2 and not 0.1.1.** In semantic versioning, while the first number is 0, the middle number is the one that moves for each meaningful step. The last number is kept for fixes. A new battle view, a possible engine change and a new art pipeline are all features, so they belong in 0.2.

### The scheme

| Piece | Rule |
|---|---|
| Source of truth | The `"version"` field in `package.json` (shown on the title screen, `0.2.0-dev` on `main` since 2026-10-03, after the first release v0.1.0). Tags, changelog and in-game label all come from it. |
| Release tags | Annotated tags such as `v0.1.0`, which record author, date and message. A pushed release tag is never moved or deleted. |
| GitHub Releases | One per tag, with the "pre-release" box ticked for the whole 0.x line. Generate the notes, then edit them by hand. |
| Changelog | `CHANGELOG.md` in Keep a Changelog 1.1.0 format: an `Unreleased` section on top, ISO dates, and the headings Added / Changed / Deprecated / Removed / Fixed / Security. The agent drafts the entry inside each feature PR, so you read it in the diff. |
| In-game label | Vite's `define:` injects `__APP_VERSION__` and the short git SHA at build time. It shows as small text like `v0.2.0-dev · abc1234` on the title screen and in the DEV tab, and `?debug`/`__SJ__` exposes it so test runs and playtest notes can name their build. |
| Minor vs patch while 0.x | **Minor** (0.2 → 0.3) is anything a player would call a different build: a battle view, an engine, a new chapter or zone, a new system, a save reshape, a new art pipeline. **Patch** (0.2.0 → 0.2.1) covers fixes, balance numbers, copy, and art swaps that change no system. The major number stays 0 until you say "1.0". |
| When to tag | After a set of feature PRs has merged and you've playtested it. The tag marks "last known good". Not every PR gets one. |
| Dev builds | Right after v0.1.0 is tagged, `main` moves to `0.2.0-dev`. That suffix is valid semver and sorts below `0.2.0`. |

### Spikes and pivots

- A spike lives on a `spike/<topic>` branch with a **draft PR that is never merged**. If it works, the good parts are rebuilt on a normal feature branch, so experimental code never sneaks into `main`.
- Every spike gets a one-page `docs/spikes/<topic>.md` holding the question, the time box and the exit criteria. That page is committed **before** any spike code is written.
- A large change lands on `main` behind a query flag (for example `?battle=side`, the same style as `?scene=fxlab` and `?debug`) until it is good enough to become the default.
- When a spike is dropped, its doc records "abandoned" with the reason and the numbers. The branch tip is tagged `archive/<topic>-YYYY-MM-DD` so the work stays reachable, then the PR is closed and the branch deleted. `main` never saw it, so nothing needs reverting.
- The two `snapshot/2026-09-30-*` tags keep their meaning: dated art-decision checkpoints, not releases. `v*` is the only release prefix.

### Save policy

- `SAVE_VERSION` (3 today, in `src/game/state.ts:54`) moves independently of the app version. It is bumped only when a field is renamed or reshaped. Each bump comes with a `MIGRATIONS[n]` step and a unit test that uses a fixture save from the previous version. Purely additive fields need no bump, because `backfill()` fills them in.
- A new `meta.appVersion` field records which build wrote each save.
- An older build that meets a newer save already refuses to load it, which is correct. The slot should say "saved by a newer version" rather than "damaged".
- A 0.2.x build must load any 0.1.x save. Wipes happen only on purpose, are announced in-game and in the changelog, and never come from a half-working migration.
- Before a migration overwrites a slot, the old JSON is copied aside (inferred as worthwhile; the repo doesn't do this yet). Skipped 2026-10-03: `loadSave` migrates in memory only and never writes a slot back, so nothing overwrites old JSON. Revisit if a migration ever writes back.
- Spike preview builds run on their own origins, so their `localStorage` can't touch your real saves.

### Not adopting

These are all skipped as ceremony with no payoff for one maintainer: release-please, changesets, enforced Conventional Commits, gitflow, four-part build numbers, an alpha/beta/rc ladder on every tag, and multi-environment deploy pipelines.

### Order of the freeze

1. A small "release prep" PR adds `CHANGELOG.md` with a `[0.1.0] - 2026-10-02` entry, the in-game version label, a `docs/spikes/` template, and an update to the stale line in `status.md` that says PR #1 is waiting.
2. You merge it.
3. `v0.1.0` is tagged on that merge commit.
4. The GitHub pre-release is created.
5. A second small PR bumps to `0.2.0-dev` and adds `meta.appVersion` plus the "newer version" message.

**Status (2026-10-04): all five steps are done.** PR #2 (release prep) merged and `v0.1.0` was tagged and released as a pre-release on merge commit `81bc0f8`, all on 2026-10-03. PR #5 (the bump) merged on 2026-10-03. Since then a GitHub ruleset, "Main branch protection", requires a pull request and a passing `check` job on `main` and blocks deletion and force-push.

**These need your explicit go-ahead:**
- pushing any tag, including `v0.1.0` and later `archive/*` tags;
- creating a GitHub Release;
- any deploy, including a preview URL for a spike build;
- buying Sprite Fusion or cancelling PixelLab, which you do yourself in their web pages.

As always, you merge every PR.

## Pivot 1: a side-on or 3/4 battle view

**Mark's input, 2026-10-02.** The Phantasy Star IV feel is the loop (combos, panels, cut-ins, pacing), not the over-the-shoulder camera (decision 2). He expects side-on to make everything easier overall, because the pixel-art community has far more reference material, examples and assets for small side-on characters. He also wants battle sprites a little more detailed than field sprites, for personality and ambience. That points at a middle **battle scale of about 44–48 px tall in a 64 px cell**: the size of RPG Maker MV/MZ's side-view battlers, whose standard sheet is 576×384, a 9×6 grid of 64 px cells holding 18 motions of 3 frames each (walk, wait, chant, guard, damage, evade, thrust, swing, missile, skill, spell, item, escape, victory, dying, abnormal, sleep, dead; [RPG Maker MZ help](https://rpgmakerofficial.com/product/MZ_help-en/01_11_02.html)). That format gives us a ready-made pose list and the biggest pool of side-on references, and it sits inside Sprite Fusion's 64 px maximum. Community sprites are fine as pose and style references; anything used in the game needs its licence checked first. The spike below should compare field scale (~30 px) with this battle scale; hero scale (~55 px) stays a fallback if 44–48 px still feels too small.

**Verdict: spike first.** Pausing the back-view work costs little, and a 3-day spike answers the one question only your eyes can: whether small battle sprites look like a downgrade.

### What it fixes and what it doesn't

The pain in numbers: since 09-30, 37 of 60 commits were art, rig or tool work. `rig2/battle.ts` took 19 commits and `skeleton.json` took 12. The battle engine, AI and abilities took none. The commit titles fix one sleeve or one stray pixel at a time.

**What it genuinely fixes:**
- **Swings stay flat on the screen.** In profile, a swing travels across the screen. From behind it has to reach *into* the screen, which is why the 2.5D reach prototype exists.
- **A frame has about a tenth of the pixels:** ~900 at field scale against ~10,000 for a back view. That means far fewer sleeves, hems and plates to keep consistent.
- **Identity comes almost free at field scale.** All four crew already have traced, separately drawn `left`/`right` profile frames (16–27 × 27–32 px), and rig v2 already gives them a hip split, a walk, a bob and an outline.
- **No more overlap.** Back-of-head blobs covering the enemies (round 13's finding) can't happen by construction.

**What it doesn't fix:**
- **The pose count.** Each member still needs about 10–12 poses: ready, wind-up, strike, cast/item, hurt, defend, low-HP kneel, KO, victory, run. Smaller does not mean fewer.
- **The arm.** The profile frames have the near arm *painted into the body*. Posing it means erasing those pixels and repainting the torso behind it, and that erase-and-fill job is exactly what produced today's churn. A code-drawn limb 2 px thick (like `katana()`) may read fine at 30 px (inferred). This is the part most likely to sink the pivot.
- **AI drift.** This pivot makes AI animation unnecessary. It doesn't make AI animation better.

**The strongest objection.** The churn may come from the *method* (trace one frame, cut out an arm by colour, repaint the gap) rather than the camera. Shrinking the canvas keeps that method, and at 30 px every pixel counts. The spike is built to test the method, not just the look.

### Options compared

| | (A) Field scale | (B) Hero scale | (C) Keep the back view |
|---|---|---|---|
| Party height | 28–32 px, using the existing `left`/`right` frames | ~49–62 px: the traced east/west views (97–123 px) downscaled 2:1 | 97–109 px (today) |
| Base art | Exists | Needs downscale and cleanup; quality untested (inferred) | Exists |
| Pixels per frame | ~900 | ~3,000 | ~10,000 |
| Your references | Image 1 (~12–14% of screen) | Images 2–4 (16–23%) | None |
| Humanoid enemies (punk 91, medic 67, slinger 86, sentinel 92, arcanist 92 px) | ~3× the party, so about 5 need field-scale art. Ghoul 96, shade 88, bound 92 and wisp 87 may also read as giants | 1.2–1.7× the party, probably fine as-is (inferred) | As-is |
| Sprite Fusion fit | 32 px cell | 64 px cell | Out of range |
| Pixel density | One sprite scale, but backdrops stay a 240×135 world drawn 2× unless re-baked (+1–2 days) | Same | Mixed, as today |

**Layout:** a shallow 3/4 diagonal (party lower right, enemies left and upper left) on the existing backdrops, like images 1 and 3. A Chrono Trigger-style fight on the field map would mean rewriting the field system, so it's out of scope.

No size is preferred going in. Three of your four references sit at (B)'s size, so (B) gets the same treatment in the spike as (A), and you choose from the result.

### Kept and lost

**Kept:**
- the battle engine, AI, balance and `playback.test.ts` (about 2.4k lines that don't depend on the view);
- combos, cut-ins, panels and the turn strip;
- audio, story and dev pages;
- saves (no layout field in `state.ts`).

**Kept with a small rework:**
- The GPU hit and `FxLayer.play` are anchor-driven. A few offsets tuned for tall back views (`fx.ts` ~L765–783) need a pass.
- The FX lab imports `PANEL_Y` from `geom.ts`, so it needs a small touch.

**Lost:**
- **The over-the-shoulder camera.**
- **Kit's finished back-view poses, which you signed off.** That is a real loss, not just about 30 commits.
- **Rook's merged ones too.** `skeleton.json` holds pixel coordinates on 128 px back-view canvases, and none of that transfers.
- **The back-view parts of the tooling.** `?art=review`'s battle-back role and `tests/rigcheck.test.ts` go with the old rig. The editor's arm-picking logic goes too; its drag UI and pose list could be pointed at profile frames (inferred).

**What survives from the rig:**
- the pose vocabulary;
- the timing (`PARTY_POSE_T`, the beats);
- `katana()`;
- the arc and swept-light code;
- the turntable.

### Effort

No honest estimate is possible before the spike. On paper, (A) costs 7–11 Claude working days:
- scene and renderer, 2–3 days (about 1.2–1.5k lines);
- profile arm rig plus editor retarget, 1.5–2 days;
- poses, 2–3 days;
- humanoid enemies, 1–2 days;
- FX anchors and backdrop framing, about 1 day;
- E2E fixes, about 0.5 day.

That pose line assumes posing is 3–4× faster per pose than Kit and Rook were (about 4 art-heavy days for two members), which is exactly what the spike tests. The planning number should be **(per-pose cost measured in the spike) × about 40–48 poses**, with a pessimistic range of **12–18 days**. On top of that comes about a day for:
- CONCEPTS and ARCHITECTURE updates (CONCEPTS.md line 30 calls Shadow Jog a back-view game);
- Copilot review rounds;
- fixes to the 9 E2E specs that touch battle.

(B) adds downscale cleanup but needs less enemy re-art. (C), finishing Hex and Sable from behind plus a layout fix for the overlap, is 4–8 days with the same churn risk.

### The spike

- **Setup.** Branch `spike/side-battle`, flag `?battle=side`, criteria in `docs/spikes/side-battle.md` first. v0.1.0 is tagged before it starts.
- **Time box.** 3 days, hard stop. Step 1 is designed to fail fast by the end of day 1.

**Steps:**
0. You supply or approve profile references for Rook's strike and Kit's punch (FF6, Chrono Trigger, Sea of Stars, anything). Nothing is posed without your direction (`status.md:237`).
1. **Arm test.** On Rook's `right` frame, separate the near arm and repaint the torso behind it. Try a code-drawn limb too. Hand-drawn frames are an allowed fallback, but their time is logged as a cost.
2. Static layout on one existing backdrop: two Rustfang Punks plus a Glowrat, then the Warden. The party uses field frames at 1:1 with the idle bob and walk-in.
3. Rook's kendo strike end to end through the real playback engine: wind-up and strike keys, code katana and arc, horizontal lunge, hitstop, and the GPU hit at the new anchor.
4. **Kit's punch** the same way. It is the non-weapon case, with no `katana()` shortcut.
5. (B) at hero size with **the same Rook strike**. If time runs short, compare (A) and (B) as still key poses only, never an animated (A) against a static (B).
6. Hurt and KO for one member, plus Hex's Overload re-anchored.
7. Scale check: the 91 px punk and the 96 px ghoul beside a field-scale stand-in such as the `ganger` NPC. No re-art.
8. Comparison sheet of short **clips**, not stills: v0.1.0 back view, (A) and (B), plus the Sprite Fusion strike if Pivot 3 produced one.

**GO if all of these hold:**
- **Readability:** at normal speed you can tell who is acting and whether it's a strike or a cast.
- **Identity:** battle Rook is clearly field Rook.
- **Impact:** at least as good as the v0.1.0 strike in the side-by-side.
- **Cost:** each of Rook's and Kit's key poses takes about 2 hours of Claude time or less, with at most one round of your corrections. This is measured by elapsed time and your rounds, not commit titles.
- **Composition:** nothing overlaps, and the target cursor and enemy HP read clearly.

**NO-GO if any of these happens:**
- you call both sizes a downgrade;
- any pose needs 3 or more correction rounds;
- the arm can only be posed through a repaint loop like today's;
- Hex's spell effects don't read on small targets.

### Open risks

- **Perceived downgrade.** The crew at 30 px has less personality than at 100 px.
- **Backdrop density.** Backdrops stay mixed unless they are re-baked.
- **Targeting.** Moving from a left-right row to columns changes the targeting controls.
- **Silhouettes.** Fists, katana, pistol and staff all need clear shapes at small size.

## Pivot 2: port to Phaser

**Verdict: don't port now. Run the spike after you've picked the battle look.** A full port would not touch the art problem. The question worth answering is whether building in Phaser's standard engine style beats our custom one, and the right time to answer it is before the new battle scene is written for real.

### What it fixes and what it doesn't

**Status:** Phaser 4 is stable. The current release is v4.2.1 (2026-07-09), and v4.0.0 shipped 2026-04-10. It is MIT licensed.

**Procedural sprites work** (checked in the v4 docs):
- `textures.createCanvas`/`addCanvas` turn a canvas we draw into a texture, and `refresh()` re-uploads it after drawing.
- `Texture.add()` registers frames on that texture.
- Building animations from those frames with `anims.create` follows from the standard API but wasn't checked (inferred).
- Every one of our generators would run unchanged. Only the code that draws their output changes.

**What it gives you:**
- The standard vocabulary: scene, sprite, texture, animation manager, camera, tween, tilemap. That is what you asked for. The "stay custom but use engine-style structure" option teaches the same ideas under our own names, which is *not* the same thing, and this plan says so plainly.
- Camera shake and flash, gamepad input, integer-zoom scaling.
- A huge base of examples.

**What it doesn't fix:**
- **Sprite posing.** Phaser plays frames, it doesn't draw them. Rig v2 and the editor carry over with the same hard problem.
- **Mixed scale.** That's an art decision (Pivot 1).
- **Story, audio and balance.** Unchanged.

**What it changes for the worse:**
- **WebGL only.** Filters (Phaser's post-effects) need WebGL, and its Canvas renderer is officially deprecated, so our 2D fallback goes away.
- **CI may break.** CI runs on GPU-less machines, where our presenter already drops to plain 2D (`failIfMajorPerformanceCaveat`). How Phaser behaves there is untested.
- **Young version.** Most tutorials and AI training data are v3, and v4 changed the rendering APIs (inferred risk of stale advice). Whether the rexrainbow plugins support v4 is unconfirmed.

**Why the reason for hand-rolling is gone.** "Zero runtime dependencies" was an AI choice, not yours. It is written into `docs/ARCHITECTURE.md:15` and `CLAUDE.md:4`, and it is why a PixiJS rewrite was turned down. Both lines should be corrected so future sessions stop treating it as a rule. The bundle budget is an alarm: it was re-set four times between 09-29 and 09-30. Real download size still matters to players:
- the full Phaser build is about 353 kB gzip (measured);
- a trimmed "core" build is about 235 kB (our own esbuild run);
- the realistic game total is **about 420–500 kB gzip**, roughly double today's 233 kB (inferred);
- that is fine on broadband and noticeable on mobile (inferred).

### Options compared

| Option | Effort | Standard-engine value | Main risk |
|---|---|---|---|
| Full port | 15–30 sessions, ~3–5 weeks with your visual review (a guess; see below) | Full | Long tail of visual regressions |
| Phaser as shell (whole game drawn into one `CanvasTexture`), scenes converted later | Shell 2–4 sessions; 2–6 per scene | Almost none until scenes convert | Pays the setup cost up front |
| New battle view as the first native Phaser scene | Shell + 6–10 sessions | High, in the most-used scene | Only safe once the look is already chosen |
| Stay custom, engine-style structure | Mostly absorbed in the battle rewrite | Medium; our names, not the standard's | Low |
| Godot or Unity | Rewrite everything | High, but not for a browser game | Multi-MB web builds, slow loads (inferred); fit with agent and Playwright work unproven (inferred) |

**Where the effort figure comes from.** Code volume isn't the limit: the whole game was written in 6 days. Your visual review is. About 10.6k lines of scene and draw code would be rewritten. For comparison, rig v2 and the editor were about 2.9k lines over about 3 days, including two "pose is wrong, redo" cycles. At that rate, the port is 10 or more review-days. Here a "session" means one focused Claude Code work block of a few hours (inferred).

**Other costs to count:**
- **Draw calls.** There are 970 `ctx.` uses across 47 files, 426 of them in scenes, battle, field and UI.
- **Adapter.** `await game.run(scene)` needs an adapter, about 200–400 lines (inferred).
- **Test hooks.** `__SJ__` has to be re-exposed. It is used in 11 E2E files, which reach into scene internals 14 times.
- **Docs.** ARCHITECTURE and DEVELOPING need rewriting, and CONCEPTS and GLOSSARY entries come in the same change.
- **Review.** Copilot rounds on a large PR.

### Kept and lost

**Kept unchanged:**
- story, data, saves (same `localStorage` keys, no migration);
- the synthesized audio (Phaser runs with `noAudio`, and our `AudioContext` stays);
- rigedit, artreview and the DEV tab;
- the fixed-timestep accumulator, which moves inside Phaser's `update`. Phaser's `fps` setting has no fixed logic step, and the frame-counted choreography must not become millisecond tweens.

**Kept with changes:**
- **The presenter.** It survives as an overlay, or gets rebuilt as Phaser filters. Glow, Blur, ColorMatrix and Blend are confirmed in v4. Bloom and Vignette by name are not confirmed. At 480×270, filters would look chunkier than today's screen-resolution effects.
- **The bitmap font.** `font.ts` keeps drawing into textures, because `BitmapText` has no inline colour codes.

**Needs porting:**
- the FX lab and artswap;
- a few unit tests that record canvas draw calls.

**Gotchas:**
- `DynamicTexture` comes back blank after a WebGL context loss.
- v4 removed the string-pixel texture generator.

### The spike

- **When.** After the battle look is chosen, and before the production battle scene is written.
- **Setup.** Branch `spike/phaser`, draft PR, criteria in `docs/spikes/phaser.md` first.
- **Time box.** 4 sessions maximum.
- **Assets.** Existing art only. No accounts.

**Steps:**
1. **Shell.** Run the existing game inside Phaser 4.2.x as one `CanvasTexture`, with the presenter overlay untouched. Exit check: CI goes green on chromium, webkit and firefox, including `perf.spec`'s software-canvas gates (mean under 8 ms, p95 under 11 ms), within 2 sessions.
2. **Native slice.** Rebuild the spike's side-view strike scene (one party member, one enemy, backdrop, strike, hitstop, shake) with Phaser sprites, animations, a camera, and timers driven by frame counts. Judge it on lines of code, how easy it is to read, and whether you'd rather learn from and keep this version or ours.
3. **Filter check.** Record short clips of one Phaser glow at 480×270 and at screen size with integer zoom, next to the presenter's bloom. This is for information only.
4. **Measure.** Record the bundle size and first load on throttled "Fast 4G", and keep a log of v4 surprises.

**Kill rule:** the shell takes more than 2 sessions, or the native slice shows you no gain. Preferring the presenter is **not** a kill reason, because it can stay as an overlay.

### Open risks

- whether CI keeps working on GPU-less machines;
- WebGL-only players;
- v4's youth;
- writing battle presentation twice if the decision slips (addressed in the sequencing below).

## Pivot 3: Sprite Fusion as the AI generator

**Verdict: spike first, for one month and about one evening of your time.** You've already seen better consistency on simple animations. Nobody has yet tested hard poses on our characters.

### What it is

**Update 2026-10-02 (from the developer, relayed by Mark).** Hugo Duprez announced a new version of the pixel-art model: much better size adherence, better overall quality, better background removal, and style reference at 16, 24, 32, 48, 64, 80, 96, 112 and 128 px (API only for now). He recommends driving it through the API from Claude Code or Codex. Verified the same day against the [API docs](https://www.spritefusion.com/docs/pixel-art-generator/api/generate-and-transform-images). Style reference lists those nine sizes. Generate and direction-set still take 16, 32 or 64. Edit and animate keep the input sprite's size. For Shadow Jog that means a 48 px battle-scale crew member can be edited into a pose, animated, or used as a style reference for new 48 px characters and enemies, all at the size the side-view spike is testing. Mark wants to explore the API when this pivot comes up. That changes the spike's set-up below: generation would run from a build-time script (like `scripts/pixellab/`), with an API key Mark creates and keeps in the git-ignored `.env.local`. The key never goes into the game bundle or the repo. Decision 4 (whether to buy the month) was answered in practice: Mark subscribed and uses Sprite Fusion.

**Mark's own results, 2026-10-02.** Mark has an account and is generating Shadow Jog sprites himself (kept locally in the git-ignored `spritefusion-tests/`, not committed). What he found:
- **Animate works well for simple loops.** Idle and walk animations come out consistent (Kit's 8-frame battle idle and overworld walk; Rook's battle-stance and relaxed idles).
- **Complex moves work better frame by frame.** For Rook's sword swing, he picks a static pose he likes and uses edit to make each frame by hand (an overhead wind-up and a low follow-through so far), rather than asking animate for the whole move.
- **The 8-direction set is poor.** The directions come out at different scales and details change between them, so he hasn't kept any. That matters less for a side-view battle, which needs one facing. The field needs four facings, so field sprites either stay on the traced art and the code walk (rig v2), or each facing is made separately from a reference and checked for consistency.
- **Sizes he landed on:** about 64 px tall for battle (64x64 cells; Rook 68 px), and 34x34 for the overworld walk.
His sprites face right, so the side-view spike now puts the party on the left facing right (like his reference screenshot 1). In practice this answers the first half of decision 4 (he is using it). Whether Sprite Fusion frames replace code-drawn characters in battle is the art-direction call the plan left to him; the spike's comparison sheets are built to inform it.

- **The maker.** A solo developer (Hugo Duprez). The generator launched in mid-2026, so it is about 3 months old.
- **What it makes.** Sprites at exactly 16, 32 or 64 px, through five operations:
  - *generate*;
  - *edit* (1–9 input images plus text, whole sprite, no mask);
  - *style-reference* (up to 20 images);
  - *direction-set* (exactly 8 directions, no prompt);
  - *animate* (one start image plus a text prompt, 2–16 frames, even numbers).
- **Unverified details.** "8 frames recommended" is unverified. No skeleton or template posing appears in its five operations (inferred).
- **Cost.** 15 credits per action. One action returns 12 generated stills, 2 edits, 8 directions, 9 style-matched stills, or 1 animation. Credits reset monthly with no rollover. Top-ups are confirmed at $5/150, $12/450 and $35/1,500. Plan prices (Starter $9/450, Creator $19/1,050, Pro $49/3,000) come from a search summary only.
- **Integrations.** Generator plugins exist for **Unity and Godot only**. The Phaser integration is for its tilemap editor, not the generator. For us that adds nothing: our maps are code-authored letter grids, not Tiled maps.
- **API.** An HTTP API with streamed events. Its key must never be in the game bundle, so any scripted use is a build-time script.
- **Terms.** Outputs are yours, commercial use is allowed, and outputs made on a paid plan are private. You may not use outputs to train ML models. Nothing found promises they won't train on your inputs (unverified).

### What it fixes and what it doesn't

**What it could fix:**
- **Identity across frames at small sizes.** It animates in one run from one start image.
- **Base drawings code can't make.** New characters and enemies after PixelLab ends.
- **A pose set for a small-sprite battle**, if Pivot 1 goes that way.

**What it doesn't fix:**
- **Today's back view.** It's 64 px at most against 97–109 px backs, so its output could only be references.
- **Posing.** It is text only, so you still direct every pose, the same lesson as PixelLab's inpainting: "kept identity, wrong move".
- **Other asset types.** No tiles, props or portraits.
- **Colours.** Its only colour control is a colour count, so snapping to our palettes is our job.

**A reversal to name plainly.** Using AI pose frames in the game would reverse the 09-30 decision. `docs/PIXELLAB-LESSONS.md` records your bet that code-drawn art would give "consistency PixelLab couldn't give us". It also ranks sources for new characters: the NPC generator first, you drawing second, another generator last. A passing spike puts that choice in front of you. It doesn't make it.

### Possible roles

| Role | Under today's back view | Under a small-sprite battle | Fits "code-drawn over AI" |
|---|---|---|---|
| (a) Base standing frames, traced | Field sprites only | Yes | Yes, like the PixelLab picks |
| (b) Pose references you pick from | Yes, as reference | Yes | Yes |
| (c) Animation frames used in-game | No | Best fit | Only if you decide to reverse 09-30 |
| (d) Enemy redraws | Small enemies only | Yes, ~5 humanoids | Yes, traced |
| (e) None | — | — | Status quo |

### Kept and lost

- **Kept:** effects, GPU layer, FX lab, audio, narrative, environments, the PixelLab tiles and props, and the tracing and review tools.
- **At risk:** style. Every frame must be snapped to the character's existing palette and judged next to code-drawn sprites, or the model's idea of pixel art leaks in.
- **The vendor:** another young company with unpublished rate limits.
- **Lock-in:** low, because we keep and trace the PNGs.

### Effort

- **Importer.** Today `trace.mjs` builds a *new* palette per character, which is wrong for new frames of an existing character. A "snap to this character's palette" step is needed. Naive nearest-colour is 30–80 lines (inferred), but it tends to break outline and shading ramps, so budget for an outline-aware pass plus a small touch-up layer.
- **Test kit.** Field frames must be rendered *with outlines* (the tracer strips them), plus palette PNGs and a prompt sheet.
- **Review page.** `/artreview.html` needs a backdrop and game-speed playback.
- **Totals:** about 2 days of Claude time and **4–6 hours of yours** (inferred), plus a CONCEPTS entry and a Copilot round on the importer PR.

### The spike

- **Setup.** Branch `spike/spritefusion`, criteria in `docs/spikes/spritefusion.md` first. Raw outputs go in git-ignored `media/spritefusion/`, because the repo is public.
- **Budget.** One month (450 credits = 30 actions). No top-ups: running out is a hard stop.
- **Account.** You subscribe and generate in the web app. Nothing of ours touches an API key.

**Phase A, same week as the battle spike (about 10 actions):**
- Kit fighting stance (an edit, with your pose reference as an extra input).
- Kit's punch animated at 32 **and** at 64. These feed the size question.
- Rook edited into a wind-up, then a katana slash animated at 32. This goes on the battle spike's comparison sheet.
- One new character still from text plus style references.

**Phase B, after the size is chosen (about 8 actions):**
- Hex's cast;
- one hurt and one KO;
- Kit's walk compared against rig v2's code walk;
- the punk and the ghoul at the chosen size;
- optionally, one direction set.

**Judging.** The comparison is against **code only**, with no PixelLab arm: PixelLab is ending and its animations were already judged unusable. It isn't blind either, since you'd recognise our code look. You score each clip 1–5 on:
1. identity hold;
2. whether the move reads at 1× and game speed;
3. how well it fits our art after the palette snap;
4. fix time in minutes;
5. whether it fits its canvas and matches field-sprite proportions (PixelLab's ran about 15% tall).

**Outcomes:**
- **PASS:** at least 2 of the 3 attack/cast clips score 4+ on identity and move; at most 1 frame per clip needs more than about 5 pixel fixes; and **one accepted clip works inside the actual battle prototype**, with hit timing, code arcs and GPU effects lined up. A pass puts role (c) on the table for you to decide.
- **PARTIAL:** stills pass but animations drift. Use roles (a), (b) and (d), bought only in months with art work.
- **FAIL:** role (e).
- **Stop early** if Kit's punch and Rook's slash both fail.

### Open risks

- drift on hard poses;
- palette-snap damage;
- vendor maturity;
- unknown training data (a legal unknown, not a known problem).

## How the three fit together

**Update 2026-10-02 evening: the Phaser spike moves up and becomes a tooling spike.** While the side-view spike was running, Mark asked whether, instead of agents iterating on battle layouts by hand, he should get tools to make those design calls himself (like RPG Maker's troop placement view and battle test), and whether moving to Phaser would make building a bespoke "Shadow Jog Engine" toolset easier. The answer was yes for a suite of tools: Phaser keeps a list of on-screen objects with positions and depth and makes them draggable with a setting, so an edit mode can live inside the real battle scene (what you drag is what the game draws); free editors plug in (Tiled maps load natively; Sprite Fusion sheets load as animations); and its animations, tweens, particles and cameras are plain settings objects that tools can write. Building tools on the current immediate-mode engine first would mean building each tool's object layer twice. Mark chose to run the Phaser spike now as a tooling spike: the new side-view battle stage built natively in Phaser 4 with an in-game edit mode (drag heroes and enemies onto depth rows, horizon and floor, HUD layout, battle test), saving to `stages.json`. It answers decision 6 and delivers the first editor in one go. The rest of the game stays on the current engine; porting it is a separate decision for 0.3 or later. Spike doc: `docs/spikes/phaser-stage.md` on branch `spike/phaser-stage`.

**Dependencies:**
- **Pivot 1 multiplies Pivot 3.** Under the back view, Sprite Fusion is an occasional reference tool. At small scale, it could supply the whole pose set.
- **Phaser is neutral on art.** Every art path ends as canvases or PNGs, which become textures in either engine. Pose work is never wasted by the engine choice.
- **The battle rewrite is the overlap.** The 1.2–1.5k lines of battle scene and renderer that Pivot 1 rewrites are exactly what a Phaser port would rewrite anyway. Sequencing exists to avoid writing them twice.

**Sequence:**

| When | Work | Who decides |
|---|---|---|
| Now | Release-prep PR, tag v0.1.0 (go-ahead), bump to 0.2.0-dev. Pause Hex/Sable back-view tuning. Turn off PixelLab auto-renew. | You |
| Week 1 | Battle spike (3 days) **in parallel with** Sprite Fusion Phase A. These two can run alongside each other because Phase A is mostly your evening and the battle spike is mostly Claude's time. | You pick view and size from the comparison sheet |
| Week 2 | Phaser spike (≤4 sessions), with the native slice built on the chosen look. Sprite Fusion Phase B runs alongside. | You pick the engine for the production battle scene |
| Weeks 3–5 (inferred) | Production battle view behind `?battle=side`: pose sets, humanoid enemies, FX anchors, backdrop framing. Then it becomes the default. | You review poses |
| Before 10-30 | Use any PixelLab generations you want to keep (see Decisions). | You |
| End | Your playthrough, then tag v0.2.0 (go-ahead). | You |

**What not to couple:**
- **Don't make Sprite Fusion a precondition for the side view.** The code path has to stand on its own.
- **Don't let the Phaser decision stall the battle work.** If the Phaser spike runs over or is unclear by the end of week 2, build the production scene in the current engine. A sprite list, one texture registry and one draw module become an *acceptance check* on that PR, not a style hint. Whether that makes a later port "nearly mechanical" is (inferred).
- **Don't port the rest of the game inside 0.2.** If Phaser wins, the shell lands as its own PR (no visible change, full E2E green), the battle scene is built natively, and the other scenes convert in 0.3 or later.
- **Don't merge spike branches.**

**Rough contents of v0.2.0** (assuming the battle spike is a GO):
- the version label and changelog;
- the new battle view as the default, with four crew pose sets;
- the humanoid enemies re-scaled;
- FX re-anchored;
- the CONCEPTS additions below;
- `meta.appVersion` and the save message;
- possibly the Phaser shell plus a native battle scene, and the Sprite Fusion importer if that spike passes.

If the battle spike is a NO-GO, 0.2.0 is instead Hex and Sable finished from behind (option C) plus Sprite Fusion for base art, and the back-view rig stays.

## What stays no matter what

| Item from your list | Side-view battle | Phaser | Sprite Fusion |
|---|---|---|---|
| Code-drawn characters as the default | Kept (even less AI) | Kept; canvases become textures | Kept unless you choose role (c) |
| You direct the poses | Kept; step 0 of the spike | Unaffected | Kept; prompts carry your references |
| PixelLab tiles and props | Untouched | Untouched | Untouched (it doesn't make tiles) |
| Style and palettes | Same traced art and palettes | Unchanged | Kept only with palette snapping |
| Story, setting, glossary, Chapter 1 scripts | Untouched | Untouched | Untouched |
| Environments and backdrops | Re-framed, possibly re-baked | Unchanged | Untouched |
| GPU effects and spell signatures | Kept, anchors re-pointed | Overlay kept, or rebuilt as filters | Untouched |
| FX lab and `fx.json` | Small `PANEL_Y` touch | Needs porting; data survives | Untouched |
| Audio (all synthesized) | Untouched | Kept with `noAudio` | Untouched |
| Battle engine, AI, combos, cut-ins, panels, turn strip | Kept; the strip may change sides | Kept (logic is engine-free) | Untouched |
| rigedit, artreview, DEV tab, `?debug` | Editor retargeted; `?art=review` battle role and rigcheck retire | Kept; `__SJ__` re-exposed | artreview extended |
| Saves (v3) | No migration | No migration, same keys | None |
| Unit and E2E tests | Battle E2E specs need fixes | Some E2E specs break and need fixing | New importer tests |
| Kit's finished back-view poses | Preserved in v0.1.0 and behind a flag | Preserved | Preserved |

## Decisions for Mark

**Status on 2026-10-04.** Answered: 1, 2, 3, 4 (in practice), 6, 7, 8 and 11 to 16. **Open: 5 (PixelLab), 9 (GO / NO-GO for the Phaser toolset, due 2026-10-09) and 10 (the fate of PR #3 and the next build steps).**

Decided 2026-10-02: 1 (yes, v0.1.0 then 0.2), 2 (the loop, not the camera), 6 (the Phaser spike runs now as a tooling spike), 3 (run the side-view spike now, comparing field scale with the ~44–48 px battle scale, with Hex/Sable back-view tuning paused) and 7 (yes, correct the docs. Mark: "I'm OK with dependencies as long as they're high quality and free"). Decisions 9 to 16 were added on 2026-10-04 to record calls made during the spikes.

**1. Should today's game be frozen as v0.1.0, with the new phase numbered 0.2?** — **decided 2026-10-02: (a)** The new work changes features, not bugs, so it belongs in 0.2. Freezing means a small PR with a changelog and an in-game version label, then an annotated tag `v0.1.0`, then a GitHub pre-release, then `main` moving to `0.2.0-dev`.
Options: (a) yes: 0.1.0 tag plus 0.2.0 phase; (b) call the next step 0.1.1; (c) no tags yet.
**Recommendation: (a).** Your go-ahead is needed to push the tag and create the Release. **Done 2026-10-03:** tag `v0.1.0` and the GitHub pre-release, on merge commit `81bc0f8`.

**2. What makes Shadow Jog feel like Phantasy Star IV to you: the over-the-shoulder camera, or the loop?** — **decided 2026-10-02: (b), the loop** "The loop" means combos, panels, cut-ins and pacing. If it's the camera, the battle-view spike isn't worth running and we finish Hex and Sable from behind (4–8 days, same churn risk).
Options: (a) the camera, keep the back view; (b) the loop, with any camera.
**Recommendation: (b), the loop.** Let the camera go if the spike passes.

**3. Should the back-view rig work be paused while a 3-day side-view spike runs?** — **decided 2026-10-02: (a), with battle scale (~44–48 px) as the second size** The spike tests field scale (~30 px) against battle scale (~44–48 px, the RPG Maker side-view size) with equal effort, starting with your profile references; hero scale (~55 px) stays a fallback. You choose the size from clips afterwards. Kit's and Rook's finished back-view poses stay in v0.1.0 and behind a flag either way.
Options: (a) pause Hex/Sable tuning and run the spike now; (b) finish the back view first, spike later; (c) don't spike.
**Recommendation: (a).** The back-view code is deleted from `main` only when the new view ships.

**4. Should you buy one month of Sprite Fusion and run the spike this week, and what may its output become?** — **answered in practice 2026-10-02: Mark subscribed and uses it (the first half of the question is yes). The second half is still his call: the spikes use his Sprite Fusion frames as the battle sprites, and the comparison sheets inform whether they replace code-drawn characters in battle. On 2026-10-02 he paused because his lowest credit tier ran low. The next credits go to the shopping list: missing reactions, Hex and Sable moves, side-facing enemies.** About 30 actions on one plan; the $9 Starter price is secondary-sourced. Judging is against our code-drawn art only. Using AI frames as in-game animation would reverse the 09-30 "code over AI" decision.
Options: (a) run it, with outputs limited to base drawings and references unless you later decide otherwise; (b) run it and allow in-game animation frames automatically if it passes; (c) skip it.
**Recommendation: (a).** A pass puts in-game frames on the table for you to decide, not before.

**5. What should happen to PixelLab before it ends around 10-30?** — **OPEN (2026-10-04).** You have about 800 generations left. Spending them on a "Chapter 2 cast" would mean designing that cast in the next four weeks, alongside these pivots, and Chapter 2 is only seeds today.
Options: (a) turn off auto-renew and let it lapse unused; (b) turn off auto-renew and spend it only on tiles, props or portraits for things that already exist; (c) rush Chapter 2 character designs to use it.
**Recommendation: (b).** Check that access continues to the end of the period after you cancel (unverified).

**6. Should a short Phaser spike run once the battle look is chosen, before the new battle scene is written for real?** — **decided 2026-10-02: yes, now, as a tooling spike (see the update below)** It runs the current game inside Phaser (2 sessions maximum), then rebuilds the spike's strike scene in proper Phaser style so you can compare the code and decide which engine to build in. If it's unclear by the end of week 2, the battle scene gets built in the current engine with a port-ready structure.
Options: (a) yes, then; (b) only after 0.2 ships; (c) never.
**Recommendation: (a).** Porting the rest of the game would be 0.3 or later in any case.

**7. Should the "zero runtime dependencies" rule be removed from the project docs?** — **decided 2026-10-02: (a)** You never set it. `ARCHITECTURE.md:15` and `CLAUDE.md:4` stated it. Both docs were corrected on 2026-10-02 and now say high-quality, free dependencies are fine. The bundle budget became an alarm that is re-set on purpose, with the real player download in mind; Phaser would take the game from about 233 kB to about 420–500 kB gzip.
Options: (a) correct both docs now; (b) leave them until a dependency actually lands.
**Recommendation: (a).**

**8. If the side view goes ahead, what happens to the enemies?** — **answered 2026-10-02: keep today's enemies in the spike and re-art them later. New side-facing humanoid enemies go on the Sprite Fusion shopping list.** On 2026-10-03 the Phaser spike also made every enemy face the heroes by mirroring five sprites (see decision 13). Creatures and bosses look fine large. Human-sized regulars (punk, medic, slinger, sentinel, arcanist, and possibly ghoul and shade) would tower over a 30 px party.
Options: (a) keep creatures and bosses large, re-art the humanoid regulars to party scale; (b) re-scale all 21; (c) keep everything as-is.
**Recommendation: (a)**, the Final Fantasy VI approach, which also makes bosses more of a spectacle. Knuckles can stay big on the `brute` sprite. Decide this after the spike's scale check.

**9. Is the Phaser tooling spike a GO or a NO-GO? (added 2026-10-04)** — **OPEN. Due 2026-10-09 (the time box).** The test that decides is Mark's: open `/stageedit.html`, change a stage, save and run a Battle Test in under one minute (steps in the spike doc's "Try it", on branch `spike/phaser-stage`). All the exit criteria that agents can check hold. The CI fix is `8ad78bf` ([PR #4](https://github.com/markhazlewood42/shadow-jog/pull/4), draft, never merged).
Options: (a) GO for the toolset: build the next tools (the troop editor, then the Animation Composer) on this editor shell, and do not port the shipped game. (b) NO-GO: archive the spike (tag `archive/phaser-stage-YYYY-MM-DD`, close the PR, delete the branch). (c) GO and also plan a port of the shipped game (the agents do not recommend this on this evidence).
**Recommendation: (a).**

**10. What happens to the side-view spike ([PR #3](https://github.com/markhazlewood42/shadow-jog/pull/3)), and what are the next build steps of phase 0.2? (added 2026-10-04)** — **The pivot is decided 2026-10-04: GO. The side-on view is the game's battle view.** Mark called it from the work he saw, not from the formal clip comparison. The size is his Sprite Fusion crew at about 64 px, larger than both sizes the spike tested (this also answers the size part of decision 3). The spike doc's "Result" section records the call (commit `12a00e4` on `spike/side-battle`). **Still open: the next build steps, after decision 9.** PR #3 is a draft with merge conflicts with `main`. It is left alone on purpose. The 3/4 arena stage and side-view HUD it chose were rebuilt in the Phaser spike.
Options: (a) record the result, tag `archive/side-battle-YYYY-MM-DD`, close the PR and delete the branch. (b) keep it open as a reference until the Phaser decision (9) is made. (c) rebase it.
**Mark's choice (2026-10-04): (b) until decision 9, then (a).** Decide the next build steps (the production battle view behind `?battle=side`, the poses, the humanoid enemies) after decision 9.

**11. Where does the battle HUD live? (added 2026-10-04)** — **decided 2026-10-03: global.** One layout in `src/data/hud.json`. A stage may override single boxes. It is not a copy of the HUD on each stage. The "scope rule" (decision 15) follows from this.

**12. What happens when a stage breaks a design rule? (added 2026-10-04)** — **decided 2026-10-03: a live warning, never a block.** The editor shows a "Warnings (n)" chip and red outlines. A save always works. The laptop zoom stays as it is (1x on narrow windows, with the "Press P" hint).

**13. Which way do enemies face, and how do the spacing rules measure them? (added 2026-10-04)** — **decided 2026-10-03: enemies face the heroes, and the rules measure the full drawn outline, weapons included.** `src/data/enemyfacing.json` mirrors the punk, ghoul, maint, shade and sentinel. The enemy slots were nudged to obey the rules. Warnings went from 20 to 2 (the Warden boss groups).

**14. How do the heroes get their body proportions? (added 2026-10-04)** — **decided 2026-10-03: a global setting per hero, "method B".** `src/data/heroes.json` holds a height and a build for each hero. Whole rows and columns are added or removed inside the body, baked when the textures are built. The head and the feet stay. Kit and Rook are human, Hex is a dwarf (shorter, stouter), Sable is an orc (taller, at least as broad as the humans). (Mark said "ogre". The canon word in `docs/GLOSSARY.md` is orc.) Mark's values from his own editor pass (commit `a5a3f73`, 2026-10-03): Kit 1.11 and 1.00, Rook 1.07 and 1.08, Hex 0.85 and 1.00, Sable 1.34 and 1.18 (height and build). Rook's sprite is drawn taller (68 px against 63 px for Kit), so he still comes out taller than Kit.

**15. What may a stage hold? (added 2026-10-04)** — **decided 2026-10-03 (the scope rule): a stage holds only its own layout** (backdrop, floor, rows, and hero and enemy positions). A setting that belongs to a character or to the whole game is a global file, edited under an "all battles" label: `hud.json` (a stage can override it), `enemyfacing.json` and `heroes.json` (no stage override).

**16. Pronouns, and how versions and releases are handled (added 2026-10-04)** — **decided 2026-10-03 and 2026-10-04.**
- **Pronoun canon** (Mark decided on 2026-10-03. [PR #6](https://github.com/markhazlewood42/shadow-jog/pull/6) merged on 2026-10-04 (UTC)): Kit she/her, Rook he/him, Hex they/them, Sable he/him. Kit and Rook are human, Hex is a dwarf, Sable is an orc (Mark said "ogre". The canon word in `docs/GLOSSARY.md` is orc.) `docs/GLOSSARY.md` records it. An old save gets Hex's new objective wording when it loads.
- **Versioning:** saves record `meta.appVersion`, and a slot saved by a newer version says so ([PR #5](https://github.com/markhazlewood42/shadow-jog/pull/5), merged 2026-10-03). `main` is `0.2.0-dev`.
- **Process:** `main` is protected by a ruleset. It requires a pull request and a passing `check` job. It blocks deletion and force-push. Mark is new to GitHub release management and asked to be taught as we go. `docs/DEVELOPING.md` section 9 holds the how-to.

## New concepts for CONCEPTS.md

Skipped because `docs/CONCEPTS.md` already has them: hitstop, sprite sheet, camera views, back-view battle, key poses, smear frames, tracing, colour quantization, palette swap, style reference, pixel density, procedural art, idle animation, combos, post-processing, bloom, frame budget, software vs hardware rendering. The first entry below adds the *battle* sense of side vs 3/4 next to the existing "Camera views" entry.

- **Side-view and 3/4 battles.** In a side-view battle, the party and enemies face each other across the screen in profile (Final Fantasy IV–VI). A 3/4 battle tilts that so you see a little of the top and front, usually with the party on a diagonal (Sea of Stars). Both keep a swing flat on the screen, unlike a back view, where it reaches into the screen. *Here:* the Pivot 1 spike, behind `?battle=side`.
- **Battle sprite vs field sprite.** The drawing used in fights versus the one used walking around. FF6 uses different, bigger art for battle. Chrono Trigger reuses the field sprite plus extra poses. "Field scale" and "hero scale" are names for those two choices. *Here:* today the battle backs are ~3.5× the field sprites; field scale would reuse the traced `left`/`right` frames.
- **Pose set.** The full list of stances a fighter needs: ready, wind-up, strike, cast, item, hurt, defend, kneel, KO, victory, run. Poses are held, and code moves the character between them. Smaller sprites don't shrink the list. *Here:* about 10–12 per crew member.
- **Silhouette readability.** Whether a pose can be recognised from its outline alone, filled solid black. It matters more as sprites shrink, which is why weapons and limbs get exaggerated. *Here:* the spike's readability check for fists, katana, pistol and staff.
- **Identity drift.** An AI tool changing a character between frames: hair, clothes or body shape shifting. It is why PixelLab's animations failed review. *Here:* the first thing the Sprite Fusion spike scores.
- **Palette snapping.** Recolouring new art to an existing palette by swapping each pixel for the nearest allowed colour. Done naively it breaks outlines and shading ramps, so good versions respect them. *Here:* the importer step needed before any generated frame joins a traced character.
- **Immediate vs retained mode rendering.** Immediate mode redraws everything from code every frame ("draw this rectangle now"). Retained mode keeps a list of objects (sprites with positions) that the engine draws for you. *Here:* our scenes are immediate (`render(ctx)`); Phaser is retained.
- **Game engine vs framework.** An engine (Unity, Godot) is a full program with an editor, its own tools and its own build. A framework (Phaser) is a code library you call from your own program. *Here:* Phaser would replace our hand-written loop, scenes and input, not our tools.
- **Scene manager.** The part of an engine that runs screens (title, field, battle, menu), switches between them and stacks them. *Here:* our `game.run(scene)` returns a promise that story scripts `await`; Phaser's manager doesn't, so a port needs an adapter.
- **Texture, texture atlas and runtime textures.** A texture is an image loaded onto the GPU. An atlas packs many frames into one texture so the GPU switches less often. Runtime textures are drawn by code while the game runs instead of loaded from files. *Here:* every cached sprite canvas could become a Phaser runtime texture.
- **Render filter (shader effect).** A small GPU program that changes an image as it's drawn: glow, blur, colour shifts. It can apply to one object or the whole camera. *Here:* our presenter's bloom and shockwaves are hand-written filters; Phaser 4 ships some, and they need WebGL.
- **WebGL context loss.** The browser can take the GPU away from a page (driver reset, too many tabs), and everything on the GPU must be rebuilt afterwards. *Here:* a Phaser gotcha (`DynamicTexture` comes back blank).
- **Fixed timestep.** Running game logic in equal 1/60-second steps however fast the screen draws, catching up with an accumulator. It keeps frame-counted moves and tests deterministic. *Here:* `main.ts`; Phaser has no built-in fixed step, so the accumulator would move inside its `update`.
- **Tween.** Code that moves a value smoothly from A to B over time ("in-between"). Engines measure tweens in milliseconds. *Here:* our battle choreography counts frames instead, and should keep doing so.
- **Download size budget and tree-shaking.** A budget is a size alarm for what players download. Tree-shaking removes unused library code at build time. Phaser doesn't tree-shake well, so the usual route is a hand-picked "core" build. *Here:* `scripts/bundle-budget.mjs`, now treated as an alarm to re-set deliberately.
- **Semantic versioning.** MAJOR.MINOR.PATCH. While MAJOR is 0, anything may change, MINOR marks each meaningful step and PATCH marks fixes. A suffix like `-dev` marks an unreleased build, and `+abc1234` is build information. *Here:* v0.1.0 now, 0.2.0 for this phase.
- **Changelog.** A hand-written, human-readable list of what changed in each release, newest first. *Here:* `CHANGELOG.md` in Keep a Changelog format.
- **Release tag and GitHub Release.** A tag is a named, permanent pointer to one commit. An "annotated" tag also records who made it, when and why. A GitHub Release adds notes and downloads on top of a tag. *Here:* `v*` for releases, `snapshot/*` for checkpoints, `archive/*` for dropped spikes.
- **Spike.** A short, time-boxed experiment that answers one question, with its success criteria written before it starts. The code is thrown away and the answer is kept. *Here:* `spike/side-battle`, `spike/spritefusion`, `spike/phaser`, each with a page in `docs/spikes/`.
- **Feature flag.** A switch that turns unfinished work on only for whoever asks, so it can live on `main` without changing the game for everyone. *Here:* `?battle=side`, in the style of `?scene=fxlab`.
- **Save migration.** Code that upgrades an old save to the current format, one version step at a time, so players never lose progress. *Here:* `SAVE_VERSION` 3 with the `MIGRATIONS` chain in `src/game/save.ts`; none of the three pivots needs one.