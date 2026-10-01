---
type: reference
title: Shadow Jog — Architecture
project: shadow-jog
created: 2026-09-29
updated: 2026-09-29
tags: [architecture, code, reference]
---

# Architecture

How the code is organised and how the pieces talk to each other. For *what* the game is, read `docs/GDD.md`; for
day-to-day work (commands, tests, conventions, recipes), read `docs/DEVELOPING.md`.

**In one paragraph:** a browser game with **zero runtime dependencies**. Vite + TypeScript (strict), Canvas 2D at
**480×270**, scaled to the window. The art is **generated in code** (sprites from letter grids and shape routines,
tiles from procedural painters), with **drawn art** from the PixelLab pass loaded over it at startup where Mark picked
it (§7, "Drawn art"); music comes from a small score format played by a WebAudio synthesizer. A
**scene stack** runs at a fixed 60 Hz. The **field** (towns, dungeons, world map) runs **story scripts**, async
functions that `await` dialogue, battles and camera moves. **Battles** are a pure, deterministic engine that the
battle scene replays as animation. The game state is one plain object, saved to `localStorage`.

---

## 1. Directory map

```
src/
  main.ts            start(): builds Display, Input, Game; the fixed-step loop; the notice overlay; boot failure
  boot.ts            boot(): installs systems, debug hooks (DEV only), tab coordination, autosave, the title
  devroutes.ts       ?scene=… test scenes (DEV only, lazily imported)
  engine/            the game-agnostic core: loop and scene stack, input, font, canvas, display, rng, colour…
  game/              game-specific systems: state, save, party maths, settings, the script API, hooks, stages
  field/             the overworld: map building (tiles, buildings, props, lights), actors, weather, lighting
  battle/            the pure battle engine: rules, AI, FX particles (engine.ts has no DOM)
  scenes/            every Scene: title, field, battle, menu, shop, dialog, panels, ending…
    battlekit/       BattleScene's parts: renderer, playback, timing, orders, sprites, motion, geometry
    fieldkit/        FieldScene's parts: the script API, draw helpers, dust
  art/               procedural art: characters, party battlers, enemies, portraits, battle backdrops, the Pix kit
  audio/             the synth engine, the song format and sequencer, the songs, sound effects
  data/              content: abilities, enemies, items, shops, party, looks, speakers, maps/
  story/             chapter1.ts (every story beat as a script), newgame.ts
  ui/                window drawing, the list menu, layout width constants
tests/               Vitest unit tests + simulation harnesses (battle sim, economy model, map graph)
e2e/                 Playwright: full-chapter runs, playtest capture, screenshots, perf, audio evidence, chaos
scripts/             bundle budget, evidence runner, reviewer-prompt generator, score history
docs/                GDD, glossary, setting bible, this file, DEVELOPING, quality/ (rubric, scorecard, grading)
```

Dependency direction (enforced by habit, checked by reviewers): `engine/` imports nothing else; `battle/` imports
`engine/` and `data/`; `data/` imports types and `engine/assert`; `field/` imports `engine/`, `art/`, `data/`;
`scenes/` import everything below them; `game/systems.ts` wires scenes together at boot. Cycles are avoided with
**late-bound hooks** (`game/hooks.ts`) and **lazy imports** (the battle chunk, dev routes).

---

## 2. The core: loop, scenes, input (`src/engine/`)

### The loop (`main.ts`)
`requestAnimationFrame` drives a **fixed 60 Hz** accumulator: up to 5 `game.tick()` per frame (then it drops the
backlog), then one `game.render()` and `display.present()`. `perf.record()` samples frame and simulation time (read
by `e2e/perf.spec.ts`). Errors in a tick or render are reported, not fatal.

### The scene stack (`engine/game.ts`)
- `Scene<R>`: `enter()`, `exit()`, `resume()`, `update()`, `render(ctx)`, `close(result)`. Flags:
  - `opaque`: scenes below it aren't drawn (default true).
  - `curtain`: a full-screen menu that dims the world; only the **topmost** curtain is drawn over the opaque base,
    so stacked menus never ghost through each other.
  - `passUpdate`: the scene below keeps updating (ambient animation under a dialog).
