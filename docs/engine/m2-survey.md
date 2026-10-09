---
type: reference
title: "Shadow Jog Engine — M2 survey: the callers of postfx, the presenter's slots, the old presenter on a software GPU"
project: shadow-jog
created: 2026-10-09
updated: 2026-10-09
tags: [engine, m2, survey, effects]
---

# M2 survey (task 1)

Read before the build: [m2-brief.md](m2-brief.md). Result of each part: nothing in the callers needs a change, every uniform slot has a place in the new code, and the old presenter can run on SwiftShader with one test-only line.

## 1. Who calls `postfx`

`postfx` is the singleton of `src/engine/postfx.ts` (a `PostFx`, which extends the shared `FxState`). The routing (task 7) makes it delegate to the `FxSystem`, so none of these files changes.

| File | What it uses | Why |
|---|---|---|
| `src/boot.ts` | `motion`, `intensity`, `update()`, `suspended`; passes `postfx` and `FX` to the dev hook | Comfort settings and the one `update()` per tick (a ticker). **Game must not call `update()` as well**: it would age every effect twice. |
| `src/main.ts` | `active` | The old loop's slow-GPU watch. Old path only. |
| `src/engine/game.ts` (old) | `active`, `ui`, `flashColor`, `flashAlpha` | The UI layer, and the flash for the presenter. The new `Game.paintTop` and `Game.draw` do the same on the new path. |
| `src/engine/display.ts` (old) | `active`, `glow`, `ui`, `glowUsed`, `suspended` | Makes the layers, starts each frame. Replaced by `FxSystem.beginFrame` on the new path. |
| `src/engine/gl/presenter.ts` (old) | all the state (it draws it) | Replaced by the composite, the glow chain and the particles. |
| `src/engine/moments.ts` | `active`, `later`, `emit`, `shock`, `aberrate`, `flare`, `haze`, `glitch`, `dim` | `playMoment`. Unchanged (pass line 8). `FxSystem.playMoment` is the same logic without a scene (`src/sje/fx/moments.ts`). |
| `src/scenes/field.ts` | `glowLayer()`, `bloom` | The field draws its lights into the glow layer. |
| `src/scenes/battlekit/render.ts` | `glowLayer()`, `bloom`, `active`, `ui` | The battle draws glow, and its UI panel into the UI layer. |
| `src/scenes/battlekit/gpufx.ts` | `active`, `later` | Spell moments (delay to the impact). |
| `src/scenes/battle.ts` | `clear()` x2, `clip`, `rate` | Scene change drops the effects; clip to the battlefield; hit stop slows the clock. |
| `src/scenes/options.ts` | `active`, `suspended` | The "GPU effects" row. |
| `src/dev/fxlab.ts` | `clear`, `rate`, `clip`, `glowLayer()`, `bloom`, `ui`, `active`, `emit` | The FX lab. Not ported in M2 (milestone ET). |
| `src/dev/trailer.ts` | `glowLayer()` | The trailer tool. |

Counts: `glowLayer()` 4 files, `postfx.ui` 3 files, `postfx.glow` 1 (the old display). Nobody outside the old display reads `postfx.glow`.

## 2. The old presenter, pass by pass

Order today: (1) bloom, (2) composite, (3) particles, (4) the UI layer. The new order is the same.

| Pass | Old program | Reads | New home |
|---|---|---|---|
| Light | `layer` | the glow canvas, plus the glowing particles drawn additively, at W x H | `GlowChain.lit` (a render texture); a sprite and a `ParticleContainer` |
| Blur x4 | `blur` | `uTex`; `uStep` | `BlurPass` x4 (`glowchain.ts`): lit to half across, half down, half to quarter across, quarter down |
| Composite | `comp` | `uScene`, `uBloomA`, `uBloomB`, `uLight` | `CompositeFilter` on `worldRoot` (the world is the filter's input) |
| Particles | `part` | none (instanced quads) | two `ParticleContainer`s (glowing, covering) over a 5-shape atlas |
| UI | `layer` | the UI canvas, premultiplied | `fx-ui` `CanvasImage` in `screen.fxRoot`, under `uiRoot` |

### Uniform slots of `comp`, and where each value comes from

| Slot | Type | Source |
|---|---|---|
| `uRes` | vec2 | W, H |
| `uShock[4]` | vec4 | x, y, radius = `reach * (1 - (1 - k)^2)`, push = `strength * (1 - k)^1.5` (`k = t / life`) |
| `uShockW[4]` | float | `width * (0.6 + k)` |
| `uAberr` | vec3 | `aberration`, `aberrationX`, `aberrationY` |
| `uBloom` | float | `bloom + pulse`, or 0 when nothing glows |
| `uFlash` | vec4 | `flashColor` as rgb, `flashAlpha` |
| `uVignette` | float | `vignette` |
| `uHaze[4]` | vec4 | x, y, radius, `strength * envelope(t, life, 8, 20)` |
| `uGlitch[2]` | vec4 | x, y, w, h |
| `uGlitchP[2]` | vec2 | `strength * envelope(t, life, 2, 6)`, `seed` |
| `uTime` | float | `time` (the effects clock) |
| `uDim` | float | `dimNow` |
| `uLightOn` | float | 1 when the bloom runs |
| `uBloomA`, `uBloomB`, `uLight` | sampler | half-size blur, quarter-size blur, the light |

`blur`: `uTex` (the source), `uStep` = (dx / source width, dy / source height). `part`: `uRes`; its attributes are the packed `ParticleSim` record (x, y, w, h, angle, rgb, a, shape).

Constants that were in the shaders or the draw code (the pairs `0.9`, `0.8`; the dim gain `3.0`; the vignette `2.0`; the blur taps; the haze and glitch numbers; the shock easing; the particle cap) are in `FxParams` now (`src/sje/fx/fxparams.ts`).

## 3. Showing the old presenter on a software GPU

`GlPresenter.create` refuses a context twice: `failIfMajorPerformanceCaveat: true`, and the renderer name against `SOFTWARE_GL`. Headless Chromium on CI gives a context (the first check passes) and the name check refuses it. Checked on the bundled Chromium: without a change `#fx` does not exist and `postfx.active` is false.

**Answer: one init script in the test, no change to `src/`.** It makes the name look like a GPU:

```ts
await page.addInitScript(() => {
  const orig = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function (p) {
    return p === 0x9246 ? 'ANGLE (NVIDIA, Fake GPU)' : orig.call(this, p); // UNMASKED_RENDERER_WEBGL
  };
});
```

With it, `/?debug` shows `#fx` and `postfx.active` is true on SwiftShader (checked). The side-by-side (`e2e/sje-fx-compare.spec.ts`, local, GPU) then needs no trick on a real GPU; on SwiftShader it uses this script. The new path needs no trick: `?engine=sje&fx=full` forces `full`, and `auto` picks `lite` on a software renderer.
