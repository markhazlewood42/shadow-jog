---
type: reference
title: CI strategy (Shadow Jog)
---

# CI strategy

This is the full picture of CI for Shadow Jog. The workflow is `.github/workflows/ci.yml`. The playtest has its own workflow, `.github/workflows/playtest.yml`.

![The CI pipeline: check, eight e2e shards, the e2e gate and e2e-engines run side by side](ci/pipeline.svg)

## What runs, and when

| Event | What happens |
|---|---|
| Pull request, game or code change | `check`, eight e2e shards, the `e2e` gate and `e2e-engines` all run. A new push cancels the earlier run of the same pull request |
| Pull request, docs-only change | Every job still starts and reports. `check` runs only the roadmap test. The shards and `e2e-engines` skip their steps |
| Push to `main` | The same jobs run, unless the push changes only docs, notes, `tools/command-center/` or the Claude review workflow. A run on `main` is never canceled once it starts |
| Push to `main` (playtest) | `playtest.yml` runs the real-speed playtest. It does not run on pull requests |
| Manual run | Actions tab, CI, **Run workflow**. A manual run is always a full run |

"Docs-only" means that every changed file is under `docs/` or `tools/command-center/`, is a `*.md` file, or is `.github/workflows/claude-code-review.yml`. If git cannot list the changed files, the jobs run in full. The check fails closed.

## The jobs

| Job | Check name | What it does | Time of tests |
|---|---|---|---|
| `check` | `check` | Lint, typecheck, unit tests (Vitest), the bundle budget (since M7 it counts the lazy 3D chunk apart from the game total) | about 40 seconds |
| `e2e-shards` | `e2e (1/8)` to `e2e (8/8)` | The Playwright specs on Chromium, one spec list per shard | about 6 minutes each (target; see below) |
| `e2e` | `e2e` | The gate. It passes only when every shard passed | about 3 seconds |
| `e2e-engines` | `e2e-engines` | `gameover` and `prod` on WebKit (the whole flow, and since M7 the case that loads the hashed 3D chunk from the shipped build) and Firefox (the "no WebGL 2" message; the chunk case is skipped there) | about 4 to 5 minutes |

All jobs start together. The `e2e` gate is the only job that waits, and it waits only for the shards. A pull request waits for the slowest shard. Before this change that was about 12 minutes: the slowest of the four old shards in run `38150548004` took 691 seconds of tests plus the setup.

The target is about 7 minutes on a normal runner (about 6 minutes of tests plus the setup). Measured on run `38188864991` (three attempts, all green): 9.9, 9.8 and 7.0 minutes of wall time. The slowest shard changed from run to run (`e2e (6/8)` took 9.8, 9.7 and then 4.4 minutes), so the spread comes from the runner, not from the shard lists. A slow runner can still push one run past 10 minutes: the attempts of one spec differ by up to 35%. The balance cannot do much better, because the longest spec (`sje-field-parity-a`, 364 seconds) is already more than the average of 355 seconds (2,838 seconds divided by eight). The first run with six shards (`38182602108`) took about 16 minutes, because one shard held six skipped tests that each took a minute (see below). Mark chose eight shards on 2026-10-11 and then to stop here (see "Parked ideas").

The repo is public, so GitHub-hosted runner minutes cost nothing. More shards cost no money.

## The eight shards

The specs are split by name, not with Playwright's `--shard`. `--shard` splits by test count, and the tests differ a lot in cost (a field parity state takes 24 to 52 seconds, an `fxlab` test about 5). The lists are balanced by measured time.

The seconds below are the larger of the two attempts of the run `38182602108` (one worker, the `list` reporter). The attempts differ by up to 35% on the same spec, because the runners differ, so a shard can be a minute off.

