---
name: engine
description: Work on the Shadow Jog Engine (src/sje, the new Pixi and Three engine that replaces src/engine). Use when you add or change a GameObject, scene, effect, texture, 3D frame, canary or lab check, or when you write Pixi, Three or Phaser-style code in this repo. Triggers: "engine", "sje", "GameObject", "Pixi", "Three", "canary", "lab page", "add an effect", "add a scene".
---

# Shadow Jog Engine skill

Agents write Pixi v7 and Phaser 3 from memory. Both are wrong here. This skill gives the order of authority, the read order, the recipes and the hard rules. The rules come from tests that fail if a rule is broken (the canary suite). Keep this file short: details live in `docs/engine/`.

## Authority order (what to trust when sources disagree)

1. The installed `.d.ts` files and source in `node_modules` (`pixi.js` 8.22.0, `three` 0.186.1). Read the file, do not guess.
2. `docs/engine/` (the approved design) and `docs/engine/verified-conventions.md` (what the lab checked).
3. Context7. It lists Pixi only up to v8.16.0, and this repo runs 8.22.0.
4. `pixijs.com/llms.txt`.

Pixi ships 26 skill folders in `node_modules/pixi.js/skills`. Two examples there are wrong in 8.22: treat them as hints.

Phaser 4 is the naming reference, not a dependency. Its source is not in this repo. The Phaser 4.2.1 package lived in the spike checkout (`shadow-jog-phaser/node_modules/phaser`); the facts that matter are in `docs/engine/verified-conventions.md`. Phaser 3 habits are wrong for Phaser 4 too.

## Read order

1. `docs/engine/README.md` (levels, the three things that look like Phaser and are not).
2. `docs/engine/conventions.md` (the name for each concept, and the tags `ours`, `deviation`, `on demand`).
3. The doc for your part: `scene-graph.md` (display objects), `frame-and-rendering.md` (loop, back buffer, hand-off), `interfaces.md` (signatures, compiled by `src/sje/interfaces.check.ts`), `tooling-and-testing.md` (tests, gates).
4. `docs/engine/migration.md` (which milestone owns your change) and `docs/engine/m0-brief.md` (what M0 built).

## What exists now (M0)

`src/sje/core` (size, loop, events), `render` (GL context, Pixi renderer, back buffer, presenter, GL hand-off, frame textures), `display` (GameObjects, effects, textures), `runtime/glrenderer.ts` only, `three` (3D frames). No `Game`, `Scene` or `SceneManager` yet: M1 builds them, and `Scene3D` is M1b. The lab page (`sjelab.html`, `src/sje-lab/`) composes what exists and is the target of the canary suite.

## Levels (dependencies point down)

0 core, 1 render, 2 display, 3 runtime, 4 facade (`src/sje/index.ts`, the only import for game code), 5 the lazy 3D chunk (`src/sje/three`, `src/hack3d`). Biome `noRestrictedImports` and `tests/sje-imports.test.ts` enforce it. `pixi.js` only under `render` and `display`. `three` only under `src/sje/three` and `src/hack3d`. Raw GL state calls only in `src/sje/render/glhandoff.ts`.

## Recipes

**Add a GameObject.** Put the file in `src/sje/display/`. Extend `GameObject` (it owns exactly one Pixi node and hides it: composition, not subclassing). Take the `DisplayHost` in the constructor, call `super(scene, pixiNode)`, and override `destroyNode()` if the node owns GPU data. Positions go through `writePosition` (snap to pixel). A leaf has no children. Export it from `src/sje/index.ts`. Add a unit test in `tests/` (Pixi scene classes run in plain Node) and, if it draws, a pixel check in the lab.

**Add a scene.** Not yet: the scene runtime is M1 (`Scene` with `init`, `preload`, `create`, `fixedUpdate(tick)`; `game.run(scene)` waits for `close(result)`). Until then a lab scene is a `LabContent`-style class in `src/sje-lab/`.

**Add an effect.** `colorMatrixEffect(matrix)` or `createEffect({ name, fragment, uniforms })` from `src/sje/display/effects.ts`, then `object.filters.add(effect)`. The engine supplies the vertex shader. Filters run inside the back buffer, at game resolution. Free the effect yourself (`effect.destroy()`): the code that made it owns it. Masks: `object.filters.addMask(maskObject)`.

