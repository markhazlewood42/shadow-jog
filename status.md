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

**Content-complete and playable start to finish.** Quality gate: rounds 1–5 verified (scores in the scorecard); Mark asked for unattended rounds past the rubric's 4-round cap, pausing only at usage limits. **Round 6 fixes landed (2026-09-28) and are being verified**: see the scorecard's round-6 work plan. Headlines: UI overflow and floater collisions fixed with tests; a software-canvas perf pathology found and fixed (CI field frame 24 → 4.4 ms; CI green again after 6 red commits); Monte Carlo economy model with padded checkpoints; audio wet returns now on the music bus; distinct lead faces; cryopod continuity; Places maps; BattleScene split further.

**Resume here**
1. Read the latest verifier results in the scorecard. Deferred on purpose in round 6: a second mechanic per dungeon, Warden arena terrain, alternate combo recipes.
2. After any change: `npx tsc --noEmit`, `npm run lint` (judge by exit code, not the last line), `npx vitest run`, `npx playwright test` (full suite), commit, push, then `gh run list -L 3` to confirm CI. `PW_NOGPU=1` reproduces CI's software canvas for perf work.
3. Evidence: `npm run shots` (screenshots incl. map overviews), logs in `docs/quality/evidence/`.

Don't edit `src/` while a Playwright run is going: Vite hot-reloads and the run dies.

The original prompt that started the project: `docs/original-prompt.md`.

## Future Plans

- Touch controls.
- Deploy (GitHub Pages or Vercel; ask first).
- Chapter 2 ("Deniable Assets"): getting Rook back.

## Notes

- Python edits on Windows: write with `newline='\n'`. Avoid `'` inside Python heredocs; use ’ in dialogue.
- No Co-Authored-By lines in commits (per CLAUDE.md).
- Biome's formatter is deliberately off: palettes, glyph tables, maps and ability data are hand-grouped, and the formatter explodes them one entry per line (tried in round 5: +6.8k lines, much harder to read). Lint is enforced in CI; `.editorconfig` covers whitespace.
