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

**Content-complete and playable start to finish.** Quality gate: rounds 1–3 done; **round 4 (the last round per the rubric) is being verified** — all 11 area verifiers launched 2026-09-28 against commit 998cb8b. Scores and the round-4 work log live in `docs/quality/scorecard.md`. Areas still under 8.5 after round 4 get parked there with reasons.

Round 4 landed (2026-09-28): crash-proof loop and damaged-save handling; Crow's Wing combo, remembered resistances/immunities, Shell Wall protector, Repeat locked during telegraphs; eased bars, floaters over heads, shake intensity; 16-bar boss loops, dialogue ducking, reverb continuity; requisition terminal before the Warden; Pale's early beat and the finale title card; spatial valve puzzle, visible lattice emitters, a hidden crawlspace, the radio lot; rim-lit enemies, individual duplicates, new FX shapes; field sprite faces, rain depth, bar/lamp/car detail.

**Resume here**
1. Read the round-4 verifier results in the scorecard review log. Park anything under 8.5 with its blocking reason.
2. After any change: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx playwright test` (full suite, ~8 min), commit, push.
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
