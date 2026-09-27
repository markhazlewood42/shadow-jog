---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-09-27
tags: [status]
---

# Shadow Jog

Browser JRPG: a cyberpunk-fantasy setting with the Phantasy Star IV game loop. Chapter 1, "Milk Run", covers one hub town, the world map, one outpost and one two-floor dungeon. Design lives in `docs/GDD.md`.

**GitHub:** [markhazlewood42/shadow-jog](https://github.com/markhazlewood42/shadow-jog)

## Architecture

- Vite + TypeScript (strict), zero runtime dependencies, Canvas 2D at 480x270. All art and audio are generated in code.
- `src/engine/`: loop, scene stack, input, bitmap font, display scaling.
- `src/field/`: map baking (tiles, buildings, props), light map, rain, actors.
- `src/battle/`: pure, deterministic engine (`engine.ts`), AI, combatant setup.
- `src/data/`: abilities and combos, items, enemies and encounters, party growth, looks, maps.
- `src/art/`: character rig (`chars.ts`), pixel kit (`pix.ts`), enemy art (`enemies.ts`).
- Tests (Vitest): `tests/battle.test.ts`, `tests/balance.test.ts` (sim in `tests/sim.ts`). 23/23 pass.
- Dev server on port 3007: `npm run dev`. Screenshots: `node scripts/shot.mjs "<query>" out.png` (uses system Edge).
- Dev routes: `?scene=field&map=lantern_row&x=26&y=15`, `?scene=chars`, `?scene=bestiary[&page=1]`.

## Current Status

**Done**
- Engine core
- Field engine
- Lantern Row exterior draft
- Character rig with the cast
- Battle data and engine, with combos and boss phases
- Balance sim tuned to per-stage targets

**In progress:** enemy battle art. `src/art/enemies.ts` and the bestiary test scene are written but the art hasn't been reviewed yet.

**Resume here**
1. Review the bestiary screenshots, then build `BattleScene`:
   - 240x135 world at 2x
   - party back-sprites
   - status panel and command menu
   - FX and damage numbers
2. Build the remaining systems:
   - audio (WebAudio synth and tracks; `src/audio/*` are stubs)
   - portraits (`src/art/portraits.ts` is a stub)
   - menus (item, equip, status, save), shop, inn, clinic, save/load, title screen
3. Build the content:
   - world map, interiors, Rustyard, Sinkline B1/B2
   - story scripts and NPCs
4. Hold the quality gates: score each area with a fresh verifier subagent (sonnet) per `docs/quality/rubric.md` and log the results in `docs/quality/scorecard.md`. Nothing has been scored yet.

## Future Plans

- Touch controls, gamepad remap.
- Deploy to GitHub Pages or Vercel (ask first).
- Chapter 2.

## Notes

- The quality process uses loop-engineering conventions (fresh verifier plus rubric) rather than a scheduled `/create-loop` Routine, because this is interactive build work.
- Python edits on Windows: write with `newline='
'`.
- No Co-Authored-By lines in commits (per CLAUDE.md).