| Shard | Specs | Seconds |
|---|---|---|
| `e2e (1/8)` | `sje-field-parity-a` 364, `sje-scene3d` 45 (estimate) | 409 |
| `e2e (2/8)` | `sje-field-parity-c` 322, `chaos` 61, `fxlab` 16 | 399 |
| `e2e (3/8)` | `default-path` 285, `prod` 123 | 408 |
| `e2e (4/8)` | `sje-field-parity-d` 142, `sje-battle` 119, `gameover` 144 | 405 |
| `e2e (5/8)` | `playthrough` 218, `economy` 131, `sje-fx` 62 | 411 |
| `e2e (6/8)` | `sje-hack` 312 (M7), `sje-shell` 56, `gpufx` 40 | 408 |
| `e2e (7/8)` | `sje-draws` 159, `sje-field` 149, `sje-canaries` 82 | 390 |
| `e2e (8/8)` | `sje-field-parity-b` 292, `sje-stage-parity` 77 | 369 |

**Rebalance after run `38337948613` (2026-10-13).** Shard 8/8 took 9m19s (513 seconds of tests: field parity B had grown to 292 seconds, from 165) and 4/8 took 5m05s (260 seconds). The median of the other shards was about 400 seconds. `gameover` (144 seconds) moved from 8/8 to 4/8, so 8/8 now holds about 369 seconds and 4/8 about 404. The other shards are as the table says (measured: 1/8 418, 2/8 388, 3/8 293, 5/8 409, 7/8 381); 6/8 (`sje-hack`) had not finished in that run, so it is not re-measured. Measure the new split on the next green run.

**M7 (2026-10-12) moved most specs.** The 3D mode added `sje-hack` (56 tests, 312 seconds on the bundled Chromium on SwiftShader, measured locally, not on CI): it runs the 3D hack scene on the real game page, and its cases of the jump between 2D and 3D capture every frame of three styles at three effects levels. Put in the old shard 6/8 it would have made that shard 661 seconds, so the eight lists were packed again (longest first, into the shortest shard) with the spec kept in 6/8, as pass line 18 of `m7-brief.md` says. The total is about 3,200 seconds, so eight shards average 400 seconds (355 before). `sje-scene3d` was never measured on CI; 45 seconds is an estimate from a local run. `prod.spec.ts` has a new case that loads the hashed 3D chunk from the preview server by its manifest name, and `default-path.spec.ts` asserts that a normal run makes no request for the 3D chunk. Measure the shards on the first CI run of the M7 pull request and rebalance if one is a minute off (the procedure is below).

`sje-field-parity-c` is 316 seconds for its 10 states plus an estimate of 6 seconds for its 6 GPU-only states, which skip themselves on CI. This estimate is not measured yet. No spec is split further: `sje-field-parity-a` is the longest and `sje-hack` the next, and the `playthrough` (218 seconds) is one test. The seconds of the other specs are from the run `38182602108`; the total of that run was 2,838 seconds.

Each shard needs 24 to 46 seconds of setup (checkout, `npm ci`, the Chromium download) before the test command starts, and 3 to 6 seconds more from the command to the first test (the server start). Both ranges are measured in the run `38182602108`. The cap is 30 minutes for each shard.

### Why one shard took 16 minutes in the first run (six shards)

In run `38182602108` the shard `4/6` (of the six-shard layout) held `sje-field-parity-c`, `gameover` and `sje-canaries`. They had 540 seconds of passed tests, but the job took 16 minutes in both attempts. The reason: `sje-field-parity-c` has 6 GPU-only states. Each one rendered the full effect stack on SwiftShader (about 52 to 72 seconds) and only then skipped itself, because it has no reference for a software renderer. Six skips took about 6 minutes. The `list` reporter shows them as `-` lines with no time, so the time did not show in the totals.

The fix is in `e2e/sjefieldparityparts.ts`: a state with a `kinds` list now checks the renderer on a bare page and skips before it renders. No test asserts anything different. After the fix, that shard has no hidden time.

The field parity set is four files. Playwright names a test by the file that calls `test()`, so one file cannot be split across shards. The test bodies live in `e2e/sjefieldparityparts.ts`.

