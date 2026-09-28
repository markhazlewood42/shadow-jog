---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-09-28
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
- Tests: Vitest (battle, balance simulator, economy model, save, music) and Playwright E2E (`e2e/playthrough.spec.ts` full chapter, `e2e/gameover.spec.ts`). Screenshot evidence: `npm run shots` writes `docs/screenshots/`. Playtest capture: `npx playwright test e2e/playtest.spec.ts` plays Chapter 1 hands-off with real dialogs/battles and writes a frame every 2.5s to `playtest/latest/` (gitignored).
- Dev: `npm run dev` (port 3007). Debug routes: `?scene=field&map=ID&x=&y=`, `?scene=battle&enc=&bg=`, `?scene=chars|bestiary|portraits|mapview&map=ID`. `window.__SJ__` offers `stage(name)`, `tp()`, `battle()`, `say()`, `menu()` and `debug.autoDialog/autoBattle`.

## Current Status

**Content-complete and playable start to finish.** Quality gate round 1 done (scores 3.5–7.6, see `docs/quality/scorecard.md`); **round 2 in progress**, one batch per area, ticked in the scorecard's work plan.

Round 2 done so far: stability/engine (06f403c), economy + balance (5bd94c9: no-grind economy model, competent-player sim with full ability/combo coverage, Warden/Lurker retune, playtest capture mode).

**Resume here**
1. Scorecard → next unticked batch in "Round 2 work plan" (next: UI/UX, then field art, battle presentation, combat, narrative, level design, audio).
2. After each batch: `npx tsc --noEmit`, `npx vitest run`, `npx playwright test e2e/playthrough.spec.ts e2e/gameover.spec.ts`, commit, push.
3. When all batches land: `npm run shots`, playtest capture, re-verify every area with fresh sonnet verifiers (rubric grader prompt).

Don't edit `src/` while a Playwright run is going: Vite hot-reloads and the run dies.

## Future Plans

- Touch controls.
- Deploy (GitHub Pages or Vercel; ask first).
- Chapter 2 ("Deniable Assets"): getting Rook back.

## Notes

- Python edits on Windows: write with `newline='
'`. Avoid `'` inside Python heredocs; use ’ in dialogue.
- No Co-Authored-By lines in commits (per CLAUDE.md).
