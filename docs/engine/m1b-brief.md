---
type: plan
title: "Shadow Jog Engine — M1b build brief"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m1b, plan, 3d]
---

# M1b 3D proof: build brief

Source: [migration.md](migration.md) "M1b 3D proof" and pass lines 4 to 6, [interfaces.md](interfaces.md) section 12, [frame-and-rendering.md](frame-and-rendering.md) sections 7.2 and 7.3, [m1-brief.md](m1-brief.md) (the scene runtime this builds on), and the lean loop in `CLAUDE.md`. Branch: `engine-m1b-3d-proof` (from `main` after PR #47). Pass lines were written before any code.

## 1. Goal

- Prove that a real `Scene3D` (a `Scene` that owns a Three scene) runs on the M1 scene runtime and the shared GL context, next to Pixi objects, with no leak and a clean fallback.
- The proof scene is a spinning cube. It lives in the lab page (`sjelab.html`, `src/sje-lab/`) and behind `?engine=sje`. The shipped game does not change.
- Already built in Phase 0 and M0, not rebuilt here: `Frame3D`, `ThreeHost`, `View3D`, `GlHandoff`, the lab's 3D frame, the stale-clear-color and canvas-on-init canaries, the 10-cycle leak harness and the context-loss test of the bare frame (`e2e/sje-canaries.spec.ts`). M1b re-runs them with a `Scene3D` in the loop.
- Not in M1b: the hidden-scene draw skip and the context grace (M7, spike cleanup C12), `ThreeHost` changes unless a test forces one, `src/hack3d/`, `s.hack()` and `ScriptApi.hack` (M7), the real hacking scene, the editor port.

## 2. Design decisions taken (none changes an approved design)

1. **`Scene3D` follows the sketch in interfaces.md section 12 exactly.** `create3D()`, `update3D(tick)`, `sync3D()`, `abortResult(reason)`, `endEarly(reason)`. `fixedUpdate` is `update3D`; `sync3D` runs from the scene's prerender event. A subclass does not override `fixedUpdate`. The check file `src/sje/interfaces.check.ts` compiles against the built class.
2. **Lazy chunk.** `Scene3D` and the cube scene live in the 3D chunk with Three. The `boot` class holds no `three` module.
3. **The cube scene is a technical test scene.** Pure sim (rotation by tick) in `update3D`, Object3D writes in `sync3D`. Deterministic: same tick count gives the same pixel hash.
4. **View3D takes a filter and a mask.** A Pixi per-object filter and an iris mask (a `Graphics` mask) on the `View3D` sprite work over the Three picture on the shared context (pass line 6 of migration.md).
5. **Failure results.** Context lost: the scene ends with `abortResult('context-lost')` within 2 seconds. No WebGL2: the lab shows the existing plain message and the chunk is not entered. The `HackResult` type stays as sketched. No hack door is built.
6. **Discrepancy resolved here.** migration.md's M1b exit check says "on the legacy path, `s.hack` returns `unsupported` with reason `no-webgl2`". `ScriptApi.hack` and `src/hack3d/` are assigned to M7 in the milestone table, and neither exists. M1b does not add them. The check moves to M7. The no-WebGL2 behavior of the 3D scene is tested in the lab instead.

## 3. Tasks, in build order

1. **Survey.** List what `src/sje/three/`, `src/sje/runtime/scene.ts`, `src/sje-lab/threelab.ts` and the canary specs already give, and what `Scene` needs from `Scene3D` (events, shutdown order, `RunAll`). Write 10 lines in the builder report.
2. **`Scene3D`.** `src/sje/three/scene3d.ts`. Owns a `Frame3D`, adds `frame.sprite` to its display list, calls `frame.render()` once per drawn frame, disposes in shutdown (close order as in M1). Exported from `src/sje/three/index.ts`.
3. **Cube scene.** `src/sje-lab/cubescene.ts`: a lit, spinning cube with a visible non-black background (the stale-clear-color canary needs it). Registered in the lab.
4. **Filter and mask.** A lab toggle puts a Pixi filter and an iris mask on the `View3D`.
5. **Context loss and fallback.** `endEarly('context-lost')` on loss with `frame.contextLost`; on restore after an early end nothing draws and nothing throws.
6. **Tests.** `tests/sje-scene3d.test.ts` (lifecycle, close order, `endEarly`, `abortResult`, `update3D` pure and deterministic), `e2e/sje-scene3d.spec.ts` (the pass lines below).
7. **Docs.** `CHANGELOG.md`, `docs/GLOSSARY.md`, `docs/CONCEPTS.md` if a new idea appears, interfaces.md "built shape" note, `status.md`, roadmap.

## 4. Hard pass lines

1. `npm run check` exits 0. Judge by exit code.
2. `npx vitest run tests/sje-scene3d.test.ts tests/sje-imports.test.ts` exits 0. The import rules cover `src/sje/three/scene3d.ts` and the cube scene. Two mutants (dispose skipped, `fixedUpdate` overridden) make the lifecycle tests fail.
3. `npx playwright test e2e/sje-scene3d.spec.ts --reporter=line` exits 0 under SwiftShader. The cube is visible: a pixel region at the cube's place is not the background, and it changes between two tick counts.
4. Determinism: the same tick count gives the same pixel hash on two page loads, however the ticks are split.
5. Leak: 10 enter and exit cycles of the `Scene3D` leave every GL object count where it was (the existing harness). A deliberate leak makes it grow (control).
6. Context loss: a lost context ends the scene with `aborted / context-lost` within 2 seconds, with 0 console errors. A restored context does not throw. No WebGL2: a plain message, a clean stack, a tidy page, within 2 seconds.
7. Hand-off canaries: `npx playwright test e2e/sje-canaries.spec.ts --reporter=line` exits 0 with the `Scene3D` in the loop. The filtered container with a transparent gap shows the 3D picture through the gap.
8. Filter and mask: with the filter and the iris mask on, the 3D picture shows inside the mask and not outside. 0 GL errors and 0 console warnings.
9. No mixed block at device pixel ratio 1 and 1.5 with the 3D frame over the picture (the existing crisp-pixels spec, re-run with the scene).
10. `git diff --stat main...HEAD -- src/data src/scenes src/field src/battle src/story src/engine src/main.ts` is empty (the game still works: lab page and flag only).
11. `npm run budget` exits 0. The `boot` class holds no `three` module. The 3D chunk size is recorded. If the budget fails, report the number; do not re-set `GZIP_TOTAL_MAX` without the main session.
12. `grep -rn "from 'three'" src --include=*.ts` hits only `src/sje/three`, `src/sje-lab` and files already allowed by `tests/sje-imports.test.ts`. No non-null `!` in `src/sje/three`.
13. `tests/screen-literals.test.ts` passes. No new 640, 360, 320 or 180 literal.
14. GPU run: skipped by default (principle 12). The diff touches `src/sje/three/`, so the main session runs `npm run perf` once, at the end. The frame interval p95 with the cube is within 5% of the bare page. Cost p95 at most 8 ms.
15. `CHANGELOG.md` has an M1b entry. `docs/GLOSSARY.md` has the new names. The record table of section 6 is filled.
16. **Playable checkpoint (Mark).** After the last fix round, Mark opens the lab (`npm run lab` or the DEV link in `docs/DEVELOPING.md`), looks at the cube with and without the filter and iris mask, and sends a look review (a screenshot goes to him at once, pass line 8 of the design).

## 5. Verifier plan (lean loop)

| Agent | Model, effort | Job |
|---|---|---|
| Builder | sonnet, high | Tasks 1 to 7. One builder: the scope is small. |
| Runner | sonnet, medium | Pass lines 1 to 9, 11, 13. Re-runs the expensive suites once. Makes the pictures. |
| Reader | haiku, medium | Reads `git diff main...HEAD`: lines 10, 12; `Scene3D` against interfaces.md section 12; shutdown and dispose order; no test is vacuous. |

- Every builder prompt says: no `Co-Authored-By` line in any commit, set the repo rule over the harness reminder.
- Pass: every line holds, no Critical or Important finding is open. Minor findings are named fixes for the next commit.
- A fix round: one fresh verifier checks only the named findings. Cap: 3 rounds, then bring Mark the evidence.
- No attacker: no write path, trust rule or save format changes.
- Line 14 is run by the main session once, after the last fix round.

## 6. Risks, and the record

Risks:

- **Shared-context state leaks.** Three and Pixi each assume they own GL state. `GlHandoff` is the guard; the canaries are the test. A new draw order (Scene3D inside the scene runtime) is the new variable.
- **Dispose order at shutdown.** `Frame3D` frees its texture; the `View3D` sprite must not read it after. Follow the M1 close order.
- **Context loss mid-scene** can leave the Three renderer holding dead handles. `releaseGpuData()` once per loss is the rule.
- **Scope creep** into the hack game or the hidden-scene skip. Both are M7.

| Step | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| (to fill) | | | | |