| File | Holds |
|---|---|
| `sje-field-parity-a` | The inputs check, and states 0 to 7 (the town street and the world map, with their variants) |
| `sje-field-parity-b` | States 8 to 14 (the world map by day, the yard, the sinkline, the annex, the dock) |
| `sje-field-parity-c` | States 15 to 30 (the interiors, and 6 GPU-only states, which skip themselves on CI before they render) |
| `sje-field-parity-d` | The 6 controls (each must fail the bounds) |

### Specs that CI does not run

These are on the `NOT_IN_CI` list in `tests/ci-shards.test.ts`, each with its reason.

| Spec | Why |
|---|---|
| `perf` | Frame timing needs a real GPU. Run `npm run perf` locally |
| `sje-bench` | Times a GPU with 1,000 objects. Local only |
| `shots` | Regenerates `docs/screenshots/`. It makes pictures and judges nothing |
| `audio-evidence` | Writes reports under `docs/quality/evidence/audio/`. It makes files and judges nothing |
| `playtest` | The real-speed playtest. It has its own workflow, `playtest.yml` |
| `sje-pictures` | The pictures for the M3 look review. Local only |

## The `e2e` gate, and the required checks

The `main` ruleset requires three checks: `check`, `e2e-engines` and `e2e`. Mark set this on 2026-10-11, when PR #64 merged (merge `6554cdb`). The four old names, `e2e (1/4)` to `e2e (4/4)`, are gone from the ruleset.

The shard names (`e2e (1/8)`) must not be required. A required check that never reports blocks the merge for ever, so a ruleset that lists shard names breaks whenever the shard count changes. The `e2e` gate has one stable name. It `needs` the shard job and runs with `if: always()`. It fails unless the shard result is `success`. A failed, cancelled or skipped shard makes the gate fail.

`if: always()` matters. Without it, a failed shard would skip the gate, and a skipped job reports success.

The job id of the shard matrix is `e2e-shards`, so the gate can have the id and name `e2e`. Do not rename the jobs `check`, `e2e` or `e2e-engines`: the ruleset matches the names.

## The docs-only skip

Every job has the same first step, "Check which files changed". It compares the pull request with its base. If every changed file is a docs file, the later steps skip. The job itself never skips, because a skipped job reports success without checking anything. Each job has its own copy of the step, on purpose: one shared detection job could fail, and a required check must not depend on it.

On a docs-only pull request, `check` still runs `tests/roadmap.test.ts`. That test reads `docs/engine/migration.md` and `docs/roadmap/*`, so the skip must not hide drift there. It costs `npm ci` and one Vitest file.

## Add a new spec

1. Write `e2e/<name>.spec.ts`.
2. Add it to the shard with the smallest total in `ci.yml` (matrix `specs`). Or add it to `NOT_IN_CI` in `tests/ci-shards.test.ts`, with a reason.
3. Run `npx vitest run tests/ci-shards.test.ts`.

The test fails if a spec is in no shard and not on `NOT_IN_CI`, if a spec is in two shards, or if a listed file does not exist. It has negative controls, so it can fail.

## Rebalance the shards

1. Open a recent green run on `main`. Read the `list` reporter lines of each shard. Each line ends with the test time.
2. Add up the seconds for each spec file. A skipped test (a `-` line) shows no time: use the gap to the line before it. A long gap means the test ran before it skipped.
3. Move specs between the lists in `ci.yml` until every shard is close to the total divided by the number of shards.
4. Update the comment above the matrix with the new totals and the run id.
5. Run `tests/ci-shards.test.ts`. No ruleset change is needed, because the gate is the only required shard check.

To split a spec file that is the floor, share its test bodies in a helper (like `sjefieldparityparts.ts`) and write more spec files. Do not change what a test checks.

## Force a full run

- On a pull request, push a change to any file that is not a docs file. Or push a commit that touches one `src/` or `e2e/` file.
- By hand: Actions tab, CI, **Run workflow**, pick the branch. The scope step runs only on a pull request, so a manual run is always full.