- `game.run(scene): Promise<R>` pushes a scene and resolves with its result when it closes. **Game flow is written
  as `await game.run(...)`**, which reads like a script.
- `game.reset(scene)` clears the stack; `game.abandon()` drops everything without resolving (recovery).
- `game.wait(frames)`, `fadeOut/fadeIn/fadeTo`, `flash(color, frames)`, `shake(frames, mag, dir?)` (directional
  kick-and-spring or smooth rumble, `engine/shake.ts`), `tickers` (per-tick hooks) and `overlays` (drawn last).
- **Fault isolation:** a throwing scene update/render, ticker or overlay is reported (`engine/errors.ts` notice) and
  the loop continues. `FAULT_LIMIT` (30) consecutive faulting ticks or renders call `onFault`, which `boot.ts` uses to
  abandon the flow and return to the title.
- `playFrames` counts play time while `countPlayTime` is set (the field sets it; the title clears it).

### Input (`engine/input.ts`)
Actions: `up down left right confirm cancel menu dash fullscreen`. Keyboard (default map plus the player's custom
keys from settings), gamepad (polled), and touch. `pressed(a)` is true for exactly one tick; `repeat(a)` auto-repeats
for menus; `down(a)` is held. Taps shorter than a tick are never lost. `carry(a)` holds a press over to the next
tick (a battle hit-pause uses it). `keysFor(a)`, `keyName(a)` name the bound keys for on-screen hints.

### Text (`engine/font.ts`)
A bitmap font baked to an atlas; `drawText`, `measure`, `wrap`, `drawParagraph`, `fitText`. **Inline colour codes**
in any string: `{c}` cyan, `{y}` amber, `{r}` red, `{g}` green, `{d}` dim, `{#rrggbb}`, `{/}` back to the base
colour. Every character the game uses must exist in the font (`tests/glyphs.test.ts`).

### Other engine pieces
`canvas.ts` (`surface(w, h)`: an offscreen canvas and its context, pixel-art configured), `display.ts` (integer or
fill scaling of the 480×270 back buffer), `color.ts` (`rgb`, `mix`, `shade`: `shade(c, -x)` darkens *and* shifts
hue; use `mix(c, dark, t)` for a true darkening), `rng.ts` (seeded mulberry32 `Rng`, `hash2` noise, named
`streams` for encounters and battles so saves are reproducible), `errors.ts` (`notice(text, tone)`,
`reportError`), `assert.ts` (`must(value, what)`: the only sanctioned non-null assertion in `engine/` and
`battle/`), `perf.ts`.

### GPU effects (`engine/postfx.ts`, `engine/gl/presenter.ts`, `engine/particles.ts`)
An optional layer over the Canvas 2D renderer (Options → GPU effects, on by default; off, or without WebGL 2, the
game draws exactly as before). Nothing in the game's drawing changed to allow it; three things were added:
- **`postfx`** (the façade game code talks to): `shock(x, y)` (a ring of distortion), `aberrate(px, x, y)` (a colour
  split easing out), `flare(amount)` (extra bloom), `emit(preset, x, y)` (a particle burst). All no-ops while
  `postfx.active` is false. Two layers: `glowLayer()` (draw what should bloom: the field's baked emissive map and
  sprite emits, the battle backdrop's neon and every effect in flight) and `ui` (everything above the world scene;
  `Game.render` routes to it, and the battle draws its HUD there). Shockwaves follow Screen shake and pulses
  follow Screen flash. `rate` is the battle's animation clock; `clip` keeps particles on the battlefield.
