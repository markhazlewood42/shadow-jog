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

**Content-complete and playable start to finish.** Quality gate: rounds 1–8 verified (scores in the scorecard; round 8 averaged 7.57, none at 8.5 yet); Mark asked for unattended rounds past the rubric's 4-round cap, pausing only at usage limits. **Round 9 fixes landed (2026-09-28) and are being verified**: see the scorecard's round-9 work log. Headlines: timed presses in battle (strike/brace rings, On/Assist/Off) with a turn-order strip; impact frames and a camera push on big hits; render-fault recovery; Firefox reload errors fixed (pending AudioContext promises); interiors in a building shell; drawing split out of BattleScene; misdirection in the story; visible Annex secrets, catwalk height and three loops; an air bed and measured loop seams in the audio.

**Resume here**
1. Read the latest verifier results in the scorecard. Deferred on purpose in round 9: three-member combos and combo ranks, a pre-fight intel source, distinct counterplay per tell beyond Guard, rat/hound anatomy, hand-authored signature melodies.
2. After any change: `npx tsc --noEmit`, `npm run lint` (judge by exit code, not the last line), `npx vitest run`, `npx playwright test` (full suite), commit, push, then `gh run list -L 3` to confirm CI. `PW_NOGPU=1` reproduces CI's software canvas for perf work.
3. Evidence: `npm run shots` (screenshots incl. map overviews), logs in `docs/quality/evidence/`.

Don't edit `src/` while a Playwright run is going: Vite hot-reloads and the run dies.

The original prompt that started the project: `docs/original-prompt.md`.

## Future Plans

- Touch controls.
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