## Run one shard on your machine

```bash
CI=1 PW_PORT=3012 npx playwright test --project=chromium <the specs of one matrix entry in ci.yml>
```

## Parked ideas

These are not built. Mark decided on 2026-10-11 to go to eight shards, fix the flaky test and stop there. Each idea below was meant as a throwaway draft pull request that is closed after, never merged, with the numbers going to Mark before any build. Pick one up only if pull request waits grow again.

### L3. A test build instead of the dev server

Every boot loads hundreds of unbundled modules from the Vite dev server, with software WebGL. A test build (`vite build --mode e2e`, with the `window.__SJ__` hooks on) served by `vite preview` may boot much faster.

- Measure: one CI run times 5 boots on the dev server against 5 boots on a test build.
- Adoption line: adopt only if a boot is at least 30% faster.
- Risk: the hooks must stay out of the shipped bundle. The bundle budget test and `prod.spec.ts` already check the shipped build.

### L4. Two workers per shard

`playwright.config.ts` has `workers: 1`.

- Measure: set `workers: 2` on one shard, and run it 3 times. Count flakes and compare the times.
- Adoption line: adopt only with 0 new flakes in 3 runs. Earlier slow-runner failures (Game Over, the battle golden, the playthrough) show that CPU load breaks timing-sensitive tests.
- The balance alone puts the floor at about 6 minutes of tests per shard (about 2,840 seconds divided by eight, with the 364-second `sje-field-parity-a` as the longest). To go lower, L3 or L4 must cut the total.

### L5. Fixed waits to condition waits

143 `waitForTimeout` calls hold about 124 seconds of fixed delay. Replace the waits in `prod`, `gameover`, `economy` and `gpufx` (about 84 seconds) with waits on a state. Each change needs a negative control. It also removes a cause of flakes.

### A tiered suite

Mark asked for this on 2026-10-11.

1. A smoke set of about 10 to 15 e2e tests, about 2 to 3 minutes. The game and the shipped build boot to the title with no errors. A new game, a few field steps, and one battle started and finished. Save, reload and continue. The lab pages open. `check` still runs on every push.
2. The full suite (goldens, parity, the playthrough, chaos, WebKit and Firefox) runs in one of two ways. Either when a pull request is marked "ready for review": draft pushes run only the smoke set, and one full run happens before the merge, which suits pull requests with many pushes like #58. Or after the merge to `main`, or nightly: that is faster, but a break shows only after it is on `main` and needs a fix pull request.
3. Required checks: the `e2e` gate would need to accept the smoke-only result on a draft pull request.

Parked, not built. Adopt it if pull request waits grow again.

## The flaky battle notice test (fixed)

`e2e/sje-battle.spec.ts` "a stage chunk that fails to load" failed in 2 of 4 CI runs (`38185184825` and `38183421640`): `sj.notice()` returned `null`. The cause was in the test. A notice clears itself 6 seconds after it was posted (`currentNotice` in `src/engine/errors.ts`, real time, by design). The failure notice is posted when the stage chunk fails to load, right after the battle opens. The test then waited up to 60 seconds for the round menu and read the notice last. On a slow runner the fight took more than 6 seconds to reach the round menu, so the notice had already cleared. Locally the fight takes about 2 seconds, so the test passed. A wait of 6.5 seconds before the read makes it fail every time. The test now waits for the notice text and checks it first, before the slow wait. The game was right, so `src/` did not change.

## Not done

- **Path selection** (run only the specs that a change can touch). Of the last 30 merged pull requests, 18 were docs-only (already skipped) and 9 touched game files (13 of 17 specs boot the whole game). The gain is small. The named spec lists make it easy to add later.
- **A Playwright browser cache.** It would save about 20 seconds per shard. Playwright advises against it, and the system packages that `--with-deps` installs cannot be cached.
- **L3, L4, L5 and the tiered suite** are under "Parked ideas".
