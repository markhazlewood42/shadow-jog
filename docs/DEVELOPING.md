---
type: reference
title: Shadow Jog — Developing
project: shadow-jog
created: 2026-09-29
updated: 2026-10-06
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
| `npm run cc` | The Command Center on **http://localhost:3009** (installs its packages, builds its page, opens a tab; section 10) |
| `npm run e2e` | Every Playwright spec (long: prefer running the ones you need, below) |
| `npm run shots` | Regenerate `docs/screenshots/` (deterministic: one build gives the same bytes every run; section 3, the `shots.spec.ts` row) |
| `bash scripts/evidence.sh` | Regenerate all quality evidence (~25 min; see section 6) |

**Ports:** 3007 (dev), 3008 (preview), 3009 (the Command Center) and 3010 (its Playwright server) belong to this
project. The home-base workspace reserves 3002–3006 for other projects: never kill those.

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
| `camera.test.ts` | The field camera rule (`scenes/fieldkit/camera.ts`): a map smaller than the view is centered, a larger one is clamped. Also pins that the scripted `pan()` uses that rule (a stand-in scene, no canvas) |
| `display.test.ts` | The scale rule of the display (`cssScaleFor`): the window table, 90% line, both scale modes, device pixel ratios (D14) |
| `shake.test.ts` | Screen shake keeps its on-screen size: strengths are scaled by 4/3 (`SHAKE_PIXEL_GAIN`), offsets stay whole pixels (D10) |
| `screen-literals.test.ts` | The screen-size scan (below): no bare `480`, `270`, `640`, `360` (and their half and off-by-one neighbors) in code, except on a listed line |
| `playback.test.ts`, `orders.test.ts`, `timing.test.ts`, `motion.test.ts` | Battle presentation logic without a canvas |
| `input.test.ts`, `ui-list.test.ts`, `actor.test.ts`, `atmosphere.test.ts`, `music.test.ts`, `content.test.ts` | Input, list menus, actors, weather and lighting, song bars and harmony, content references |

Balance targets live in `balance.test.ts` (`stages` array: win rate, rounds, HP lost per stage) and
`BOSS_WIN_MAX`. **When you change stats, abilities, items or encounters, run `balance.test.ts` and
`economy.test.ts`** and read the printed tables: most tuning is done by adjusting numbers until those pass.

### E2E (`e2e/`, Playwright)
Locally it runs **Edge**. One worker, one at a time. Run a single spec: `npx playwright test e2e/chaos.spec.ts
--reporter=line`; one test: `-g "name"`.

CI (`.github/workflows/ci.yml`) runs three jobs at the same time, so a pull request waits for the slowest one:

| Job | What |
|---|---|
| `check` | Lint, typecheck, unit tests, the bundle budget. The `main` ruleset requires this check, so keep the job name |
| `e2e` | Every spec except `playtest`, `shots` and `audio-evidence` (those two regenerate files), on Chromium |
| `e2e-engines` | `gameover` and `prod` on WebKit and Firefox |

The playtest has its own workflow, `.github/workflows/playtest.yml`. It runs on a push to `main` (not one that touches
only `docs/`, `tools/command-center/` or `.md` files) and from the Actions tab (**Run workflow**, on any branch), not
on pull requests. A change that touches only those paths skips the work. On a pull request, the jobs still start and
report success, because a required check that never reports blocks the merge. A new push to a pull request cancels
that pull request's earlier CI run. A run on `main` is never canceled once it starts.

