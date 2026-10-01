---
type: status
title: Shadow Jog — Project Status
project: shadow-jog
created: 2026-09-27
updated: 2026-09-30
tags: [status]
---

# Shadow Jog

Browser JRPG: a cyberpunk-fantasy setting with the Phantasy Star IV game loop. Chapter 1, "Milk Run", covers the town
(Lantern Row), the world map (the Sprawl), an outpost (the Rustyard) and a two-floor dungeon (the Sinkline B1 and
K-M Annex 7). About 45–75 minutes. Design lives in `docs/GDD.md`.

**GitHub:** [markhazlewood42/shadow-jog](https://github.com/markhazlewood42/shadow-jog) (public). CI: GitHub Actions
on every push to `main`.

## Where we left off (2026-09-30, afternoon)

### The whole process so far
1. **Build (2026-09-27 → 28).** From the original prompt (`docs/original-prompt.md`) to a content-complete chapter:
   town, world map, outpost, two-floor dungeon, four party members, 21 enemies and three bosses, nine combos, an
   economy, a story with a comic-panel intro and ending, 15 songs and 69 sound effects, all generated in code (16 and
   72 since playthrough 2).
2. **Quality loop (rounds 1–12, 2026-09-28 → 29).** Eleven areas scored by fresh independent reviewers each round.
   The average went 6.36 → 7.98. All of it is in `docs/quality/GRADING.md`; scores in `docs/quality/scorecard.md`.
3. **Exit (2026-09-29).** Round 12 was the last automated round; Mark's own playthrough became the gate.
4. **Playthrough 1 (2026-09-29).** Mark played part of the chapter and left 25 notes
   (`docs/mark-playthrough-notes.md`). All 25 were worked through; `docs/quality/playthrough-1.md` answers each (what
   changed, where to see it, the commit) and lists the judgment calls. Big pieces: slower, readable battles (one
   animation clock, a beat between turns, longer transition, slower timed presses, a Battle speed setting still there);
   damage-type symbols; a louder "who's acting"; fixed menu and turn strip; the shop's slot tag, equip-now and sell-all;
   Chapter 1 now ends around **level 6** (new XP curve), new abilities are rare (three by level) and a level-up fully
   restores; **Rook is a level-10 veteran who starts wounded** and heals in two story beats; **Hex's deck** (seen dead,
   the Stingray seated by hand, a Deck page with slots for later parts, a mini deck in battle); Sinkline encounters
   1 in 40; field depth cues (relief shadows, Sprawl facades and curbs, Sinkline caps and edges); glowing chests and
   an interact marker; finer, smaller creature art; Last Rites Arms (was Iron Saint Arms).
