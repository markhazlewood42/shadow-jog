---
type: reference
title: CI strategy (Shadow Jog)
---

# CI strategy

This is the full picture of CI for Shadow Jog. The workflow is `.github/workflows/ci.yml`. The playtest has its own workflow, `.github/workflows/playtest.yml`.

![The CI pipeline: check, six e2e shards, the e2e gate and e2e-engines run side by side](ci/pipeline.svg)

## What runs, and when

| Event | What happens |
|---|---|
| Pull request, game or code change | `check`, six e2e shards, the `e2e` gate and `e2e-engines` all run. A new push cancels the earlier run of the same pull request |
| Pull request, docs-only change | Every job still starts and reports. `check` runs only the roadmap test. The shards and `e2e-engines` skip their steps |
| Push to `main` | The same jobs run, unless the push changes only docs, notes, `tools/command-center/` or the Claude review workflow. A run on `main` is never canceled once it starts |
| Push to `main` (playtest) | `playtest.yml` runs the real-speed playtest. It does not run on pull requests |
| Manual run | Actions tab, CI, **Run workflow**. A manual run is always a full run |

"Docs-only" means that every changed file is under `docs/` or `tools/command-center/`, is a `*.md` file, or is `.github/workflows/claude-code-review.yml`. If git cannot list the changed files, the jobs run in full. The check fails closed.

## The jobs

| Job | Check name | What it does | Time of tests |
|---|---|---|---|
| `check` | `check` | Lint, typecheck, unit tests (Vitest), the bundle budget | about 40 seconds |
| `e2e-shards` | `e2e (1/6)` to `e2e (6/6)` | The Playwright specs on Chromium, one spec list per shard | about 8 minutes each (target; see below) |
| `e2e` | `e2e` | The gate. It passes only when every shard passed | about 3 seconds |
| `e2e-engines` | `e2e-engines` | `gameover` and `prod` on WebKit (the whole flow) and Firefox (the "no WebGL 2" message) | about 4 to 5 minutes |

All jobs start together. The `e2e` gate is the only job that waits, and it waits only for the shards. A pull request waits for the slowest shard. Before this change that was about 12 minutes: the slowest of the four old shards in run `38150548004` took 691 seconds of tests plus the setup.

The target is about 9 minutes (about 8 minutes of tests plus the setup). It is not measured yet. The balance cannot do better, because the total test time (about 2,840 seconds) divided by six is about 473 seconds. The first run with six shards (`38182602108`) took about 16 minutes, because one shard held six skipped tests that each took a minute (see below). The run on the fixed head will show the real number.

The repo is public, so GitHub-hosted runner minutes cost nothing. More shards cost no money.

## The six shards

The specs are split by name, not with Playwright's `--shard`. `--shard` splits by test count, and the tests differ a lot in cost (a field parity state takes 24 to 52 seconds, an `fxlab` test about 5). The lists are balanced by measured time.

The seconds below are the larger of the two attempts of the run `38182602108` (one worker, the `list` reporter). The attempts differ by up to 35% on the same spec, because the runners differ, so a shard can be a minute off.

| Shard | Specs | Seconds |
|---|---|---|
| `e2e (1/6)` | `default-path` 285, `sje-battle` 128, `chaos` 61 | 474 |
| `e2e (2/6)` | `sje-field-parity-a` 364, `sje-shell` 56, `gpufx` 40, `fxlab` 16 | 476 |
| `e2e (3/6)` | `sje-field-parity-b` 165, `gameover` 143, `sje-canaries` 82, `sje-stage-parity` 82 | 472 |
| `e2e (4/6)` | `sje-field-parity-c` 322, `sje-field` 149 | 471 |
| `e2e (5/6)` | `sje-field-parity-d` 257, `playthrough` 218 | 475 |
| `e2e (6/6)` | `sje-draws` 159, `economy` 131, `prod` 118, `sje-fx` 62 | 470 |

`sje-field-parity-c` is 316 seconds for its 10 states plus an estimate of 6 seconds for its 6 GPU-only states, which skip themselves on CI. This estimate is not measured yet.

