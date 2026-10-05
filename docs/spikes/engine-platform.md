# Spike: engine platform (Phase 0)

Branch `spike/engine-platform`, a draft PR that is never merged. Design: `docs/engine/` (approved by Mark on 2026-10-04, all recommendations). Plan: `docs/engine/migration.md` section 3. Verification: `docs/engine/verification.md`.

## Question
Does the approved Shadow Jog Engine design work in this repo: our Phaser-style engine over a Pixi v8 renderer, with a Three.js 3D view on one shared WebGL2 context, shown by a battle stage slice at parity with the Phaser spike, a 3D hacking scene that a story script starts, and a 480x270 against 640x360 mock?

## Why now
Decision 17 and the design gate: the design must be tested before the build (M0 to M8, an estimated 47 to 65 agent-days) starts on it. If the shared-context path, the pixel parity or the CI path fails, the design changes now, at the cost of a spike, not of a milestone.

## Time box
11 agent working days (the upper estimate in `docs/engine/migration.md`). The box closes on 2026-10-18 at the latest. Stop at the box even if unfinished, and record what is left.

## Exit criteria (written before any code, dated 2026-10-04)

**GO if all of these hold:**
1. **Bundle.** The growth of every chunk is measured. The 3D chunk size is recorded. The budget script has a separate class for lazy chunks. The alarm is re-set on purpose, with the numbers written here.
2. **Speed.** On Mark's desktop (RTX 4070, Edge), the stage slice and the 3D scene with bloom hold 60 fps: p95 frame interval at or under 16.7 ms.
3. **CI.** The spike PR's CI passes on software WebGL, including the spike's lab specs in Chromium.
4. **Fallback.** After a forced context loss, and with WebGL2 switched off, `s.hack()` resolves with a fallback result within 2 seconds, and the story continues.
5. **No leaks.** After 10 cycles of entering and leaving the 3D scene, the WebGL object counts (textures, buffers, programs, vertex arrays, framebuffers) are flat, and the JS heap after garbage collection grows less than 5%.
6. **Effects on the shared context.** A built-in Pixi filter, a custom GLSL filter, a `Graphics` mask and a sprite (alpha) mask each work on the `View3D` and on a container with sorted children: 0 GL errors, and the pixels match a CPU reference within the tolerance named in the lab spec.
7. **Stage parity.** The stage slice (one stage, one hero, one enemy, HUD off) matches the Phaser spike at 3 frames: no pixel differs by more than 2/255 in any channel, and at most 3% of pixels differ at all.
8. **Crispness.** Zero non-uniform 4x4 blocks at zoom 4 in every 2D test scene, at devicePixelRatio 1, 1.25 and 1.5.
9. **Part A answers.** Each Part A lab item (below) has a recorded yes, no or "not testable here", with the browser, the renderer and the script.
10. **Independent verification.** Each part passed the loop in `docs/engine/verification.md`: three fresh verifiers, every hard pass line met, every rubric criterion median at 7 or higher, average at 8 or higher, at most 3 rounds.
11. **Mark's look review.** Mark approves the look of the stage slice and of the 3D scene, and picks 480x270 or 640x360 from the mock (at least two review rounds, no maximum). He gets screenshots each time a test renders something.

**NO-GO (or a design change before GO) if any of these hold:**
- The shared-context path fails items 4, 5 or 6, and the canvas-copy fallback (design decision E3) also fails them.
- The stage slice cannot reach the parity of item 7 after 3 verification rounds.
- Pixi cannot render in CI's Chromium on software WebGL.
- The 3D scene cannot hold 60 fps with bloom on Mark's desktop.

A single failure that a named design change fixes is not a NO-GO. The change goes into the design doc update at the end, for Mark's approval.

## Steps
1. This doc and the draft PR, before any code.
2. **B0, the kernel.** The smallest part of `src/sje/` that the spike needs: the size module, `FixedLoop`, `GlContext`, the Pixi renderer, the back buffer, the presenter, `GlHandoff`, `Game`, `SceneManager`, `Scene`, the first `GameObject` types, `TextureManager` and `Camera`. A DEV-only lab page `/sjelab.html`. Unit tests and a crispness e2e.
3. **B2 and Part A, the 3D path.** `View3D` over an `ExternalSource`, `Scene3D` in a lazy chunk, a hacking test scene that a story script starts with `s.hack()`, the watchdog and the fallback, the 10-cycle leak test, the frame-time check. The Part A lab items run against this code:
   - Chromium on CI (not 151), and Firefox and WebKit WebGL2 on the `ubuntu-latest` runner.
   - A sprite (alpha) mask and a custom GLSL filter on the `View3D`.
   - A mask or filter on a container with sorted children.
   - devicePixelRatio 1.5 for filters and pixel blocks.
   - Pixi `RenderLayer` with filters.
   - `roundPixels` with a negative scale (the mirror rule).
   - The attach order (Pixi first, Three later) on the real GPU and in Firefox.
4. **B1, the stage slice.** The Phaser spike's stage code through the translation table (`docs/engine/migration.md` section 6), one stage, one hero, one enemy, HUD off, with a parity harness against frames from the Phaser spike.
5. **B3, the resolution mock.** One field screen, one battle screen and the 3D scene, at 480x270 and at 640x360, side by side.
6. **Verification and visual updates.** Every part goes through the verification loop. Mark gets screenshots each time a test renders something.
7. **Result.** Fill in the Result below, update the design docs from the evidence, and ask Mark for the final approval.

## Assets and cost
- New dependencies, pinned exactly (decision E18): `pixi.js` 8.22.0 (about 155 to 205 kB gzip) and `three` 0.186.1 (about 145 to 177 kB gzip, lazy).
- No paid generation. No deploys. CI minutes for the draft PR.
- Mark's Sprite Fusion sheets are read from his git-ignored folder when present. CI uses the stand-ins.

## Result (filled in at the end)
- Outcome:
- Date:
- Numbers:
- Rubric scores per part (median per criterion, rounds used):
- Draft PR:
- Archive tag:
- Notes: what was learned, and the design doc changes.