5. **Round 13 (at Mark's request).** One verification round: ten areas re-scored plus a reviewer checking each note
   (21 addressed, 4 partial). Average **7.22** (round 12: 7.98): regressions this work introduced (New Game started
   Rook at 3, old saves didn't migrate, broken screenshot navigation hid a Bestiary overflow, clipped labels, …) were
   all fixed after the reports (de5fff5, c7c055b), with tests; the rest is trade-offs the notes asked for and older
   findings scored more strictly. The fixed state isn't re-scored. Reports: `docs/quality/reviews/round-13.md`.
6. **Playthrough 2 (2026-09-29, same save, to just past the Lurker).** 14 more notes, all worked through;
   `docs/quality/playthrough-2.md` answers each. Big pieces: enemies no longer gang up on Hex (they lean, 1.5×, on
   whoever is lowest by percent, per Mark's follow-up); boss tells pinned on screen until acted on; healing skills get a
   green timed ring (+30% on the beat); a real level-up moment (fanfare jingle, stats counting up, restore, new
   abilities); valve, pipe and pump sounds; the equip screen shows the highlighted slot's gear with stat diffs; damage
   types written by name carry their symbol everywhere; Kit's own bed is a free rest; the inn's price line fixed; the
   stray examine twinkles removed; Dutch's hat centred; clothes rails in Kowloon Threads; a taller APTS block; shop tags
   name only crew you've met. Verified with unit tests, the affected E2E specs and hand checks of each screen (no
   scored round: Mark didn't ask for one).

### Right now
- **GPU effects layer: first slice in (2026-09-30).** A WebGL 2 presenter over the Canvas 2D game (not the PixiJS
  rewrite): real bloom on neon, lamps and spells, shockwaves, a colour split on big impacts, and GPU particles from
  data presets (`src/data/emitters.ts`), wired to battle moments (`battlekit/gpufx.ts`). Options → GPU effects
  (on by default); without WebGL 2 the game is unchanged. How it works: `docs/ARCHITECTURE.md` §2 "GPU effects".
  **FX lab built (2026-09-30):** `npm run dev`, then http://localhost:3007/?scene=fxlab. Mark tunes every preset
  and every battle moment (what plays on a FIRE hit, a crit, a combo…) with sliders, fires them on a battle
  backdrop, and **Save** writes `src/data/fx.json` (commit it to ship). Guide: `docs/DEVELOPING.md` §8.
  **Next slices, for Mark to pick:** per-spell looks (heat haze for FIRE, a lightning flash for SHOCK, a Warden cannon charge); field weather (rain
  splashes, lamp flicker into the bloom); per-place colour grading.
- **Trailer, "before" record (2026-09-30):** `media/shadow-jog-trailer-2026-09-30.mp4` (94.7 s, 1080p60, game audio;
  not in git) records the game as it stands with everything made in code, before any AI-generated art. Shot by
  `node scripts/trailer.mjs`; re-shoot after the art changes for the "after".
- **Mark's review of the code-drawn art (2026-10-01): every asset marked Best.** His three notes are done (new
  versions on the review page): Sable's staff was half gone in her down view (the tracer took a thin dark staff for
  outline; it now keeps thin dark lines with nothing behind them, which also restored Hex's antenna and a few
  enemy details); the hooded scav townsperson (pool 6) has a human face instead of the gas mask he read as an ewok
  (`FACE_FIXES` in `scripts/art/trace.mjs`); Rook's portrait is traced from round 2's first redo, made from the
  same note (broad shoulders, the chrome arm prominent). He hasn't looked at the animations yet.
- **Pixel-art library (2026-10-01, Mark's ask):** `knowledge/pixel-art/` is the craft in depth, written to be
  taught: 16 modules in teaching order (README has the curriculum map and a learning path), a glossary, and a page
  per source (55). Each module ends with "In Shadow Jog". Its five suggestions for the game's art (one pixel
  density in battle, labelled palette slots, silhouette/greyscale toggles on the review page, light direction,
  a pixel-art lint) are in the README; none is acted on yet.
- **Spells that look like spells (2026-10-01, Mark's pick for the first effects slice).** Each element has its
  own signature, with a cast, a travel and an impact: Firebrand (embers gather, a fireball arcs over, the target
  stands in flames under a heat haze), Wildfire (the stage dims, the ground catches under every enemy in turn),
  Overload (the stage darkens, forked lightning out of the sky, arcs crawling after), Spike (code streams at the
  target and the screen tears there), Iron Palm (ki in the fist, a palm print, a hard push), Dragon Coil (one ki
  serpent winding through every enemy), heals (a turning ring of runes; Mending Rain falls as light). New GPU
  effects: heat haze, glitch, stage dim, inward-gathering particles. All tunable in the FX lab (new Spells tab;
  `cast.*`/`spell.*` moments). **Next for Mark:** cast them in the lab (DEV menu → FX lab → Spells) and in a
  battle, and say what to push further; then the combos, the enemy casters and the rest of the moves.
- **Skeleton and animation editor: first build done (2026-09-30, night).** The crew's battle arms are bones now
  (`skeleton.json`; limbs can't stretch) and `/rigedit.html` poses them (drag the hand; notes per pose for Claude;
  Save writes the file), and **"Ask Claude to fix it"** works: Claude Code headless on his plan reads the pose
  and his note and changes the pose in ~5–30 s (tested: "fist straight up, calling down lightning" took 5 s).
  The poses are the old ones converted, waiting on Mark's eye. **Next in this thread:** his pass in the editor
  (under way 2026-10-01, Kit first: her jacket sleeve now moves with her arm, drawn clean, torso filled; a
  turntable shows each crew member's 8 drawn views); then in-betweens (tweening between key poses) and the field
  sprites on the same bones. **Pinned (Mark, 2026-10-01): a 2.5D depth prototype on Kit's strike** (a depth
  control for the hand: the arm foreshortens reaching into the screen, the fist shrinks a little, draw order
  follows depth; maybe a drawn end-on fist swapped in), after the current kinks are worked out.
- **Next (Mark, 2026-09-30, night): a skeleton rig, then a novice-friendly animation editor.** Battle limbs stretch
  today (the forearm is a band from a fixed elbow to wherever the hand goes); fixed-length bones fix that by
  construction. Then an editor page (dev only): pick a character and pose, drag a hand and the elbow bends (IK),
  onion skin, play at game speed, save to pose data the game reads; notes per frame for Claude, and later a live
  "tell Claude" box (Claude Code run headless by the dev server, on his Max plan) that proposes a pose he accepts or
  rejects. Everything feeds back into the code-drawn sprites. Special effects after that.
  **PixelLab ends ~2026-10-30** (Mark cancels after a month): `docs/PIXELLAB-LESSONS.md` maps every capability to our
  replacement and lists what's worth generating before then (needs his OK; 827 generations left): mainly standing
  frames for future characters, the one thing code can't make.
- **Direction change (2026-09-30, late): back to code-drawn art, made better.** Mark: the game's UX was better with
  the code-drawn assets; PixelLab's glitches and inconsistency aren't worth it. Goal: code-drawn pixel art that looks
  better than before but keeps the flexibility to animate and improve incrementally, using the PixelLab picks he
  liked as reference. **Kept from PixelLab by default: the tilesets and props** (Mark: he likes them); characters,
enemies and portraits are code-drawn again (`?art=drawn` loads all the PixelLab picks, `?art=classic` none). Snapshots to roll
  back to: tag `snapshot/2026-09-30-procedural` (all code-drawn), tag `snapshot/2026-09-30-pixellab-picks` (picks
  shipped), and `media/snapshots/art-pass-2026-09-30.tar.gz` (every generated option and his full review; local).
  **Next focus after this (Mark): special effects, "the real differentiator"**, once the art is in a good middle
  ground (scalable, decent animation). **The review tool stays in use for the code-drawn art** (Mark): each rig
  iteration is rendered onto /artreview.html (`scripts/art/review-rig.mjs`) as a new version beside the old sprite
  and the PixelLab pick.
  **Rig v2 progress (2026-09-30, while Mark was away):** the crew's battle backs (Kit from her stance; Rook draws
  and swings a code-drawn katana, the hilt leaving his back; Hex aims a code-drawn pistol; Sable lifts and swings her
  staff), with drawn light per pose; every NPC and townsperson on the rig (traced from their PixelLab standing
  frames, including the four he turned down for walk glitches, since the rig's walk replaces PixelLab's); passers-by
  take the 8 townsfolk looks in turn. The traced data loads from `public/art/rig/*.json` at startup (it pushed the
  script bundle over its budget as code). All 21 enemies on the rig too (traced from his redraw picks; strike and
  flinch by code; glow from their bright pixels). All of it on the review page (Rig v2 · crew / battle / enemies /
  NPCs / townsfolk), code-drawn art only (Mark: no PixelLab sprites there; an "Art" chip brings back the archive).
  **Portraits on the rig too:** the 8 picks traced with the faces the art pass redrew (Kit, Hex, Sable, Dutch); the
  rest drawn in code (all of Rook, Pale, Mags and Yun's expressions; Dutch's unused ones); every portrait now talks
  while a line types and blinks (Rig v2 · portraits on the review page, the blink and talk last in the strip).
  The script bundle budget is 236 kB since the skeleton (Mark's call; measured 224.9 kB).
  **First build done (rig v2, the crew in the field):** Kit (from the round-2 redo, with a face in profile), Rook,
  Hex and Sable traced and walking in code (`src/art/rig2/`); review versions v1 and v2 on the page. Next in the
  slice: Kit's battle back from her fighting-stance frame, with stance → strike and a cast raise by code (Mark's
  direction: the strike starts in her stance and ends fist out in it).
  **Plan:** a rig v2 for characters: chibi proportions from the picks (~18x28 field sprites, faces in every
  facing), 3-4 tone hue-shifted ramps per material with one light direction, selective outlines, parts drawn in code
  and layered per facing, animation in code (walks; battle key poses as part swaps, directable by Mark). First build:
  the four crew in the field + Kit's battle back with stance, strike and cast.
- **Art pass, phase 1 in the game (2026-09-30, evening).** Mark reviewed round 1 (98 assets) and his picks now ship:
  `public/art/` + `src/art/drawn.ts`, loaded at startup over the code-drawn art (which stays as the fallback;
  `?art=classic` compares). In: 33 characters (Hex, Rook, Sable in the field; 25 named and one-off NPCs; the
  townsfolk pool), the 4 crew battle backs (standing frame; code motion), all 21 enemies (redraws), 5 tilesets laid
  into their maps, 17 props. Held: portraits (need expressions), Noodle (critters aren't sprite-based), the harbour
  tileset (no map). Kit's field sprite stays code-drawn until he picks a round-2 redo. E2E (prod, perf, gpufx,
  gameover) pass with it; 60 fps held.
  **Round 2 (70 generations, balance 923) is waiting on his review:** Kit field redo ×2 (faces in the side views
  now), Pale and Rook portraits with his notes, bed/car/shrine/dumpster each with its own camera (bed and car
  fixed; shrine half; dumpster still angled), and new walking-away frames for Mags, Pale, Hex, Rook and three
  townsfolk (salaryman, scav, Hex fixed; Mags and Pale still show a front-facing or tie frame, repaired at export
  where it's detected, or by his flags; Rook's sword is now missing from the whole cycle).
  **Portrait expressions (Mark chose "main speakers, inpainted"):** `scripts/pixellab/expressions.mjs` redraws only
  the face box of the picked portrait per expression the game uses (counted per speaker: Kit, Rook, Hex all six;
  Sable five; Dutch and Pale two; Mags three; Yun one). Done and in the game: **Kit, Hex, Sable, Dutch** (19 faces,
  95 generations; balance ~828). Waiting: **Rook and Pale** (8 faces, ~40) until Mark picks their round-2 portraits;
  Mags and Yun (4, ~20) not yet approved.
  **Scale (measured 2026-09-30):** new characters are ~15% taller (median; 0.91–1.29x) and much wider (chibi heads:
  ~13x25 → ~19x29 px); props median 1.07x, outliers the barrels (15 → 26 px) and the terminal (22 → 28). Proposal to
  Mark: don't shrink pixel art; most of the mismatch is the code-drawn Kit among new characters (goes away when he
  picks a round-2 Kit); then only fix the outliers (barrels at today's size) and check 16 px doorways.
- **PixelLab art pass, round 1: generated, waiting on Mark's review (2026-09-30).** Mark subscribed to PixelLab (Tier 1,
  2,000 generations a month) and asked for a full pass over the game's art, with options to choose between, reviewed in
  a tool of its own rather than swapped in place. Budget: at most half the month (the client stops at a balance of
  1,000). **Review it:** `npm run dev`, then http://localhost:3007/artreview.html (★ Best / ✓ Good / ✗ No and notes per
  option; saves to `media/art-pass/review.json`; **Try ↗** opens the game with an option swapped in). Read his verdicts
  next session with `node scripts/pixellab/status.mjs --review`. What was made, and the recipes: `scripts/pixellab/plan.mjs`;
  how it all works: `docs/DEVELOPING.md` §8 "The PixelLab art pass". The art is in `media/art-pass/` (not in git) until
  he picks; **integration (putting picks into the game for real) is the next step after his review.**
  **What round 1 made** (963 of the 1,000 generations allowed; 165 options across 98 assets, side by side):
  - *Crew, field:* Kit and Rook (Mark's picks from the tests) with walk cycles; Hex and Sable two ways each (styled on
    their own sprite / on the new Kit), with walks.
  - *Crew, battle (from behind, 128 px, twice today's detail):* two recipes each (styled on the new Kit: saturated
    but it misreads details, e.g. Hex's bun as a hat and Rook's katana as a red bar; prompt only: taller, more faithful),
    each with a fight-stance idle, attack, special or cast, hurt, item and (some) victory animations.
  - *Enemies and bosses (21):* "redraw of today's design" (today's sprite as the style image) and "new look, crew
    style". The redraws are the stronger set; the crew-style ones often come out small in their frame. The bosses
    are the best of the lot.
  - *Portraits (8):* styled on today's portrait (consistently strong) and prompt only (mostly came out as tiny
    full figures, not busts).
  - *NPCs:* the 8 named looks (with walks), 18 one-off NPCs, Noodle, and 8 townsfolk looks for the passers-by
    (with walks), one option each, styled on the new Kit.
  - *Props (20):* redrawn at today's size, and PixelLab's map-object tool (32 px minimum, so often bigger).
  - *Terrain (6 two-terrain tilesets × 3 recipes):* shown laid into the real levels (Mark asked to judge them in
    context: `scripts/pixellab/render-maps.mjs`). **The weakest category:** the tileset tool makes generic
    raised-block tiles; "today's colours, more texture" is closest. The harbour set has no map to go in.
  **Integration questions for after the review:** the game has been all-code so far, and picks become PNG files it
  loads (the one exception to "every asset generated in code"); a scale pass (Mark: the new sprites run large);
  portraits need the other expressions (only neutral was made); enemies have no strike or flinch frames yet; the
  game's palette shift for a second copy of an enemy recolours drawn art badly (green skin).
  **Decided from Mark's review so far (2026-09-30):** PixelLab's battle animations are unusable (bodies drift,
  clothes and hair change, the moves don't read), so battle sprites use **only the standing back view** and the
  game's code-driven motion (lunge, strike smear, hurt drop, hop); `?art=review` already does this (`&frames=anim`
  shows the drawn frames). Don't spend more on battle animations.
  **But no animation at all feels stiff, a UX regression** (Mark): PSIV-style battles need 2–3 key poses per action
  (stance → strike, arm raised to cast) plus effects. Tried: inpainting just the arm on Kit's standing back view
  (`scripts/pixellab/poses.mjs`, 24 generations): identity held, but the poses were wrong for the character (her
  strike should start from her **fighting stance**, the unflagged frames of her PixelLab idle, and end with the fist
  extended in that stance). **Pinned (2026-09-30): Mark will make the key poses himself in PixelLab's editor**,
  character by character. Don't generate battle poses without his pose direction. The game side is ready:
  `?art=review` shows `poses` (per option in meta.json) with code-drawn sparks and arcs; hand-made frames can be
  wired in the same way when he has them (ask him how he'd like to hand them over). He prefers the **faithful redraws** of today's
  designs (enemies especially); the crew's field sprites styled on the new Kit. Walk cycles: small glitches he
  flags per frame, fixable at integration (e.g. snapping each frame to the standing sprite's colours).
- **CI was red from the GPU effects commit (965795d) until 8ea2335:** headless Chromium on the runners gives a
  software (SwiftShader) WebGL 2 context without a "performance caveat", so the effects ran on the CPU at ~25 fps and
  `e2e/perf.spec.ts` failed. The presenter now also refuses software renderers by name.
- **Waiting on Mark's next playthrough.** His existing save loads: saves migrate to format v3 (levels re-worked on
  the new curve from the XP earned, Rook at 10, story unlocks already passed are set). A new game shows the new
  opening (Rook's wound). Rebuild first: `npm run build && npm run preview` (http://localhost:3008).
- **Decisions waiting on Mark** (in `playthrough-1.md`, "Judgment calls"): is the new battle pace right (one constant,
  `FX_PACE`); Rook sits at 10–11 beside a level-6 chapter (his choice for note 7, flagged by the reviewer); human
  enemies kept the party's pixel scale while creatures got finer art (the battle reviewer calls the mix of densities
  a flaw); whether to act on round 13's design notes.
- **Parked ideas Mark liked** (Future Plans): a GPU effects layer (WebGL post-process and particles on top of the
  current renderer, no port); a one-battle Unity spike before any port.
- **State at this handoff:** see the end of this section's commit (`git log -1`); CI runs on every push.

### What happens next, in order
1. **Mark reviews the art pass** (`/artreview.html`), then **integration**: read his picks and notes
   (`node scripts/pixellab/status.mjs --review`), regenerate what he asks for (the month's other ~1,000 generations,
   his call), then put the picks into the game for real (the integration questions are above).
2. **Random-NPC generator prototype** (Mark, 2026-09-30: "try the small prototype after this pass of art review is
   done"). Townsfolk made from one clean PixelLab base body plus outfit variants, recoloured at runtime, instead of a
   fixed set of sprites. Scope: one base townsperson with a clean walk; about 4 outfit variants through PixelLab's
   `/create-character-state` (a text edit applied across all directions) and `/transfer-outfit-v2` or
   `/edit-animation-v2` (re-dress the walk keeping its motion), neither tested yet; a recolouring step (skin, hair,
   clothes in known colour slots) hooked into the existing `randomLook(seed)` crowd code (`src/art/chars.ts`,
   `src/data/looks.ts`); tried in game on Lantern Row. **Price it first** (guess: 40–60 generations). Story and named
   characters stay hand-picked. Background: `docs/CONCEPTS.md` ("Paper-doll characters", "Palette swap").
3. **Mark's next playthrough**: new notes are the work queue, same process (triage, fix, one verification round if he
   asks for it).
4. **Triage round 13's design notes** with Mark (`reviews/round-13.md`): the lift scene's motivation (Narrative's
   cap), trash-fight depth and a Lurker tell, the Rustyard scrap heaps and Sprawl rooftops, party back-sprites that
   cover enemies, menu transitions, a real (unforced) E2E playthrough.
5. **Mark's reviews**: `docs/quality/GRADING.md`, `docs/GLOSSARY.md` ([review] marks), `docs/SETTING.md` ([new]).
6. **Ship the alpha**: shadowjog.com with the secure email sign-up. **Only with Mark's go-ahead.**
7. **Chapter 2, "Deniable Assets"**: getting Rook back (seeds in `docs/SETTING.md` §10).

### Known gaps (from round 13; none are bugs)
- Battle presentation (7.5): the party are back-of-head sprites that cover enemies; creatures are finer than the party
  and human enemies (mixed pixel density); spell FX are small primitives. A GPU effects layer is the parked idea.
- Combat (7.7): most trash fights end in two rounds; few tells reach normal fights; the Lurker has no tell.
- Narrative (6.0, capped): nobody says why the crew rides Pale's lift; Pale's intake arithmetic; ending repetition.
- Field art (7.0): Rustyard scrap heaps read as noise; six rooftop stamps; the toxic canal reads as foliage.
- Level design (7.0): small, linear dungeon; one-note puzzles.
- Feel (7.6): the field drops presses mid-step; menus snap open; retry is unskippable. (Results panels now finish
  their count on the first press instead of closing: fixed in playthrough 2.)
- Stability (7.9): the E2E run teleports and auto-resolves; no save/reload mid-chapter test.
- UI: no colour-blind palette or text-size option. Touch controls: no on-screen pad yet.

## Documentation map

| Doc | For |
|---|---|
| `CLAUDE.md` | AI sessions: read order and rules (loaded automatically in this folder) |
| `docs/ARCHITECTURE.md` | How the code is organised and how the pieces talk |
| `docs/DEVELOPING.md` | Commands, tests, debug tools, conventions, traps, recipes |
| `docs/GDD.md` | The game's design |
| `docs/GLOSSARY.md` | Every name, place, faction, term and mechanic (with [review] marks) |
| `docs/CONCEPTS.md` | Game-dev and JRPG concepts behind the game, in plain words, kept current (Mark's learning record) |
| `docs/SETTING.md` | The world bible: history, politics, society, figures ([canon] vs [new]) |
| `docs/quality/GRADING.md` | How quality was graded, the full score history, what it got wrong, the exit |
| `docs/quality/rubric.md`, `scorecard.md`, `reviews/` | The rubric, the scores and work logs, each round's reviewer notes |
| `docs/mark-playthrough-notes.md` | Mark's latest playthrough notes (now playthrough 2's 14; the first 25 are in git history) |
| `docs/quality/playthrough-1.md` | Playthrough 1: what changed for each note, the judgment calls, what round 13 found and fixed |
| `docs/quality/playthrough-2.md` | Playthrough 2: what changed for each note and the judgment calls |
| `docs/original-prompt.md` | The prompt that started it |

## Architecture (summary; full version in docs/ARCHITECTURE.md)

- Vite + TypeScript (strict), zero runtime deps, Canvas 2D at 480x270. Audio is generated in code; art is generated in
  code with Mark's picks from the PixelLab pass loaded over it (`public/art/`, `src/art/drawn.ts`).
- `src/engine/`: loop, scene stack, input, bitmap font, display scaling; the optional GPU effects layer
  (`postfx.ts`, `gl/presenter.ts`, `particles.ts`).
- `src/field/`: map baking (tiles, buildings, props), light map, weather, actors, chests.
- `src/battle/`: pure deterministic engine, AI, FX. `src/scenes/battle.ts` + `battlekit/` are the presentation
  (loaded as a separate chunk).
- `src/audio/`: WebAudio synth, sequencer and composition DSL; 16 songs (`songs.ts`) and 72 SFX.
- `src/story/chapter1.ts`: every story beat. `src/data/maps/*.ts`: all maps, NPCs and events.
- `src/game/`: state, party, save (3 slots + autosave, format v3 with migrations), systems hooks, debug and stage
  presets.
- Tests: Vitest (battle rules, balance simulator, economy Monte Carlo, save, maps, layout, music…) and Playwright
  E2E (full chapter, playtest capture, game over and saves, chaos input, shipped build, perf, audio, screenshots).
- Dev: `npm run dev` (port 3007). Debug routes and the `window.__SJ__` hook are in `docs/DEVELOPING.md` §4.

## Future Plans

- **GPU effects layer** (Mark interested, 2026-09-29): keep the Canvas 2D game and renderer; send the finished frame
  through a small hand-written WebGL pass (bloom, shockwave, heat haze, colour grading) and draw big effects with GPU
  particles, with a Canvas 2D fallback. Mark has particle-system experience and could design emitters. **First
  slice built 2026-09-30** (see "Right now"); targeted improvements, not the full PixiJS port.
- **Unity port** (pinned 2026-09-29): feasible (the procedural art exports to PNG sheets, audio to WAV, the battle
  engine ports mechanically to C#; Unity's own MCP needs its AI plan, community MCPs are free). Proposed first step
  if revisited: a one-battle spike.
- Touch controls.
- **Setting bible.** `docs/SETTING.md` (2026-09-29): history, politics, society, key events and figures, each line tagged [canon] (in the game) or [new] (invented to fill a gap). Mark will use it to shape future narrative and setting changes to his own vision.
- **Glossary review.** `docs/GLOSSARY.md` holds every term and concept in the setting; Mark reviews it as a whole once the alpha phase completes (asked 2026-09-29). Its **[review]** marks and closing questions are the agenda. Keep it current in the same change as any new name or term.
- **Deploy to shadowjog.com** (domain bought 2026-09-28; hosting probably Vercel). Confirm with Mark before any deploy.
- **Last step, after the alpha is fully working: interest sign-up.** The final screen (the "Chapter 2 coming soon"
  card, `src/scenes/ending.ts`) gets an email field so players can ask to hear about updates. It must be secure. The
  details are to be designed with Mark later; points to cover then:
  - the address goes to a server endpoint (a Vercel function), never straight from the browser to a mailing service,
    and no secret or API key ships in the client bundle;
  - validate and rate-limit on the server; bot protection (honeypot or similar); double opt-in confirmation;
  - HTTPS only; a short privacy note at the field; an unsubscribe path; store no more than the address and consent;
  - the game keeps working (and the field fails gracefully, with a visible error state) if the endpoint is down.
- Chapter 2 ("Deniable Assets"): getting Rook back.

## Notes

- Line endings: a CRLF-to-LF fix must skip binary files (a byte replace corrupts PNGs; E2E runs rewrite some
  screenshots under `docs/screenshots/`, so `git diff --name-only` can list them).
- Python edits on Windows: write with `newline='\n'`. Avoid `'` inside Python heredocs; use ’ in dialogue. Scripts
  with backslashes: write them to a file rather than a heredoc.
- No Co-Authored-By lines in commits (per CLAUDE.md).
- Biome's formatter is deliberately off: palettes, glyph tables, maps and ability data are hand-grouped, and the formatter explodes them one entry per line (tried in round 5: +6.8k lines, much harder to read). Lint is enforced in CI; `.editorconfig` covers whitespace.
