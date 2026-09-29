---
type: process
title: Shadow Jog — Quality Gate Rubric
project: shadow-jog
created: 2026-09-27
updated: 2026-09-29
tags: [quality, verification]
---

# Quality gate

> **How this was used, what it got wrong, the full score history and the exit set on 2026-09-29:**
> `docs/quality/GRADING.md`. (The 4-round cap below was lifted by Mark on 2026-09-28; the loop ran 12 rounds.)

Every area below is scored out of 10 by an **independent verifier**: a fresh `Agent` subagent (model `sonnet`, not a
fork) with no knowledge of the writer's intent beyond the GDD. An area passes at **≥ 8.5**. Anything lower goes
back for iteration against the verifier's issue list. Iteration cap: 4 rounds per area per milestone. If an area is
still under 8.5 after that, it is parked in `scorecard.md` with the blocking reason and I decide explicitly whether to move on.

The bar is an **indie alpha**: a stranger could play it start to finish, understand it without the developer present,
and come away wanting more. Placeholder-feeling art, unreadable text, softlocks and "programmer UI" all fail.

## Areas and what "8.5" means

| # | Area | 8.5 looks like | Automatic cap |
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

## Verifier grader prompt (verbatim — do not paraphrase at runtime)

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

## Evidence capture

`npm run shots` runs `e2e/shots.spec.ts`, which drives the game to fixed states via the debug hook `window.__SJ__`
and writes PNGs to `docs/screenshots/`. Verifiers read those files.
