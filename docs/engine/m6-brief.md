---
type: plan
title: "Shadow Jog Engine — M6 build brief"
project: shadow-jog
created: 2026-10-10
updated: 2026-10-10
tags: [engine, m6, plan, flip]
---

# M6 Flip default: build brief

Source: [migration.md](migration.md) "M6 Flip default", principle 12 (GPU timing once, by the main session), the ET table row for the FX lab, [decisions.md](decisions.md) E5, [m5-brief.md](m5-brief.md) (format), and the lean loop in `CLAUDE.md`. Branch: `engine-m6-flip` (from `main` after PR #54). Pass lines come first in value: they were written before any task. **Nothing is built until Mark approves this brief.**

Facts in section 2 come from a read-only survey on 2026-10-10 (grep and `npm run budget`, no code run in a browser). Task 1 re-checks each one.

## 1. Goal

- With no flag, the game starts on the Pixi engine. `src/main.ts` always calls `startSje`. The old `start()` path is gone.
- `GlPresenter` (`src/engine/gl/presenter.ts`, 588 lines) and the `#fx` overlay canvas are gone. Effects come only from `game.fx`.
- The FX lab runs on the new engine and no longer imports the old `Display`, `Game` or `postfx`.
- A browser without WebGL 2 shows the E5 message and nothing else.
- Bundle caps, perf gates and specs describe the new default. Goldens exist for the default path.
- Not in M6: M4 UI scenes (optional), 3D mode (M7), deleting `src/engine/{game,display,postfx}` (M8), the other editors (ET after M6).
- Exit check (migration.md): full CI green on SwiftShader. Playthrough, chaos, perf, prod and gameover pass.

## 2. Survey facts that change the plan

- **The flag gate is one line.** `src/main.ts:88` tests `engine === 'sje'` and imports `./sje/boot`. Else it runs `start()` (lines 1 to 77), the only runtime user of the old `Game`, `Display` and `postfx.active`. `src/boot.ts` takes `Game` and `Display` as parameters, so it does not change.
- **`postfx` cannot go in M6.** `src/engine/postfx.ts` (17 lines) is the singleton that 9 `src` files call (`scenes/battle.ts`, `scenes/field.ts`, `scenes/options.ts`, `engine/moments.ts`, `scenes/battlekit/*`, `fieldstage/stagescene.ts`, `sje/boot.ts`, `sje/fx/route.ts`). Under the flag `routePostfx` points it at `game.fx`. **migration.md M6 says "remove the `#fx` path"; that is right. M8 deletes `postfx`.** M6 keeps the singleton and its route.
- **Old presenter users:** `GlPresenter` is imported only by `src/engine/display.ts` (153 lines). `Display` is used by `src/main.ts`, by `src/dev/fxlab.ts` and by type in `src/boot.ts`. After `main.ts` stops using it, `Display` is type-only and dead code. Delete `gl/presenter.ts` and the GL half of `display.ts` in M6; M8 deletes the rest.
- **`#fx` readers:** `e2e/gpufx.spec.ts` (169 lines, 8 hits), `e2e/sjefieldkit.ts` (1 comment), `src/dev/trailer.ts:155` (`getElementById('fx') ?? 'screen'`), `src/engine/display.ts`, `src/sje-lab/{fxpanel,stagelab}.ts` and `src/battlestage/demo.ts` (comments or lookups to check), `tests/playback.test.ts`. The new path asserts `getElementById('fx')` is null (`e2e/sje-fx.spec.ts:135`).
- **FX lab:** `src/dev/fxlab.ts` is 901 lines. It imports the old `Display` (type, calls `toGame`, `resize`), `Scene` from `engine/game`, `postfx` (9 calls), `playMoment`, `gpuCast`, `gpuSpell`. It opens through `src/devroutes.ts:21` (`?scene=fxlab`). `e2e/fxlab.spec.ts` (71 lines, 2 `goto` calls) runs it on the old path. A newer panel exists at `src/sje-lab/fxpanel.ts` (89 lines), which is the engine-lab form, not the game's FX lab.
- **Bundle (measured with `npm run budget` today):** game gzip total 408.9 kB (cap 409), flag-only class 49.1 kB (`liveopen` 41.5 + `fieldopen` 7.6; cap 50, not in the total), boot class 202.0 kB, lazy-2d 155.1 kB, lazy-other 51.9 kB, first play (boot + lazy-2d) 345.7 kB with no cap. Largest chunk `index` 464.1 kB raw (cap 480). Lab lazy-3d 137.8 kB (cap 160). **After the flip the flag-only class is just lazy code every player downloads.** The shipped total therefore grows by 49.1 kB to about 458 kB if nothing is cut, and first play is the real first download.
- **E5 text already exists.** `src/sje/runtime/glrenderer.ts:48` throws "This browser cannot run WebGL 2, which the game needs. Try a current Chrome, Edge, Firefox or Safari." `main.ts` `fail()` shows it under "SHADOW JOG failed to start." That fits E5 option A. No spec of the game page asserts it today; only the 3D door spec asserts `unsupported / no-webgl2`.
- **CI Firefox has no WebGL 2** (decisions.md Phase 0 result; migration.md line 255). The `e2e-engines` job runs `prod.spec.ts` and `gameover.spec.ts` on WebKit and Firefox (`playwright.config.ts`). After the flip those two specs on Firefox meet the E5 message, not a game. **migration.md M6 does not mention this; it is a real gap.**
- **Spec load paths:** `playthrough`, `chaos`, `gameover`, `perf`, `gpufx`, `economy` open `/?debug` (playthrough 27 lines, chaos 135, gameover 350, perf 275). `prod` opens the preview build (`PROD`). `fxlab` opens `/?scene=fxlab`. None passes `engine=`. After the flip all of them run on Pixi with no edit to the URL. 10 files hard-code `?engine=sje` (12 uses: `sje-battle`, `sje-bench`, `sje-field`, `sje-field-parity`, `sjefieldparity`, `sje-field-pictures`, `sje-field-refs`, `sje-fx`, `sje-shell`, `sjegamekit` x3).
- **Scenes on `LegacyScene`:** 21 `Scene` classes in `src/scenes` (title, menu, dialog, shop, options, deck, saveload, card, controls, ending, gameover, panels, mapview, placemap, and 6 test scenes), plus `BattleScene` and `FieldScene`, which draw through stages (M3, M5) but still derive from `Scene`. migration.md "Hybrid rule" (line 314) keeps title, menu, dialog, shop, options, deck and saveload on `LegacyScene` until one needs a camera, filter, mask or transition. **M6 does not need M4.** The playthrough already ran under the flag in M5 (pass line 6 there).
- **Contradiction 1:** migration.md says "Re-baseline the perf gates on CI at 640x360". Principle 12 and tooling-and-testing.md say CI runs no timing gate (software GL says nothing). **Principle 12 is right.** M6 re-sets the sanity bounds on SwiftShader (ticks, sane interval) and records real numbers once, locally, with `npm run perf`.
- **Contradiction 2:** the diagram shows M4 and M5 both joining M6, but M4 is optional (migration.md line 55). **The text is right; the diagram reads too strictly.**
- **Dev-only cast:** `sje/boot.ts` passes a `DisplayAdapter` cast to `bootGame` and `FxLabScene`. The FX lab port removes one consumer of that cast.

## 3. Open decisions for Mark (recommendation first; the build uses it unless Mark says otherwise)

1. **Delete the old presenter in M6, or keep it behind a flag for one release?** Recommend: delete `GlPresenter` and the old `start()` path in M6. migration.md says the old path stays one release *in git history*, not shipped, and a flag keeps a second engine alive in CI. Rollback is reverting the M6 merge (migration.md section 7). `Game`, `Display` shell and `postfx` stay until M8 as type and route glue.
2. **What players without WebGL 2 see.** Recommend: keep the existing "failed to start" screen with the current message (E5 option A; text already built). Add one thing: a line "Your browser's WebGL 2 may be turned off in its settings." No fallback renderer (E5 B and C were rejected). One spec asserts the text.
3. **Does M4 join?** Recommend no. The seven `LegacyScene` UI scenes already work under the flag. M4 stays demand-driven.
4. **Where the new bundle caps go.** Recommend: (a) fold `FLAG_ONLY_SRC` into `lazy-2d` (the class and its 50 kB cap go away). (b) Set the total at the measured value after the flip, rounded up to the next 1 kB, with a dated comment (Mark's one-bigger-total rule). Expect about 458 kB; any cut from deleting `presenter.ts` and the display GL half is measured, not promised. (c) Give `first play` its own cap, measured plus 1 kB, because it is now what every player downloads. (d) Keep the `boot` hard check (no `pixi.js` or `three`) and the 480 kB largest-chunk cap.
5. **Firefox on CI.** Recommend: on the `firefox` project, `prod.spec.ts` and `gameover.spec.ts` assert the E5 message and skip the game flow (a `test.skip` by `browserName` plus one E5 test). WebKit has WebGL 2 on CI and runs the full flow. Alternative: drop Firefox from `e2e-engines`. That loses the E5 check on a real engine.
6. **FX lab port depth.** Recommend: the smallest port that meets the ET row. `FxLabScene` takes `Game` (new) and uses `game.fx`, `game.scale`; no import of `engine/display`, `engine/game` `Scene` or `engine/postfx`. Same panels, same file format, no new features. The animation editor, art review and DEV menu stay in ET after M6.
7. **`?engine=sje` after the flip.** Recommend: the parameter is ignored, and the 10 spec files drop it. A one-line DEV warning if it is present is enough.

## 4. Hard pass lines

1. `npm run check` exits 0 (judge by exit code).
2. **Default is the new engine.** `grep -n "engine" src/main.ts` shows no `=== 'sje'` test; `npx playwright test e2e/sje-shell.spec.ts --reporter=line` exits 0 with a new case: `/?debug` (no flag) has `window.__SJE__` and a Pixi canvas, no `#fx` and no `#screen`. **Control:** the same assertion fails on the `main` branch build (run once by the runner, expect failure, record it).
3. **Old presenter gone.** `git ls-files src/engine/gl` prints nothing. `grep -rn "GlPresenter\|engine/gl/" src tests e2e scripts` prints nothing. `grep -rln "getElementById('fx')" src e2e tests` lists only the negative assertion in `e2e/sje-fx.spec.ts`.
4. **`postfx` still routes.** `npx vitest run tests/sje-fx.test.ts tests/gpufx.test.ts` exits 0 (the singleton and `routePostfx` stay until M8). **Control:** a unit test that fails if `routePostfx` is not applied before `bootGame`.
5. **No rule or content change** (principle 8). `git diff --stat main...HEAD -- src/field src/game src/battle src/data src/art src/scenes/field.ts src/scenes/battle.ts` shows no change except `src/game/settings.ts` or `src/scenes/options.ts` text for pass line 9.
6. **Default-path suite on SwiftShader:** `npx playwright test e2e/playthrough.spec.ts e2e/chaos.spec.ts e2e/gameover.spec.ts e2e/economy.spec.ts e2e/prod.spec.ts --reporter=line` exits 0 with the URLs unchanged (`/?debug`, `PROD`). 0 GL errors and 0 console warnings in `playthrough`. **Control:** the runner sets `?fx=none` once and the effects specs below must then fail their `fxLevel` assertion.
7. **`gpufx.spec.ts` rewritten** to read `__SJ__.renderer.fxLevel` (tooling-and-testing.md section 11). `npx playwright test e2e/gpufx.spec.ts --reporter=line` exits 0. Control: a case that forces `?fx=none` expects level `none` and fails if the spec still looks for `#fx`.
8. **FX lab.** `grep -n "engine/display\|engine/game\|engine/postfx" src/dev/fxlab.ts` prints nothing. `npx playwright test e2e/fxlab.spec.ts --reporter=line` exits 0 and shows the same 2 flows (list, edit, save, reload). Control: the spec loads an invalid `fx.json` edit and expects the "Unsaved" and error states.
9. **E5 on a browser without WebGL 2.** `npx playwright test e2e/prod.spec.ts e2e/gameover.spec.ts --project=firefox --reporter=line` exits 0 on the CI image (E5 text asserted, no game flow); the same specs on `--project=webkit` run the whole flow. Local check, once: Chromium with `--disable-webgl` shows the text "This browser cannot run WebGL 2". **Control:** a page with WebGL 2 must not show the text.
10. **Stage and field specs unchanged in meaning:** `npx playwright test e2e/sje-canaries.spec.ts e2e/sje-draws.spec.ts e2e/sje-fx.spec.ts e2e/sje-battle.spec.ts e2e/sje-stage-parity.spec.ts e2e/sje-field.spec.ts e2e/sje-field-parity.spec.ts --reporter=line` exits 0 with `?engine=sje` removed from the 10 files. `grep -rn "engine=sje" e2e` prints nothing.
11. **Bundle.** `npm run budget` exits 0 with the caps of decision 4. `grep -n "FLAG_ONLY" scripts/bundle-budget.mjs` shows the class removed. The `boot` class holds no `pixi.js` module (existing hard check). **Control:** run the budget once with a deliberate import of `pixi.js` in `src/main.ts`; it must fail. Revert it.
12. **Goldens for the default path.** Add `e2e/default-path.spec.ts`: title, field (`rustyard`), a battle, the Options screen, one frame each, on the CI `soft` set, using the M5 parity method. Control: a 2/255 step and a one-pixel move fail.
13. **Imports.** `tests/sje-imports.test.ts` updated: nothing under `src/` outside the allowed folders imports `pixi.js`; `src/main.ts` imports no `engine/display`, `engine/game` or `engine/postfx`. **Control:** the existing negative case.
14. **Pictures for Mark** (evidence, not a gate): `media/m6-flip/` holds the default page at 640x360 and 1280x720 for title, field, battle, menu, FX lab, and the E5 screen.
15. **GPU run, once, at the end (principle 12), by the main session:** `npm run perf`. Interval p95 within 5% of the bare page, cost p95 at most 8 ms. Numbers go in `tooling-and-testing.md` section 7.
16. `CHANGELOG.md`, `GLOSSARY.md`, `DEVELOPING.md`, `ARCHITECTURE.md` (default path), `tooling-and-testing.md`, and the record table below are filled.
17. **Playable checkpoint (Mark).** After the last fix round, the main session gives `http://localhost:3007/` (no flag), the pictures and the perf numbers. Mark merges or names fixes.

## 5. Tasks, in build order

1. **Survey, then record.** `docs/engine/m6-survey.md`: re-check section 2, list every importer of `engine/display`, `engine/game`, `engine/postfx`, `#fx`, and every spec step that depends on the old canvas pair.
2. **Specs first.** Remove `?engine=sje` from the 10 files; rewrite `gpufx.spec.ts`; add the `sje-shell` default case and the Firefox E5 cases. Run them red against the old default (they must fail on `main`).
3. **Flip.** `src/main.ts` calls `startSje`; delete `start()`, the GL slow-frame counter and the old loop. Keep `fail`, the error handlers and the `Cancelled` rule.
4. **Presenter removal.** Delete `src/engine/gl/`; cut the GL half of `display.ts` (keep what `boot.ts` types need until M8); drop `#fx` reads in `trailer.ts`.
5. **FX lab port** (decision 6). Update `devroutes.ts` and `trailer.ts` as needed.
6. **E5 screen** (decision 2) and the Options text: the "GPU effects need a graphics card" notice in `boot.ts:185` becomes the `lite`-level notice or goes.
7. **Budget.** Fold the flag-only class (decision 4), set caps, dated comment.
8. **Goldens, CI, docs.** `default-path.spec.ts`, `ci.yml` (add the new specs; Firefox rule), docs of pass line 16.

## 6. Editor contract (principle 11)

(a) The FX lab reads and writes `src/data/fx.json` through `checkFx`, unchanged. (b) It plays a moment through `game.fx.playMoment` by name, so what the lab shows is what the game plays. (c) No Pixi object leaves `src/sje`. (d) The lab does not read the old canvas. (e) What stays in code: the lab's panel layout (ET rule: no new tool features). Control: pass line 8's invalid-edit case.

## 7. Verifier plan (lean loop)

| Agent | Model, effort | Job |
|---|---|---|
| Builder A | sonnet, high | Tasks 1 to 4 (survey, specs, flip, presenter removal). |
| Builder B | sonnet, high | Tasks 5 to 8 (FX lab, E5, budget, goldens, docs). Starts after A is committed. |
| Runner | sonnet, medium | Pass lines 1 to 13. Runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 3, 5, 13; every deleted `#fx` use; no vacuous test; controls really fail. |

- Every builder prompt: no `Co-Authored-By` line and no `Claude-Session` trailer in any commit.
- Pass: every line holds, no Critical or Important finding open. A Minor finding is a named fix. A fix round: one fresh verifier checks only the named findings. Cap 3 rounds.
- No attacker: no write path, trust rule or save format changes.
- Perf (line 15) is run by the main session after the last fix round.

## 8. Risks

- **Firefox E5 on CI** (decision 5): a missed `skip` turns the `e2e-engines` job red.
- **WebKit on the full flow:** `prod`, `gameover` run the real game on Pixi there for the first time. Time limits and context rules may differ.
- **Total grows about 49 kB** at the flip (decision 4). The cap is re-set on purpose, not hidden.
- **Shared singleton:** `postfx` stays; a late `routePostfx` call would silently leave effects off. Pass line 4's control guards it.
- **Conflicts** in `status.md`, `CHANGELOG.md`, `docs/roadmap/roadmap.json`. Keep edits small; merge `main` before each commit.
- **Scope creep:** M4 scenes, `postfx` deletion (M8), other editors (ET).

## 9. Record

| Step | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Brief | this file. Mark answered decision 1 (issue #56) and decision 4 (issue #57) with A on 2026-10-10; decisions 2, 3, 5, 6 and 7 stay as recommended | — | approved | — |
| A: task 1 | `m6-survey.md` | — | — | — |
| A: tasks 2 to 4 | specs red, flip, presenter removed | — | — | — |
| B: tasks 5 to 8 | FX lab, E5, budget, goldens, docs | — | — | — |
| Runner | pass lines 1 to 13 | — | — | — |
| Pass line 15 (GPU run) | `npm run perf` on the RTX 4070 | — | — | — |
