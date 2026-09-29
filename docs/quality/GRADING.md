---
type: process
title: Shadow Jog — How the Alpha Was Graded
project: shadow-jog
created: 2026-09-29
updated: 2026-09-29
tags: [quality, verification, grading, review]
---

# How the alpha was graded

> **For Mark's review.** This is everything about how Shadow Jog's quality was scored: where the process came from,
> what the reviewers were told and shown, what they compared against, the full score history, what the grading got
> wrong, and the exit criteria set on 2026-09-29. The rubric itself is `docs/quality/rubric.md`; the running scores
> are `docs/quality/scorecard.md`; each round's reviewer notes are in `docs/quality/reviews/`.

---

## 1. Where it came from

The original prompt (`docs/original-prompt.md`) asked for the work to be scored "out of 10" per part, iterated "until
it's 8.5+", with "independent verification sub-agents", screenshots, saved status and sensible commits. So from day
one the process was:

1. Split the game into **11 areas** (below), each with a written bar for 8.5 and an automatic cap for a disqualifying
   flaw.
2. After each batch of work, **regenerate the evidence** (screenshots, test logs, measurements).
3. Send **one fresh reviewer per area** to read the evidence and the code and score it.
4. Fix what they found, most severe first, and go again.

The rubric set a cap of 4 rounds per area. Mark lifted it on 2026-09-28 ("don't stop for my approval for future
rounds"), which is why it ran to 12. Mark set an exit on 2026-09-29 (section 9).

---

## 2. Who grades, and how

**The writer** (the main Claude session, Opus) built the game and made the fixes. It never scored its own work.

**The reviewers** were fresh subagents, model **Sonnet**, launched cold for each area in each round: 11 per round.
Each one:

- got **only its prompt**: no conversation history, no memory of earlier rounds, no view of the writer's intent beyond
  the GDD;
- was told the review is **read-only** (no edits, no git changes);
- read the GDD, **opened every listed screenshot**, read the listed source files and evidence logs, and could explore
  the repo further on its own;
- returned a fixed format: a score to one decimal, PASS/ITERATE, up to 8 top issues citing a screenshot or
  `file:line`, up to 3 strengths, and a paragraph on what would move it +1.

**Important: the reviewers never played the game.** They judged screenshots captured by a script, code, test output
and measurements. Anything the evidence didn't show (the feel of a 45-minute session, pacing between beats, how a
song sits after the tenth loop) was judged by inference from code, or not at all. Your playthrough is the first
real play test.

**Scores are one reviewer's opinion.** There was no averaging, no second reviewer, and no calibration between rounds
(section 7 covers what that did to the numbers).

---

## 3. The rubric

The bar is an **indie alpha**: "a stranger could play it start to finish, understand it without the developer present,
and come away wanting more. Placeholder-feeling art, unreadable text, softlocks and 'programmer UI' all fail."
An area passes at **8.5**.

| # | Area | What 8.5 means | Automatic cap |
|---|---|---|---|
| 1 | Engine & code | Clean module boundaries, strict TS, no per-frame allocs in hot paths, 60fps, logic unit-tested | ≤6 if the build or tests fail |
| 2 | Field art | Cohesive palette, readable tiles, lighting sells the mood, characters have personality | ≤6 if any tile/sprite reads as a debug placeholder |
| 3 | Battle presentation | Enemies are distinct and readable, backgrounds set place, and FX sell every hit and spell | ≤6 if actions lack visual feedback |
| 4 | UI / UX | Crisp font, consistent windows, clear focus/cursor, no clipped text, every async/empty state handled | ≤6 if any text overflows its box |
| 5 | Combat design | Meaningful choices each round, visible weaknesses, combos discoverable, no dominant spam strategy | ≤6 if one command wins every fight |
| 6 | Progression & economy | Steady power curve, shopping decisions matter, grinding optional (<10% of playtime) | ≤6 if the story path requires grinding |
| 7 | Narrative & writing | Distinct voices, economical dialogue, stakes clear, ending lands, no typos | ≤6 if the motivation is unclear at any beat |
| 8 | Level design | Readable navigation, landmarks, secrets reward curiosity, dungeon has a shape and a climax | ≤6 if the player can get lost with no signposting |
| 9 | Audio | Tracks fit each context, loop cleanly, mix balanced; SFX on every interaction | ≤6 if music is atonal/grating |
| 10 | Feel & polish | Transitions, screen shake, text speed, input latency and juice are all intentional | ≤6 if input feels laggy |
| 11 | Stability | Save/load round-trips, no softlocks, E2E happy path passes | ≤5 if any softlock is found |

