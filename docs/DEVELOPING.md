---
type: reference
title: Shadow Jog — Developing
project: shadow-jog
created: 2026-09-29
updated: 2026-09-29
tags: [development, testing, tooling, recipes]
---

# Developing Shadow Jog

Everything needed to change the game safely: setup, commands, how testing works, the debug tools, the conventions
the code follows, the traps that have bitten before, and step-by-step recipes for common changes. Architecture is
in `docs/ARCHITECTURE.md`.

---

## 1. Setup and commands

Windows 11, Git Bash. Node 24 (as in CI). From `projects/shadow-jog/`:

```bash
npm install
```

| Command | What |
|---|---|
| `npm run dev` | Dev server on **http://localhost:3007** (debug hooks on; add `?debug` for the test helpers) |
| `npm run build` | Typecheck, then the production build into `dist/` |
| `npm run preview` | Serve `dist/` on **http://localhost:3008** (the shipped build) |
| `npm run check` | Lint + typecheck + unit tests (the quick pre-commit gate) |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | Biome lint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run budget` | Build, then the bundle budget |
| `npm run e2e` | Every Playwright spec (long: prefer running the ones you need, below) |
| `npm run shots` | Regenerate `docs/screenshots/` |
| `bash scripts/evidence.sh` | Regenerate all quality evidence (~25 min; see section 6) |

**Ports:** 3007 (dev) and 3008 (preview) belong to this project. The home-base workspace reserves 3002–3006 for
other projects: never kill those.

---

## 2. The rules of the road

- **Before committing, check `origin`:** `git fetch` then `git rev-list --left-right --count HEAD...origin/main`.
- **Judge lint and typecheck by exit code** (`npx biome lint src tests e2e; echo $?`), not by the last line of
  output: Biome's summary line can read fine when it failed.
- **Commit after each meaningful piece of work and push right away** (Mark's standing preference). Then confirm CI
  with `gh run list -L 3`. No `Co-Authored-By` lines in commits.
- **Don't edit `src/` while a Playwright run is going.** Vite hot-reloads and the run dies mid-test.
- **The repo is public** (`markhazlewood42/shadow-jog`). Nothing secret in it, ever.
- **Glossary rule:** any new or renamed name, place, faction or term goes into `docs/GLOSSARY.md` in the same
  change. Mark will review the glossary, the setting bible and the grading as a whole after the alpha.
- **Deploying** (shadowjog.com, probably Vercel, with a secure email sign-up) is the **last step** of the alpha and
  needs Mark's go-ahead. See `status.md`, Future Plans, for the security requirements.

---

## 3. Testing

### Unit tests (`tests/`, Vitest, node environment)
Run one file with `npx vitest run tests/battle.test.ts`. Output of the simulation tables needs
`--reporter=verbose`. The suites:

| File | Covers |
|---|---|
| `battle.test.ts` | Engine rules: damage, statuses, Guard, stun immunity, combos, timing multipliers, enemy AI tells, data integrity |
| `balance.test.ts` | **Simulated fights and dungeon runs** (`sim.ts`): each stage's win rate, rounds and HP loss inside a target band; boss ceilings with timed presses; attrition runs; alternative builds hold up |
| `auto.test.ts` | Mashing Auto loses to a competent policy; timed presses pay without trivialising bosses |
| `economy.test.ts` | **Monte Carlo over the chapter route** (`economy.ts`, `route.ts`): gear affordable at each checkpoint for 9 runs in 10 (3 in 4 when skipping every optional chest); the fork at Mags' is balanced; you can't buy everything |
| `pacing.test.ts` | Steps between encounters, fights per area |
| `save.test.ts` | Round-trips, tampering, damaged slots, migrations, the real v1 fixture |
| `game.test.ts` | Scene stack: fault isolation and recovery, curtain compositing, notices |
| `maps.test.ts` | Every map's content reachable; **no mid-story dead ends** at any of 25 story stages; relay logic; typographic apostrophes; glyph coverage; every prop has a painter; no overlapping signs |
| `layout.test.ts`, `glyphs.test.ts` | Every data-driven string fits its box; every character has a glyph |
| `playback.test.ts`, `orders.test.ts`, `timing.test.ts`, `motion.test.ts` | Battle presentation logic without a canvas |
| `input.test.ts`, `ui-list.test.ts`, `actor.test.ts`, `atmosphere.test.ts`, `music.test.ts`, `content.test.ts` | Input, list menus, actors, weather and lighting, song bars and harmony, content references |

Balance targets live in `balance.test.ts` (`stages` array: win rate, rounds, HP lost per stage) and
`BOSS_WIN_MAX`. **When you change stats, abilities, items or encounters, run `balance.test.ts` and
`economy.test.ts`** and read the printed tables: most tuning is done by adjusting numbers until those pass.

### E2E (`e2e/`, Playwright)
Locally it runs **Edge**; CI runs Chromium, plus WebKit and Firefox for `prod` and `gameover`. One worker, one at a
time. Run a single spec: `npx playwright test e2e/chaos.spec.ts --reporter=line`; one test: `-g "name"`.

| Spec | What |
|---|---|
| `playthrough.spec.ts` | The whole chapter through the real scripts (dialogs and fights auto-resolved) |
| `playtest.spec.ts` | A hands-off real-speed playtest; writes a frame every 2.5 s to `playtest/latest/` |
| `gameover.spec.ts` | Game over flows, saves, storage failure, render/update faults, tabs, boot failure |
| `chaos.spec.ts` | Mashing keys through doors, menus mid-warp, reload mid-dialogue, keys through a battle |
| `prod.spec.ts` | The **shipped build** (builds fresh, serves on 3008): new game, save, reload, continue |
| `economy.spec.ts` | Zone walks and a shop in the real game |
| `perf.spec.ts` | Frame budget in the plaza and a battle; input latency. `PW_NOGPU=1` reproduces CI's software canvas |
| `shots.spec.ts` | The screenshot set for `docs/screenshots/` |
| `audio-evidence.spec.ts` | Renders every song and effect offline and measures them |

`PW_ALL_ENGINES=1` runs WebKit and Firefox locally too.

---

## 4. Debug tools (DEV builds only)

**URL routes** (`src/devroutes.ts`):
- `?scene=field&map=ID&x=&y=`: straight into a map.
- `?scene=battle&enc=ID&bg=ID[&boss]`: a battle on loop.
- `?scene=mapview&map=ID`: the whole map rendered.
- `?scene=chars[&zoom=4][&npcs][&battlers]`, `?scene=bestiary[&page=1]`, `?scene=portraits`, `?scene=font`:
  asset sheets.
- `?scene=fxlab`: the FX lab (particle presets and battle moments; see §8).
- `/artreview.html`: the art-pass review page; `?art=review[&try=asset/option,...]` on any route swaps art-pass
  options into the game (see §8, "The PixelLab art pass").

**`window.__SJ__`** (open the console on `http://localhost:3007/?debug`):
- `game`, `display`, `state`, `field()`, `top()` (the top scene's class name), `idle()` (field ready for input);
- `stage(name)`: jump to a preset (`start`, `town`, `sinkline`, `annex`, `finale`);
- `tp(map, x, y, dir)`: teleport;
- `battle(encounter, bg, boss)`, `defineEncounter(id, enemies)`;
- `say(who, text)`, `menu()`, `shop(id)`, `run(scriptFn)`, `save(slot)`, `ending()`, `notice()`;
- `debug`: `{ autoDialog, autoBattle, autoLose, playtest }`.
- `postfx` (the GPU effects façade: try `sj.postfx.shock(240, 135)`), `fx` (the live presets and moments),
  `gpu(on)` (the Options switch).

Setting flags by hand: `sj.state.flags.floodgate = true`, then `sj.field().api.refreshMap()`.

---

## 5. Conventions

- **TypeScript strict** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. In `src/engine/` and
  `src/battle/` there are **no non-null assertions** (Biome enforces it): use a guard, `for…of`, optional chaining
  or `must(value, 'what')`. Elsewhere `!` is tolerated but prefer the same.
- **Biome** lints (the formatter is off; match the surrounding style: 2 spaces, single quotes, semicolons, long
  lines are fine for data).
- **No per-frame allocation in hot paths** (render loops, update loops): reuse buffers, pool particles, cache
  gradients and canvases.
- **Comments explain why**, in plain sentences, often with the design intent ("a guarded hit gives TP back, so
  Guard/Attack can't be run as a battery"). Keep that density.
- **Player-facing text** uses typographic quotes and apostrophes (’ “ ”) and the ellipsis glyph (…); a test fails
  straight apostrophes in strings. Every character must exist in the font.
- **Deterministic randomness:** gameplay RNG comes from `Rng` streams, never `Math.random()` (visual effects may
  use `Math.random`). The battle engine is pure: same seed, same fight.
- **Terms:** the setting's own words (Woken, spark, deck jockey, ki brawler); see the glossary.

---

## 6. Evidence and verification rounds

The quality process (11 areas scored by independent reviewers) is documented in full in `docs/quality/GRADING.md`,
including why it ended at round 12. If a future milestone brings it back:

1. Regenerate evidence: `bash scripts/evidence.sh` (writes `docs/quality/evidence/*`, `docs/screenshots/*`).
2. After a green CI run, refresh `docs/quality/evidence/ci-engines.txt` from `gh run view <id> --log` (keep the
   lines with ✓, ✘, passed, failed; put the run id and commit at the top).
3. Generate the prompts: `python scripts/verifier-prompts.py <round>` (writes `reviewer-prompts/`).
4. Launch one fresh subagent per area (model `sonnet`, read-only) with: "Your instructions are in <file>. Read it
   and follow it exactly."
5. Record scores in `docs/quality/scorecard.md` (the table rows, a round note, the work log) and the reports in
   `docs/quality/reviews/round-NN.md`. `python scripts/score-history.py` prints the history table.

---

## 7. Traps that have bitten before

- **Git Bash heredocs mangle backslashes** in Python one-liners (`\\`, `\n` in regexes). Write scripts to a file
  instead of piping them through `<<'EOF'` when they contain backslashes.
- **`shade(color, -x)` doesn't darken much**, and shifts the hue towards blue. For "this colour, mostly dark", use
  `mix(color, '#0a0814', 0.8)`.
- **Sound effect names must exist** in `src/audio/sfx.ts`; an unknown name is silent.
- **Map changes that depend on flags** need `s.refreshMap()` after the flag is set.
- **Sign boards** must not overlap (a test enforces it); text on props and signs is measured with the game font.
- **Balance is coupled:** a stat or ability change shifts boss win rates and dungeon attrition. Run
  `balance.test.ts` and `economy.test.ts` after any combat or economy change. Simulations with 60 runs swing about
  ±5 points; some tests use 120 for that reason.
- **The bundle budget** is close to its cap by design (it catches unplanned growth). If a planned feature needs
  more, re-set it in `scripts/bundle-budget.mjs` with the reason in the comment.
- **Screenshots are staged**, not played: `e2e/shots.spec.ts` sets flags and positions directly. When a feature
  changes a scene, update or add its shot.
- **Importing a module by URL in a test page** (`import('/src/…')`) can hand back a *second copy* of it on a
  long-running dev server: a module edited since the server started is served to the app with a `?t=` query. Go
  through `window.__SJ__` (which holds the app's own copies) for anything with state (`settings`, `postfx`).
- **GPU effects in tests**: headless Chromium on CI has no GPU; WebGL is either missing (the game falls back to 2D)
  or software (slower: `PW_NOGPU=1` reproduces it locally). `e2e/gpufx.spec.ts` skips its WebGL checks where
  there's no WebGL 2 and always checks the fallback.
- **Evidence runs take ~25 minutes** and use ports 3007/3008; don't start a manual preview on 3008 during one.

---

## 8. Recipes

### A new enemy
1. `src/data/enemies.ts`: add it with stats, `family`, `moves` (ids in `ABILITIES`), drops, `lore`, `sprite`, and an
   `ai` key if it needs scripted behaviour (`src/battle/ai.ts`).
2. `src/art/enemies.ts`: a maker under `HUMANS` (built on the character rig) or `CREATURES` (with `Pix`); add it to
   `POSED` and handle `POSE === 'attack'` and `'hurt'` for its strike and flinch frames.
3. Put it in an encounter table (`ENCOUNTERS`), run `balance.test.ts`, and add it to the glossary.

### A new ability or combo
1. `src/data/abilities.ts`: the ability (`kind`, `cost` or `uses`, `target`, `effects`, `fx`), and a `LEARNSETS` entry.
2. Combos: an `ABILITIES` entry of kind `combo` plus a `COMBOS` entry (parts, hint, and the caller's line).
3. FX: a case in `src/battle/fx.ts` `play()` (or reuse one); a sound in `battlekit/tables.ts` `fxSound`.
4. If the sim should use it, teach `tests/sim.ts` `policy()`; run the balance tests.

### A new item or shop entry
`src/data/items.ts` (with `who` for gear), then the shop's `items` in `src/data/shops.ts`. Run `economy.test.ts`.

### A new map, NPC or event
1. A `MapDef` in `src/data/maps/` (build terrain with `Grid`), registered in `data/maps/index.ts`.
2. Warps both ways (the connectivity and dead-end tests will tell you if something is unreachable).
3. NPC `talk` is a string array or a `ScriptFn`; events are `touch` or `action`, optionally `once` and `when`.
4. New prop kinds: add the name to `PropKind` (`field/types.ts`) and a painter in `field/props.ts`.

### A new story beat
Write a `ScriptFn` in `src/story/chapter1.ts` (or a new chapter file) and attach it to an NPC, event or warp. Set
flags with `s.set`; add each new flag to the ordered list in the file's header (the dead-end test walks it).
Objectives go in `OBJ`. New names go in the glossary.

### A new song or sound
- Songs: a `SongSpec` in `src/audio/songs.ts` (see the notation at the top of `music.ts`). Bars must add up
  (`music.test.ts`). Check loudness and loop seams with `npx playwright test e2e/audio-evidence.spec.ts`.
- Effects: a synth function and a `LEVEL` entry in `src/audio/sfx.ts` (measure it with the audio evidence).

### Particle effects and battle moments: the FX lab
- **Open it:** `npm run dev`, then http://localhost:3007/?scene=fxlab. The game screen (a battle backdrop and an
  enemy to aim at, with the real GPU effects) is on the left; the panel is on the right.
- **Presets** (the Particle presets tab): every field has a slider and a number box (count, life, speed, direction,
  spread, spawn radius, gravity, drag, size and opacity over life, colours over life, shape, blend, spark length,
  spin, wobble, pixel snap). New, Duplicate, Rename (moments follow the new name) and Delete (refused while a
  moment uses it). Each edit fires a burst (turn that off with "Fire on every change"); auto-repeat keeps firing.
- **Moments** (the Moments tab): what plays on each game event (`GAME_MOMENTS` in `src/data/fx.ts`: a hit by damage
  type, heavy hits, criticals, combos, heals, kills, a boss's phase, the battle transition). A moment is a stack of
  layers: particles (a preset, a count multiplier, weighted by the blow, aimed the way it travelled), a shockwave,
  a colour split or a bloom flare, each with a delay and an offset. "Test weight" and "Aim angle" stand in for the
  blow when you play it. Moments the game doesn't play yet can be made and saved; code has to call them.
- **Save to game** writes `src/data/fx.json` (checked first; the file keeps one field per line, so the diff is
  small). A dev game running in another tab takes the change at once, no reload. Commit the file to ship it.
  **Revert** reloads the file. **Export / import**: one preset, one moment or the whole file as JSON.
- The data's shapes, checks and file format are `src/engine/fxdata.ts`; the save endpoint is the plugin in
  `vite.config.ts` (dev server only); `tests/gpufx.test.ts` checks the file and `e2e/fxlab.spec.ts` the lab.
- In code: `playMoment(FX, 'crit', x, y, { angle, weight })` (`engine/moments.ts`); one preset:
  `postfx.emit(FX.presets.embers, x, y)`. Screen pixels (battle world coordinates ×2).

### The trailer
- `node scripts/trailer.mjs` (with `npm run dev` running) shoots about 95 s of real gameplay, directed: title,
  Lantern Row, Dutch, the Sprawl, the Rustyard, a staged fight (the Clean Job combo, FIRE and SHOCK, victory, a
  level-up), the Sinkline, the Lurker, the Warden's tell and phase change, and a title-only end card. It records
  the game's own picture and audio mix in Edge at 1920x1080, 60 fps, to `media/shadow-jog-trailer-<date>.mp4`
  (H.264 + AAC, about 200 MB; `media/` isn't committed). `--preview` takes one still per shot instead, to check
  framing first (`media/trailer-preview/`).
- The shots are the script's shot list; the in-page tools (caption cards in the game font, one held song per
  section, the recorder) are `src/dev/trailer.ts`. Re-shoot it after changing the art for a before/after pair.

### The PixelLab art pass and the review page
Drawn art made with [PixelLab](https://www.pixellab.ai) (a paid account; its REST API, `https://api.pixellab.ai/v2`),
kept out of the game and out of git until Mark picks. Everything generated lives in `media/art-pass/`.
- **The key** is `PIXELLAB_API_KEY` in `.env.local` (git-ignored). Scripts read it; nothing prints it.
- **What today's art looks like:** `node scripts/pixellab/render-current.mjs` (dev server running) renders the
  game's own art to `media/art-pass/current/`: every character look (4 facings, plus a 32×32 style image), the
  crew's battle poses, the enemies, the portraits, each prop as the game draws it, NPC placements, and in-game
  shots of the places the terrain comes from. These are the review's "Now" column and the style images.
- **Recipes** are `scripts/pixellab/plan.mjs`, in groups: `crew`, `battle`, `enemies`, `portraits`, `npcs`,
  `terrain`, `props`. Each asset has options (different recipes) for Mark to choose between.
- **Generating:** `node scripts/pixellab/pass.mjs <groups…> [--only id,id] [--dry]`. It's resumable (a finished
  option is skipped; one with a PixelLab id recorded is picked up, not paid for twice) and it forgets jobs PixelLab
  failed ("heavy load"), so just run it again. Each asset's options and files go in
  `media/art-pass/assets/<asset>/`, with a `meta.json` the review page reads; every paid request is logged in
  `media/art-pass/ledger.jsonl`.
- **Budget:** the client (`scripts/pixellab/lib.mjs`) refuses any request that could take the account's balance
  below `ARTPASS_FLOOR` (1000 by default: this pass may spend half the month's 2,000). Costs seen: Pro Flash
  character 6 (32 px) to 8 (128 px) with its 8 directions; image 5–9 by size; a template animation 1 per
  direction; a custom (v3) animation 2 per direction at 128 px; a Wang tileset 3; a map object 1.
- **Speed:** Tier 1 runs at most 8 jobs at once (an animation is one job per direction). The runner takes job slots
  before starting anything (`ARTPASS_SLOTS`, default 8; run two at once with, say, 7 and 1). A character's
  8-direction rotation takes 5–8 minutes; images take about a minute, tilesets and map objects under one.
- **The review page:** `npm run dev`, then http://localhost:3007/artreview.html. Per asset: "Now" and each option at
  the same screen scale (walk cycles and battle animations play; tilesets are laid out as a patch of map). Mark
  marks options ★ Best (one per asset) / ✓ Good / ✗ No and writes notes, per option and per asset; it saves as he
  goes to `media/art-pass/review.json` (the `/__artpass` plugin in `vite.config.ts`). **Try ↗** opens the game with
  that option swapped in; **Try picks in game** swaps in every Best. Tilesets are judged in a level, not as loose
  tiles: `node scripts/pixellab/render-maps.mjs` (free, dev server running) bakes each tileset option into its map
  (`TERRAIN_PLACE` in `plan.mjs` says which map, and which of the game's terrain types are its lower and upper) and
  saves the whole map plus an in-game shot where the two terrains meet; the review page switches between "In the
  game", "Whole map" and "Tiles". Re-run it after generating new tilesets.
- **Swapping into the game** (`src/dev/artswap.ts`, loaded by `?art=review`; boot waits for it before starting a
  scene): field sprites for the crew, named and one-off NPCs and the townsfolk pool (with drawn walk cycles:
  `CharSprite.walk`), the crew's battle sprites (`replaceBattler`, drawn at twice the battle world's resolution:
  `Battler.res`), enemies (`replaceEnemyArt`), portraits (`replacePortrait`) and terrain (`addTerrainOverlay` in
  `field/tiles.ts`: the drawn Wang tiles laid over the painted terrain when a map bakes). Props aren't swappable yet:
  that's the integration step after picks. None of this ships: it's all behind `import.meta.env.DEV`.
- **Putting picks into the game:** `node scripts/pixellab/export-picks.mjs` writes Mark's picks to `public/art/`
  (committed, shipped) with `manifest.json`; `src/art/drawn.ts` loads them at startup. The pick is an asset's ★ Best,
  else its ✓ Good; the townsfolk pool takes every look marked either. On the way it snaps each walk frame to its
  standing frame's colours and replaces a walk frame that faces the wrong way (or that Mark flagged) with the
  mirrored opposite step. It holds back portraits (neutral only so far), critters and tilesets no map uses, and
  says so. Re-run it after every review round, then check the game with and without `?art=classic`.
- **The house recipe** (from the first tests with Mark): Pro Flash, Low Top-Down, a style image, and a prompt that
  describes the look ("chibi proportions about 2.5 heads tall, … at most 15 colors, bold black outline"). Naming
  Phantasy Star IV made results noisier. All battle art is made at the field's pixel size (the battle world's
  `res 2`), so the game has one pixel size throughout.

### A new save field
Add it to `GameState` and `newState()`. If it's purely additive, give it a default in `backfill()` (`save.ts`). If
it renames or reshapes data, bump `SAVE_VERSION` and add a `MIGRATIONS[oldVersion]` step, with a test against a
fixture.

### A new screenshot
A `test()` in `e2e/shots.spec.ts` using `open(page, stage)`, `sj(page, …)` and `shot(page, name)`; if reviewers
should see it, add it to an area's list in `scripts/verifier-prompts.py`.