- **`GlPresenter`**: a WebGL 2 canvas (`#fx`) laid exactly over `#screen` (which keeps focus and input). Per frame:
  the glow layer plus glowing particles into a light buffer, blurred at half and quarter size (bloom); a composite
  of the back buffer (nearest-neighbour, so pixels stay sharp) bent by up to four shockwaves, colour-split, with the
  bloom, the hit flash and a vignette; the particles again, sharp; the UI layer (where `Game.render` also draws the
  fade, under the notices, as in 2D). A lost context falls back to 2D until it's restored; a shader that won't
  compile means no GPU effects at all (Options then says "Unavailable"). If the game runs under 25 fps for a few
  seconds with them on, `main.ts` switches them off for the session with a notice ("Paused (slow)").
- **`ParticleSim`**: typed-array simulation (no allocation per particle), drawn as instanced quads with shapes made in
  the fragment shader (`soft`, `dot`, `spark` stretched along its flight, `square` snapped to pixels, `ring`).
  Presets and **moments** (what plays on each game event: stacks of layers, each a burst, a shockwave, a colour
  split or a flare, with a delay) are data: `src/data/fx.json`, typed and checked by `engine/fxdata.ts`, played by
  `engine/moments.ts`. Battle events call moments by name in `scenes/battlekit/gpufx.ts`. The **FX lab**
  (`src/dev/fxlab.ts`, `?scene=fxlab`, dev only) edits the file and saves it through a dev-server plugin in
  `vite.config.ts`; `data/fx.ts` takes the new data live (Vite HMR), so a running dev game changes at once.

`Display.beginFrame()` (called before `game.render()`) decides each frame whether the layer is live and clears its
layers; `Display.present()` hands them to the presenter. A battle clears every effect in flight in `exit()`, however
it ends; GPU particles hold still through a hit pause.

---

## 3. Game state and systems (`src/game/`)

