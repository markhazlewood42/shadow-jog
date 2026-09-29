---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-09-29
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

**Content-complete and playable start to finish.** Quality gate: rounds 1–10 verified (round 10 averaged 7.74; Stability 8.8 and Engine 8.5 pass, the first areas to clear 8.5). Mark asked for unattended rounds past the rubric's 4-round cap, pausing only at usage limits. **Round 11 fixes landed (2026-09-29) and are being verified**: see the scorecard's round-11 work log. Headlines: menus composite one at a time and locked rows say why; a mistimed press costs, Guard earns TP only off a real blow, a three-part combo; the crew speaks in battle; Saltreach's own terminology (Woken, spark, deck jockey); swings in beats and directional shake; every recurring enemy has drawn strike and flinch frames; tab handover, a real save migration and a boot that can't hang; field.ts split; a brighter mix and longer loops; intakes that show their state; Dutch's hat, Mags' cane.

**Resume here**
1. Read the latest verifier results in the scorecard. Deferred on purpose in round 11: Annex set-piece rooms, the Barrens middle, neon in puddles, distinct terminal/tank silhouettes, hand-authored signature melodies.
2. After any change: `npx tsc --noEmit`, `npm run lint` (judge by exit code, not the last line), `npx vitest run`, `npx playwright test` (full suite), commit, push, then `gh run list -L 3` to confirm CI. `PW_NOGPU=1` reproduces CI's software canvas for perf work.
3. Evidence: `npm run shots` (screenshots incl. map overviews), logs in `docs/quality/evidence/`.

Don't edit `src/` while a Playwright run is going: Vite hot-reloads and the run dies.

The original prompt that started the project: `docs/original-prompt.md`.

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

- Python edits on Windows: write with `newline='\n'`. Avoid `'` inside Python heredocs; use ’ in dialogue.
- No Co-Authored-By lines in commits (per CLAUDE.md).
- Biome's formatter is deliberately off: palettes, glyph tables, maps and ability data are hand-grouped, and the formatter explodes them one entry per line (tried in round 5: +6.8k lines, much harder to read). Lint is enforced in CI; `.editorconfig` covers whitespace.