The caps did their job twice: in round 9, UI/UX was capped at 5.5 for a turn-order strip drawn over a description
(clipped text), and Field art at 5.8 for a boss-arena floor that read as a debug test pattern. Both were fixed the
next round.

---

## 4. The prompt every reviewer got (verbatim)

Filled in per area with its name, bar, cap, and the lists in section 5. A preamble line set the working directory and
said "Read-only review: do not edit any files."

```
You are an independent reviewer grading one area of an indie JRPG alpha called SHADOW JOG.
You did not write this work and you owe the writer nothing. Your job is to find what is wrong.

Area: {AREA_NAME}
What 8.5/10 means for this area: {AREA_BAR}
Automatic cap: {AREA_CAP}

Read docs/GDD.md for intent. Then inspect the evidence:
- Screenshots (open every one with the Read tool): {SCREENSHOT_PATHS}
- Source files relevant to this area: {FILE_PATHS}
- Test output (if any): {TEST_OUTPUT_PATH}

Score strictly against commercial indie standards, not "impressive for AI" or "good for a prototype".
Compare against the reference points: Phantasy Star IV (1993), Chrono Trigger (1995), Sea of Stars (2023), CrossCode (2018).

Return exactly this format:
SCORE: <number with one decimal>/10
VERDICT: PASS (>=8.5) | ITERATE (<8.5)
TOP ISSUES (most severe first, max 8, each one concrete and actionable, citing a screenshot or file:line):
1. ...
STRENGTHS (max 3, one line each):
- ...
WHAT WOULD MOVE THIS +1 POINT: <one paragraph>
```

---

## 5. What each reviewer was shown (round 12)

The lists grew each round as new evidence was added (new screenshots for new features, new measurement files). The
reviewers could also open anything else in the repo.

### The evidence files

| File | What it is | How it's made |
|---|---|---|
| `docs/screenshots/*.png` | ~50 fixed game states (menus, battles, maps, story beats, contact sheets of sprites) | `e2e/shots.spec.ts` drives the game through its debug hook to each state and screenshots the canvas |
| `docs/screenshots/maps/*.png` | Every map rendered whole | a dev route that draws the full map |
| `unit-tests.txt` | The full unit suite, including the balance and economy simulations' printed tables | `npx vitest run` |
| `typecheck.txt`, `lint.txt` | TypeScript strict and Biome results | `tsc --noEmit`, `biome lint` |
| `e2e-playthrough.txt` | End-to-end runs: the full chapter driven through the real scripts, the real-speed playtest, game over, save/load, tabs, chaos input, the shipped build | Playwright |
| `perf.txt` | Frame time (mean, p95) in the busiest field scene and a live battle, on a GPU canvas and a software one, plus input latency | `e2e/perf.spec.ts` |
| `audio.txt` | Every song rendered offline: peak, loudness, in-song range, and share of energy per frequency band; every sound effect's level | `e2e/audio-evidence.spec.ts` |
| `audio-loops.txt` | Every loop seam rendered and measured against the song's own bar-line changes | same |
| `audio/*.png` | A spectrogram per song | same |
| `ci-engines.txt` | The latest green GitHub Actions run: every E2E test, with WebKit and Firefox on the save, game-over and shipped-build flows | copied from CI |
| `bundle.txt` | Shipped JavaScript size against its budget | `npm run build && node scripts/bundle-budget.mjs` |
| `ending-results.txt` | What the two results-screen captures are (a preset stage, and a driven test run) | written by hand |

### Per area

### 1. Engine & code

