---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-09-29
tags: [status]
---

# Shadow Jog

Browser JRPG: a cyberpunk-fantasy setting with the Phantasy Star IV game loop. Chapter 1, "Milk Run", covers the town
(Lantern Row), the world map (the Sprawl), an outpost (the Rustyard) and a two-floor dungeon (the Sinkline B1 and
K-M Annex 7). About 45–75 minutes. Design lives in `docs/GDD.md`.

**GitHub:** [markhazlewood42/shadow-jog](https://github.com/markhazlewood42/shadow-jog) (public). CI: GitHub Actions
on every push to `main`.

## Where we left off (2026-09-29)

### The whole process so far
1. **Build (2026-09-27 → 28).** From the original prompt (`docs/original-prompt.md`) to a content-complete chapter:
   town, world map, outpost, two-floor dungeon, four party members, 21 enemies and three bosses, nine combos, an
   economy, a story with a comic-panel intro and ending, 15 songs and 69 sound effects, all generated in code.
2. **Quality loop (rounds 1–12, 2026-09-28 → 29).** Eleven areas scored out of 10 by fresh independent reviewers
   each round; fixes between rounds. The average went 6.36 → 7.50 in rounds 1–4, then wandered 7.27–7.87 through
   round 11. Three areas passed 8.5 at some point (Stability 9.0, UI/UX 8.7, Engine 8.5 in round 10). Everything
   about it is in `docs/quality/GRADING.md`; scores and work logs in `docs/quality/scorecard.md`.
3. **Exit (2026-09-29).** Mark asked whether we were going in circles; gains per round had shrunk to the size of
   reviewer noise. He set an exit: **round 12 is the last automated round**, and **the real gate is his own
   end-to-end playthrough**.
4. **Documentation (2026-09-29).** Architecture, developer guide, AI-session instructions (`CLAUDE.md`), the grading
   write-up, the glossary and the setting bible, so work can resume cold in a fresh session.

### Right now
- **Round 12 is verified, and the automated loop is over.** The closing measurement averaged **7.98**, the highest
  of the run (round 11: 7.87). Stability passes (8.6); the lowest area is Battle presentation (7.3). The one bug the
  reviewers found (the settings crashed the boot where browser storage is blocked) is fixed, with a test.
  Verbatim reports: `docs/quality/reviews/round-12.md`; scores: `docs/quality/scorecard.md`.
- **Waiting on Mark's playthrough.** He's playing the shipped build end to end (`npm run build && npm run preview`,
  http://localhost:3008). His notes are the next work queue.

### What happens next, in order
1. **Triage Mark's playthrough notes**: bugs get fixed before the alpha ships (with tests where it makes sense);
   design notes go to a list for the next milestone.
2. **Mark's reviews**: `docs/quality/GRADING.md` (its closing questions), `docs/GLOSSARY.md` (the **[review]** marks
   and open questions, including the Shadowrun-term swap), `docs/SETTING.md` (everything tagged **[new]**).
3. **Ship the alpha**: deploy to shadowjog.com (Vercel, probably) with the secure email sign-up on the last card.
   **Only with Mark's go-ahead.** Requirements under Future Plans.
4. **Chapter 2, "Deniable Assets"**: getting Rook back (seeds in `docs/SETTING.md` §10).

### Known gaps (from the last reviews; none are bugs)
- **Audio (7.8) and Battle presentation (7.3)** were flat for most of the run against hand-made references; round
  12 moved both, but more procedural tweaking has shrinking returns (GRADING.md §6). Hand-made or commissioned assets are the likely next step if they
  matter at 8.5.
- Stability: no gamepad or touch E2E, no long-session soak. (A storage-blocked boot is now covered by a unit test.)
- The fullest current list of design notes is round 12's reviewer reports (`docs/quality/reviews/round-12.md`):
  trash fights end in about 2 rounds, few enemies telegraph, required gear is never a budget decision, menus snap
  open, rooms are all rectangles, and more. None are bugs; they wait for Mark's triage.
- UI: no colour-blind palette or text-size option.
- Feel: key story portraits have few expressions; no camera punch on the biggest combos; one swing timing for all
  weapons.
- Field art: rooftop clutter repeats; puddle reflections are smudgy; the bar interior is sparse.
- Level: the Barrens' middle is empty; the Annex wings could use set-piece rooms.
- Progression: loot is only sold, never used (no crafting layer).
- Engine: `field/props.ts` (1,756 lines) and `field/tiles.ts` are big single files; `!` assertions remain outside
  `engine/` and `battle/`.
- Touch controls (the input layer supports touch; there's no on-screen pad yet).

## Documentation map

| Doc | For |
|---|---|
| `CLAUDE.md` | AI sessions: read order and rules (loaded automatically in this folder) |
| `docs/ARCHITECTURE.md` | How the code is organised and how the pieces talk |
| `docs/DEVELOPING.md` | Commands, tests, debug tools, conventions, traps, recipes |
| `docs/GDD.md` | The game's design |
| `docs/GLOSSARY.md` | Every name, place, faction, term and mechanic (with [review] marks) |
| `docs/SETTING.md` | The world bible: history, politics, society, figures ([canon] vs [new]) |
| `docs/quality/GRADING.md` | How quality was graded, the full score history, what it got wrong, the exit |
| `docs/quality/rubric.md`, `scorecard.md`, `reviews/` | The rubric, the scores and work logs, each round's reviewer notes |
| `docs/original-prompt.md` | The prompt that started it |

## Architecture (summary; full version in docs/ARCHITECTURE.md)

- Vite + TypeScript (strict), zero runtime deps, Canvas 2D at 480x270. All art and audio are generated in code.
- `src/engine/`: loop, scene stack, input, bitmap font, display scaling.
- `src/field/`: map baking (tiles, buildings, props), light map, weather, actors, chests.
- `src/battle/`: pure deterministic engine, AI, FX. `src/scenes/battle.ts` + `battlekit/` are the presentation
  (loaded as a separate chunk).
- `src/audio/`: WebAudio synth, sequencer and composition DSL; 15 songs (`songs.ts`) and 69 SFX.
- `src/story/chapter1.ts`: every story beat. `src/data/maps/*.ts`: all maps, NPCs and events.
- `src/game/`: state, party, save (3 slots + autosave, format v2 with migrations), systems hooks, debug and stage
  presets.
- Tests: Vitest (battle rules, balance simulator, economy Monte Carlo, save, maps, layout, music…) and Playwright
  E2E (full chapter, playtest capture, game over and saves, chaos input, shipped build, perf, audio, screenshots).
- Dev: `npm run dev` (port 3007). Debug routes and the `window.__SJ__` hook are in `docs/DEVELOPING.md` §4.

## Future Plans

- Touch controls.
- **Setting bible.** `docs/SETTING.md` (2026-09-29): history, politics, society, key events and figures, each line tagged [canon] (in the game) or [new] (invented to fill a gap). Mark will use it to shape future narrative and setting changes to his own vision.
- **Glossary review.** `docs/GLOSSARY.md` holds every term and concept in the setting; Mark reviews it as a whole once the alpha phase completes (asked 2026-09-29). Its **[review]** marks and closing questions are the agenda. Keep it current in the same change as any new name or term.
- **Deploy to shadowjog.com** (domain bought 2026-09-28; hosting probably Vercel). Confirm with Mark before any deploy.
- **Last step, after the alpha is fully working: interest sign-up.** The final screen (the "Chapter 2 coming soon"
  card, `src/scenes/ending.ts`) gets an email field so players can ask to hear about updates. It must be secure. The
  details are to be designed with Mark later; points to cover then:
  - the address goes to a server endpoint (a Vercel function), never straight from the browser to a mailing service,
    and no secret or API key ships in the client bundle;
  - validate and rate-limit on the server; bot protection (honeypot or similar); double opt-in confirmation;
  - HTTPS only; a short privacy note at the field; an unsubscribe path; store no more than the address and consent;
  - the game keeps working (and the field fails gracefully, with a visible error state) if the endpoint is down.
- Chapter 2 ("Deniable Assets"): getting Rook back.

## Notes

- Python edits on Windows: write with `newline='\n'`. Avoid `'` inside Python heredocs; use ’ in dialogue. Scripts
  with backslashes: write them to a file rather than a heredoc.
- No Co-Authored-By lines in commits (per CLAUDE.md).
- Biome's formatter is deliberately off: palettes, glyph tables, maps and ability data are hand-grouped, and the formatter explodes them one entry per line (tried in round 5: +6.8k lines, much harder to read). Lint is enforced in CI; `.editorconfig` covers whitespace.
