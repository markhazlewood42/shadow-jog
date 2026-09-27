---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-09-27
tags: [status]
---

# Shadow Jog

Browser JRPG: a cyberpunk-fantasy setting with the Phantasy Star IV game loop. Chapter 1, "Milk Run", covers the town (Lantern Row), the world map (the Sprawl), an outpost (the Rustyard) and a two-floor dungeon (the Sinkline B1 and K-M Annex 7). Design lives in `docs/GDD.md`.

**GitHub:** [markhazlewood42/shadow-jog](https://github.com/markhazlewood42/shadow-jog)

## Architecture

- Vite + TypeScript (strict), zero runtime deps, Canvas 2D at 480x270. All art and audio are generated in code.
- `src/engine/`: loop, scene stack, input, bitmap font, display scaling.
- `src/field/`: map baking (tiles, buildings, props), light map, weather, actors, chests.
- `src/battle/`: pure deterministic engine, AI, FX. `src/scenes/battle.ts` is the presentation.
- `src/audio/`: WebAudio synth, sequencer and composition DSL; 14 songs (`songs.ts`) and SFX.
- `src/story/chapter1.ts`: every story beat. `src/data/maps/*.ts`: all maps, NPCs and events.
- `src/game/`: state, party, save (3 slots + autosave), systems hooks, debug and stage presets.
- Tests: Vitest (battle, balance simulator, music) and the Playwright E2E full-chapter playthrough (`e2e/playthrough.spec.ts`). Screenshot evidence: `npm run shots` writes `docs/screenshots/`.
- Dev: `npm run dev` (port 3007). Debug routes: `?scene=field&map=ID&x=&y=`, `?scene=battle&enc=&bg=`, `?scene=chars|bestiary|portraits|mapview&map=ID`. `window.__SJ__` offers `stage(name)`, `tp()`, `battle()`, `say()`, `menu()` and `debug.autoDialog/autoBattle`.

## Current Status

**Content-complete and playable start to finish.** The E2E playthrough passes, 38/38 unit tests pass, and typecheck is clean.

**Quality gate round 1** is running: 11 independent sonnet verifiers, one per rubric area. Results go in `docs/quality/scorecard.md`.

**Resume here**
1. Read the scorecard.
2. Fix the top issues in every area scored below 8.5.
3. Re-run `npm run shots` and the E2E playthrough.
4. Re-verify.

Areas to watch: human enemy sprites use Scale2x (their pixel density differs from the party sprites); the level design of Sinkline B1 is fairly linear; audio can only be reviewed from code.

## Future Plans

- Touch controls.
- Deploy (GitHub Pages or Vercel; ask first).
- Chapter 2 ("Rook, Taken").

## Notes

- Python edits on Windows: write with `newline='
'`. Avoid `'` inside Python heredocs; use ’ in dialogue.
- No Co-Authored-By lines in commits (per CLAUDE.md).
