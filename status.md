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

## Where we left off (2026-09-29, evening)

### The whole process so far
1. **Build (2026-09-27 → 28).** From the original prompt (`docs/original-prompt.md`) to a content-complete chapter:
   town, world map, outpost, two-floor dungeon, four party members, 21 enemies and three bosses, nine combos, an
   economy, a story with a comic-panel intro and ending, 15 songs and 69 sound effects, all generated in code (16 and
   72 since playthrough 2).
2. **Quality loop (rounds 1–12, 2026-09-28 → 29).** Eleven areas scored by fresh independent reviewers each round.
   The average went 6.36 → 7.98. All of it is in `docs/quality/GRADING.md`; scores in `docs/quality/scorecard.md`.
3. **Exit (2026-09-29).** Round 12 was the last automated round; Mark's own playthrough became the gate.
4. **Playthrough 1 (2026-09-29).** Mark played part of the chapter and left 25 notes
   (`docs/mark-playthrough-notes.md`). All 25 were worked through; `docs/quality/playthrough-1.md` answers each (what
   changed, where to see it, the commit) and lists the judgment calls. Big pieces: slower, readable battles (one
   animation clock, a beat between turns, longer transition, slower timed presses, a Battle speed setting still there);
   damage-type symbols; a louder "who's acting"; fixed menu and turn strip; the shop's slot tag, equip-now and sell-all;
   Chapter 1 now ends around **level 6** (new XP curve), new abilities are rare (three by level) and a level-up fully
   restores; **Rook is a level-10 veteran who starts wounded** and heals in two story beats; **Hex's deck** (seen dead,
   the Stingray seated by hand, a Deck page with slots for later parts, a mini deck in battle); Sinkline encounters
   1 in 40; field depth cues (relief shadows, Sprawl facades and curbs, Sinkline caps and edges); glowing chests and
   an interact marker; finer, smaller creature art; Last Rites Arms (was Iron Saint Arms).
5. **Round 13 (at Mark's request).** One verification round: ten areas re-scored plus a reviewer checking each note
   (21 addressed, 4 partial). Average **7.22** (round 12: 7.98): regressions this work introduced (New Game started
   Rook at 3, old saves didn't migrate, broken screenshot navigation hid a Bestiary overflow, clipped labels, …) were
   all fixed after the reports (de5fff5, c7c055b), with tests; the rest is trade-offs the notes asked for and older
   findings scored more strictly. The fixed state isn't re-scored. Reports: `docs/quality/reviews/round-13.md`.
6. **Playthrough 2 (2026-09-29, same save, to just past the Lurker).** 14 more notes, all worked through;
   `docs/quality/playthrough-2.md` answers each. Big pieces: enemies no longer gang up on Hex (they lean, 1.5×, on
   whoever is lowest by percent, per Mark's follow-up); boss tells pinned on screen until acted on; healing skills get a
   green timed ring (+30% on the beat); a real level-up moment (fanfare jingle, stats counting up, restore, new
   abilities); valve, pipe and pump sounds; the equip screen shows the highlighted slot's gear with stat diffs; damage
   types written by name carry their symbol everywhere; Kit's own bed is a free rest; the inn's price line fixed; the
   stray examine twinkles removed; Dutch's hat centred; clothes rails in Kowloon Threads; a taller APTS block; shop tags
   name only crew you've met. Verified with unit tests, the affected E2E specs and hand checks of each screen (no
   scored round: Mark didn't ask for one).

### Right now
- **GPU effects layer: first slice in (2026-09-30).** A WebGL 2 presenter over the Canvas 2D game (not the PixiJS
  rewrite): real bloom on neon, lamps and spells, shockwaves, a colour split on big impacts, and GPU particles from
  data presets (`src/data/emitters.ts`), wired to battle moments (`battlekit/gpufx.ts`). Options → GPU effects
  (on by default); without WebGL 2 the game is unchanged. How it works: `docs/ARCHITECTURE.md` §2 "GPU effects".
  **FX lab built (2026-09-30):** `npm run dev`, then http://localhost:3007/?scene=fxlab. Mark tunes every preset
  and every battle moment (what plays on a FIRE hit, a crit, a combo…) with sliders, fires them on a battle
  backdrop, and **Save** writes `src/data/fx.json` (commit it to ship). Guide: `docs/DEVELOPING.md` §8.
  **Next slices, for Mark to pick:** per-spell looks (heat haze for FIRE, a lightning flash for SHOCK, a Warden cannon charge); field weather (rain
  splashes, lamp flicker into the bloom); per-place colour grading.
- **Waiting on Mark's next playthrough.** His existing save loads: saves migrate to format v3 (levels re-worked on
  the new curve from the XP earned, Rook at 10, story unlocks already passed are set). A new game shows the new
  opening (Rook's wound). Rebuild first: `npm run build && npm run preview` (http://localhost:3008).
- **Decisions waiting on Mark** (in `playthrough-1.md`, "Judgment calls"): is the new battle pace right (one constant,
  `FX_PACE`); Rook sits at 10–11 beside a level-6 chapter (his choice for note 7, flagged by the reviewer); human
  enemies kept the party's pixel scale while creatures got finer art (the battle reviewer calls the mix of densities
  a flaw); whether to act on round 13's design notes.
- **Parked ideas Mark liked** (Future Plans): a GPU effects layer (WebGL post-process and particles on top of the
  current renderer, no port); a one-battle Unity spike before any port.
- **State at this handoff:** see the end of this section's commit (`git log -1`); CI runs on every push.

### What happens next, in order
1. **Mark's next playthrough**: new notes are the work queue, same process (triage, fix, one verification round if he
   asks for it).
2. **Triage round 13's design notes** with Mark (`reviews/round-13.md`): the lift scene's motivation (Narrative's
   cap), trash-fight depth and a Lurker tell, the Rustyard scrap heaps and Sprawl rooftops, party back-sprites that
   cover enemies, menu transitions, a real (unforced) E2E playthrough.
3. **Mark's reviews**: `docs/quality/GRADING.md`, `docs/GLOSSARY.md` ([review] marks), `docs/SETTING.md` ([new]).
4. **Ship the alpha**: shadowjog.com with the secure email sign-up. **Only with Mark's go-ahead.**
5. **Chapter 2, "Deniable Assets"**: getting Rook back (seeds in `docs/SETTING.md` §10).

### Known gaps (from round 13; none are bugs)
- Battle presentation (7.5): the party are back-of-head sprites that cover enemies; creatures are finer than the party
  and human enemies (mixed pixel density); spell FX are small primitives. A GPU effects layer is the parked idea.
- Combat (7.7): most trash fights end in two rounds; few tells reach normal fights; the Lurker has no tell.
- Narrative (6.0, capped): nobody says why the crew rides Pale's lift; Pale's intake arithmetic; ending repetition.
- Field art (7.0): Rustyard scrap heaps read as noise; six rooftop stamps; the toxic canal reads as foliage.
- Level design (7.0): small, linear dungeon; one-note puzzles.
- Feel (7.6): the field drops presses mid-step; menus snap open; retry is unskippable. (Results panels now finish
  their count on the first press instead of closing: fixed in playthrough 2.)
- Stability (7.9): the E2E run teleports and auto-resolves; no save/reload mid-chapter test.
- UI: no colour-blind palette or text-size option. Touch controls: no on-screen pad yet.

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
| `docs/mark-playthrough-notes.md` | Mark's latest playthrough notes (now playthrough 2's 14; the first 25 are in git history) |
| `docs/quality/playthrough-1.md` | Playthrough 1: what changed for each note, the judgment calls, what round 13 found and fixed |
| `docs/quality/playthrough-2.md` | Playthrough 2: what changed for each note and the judgment calls |
| `docs/original-prompt.md` | The prompt that started it |