**Add a test.** Logic: Vitest in `tests/`, Node, no GPU. Browser: a Playwright spec on the lab page (`e2e/sje-canaries.spec.ts`, helpers in `e2e/sjelabkit.ts`). Every check that guards a trap gets a negative control: the same check on a build that has the trap on purpose, which must fail. Pixel checks run inside the page through the `window.__SJE__` hook, so a test does not ship pixels through Playwright.

**Add a canary.** Write the check in `src/sje-lab/pixilab.ts` (Pixi) or `threelab.ts` (Three), expose it on the hook, and add the test and its control to `e2e/sje-canaries.spec.ts`. Run it on a Pixi or Three bump.

## Hard rules

- Pixi `Application` and `Ticker.shared`: not used. The renderer still starts `Ticker.system` through its scheduler: stop it after `init` (`Ticker.system.stop()`). Any throwaway renderer you make must stop it too.
- Pixi anchor defaults to (0,0). Phaser origin defaults to 0.5. Use `setOrigin`.
- `new WebGLRenderer()`, never a string preference. Create it with BOTH `context` and `canvas`, and `skipExtensionImports: true`. Add back only the extensions the engine draws with, in `src/sje/render/extensions.ts`. Never import `pixi.js/accessibility`.
- Never call `renderer.destroy()` on a shared context. It loses the context.
- No top-level `await` on `init`: a production build hangs. Run it in an async function.
- No named `output.codeSplitting` or `manualChunks` group for Pixi or Three: it moves Vite's preload helper into the group and the entry then imports it statically.
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` before any texture exists. Pixi's `scaleMode` does not reach an `ExternalSource`: set `NearestFilter` on the Three target.
- `Texture.from(canvas)` caches by canvas. Build the `CanvasSource` yourself (`TextureManager.addCanvas`). `texture.destroy()` leaves the source alive: destroy the frame textures first, then the source once.
- A changed canvas needs `source.update()` (`TextureManager.refresh`).
- `Filter.from({ gl: { fragment } })` throws in 8.22: pass `vertex: defaultFilterVert` too. Fragment shaders need `uniform highp vec4 uInputSize`. Leave an empty uniform group out.
- `setMask({ mask: null })` does nothing in 8.22: set `node.mask = null`. A sprite mask reads red times alpha by default: pass `channel: 'alpha'`.
- `g.rect(...).fill(color, alpha)` is deprecated and logs a warning (the boot gate fails on any warning). Use `fill({ color, alpha })`.
- `stroke({ pixelLine: true })` is not exact: draw 1 px lines as rectangles. `roundPixels` stays off: snap in the wrapper.
- `RenderLayer` ignores filters.
- Three: create with `{ canvas, context }`; never `setSize`, `setViewport` or `setPixelRatio` on the shared renderer; render only to render targets. Call `three.resetState()` after Three renders and before Pixi draws (`GlHandoff` does it). `ColorManagement.enabled = false` and no `OutputPass`, or `#ff2080` comes out as `#ff0437`. `Clock` is deprecated: use a constant dt. Dispose geometry, material and texture yourself (`disposeObject3D`); `Frame3D.releaseGpuData()` and `releaseGpuData(scene)` on a context loss.
- Leaves have no children.
- Do not use Pixi's `Text`: it needs `document`. Draw text with the game's font into a canvas.
- Strict TypeScript. No `!` in `src/sje`: use `must(value, 'what')`. No per-frame allocation in hot paths. Gameplay randomness only from seeded `Rng`. Comments explain why, and every borrowed name says where it came from (`// ours`, `// deviation`).
- The one source of the size is `src/sje/core/size.ts`. Never write 640, 360, 320 or 180 for the screen: `tests/screen-literals.test.ts` fails.

## Commands

`npm run check` (lint, types, unit tests). `npx playwright test e2e/sje-canaries.spec.ts` and `e2e/perf.spec.ts` (set `CI=1` for the bundled Chromium on SwiftShader, like CI). `npm run budget` (the manifest bundle gate). `node scripts/sync-interface-check.mjs` after editing `docs/engine/interfaces.md`. Dev server port 3007, preview 3008.