Each shard needs 24 to 46 seconds of setup (checkout, `npm ci`, the Chromium download) before the test command starts, and 3 to 6 seconds more from the command to the first test (the server start). Both ranges are measured in the run `38182602108`. The cap is 30 minutes for each shard.

### Why shard 4/6 took 16 minutes in the first run

In run `38182602108` the shard `4/6` held `sje-field-parity-c`, `gameover` and `sje-canaries`. They had 540 seconds of passed tests, but the job took 16 minutes in both attempts. The reason: `sje-field-parity-c` has 6 GPU-only states. Each one rendered the full effect stack on SwiftShader (about 52 to 72 seconds) and only then skipped itself, because it has no reference for a software renderer. Six skips took about 6 minutes. The `list` reporter shows them as `-` lines with no time, so the time did not show in the totals.

The fix is in `e2e/sjefieldparityparts.ts`: a state with a `kinds` list now checks the renderer on a bare page and skips before it renders. No test asserts anything different. After the fix, the shard `4/6` has no hidden time.

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
| `sje-scene3d` | An open decision for Mark. It was never in a CI list, and its header says it can run on SwiftShader "like CI", so it may belong in a shard. Until Mark decides, it stays here |

## The `e2e` gate, and the required checks

From PR #64 on, the `main` ruleset must require three checks: `check`, `e2e-engines` and `e2e`. **Mark changes the ruleset when he merges PR #64.** Until then it still requires the four old names, `e2e (1/4)` to `e2e (4/4)`, which no run reports any more. Change the ruleset right before the merge, or the merge stays blocked.

The shard names (`e2e (1/6)`) must not be required. A required check that never reports blocks the merge for ever, so a ruleset that lists shard names breaks whenever the shard count changes. The `e2e` gate has one stable name. It `needs` the shard job and runs with `if: always()`. It fails unless the shard result is `success`. A failed, cancelled or skipped shard makes the gate fail.

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
3. Move specs between the lists in `ci.yml` until every shard is close to the total divided by six.
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

## Experiments next

These are not built. Each is a throwaway draft pull request that is closed after, never merged. The numbers go to Mark before any build.

### L3. A test build instead of the dev server

Every boot loads hundreds of unbundled modules from the Vite dev server, with software WebGL. A test build (`vite build --mode e2e`, with the `window.__SJ__` hooks on) served by `vite preview` may boot much faster.

- Measure: one CI run times 5 boots on the dev server against 5 boots on a test build.
- Adoption line: adopt only if a boot is at least 30% faster.
- Risk: the hooks must stay out of the shipped bundle. The bundle budget test and `prod.spec.ts` already check the shipped build.

### L4. Two workers per shard

`playwright.config.ts` has `workers: 1`.

- Measure: set `workers: 2` on one shard, and run it 3 times. Count flakes and compare the times.
- Adoption line: adopt only with 0 new flakes in 3 runs. Earlier slow-runner failures (Game Over, the battle golden, the playthrough) show that CPU load breaks timing-sensitive tests.
- The balance alone puts the floor at about 8 minutes of tests per shard (about 2,840 seconds divided by six). To go lower, L3 or L4 must cut the total.

## Known flaky

One observation, not fixed. In a control run, `e2e (3/6)` failed `sje-battle.spec.ts:255` ("a stage chunk that fails to load"): `sj.notice()` returned `null`. The same test passed on the real pull request runs. If it fails again, look at the timing of the notice first.

## Not done

- **Path selection** (run only the specs that a change can touch). Of the last 30 merged pull requests, 18 were docs-only (already skipped) and 9 touched game files (13 of 17 specs boot the whole game). The gain is small. The named spec lists make it easy to add later.
- **A Playwright browser cache.** It would save about 20 seconds per shard. Playwright advises against it, and the system packages that `--with-deps` installs cannot be cached.
- **L5: fixed waits to condition waits.** 143 `waitForTimeout` calls hold about 124 seconds of fixed delay. Replace the waits in `prod`, `gameover`, `economy` and `gpufx` (about 84 seconds) with waits on a state. Each change needs a negative control. It also removes a cause of flakes.