## Architecture (summary; full version in docs/ARCHITECTURE.md)

- Vite + TypeScript (strict), zero runtime deps, Canvas 2D at 480x270. All art and audio are generated in code.
- `src/engine/`: loop, scene stack, input, bitmap font, display scaling; the optional GPU effects layer
  (`postfx.ts`, `gl/presenter.ts`, `particles.ts`).
- `src/field/`: map baking (tiles, buildings, props), light map, weather, actors, chests.
- `src/battle/`: pure deterministic engine, AI, FX. `src/scenes/battle.ts` + `battlekit/` are the presentation
  (loaded as a separate chunk).
- `src/audio/`: WebAudio synth, sequencer and composition DSL; 16 songs (`songs.ts`) and 72 SFX.
- `src/story/chapter1.ts`: every story beat. `src/data/maps/*.ts`: all maps, NPCs and events.
- `src/game/`: state, party, save (3 slots + autosave, format v3 with migrations), systems hooks, debug and stage
  presets.
- Tests: Vitest (battle rules, balance simulator, economy Monte Carlo, save, maps, layout, music…) and Playwright
  E2E (full chapter, playtest capture, game over and saves, chaos input, shipped build, perf, audio, screenshots).
- Dev: `npm run dev` (port 3007). Debug routes and the `window.__SJ__` hook are in `docs/DEVELOPING.md` §4.

## Future Plans

- **GPU effects layer** (Mark interested, 2026-09-29): keep the Canvas 2D game and renderer; send the finished frame
  through a small hand-written WebGL pass (bloom, shockwave, heat haze, colour grading) and draw big effects with GPU
  particles, with a Canvas 2D fallback. Mark has particle-system experience and could design emitters. **First
  slice built 2026-09-30** (see "Right now"); targeted improvements, not the full PixiJS port.
- **Unity port** (pinned 2026-09-29): feasible (the procedural art exports to PNG sheets, audio to WAV, the battle
  engine ports mechanically to C#; Unity's own MCP needs its AI plan, community MCPs are free). Proposed first step
  if revisited: a one-battle spike.
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

- Line endings: a CRLF-to-LF fix must skip binary files (a byte replace corrupts PNGs; E2E runs rewrite some
  screenshots under `docs/screenshots/`, so `git diff --name-only` can list them).
- Python edits on Windows: write with `newline='\n'`. Avoid `'` inside Python heredocs; use ’ in dialogue. Scripts
  with backslashes: write them to a file rather than a heredoc.
- No Co-Authored-By lines in commits (per CLAUDE.md).
- Biome's formatter is deliberately off: palettes, glyph tables, maps and ability data are hand-grouped, and the formatter explodes them one entry per line (tried in round 5: +6.8k lines, much harder to read). Lint is enforced in CI; `.editorconfig` covers whitespace.