- **Screenshots:** 11-battle-command.png, 13-battle-action.png, 04-lantern-row-street.png
- **Source files:** src/engine/*.ts, src/main.ts, src/boot.ts, src/devroutes.ts, src/game/debug.ts, src/scenes/battle.ts, src/scenes/battlekit/*.ts (render.ts: the renderer split out of the scene; timing.ts; geom.ts), src/field/lighting.ts, e2e/perf.spec.ts, tests/orders.test.ts, tests/content.test.ts, tests/playback.test.ts, tests/glyphs.test.ts, tests/timing.test.ts, scripts/bundle-budget.mjs, src/scenes/field.ts, src/field/weather.ts, src/field/lighting.ts, src/battle/engine.ts, src/game/save.ts, tsconfig.json, biome.json, .github/workflows/ci.yml, tests/*.ts, src/scenes/fieldkit/*.ts (the field scene split), src/engine/shake.ts, src/scenes/battlekit/motion.ts, tests/atmosphere.test.ts, tests/motion.test.ts, src/engine/assert.ts, src/game/systems.ts (loadBattle: the battle chunk)
- **Evidence files:** docs/quality/evidence/unit-tests.txt, docs/quality/evidence/typecheck.txt, docs/quality/evidence/lint.txt, docs/quality/evidence/perf.txt, docs/quality/evidence/bundle.txt

### 2. Field art

- **Screenshots:** 04-lantern-row-street.png, 05-lantern-row-plaza.png, 06-bar-dialog.png, 18-sinkline.png, 19-world.png, 20-rustyard.png, 21-annex.png, 27-annex-lattice.png, 29-annex-crawlspace.png, 30-sinkline-intake.png, 31-world-radio-lot.png, progress-01-cast-sprites.png, 32-crowd-sprites.png, 37-annex-cryopod.png, 37b-annex-cryopod-empty.png, 18b-sinkline-intakes.png, maps/lantern_row.png, maps/bar.png, maps/world.png, maps/rustyard.png, maps/sinkline_1.png, maps/annex.png, maps/dock.png
- **Source files:** src/art/chars.ts, src/data/looks.ts, src/field/tiles.ts, src/field/props.ts, src/field/buildings.ts, src/field/lighting.ts, src/field/weather.ts, src/data/maps/interiors.ts (bar), src/data/maps/lantern_row.ts (plaza), src/data/maps/sinkline.ts, src/data/maps/annex.ts, src/data/maps/world.ts, src/scenes/field.ts (drawShell: interiors in their building)
- **Evidence files:** none

### 3. Battle presentation

- **Screenshots:** 11-battle-command.png, 12-battle-techs.png, 13-battle-action.png, 14-battle-combo-hint.png, 15-battle-combo.png, 16-battle-warden.png, 17-battle-lurker.png, 22-battle-victory.png, 38-battle-rat-pack.png, 38b-battle-hound-pack.png, 15b-battle-triple-combo.png, 16b-enemy-poses.png, 16c-boss-poses.png, 13b-swing-gather.png, 13b-swing-raise.png, 13b-swing-cut.png, 13b-swing-settle.png
- **Source files:** src/scenes/battle.ts, src/scenes/battlekit/*.ts, src/battle/fx.ts, src/art/enemies.ts, src/art/battlers.ts, src/art/battlebg.ts, src/art/portraits.ts
- **Evidence files:** none

### 4. UI / UX

- **Screenshots:** 01-title.png, 03-dialog-portrait.png, 06-bar-dialog.png, 07-menu.png, 08-menu-status.png, 09-menu-equip.png, 10-shop.png, 12-battle-techs.png, 14-battle-combo-hint.png, 10b-shop-sell.png, 24-ending-results.png, 25-ending-next.png, 26-menu-bestiary.png, 33-menu-places.png, 33b-menu-place-map.png, 34-game-over.png, 35-options.png, 36-controls.png
- **Source files:** src/ui/*.ts, src/engine/font.ts, src/scenes/menu.ts, src/scenes/placemap.ts, tests/layout.test.ts, src/scenes/shop.ts, src/scenes/saveload.ts, src/scenes/options.ts, src/scenes/dialog.ts, src/scenes/title.ts, src/scenes/controls.ts, src/scenes/gameover.ts, src/scenes/battlekit/render.ts (renderPanel, renderTargetInfo, renderOrder, menus), src/scenes/field.ts (drawShell), src/engine/display.ts (scaling), tests/glyphs.test.ts, src/main.ts (notice overlay), tests/ui-list.test.ts, tests/game.test.ts
- **Evidence files:** docs/quality/evidence/unit-tests.txt

### 5. Combat design

- **Screenshots:** 11-battle-command.png, 12-battle-techs.png, 13-battle-action.png, 14-battle-combo-hint.png, 15-battle-combo.png, 16-battle-warden.png, 17-battle-lurker.png, 26-menu-bestiary.png, 15b-battle-triple-combo.png
- **Source files:** src/battle/engine.ts, src/battle/ai.ts, src/battle/types.ts, src/data/abilities.ts, src/data/enemies.ts, src/scenes/battle.ts, src/scenes/battlekit/timing.ts, src/scenes/battlekit/playback.ts, src/game/settings.ts, tests/timing.test.ts, tests/balance.test.ts, tests/sim.ts, tests/stages.ts, tests/battle.test.ts, tests/auto.test.ts
- **Evidence files:** docs/quality/evidence/unit-tests.txt

### 6. Progression & economy

- **Screenshots:** 09-menu-equip.png, 10-shop.png, 10b-shop-sell.png, 24-ending-results.png, 24c-ending-results-driven-test-run.png
- **Source files:** src/data/items.ts, src/data/shops.ts, src/data/enemies.ts (xp/cred), src/data/maps/*.ts (chests), src/game/stages.ts, src/game/party.ts (rest, innPrice), src/game/systems.ts (inn, clinic), src/scenes/shop.ts (prices, discounts), src/story/chapter1.ts (magsReward: the collection fork), src/data/maps/rustyard.ts, tests/economy.test.ts, tests/economy.ts, tests/route.ts, tests/pacing.test.ts, tests/stages.ts, tests/balance.test.ts, e2e/economy.spec.ts
- **Evidence files:** docs/quality/evidence/unit-tests.txt, docs/quality/evidence/e2e-playthrough.txt

### 7. Narrative & writing

- **Screenshots:** 02-intro-panels.png, 03-dialog-portrait.png, 06-bar-dialog.png, 23-ending-panels.png, 23b-ending-finale.png, 24-ending-results.png, 25-ending-next.png, 15b-battle-triple-combo.png
- **Source files:** docs/GDD.md (glossary), src/story/chapter1.ts, src/scenes/panels.ts, src/scenes/ending.ts, src/data/maps/*.ts (NPC and event dialogue), src/data/items.ts and src/data/enemies.ts (descriptions, lore), src/data/speakers.ts
- **Evidence files:** none

### 8. Level design

- **Screenshots:** 04-lantern-row-street.png, 05-lantern-row-plaza.png, 18-sinkline.png, 19-world.png, 20-rustyard.png, 21-annex.png, 27-annex-lattice.png, 28-annex-panel.png, 29-annex-crawlspace.png, 30-sinkline-intake.png, 31-world-radio-lot.png, 33-menu-places.png, 33b-menu-place-map.png, 37-annex-cryopod.png, 37b-annex-cryopod-empty.png, 18b-sinkline-intakes.png, 18c-sinkline-lure.png, maps/lantern_row.png, maps/bar.png, maps/world.png, maps/rustyard.png, maps/sinkline_1.png, maps/annex.png, maps/dock.png
- **Source files:** src/data/maps/*.ts, src/field/props.ts (valve, loom, lure), src/story/chapter1.ts (puzzles: pumpValve, floodgate, relay, lattice, latticeEmitters), tests/maps.test.ts, tests/mapgraph.ts
- **Evidence files:** docs/quality/evidence/unit-tests.txt

### 9. Audio

- **Screenshots:** docs/quality/evidence/audio/*.png (one spectrogram per song, rendered offline through the game mix; open a few)
- **Source files:** src/audio/engine.ts, src/audio/music.ts, src/audio/songs.ts, src/audio/sfx.ts, tests/music.test.ts, src/scenes/dialog.ts (ducking), src/scenes/options.ts (volume preview), src/scenes/field.ts (placeMusic), src/data/maps/annex.ts (dock space), e2e/audio-evidence.spec.ts
- **Evidence files:** docs/quality/evidence/audio.txt (levels, loudness range, band balance, SFX levels from offline renders), docs/quality/evidence/audio-loops.txt (every loop seam rendered and measured), docs/quality/evidence/unit-tests.txt

### 10. Feel & polish

- **Screenshots:** 02-intro-panels.png, 03-dialog-portrait.png, 13-battle-action.png, 15-battle-combo.png, 22-battle-victory.png, 23b-ending-finale.png, 34-game-over.png, 13b-swing-gather.png, 13b-swing-raise.png, 13b-swing-cut.png, 13b-swing-settle.png, 15b-battle-triple-combo.png
- **Source files:** src/scenes/battle.ts, src/scenes/battlekit/*.ts, src/battle/fx.ts, src/scenes/gameover.ts, e2e/perf.spec.ts (input latency), src/scenes/dialog.ts, src/scenes/panels.ts, src/scenes/field.ts, src/engine/game.ts, src/engine/input.ts, src/game/settings.ts, src/scenes/options.ts, src/field/weather.ts, src/field/actor.ts, src/ui/list.ts, src/engine/shake.ts, src/scenes/battlekit/motion.ts, tests/motion.test.ts
- **Evidence files:** docs/quality/evidence/perf.txt, docs/quality/evidence/e2e-playthrough.txt

### 11. Stability

- **Screenshots:** none (judge from code and test output)
- **Source files:** index.html (the pre-start error screen), src/main.ts, src/engine/game.ts, src/engine/errors.ts, src/boot.ts, src/game/save.ts, src/game/systems.ts, src/scenes/saveload.ts, src/scenes/title.ts, e2e/*.spec.ts, e2e/route.ts, tests/save.test.ts, tests/game.test.ts, tests/maps.test.ts, e2e/prod.spec.ts, e2e/economy.spec.ts, e2e/chaos.spec.ts, tests/fixtures/save-v1-annex.json, src/audio/engine.ts (navigation-safe audio), playwright.config.ts, .github/workflows/ci.yml
- **Evidence files:** docs/quality/evidence/e2e-playthrough.txt, docs/quality/evidence/unit-tests.txt, docs/quality/evidence/ci-engines.txt (a CI run: every E2E test, with WebKit and Firefox on the save, game-over and shipped-build flows)

---

## 6. The reference games, and grading generated work against them

The prompt names four references: **Phantasy Star IV** (1993; the game loop Shadow Jog follows), **Chrono Trigger**
(1995; the high-water mark for 16-bit JRPG presentation, music and pacing), **Sea of Stars** (2023; a modern
pixel-art JRPG, hand-animated, with a live composer), and **CrossCode** (2018; a modern indie action RPG known for
puzzles, level design and crisp tiles).

Reviewers were told to score "strictly against commercial indie standards, not 'impressive for AI' or 'good for a
prototype'." They did. That has consequences you should weigh when you read the scores:

- **Everything in Shadow Jog is generated by code.** Every sprite is drawn from letter grids and shape routines,
  every tile is a procedural painter, and every song is a compact score played by a synthesizer written for the game.
  The references were made by teams of artists, animators and composers.
- **Areas that depend on hand-made craft plateaued.** Audio has sat between 6.5 and 7.8 for 12 rounds, and Battle
  presentation between 6.5 and 7.6. Each round's fixes were real (measured: brighter mix, cleaner loops, more
  animation frames), but the reviewers' remaining issues drifted towards things like "expressive portraits",
  "per-weapon animation", or "memorable melodies". Those are craft problems more than bugs, and a hand-made game at
  that level has them solved by people.
- **Areas that depend on systems and rigour did well.** Stability, UI/UX and Engine reached 8.5+. Their bars are
  things code can meet completely: no softlocks, text fits its box, tests pass, allocations stay out of hot paths.
- **The comparison still did useful work.** It pushed the art and audio well past "programmer art" (a round-1
  reviewer scored progression 3.5 and field art 5.5), and it produced concrete, fixable issues every round.

A question for your review: should generated assets be graded against these four, or against a bar that separates
"is this finished and coherent" from "is this as crafted as Chrono Trigger"? The answer decides whether 8.5 in Audio
and Battle presentation is reachable by iteration or needs hand-made assets.

---

## 7. What the grading got wrong, or couldn't see

- **One reviewer per area, with no memory.** Each round's reviewer brought their own emphasis, so an area could move
  by up to a point with little change to the work. Examples:
  - Audio dropped 0.5 in round 2 because that reviewer judged mix and timbre, which round 1's hadn't weighed.
  - Engine dropped 8.5 to 8.3 in round 11 because that reviewer counted non-null assertions; no earlier one had.
  - Combat went 8.1 to 7.2 in round 9 as the reviewer judged the new timed-press system harder than the old one.
- **Noise about the size of the gains.** From round 4 on, the average moved within about ±0.3 each round, while the
  typical round's genuine improvement was worth +0.1 to +0.3. Round-to-round movement in one area mostly can't be
  told apart from reviewer variance. The multi-round trend is the reliable signal (section 8).
- **Moving targets.** A reviewer's top issues were fixed; the next reviewer listed different ones. That's the process
  working as intended (each fix is real), but it means a score can stay flat while real problems get fixed.
- **Nobody played it.** Reviewers read screenshots staged by a script. They could catch a clipped word or a muddy
  palette, but not boredom, confusion over 20 minutes, or a fight that's tedious the fifth time.
- **Reviewers were sometimes wrong.** Round 1's economy reviewer missed the job board entirely (and scored 3.5).
  Round 11's progression reviewer said the results screenshot was mislabelled; it was labelled, in a text file they
  may not have read (it was renamed anyway, to be unmissable). Round 12's battle-presentation reviewer said Rook's
  body "does not shift one pixel" across the four swing shots; a pixel diff shows it moves 15 px
  (`reviews/round-12.md`, "Checked after the reports came in").
- **The writer chose what to show.** The screenshot list and evidence files were chosen by the writer. Reviewers
  could explore further, and often did, but the staged evidence set the agenda.

---

## 8. Score history

Every area's score in every round, from the scorecard's history (round 6's Stability passed at 8.7 and was not
re-reviewed that round).

| Area | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | R11 | R12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Engine & code | 6.5 | 7.2 | 7.5 | 7.7 | 8.2 | 7.7 | 7.6 | 7.7 | 8.0 | **8.5** | 8.3 | 8.2 |
| Field art | 5.5 | 7.0 | 7.4 | 7.0 | 6.5 | 7.2 | 7.3 | 7.6 | 5.8* | 7.0 | 7.5 | 7.8 |
| Battle presentation | 6.5 | 7.0 | 7.0 | 7.3 | 7.2 | 7.6 | 7.0 | 7.2 | 7.2 | 7.0 | 6.5 | 7.3 |
| UI / UX | 6.0 | 6.0 | 8.2 | 8.3 | 6.0 | 8.0 | 7.2 | 7.8 | 5.5* | 7.6 | **8.7** | 8.2 |
| Combat design | 7.0 | 7.0 | 7.0 | 7.8 | 6.8 | 7.5 | 8.1 | 8.1 | 7.2 | 7.5 | 7.8 | 8.0 |
| Progression & economy | 3.5 | 7.3 | 6.5 | 6.5 | 7.2 | 8.1 | 7.8 | 7.5 | 7.5 | 8.0 | 7.6 | 7.6 |
| Narrative & writing | 7.6 | 7.8 | 8.0 | 7.5 | 8.0 | 8.0 | 7.4 | 7.6 | 7.8 | 8.0 | 7.8 | 8.2 |
| Level design | 7.2 | 7.3 | 7.3 | 7.6 | 7.0 | 7.2 | 7.0 | 7.2 | 7.4 | 7.7 | 7.8 | 7.8 |
| Audio | 7.0 | 6.5 | 7.2 | 7.0 | 7.8 | 7.2 | 6.5 | 7.2 | 7.0 | 7.2 | 7.2 | 7.8 |
| Feel & polish | 7.2 | 7.4 | 7.5 | 7.8 | 7.2 | 7.0 | 7.5 | 7.4 | 8.3 | 7.8 | 8.4 | 8.3 |
| Stability | 6.0 | 8.0 | 7.3 | 8.0 | 8.2 | **8.7** | 7.5 | 8.0 | 8.3 | **8.8** | **9.0** | **8.6** |
| **Average** | 6.36 | 7.14 | 7.35 | 7.50 | 7.28 | 7.65 | 7.35 | 7.57 | 7.27 | 7.74 | 7.87 | 7.98 |

\* capped (section 3). Bold: a pass.

**What it shows:**

- Most of the average's gain came in rounds 1–4 (6.36 to 7.50), when the problems were big and obvious: a broken
  economy, placeholder-feeling art, missing systems.
- From round 4 to round 11 the average wandered between 7.27 and 7.87. The trend over those eight rounds is up
  (about +0.05 a round), but no single round's number means much on its own.
- Four areas trended up steadily in the last rounds: Stability, UI/UX, Level design and Combat. Two stayed flat through
  round 11: Audio and Battle presentation (section 6).
- **Round 12, the closing measurement, came in at 7.98**, the highest of the run. Both flat areas finally moved
  (Battle presentation 6.5 to 7.3, Audio 7.2 to 7.8), and nothing fell below 7.3. Only Stability passed 8.5; nine
  areas sit between 7.6 and 8.3, close to the fallback and still short of the target.

---

## 9. Exit criteria (set 2026-09-29)

Mark called the question after round 12's fixes ("Are we making effective progress? We're not just going in circles?")
and set an exit:

- **Round 12 is the last automated round.** Its fixes are in; its verification runs as the closing measurement and
  is recorded here and in the scorecard. No round 13 starts without Mark asking for one.
- **The real exit gate is Mark's own end-to-end playthrough.** Anything he finds is triaged as a bug (fixed before
  the alpha ships) or a design note (goes to the next milestone).
- **Round 13 (2026-09-29, at Mark's request).** After his first partial playthrough Mark asked for his 25 notes to be
  worked through "with reasonable verification using a similar rubric as the initial build". That was one round:
  ten areas re-scored (Audio untouched) plus a reviewer checking each note, then the defects it found were fixed.
  It averaged 7.22 (round 12: 7.98). Much of the drop was regressions the notes' work introduced (fixed the same
  day); some is the trade-offs his notes asked for; some is older findings scored more strictly. The fixed state
  wasn't re-scored: the gate is still Mark's playthrough. Details: `docs/quality/playthrough-1.md`,
  `reviews/round-13.md`.
- **For the record, the numeric target the loop was chasing** was 8.5 in every area. The fallback proposed with the
  exit was: average ≥ 8.0, no area below 7.0, no open bugs. Round 12's result is compared against both in the
  scorecard, as information, not as a gate.
- **Round 12's result:** average 7.98, lowest area 7.3 (Battle presentation), and one bug found and fixed (the
  settings crashed the boot where browser storage is blocked; now tested). The 8.5 target is met in one area
  (Stability). The fallback is met on two counts of three and missed on the average by 0.02. The loop ended as
  planned either way.
- **After the alpha is accepted:** the deploy to shadowjog.com with the secure email sign-up (status.md, Future
  Plans), and Mark's review of this document, the glossary and the setting bible.

---

## 10. Questions for your review

1. **The references.** Keep grading generated art and audio against Chrono Trigger and Sea of Stars, or split the bar
   into "finished and coherent" and "crafted to a studio standard"?
2. **The reviewer.** One Sonnet reviewer per area gave noisy scores. For future milestones: two reviewers averaged, a
   stronger model, or a reviewer who checks off the last round's issues before scoring?
3. **Playing vs reading.** Should a future reviewer actually play (drive the real game through the browser for a set
   time), rather than read staged screenshots?
4. **The areas and bars.** Are the 11 areas and their 8.5 descriptions the right ones? Anything missing (onboarding,
   accessibility, performance on low-end devices)?
5. **The caps.** They caught two real problems. Keep them as they are?

---

## Where everything lives

| What | Where |
|---|---|
| The rubric | `docs/quality/rubric.md` |
| Current scores and each round's work log | `docs/quality/scorecard.md` |
| Each round's reviewer notes | `docs/quality/reviews/round-NN.md` (condensed for rounds 6–11; verbatim from round 12) |
| The evidence | `docs/quality/evidence/`, `docs/screenshots/` |
| The tools | `scripts/evidence.sh` (regenerate all evidence), `scripts/verifier-prompts.py <round>` (the 11 reviewer prompts, with the per-area lists of section 5), `scripts/score-history.py` (the history table in section 8); how to run a round: `docs/DEVELOPING.md` §6 |