| Spec | What |
|---|---|
| `playthrough.spec.ts` | The whole chapter through the real scripts (dialogs and fights auto-resolved) |
| `playtest.spec.ts` | A hands-off real-speed playtest; writes a frame every 2.5 s to `playtest/latest/`. CI runs it in `playtest.yml` |
| `gameover.spec.ts` | Game over flows, saves, storage failure, render/update faults, tabs, boot failure |
| `chaos.spec.ts` | Mashing keys through doors, menus mid-warp, reload mid-dialogue, keys through a battle |
| `prod.spec.ts` | The **shipped build** (builds fresh, serves on 3008): new game, save, reload, continue |
| `economy.spec.ts` | Zone walks and a shop in the real game, and the four-corner camera walk of the 640x360 move (every scrolling map at the four corners of its camera clamp; `SJ_CORNER_SHOTS=<folder>` also saves a picture of each corner, unset it writes nothing) |
| `gpufx.spec.ts` | The GPU effects layer (comes up, survives a battle, switches off and on, falls back to 2D) and the pixel-perfect block test: every game pixel an exact block at k=3 (1920x1080) and k=2 (1280x800) |
| `perf.spec.ts` | Frame budget in the plaza and a battle; input latency. `PW_NOGPU=1` reproduces CI's software canvas |
| `shots.spec.ts` | The screenshot set for `docs/screenshots/`. Deterministic: the game runs on Playwright's paused clock, with a fixed `Date.now()` (so a fixed RNG seed), pinned fights and a seeded `Math.random`; the header comment explains. For a compare across two commits set `SJ_BUILD_SHA=<label>` for both runs: the title draws the build's commit |
| `audio-evidence.spec.ts` | Renders every song and effect offline and measures them |

`PW_ALL_ENGINES=1` runs WebKit and Firefox locally too.

### The 640x360 move: the size scan and the screenshot tools
`docs/PIVOT-640.md` is the contract for the move from 480x270 to 640x360 (criteria, rubric, record). Its tools:

- **The scan** (`tests/screen-literals.test.ts`, helper `scripts/lib/source-scan.mjs`). It reads every `.ts` file under `src/` plus `vite.config.ts` and `scripts/bundle-budget.mjs`, drops comments and strings, and fails on a bare screen-size token (480, 270, 240, 135, 639, 359 and so on) that is on neither list. `tests/screen-literals.allow.json` holds hits that do not mean the screen, each with a reason (a price, a frame count, degrees, hertz). `tests/screen-literals.pending.json` holds hits that do mean the screen and that a work package of the move still replaces; its `wp` field names the package, and it only shrinks. An entry that matches nothing fails the test too. To rewrite the pending list from the current hits: `SCREEN_LITERALS_WRITE_PENDING=1 npx vitest run tests/screen-literals.test.ts` (it keeps the `wp` of every entry that still matches and marks new entries `?`). New layout code uses `W`, `H`, `BW`, `BHT` and `WORLD_SCALE`, never the number.
- **`node scripts/derived-literals.mjs`** lists derived layout values (464, 472, `W-16`, ...) per file. It is advisory and never fails; the scan cannot see them because they are not screen-size tokens.
- **`node scripts/pixel-diff.mjs <dirA> <dirB> [--diff-out <dir>]`** compares two sets of screenshots pixel by pixel and exits 1 on any difference (`--help` lists the mask options, which the deterministic capture made unnecessary). `--diff-out` draws every differing shot, and the report names that folder only when it wrote a picture. Two folders with no shot between them exit 2.
- **`node scripts/contact-sheet.mjs <baselineDir> <resultDir> <outPrefix> [--view gamepx|1080p]`** writes PNG pages that pair each baseline shot with its result. The captions come from the real picture sizes, so the sheet says which viewport each side came from. `--base` is read from the baseline's own pictures when it is not given (it tries the result's size, 480x270 and 640x360), and the caption says "the right picture is larger" only when it is; for a set of options at one size, pass `--base 640x360 --result 640x360`.
- **`node scripts/measure-battle-sprites.mjs [baseURL] [outFile]`** (with `npm run dev` running) measures the real party and enemy sprites and writes `tests/fixtures/battle-sprites.json`, which `tests/battle-geom.test.ts` reads to check that the enemy row stays above the party's heads. Run it again when that art changes size.
- **`node scripts/check-shots.mjs <dir>`** is the smoke check of the move (PL3): the area outside the old 480x270 frame must not be empty. `scripts/pivot-640.json` holds its void-allowed list.