- **`state.ts`**: `GameState`, one plain JSON-able object: party, members (level, xp, hp, tp, skill uses, equipment,
  ailments), inventory, cred, **flags** (the story's memory), position, lastTown, lastEntrance, play time, combos
  found, bestiary and weakness notes, last orders, RNG stream states. `SAVE_VERSION` (currently **3**: v2 → v3 re-levels
  a save on the 2026-09-29 XP curve and sets the story unlocks it has passed). `flags` is
  a helper over `state.flags`.
- **`save.ts`**: 3 slots + `auto`. A save file is `{ meta, state }`; `readMeta` for the slot list,
  `loadSave` = parse → `migrateTo(SAVE_VERSION)` (the `MIGRATIONS[v]` chain, then `backfill` for added fields) →
  `validState` → `sanitize` (clamps numbers, drops unknown items/abilities/enemies). `applySave` then runs
  `reconcileParty` (HP/TP inside today's maximums, charges for every known skill). `slotStatus` distinguishes
  empty, ok and damaged. `tests/fixtures/save-v1-annex.json` is a real v1 save that must keep loading.
- **`party.ts`**: member stats from base + growth + equipment (`memberStats`), XP curve, learnsets, `rest`,
  `innPrice`, `canEquip`. Since 2026-09-29: abilities can need a **story flag** as well as a level
  (`CH1_STORY_FLAGS` in `data/abilities.ts`: `stingray_seated`, `rook_tuned`, `rook_mended`, set by the script API's
  `unlock`); Rook's **wound** (`isWounded`, `WOUND`/`WOUND_TUNED`, `maxUses` a charge short) lifts in two story steps;
  a **level-up is a full restore**; prices follow `crewLevel()` (Rook's veteran 10 excluded).
- **`newgame.ts`**: `freshGame()`, the state a new game starts from (pure, tested).
- **`settings.ts`**: persistent options (volumes, text and battle speed, timed presses on/assist/off, shake, flash,
  hit pause, scale, custom keys), saved separately from games.
- **`script.ts`**: the `ScriptApi` type: everything a story script can do (see section 5).
- **`hooks.ts`**: `fieldHooks`, late-bound functions the field calls (menu, battles, shops, inn, clinic, give/take,
  join/leave, panels, end of chapter, save prompt). Installed by `systems.ts`.
- **`systems.ts`**: `installSystems(game, handlers)`, the wiring:
  - **random encounters** per map zone;
  - **battles** (`runBattle`): the battle system is a **separate chunk**, lazily imported and prefetched at boot;
  - shops, the inn (only standing members pay), the clinic;
  - the menu and saving; game over (retry, load, title); the ending;
  - **autosave** (every area change, and a periodic ticker; paused in a second tab);
  - the Rustfang bounty tally.
- **`stages.ts`**: debug presets (`start`, `town`, `sinkline`, `annex`, `finale`) that set up party, gear, flags and
  position for tests and screenshots.
- **`debug.ts`**: switches for E2E (`autoDialog`, `autoBattle`, `autoLose`, `playtest`) and the battle driver that
  exposes them. DEV builds only.

**Multiple tabs** (`boot.ts`): tabs talk over a `BroadcastChannel`. The oldest open tab autosaves; a closing tab
says goodbye and closes its channel, and the next oldest takes over.

---

## 4. The field (`src/field/`, `src/scenes/field.ts`)

### Maps (`src/data/maps/*.ts`, types in `field/types.ts`)
A `MapDef` is authored data:
- **`terrain`**: rows of characters, usually built with `Grid` (`data/maps/grid.ts`: `rect`, `set`, `paste`), mapped
  to `TerrainId`s through `legend` (merged over `DEFAULT_LEGEND`).
- **`patches`**: terrain rewrites that apply when a flag condition holds (the drained junction, the opened panel).
- `structures` (buildings with doors, signs, awnings), `props` (placed objects, each kind a painter), `npcs`,
  `warps`, `events` (`touch` or `action`, optional `once`, `when`), `chests`, `lights`, `encounters` (zones with a
  table, a rate, and a backdrop), `ambient` (the light-map base colour), `weather`, `music`.
- Most lists accept `when: (flags) => boolean`: the map is rebuilt when flags change (`s.refreshMap()`), so a
  valve can turn green or a pod can shatter.
- Registered in `data/maps/index.ts` (`getMap`, `mapIds`). Maps: `lantern_row`, the interiors (bar, shops, flats,
  clinic, inn, noodle bar…), `world` (the Sprawl), `rustyard`, `sinkline_1`, `annex`, `dock`.

### Building a map (`fieldmap.ts`, `tiles.ts`, `buildings.ts`, `props.ts`, `bake.ts`)
`FieldMap` parses the def and **bakes** it once into layers: ground (tile painters from `tiles.ts`, one per
`TerrainId`, 16×16 px), structures, sprites (props and buildings as depth-sorted sprites with an emissive layer), an
overhead layer, animated props (`anims`), and lights. The field scene caches built maps (`MAP_CACHE_MAX` 8 in `scenes/field.ts`); `refreshMap()`
rebuilds after a flag change. `SOLID_TERRAIN` decides walkability; props block their footprint unless `pass: true`.
After the tiles, a **relief** pass shades the ground at the foot and right of raised terrain (walls, city blocks);
dungeons also bake a faint unlit edge where floor meets wall or void (`bakeStructureEdges`).

### Actors, lighting, weather
- `actor.ts`: grid movement with smooth steps, walk frames, idle poses after standing still, emotes, and path
  following for scripts.
- `lighting.ts`: a light map (ambient colour + additive radial lights, some flickering) multiplied over the scene;
  sprites are lit individually.
- `weather.ts`: pooled rain in three depth layers (drawn in one ordered pass), splashes, drips, dust.

### The field scene (`scenes/field.ts` + `fieldkit/`)
Owns the map, party train (followers walk the leader's trail), NPCs, chests, camera (follow, pan, clamp), the draw
list (depth-sorted each frame from pooled entries), banners, the objective line, and **script execution**
(`runScript(fn)`, with `busy` counting running scripts). `fieldkit/api.ts` builds the `ScriptApi` for a field;
`fieldkit/draw.ts` has the shell drawn round small interiors, blits and emotes; `fieldkit/dust.ts` the dash dust.

---

## 5. Story scripting (`src/story/`, `game/script.ts`)

A **script** is `async (s: ScriptApi) => { … }`. It `await`s each step, so a scene reads top to bottom:

```ts
export const magsReward: ScriptFn = async (s) => {
  if (!s.flag('knuckles')) { await s.say('mags', 'Tire depot, north end…'); return; }
  await s.give('coprocessor', 1);
  s.set('coprocessor_given');
  const keep = await s.ask('mags', 'The camp took up a collection…', ['Take it', 'Leave it with the camp']);
  …
};
```

The API (`game/script.ts`): `say`, `narrate`, `ask` (returns the chosen index), `wait`; `flag`, `get`, `set`;
`give`, `take`, `has`, `cred`; `join`, `leave`, `restoreParty`; `battle` (returns win/lose/run); `warp`, `move`,
`face`, `emote`, `spawn`, `despawn`, `followers`, `actor`, `regroup`, `pan`, `panBack`; `fadeOut`, `fadeIn`,
`shake`, `flash`, `sfx`, `music`; `shop`, `inn`, `clinic`, `banner`, `panels` (comic pages), `endChapter`,
`savePrompt`, `tutorial`; `refreshMap`; `objective`.

- **`story/chapter1.ts`** holds every beat, the objectives (`OBJ`), the valve and lattice puzzles (`VALVES`,
  `RELAYS`, `RELAY_COLOR`, `latticeEmitters`), the cryopod, the Warden and the betrayal. Its header lists **every
  story flag in the order the chapter sets them**; `tests/maps.test.ts` walks every map at every one of those stages
  to prove there's no dead end.
- Scripts attach to data: an NPC's `talk`, an event's `run`, a warp's `blocked`, a map's `onEnter`.
- **Speakers** (`data/speakers.ts`): name, colour, voice pitch and portrait for each `say` id.
- **Comic panels** (`scenes/panels.ts`): the intro and the ending, as pages of panels with captions and speech.

---

## 6. Battles (`src/battle/`, `src/scenes/battle.ts`, `src/scenes/battlekit/`)

### The engine (`battle/engine.ts`): pure and deterministic
- `Battle(party, enemies, rng, opts)`. Combatants carry base stats, HP/TP, skill uses, statuses, memory (for AI).
- A round: the player enters **commands** for everyone (`attack`, `tech`, `skill`, `item`, `guard`, `run`);
  `startRound(cmds)` rolls initiative and plans the queue (agility order; combos, first strikes and Guard adjust
  it); then, per action, **`next()` declares** it (who, what, at whom; returns events and an optional **timing
  prompt**) and **`land(timing)` resolves** it; `endRound()` ticks statuses and decides the outcome.
  `resolveRound(cmds, grader?)` runs that loop in one call (tests and sims).
- **Combos** (`data/abilities.ts` `COMBOS`): two or three members' specific abilities in the same round fuse into one
  stronger action (`Battle.findCombos`, largest first). Each has a caller and a line.
- **Timed presses**: an action offers a `TimingPrompt` (`strike` for the crew's hits, `brace` for hits on the crew,
  `mend` for a crew member's healing skill) with a profile (`quick`, `normal`, `heavy`). The grade (`perfect`, `good`,
  `none`, `whiff`) multiplies damage or healing (`STRIKE_MULT`, `BRACE_MULT`, `MEND_MULT`); a whiff costs. The window
  itself is `battlekit/timing.ts`.
- **Tells** are their own event (`{ t: 'tell', actor, text }`, from an enemy AI's `message`): the scene pins them at
  the top of the screen until that enemy has acted (`BattleScene.tell`). Plain `msg` events are transient lines.
- **Targeting**: single-target enemy blows go through `ai.ts` `smellBlood` (the member lowest by HP percent weighs
  `BLOOD_WEIGHT` = 1.5, everyone else 1).
- Damage: physical (ATK² / (ATK + DEF)) or tech (power + MND vs RES); elements (`phys fire shock mana cyber`) against
  **family** weaknesses (`data/enemies.ts` `FAMILY_WEAK`, per-enemy overrides); crits; Guard (half, a quarter against a
  telegraphed blow; a guarded hit gives TP back, or Rook a spent charge once a fight); statuses (stun, with two
  rounds of immunity after one; blind, poison, burn, jammed, exposed, buffs and debuffs, cover, lock-on, hijack).
- **`ai.ts`**: enemies pick from weighted move tables with conditions; scripted AIs have **tells** (the Warden locks
  its cannon on a named member; Knuckles squares up to a named member; the turret spins up; the Arcanist draws a
  surge that damage or blindness breaks; the Lurker and the Warden's spirit have their own patterns).
- **`fx.ts`**: `FxLayer`, pooled particles and shapes for every ability's visual; `play(id, from, targets)` returns
  when the hit lands.
- `setup.ts` builds combatants from party state and enemy data; `types.ts` holds the types.

### The scene (`scenes/battle.ts` + `battlekit/`)
BattleScene holds battle state and flow (intro, the round menu, per-member command menus, targeting, executing a
round, victory, defeat, fleeing). Its parts:
- `render.ts` (`BattleRenderer`): all drawing: backdrop, enemies (idle, strike and flinch frames), the party from
  behind (swing beats), floaters, panels, menus, the turn-order strip, target info, cut-ins, banners, the impact frame.
- `playback.ts`: `playEvent(view, event)` turns engine events into animation and sound (tested against a recording
  view in `tests/playback.test.ts`).
- `timing.ts` (the ring and its judgement), `orders.ts` (building menus and orders, combo hints), `motion.ts` (the
  swing's beats), `sprites.ts` (enemy frame caches, recolours, dissolve), `geom.ts` (layout constants),
  `tables.ts` (poses, sounds and stings per effect), `intro.ts` (the glass-shatter transition), `driver.ts` (test hook).
- Three layers under a full-resolution UI: the backdrop world (240×135, scaled 2×), the **enemies** on a
  screen-resolution layer (drawn through a 2× transform, so creatures' finer art lands 1:1; `EnemyArt.res`, `w`, `h`),
  and a clear world-scale layer for the party, effects, rings, arrows and numbers.
- **Pace:** every move's animation (effects, poses, cut-ins, numbers) runs on one clock, `FxLayer.rate` =
  `FX_PACE` (0.65) × Battle Speed; each action lets its effect finish and holds `TURN_GAP` before the next. A move's
  flash and shake are held until its impact. The intro shatter is `INTRO_T` (52) frames.
- The command menu is always bottom-left and the turn strip always right; the strip also shows the live queue while
  the round plays. Damage-type symbols (`ELEMENT_ICON`, private-use glyphs in the font) mark every order.
- `scenes/deck.ts` (Hex's deck: dead, the Stingray seated by hand, the menu's Deck page) and `art/deck.ts` (the
  deck drawn in code, plus the mini deck for the in-battle cut-in). The deck scene is its own lazy chunk.

### Art for battles
`art/battlers.ts` (party battle frames from the back: idle, attack, strike, cast, item, hurt, victory, thrust,
brace, aim), `art/enemies.ts` (enemy makers; humans are built on the character rig, creatures with `Pix`; every
recurring enemy and each boss has `attack` and `hurt` frames; pack-mates are distinct individuals),
`art/battlebg.ts` (backdrops per place, with foreground framing).

---

## 7. Procedural art (`src/art/`)

- **`pix.ts`**: `Pix`, a pixel canvas in design units with `rect`, `ellipse`, `ball` (shaded, dithered spheres),
  `poly`, `line`, `limb`, `outline`, `form` (whole-silhouette light and shadow) and `toCanvas`; `scale2x` (EPX).
- **`chars.ts`**: the character rig. A look (`CharLook`: body, skin, hair style and colour, clothes, accessories,
  mouth, brows, eyes, stance, umbrella, carried item, idle) is painted from **letter grids** (`BODY`, `HAIR`, `ACC`)
  through a palette, for four directions × three walk frames. `buildChar(look)` is cached.
- **`portraits.ts`**: dialogue portraits per speaker and face (`neutral`, `happy`, `sad`, `angry`, `surprised`,
  `smirk`, `hurt`).
- **`critters.ts`**: cats and crows.
- `data/looks.ts`: the cast's looks (`LOOKS`) and `randomLook(seed)` / `streetLook(seed)` for crowds.
- **Rig v2 (`rig2/`, since 2026-09-30): characters drawn in code from traced standing frames.** A look with
  `rig: 'kit'` (the crew so far) is built by `rigSprite()` instead of the letter-grid templates. `public/art/rig/field.json` (loaded at startup by `rig2/data.ts`)
  holds each character's standing frame per facing, traced from the PixelLab pick Mark liked by
  `scripts/art/trace.mjs` (palette-indexed pixels, one palette per character, outline removed, the feet and hip
  rows). Everything else is code and identical every time: below the hip only trouser and boot colours move
  (`legColours`), so hair, coat hems and staffs hang still; facing us or away a step lifts one foot a pixel; side on,
  the legs swing apart about the hip by RotSprite (Scale2x up 8x, rotate, sample down), the far leg a shade darker;
  the body bobs on passing steps; the outline is drawn around each finished pose. Walks go in `CharSprite.walk`.
  The crew's battle backs (`rig2/battle.ts`, from `battle.json`) pose by code: the moving hand or staff cut out by
  colour and turned, a forearm drawn to it, weapons drawn in code, and the light each pose throws. NPCs and
  townsfolk (`rig2/npcs.ts`) are swapped in after loading; passers-by take the townsfolk looks in turn. **Enemies**
  (`rig2/enemy.ts`, from `enemies.json`, keyed by sprite name): `enemyArt()` takes the traced redraw where there is
  one, keeping the code-drawn art's idle motion, shadow and size; the strike frame leans it in and the flinch tips it
  back (RotSprite about its feet), and its bright, saturated pixels make its glow. It's `individual`, so a second
  copy in a fight is mirrored and marked.
- **Drawn art (`drawn.ts`, shipped since 2026-09-30).** At startup `boot.ts` awaits `loadDrawnArt()`: it reads
  `public/art/manifest.json` (written by `scripts/pixellab/export-picks.mjs` from Mark's review) and hands each piece
  to its cache's replace hook: characters (a sheet per character: a row per facing, standing frame then walk),
  the crew's battle backs (the standing frame for every pose; the battle animates it in code), enemies (marked
  `individual`, so a second copy is mirrored and marked, not palette-shifted), terrain (Wang tilesets laid over the
  painted terrain as a map bakes: `addTerrainOverlay` in `field/tiles.ts`) and props (`replacePropArt` in
  `field/props.ts`: the prop's painter still runs for its light, flicker and blocking, into scratch, and the picture
  stands on its footprint with a shadow and its bright pixels glowing). A piece that fails to load keeps its
  code-drawn art, with a notice; `?art=classic` skips all of it. Portraits are held back until they have all their
  expressions.
- **Drawn art, tried in place (dev only).** Each art cache has a `replace…` hook (`replaceCharSprite`,
  `replaceBattler`, `replaceEnemyArt`, `replacePortrait`) that `src/dev/artswap.ts` uses to put PixelLab art-pass
  picks into the running game (`?art=review`). Two fields exist for that art: `CharSprite.walk` (a drawn four-frame
  walk per facing, which `Actor.frame()` prefers over stand/step/stand/step) and `Battler.res` (art pixels per
  battle pixel, as `EnemyArt.res` already had; the party is drawn through `putArt`). The pipeline and the review
  page: DEVELOPING.md §8, "The PixelLab art pass".

---

## 8. Audio (`src/audio/`)

- **`engine.ts`**: the WebAudio graph. Instruments (`lead`, `lead2`, `reed`, `pluck`, `twang`, `arp`, `bass`, `sub`,
  `pad`, `choir`, `organ`, `bell`, drums) are synthesized per note. The music bus runs EQ, saturation and a
  compressor; there are reverb **spaces** (per place, crossfaded), a delay, dialogue ducking, an air bed, and a
  master limiter. `playNote`, `audio.wake()` (unlocks on the first input), `close/reopen`.
- **`music.ts`**: the **song format** and sequencer. A `SongSpec` has bpm, a chord progression (bars separated by
  `|`), parts (hand-written `notes` or a generator `gen` from the chords), a drum pattern, loop point, intro bars,
  **rest bars** (breakdowns: drums, bass and sub drop out), a gain trim, an air level and a space. Notes: `A4`,
  `C#5`, `-` hold, `.` rest; each bar's tokens divide it evenly. `music(name, fade)`, `pushMusic/popMusic`,
  `placeMusic`, and `renderSong` (offline, for the audio evidence).
- **`songs.ts`**: the soundtrack (title, town, bar, world, rustyard, dungeon, lab, battle, boss, boss2, victory,
  victory_boss, gameover, sable, tension). `tests/music.test.ts` checks every bar's length and that melodic
  dissonances resolve.
- **`sfx.ts`**: 69 synthesized effects, levelled by a measured gain table (`LEVEL`).

---

## 9. UI (`src/ui/`, scenes)

- `ui/draw.ts`: `drawWindow` (frame, gradient, scanlines, corner brackets, circuit trim, title tab, footer tab),
  `drawSelect`, `drawCursor`, `drawBar`, `drawDivider`, `keyLegend`, the `UI` colour tokens, `OVERLAY_DIM`.
- `ui/list.ts`: `ListMenu`, scrolling, wrapping, disabled rows with a `why`, right-hand detail, repeat navigation.
- `ui/layout.ts`: text widths shared with `tests/layout.test.ts`, which proves every data-driven string fits.
- Scenes: `title`, `field`, `battle`, `menu` (items, techs, equip, status, combos, bestiary, places, save,
  options), `shop`, `dialog`, `card`, `panels`, `ending`, `gameover`, `saveload`, `options`, `controls`,
  `placemap`, plus DEV test scenes (`chartest`, `bestiarytest`, `fonttest`, `mapview`, `portraittest`).

---

## 10. Build, tests and tooling (summary; details in DEVELOPING.md)

- **Build:** `vite build` (after `tsc --noEmit`): two chunks, the boot bundle and the battle system. Budgets in
  `scripts/bundle-budget.mjs` (chunk 480 kB, total gzip 200 kB).
- **Unit tests** (`tests/`, Vitest, node): battle rules, **balance simulations** (`tests/sim.ts` plays whole fights
  and dungeon runs with a competent policy), the **economy model** (`tests/economy.ts`, Monte Carlo over the route),
  pacing, save/migration, input, UI list, layout and glyphs, map connectivity and dead ends, music, motion, weather
  and lighting.
- **E2E** (`e2e/`, Playwright, Edge locally, Chromium/WebKit/Firefox in CI): the full chapter through the real
  scripts, a real-speed playtest capture, game over and saves, tabs, boot failure, chaos input, the shipped build,
  frame budgets, audio evidence, and the screenshot set.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit tests, bundle budget, E2E.

---

## 11. Content data (`src/data/`)

| File | What |
|---|---|
| `party.ts` | The four members: role, colour, resource label, bio, base stats and growth, start level and gear |
| `abilities.ts` | Every tech, skill, combo and enemy move (`ABILITIES`), combos (`COMBOS`), learnsets (`LEARNSETS`), `ability(id)` |
| `enemies.ts` | Enemies (stats, family, moves, drops, lore, AI key, sprite), `FAMILY_WEAK`, `FAMILY_IMMUNE`, encounter tables (`ENCOUNTERS`: `street`, `barrens`, `park`, `sinkline`, `annex`, and the fixed fights `f_*`) |
| `items.ts` | Consumables, weapons, armour, headgear, mods (with `who` can equip), key items, loot; `sellPrice` |
| `shops.ts` | Shop stock, keepers, greetings, discounts |
| `looks.ts` | Character looks and crowd generators |
| `speakers.ts` | Dialogue speakers |
| `maps/` | Every map (section 4) |

Words, names and places are catalogued in `docs/GLOSSARY.md`; the world behind them in `docs/SETTING.md`.