Capture a set with `SJ_BUILD_SHA=<label> npm run shots`, copy `docs/screenshots` aside, then `git checkout -- docs/screenshots` (the set in git is regenerated once, at WP7).

### Tests vs design data
The stage tools come to `main` when the battle stage is built on the new engine (decision 17 in `docs/PHASE-0.2.md`). Follow this rule from the first commit of that build. The paths below are the paths on `spike/phaser-stage`.

Mark edits the design data (`src/data/stages.json`, `heroes.json`, `hud.json`, `axes.json`, `enemyfacing.json`) in the Battle Stage Editor and saves it. **A test never pins a value that a designer edits in a tool**, or it breaks every time he uses the tool. The rule for the stage tools (`src/stage`, `e2e/stage*`, `e2e/battletest*`, `tests/stage*`):

1. **Tests of the tool and of the algorithms use fixture data**, a frozen copy of the five files in `tests/fixtures/stagedata/`. Unit tests load it with `fixtureStages()`, `fixtureHeroes()` and friends from `tests/stagefiles.ts`; editor e2e specs get it for free, because `openEditor` (`e2e/stageeditkit.ts`) seeds the scratch copy (`?scratch=`) from it. A test that edits and saves asserts RELATIVE behaviour: the value changed by the drag, and undo restores the starting value read at the start of the test, never a number copied from Mark's file. Inline numbers are fine too (for example the bake tests feed their own heroes).
2. **Tests of the shipped data check invariants only**: every file loads with the loader the game uses, all four heroes are present, the hero ancestry order holds in the measured baked heights (Hex shorter than Kit and Rook, Sable the tallest, Rook at least as tall as Kit), the facing file covers every sprite, the files are in the stable format. They live in `tests/stageshipped.test.ts`, in the "shipped" blocks of `stageproportions` and `stagefacing`, and in `e2e/stageshipped.spec.ts`, which opens the editor on his current files (`openEditor(..., { data: 'current' })`). The editor's warnings must equal what `rules.ts` computes for the same stage (`ruleKeys` in the kit), with no fixed list of expected warnings.
3. **Design-rule warnings are advice and never fail a run.** The rules are tested on fixture stages and figures built to break each one (`tests/stagerules.test.ts`).
4. When a test needs to see a warning, break a rule on purpose in the scratch copy. Do not rely on a break that Mark's data happens to have.

When a test fails after Mark saved in the editor, the test is wrong, not his data. Fix the test to follow the rule above, never the data. If the algorithms change in a way that needs new fixture values, change the fixture in the same commit.

---

## 4. Debug tools (DEV builds only)

**The DEV menu:** on the game page (`http://localhost:3007/`), the DEV tab in the top-left corner (or the ` key)
lists every tool below with a line on what it's for; `/?devmenu` opens the page with it open, and the editors link
back to it. `npm run dev` prints the main ones under the server's addresses. The list is `src/dev/tools.ts`: a new
tool, page or route goes there. The menu isn't mounted under Playwright (`navigator.webdriver`) or in a build.

**URL routes** (`src/devroutes.ts`):
- `?scene=stage&stage=ID`: straight to a chapter preset (`start`, `town`, `sinkline`, `annex`, `finale`:
  `game/stages.ts`), with its party, levels, gear and flags.
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
   lines with ✓, ✘, passed, failed; put the run id and commit at the top). The log holds three jobs: the unit tests
   come from `check`, the Chromium specs from `e2e`, and the WebKit and Firefox lines from `e2e-engines`
   (`gh run view <id>` lists the job ids, and `--job <job id>` shows one job). The playtest is not in this run: it
   logs in the latest run of `playtest.yml` (`gh run list --workflow playtest.yml`).
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
  changes a scene, update or add its shot. The spec never waits on real time: every wait is a step of the page's
  fake clock (`advance(page, ms)`), so a `page.waitForTimeout` in it would break the same-bytes guarantee.
- **Importing a module by URL in a test page** (`import('/src/…')`) can hand back a *second copy* of it on a
  long-running dev server: a module edited since the server started is served to the app with a `?t=` query. Go
  through `window.__SJ__` (which holds the app's own copies) for anything with state (`settings`, `postfx`).
- **GPU effects in tests**: headless Chromium on CI has no GPU; WebGL is either missing (the game falls back to 2D)
  or software (slower: `PW_NOGPU=1` reproduces it locally). `e2e/gpufx.spec.ts` skips its WebGL checks where
  there's no WebGL 2 and always checks the fallback.
- **Evidence runs take ~25 minutes** and use ports 3007/3008; don't start a manual preview on 3008 during one.
- **`vite.config.ts` edited in several writes** (a script making one replacement at a time) can leave the dev
  server running a half-edited config. It restarts on the first write and may miss the rest (2026-10-02: one
  endpoint had the fix and another didn't). Write it in one go, or touch it afterwards, and confirm with a request.
- **The dev server's write endpoints write real files.** `/__rig/skeleton` writes `public/art/rig/skeleton.json`
  and `/__artpass/review` writes `media/art-pass/review.json`. Before probing one, back the file up and
  byte-compare it afterwards; the FX lab has `?dry=1`. All three refuse requests from other sites (`Origin` /
  `Sec-Fetch-Site`); a script with neither passes.

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
  a colour split, a bloom flare, a heat haze (a shimmering patch), a glitch (a rectangle whose slices slide and
  split colour) or a stage dim (the battlefield darkens, but anything glowing stays lit), each with a delay and an
  offset. "Test weight" and "Aim angle" stand in for the blow when you play it. Moments the game doesn't play yet
  can be made and saved; code has to call them. A preset can also gather inward (spawn on its radius, fly to the
  point): power drawn into a caster's hand.
- **Spells** (the Spells tab): casts a whole spell as the battle does, from a caster at the lower left onto the
  target (three targets for spells that hit everyone): its shapes (code, `src/battle/fx.ts`) and its two moments,
  `cast.<fx>` at the caster through the windup and `spell.<fx>` on each target as it lands. "Cast ›" and
  "Lands ›" jump to those moments to tune them. Any move whose effect id has `cast.`/`spell.` moments gets them in
  battle (`scenes/battlekit/gpufx.ts` `gpuCast`, `gpuSpell`, called from playback's windup).
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
Mark cancels the plan around 2026-10-30: what it does, what we learned and what replaces each capability is in
`docs/PIXELLAB-LESSONS.md`.
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

### Rig v2: characters drawn in code
- **Posing the crew in battle: the animation editor.** `npm run dev`, then `/rigedit.html`. Pick someone and a
  pose; drag the hand (orange) and the elbow bends by itself (IK); drag the elbow (blue) across the arm to flip the
  bend; the green dot turns the hand and what it holds; sliders for a weapon's angle, how far the hand reaches into the screen (also the side view), the light.
  The faint figure is the pose the move comes from; "Play the move" loops it at game speed. A character with a
  free arm (Rook) shows its hand as a pink dot: one pose for that arm, shared by every one-handed pose (out for balance), and
  a "Stance" section bends the knees, spreads the feet and puts the right foot forward for every pose (`free` and
  `stance` in `skeleton.json`; standing stays as traced). "Both hands on the sword" puts the free hand on the grip in
  that pose; "Arm length" lets a drawn arm reach overhead or across behind the body. Rook also has a **Raised** pose
  (`windup`) between Ready and Strike: the battle shows it from halfway through a swing's gather, as its attack
  frame. **A new field** on a pose, an arm or a stance (in `battle.ts`) also goes into `src/art/rig2/check.ts`.
  The save refuses data that check doesn't know, and `tests/rigcheck.test.ts` checks the shipped `skeleton.json`
  against it. His strike poses also lean the body from the hips, drop it and move each foot (`lean`, `drop`, `feet` on a
  pose, about the stance's `hip` and `neck`; data only, no editor controls yet), and his katana is drawn pixel by
  pixel in one style, the same at any angle (`katana()` in `battle.ts`). **Save** writes
  `public/art/rig/skeleton.json` (commit it to ship). "Skeleton setup…" moves the rest joints and how far each
  bone's pixels reach (once per character). **Notes for Claude:** each pose has a note box; the notes are saved in
  `skeleton.json` (`notes`), and a session works through them (read the note, change the pose or the skeleton,
  re-render with `node scripts/art/review-rig.mjs`, clear the note).
- **Tracing a character:** add it to `SOURCES` in `scripts/art/trace.mjs` (the PixelLab frames to trace), run it,
  and give its look `rig: '<name>'` in `src/data/looks.ts`. The tracer writes `public/art/rig/field.json`, `battle.json`, `enemies.json` (each enemy's review pick, from `ENEMY_SPRITE`) and `portraits.json` (each portrait pick with its redrawn faces; eye and mouth boxes in `PORTRAIT_FEATURES`, read off the neutral face), which the game loads at startup (`src/art/rig2/data.ts`; `?rig=old` skips them)
  (regenerate, don't hand-edit).
- **Reviewing it:** `node scripts/art/review-rig.mjs --label "what changed"` (dev server running) renders every rig
  character's standing frames and walks onto the review page (categories "Rig v2 · crew / battle / enemies / portraits / NPCs / townsfolk") as a new version beside
  the earlier ones, with the old code-drawn sprite as "Now" (no PixelLab sprites: Mark found them clutter; the page's
  "+ PixelLab archive" chip shows the old art-pass assets). An unchanged render isn't added as a new version. Mark flags frames and leaves
  notes there like any other asset; read them with `node scripts/pixellab/status.mjs --review`.
- **Tuning the animation:** `src/art/rig2/rig.ts` (`STRIDE`, `BOB`, how feet lift). Change, re-run the review
  script, compare versions.
- **The dev server can serve a stale module for a few seconds after an edit** (it polls for changes), and a module
  edited since it started is served as `name.ts?t=…`: a plain `import('/src/…')` in a script gets a second copy
  with its own state. `review-rig.mjs` imports `portraits.ts` by the game's own URL for that reason; if a version
  comes out unchanged after an edit, run it again.

### A new save field
Add it to `GameState` and `newState()`. If it's purely additive, give it a default in `backfill()` (`save.ts`). If
it renames or reshapes data, bump `SAVE_VERSION` and add a `MIGRATIONS[oldVersion]` step, with a test against a
fixture.

### A new screenshot
A `test()` in `e2e/shots.spec.ts` using `open(page, stage)`, `sj(page, …)`, `advance(page, ms)` for every wait
(never `page.waitForTimeout`), `battle(page, enc, bg)` for a fight (it pins the random tables) and `shot(page, name)`;
if reviewers should see it, add it to an area's list in `scripts/verifier-prompts.py`. Run the spec twice and compare
the new PNG's bytes: a shot that differs between two runs of one build is a bug in the shot.

---

## 9. Versions, releases and spikes

The why (and the decisions behind it) is in `docs/PHASE-0.2.md`, "Versioning and releases". This is the how-to.

**Where the version lives.** `package.json` `"version"` is the only place to edit it. Vite's `define:` injects it (plus the short git SHA) at build time, `src/version.ts` re-exports it, and it shows on the title screen and in the DEV tab, and `window.__SJ__.version` exposes it on the dev server (never in the shipped game) so test runs and playtest notes can name their build.

**Minor or patch while 0.x.** Minor (0.2.0 to 0.3.0) is anything a player would call a different build: a battle view, an engine, a new chapter or zone, a new system, a save reshape, a new art pipeline. Patch (0.2.0 to 0.2.1) is fixes, balance numbers, copy, and art swaps that change no system. Day-to-day work on `main` carries a `-dev` suffix (`0.2.0-dev`). The major number stays 0 until Mark says 1.0.

**Changelog.** `CHANGELOG.md` is Keep a Changelog 1.1.0: `Unreleased` on top, ISO dates, headings Added / Changed / Deprecated / Removed / Fixed / Security. Every feature PR adds its entry under `Unreleased`.

### Cutting a release

Mark's playtest and go-ahead come first. Pushing a tag and creating a GitHub Release each need his explicit yes.

1. Move the `Unreleased` entries under a new `[X.Y.Z] - date` heading in `CHANGELOG.md` (the date is the day the tag is cut; if the PR merges on a later day, correct it in the follow-up bump PR) and set `"version"` in `package.json`.
2. Open the PR. Mark merges it.
3. Tag the merge commit, annotated: `git tag -a vX.Y.Z -m "Shadow Jog X.Y.Z: one-line summary" <merge-sha>`.
4. Push the tag: `git push origin vX.Y.Z`. A pushed release tag is never moved or deleted.
5. `gh release create vX.Y.Z --prerelease --notes-file <notes.md>`. The whole 0.x line is marked pre-release.
6. A small follow-up PR bumps `"version"` to the next `-dev` (for example `0.2.0-dev`).

`snapshot/*` tags are dated checkpoints and `archive/*` tags are abandoned spikes. `v*` is the only release prefix.

### Spikes

A spike is a time-boxed experiment that answers one question. It lives on a `spike/<topic>` branch with a **draft PR that is never merged**; if it works, the good parts are rebuilt on a normal feature branch. Before any spike code, commit `docs/spikes/<topic>.md` with the question, time box and dated exit criteria (template and rules: `docs/spikes/README.md`). Any deploy of a spike build, even a preview URL, needs Mark's go-ahead.

To abandon one: fill in the Result section of its doc (ABANDONED, date, reason, numbers), tag the branch tip `archive/<topic>-YYYY-MM-DD` (pushing it needs Mark's go-ahead), close the draft PR, delete the branch, and note it in `docs/spikes/`.

### Save policy

`SAVE_VERSION` (`src/game/state.ts`) is independent of the app version. Bump it only when a field is renamed or reshaped, and add a `MIGRATIONS[oldVersion]` step plus a unit test against a fixture save from the previous version (see "A new save field" in section 8). Purely additive fields need no bump: `backfill()` fills them in. A newer 0.x build must load any older 0.x save. Wipes happen only on purpose, announced in-game and in the changelog, never from a half-working migration.

---

## 10. The Command Center

`tools/command-center/` is a local website for the project: what is going on now, every doc in one place, and the design decisions that wait on Mark. It is a separate package with its own `package.json`, lock file and `node_modules`. It imports nothing from `src/`, and the game does not depend on it. Full guide: `tools/command-center/README.md` (install, config keys, how to add a nav section, how decisions work, trouble signs). Design: `docs/command-center/design.md`.

- **Start:** `npm run cc` from the repo root. It installs the tool's packages, builds the page, starts the server on **3009** and opens a tab. Set `CC_NO_OPEN=1` to skip the tab (every test and automated run does).
- **Check it:** `npm --prefix tools/command-center run check` (typecheck and Vitest) and `npm --prefix tools/command-center run e2e` (Playwright, on its own server at **3010**). The root `npm run check` does not run them, and CI skips a change that touches only `tools/command-center/`: run both before you push a change there.
- **Read-only, with one write.** The server reads the repo, `git`, `gh` and the Claude session files. Its one write is Mark's answer to a decision issue, through `gh`. `tests/no-fs-write.test.ts` fails if the server's source can write a file.
- **A new doc** shows in the command center on its own. If it belongs in a section, add it to `tools/command-center/nav.json`: a doc that no section names lands under "Other".
- **Raise a decision** only when it blocks work, changes an approved design, or touches more than one session or branch. The rule and the commands are in `CLAUDE.md` ("Decisions for Mark").
